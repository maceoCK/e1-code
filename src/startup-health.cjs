// The captured client can cache a timed-out probe before its main thread finishes
// startup. Re-run that real probe once when the renderer asks for its health.
function installStartupHealthRetry(ipcMain, origin, onRetry = () => {}) {
  const handle = ipcMain.handle.bind(ipcMain);
  const startedAt = Date.now();
  let recheck, attempted = false;
  ipcMain.handle = (channel, handler) => {
    if (channel.endsWith("_$_Custom3pSetup_$_recheckConfigHealth")) recheck = handler;
    if (!channel.endsWith("_$_Custom3pSetup_$_getConfigHealth"))
      return handle(channel, handler);
    return handle(channel, async (...args) => {
      const health = await handler(...args);
      let endpoint;
      try { endpoint = new URL(health?.endpoint || health?.requestUrl).origin; } catch {}
      if (!attempted && recheck && Date.now() - startedAt < 120000 &&
          endpoint === origin && health?.state === "unreachable" && /timeout/i.test(health.message || "")) {
        attempted = true;
        const result = await recheck(...args);
        onRetry({ checkedAt: new Date().toISOString(), state: result?.state });
        return result;
      }
      return health;
    });
  };
}
module.exports = { installStartupHealthRetry };
