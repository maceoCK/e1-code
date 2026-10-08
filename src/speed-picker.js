(() => {
  if(window.__e1SpeedPicker || !window.e1SpeedPreferences) return;
  window.__e1SpeedPicker=true;
  const api=window.e1SpeedPreferences, selector='[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  let state,scheduled=false;
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
  function open(picker, trigger) {
    const ctx=context(picker);if(!ctx)return;
    return window.e1PreferenceDialog.open({
      trigger, read:()=>api.read(),
      isCurrent:()=>{const now=context(picker);return picker.isConnected&&now?.chatId===ctx.chatId&&now?.model.id===ctx.model.id;},
      configure(data){
        state=data;
        const model=state.models.find(m=>m.id===ctx.model.id)||ctx.model, pref=preference(ctx);
        const paid=v=>v.mode!=='standard',connection=v=>model.connections.find(c=>c.id===v.apiProvider);
        return {
          id:'speed',title:'Inference speed',description:ctx.chatId?'For this chat · '+model.name:'Default for chats using '+model.name,
          values:{mode:model.modes.includes(pref.mode)?pref.mode:'standard',apiProvider:model.connections.some(c=>c.id===pref.apiProvider)?pref.apiProvider:model.connections[0]?.id||''},
          fields:v=>[
            {name:'mode',label:'Speed',items:model.modes.map(value=>({value,label:names[value]}))},
            {name:'apiProvider',label:'API connection',hidden:!paid(v),disabled:!model.connections.length,items:model.connections.map(c=>({value:c.id,label:c.name}))},
          ],
          note:v=>!paid(v)
            ? model.modes.length===1?'This model supports Standard speed here. Claude Fast requires a supported Opus model. Your model will not be changed automatically.':'Standard restores your normal account-routing settings, including your configured API fallback.'
            : connection(v)?names[v.mode]+' uses paid API billing through '+connection(v).name+', at premium rates outside your subscription allowance. '+model.name+' and your chat history stay the same. '+(ctx.chatId?'This applies to subsequent requests in this chat.':'This becomes the default for chats using this model unless they have their own speed setting.')+' Provider access and capacity still apply.':'No configured API connection offers this exact model. Add one in Accounts & billing, then reopen this control. Nothing will be switched or charged.',
          canSave:v=>!paid(v)||!!connection(v),
          saveLabel:v=>paid(v)?'Enable '+names[v.mode]+' · use paid API':'Use Standard',
          save:v=>api.save({parentModel:ctx.model.id,chatId:ctx.chatId,...v,confirmPaid:paid(v)}),
        };
      },
      onSaved:updated=>{state=updated;schedule();},
    });
  }
  function render() {
    scheduled=false;observer.disconnect();const seen=new Set();
    try {
    const pickers=new Set([...document.querySelectorAll(selector)].map(el=>el.matches('button')?el:el.querySelector('button')).filter(Boolean));
    for(const picker of pickers){
      if(!picker.getClientRects().length||picker.closest('[role=dialog], [role=menu], dialog'))continue;
      const ctx=context(picker);if(!ctx)continue;seen.add(picker);
      let control=controls.get(picker);
      if(!control?.isConnected){control=document.createElement('button');control.type='button';control.className='e1-subagents-button e1-speed-button';control.style.webkitAppRegion='no-drag';
        control.onclick=event=>{event.preventDefault();event.stopPropagation();open(picker,control)?.catch(error=>{control.title=error.message;});};
        picker.insertAdjacentElement('afterend',control);controls.set(picker,control);}
      const pref=preference(ctx),text=pref.mode==='standard'?'Speed':names[pref.mode]+' · API',label='Inference speed: '+names[pref.mode]+(pref.mode==='standard'?'':' · paid API');
      if(control.textContent!==text)control.textContent=text;
      if(control.getAttribute('aria-label')!==label)control.setAttribute('aria-label',label);
      control.style.color=pref.mode==='standard'?'':'#bf851e';
    }
    for(const [picker,control] of controls)if(!seen.has(picker)){control.remove();controls.delete(picker);}
    } finally { observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','data-session-id','hidden']}); }
  }
  function schedule(){if(!scheduled){scheduled=true;setTimeout(render,80);}}
  const observer=new MutationObserver(schedule);
  api.read().then(value=>{state=value;schedule();}).catch(()=>{});
})();
