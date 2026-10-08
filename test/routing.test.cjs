const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../src/gateway.cjs'), R = require('../src/routing.cjs');
const wire = (...events) => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const complete = () => wire({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'RESULT' }, { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 2 } } });
test('billing details distinguish account identity from known plan tier',()=>{
  assert.deepEqual(R.billingDetails({authType:'claude-code',planType:'max',name:'Personal',accountEmail:'me@example.test'}),{planName:'Claude Max',accountLabel:'Personal',accountEmail:'me@example.test'});
  assert.equal(R.billingDetails({authType:'chatgpt-subscription',name:'Work Pro'}).planName,'ChatGPT subscription');
});
function fixture(allowApiFallback = false) {
  const providers = ['one', 'two', 'api'].map(id => ({ id, name: id, protocol: 'responses', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-6.1-sol' }],
    ...(id === 'api' ? {} : { authType: 'chatgpt-subscription', accountId: id, signedIn: true }) }));
  return { data: { providers, routing: { enabled: true, allowApiFallback, order: ['one', 'two', 'api'] } },
    provider: id => providers.find(p => p.id === id), key: p => p.id };
}
test('automatic routing defaults to subscription-only, retains exact models and respects unknown reset times', () => {
  const store = fixture(), routes = G.catalog(store), selected = routes.find(r => r.provider === 'api');
  assert.deepEqual(R.policyFor().allowApiFallback, false);
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), {}).map(r => r.provider), ['one', 'two']);
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), { one: { retryAt: null }, two: { retryAt: null } }), []);
  store.data.routing.allowApiFallback = true;
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), {}).map(r => r.provider), ['one', 'two', 'api']);
  assert.equal(R.retryAt(new Headers()), null);
  assert.equal(R.retryAt(new Headers({ 'Retry-After': '30' }), 1000), 31000);
});
test('quota fallback preserves the full tool history, uses API only when allowed and reports billing', async () => {
  for (const allowApi of [false, true]) {
    const store = fixture(allowApi), calls = [], statuses = [];
    const gateway = await G.startGateway({ store, onStatus: s => statuses.push(s), transport: async (url, options) => {
      const account = options.headers.Authorization.slice(7), request = JSON.parse(options.body); calls.push({ account, request });
      if (account !== 'api') return new Response(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }), { status: 429 });
      return complete();
    } });
    try {
      const messages = [{ role: 'user', content: 'Use my earlier result' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/fixture' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ORIGINAL_CONTEXT' }] }];
      const res = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ model: gateway.catalog()[0].id, stream: true, messages }) });
      const text = await res.text();
      assert.deepEqual(calls.map(c => c.account), allowApi ? ['one', 'two', 'api'] : ['one', 'two']);
      for (const c of calls) assert.equal(c.request.input.at(-1).output, 'Read result for file_path="/fixture"\nORIGINAL_CONTEXT');
      if (allowApi) { assert.match(text, /RESULT/); assert.equal(statuses.at(-1).billing, 'api'); assert.equal(statuses.at(-1).fallback, true); }
      else assert.match(text, /subscription_sharing_usage_limit_exceeded/);
    } finally { gateway.close(); }
  }
});
test('streamed quota errors retry only before content and never replay an exposed tool call', async () => {
  for (const exposed of [false, true]) {
    const store = fixture(true), calls = [];
    const gateway = await G.startGateway({ store, transport: async (_url, options) => {
      calls.push(options.headers.Authorization);
      if (calls.length > 1) return complete();
      return wire({ type: 'response.created', response: {} }, ...(exposed ? [{ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'action', name: 'Write', arguments: '{}' } }] : []),
        { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } });
    } });
    try {
      const text = await (await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ model: gateway.catalog()[0].id, stream: true, messages: [{ role: 'user', content: 'test' }] }) })).text();
      assert.equal(calls.length, exposed ? 1 : 2);
      assert.equal((text.match(/event: message_start/g) || []).length, 1);
      assert.equal(text.includes('RESULT'), !exposed);
    } finally { gateway.close(); }
  }
});
test('ChatGPT plan requests use the public endpoint, namespaces, streaming and client-side history', () => {
  const store = fixture(), route = G.catalog(store)[0];
  const r = G.requestFor({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 100,
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: {} } }], tool_choice: { type: 'tool', name: 'Read' } }, store.provider('one'), route);
  assert.equal(r.url, 'https://api.openai.com/v1/responses');
  assert.equal(r.body.store, false); assert.equal(r.body.stream, true);
  assert.equal(r.body.max_output_tokens, undefined); assert.equal(r.body.previous_response_id, undefined);
  assert.equal(r.body.tools[0].type, 'namespace'); assert.equal(r.body.tool_choice, 'required');
  assert.deepEqual(r.body.tools[0].tools.map(t => t.name), ['Read']);
});

test('native JSON model validation consumes ChatGPT plan streaming without losing content', async () => {
  const store = fixture(); let observed;
  const gateway = await G.startGateway({ store, transport: async (_url, options) => {
    observed = JSON.parse(options.body); const stream = complete();
    return new Response(stream.body, { headers: { 'Content-Type': 'application/json' } });
  } });
  try {
    const res = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token },
      body: JSON.stringify({ model: gateway.catalog()[0].id, stream: false, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }) });
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(observed.stream, true); assert.equal(observed.max_output_tokens, undefined);
    const result = await res.json(); assert.equal(result.content[0].text, 'RESULT'); assert.equal(result.stop_reason, 'end_turn');
  } finally { gateway.close(); }
});
