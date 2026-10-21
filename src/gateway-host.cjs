const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { catalog, modelCatalog } = require("./gateway.cjs");

async function startGatewayWorker({ store, onRequest = () => {}, onStatus = () => {} }) {
  if (store.proxy) await store.proxy.prepare();
  const planUsage = store.planUsage ||= new (require('./plan-usage.cjs').PlanUsage)(store);
  const routes = catalog(store);
  const credentials = {};
  const snapshotProviders = () => [...store.data.providers, ...(store.subscriptions?.providers() || []), ...(store.claudeAccounts?.providers() || [])].map((p) => {
    delete credentials[p.id];
    if (!p.authType && !store.proxy?.decorate(p)?.proxy && (p.secret || store.memoryKeys?.has(p.id) || p.keyFile || p.credential)) {
      try {
        credentials[p.id] = { key: store.sourceKey ? store.sourceKey(p) : store.key(p) };
      } catch {
        credentials[p.id] = { error: "Provider credential is unavailable. Update the connection and reopen the workspace." };
      }
    }
    return {
      proxy: store.proxy?.decorate(p)?.proxy || p.proxy, id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl,
      models: p.models, preferredModel: p.preferredModel,
      credential: p.credential, credentialBase: p.credentialBase, keyFile: p.keyFile,
      executable: p.executable, configDir: p.configDir, profileDir: p.profileDir, billing: p.billing, billingMethod: p.billingMethod, authType: p.authType, accountId: p.accountId, signedIn: p.signedIn,
      planType:p.planType, accountEmail:p.accountEmail, connectionMode:p.connectionMode, workspaceAccountId:p.workspaceAccountId, connectionAliases:p.connectionAliases,
    };
  });
  const providers = snapshotProviders();
  // Select an unused loopback port without waiting for the worker to initialize.
  // The recovered bootstrap must run before Electron's ready event.
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const token = crypto.randomBytes(32).toString("hex");
  const worker = new Worker(path.join(__dirname, "gateway-worker.cjs"), {
    workerData: {
      data: { providers, selection: store.data.selection, modelPreferences: store.data.modelPreferences || {}, routing: store.data.routing,
        routingHealth: store.dir ? require('./library-identity.cjs').readJson(path.join(store.dir, 'routing-health.json'), {}) : {} },
      credentials,
      dir: store.dir, nativeProfile: store.nativeProfile,
      port, token, proxyKey:store.proxy?.key, waitForProxy: !!store.proxy,
    },
  });
  const proxyReady = store.proxy ? store.proxy.start().then(() => {worker.postMessage({type:'providers',providers:snapshotProviders(),credentials});worker.postMessage({type:'proxy-ready'});}) : Promise.resolve();
  proxyReady.catch(() => worker.postMessage({type:'proxy-failed'}));
  const previousSubscriptionChange=store.subscriptions?.onChange;
  if(store.subscriptions)store.subscriptions.onChange=change=>{
    previousSubscriptionChange?.(change);
    worker.postMessage({type:'subscription-providers',providers:store.subscriptions.providers(),reconnected:change?.authenticated?'chatgpt-'+change.accountId:undefined});
  };
  let previousConsoleState;
  const previousClaudeChange = store.claudeAccounts?.onChange;
  if (store.claudeAccounts) store.claudeAccounts.onChange = change => {
    previousClaudeChange?.(change); store.save();
    const consoleState=JSON.stringify(store.claudeAccounts.data.accounts.filter(a=>a.method==='console'));
    if(consoleState!==previousConsoleState||change?.authenticated){previousConsoleState=consoleState;void refreshProviders().catch(()=>onStatus({provider:'gateway',failureReason:'configuration',phase:'finished'}));}
    worker.postMessage({type:'claude-providers',providers:store.claudeAccounts.providers().map(p=>store.proxy?.decorate(p)||p),routing:store.data.routing,reconnected:change?.authenticated?'claude-code-'+change.accountId:undefined});
  };
  const refreshProviders = async () => { await proxyReady; await store.proxy?.syncProviders(); worker.postMessage({type:'providers',providers:snapshotProviders(),credentials}); };
  const readyPromise = new Promise((resolve, reject) => {
    let ready = false;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Local provider gateway did not start within 15 seconds."));
    }, store.proxy ? 45000 : 15000);
    worker.on("message", (message) => {
      if (message.type === "request") onRequest(message.request);
      if (message.type === 'status') {
        onStatus(message.status);
        if (message.status.failureReason === 'authentication' && message.status.authType === 'claude-code')
          store.claudeAccounts?.refresh(message.status.accountId).catch(() => {});
      }
      if (message.type === 'plan-usage') {
        planUsage.read(message.provider).then(value => worker.postMessage({type:'plan-usage', id:message.id, value})).catch(() => worker.postMessage({type:'plan-usage', id:message.id, value:{state:'unavailable',windows:[]}}));
      }
      if (message.type === 'subscription-key') {
        Promise.resolve().then(() => store.subscriptions.token(message.accountId,message.refresh===true)).then(
          key => worker.postMessage({ type: 'subscription-key', id: message.id, key }),
          error => worker.postMessage({ type: 'subscription-key', id: message.id, error: error.message, code: error.code, status: error.status }),
        );
      }
      if (message.type === "failed") {
        clearTimeout(timer);
        worker.terminate();
        reject(Error(message.message));
      }
      if (message.type === "ready") {
        clearTimeout(timer);
        ready = true;
        resolve();
      }
    });
    worker.on("error", (error) => {
      clearTimeout(timer);
      if (!ready) reject(error);
      else console.error("ASTER_GATEWAY_WORKER_FAILED", error.name);
    });
    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (!ready) reject(Error(`Local provider gateway exited before startup (${code}).`));
    });
  });
  return { store, refreshProviders, origin: `http://127.0.0.1:${port}`, token, ready: Promise.all([readyPromise, proxyReady]).catch(async error => { await store.proxy?.close(); await worker.terminate(); throw error; }),
    catalog: () => modelCatalog(store), routes: () => catalog(store), close: () => { void store.proxy?.close(); worker.postMessage({ type: 'shutdown' }); return new Promise(resolve => { const timer = setTimeout(() => worker.terminate().then(resolve), 1500); worker.once('exit', code => { clearTimeout(timer); resolve(code); }); }); },
    updateRouting: routing => worker.postMessage({ type: 'routing', routing }),
    resetHealth: id => worker.postMessage({ type: 'reset-health', id }),
    disconnectProvider: id => worker.postMessage({ type: 'disconnect-provider', id }),
    abortProvider: id => worker.postMessage({ type: 'abort-provider', id }),
  };
}
module.exports = { startGatewayWorker };
