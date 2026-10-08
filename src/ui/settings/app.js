const $ = id => document.getElementById(id);
let state, editing, clearKey = false;
let loginPoll;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(route, data) {
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
  for (const tab of document.querySelectorAll('[data-panel]')) {
    const active = tab.dataset.panel === id;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(tab.dataset.panel).hidden = !active;
  }
}
for (const tab of document.querySelectorAll('[data-panel]')) {
  tab.onclick = () => showPanel(tab.dataset.panel);
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const other = event.key === 'Home' ? $('accounts-tab') : event.key === 'End' ? $('models-tab') : tab === $('accounts-tab') ? $('models-tab') : $('accounts-tab');
    showPanel(other.dataset.panel); other.focus();
  };
}
function routingOrder() { return [...$('routing-pool').querySelectorAll('[data-route]:checked')].map(x => x.dataset.route); }
function renderRouting(order = state.routing?.order || []) {
  const ordered = [...order, ...state.providers.map(p => p.id)].filter((id, i, all) => all.indexOf(id) === i);
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
    if (b.dataset.up && row.previousElementSibling) row.before(row.previousElementSibling);
    else if (row.nextElementSibling) row.nextElementSibling.after(row);
    const rows = [...$('routing-pool').children];
    rows.forEach((r, i) => { r.querySelector('[data-up]').disabled = i === 0; r.querySelector('[data-down]').disabled = i === rows.length - 1; });
  };
}
function renderAccounts() {
  if (!$('show-legacy-models').disabled) $('show-legacy-models').checked = state.modelBrowser?.showLegacy === true;
  renderClaude();
  const accounts = state.subscriptions?.accounts || [];
  $('add-subscription').disabled = !state.subscriptions?.available;
  $('subscription-list').innerHTML = accounts.length ? accounts.map(a => `<div class="subscription-row"><div><button class="account-label" data-rename="${escape(a.id)}" aria-label="Rename ${escape(a.label)}">${escape(a.label)}</button><small>${escape(a.email)} · ${a.connected ? a.planEnabled ? 'Connected' : 'Plan permission required' : 'Signed out'}</small></div><div class="account-actions">${a.connected && a.planEnabled ? '' : `<button data-signin="${escape(a.id)}">Sign in</button>`}<button data-signout="${escape(a.id)}" ${a.connected ? '' : 'disabled'}>Sign out</button></div></div>`).join('') : '<div class="subscription-empty">No ChatGPT accounts connected. You can add more than one.</div>';
  for (const b of $('subscription-list').querySelectorAll('[data-signin]')) b.onclick = () => startLogin(b.dataset.signin);
  for (const b of $('subscription-list').querySelectorAll('[data-signout]')) b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('subscription/logout', { accountId: b.dataset.signout }); $('subscription-status').textContent = r.message; await refreshAccounts(); }
    catch (e) { b.disabled = false; $('subscription-status').textContent = e.message; }
  };
  for (const b of $('subscription-list').querySelectorAll('[data-rename]')) b.onclick = () => {
    const account = accounts.find(a => a.id === b.dataset.rename), form = document.createElement('form');
    form.className = 'account-name-form';
    form.innerHTML = `<input aria-label="Account name" maxlength="80" value="${escape(account.label)}"><button>Save</button><button type="button">Cancel</button>`;
    form.onsubmit = async event => { event.preventDefault(); try { const name = form.querySelector('input').value.trim(); if (!name) return; await api('provider', { id: 'chatgpt-' + account.id, name }); await refreshAccounts(); } catch(e) { $('subscription-status').textContent = e.message; } };
    form.querySelector('[type=button]').onclick = renderAccounts;
    b.replaceWith(form); form.querySelector('input').focus();
  };
  $('routing-enabled').checked = state.routing?.enabled === true;
  $('routing-api').checked = state.routing?.allowApiFallback === true;
  $('api-notice').hidden = !$('routing-api').checked;
  renderRouting();
  const status = state.routingStatus;
  $('routing-status').dataset.billing = status?.billing || '';
  $('routing-status').textContent = status?.billing ? `${status.billing === 'api' ? 'API billing' : status.billing === 'subscription' ? 'Using plan allowance' : status.billing === 'account' ? 'Check Claude billing' : 'Local'} · ${status.label}${status.paused ? ' · Usage limit reached' : ''}` : 'No routed request yet.';
  if (accounts.some(a => a.connected && a.planEnabled) && !state.subscriptions.welcomeAcknowledged && !$('plan-welcome').open) $('plan-welcome').showModal();
}
async function refreshAccounts() { state = await api('state'); renderAccounts(); renderProviderList(); }
function watchLogin(login) {
  clearInterval(loginPoll);
  $('add-subscription').disabled = true;
  $('subscription-status').textContent = 'Finish connecting on the OpenAI page in your browser. Your current connection stays active.';
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
      $('subscription-status').textContent = p?.status === 'complete' ? 'Connected. Add the account to your fallback connections or select it under Models & connections, then reopen E1 Code to load its models.' : p?.error || `Sign-in ${p?.status || 'ended'}. Use Continue with ChatGPT to try again.`;
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
  $('claude-list').innerHTML = accounts.length ? accounts.map(a => `<div class="subscription-row"><div><strong>${escape(a.label)}</strong><small>${a.connected ? 'Connected through official Claude Code' : 'Sign-in needed'} · ${a.method === 'console' ? 'Console API billing' : a.billingState === 'subscription' ? escape((a.subscriptionType || 'Claude') + ' plan · allowance verified') : 'Claude account'}</small></div><div class="account-actions"><button data-claude-signin="${escape(a.id)}">Sign in</button><button data-claude-check="${escape(a.id)}">Check</button><button data-claude-remove="${escape(a.id)}">Disconnect</button></div></div>`).join('') : '<div class="subscription-empty">Connect an existing sign-in or add a separate Claude account.</div>';
  for (const b of $('claude-list').querySelectorAll('[data-claude-signin]')) b.onclick = () => startClaude(b.dataset.claudeSignin);
  for (const b of $('claude-list').querySelectorAll('[data-claude-check]')) b.onclick = async () => {
    b.disabled = true; try { await api('claude/refresh', { accountId: b.dataset.claudeCheck }); await refreshAccounts(); $('claude-status').textContent = 'Account checked. Billing eligibility is determined by Claude.'; } catch(e) { b.disabled = false; $('claude-status').textContent = e.message; }
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
    await refreshAccounts(); $('routing-status').textContent = 'Routing saved. Your chat library is unchanged.';
  } catch (e) { $('routing-status').textContent = e.message; }
};

(async () => {
  try {
    if (location.hash) {
      const token = location.hash.slice(1);
      history.replaceState(null, '', '/');
      await api('session', {token});
    }
    state = await api('state');
    editing = state.selection.provider;
    renderAccounts(); renderProviderList(); loadProvider();
    const pending = state.subscriptions?.pending?.find(p => ['waiting', 'verifying'].includes(p.status));
    if (pending) watchLogin(pending);
    const claudePending = state.claudeAccounts?.pending?.find(p => p.status === 'waiting');
    if (claudePending) watchClaude(claudePending);
  } catch (error) { $('settings-status').textContent = error.message; }
})();
