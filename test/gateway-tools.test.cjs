const test = require('node:test');
const assert = require('node:assert/strict');
const { requestFor } = require('../src/gateway.cjs');
const { inputFor } = require('../src/claude-engine.cjs');
const { nativePicker } = require('../src/model-picker.cjs');
const { registerNativeRoutes, nativeThinking } = require('../src/model-effort.cjs');
const schema = { type: 'object', properties: {} };
const body = {
  model: 'alias', max_tokens: 64,
  tools: [{ name: 'ToolSearch', input_schema: schema },
    { name: 'mcp__browser__navigate', input_schema: schema, defer_loading: true },
    { name: 'mcp__unused__big_schema', description: 'x'.repeat(10000), input_schema: schema, defer_loading: true }],
  messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'search-1', name: 'ToolSearch', input: { query: 'browser' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'search-1', content: [{ type: 'tool_reference', tool_name: 'mcp__browser__navigate' }] }] },
  ],
};
const route = { id: 'alias', model: 'test-model', provider: 'test', meta: {} };
for (const protocol of ['responses', 'chat', 'ollama', 'claude-code']) {
  test(protocol + ' preserves discovery result while omitting unused schemas', () => {
    const request = requestFor(body, { protocol, baseUrl: 'http://127.0.0.1' }, route);
    const json = JSON.stringify(request.body);
    assert.ok(json.includes('mcp__browser__navigate'));
    assert.ok(!json.includes('mcp__unused__big_schema'));
    assert.ok(!json.includes('"type":"tool_reference"'));
    assert.ok(json.includes('is available'));
    assert.equal(request.body.tools.length, 2);
    if (protocol === 'claude-code') {
      assert.ok(inputFor(request.body)[0].text.includes('is available'));
      assert.ok(!inputFor(request.body)[0].text.includes('mcp__unused__big_schema'));
    }
    assert.equal(body.tools.length, 3);
    assert.equal(body.tools[1].defer_loading, true);
  });
}
test('native Anthropic retains reference blocks and deferral semantics', () => {
  const request = requestFor(body, { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, route);
  assert.deepEqual(request.body.tools, body.tools);
  assert.deepEqual(request.body.messages, body.messages);
});
test('curated picker only trusts configured E1 IDs, preserves exclusions and 1M flags', () => {
  const a = 'claude-aster-0000000000000001', b = 'claude-aster-0000000000000002';
  const settings = nativePicker([{ name: a, labelOverride: 'Claude test', supports1m: true }, { name: b }, { name: 'arbitrary' }], new Set([b]));
  assert.deepEqual(settings.modelPicker.options, [{ model: a, label: 'Claude test' }, { model: a + '[1m]', label: 'Claude test (1M context)' }]);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, false);
  assert.deepEqual(nativePicker([{ name: 'unknown' }]), {});
});
test('effort picker handles explicit context aliases without changing model capabilities', () => {
  registerNativeRoutes([{ id: 'alias', aliases: ['alias[1m]'], model: 'claude-opus-5-5', meta: { reasoningEfforts: ['low', 'high', 'max'] } }]);
  assert.deepEqual(nativeThinking('alias[1m]'), nativeThinking('alias'));
  assert.ok(nativeThinking('alias[1m]').effort_options.some(o => o.id === 'max'));
});
