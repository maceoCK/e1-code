const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installStartupHealthRetry } = require("../src/startup-health.cjs");
test("startup timeout retries the real local probe once and preserves other failures", async () => {
  const handlers = new Map(), ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const origin = "http://127.0.0.1:12345";
  installStartupHealthRetry(ipc, origin);
  let result, retried = 0;
  const get = "prefix_$_Custom3pSetup_$_getConfigHealth";
  ipc.handle("prefix_$_Custom3pSetup_$_recheckConfigHealth", async () => {
    retried++; return { state: "healthy" };
  });
  ipc.handle(get, async () => result);
  for (const health of [
    { state: "auth_failed", endpoint: origin, message: "timeout" },
    { state: "unreachable", endpoint: "https://example.com", message: "timeout" },
    { state: "unreachable", endpoint: origin, message: "Connection refused" },
  ]) {
    result = health;
    assert.equal(await handlers.get(get)(), health);
  }
  assert.equal(retried, 0);
  result = { state: "unreachable", endpoint: origin, message: "Gateway timeout" };
  assert.deepEqual(await handlers.get(get)(), { state: "healthy" });
  assert.equal(retried, 1);
  assert.equal(await handlers.get(get)(), result);
  assert.equal(retried, 1);
});
