// Run while Aster is closed. Copies only a reference, never the key itself.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const file = path.resolve(process.argv[2] || ""),
  field = process.argv[3] || "OPENAI_API_KEY";
const secrets = JSON.parse(fs.readFileSync(file, "utf8"));
if (typeof secrets[field] !== "string" || !secrets[field])
  throw Error("Requested key field is missing.");
const workspace = path.join(
  os.homedir(),
  "Library/Application Support/Aster/workspace.json",
);
const data = JSON.parse(fs.readFileSync(workspace));
const provider = data.providers.find((p) => p.id === "openai");
if (provider.baseUrl !== "https://api.openai.com/v1")
  throw Error(
    "OpenAI connection has a different endpoint. Refusing to attach an OpenAI key.",
  );
provider.keyFile = { path: file, field, baseUrl: provider.baseUrl };
delete provider.secret;
delete provider.credential;
fs.writeFileSync(workspace, JSON.stringify(data, null, 2), { mode: 0o600 });
console.log(
  "Imported an existing OpenAI credential reference. No key copied to source or renderer.",
);
