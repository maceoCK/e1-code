const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const G = require('../src/gateway.cjs');

const prefix = 'mcp__cua-driver__';
const input_schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const target = { pid: { type: 'integer' }, window_id: { type: 'integer' }, session: { type: 'string' } };
const tools = [
  { name: prefix + 'get_window_state', description: 'Observe one window.', input_schema: input_schema({ ...target,
    include_screenshot: { type: 'boolean' }, include_accessibility_tree: { type: 'boolean' }, timeout_ms: { type: 'integer' } }, ['pid', 'window_id']) },
  { name: prefix + 'click', description: 'Click one observed target.', input_schema: input_schema({ ...target,
    element_token: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, capture_id: { type: 'string' },
    delivery_mode: { type: 'string', enum: ['background', 'foreground'] } }, ['pid']) },
];
// A real PNG header; this fixture contains no account or application content.
const image = Buffer.alloc(33);
Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(image);
image.writeUInt32BE(230, 16); image.writeUInt32BE(408, 20);
const IMAGE = image.toString('base64');
const captureInput = { pid: 689, window_id: 49, session: 'fixture' };
const capture = id => ({ type: 'tool_result', tool_use_id: id, content: [
  { type: 'text', text: JSON.stringify({ pid: 689, window_id: 49, snapshot_id: 's00000026', capture_id: 'capture_fixture_1',
    screenshot_width: 230, screenshot_height: 408, screenshot_scale: 1, screenshot_frame_valid: true,
    elements: [{ element_token: 's00000026:0', element_index: 0, role: 'AXWindow', label: 'Calculator', depth: 0, actions: ['AXRaise'],
      screenshot_frame: { x: 0, y: 0, w: 230, h: 408 } },
    { element_token: 's00000026:1', element_index: 1, role: 'AXButton', label: '7', depth: 2, parent_index: 0, actions: ['AXPress'],
      screenshot_frame: { x: 12, y: 183, w: 42, h: 42 } }] }) },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: IMAGE } },
] });
const observation = () => [
  { role: 'user', content: 'Press 7 in the calculator.' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'observe-1', name: prefix + 'get_window_state', input: captureInput }] },
  { role: 'user', content: [capture('observe-1')] },
];
const step = { goal: 'Press the 7 button.', observation_tool_use_id: 'observe-1', expected_outcome: 'The display shows 7.' };
const proposal = { outcome: 'action', tool_name: prefix + 'click', input: { pid: 689, window_id: 49, session: 'fixture', element_token: 's00000026:1' } };
class MemoryResponse extends EventEmitter {
  constructor() { super(); this.chunks = []; this.headersSent = false; this.destroyed = false; }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; }
  flushHeaders() {}
  write(c) { this.chunks.push(String(c)); }
  end(c) { if (c !== undefined) this.write(c); this.emit('close'); }
  text() { return this.chunks.join(''); }
}
function nativeTool(data = step) { return { type: 'tool_use', id: 'virtual-1', name: 'E1CuaStep', input: data }; }
function upstream(protocol, content, stream, truncated = false) {
  const tool = content.find(c => c.type === 'tool_use');
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('');
  if (!stream) return new Response(JSON.stringify(protocol === 'responses'
    ? { status: truncated ? 'incomplete' : 'completed', output: tool
        ? [{ type: 'function_call', call_id: tool.id, name: tool.name, arguments: JSON.stringify(tool.input) }]
        : [{ type: 'message', content: [{ type: 'output_text', text }] }] }
    : { choices: [{ finish_reason: truncated ? 'length' : tool ? 'tool_calls' : 'stop', message: tool
        ? { tool_calls: [{ id: tool.id, function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] } : { content: text } }] }),
    { headers: { 'content-type': 'application/json' } });
  const events = protocol === 'responses'
    ? [...(tool ? [{ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: tool.id, name: tool.name, arguments: JSON.stringify(tool.input) } }]
        : [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text }]),
      { type: truncated ? 'response.incomplete' : 'response.completed', response: { usage: {} } }]
    : [{ choices: [{ delta: tool ? { tool_calls: [{ index: 0, id: tool.id, function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] } : { content: text } }] },
      { choices: [{ delta: {}, finish_reason: truncated ? 'length' : tool ? 'tool_calls' : 'stop' }] }];
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
async function fixture(t, { protocol = 'chat', stream = false, truncated = false, helper = proposal, messages = observation(), respond } = {}) {
  let handler;
  const server = new EventEmitter();
  server.listen = (_port, _host, done) => done(); server.address = () => ({ port: 43123 }); server.close = () => {};
  const mock = t.mock.method(http, 'createServer', cb => { handler = cb; return server; });
  const providers = [
    { id: 'main', name: 'Planner', protocol, baseUrl: 'https://planner.example.test/v1', models: [{ id: 'abliterated', input: ['text'] }] },
    { id: 'luna', name: 'Luna', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-6-luna', input: ['text', 'image'] }] },
  ];
  const sent = [];
  const store = { data: { providers, routing: { allowApiFallback: true } }, provider: id => providers.find(p => p.id === id), key: async () => 'fixture' };
  const gateway = await G.startGateway({ store, token: 'fixture-token', transport: async (url, options) => {
    const call = { url, body: JSON.parse(options.body) }; sent.push(call);
    if (respond) return respond(call, sent, protocol);
    return url.startsWith(providers[1].baseUrl)
      ? upstream('responses', [{ type: 'text', text: JSON.stringify(helper) }], false)
      : upstream(protocol, messages === null ? [{ type: 'text', text: 'Ordinary streamed answer' }] : [nativeTool()], stream, truncated);
  } });
  mock.mock.restore(); t.after(() => gateway.close());
  const model = gateway.catalog().find(r => r.provider === 'main').id;
  const body = { model, tools, stream, max_tokens: 2000, messages: messages || [{ role: 'user', content: 'Hello.' }] };
  async function invoke(input = body) {
    const res = new MemoryResponse();
    await handler({ method: 'POST', url: '/v1/messages', headers: { host: '127.0.0.1:43123', authorization: 'Bearer fixture-token' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
    return res;
  }
  return { body, sent, invoke, gateway };
}
for (const protocol of ['chat', 'responses', 'ollama']) {
  for (const stream of [false, true]) {
    test(`${protocol} ${stream ? 'SSE' : 'JSON'} compiles operator into a normal native tool`, async t => {
      const f = await fixture(t, { protocol, stream });
      const before = structuredClone(f.body);
      const res = await f.invoke();
      assert.equal(res.statusCode, 200, res.text());
      assert.equal(f.sent.length, 2, JSON.stringify(f.sent.map(c => c.url)));
      assert.ok(f.sent[0].url.includes('planner.example.test'));
      assert.ok(JSON.stringify(f.sent[0].body).includes('E1CuaStep'));
      assert.ok(!JSON.stringify(f.sent[0].body).includes(IMAGE));
      assert.ok(JSON.stringify(f.sent[1].body).includes(IMAGE));
      assert.ok(!res.text().includes('E1CuaStep'), 'virtual tool must never reach native host');
      assert.ok(res.text().includes(prefix + 'click'), res.text());
      assert.ok(!res.text().includes('virtual-1'));
      assert.deepEqual(f.body, before);
    });
  }
  test(`${protocol} incomplete virtual call cannot execute`, async t => {
    const f = await fixture(t, { protocol, stream: true, truncated: true });
    const res = await f.invoke();
    assert.equal(f.sent.length, 1, 'do not ground an incomplete planner proposal');
    assert.ok(!res.text().includes('"type":"tool_use"'), res.text());
    assert.ok(!res.text().includes('"name":"E1CuaStep"'));
  });
  test(`${protocol} ordinary turns still stream without invoking helper`, async t => {
    const f = await fixture(t, { protocol, stream: true, messages: null });
    const res = await f.invoke();
    assert.equal(f.sent.length, 1);
    assert.ok(!JSON.stringify(f.sent[0].body).includes('E1CuaStep'));
    assert.match(res.text(), /content_block_delta/);
    assert.match(res.text(), /Ordinary streamed answer/);
  });
}

test('matching native action result produces a fresh permission-controlled capture without planner inference', async t => {
  const f = await fixture(t);
  const first = JSON.parse((await f.invoke()).text());
  const action = first.content.find(c => c.type === 'tool_use');
  assert.ok(action, JSON.stringify(first));
  const body = { ...f.body, messages: [...f.body.messages,
    { role: 'assistant', content: first.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: action.id, content: [{ type: 'text', text: '{"effect":"unverifiable"}' }] }] },
  ] };
  const next = JSON.parse((await f.invoke(body)).text());
  assert.equal(f.sent.length, 2, 'capture transition has no provider request');
  const captureCall = next.content.find(c => c.type === 'tool_use');
  assert.equal(captureCall.name, prefix + 'get_window_state');
  assert.equal(captureCall.input.pid, 689);
  assert.equal(captureCall.input.window_id, 49);
  assert.notEqual(captureCall.id, action.id);
  assert.doesNotMatch(JSON.stringify(next), /satisfied|successfully/);
});

for (const stream of [false, true]) {
  test(`verified outcome survives gateway retry and native ${stream ? 'SSE' : 'JSON'} output`, async t => {
    let plannerCalls = 0, helperCalls = 0;
    const f = await fixture(t, { respond: (call) => {
      if (call.url.includes('api.openai.com')) {
        helperCalls++;
        assert.ok(helperCalls <= 2, 'operator-owned screenshots must not trigger generic captions');
        return upstream('responses', [{ type: 'text', text: JSON.stringify(helperCalls === 1 ? proposal : { verdict: 'satisfied', evidence: 'The display visibly shows 7.' }) }], false);
      }
      plannerCalls++;
      if (plannerCalls === 1) return upstream('chat', [nativeTool()], false);
      assert.match(JSON.stringify(call.body), /CUA post-action verification: satisfied/);
      assert.doesNotMatch(JSON.stringify(call.body), /data:image/);
      if (plannerCalls === 2) return new Response(JSON.stringify({ error: { message: 'temporary rate limit', code: 'rate_limit' } }), { status: 429, headers: { 'content-type': 'application/json' } });
      return upstream('chat', [{ type: 'text', text: 'Finished.' }], stream);
    } });
    const first = JSON.parse((await f.invoke()).text()), action = first.content.find(c => c.type === 'tool_use');
    const afterAction = { ...f.body, messages: [...f.body.messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: action.id, content: [{ type: 'text', text: '{"effect":"unverifiable"}' }] }] },
    ] };
    const next = JSON.parse((await f.invoke(afterAction)).text()), recapture = next.content.find(c => c.type === 'tool_use');
    const fresh = capture(recapture.id), metadata = JSON.parse(fresh.content[0].text);
    metadata.capture_id = 'capture_fixture_after';
    fresh.content[0].text = JSON.stringify(metadata);
    const afterCapture = { ...f.body, stream, messages: [...afterAction.messages, { role: 'assistant', content: next.content }, { role: 'user', content: [fresh] }] };
    const failed = await f.invoke(afterCapture);
    assert.match(failed.text(), /429.*rate_limit/);
    f.gateway.resetHealth('main');
    const retried = await f.invoke(afterCapture);
    assert.equal(retried.statusCode, 200, retried.text());
    assert.match(retried.text(), /CUA post-action verification: satisfied/);
    assert.match(retried.text(), /Finished\./);
    assert.equal(helperCalls, 2, 'exact retry reuses verified evidence, not a new inference or action');
    assert.doesNotMatch(retried.text(), /"name":"E1CuaStep"/);
  });
}
