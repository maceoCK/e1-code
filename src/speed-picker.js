(() => {
  if(window.__e1SpeedPicker || !window.e1SpeedPreferences) return;
  window.__e1SpeedPicker=true;
  const api=window.e1SpeedPreferences, selector='[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  let state,scheduled=false,dialog;
  const controls=new Map(), names={standard:'Standard',fast:'Fast',ultrafast:'Ultrafast'};
  function context(picker) {
    const name=(picker.getAttribute('aria-label')?.replace(/^Model:\s*/,'')||picker.textContent).trim();
    const model=state?.models.find(m=>m.name===name);
    const pane=picker.closest('.dframe-pane, [aria-label="Primary pane"], [aria-label="Secondary pane"]');
    const ids=[...new Set([picker.closest('[data-session-id]')?.getAttribute('data-session-id'),
      ...[...(pane?.querySelectorAll('[data-session-id]')||[])].map(el=>el.getAttribute('data-session-id'))].filter(Boolean))];
    return model?{model,chatId:ids.length===1?ids[0]:null}:null;
  }
  const preference=ctx=>state.preferences.chats?.[ctx.chatId]?.[ctx.model.id]||state.preferences.models?.[ctx.model.id]||{mode:'standard'};
  async function open(picker) {
    state=await api.read();const ctx=context(picker);if(!ctx)return;
    dialog?.remove();dialog=document.createElement('dialog');dialog.className='e1-workflow-dialog';
    dialog.setAttribute('aria-labelledby','e1-speed-title');
    dialog.innerHTML='<form><h2 id="e1-speed-title">Inference speed</h2><p data-scope></p><label for="e1-speed-mode">Speed</label><select id="e1-speed-mode"></select><div data-paid><label for="e1-speed-account">API connection</label><select id="e1-speed-account"></select><p data-warning style="margin-top:16px;opacity:1"></p></div><p data-standard style="margin-top:16px"></p><div role="status"></div><footer><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></footer></form>';
    dialog.querySelector('[data-scope]').textContent=ctx.chatId?'For this chat · '+ctx.model.name:'Default for chats using '+ctx.model.name;
    const mode=dialog.querySelector('#e1-speed-mode'),account=dialog.querySelector('#e1-speed-account'),submit=dialog.querySelector('[type=submit]'),pref=preference(ctx);
    for(const id of ctx.model.modes)mode.add(new Option(names[id],id));
    mode.value=ctx.model.modes.includes(pref.mode)?pref.mode:'standard';
    for(const c of ctx.model.connections)account.add(new Option(c.name,c.id));
    if(ctx.model.connections.some(c=>c.id===pref.apiProvider))account.value=pref.apiProvider;
    const close=()=>{dialog.close();dialog.remove();dialog=null;picker.focus();};
    function update() {
      const paid=mode.value!=='standard',connection=ctx.model.connections.find(c=>c.id===account.value);
      dialog.querySelector('[data-paid]').hidden=!paid;
      dialog.querySelector('[data-standard]').hidden=paid;
      dialog.querySelector('[data-standard]').textContent=ctx.model.modes.length===1
        ?'This model supports Standard speed here. Claude Fast requires a supported Opus model. Your model will not be changed automatically.'
        :'Standard restores your normal account-routing settings, including your configured API fallback.';
      dialog.querySelector('[data-warning]').textContent=connection
        ? names[mode.value]+' uses paid API billing through '+connection.name+', at premium rates outside your subscription allowance. '+ctx.model.name+' and your chat history stay the same. '+(ctx.chatId?'This applies to subsequent requests in this chat.':'This becomes the default for chats using this model unless they have their own speed setting.')+' Provider access and capacity still apply.'
        :'No configured API connection offers this exact model. Add one in Accounts & billing, then reopen this control. Nothing will be switched or charged.';
      submit.disabled=paid&&!connection;submit.textContent=paid?'Enable '+names[mode.value]+' · use paid API':'Use Standard';
    }
    mode.onchange=update;account.onchange=update;update();
    dialog.querySelector('[data-cancel]').onclick=close;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;
      try {state=await api.save({parentModel:ctx.model.id,chatId:ctx.chatId,mode:mode.value,apiProvider:account.value,confirmPaid:mode.value!=='standard'});close();schedule();}
      catch(error){dialog.querySelector('[role=status]').textContent=error.message;update();}
    };
    document.body.append(dialog);dialog.showModal();mode.focus();
  }
  function render() {
    scheduled=false;observer.disconnect();const seen=new Set();
    const pickers=new Set([...document.querySelectorAll(selector)].map(el=>el.matches('button')?el:el.querySelector('button')).filter(Boolean));
    for(const picker of pickers){
      if(!picker.getClientRects().length||picker.closest('[role=dialog], [role=menu], dialog'))continue;
      const ctx=context(picker);if(!ctx)continue;seen.add(picker);
      let control=controls.get(picker);
      if(!control?.isConnected){control=document.createElement('button');control.type='button';control.className='e1-subagents-button e1-speed-button';control.style.webkitAppRegion='no-drag';
        control.onclick=event=>{event.preventDefault();event.stopPropagation();open(picker).catch(error=>{control.title=error.message;});};
        picker.insertAdjacentElement('afterend',control);controls.set(picker,control);}
      const pref=preference(ctx),text=pref.mode==='standard'?'Speed':names[pref.mode]+' · API',label='Inference speed: '+names[pref.mode]+(pref.mode==='standard'?'':' · paid API');
      if(control.textContent!==text)control.textContent=text;
      if(control.getAttribute('aria-label')!==label)control.setAttribute('aria-label',label);
      control.style.color=pref.mode==='standard'?'':'#bf851e';
    }
    for(const [picker,control] of controls)if(!seen.has(picker)){control.remove();controls.delete(picker);}
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','data-session-id','hidden']});
  }
  function schedule(){if(!scheduled){scheduled=true;setTimeout(render,80);}}
  const observer=new MutationObserver(schedule);
  api.read().then(value=>{state=value;schedule();}).catch(()=>{});
})();
