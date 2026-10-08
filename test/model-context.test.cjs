const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installModelContext } = require("../src/model-context.cjs");

test("Cowork receives known provider context limits without losing native settings", () => {
  const handlers = new Map(), ipc = { handle: (channel, fn) => handlers.set(channel, fn) };
  installModelContext(ipc, [
    { id: "local", meta: { contextWindow: 131072 } },
    { id: "unknown", meta: {} },
    { id: "bad", meta: { contextWindow: -1 } },
  ]);
  const channel = "prefix_$_ClaudeVM_$_setYukonSilverConfig";
  ipc.handle(channel, (event, config, tail) => ({ event, config, tail }));
  const original = { memoryGB: 8, autoCompactWindow: 200000, contextWindowByModel: { local: 200000, native: 1000000 } };
  const { config, event, tail } = handlers.get(channel)("event", original, "tail");
  assert.equal(event, "event"); assert.equal(tail, "tail");
  assert.deepEqual(config, { ...original, contextWindowByModel: { local: 131072, native: 1000000 } });
  assert.equal(original.contextWindowByModel.local, 200000);
  assert.equal(handlers.get(channel)("event", null).config, null);
  const untouched = () => "unchanged";
  ipc.handle("other", untouched); assert.equal(handlers.get("other"), untouched);
});
