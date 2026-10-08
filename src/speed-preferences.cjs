const path = require('node:path');
const { readJson, atomicJson } = require('./library-identity.cjs');
const R = require('./routing.cjs');
const { findRoute } = require('./workflow-preferences.cjs');
const { requestScope, NativeSessionIndex } = require('./billing-state.cjs');
const validChat = value => typeof value === 'string' && /^(?:local_)?[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

// Only advertise combinations documented by the providers. Never infer a new
// model's speed support from a user-created display name.
function modesFor(model) {
  if (/^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['standard','fast','ultrafast'];
  if (/^gpt-(?:6(?:\.1)?-sol|6-luna|5\.6-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ||
      /^claude-opus-(?:5-5|5|4-8)(?:-\d{8})?$/.test(model)) return ['standard','fast'];
  return ['standard'];
}
function apiRoutes(selected, routes, store) {
  const family = R.modelFamily(store.provider(selected.provider));
  const order = R.policyFor(store.data.routing).order;
  return routes.filter(route => {
    const p = store.provider(route.provider);
    if (route.model !== selected.model || R.modelFamily(p) !== family || R.billingFor(p) !== 'api') return false;
    if (p.authType === 'claude-code') return p.signedIn && p.billingMethod === 'console';
    if (p.authType) return false;
    return (p.protocol === 'anthropic' && /^https:\/\/api\.anthropic\.com(?:\/|$)/.test(p.baseUrl)) ||
      (p.protocol === 'responses' && /^https:\/\/api\.openai\.com(?:\/|$)/.test(p.baseUrl));
  }).sort((a,b) => (a.provider===selected.provider?-1:order.indexOf(a.provider)<0?10000:order.indexOf(a.provider)) -
    (b.provider===selected.provider?-1:order.indexOf(b.provider)<0?10000:order.indexOf(b.provider)));
}
function preferenceFor(data, chatId, modelId) {
  return (chatId && data.chats?.[chatId]?.[modelId]) || data.models?.[modelId] || {mode:'standard'};
}
class SpeedPreferences {
  constructor(dir) { this.file=path.join(dir,'speed-preferences.json'); }
  read() { return readJson(this.file,{version:1,chats:{},models:{}}); }
  save(input, models, routes, store) {
    const model=findRoute(models,input?.parentModel);
    if(!model) throw Error('Choose an available model.');
    if(input.chatId!=null && !validChat(input.chatId)) throw Error('Invalid chat.');
    if(!modesFor(model.model).includes(input.mode)) throw Error('This model does not support that speed mode.');
    const value={mode:input.mode};
    if(input.mode!=='standard') {
      if(input.confirmPaid!==true) throw Error('Confirm paid API billing before enabling this speed.');
      const api=apiRoutes(model,routes,store).find(r=>r.provider===input.apiProvider);
      if(!api) throw Error('Configure an eligible API connection for this exact model first.');
      const provider=store.provider(api.provider);
      if(provider.authType!=='claude-code' && store.key && !store.key(provider)) throw Error('Add an API key to this connection first.');
      value.apiProvider=api.provider; value.confirmPaid=true;
    }
    const data=this.read();data.chats||={};data.models||={};
    const bucket=input.chatId?(data.chats[input.chatId]||={}):data.models;
    bucket[model.id]=value; atomicJson(this.file,data); return data;
  }
}
const healthKey=(provider,model,mode)=>mode==='standard'?provider:`${provider}:${model}:${mode}`;
function paidRoute(selected, pref, routes, store, health={}) {
  if(!pref || pref.mode==='standard') return null;
  if(pref.confirmPaid!==true || !modesFor(selected.model).includes(pref.mode)) throw Error('Review and confirm the paid speed setting for this model.');
  const route=apiRoutes(selected,routes,store).find(r=>r.provider===pref.apiProvider);
  if(!route) throw Error('The API connection approved for this speed is unavailable. Choose another in Speed settings.');
  for(const key of [route.provider,healthKey(route.provider,route.model,pref.mode)]) {
    const h=health[key];if(h&&(h.retryAt===null||h.retryAt>Date.now())) throw Error('The approved API connection is paused at its usage limit. Turn off Fast or review Speed settings.');
  }
  return route;
}
class SpeedRouter {
  constructor(profile) {this.index=profile?new NativeSessionIndex(profile):null;}
  select(body, selected, preferences, routes, store, health) {
    const ref=this.index?.resolve(requestScope(body));
    const pref=preferenceFor(preferences,ref?.chatId,selected.id);
    return {mode:pref.mode,route:paidRoute(selected,pref,routes,store,health)};
  }
}
function applySpeed(outbound, provider, mode='standard') {
  // The native toggle cannot authorize paid routing by itself. The scoped,
  // confirmed preference is the only source for these billing-sensitive fields.
  delete outbound.body.speed; delete outbound.body.service_tier;
  if(mode==='standard') {
    if(!provider.authType && provider.protocol==='responses' && /^https:\/\/api\.openai\.com(?:\/|$)/.test(provider.baseUrl)) outbound.body.service_tier='default';
  } else if(provider.protocol==='responses') outbound.body.service_tier=mode;
  else outbound.body.speed='fast';
  return outbound;
}
function actualSpeed(result) {
  const value=result.service_tier || result.usage?.speed || result.claudeCode?.speed;
  return value==='priority'?'fast':value==='default'?'standard':value || null;
}
module.exports={modesFor,apiRoutes,preferenceFor,SpeedPreferences,SpeedRouter,paidRoute,applySpeed,actualSpeed,healthKey};
