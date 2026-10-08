const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const f = path.join(
    os.homedir(),
    "Library/Application Support/Aster/settings-ui.json",
  );
  let d;
  for (let i = 0; i < 50; i++) {
    try {
      d = JSON.parse(fs.readFileSync(f));
      process.kill(d.pid, 0);
      const r = await fetch(d.origin, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
      d = null;
    } catch {
      d = null;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!d) throw Error("Native backend did not become ready.");
  let r = await fetch(d.origin + "/api/session", {
    method: "POST",
    headers: { Origin: d.origin },
    body: JSON.stringify({ token: d.url.split("#")[1] }),
  });
  if (!r.ok) throw Error("Native session failed.");
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const results = [];
  for (const provider of ["openai", "pi-abliteration", "ollama"]) {
    const r = await fetch(d.origin + "/api/models", {
      method: "POST",
      headers: { Origin: d.origin, Cookie: cookie },
      body: JSON.stringify({ provider }),
    });
    const j = await r.json();
    console.log(provider, r.status, r.ok ? j.models.length : j.error);
    results.push({
      provider,
      status: r.status,
      models: j.models?.length,
      error: j.error,
    });
  }
  fs.writeFileSync(
    path.join(__dirname, "../evidence/native-connections.json"),
    JSON.stringify({ pid: d.pid, origin: d.origin, results }, null, 2),
  );
  if (results.some((r) => r.status !== 200)) process.exitCode = 1;
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
