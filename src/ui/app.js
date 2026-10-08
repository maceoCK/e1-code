const $ = (id) => document.getElementById(id);
let state,
  chatId = null,
  busy = false,
  editing = null,
  attachment = null,
  clearKey = false;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const md = (text) =>
  DOMPurify.sanitize(marked.parse(text, { breaks: true }), {
    FORBID_TAGS: ["img", "iframe", "style"],
    FORBID_ATTR: ["style"],
  });
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
function notice(s) {
  $("notice").textContent = s;
  $("notice").hidden = !s;
}
function current() {
  return state.chats.find((c) => c.id === chatId);
}
function renderHistory() {
  const q = $("search").value.toLowerCase();
  const chats = state.chats.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q)),
  );
  $("history").innerHTML = chats.length
    ? chats
        .map(
          (c) =>
            `<button class="${c.id === chatId ? "active" : ""}" data-chat="${c.id}" title="${escape(c.title)}">${escape(c.title)}</button>`,
        )
        .join("")
    : '<p class="rail-empty">Your conversations will<br>find a home here.</p>';
  for (const b of $("history").querySelectorAll("button"))
    b.onclick = () => {
      if (busy) return;
      chatId = b.dataset.chat;
      render();
    };
}
function render() {
  document.body.classList.toggle("night", state.theme === "night");
  renderHistory();
  const c = current();
  $("welcome").hidden = !!c?.messages.length;
  $("chat-title").textContent = c?.title || "New conversation";
  $("messages").innerHTML = (c?.messages || [])
    .map((m, i) =>
      m.role === "user"
        ? `<div class="message user">${escape(m.content)}</div>`
        : `<div class="message assistant"><div class="message-meta"><img src="/logo.svg" alt=""><span>${escape(m.model || "Assistant")}</span><span>·</span><span>${escape(m.provider || "")}</span></div><div class="content" data-content="${i}">${md(m.content)}</div>${m.error ? `<div class="response-error">${escape(m.error)}</div>` : ""}${busy && i === c.messages.length - 1 ? '<div class="pending"><span class="pulse"></span><span>Responding…</span></div>' : `<button class="copy" data-copy="${i}">Copy response</button>`}</div>`,
    )
    .join("");
  for (const b of $("messages").querySelectorAll("[data-copy]"))
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(
          c.messages[+b.dataset.copy].content,
        );
        b.textContent = "Copied";
      } catch {
        notice("Could not copy. Select the response text to copy it.");
      }
    };
  const p = state.providers.find((p) => p.id === state.selection.provider);
  $("selected-model").textContent = state.selection.model || "Choose a model";
  $("profile-button").textContent =
    state.selection.profile === "auto"
      ? "Auto prompt"
      : state.profiles[state.selection.profile]?.name || "Prompt";
  $("route-hint").textContent = p
    ? `${p.name} · ${new URL(p.baseUrl).hostname}`
    : "Choose a connection to begin";
  $("send").hidden = busy;
  $("stop").hidden = !busy;
  $("export").disabled = !c?.messages.length;
  $("delete-chat").disabled = !c || busy;
  $("new-chat").disabled = busy;
  $("providers-nav").disabled = busy;
  $("model-button").disabled = busy;
  $("profile-button").disabled = busy;
}
async function sync() {
  state = await api("state");
  render();
}
function scrollBottom() {
  const el = $("conversation");
  el.scrollTop = el.scrollHeight;
}
async function newChat() {
  if (busy) return;
  chatId = null;
  notice("");
  render();
  $("message").focus();
}
async function openSettings(profile = false) {
  if (busy) return;
  await sync();
  editing = state.selection.provider;
  renderProviderList();
  loadProvider();
  $("settings").showModal();
  $("prompt-details").open = profile;
  if (profile) preview();
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
  $("models-list").innerHTML = p.models
    .map((m) => `<option value="${escape(m.id)}">${escape(m.name)}</option>`)
    .join("");
  $("models-note").textContent = p.models.length
    ? `${p.models.length} models available. You can also enter a model ID directly.`
    : "Refresh the model list, or enter any model ID served by this endpoint.";
}
function loadProvider() {
  const p = state.providers.find((p) => p.id === editing);
  $("provider-name").value = p.name;
  $("protocol").value = p.protocol;
  $("endpoint").value = p.baseUrl;
  $("api-key").value = "";
  $("key-source").textContent = p.keySource || "Not configured";
  clearKey = false;
  $("settings-status").textContent = "";
  modelOptions(p);
  $("model-id").value =
    editing === state.selection.provider
      ? state.selection.model
      : p.preferredModel || p.models[0]?.id || "";
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
      provider.protocol === "responses" ||
      meta?.compat?.supportsReasoningEffort === true
    );
  } catch (e) {
    $("settings-status").textContent = e.message;
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
    preview();
  } catch (e) {
    $("settings-status").textContent = e.message;
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
    await sync();
    $("settings").close();
    $("message").focus();
    notice("");
  } catch (e) {
    $("settings-status").textContent = e.message;
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
$("new-chat").onclick = newChat;
$("search").oninput = renderHistory;
$("model-button").onclick = () => openSettings();
$("providers-nav").onclick = () => openSettings();
$("profile-button").onclick = () => openSettings(true);
$("settings").querySelector(".close").onclick = () => $("settings").close();
$("theme").onclick = async () => {
  try {
    await api("preferences", {
      theme: state.theme === "night" ? "mist" : "night",
    });
    await sync();
  } catch (e) {
    notice(e.message);
  }
};
$("menu-toggle").onclick = () => {
  document.body.classList.toggle("show-sidebar");
  document.body.classList.remove("sidebar-hidden");
};
for (const b of document.querySelectorAll("[data-prompt]"))
  b.onclick = () => {
    $("message").value = b.dataset.prompt;
    $("message").focus();
  };
$("attach").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 100000) {
    notice("Attach a text file smaller than 100 KB.");
    return;
  }
  const text = await f.text();
  if (text.includes("\0")) {
    notice("This file is binary. Attach plain text or code.");
    return;
  }
  attachment = { name: f.name, text };
  $("attachment").hidden = false;
  $("attachment").innerHTML =
    `${escape(f.name)} · ${Math.ceil(f.size / 1024)} KB <button aria-label="Remove attachment">×</button>`;
  $("attachment").querySelector("button").onclick = () => {
    attachment = null;
    $("attachment").hidden = true;
  };
  $("file").value = "";
};
$("composer").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  let text = $("message").value.trim();
  if (!text) return;
  if (!state.selection.model) {
    await openSettings();
    return;
  }
  if (attachment)
    text += `\n\nAttached text file: ${attachment.name}\n\n${attachment.text}`;
  notice("");
  try {
    if (!chatId) {
      const c = await api("chat/new", {});
      state.chats.unshift(c);
      chatId = c.id;
    }
    busy = true;
    $("message").value = "";
    attachment = null;
    $("attachment").hidden = true;
    render();
    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chatId, text }),
    });
    if (!r.ok) {
      const j = await r.json();
      throw Error(j.error);
    }
    let pending = "",
      decoder = new TextDecoder();
    for await (const bytes of r.body) {
      pending += decoder.decode(bytes, { stream: true });
      let n;
      while ((n = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, n);
        pending = pending.slice(n + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.chat) {
          const idx = state.chats.findIndex((c) => c.id === chatId);
          state.chats[idx] = ev.chat;
          render();
        }
        if (ev.type === "delta") {
          const c = current();
          c.messages[c.messages.length - 1].content += ev.text;
          const target = $("messages").querySelector(
            '[data-content="' + (c.messages.length - 1) + '"]',
          );
          if (target)
            target.innerHTML = md(c.messages[c.messages.length - 1].content);
        }
        if (ev.type === "error") notice(ev.error);
        scrollBottom();
      }
    }
  } catch (err) {
    notice(err.message);
    if (!current()?.messages.length) $("message").value = text;
  } finally {
    busy = false;
    await sync();
    scrollBottom();
    $("message").focus();
  }
};
$("stop").onclick = () =>
  api("stop", { id: chatId }).catch((e) => notice(e.message));
$("message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
};
$("delete-chat").onclick = () => $("delete-confirm").showModal();
$("cancel-delete").onclick = () => $("delete-confirm").close();
$("confirm-delete").onclick = async () => {
  await api("chat/delete", { id: chatId });
  chatId = null;
  $("delete-confirm").close();
  await sync();
};
$("export").onclick = () => {
  const c = current();
  if (!c) return;
  const text =
    `# ${c.title}\n\n` +
    c.messages
      .map(
        (m) =>
          `## ${m.role === "user" ? "You" : m.model + " · " + m.provider}\n\n${m.content}${m.error ? "\n\n[" + m.error + "]" : ""}`,
      )
      .join("\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = c.title.replace(/[^\w -]/g, "").slice(0, 60) + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "n") {
    e.preventDefault();
    newChat();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {
    e.preventDefault();
    openSettings();
  }
});
(async () => {
  try {
    if (location.hash) {
      const token = location.hash.slice(1);
      history.replaceState(null, "", "/");
      await api("session", { token });
    }
    await sync();
    $("message").focus();
  } catch (e) {
    notice(e.message);
  }
})();

window.addEventListener("focus", () => {
  if (state && !busy && !$("settings").open)
    sync().catch((e) => notice(e.message));
});
