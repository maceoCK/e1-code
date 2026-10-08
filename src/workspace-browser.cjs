const { randomUUID } = require('node:crypto');

// Electron is injected so the host can be exercised without loading native UI
// in unit tests. Browser contents never get the workspace's authenticated session.
class WorkspaceBrowser {
  constructor({ state, electron, getWindow, onChange = () => {} }) {
    this.state = state; this.electron = electron; this.getWindow = getWindow;
    this.onChange = onChange; this.tabs = new Map(); this.queues = new Map(); this.shown = null;
    this.closed = false;
    this.presentationGeneration = 0;
  }
  async serial(chatId, work) {
    const previous = this.queues.get(chatId) || Promise.resolve();
    const current = previous.catch(() => {}).then(work); this.queues.set(chatId, current);
    try { return await current; } finally { if (this.queues.get(chatId) === current) this.queues.delete(chatId); }
  }
  validateURL(url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) && url !== 'about:blank') throw Error('Browser URLs must use HTTP or HTTPS.');
    if (parsed.username || parsed.password) throw Error('Use the site sign-in form instead of putting credentials in a URL.');
    return parsed.href;
  }
  metadata(tab) { return { id: tab.id, url: tab.url, title: tab.title, epoch: tab.epoch, status: tab.status, lastUsed: tab.lastUsed }; }
  publish(tab) {
    this.state.updateChat(tab.chatId, chat => {
      chat.browserTabs ||= [];
      const index = chat.browserTabs.findIndex(t => t.id === tab.id);
      if (index === -1) chat.browserTabs.push(this.metadata(tab)); else chat.browserTabs[index] = this.metadata(tab);
      for (const panel of chat.panels) if (panel.kind === 'browser' && panel.resourceId === tab.id) panel.title = tab.title || tab.url;
    });
    this.onChange({ type: 'browser', chatId: tab.chatId, id: tab.id });
  }
  list(chatId) {
    return (this.state.chat(chatId).browserTabs || []).map(saved => this.tabs.has(saved.id) ? this.metadata(this.tabs.get(saved.id)) : { ...saved, status: 'unloaded' });
  }
  createView(chatId, saved) {
    if (this.closed) throw Error('Browser host is closing.');
    const session = this.electron.session.fromPartition('persist:e1-workspace-web-' + chatId);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    const view = new this.electron.WebContentsView({ webPreferences: { session, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    view.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
    const tab = { ...saved, chatId, view, epoch: (saved.epoch || 0) + 1, status: 'active', lastUsed: Date.now() };
    this.tabs.set(tab.id, tab);
    // Park behind the chat renderer. An unattached WebContentsView has no
    // compositor surface and can silently lose native input and capture.
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.contentView.addChildView(view, 0);
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => { void this.open(chatId, url).catch(() => {}); return { action: 'deny' }; });
    wc.on('will-navigate', (event, url) => { try { this.validateURL(url); } catch { event.preventDefault(); } });
    wc.on('will-redirect', (event, url) => { try { this.validateURL(url); } catch { event.preventDefault(); } });
    wc.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) tab.epoch++; });
    const changed = () => { if (!wc.isDestroyed() && this.tabs.has(tab.id) && !this.closed) { tab.url = wc.getURL(); tab.title = wc.getTitle() || tab.url; this.publish(tab); } };
    wc.on('did-navigate', changed); wc.on('did-navigate-in-page', changed); wc.on('page-title-updated', changed);
    return tab;
  }
  async load(tab, url, signal) {
    const wc = tab.view.webContents;
    const abort = () => wc.stop();
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
    let timer;
    try {
      await Promise.race([wc.loadURL(this.validateURL(url)), new Promise((_, reject) => { timer = setTimeout(() => { wc.stop(); reject(Error('Page load timed out. Inspect the tab before retrying.')); }, 30000); })]);
      signal?.throwIfAborted(); tab.url = wc.getURL(); tab.title = wc.getTitle() || tab.url; this.publish(tab);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async get(chatId, id, signal) {
    let tab = this.tabs.get(id);
    if (tab && tab.chatId !== chatId) throw Error('Tab belongs to another chat.');
    if (!tab) {
      const saved = (this.state.chat(chatId).browserTabs || []).find(t => t.id === id);
      if (!saved) throw Error('Browser tab not found.');
      tab = this.createView(chatId, saved); await this.load(tab, saved.url, signal);
    }
    if (tab.status === 'frozen') { await this.cdp(tab, 'Page.setWebLifecycleState', { state: 'active' }); tab.status = 'active'; }
    tab.lastUsed = Date.now(); return tab;
  }
  async cdp(tab, method, params) {
    const debug = tab.view.webContents.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    return debug.sendCommand(method, params);
  }
  async budget(chatId, protectedId) {
    const limit = this.state.chat(chatId).limits.activeTabs;
    const active = [...this.tabs.values()].filter(t => t.chatId === chatId && t.status === 'active').sort((a, b) => a.lastUsed - b.lastUsed);
    let count = active.length;
    for (const tab of active) {
      if (count <= limit) break;
      if (tab.id === protectedId || tab.id === this.shown) continue;
      try { await this.cdp(tab, 'Page.setWebLifecycleState', { state: 'frozen' }); tab.status = 'frozen'; this.publish(tab); count--; }
      catch { /* Failed suspension is not represented as a successful freeze. */ }
    }
  }
  async open(chatId, url, signal) {
    return this.serial(chatId, async () => {
      const chat = this.state.chat(chatId); url = this.validateURL(url);
      if ((chat.browserTabs || []).length >= chat.limits.maxTabs) throw Error(`This chat has reached its ${chat.limits.maxTabs}-tab budget. Close a tab or adjust its resource limits.`);
      const tab = this.createView(chatId, { id: randomUUID(), url, title: url });
      this.publish(tab);
      try { await this.load(tab, url, signal); } catch (error) { tab.status = 'failed'; tab.error = error.message; this.publish(tab); throw error; }
      this.state.openPanel(chatId, 'browser', tab.id, tab.title);
      await this.budget(chatId, tab.id); return this.metadata(tab);
    });
  }
  async navigate(chatId, id, url, signal) {
    return this.serial(chatId, async () => { const tab = await this.get(chatId, id, signal); await this.load(tab, url, signal); await this.budget(chatId, id); return this.metadata(tab); });
  }
  async read(chatId, id, signal) {
    const tab = await this.get(chatId, id, signal), epoch = tab.epoch;
    const content = await tab.view.webContents.executeJavaScript(`(() => {
      const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')].filter(e => e.getClientRects().length).slice(0,500);
      const selector=e=>{if(e.id)return '#'+CSS.escape(e.id);const parts=[];for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const tag=n.tagName.toLowerCase();parts.unshift(tag+':nth-of-type('+([...n.parentElement.children].filter(x=>x.tagName===n.tagName).indexOf(n)+1)+')');}return parts.join(' > ');};
      return {text:document.body?.innerText.slice(0,50000)||'',elements:nodes.map((e,index)=>({index,selector:selector(e),tag:e.tagName.toLowerCase(),label:e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.innerText?.slice(0,160)||'',type:e.type||'',href:e.getAttribute('href')||''}))};
    })()`);
    if (epoch !== tab.epoch) throw Error('Page navigated while reading. Read it again.');
    await this.budget(chatId, id); return { ...this.metadata(tab), ...content };
  }
  async act(chatId, input, action, signal) {
    return this.serial(chatId, async () => {
      const tab = await this.get(chatId, input.id, signal);
      if (tab.epoch !== input.epoch) throw Error('Page changed. Read the tab again before acting.');
      const selector = JSON.stringify(input.selector);
      if (action === 'click') {
        const point = await tab.view.webContents.executeJavaScript(`(() => {const e=document.querySelector(${selector});if(!e)throw Error('Element not found');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        if (tab.epoch !== input.epoch) throw Error('Page changed before clicking.');
        try { await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); }
        finally { await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); }
      } else {
        await tab.view.webContents.executeJavaScript(`(() => {const e=document.querySelector(${selector});if(!e)throw Error('Element not found');if(e.disabled||e.readOnly)throw Error('Element is not editable');e.focus();const value=${JSON.stringify(input.text)};if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement){const p=e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,value);}else if(e.isContentEditable){e.textContent=value;}else throw Error('Element is not a text field');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      }
      signal?.throwIfAborted(); return this.read(chatId, input.id, signal);
    });
  }
  async present(chatId, id, bounds) {
    const generation = ++this.presentationGeneration;
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw Error('Open the chat workspace window to display this tab.');
    const tab = await this.get(chatId, id);
    if (generation !== this.presentationGeneration || window.isDestroyed()) return;
    this.detach();
    const zoom = window.webContents.getZoomFactor();
    const scaled = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * zoom)]));
    window.contentView.addChildView(tab.view); tab.view.setBounds(scaled); this.shown = id;
    await this.budget(chatId, id);
  }
  hide() {
    this.presentationGeneration++;
    this.detach();
  }
  detach() {
    const tab = this.tabs.get(this.shown), window = this.getWindow();
    if (tab && window && !window.isDestroyed()) { window.contentView.removeChildView(tab.view); window.contentView.addChildView(tab.view, 0); }
    this.shown = null;
  }
  closeTab(chatId, id) {
    const saved = this.list(chatId).find(t => t.id === id); if (!saved) throw Error('Browser tab not found.');
    if (this.shown === id) this.hide();
    const tab = this.tabs.get(id); this.tabs.delete(id);
    const window = this.getWindow();
    if (tab && window && !window.isDestroyed()) window.contentView.removeChildView(tab.view);
    tab?.view.webContents.close();
    this.state.updateChat(chatId, c => { c.browserTabs = (c.browserTabs || []).filter(t => t.id !== id); c.panels = c.panels.filter(p => !(p.kind === 'browser' && p.resourceId === id)); if (!c.panels.some(p => p.id === c.activePanelId)) c.activePanelId = c.panels.at(-1)?.id || null; });
    this.onChange({ type: 'browser', chatId }); return { closed: id };
  }
  async screenshot(chatId, id, signal) {
    const tab = await this.get(chatId, id, signal);
    const image = await tab.view.webContents.capturePage();
    const scaled = image.getSize().width > 1280 ? image.resize({ width: 1280 }) : image;
    return { ...this.metadata(tab), image: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: scaled.toPNG().toString('base64') } } };
  }
  close() { this.closed = true; this.hide(); for (const tab of this.tabs.values()) tab.view.webContents.close(); this.tabs.clear(); }
}
module.exports = { WorkspaceBrowser };
