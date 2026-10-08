const { randomUUID } = require('node:crypto');

class WorkspaceScheduler {
  constructor({ state, start, isRunning, onChange = () => {}, now = Date.now, autoStart = true }) {
    Object.assign(this, { state, start, isRunning, onChange, now });
    this.closed = false; this.pending = new Set();
    if ((state.data.schedules || []).some(s => ['dispatching', 'running'].includes(s.lastRun?.status))) {
      state.change(data => {
        for (const schedule of data.schedules) if (['dispatching', 'running'].includes(schedule.lastRun?.status)) {
          schedule.lastRun.status = 'interrupted'; schedule.lastRun.finishedAt = now(); schedule.enabled = false;
          this.notify(data, schedule, 'interrupted', 'The app closed during this run. Check its results before resuming the schedule.');
        }
      });
    }
    if (autoStart) this.timer = setInterval(() => this.tick(), 1000);
    this.timer?.unref();
  }
  notify(data, schedule, status, text) {
    if (status === 'completed' && schedule.notificationPolicy === 'failures') return;
    data.notifications ||= [];
    data.notifications.push({ id: randomUUID(), chatId: schedule.chatId, scheduleId: schedule.id,
      title: schedule.title, status, text, createdAt: this.now(), read: false });
    data.notifications = data.notifications.slice(-200);
  }
  list(chatId) { this.state.chat(chatId); return structuredClone((this.state.data.schedules || []).filter(s => s.chatId === chatId)); }
  validate(input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) throw Error('Enter a schedule title under 160 characters.');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 120000) throw Error('Enter a schedule prompt under 120,000 characters.');
    if (!Number.isSafeInteger(input.nextRunAt) || input.nextRunAt < 0 || input.nextRunAt > 8640000000000000) throw Error('Choose a valid scheduled time.');
    if (input.intervalMinutes !== null && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 525600)) throw Error('Repeat interval must be 1–525600 minutes or null.');
    if (!['all', 'failures'].includes(input.notificationPolicy)) throw Error('Invalid notification policy.');
    if (typeof input.enabled !== 'boolean') throw Error('Invalid schedule state.');
  }
  create(chatId, input) {
    const chat = this.state.chat(chatId);
    if (!chat.model) throw Error('Choose a model for this chat before scheduling it.');
    const schedule = { ...input, intervalMinutes: input.intervalMinutes ?? null, notificationPolicy: input.notificationPolicy || 'all',
      enabled: true, id: randomUUID(), chatId, createdAt: this.now(), lastRun: null, history: [] };
    this.validate(schedule);
    if (schedule.nextRunAt <= this.now()) throw Error('Choose a future scheduled time.');
    this.state.change(data => { data.schedules ||= []; data.schedules.push(schedule); });
    this.onChange({ type: 'schedule', chatId }); return structuredClone(schedule);
  }
  update(chatId, id, changes) {
    const current = this.list(chatId).find(s => s.id === id);
    if (!current) throw Error('Schedule not found in this chat.');
    const updated = { ...current, ...changes }; this.validate(updated);
    if (updated.enabled && updated.nextRunAt <= this.now() && (!current.enabled || 'nextRunAt' in changes)) throw Error('Choose a new future time before resuming an overdue schedule.');
    this.state.change(data => Object.assign(data.schedules.find(s => s.id === id), updated));
    this.onChange({ type: 'schedule', chatId }); return updated;
  }
  remove(chatId, id) {
    const current = this.list(chatId).find(s => s.id === id);
    if (!current) throw Error('Schedule not found in this chat.');
    if (['dispatching', 'running'].includes(current.lastRun?.status)) throw Error('Stop the running chat before deleting this schedule.');
    this.state.change(data => { data.schedules = data.schedules.filter(s => s.id !== id); });
    this.onChange({ type: 'schedule', chatId }); return { deleted: true };
  }
  tick() {
    if (this.closed) return;
    for (const schedule of structuredClone(this.state.data.schedules || [])) {
      if (!schedule.enabled || schedule.nextRunAt > this.now() || this.isRunning(schedule.chatId) || ['dispatching', 'running'].includes(schedule.lastRun?.status)) continue;
      try { this.dispatch(schedule); }
      catch (error) { this.onChange({ type: 'scheduler_error', error: error.message }); }
    }
  }
  dispatch(schedule) {
    const now = this.now(), occurrence = { id: randomUUID(), scheduledAt: schedule.nextRunAt, startedAt: now, status: 'dispatching' };
    // Persist the occurrence before starting inference. Restart never dispatches
    // an uncertain occurrence again; it pauses it for review instead.
    this.state.change(data => {
      const saved = data.schedules.find(s => s.id === schedule.id);
      if (saved.lastRun) saved.history = [...saved.history, saved.lastRun].slice(-100);
      saved.lastRun = occurrence;
      if (saved.intervalMinutes) {
        const interval = saved.intervalMinutes * 60000;
        saved.nextRunAt += (Math.floor((now - saved.nextRunAt) / interval) + 1) * interval;
      } else saved.enabled = false;
    });
    let run;
    try {
      run = this.start(schedule.chatId, schedule.prompt);
      this.state.change(data => Object.assign(data.schedules.find(s => s.id === schedule.id).lastRun, { status: 'running', runId: run.id }));
    } catch (error) { this.finish(schedule, occurrence.id, 'failed', error.message); return; }
    const pending = Promise.resolve(run.done).then(() => {
      const chat = this.state.chat(schedule.chatId);
      this.finish(schedule, occurrence.id, chat.status === 'idle' ? 'completed' : chat.status, chat.error || 'Scheduled work completed.');
    }, error => this.finish(schedule, occurrence.id, 'failed', error.message)).catch(error => {
      this.onChange({ type: 'scheduler_error', error: error.message });
    }).finally(() => this.pending.delete(pending));
    this.pending.add(pending); this.onChange({ type: 'schedule', chatId: schedule.chatId });
  }
  finish(schedule, occurrenceId, status, text) {
    this.state.change(data => {
      const current = data.schedules.find(s => s.id === schedule.id);
      if (!current || current.lastRun?.id !== occurrenceId) return;
      Object.assign(current.lastRun, { status, text, finishedAt: this.now() });
      if (status !== 'completed') current.enabled = false;
      this.notify(data, current, status, text);
    });
    this.onChange({ type: 'schedule', chatId: schedule.chatId });
  }
  close() { this.closed = true; clearInterval(this.timer); }
  async drain() { await Promise.all([...this.pending]); }
}
module.exports = { WorkspaceScheduler };
