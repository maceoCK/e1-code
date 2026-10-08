(() => {
  if (window.__e1WorkflowPicker) return;
  window.__e1WorkflowPicker = true;
  const api = window.e1WorkflowPreferences;
  if (!api) return;
  const selector = '[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  let state, scheduled = false, lastPicker, dialog;
  const controls = new Map();
  const style = document.createElement('style');
  style.textContent = `
    .e1-subagents-button { color:inherit; background:transparent; border:0; border-radius:6px; font:inherit; font-size:12px; padding:5px 7px; cursor:pointer; opacity:.8; white-space:nowrap; }
    .e1-subagents-button:hover { background:#819c8c20; opacity:1; }
    .e1-subagents-button:focus-visible, .e1-workflow-dialog :focus-visible { outline:2px solid #729c89; outline-offset:2px; }
    .e1-subagents-menu { display:block; width:100%; text-align:left; border-top:1px solid #87968b33; margin-top:4px; padding:10px; }
    .e1-workflow-dialog { color:#26352d; background:#f1f3ef; border:1px solid #81918555; border-radius:12px; padding:24px; width:420px; max-width:calc(100vw - 40px); box-shadow:0 12px 50px #0003; font:14px/1.5 system-ui; }
    .e1-workflow-dialog::backdrop { background:#07140d66; }
    .e1-workflow-dialog h2 { margin:0 0 4px; font-size:19px; font-weight:600; letter-spacing:-.02em; }
    .e1-workflow-dialog p { margin:0 0 20px; opacity:.7; font-size:12px; }
    .e1-workflow-dialog label { display:block; margin:16px 0 6px; font-weight:500; }
    .e1-workflow-dialog select { display:block; width:100%; color:inherit; background:transparent; border:1px solid #81918577; border-radius:7px; padding:9px; font:inherit; }
    .e1-workflow-dialog option { color:#26352d; background:#f1f3ef; }
    .e1-workflow-dialog footer { display:flex; justify-content:flex-end; gap:8px; margin-top:22px; }
    .e1-workflow-dialog button { color:inherit; border:1px solid #81918555; background:transparent; border-radius:7px; font:inherit; padding:7px 12px; cursor:pointer; }
    .e1-workflow-dialog button[type=submit] { background:#35665b; color:white; border-color:transparent; }
    .e1-workflow-dialog [role=status] { min-height:18px; font-size:12px; color:#a44b30; margin-top:10px; }
    @media(prefers-color-scheme:dark) { .e1-workflow-dialog, .e1-workflow-dialog option { background:#202a24; color:#e0e7df; } .e1-workflow-dialog [role=status] { color:#eab48e; } }
  `;
  document.head.append(style);
  function context(picker) {
    const name = (picker.getAttribute('aria-label')?.replace(/^Model:\s*/, '') || picker.textContent).trim();
    const model = state?.models.find(m => m.name === name);
    const pane = picker.closest('.dframe-pane, [aria-label="Primary pane"], [aria-label="Secondary pane"]');
    const ids = [...new Set([picker.closest('[data-session-id]')?.getAttribute('data-session-id'),
      ...[...(pane?.querySelectorAll('[data-session-id]') || [])].map(el => el.getAttribute('data-session-id'))].filter(Boolean))];
    return model ? { model, chatId: ids.length === 1 ? ids[0] : null } : null;
  }
  function preference(ctx) { return state.preferences.chats?.[ctx.chatId] || state.preferences.models?.[ctx.model.id] || { model:'', effort:'' }; }
  async function open(picker) {
    state = await api.read();
    const ctx = context(picker); if (!ctx) return;
    dialog?.remove(); dialog = document.createElement('dialog'); dialog.className = 'e1-workflow-dialog';
    dialog.setAttribute('aria-labelledby','e1-workflow-title');
    dialog.innerHTML = '<form><h2 id="e1-workflow-title">Workflow subagents</h2><p class="e1-workflow-scope"></p><label for="e1-worker-model">Subagent model</label><select id="e1-worker-model"></select><label for="e1-worker-effort">Subagent effort</label><select id="e1-worker-effort"></select><p style="margin-top:14px;margin-bottom:0">Your main chat keeps its model. Applies to subsequent workflow subagent requests, including Ultracode.</p><div role="status"></div><footer><button type="button" data-reset>Reset</button><button type="button" data-cancel>Cancel</button><button type="submit">Save changes</button></footer></form>';
    dialog.querySelector('.e1-workflow-scope').textContent = ctx.chatId ? 'For this chat' : 'Default for chats using ' + ctx.model.name;
    const model = dialog.querySelector('#e1-worker-model'), effort = dialog.querySelector('#e1-worker-effort'), pref = preference(ctx);
    model.add(new Option('Same as main chat', ''));
    for (const item of state.models) model.add(new Option(item.name,item.id));
    if (pref.model && !state.models.some(m => m.id === pref.model)) model.add(new Option('Unavailable model — choose another',pref.model));
    model.value = pref.model;
    function efforts(value='') {
      effort.replaceChildren(new Option('Inherit chat effort',''));
      const chosen = state.models.find(m => m.id === model.value) || ctx.model;
      for (const level of chosen.efforts) effort.add(new Option(({xhigh:'Extra',none:'None'})[level] || level[0].toUpperCase()+level.slice(1),level));
      effort.value = [...effort.options].some(o => o.value === value) ? value : '';
    }
    efforts(pref.effort); model.onchange = () => efforts(effort.value);
    const close = () => { dialog.close(); dialog.remove(); dialog=null; picker.focus(); };
    dialog.querySelector('[data-cancel]').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    async function save(reset=false) {
      const status = dialog.querySelector('[role=status]'), submit = dialog.querySelector('[type=submit]'); submit.disabled = true;
      try { state = await api.save({ parentModel:ctx.model.id, chatId:ctx.chatId, model:model.value, effort:effort.value, reset }); close(); schedule(); }
      catch(error) { status.textContent = error.message; submit.disabled = false; }
    }
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); void save(); };
    dialog.querySelector('[data-reset]').onclick = () => void save(true);
    document.body.append(dialog); dialog.showModal(); model.focus();
  }
  function button(picker, menu=false) {
    const el = document.createElement('button'); el.type='button'; el.className='e1-subagents-button'+(menu?' e1-subagents-menu':'');
    el.textContent = menu ? 'Workflow subagents…' : 'Subagents';
    el.onclick = event => { event.preventDefault(); event.stopPropagation(); void open(picker).catch(error => {
      const message = document.createElement('span'); message.setAttribute('role','status');
      message.textContent = 'Could not open subagent settings: '+error.message;
      picker.insertAdjacentElement('afterend',message); setTimeout(()=>message.remove(),10000);
    }); };
    return el;
  }
  function render() {
    scheduled = false; observer.disconnect(); const seen = new Set();
    const pickers = new Set([...document.querySelectorAll(selector)].map(el => el.matches('button') ? el : el.querySelector('button')).filter(Boolean));
    for (const picker of pickers) {
      if (!picker.getClientRects().length || picker.closest('[role=dialog], [role=menu], .e1-workflow-dialog')) continue;
      const ctx = context(picker); if (!ctx) continue; seen.add(picker);
      let control = controls.get(picker);
      if (!control?.isConnected) { control=button(picker); picker.insertAdjacentElement('afterend',control); controls.set(picker,control); }
      const pref = preference(ctx), chosen = state.models.find(m => m.id === pref.model);
      const title = 'Workflow subagents: '+(chosen?.name || (pref.model ? 'Unavailable model' : 'Same as main chat'))+(pref.effort ? ' · '+pref.effort : '');
      if (control.title !== title) { control.title=title; control.setAttribute('aria-label',title); }
    }
    for (const [picker, control] of controls) if (!seen.has(picker)) { control.remove(); controls.delete(picker); }
    if (lastPicker?.isConnected && lastPicker.getAttribute('aria-expanded') === 'true') {
      const menu = document.getElementById(lastPicker.getAttribute('aria-controls'));
      if (menu && !menu.querySelector('.e1-subagents-menu')) menu.append(button(lastPicker,true));
    }
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','aria-expanded','data-session-id','hidden']});
  }
  function schedule() { if (!scheduled) { scheduled=true; setTimeout(render,80); } }
  const observer = new MutationObserver(schedule);
  document.addEventListener('click',event => { const p=event.target.closest(selector); if(p) { lastPicker=p.matches('button')?p:p.querySelector('button'); schedule(); } },true);
  api.read().then(value => { state=value; schedule(); }).catch(() => {});
})();
