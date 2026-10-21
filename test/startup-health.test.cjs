const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installStartupHealthRetry } = require("../src/startup-health.cjs");
// Since the CLIProxyAPI migration, an initial local "unreachable" (timeout or connection
// refusal) waits for the helper and gateway to be ready, then re-runs the real probe once.
test("startup timeout retries the real local probe once and preserves other failures", async () => {
  const handlers = new Map(), ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const origin = "http://127.0.0.1:12345", retries = [];
  let release; const ready = new Promise(resolve => release = resolve);
  installStartupHealthRetry(ipc, origin, info => retries.push(info), ready);
  let result, retried = 0;
  const get = "prefix_$_Custom3pSetup_$_getConfigHealth";
  ipc.handle("prefix_$_Custom3pSetup_$_recheckConfigHealth", async () => {
    retried++; return { state: "healthy" };
  });
  ipc.handle(get, async () => result);
  for (const health of [
    { state: "auth_failed", endpoint: origin, message: "timeout" },
    { state: "unreachable", endpoint: "https://example.com", message: "timeout" },
    { state: "unreachable", endpoint: "not a url", message: "Connection refused" },
  ]) {
    result = health;
    assert.equal(await handlers.get(get)(), health);
  }
  assert.equal(retried, 0);
  result = { state: "unreachable", endpoint: origin, message: "Connection refused" };
  const pending = handlers.get(get)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retried, 0, "the recheck waits for local services to be ready");
  release();
  assert.deepEqual(await pending, { state: "healthy" });
  assert.equal(retried, 1);
  assert.equal(retries.length, 1); assert.equal(retries[0].state, "healthy");
  result = { state: "unreachable", endpoint: origin, message: "Gateway timeout" };
  assert.equal(await handlers.get(get)(), result);
  assert.equal(retried, 1);
  // A timed-out probe reported through requestUrl is retried too (once per launch).
  const again = new Map(), ipc2 = { handle: (name, fn) => again.set(name, fn) };
  installStartupHealthRetry(ipc2, origin);
  let rechecked = 0;
  ipc2.handle("prefix_$_Custom3pSetup_$_recheckConfigHealth", async () => { rechecked++; return { state: "healthy" }; });
  ipc2.handle(get, async () => ({ state: "unreachable", requestUrl: origin + "/v1/models", message: "Gateway timeout" }));
  assert.deepEqual(await again.get(get)(), { state: "healthy" });
  assert.equal(rechecked, 1);
});
