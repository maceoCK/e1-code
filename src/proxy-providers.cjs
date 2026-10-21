// E1 retains provider identity and policy; CPA owns supported HTTP transports.
const crypto = require('node:crypto');
const prefix = id => 'e1-api-' + crypto.createHash('sha256').update(id).digest('hex').slice(0,24);
// CPA 8.0.30's Codex executor strips ordinary Responses API token limits.
// Keep that protocol direct until upstream supports lossless API-key requests.
const protocolFor = p => p.authType === 'claude-code' && p.billingMethod === 'console' ? 'anthropic' :
  !p.authType && ['chat','anthropic'].includes(p.protocol) ? p.protocol : null;
function modelsFor(p) {
  const rows = [...(p.models || [])];
  if (p.preferredModel && !rows.some(m => m.id === p.preferredModel)) rows.push({id:p.preferredModel});
  return rows.map(m => ({name:m.id,alias:m.id,...(m.contextWindow ? {'max-context-length':m.contextWindow}:{}),
    ...(m.compat?.maxTokensField === 'max_completion_tokens' ? {'use-max-completion-tokens':true}:{}),
    ...(m.reasoningEfforts?.length ? {thinking:{levels:m.reasoningEfforts}}:{}),
    ...(m.inputModalities?.length ? {'input-modalities':m.inputModalities}:{})}));
}
function entryFor(p,key) {
  const protocol = protocolFor(p); if (!protocol) return null;
  const group = protocol === 'chat' ? 'openai-compatibility' : protocol === 'responses' ? 'codex' : 'claude';
  const base = p.authType === 'claude-code' ? 'https://api.anthropic.com/v1' : p.baseUrl;
  const entry = {name:prefix(p.id),prefix:prefix(p.id),'base-url':group==='claude'?base.replace(/\/v1\/?$/,''):base,models:modelsFor(p),'request-retry':0,
    keys:key ? [{'api-key':key,...(group==='claude'?{cloak:{mode:'never'}}:{})}] : []};
  return {group,entry,protocol};
}
module.exports = {prefix,protocolFor,entryFor};
