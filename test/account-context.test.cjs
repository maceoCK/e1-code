const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startGateway, modelCatalog } = require('../src/gateway.cjs');
const engine = require('../src/claude-engine.cjs');

test('Claude-account transport opts the inner CLI into verified 1M context only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-account-test-'));
  const provider = { id: 'fixture', name: 'Fixture', protocol: 'claude-code', authType: 'claude-code', billing: 'subscription', signedIn: true,
    models: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }] };
  const store = { data: { providers: [provider] }, nativeProfile: dir, provider: () => provider };
  const original = engine.generate, calls = [];
  engine.generate = async (_provider, body, model) => {
    calls.push(model);
    return { id: 'fixture', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  };
  let gateway;
  try {
    gateway = await startGateway({ store, transport: () => { throw Error('No network allowed'); } });
    for (const model of modelCatalog(store)) {
      const response = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token },
        body: JSON.stringify({ model: model.id, max_tokens: 10, messages: [{ role: 'user', content: 'Offline' }] }) });
      assert.equal(response.status, 200, await response.text());
    }
    assert.deepEqual(calls, ['claude-opus-5-5[1m]', 'claude-haiku-5-5']);
  } finally { engine.generate = original; gateway?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('account 1M suffix preserves existing Fast-mode capability and consent checks', async () => {
  const provider = { signedIn: true, billingMethod: 'console', executable: 'fixture', configDir: '/tmp/e1-offline-account' };
  let launched = false;
  const launch = (_executable, args) => {
    launched = true;
    assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5[1m]');
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    setImmediate(() => { child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { text: 'OK', tool_calls: [] } }) + '\n'); child.emit('close', 0); });
    return child;
  };
  await engine.generate(provider, { speed: 'fast', messages: [] }, 'claude-opus-5-5[1m]', undefined, undefined, launch);
  assert.equal(launched, true);
  await assert.rejects(engine.generate({ ...provider, billingMethod: 'subscription' }, { speed: 'fast', messages: [] }, 'claude-opus-5-5[1m]', undefined, undefined, launch), /approved Console/);
});
