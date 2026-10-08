const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const markdown = text => DOMPurify.sanitize(marked.parse(text || ''), { FORBID_TAGS: ['style', 'iframe', 'script', 'img'], FORBID_ATTR: ['style'] });
let state, chatId = localStorage.getItem('e1-workspace-chat'), renderedPanel, editorDirty = false, refreshTimer, entryAction;
let terminalView;
const drafts = new Map();
const modelChoices = new Map();
const chat = () => state?.chats.find(c => c.id === chatId);
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
async function api(route, body) {
  const response = await fetch('/api/workspace/' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed.'); return data;
}
const attempt = fn => async (...args) => { try { await fn(...args); } catch (error) { notice(error.message); } };
const tool = (name, args, id = chatId) => api('tool', { chatId: id, name, arguments: args });
function selectChat(id) { chatId = id; localStorage.setItem('e1-workspace-chat', id); renderedPanel = null; editorDirty = false; render(); }
function ask(title, label, value, callback, description = '') {
  entryAction = callback; $('entry-title').textContent = title; $('entry-label').textContent = label; $('entry-input').value = value; $('entry-input').required = title !== 'Open a terminal'; $('entry-description').textContent = description; $('entry').showModal(); $('entry-input').focus();
  void syncBrowserBounds();
}
function newChat() {
  ask('New chat', 'Workspace folder', chat()?.cwd || '', async cwd => {
    const created = await api('chat', { cwd, model: $('model').value }); await refresh(); selectChat(created.id); $('prompt').focus();
  }, 'Choose the folder E1 should work in. Your existing files stay in place.');
}
function messagesHTML(messages) {
  return messages.map(message => {
    if (typeof message.content === 'string') return `<div class="message ${message.role}">${message.role === 'user' ? escape(message.content) : markdown(message.content)}</div>`;
    const texts = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const calls = message.content.filter(b => b.type === 'tool_use');
    const results = message.content.filter(b => b.type === 'tool_result');
    return `<div class="message assistant">${markdown(texts)}${calls.map(c => `<details><summary>${escape(c.name.replaceAll('_', ' '))}</summary><pre>${escape(JSON.stringify(c.input, null, 2))}</pre></details>`).join('')}${results.map(r => `<details><summary>${r.is_error ? 'Action failed' : 'Result'}</summary><pre>${escape(r.content)}</pre></details>`).join('')}</div>`;
  }).join('');
}
function render() {
  const current = chat();
  const query = $('search').value.toLowerCase();
  $('chats').innerHTML = state.chats.filter(c => c.title.toLowerCase().includes(query)).map(c => `<button data-id="${c.id}" class="${c.id === chatId ? 'selected' : ''}">${c.parentId ? '↳ ' : ''}${escape(c.title)}</button>`).join('');
  $('chats').querySelectorAll('button').forEach(button => button.onclick = () => selectChat(button.dataset.id));
  $('title').textContent = current?.title || 'New chat'; $('folder').textContent = current?.cwd || '';
  const model = modelChoices.get(chatId) || current?.model;
  $('model').innerHTML = '<option value="">Choose a model</option>' + state.models.map(m => `<option value="${escape(m.id)}">${escape(m.name || m.id)}</option>`).join('');
  $('model').value = state.models.some(m => m.id === model) ? model : (state.models[0]?.id || '');
  const run = state.runs.find(r => r.chatId === chatId);
  $('empty').hidden = !!current?.messages.length;
  $('start-chat').hidden = !!current;
  const messageBox = $('messages'), nearBottom = messageBox.scrollHeight - messageBox.scrollTop - messageBox.clientHeight < 100;
  messageBox.innerHTML = messagesHTML(current?.messages || []) + (run?.text ? `<div class="message assistant">${markdown(run.text)}</div>` : '');
  if (nearBottom) messageBox.scrollTop = messageBox.scrollHeight;
  $('activity').textContent = run ? run.activity.replaceAll('_', ' ') + '…' : current?.error || '';
  $('send').hidden = !!run; $('stop').hidden = !run; $('send').disabled = !current; $('model').disabled = !!run;
  document.querySelector('[data-action="browser"]').hidden = !state.capabilities.browser;
  $('resume').hidden = !!run || !['interrupted', 'incomplete', 'failed', 'stopped'].includes(current?.status);
  const unread = (state.notifications || []).filter(n => !n.read && n.chatId === chatId).length;
  $('open-updates').textContent = unread ? `Updates (${unread})` : 'Updates';
  const panel = current?.panels.find(p => p.id === current.activePanelId);
  $('side-panel').hidden = !panel; $('resize').hidden = !panel;
  if (current) document.documentElement.style.setProperty('--panel-width', current.layout.width + 'px');
  $('tabs').innerHTML = (current?.panels || []).map(p => `<div class="${p.id === panel?.id ? 'selected' : ''}"><button data-select="${p.id}">${escape(p.title)}</button><button data-close="${p.id}" aria-label="Close ${escape(p.title)}">×</button></div>`).join('');
  const selectedTab = $('tabs').querySelector('.selected');
  if (selectedTab && (selectedTab.offsetLeft < $('tabs').scrollLeft || selectedTab.offsetLeft + selectedTab.offsetWidth > $('tabs').scrollLeft + $('tabs').clientWidth)) selectedTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('tabs').querySelectorAll('[data-select]').forEach(button => button.onclick = attempt(async () => { await api('select-panel', { chatId, id: button.dataset.select }); renderedPanel = null; editorDirty = false; await refresh(); }));
  $('tabs').querySelectorAll('[data-close]').forEach(button => button.onclick = attempt(async () => {
    const closing = chat().panels.find(p => p.id === button.dataset.close);
    await tool(closing.kind === 'browser' ? 'browser_close' : 'panel_close', { id: closing.kind === 'browser' ? closing.resourceId : closing.id });
    renderedPanel = null; editorDirty = false; await refresh();
  }));
  if (panel) void attempt(() => renderPanel(panel))();
  else { terminalView?.dispose(); terminalView = null; void syncBrowserBounds(); }
}
async function refresh() { state = await api('state'); if (!chat() && state.chats.length) chatId = state.chats.at(-1).id; render(); }
function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; void attempt(refresh)(); }, 90); }
function toolbar(title, actions = '') { return `<div class="panel-toolbar"><strong>${escape(title)}</strong>${actions}</div>`; }
async function renderPanel(panel) {
  const owner = chatId;
  const key = owner + ':' + panel.id;
  if (renderedPanel !== key) notice();
  if (terminalView && (terminalView.key !== key || panel.kind !== 'terminal')) { terminalView.dispose(); terminalView = null; }
  if (panel.kind !== 'browser') void syncBrowserBounds();
  if (panel.kind === 'schedules') return renderSchedules(key, owner);
  if (panel.kind === 'activity') return renderUpdates(key, owner);
  if (panel.kind === 'browser') {
    const tab = chat().browserTabs?.find(t => t.id === panel.resourceId);
    if (renderedPanel !== key) {
      renderedPanel = key;
      $('panel-content').innerHTML = '<form id="browser-address-form" class="terminal-input"><input id="browser-address" aria-label="Browser address"><button>Go</button></form><div id="browser-viewport" class="browser-viewport"></div>';
      $('browser-address').value = tab?.url || '';
      $('browser-address-form').onsubmit = attempt(async event => { event.preventDefault(); await tool('browser_navigate', { id: panel.resourceId, url: $('browser-address').value }); await refresh(); });
    }
    await syncBrowserBounds(); return;
  }
  if (panel.kind === 'page' || panel.kind === 'file') {
    if (renderedPanel === key) return;
    renderedPanel = key;
    const resource = panel.kind === 'page' ? await tool('page_read', { id: panel.resourceId }) : await tool('file_read', { path: panel.resourceId });
    if (renderedPanel !== key) return;
    const draftKey = panel.kind + ':' + panel.resourceId, draft = drafts.get(draftKey);
    if (draft) resource.revision = draft.revision;
    $('panel-content').innerHTML = toolbar(resource.title || panel.title, '<span id="save-state">' + (draft ? 'Unsaved' : 'Saved') + '</span>' + (panel.kind === 'page' ? '<button id="preview-resource">Preview</button>' : '') + '<button id="save-resource">Save</button>') + `<textarea id="resource-editor" class="editor ${panel.kind === 'file' ? 'code-editor' : ''}" aria-label="${escape(panel.title)}">${escape(draft?.content ?? resource.content)}</textarea><div id="resource-preview" class="page-preview message assistant" hidden></div>`;
    if (panel.kind === 'page') $('preview-resource').onclick = () => {
      const preview = $('resource-preview'), editor = $('resource-editor');
      preview.innerHTML = markdown(editor.value); preview.hidden = !preview.hidden; editor.hidden = !preview.hidden;
      $('preview-resource').textContent = preview.hidden ? 'Preview' : 'Edit';
    };
    editorDirty = !!draft;
    $('resource-editor').oninput = () => { editorDirty = true; drafts.set(draftKey, { content: $('resource-editor').value, revision: resource.revision }); $('save-state').textContent = 'Unsaved'; };
    $('save-resource').onclick = attempt(async () => {
      const content = $('resource-editor').value;
      const saved = panel.kind === 'page' ? await tool('page_edit', { id: resource.id, revision: resource.revision, content }) : await tool('file_write', { path: resource.path, revision: resource.revision, content });
      resource.revision = saved.revision; drafts.delete(draftKey); editorDirty = false; $('save-state').textContent = 'Saved'; await refresh();
    });
    return;
  }
  if (panel.kind === 'terminal') {
    if (!terminalView) {
      renderedPanel = key;
      $('panel-content').innerHTML = toolbar(panel.title, '<span id="command-state"></span><button id="interrupt-command">Ctrl-C</button><button id="stop-command">Stop</button>') + '<div id="terminal-host" class="terminal-host" aria-label="Interactive terminal"></div>';
      const call = (name, input = {}) => tool(name, { id: panel.resourceId, ...input }, owner);
      terminalView = new WorkspaceTerminal({ key, host: $('terminal-host'), call,
        onError: notice, onStatus: command => {
          $('command-state').textContent = command.status === 'running' ? 'Running' : command.status === 'unavailable' ? 'Disconnected' : `Exited ${command.signal || command.exitCode || 0}`;
          $('command-state').title = command.error || '';
          if (command.error) notice(command.error);
          $('stop-command').disabled = command.status !== 'running'; $('interrupt-command').disabled = command.status !== 'running';
        } });
      $('stop-command').onclick = attempt(async () => { await call('terminal_stop'); await refresh(); });
      $('interrupt-command').onclick = () => terminalView?.enqueue('terminal_write', { text: '\x03' });
    }
    await terminalView.refresh();
    return;
  }
  if (panel.kind === 'chat') {
    const child = state.chats.find(c => c.id === panel.resourceId), run = state.runs.find(r => r.chatId === child?.id);
    if (!child) return;
    if (renderedPanel !== key) {
      renderedPanel = key;
      $('panel-content').innerHTML = toolbar(child.title, '<button id="open-child">Open chat</button>') + '<div id="child-messages" class="side-chat"></div><form id="child-form" class="terminal-input"><input id="child-prompt" aria-label="Message side chat" placeholder="Message this chat"><button>Send</button></form>';
      $('open-child').onclick = () => selectChat(child.id);
      $('child-form').onsubmit = attempt(async event => { event.preventDefault(); await api('send', { chatId: child.id, text: $('child-prompt').value, model: child.model || $('model').value }); $('child-prompt').value = ''; await refresh(); });
    }
    $('child-messages').innerHTML = messagesHTML(child.messages) + (run?.text ? markdown(run.text) : '');
    $('child-prompt').disabled = !!run;
  }
}
$('resume').onclick = attempt(async () => { await api('resume', { chatId, model: $('model').value }); await refresh(); });
for (const [button, kind] of [['open-schedules', 'schedules'], ['open-updates', 'activity']]) $(button).onclick = attempt(async () => { if (!chat()) return newChat(); await tool('panel_open', { kind, resourceId: chatId }); await refresh(); });
$('new-chat').onclick = newChat; $('start-chat').onclick = newChat;
$('search').oninput = render;
$('model').onchange = attempt(async () => { const owner = chatId, model = $('model').value; if (owner) await api('model', { chatId: owner, model }); modelChoices.set(owner, model); await refresh(); });
$('entry-cancel').onclick = () => { $('entry').close(); void syncBrowserBounds(); };
$('entry').addEventListener('close', () => void syncBrowserBounds());
$('entry-form').onsubmit = attempt(async event => { event.preventDefault(); await entryAction($('entry-input').value); $('entry').close(); notice(); });
$('composer').onsubmit = attempt(async event => { event.preventDefault(); await api('send', { chatId, text: $('prompt').value, model: $('model').value }); $('prompt').value = ''; notice(); await refresh(); });
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('send').disabled && !$('send').hidden) $('composer').requestSubmit(); } };
$('stop').onclick = attempt(async () => { await api('stop', { chatId }); await refresh(); });
document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => {
  if (!chat()) return newChat();
  const action = button.dataset.action;
  if (action === 'page') ask('Create a Page', 'Title', '', async title => { await tool('page_create', { title, content: '' }); await refresh(); });
  if (action === 'file') ask('Open a file', 'Path in this workspace', '', async resourceId => { await tool('panel_open', { kind: 'file', resourceId }); await refresh(); });
  if (action === 'browser') ask('Open a browser tab', 'URL', 'https://', async url => { await tool('browser_open', { url }); await refresh(); });
  if (action === 'terminal') ask('Open a terminal', 'Command (optional)', '', async command => { await tool('terminal_start', { command }); await refresh(); }, 'Leave blank for an interactive shell. Runs locally with your user permissions.');
  if (action === 'fork') ask('Create a side chat', 'Title', chat().title + ' — side chat', async title => { await tool('chat_fork', { title }); await refresh(); }, 'Starts with a copy of the current conversation. Later messages stay separate.');
});
$('limits').onclick = () => { if (!chat()) return newChat(); $('max-tabs').value = chat().limits.maxTabs; $('active-tabs').value = chat().limits.activeTabs; $('tool-rounds').value = chat().limits.maxToolRounds; $('limit-dialog').showModal(); };
$('limit-cancel').onclick = () => $('limit-dialog').close();
$('limit-dialog').addEventListener('close', () => void syncBrowserBounds());
$('limit-form').onsubmit = attempt(async event => { event.preventDefault(); await api('limits', { chatId, limits: { maxTabs: +$('max-tabs').value, activeTabs: +$('active-tabs').value, maxToolRounds: +$('tool-rounds').value } }); $('limit-dialog').close(); await refresh(); });
let dragWidth;
let lastBrowserLayout = '';
async function syncBrowserBounds() {
  if (!state?.capabilities.browser) return;
  const selected = chat()?.panels.find(p => p.id === chat().activePanelId);
  const viewport = $('browser-viewport');
  let input = { id: null };
  if (selected?.kind === 'browser' && viewport && !document.querySelector('dialog[open]')) {
    const r = viewport.getBoundingClientRect();
    input = { chatId, id: selected.resourceId, bounds: { x:r.x, y:r.y, width:r.width, height:r.height } };
  }
  const serialized = JSON.stringify(input); if (serialized === lastBrowserLayout) return;
  lastBrowserLayout = serialized;
  try { await api('browser-layout', input); } catch (error) { lastBrowserLayout = ''; notice(error.message); }
}
new ResizeObserver(() => void syncBrowserBounds()).observe($('panel-content'));
$('resize').onpointerdown = event => { $('resize').setPointerCapture(event.pointerId); dragWidth = chat().layout.width; };
$('resize').onpointermove = event => { if ($('resize').hasPointerCapture(event.pointerId)) { dragWidth = Math.max(280, Math.min(innerWidth * .6, innerWidth - event.clientX)); document.documentElement.style.setProperty('--panel-width', dragWidth + 'px'); } };
$('resize').onpointerup = attempt(async event => { $('resize').releasePointerCapture(event.pointerId); await api('layout', { chatId, width: dragWidth, position: 'right' }); await refresh(); });
$('resize').onkeydown = attempt(async event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); await api('layout', { chatId, width: Math.max(280, Math.min(1600, chat().layout.width + (event.key === 'ArrowLeft' ? 20 : -20))), position: 'right' }); await refresh(); } });
window.addEventListener('beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = ''; } });
void attempt(async () => {
  const token = location.hash.slice(1); history.replaceState(null, '', location.pathname);
  if (token) { const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); if (!response.ok) throw Error('Reopen the workspace from E1.'); }
  await refresh();
  const events = new EventSource('/api/workspace/events'); events.onmessage = scheduleRefresh;
  events.onerror = () => notice('Reconnecting to the workspace…'); events.onopen = () => notice();
})();

