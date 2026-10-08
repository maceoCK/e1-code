const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { events } = require('../src/providers.cjs');
(async () => {
  const g = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'Library/Application Support/Aster-Workspace-3p/aster-gateway.json')));
  const route = g.models.find(m => m.provider.startsWith('chatgpt-') && m.model === 'gpt-6.1-sol');
  if (!route) throw Error('No loaded ChatGPT plan route.');
  const logFile = path.join(__dirname, '../evidence/native-subscription-runtime.log');
  const logStart = fs.readFileSync(logFile, 'utf8').length;
  const marker = 'PLAN-CHECK-' + crypto.randomBytes(8).toString('hex');
  const tool = { name: 'get_verification_marker', description: 'Read the verification marker from the local test fixture.', input_schema: { type: 'object', properties: {}, required: [] } };
  async function request(messages, force) {
    const r = await fetch(g.origin + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': g.token },
      body: JSON.stringify({ model: route.alias, stream: true, max_tokens: 256, output_config: { effort: 'low' }, messages, tools: [tool], ...(force ? { tool_choice: { type: 'tool', name: tool.name } } : {}) }), signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw Error('Gateway returned HTTP ' + r.status);
    const content = []; let completed = false;
    for await (const e of events(r.body)) {
      if (e.type === 'error') throw Error(e.error?.message || 'Stream failed');
      if (e.type === 'content_block_start') content[e.index] = { ...e.content_block, _args: '' };
      if (e.type === 'content_block_delta') {
        if (e.delta.type === 'text_delta') content[e.index].text += e.delta.text;
        if (e.delta.type === 'input_json_delta') content[e.index]._args += e.delta.partial_json;
      }
      if (e.type === 'message_stop') completed = true;
    }
    if (!completed) throw Error('Stream did not complete');
    return content.map(({ _args, ...b }) => b.type === 'tool_use' ? { ...b, input: JSON.parse(_args || '{}') } : b);
  }
  const messages = [{ role: 'user', content: 'Call get_verification_marker, then return only its marker text. This is a connection verification; no other actions are needed.' }];
  const first = await request(messages, true), call = first.find(b => b.type === 'tool_use' && b.name === tool.name);
  if (!call) throw Error('The plan model did not call the verification tool');
  messages.push({ role: 'assistant', content: first }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: marker }] });
  const second = await request(messages, false), text = second.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (text !== marker) throw Error('The plan model did not preserve the tool result');
  const requests = fs.readFileSync(logFile, 'utf8').slice(logStart).split('\n').filter(l => l.startsWith('ASTER_GATEWAY_REQUEST ')).map(l => JSON.parse(l.slice('ASTER_GATEWAY_REQUEST '.length))).filter(r => r.tools === 1);
  const plan = requests.length === 2 && requests.every(r => r.provider === route.provider && r.billing === 'subscription' && !r.fallback);
  const health = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'Library/Application Support/Aster/routing-health.json')));
  const fallback = requests.length === 2 && requests.every(r => r.provider === 'openai' && r.billing === 'api' && r.fallback) && health[route.provider]?.code === 'subscription_sharing_usage_limit_exceeded';
  if (!plan && !(process.env.VERIFY_API_FALLBACK === '1' && fallback)) throw Error('The test did not stay on ChatGPT plan billing.');
  const result = { checkedAt: new Date().toISOString(), status: plan ? 'plan-inference-passed' : 'api-fallback-passed-plan-limited', model: route.model, route: route.provider, label: route.label, toolCalled: true, fullHistoryPreserved: true, exactMarkerReturned: true, completedStreams: 2, actualBilling: plan ? 'subscription' : 'api', fallbackUsed: fallback, planInference: plan ? 'verified' : 'blocked by plan-sharing usage limit', resetTime: health[route.provider]?.retryAt ?? null };
  fs.writeFileSync(path.join(__dirname, '../evidence/subscription-live.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
