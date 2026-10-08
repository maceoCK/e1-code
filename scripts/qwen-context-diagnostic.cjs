const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { Store } = require('../src/store.cjs');
const { startGateway } = require('../src/gateway.cjs');
(async () => {
  const base = path.resolve(__dirname, '..');
  const dir = path.resolve(base, '../work/qwen-context-diagnostic');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sessionPath = process.env.E1_DIAGNOSTIC_SESSION;
  if (!sessionPath) throw Error('Set E1_DIAGNOSTIC_SESSION to a local session JSON file. Keep generated evidence private.');
  const session = JSON.parse(fs.readFileSync(sessionPath));
  const model = process.env.ASTER_DIAGNOSTIC_MODEL || 'qwen3.5:9b';
  const stress = process.env.ASTER_DIAGNOSTIC_STRESS === '1';
  if (stress) session.systemPrompt += '\n<reference_inventory>\n' + Array.from({length:3000}, (_,i) => `Reference item ${i}: stable sample data for context capacity measurement.`).join('\n') + '\n</reference_inventory>';
  const store = new Store(path.join(os.homedir(), 'Library/Application Support/Aster'));
  if (!store.provider('ollama').models.some(entry => entry.id === model)) store.provider('ollama').models.push({id:model,name:model});
  store.data.modelPreferences['ollama:'+model] = store.data.modelPreferences['ollama:qwen3.5:9b'] || {};
  const promptFile = path.join(dir, 'cowork-system.txt');
  fs.writeFileSync(promptFile, session.systemPrompt, { mode: 0o600 });
  const marker = 'ASTER_CONTEXT_' + require('node:crypto').randomBytes(5).toString('hex');
  const fixture = path.join(dir, 'marker.txt');
  fs.writeFileSync(fixture, marker + '\n');
  const calls = [], outbound = [];
  const gateway = await startGateway({ store,
    onRequest: r => calls.push(r),
    transport: async (url, options) => {
      const body = JSON.parse(options.body);
      const index = outbound.length;
      fs.writeFileSync(path.join(dir, `request-${index}.json`), options.body, { mode: 0o600 });
      outbound.push({ promptCharacters: JSON.stringify(body.messages).length, toolCharacters: JSON.stringify(body.tools || []).length, tools: body.tools?.length, maxTokens: body.max_tokens, reasoningEffort: body.reasoning_effort });
      console.log(JSON.stringify({ request: index, ...outbound.at(-1) }));
      return fetch(url, options);
    }
  });
  const route = gateway.catalog().find(r => r.provider === 'ollama' && r.model === model);
  const started = Date.now();
  try {
    const answer = await new Promise((resolve, reject) => {
      const child = cp.execFile(require('./engine-path.cjs')(), ['--bare', '-p', `Read exactly this local test file with the Read tool and reply only with its contents: ${fixture}. Do not change files, use the network, or inspect any other files.`, '--model', route.id, '--system-prompt-file', promptFile, '--tools', 'default', '--allowedTools', 'Read', '--max-turns', '4', '--no-session-persistence', '--output-format', 'json'], {
        cwd: dir, timeout: 180000, maxBuffer: 8e6,
        env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.config'), ANTHROPIC_API_KEY: gateway.token, ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: gateway.origin, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ENABLE_TOOL_SEARCH: 'false', DISABLE_TELEMETRY: '1', CLAUDE_CODE_OAUTH_TOKEN: '' }
      }, (error, stdout, stderr) => error ? reject(Error(`Engine ${error.code}: ${stderr.slice(-1000)}`)) : resolve(JSON.parse(stdout)));
      child.stdin.end();
    });
    const report = { checkedAt: new Date().toISOString(), seconds: (Date.now()-started)/1000, engine: '2.1.286', nativeGui: false, model, stress, scope: 'Captured Cowork system prompt plus default engine tool catalog; read-only random marker test with optional reference data', success: !answer.is_error && answer.result?.includes(marker), isError: answer.is_error, result: answer.result, outbound, calls };
    fs.writeFileSync(path.join(base, stress ? 'evidence/qwen-context-stress.json' : 'evidence/qwen-context-diagnostic.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ success: report.success, seconds: report.seconds, result: report.result, calls }));
  } finally { gateway.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
