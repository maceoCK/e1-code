const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const base = path.resolve(__dirname, ".."),
  root = path.resolve(base, ".."),
  original = path.join(
    root,
    "outputs/claude-desktop-decomp/full/original/Claude.app/Contents/Resources/ion-dist",
  ),
  installed = path.join(
    os.homedir(),
    "Applications/E1 Code.app/Contents/Resources/ion-dist",
  );
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
function walk(dir, prefix = "") {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((f) =>
      f.isDirectory()
        ? walk(path.join(dir, f.name), path.join(prefix, f.name))
        : [path.join(prefix, f.name)],
    );
}
const files = [],
  patched = [], patchedJavaScript = [];
let keyframes = 0,
  motionDeclarations = 0;
for (const file of walk(original)) {
  const a = fs.readFileSync(path.join(original, file)),
    b = fs.readFileSync(path.join(installed, file));
  if (file.endsWith(".html")) {
    const expected = a
      .toString()
      .replace(
        /(<link rel="icon"[^>]*href=")[^"]+/,
        "$1/assets/v1/aster-logo.svg",
      )
      .replace(
        "</head>",
        '<link rel="stylesheet" href="/assets/v1/aster-theme.css" data-aster-theme><script defer src="/assets/v1/aster-branding.js"></script><script defer src="/assets/v1/e1-billing.js"></script><script defer src="/assets/v1/e1-preferences-dialog.js"></script><script defer src="/assets/v1/e1-model-list.js"></script><script defer src="/assets/v1/e1-workflows.js"></script><script defer src="/assets/v1/e1-speed.js"></script></head>',
      );
    assert.equal(
      b.toString(),
      expected,
      file + " has unexpected markup changes",
    );
    patched.push(file);
  } else if (file === require('./patch-workflow-renderer.cjs').file) {
    assert.equal(b.toString(), require('./patch-workflow-renderer.cjs').patch(a.toString()), 'Unexpected workflow renderer changes');
    patchedJavaScript.push({ file, purpose: 'Recognize Ultracode independently of provider reasoning effort', sha256: hash(b) });
  } else if (file === require('./patch-model-browser.cjs').file) {
    assert.equal(b.toString(), require('./patch-model-browser.cjs').patch(a.toString()), 'Unexpected model browser changes');
    patchedJavaScript.push({file,purpose:'Group, sort and search model choices without changing inference routes',sha256:hash(b)});
  } else if (file === require('./patch-tab-actions.cjs').file) {
    assert.equal(b.toString(),require('./patch-tab-actions.cjs').patch(a.toString()));
    patchedJavaScript.push({file,purpose:'Expose native pane actions to browser start',sha256:hash(b)});
  } else if (file === require('./patch-browser-start.cjs').file) {
    assert.equal(b.toString(),require('./patch-browser-start.cjs').patch(a.toString()));
    patchedJavaScript.push({file,purpose:'Browser start layout with native actions and same-tab navigation',sha256:hash(b)});
  } else if (file === require('./patch-title-renderer.cjs').file) {
    assert.equal(b.toString(), require('./patch-title-renderer.cjs').patch(a.toString()), 'Unexpected split-pane title changes');
    patchedJavaScript.push({ file, purpose: 'Keep split-pane title pinning consistent with display branding', sha256: hash(b) });
  } else {
    assert.ok(a.equals(b), file + " differs from captured renderer");
    files.push({ file, sha256: hash(b) });
  }
  if (file.endsWith(".css")) {
    keyframes += (a.toString().match(/@(?:-webkit-)?keyframes\b/g) || [])
      .length;
    motionDeclarations += (
      a
        .toString()
        .match(/(?:^|[;{])(?:animation|transition)(?:-[a-z-]+)?\s*:/g) || []
    ).length;
  }
}
const theme = fs.readFileSync(
  path.join(installed, "assets/v1/aster-theme.css"),
  "utf8",
);
assert.equal(
  theme,
  fs.readFileSync(path.join(base, "src/recovered-theme.css"), "utf8"),
);
const declarations = [...theme.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)];
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/aster-branding.js'))
  .equals(fs.readFileSync(path.join(base, 'src/recovered-branding.js'))));
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/aster-logo.svg'))
  .equals(fs.readFileSync(path.join(base, 'assets/aster-source.svg'))));
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/e1-billing.js'))
  .equals(fs.readFileSync(path.join(base, 'src/billing-indicator.js'))));
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/e1-workflows.js'))
  .equals(fs.readFileSync(path.join(base, 'src/workflow-picker.js'))));
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/e1-speed.js')).equals(fs.readFileSync(path.join(base, 'src/speed-picker.js'))));
assert.ok(fs.readFileSync(path.join(installed, 'assets/v1/e1-preferences-dialog.js')).equals(fs.readFileSync(path.join(base, 'src/native-preferences-dialog.js'))));
for (const [source,target] of [['model-list.js','e1-model-list.js'],['native-model-browser.js','e1-model-browser.js'],['browser-start.js','e1-browser-start.js']])
  assert.ok(fs.readFileSync(path.join(installed,'assets/v1',target)).equals(fs.readFileSync(path.join(base,'src',source))));
const brandData = JSON.parse(fs.readFileSync(path.join(installed, 'assets/v1/aster-branding.json')));
assert.equal(brandData.sourceSha256, hash(fs.readFileSync(path.join(base, 'assets/aster-source.svg'))));
assert.ok(declarations.length > 0);
for (const [, name, value] of declarations) {
  assert.ok(name.startsWith("--"), "Theme changes layout or behavior: " + name);
  assert.match(
    name,
    /^--(?:(?:cds-)?(?:clay|surface)|cds-fill-brand-hover|_brand|accent-brand|bg-)/,
  );
  assert.match(value.trim(), /^(#[a-f\d]{6}|\d+ \d+% \d+%)$/i);
}
const report = {
  checkedAt: new Date().toISOString(),
  capturedVersion: "2.19675.0",
  unchangedFiles: files.length,
  unchangedJavaScript: files.filter((f) => f.file.endsWith(".js")).length,
  unchangedStylesheets: files.filter((f) => f.file.endsWith(".css")).length,
  unchangedFonts: files.filter((f) => /\.woff2?$/.test(f.file)).length,
  originalKeyframes: keyframes,
  originalMotionDeclarations: motionDeclarations,
  patchedHTML: patched,
  patchedJavaScript,
  theme: "color properties only",
  branding: JSON.parse(fs.readFileSync(path.join(base, 'evidence/branding-build.json'), 'utf8')),
  animationRuntime:
    "Native Code and Cowork host interactions exercised; frame-level animation timing parity remains unverified",
  files,
};
fs.writeFileSync(
  path.join(base, "evidence/renderer-fidelity.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, files: undefined }, null, 2));
