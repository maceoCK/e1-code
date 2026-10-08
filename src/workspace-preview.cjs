// Standalone desktop candidate. It reads existing Claude account metadata and
// delegates authentication to the official CLI; it never copies account tokens.
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { ClaudeAccounts } = require('./claude-accounts.cjs');
const { startGatewayWorker } = require('./gateway-host.cjs');
const { startServer } = require('./server.cjs');
const { WorkspaceAgent } = require('./workspace-agent.cjs');
const { WorkspaceBrowser } = require('./workspace-browser.cjs');

app.setName('E1 Workspace Preview');
app.setPath('userData', path.join(app.getPath('appData'), 'E1 Workspace Preview'));
const own = app.requestSingleInstanceLock();
if (!own) app.quit();
let win, gateway, service, closing = false, ready;
const focus = () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
app.on('second-instance', focus);

async function openWindow() {
  if (win && !win.isDestroyed()) return focus();
  const uiSession = session.fromPartition('e1-workspace-preview-ui');
  uiSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  uiSession.setPermissionCheckHandler(() => false);
  uiSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = details.url === 'about:blank';
    try { allowed ||= new URL(details.url).origin === service.origin; } catch {}
    callback({ cancel: !allowed });
  });
  win = new BrowserWindow({ width: 1380, height: 900, minWidth: 760, minHeight: 560,
    title: 'E1 Workspace Preview', backgroundColor: '#ffffff', show: false,
    webPreferences: { session: uiSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== service.origin) event.preventDefault(); });
  win.on('close', () => service.workspace.tools.browser.hide());
  win.once('closed', () => { win = null; });
  win.once('ready-to-show', focus);
  await win.loadURL(service.origin + '/workspace' + new URL(service.url).hash);
}
async function boot() {
  const directory = app.getPath('userData');
  const accounts = new ClaudeAccounts(path.join(app.getPath('appData'), 'Aster'));
  // The preview deliberately uses only connected subscription routes. The
  // installed E1 app retains account setup and API provider configuration.
  const providers = accounts.providers().filter(p => p.signedIn && p.billing === 'subscription');
  const store = { dir: path.join(directory, 'gateway'),
    data: { providers, modelPreferences: {}, selection: { provider: providers[0]?.id },
      routing: { enabled: true, allowApiFallback: false, order: providers.map(p => p.id) } },
    provider(id) { const found = providers.find(p => p.id === id); if (!found) throw Error('Connection not found.'); return found; },
    key() { throw Error('Authentication is managed by the official Claude CLI.'); },
  };
  fs.mkdirSync(store.dir, { recursive: true, mode: 0o700 });
  gateway = await startGatewayWorker({ store }); await gateway.ready;
  const agent = new WorkspaceAgent({ directory: path.join(directory, 'workspace'), gateway });
  const initial = process.env.E1_WORKSPACE_INITIAL_CWD;
  if (!agent.state.data.chats.length && initial && fs.existsSync(initial)) {
    const model = gateway.catalog().find(m => /sonnet/.test(m.model)) || gateway.catalog()[0];
    agent.state.createChat({ cwd: initial, title: 'E1 workspace', model: model?.id || '' });
  }
  service = await startServer({ dataDir: path.join(directory, 'server'), workspaceAgent: agent });
  agent.tools.browser = new WorkspaceBrowser({ state: agent.state, electron: require('electron'), getWindow: () => win,
    onChange: event => agent.emit('change', event) });
  const standard = [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
  standard.push({ label: 'Workspace', submenu: [
    { label: 'Show chat', click: () => openWindow() },
    { label: 'Show workspace data', click: () => shell.showItemInFolder(agent.state.file) },
    { label: 'About this preview', click: () => dialog.showMessageBox(win, { type: 'info', title: 'E1 Workspace Preview',
      message: 'Chat, Pages, terminal, browser, side chats, and schedules',
      detail: 'This preview uses E1’s connected Claude subscription accounts through the official CLI. Chat data is separate from your installed E1 app. Restart the preview after changing accounts in E1. Schedules run while this app is open. Document engines, native app control, MCP Apps, cloud collaboration, and other providers are still being integrated.' }) },
  ] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(standard));
  await openWindow();
  console.log('E1_WORKSPACE_PREVIEW_READY');
}
if (own) ready = app.whenReady().then(boot).catch(error => {
  dialog.showErrorBox('Could not open E1 Workspace Preview', error.message); app.quit();
});
app.on('activate', () => { if (service) void openWindow(); });
app.on('before-quit', event => {
  if (closing) return;
  event.preventDefault(); closing = true;
  Promise.resolve(ready).then(async () => { await service?.close(); await gateway?.close(); })
    .finally(() => app.quit());
});
