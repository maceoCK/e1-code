function policyFor(value = {}) {
  return { enabled: value.enabled === true, allowApiFallback: value.allowApiFallback === true,
    // Legacy per-connection model mappings must never change a selected model.
    order: [...new Set((Array.isArray(value.order) ? value.order : []).filter(x => typeof x === 'string'))] };
}
function modelFamily(provider) {
  if (provider.authType === 'claude-code') return 'anthropic';
  if (provider.authType === 'chatgpt-subscription') return 'openai';
  let host; try { host = new URL(provider.baseUrl).hostname; } catch {}
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.anthropic.com') return 'anthropic';
  // Identical names at unrelated compatible endpoints do not prove identity.
  return provider.baseUrl ? provider.protocol + ':' + provider.baseUrl.replace(/\/$/, '') : provider.id;
}
function billingFor(provider) {
  return provider.authType === 'claude-code' ? (provider.billing || 'account') : provider.authType === 'chatgpt-subscription' ? 'subscription' :
    provider.protocol === 'ollama' || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(provider.baseUrl) ? 'local' : 'api';
}
function billingDetails(provider) {
  const service = provider.authType === 'claude-code' ? 'Claude' : provider.authType === 'chatgpt-subscription' ? 'ChatGPT' : '';
  const tier = typeof provider.planType === 'string' ? provider.planType.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
  return { accountLabel: provider.name, accountEmail: provider.accountEmail || '',
    planName: service ? service + (tier ? ' ' + tier : ' subscription') : '' };
}
function candidateRoutes(selected, routes, store, policy, health, now = Date.now()) {
  let ordered = [selected.pool ? routes.find(r => r.provider === selected.provider && r.model === selected.model) : selected].filter(Boolean);
  const selectedProvider = store.provider(selected.provider);
  if (policy.enabled) for (const id of policy.order) {
    if (id === selected.provider) continue;
    const provider = store.provider(id);
    if (['api', 'account'].includes(billingFor(provider)) && !policy.allowApiFallback) continue;
    if (['chatgpt-subscription', 'claude-code'].includes(provider.authType) && !provider.signedIn) continue;
    if (modelFamily(provider) !== modelFamily(selectedProvider)) continue;
    const route = routes.find(r => r.provider === id && r.model === selected.model);
    if (route) ordered.push(route);
  }
  if (policy.enabled) ordered = ordered.filter(r => policy.allowApiFallback || !['api', 'account'].includes(billingFor(store.provider(r.provider))))
    .sort((a, b) => Number(['api', 'account'].includes(billingFor(store.provider(a.provider)))) - Number(['api', 'account'].includes(billingFor(store.provider(b.provider)))));
  return ordered.filter(r => {
    const h = Object.hasOwn(health, r.provider) ? health[r.provider] : null;
    return !h || (h.retryAt !== null && h.retryAt <= now);
  });
}
function limitFailure({ status, code }) {
  return status === 429 || ['subscription_sharing_usage_limit_exceeded', 'insufficient_quota', 'rate_limit_exceeded'].includes(code);
}
function retryAt(headers, now = Date.now()) {
  const value = headers?.get('retry-after');
  if (value == null) return null;
  const milliseconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? now + milliseconds : null;
}
function quotaError(status, data, headers) {
  const e = Error(`Provider returned HTTP ${status}${typeof data?.error?.code === 'string' ? ' (' + data.error.code + ')' : ''}${typeof data?.error?.param === 'string' ? ' for ' + data.error.param : ''}`);
  e.status = status; e.code = data?.error?.code; e.param = data?.error?.param;
  e.requestId = headers?.get('x-request-id'); e.retryAt = retryAt(headers);
  return e;
}
// Buffer protocol setup until the first content block. Retrying is safe only
// before any model content/tool invocation is delivered to the native engine.
function gatedResponse(res) {
  let pending = [], emitted = false;
  return {
    get destroyed() { return res.destroyed; },
    get emitted() { return emitted; },
    write(chunk) {
      if (!emitted && /event: content_block_(start|delta)/.test(chunk)) {
        emitted = true; for (const value of pending) res.write(value); pending = [];
      }
      if (emitted) return res.write(chunk);
      pending.push(chunk); return true;
    },
    end() { for (const value of pending) res.write(value); pending = []; res.end(); },
  };
}
module.exports = { policyFor, modelFamily, billingFor, billingDetails, candidateRoutes, limitFailure, retryAt, quotaError, gatedResponse };
