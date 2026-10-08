const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceState } = require('../src/workspace-state.cjs');
const { WorkspaceTools } = require('../src/workspace-tools.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-pty-'));
  const state = new WorkspaceState(directory), chat = state.createChat({ cwd: directory });
  const tools = new WorkspaceTools(state, { shell: '/bin/sh' });
  t.after(async () => { await tools.close(); fs.rmSync(directory, { force: true, recursive: true }); });
  return { directory, state, chat, tools, call: (name, args) => tools.call(chat.id, name, args) };
}
async function untilOutput(tools, chat, id, pattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const output = tools.info(tools.process(chat.id, id));
    if (pattern.test(output.output)) return output;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Terminal output did not match ${pattern}: ${tools.info(tools.process(chat.id, id)).output}`);
}
test('legacy terminal panels stay readable as unavailable after restart', async t => {
  const { state, chat, directory } = fixture(t);
  state.openPanel(chat.id, 'terminal', 'old-session', 'Old command');
  const restored = new WorkspaceTools(new WorkspaceState(directory));
  t.after(() => restored.close());
  const result = await restored.call(chat.id, 'terminal_read', { id: 'old-session' });
  assert.equal(result.status, 'unavailable'); assert.equal(result.output, '');
  assert.match(result.error, /cannot be restored/);
  await assert.rejects(restored.call(chat.id, 'terminal_write', { id: 'old-session', text: 'no' }), /no longer/);
});
test('PTY is a TTY, resizes the running process and restores completed output', { timeout: 10000 }, async t => {
  const { directory, chat, tools, call } = fixture(t);
  const term = await call('terminal_start', { command: 'stty -echo; test -t 0 && printf "TTY_READY\\n"; read value; stty size; printf "received:%s\\n" "$value"', cols: 81, rows: 25 });
  await untilOutput(tools, chat, term.id, /TTY_READY/);
  await call('terminal_resize', { id: term.id, cols: 112, rows: 37 });
  await assert.rejects(call('terminal_resize', { id: term.id, cols: 0, rows: 37 }), /Terminal size/);
  await call('terminal_write', { id: term.id, text: 'résumé ✓\n' });
  await tools.process(chat.id, term.id).done;
  const output = await call('terminal_read', { id: term.id });
  assert.match(output.output, /37 112/); assert.match(output.output, /received:résumé ✓/);
  assert.equal(output.exitCode, 0); assert.equal(output.mode, 'pty');
  assert.equal((await call('terminal_read', { id: term.id, cursor: output.cursor })).output, '');
  const restored = new WorkspaceTools(new WorkspaceState(directory));
  t.after(() => restored.close());
  const saved = await restored.call(chat.id, 'terminal_read', { id: term.id });
  assert.equal(saved.restored, true); assert.equal(saved.status, 'exited'); assert.equal(saved.output, output.output);
  await assert.rejects(restored.call(chat.id, 'terminal_write', { id: term.id, text: 'no' }), /no longer/);
});
test('Ctrl-C interrupts a foreground job and leaves an interactive shell usable', { timeout: 10000 }, async t => {
  const { chat, tools, call } = fixture(t);
  const term = await call('terminal_start', {});
  await call('terminal_write', { id: term.id, text: 'stty -echo; printf "JOB_READY\\n"; sleep 60\n' });
  await untilOutput(tools, chat, term.id, /JOB_READY\r?\n/);
  await call('terminal_write', { id: term.id, text: '\x03' });
  await call('terminal_write', { id: term.id, text: 'printf "SHELL_SURVIVED\\n"\n' });
  const output = await untilOutput(tools, chat, term.id, /SHELL_SURVIVED\r?\n/);
  assert.equal(output.status, 'running');
  await call('terminal_write', { id: term.id, text: 'exit\n' });
  await tools.process(chat.id, term.id).done;
});
test('Stop terminates foreground descendants even when the shell uses job control', { timeout: 10000 }, async t => {
  const { chat, tools, call } = fixture(t);
  const term = await call('terminal_start', {});
  await call('terminal_write', { id: term.id, text: 'stty -echo; sleep 60 & child=$(jobs -p); printf "CHILD:%s\\n" "$child"; wait\n' });
  const output = await untilOutput(tools, chat, term.id, /CHILD:\d+\r?\n/);
  const child = Number(output.output.match(/CHILD:(\d+)\r?\n/)[1]);
  await call('terminal_stop', { id: term.id });
  assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
});