const scheduleDrafts = new Map();
function localDateTime(timestamp) {
  const date = new Date(timestamp); return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function scheduleFields(schedule) {
  return `<label>Title<input name="title" maxlength="160" required value="${escape(schedule.title || '')}"></label>
    <label>Instructions<textarea name="prompt" required rows="3" maxlength="120000">${escape(schedule.prompt || '')}</textarea></label>
    <label>Run at<input name="nextRunAt" type="datetime-local" required value="${escape(localDateTime(schedule.nextRunAt || Date.now() + 3600000))}"></label>
    <div class="schedule-options"><label>Repeat every (minutes)<input name="intervalMinutes" type="number" min="1" max="525600" placeholder="Once" value="${schedule.intervalMinutes || ''}"></label>
    <label>Notify me<select name="notificationPolicy"><option value="all"${schedule.notificationPolicy !== 'failures' ? ' selected' : ''}>After each run</option><option value="failures"${schedule.notificationPolicy === 'failures' ? ' selected' : ''}>If attention is needed</option></select></label></div>`;
}
function readScheduleForm(form) {
  return { title: form.elements.title.value, prompt: form.elements.prompt.value,
    nextRunAt: new Date(form.elements.nextRunAt.value).getTime(),
    intervalMinutes: form.elements.intervalMinutes.value ? Number(form.elements.intervalMinutes.value) : null,
    notificationPolicy: form.elements.notificationPolicy.value,
    ...(form.elements.enabled ? { enabled: form.elements.enabled.checked } : {}) };
}
function renderSchedules(key, owner) {
  const schedules = (state.schedules || []).filter(s => s.chatId === owner);
  const roster = schedules.map(s => s.id).join(':');
  if (renderedPanel !== key || $('schedule-list')?.dataset.roster !== roster) {
    renderedPanel = key;
    $('panel-content').innerHTML = toolbar('Schedules') + '<div class="schedule-panel"><p class="schedule-help">Runs in this chat while E1 is open. Missed runs are combined into one when E1 reopens. Interrupted or failed runs pause for review.</p><div id="schedule-list"></div><details open><summary>New schedule</summary><form id="new-schedule" class="schedule-form">' + scheduleFields({}) + '<button class="primary" type="submit">Create schedule</button></form></details></div>';
    $('schedule-list').dataset.roster = roster;
    for (const schedule of schedules) {
      const container = document.createElement('details'); container.dataset.schedule = schedule.id;
      container.innerHTML = `<summary>${escape(schedule.title)}<span class="schedule-status"></span></summary><p class="schedule-run"></p><form class="schedule-form">${scheduleFields(schedule)}<label class="check-label"><input type="checkbox" name="enabled" ${schedule.enabled ? 'checked' : ''}> Enabled</label><div class="schedule-buttons"><button type="submit">Save changes</button><button type="button" data-delete>Delete</button></div></form>`;
      $('schedule-list').append(container);
      container.querySelector('[data-delete]').onclick = attempt(async () => { await tool('schedule_delete', { id: schedule.id }, owner); scheduleDrafts.delete(owner + ':' + schedule.id); await refresh(); });
      const form = container.querySelector('form');
      bindScheduleDraft(form, owner + ':' + schedule.id);
      form.onsubmit = attempt(async event => { event.preventDefault(); await tool('schedule_update', { id: schedule.id, ...readScheduleForm(form) }, owner); scheduleDrafts.delete(owner + ':' + schedule.id); renderedPanel = null; await refresh(); notice(); });
    }
    const form = $('new-schedule'); bindScheduleDraft(form, owner + ':new');
    form.onsubmit = attempt(async event => { event.preventDefault(); await tool('schedule_create', readScheduleForm(form), owner); scheduleDrafts.delete(owner + ':new'); renderedPanel = null; await refresh(); notice(); });
  }
  for (const container of $('schedule-list').children) {
    const schedule = schedules.find(s => s.id === container.dataset.schedule);
    container.querySelector('.schedule-status').textContent = schedule.enabled ? 'Scheduled' : 'Paused';
    container.querySelector('.schedule-run').textContent = schedule.lastRun ? `Last run: ${schedule.lastRun.status}${schedule.lastRun.text ? '. ' + schedule.lastRun.text : ''}` : 'No runs yet.';
  }
}
function bindScheduleDraft(form, key) {
  const draft = scheduleDrafts.get(key);
  if (draft) for (const [name, value] of Object.entries(draft)) {
    if (name === 'enabled') form.elements[name].checked = value;
    else form.elements[name].value = value;
  }
  form.oninput = () => scheduleDrafts.set(key, Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value])));
}
function renderUpdates(key, owner) {
  renderedPanel = key;
  const notifications = (state.notifications || []).filter(n => n.chatId === owner).toReversed();
  $('panel-content').innerHTML = toolbar('Updates') + '<div class="schedule-panel">' + (notifications.length ? notifications.map(n => `<article class="update-item"><strong>${escape(n.title)}</strong><small>${escape(new Date(n.createdAt).toLocaleString())} · ${escape(n.status)}</small><p>${escape(n.text)}</p>${n.read ? '' : `<button data-read="${n.id}">Mark read</button>`}</article>`).join('') : '<p class="schedule-help">Completed runs and work that needs your attention will appear here.</p>') + '</div>';
  $('panel-content').querySelectorAll('[data-read]').forEach(button => button.onclick = attempt(async () => { await api('notification-read', { id: button.dataset.read }); await refresh(); }));
}
