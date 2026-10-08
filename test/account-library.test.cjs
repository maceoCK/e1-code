const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../src/store.cjs');
const { ensureLibraryIdentity, atomicJson } = require('../src/library-identity.cjs');
test('connection edits, credential removal and stale settings windows preserve the shared chat library', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-library-'));
  try {
    atomicJson(path.join(dir, 'workspace.json'), { providers: [{ id: 'api', name: 'API', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', models: [] }],
      chats: [{ id: 'old-chat', title: 'Preserve me', messages: [{ role: 'user', content: 'Original context' }] }], selection: { provider: 'api' } });
    const owner = new Store(dir), settings = new Store(dir);
    assert.ok(fs.existsSync(path.join(dir, 'workspace.json.before-library-split')));
    assert.equal(JSON.parse(fs.readFileSync(owner.file)).chats, undefined);
    owner.newChat({ provider: 'api' });
    const expected = fs.readFileSync(owner.historyFile);
    settings.setProvider({ id: 'api', name: 'Other account', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', apiKey: 'different-account-key' });
    settings.setProvider({ id: 'api', name: 'Signed out', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', clearKey: true });
    assert.ok(fs.readFileSync(owner.historyFile).equals(expected));
    assert.equal(new Store(dir).data.chats.length, 2);
    settings.data.chats[0].title = 'stale overwrite';
    assert.throws(() => settings.save(), /another window/);
    assert.ok(fs.readFileSync(owner.historyFile).equals(expected));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('native identity is pinned independently of remote accounts and restored if its device file disappears', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-identity-')), profile = path.join(dir, 'native');
  try {
    fs.mkdirSync(profile);
    const original = '982fcb7c-d869-4348-ae5f-609c9cf0312a';
    fs.writeFileSync(path.join(profile, 'ant-did'), Buffer.from(original).toString('base64'));
    const a = ensureLibraryIdentity(dir, profile);
    atomicJson(path.join(profile, 'config.json'), { lastKnownAccountUuid: 'a57e0000-0000-4000-8000-000000000001' });
    assert.deepEqual(ensureLibraryIdentity(dir, profile), a);
    fs.unlinkSync(path.join(profile, 'ant-did'));
    assert.deepEqual(ensureLibraryIdentity(dir, profile), a);
    assert.equal(Buffer.from(fs.readFileSync(path.join(profile, 'ant-did'), 'utf8'), 'base64').toString(), original);
    fs.writeFileSync(path.join(profile, 'ant-did'), Buffer.from('a57e0000-0000-4000-8000-000000000001').toString('base64'));
    assert.throws(() => ensureLibraryIdentity(dir, profile), /identity changed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'library-identity.json'))).accountUuid, original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
