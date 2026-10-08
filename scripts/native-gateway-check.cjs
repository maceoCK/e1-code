const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
(async () => {
  const dir = path.join(
    os.homedir(),
    "Library/Application Support/Aster-Workspace-3p",
  );
  const gateway = JSON.parse(
    fs.readFileSync(path.join(dir, "aster-gateway.json")),
  );
  process.kill(gateway.pid, 0);
  const lifecycle = JSON.parse(
    fs.readFileSync(path.join(dir, "aster-lifecycle.json")),
  );
  assert.equal(lifecycle.pid, gateway.pid);
  const workspaceLoaded = lifecycle.loaded.some((x) => x.url.startsWith("app://localhost/"));
  const results = [];
  for (const [provider, model] of [
    ["openai", "gpt-5.4-mini"],
    ["pi-abliteration", "abliterated-model-large-v2"],
    ["ollama", "qwen3.5:9b-aster-128k"],
  ]) {
    const route = gateway.models.find(
      (r) => r.provider === provider && r.model === model,
    );
    assert.ok(route);
    const response = await fetch(gateway.origin + "/v1/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + gateway.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: route.alias,
        max_tokens: 512,
        messages: [
          { role: "user", content: "Reply with exactly: ASTER_GATEWAY_OK" },
        ],
      }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    assert.match(text, /ASTER_GATEWAY_OK/);
    const result = {
      provider,
      model,
      status: response.status,
      completed: data.stop_reason === "end_turn",
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.writeFileSync(
    path.join(__dirname, "../evidence/native-gateway.json"),
    JSON.stringify(
      { at: new Date().toISOString(), pid: gateway.pid, workspaceLoaded, lifecycle, results },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
