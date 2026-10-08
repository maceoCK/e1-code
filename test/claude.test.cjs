const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PassThrough } = require('node:stream'), { EventEmitter } = require('node:events');
const A = require('../src/claude-accounts.cjs'), E = require('../src/claude-engine.cjs'), R = require('../src/routing.cjs'), G = require('../src/gateway.cjs');
const result = value => ({ type: 'result', subtype: 'success', structured_output: value, usage: { input_tokens: 4, output_tokens: 9 } });
test('official Claude subprocess never inherits a gateway, API key, or forced model configuration', () => {
  const env = A.cliEnvironment('/separate/profile', { HOME: '/home', PATH: '/bin', ANTHROPIC_API_KEY: 'private', ANTHROPIC_BASE_URL: 'http://gateway', CLAUDE_CODE_OAUTH_TOKEN: 'private', CLAUDE_CONFIG_DIR: '/old', CLAUDECODE: '1', NODE_EXTRA_CA_CERTS: '/cert' });
  assert.deepEqual(env, { HOME: '/home', PATH: '/bin', NODE_EXTRA_CA_CERTS: '/cert', CLAUDE_CONFIG_DIR: '/separate/profile', ANTHROPIC_CONFIG_DIR: '/separate/profile/anthropic' });
});
test('Claude account metadata contains no credentials and disconnect preserves official auth and chats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-account-test-'));
  try {
    const calls = [], a = new A.ClaudeAccounts(dir, { executable: '/official/claude', run: async (...args) => { calls.push(args); return { data: { loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty', secret: 'MUST_NOT_STORE' } }; } });
    const added = await a.useExisting(); assert.equal(a.providers()[0].signedIn, true); assert.deepEqual(calls[0][1], ['auth', 'status', '--json']);
    fs.writeFileSync(path.join(dir, 'chat-library.json'), 'unchanged');
    assert.equal(JSON.stringify(a.snapshot()).includes('MUST_NOT_STORE'), false); assert.equal(fs.readFileSync(a.file, 'utf8').includes('MUST_NOT_STORE'), false);
    a.disconnect(added.accountId); assert.equal(a.providers().length, 0); assert.equal(calls.length, 1); assert.equal(fs.readFileSync(path.join(dir, 'chat-library.json'), 'utf8'), 'unchanged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Claude continuation preserves tool IDs, result provenance and image pixels', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'pixels' } };
  const input = E.inputFor({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/one' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: [image] }] }] });
  assert.match(input[0].text, /tool_use_id.*c1/); assert.match(input[0].text, /file_path/); assert.deepEqual(input[1], image);
  assert.equal(input[0].text.includes('pixels'), false);
});
test('Claude cannot execute missing tools or bypass forced tool choice through its response', () => {
  const body = { tools: [{ name: 'Read' }], tool_choice: { type: 'tool', name: 'Read' } };
  assert.throws(() => E.normalizeResult(result({ text: '', tool_calls: [{ name: 'Bash', arguments_json: '{}' }] }), body), /unavailable/);
  assert.throws(() => E.normalizeResult(result({ text: 'done', tool_calls: [] }), body), /required/);
  const answer = E.normalizeResult(result({ text: '', tool_calls: [{ name: 'Read', arguments_json: '{"file_path":"/one"}' }] }), body);
  assert.equal(answer.stop_reason, 'tool_use'); assert.equal(answer.content[0].input.file_path, '/one');
});
test('legacy cross-model mappings are ignored and unknown billing is excluded by default', () => {
  const providers = [{ id: 'claude', name: 'Claude', authType: 'claude-code', signedIn: true, models: [{ id: 'sonnet' }] }, { id: 'plan', name: 'Plan', authType: 'chatgpt-subscription', signedIn: true, models: [{ id: 'gpt-6.1-sol' }] }, { id: 'api', name: 'API', protocol: 'responses', models: [{ id: 'gpt-6.1-sol' }] }];
  const store = { data: { providers }, provider: id => providers.find(p => p.id === id) }, routes = G.catalog(store), selected = routes[0];
  assert.equal(R.candidateRoutes(selected, routes, store, R.policyFor({ enabled: true, order: ['plan', 'api'] }), {}).length, 0);
  const policy = { enabled: true, order: ['plan', 'api'], models: { plan: 'gpt-6.1-sol', api: 'gpt-6.1-sol' } };
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor(policy), {}).map(r => r.provider), []);
  assert.deepEqual(R.candidateRoutes(selected, routes, store, R.policyFor({ ...policy, allowApiFallback: true }), { claude: { retryAt: null } }).map(r => r.provider), []);
});
test('cancelling Claude stops its subprocess before any desktop tool can be delivered', async () => {
  const controller = new AbortController(); let killed = false;
  const launch = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', null)); }; return child;
  };
  const running = E.generate({ signedIn: true, executable: '/official/claude', configDir: '/profile' }, { messages: [] }, 'sonnet', controller.signal, () => {}, launch);
  controller.abort(); await assert.rejects(running, /stopped/); assert.equal(killed, true);
});
test('separate Claude logins isolate both Claude and Console credential directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-logins-test-')), children = [];
  const a = new A.ClaudeAccounts(dir, { executable: '/official/claude', spawn: (_file, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    children.push({ child, args, options }); return child;
  } });
  try {
    const one = a.begin(), two = a.begin(undefined, 'console');
    assert.notEqual(children[0].options.env.CLAUDE_CONFIG_DIR, children[1].options.env.CLAUDE_CONFIG_DIR);
    assert.notEqual(children[0].options.env.ANTHROPIC_CONFIG_DIR, children[1].options.env.ANTHROPIC_CONFIG_DIR);
    assert.equal(children[0].options.env.ANTHROPIC_CONFIG_DIR.startsWith(dir), true);
    assert.deepEqual(children[0].args, ['auth', 'login', '--claudeai']);
    assert.deepEqual(children[1].args, ['auth', 'login', '--console']);
    a.cancel(one.id); a.cancel(two.id);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('only observed Claude allowance changes billing eligibility, and sign-out clears it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-billing-test-'));
  let loggedIn = true;
  const a = new A.ClaudeAccounts(dir, { executable: '/official/claude', run: async () => ({ data: { loggedIn, authMethod: 'claude.ai', subscriptionType: 'max' } }) });
  try {
    const added = await a.useExisting(); assert.equal(a.providers()[0].billing, 'account');
    a.recordBilling(added.accountId, 'subscription', { status: 'allowed', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.1 } } });
    assert.equal(a.providers()[0].billing, 'subscription');
    a.recordBilling(added.accountId, 'api', { status: 'allowed', isUsingOverage: true });
    assert.equal(a.providers()[0].billing, 'api');
    loggedIn = false; await a.refresh(added.accountId); assert.equal(a.providers()[0].billing, 'account'); assert.equal(a.providers()[0].signedIn, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Claude quota never falls back to a different model even with a legacy mapping', async () => {
  const original = E.generate; let observed;
  E.generate = async () => { const error = Error('Claude limit'); error.status = 429; error.code = 'claude_usage_limit'; throw error; };
  const providers = [{ id: 'claude', name: 'Claude', protocol: 'claude-code', authType: 'claude-code', signedIn: true, models: [{ id: 'sonnet' }] },
    { id: 'api', name: 'API', baseUrl: 'https://api.example.test/v1', protocol: 'chat', models: [{ id: 'gpt-test' }] }];
  const store = { data: { providers, routing: { enabled: true, allowApiFallback: true, order: ['api'], models: { api: 'gpt-test' } } },
    provider: id => providers.find(p => p.id === id), key: () => 'fixture' };
  const gateway = await G.startGateway({ store, transport: async (_url, options) => {
    observed = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }));
  } });
  try {
    const response = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ model: gateway.catalog()[0].id,
      messages: [{ role: 'user', content: 'Original context' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'earlier', name: 'Read', input: { file_path: '/fixture' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'earlier', content: 'UNIQUE_RESULT' }] }] }) });
    assert.equal(response.status, 429); assert.equal((await response.json()).error.code, 'claude_usage_limit');
    assert.equal(observed, undefined, 'Different-model provider must never be called');
  } finally { gateway.close(); E.generate = original; }
});
test('disconnect blocks later Claude requests without deleting shared history or allowing manual health reset to revive it', async () => {
  const provider = { id: 'claude', name: 'Claude', authType: 'claude-code', protocol: 'claude-code', signedIn: true, models: [{ id: 'sonnet' }] };
  const store = { data: { providers: [provider] }, provider: () => provider };
  const gateway = await G.startGateway({ store });
  try {
    gateway.disconnectProvider('claude'); gateway.resetHealth('claude');
    const response = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ model: gateway.catalog()[0].id, messages: [] }) });
    assert.equal(response.status, 400); assert.match((await response.json()).error.message, /paused/);
  } finally { gateway.close(); }
});
