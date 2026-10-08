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
class ClaudeAccounts {
  constructor(dir, options = {}) {
    this.dir = dir; this.file = path.join(dir, 'claude-accounts.json');
    this.executable = options.executable || findBinary(); this.run = options.run || run;
    this.spawn = options.spawn || spawn; this.openExternal = options.openExternal;
    this.data = readJson(this.file, { version: 1, accounts: [] }); this.pending = new Map();
  }
  save() { atomicJson(this.file, this.data); }
  account(id) { const a = this.data.accounts.find(a => a.id === id); if (!a) throw Error('Claude account not found.'); return a; }
  snapshot() {
    return { available: !!this.executable, accounts: this.data.accounts.map(({ configDir, profileDir, ...a }) => a),
      pending: [...this.pending.values()].map(({ child, timer, url, ...p }) => p) };
  }
  providers() {
    return this.data.accounts.map(a => ({ id: 'claude-code-' + a.id, accountId: a.id, name: a.label,
      authType: 'claude-code', protocol: 'claude-code', baseUrl: 'claude-code://local', signedIn: a.connected,
      executable: this.executable, configDir: a.configDir, profileDir: a.profileDir,
      models: (a.models?.length ? a.models : MODELS).map(m => ({ ...m, name: require('./claude-models.cjs').modelName(m.id, m.name) })),
      preferredModel: a.preferredModel || 'sonnet', billingMethod: a.method,
      planType: a.subscriptionType, accountEmail: a.email,
      billing: a.method === 'console' ? 'api' : (a.billingState || 'account'), keySource: 'Managed by official Claude Code', hasKey: a.connected }));
  }
  async refresh(id) {
    if (!this.executable) throw Error('Install the official Claude Code CLI to connect a Claude account.');
    const a = this.account(id), { data } = await this.run(this.executable, ['auth', 'status', '--json'], a.configDir, 30000, a.profileDir);
    a.connected = data.loggedIn === true; if (!a.connected) { delete a.billingState; delete a.allowance; } a.authMethod = data.authMethod || null;
    a.apiProvider = data.apiProvider || null; a.subscriptionType = data.subscriptionType || null; a.email = data.email || null; a.checkedAt = new Date().toISOString();
    // CLI auth status does not prove the charge source of an individual request.
    this.save(); return this.snapshot();
  }
  async models(id) {
    await this.refresh(id);
    const a = this.account(id);
    if (!a.connected) throw Error('Sign in to discover Claude models.');
    const models = await require('./claude-models.cjs').discoverModels(this.executable, cliEnvironment(a.configDir, process.env, a.profileDir));
    a.models = models; a.modelsCheckedAt = new Date().toISOString(); this.save(); return models;
  }
  async useExisting() {
    const configDir = path.join(os.homedir(), '.claude');
    let a = this.data.accounts.find(a => a.configDir === configDir);
    if (!a) { a = { id: randomUUID(), label: 'Claude Code', configDir, existing: true, connected: false }; this.data.accounts.push(a); }
    a.profileDir = path.join(this.dir, 'claude-profiles', 'existing-subscription', 'anthropic');
    a.method = 'claudeai';
    await this.refresh(a.id);
    if (!a.connected) {
      // A Console profile is a distinct, explicitly labelled API connection.
      a.profileDir = path.join(os.homedir(), '.config/anthropic'); a.method = 'console';
      a.label = 'Claude Console (existing)'; await this.refresh(a.id);
    }
    return { accountId: a.id, ...this.snapshot() };
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
    let a = id ? this.account(id) : null;
    if (a?.existing) a = null; // A new login must never sign out the user's global CLI profile.
    if (!a) {
      const accountId = randomUUID();
      a = { id: accountId, label: (method === 'console' ? 'Claude Console ' : 'Claude ') + (this.data.accounts.length + 1), connected: false, method,
        configDir: path.join(this.dir, 'claude-profiles', accountId) };
      fs.mkdirSync(a.configDir, { recursive: true, mode: 0o700 }); this.data.accounts.push(a); this.save();
    }
    if ([...this.pending.values()].some(p => p.accountId === a.id && p.status === 'waiting')) throw Error('Sign-in is already open for this account.');
    a.method = method; delete a.billingState; delete a.allowance; this.save();
    const child = this.spawn(this.executable, ['auth', 'login', '--' + method], {
      env: cliEnvironment(a.configDir, process.env, a.profileDir), cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = { id: randomUUID(), accountId: a.id, status: 'waiting', child };
    this.pending.set(p.id, p);
    let output = '';
    const observe = chunk => {
      output = (output + chunk).slice(-16000);
      const match = output.match(/https:\/\/(?:claude\.ai|platform\.claude\.com|console\.anthropic\.com)\/[^\s\x1b]+/);
      if (match) p.url = match[0]; // Kept in memory only; contains OAuth state.
    };
    child.stdout.on('data', observe); child.stderr.on('data', observe);
    p.timer = setTimeout(() => this.cancel(p.id), 600000);
    child.on('error', () => { p.status = 'failed'; p.error = 'Could not start Claude Code sign-in.'; clearTimeout(p.timer); });
    child.on('close', async code => {
      clearTimeout(p.timer); if (p.status !== 'waiting') return;
      try { await this.refresh(a.id); p.status = code === 0 && a.connected ? 'complete' : 'failed';
        if (p.status === 'complete') await this.models(a.id).catch(() => {}); }
      catch { p.status = 'failed'; }
      if (p.status === 'failed') p.error = 'Claude Code sign-in did not complete. Open it again to retry.';
      delete p.url;
    });
    return { id: p.id, accountId: a.id, status: p.status };
  }
  cancel(id) { const p = this.pending.get(id); if (p?.status === 'waiting') { p.status = 'cancelled'; clearTimeout(p.timer); p.child.kill('SIGTERM'); delete p.url; } }
  async reopen(id) { const p = this.pending.get(id); if (!p?.url || p.status !== 'waiting') throw Error('Sign-in URL is not ready. Try again shortly.'); await this.openExternal?.(p.url); }
  disconnect(id) {
    this.account(id); for (const p of this.pending.values()) if (p.accountId === id) this.cancel(p.id);
    // Disconnecting never deletes official credentials, transcripts, or the shared chat library.
    this.data.accounts = this.data.accounts.filter(a => a.id !== id); this.save(); return { ok: true };
  }
}
const instances = new Map();
function claudeAccountsFor(dir, options) { if (!instances.has(dir)) instances.set(dir, new ClaudeAccounts(dir, options)); return instances.get(dir); }
module.exports = { ClaudeAccounts, claudeAccountsFor, cliEnvironment, MODELS };
