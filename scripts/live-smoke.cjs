const P = require("../src/providers.cjs"),
  fs = require("node:fs");
(async () => {
  const ps = P.initialProviders(),
    report = [];
  for (const id of ["openai", "pi-abliteration", "ollama"]) {
    const p = ps.find((p) => p.id === id);
    if (!p) continue;
    try {
      const key = P.resolveKey(p);
      const found = await P.models(p, key);
      console.log(
        p.name,
        "models available:",
        found.length,
        found
          .filter((m) => /gpt-.*(mini|luna)|abliter|qwen/i.test(m.id))
          .slice(0, 25)
          .map((m) => m.id),
      );
      const model =
        id === "openai"
          ? ["gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini"].find((id) =>
              found.some((m) => m.id === id),
            ) || found.find((m) => /^gpt-/.test(m.id))?.id
          : p.models[0]?.id || found[0]?.id;
      if (!model) throw Error("No chat model found.");
      let content = "",
        profile;
      const started = Date.now();
      for await (const e of P.generate(
        p,
        key,
        model,
        [
          {
            role: "user",
            content:
              "Reply with one short sentence describing what a multi-model desktop chat app does.",
          },
        ],
        { maxTokens: 512, think: false },
      )) {
        if (e.type === "delta") content += e.text;
        if (e.type === "profile") profile = e.profile;
      }
      report.push({
        provider: p.name,
        model,
        profile,
        ok: true,
        content,
        elapsedMs: Date.now() - started,
      });
      console.log(p.name, "PASS", model, content.slice(0, 400));
    } catch (e) {
      report.push({ provider: p.name, ok: false, error: e.message });
      console.log(p.name, "FAIL", e.message);
    }
  }
  fs.writeFileSync(
    require("node:path").join(__dirname, "../evidence/live-providers.json"),
    JSON.stringify(report, null, 2),
  );
})();
