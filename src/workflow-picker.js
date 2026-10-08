(() => {
  if (window.__e1WorkflowPicker) return;
  window.__e1WorkflowPicker = true;
  const api = window.e1WorkflowPreferences;
  if (!api) return;
  const selector = '[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  let state, scheduled = false, lastPicker;
  const controls = new Map();
  const style = document.createElement('style');
  style.textContent = `
    .e1-subagents-button { color:inherit; background:transparent; border:0; border-radius:6px; font:inherit; font-size:12px; padding:5px 7px; cursor:pointer; opacity:.8; white-space:nowrap; }
    .e1-subagents-button:hover { background:#819c8c20; opacity:1; }
    .e1-subagents-button:focus-visible { outline:2px solid #729c89; outline-offset:2px; }
    .e1-subagents-menu { display:block; width:100%; text-align:left; border-top:1px solid #87968b33; margin-top:4px; padding:10px; }
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
  function open(picker, trigger) {
    const ctx = context(picker); if (!ctx) return;
    return window.e1PreferenceDialog.open({
      trigger,
      read: () => api.read(),
      isCurrent: () => {
        const now = context(picker);
        return picker.isConnected && now?.chatId === ctx.chatId && now?.model.id === ctx.model.id;
      },
      configure(data) {
        state = data;
        const pref = preference(ctx);
        const modelItems = [{label:'Same as main chat',value:''}, ...window.E1ModelList.items(data.models,{showLegacy:data.modelBrowser?.showLegacy,selected:pref.model})];
        if (pref.model && !data.models.some(m => m.id === pref.model)) modelItems.push({label:'Unavailable model — choose another',value:pref.model});
        const efforts = values => (data.models.find(m => m.id === values.model) || ctx.model).efforts;
        const normalize = values => ({...values, effort: efforts(values).includes(values.effort) ? values.effort : ''});
        return {
          id:'workflow', title:'Workflow subagents',
          description:ctx.chatId ? 'For this chat' : 'Default for chats using ' + ctx.model.name,
          values:normalize({model:pref.model || '',effort:pref.effort || ''}), reset:true,
          fields:values => [
            {name:'model',label:'Subagent model',items:modelItems,filter:(item,query)=>window.E1ModelList.matches(item,query)},
            {name:'effort',label:'Subagent effort',items:[{label:'Inherit chat effort',value:''}, ...efforts(values).map(value => ({value,label:({xhigh:'Extra',none:'None'})[value] || value[0].toUpperCase()+value.slice(1)}))]},
          ],
          normalize,
          note:() => 'Used for new workflow tasks, including Ultracode. Your main chat keeps its model.',
          save:(values,reset) => api.save({parentModel:ctx.model.id,chatId:ctx.chatId,...values,reset}),
        };
      },
      onSaved:updated => { state=updated; schedule(); },
    });
  }
  function button(picker, menu=false) {
    const el = document.createElement('button'); el.type='button'; el.className='e1-subagents-button'+(menu?' e1-subagents-menu':'');
    el.textContent = menu ? 'Workflow subagents…' : 'Subagents';
    el.onclick = event => { event.preventDefault(); event.stopPropagation();
      if (menu && picker.getAttribute('aria-expanded') === 'true') picker.click();
      void open(picker, menu ? controls.get(picker) || picker : el)?.catch(error => {
      const message = document.createElement('span'); message.setAttribute('role','status');
      message.textContent = 'Could not open subagent settings: '+error.message;
      picker.insertAdjacentElement('afterend',message); setTimeout(()=>message.remove(),10000);
    }); };
    return el;
  }
  function render() {
    scheduled = false; observer.disconnect(); const seen = new Set();
    try {
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
    } finally { observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','aria-expanded','data-session-id','hidden']}); }
  }
  function schedule() { if (!scheduled) { scheduled=true; setTimeout(render,80); } }
  const observer = new MutationObserver(schedule);
  document.addEventListener('click',event => { const p=event.target.closest(selector); if(p) { lastPicker=p.matches('button')?p:p.querySelector('button'); schedule(); } },true);
  api.read().then(value => { state=value; schedule(); }).catch(() => {});
})();
