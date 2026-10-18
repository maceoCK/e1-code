// Claude limits from the shipped first-party Code catalog v1462 (2026-10-01).
// Apply these only to official Anthropic connections, never similarly named
// models on third-party endpoints. Explicit connection limits always win.
const claudeContexts = new Map([
  ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1',
    'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-opus-4-8',
    'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'].map(id => [id, 1000000]),
  ['claude-haiku-4-5-20251001', 200000], ['claude-opus-4-1-20250805', 200000],
]);
function positive(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function contextWindow(meta = {}, provider = {}) {
  for (const value of [meta.contextWindow, meta.context_window, meta.context_length,
    meta.max_input_tokens, meta.runtime?.max_input_tokens]) {
    const limit = positive(value);
    if (limit !== undefined) return limit;
  }
  // Arnict advertises numeric per-input limits; take the restrictive one.
  const inputs = (Array.isArray(meta.input_modalities) ? meta.input_modalities : [])
    .map(input => positive(input.supported_inputs?.max_context_length?.value)).filter(Boolean);
  if (inputs.length) return Math.min(...inputs);
  const official = provider.authType === 'claude-code' ||
    (provider.protocol === 'anthropic' && provider.baseUrl === 'https://api.anthropic.com/v1');
  if (official) return claudeContexts.get(String(meta.id || '').replace(/\[1m\]$/i, ''));
}
function metadata(meta, provider) {
  const limit = contextWindow(meta, provider);
  return { ...meta, ...(limit === undefined ? {} : { contextWindow: limit }) };
}
function supports1m(route) { return route.meta?.contextWindow >= 1000000; }
function nativeConfig(route) {
  return supports1m(route) ? { supports1m: true, prefer1m: true } : {};
}
function withContextAliases(route) {
  if (!supports1m(route)) return route;
  const aliases = route.aliases || [];
  return { ...route, aliases: [...new Set([...aliases, ...[route.id, ...aliases]
    .filter(id => !/\[1m\]$/i.test(id)).map(id => id + '[1m]')])] };
}
function canonicalId(id) {
  return typeof id === 'string' ? id.replace(/^(claude-aster-[0-9a-f]{16})\[1m\]$/i, '$1') : id;
}
module.exports = { positive, contextWindow, metadata, supports1m, nativeConfig, withContextAliases, canonicalId };
