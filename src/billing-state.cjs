const fs = require('node:fs');
const path = require('node:path');
const { readJson, atomicJson } = require('./library-identity.cjs');
const uuid = '(?:local_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const validId = value => typeof value === 'string' && new RegExp(`^${uuid}$`, 'i').test(value);

// Keep only routing correlation IDs, never device/account metadata or prompts.
function requestScope(body) {
  let metadata = body?.metadata;
  try { if (typeof metadata?.user_id === 'string') metadata = JSON.parse(metadata.user_id); } catch {
    const match = metadata.user_id.match(new RegExp(`_session_(${uuid})$`, 'i'));
    metadata = { session_id: match?.[1] };
  }
  return Object.fromEntries(['session_id', 'parent_session_id'].filter(k => validId(metadata?.[k])).map(k => [k, metadata[k]]));
}

class NativeSessionIndex {
  constructor(profile) { this.profile = profile; this.entries = new Map(); this.scannedAt = 0; }
  refresh() {
    if (Date.now() - this.scannedAt < 500) return;
    this.scannedAt = Date.now();
    for (const [folder, kind] of [['claude-code-sessions', 'code'], ['local-agent-mode-sessions', 'cowork']]) {
      const visit = (dir, depth) => {
        let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory() && depth < 2) visit(file, depth + 1);
          else if (entry.isFile() && /^local_.*\.json$/.test(entry.name)) {
            const data = readJson(file, {});
            if (validId(data.sessionId) && validId(data.cliSessionId)) {
              const ref = { chatId: data.sessionId, kind };
              this.entries.set(data.cliSessionId, ref); this.entries.set(data.sessionId, ref);
            }
          }
        }
      };
      visit(path.join(this.profile, folder), 0);
    }
  }
  resolve(scope = {}) {
    this.refresh();
    // A child agent's spend belongs to the parent chat when it has no own pane.
    return this.entries.get(scope.session_id) || this.entries.get(scope.parent_session_id);
  }
}

class BillingState {
  constructor({ profile, file }) {
    this.index = new NativeSessionIndex(profile); this.file = file;
    this.active = new Map(); this.latest = new Map(); this.order = new Map(); this.sequence = 0;
    const saved = readJson(file, { chats: [] });
    for (const s of saved.chats || []) if (validId(s.chatId)) this.latest.set(s.chatId, { ...s, running: false, phase: 'finished', sequence: 0 });
  }
  update(status) {
    if (!status.requestId || !status.billing) return;
    const ref = this.index.resolve(status.scope);
    if (!ref) return; // Startup checks must never be assigned to the focused chat.
    let sequence = this.order.get(status.requestId);
    if (!sequence) { sequence = ++this.sequence; this.order.set(status.requestId, sequence); }
    const value = { ...status, ...ref, sequence };
    delete value.scope; delete value.health; delete value.allowance;
    if (status.phase === 'finished') this.active.delete(status.requestId);
    else this.active.set(status.requestId, value);
    if ((this.latest.get(ref.chatId)?.sequence || 0) <= sequence) this.latest.set(ref.chatId, value);
    if (status.phase === 'finished') {
      atomicJson(this.file, { chats: [...this.latest.values()].slice(-5000).map(v => ({ ...v, phase: 'finished', running: false })) });
    }
    return value;
  }
  snapshot() {
    const chats = new Map([...this.latest].map(([id, s]) => [id, { ...s, running: false }]));
    for (const value of this.active.values()) {
      const current = chats.get(value.chatId);
      if (!current?.running || (current.billing !== 'api' && value.billing === 'api') || (current.billing === value.billing && current.sequence < value.sequence)) {
        chats.set(value.chatId, { ...value, running: true });
      }
    }
    return [...chats.values()].map(({ sequence, requestId, ...s }) => s);
  }
}
module.exports = { requestScope, NativeSessionIndex, BillingState };
