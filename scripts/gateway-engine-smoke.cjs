const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  assert = require("node:assert/strict");
const { Store } = require("../src/store.cjs"),
  { startGateway } = require("../src/gateway.cjs");
(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aster-engine-"));
  const marker =
    "ASTER-TOOL-ROUNDTRIP-" +
    require("node:crypto").randomBytes(8).toString("hex");
  const fixture = path.join(workspace, "verification.txt");
  fs.writeFileSync(fixture, marker + "\n");
  const requests = [];
  const gateway = await startGateway({
    store: new Store(
      path.join(os.homedir(), "Library/Application Support/Aster"),
    ),
    onRequest: (r) => requests.push(r),
  });
  const binary = require("./engine-path.cjs")();
  const results = [];
  try {
    for (const [provider, model] of [
      ["openai", "gpt-5.4-mini"],
      ["pi-abliteration", "abliterated-model-large-v2"],
      ["ollama", "qwen3.5:9b"],
    ]) {
      const route = gateway
          .catalog()
          .find((r) => r.provider === provider && r.model === model),
        from = requests.length,
        start = Date.now();
      const env = {
        ...process.env,
        CLAUDE_CONFIG_DIR: path.join(workspace, "config-" + provider),
        ANTHROPIC_API_KEY: gateway.token,
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: gateway.origin,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ENABLE_TOOL_SEARCH: "false",
        DISABLE_TELEMETRY: "1",
        CLAUDE_CODE_OAUTH_TOKEN: "",
      };
      const stdout = await new Promise((resolve, reject) =>
        cp.execFile(
          binary,
          [
            "--bare",
            "-p",
            `Use the Read tool to read ${fixture}. Return only the exact text stored in that file. You must read it; do not guess.`,
            "--model",
            route.id,
            "--tools",
            "Read",
            "--allowedTools",
            "Read",
            "--max-turns",
            "4",
            "--no-session-persistence",
            "--output-format",
            "json",
          ],
          { cwd: workspace, env, timeout: 180000, maxBuffer: 4e6 },
          (e, out, err) =>
            e
              ? reject(
                  Error(
                    `Engine failed (${e.code}): ${out.slice(-2000)} ${err.slice(-1000)}`,
                  ),
                )
              : resolve(out),
        ),
      );
      const answer = JSON.parse(stdout),
        calls = requests.slice(from);
      assert.equal(answer.is_error, false, JSON.stringify(answer));
      assert.ok(answer.result.includes(marker), answer.result);
      assert.ok(
        calls.some((r) => r.returnedTools > 0),
        "No actual engine tool call",
      );
      const result = {
        provider,
        model,
        engine: "2.1.286",
        success: true,
        toolCallReturned: true,
        fileContentVerified: true,
        requests: calls.length,
        seconds: Math.round((Date.now() - start) / 100) / 10,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    fs.writeFileSync(
      path.join(__dirname, "../evidence/gateway-engine.json"),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
    );
  } finally {
    gateway.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
