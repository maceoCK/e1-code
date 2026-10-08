const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson, readJson } = require('./library-identity.cjs');

// This store is deliberately separate from account settings and the recovered
// conversation database. A model change never changes a workspace identity.
class WorkspaceState {
  constructor(directory) {
    this.file = path.join(directory, 'agent-workspace.json');
    this.data = readJson(this.file, { version: 1, revision: 0, chats: [], pages: [] });
    if (this.data.version !== 1) throw Error('Unsupported workspace version. Existing data was preserved.');
    this.savedRevision = this.data.revision;
    // Running operations cannot survive the host process. Never display them as live.
    if (this.data.chats.some(c => c.status === 'running' || c.pendingTurn)) this.change(data => {
      for (const chat of data.chats) if (chat.status === 'running' || chat.pendingTurn) {
        recoverPending(chat);
        chat.status = 'interrupted';
        chat.interruption = 'The workspace closed before this response completed.';
      }
    });
  }
  change(fn) {
    const disk = readJson(this.file, null);
    if (disk && disk.revision !== this.savedRevision) throw Error('Workspace changed in another process. Reopen it before editing.');
    const next = structuredClone(this.data);
    const result = fn(next);
    next.revision++;
    atomicJson(this.file, next);
    this.data = next;
    this.savedRevision = next.revision;
    return structuredClone(result);
  }
  snapshot() { return structuredClone(this.data); }
  chat(id) {
    const chat = this.data.chats.find(c => c.id === id);
    if (!chat) throw Error('Chat not found.');
    return structuredClone(chat);
  }
  createChat({ title = 'New chat', cwd, model = '', parentId } = {}) {
    if (!cwd || !fs.statSync(cwd).isDirectory()) throw Error('Choose an existing workspace folder.');
    cwd = fs.realpathSync(cwd);
    const parent = parentId ? this.chat(parentId) : null;
    const chat = { id: randomUUID(), title: String(title).slice(0, 160), cwd, model,
      parentId: parent?.id || null, createdAt: Date.now(), status: 'idle',
      messages: parent ? structuredClone(parent.messages) : [], panels: [], activePanelId: null,
      layout: { position: 'right', width: 480 }, limits: { maxTabs: 32, activeTabs: 6, maxToolRounds: 50 } };
    return this.change(data => { data.chats.push(chat); return chat; });
  }
  updateChat(id, fn) {
    return this.change(data => {
      const chat = data.chats.find(c => c.id === id);
      if (!chat) throw Error('Chat not found.');
      fn(chat); return chat;
    });
  }
  openPanel(chatId, kind, resourceId, title) {
    if (!['page', 'file', 'terminal', 'browser', 'chat', 'app', 'review', 'artifact', 'schedules', 'activity'].includes(kind)) throw Error('Unsupported panel kind.');
    let panel;
    this.updateChat(chatId, chat => {
      panel = chat.panels.find(p => p.kind === kind && p.resourceId === resourceId);
      if (!panel) { panel = { id: randomUUID(), kind, resourceId, title: String(title).slice(0, 160) }; chat.panels.push(panel); }
      chat.activePanelId = panel.id;
    });
    return structuredClone(panel);
  }
  page(id) {
    const page = this.data.pages.find(p => p.id === id);
    if (!page) throw Error('Page not found.');
    return structuredClone(page);
  }
  createPage({ title, content = '', parentId = null }) {
    if (parentId) this.page(parentId);
    const page = { id: randomUUID(), title: String(title).slice(0, 160), content, parentId,
      revision: 1, updatedAt: Date.now(), history: [], comments: [] };
    return this.change(data => { data.pages.push(page); return page; });
  }
  editPage({ id, revision, title, content, parentId }) {
    return this.change(data => {
      const page = data.pages.find(p => p.id === id);
      if (!page) throw Error('Page not found.');
      if (page.revision !== revision) throw Error('Page changed. Read its current revision before saving.');
      if (parentId !== undefined && parentId !== null) {
        let ancestor = data.pages.find(p => p.id === parentId);
        if (!ancestor) throw Error('Parent page not found.');
        while (ancestor) {
          if (ancestor.id === id) throw Error('Pages cannot contain themselves.');
          ancestor = data.pages.find(p => p.id === ancestor.parentId);
        }
      }
      page.history.push({ revision: page.revision, title: page.title, content: page.content, parentId: page.parentId, updatedAt: page.updatedAt });
      if (title !== undefined) page.title = String(title).slice(0, 160);
      if (content !== undefined) page.content = content;
      if (parentId !== undefined) page.parentId = parentId;
      page.revision++; page.updatedAt = Date.now(); return page;
    });
  }
}
function recoverPending(chat) {
  if (!chat.pendingTurn) return;
  const pending = chat.pendingTurn, results = pending.content.filter(b => b.type === 'tool_use').map(call =>
    pending.results.find(result => result.tool_use_id === call.id) || {
      type: 'tool_result', tool_use_id: call.id, is_error: true,
      content: pending.startedAction === call.id
        ? 'The host stopped while this action was running. Its outcome is UNKNOWN and it may already have changed things. Verify the current state before any retry. Do not repeat automatically.'
        : 'The host stopped before this action was started. It was not executed.',
    });
  chat.messages.push({ role: 'assistant', content: pending.content }, { role: 'user', content: results });
  chat.recoveries = [...(chat.recoveries || []), { runId: pending.runId, recoveredAt: Date.now(), uncertainAction: pending.startedAction || null }].slice(-100);
  delete chat.pendingTurn;
}
module.exports = { WorkspaceState, recoverPending };
