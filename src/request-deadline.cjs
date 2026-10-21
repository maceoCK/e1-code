// A response may run for a long time while still making progress. Bound silence
// separately from total runtime, and preserve the caller's cancellation reason.
const DEFAULTS = Object.freeze({ firstByteMs: 300000, idleMs: 300000, totalMs: 3600000 });
function timeoutPolicy(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) =>
    [key, Number.isFinite(value?.[key]) ? Math.max(1000, Math.min(86400000, value[key])) : fallback]));
}
function createDeadline(parent, options = DEFAULTS) {
  const limits = { ...DEFAULTS, ...options }, controller = new AbortController();
  let idleTimer, totalTimer, closed = false;
  const expire = phase => controller.abort(Object.assign(Error(phase === 'first_byte'
    ? 'The provider did not start responding in time.'
    : phase === 'idle' ? 'The provider stopped sending data for too long.'
    : 'The provider exceeded the maximum response duration.'),
    { name: 'TimeoutError', status: 504, code: 'provider_timeout', timeoutPhase: phase }));
  const arm = (phase, ms) => { clearTimeout(idleTimer); idleTimer = setTimeout(() => expire(phase), ms); idleTimer.unref?.(); };
  const cancelled = () => controller.abort(parent.reason);
  parent?.addEventListener('abort', cancelled, { once: true });
  if (parent?.aborted) cancelled();
  arm('first_byte', limits.firstByteMs);
  totalTimer = setTimeout(() => expire('total'), limits.totalMs); totalTimer.unref?.();
  const touch = () => { if (!closed && !controller.signal.aborted) arm('idle', limits.idleMs); };
  const close = () => { closed = true; clearTimeout(idleTimer); clearTimeout(totalTimer); parent?.removeEventListener('abort', cancelled); };
  controller.signal.addEventListener('abort', close, { once: true });
  if (controller.signal.aborted) close();
  const observe = response => {
    controller.signal.throwIfAborted(); touch();
    if (!response.body) return response;
    const reader = response.body.getReader(); let ended = false, output;
    const end = () => { ended = true; controller.signal.removeEventListener('abort', abort); };
    const abort = () => {
      if (ended) return; end(); output.error(controller.signal.reason);
      void reader.cancel(controller.signal.reason).catch(() => {}).finally(() => reader.releaseLock());
    };
    const body = new ReadableStream({
      start(c) { output = c; controller.signal.addEventListener('abort', abort, { once: true }); if (controller.signal.aborted) abort(); },
      async pull(c) {
        try {
          const next = await reader.read(); if (ended) return;
          if (next.done) { end(); reader.releaseLock(); c.close(); }
          else { if (next.value.byteLength) touch(); c.enqueue(next.value); }
        } catch (error) { if (!ended) { end(); reader.releaseLock(); c.error(controller.signal.aborted ? controller.signal.reason : error); } }
      },
      async cancel(reason) { if (ended) return; end(); try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return { signal: controller.signal, touch, close, observe };
}
module.exports = { DEFAULTS, timeoutPolicy, createDeadline };
