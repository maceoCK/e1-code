const crypto = require('node:crypto');
const path = require('node:path');
const { readJson, atomicJson } = require('./library-identity.cjs');
const R = require('./routing.cjs');

// Only fresh, explicitly applicable limits can exclude a route. Unknown model
// buckets remain informational; treating every bucket as global strands accounts.
function allowance(usage, model, now = Date.now()) {
  if (usage?.state !== 'live' || !Number.isFinite(usage.checkedAt) || now - usage.checkedAt > 120000 || usage.checkedAt > now + 5000)
    return { known: false, blocked: false, reset: Infinity };
  const windows = (usage.windows || []).filter(w => w.scope === 'account' ||
    (w.models || []).includes(model) || w.modelFamily && model.toLowerCase().includes(w.modelFamily));
  const exhausted = windows.filter(w => w.usedPercent >= 100 && Number.isFinite(w.resetsAt) && w.resetsAt > now);
  const weekly = windows.filter(w => w.windowDurationMins === 10080 && Number.isFinite(w.resetsAt) && w.resetsAt > now);
  return { known: windows.some(w => Number.isFinite(w.usedPercent)), blocked: exhausted.length > 0,
    retryAt: exhausted.length ? Math.max(...exhausted.map(w => w.resetsAt)) : undefined,
    reset: weekly.length ? Math.min(...weekly.map(w => w.resetsAt)) : Infinity };
}

class SubscriptionPool {
  constructor(dir, { now = Date.now } = {}) {
    this.now = now; this.file = dir && path.join(dir, 'subscription-affinity.json');
    this.bindings = {};
    try { if (this.file) this.bindings = readJson(this.file, { bindings: {} }).bindings || {}; }
    catch { this.persistenceError = true; }
    this.cursor = new Map();
  }
  key(family, scope = {}, chatId) {
    const session = chatId || scope.parent_session_id || scope.session_id;
    return session ? crypto.createHash('sha256').update(family + ':' + session).digest('hex') : null;
  }
  save() {
    const now = this.now();
    this.bindings = Object.fromEntries(Object.entries(this.bindings)
      .filter(([, b]) => b && b.expiresAt > now).sort((a,b) => b[1].expiresAt - a[1].expiresAt).slice(0, 5000));
    if (this.file) {
      try { atomicJson(this.file, { version: 1, bindings: this.bindings }); this.persistenceError = false; }
      catch { this.persistenceError = true; } // In-memory affinity still works if the disk is full.
    }
  }
  select(routes, { selected, store, policy, usage = {}, scope, chatId }) {
    const now = this.now(), family = R.modelFamily(store.provider(selected.provider));
    const key = policy.sessionAffinity ? this.key(family, scope, chatId) : null;
    const saved = key && this.bindings[key];
    const previous = saved?.expiresAt > now ? saved.provider : null;
    const limits = new Map(routes.map(r => [r.provider, allowance(usage[r.provider], r.model, now)]));
    const eligible = routes.filter(r => !limits.get(r.provider).blocked);
    const plans = eligible.filter(r => R.billingFor(store.provider(r.provider)) === 'subscription');
    const other = eligible.filter(r => !plans.includes(r));
    if (policy.strategy === 'reset-first') plans.sort((a,b) => limits.get(a.provider).reset - limits.get(b.provider).reset);
    if (policy.strategy === 'round-robin' && plans.length) {
      const group = family + ':' + selected.model;
      const start = (this.cursor.get(group) || 0) % plans.length;
      plans.push(...plans.splice(0, start));
      if (!previous || !plans.some(r => r.provider === previous)) this.cursor.set(group, start + 1);
    }
    const ordered = [...plans, ...other];
    // A paid fallback never becomes preferred over a recovered subscription.
    const stickyIndex = ordered.findIndex(r => r.provider === previous &&
      (R.billingFor(store.provider(r.provider)) === 'subscription' || !plans.length));
    if (stickyIndex > 0) ordered.unshift(...ordered.splice(stickyIndex, 1));
    const first = ordered[0];
    if (key && first) {
      // A temporarily unavailable binding remains preferred when it recovers.
      // Quota/auth failures explicitly release it in failed(). Fresh quota data
      // can also release it before attempting a known-exhausted account.
      if (!previous || previous === first.provider || limits.get(previous)?.blocked ||
          !routes.some(r => r.provider === previous) && !store.data.routing?.order?.includes(previous)) {
        this.bindings[key] = { provider: first.provider, expiresAt: now + policy.affinityTtlMs };
        this.save();
      }
    }
    return { routes: ordered, key, reason: stickyIndex >= 0 ? 'session' : policy.strategy,
      blocked: routes.filter(r => limits.get(r.provider).blocked).map(r => ({ provider: r.provider, retryAt: limits.get(r.provider).retryAt })) };
  }
  failed(key, provider, error) {
    if (key && this.bindings[key]?.provider === provider && ['quota', 'authentication'].includes(R.failureKind(error))) {
      delete this.bindings[key]; this.save();
    }
  }
  succeeded(key, provider, policy) {
    if (!key || this.bindings[key] && this.bindings[key].provider !== provider) return;
    this.bindings[key] = { provider, expiresAt: this.now() + policy.affinityTtlMs }; this.save();
  }
  forget(provider) {
    for (const [key, b] of Object.entries(this.bindings)) if (b.provider === provider) delete this.bindings[key];
    this.save();
  }
}
module.exports = { SubscriptionPool, allowance };
