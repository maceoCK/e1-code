function policyFor(value = {}) {
  return { enabled: value.enabled === true, allowApiFallback: value.allowApiFallback === true,
    strategy: ['fill-first', 'round-robin', 'reset-first'].includes(value.strategy) ? value.strategy : 'reset-first',
    sessionAffinity: value.sessionAffinity !== false,
    requestTimeouts: require('./request-deadline.cjs').timeoutPolicy(value.requestTimeouts),
    affinityTtlMs: Number.isFinite(value.affinityTtlMs) ? Math.max(60000, Math.min(86400000, value.affinityTtlMs)) : 3600000,
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
    let provider; try { provider = store.provider(id); } catch { continue; }
    if (!provider) continue;
    if (['api', 'account'].includes(billingFor(provider)) && !policy.allowApiFallback) continue;
    if (['chatgpt-subscription', 'claude-code'].includes(provider.authType) && !provider.signedIn) continue;
    if (modelFamily(provider) !== modelFamily(selectedProvider)) continue;
    const route = routes.find(r => r.provider === id && r.model === selected.model);
    if (route) ordered.push(route);
  }
  if (policy.enabled) ordered = ordered.filter(r => policy.allowApiFallback || !['api', 'account'].includes(billingFor(store.provider(r.provider))))
    .sort((a, b) => Number(['api', 'account'].includes(billingFor(store.provider(a.provider)))) - Number(['api', 'account'].includes(billingFor(store.provider(b.provider)))));
  return ordered.filter(r => !routeHealth(r, health, now));
}
// Old builds wrote an indefinite pause for 429s without Retry-After. Give those
// entries a bounded retry too, so a restart does not strand a healthy account.
function healthRetryAt(h) { return Number.isFinite(h?.retryAt) ? h.retryAt : Number.isFinite(h?.at) ? h.at + 60000 : 0; }
function routeHealth(route, health = {}, now = Date.now()) {
  return [health[route.provider], health[route.provider + ':' + route.model]]
    .find(h => h && healthRetryAt(h) > now);
}
function limitFailure({ status, code }) {
  return status === 429 || ['subscription_sharing_usage_limit_exceeded', 'usage_limit_reached', 'insufficient_quota', 'rate_limit_exceeded', 'rate_limit_error', 'slow_down'].includes(code);
}
function retryAt(headers, now = Date.now()) {
  const value = headers?.get('retry-after');
  if (value == null) return null;
  const milliseconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? now + milliseconds : null;
}
function quotaError(status, data, headers, now = Date.now()) {
  const e = Error(`Provider returned HTTP ${status}${typeof data?.error?.code === 'string' ? ' (' + data.error.code + ')' : ''}${typeof data?.error?.param === 'string' ? ' for ' + data.error.param : ''}`);
  e.status = status; e.code = data?.error?.code || data?.error?.type; e.param = data?.error?.param;
  const detail = data?.error || data || {};
  e.requestId = headers?.get('x-request-id'); e.retryAt = retryAt(headers, now);
  if (e.retryAt == null) {
    const reset = detail.resets_at ?? detail.reset_at;
    const absolute = typeof reset === 'number' ? (reset < 1e12 ? reset * 1000 : reset) : Date.parse(reset);
    const delay = Number(detail.resets_in_seconds ?? detail.retry_after);
    if (Number.isFinite(absolute) && absolute > now) e.retryAt = absolute;
    else if (Number.isFinite(delay) && delay > 0) e.retryAt = now + delay * 1000;
  }
  return e;
}
function failureKind(error) {
  if (limitFailure(error)) return 'quota';
  if (error.status === 401 || ['sign_in_required','authentication_error','invalid_api_key'].includes(error.code)) return 'authentication';
  if ([408, 500, 502, 503, 504, 529].includes(error.status) || ['server_error','overloaded_error','server_is_overloaded'].includes(error.code) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error.code || error.cause?.code) || error.name === 'TimeoutError') return 'temporary';
  return null;
}
function failureHealth(error, previous, now = Date.now()) {
  const reason = failureKind(error); if (!reason) return null;
  const failures = previous?.reason === reason ? Math.min((previous.failures || 0) + 1, 8) : 1;
  const base = reason === 'temporary' ? 5000 : reason === 'authentication' ? 300000 : 60000;
  const delay = Math.min(base * 2 ** (failures - 1), reason === 'temporary' ? 60000 : 900000);
  return { status: error.status || 502, code: error.code || reason, reason, failures,
    retryAt: Number.isFinite(error.retryAt) && error.retryAt > now ? error.retryAt : now + delay,
    requestId: error.requestId || null, at: now };
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
module.exports = { policyFor, modelFamily, billingFor, billingDetails, candidateRoutes, limitFailure, retryAt, quotaError, gatedResponse,
  healthRetryAt, routeHealth, failureKind, failureHealth };
