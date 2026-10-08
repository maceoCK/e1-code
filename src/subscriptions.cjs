const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { atomicJson, readJson } = require('./library-identity.cjs');
const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const TERMINAL = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
async function validateIdentity(token, { clientId, nonce, transport = fetch }) {
  const chunks = String(token || '').split('.');
  if (chunks.length !== 3) throw Error('The sign-in did not return a valid ID token.');
  let header, claims;
  try { header = JSON.parse(Buffer.from(chunks[0], 'base64url')); claims = JSON.parse(Buffer.from(chunks[1], 'base64url')); }
  catch { throw Error('The sign-in ID token is malformed.'); }
  if (header.alg !== 'RS256' || !header.kid) throw Error('Unsupported sign-in signature.');
  const configResponse = await transport(AUTH + '/.well-known/openid-configuration', { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!configResponse.ok) throw Error('Cannot verify the sign-in issuer.');
  const config = await configResponse.json();
  if (config.issuer !== AUTH || new URL(config.jwks_uri).origin !== AUTH) throw Error('Unexpected sign-in issuer.');
  const keyResponse = await transport(config.jwks_uri, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!keyResponse.ok) throw Error('Cannot verify the sign-in signature.');
  const jwk = (await keyResponse.json()).keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  if (!jwk || !crypto.verify('RSA-SHA256', Buffer.from(chunks.slice(0, 2).join('.')), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(chunks[2], 'base64url')))
    throw Error('The sign-in signature could not be verified.');
  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== AUTH || !aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId) ||
      typeof claims.exp !== 'number' || claims.exp <= now || (claims.nbf && claims.nbf > now + 30) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.nonce !== nonce) throw Error('The sign-in identity, expiry, or nonce did not match.');
  return claims;
}
class Subscriptions {
  constructor(dir, vault, { transport = fetch, openExternal, onChange = () => {} } = {}) {
    this.file = path.join(dir, 'subscription-accounts.json');
    this.vault = vault; this.transport = transport; this.openExternal = openExternal; this.onChange = onChange;
    this.data = readJson(this.file, { version: 1, hostId: 'urn:uuid:' + crypto.randomUUID(), accounts: [] });
    this.pending = new Map(); this.refreshing = new Map();
    this.save();
  }
  save() { atomicJson(this.file, this.data); }
  account(id) { const a = this.data.accounts.find(a => a.id === id); if (!a) throw Error('Subscription account not found.'); return a; }
  unpack(a) {
    if (!a.secret || !this.vault) throw Error('Sign in to this ChatGPT account again.');
    return JSON.parse(this.vault.decryptString(Buffer.from(a.secret, 'base64')));
  }
  pack(tokens) { if (!this.vault) throw Error('Subscription sign-in requires the desktop app’s encrypted storage.'); return this.vault.encryptString(JSON.stringify(tokens)).toString('base64'); }
  snapshot() {
    return { accounts: this.data.accounts.map(({ secret, ...a }) => ({ ...a, connected: !!secret })),
      pending: [...this.pending.values()].map(p => ({ id: p.id, status: p.status, error: p.error })),
      welcomeAcknowledged: this.data.welcomeAcknowledged === true, available: !!this.vault && !!this.openExternal };
  }
  providers() {
    return this.data.accounts.map(a => ({ id: 'chatgpt-' + a.id, name: a.label,
      protocol: 'responses', baseUrl: RESOURCE, authType: 'chatgpt-subscription', accountId: a.id, accountEmail: a.email,
      models: a.models || [], preferredModel: a.preferredModel, signedIn: !!a.secret && a.planEnabled,
      hasKey: !!a.secret, keySource: a.planEnabled ? 'ChatGPT plan · ' + a.email : 'Sign-in or plan permission required' }));
  }
  async post(endpoint, form) {
    const r = await this.transport(AUTH + endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    let d = {}; try { d = await r.json(); } catch {}
    if (!r.ok) { const e = Error('ChatGPT sign-in returned HTTP ' + r.status + (typeof d.error === 'string' ? ' (' + d.error + ')' : '')); e.code = d.error; throw e; }
    return d;
  }
  async begin(accountId) {
    if (!this.vault || !this.openExternal) throw Error('Open subscription sign-in from the desktop app.');
    if ([...this.pending.values()].some(p => ['waiting', 'verifying'].includes(p.status))) throw Error('Finish or cancel the current sign-in first.');
    const existing = accountId ? this.account(accountId) : null;
    const p = { id: crypto.randomUUID(), status: 'waiting', state: crypto.randomBytes(32).toString('base64url'),
      nonce: crypto.randomBytes(32).toString('base64url'), verifier: crypto.randomBytes(48).toString('base64url'), existing };
    const server = http.createServer(async (req, res) => {
      const reply = (status, text) => {
        const page = require('./auth-page.cjs').authPage(status, text);
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; img-src data:; style-src 'nonce-${page.nonce}'; script-src 'nonce-${page.nonce}'; frame-ancestors 'none'; base-uri 'none'`, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
        res.end(page.html);
      };
      try {
        if (req.headers.host !== new URL(p.redirect).host || req.method !== 'GET') return reply(400, 'Invalid callback.');
        const url = new URL(req.url, p.redirect);
        if (url.pathname !== '/auth/callback') return reply(404, 'Not found.');
        if (url.searchParams.get('state') !== p.state || p.status !== 'waiting') return reply(400, 'Sign-in state did not match.');
        p.status = 'verifying';
        if (url.searchParams.has('error')) throw Error('ChatGPT sign-in was declined or cancelled.');
        const clientId = url.searchParams.get('client_id') || existing?.clientId;
        if (!clientId || clientId === 'dynamic_agent_client' || (existing && clientId !== existing.clientId)) throw Error('The sign-in registration did not match.');
        const code = url.searchParams.get('code'); if (!code) throw Error('The sign-in code is missing.');
        const tokens = await this.post('/api/accounts/oauth/token', { grant_type: 'authorization_code', client_id: clientId,
          code, code_verifier: p.verifier, redirect_uri: p.redirect, resource: RESOURCE });
        const claims = await validateIdentity(tokens.id_token, { clientId, nonce: p.nonce, transport: this.transport });
        if (existing && (existing.subject !== claims.sub || existing.issuer !== claims.iss)) throw Error('This is a different account. Add it as a separate connection.');
        if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw Error('The sign-in token response is incomplete.');
        const scopes = String(tokens.scope || '').split(' ');
        const a = existing || { id: crypto.randomUUID(), label: 'ChatGPT ' + (this.data.accounts.length + 1), models: [] };
        Object.assign(a, { clientId, subject: claims.sub, issuer: claims.iss, email: claims.email || 'ChatGPT account',
          planEnabled: scopes.includes('chatgpt.tokens.use.direct'), secret: this.pack({ ...tokens, scopes, expiresAt: Date.now() + tokens.expires_in * 1000 }), status: 'connected' });
        if (!existing) this.data.accounts.push(a);
        this.save(); this.onChange(); p.status = 'complete';
        reply(200, 'Connected to E1 Code. You can close this tab. Your existing chats are unchanged.');
      } catch (e) { p.status = 'failed'; p.error = e.message; reply(400, e.message); }
      finally { if (p.status !== 'waiting') { clearTimeout(p.timer); server.close(); } }
    });
    p.server = server;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    p.redirect = 'http://127.0.0.1:' + server.address().port + '/auth/callback';
    p.timer = setTimeout(() => { p.status = 'expired'; server.close(); }, 10 * 60 * 1000); p.timer.unref();
    this.pending.set(p.id, p);
    const query = new URLSearchParams({ client_id: existing?.clientId || 'dynamic_agent_client', ext_agent_host_id: this.data.hostId,
      response_type: 'code', redirect_uri: p.redirect, scope: SCOPES, resource: RESOURCE, state: p.state, nonce: p.nonce,
      code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(p.verifier).digest('base64url') });
    if (!existing) query.set('agent_name_hint', 'E1 Code');
    else if (existing.secret) { const t = this.unpack(existing); if (t.id_token) query.set('id_token_hint', t.id_token); }
    p.authUrl = AUTH + '/api/accounts/authorize?' + query.toString();
    try { await this.openExternal(p.authUrl); }
    catch { this.cancel(p.id); throw Error('Could not open the system browser for sign-in.'); }
    return { id: p.id };
  }
  async reopen(id) {
    const p = this.pending.get(id);
    if (!p || p.status !== 'waiting') throw Error('This sign-in has ended. Use Continue with ChatGPT to start again.');
    await this.openExternal(p.authUrl);
  }
  cancel(id) { const p = this.pending.get(id); if (p && p.status === 'waiting') { p.status = 'cancelled'; clearTimeout(p.timer); p.server.close(); } }
  async token(id) {
    const a = this.account(id);
    if (!a.planEnabled) throw Error('Enable ChatGPT plan usage for this connection before using it.');
    let t = this.unpack(a);
    if (t.expiresAt > Date.now() + 90000) return t.access_token;
    if (!this.refreshing.has(id)) this.refreshing.set(id, (async () => {
      try {
        const next = await this.post('/api/accounts/oauth/token', { grant_type: 'refresh_token', client_id: a.clientId,
          refresh_token: t.refresh_token, resource: RESOURCE });
        if (!next.access_token || !Number.isFinite(next.expires_in) || next.expires_in <= 0) throw Error('Incomplete ChatGPT token refresh.');
        const scopes = next.scope ? next.scope.split(' ') : t.scopes;
        t = { ...t, ...next, scopes, expiresAt: Date.now() + next.expires_in * 1000 };
        a.planEnabled = scopes.includes('chatgpt.tokens.use.direct'); a.secret = this.pack(t); this.save();
        if (!a.planEnabled) throw Error('ChatGPT plan usage permission was removed.');
        return t.access_token;
      } catch (e) { if (TERMINAL.has(e.code)) { delete a.secret; a.status = 'sign-in-required'; this.save(); this.onChange(); } throw e; }
      finally { this.refreshing.delete(id); }
    })());
    return this.refreshing.get(id);
  }
  async models(id) {
    const token = await this.token(id);
    const r = await this.transport(RESOURCE + '/models', { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error('ChatGPT model discovery returned HTTP ' + r.status);
    const d = await r.json();
    const models = (d.models || []).filter(m => m.visibility === 'list' && m.slug).map(m => ({ id: m.slug, name: m.display_name || m.slug }));
    if (!models.length) throw Error('This account returned no available ChatGPT models.');
    this.account(id).models = models; this.save(); this.onChange(); return models;
  }
  update(id, { label, preferredModel }) {
    const a = this.account(id);
    if (label) a.label = String(label).slice(0, 80);
    if (preferredModel !== undefined) {
      if (!a.models.some(m => m.id === preferredModel)) throw Error('Choose a model available to this ChatGPT account.');
      a.preferredModel = preferredModel;
    }
    this.save(); this.onChange();
  }
  async logout(id) {
    const a = this.account(id); let confirmed = false;
    if (this.refreshing.has(id)) await this.refreshing.get(id).catch(() => {});
    if (a.secret) {
      const t = this.unpack(a);
      try {
        const r = await this.transport(AUTH + '/.well-known/openid-configuration', { redirect: 'error', signal: AbortSignal.timeout(15000) });
        const d = await r.json();
        if (!r.ok || new URL(d.revocation_endpoint).origin !== AUTH) throw Error('Invalid revocation endpoint');
        await this.post(new URL(d.revocation_endpoint).pathname, { token: t.refresh_token, token_type_hint: 'refresh_token', client_id: a.clientId });
        confirmed = true;
      } catch {}
      delete a.secret;
    }
    a.status = 'signed-out'; this.save(); this.onChange();
    return { remoteRevocationConfirmed: confirmed, message: confirmed ? 'Signed out. Your chats are unchanged.' : 'Signed out locally. Remote revocation was not confirmed; disconnect E1 Code in ChatGPT Settings. Your chats are unchanged.' };
  }
  close() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.server?.close(); } }
}
const instances = new Map();
function subscriptionsFor(dir, vault, options = {}) {
  if (!instances.has(dir)) instances.set(dir, new Subscriptions(dir, vault, options));
  const manager = instances.get(dir);
  if (options.openExternal) manager.openExternal = options.openExternal;
  return manager;
}
module.exports = { Subscriptions, validateIdentity, subscriptionsFor };
