// The official CLI owns authentication. This module stores account metadata only.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { atomicJson, readJson } = require('./library-identity.cjs');

function cliEnvironment(configDir, base = process.env, profileDir = path.join(configDir, 'anthropic')) {
  const env = { ...base };
  // Never inherit the recovered engine's gateway or an ambient API key.
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|ENABLE_TOOL_SEARCH$)/.test(key)) delete env[key];
  env.CLAUDE_CONFIG_DIR = configDir;
  env.ANTHROPIC_CONFIG_DIR = profileDir;
  return env;
}
function findBinary() {
  return [path.join(os.homedir(), 'Library/Application Support/Aster/engines/claude/node_modules/.bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(os.homedir(), '.local/bin/claude')]
    .find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
}
function run(executable, args, configDir, timeout = 30000, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: cliEnvironment(configDir, process.env, profileDir), cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Error('Claude Code did not respond in time.')); }, timeout);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1e6) { child.kill('SIGKILL'); finish(Error('Claude Code returned too much data.')); } });
    child.stderr.resume();
    child.on('error', () => finish(Error('Could not start the official Claude Code executable.')));
    child.on('close', code => { try { finish(null, { code, data: JSON.parse(output) }); } catch { finish(Error('Claude Code returned an unreadable authentication status.')); } });
  });
}
const MODELS = [
  { id: 'sonnet', name: 'Sonnet (Claude Code default)', contextWindow: 200000, maxTokens: 32768, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'opus', name: 'Opus (Claude Code default)', contextWindow: 200000, maxTokens: 32768, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'fable', name: 'Fable (Claude Code default)', contextWindow: 200000, maxTokens: 32768, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'haiku', name: 'Haiku (Claude Code default)', contextWindow: 200000, maxTokens: 32768 },
];
function identity(a) {
  if (!a.orgId || typeof a.email !== 'string' || !a.email.includes('@')) return null;
  if (a.method === 'console' && !a.workspaceId) return null;
  return JSON.stringify([a.method, a.email.trim().toLowerCase(), a.orgId, a.method === 'console' ? a.workspaceId : null]);
}
function knownIdentity(a) {
  const previous = a.lastIdentity || {};
  return { method: a.method || previous.method, email: a.email || previous.email,
    orgId: a.orgId || previous.orgId, workspaceId: a.workspaceId || previous.workspaceId };
}
function sameIdentity(expected, actual) {
  return ['method', 'email', 'orgId', 'workspaceId'].every(key => !expected[key] ||
    (key === 'email' ? String(expected[key]).trim().toLowerCase() === String(actual[key] || '').trim().toLowerCase() : expected[key] === actual[key]));
}
class ClaudeAccounts {
  constructor(dir, options = {}) {
    this.dir = dir; this.file = path.join(dir, 'claude-accounts.json');
    this.executable = options.executable || findBinary(); this.run = options.run || run;
    this.spawn = options.spawn || spawn; this.openExternal = options.openExternal;
    this.data = readJson(this.file, { version: 1, accounts: [] }); this.pending = new Map(); this.dedupe();
  }
  save() { atomicJson(this.file, this.data); this.onChange?.(); }
  resolveAccountId(id) {
    const seen = new Set();
    while (this.data.accountAliases?.[id] && !seen.has(id)) { seen.add(id); id = this.data.accountAliases[id]; }
    return id;
  }
  resolveProviderId(id) { return typeof id === 'string' && id.startsWith('claude-code-') ? 'claude-code-' + this.resolveAccountId(id.slice(12)) : id; }
  dedupe() {
    const groups = new Map(), removed = new Set();
    for (const duplicate of this.data.accounts) {
      const key = identity(duplicate); if (!key) continue;
      const first = groups.get(key); if (!first) { groups.set(key, duplicate); continue; }
      const backup = this.file + '.before-dedup';
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
      const stable = { id: first.id, label: first.label, preferredModel: first.preferredModel || duplicate.preferredModel };
      const models = [...new Map([...(first.models || []), ...(duplicate.models || [])].map(m => [m.id, m])).values()];
      if (duplicate.connected && (!first.connected || (duplicate.checkedAt || '') >= (first.checkedAt || ''))) {
        Object.assign(first, duplicate, { profileDir: duplicate.profileDir, existing: duplicate.existing }, stable);
      }
      first.models = models;
      this.data.accountAliases ||= {}; this.data.accountAliases[duplicate.id] = first.id; removed.add(duplicate.id);
    }
    if (!removed.size) return false;
    this.data.accounts = this.data.accounts.filter(a => !removed.has(a.id));
    for (const id of Object.keys(this.data.accountAliases)) this.data.accountAliases[id] = this.resolveAccountId(id);
    for (const pending of this.pending.values()) pending.accountId = this.resolveAccountId(pending.accountId);
    this.save(); return true;
  }
  account(id) { id = this.resolveAccountId(id); const a = this.data.accounts.find(a => a.id === id); if (!a) throw Error('Claude account not found.'); return a; }
  snapshot() {
    return { available: !!this.executable, accounts: this.data.accounts.map(({ configDir, profileDir, ...a }) => a),
      pending: [...this.pending.values()].map(({ id, accountId, status, error }) => ({ id, accountId, status, ...(error ? {error} : {}) })) };
  }
  providers() {
    return this.data.accounts.map(a => ({ id: 'claude-code-' + a.id, accountId: a.id, name: a.label,
      connectionAliases: Object.keys(this.data.accountAliases || {}).filter(id => this.resolveAccountId(id) === a.id).map(id => 'claude-code-' + id),
      proxy: this.proxy?.route('claude',a), authType: 'claude-code', protocol: 'claude-code', baseUrl: 'claude-code://local', signedIn: a.connected,
      executable: this.executable, configDir: a.configDir, profileDir: a.profileDir,
      models: (a.models?.length ? a.models : MODELS).map(m => ({ ...m, name: require('./claude-models.cjs').modelName(m.id, m.name) })),
      preferredModel: a.preferredModel || 'sonnet', billingMethod: a.method,
      planType: a.subscriptionType, accountEmail: a.email,
      billing: a.method === 'console' ? 'api' : (a.billingState || 'account'), keySource: 'Managed by official Claude Code', hasKey: a.connected }));
  }
  async readStatus(account) {
    if (this.proxy?.has('claude-code-'+account.id) && account.configDir===this.data.accounts.find(a=>a.id===account.id)?.configDir) {
      return {...account, connected:await this.proxy.status('claude-code-'+account.id),checkedAt:new Date().toISOString()};
    }
    if (!this.executable) throw Error('Install the official Claude Code CLI to connect a Claude account.');
    const { data } = await this.run(this.executable, ['auth', 'status', '--json'], account.configDir, 30000, account.profileDir);
    const a = { ...account, connected: data.loggedIn === true, authMethod: data.authMethod || null,
      apiProvider: data.apiProvider || null, subscriptionType: data.subscriptionType || null,
      email: data.email || null, orgId: typeof data.orgId === 'string' ? data.orgId : null,
      orgName: typeof data.orgName === 'string' ? data.orgName : null, checkedAt: new Date().toISOString() };
    if (!a.connected) { delete a.billingState; delete a.allowance; }
    let details = a.connected && a.method === 'console' ? require('./claude-identity.cjs').consoleIdentity(a.profileDir || path.join(a.configDir, 'anthropic')) : null;
    if (details && ((a.orgId && a.orgId !== details.orgId) || (a.email && details.email && a.email.toLowerCase() !== details.email.toLowerCase()))) details = null;
    if (details) { a.email ||= details.email; a.orgId ||= details.orgId; a.orgName ||= details.orgName; }
    a.workspaceId = details?.workspaceId || null; a.workspaceName = details?.workspaceName || null;
    a.lastIdentity = a.connected && a.email ? knownIdentity(a) : knownIdentity(account);
    return a;
  }
  async refresh(id) {
    const a = this.account(id), profile = a.configDir, authProfile = a.profileDir;
    const next = await this.readStatus(a);
    if (!this.data.accounts.includes(a) || a.configDir !== profile || a.profileDir !== authProfile)
      throw Error('This Claude connection changed while checking its sign-in. Try again.');
    if (next.connected && !sameIdentity(knownIdentity(a), next)) {
      a.connected = false; delete a.billingState; delete a.allowance; this.save();
      throw Error('This profile is signed into a different Claude account or workspace. Add it as a separate connection.');
    }
    Object.assign(a, next);
    if (!next.connected) { delete a.billingState; delete a.allowance; }
    // CLI auth status proves connection identity, not the charge source of a request.
    this.dedupe(); this.save(); return this.snapshot();
  }
  async models(id) {
    await this.refresh(id);
    const a = this.account(id);
    if (!a.connected) throw Error('Sign in to discover Claude models.');
    const models = this.proxy?.has('claude-code-'+a.id) ? await this.proxy.models('claude',a) : await require('./claude-models.cjs').discoverModels(this.executable, cliEnvironment(a.configDir, process.env, a.profileDir));
    a.models = models; a.modelsCheckedAt = new Date().toISOString(); this.save(); return models;
  }
  async useExisting() {
    const configDir = path.join(os.homedir(), '.claude');
    const sources = [
      { method: 'claudeai', profileDir: path.join(this.dir, 'claude-profiles', 'existing-subscription', 'anthropic'), label: 'Claude Code (existing)' },
      { method: 'console', profileDir: path.join(os.homedir(), '.config/anthropic'), label: 'Claude Console (existing)' },
    ];
    for (const source of sources) {
      const previous = this.data.accounts.find(a => a.configDir === configDir && a.profileDir === source.profileDir && a.method === source.method);
      const checked = await this.readStatus({ ...(previous || {}), id: previous?.id || randomUUID(), existing: true, configDir, ...source });
      if (!checked.connected) continue;
      if (previous && !sameIdentity(knownIdentity(previous), checked))
        throw Error('The existing CLI is signed into a different account. Add it as a new connection instead of replacing this one.');
      const duplicate = identity(checked) && this.data.accounts.find(a => identity(a) === identity(checked));
      // Prefer an already connected isolated profile over a shared CLI profile.
      if (duplicate?.connected) return { accountId: duplicate.id, ...this.snapshot() };
      const target = previous || duplicate;
      if (target) Object.assign(target, checked, {id: target.id, label: target.label, preferredModel: target.preferredModel});
      else this.data.accounts.push(checked);
      this.save(); return { accountId: target?.id || checked.id, ...this.snapshot() };
    }
    throw Error('No signed-in Claude Code profile was found. Add a Claude account to sign in.');
  }
  recordBilling(id, billing, allowance) {
    if (!['api', 'subscription'].includes(billing) || !allowance) return;
    const a = this.account(id);
    if (a.method === 'console') return;
    a.billingState = billing; a.allowance = allowance; a.billingCheckedAt = new Date().toISOString(); this.save();
  }
  update(id, value) {
    const a = this.account(id);
    if (value.label != null) a.label = String(value.label).trim().slice(0, 80) || a.label;
    if (value.preferredModel != null) a.preferredModel = String(value.preferredModel).slice(0, 300);
    this.save();
  }
  begin(id, method = 'claudeai') {
    if (!this.executable) throw Error('Install the official Claude Code CLI first.');
    if (!['claudeai', 'console'].includes(method)) throw Error('Unknown sign-in method.');
    let existing = id ? this.account(id) : null;
    if (existing?.existing) existing = null; // Never replace the user's global CLI profile.
    if (existing && existing.method !== method) throw Error('Add a separate connection to change between subscription and Console billing.');
    const accountId = existing?.id || randomUUID();
    if ([...this.pending.values()].some(p => p.accountId === accountId && ['waiting','verifying'].includes(p.status)))
      throw Error('Sign-in is already open for this account.');
    // Login always writes to a new isolated profile. Until verification commits,
    // inference and cancellation continue to use the original account unchanged.
    const configDir = path.join(this.dir, 'claude-profiles', randomUUID());
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const draft = { ...(existing || {}), id: accountId, method, connected: false, existing: false,
      label: existing?.label || (method === 'console' ? 'Claude Console ' : 'Claude ') + (this.data.accounts.length + 1),
      configDir, profileDir: path.join(configDir, 'anthropic') };
    const p = { id: randomUUID(), accountId, status: 'waiting', draft, existing,
      originalProfile: existing?.configDir, originalAuthProfile: existing?.profileDir, expected: existing && knownIdentity(existing) };
    if (this.openExternal) p.browser = require('./auth-browser.cjs').createAuthBrowser(url => {
      if (p.status !== 'waiting') return; p.url = url; return this.openExternal(url);
    });
    const env = cliEnvironment(configDir, process.env, draft.profileDir);
    if (p.browser) env.BROWSER = p.browser.command;
    let child;
    try { child = this.spawn(this.executable, ['auth', 'login', '--' + method], {
      env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
    }); } catch (error) { p.browser?.close(); throw error; }
    p.child = child; this.pending.set(p.id, p);
    let output = '';
    const observe = chunk => {
      output = (output + chunk).slice(-16000);
      const match = output.match(/https:\/\/(?:claude\.ai|claude\.com|platform\.claude\.com|console\.anthropic\.com)\/[^\s\x1b]+/);
      if (match) p.url = match[0]; // Kept in memory only; contains OAuth state.
    };
    child.stdout.on('data', observe); child.stderr.on('data', observe);
    p.timer = setTimeout(() => this.cancel(p.id), 600000);
    child.on('error', () => { p.status = 'failed'; p.error = 'Could not start Claude Code sign-in.'; clearTimeout(p.timer); p.browser?.close(); delete p.url; });
    child.on('close', code => { void this.finishLogin(p, code); });
    return { id: p.id, accountId, status: p.status };
  }
  async discardLogin(p) {
    if (p.published || p.discarded) return;
    p.discarded = true;
    // Log out only this attempt's isolated profile. Old credentials and history
    // remain recoverable; no existing account directory is ever removed.
    try { await this.run(this.executable, ['auth', 'logout'], p.draft.configDir, 10000, p.draft.profileDir); } catch {}
  }
  async finishLogin(p, code) {
    clearTimeout(p.timer); p.browser?.close();
    if (p.status !== 'waiting') { if (p.status !== 'complete') await this.discardLogin(p); return; }
    p.status = 'verifying'; delete p.url;
    try {
      if (code !== 0) throw Error('Claude Code sign-in did not complete. Open it again to retry.');
      const next = await this.readStatus(p.draft);
      if (p.status !== 'verifying') return;
      if (!next.connected || typeof next.email !== 'string' || !next.email.includes('@'))
        throw Error('Claude did not return a verified account identity. Please sign in again.');
      if (p.existing && (!this.data.accounts.includes(p.existing) || p.existing.configDir !== p.originalProfile || p.existing.profileDir !== p.originalAuthProfile))
        throw Error('This connection changed while signing in. Start again from Accounts.');
      if (p.expected && !sameIdentity(p.expected, next))
        throw Error('This is a different Claude account or workspace. Add it as a separate connection. Your previous connection is unchanged.');
      if (JSON.stringify(readJson(this.file, this.data)) !== JSON.stringify(this.data))
        throw Error('Connections changed in another window while signing in. Reload Accounts and try again; existing connections have been preserved.');
      const duplicate = identity(next) && this.data.accounts.find(a => identity(a) === identity(next));
      const target = p.existing || duplicate;
      if(this.proxy && this.proxy.supports('claude',next)) await this.proxy.importAccount('claude',{...next,id:target?.id||next.id},{replace:true});
      const previousAccounts = [...this.data.accounts], previousTarget = target && { ...target };
      if (target) {
        const stable = { id: target.id, label: target.label, preferredModel: target.preferredModel };
        Object.assign(target, next, stable); p.accountId = target.id;
      } else this.data.accounts.push(next);
      try { atomicJson(this.file, this.data); }
      catch {
        this.data.accounts = previousAccounts;
        if (target) { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, previousTarget); }
        throw Error('Could not save the verified Claude connection. Your previous connection is unchanged.');
      }
      p.published = true; p.status = 'complete';
      // A consumer notification failure must not roll back a committed sign-in.
      try { this.onChange?.({accountId:p.accountId,authenticated:true}); } catch {}
      void this.models(p.accountId).catch(() => {});
    } catch (error) {
      if (p.status !== 'cancelled') { p.status = 'failed'; p.error = error.message; }
    } finally { if (!p.published) await this.discardLogin(p); }
  }
  cancel(id) {
    const p = this.pending.get(id);
    if (p && ['waiting','verifying'].includes(p.status)) {
      p.status = 'cancelled'; clearTimeout(p.timer); p.browser?.close(); p.child.kill('SIGTERM'); delete p.url;
      // Wait for the login child to exit before logging its temporary profile out.
      if (p.child.exitCode != null) void this.discardLogin(p);
    }
  }
  async reopen(id) { const p = this.pending.get(id); if (!p?.url || p.status !== 'waiting') throw Error('Sign-in URL is not ready. Try again shortly.'); await this.openExternal?.(p.url); }
  async disconnect(id) {
    if(this.proxy?.has('claude-code-'+this.account(id).id))await this.proxy.disconnect('claude-code-'+this.account(id).id);
    id = this.account(id).id; for (const p of this.pending.values()) if (p.accountId === id) this.cancel(p.id);
    // Disconnecting never deletes official credentials, transcripts, or the shared chat library.
    this.data.accounts = this.data.accounts.filter(a => a.id !== id); this.save(); return { ok: true };
  }
}
const instances = new Map();
function claudeAccountsFor(dir, options) { if (!instances.has(dir)) instances.set(dir, new ClaudeAccounts(dir, options)); return instances.get(dir); }
module.exports = { ClaudeAccounts, claudeAccountsFor, cliEnvironment, MODELS };
