const { app, BrowserWindow, Menu, MenuItem, safeStorage, shell, dialog, autoUpdater, session } = require("./secure-storage.cjs").install();
const path = require("node:path"), fs = require("node:fs");
// Test isolation: relocate every E1 profile directory (Aster, Aster-Workspace-3p, ...).
if (process.env.E1_APPDATA_ROOT) app.setPath("appData", path.resolve(process.env.E1_APPDATA_ROOT));
if (process.argv.includes('--e1-check-keychain')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'E1 Storage Verification'));
  app.whenReady().then(async () => {
    const probe = 'E1 storage verification ' + require('node:crypto').randomUUID();
    if (safeStorage.decryptString(safeStorage.encryptString(probe)) !== probe) throw Error('Storage roundtrip failed.');
    const directory = path.join(app.getPath('appData'), 'Aster');
    let legacyCredentials = 0;
    for (const [file, key] of [['workspace.json', 'providers'], ['subscription-accounts.json', 'accounts']]) {
      const location = path.join(directory, file);
      if (!fs.existsSync(location)) continue;
      for (const record of JSON.parse(fs.readFileSync(location))[key] || []) {
        if (!record.secret) continue;
        const value = safeStorage.decryptString(Buffer.from(record.secret, 'base64'));
        if (key === 'accounts') JSON.parse(value);
        legacyCredentials++;
      }
    }
    let browserCookie;
    if (process.argv.includes('--e1-cookie-write') || process.argv.includes('--e1-cookie-read')) {
      const cookies = session.fromPartition('persist:keychain-check').cookies;
      const url = 'https://e1-keychain-check.invalid', name = 'storage-roundtrip', value = 'synthetic-encrypted-cookie';
      if (process.argv.includes('--e1-cookie-write')) {
        await cookies.set({ url, name, value, expirationDate: Date.now() / 1000 + 3600, secure: true });
        await cookies.flushStore(); browserCookie = 'written';
      } else {
        const existing = await cookies.get({ url, name });
        if (existing.length !== 1 || existing[0].value !== value) throw Error('Browser cookie did not survive the app rebuild.');
        await cookies.remove(url, name); await cookies.flushStore(); browserCookie = 'restored-and-removed';
      }
    }
    console.log(JSON.stringify({ storageBackend: 'stable-keychain-helper', keychainRoundtrip: true, legacyCredentialsReadable: legacyCredentials, browserCookie }));
    app.exit(0);
  }).catch(error => { console.error(error.message); app.exit(1); });
} else {
console.log("ASTER_BOOT", process.pid);
const wantsConnections = argv => argv.includes("--aster-connections") || argv.includes("--show-connections");
app.setName("E1 Code");
app.whenReady().then(() => {
  const icon = path.join(process.resourcesPath, "aster-icon.png");
  if (fs.existsSync(icon)) app.dock?.setIcon(icon);
});
app.on("browser-window-created", (_event, win) => {
  const setTitle = win.setTitle.bind(win);
  win.setTitle = title => setTitle(String(title).replace(/\b(?:Claude|Aster)(?: Code)?\b/g, "E1 Code"));
  win.setTitle(win.getTitle());
  win.on("page-title-updated", (event, title) => {
    if (/\b(?:Claude|Aster)\b/.test(title)) { event.preventDefault(); win.setTitle(title); }
  });
});
// The recovered renderer needs its desktop compatibility token for native features.
if (!/\bClaude\/\d+\.\d+\.\d+/.test(app.userAgentFallback))
  app.userAgentFallback += ` Claude/${app.getVersion()}`;
app.setPath("userData", path.join(app.getPath("appData"), "Aster-Workspace"));
for (const name of ["checkForUpdates", "quitAndInstall", "setFeedURL"])
  autoUpdater[name] = () => {};
// All entry points share one native workspace process, including model settings.
const base = app.getPath("userData");
app.setPath("userData", base + "-3p");
const { forwardToExisting, registerInstance } = require("./instance.cjs");
const forwarded = forwardToExisting(base + "-3p", process.execPath, wantsConnections(process.argv));
const ownsWorkspace = !forwarded && app.requestSingleInstanceLock();
app.setPath("userData", base);
if (!ownsWorkspace) app.exit(0);
else {
  let servicePromise;
  const mainWindow = () => BrowserWindow.getAllWindows().find(win =>
    !win.isDestroyed() && win.webContents.getURL().includes("/main_window/")) ||
    BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
  const newTab = require('./new-tab.cjs').installNewTab(require('electron'), mainWindow);
  const dotTab = require('./dot-tab.cjs').installDotTab(require('electron'), mainWindow, {openConnections:()=>openConnections('accounts')});
  const showMain = () => {
    const win = mainWindow();
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  };
  const getSettingsService = async () => {
      servicePromise ||= (async () => {
        require("./providers.cjs").setTransport((url, options) => require("electron").net.fetch(url, options));
        const dataDir = path.join(app.getPath("appData"), "Aster");
        const service = await require("./server.cjs").startServer({
          dataDir, settingsOnly: true, sharedStore: app.e1Gateway?.store,
          providersChanged: () => app.e1Gateway?.refreshProviders(),
          vault: { encryptString: s => safeStorage.encryptString(s), decryptString: b => safeStorage.decryptString(b) },
          subscriptions: require('./subscriptions.cjs').subscriptionsFor(dataDir, null),
          claudeAccounts: require('./claude-accounts.cjs').claudeAccountsFor(dataDir, { openExternal: url => shell.openExternal(url) }),
          routingChanged: routing => app.e1Gateway?.updateRouting(routing),
          resetRoutingHealth: id => app.e1Gateway?.resetHealth(id),
          abortProvider: id => app.e1Gateway?.disconnectProvider(id),
        });
        fs.writeFileSync(path.join(dataDir, "settings-ui.json"), JSON.stringify({ origin: service.origin, url: service.url, pid: process.pid }), { mode: 0o600 });
        return service;
      })().catch(error => { servicePromise = undefined; throw error; });
    return servicePromise;
  };
  const settingsPages = require("./settings-native.cjs").installSettings(require("electron"), mainWindow, getSettingsService);
  const openConnections = (page='models') => settingsPages.open(page).catch(error => dialog.showErrorBox("Could not open model settings", error.message));
  app.on("second-instance", (_event, argv) => {
    if (wantsConnections(argv)) void openConnections();
    else showMain();
  });
  const unregister = registerInstance(base + "-3p", settings => {
    if (settings) void openConnections(); else showMain();
  }, () => app.isReady() && !!mainWindow());
  app.once("will-quit", unregister);
  const setMenu = Menu.setApplicationMenu.bind(Menu);
  Menu.setApplicationMenu = menu => {
    const appMenu = menu?.items[0]?.submenu;
    if (appMenu && !appMenu.getMenuItemById("aster-connections"))
      appMenu.insert(1, new MenuItem({ id: "aster-connections", label: "Models & connections…", click: ()=>openConnections('models') }));
    if (appMenu && !appMenu.getMenuItemById('e1-dot'))
      appMenu.insert(2, new MenuItem({ id:'e1-dot', label:'Your dot', click:()=>dotTab.open().catch(error=>dialog.showErrorBox('Could not open dot',error.message)) }));
    newTab.menu(menu);
    setMenu(menu);
  };
  app.on("before-quit", () => { servicePromise?.then(service => service.close()).catch(() => {}); });
  app.setAsDefaultProtocolClient = () => false;
  app.removeAsDefaultProtocolClient = () => false;
  require("./recovered.cjs").prepareRecovered(require("electron")).then(() => {
    // Preserve the recovered bootstrap's one-time ready handler if ready fired first.
    const on = app.on;
    app.on = function (event, listener) {
      if (event === "ready" && app.isReady()) {
        Promise.resolve().then(listener).catch(error => console.error("ASTER_RECOVERED_READY_FAILED", error.message));
        return app;
      }
      return on.call(this, event, listener);
    };
    require(path.join(__dirname, "../.vite/build/index.pre.js"));
    if (wantsConnections(process.argv)) void openConnections();
  }).catch(error => {
    console.error("ASTER_RECOVERED_START_FAILED", error.message);
    app.quit();
  });
}

}
