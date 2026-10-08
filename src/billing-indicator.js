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
    .e1-billing-chip[data-billing="subscription"] { color:#35665b; background:#b9d8c833; }
    .e1-billing-chip[data-billing="local"], .e1-billing-chip[data-billing="paused"] { color:var(--text-secondary,#777); background:transparent; }
    .e1-billing-chip[data-running="true"]::before { content:''; width:4px; height:4px; border-radius:50%; background:currentColor; }
    .e1-billing-model { margin-inline:4px; }
    .e1-billing-sidebar { margin-inline-start:auto; }
    .e1-billing-chip:focus-visible { outline:2px solid #729c89; outline-offset:2px; }
    .e1-billing-tooltip { position:fixed; z-index:2147483647; pointer-events:none; max-width:min(340px,calc(100vw - 24px)); padding:10px 12px; border:1px solid #87968b55; border-radius:8px; color:#26352d; background:#f1f3ef; box-shadow:0 4px 18px #0002; font:12px/1.5 system-ui; overflow-wrap:anywhere; }
    .e1-billing-tooltip strong { display:block; font-weight:600; margin-bottom:3px; }
    .e1-billing-tooltip div { opacity:.8; }
    @media (prefers-color-scheme:dark) {
      .e1-billing-chip { color:#efc270; background:#75511444; }
      .e1-billing-chip[data-billing="subscription"] { color:#a5d1bc; background:#355d4933; }
      .e1-billing-tooltip { color:#e0e7df; background:#202a24; }
    }
  `;
  document.head.append(style);
  // Remove the previous global treatment when this is loaded during development.
  document.querySelector('#e1-api-billing-border')?.remove();
  document.querySelector('#e1-billing-indicator')?.remove();
  const labels = { api: 'API', account: 'Check billing', subscription: 'Plan', local: 'Local', paused: 'Paused' };
  const attr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
  const tooltip = document.createElement('div'); tooltip.id='e1-billing-tooltip'; tooltip.className='e1-billing-tooltip'; tooltip.role='tooltip'; tooltip.hidden=true;
  document.body.append(tooltip);
  let hovered;
  function hideDetails() {
    hovered?.removeAttribute('aria-describedby'); hovered=null; tooltip.hidden=true;
  }
  function showDetails(chip) {
    if (!chip.isConnected || !chip.billingDetails) return hideDetails();
    if (hovered !== chip) hovered?.removeAttribute('aria-describedby');
    hovered=chip;
    const lines=chip.billingDetails;
    // Avoid replacing unchanged tooltip content during routing-status refreshes.
    const value=JSON.stringify(lines);
    if (tooltip.dataset.content !== value) {
      tooltip.replaceChildren(...lines.map((text,index)=>{const el=document.createElement(index?'div':'strong');el.textContent=text;return el;}));
      tooltip.dataset.content=value;
    }
    tooltip.hidden=false; attr(chip,'aria-describedby',tooltip.id);
    const r=chip.getBoundingClientRect(), width=tooltip.offsetWidth, height=tooltip.offsetHeight;
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
  function decorate(owner, status, kind, seen, phase) {
    if (!labels[status?.billing]) return;
    seen.add(owner);
    let item = decorations.get(owner);
    if (!item || !item.chip.isConnected) {
      const chip = document.createElement('span');
      chip.className = 'e1-billing-chip e1-billing-' + kind;
      chip.addEventListener('mouseenter',()=>showDetails(chip)); chip.addEventListener('mouseleave',()=>{if(document.activeElement!==chip)hideDetails();});
      chip.addEventListener('focus',()=>showDetails(chip)); chip.addEventListener('blur',hideDetails);
      if (kind === 'model') { chip.setAttribute('role', 'status'); chip.tabIndex=0; owner.insertAdjacentElement('afterend', chip); }
      else owner.append(chip);
      item = { chip }; decorations.set(owner, item);
    }
    const { chip } = item;
    if (kind === 'model') attr(owner, 'data-e1-billing', status.billing);
    if (chip.textContent !== labels[status.billing]) chip.textContent = labels[status.billing];
    attr(chip, 'data-billing', status.billing); attr(chip, 'data-running', String(!!status.running));
    const detail = status.billing === 'api' ? 'Pay-as-you-go API billing' : status.billing === 'subscription' ? 'Subscription allowance' : status.billing === 'account' ? 'Claude billing is not yet confirmed' : labels[status.billing];
    const title = `${phase}: ${detail}${status.label ? ' · ' + status.label : ''}${status.model ? ' · ' + status.model : ''}${status.fallback ? ' · automatic fallback' : ''}${status.paused ? ' · limit reached' : ''}`;
    chip.billingDetails = [status.billing === 'subscription' ? status.planName || status.label || 'Subscription plan' : detail,
      (phase === 'Running' ? 'Using now' : phase) + (status.fallback ? ' · automatic fallback' : ''),
      'Account: '+(status.accountLabel || status.label || 'Unknown'),
      ...(status.accountEmail ? [status.accountEmail] : []), ...(status.model ? ['Model: '+status.model] : []),
      ...(status.requestedSpeed && status.requestedSpeed!=='standard' ? ['Requested speed: '+status.requestedSpeed] : []),
      ...(status.actualSpeed ? ['Delivered speed: '+status.actualSpeed] : status.requestedSpeed && status.requestedSpeed!=='standard' ? ['Delivered speed: not yet confirmed'] : []),
      ...(status.paused ? ['Limit reached'] : [])];
    attr(chip, 'aria-label', title + (status.accountEmail ? ' · '+status.accountEmail : ''));
    if (hovered===chip) showDetails(chip);
  }
  function render() {
    scheduled = false; observer.disconnect();
    const seen = new Set(), chats = new Map(snapshot.chats.map(s => [s.chatId, s]));
    const pickers = new Set([...document.querySelectorAll(pickerSelector)].map(el => el.matches('button') ? el : el.querySelector('button')).filter(Boolean));
    for (const picker of pickers) {
      if (!picker.getClientRects().length || picker.closest(sidebarSelector) || picker.closest('[role="dialog"], [role="menu"]')) continue;
      const label = (picker.getAttribute('aria-label')?.replace(/^Model:\s*/, '') || picker.textContent).trim();
      const route = snapshot.catalog.find(r => r.name === label);
      const chatId=chatForPicker(picker), chat = chats.get(chatId);
      const pref=snapshot.speedPreferences?.chats?.[chatId]?.[route?.id] || snapshot.speedPreferences?.models?.[route?.id] || {mode:'standard'};
      const useActual = chat && (chat.running || (route && (chat.selectedModel === route.id || route.aliases?.includes(chat.selectedModel)) && (chat.requestedSpeed||'standard')===pref.mode));
      const predictedSpeed=pref.mode!=='standard' && pref.confirmPaid===true
        ? {...(route?.speedRoutes?.find(r=>r.provider===pref.apiProvider)||{billing:'paused',label:'Approved API connection unavailable'}),requestedSpeed:pref.mode}
        : route?.prediction;
      const status = useActual ? chat : predictedSpeed;
      decorate(picker, status, 'model', seen, useActual ? (chat.running ? 'Running' : 'Last used') : 'Next request');
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
      owner.removeAttribute('data-e1-billing'); item.chip.remove(); decorations.delete(owner);
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
