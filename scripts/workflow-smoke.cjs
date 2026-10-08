const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { Store } = require("../src/store.cjs"),
  { startGateway } = require("../src/gateway.cjs");
(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aster-workflows-"));
  const requests = [],
    results = [];
  const only = process.env.ASTER_WORKFLOW_PROVIDER;
  const gateway = await startGateway({
    store: new Store(
      path.join(os.homedir(), "Library/Application Support/Aster"),
    ),
    onRequest: (r) => requests.push(r),
    transport: async (url, opts) => {
      try {
        return await fetch(url, opts);
      } catch (e) {
        console.error(
          "Transport failed",
          new URL(url).origin,
          e.cause?.code,
          e.cause?.message,
        );
        throw e;
      }
    },
  });
  const binary = require("./engine-path.cjs")();
  const report = () =>
    fs.writeFileSync(
      path.join(
        __dirname,
        only
          ? `../evidence/workflows-${only}.json`
          : "../evidence/workflows.json",
      ),
      JSON.stringify(
        { at: new Date().toISOString(), workspace, engine: "2.1.286", results },
        null,
        2,
      ),
    );
  const run = async (dir, route, prompt, extra = []) => {
    const start = Date.now(),
      from = requests.length;
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: path.join(dir, ".config"),
      ANTHROPIC_API_KEY: gateway.token,
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: gateway.origin,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ENABLE_TOOL_SEARCH: "false",
      DISABLE_TELEMETRY: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "",
    };
    const out = await new Promise((resolve, reject) => {
      const child = cp.execFile(
        binary,
        [
          "--bare",
          "-p",
          prompt,
          "--model",
          route.id,
          "--tools",
          "Read,Edit,Write,Bash",
          "--allowedTools",
          "Read",
          "Edit",
          "Write",
          "Bash(node:*)",
          "--max-turns",
          "12",
          "--output-format",
          "json",
          ...extra,
        ],
        { cwd: dir, env, timeout: 240000, maxBuffer: 8e6 },
        (e, stdout, stderr) =>
          e
            ? reject(
                Error(
                  `Engine ${e.code}: ${stdout.slice(-1500)} ${stderr.slice(-500)}`,
                ),
              )
            : resolve(stdout),
      );
      child.stdin.end();
    });
    const answer = JSON.parse(out),
      calls = requests.slice(from);
    assert.equal(
      answer.is_error,
      false,
      answer.result || JSON.stringify(answer),
    );
    return {
      answer,
      calls,
      seconds: Math.round((Date.now() - start) / 100) / 10,
    };
  };
  try {
    for (const [provider, model] of [
      ["openai", "gpt-5.4-mini"],
      ["pi-abliteration", "abliterated-model-large-v2"],
      ["ollama", "qwen3.5:9b"],
    ]) {
      if (only && provider !== only) continue;
      const dir = path.join(workspace, provider);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "sum.cjs"),
        "exports.sum = (a, b) => a - b;\n",
      );
      fs.writeFileSync(
        path.join(dir, "verify.cjs"),
        "const a = require('node:assert/strict'); const {sum} = require('./sum.cjs'); a.equal(sum(5,7),12); a.equal(sum(-4,9),5); console.log('SUM_CHECK_PASSED');\n",
      );
      const route = gateway
        .catalog()
        .find((r) => r.provider === provider && r.model === model);
      const { answer, calls, seconds } = await run(
        dir,
        route,
        "Work only in this directory. Read sum.cjs and verify.cjs using Read. Repair the addition bug in sum.cjs using Edit (do not change verify.cjs). Run node verify.cjs with Bash and confirm it succeeds. Write a short result to result.txt using Write, including SUM_CHECK_PASSED only after the test passes. Do not access the network, install anything, or modify other files.",
      );
      assert.match(
        cp.execFileSync(process.execPath, ["verify.cjs"], {
          cwd: dir,
          encoding: "utf8",
        }),
        /SUM_CHECK_PASSED/,
      );
      assert.match(
        fs.readFileSync(path.join(dir, "result.txt"), "utf8"),
        /SUM_CHECK_PASSED/,
      );
      const tools = [
        ...new Set(calls.flatMap((c) => c.returnedToolNames || [])),
      ];
      for (const name of ["Read", "Edit", "Bash"])
        assert.ok(tools.includes(name), `Missing actual ${name}`);
      assert.ok(calls.some((c) => c.streaming));
      const item = {
        provider,
        model,
        workflow: "read-edit-run-create-output",
        success: true,
        tools,
        requests: calls.length,
        streaming: true,
        seconds,
      };
      results.push(item);
      report();
      console.log(JSON.stringify(item));
      if (provider === "openai") {
        const resumed = await run(
          dir,
          route,
          "Without using any tools, name the exact test command you ran in our previous conversation and its success marker.",
          ["--resume", answer.session_id],
        );
        assert.match(resumed.answer.result, /node verify\.cjs/);
        assert.match(resumed.answer.result, /SUM_CHECK_PASSED/);
        results.push({
          provider,
          model,
          workflow: "resume",
          success: true,
          seconds: resumed.seconds,
        });
        report();
        const before = fs.readFileSync(path.join(dir, "sum.cjs"));
        const planned = await run(
          dir,
          route,
          "Read sum.cjs. Plan how to add subtraction support. Stay in plan mode; do not edit or run commands. Return the proposed steps.",
          ["--permission-mode", "plan", "--allowedTools", "Read"],
        );
        assert.ok(before.equals(fs.readFileSync(path.join(dir, "sum.cjs"))));
        assert.ok(
          !planned.calls
            .flatMap((c) => c.returnedToolNames || [])
            .some((t) => ["Edit", "Write", "Bash"].includes(t)),
        );
        results.push({
          provider,
          model,
          workflow: "plan-mode",
          success: true,
          filesUnchanged: true,
          seconds: planned.seconds,
        });
        report();
        const sharp = require("sharp");
        const options = [
          { name: "red", hex: "#e52323" },
          { name: "blue", hex: "#204ee8" },
          { name: "green", hex: "#14994a" },
        ].sort(() => crypto.randomInt(3) - 1);
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160"><rect width="360" height="160" fill="white"/>' +
          options
            .map(
              (c, i) =>
                `<rect x="${15 + i * 115}" y="30" width="95" height="100" fill="${c.hex}"/>`,
            )
            .join("") +
          "</svg>";
        await sharp(Buffer.from(svg))
          .png()
          .toFile(path.join(dir, "visual.png"));
        const visual = await run(
          dir,
          route,
          "Use Read to view visual.png. Reply only with the three rectangle colors in left-to-right order. Do not use Bash or inspect bytes; identify the pixels.",
          ["--allowedTools", "Read"],
        );
        const colors = visual.answer.result
          .toLowerCase()
          .match(/red|blue|green/g);
        assert.deepEqual(
          colors,
          options.map((c) => c.name),
        );
        results.push({
          provider,
          model,
          workflow: "image-tool-result",
          success: true,
          pixelsVerified: true,
          seconds: visual.seconds,
        });
        report();
      }
    }
  } catch (e) {
    results.push({ success: false, error: e.message });
    report();
    throw e;
  } finally {
    gateway.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
