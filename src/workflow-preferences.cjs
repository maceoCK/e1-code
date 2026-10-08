const path = require('node:path');
const { readJson, atomicJson } = require('./library-identity.cjs');
const { requestScope, NativeSessionIndex } = require('./billing-state.cjs');
const { supportedEfforts } = require('./model-effort.cjs');
const validChat = value => typeof value === 'string' && /^(?:local_)?[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const findRoute = (routes, id) => routes.find(r => r.id === id || r.aliases?.includes(id));
function preferenceFor(data, chatId, modelId) {
  return (chatId && data.chats?.[chatId]) || data.models?.[modelId] || { model: '', effort: '' };
}
class WorkflowPreferences {
  constructor(dir) { this.file = path.join(dir, 'workflow-preferences.json'); }
  read() { return readJson(this.file, { version: 1, chats: {}, models: {} }); }
  save(input, routes) {
    if (!input || typeof input !== 'object') throw Error('Invalid workflow preferences.');
    const parent = findRoute(routes, input.parentModel);
    if (!parent) throw Error('Select an available main model.');
    if (input.chatId != null && !validChat(input.chatId)) throw Error('Invalid chat.');
    const chosen = input.model ? findRoute(routes, input.model) : parent;
    if (!chosen) throw Error('The preferred subagent model is no longer connected.');
    if (input.effort && !supportedEfforts(chosen.model, chosen.meta).includes(input.effort))
      throw Error('Choose an effort supported by the subagent model.');
    const data = this.read(); data.chats ||= {}; data.models ||= {};
    const bucket = input.chatId ? data.chats : data.models, key = input.chatId || parent.id;
    if (input.reset === true) delete bucket[key];
    else bucket[key] = { model: input.model ? chosen.id : '', effort: input.effort || '' };
    atomicJson(this.file, data); return data;
  }
}
function isWorkflowChild(body) {
  return (body.messages || []).some(m => m.role === 'user' &&
    (typeof m.content === 'string' ? m.content : (m.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'))
      .split('\n').some(line => line.startsWith('[Workflow harness — computed task]')));
}
class WorkflowRouter {
  constructor(profile) { this.index = profile ? new NativeSessionIndex(profile) : null; this.parents = new Map(); }
  select(body, requested, routes, preferences = {}) {
    const scope = requestScope(body), child = isWorkflowChild(body);
    const ref = this.index?.resolve(scope);
    const keys = [scope.parent_session_id, scope.session_id].filter(Boolean);
    const parentId = child ? keys.map(k => this.parents.get(k)).find(Boolean) || requested.id : requested.id;
    if (!child) {
      for (const key of keys) this.parents.set(key, requested.id);
      if (this.parents.size > 10000) this.parents.delete(this.parents.keys().next().value);
    }
    const pref = preferenceFor(preferences, ref?.chatId, parentId);
    if (!child) return { route: requested, body, child: false, preference: pref };
    // This is deliberate subagent selection, before exact-model plan failover.
    // A disconnected preference pauses; it must never silently use another model.
    const route = pref.model ? findRoute(routes, pref.model) : findRoute(routes, parentId) || requested;
    if (!route) throw Error('The preferred subagent model is unavailable. Update Subagents in the model picker.');
    return { route, child: true, preference: pref,
      body: pref.effort ? { ...body, output_config: { ...body.output_config, effort: pref.effort } } : body };
  }
}
module.exports = { WorkflowPreferences, WorkflowRouter, preferenceFor, findRoute, isWorkflowChild };
