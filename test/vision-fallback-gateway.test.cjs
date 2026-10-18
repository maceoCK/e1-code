const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const G = require('../src/gateway.cjs');

// This file is isolated by node --test so its HTTP constructor stub cannot
// affect gateway tests in other files. No Server or socket is ever constructed.
const IMAGE = Buffer.from('gateway-vision-fixture-only').toString('base64');
const DESCRIPTION = 'A green Run button beneath the editor.';
const TOKEN = 'in-memory-gateway-token';
const bounded = { timeout: 2000 };

class MemoryResponse extends EventEmitter {
  constructor() {
    super();
    this.headersSent = false;
    this.destroyed = false;
    this.chunks = [];
  }
  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  flushHeaders() {}
  write(chunk) { this.chunks.push(String(chunk)); return true; }
  end(chunk) {
    if (chunk !== undefined) this.write(chunk);
    this.writableEnded = true;
    this.emit('close');
  }
  json() { return JSON.parse(this.chunks.join('')); }
}
const responseFor = (protocol, text) => new Response(JSON.stringify(
  protocol === 'responses'
    ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
    : protocol === 'anthropic'
      ? { type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }
      : { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
), { headers: { 'content-type': 'application/json' } });

async function harness(t, { protocol = 'chat', transport } = {}) {
  let handler, listenCalls = 0, closeCalls = 0;
  const server = new EventEmitter();
  server.listen = (port, host, ready) => {
    assert.equal(port, 0);
    assert.equal(host, '127.0.0.1');
    listenCalls++;
    ready(); // Simulate readiness; do not bind or create a listener.
  };
  server.address = () => ({ port: 43123 });
  server.close = () => { closeCalls++; };
  const createServer = t.mock.method(http, 'createServer', callback => { handler = callback; return server; });
  const primary = { id: 'primary-fixture', name: 'Text fixture', protocol, baseUrl: 'https://primary.example.test/v1',
    models: [{ id: 'qwen3-abliterated', input: ['text'] }] };
  const vision = { id: 'vision-fixture', name: 'Vision fixture', protocol: 'responses', baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-6-luna', input: ['text', 'image'] }] };
  const providers = [primary, vision], sent = [], keyReads = [], requests = [], statuses = [];
  // No dir or nativeProfile: all preferences and route metadata stay in memory.
  const store = { data: { providers, routing: { allowApiFallback: true } },
    provider: id => providers.find(provider => provider.id === id),
    key: async provider => { keyReads.push(provider.id); return `fixture-key-${provider.id}`; } };
  const gateway = await G.startGateway({ store, token: TOKEN,
    onRequest: request => requests.push(request), onStatus: status => statuses.push(status),
    transport: async (url, options) => {
      const call = { url, options, body: JSON.parse(options.body) };
      sent.push(call);
      if (transport) return transport(call, { primary, vision });
      return url.startsWith(vision.baseUrl) ? responseFor('responses', DESCRIPTION) : responseFor(protocol, 'Main model answer');
    },
  });
  createServer.mock.restore();
  t.after(() => gateway.close());
  assert.equal(listenCalls, 1);
  const selected = gateway.catalog().find(route => route.provider === primary.id);
  assert.ok(selected);
  const body = { model: selected.id, max_tokens: 128, messages: [
    { role: 'user', content: [{ type: 'text', text: 'What is on the screenshot?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: IMAGE } }] },
  ] };
  const invoke = () => {
    const payload = JSON.stringify(body);
    const req = { method: 'POST', url: '/v1/messages', headers: {
      host: new URL(gateway.origin).host, authorization: `Bearer ${TOKEN}`,
    }, async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload.slice(0, 25));
      yield Buffer.from(payload.slice(25));
    } };
    const res = new MemoryResponse();
    return { res, done: handler(req, res) };
  };
  return { gateway, primary, vision, selected, body, sent, keyReads, requests, statuses, invoke,
    get closeCalls() { return closeCalls; } };
}

for (const protocol of ['chat', 'responses', 'anthropic', 'ollama']) {
  test(`gateway prepares images before the actual ${protocol} primary transport without changing models`, bounded, async t => {
    const f = await harness(t, { protocol });
    const original = structuredClone(f.body);
    const { res, done } = f.invoke();
    await done;
    assert.deepEqual(f.body, original);
    assert.equal(res.statusCode, 200);
    assert.equal(f.sent.length, 2);
    const [vision, main] = f.sent;
    assert.equal(vision.url, f.vision.baseUrl + '/responses');
    assert.equal(vision.body.model, 'gpt-6-luna');
    assert.equal(vision.body.input[0].content[1].image_url, `data:image/png;base64,${IMAGE}`);
    assert.ok(main.url.startsWith(f.primary.baseUrl));
    assert.equal(main.body.model, 'qwen3-abliterated');
    const wire = JSON.stringify(main.body);
    assert.ok(wire.includes(DESCRIPTION));
    assert.match(wire, /Image description by gpt-6-luna/);
    assert.ok(!wire.includes(IMAGE));
    assert.doesNotMatch(wire, /data:image\/|"type":"(?:image|input_image|image_url)"|"image_url":/);
    assert.deepEqual(f.keyReads, [f.vision.id, f.primary.id]);
    assert.equal(res.json().model, f.selected.id);
    assert.deepEqual(res.json().content, [{ type: 'text', text: 'Main model answer' }]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].model, 'qwen3-abliterated');
    assert.equal(f.requests[0].provider, f.primary.id);
    assert.ok(f.statuses.every(status => status.model === 'qwen3-abliterated'));
  });
}

for (const target of ['primary', 'vision']) {
  test(`disconnecting the ${target} provider during image analysis aborts helper and never calls primary`, bounded, async t => {
    let began;
    const started = new Promise(resolve => { began = resolve; });
    const f = await harness(t, { transport: (call, { vision }) => {
      assert.equal(call.url, vision.baseUrl + '/responses');
      began(call.options.signal);
      return new Promise((resolve, reject) => {
        call.options.signal.addEventListener('abort', () => reject(call.options.signal.reason), { once: true });
      });
    } });
    const { res, done } = f.invoke();
    const signal = await started;
    assert.equal(signal.aborted, false);
    f.gateway.disconnectProvider(f[target].id);
    await done;
    assert.equal(signal.aborted, true);
    assert.equal(f.sent.length, 1, 'cancelled analysis must not continue to the text model');
    assert.deepEqual(f.keyReads, [f.vision.id]);
    assert.equal(f.requests.length, 0);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().type, 'error');
    assert.match(res.json().error.message, /abort/i);
    assert.ok(!JSON.stringify(res.json()).includes(IMAGE));
  });
}
