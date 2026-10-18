(() => {
  if (window.__e1BillingInstalled) return;
  window.__e1BillingInstalled = true;
  const pickerSelector = '[data-testid="epitaxy-cds-model-selector"], [data-testid="model-selector-dropdown"], button[aria-label^="Model:"]';
  const sidebarSelector = '.dframe-sidebar, [aria-label="Sidebar"], [data-testid="sidebar"]';
  const rowSelector = '[data-row-key], [data-select-row-key]';
  let snapshot = { chats: [], catalog: [] }, scheduled = false;
  const decorations = new Map();
  const style = document.createElement('style');
  style.textContent = `
    [data-e1-billing="api"], [data-e1-billing="account"] { box-shadow: inset 0 0 0 1.5px #bf851e !important; }
    [data-e1-billing="subscription"] { box-shadow: inset 0 0 0 1px #53816e !important; }
    .e1-billing-chip { display:inline-flex; align-items:center; gap:4px; flex:none; vertical-align:middle; white-space:nowrap; border-radius:4px; padding:2px 5px; font:500 10px/14px system-ui; letter-spacing:.015em; color:#80500b; background:#f3d89555; }
    .e1-billing-chip[data-billing="subscription"] { color:var(--cds-clay,#35665b); background:#b9d8c833; }
    .e1-billing-chip[data-billing="local"], .e1-billing-chip[data-billing="paused"] { color:var(--text-secondary,#777); background:transparent; }
    .e1-billing-chip[data-running="true"]::before { content:''; width:4px; height:4px; border-radius:50%; background:currentColor; }
    .e1-billing-model { margin-inline:4px; }
    .e1-billing-sidebar { margin-inline-start:auto; }
    .e1-billing-chip:focus-visible { outline:2px solid #729c89; outline-offset:2px; }
    .e1-billing-tooltip { position:fixed; z-index:2147483647; pointer-events:auto; width:340px; max-height:calc(100vh - 24px); overflow:auto; max-width:calc(100vw - 24px); padding:12px 14px; border:1px solid var(--cds-border-strong,#87968b55); border-radius:12px; color:var(--cds-text-primary,#26352d); background:var(--cds-surface-2,#f1f3ef); box-shadow:0 4px 18px #0002; font:12px/1.5 system-ui; overflow-wrap:anywhere; }
    .e1-billing-tooltip strong { display:block; font-weight:600; margin-bottom:3px; }
    .e1-billing-tooltip .e1-usage { margin-top:12px; padding-top:10px; border-top:1px solid var(--cds-border-strong,#87968b55); }
    .e1-billing-tooltip .e1-usage-window { margin-bottom:12px; }
    .e1-billing-tooltip .e1-usage-label { display:flex; justify-content:space-between; gap:12px; }
    .e1-billing-tooltip .e1-usage-track { height:5px; border-radius:5px; overflow:hidden; background:var(--cds-fill-ghost-hover,#87968b33); margin:6px 0; }
    .e1-billing-tooltip .e1-usage-fill { height:100%; background:var(--cds-text-primary,#53816e); border-radius:inherit; }
    .e1-billing-tooltip .e1-usage-heading { font-weight:600; margin-bottom:6px; }
    .e1-billing-tooltip .e1-price-context { font-weight:500; margin-top:8px; }
    .e1-billing-tooltip .e1-price-source { color:inherit; text-decoration:underline; font-size:11px; }
    .e1-billing-tooltip .e1-usage-note { font-size:11px; color:var(--cds-text-secondary,#66736b); }
  `;
  document.head.append(style);
  // Remove the previous global treatment when this is loaded during development.
  document.querySelector('#e1-api-billing-border')?.remove();
  document.querySelector('#e1-billing-indicator')?.remove();
  const labels = { api: 'API', account: 'Check billing', subscription: 'Plan', local: 'Local', paused: 'Paused' };
  const attr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
  const tooltip = document.createElement('div'); tooltip.id='e1-billing-tooltip'; tooltip.className='e1-billing-tooltip'; tooltip.role='tooltip'; tooltip.hidden=true;
  document.body.append(tooltip);
  let hovered, anchor, hideTimer;
  const refreshDetails=()=>{if(hovered)showDetails(hovered,anchor,anchor!==hovered||!hovered.planProvider);};
  const enterDetails=(...args)=>{clearTimeout(hideTimer);showDetails(...args);};
  const usageCache=new Map(),usagePending=new Map();
  function usageFor(chip){return usageCache.get(chip.usageKey)?.value;}
  function loadUsage(chip){
    const key=chip.usageKey;if(!key||!window.e1PlanUsage?.read)return;
    const cached=usageCache.get(key);if(cached&&Date.now()-cached.at<(cached.value.state==='live'?60000:15000)||usagePending.has(key))return;
    usagePending.set(key,true);
    window.e1PlanUsage.read(chip.planProvider).then(value=>usageCache.set(key,{at:Date.now(),value})).catch(()=>usageCache.set(key,{at:Date.now(),value:{windows:[],state:'unavailable',note:'Usage could not be loaded. Hover again to retry.'}})).finally(()=>{usagePending.delete(key);if(hovered?.usageKey===key)refreshDetails();});
  }
  function appendUsage(container,chip){
    if(!chip.usageKey)return;const section=document.createElement('section');section.className='e1-usage';section.setAttribute('aria-label','Plan usage');container.append(section);
    const add=(text,cls='e1-usage-note')=>{const n=document.createElement('div');n.className=cls;n.textContent=text;section.append(n);return n;};
    add('Usage limits & resets','e1-usage-heading');
    const data=usageFor(chip);if(!data){add(window.e1PlanUsage?'Loading plan usage…':'Usage data is unavailable.');return;}
    for(const w of data.windows||[]){const row=document.createElement('div');row.className='e1-usage-window';const label=document.createElement('div');label.className='e1-usage-label';const name=document.createElement('span');name.textContent=w.label;const value=document.createElement('span');
      const expired=w.resetsAt!=null&&w.resetsAt<=Date.now();const pct=typeof w.usedPercent==='number'&&!expired?w.usedPercent:null;
      value.textContent=pct==null?'Not reported':Math.round(pct)+'% used';label.append(name,value);row.append(label);
      if(pct!=null){const track=document.createElement('div');track.className='e1-usage-track';track.role='meter';track.setAttribute('aria-label',w.label+' used');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(pct));const fill=document.createElement('div');fill.className='e1-usage-fill';fill.style.width=pct+'%';track.append(fill);row.append(track);}
      const reset=document.createElement('div');reset.className='e1-usage-note';
      if(expired)reset.textContent='Reset passed · waiting for updated usage';
      else if(w.resetsAt){const mins=Math.max(1,Math.ceil((w.resetsAt-Date.now())/60000));const relative=mins>=1440?Math.floor(mins/1440)+'d '+Math.floor(mins%1440/60)+'h':mins>=60?Math.floor(mins/60)+'h '+mins%60+'m':mins+'m';const exact=new Date(w.resetsAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});reset.textContent=(pct==null?'':Math.round(100-pct)+'% left · ')+'Resets in '+relative;const date=document.createElement('div');date.className='e1-usage-note';date.textContent=exact;reset.append(document.createElement('br'),date);}
      else reset.textContent=(pct==null?'':Math.round(100-pct)+'% left · ')+'Reset time not reported';row.append(reset);section.append(row);
    }
    if(data.extraUsage)add('Extra usage is enabled.');
    if(data.note)add(data.note);
    if(data.checkedAt)add((data.state==='live'?'Updated ':'Last reported ')+new Date(data.checkedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
  }
  const usageTimer=setInterval(()=>{if(hovered?.usageKey){loadUsage(hovered);tooltip.dataset.content='';refreshDetails();}},60000);
  window.addEventListener('beforeunload',()=>clearInterval(usageTimer));
  function hideDetails() {
    clearTimeout(hideTimer);anchor?.removeAttribute('aria-describedby'); hovered=null;anchor=null;tooltip.hidden=true;
  }
  function leaveDetails(event){
    if(tooltip.contains(event.relatedTarget)||event.relatedTarget===anchor)return;
    clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(document.activeElement!==anchor&&!tooltip.contains(document.activeElement))hideDetails();},120);
  }
  tooltip.addEventListener('mouseenter',()=>clearTimeout(hideTimer));tooltip.addEventListener('mouseleave',leaveDetails);
  tooltip.addEventListener('focusout',leaveDetails);
  function appendPricing(container,chip){
    const p=chip.pricing;if(!p)return;
    const section=document.createElement('section');section.className='e1-usage';section.setAttribute('aria-label','Model pricing');container.append(section);
    const add=(text,cls='e1-usage-note')=>{const el=document.createElement('div');el.className=cls;el.textContent=text;section.append(el);return el;};
    add(p.reference?'API price for reference':'Model pricing','e1-usage-heading');
    if(p.reference)add('Using subscription allowance. These are separate API rates.');
    if(p.state==='published'){
      add(p.mode[0].toUpperCase()+p.mode.slice(1)+' · USD per 1M tokens');
      for(const [rates,label] of [[p.rates,p.longRates?'Up to '+(p.threshold/1000)+'K input tokens':null],[p.longRates,'Over '+(p.threshold/1000)+'K input tokens']]){
        if(!rates)continue;if(label)add(label,'e1-price-context');
        for(const [key,name] of [['input','Input'],['cachedInput','Cached input'],['output','Output'],['cacheWrite',rates.cacheWriteHour!=null?'Cache write · 5 min':'Cache write'],['cacheWriteHour','Cache write · 1 hour']]){
          if(rates[key]==null)continue;const row=add('','e1-usage-label');const a=document.createElement('span'),b=document.createElement('span');a.textContent=name;b.textContent='$'+rates[key].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});row.append(a,b);
        }
      }
    }
    if(p.note)add(p.note);
    if(p.source){const source=document.createElement('a');source.href=p.source;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Provider pricing';source.className='e1-price-source';section.append(source);}
    if(p.state==='published'&&p.verifiedAt)add('Rates checked '+p.verifiedAt);
  }
  function showDetails(chip, target=chip, withPrice=!chip.planProvider) {
    if (!chip.isConnected || !chip.billingDetails) return hideDetails();
    if(target.getAttribute('aria-expanded')==='true')return hideDetails();
    if(anchor!==target)anchor?.removeAttribute('aria-describedby');
    hovered=chip;anchor=target;
    // Keep fixed positioning relative to the viewport; pane roots can be transformed.
    const theme=chip.closest('.cds-root')||document.querySelector('.cds-root');
    if(theme){const computed=getComputedStyle(theme);for(const name of ['--cds-surface-2','--cds-text-primary','--cds-text-secondary','--cds-border-strong','--cds-fill-ghost-hover'])tooltip.style.setProperty(name,computed.getPropertyValue(name));}
    loadUsage(chip);
    const lines=chip.billingDetails;
    // Avoid replacing unchanged tooltip content during routing-status refreshes.
    const value=JSON.stringify([lines,chip.usageKey,usageFor(chip),withPrice?chip.pricing:null]);
    if (tooltip.dataset.content !== value) {
      tooltip.replaceChildren(...lines.map((text,index)=>{const el=document.createElement(index?'div':'strong');el.textContent=text;return el;}));
      if(withPrice)appendPricing(tooltip,chip);
      appendUsage(tooltip,chip);
      tooltip.dataset.content=value;
    }
    tooltip.hidden=false; attr(target,'aria-describedby',tooltip.id);
    const r=target.getBoundingClientRect(), width=tooltip.offsetWidth, height=tooltip.offsetHeight;
    tooltip.style.left=Math.max(12,Math.min(r.left,innerWidth-width-12))+'px';
    tooltip.style.top=(r.top>height+12?r.top-height-8:Math.min(r.bottom+8,innerHeight-height-12))+'px';
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideDetails();});
  window.addEventListener('resize',hideDetails);
  window.addEventListener('scroll',hideDetails,true);
  const idFromRow = row => (row.getAttribute('data-row-key') || row.getAttribute('data-select-row-key') || '').replace(/^(code|cowork|chat):/, '');
  function chatForPicker(picker) {
    const direct = picker.closest('[data-session-id]')?.getAttribute('data-session-id');
    if (direct) return direct;
    const pane = picker.closest('.dframe-pane, [aria-label="Primary pane"], [aria-label="Secondary pane"]');
    if (!pane) return null;
    const ids = [...new Set([...pane.querySelectorAll('[data-session-id]')].map(el => el.getAttribute('data-session-id')).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }
  function openPlan(chip){
    const context=chip.planContext;if(!context||!chip.planProvider||!window.e1PlanUsage?.choices||!window.e1PreferenceDialog)return;
    hideDetails();
    const key=JSON.stringify(context);
    window.e1PreferenceDialog.open({trigger:chip,read:()=>window.e1PlanUsage.choices(context),
      isCurrent:()=>chip.isConnected&&JSON.stringify(chip.planContext)===key,
      configure:data=>({id:'plan',title:'Choose a plan',description:context.chatId?'For the next requests in this chat':'Default for new chats using '+data.model,
        values:{provider:data.selected},fields:()=>[{name:'provider',label:'Connection',presentation:'choices',rows:true,items:[
          {value:'',label:'Automatic',description:'Use your connection order and fallback settings.'},
          ...data.choices.map(c=>({value:c.id,label:c.accountLabel,description:[c.accountEmail,c.planName].filter(Boolean).join(' · ')})),
          ...(data.selected&&!data.choices.some(c=>c.id===data.selected)?[{value:data.selected,label:'Selected plan unavailable',description:'Choose a connected plan or Automatic.'}]:[])
        ]}],
        note:v=>v.provider?'Uses this plan at Standard speed. If it reaches a limit, this chat pauses until you switch plans or choose Automatic. A running response keeps its current account.':'Automatic follows your saved account order and API fallback setting.',
        canSave:v=>!v.provider||data.choices.some(c=>c.id===v.provider),saveLabel:v=>v.provider?'Use this plan':'Use Automatic',
        save:v=>window.e1PlanUsage.select({...context,provider:v.provider})}),
      onSaved:()=>window.dispatchEvent(new Event('e1-routing-changed')),
    }).catch(error=>{chip.title=error.message;});
  }
  function decorate(owner, status, kind, seen, phase, context) {
    if (!labels[status?.billing]) return;
    seen.add(owner);
    let item = decorations.get(owner);
    if (!item || !item.chip.isConnected) {
      item?.cleanup();
      const chip = document.createElement('span');
      chip.className = 'e1-billing-chip e1-billing-' + kind;
      chip.addEventListener('mouseenter',()=>enterDetails(chip)); chip.addEventListener('mouseleave',leaveDetails);
      chip.addEventListener('click',event=>{if(chip.planProvider&&chip.planContext){event.preventDefault();event.stopPropagation();openPlan(chip);}});
      chip.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&chip.planProvider&&chip.planContext){event.preventDefault();openPlan(chip);}});
      chip.addEventListener('focus',()=>enterDetails(chip)); chip.addEventListener('blur',leaveDetails);
      if (kind === 'model') { chip.setAttribute('role', 'status'); chip.tabIndex=0; owner.insertAdjacentElement('afterend', chip); }
      else owner.append(chip);
      const enter=()=>enterDetails(chip,owner,true);
      if(kind==='model'){owner.addEventListener('mouseenter',enter);owner.addEventListener('focus',enter);owner.addEventListener('mouseleave',leaveDetails);owner.addEventListener('blur',leaveDetails);owner.addEventListener('pointerdown',hideDetails);owner.addEventListener('click',hideDetails);}
      item = { chip,cleanup:()=>{owner.removeEventListener('mouseenter',enter);owner.removeEventListener('focus',enter);owner.removeEventListener('mouseleave',leaveDetails);owner.removeEventListener('blur',leaveDetails);owner.removeEventListener('pointerdown',hideDetails);owner.removeEventListener('click',hideDetails);} }; decorations.set(owner, item);
    }
    const { chip } = item;
    if (kind === 'model') attr(owner, 'data-e1-billing', status.billing);
    if (chip.textContent !== labels[status.billing]) chip.textContent = labels[status.billing];
    attr(chip, 'data-billing', status.billing); attr(chip, 'data-running', String(!!status.running));
    const detail = status.billing === 'api' ? 'Pay-as-you-go API billing' : status.billing === 'subscription' ? 'Subscription allowance' : status.billing === 'account' ? 'Claude billing is not yet confirmed' : labels[status.billing];
    const title = `${phase}: ${detail}${status.label ? ' · ' + status.label : ''}${status.model ? ' · ' + status.model : ''}${status.fallback ? ' · automatic fallback' : ''}${status.paused ? ' · limit reached' : ''}`;
    chip.pricing=status.actualSpeed?status.pricing:status.priceBySpeed?.[status.requestedSpeed||'standard']||status.pricing;
    chip.planProvider=status.planProvider||(status.billing==='subscription'?status.provider:null);
    chip.planContext=context;
    if(kind==='model'){attr(chip,'role',chip.planProvider&&context?'button':'status');if(chip.planProvider&&context)attr(chip,'aria-haspopup','dialog');else chip.removeAttribute('aria-haspopup');}
    chip.usageKey=chip.planProvider?JSON.stringify([chip.planProvider,status.accountEmail,status.accountLabel]):null;
    chip.billingDetails = [status.billing === 'subscription' ? status.planName || status.label || 'Subscription plan' : detail,
      (phase === 'Running' ? 'Using now' : phase) + (status.fallback ? ' · automatic fallback' : ''),
      'Account: '+(status.accountLabel || status.label || 'Unknown'),
      ...(status.accountEmail ? [status.accountEmail] : []), ...(status.model ? ['Model: '+status.model] : []),
      ...(status.requestedSpeed && status.requestedSpeed!=='standard' ? ['Requested speed: '+status.requestedSpeed] : []),
      ...(status.actualSpeed ? ['Delivered speed: '+status.actualSpeed] : status.requestedSpeed && status.requestedSpeed!=='standard' ? ['Delivered speed: not yet confirmed'] : []),
      ...(status.paused ? ['Limit reached'] : [])];
    attr(chip, 'aria-label', title + (status.accountEmail ? ' · '+status.accountEmail : ''));
    if (hovered===chip) refreshDetails();
  }
  function render() {
    scheduled = false; observer.disconnect();
    const seen = new Set(), chats = new Map(snapshot.chats.map(s => [s.chatId, s]));
    const pickers = new Set([...document.querySelectorAll(pickerSelector)].map(el => el.matches('button') ? el : el.querySelector('button')).filter(Boolean));
    for (const picker of pickers) {
      if (!picker.getClientRects().length || picker.closest(sidebarSelector) || picker.closest('[role="dialog"], [role="menu"]')) continue;
      const label = (picker.getAttribute('aria-label')?.replace(/^Model:\s*/, '') || picker.textContent).trim();
      const route = window.E1ModelList?.resolvePickerModel(snapshot.catalog, label);
      const chatId=chatForPicker(picker), chat = chats.get(chatId);
      const pref=snapshot.speedPreferences?.chats?.[chatId]?.[route?.id] || snapshot.speedPreferences?.models?.[route?.id] || {mode:'standard'};
      const planBucket=snapshot.planPreferences?.chats?.[chatId], planDefault=snapshot.planPreferences?.models;
      const planKey=route&&[route.id,...(route.aliases||[])].find(id=>planBucket&&Object.hasOwn(planBucket,id));
      const defaultKey=route&&[route.id,...(route.aliases||[])].find(id=>planDefault&&Object.hasOwn(planDefault,id));
      const pin=planKey?planBucket[planKey]:defaultKey?planDefault[defaultKey]:'';
      const useActual = chat && (chat.running || ((!pin||chat.provider===pin) && route && (chat.selectedModel === route.id || route.aliases?.includes(chat.selectedModel)) && (chat.requestedSpeed||'standard')===pref.mode));
      const predictedSpeed=pref.mode!=='standard' && pref.confirmPaid===true
        ? {...(route?.speedRoutes?.find(r=>r.provider===pref.apiProvider)||{billing:'paused',label:'Approved API connection unavailable'}),requestedSpeed:pref.mode}
        : pin?(snapshot.planRoutes?.find(r=>r.provider===pin&&r.model===route?.prediction?.model)||{billing:'paused',label:'Selected plan unavailable',provider:pin,planProvider:pin,model:route?.prediction?.model}):route?.prediction;
      const status = useActual ? chat : predictedSpeed;
      decorate(picker, status, 'model', seen, useActual ? (chat.running ? 'Running' : 'Last used') : 'Next request',route?{modelId:route.id,chatId}:null);
    }
    for (const sidebar of document.querySelectorAll(sidebarSelector)) for (const row of sidebar.querySelectorAll(rowSelector)) {
      // The outer row and its button may both carry a key; decorate only once.
      if (row.parentElement?.closest(rowSelector)?.closest(sidebarSelector)) continue;
      const status = chats.get(idFromRow(row));
      if (!status) continue;
      const main = row.querySelector('[data-row-main-button]') || row.querySelector('button, a');
      if (!main) continue;
      const nativeRunning = !!row.querySelector('[aria-label="Running"], [aria-label="Using the browser"], img[alt="Running"]');
      if (!status.running && !nativeRunning) continue;
      decorate(main, { ...status, running: true }, 'sidebar', seen, 'Running');
    }
    for (const [owner, item] of decorations) if (!seen.has(owner)) {
      if (hovered===item.chip) hideDetails();
      item.cleanup();owner.removeAttribute('data-e1-billing'); item.chip.remove(); decorations.delete(owner);
    }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'data-session-id', 'data-row-key', 'data-select-row-key', 'class', 'hidden'] });
  }
  function schedule() { if (!scheduled) { scheduled = true; setTimeout(render, 80); } }
  const observer = new MutationObserver(schedule);
  window.addEventListener('e1-billing-status', event => {
    if (event.detail?.version !== 2) return;
    snapshot = event.detail; schedule();
  });
  schedule();
})();
