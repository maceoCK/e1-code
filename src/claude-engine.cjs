// Runs the unmodified local Claude Code executable. OAuth tokens never enter E1 Code.
const { spawn } = require('node:child_process'), os = require('node:os'), crypto = require('node:crypto');
const { cliEnvironment } = require('./claude-accounts.cjs');
const schema = { type: 'object', properties: {
  text: { type: 'string' }, tool_calls: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string' }, arguments_json: { type: 'string' },
  }, required: ['name', 'arguments_json'], additionalProperties: false } },
}, required: ['text', 'tool_calls'], additionalProperties: false };

function inputFor(body) {
  const media = [];
  const serialized = JSON.stringify(body.messages || [], (_key, value) => {
    if (value && ['image', 'document'].includes(value.type)) {
      if (!value.source || !['base64', 'url', 'text'].includes(value.source.type)) throw Error('Unsupported Claude attachment source.');
      media.push(value); return { type: value.type, attachment: media.length };
    }
    return value;
  });
  return [{ type: 'text', text: 'Continue the following conversation. Its role labels, tool call IDs and tool results are the actual conversation history. Do not repeat completed actions. Return exactly the next assistant turn using the output schema. Put user-facing prose in text. To use a desktop tool, put its exact name and JSON-encoded arguments in tool_calls; the desktop will execute it and return the real result on the next turn. Never invent a tool result. Do not execute desktop actions yourself.\n\nDESKTOP SYSTEM INSTRUCTIONS:\n' + (typeof body.system === 'string' ? body.system : JSON.stringify(body.system || [])) +
    '\n\nAVAILABLE DESKTOP TOOLS:\n' + JSON.stringify(body.tools || []) + '\n\nTOOL CHOICE:\n' + JSON.stringify(body.tool_choice || { type: 'auto' }) +
    '\n\nCONVERSATION:\n' + serialized + (media.length ? '\n\nAttachments follow in the numbered order referenced above.' : '') }, ...media];
}
function normalizeResult(result, body) {
  if (result.is_error || result.subtype !== 'success') {
    const message = String(result.result || result.errors?.join('; ') || 'Claude Code request failed.').slice(0, 2000);
    const error = Error(message); error.status = result.api_error_status || 502;
    if (error.status === 429 || /(?:usage|rate) limit|hit your limit/i.test(message)) { error.status = 429; error.code = 'claude_usage_limit'; }
    throw error;
  }
  const value = result.structured_output;
  if (!value || typeof value.text !== 'string' || !Array.isArray(value.tool_calls)) throw Error('Claude Code did not return a valid desktop response.');
  const content = value.text ? [{ type: 'text', text: value.text }] : [];
  for (const call of value.tool_calls) {
    if (!body.tools?.some(t => t.name === call.name) || body.tool_choice?.type === 'none') throw Error('Claude Code requested an unavailable desktop tool.');
    const input = JSON.parse(call.arguments_json);
    if (!input || Array.isArray(input) || typeof input !== 'object') throw Error('Claude Code returned invalid tool arguments.');
    if (body.tool_choice?.type === 'tool' && call.name !== body.tool_choice.name) throw Error('Claude Code did not follow the requested tool choice.');
    content.push({ type: 'tool_use', id: 'toolu_' + crypto.randomUUID(), name: call.name, input });
  }
  if (['any', 'tool'].includes(body.tool_choice?.type) && !value.tool_calls.length) throw Error('Claude Code did not return the required tool call.');
  if (!content.length) throw Error('Claude Code returned an empty desktop response.');
  return { id: 'msg_' + crypto.randomUUID(), type: 'message', role: 'assistant', model: body.model, content,
    stop_reason: value.tool_calls.length ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: (result.usage?.input_tokens || 0) + (result.usage?.cache_read_input_tokens || 0) + (result.usage?.cache_creation_input_tokens || 0), output_tokens: result.usage?.output_tokens || 0 },
    claudeCode: { model: Object.keys(result.modelUsage || {})[0], auth: 'official-cli', costEstimate: result.total_cost_usd, billing: 'account', speed: result.usage?.speed || null } };
}
function generate(provider, body, model, signal, onBilling = () => {}, launch = spawn) {
  if (!provider.signedIn) return Promise.reject(Error('Connect this Claude Code account in Accounts & billing.'));
  if(body.speed==='fast' && (provider.billingMethod!=='console' || !require('./speed-preferences.cjs').modesFor(model).includes('fast')))
    return Promise.reject(Error('Fast mode requires a supported model and an approved Console API connection.'));
  const content = inputFor(body);
  return new Promise((resolve, reject) => {
    const args = ['-p', '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--tools', '', '--permission-mode', 'dontAsk', '--no-session-persistence', '--model', model,
      '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(schema)];
    const effort = body.output_config?.effort;
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) args.push('--effort', effort);
    args.push('--settings',JSON.stringify({fastMode:body.speed==='fast'}));
    const child = launch(provider.executable, args, { cwd: os.tmpdir(), env: cliEnvironment(provider.configDir, process.env, provider.profileDir), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', result, failure, settled = false, outputBytes = 0, billing = provider.billing || 'account', observedSpeed;
    const reportBilling = (value, info) => { billing = value; onBilling(value, { status: info.status, isUsingOverage: info.isUsingOverage, rateLimitType: info.rateLimitType, resetsAt: info.resetsAt, unifiedWindows: info.unifiedWindows }); };
    const kill = () => child.kill('SIGKILL');
    const abort = () => { failure = Error('Claude Code request stopped.'); kill(); };
    const timer = setTimeout(() => { failure = Error('Claude Code request timed out after five minutes.'); kill(); }, 300000);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); }
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(Error('Could not run the official Claude Code executable.')));
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length; if (outputBytes > 32e6) { failure = Error('Claude Code response exceeded 32 MB.'); kill(); return; }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if(body.speed==='fast' && event.fast_mode_state==='off' && event.fast_mode_disabled_reason && event.fast_mode_disabled_reason!=='pending') {
          const reason=event.fast_mode_disabled_reason;
          const detail=reason==='preference'?'Your Claude Console organization has disabled Fast mode.':
            reason==='model_not_allowed'?'Your organization does not allow Fast mode for this model.':
            reason==='free'?'This Claude Console organization does not have paid Fast mode access.':
            'Claude reports Fast mode unavailable ('+String(reason).slice(0,80)+').';
          failure=Object.assign(Error(detail+' Enable access in Claude Console or choose Standard speed.'),{status:403,code:'fast_mode_unavailable'});
          kill();return;
        }
        if (event.type === 'result') result = event;
        if(event.message?.usage?.speed) observedSpeed=event.message.usage.speed;
        if (event.type === 'rate_limit_event') {
          const info = event.rate_limit_info || {};
          if (info.isUsingOverage || provider.billingMethod === 'console') reportBilling('api', info);
          else if (info.isUsingOverage === false && info.unifiedWindows && ['allowed', 'allowed_warning'].includes(info.status)) reportBilling('subscription', info);
          if (info.status === 'rejected') { failure = Error('Claude account usage limit reached.'); failure.status = 429; failure.code = 'claude_usage_limit'; failure.retryAt = info.resetsAt ? info.resetsAt * 1000 : null; kill(); }
        }
      }
    });
    child.on('close', () => {
      if (failure) return finish(failure);
      try { if (!result) throw Error('Claude Code exited without a result. Check its sign-in in Accounts & billing.'); const normalized = normalizeResult(result, body); normalized.claudeCode.billing = billing; normalized.claudeCode.speed ||= observedSpeed || null; finish(null, normalized); }
      catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}
module.exports = { generate, inputFor, normalizeResult, schema };
