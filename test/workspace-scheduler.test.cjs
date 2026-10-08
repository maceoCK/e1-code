const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WorkspaceState } = require('../src/workspace-state.cjs');
const { WorkspaceScheduler } = require('../src/workspace-scheduler.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-schedules-'));
  const state = new WorkspaceState(directory), chat = state.createChat({ cwd: directory, model: 'test' });
  let now = 100000, running = false, starts = [], finish;
  const scheduler = new WorkspaceScheduler({ state, autoStart: false, now: () => now,
    isRunning: () => running, start: (chatId, prompt) => {
      starts.push({ chatId, prompt }); running = true;
      state.updateChat(chatId, c => { c.status = 'running'; });
      return { id: 'run-' + starts.length, done: new Promise(resolve => { finish = (status = 'idle') => {
        state.updateChat(chatId, c => { c.status = status; }); running = false; resolve();
      }; }) };
    } });
  t.after(() => { scheduler.close(); fs.rmSync(directory, { force: true, recursive: true }); });
  return { directory, state, chat, scheduler, starts, setNow: value => { now = value; },
    setBusy: value => { running = value; }, finish: async status => { finish(status); await scheduler.drain(); } };
}
test('persistent schedules defer busy chats, run once, notify and survive reload', async t => {
  const f = fixture(t);
  const schedule = f.scheduler.create(f.chat.id, { title: 'Read progress', prompt: 'Check the latest progress', nextRunAt: 101000 });
  f.scheduler.tick(); assert.equal(f.starts.length, 0);
  f.setNow(101000); f.setBusy(true); f.scheduler.tick(); assert.equal(f.starts.length, 0);
  f.setBusy(false); f.scheduler.tick(); f.scheduler.tick(); assert.equal(f.starts.length, 1);
  assert.equal(f.scheduler.list(f.chat.id)[0].lastRun.status, 'running');
  await f.finish(); f.scheduler.tick(); assert.equal(f.starts.length, 1);
  const reopened = new WorkspaceState(f.directory);
  assert.equal(reopened.data.schedules[0].id, schedule.id);
  assert.equal(reopened.data.schedules[0].enabled, false);
  assert.equal(reopened.data.notifications[0].status, 'completed');
});
test('missed recurring occurrences coalesce; failed runs pause and failures-only notices remain quiet on success', async t => {
  const f = fixture(t);
  f.scheduler.create(f.chat.id, { title: 'Repeat', prompt: 'Check status', nextRunAt: 101000, intervalMinutes: 1, notificationPolicy: 'failures' });
  f.setNow(101000 + 5 * 60000 + 10); f.scheduler.tick(); await f.finish();
  assert.equal(f.starts.length, 1); assert.equal((f.state.data.notifications || []).length, 0);
  const next = f.scheduler.list(f.chat.id)[0].nextRunAt; assert.equal(next, 461000);
  f.setNow(next); f.scheduler.tick(); await f.finish('failed');
  assert.equal(f.scheduler.list(f.chat.id)[0].enabled, false);
  assert.equal(f.state.data.notifications[0].status, 'failed');
});
test('restart marks uncertain scheduled dispatch interrupted and never repeats it automatically', async t => {
  const f = fixture(t);
  const schedule = f.scheduler.create(f.chat.id, { title: 'Do work', prompt: 'Do authorized work', nextRunAt: 101000, intervalMinutes: 1 });
  f.state.change(data => { data.schedules[0].lastRun = { id: 'uncertain', status: 'dispatching' }; });
  const state = new WorkspaceState(f.directory);
  const recovered = new WorkspaceScheduler({ state, autoStart: false, now: () => 999999,
    isRunning: () => false, start: () => assert.fail('Must not replay an uncertain occurrence') });
  recovered.tick(); assert.equal(recovered.list(f.chat.id)[0].enabled, false);
  assert.equal(recovered.list(f.chat.id)[0].lastRun.status, 'interrupted');
  assert.throws(() => recovered.update(f.chat.id, schedule.id, { enabled: true }), /future/);
  const other = state.createChat({ cwd: f.directory, model: 'test' });
  assert.throws(() => recovered.remove(other.id, schedule.id), /not found/);
  recovered.close();
});
test('action recovery retains completed results and distinguishes uncertain from unstarted actions', t => {
  const f = fixture(t);
  f.state.updateChat(f.chat.id, c => {
    c.status = 'running';
    c.pendingTurn = { runId: 'run-1', content: ['complete', 'uncertain', 'not-started'].map(id => ({ type: 'tool_use', id, name: 'page_create', input: { title: id } })),
      results: [{ type: 'tool_result', tool_use_id: 'complete', content: 'Already saved' }], startedAction: 'uncertain' };
  });
  const recovered = new WorkspaceState(f.directory).chat(f.chat.id);
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.pendingTurn, undefined);
  const results = recovered.messages.at(-1).content;
  assert.equal(results[0].content, 'Already saved'); assert.match(results[1].content, /UNKNOWN/); assert.match(results[2].content, /not executed/);
  assert.equal(new WorkspaceState(f.directory).chat(f.chat.id).messages.length, 2);
});
test('a real host exit after a side effect leaves an uncertain action without losing the Page', async t => {
  const f = fixture(t);
  const { execFile } = require('node:child_process');
  const directory = path.join(f.directory, 'crash');
  const script = `
    const {WorkspaceAgent}=require(${JSON.stringify(path.resolve(__dirname, '../src/workspace-agent.cjs'))});
    const agent=new WorkspaceAgent({directory:${JSON.stringify(directory)},generate:async function*(){
      yield {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'side-effect',name:'page_create',input:{title:'Survives crash',content:'Saved before crash'}}};
      yield {type:'content_block_stop',index:0}; yield {type:'message_delta',delta:{stop_reason:'tool_use'}};yield {type:'message_stop'};
    }});
    const original=agent.tools.call.bind(agent.tools);
    agent.tools.call=async(...args)=>{await original(...args);process.exit(23)};
    const chat=agent.state.createChat({cwd:${JSON.stringify(f.directory)},model:'fixture'});
    agent.start(chat.id,'Create a Page');
  `;
  const result = await new Promise(resolve => execFile(process.execPath, ['-e', script], { timeout: 5000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error?.code, 23, result.stderr);
  const recovered = new WorkspaceState(directory);
  assert.equal(recovered.data.pages.length, 1); assert.equal(recovered.data.pages[0].content, 'Saved before crash');
  assert.equal(recovered.data.chats[0].status, 'interrupted');
  assert.match(recovered.data.chats[0].messages.at(-1).content[0].content, /UNKNOWN/);
});
