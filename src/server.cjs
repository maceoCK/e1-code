const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Store } = require("./store.cjs"),
  P = require("./providers.cjs");
async function startServer({ dataDir, vault, port = 0, legacy, settingsOnly = false, subscriptions, claudeAccounts,
  sharedStore, providersChanged = async () => {}, routingChanged = () => {}, resetRoutingHealth = () => {}, abortProvider = () => {} }) {
  const store = sharedStore || new Store(dataDir, vault),
    token = crypto.randomBytes(32).toString("hex"),
    sessions = new Set(),
    active = new Map();
  const modelBrowser = new (require('./model-browser-preferences.cjs').ModelBrowserPreferences)(dataDir);
  store.subscriptions = subscriptions; store.claudeAccounts = claudeAccounts;
  const planUsage = new (require('./plan-usage.cjs').PlanUsage)(store);
  let origin;
  const json = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const read = async (req) => {
    let text = "";
    for await (const c of req) {
      text += c;
      if (text.length > 2e6)
        throw Error("Request is too large (2 MB maximum).");
    }
    return JSON.parse(text || "{}");
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host)
        return json(res, { error: "Invalid host." }, 403);
      const url = new URL(req.url, origin);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
      );
      if (url.pathname === "/api/session" && req.method === "POST") {
        if (req.headers.origin !== origin)
          return json(res, { error: "Origin rejected." }, 403);
        const b = await read(req);
        if (b.token !== token)
          return json(res, { error: "Open E1 Code from the desktop app." }, 401);
        const session = crypto.randomBytes(32).toString("hex");
        sessions.add(session);
        res.setHeader(
          "Set-Cookie",
          `aster_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return json(res, { ok: true });
      }
      if (url.pathname.startsWith("/api/")) {
        const session = req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("aster_session="))
          ?.slice(14);
        if (!sessions.has(session))
          return json(res, { error: "Session expired. Reopen E1 Code." }, 401);
        if (req.method !== "GET" && req.headers.origin !== origin)
          return json(res, { error: "Origin rejected." }, 403);
        if (settingsOnly && !["/api/state", "/api/provider", "/api/models", "/api/model-browser", "/api/preferences", "/api/preview", '/api/subscription/login', '/api/subscription/cancel', '/api/subscription/reopen', '/api/subscription/acknowledge', '/api/subscription/logout', '/api/claude/existing', '/api/claude/login', '/api/claude/refresh', '/api/claude/reopen', '/api/claude/cancel', '/api/claude/disconnect', '/api/routing', '/api/routing/reset', '/api/plan/usage'].includes(url.pathname))
          return json(res, { error: "Not found" }, 404);
        const b = req.method === "GET" ? {} : await read(req);
        switch (url.pathname) {
          case "/api/state": {
            const snapshot = store.snapshot();
            if (settingsOnly) delete snapshot.chats;
            return json(res, {
              ...snapshot,
              modelBrowser: modelBrowser.read(),
              legacyAvailable: !!legacy,
              profiles: P.PROFILES,
              claudeAccounts: claudeAccounts?.snapshot() || { accounts: [], pending: [], available: false },
              subscriptions: subscriptions?.snapshot() || { accounts: [], pending: [], available: false },
              routing: require('./routing.cjs').policyFor(store.data.routing),
              routingHealth: require('./library-identity.cjs').readJson(path.join(dataDir, 'routing-health.json'), {}),
              routingStatus: require('./library-identity.cjs').readJson(path.join(dataDir, 'routing-status.json'), null),
            });
          }
          case '/api/model-browser':
            if (req.method === 'GET') return json(res, modelBrowser.read());
            if (req.method !== 'POST') return json(res, {error:'Method not allowed.'}, 405);
            return json(res, modelBrowser.save(b));
          case '/api/claude/existing': {
            if (!claudeAccounts) throw Error('Open Claude sign-in from the desktop app.');
            const connected = await claudeAccounts.useExisting();
            if (claudeAccounts.account(connected.accountId).connected) await claudeAccounts.models(connected.accountId).catch(() => {});
            return json(res, { accountId: connected.accountId, ...claudeAccounts.snapshot() });
          }
          case '/api/claude/login':
            if (!claudeAccounts) throw Error('Open Claude sign-in from the desktop app.');
            return json(res, claudeAccounts.begin(b.accountId, b.method));
          case '/api/claude/refresh':
            if (!claudeAccounts) throw Error('Open Claude sign-in from the desktop app.');
            return json(res, await claudeAccounts.refresh(b.accountId));
          case '/api/claude/reopen':
            if (!claudeAccounts) throw Error('Open Claude sign-in from the desktop app.');
            await claudeAccounts.reopen(b.id); return json(res, { ok: true });
          case '/api/claude/cancel':
            claudeAccounts?.cancel(b.id); return json(res, { ok: true });
          case '/api/claude/disconnect':
            abortProvider('claude-code-' + b.accountId);
            return json(res, await claudeAccounts?.disconnect(b.accountId));
          case '/api/subscription/login':
            if (!subscriptions) throw Error('Subscription sign-in requires the desktop app.');
            return json(res, await subscriptions.begin(b.accountId));
          case '/api/subscription/reopen':
            if (!subscriptions) throw Error('Open subscription sign-in from the desktop app.');
            await subscriptions.reopen(b.id); return json(res, { ok: true });
          case '/api/subscription/acknowledge':
            if (subscriptions) { subscriptions.data.welcomeAcknowledged = true; subscriptions.save(); }
            return json(res, { ok: true });
          case '/api/subscription/cancel':
            await subscriptions?.cancel(b.id); return json(res, { ok: true });
          case '/api/subscription/logout':
            if (!subscriptions) throw Error('Subscription sign-in requires the desktop app.');
            abortProvider('chatgpt-' + b.accountId);
            return json(res, await subscriptions.logout(b.accountId));
          case '/api/plan/usage': {
            if (req.method !== 'POST' || typeof b.provider !== 'string') return json(res,{error:'Choose an account.'},400);
            return json(res, await planUsage.read(b.provider));
          }
          case '/api/routing': {
            const policy = require('./routing.cjs').policyFor(b);
            for (const id of policy.order) store.provider(id);
            store.data.routing = policy; store.save(); routingChanged(policy);
            return json(res, policy);
          }
          case '/api/routing/reset': {
            const p=store.provider(b.provider);
            if(p.proxy)await store.proxy.reset(p.id);
            const file = path.join(dataDir, 'routing-health.json');
            const health = require('./library-identity.cjs').readJson(file, {});
            for(const key of Object.keys(health))if(key===b.provider||key.startsWith(b.provider+':'))delete health[key]; require('./library-identity.cjs').atomicJson(file, health);
            resetRoutingHealth(b.provider); return json(res, { ok: true });
          }
          case "/api/provider": {
            const result=store.setProvider(b);await providersChanged();return json(res,result);
          }
          case "/api/models": {
            const p = store.provider(b.provider);
            const list = p.authType === 'claude-code' ? await claudeAccounts.models(p.accountId) : p.authType === 'chatgpt-subscription' ? await subscriptions.models(p.accountId) : await P.models(p, await (store.sourceKey ? store.sourceKey(p) : store.key(p)));
            const saved=store.data.providers.find(row=>row.id===p.id)||p;
            saved.models = list.map((m) => ({
              ...p.models.find((old) => old.id === m.id),
              ...m,
            }));
            store.save();
            await providersChanged();
            return json(res, { models: saved.models });
          }
          case "/api/preferences": {
            if (b.selection) {
              const s = b.selection;
              store.provider(s.provider);
              if (typeof s.model !== "string" || s.model.length > 300)
                throw Error("Invalid model ID.");
              if (!P.PROFILES[s.profile])
                throw Error("Invalid prompt profile.");
              if (s.instructions?.length > 20000)
                throw Error("Keep instructions under 20,000 characters.");
              if (
                !Number.isFinite(+s.maxTokens) ||
                +s.maxTokens < 64 ||
                +s.maxTokens > 32768
              )
                throw Error("Output limit must be 64–32,768 tokens.");
              store.data.selection = s;
              store.data.modelPreferences ||= {};
              store.data.modelPreferences[s.provider + ":" + s.model] = s;
              (store.data.providers.find(p=>p.id===s.provider)||store.provider(s.provider)).preferredModel = s.model;
              const selectedProvider = store.provider(s.provider);
              if (selectedProvider.authType === 'claude-code') claudeAccounts.update(selectedProvider.accountId, { preferredModel: s.model });
              if (selectedProvider.authType === 'chatgpt-subscription') subscriptions.update(selectedProvider.accountId, { preferredModel: s.model });
            }
            if (["mist", "night"].includes(b.theme)) store.data.theme = b.theme;
            store.save();await providersChanged();
            return json(res, { ok: true });
          }
          case "/api/chat/new":
            return json(res, store.newChat(store.data.selection));
          case "/api/chat/delete":
            if (active.has(b.id))
              throw Error("Stop the response before deleting this chat.");
            store.data.chats = store.data.chats.filter((c) => c.id !== b.id);
            store.save();
            return json(res, { ok: true });
          case "/api/chat/rename":
            store.chat(b.id).title = String(b.title || "Untitled").slice(
              0,
              100,
            );
            store.save();
            return json(res, { ok: true });
          case "/api/preview":
            return json(
              res,
              P.promptFor(b.model || store.data.selection.model, b),
            );
          case "/api/legacy":
            if (!legacy)
              throw Error("This option is available in the desktop app.");
            legacy();
            return json(res, { ok: true });
          case "/api/stop":
            active.get(b.id)?.abort();
            return json(res, { ok: true });
          case "/api/send": {
            const c = store.chat(b.id);
            if (active.has(c.id))
              throw Error("This chat already has a response running.");
            const text = String(b.text || "").trim();
            if (!text || text.length > 120000)
              throw Error("Enter a message under 120,000 characters.");
            const s = store.data.selection,
              p = store.provider(s.provider);
            if (!s.model) throw Error("Choose a model first.");
            const key = await store.key(p);
            const ctl = new AbortController();
            active.set(c.id, ctl);
            res.on("close", () => ctl.abort());
            c.selection = { ...s };
            c.messages.push({ role: "user", content: text });
            if (c.messages.length === 1)
              c.title = text.split("\n")[0].slice(0, 60);
            const history = c.messages
              .filter((m) => !m.error && !m.stopped)
              .map(({ role, content }) => ({ role, content }));
            const answer = {
              role: "assistant",
              content: "",
              model: s.model,
              provider: p.name,
              profile: P.profileFor(s.model, s.profile),
              startedAt: Date.now(),
            };
            c.messages.push(answer);
            store.save();
            res.writeHead(200, {
              "Content-Type": "application/x-ndjson",
              "Cache-Control": "no-store",
            });
            const emit = (x) => {
              if (!res.destroyed) res.write(JSON.stringify(x) + "\n");
            };
            emit({ type: "chat", chat: c });
            try {
              for await (const e of P.generate(
                p,
                key,
                s.model,
                history,
                s,
                ctl.signal,
              )) {
                if (e.type === "delta") answer.content += e.text;
                if (e.type !== "done") emit(e);
              }
              answer.completedAt = Date.now();
              store.save();
              emit({ type: "done", chat: c });
            } catch (e) {
              answer.error = ctl.signal.aborted
                ? "Stopped"
                : String(e.message).replaceAll(key || "\0", "[redacted]");
              answer.stopped = ctl.signal.aborted;
              store.save();
              emit({ type: "error", error: answer.error, chat: c });
            } finally {
              active.delete(c.id);
              res.end();
            }
            return;
          }
          default:
            return json(res, { error: "Not found" }, 404);
        }
      }
      const files = {
        "/": settingsOnly ? "settings/index.html" : "index.html",
        "/app.js": settingsOnly ? "settings/app.js" : "app.js",
        "/style.css": settingsOnly ? "settings/style.css" : "style.css",
        "/logo.svg": "logo.svg",
        "/model-list.js": "../model-list.js",
        "/marked.js": "vendor/marked.umd.js",
        "/purify.js": "vendor/purify.min.js",
        "/serif.woff2": "fonts/serif.woff2",
        "/sans.woff2": "fonts/sans.woff2",
      };
      if (!files[url.pathname]) return json(res, { error: "Not found" }, 404);
      const type = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      }[path.extname(files[url.pathname])];
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      fs.createReadStream(path.join(__dirname, "ui", files[url.pathname])).pipe(
        res,
      );
    } catch (e) {
      if (!res.headersSent) json(res, { error: e.message }, 400);
      else res.end();
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    store,
    origin,
    url: `${origin}/#${token}`,
    close: () => {
      for (const c of active.values()) c.abort();
      server.close();
    },
  };
}
module.exports = { startServer };
