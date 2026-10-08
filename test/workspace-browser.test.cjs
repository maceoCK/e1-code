const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceState } = require('../src/workspace-state.cjs');
const { WorkspaceBrowser } = require('../src/workspace-browser.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = new WorkspaceState(directory), chat = state.createChat({ cwd: directory });
  const created = [], mounted = new Set();
  class Contents extends EventEmitter {
    constructor() { super(); this.url = 'about:blank'; this.dead = false; this.commands = []; this.debugger = { isAttached: () => true, sendCommand: async (method, args) => { this.commands.push({method,args}); } }; }
    setWindowOpenHandler(handler) { this.popup = handler; }
    async loadURL(url) { this.emit('did-start-navigation', {}, url, false, true); this.url = url; this.emit('did-navigate'); }
    getURL() { return this.url; } getTitle() { return this.url; } isDestroyed() { return this.dead; }
    close() { this.dead = true; } stop() {}
    async executeJavaScript() { return { text: 'fixture document', elements: [] }; }
  }
  const electron = { session: { fromPartition: name => ({ name, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) }, WebContentsView: class { constructor(options) { this.options = options; this.webContents = new Contents(); created.push(this); } setBounds(bounds) { this.bounds = bounds; } } };
  const window = { isDestroyed: () => false, webContents: { getZoomFactor: () => 2 }, contentView: { addChildView: view => mounted.add(view), removeChildView: view => mounted.delete(view) } };
  const browser = new WorkspaceBrowser({ state, electron, getWindow: () => window }); t.after(() => browser.close());
  return { state, chat, browser, created, mounted };
}
test('browser serializes concurrent creates against configurable budget', async t => {
  const { state, chat, browser, created } = fixture(t);
  state.updateChat(chat.id, c => { c.limits.maxTabs = 2; c.limits.activeTabs = 1; });
  const results = await Promise.allSettled(['a','b','c'].map(host => browser.open(chat.id, 'https://' + host + '.example')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(browser.list(chat.id).length, 2);
  assert.equal(created.length, 2);
  assert.ok(browser.list(chat.id).some(tab => tab.status === 'frozen'));
  const frozen = browser.list(chat.id).find(tab => tab.status === 'frozen');
  await browser.read(chat.id, frozen.id);
  assert.equal(browser.list(chat.id).find(tab => tab.id === frozen.id).status, 'active');
  assert.equal(browser.list(chat.id).filter(tab => tab.status === 'active').length, 1);
});
test('browser refuses foreign tabs, dangerous URLs and stale navigation epochs', async t => {
  const { state, chat, browser } = fixture(t);
  const first = await browser.open(chat.id, 'https://example.com');
  const foreign = state.createChat({ cwd: chat.cwd });
  await assert.rejects(browser.get(foreign.id, first.id), /another chat/);
  await assert.rejects(browser.open(chat.id, 'file:///etc/passwd'), /HTTP/);
  await assert.rejects(browser.open(chat.id, 'https://user:password@example.com'), /credentials/);
  await browser.navigate(chat.id, first.id, 'https://example.org');
  await assert.rejects(browser.act(chat.id, {id:first.id,epoch:first.epoch,selector:'button'}, 'click'), /changed/);
});
test('browser mounts one view at scaled bounds and removes closed resources', async t => {
  const { state, chat, browser, mounted, created } = fixture(t);
  const first = await browser.open(chat.id, 'https://a.example');
  const second = await browser.open(chat.id, 'https://b.example');
  await browser.present(chat.id, first.id, {x:100,y:50,width:300,height:400});
  assert.deepEqual(created[0].bounds, {x:200,y:100,width:600,height:800});
  await browser.present(chat.id, second.id, {x:100,y:50,width:300,height:400});
  assert.equal(mounted.size, 2); assert.ok(mounted.has(created[1])); assert.equal(browser.shown, second.id);
  browser.closeTab(chat.id, second.id);
  assert.equal(mounted.size, 1); assert.ok(created[1].webContents.dead);
  assert.equal(state.chat(chat.id).panels.length, 1);
});
test('late presentation cannot undo a newer hide', async t => {
  const { chat, browser, mounted } = fixture(t);
  const tab = await browser.open(chat.id, 'https://a.example');
  const get = browser.get.bind(browser); let release;
  browser.get = async (...args) => { await new Promise(r => {release=r;}); return get(...args); };
  const showing = browser.present(chat.id, tab.id, {x:0,y:0,width:300,height:300});
  browser.hide(); release(); await showing;
  assert.equal(mounted.size, 1); assert.equal(browser.shown, null);
});
