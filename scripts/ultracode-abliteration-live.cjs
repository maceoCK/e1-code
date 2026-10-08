const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process'), assert = require('node:assert/strict');
const { Store } = require('../src/store.cjs'), { startGateway } = require('../src/gateway.cjs'), M = require('../src/model-effort.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-abliteration-workflow-'));
  const store = new Store(path.join(os.homedir(), 'Library/Application Support/Aster'));
  store.data.providers = store.data.providers.filter(p => p.id === 'pi-abliteration');
  store.data.routing = { enabled: false };
  const marker = 'ABL-' + require('node:crypto').randomBytes(4).toString('hex');
  const inputs = { 'alpha.json': { marker: marker + '-A', values: [13, 27, 51] }, 'beta.json': { marker: marker + '-B', values: [19, 41, 67] } };
  for (const [file, data] of Object.entries(inputs)) fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  const requests = [], outbound = [];
  const gateway = await startGateway({ store, onRequest: r => { requests.push(r); console.log(JSON.stringify({ tool: r.returnedToolNames, child: r.workflowSubtask, ultracode: r.nativeUltracodeReminder, upstreamEffort: r.upstreamEffort })); }, transport: async (url, options) => {
    const b = JSON.parse(options.body); outbound.push({ model: b.model, hasEffort: 'reasoning_effort' in b });
    return fetch(url, options);
  } });
  const route = gateway.catalog().find(r => r.model === 'abliterated-model-large-v2');
  const env = require('../src/claude-accounts.cjs').cliEnvironment(path.join(dir, '.config'));
  Object.assign(env, { ANTHROPIC_API_KEY: gateway.token, ANTHROPIC_BASE_URL: gateway.origin, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ENABLE_TOOL_SEARCH: 'false', DISABLE_TELEMETRY: '1', CLAUDE_CODE_MODEL_CAPABILITIES: M.nativeEngineCapabilities([route]) });
  try {
    const prompt = 'Analyze alpha.json and beta.json in the current directory. Validate their schemas, calculate the marker, count, minimum, maximum and sum for each file, independently verify the arithmetic, then report both markers and the combined total. Do not modify either input file. Any workflow definition files must stay inside this directory. Wait for all workflow agents to finish before answering.';
    const output = await new Promise((resolve, reject) => {
      const child = cp.execFile(require('./engine-path.cjs')(), ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '-p', prompt, '--model', route.id,
        '--settings', JSON.stringify({ ultracode: true, enableWorkflows: true, workflowSize: 'small' }), '--effort', 'ultracode',
        '--tools', 'Read,Write,Workflow,TaskOutput', '--allowedTools', 'Read', 'Write', 'Workflow', 'TaskOutput', '--max-turns', '18', '--output-format', 'stream-json', '--verbose'],
      { cwd: dir, env, timeout: 240000, maxBuffer: 12e6 }, (error, out, err) => {
        fs.writeFileSync(path.join(__dirname, '../evidence/abliteration-ultracode-events.jsonl'), out);
        error ? reject(Error(`Engine exited ${error.code}: ${err.slice(-500)}`)) : resolve(out);
      }); child.stdin.end();
    });
    const events = output.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = events.findLast(e => e.type === 'result');
    assert(result && !result.is_error, result?.result || 'Missing successful result');
    assert(requests.some(r => r.returnedToolNames?.includes('Workflow')), 'No native Workflow invocation');
    assert(requests.some(r => r.workflowSubtask), 'No actual workflow agent request');
    assert(requests.some(r => r.nativeUltracodeReminder), 'Missing native Ultracode reminder');
    assert(outbound.every(r => !r.hasEffort), 'Unsupported reasoning parameter reached Abliteration');
    assert(result.result.includes(marker + '-A') && result.result.includes(marker + '-B') && result.result.includes('218'), 'Incorrect fixture result');
    for (const [file, data] of Object.entries(inputs)) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, file))), data);
    const report = { checkedAt: new Date().toISOString(), status: 'passed', provider: route.provider, model: route.model, directory: dir,
      nativeUltracode: true, nativeWorkflow: true, actualChildRequests: requests.filter(r => r.workflowSubtask).length, unsupportedEffortSent: false, inputsPreserved: true, result: result.result, requests };
    fs.writeFileSync(path.join(__dirname, '../evidence/abliteration-ultracode-live.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, actualChildRequests: report.actualChildRequests }));
  } finally { gateway.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
