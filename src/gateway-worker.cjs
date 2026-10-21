const { parentPort, workerData } = require("node:worker_threads");
const { startGateway } = require("./gateway.cjs");
const { Store } = require("./store.cjs");
const pendingKeys = new Map();
let keyIndex = 0, gatewayInstance, proxyResolve, proxyReject;
const proxyReady = workerData.waitForProxy ? new Promise((resolve,reject) => {proxyResolve=resolve;proxyReject=reject;}) : Promise.resolve();
const pendingUsage = new Map();
parentPort.on('message', message => {
  if(message.type==='providers'){store.data.providers=message.providers;workerData.credentials=message.credentials;}
  if(message.type==='proxy-ready')proxyResolve?.();
  if(message.type==='proxy-failed')proxyReject?.(Error('Bundled CLIProxyAPI could not start.'));
  if (message.type === 'plan-usage') {
    const p = pendingUsage.get(message.id); if (p) {clearTimeout(p.timer); pendingUsage.delete(message.id); p.resolve(message.value);}
  }
  if (message.type === 'subscription-key') {
    const p = pendingKeys.get(message.id); if (!p) return;
    clearTimeout(p.timer); pendingKeys.delete(message.id);
    message.error ? p.reject(Object.assign(Error(message.error), {code:message.code, status:message.status})) : p.resolve(message.key);
  }
  if (message.type === 'disconnect-provider') gatewayInstance?.disconnectProvider(message.id);
  if (message.type === 'shutdown') { gatewayInstance?.close(); setTimeout(() => process.exit(0), 100); }
  if(message.type==='subscription-providers'){store.data.providers=[...store.data.providers.filter(p=>p.authType!=='chatgpt-subscription'),...message.providers];if(message.reconnected)gatewayInstance?.reconnectProvider(message.reconnected);}
  if(message.type==='claude-providers'){
    const previous=new Set(store.data.providers.filter(p=>p.authType==='claude-code'&&p.signedIn).map(p=>p.id));
    store.data.providers=[...store.data.providers.filter(p=>p.authType!=='claude-code'),...message.providers];store.data.routing=message.routing;
    for(const p of message.providers)if(p.signedIn&&(!previous.has(p.id)||p.id===message.reconnected))gatewayInstance?.reconnectProvider(p.id);
  }
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
  resolveProviderId(id) { return this.data.providers.find(p => p.id === id || p.connectionAliases?.includes(id))?.id || id; },
  provider(id) {
    id = this.resolveProviderId(id);
    const provider = this.data.providers.find((p) => p.id === id);
    if (!provider) throw Error("Provider not found.");
    return provider;
  },
  key(provider,refresh=false) {
    if(provider.proxy){if(provider.proxy.error)throw Error(provider.proxy.error);return workerData.proxyKey;}
    if (provider.authType === 'chatgpt-subscription') return new Promise((resolve, reject) => {
      const id = ++keyIndex;
      const timer = setTimeout(() => { pendingKeys.delete(id); reject(Error('Subscription credential refresh timed out.')); }, 30000);
      pendingKeys.set(id, { resolve, reject, timer });
      parentPort.postMessage({ type: 'subscription-key', id, accountId: provider.accountId, refresh });
    });
    const entry = workerData.credentials[provider.id];
    if (entry?.error) throw Error(entry.error);
    return entry ? entry.key : Store.prototype.sourceKey.call(this, provider);
  },
};
store.planUsage={read:provider=>new Promise(resolve=>{
  const id=++keyIndex; const timer=setTimeout(()=>{pendingUsage.delete(id);resolve({state:'unavailable',windows:[]});},1500);
  pendingUsage.set(id,{resolve,timer}); parentPort.postMessage({type:'plan-usage',id,provider});
})};
store.subscriptions={providers:()=>[],token:(accountId,refresh)=>store.key({authType:'chatgpt-subscription',accountId},refresh)};
proxyReady.then(() => startGateway({
  store,
  listenPort: workerData.port,
  token: workerData.token,
  onRequest: (request) => parentPort.postMessage({ type: "request", request }),
  onStatus: status => parentPort.postMessage({ type: 'status', status }),
})).then((gateway) => {
  gatewayInstance = gateway;
  parentPort.postMessage({ type: "ready", origin: gateway.origin, token: gateway.token });
}).catch((error) => {
  parentPort.postMessage({ type: "failed", message: error.message });
});
