window.e1MountSettings = function(root = document, request) {
const $ = id => root.querySelector("#" + CSS.escape(id));
let disposed = false;
function closeMenus(event){for(const menu of root.querySelectorAll('.account-menu[open]'))if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;}
function menuEscape(event){if(event.key==='Escape'){const menu=root.querySelector('.account-menu[open]');if(menu){event.preventDefault();event.stopImmediatePropagation();menu.open=false;menu.querySelector('summary').focus();}}}
root.addEventListener('click',closeMenus);root.addEventListener('keydown',menuEscape,true);
let state, editing, clearKey = false;
let loginPoll;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(route, data) {
  if (disposed) throw Error("Settings closed.");
  if (request) return request(route, data);
  const r = await fetch(
    "/api/" + route,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Request failed.");
  return j;
}
function renderProviderList() {
  $("provider-list").innerHTML =
    state.providers
      .map(
        (p) =>
          `<button data-provider="${escape(p.id)}" class="${p.id === editing ? "active" : ""}">${escape(p.name)}</button>`,
      )
      .join("") + '<button id="add-connection">＋ Add connection</button>';
  for (const b of $("provider-list").querySelectorAll("[data-provider]"))
    b.onclick = () => {
      editing = b.dataset.provider;
      renderProviderList();
      loadProvider();
    };
  $("add-connection").onclick = () => {
    const id = "custom-" + Date.now();
    state.providers.push({
      id,
      name: "New connection",
      protocol: "chat",
      baseUrl: "http://127.0.0.1:8080/v1",
      models: [],
      keySource: "Not configured",
    });
    editing = id;
    renderProviderList();
    loadProvider();
  };
}
function modelOptions(p) {
  const rows=provider=>provider.models.map(m=>({...m,model:m.id,providerName:provider.name,providerKind:provider.protocol}));
  const visible=window.E1ModelList.arrange(rows(p),{showLegacy:state.modelBrowser?.showLegacy,
    selected:$("model-id").value,universe:state.providers.flatMap(rows)});
  $("models-list").innerHTML = visible
    .map((m) => `<option value="${escape(m.id)}">${escape(m.name)}</option>`)
    .join("");
  $("models-note").textContent = p.models.length
    ? `${visible.length} of ${p.models.length} models shown. You can also enter a model ID directly.`
    : "Refresh the model list, or enter any model ID served by this endpoint.";
}
function loadProvider() {
  const p = state.providers.find((p) => p.id === editing);
  $("provider-name").value = p.name;
  $("protocol").value = p.protocol;
  $("endpoint").value = p.baseUrl;
  $("api-key").value = "";
  $("key-source").textContent = p.keySource || "Not configured";
  const subscription = ['chatgpt-subscription', 'claude-code'].includes(p.authType);
  for (const id of ['protocol', 'endpoint', 'api-key', 'clear-key']) $(id).disabled = subscription;
  $('max-tokens').disabled = subscription;
  clearKey = false;
  $("settings-status").textContent = "";
  delete $("settings-status").dataset.success;
  $("model-id").value =
    editing === state.selection.provider
      ? state.selection.model
      : p.preferredModel || p.models[0]?.id || "";
  modelOptions(p);
  loadModelPrefs();
  preview();
}
function loadModelPrefs() {
  const key = editing + ":" + $("model-id").value;
  const s =
    state.modelPreferences?.[key] ||
    (editing === state.selection.provider &&
    $("model-id").value === state.selection.model
      ? state.selection
      : {});
  $("profile").value = s.profile || "auto";
  $("instructions").value = s.instructions || "";
  $("max-tokens").value = s.maxTokens || 2048;
  $("effort").value = s.effort || "default";
}
async function preview() {
  const b = {
    model: $("model-id").value,
    profile: $("profile").value,
    instructions: $("instructions").value,
  };
  try {
    const p = await api("preview", b);
    $("prompt-preview").textContent = p.text;
    $("profile-hint").textContent = state.profiles[p.profile]?.hint || "";
    const provider = state.providers.find((p) => p.id === editing),
      meta = provider.models.find((m) => m.id === b.model);
    $("effort").disabled = !(
      provider.protocol === "responses" || provider.authType === "claude-code" ||
      meta?.compat?.supportsReasoningEffort === true
    );
  } catch (e) {
    $("settings-status").textContent = e.message;
    delete $("settings-status").dataset.success;
  }
}
async function saveConnection() {
  const p = await api("provider", {
    id: editing,
    name: $("provider-name").value,
    protocol: $("protocol").value,
    baseUrl: $("endpoint").value,
    apiKey: $("api-key").value,
    clearKey,
  });
  $("api-key").value = "";
  clearKey = false;
  const i = state.providers.findIndex((x) => x.id === editing);
  state.providers[i] = p;
  return p;
}
$("refresh-models").onclick = async () => {
  const b = $("refresh-models");
  b.disabled = true;
  b.textContent = "Connecting…";
  try {
    await saveConnection();
    const d = await api("models", { provider: editing });
    const p = state.providers.find((p) => p.id === editing);
    p.models = d.models;
    modelOptions(p);
    if (!$("model-id").value) {
      $("model-id").value =
        (editing === "openai"
          ? d.models.find((m) => m.id === "gpt-5.4-mini") ||
            d.models.find((m) => m.id === "gpt-5-mini") ||
            d.models.find((m) => m.id === "gpt-4.1-mini")
          : d.models[0]
        )?.id || "";
      loadModelPrefs();
    }
    $("settings-status").textContent =
      `Connected. ${d.models.length} models found.`;
    $("settings-status").dataset.success = "true";
    preview();
  } catch (e) {
    $("settings-status").textContent = e.message;
    delete $("settings-status").dataset.success;
  } finally {
    b.disabled = false;
    b.textContent = "Refresh models ↻";
  }
};
$("save-provider").onclick = async () => {
  try {
    const model = $("model-id").value.trim();
    if (!model) throw Error("Choose or enter a model ID.");
    await saveConnection();
    await api("preferences", {
      selection: {
        provider: editing,
        model,
        profile: $("profile").value,
        instructions: $("instructions").value,
        maxTokens: Number($("max-tokens").value),
        effort: $("effort").value,
      },
    });
    state = await api("state");
    $("settings-status").textContent = "Saved. Reopen E1 Code to apply connection changes to the workspace.";
    $("settings-status").dataset.success = "true";
  } catch (e) {
    $("settings-status").textContent = e.message;
    delete $("settings-status").dataset.success;
  }
};
$("clear-key").onclick = () => {
  clearKey = true;
  $("api-key").value = "";
  $("key-source").textContent = "Key will be removed when you save.";
};
$("profile").onchange = preview;
$("instructions").oninput = preview;
$("model-id").onchange = () => {
  loadModelPrefs();
  preview();
};

$('show-legacy-models').onchange = async () => {
  const control=$('show-legacy-models'), showLegacy=control.checked;
  control.disabled=true; $('model-browser-status').textContent='';
  try {
    state.modelBrowser=await api('model-browser',{showLegacy});
    modelOptions(state.providers.find(p=>p.id===editing));
    $('model-browser-status').textContent='Saved. Model pickers update automatically.';
  } catch(e) { control.checked=state.modelBrowser?.showLegacy === true; $('model-browser-status').textContent=e.message; }
  finally { control.disabled=false; }
};
function showPanel(id) {
  for (const tab of root.querySelectorAll('[data-panel]')) {
    const active = tab.dataset.panel === id;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(tab.dataset.panel).hidden = !active;
  }
}
for (const tab of root.querySelectorAll('[data-panel]')) {
  tab.onclick = () => showPanel(tab.dataset.panel);
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs=[...root.querySelectorAll('[data-panel]')],index=tabs.indexOf(tab);
    const other=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+tabs.length)%tabs.length];
    showPanel(other.dataset.panel); other.focus();
  };
}
function routingOrder() { return [...$('routing-pool').querySelectorAll('[data-route]:checked')].map(x => x.dataset.route); }
function renderRouting(order = state.routing?.order || []) {
  const configured=state.providers.filter(p=>p.hasKey||p.signedIn||order.includes(p.id));
  const ordered = [...order, ...configured.map(p => p.id)].filter((id, i, all) => all.indexOf(id) === i);
  $('routing-pool').innerHTML = ordered.map((id, index) => {
    const p = state.providers.find(p => p.id === id); if (!p) return '';
    const h = state.routingHealth?.[id];
    const limit = h ? h.retryAt ? `Limited until ${new Date(h.retryAt).toLocaleTimeString()}` : 'Usage limit reached; reset time unavailable' : '';
    const billing = p.authType === 'claude-code' ? (p.billing === 'api' ? 'Claude API billing' : p.billing === 'subscription' ? 'Claude plan' : 'Claude billing') : p.authType === 'chatgpt-subscription' ? 'ChatGPT plan' : p.protocol === 'ollama' || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(p.baseUrl) ? 'Local' : 'Paid API';
    return `<div class="route-row"><label><input type="checkbox" data-route="${escape(id)}" ${order.includes(id) ? 'checked' : ''}><span>${escape(p.name)}${limit ? `<br><small>${escape(limit)}</small>` : ''}</span><span class="billing-type">${billing}</span></label>${limit ? `<button type="button" data-retry="${escape(id)}">Retry</button>` : ''}<button data-up="${escape(id)}" aria-label="Move ${escape(p.name)} earlier" ${index === 0 ? 'disabled' : ''}>↑</button><button data-down="${escape(id)}" aria-label="Move ${escape(p.name)} later" ${index === ordered.length - 1 ? 'disabled' : ''}>↓</button></div>`;
  }).join('');
  for (const b of $('routing-pool').querySelectorAll('[data-retry]')) b.onclick = async () => {
    try { await api('routing/reset', { provider: b.dataset.retry }); state = await api('state'); renderRouting(routingOrder()); }
    catch (e) { $('routing-status').textContent = e.message; }
  };
  for (const b of $('routing-pool').querySelectorAll('[data-up], [data-down]')) b.onclick = () => {
    const row = b.closest('.route-row');
    if (b.dataset.up && row.previousElementSibling) row.previousElementSibling.before(row);
    else if (row.nextElementSibling) row.nextElementSibling.after(row);
    $('routing-status').textContent = 'Order changed. Save changes to apply.';
    const rows = [...$('routing-pool').children];
    rows.forEach((r, i) => { r.querySelector('[data-up]').disabled = i === 0; r.querySelector('[data-down]').disabled = i === rows.length - 1; });
  };
}
function renameAccount(button, account, prefix, statusId) {
  const label = button.closest('.subscription-row').querySelector('.account-label');
  const form = document.createElement('form'); form.className = 'account-name-form';
  form.innerHTML = `<input aria-label="Account label" maxlength="80" required value="${escape(account.label)}"><button type="submit">Save</button><button type="button">Cancel</button>`;
  form.onsubmit = async event => {
    event.preventDefault(); const name = form.querySelector('input').value.trim(); if (!name) return;
    form.querySelector('[type=submit]').disabled = true;
    try { await api('provider', { id: prefix + account.id, name }); await refreshAccounts(); }
    catch(e) { $(statusId).textContent = e.message; form.querySelector('[type=submit]').disabled = false; }
  };
  form.querySelector('[type=button]').onclick = renderAccounts;
  form.onkeydown = event => { if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); renderAccounts(); } };
  label.replaceWith(form); form.querySelector('input').focus(); form.querySelector('input').select();
}
function renderAccounts() {
  if (!$('show-legacy-models').disabled) $('show-legacy-models').checked = state.modelBrowser?.showLegacy === true;
  renderClaude();
  const accounts = state.subscriptions?.accounts || [];
  $('add-subscription').disabled = !state.subscriptions?.available;
  $('subscription-list').innerHTML = accounts.length ? accounts.map(a => `<div class="subscription-row"><div><button class="account-label" data-rename="${escape(a.id)}" aria-label="Rename ${escape(a.label)}">${escape(a.label)}</button><small>${escape(a.email)} · ${a.connected ? a.planEnabled ? a.mode === 'codex' ? 'Connected' : 'Reconnect needed' : 'Plan permission required' : 'Signed out'}</small></div><details class="account-menu"><summary aria-label="Manage ${escape(a.label)}">•••</summary><div class="account-actions"><button data-rename="${escape(a.id)}">Rename</button><button data-signin="${escape(a.id)}">${a.connected ? a.mode === 'codex' ? 'Reconnect' : 'Use Codex sign-in' : 'Sign in'}</button><button data-signout="${escape(a.id)}" ${a.connected ? '' : 'disabled'}>Sign out</button></div></details></div>`).join('') : '<div class="subscription-empty">No ChatGPT accounts connected. You can add more than one.</div>';
  for (const b of $('subscription-list').querySelectorAll('[data-signin]')) b.onclick = () => startLogin(b.dataset.signin);
  for (const b of $('subscription-list').querySelectorAll('[data-signout]')) b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('subscription/logout', { accountId: b.dataset.signout }); $('subscription-status').textContent = r.message; await refreshAccounts(); }
    catch (e) { b.disabled = false; $('subscription-status').textContent = e.message; }
  };
  for (const b of $('subscription-list').querySelectorAll('[data-rename]')) b.onclick = () => renameAccount(b, accounts.find(a => a.id === b.dataset.rename), 'chatgpt-', 'subscription-status');
  $('routing-enabled').checked = state.routing?.enabled === true;
  $('routing-api').checked = state.routing?.allowApiFallback === true;
  $('api-notice').hidden = !$('routing-api').checked;
  renderRouting();
  const status = state.routingStatus;
  $('routing-status').dataset.billing = status?.billing || '';
  $('routing-status').textContent = status?.billing ? `${status.billing === 'api' ? 'API billing' : status.billing === 'subscription' ? 'Using plan allowance' : status.billing === 'account' ? 'Check Claude billing' : 'Local'} · ${status.label}${status.paused ? ' · Usage limit reached' : ''}` : '';
  if (accounts.some(a => a.connected && a.planEnabled) && !state.subscriptions.welcomeAcknowledged && !$('plan-welcome').open) $('plan-welcome').showModal();
}
async function refreshAccounts() { state = await api('state'); renderAccounts(); renderProviderList(); }
function watchLogin(login) {
  clearInterval(loginPoll);
  $('add-subscription').disabled = true;
  $('subscription-status').textContent = 'Finish Codex sign-in in your browser, then return to E1 Code. Your current connection stays active.';
  const actions = document.createElement('div'); actions.className = 'login-actions';
  const reopen = document.createElement('button'); reopen.textContent = 'Open browser again';
  reopen.onclick = async () => { try { await api('subscription/reopen', { id: login.id }); } catch(e) { $('subscription-status').textContent = e.message; } };
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel sign-in';
  cancel.onclick = async () => { try { await api('subscription/cancel', { id: login.id }); clearInterval(loginPoll); $('subscription-status').textContent = 'Sign-in cancelled. Your chats are unchanged.'; $('add-subscription').disabled = false; } catch(e) { $('subscription-status').textContent = e.message; } };
  actions.append(reopen, cancel); $('subscription-status').append(actions);
  let checking = false;
  loginPoll = setInterval(async () => {
    if (checking) return; checking = true;
    try {
      let next = await api('state'); const p = next.subscriptions.pending.find(p => p.id === login.id);
      if (p && ['waiting', 'verifying'].includes(p.status)) return;
      clearInterval(loginPoll);
      if (p?.status === 'complete') {
        for (const account of next.subscriptions.accounts.filter(a => a.connected && a.planEnabled && !a.models?.length)) {
          try { await api('models', { provider: 'chatgpt-' + account.id }); } catch {}
        }
        next = await api('state');
      }
      state = next; renderAccounts(); renderProviderList();
      $('subscription-status').textContent = p?.status === 'complete' ? 'Connected. Add the account to your fallback connections or select it under Models & connections, then reopen E1 Code to load its models.' : p?.error || `Sign-in ${p?.status || 'ended'}. Use Add account to try again.`;
    } catch (e) { clearInterval(loginPoll); $('add-subscription').disabled = false; $('subscription-status').textContent = e.message; }
    finally { checking = false; }
  }, 1500);
}
async function startLogin(accountId) {
  $('add-subscription').disabled = true;
  try { watchLogin(await api('subscription/login', { accountId })); }
  catch (e) { $('add-subscription').disabled = false; $('subscription-status').textContent = e.message; }
}
let claudePoll;
function renderClaude() {
  const accounts = state.claudeAccounts?.accounts || [];
  for (const id of ['add-claude', 'existing-claude', 'claude-console']) $(id).disabled = !state.claudeAccounts?.available;
  $('claude-list').innerHTML = accounts.length ? accounts.map(a => {
    const email = a.email?.trim();
    const plan = a.method === 'console' ? 'Console · API billing' : a.subscriptionType ? ({max:'Max',pro:'Pro',team:'Team',enterprise:'Enterprise'}[a.subscriptionType] || a.subscriptionType) + ' subscription' : 'Plan not reported';
    const source = a.existing ? 'Imported from Claude Code' : 'Signed in through E1';
    const workspace = a.method === 'console' ? [a.orgName, a.workspaceName].filter(Boolean).join(' / ') : ''; 
    const identity = email || 'Account identity unavailable';
    const repeated = email && accounts.filter(other => other.connected && other.email?.trim().toLowerCase() === email.toLowerCase()).length > 1;
    return `<div class="subscription-row"><div><strong>${escape(identity)}</strong><small>${escape(plan)} · ${a.connected ? 'Connected' : 'Sign-in needed'}</small>${workspace ? `<small>${escape(workspace)}</small>` : ''}<div class="account-origin"><button class="account-label" data-claude-rename="${escape(a.id)}" aria-label="Rename ${escape(a.label)}">${escape(a.label)}</button> · ${source}${repeated ? ' · Same email on another connection' : ''}</div>${!email ? '<small>Use Refresh details to check the account identity.</small>' : ''}</div><details class="account-menu"><summary aria-label="Manage ${escape(a.label)}">•••</summary><div class="account-actions"><button data-claude-rename="${escape(a.id)}">Rename</button><button data-claude-signin="${escape(a.id)}">${a.connected ? 'Reconnect' : 'Sign in'}</button><button data-claude-check="${escape(a.id)}">Refresh details</button><button data-claude-remove="${escape(a.id)}">Disconnect</button></div></details></div>`;
  }).join('') : '<div class="subscription-empty">Connect an existing sign-in or add a separate Claude account.</div>';
  for (const b of $('claude-list').querySelectorAll('[data-claude-rename]')) b.onclick = () => renameAccount(b, accounts.find(a => a.id === b.dataset.claudeRename), 'claude-code-', 'claude-status');
  for (const b of $('claude-list').querySelectorAll('[data-claude-signin]')) b.onclick = () => startClaude(b.dataset.claudeSignin, accounts.find(a => a.id === b.dataset.claudeSignin)?.method || 'claudeai');
  for (const b of $('claude-list').querySelectorAll('[data-claude-check]')) b.onclick = async () => {
    b.disabled = true; try { await api('claude/refresh', { accountId: b.dataset.claudeCheck }); await refreshAccounts(); $('claude-status').textContent = 'Account details refreshed.'; } catch(e) { b.disabled = false; $('claude-status').textContent = e.message; }
  };
  for (const b of $('claude-list').querySelectorAll('[data-claude-remove]')) b.onclick = async () => {
    try { await api('claude/disconnect', { accountId: b.dataset.claudeRemove }); await refreshAccounts(); $('claude-status').textContent = 'Disconnected from E1 Code. All chats and the official sign-in are preserved. Reopen E1 Code to update the model picker.'; } catch(e) { $('claude-status').textContent = e.message; }
  };
}
async function startClaude(accountId, method = 'claudeai') {
  try { watchClaude(await api('claude/login', { accountId, method })); } catch(e) { $('claude-status').textContent = e.message; }
}
function watchClaude(login) {
  clearInterval(claudePoll);
  $('claude-status').textContent = 'Complete the official Claude Code sign-in in your browser.';
  const actions = document.createElement('div'); actions.className = 'login-actions';
  const reopen = document.createElement('button'); reopen.textContent = 'Open browser again';
  reopen.onclick = async () => { try { await api('claude/reopen', { id: login.id }); } catch(e) { $('claude-status').textContent = e.message; } };
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  cancel.onclick = async () => { await api('claude/cancel', { id: login.id }); clearInterval(claudePoll); $('claude-status').textContent = 'Sign-in cancelled.'; };
  actions.append(reopen, cancel); $('claude-status').append(actions);
  let checking = false;
  claudePoll = setInterval(async () => {
    if (checking) return; checking = true;
    try {
      const next = await api('state'), p = next.claudeAccounts.pending.find(p => p.id === login.id);
      if (p?.status === 'waiting') return;
      clearInterval(claudePoll); state = next; renderAccounts(); renderProviderList();
      $('claude-status').textContent = p?.status === 'complete' ? 'Connected. Select the account under Models & connections, then reopen E1 Code to load its models.' : p?.error || 'Sign-in ended.';
    } catch(e) { clearInterval(claudePoll); $('claude-status').textContent = e.message; } finally { checking = false; }
  }, 1500);
}
$('add-claude').onclick = () => startClaude();
$('claude-console').onclick = () => startClaude(undefined, 'console');
$('existing-claude').onclick = async () => {
  $('existing-claude').disabled = true;
  try { await api('claude/existing', {}); await refreshAccounts(); $('claude-status').textContent = 'Existing sign-in checked. Console connections use API billing. Select it under Models & connections, then reopen E1 Code.'; } catch(e) { $('existing-claude').disabled = false; $('claude-status').textContent = e.message; }
};
$('routing-api').onchange = () => { $('api-notice').hidden = !$('routing-api').checked; };
$('welcome-done').onclick = async () => { try { await api('subscription/acknowledge', {}); state.subscriptions.welcomeAcknowledged = true; $('plan-welcome').close(); } catch(e) { $('subscription-status').textContent = e.message; } };
$('plan-welcome').oncancel = event => { event.preventDefault(); $('welcome-done').click(); };
$('add-subscription').onclick = () => startLogin();
$('save-routing').onclick = async () => {
  try {
    await api('routing', { enabled: $('routing-enabled').checked, allowApiFallback: $('routing-api').checked,
      order: routingOrder() });
    await refreshAccounts(); $('routing-status').textContent = 'Changes saved.';
  } catch (e) { $('routing-status').textContent = e.message; }
};

(async () => {
  try {
    if (!request && location.hash) {
      const token = location.hash.slice(1);
      history.replaceState(null, '', '/');
      await api('session', {token});
    }
    state = await api('state');
    if (disposed) return;
    editing = state.selection.provider;
    renderAccounts(); renderProviderList(); loadProvider();
    const pending = state.subscriptions?.pending?.find(p => ['waiting', 'verifying'].includes(p.status));
    if (pending) watchLogin(pending);
    const claudePending = state.claudeAccounts?.pending?.find(p => p.status === 'waiting');
    if (claudePending) watchClaude(claudePending);
  } catch (error) { $('settings-status').textContent = error.message; }
})();

return () => { root.removeEventListener('click',closeMenus);root.removeEventListener('keydown',menuEscape,true);disposed = true; clearInterval(loginPoll); clearInterval(claudePoll); };
};
if (!window.e1Settings) window.e1MountSettings();
