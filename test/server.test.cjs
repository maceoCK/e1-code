const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const { startServer } = require("../src/server.cjs"),
  { Store } = require("../src/store.cjs");
test("desktop settings has no second chat interface or chat API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-settings-"));
  const app = await startServer({ dataDir: dir, settingsOnly: true });
  try {
    app.store.newChat(app.store.data.selection);
    const html = await (await fetch(app.origin)).text();
    assert.match(html, /Models &amp; connections/);
    assert.doesNotMatch(html, /id="(?:composer|history|new-chat)"/);
    const session = await fetch(app.origin + "/api/session", {
      method: "POST", headers: { Origin: app.origin },
      body: JSON.stringify({ token: app.url.split("#")[1] }),
    });
    const headers = { Cookie: session.headers.get("set-cookie").split(";")[0], Origin: app.origin };
    const state = await (await fetch(app.origin + "/api/state", { headers })).json();
    assert.ok(state.providers.length > 0);
    assert.equal(state.chats, undefined);
    assert.equal((await fetch(app.origin + "/api/chat/new", { method: "POST", headers, body: "{}" })).status, 404);
    const claude = await fetch(app.origin + '/api/claude/login', {method:'POST',headers,body:'{}'});
    assert.notEqual(claude.status, 404, 'Desktop settings must expose the Claude account controls');
    assert.match((await claude.json()).error, /desktop app/);
    assert.equal(app.store.data.chats.length, 1);
  } finally { app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("credentials stay private and do not follow edited endpoints", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-store-"));
  try {
    const s = new Store(dir);
    s.setProvider({
      id: "openai",
      name: "OpenAI",
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-test-key",
    });
    assert.equal(s.key(s.provider("openai")), "secret-test-key");
    assert.ok(!JSON.stringify(s.snapshot()).includes("secret-test-key"));
    assert.ok(!fs.readFileSync(s.file, "utf8").includes("secret-test-key"));
    s.setProvider({
      id: "openai",
      name: "Other",
      protocol: "responses",
      baseUrl: "https://different.example/v1",
    });
    assert.equal(s.key(s.provider("openai")), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("loopback API requires session and matching origin; failed chat persists honestly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-api-"));
  const app = await startServer({ dataDir: dir });
  let upstream = http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end('{"error":{"message":"Invalid credential"}}');
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  try {
    assert.equal((await fetch(app.origin + "/api/state")).status, 401);
    assert.equal(
      (
        await fetch(app.origin + "/api/session", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
          body: JSON.stringify({ token: app.url.split("#")[1] }),
        })
      ).status,
      403,
    );
    const session = await fetch(app.origin + "/api/session", {
      method: "POST",
      headers: { Origin: app.origin },
      body: JSON.stringify({ token: app.url.split("#")[1] }),
    });
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const api = async (route, data, origin = app.origin) =>
      fetch(app.origin + "/api/" + route, {
        method: data ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
      });
    assert.equal(
      (await api("preferences", { theme: "night" }, "https://attacker.example"))
        .status,
      403,
    );
    await api("provider", {
      id: "test",
      name: "Test",
      protocol: "chat",
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      apiKey: "private-key",
    });
    await api("preferences", {
      selection: {
        provider: "test",
        model: "test",
        profile: "general",
        maxTokens: 128,
      },
    });
    const c = await (await api("chat/new", {})).json();
    const response = await api("send", { id: c.id, text: "Hello" });
    const text = await response.text();
    assert.match(text, /'|Invalid credential/);
    assert.ok(!text.includes("private-key"));
    const state = await (await api("state")).json();
    assert.equal(
      state.chats[0].messages.at(-1).error,
      "Provider returned 401: Invalid credential",
    );
    assert.ok(!JSON.stringify(state).includes("private-key"));
    assert.equal(
      (
        await api("preferences", {
          selection: {
            provider: "test",
            model: "x",
            profile: "general",
            maxTokens: -1,
          },
        })
      ).status,
      400,
    );
  } finally {
    app.close();
    await new Promise((r) => upstream.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("imported key-file references stay private and remain pinned to their provider", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-ref-"));
  try {
    const file = path.join(dir, "keys.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ OPENAI_API_KEY: "private-reference-key" }),
    );
    const s = new Store(dir);
    const p = s.provider("openai");
    p.keyFile = { path: file, field: "OPENAI_API_KEY", baseUrl: p.baseUrl };
    delete p.credential;
    s.save();
    assert.equal(s.key(p), "private-reference-key");
    assert.ok(!JSON.stringify(s.snapshot()).includes(file));
    s.setProvider({
      id: "openai",
      name: "Another endpoint",
      protocol: "chat",
      baseUrl: "https://example.net/v1",
    });
    assert.equal(s.key(s.provider("openai")), "");
    assert.ok(!s.provider("openai").keyFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("stop cancels an in-flight provider request and persists a marked partial response", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aster-stop-"));
  const app = await startServer({ dataDir: dir });
  const upstream = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n');
    const timer = setInterval(() => res.write(": waiting\n\n"), 20);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  try {
    const session = await fetch(app.origin + "/api/session", {
      method: "POST",
      headers: { Origin: app.origin },
      body: JSON.stringify({ token: app.url.split("#")[1] }),
    });
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const call = (route, data) =>
      fetch(app.origin + "/api/" + route, {
        method: "POST",
        headers: { Origin: app.origin, Cookie: cookie },
        body: JSON.stringify(data),
      });
    await call("provider", {
      id: "stop-test",
      name: "Stop test",
      protocol: "chat",
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    });
    await call("preferences", {
      selection: {
        provider: "stop-test",
        model: "test",
        profile: "general",
        maxTokens: 128,
      },
    });
    const chat = await (await call("chat/new", {})).json();
    const r = await call("send", { id: chat.id, text: "Say hello" }),
      reader = r.body.getReader();
    let text = "";
    const decoder = new TextDecoder();
    while (!text.includes("Partial answer")) {
      const chunk = await reader.read();
      if (chunk.done) throw Error("Stream ended early");
      text += decoder.decode(chunk.value);
    }
    await call("stop", { id: chat.id });
    for (;;) {
      const c = await reader.read();
      if (c.done) break;
      text += decoder.decode(c.value);
    }
    assert.ok(text.includes("Stopped"));
    const saved = app.store.chat(chat.id).messages.at(-1);
    assert.equal(saved.content, "Partial answer");
    assert.equal(saved.stopped, true);
    assert.equal(saved.error, "Stopped");
  } finally {
    app.close();
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
