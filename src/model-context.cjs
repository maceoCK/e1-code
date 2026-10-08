// Feed known provider limits into the recovered Cowork engine's own budgeting.
// Unknown models retain the original client's configuration.
function installModelContext(ipc, routes, onApplied = () => {}) {
  const limits = Object.fromEntries(routes
    .filter(route => Number.isSafeInteger(route.meta?.contextWindow) && route.meta.contextWindow > 0)
    .map(route => [route.id, route.meta.contextWindow]));
  if (!Object.keys(limits).length) return;
  const handle = ipc.handle.bind(ipc);
  ipc.handle = (channel, handler) => {
    if (!channel.endsWith("ClaudeVM_$_setYukonSilverConfig")) return handle(channel, handler);
    return handle(channel, (event, config, ...rest) => {
      if (!config || typeof config !== "object" || Array.isArray(config))
        return handler(event, config, ...rest);
      const merged = { ...config, contextWindowByModel: { ...config.contextWindowByModel, ...limits } };
      onApplied(limits);
      return handler(event, merged, ...rest);
    });
  };
}
module.exports = { installModelContext };
