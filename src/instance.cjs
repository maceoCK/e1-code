const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

// Chromium's singleton handshake can time out while macOS blocks the first
// process on Keychain. Queue the window request without replacing that process.
function forwardToExisting(dir, executable, showConnections) {
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(dir, "aster-instance.json")));
    if (!Number.isInteger(pid) || pid === process.pid) return false;
    const command = cp.execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (command !== executable && !command.startsWith(executable + " ")) return false;
    const target = path.join(dir, "aster-window-request.json"), temporary = target + "." + process.pid;
    fs.writeFileSync(temporary, JSON.stringify({ showConnections, at: Date.now() }), { mode: 0o600 });
    fs.renameSync(temporary, target);
    return true;
  } catch { return false; }
}

function registerInstance(dir, onRequest, isReady) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const instance = path.join(dir, "aster-instance.json"), request = path.join(dir, "aster-window-request.json");
  fs.writeFileSync(instance, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  const timer = setInterval(() => {
    if (!isReady() || !fs.existsSync(request)) return;
    try {
      const message = JSON.parse(fs.readFileSync(request));
      fs.unlinkSync(request);
      if (Date.now() - message.at < 300000) onRequest(message.showConnections === true);
    } catch {}
  }, 400);
  timer.unref();
  return () => {
    clearInterval(timer);
    try { if (JSON.parse(fs.readFileSync(instance)).pid === process.pid) fs.unlinkSync(instance); } catch {}
  };
}
module.exports = { forwardToExisting, registerInstance };
