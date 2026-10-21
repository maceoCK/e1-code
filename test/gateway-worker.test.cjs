const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const { startGatewayWorker } = require("../src/gateway-host.cjs");
const { Store } = require("../src/store.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

test("worker resolves an endpoint-pinned credential and completes an upstream request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-worker-test-"));
  const keyFile = path.join(dir, "key.json");
  fs.writeFileSync(keyFile, JSON.stringify({ TEST_KEY: "fixture-key" }), { mode: 0o600 });
  let authorization, request; const seen = [];
  const upstream = http.createServer(async (req, res) => {
    authorization = req.headers.authorization; seen.push(authorization);
    let raw = "";
    for await (const part of req) raw += part;
    request = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "WORKER_OK" }, finish_reason: "stop" }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  // Since the 10-18 build the host resolves credentials through the real Store and
  // the worker receives only the resolved key, never the key file or a vault handle.
  const store = new Store(path.join(dir, "workspace"));
  store.data.providers = [{ id: "custom", name: "Custom", protocol: "chat", baseUrl,
    models: [{ id: "private-model" }], keyFile: { path: keyFile, field: "TEST_KEY", baseUrl } },
    { id: "moved", name: "Moved", protocol: "chat", baseUrl: baseUrl + "/moved",
    models: [{ id: "other-model" }], keyFile: { path: keyFile, field: "TEST_KEY", baseUrl } }];
  const gateway = await startGatewayWorker({ store });
  try {
    await gateway.ready;
    const moved = gateway.catalog().find(r => r.provider === "moved");
    await fetch(gateway.origin + "/v1/messages", {
      method: "POST", headers: { Authorization: "Bearer " + gateway.token, "Content-Type": "application/json" },
      body: JSON.stringify({ model: moved.id, max_tokens: 32, messages: [{ role: "user", content: "Hello" }] }),
    }).then(r => r.arrayBuffer());
    assert.deepEqual(seen, [undefined], "the moved endpoint is reached without the pinned key file credential");
    const response = await fetch(gateway.origin + "/v1/messages", {
      method: "POST", headers: { Authorization: "Bearer " + gateway.token, "Content-Type": "application/json" },
      body: JSON.stringify({ model: gateway.catalog().find(r => r.provider === "custom").id, max_tokens: 32, messages: [{ role: "user", content: "Hello" }] }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.content[0].text, "WORKER_OK");
    assert.equal(authorization, "Bearer fixture-key");
    assert.equal(request.model, "private-model");
  } finally {
    await gateway.close();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gateway remains authenticated and responsive while the app thread is busy", { timeout: 15000 }, async () => {
  const gateway = await startGatewayWorker({ store: {
    data: { providers: [{ id: "custom", name: "Custom", protocol: "chat",
      baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "private-model" }] }] },
    key: () => "fixture-key",
  } });
  const state = new Int32Array(new SharedArrayBuffer(8));
  await gateway.ready;
  const probe = new Worker(`
    const {workerData, parentPort}=require('node:worker_threads');
    const state=new Int32Array(workerData.state);
    (async()=>{
      parentPort.postMessage('ready');
      Atomics.wait(state,0,0,5000);
      const denied=await fetch(workerData.origin+'/v1/models');
      const response=await fetch(workerData.origin+'/v1/models',{
        headers:{Authorization:'Bearer '+workerData.token}});
      const data=await response.json();
      Atomics.store(state,1,denied.status===401 && response.status===200 &&
        data.data[0].display_name==='Custom · private-model' ? 1 : -1);
      Atomics.notify(state,1);
    })().catch(()=>{Atomics.store(state,1,-1);Atomics.notify(state,1)});
  `, { eval: true, workerData: { origin: gateway.origin, token: gateway.token, state: state.buffer } });
  try {
    await new Promise((resolve, reject) => { probe.once("message", resolve); probe.once("error", reject); });
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
    // No main-thread event-loop progress until the independent HTTP probe finishes.
    assert.equal(Atomics.wait(state, 1, 0, 5000), "ok");
    assert.equal(Atomics.load(state, 1), 1);
  } finally {
    await probe.terminate();
    await gateway.close();
  }
});
