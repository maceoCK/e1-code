const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { constants } = require('node:os');
const pty = require('node-pty');

const string = { type: 'string' }, integer = { type: 'integer' };
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = [
  ['workspace_list', 'List this chat’s panels, running commands, and available Pages.', schema({})],
  ['files_list', 'List entries in a workspace directory.', schema({ path: string })],
  ['file_read', 'Read a UTF-8 workspace file and its revision hash.', schema({ path: string })],
  ['file_write', 'Write a UTF-8 workspace file. For an existing file provide the hash from file_read; use new for a new file.', schema({ path: string, content: string, revision: string })],
  ['terminal_start', 'Start a PTY terminal in this chat’s workspace. Omit command for an interactive shell. Commands have local user privileges.', schema({ command: string, cols: integer, rows: integer }, [])],
  ['terminal_read', 'Read command output starting at a byte cursor. Read again while status is running.', schema({ id: string, cursor: integer }, ['id'])],
  ['terminal_write', 'Write input to a running command.', schema({ id: string, text: string })],
  ['terminal_resize', 'Resize a live PTY terminal in character columns and rows.', schema({ id: string, cols: integer, rows: integer })],
  ['terminal_stop', 'Stop a command and its process group.', schema({ id: string })],
  ['page_list', 'Search local Pages by title or content.', schema({ query: string }, [])],
  ['page_read', 'Read a Page with its revision, history, and comments.', schema({ id: string })],
  ['page_create', 'Create a persistent local Page and show it in this chat.', schema({ title: string, content: string, parentId: string }, ['title', 'content'])],
  ['page_edit', 'Edit a local Page with optimistic revision checking.', schema({ id: string, revision: integer, title: string, content: string, parentId: { type: ['string', 'null'] } }, ['id', 'revision'])],
  ['page_comment', 'Append a comment to a Page at its current revision.', schema({ id: string, revision: integer, text: string })],
  ['panel_open', 'Show an existing Page, workspace file, command, child chat, or this chat’s schedules and activity.', schema({ kind: { type: 'string', enum: ['page', 'file', 'terminal', 'chat', 'schedules', 'activity'] }, resourceId: string })],
  ['panel_close', 'Close a panel without deleting its resource or stopping its command.', schema({ id: string })],
  ['chat_fork', 'Create a child chat containing a snapshot of this conversation.', schema({ title: string })],
];
const browserDefinitions = [
  ['browser_list', 'List this chat’s browser tabs, including suspended tabs.', schema({})],
  ['browser_open', 'Open an HTTP(S) page in a new internal browser tab.', schema({ url: string })],
  ['browser_navigate', 'Navigate an existing internal browser tab.', schema({ id: string, url: string })],
  ['browser_read', 'Read visible page text and interactive elements with selectors and a navigation epoch.', schema({ id: string })],
  ['browser_click', 'Click an element using a selector and the epoch from browser_read.', schema({ id: string, selector: string, epoch: integer })],
  ['browser_fill', 'Fill an editable text field using a selector and the epoch from browser_read.', schema({ id: string, selector: string, epoch: integer, text: string })],
  ['browser_screenshot', 'Capture the browser tab as an image.', schema({ id: string })],
  ['browser_present', 'Show an existing browser tab beside this conversation.', schema({ id: string })],
  ['browser_close', 'Close a browser tab.', schema({ id: string })],
];
const scheduleDefinitions = [
  ['schedule_list', 'List this chat’s scheduled work and recent run status. Schedules run only while E1 is open.', schema({})],
  ['schedule_create', 'Schedule work only when the user explicitly requests a future or recurring task. nextRunAt is Unix time in milliseconds; omitted intervalMinutes means once. E1 must be open to run; overdue work runs once on reopen.', schema({ title: string, prompt: string, nextRunAt: integer, intervalMinutes: { type: ['integer', 'null'] }, notificationPolicy: { type: 'string', enum: ['all', 'failures'] } }, ['title', 'prompt', 'nextRunAt'])],
  ['schedule_update', 'Update a user-authorized schedule. Pausing does not stop a current run. Interrupted schedules need a new future nextRunAt before enabling.', schema({ id: string, title: string, prompt: string, nextRunAt: integer, intervalMinutes: { type: ['integer', 'null'] }, enabled: { type: 'boolean' }, notificationPolicy: { type: 'string', enum: ['all', 'failures'] } }, ['id'])],
  ['schedule_delete', 'Delete a schedule when requested by the user.', schema({ id: string })],
];
function validate(value, spec, label = 'arguments') {
  if (spec.type === 'object') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(`${label} must be an object.`);
    for (const key of spec.required || []) if (!(key in value)) throw Error(`${label}.${key} is required.`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(spec.properties, key)) throw Error(`Unknown ${label}.${key}.`);
      validate(item, spec.properties[key], `${label}.${key}`);
    }
  } else {
    const types = [].concat(spec.type);
    if (!types.some(t => t === 'null' ? value === null : t === 'integer' ? Number.isSafeInteger(value) : typeof value === t)) throw Error(`Invalid ${label}.`);
    if (typeof value === 'string' && value.length > 1_000_000) throw Error(`${label} exceeds 1 MB.`);
    if (spec.enum && !spec.enum.includes(value)) throw Error(`Invalid ${label}.`);
  }
}
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
class WorkspaceTools {
  constructor(state, { shell = process.env.SHELL || '/bin/sh', onChange = () => {} } = {}) {
    this.state = state; this.shell = shell; this.onChange = onChange; this.processes = new Map(); this.closed = false;
    this.logDirectory = path.join(path.dirname(state.file), 'terminal-output');
    fs.mkdirSync(this.logDirectory, { recursive: true, mode: 0o700 });
    for (const chat of state.data.chats) for (const saved of chat.commands || []) {
      if (!/^[a-f0-9-]{36}$/.test(saved.id)) continue;
      const file = path.join(this.logDirectory, saved.id);
      const output = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
      this.processes.set(saved.id, { ...saved, chatId: chat.id, output, start: 0, end: output.length,
        status: saved.status === 'running' ? 'unavailable' : saved.status, restored: true,
        error: saved.status === 'running' ? 'The host restarted. This process is no longer attached; its final status is unknown.' : saved.error,
        done: Promise.resolve() });
    }
    for (const chat of state.data.chats) for (const panel of chat.panels) {
      if (panel.kind !== 'terminal' || this.processes.has(panel.resourceId)) continue;
      this.processes.set(panel.resourceId, { id: panel.resourceId, chatId: chat.id, command: panel.title,
        status: 'unavailable', restored: true, output: Buffer.alloc(0), start: 0, end: 0,
        error: 'This terminal was created before persistent sessions were available. Its process and output cannot be restored.', done: Promise.resolve() });
    }
  }
  available() { return [...definitions, ...(this.browser ? browserDefinitions : []), ...(this.scheduler ? scheduleDefinitions : [])]; }
  definitions() { return this.available().map(([name, description, input_schema]) => ({ name, description, input_schema })); }
  resolve(chatId, input, creating = false) {
    const root = this.state.chat(chatId).cwd;
    const target = path.resolve(root, input);
    const actual = creating && !fs.existsSync(target) ? path.join(fs.realpathSync(path.dirname(target)), path.basename(target)) : fs.realpathSync(target);
    if (actual !== root && !actual.startsWith(root + path.sep)) throw Error('File is outside this chat’s workspace folder.');
    return actual;
  }
  process(chatId, id) {
    const entry = this.processes.get(id);
    if (!entry || entry.chatId !== chatId) throw Error('Command not found in this chat.');
    return entry;
  }
  info(entry, cursor = entry.start) {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > entry.end) throw Error('Invalid output cursor.');
    const begin = Math.max(cursor, entry.start);
    return { id: entry.id, command: entry.command, status: entry.status, exitCode: entry.exitCode,
      signal: entry.signal, output: entry.output.subarray(begin - entry.start).toString('utf8'), cursor: entry.end,
      truncated: cursor < entry.start, restored: !!entry.restored, error: entry.error || null,
      mode: entry.mode || 'pipe', cols: entry.cols, rows: entry.rows };
  }
  dimensions(cols, rows) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 500 || rows > 300) throw Error('Terminal size must be 2–500 columns and 1–300 rows.');
  }
  start(chatId, command = '', cols = 100, rows = 30) {
    if (this.closed) throw Error('Workspace is closing.');
    this.dimensions(cols, rows);
    if ([...this.processes.values()].filter(p => p.status === 'running').length >= 32) throw Error('32 commands are running. Stop a command before starting another.');
    const entry = { id: crypto.randomUUID(), chatId, command, mode: 'pty', cols, rows, status: 'running', output: Buffer.alloc(0), start: 0, end: 0 };
    const child = pty.spawn(this.shell, command.trim() ? ['-lc', command] : ['-l'], {
      cwd: this.state.chat(chatId).cwd, name: 'xterm-256color', cols, rows,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    entry.child = child; this.processes.set(entry.id, entry);
    entry.done = new Promise(resolve => { entry.resolve = resolve; });
    const append = chunk => {
      chunk = Buffer.from(chunk, 'utf8');
      entry.output = Buffer.concat([entry.output, chunk]); entry.end += chunk.length;
      if (entry.output.length > 1_048_576) { const extra = entry.output.length - 1_048_576; entry.output = entry.output.subarray(extra); entry.start += extra; }
      try { fs.writeFileSync(path.join(this.logDirectory, entry.id), entry.output, { mode: 0o600 }); }
      catch (error) { entry.error = 'Could not preserve command output: ' + error.message; }
      this.onChange({ type: 'terminal', chatId, id: entry.id });
    };
    child.onData(append);
    child.onExit(({ exitCode: code, signal: number }) => {
      const signal = number ? Object.entries(constants.signals).find(([, value]) => value === number)?.[0] || String(number) : null;
      entry.exitCode = code; entry.signal = signal; entry.status = entry.error ? 'failed' : 'exited';
      try { this.state.updateChat(chatId, c => { const saved = c.commands?.find(p => p.id === entry.id); if (saved) Object.assign(saved, { status: entry.status, exitCode: code, signal, error: entry.error || null }); }); }
      catch (error) { entry.error = 'Could not preserve command status: ' + error.message; }
      entry.resolve(); this.onChange({ type: 'terminal', chatId, id: entry.id });
    });
    try {
      this.state.updateChat(chatId, c => { c.commands ||= []; c.commands.push({ id: entry.id, command, mode: 'pty', cols, rows, status: 'running', createdAt: Date.now() }); });
      this.state.openPanel(chatId, 'terminal', entry.id, command.slice(0, 70) || 'Terminal');
    }
    catch (error) { this.stop(entry); throw error; }
    return this.info(entry);
  }
  stop(entry) {
    if (entry.status !== 'running' || entry.stopping) return;
    // Interactive shells put foreground jobs in a separate process group.
    // Capture descendants before signalling the shell so those jobs stop too.
    const owned = new Set([entry.child.pid]);
    if (process.platform !== 'win32') {
      const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      let changed; do { changed = false; for (const [pid, parent] of processes) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true; } } while (changed);
    }
    const kill = signal => {
      for (const pid of [...owned].reverse()) try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    entry.stopping = true;
    kill('SIGTERM');
    entry.stopped = new Promise(resolve => {
      entry.killTimer = setTimeout(() => { try { kill('SIGKILL'); } finally { resolve(); } }, 1000);
    });
  }
  async close() {
    this.closed = true;
    const running = [...this.processes.values()].filter(p => p.status === 'running');
    running.forEach(p => this.stop(p)); await Promise.all([...this.processes.values()].flatMap(p => [p.done, p.stopped]));
    this.browser?.close();
  }
  async call(chatId, name, input, { signal } = {}) {
    if (this.closed) throw Error('Workspace is closing.');
    const definition = this.available().find(d => d[0] === name);
    if (!definition) throw Error('Tool is not available.');
    validate(input, definition[2]); this.state.chat(chatId);
    let result;
    switch (name) {
      case 'schedule_list': return this.scheduler.list(chatId);
      case 'schedule_create': return this.scheduler.create(chatId, input);
      case 'schedule_update': { const { id, ...changes } = input; return this.scheduler.update(chatId, id, changes); }
      case 'schedule_delete': return this.scheduler.remove(chatId, input.id);
      case 'browser_list': return this.browser.list(chatId);
      case 'browser_open': return this.browser.open(chatId, input.url, signal);
      case 'browser_navigate': return this.browser.navigate(chatId, input.id, input.url, signal);
      case 'browser_read': return this.browser.read(chatId, input.id, signal);
      case 'browser_click': return this.browser.act(chatId, input, 'click', signal);
      case 'browser_fill': return this.browser.act(chatId, input, 'fill', signal);
      case 'browser_screenshot': return this.browser.screenshot(chatId, input.id, signal);
      case 'browser_present': { const tab = await this.browser.get(chatId, input.id, signal); result = this.state.openPanel(chatId, 'browser', tab.id, tab.title); break; }
      case 'browser_close': return this.browser.closeTab(chatId, input.id);
      case 'workspace_list': result = { chat: this.state.chat(chatId), pages: this.state.data.pages.map(({ id, title, parentId, revision }) => ({ id, title, parentId, revision })), commands: [...this.processes.values()].filter(p => p.chatId === chatId).map(p => ({ id: p.id, command: p.command, status: p.status })) }; delete result.chat.messages; break;
      case 'files_list': result = fs.readdirSync(this.resolve(chatId, input.path), { withFileTypes: true }).slice(0, 2000).map(e => ({ name: e.name, kind: e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'directory' : 'file' })); break;
      case 'file_read': {
        const file = this.resolve(chatId, input.path);
        if (fs.statSync(file).size > 1_000_000) throw Error('File exceeds 1 MB. Use a bounded shell command to inspect it.');
        const bytes = fs.readFileSync(file); if (bytes.includes(0)) throw Error('Binary file; open a supported preview instead.');
        result = { path: file, content: bytes.toString('utf8'), revision: hash(bytes) }; break;
      }
      case 'file_write': {
        const file = this.resolve(chatId, input.path, true), exists = fs.existsSync(file);
        const previous = exists ? fs.readFileSync(file) : null;
        if (input.revision !== (exists ? hash(previous) : 'new')) throw Error('File changed. Read it again before writing.');
        // Preserve the old bytes for a user-visible revision rather than overwriting blindly.
        if (exists) { const revisions = path.join(path.dirname(this.state.file), 'file-revisions'); fs.mkdirSync(revisions, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(revisions, hash(previous)), previous, { mode: 0o600 }); }
        fs.writeFileSync(file, input.content, { flag: exists ? 'w' : 'wx' });
        this.state.openPanel(chatId, 'file', file, path.basename(file)); result = { path: file, revision: hash(Buffer.from(input.content)) }; break;
      }
      case 'terminal_start': result = this.start(chatId, input.command, input.cols, input.rows); break;
      case 'terminal_read': result = this.info(this.process(chatId, input.id), input.cursor); break;
      case 'terminal_write': { const p = this.process(chatId, input.id); if (p.status !== 'running' || p.stopping) throw Error('Command is no longer accepting input.'); p.child.write(input.text); result = { accepted: true }; break; }
      case 'terminal_resize': {
        const p = this.process(chatId, input.id); this.dimensions(input.cols, input.rows);
        if (p.status !== 'running') throw Error('Command is no longer running.');
        p.child.resize(input.cols, input.rows); p.cols = input.cols; p.rows = input.rows;
        result = { id: p.id, cols: p.cols, rows: p.rows }; break;
      }
      case 'terminal_stop': { const p = this.process(chatId, input.id); this.stop(p); await Promise.all([p.done, p.stopped]); result = this.info(p); break; }
      case 'page_list': result = this.state.data.pages.filter(p => (p.title + '\n' + p.content).toLowerCase().includes((input.query || '').toLowerCase())).map(({ id, title, parentId, revision }) => ({ id, title, parentId, revision })); break;
      case 'page_read': result = this.state.page(input.id); break;
      case 'page_create': result = this.state.createPage(input); this.state.openPanel(chatId, 'page', result.id, result.title); break;
      case 'page_edit': result = this.state.editPage(input); break;
      case 'page_comment': result = this.state.change(data => { const page = data.pages.find(p => p.id === input.id); if (!page || page.revision !== input.revision) throw Error('Page changed or unavailable. Read it again before commenting.'); const comment = { id: crypto.randomUUID(), chatId, text: input.text, createdAt: Date.now() }; page.comments.push(comment); page.revision++; return comment; }); break;
      case 'panel_open': {
        let id = input.resourceId, title;
        if (input.kind === 'page') title = this.state.page(id).title;
        if (input.kind === 'file') { id = this.resolve(chatId, id); title = path.basename(id); }
        if (input.kind === 'terminal') title = this.process(chatId, id).command.slice(0, 70) || 'Terminal';
        if (input.kind === 'chat') { const child = this.state.chat(id); if (child.parentId !== chatId) throw Error('This is not a child of the current chat.'); title = child.title; }
        if (['schedules', 'activity'].includes(input.kind)) { if (id !== chatId) throw Error('Choose the current chat.'); title = input.kind === 'schedules' ? 'Schedules' : 'Updates'; }
        result = this.state.openPanel(chatId, input.kind, id, title); break;
      }
      case 'panel_close': result = this.state.updateChat(chatId, chat => { if (!chat.panels.some(p => p.id === input.id)) throw Error('Panel not found.'); chat.panels = chat.panels.filter(p => p.id !== input.id); if (chat.activePanelId === input.id) chat.activePanelId = chat.panels.at(-1)?.id || null; }); break;
      case 'chat_fork': { const parent = this.state.chat(chatId); result = this.state.createChat({ title: input.title, cwd: parent.cwd, model: parent.model, parentId: chatId }); this.state.openPanel(chatId, 'chat', result.id, result.title); break; }
    }
    if (!['workspace_list', 'files_list', 'file_read', 'terminal_read', 'page_list', 'page_read'].includes(name)) this.onChange({ type: 'workspace', chatId });
    return result;
  }
}
module.exports = { WorkspaceTools, validate };
