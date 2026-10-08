const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const G = require('../src/gateway.cjs'), R = require('../src/routing.cjs'), E = require('../src/claude-engine.cjs');
const { normalizeModels } = require('../src/claude-models.cjs');
const { migrateSelections } = require('../src/model-selection.cjs');
function fixture() {
  const models = normalizeModels([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    { value: 'claude-sonnet-5', displayName: 'Sonnet 5' },
  ]);
  const providers = [
    { id: 'console', name: 'Claude Console', authType: 'claude-code', protocol: 'claude-code', signedIn: true, billing: 'api', models },
    { id: 'max', name: 'Claude Max', authType: 'claude-code', protocol: 'claude-code', signedIn: true, billing: 'subscription', models },
    { id: 'second', name: 'Second Max', authType: 'claude-code', protocol: 'claude-code', signedIn: true, billing: 'subscription', models },
  ];
  return { data: { providers, routing: { enabled: true, order: ['max', 'second', 'console'], models: { max: 'sonnet', second: 'sonnet', console: 'sonnet' } } }, provider: id => providers.find(p => p.id === id) };
}
test('model picker deduplicates accounts, resolves CLI aliases, and keeps specific versions and effort levels', () => {
  const store = fixture(), models = G.modelCatalog(store);
  assert.equal(models.length, 3);
  assert.deepEqual(models.map(m => m.display_name), ['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Sonnet 5']);
  assert.deepEqual(models[0].meta.aliases, ['default', 'opus']);
  assert.deepEqual(models[0].meta.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(models[0].provider, 'max');
  const id = models[0].id;
  store.data.providers.splice(0, 2);
  assert.equal(G.modelCatalog(store)[0].id, id, 'model ID must survive removing the original accounts');
});
test('Claude account fallback preserves the exact version and subscriptions-only pauses before Console', () => {
  const store = fixture(), routes = G.catalog(store), selected = G.modelCatalog(store)[0];
  let choices = R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), {});
  assert.deepEqual(choices.map(r => [r.provider, r.model]), [['max', 'claude-opus-5-5'], ['second', 'claude-opus-5-5']]);
  const health = { max: { retryAt: null }, second: { retryAt: null } };
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), health), []);
  store.data.routing.allowApiFallback = true;
  choices = R.candidateRoutes(selected, routes, store, R.policyFor(store.data.routing), health);
  assert.deepEqual(choices.map(r => [r.provider, r.model]), [['console', 'claude-opus-5-5']]);
});
test('gateway accepts old account model IDs but advertises only models and sends the exact chosen version', async () => {
  const store = fixture(), original = E.generate, observed = [];
  E.generate = async (provider, body, model) => {
    observed.push([provider.id, model, body.messages]);
    return { id: 'test', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], usage: {}, stop_reason: 'end_turn' };
  };
  const gateway = await G.startGateway({ store });
  try {
    const headers = { Authorization: 'Bearer ' + gateway.token };
    const catalog = await (await fetch(gateway.origin + '/v1/models', { headers })).json();
    assert.equal(catalog.data.length, 3);
    assert.equal(catalog.data.some(m => /Console|Max/.test(m.display_name)), false);
    const messages = [{ role: 'user', content: 'Keep the original conversation.' }];
    for (const model of [G.routeId('console', 'opus'), gateway.catalog()[0].id]) {
      const res = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, messages }) });
      assert.equal(res.status, 200, await res.text());
    }
    assert.deepEqual(observed, [['max', 'claude-opus-5-5', messages], ['max', 'claude-opus-5-5', messages]]);
  } finally { gateway.close(); E.generate = original; }
});
test('native model migration is idempotent and preserves every other metadata field and transcript byte', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-model-selection-'));
  try {
    const relative = 'claude-code-sessions/user/org/local_chat.json', file = path.join(profile, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = { sessionId: 'local_chat', cliSessionId: 'original', model: G.routeId('console', 'opus'), effort: 'max', title: 'Keep this', sessionSettings: { a: true } };
    const raw = JSON.stringify(before, null, 2); fs.writeFileSync(file, raw);
    fs.writeFileSync(file + 'l', 'transcript bytes\n');
    const models = G.modelCatalog(fixture());
    assert.deepEqual(migrateSelections(profile, models), [relative]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...before, model: models[0].id });
    assert.equal(fs.readFileSync(file + 'l', 'utf8'), 'transcript bytes\n');
    assert.equal(fs.readFileSync(path.join(profile, 'model-selection-backups', relative), 'utf8'), raw);
    assert.deepEqual(migrateSelections(profile, models), []);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});
