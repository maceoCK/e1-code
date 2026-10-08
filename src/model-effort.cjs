// Verified model capabilities; explicit provider metadata overrides the defaults.
// References: developers.openai.com/api/docs/models/{gpt-5.4-mini,gpt-5.2,gpt-5.6-sol,gpt-6-astra,gpt-6.1-sol}
const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
function supportedEfforts(model, meta = {}) {
  if (meta.compat?.supportsReasoningEffort === false) return [];
  if (Array.isArray(meta.reasoningEfforts))
    return levels.filter(level => meta.reasoningEfforts.includes(level));
  const base = model.startsWith("ft:") ? model.split(":")[1] : model;
  if (/^gpt-(6-astra|6\.1-sol)(?:-|$)/.test(base)) return levels.slice(2);
  if (/^gpt-5\.6-sol(?:-|$)/.test(base)) return levels.filter(x => x !== "minimal");
  if (/^gpt-5\.(2|4)(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(base))
    return ["none", "low", "medium", "high", "xhigh"];
  if (/^gpt-5\.4-pro(?:-|$)/.test(base)) return ["medium", "high", "xhigh"];
  if (/^gpt-5(?:\.|-|$)|^o[134](?:-|$)/.test(base) || meta.reasoning || meta.compat?.supportsReasoningEffort)
    return ["low", "medium", "high"];
  return [];
}
function normalizeEffort(model, meta, requested) {
  const supported = supportedEfforts(model, meta);
  if (!supported.length) return undefined;
  const value = requested && requested !== "default" ? requested : "low";
  if (!levels.includes(value)) throw Error(`Unsupported reasoning effort: ${value}`);
  return supported.filter(x => levels.indexOf(x) <= levels.indexOf(value)).at(-1) || supported[0];
}
function nativeMaxEffort(model, meta) {
  // xhigh is also the native engine's local workflow control. The gateway
  // translates it to a supported upstream effort (or omits it entirely).
  return supportedEfforts(model, meta).includes('max') ? 'max' : 'xhigh';
}
function nativeEngineCapabilities(routes, existing = "") {
  const entries = routes.map(route => {
    const supported = supportedEfforts(route.model, route.meta);
    return `${route.id}=${[
      "effort",
      "xhigh_effort",
      supported.includes("max") ? "max_effort" : "-max_effort",
    ].join(",")}`;
  });
  // The captured engine resolves these entries in order. Retain explicit
  // operator overrides last so a pre-existing restriction remains effective.
  return [...entries, existing].filter(Boolean).join(";");
}
let nativeRoutes = new Map();
function registerNativeRoutes(routes) {
  nativeRoutes = new Map(routes.map(route => [route.id, route]));
}
function nativeThinking(alias) {
  const route = nativeRoutes.get(alias);
  if (!route) return undefined;
  const supported = supportedEfforts(route.model, route.meta).filter(e => !["none", "minimal"].includes(e));
  const names = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max" };
  const options = supported.length ? supported.map((id, i) => ({ id, name: names[id], ...(i === 0 ? { recommended: true } : {}) }))
    : [{ id: 'low', name: 'Default', recommended: true, description: 'Uses the provider’s default reasoning settings.' }];
  // This intermediate entry passes through the native policy cap. It is
  // removed from the visible picker when the upstream has no xhigh setting.
  if (!supported.includes('xhigh')) options.push({ id: 'xhigh', name: 'Extra' });
  return {
    description: "Higher effort allows more reasoning and can take longer.",
    effort_options: options,
  };
}
function withUltracode(surface, alias, thinking) {
  const route = nativeRoutes.get(alias);
  if (!route || !thinking?.effort_options) return thinking;
  const supported = supportedEfforts(route.model, route.meta);
  const options = thinking.effort_options.filter(option => option.id !== 'xhigh' || supported.includes('xhigh'));
  if (!["code", "ccd", "ccr"].includes(surface) || !thinking.effort_options.some(option => option.id === 'xhigh'))
    return options.length === thinking.effort_options.length ? thinking : { ...thinking, effort_options: options };
  // Apply after the native effort cap. The renderer separately checks workflow
  // policy/transport availability and handles this as a session flag, not effort.
  return { ...thinking, effort_options: [...options, {
    id: "ultracode", name: "Ultracode",
    description: "Dynamic workflows for this session, using the provider’s supported reasoning settings.",
  }] };
}
module.exports = { supportedEfforts, normalizeEffort, nativeMaxEffort, nativeEngineCapabilities, registerNativeRoutes, nativeThinking, withUltracode };
