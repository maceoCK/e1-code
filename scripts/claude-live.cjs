const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { ClaudeAccounts } = require('../src/claude-accounts.cjs');
const { startGateway } = require('../src/gateway.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-claude-check-'));
  const subscription = process.argv.includes('--subscription');
  const accounts = new ClaudeAccounts(subscription ? path.join(os.homedir(), 'Library/Application Support/Aster') : dir);
  if (!subscription) await accounts.useExisting();
  const account = subscription ? accounts.data.accounts.find(a => a.method === 'claudeai' && a.connected) : accounts.data.accounts[0];
  if (!account) throw Error('Connect a Claude subscription first.');
  await accounts.refresh(account.id);
  const provider = accounts.providers().find(p => p.accountId === account.id), marker = 'E1-' + randomBytes(6).toString('hex');
  const store = { data: { providers: [provider], routing: { enabled: false } }, provider: () => provider,
    key() { throw Error('The Claude adapter must never request credentials.'); } };
  const requests = [], statuses = [];
  const gateway = await startGateway({ store, onRequest: r => requests.push(r), onStatus: s => { statuses.push({ ...s }); if (subscription && s.allowance) accounts.recordBilling(account.id, s.billing, s.allowance); } });
  try {
    const route = gateway.catalog().find(r => r.model === 'claude-sonnet-5-5') || gateway.catalog().find(r => r.model === 'sonnet');
    const model = route.id;
    const tools = [{ name: 'lookup_fixture', description: 'Read the verification fixture from the desktop.', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } }];
    const messages = [{ role: 'user', content: 'Call lookup_fixture with key alpha. Then reply only with the marker in its result. Do not guess the marker.' }];
    const send = async body => {
      const res = await fetch(gateway.origin + '/v1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ model, messages, tools, max_tokens: 1024, ...body }) });
      const data = await res.json(); assert.equal(res.status, 200, JSON.stringify(data)); return data;
    };
    const first = await send({ tool_choice: { type: 'tool', name: 'lookup_fixture' } });
    const call = first.content.find(c => c.type === 'tool_use'); assert.equal(call?.name, 'lookup_fixture'); assert.equal(call.input.key, 'alpha');
    messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ marker }) }] });
    const second = await send({ tool_choice: { type: 'none' } });
    assert.equal(second.content.filter(c => c.type === 'text').map(c => c.text).join(''), marker);
    const result = { status: 'passed', at: new Date().toISOString(), officialCli: true, authMethod: account.authMethod,
      suppliedApiKey: false, requestedModel: route.model, actualModel: second.claudeCode?.model, toolRoundtrip: true, preservedHistory: true,
      billing: statuses.at(-1)?.billing, allowance: statuses.findLast(s => s.allowance)?.allowance, requests };
    fs.writeFileSync(path.join(__dirname, subscription ? '../evidence/claude-subscription-live.json' : '../evidence/claude-console-live.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { gateway.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
