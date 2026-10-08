const { parentPort, workerData } = require("node:worker_threads");
const { startGateway } = require("./gateway.cjs");
const { Store } = require("./store.cjs");
const pendingKeys = new Map();
let keyIndex = 0, gatewayInstance;
parentPort.on('message', message => {
  if (message.type === 'subscription-key') {
    const p = pendingKeys.get(message.id); if (!p) return;
    clearTimeout(p.timer); pendingKeys.delete(message.id);
    message.error ? p.reject(Error(message.error)) : p.resolve(message.key);
  }
  if (message.type === 'disconnect-provider') gatewayInstance?.disconnectProvider(message.id);
  if (message.type === 'shutdown') { gatewayInstance?.close(); setTimeout(() => process.exit(0), 100); }
  if (message.type === 'routing') store.data.routing = message.routing;
  if (message.type === 'reset-health') gatewayInstance?.resetHealth(message.id);
  if (message.type === 'abort-provider') gatewayInstance?.abortProvider(message.id);
});
// Allow slow initial connections to complete before abandoning an address.
// The default 250 ms attempt budget timed out against a configured provider on
// this Mac; the request-level timeout and TLS verification remain unchanged.
require("node:net").setDefaultAutoSelectFamilyAttemptTimeout(3000);

// Credentials stay in process memory and never cross into renderer content.
const store = {
  dir: workerData.dir, nativeProfile: workerData.nativeProfile,
  data: workerData.data,
  memoryKeys: new Map(),
  provider(id) {
    const provider = this.data.providers.find((p) => p.id === id);
    if (!provider) throw Error("Provider not found.");
    return provider;
  },
  key(provider) {
    if (provider.authType === 'chatgpt-subscription') return new Promise((resolve, reject) => {
      const id = ++keyIndex;
      const timer = setTimeout(() => { pendingKeys.delete(id); reject(Error('Subscription credential refresh timed out.')); }, 30000);
      pendingKeys.set(id, { resolve, reject, timer });
      parentPort.postMessage({ type: 'subscription-key', id, accountId: provider.accountId });
    });
    const entry = workerData.credentials[provider.id];
    if (entry?.error) throw Error(entry.error);
    return entry ? entry.key : Store.prototype.key.call(this, provider);
  },
};
startGateway({
  store,
  listenPort: workerData.port,
  token: workerData.token,
  onRequest: (request) => parentPort.postMessage({ type: "request", request }),
  onStatus: status => parentPort.postMessage({ type: 'status', status }),
}).then((gateway) => {
  gatewayInstance = gateway;
  parentPort.postMessage({ type: "ready", origin: gateway.origin, token: gateway.token });
}).catch((error) => {
  parentPort.postMessage({ type: "failed", message: error.message });
});
