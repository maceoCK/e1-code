const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model-effort.cjs");
test("engine capabilities match each provider model and preserve explicit overrides", () => {
  const caps = M.nativeEngineCapabilities([
    { id: "claude-aster-mini", model: "gpt-5.4-mini" },
    { id: "claude-aster-astra", model: "gpt-6-astra" },
    { id: "claude-aster-4", model: "gpt-4.1" },
  ], "claude-aster-mini=-xhigh_effort");
  assert.equal(caps, "claude-aster-mini=effort,xhigh_effort,-max_effort;claude-aster-astra=effort,xhigh_effort,max_effort;claude-aster-4=effort,xhigh_effort,-max_effort;claude-aster-mini=-xhigh_effort");
});
test("native provider aliases offer only supported efforts and preserve unknown catalog lookup", () => {
  M.registerNativeRoutes([
    { id: "claude-aster-mini", model: "gpt-5.4-mini" },
    { id: "claude-aster-astra", model: "gpt-6-astra" },
    { id: "claude-aster-4", model: "gpt-4.1" },
  ]);
  assert.deepEqual(M.nativeThinking("claude-aster-mini").effort_options.map(x => x.id), ["low", "medium", "high", "xhigh"]);
  assert.equal(M.nativeThinking("claude-aster-astra").effort_options.at(-1).id, "max");
  assert.deepEqual(M.withUltracode('code', 'claude-aster-4', M.nativeThinking('claude-aster-4')).effort_options.map(x => x.id), ['low', 'ultracode']);
  assert.equal(M.nativeThinking("claude-sonnet-5"), undefined);
  const thinking = M.nativeThinking("claude-aster-mini");
  assert.equal(M.withUltracode("code", "claude-aster-mini", thinking).effort_options.at(-1).id, "ultracode");
  assert.equal(M.withUltracode("chat", "claude-aster-mini", thinking), thinking);
  const capped = { effort_options: thinking.effort_options.slice(0, 3) };
  assert.equal(M.withUltracode("code", "claude-aster-mini", capped), capped);
});
test('Abliteration offers Default and Ultracode while retaining native policy caps and honest provider capabilities', () => {
  const route = { id: 'claude-aster-abliteration', model: 'abliterated-model-large-v2', meta: { reasoning: true, compat: { supportsReasoningEffort: false } } };
  M.registerNativeRoutes([route]);
  assert.deepEqual(M.supportedEfforts(route.model, route.meta), []);
  assert.equal(M.nativeMaxEffort(route.model, route.meta), 'xhigh');
  const raw = M.nativeThinking(route.id);
  const visible = M.withUltracode('code', route.id, raw);
  assert.deepEqual(visible.effort_options.map(x => x.name), ['Default', 'Ultracode']);
  assert.deepEqual(M.withUltracode('chat', route.id, raw).effort_options.map(x => x.id), ['low']);
  assert.deepEqual(M.withUltracode('code', route.id, { effort_options: raw.effort_options.filter(x => x.id !== 'xhigh') }).effort_options.map(x => x.id), ['low']);
});
test('native renderer recognizes workflow-only capability without adding a fictitious Extra option', () => {
  const patch = require('../scripts/patch-workflow-renderer.cjs').patch;
  const source = 'function vD(e){return e.flatMap(e=>{let t=dD.safeParse(e.id);return!t.success||t.data==="xhigh"&&!sD()?[]:[{...e,id:t.data}]})}';
  const vm = require('node:vm');
  const context = { dD: { safeParse: id => ({ success: ['low', 'medium', 'high', 'xhigh', 'max'].includes(id), data: id }) }, sD: () => true };
  const fn = vm.runInNewContext(patch(source) + '; vD', context);
  assert.equal(JSON.stringify(fn([{ id: 'low' }, { id: 'ultracode' }])), JSON.stringify([{ id: 'low' }, { id: 'xhigh' }]));
  assert.equal(fn([{ id: 'xhigh' }, { id: 'ultracode' }]).length, 1);
  context.sD = () => false;
  assert.equal(fn([{ id: 'low' }, { id: 'ultracode' }]).length, 1, 'native workflow gate still applies');
});
test('workflow effort is omitted for Abliteration and clamped for providers with bounded controls', () => {
  const G = require('../src/gateway.cjs');
  const body = { output_config: { effort: 'xhigh' }, messages: [{ role: 'user', content: 'Use workflows.' }], tools: [] };
  const provider = { protocol: 'chat', baseUrl: 'https://example.test/v1' };
  const route = { model: 'abliterated-model-large-v2', meta: { reasoning: true, compat: { supportsReasoningEffort: false } } };
  const output = G.requestFor(body, provider, route).body;
  assert.equal('reasoning_effort' in output, false);
  const bounded = G.requestFor(body, provider, { model: 'bounded', meta: { compat: { supportsReasoningEffort: true }, reasoningEfforts: ['low', 'medium', 'high'] } }).body;
  assert.equal(bounded.reasoning_effort, 'high');
  const claude = G.requestFor(body, { protocol: 'claude-code', baseUrl: 'claude-code://local' }, { model: 'claude-opus-4-6', meta: { reasoningEfforts: ['low', 'medium', 'high', 'max'] } }).body;
  assert.equal(claude.output_config.effort, 'high');
});
