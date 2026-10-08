const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { catalog, modelCatalog } = require("./gateway.cjs");

async function startGatewayWorker({ store, onRequest = () => {}, onStatus = () => {} }) {
  const routes = catalog(store);
  const activeProviders = new Set(routes.map((route) => route.provider));
  const credentials = {};
  const providers = [...store.data.providers, ...(store.subscriptions?.providers() || []), ...(store.claudeAccounts?.providers() || [])].map((p) => {
    if (activeProviders.has(p.id) && p.secret) {
      try {
        credentials[p.id] = { key: store.key(p) };
      } catch {
        credentials[p.id] = { error: "Provider credential is unavailable. Update the connection and reopen the workspace." };
      }
    }
    return {
      id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl,
      models: p.models, preferredModel: p.preferredModel,
      credential: p.credential, credentialBase: p.credentialBase, keyFile: p.keyFile,
      executable: p.executable, configDir: p.configDir, profileDir: p.profileDir, billing: p.billing, billingMethod: p.billingMethod, authType: p.authType, accountId: p.accountId, signedIn: p.signedIn,
      planType:p.planType, accountEmail:p.accountEmail,
    };
  });
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
      port, token,
    },
  });
  const readyPromise = new Promise((resolve, reject) => {
    let ready = false;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Local provider gateway did not start within 15 seconds."));
    }, 15000);
    worker.on("message", (message) => {
      if (message.type === "request") onRequest(message.request);
      if (message.type === 'status') onStatus(message.status);
      if (message.type === 'subscription-key') {
        Promise.resolve().then(() => store.subscriptions.token(message.accountId)).then(
          key => worker.postMessage({ type: 'subscription-key', id: message.id, key }),
          error => worker.postMessage({ type: 'subscription-key', id: message.id, error: error.message }),
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
  return { origin: `http://127.0.0.1:${port}`, token, ready: readyPromise,
    catalog: () => modelCatalog(store, routes), routes: () => routes, close: () => { worker.postMessage({ type: 'shutdown' }); return new Promise(resolve => { const timer = setTimeout(() => worker.terminate().then(resolve), 1500); worker.once('exit', code => { clearTimeout(timer); resolve(code); }); }); },
    updateRouting: routing => worker.postMessage({ type: 'routing', routing }),
    resetHealth: id => worker.postMessage({ type: 'reset-health', id }),
    disconnectProvider: id => worker.postMessage({ type: 'disconnect-provider', id }),
    abortProvider: id => worker.postMessage({ type: 'abort-provider', id }),
  };
}
module.exports = { startGatewayWorker };
