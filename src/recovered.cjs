const fs = require("node:fs");
const path = require("node:path");
const { Store } = require("./store.cjs");
const { startGatewayWorker } = require("./gateway-host.cjs");
async function prepareRecovered({ app, safeStorage }) {
  // The original bootstrap reads third-party configuration from its -3p profile,
  // then moves userData there. Use that supported path, not a test-only override.
  const dir = app.getPath("userData") + "-3p";
  const lifecycle = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ready: false,
    loaded: [],
    failures: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(dir, "aster-lifecycle.json"),
      JSON.stringify(lifecycle, null, 2),
      { mode: 0o600 },
    );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const libraryIdentity = require('./library-identity.cjs').ensureLibraryIdentity(
    path.join(app.getPath('appData'), 'Aster'), dir,
  );
  // The recovered client requires both a gateway config and an explicit local
  // deployment choice. Without the choice it returns an anonymous bootstrap.
  const preferencesPath = path.join(dir, "claude_desktop_config.json");
  const preferences = fs.existsSync(preferencesPath)
    ? JSON.parse(fs.readFileSync(preferencesPath, "utf8"))
    : {};
  if (preferences.deploymentMode !== "3p") {
    fs.writeFileSync(preferencesPath,
      JSON.stringify({ ...preferences, deploymentMode: "3p" }, null, 2),
      { mode: 0o600 });
  }
  app.whenReady().then(() => {
    lifecycle.ready = true;
    record();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-finish-load", () => {
      const url = new URL(contents.getURL());
      lifecycle.loaded.push({
        kind: contents.getType(),
        url: url.protocol + "//" + url.host + url.pathname,
      });
      record();
      if (process.argv.includes("--aster-diagnostics") && url.origin === "null" && url.protocol === "app:") {
        // Local development evidence only. Never persist credential or full bootstrap values.
        contents.executeJavaScript(`(async () => {
          const response = await fetch('/api/bootstrap');
          const data = await response.json();
          return { status: response.status, accountPresent: !!data.account,
            accessFeatures: data.current_user_access?.features,
            modelConfigPresent: !!data.model_selector_config,
            bootstrapKeys: Object.keys(data),
            document: { title: document.title, readyState: document.readyState,
              userAgent: navigator.userAgent, nativeBridge: !!window.process?.versions?.electron,
              visibleText: document.body.innerText.slice(0, 1200) } };
        })()`).then((result) => {
          fs.writeFileSync(path.join(dir, "aster-renderer-diagnostics.json"),
            JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
        }).catch((error) => {
          fs.writeFileSync(path.join(dir, "aster-renderer-diagnostics.json"),
            JSON.stringify({ failed: error.name }, null, 2), { mode: 0o600 });
        });
      }
    });
    contents.on("did-fail-load", (_event, code, message) => {
      lifecycle.failures.push({ code, message });
      record();
    });
  });
  // The gateway implements ordinary function calls, not Anthropic tool search.
  process.env.ENABLE_TOOL_SEARCH = "false";
  const vault = {
    encryptString: (s) => safeStorage.encryptString(s),
    decryptString: (b) => safeStorage.decryptString(b),
  };
  const store = new Store(path.join(app.getPath("appData"), "Aster"), vault);
  store.nativeProfile = dir;
  store.subscriptions = require('./subscriptions.cjs').subscriptionsFor(store.dir, vault, {
    openExternal: url => require('electron').shell.openExternal(url),
  });
  store.claudeAccounts = require('./claude-accounts.cjs').claudeAccountsFor(store.dir, { openExternal: url => require('electron').shell.openExternal(url) });
  const billing = new (require('./billing-state.cjs').BillingState)({ profile: dir, file: path.join(store.dir, 'billing-chats.json') });
  const routing = require('./routing.cjs');
  const billingSnapshot = () => {
    const routes = gateway.catalog(), health = require('./library-identity.cjs').readJson(path.join(store.dir, 'routing-health.json'), {});
    const policy = routing.policyFor(require('./library-identity.cjs').readJson(path.join(store.dir, 'workspace.json'), store.data).routing);
    const chats = billing.snapshot().map(status => {
      try { return { ...routing.billingDetails(store.provider(status.provider)), ...status }; }
      catch { return status; }
    });
    const Speed=require('./speed-preferences.cjs'), speedPreferences=new Speed.SpeedPreferences(store.dir).read();
    return { version: 2, chats, speedPreferences, catalog: routes.map(selected => {
      const route = routing.candidateRoutes(selected, gateway.routes(), store, policy, health)[0];
      const provider = route && store.provider(route.provider);
      const speedRoutes=Speed.apiRoutes(selected,gateway.routes(),store).map(r=>{
        const p=store.provider(r.provider);
        return {billing:'api',provider:p.id,label:p.name,model:r.model,...routing.billingDetails(p)};
      });
      return { id: selected.id, aliases: selected.aliases, name: selected.display_name, speedRoutes, prediction: provider ? {
        billing: routing.billingFor(provider), provider: provider.id, label: provider.name, model: route.model,
        ...routing.billingDetails(provider),
        fallback: route.provider !== selected.provider,
      } : { billing: 'paused', label: 'Connections paused', paused: true } };
    }) };
  };
  const publishBilling = (contents, snapshot) => {
    if (contents.getURL().startsWith('app://localhost/')) contents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('e1-billing-status',{detail:${JSON.stringify(snapshot)}}));`
    ).catch(() => {});
  };
  app.on('web-contents-created', (_event, contents) => contents.on('did-finish-load', () => {
    publishBilling(contents, billingSnapshot());
  }));
  const gateway = await startGatewayWorker({
    store,
    onRequest: (r) => console.log("ASTER_GATEWAY_REQUEST", JSON.stringify(r)),
    onStatus: status => {
      if (status.authType === 'claude-code' && status.allowance) { try { store.claudeAccounts.recordBilling(status.accountId, status.billing, status.allowance); } catch {} }
      if (status.health) require('./library-identity.cjs').atomicJson(path.join(store.dir, 'routing-health.json'), status.health);
      if (!status.billing) return;
      const scoped = billing.update(status);
      require('./library-identity.cjs').atomicJson(path.join(store.dir, 'routing-status.json'), scoped || status);
      const snapshot = billingSnapshot();
      for (const contents of require('electron').webContents.getAllWebContents()) publishBilling(contents, snapshot);
    },
  });
  app.e1Gateway = gateway;
  require('./workflow-bridge.cjs').installWorkflowBridge(app, store.dir, gateway, store);
  // Refresh predictions after changing routing settings, even while no chat runs.
  let previousBilling = '';
  const billingTimer = setInterval(() => {
    const snapshot = billingSnapshot(), encoded = JSON.stringify(snapshot);
    if (encoded === previousBilling) return;
    previousBilling = encoded;
    for (const contents of require('electron').webContents.getAllWebContents()) publishBilling(contents, snapshot);
  }, 2000);
  billingTimer.unref();
  app.once('will-quit', () => clearInterval(billingTimer));
  gateway.ready.then(() => {
    lifecycle.gatewayReady = true;
    record();
  }).catch((error) => {
    lifecycle.failures.push({ code: "GATEWAY_START_FAILED", message: error.message });
    record();
    console.error("ASTER_GATEWAY_START_FAILED", error.message);
    app.quit();
  });
  app.on("web-contents-created", (_event, contents) => {
    // The captured EIPC layer registers handlers on WebContents.ipc.
    require("./model-context.cjs").installModelContext(contents.ipc, [...gateway.catalog(), ...gateway.routes()], (limits) => {
      lifecycle.modelContextLimits = limits;
      record();
    });
    require("./startup-health.cjs").installStartupHealthRetry(contents.ipc, gateway.origin, (result) => {
      lifecycle.startupHealthRetry = result;
      record();
    });
  });
  const selection = store.data.selection;
  const routes = gateway
    .catalog()
    .sort(
      (a, b) =>
        Number(
          b.provider === selection?.provider && (b.model === selection?.model || b.meta?.aliases?.includes(selection?.model)),
        ) -
        Number(
          a.provider === selection?.provider && (a.model === selection?.model || a.meta?.aliases?.includes(selection?.model)),
        ),
    );
  const id = "a57e0000-0000-4000-8000-000000000001";
  lifecycle.modelSelectionsMigrated = require('./model-selection.cjs').migrateSelections(dir, routes);
  const compatibleRoutes = [...routes, ...gateway.routes()];
  require("./model-effort.cjs").registerNativeRoutes(compatibleRoutes);
  process.env.CLAUDE_CODE_MODEL_CAPABILITIES = require("./model-effort.cjs").nativeEngineCapabilities(
    compatibleRoutes, process.env.CLAUDE_CODE_MODEL_CAPABILITIES,
  );
  const configDir = path.join(dir, "configLibrary");
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const config = {
    deploymentDisplayName: "E1 Code",
    deploymentOrganizationUuid: libraryIdentity.organizationUuid,
    inferenceProvider: "gateway",
    inferenceCredentialKind: "static",
    inferenceGatewayBaseUrl: gateway.origin,
    inferenceGatewayAuthScheme: "bearer",
    inferenceGatewayApiKey: gateway.token,
    inferenceModels: routes.map((r, i) => ({
      name: r.id,
      labelOverride: r.display_name,
      ...(i === 0
        ? { anthropicFamilyTier: "sonnet", isFamilyDefault: true }
        : {}),
      maxEffort: require("./model-effort.cjs").nativeMaxEffort(r.model, r.meta),
    })),
    modelCatalogEnabled: false,
    chatTabEnabled: true,
    chatAdvancedFileAnalysisEnabled: true,
    isDesktopExtensionEnabled: true,
    // Supported third-party deployment setting. The recovered browser retains
    // its site permission prompts, managed policy checks, and safety checks.
    builtinBrowserEnabled: true,
    disableAutoUpdates: true,
    // This controls hosted artifact frames and interactive MCP widgets as well
    // as icons; blocking it removes user-facing workflows.
    disableNonessentialServices: false,
  };
  for (const [name, data] of [
    [id + ".json", config],
    [
      "_meta.json",
      { appliedId: id, entries: [{ id, name: "E1 Code local model gateway" }] },
    ],
  ])
    fs.writeFileSync(
      path.join(configDir, name),
      JSON.stringify(data, null, 2),
      { mode: 0o600 },
    );
  fs.writeFileSync(
    path.join(dir, "aster-gateway.json"),
    JSON.stringify({
      origin: gateway.origin,
      token: gateway.token,
      pid: process.pid,
      models: routes.map((r) => ({
        alias: r.id,
        provider: r.provider,
        model: r.model,
        label: r.display_name,
      })),
    }),
    { mode: 0o600 },
  );
  app.on("before-quit", () => gateway.close());
  console.log(
    "ASTER_GATEWAY_READY",
    JSON.stringify({ pid: process.pid, models: routes.length }),
  );
  return gateway;
}
module.exports = { prepareRecovered };
