// Inference only: callers own route selection, deadlines and any interpretation
// of the normalized result. No tools, conversation history or engine startup.
const MAX_RESPONSE_BYTES = 1024 * 1024;

class VisionProviderError extends Error {
  constructor(message, code = 'VISION_REQUEST_FAILED', status) {
    super(message);
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function abortable(work, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    let pending;
    try { pending = work(); } catch (error) { cleanup(); reject(signal.aborted ? signal.reason : error); return; }
    Promise.resolve(pending).then(value => {
      cleanup();
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { cleanup(); reject(signal.aborted ? signal.reason : error); });
  });
}

// Cleanup must not delay cancellation or make an HTTP failure expose a body.
function cancelBody(body, reason) {
  try { Promise.resolve(body?.cancel(reason)).catch(() => {}); } catch {}
}

function boundedResponse(response, signal, maxBytes = MAX_RESPONSE_BYTES) {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('Invalid vision response limit');
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0, cancelled = false;
  const cancel = reason => {
    if (cancelled) return;
    cancelled = true;
    cancelBody(reader, reason);
  };
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await abortable(() => reader.read(), signal);
        bytes += value?.byteLength || 0;
        if (bytes > maxBytes) throw Error('Vision response exceeds limit');
        if (done) controller.close(); else controller.enqueue(value);
      } catch (error) { cancel(error); controller.error(error); }
    },
    cancel,
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

function createVisionProvider({ store, transport, requestFor, responseFor, relay }) {
  async function run({ route, system, content, signal = new AbortController().signal, onProvider = () => {}, maxTokens = 6000 }) {
    signal.throwIfAborted();
    let upstream;
    try {
      const provider = store.provider(route.provider);
      if (!provider || !['responses', 'chat', 'anthropic', 'ollama'].includes(provider.proxy?.protocol || provider.protocol) || (provider.authType === 'claude-code' && !provider.proxy))
        throw new VisionProviderError('vision provider is not an HTTP inference adapter');
      // Build a fresh, single-user request, never forward tool declarations or
      // replay tool-use/result blocks supplied as content by another caller.
      if (typeof content !== 'string' && (!Array.isArray(content) || content.some(block => !block || !['text', 'image'].includes(block.type))))
        throw new VisionProviderError('vision request accepts only text and images');
      onProvider(provider.id);
      const body = { model: route.id, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
      const outbound = requestFor(body, provider, route, {});
      const key = await abortable(() => store.key(provider), signal);
      signal.throwIfAborted();
      const headers = { 'Content-Type': 'application/json' };
      if (provider.protocol === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else if (key) headers.Authorization = `Bearer ${key}`;
      if (provider.connectionMode === 'codex') { headers['ChatGPT-Account-ID'] = provider.workspaceAccountId; headers.originator = 'e1_code'; }
      const send = () => abortable(async () => {
        const response = await transport(outbound.url, { method: 'POST', headers, body: JSON.stringify(outbound.body), signal, redirect: 'error', credentials: 'omit' });
        // A custom transport may ignore its signal and finish after cancellation.
        if (signal.aborted) { cancelBody(response.body); signal.throwIfAborted(); }
        return response;
      }, signal);
      upstream = await send();
      if (upstream.status === 401 && provider.connectionMode === 'codex' && !provider.proxy) {
        cancelBody(upstream.body);
        upstream = undefined;
        headers.Authorization = 'Bearer ' + await abortable(() => store.subscriptions.token(provider.accountId, true), signal);
        signal.throwIfAborted();
        upstream = await send();
      }
      if (!upstream.ok) {
        const status = Number.isInteger(upstream.status) && upstream.status >= 100 && upstream.status <= 599 ? upstream.status : undefined;
        throw new VisionProviderError(status === undefined ? 'vision request failed' : `vision provider returned HTTP ${status}`, 'VISION_HTTP_ERROR', status);
      }
      upstream = boundedResponse(upstream, signal);
      const protocol = provider.proxy?.protocol || (provider.proxy ? 'anthropic' : provider.protocol);
      const result = (!provider.proxy && provider.authType === 'chatgpt-subscription') || upstream.headers.get('content-type')?.includes('text/event-stream')
        ? await abortable(() => relay(upstream, protocol, route.id, { get destroyed() { return signal.aborted; }, write() {}, end() {} }), signal)
        : await abortable(async () => responseFor(await upstream.json(), protocol, route.id), signal);
      signal.throwIfAborted();
      // Keep stop_reason, usage, and content intact, including partial completion.
      return result;
    } catch (error) {
      signal.throwIfAborted();
      // Do not attach a cause: transport/adapter errors may contain tokens,
      // private URLs, image data or complete provider error bodies.
      throw error instanceof VisionProviderError ? error : new VisionProviderError('vision request failed');
    } finally {
      cancelBody(upstream?.body);
      onProvider(null);
    }
  }
  return { run };
}

module.exports = { createVisionProvider, boundedResponse };
