const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { forwardToExisting } = require("../src/instance.cjs");

test("a repeated launch queues its window request without replacing a busy process", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-instance-"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], { stdio: "ignore" });
  await once(child, "spawn");
  try {
    fs.writeFileSync(path.join(dir, "aster-instance.json"), JSON.stringify({ pid: child.pid }));
    assert.equal(forwardToExisting(dir, "/different/application", true), false);
    assert.equal(forwardToExisting(dir, process.execPath, true), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "aster-window-request.json"))).showConnections, true);
    process.kill(child.pid, 0);
    const exited = once(child, "exit"); child.kill(); await exited;
    assert.equal(forwardToExisting(dir, process.execPath, false), false);
  } finally {
    child.kill(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
