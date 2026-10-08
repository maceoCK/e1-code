const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { Subscriptions, validateIdentity } = require('../src/subscriptions.cjs');
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
const sign = claims => {
  const parts = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')];
  return parts.join('.') + '.' + crypto.sign('RSA-SHA256', Buffer.from(parts.join('.')), pair.privateKey).toString('base64url');
};
const fixtureVault = { encryptString: s => Buffer.from(s).map(x => x ^ 0x5a), decryptString: b => Buffer.from(b).map(x => x ^ 0x5a).toString() };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
test('subscription registration validates identity and isolates same-email accounts, refresh and logout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-auth-'));
  let authUrl, refreshCount = 0, identity = 'subject-one', registration = 'client-one';
  const transport = async (url, options = {}) => {
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('/jwks')) return json({ keys: [jwk] });
    if (url.endsWith('/revoke')) return new Response('', { status: 200 });
    if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT 6.1 Sol', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] });
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    const form = new URLSearchParams(options.body);
    assert.equal(form.get('client_id'), registration);
    if (form.get('grant_type') === 'refresh_token') {
      refreshCount++; await new Promise(r => setTimeout(r, 10));
      return json({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
    }
    assert.equal(form.get('redirect_uri'), authUrl.searchParams.get('redirect_uri'));
    assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authUrl.searchParams.get('code_challenge'));
    return json({ access_token: 'access-' + identity, refresh_token: 'refresh-' + identity, expires_in: 3600,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      id_token: sign({ iss: 'https://auth.openai.com', aud: registration, sub: identity, email: 'same@example.test', exp: Date.now() / 1000 + 3600, nonce: authUrl.searchParams.get('nonce') }) });
  };
  const manager = new Subscriptions(dir, fixtureVault, { transport, openExternal: async url => { authUrl = new URL(url); } });
  async function finish(id) {
    await manager.begin(id);
    const callback = new URL(authUrl.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: authUrl.searchParams.get('state'), code: 'fixture-code', client_id: registration });
    return fetch(callback);
  }
  try {
    assert.equal((await finish()).status, 200);
    const one = manager.data.accounts[0], host = manager.data.hostId;
    identity = 'subject-two'; registration = 'client-two';
    assert.equal((await finish()).status, 200);
    const two = manager.data.accounts[1];
    assert.notEqual(one.id, two.id); assert.equal(one.email, two.email);
    assert.equal(manager.data.hostId, host);
    assert.equal(await manager.token(one.id), 'access-subject-one');
    assert.equal(await manager.token(two.id), 'access-subject-two');
    assert.equal((await manager.models(two.id)).length, 1);
    assert.ok(!JSON.stringify(manager.snapshot()).includes('access-subject'));
    assert.ok(!fs.readFileSync(manager.file, 'utf8').includes('access-subject'));
    const oldOne = one.secret;
    registration = 'client-one'; // Returning to one with the wrong signed-in subject must fail.
    assert.equal((await finish(one.id)).status, 400);
    assert.equal(one.secret, oldOne);
    registration = 'client-two';
    const t = manager.unpack(two); t.expiresAt = 0; two.secret = manager.pack(t);
    assert.deepEqual(await Promise.all([manager.token(two.id), manager.token(two.id)]), ['refreshed-access', 'refreshed-access']);
    assert.equal(refreshCount, 1);
    assert.equal(manager.unpack(two).refresh_token, 'rotated-refresh');
    await manager.logout(two.id);
    assert.equal(one.secret, oldOne); assert.equal(two.secret, undefined);
    assert.equal(two.clientId, 'client-two'); assert.equal(two.models.length, 1);
  } finally { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('OAuth rejects signature, nonce and audience mismatches before accepting credentials', async () => {
  const transport = async url => json(url.endsWith('/jwks') ? { keys: [jwk] } : { issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks' });
  const valid = { iss: 'https://auth.openai.com', aud: 'client', sub: 'subject', exp: Date.now() / 1000 + 3600, nonce: 'nonce' };
  const opts = { clientId: 'client', nonce: 'nonce', transport };
  await validateIdentity(sign(valid), opts);
  await assert.rejects(validateIdentity(sign({ ...valid, nonce: 'other' }), opts), /nonce/);
  await assert.rejects(validateIdentity(sign({ ...valid, aud: 'other' }), opts), /identity/);
  await assert.rejects(validateIdentity(sign({ ...valid, exp: 1 }), opts), /expiry/);
  const token = sign(valid).split('.'); token[1] = Buffer.from(JSON.stringify({ ...valid, sub: 'attacker' })).toString('base64url');
  await assert.rejects(validateIdentity(token.join('.'), opts), /signature/);
});
