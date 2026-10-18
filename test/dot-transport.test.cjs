const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDotTransport } = require('../src/dot-transport.cjs');
const { DotService } = require('../src/dot-service.cjs');

function fixture() {
  const sessions = [], calls = [];
  const transport = createDotTransport({
    app: { whenReady: async () => {}, getVersion: () => '1.2.3' },
    session: { fromPartition: (partition, settings) => {
      const value = { partition, settings, setUserAgent: ua => value.ua = ua,
        fetch: async (url, options) => { calls.push({ partition, url, ...options }); return Response.json({}); } };
      sessions.push(value); return value;
    } },
  }, '44.4.3');
  return { transport, sessions, calls };
}

test('Dot desktop requests isolate accounts, omit web cookies and forbid redirects', async () => {
  const f = fixture(), options = { headers: { Authorization: 'Bearer own-token' }, credentials: 'include', redirect: 'follow' };
  await f.transport('one', 'https://chatgpt.com/backend-api/tbo/primary', options);
  await f.transport('two', 'https://chatgpt.com/backend-api/tbo/primary', options);
  await f.transport('one', 'https://chatgpt.com/backend-api/tbo?limit=25', options);
  assert.equal(f.sessions.length, 2);
  assert.notEqual(f.calls[0].partition, f.calls[1].partition);
  assert.equal(f.calls[0].partition, f.calls[2].partition);
  assert.ok(f.sessions.every(s => !s.partition.startsWith('persist:') && s.settings.cache === false));
  assert.ok(f.sessions.every(s => s.ua === 'E1Code/1.2.3 Electron/44.4.3'));
  assert.ok(f.calls.every(c => c.credentials === 'omit' && c.redirect === 'error'));
  assert.equal(f.calls[0].headers.Authorization, 'Bearer own-token');
});

test('Dot rejects untrusted origins and malformed account context before networking', async () => {
  const f = fixture();
  for (const url of ['https://example.test/backend-api/tbo', 'http://chatgpt.com/backend-api/tbo', 'https://chatgpt.com.evil.test/backend-api/tbo', 'https://chatgpt.com/other', 'https://someone@chatgpt.com/backend-api/tbo'])
    await assert.rejects(f.transport('one', url, {}), /Invalid Dot service URL/);
  await assert.rejects(f.transport('', 'https://chatgpt.com/backend-api/tbo', {}), /account is required/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sessions.length, 0);
});

test('Dot service uses its native transport including one auth refresh; shared model transport is unchanged', async () => {
  const calls = [], refreshes = [], modelTransport = async () => { throw Error('Wrong transport'); };
  const manager = { account: () => ({ mode: 'codex', codexConnected: true, workspaceAccountId: 'workspace' }),
    token: async (_, refresh) => { refreshes.push(refresh); return refresh ? 'new' : 'old'; }, transport: modelTransport };
  const service = new DotService(manager, { transport: async (accountId, url, options) => {
    calls.push({ accountId, url, ...options });
    return calls.length === 1 ? new Response('', { status: 401 }) : Response.json({ selection: null });
  } });
  assert.deepEqual(await service.request('one', '/tbo/primary'), { selection: null });
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(calls[1].headers.Authorization, 'Bearer new');
  assert.equal(calls[1].headers['ChatGPT-Account-ID'], 'workspace');
  assert.equal(calls[1].accountId, 'one');
  assert.equal(manager.transport, modelTransport);
});
