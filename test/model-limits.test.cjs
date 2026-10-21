const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Limits = require('../src/model-limits.cjs');
const { catalog, modelCatalog, routeId } = require('../src/gateway.cjs');
const { normalizeModels } = require('../src/claude-models.cjs');
const { migrateSelections } = require('../src/model-selection.cjs');
const { installModelContext } = require('../src/model-context.cjs');
function store(providers) {
  return { data: { providers, routing: { enabled: false } }, provider: id => providers.find(p => p.id === id) };
}

test('numeric metadata is validated; explicit endpoint limits win over model names', () => {
  const official = { authType: 'claude-code' };
  assert.equal(Limits.contextWindow({ id: 'claude-opus-5-5' }, official), 1000000);
  assert.equal(Limits.contextWindow({ id: 'claude-opus-5-5', contextWindow: 200000 }, official), 200000);
  assert.equal(Limits.contextWindow({ id: 'claude-opus-5-5' }, { protocol: 'chat' }), undefined);
  assert.equal(Limits.contextWindow({ id: 'claude-haiku-5-5' }, official), 1000000); // 3.1623.0 catalog
  assert.equal(Limits.contextWindow({ id: 'claude-haiku-6' }, official), undefined);
  assert.equal(Limits.contextWindow({ contextWindow: -1, max_input_tokens: 262144 }), 262144);
  assert.equal(Limits.contextWindow({ context_length: '1000000' }), undefined);
  assert.equal(Limits.contextWindow({ capabilities: ['long_context'] }), undefined);
  assert.equal(Limits.contextWindow({ input_modalities: [
    { supported_inputs: { max_context_length: { value: 1048576 } } },
    { supported_inputs: { max_context_length: { value: 262144 } } },
  ] }), 262144);
});

test('known Claude catalog rows retain limits and unknown models stay unknown', () => {
  const rows = normalizeModels([
    { value: 'opus', resolvedModel: 'claude-opus-5-5' },
    { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1' },
    { value: 'haiku', resolvedModel: 'claude-haiku-6' },
  ]);
  assert.equal(rows[0].contextWindow, 1000000);
  assert.equal(rows[1].contextWindow, 1000000);
  assert.ok(rows[1].aliases.includes('claude-fable-5-1[1m]'));
  assert.equal(rows[2].contextWindow, undefined);
});

test('stable route identities accept native 1M variants only for capable models', () => {
  const s = store([{ id: 'custom', name: 'Custom', protocol: 'chat', models: [
    { id: 'large', contextWindow: 1000000 }, { id: 'small', contextWindow: 32768 },
  ] }]);
  const [large, small] = modelCatalog(s);
  assert.equal(large.id, routeId('custom', 'large'));
  assert.ok(large.aliases.includes(large.id + '[1m]'));
  assert.deepEqual(Limits.nativeConfig(large), { supports1m: true, prefer1m: true });
  assert.deepEqual(Limits.nativeConfig(small), {});
  assert.equal(small.aliases, undefined);
  assert.equal(Limits.canonicalId(large.id + '[1m]'), large.id);
  assert.equal(Limits.canonicalId('real-model[1m]'), 'real-model[1m]');
});

test('pooling cannot inflate a subscription to the direct API context limit', () => {
  const s = store([
    { id: 'api', name: 'API', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-test', contextWindow: 1000000 }] },
    { id: 'account', name: 'Account', protocol: 'responses', authType: 'chatgpt-subscription', signedIn: true,
      models: [{ id: 'gpt-test', contextWindow: 272000 }] },
  ]);
  const pooled = modelCatalog(s);
  assert.equal(pooled.length, 1);
  assert.equal(pooled[0].meta.contextWindow, 272000);
  assert.ok(!pooled[0].aliases.some(id => id.endsWith('[1m]')));
  assert.equal(catalog(s)[0].meta.contextWindow, 1000000);
});

test('Code selection migration preserves transcripts, backs up, and is idempotent', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-model-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = routeId('custom', 'large');
  const models = [Limits.withContextAliases({ id, aliases: ['old-route'], meta: { contextWindow: 1000000 } })];
  const codeDir = path.join(dir, 'claude-code-sessions', 'org', 'workspace');
  const coworkDir = path.join(dir, 'local-agent-mode-sessions', 'org', 'workspace');
  for (const p of [codeDir, coworkDir]) fs.mkdirSync(p, { recursive: true });
  const data = { model: 'old-route', sessionId: 'keep-id', transcript: ['unchanged'], owner: 'keep-owner' };
  for (const p of [codeDir, coworkDir]) fs.writeFileSync(path.join(p, 'local_test.json'), JSON.stringify(data));
  assert.equal(migrateSelections(dir, models).length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codeDir, 'local_test.json'))), { ...data, model: id + '[1m]' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(coworkDir, 'local_test.json'))), { ...data, model: id });
  assert.deepEqual(migrateSelections(dir, models), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'model-selection-backups', 'claude-code-sessions', 'org', 'workspace', 'local_test.json'))), data);
});

test('Cowork retains exact numeric limits and supports suffixed aliases', () => {
  const handlers = new Map();
  const ipc = { handle: (channel, fn) => handlers.set(channel, fn) };
  const route = Limits.withContextAliases({ id: 'test', meta: { contextWindow: 1048576 } });
  installModelContext(ipc, [route]);
  ipc.handle('ClaudeVM_$_setYukonSilverConfig', (_event, config) => config);
  const output = handlers.get('ClaudeVM_$_setYukonSilverConfig')({}, { contextWindowByModel: { other: 1234 } });
  assert.deepEqual(output.contextWindowByModel, { other: 1234, test: 1048576, 'test[1m]': 1048576 });
});
