// Ask the official CLI for its account-specific catalog without sending a prompt.
const { spawn } = require('node:child_process');
const os = require('node:os');

function modelName(id, fallback = id) {
  const match = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  return match ? match[1][0].toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '') : fallback;
}

function normalizeModels(rows) {
  const models = new Map();
  for (const row of rows || []) {
    const id = row.resolvedModel || row.value;
    if (typeof id !== 'string' || !id.startsWith('claude-')) continue;
    const previous = models.get(id);
    const aliases = [...new Set([...(previous?.aliases || []), row.value].filter(x => typeof x === 'string' && x !== id))];
    if (previous && row.value === 'default') { previous.aliases = aliases; continue; }
    models.set(id, { id, name: modelName(id, row.displayName?.replace(/^Default.*$/, id) || id),
      description: row.description, aliases,
      reasoningEfforts: row.supportsEffort ? (row.supportedEffortLevels || ['low', 'medium', 'high']) : [],
    });
  }
  return [...models.values()];
}

function discoverModels(executable, env, launch = spawn) {
  return new Promise((resolve, reject) => {
    const child = launch(executable, ['-p', '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--tools', '', '--permission-mode', 'dontAsk', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
    { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', size = 0, settled = false;
    const timer = setTimeout(() => finish(Error('Claude model discovery timed out.')), 30000);
    function finish(error, models) {
      if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL');
      error ? reject(error) : resolve(models);
    }
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(Error('Could not start Claude model discovery.')));
    child.on('close', () => finish(Error('Claude returned no model catalog.')));
    child.stdout.on('data', chunk => {
      size += chunk.length; if (size > 2e6) return finish(Error('Claude model catalog exceeded its size limit.'));
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type !== 'control_response' || event.response?.request_id !== 'e1-models') continue;
        const models = normalizeModels(event.response?.response?.models);
        finish(models.length ? null : Error('Claude returned an empty model catalog.'), models);
      }
    });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'e1-models', request: { subtype: 'initialize' } }) + '\n');
  });
}
module.exports = { normalizeModels, discoverModels, modelName };
