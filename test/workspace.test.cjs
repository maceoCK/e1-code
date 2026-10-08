const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { WorkspaceState } = require('../src/workspace-state.cjs');
const { WorkspaceTools } = require('../src/workspace-tools.cjs');
const { WorkspaceAgent, gatewayTurn } = require('../src/workspace-agent.cjs');
const { startServer } = require('../src/server.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-workspace-'));
  const root = path.join(dir, 'project'); fs.mkdirSync(root);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new WorkspaceState(path.join(dir, 'data'));
  const chat = state.createChat({ cwd: root, model: 'test-model' });
  return { dir, root, state, chat };
}
test('workspace persists panels, pages, revisions and detects conflicting writers', t => {
  const { dir, state, chat } = fixture(t);
  const page = state.createPage({ title: 'Design', content: 'First' });
  const first = state.openPanel(chat.id, 'page', page.id, page.title);
  assert.equal(state.openPanel(chat.id, 'page', page.id, page.title).id, first.id);
  const changed = state.editPage({ id: page.id, revision: 1, content: 'Second' });
  assert.equal(changed.history[0].content, 'First');
  assert.throws(() => state.editPage({ id: page.id, revision: 1, content: 'Lost update' }), /changed/);
  const reopened = new WorkspaceState(path.join(dir, 'data'));
  assert.equal(reopened.page(page.id).content, 'Second');
  assert.equal(reopened.chat(chat.id).activePanelId, first.id);
  state.updateChat(chat.id, c => { c.title = 'New title'; });
  assert.throws(() => reopened.updateChat(chat.id, c => { c.title = 'Stale'; }), /another process/);
});
test('page hierarchy prevents cycles and preserves state on failed edits', t => {
  const { state } = fixture(t);
  const parent = state.createPage({ title: 'Parent' });
  const child = state.createPage({ title: 'Child', parentId: parent.id });
  assert.throws(() => state.editPage({ id: parent.id, revision: 1, parentId: child.id }), /themselves/);
  assert.equal(state.page(parent.id).parentId, null);
});
test('file tools prevent stale overwrites and symlink escapes', async t => {
  const { dir, root, state, chat } = fixture(t); const tools = new WorkspaceTools(state);
  fs.writeFileSync(path.join(root, 'file.txt'), 'First');
  const first = await tools.call(chat.id, 'file_read', { path: 'file.txt' });
  fs.writeFileSync(path.join(root, 'file.txt'), 'External edit');
  await assert.rejects(tools.call(chat.id, 'file_write', { path: 'file.txt', content: 'Second', revision: first.revision }), /changed/);
  assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'External edit');
  fs.symlinkSync(dir, path.join(root, 'escape'));
  await assert.rejects(tools.call(chat.id, 'file_write', { path: 'escape/outside.txt', content: 'bad', revision: 'new' }), /outside/);
  await assert.rejects(tools.call(chat.id, 'file_read', { path: 'file.txt', extra: true }), /Unknown/);
  const saved = await tools.call(chat.id, 'file_write', { path: 'new.txt', content: 'Created', revision: 'new' });
  assert.equal(fs.readFileSync(saved.path, 'utf8'), 'Created');
});
test('real command sessions accept input, retain output, isolate chats and terminate', async t => {
  const { state, chat, root } = fixture(t); const tools = new WorkspaceTools(state, { shell: '/bin/sh' });
  t.after(() => tools.close());
  const command = await tools.call(chat.id, 'terminal_start', { command: 'read value; printf "got:%s" "$value"' });
  const other = state.createChat({ cwd: root });
  await assert.rejects(tools.call(other.id, 'terminal_read', { id: command.id }), /not found/);
  await tools.call(chat.id, 'terminal_write', { id: command.id, text: 'from-test\n' });
  await tools.process(chat.id, command.id).done;
  const output = await tools.call(chat.id, 'terminal_read', { id: command.id, cursor: 0 });
  assert.match(output.output, /got:from-test/); assert.equal(output.mode, 'pty'); assert.equal(output.exitCode, 0);
  const long = await tools.call(chat.id, 'terminal_start', { command: 'sleep 60' });
  const stopped = await tools.call(chat.id, 'terminal_stop', { id: long.id });
  assert.equal(stopped.status, 'exited'); assert.equal(stopped.signal, 'SIGTERM');
});
async function* message(blocks, reason = 'end_turn') {
  for (const [index, content_block] of blocks.entries()) {
    yield { type: 'content_block_start', index, content_block };
    yield { type: 'content_block_stop', index };
  }
  yield { type: 'message_delta', delta: { stop_reason: reason } };
  yield { type: 'message_stop' };
}
test('agent loop executes shared tools and returns real results before answering', async t => {
  const { dir, root } = fixture(t); let turns = 0;
  const agent = new WorkspaceAgent({ directory: path.join(dir, 'agent'), generate: async function* (body) {
    turns++;
    if (turns === 1) yield* message([{ type: 'tool_use', id: 'call1', name: 'page_create', input: { title: 'Actual page', content: 'Persistent content' } }], 'tool_use');
    else {
      const result = JSON.parse(body.messages.at(-1).content[0].content);
      assert.equal(result.content, 'Persistent content');
      assert.ok(agent.state.page(result.id));
      yield* message([{ type: 'text', text: 'Created the page.' }]);
    }
  } }); t.after(() => agent.close());
  const chat = agent.state.createChat({ cwd: root, model: 'test-model' });
  agent.start(chat.id, 'Create a page'); await agent.active.get(chat.id).done;
  assert.equal(turns, 2); assert.equal(agent.state.chat(chat.id).status, 'idle');
  assert.equal(agent.state.chat(chat.id).messages.length, 4);
  assert.equal(agent.state.chat(chat.id).panels[0].kind, 'page');
});
test('restart reports interrupted work and preserves original user request', t => {
  const { dir, state, chat } = fixture(t);
  state.updateChat(chat.id, c => { c.status = 'running'; c.messages.push({ role: 'user', content: 'Keep this request' }); });
  const reopened = new WorkspaceState(path.join(dir, 'data'));
  assert.equal(reopened.chat(chat.id).status, 'interrupted');
  assert.equal(reopened.chat(chat.id).messages[0].content, 'Keep this request');
});
test('gateway transport rejects truncated streams and never sends browser Origin', async t => {
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.origin, undefined); assert.equal(req.headers.authorization, 'Bearer fixture-secret');
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"partial"}}\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const gateway = { origin: `http://127.0.0.1:${server.address().port}`, token: 'fixture-secret' };
  await assert.rejects(async () => { for await (const _ of gatewayTurn(gateway, {}, new AbortController().signal)) {} }, /before completion/);
});
test('workspace API shares broker state, requires authentication and checks resource limits', async t => {
  const { dir, root } = fixture(t);
  const agent = new WorkspaceAgent({ directory: path.join(dir, 'api-workspace'), generate: () => message([{ type: 'text', text: 'hello' }]) });
  const service = await startServer({ dataDir: path.join(dir, 'api'), workspaceAgent: agent }); t.after(() => service.close());
  assert.equal((await fetch(service.origin + '/api/workspace/state')).status, 401);
  const login = await fetch(service.origin + '/api/session', { method: 'POST', headers: { Origin: service.origin }, body: JSON.stringify({ token: service.url.split('#')[1] }) });
  const headers = { Origin: service.origin, Cookie: login.headers.get('set-cookie').split(';')[0] };
  const post = (route, body) => fetch(service.origin + '/api/workspace/' + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const chat = await (await post('chat', { cwd: root, model: 'test-model' })).json();
  assert.equal((await (await post('model', { chatId: chat.id, model: 'another-model' })).json()).model, 'another-model');
  const page = await (await post('tool', { chatId: chat.id, name: 'page_create', arguments: { title: 'From UI', content: 'Shared' } })).json();
  assert.equal(agent.state.page(page.id).content, 'Shared');
  const changed = await (await post('limits', { chatId: chat.id, limits: { maxTabs: 64, activeTabs: 8 } })).json();
  assert.equal(changed.limits.maxTabs, 64);
  assert.equal((await post('limits', { chatId: chat.id, limits: { activeTabs: 1000 } })).status, 400);
  assert.equal((await fetch(service.origin + '/api/workspace/tool', { method: 'POST', headers: { ...headers, Origin: 'https://wrong.example' }, body: '{}' })).status, 403);
});
