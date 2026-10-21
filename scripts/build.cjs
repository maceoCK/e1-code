const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  crypto = require("node:crypto");
let bundleTransaction;
// The renderer and main-process patches target this exact Claude Desktop build.
const capturedVersion = "3.1623.0";
// The main-process chunk is owned by patch-native-capabilities.cjs; don't
// duplicate its hashed file name here.
function nativeCapabilitiesChunk() {
  const patcher = require("./patch-native-capabilities.cjs");
  if (typeof patcher.file === "string") return patcher.file;
  const declared = fs.readFileSync(require.resolve("./patch-native-capabilities.cjs"), "utf8").match(/\bconst\s+file\s*=\s*["']([^"']+)["']/);
  if (!declared) throw Error("Cannot tell which main-process chunk patch-native-capabilities.cjs patches.");
  return declared[1];
}
function bundleVersion(bundle) {
  const plist = path.join(bundle, "Contents/Info.plist");
  if (!fs.existsSync(plist)) return null;
  try { return cp.execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist], { encoding: "utf8" }).trim(); }
  catch { return null; }
}
// Captured documents that must stay byte-identical. client-shell-v1.html is the
// sandboxed custom-3p module shell: the main process serves it with
// `script-src 'unsafe-inline' blob:; style-src 'none'; sandbox allow-scripts`,
// so injected same-origin tags would be blocked and would break its handshake.
const isolatedDocument = (html) => /<html\b[^>]*\bdata-client-shell\b/i.test(html) || /<meta\s+http-equiv=["']?Content-Security-Policy/i.test(html);
// Matches the injection in the installed E1 Code (reference/installed-ion/*.html).
const rendererScripts = ["aster-branding.js", "e1-billing.js", "e1-preferences-dialog.js", "e1-model-list.js", "e1-workflows.js", "e1-speed.js", "e1-dot.js", "e1-new-tab.js", "e1-settings-form.js", "e1-settings-navigation.js"];
// Diagnostics only: E1_FREEZE_WATCHDOG=1 loads the freeze watchdog before the
// app modules. It throttles microtasks/focus/observers, so it is never on by default.
const rendererHead = () =>
  (process.env.E1_FREEZE_WATCHDOG === "1" ? '<script src="/assets/v1/e1-freeze-watchdog.js"></script>' : "") +
  '<link rel="stylesheet" href="/assets/v1/aster-theme.css" data-aster-theme>' +
  rendererScripts.map((name) => `<script defer src="/assets/v1/${name}"></script>`).join("") +
  "</head>";
(async () => {
  const base = path.resolve(__dirname, ".."),
    capture = process.env.E1_CAPTURE_ROOT && path.resolve(process.env.E1_CAPTURE_ROOT),
    out = path.join(base, "dist"),
    installedBundle = process.env.E1_APP_BUNDLE ? path.resolve(process.env.E1_APP_BUNDLE) : path.join(out, "E1 Code.app"),
    stage = path.join(base, ".package");
  if (process.platform !== 'darwin') throw Error('Native builds require macOS.');
  if (!capture) throw Error('Set E1_CAPTURE_ROOT to your local compatible capture. Proprietary application files are not included in this repository. See docs/native-build.md.');
  for (const relative of ['full/original/Claude.app/Contents/Info.plist', 'extracted/app/package.json', path.posix.join('extracted/app', nativeCapabilitiesChunk()), 'full/original/Claude.app/Contents/Resources/ion-dist/index.html'])
    if (!fs.existsSync(path.join(capture, relative))) throw Error('Missing local build input: ' + relative + '. See docs/native-build.md.');
  const captureVersion = JSON.parse(fs.readFileSync(path.join(capture, 'extracted/app/package.json'), 'utf8')).version;
  if (captureVersion !== capturedVersion) throw Error(`The capture is Claude ${captureVersion}; this integration targets ${capturedVersion}. See docs/native-build.md.`);
  require('./build-branding.cjs').spriteSource(capture);
  fs.mkdirSync(out, { recursive: true });
  const originalBundle = path.join(capture, "full/original/Claude.app");
  // Rebuild in place only over a bundle of the same Claude version. Otherwise
  // start from the capture so Electron, helpers, app.asar.unpacked and every
  // renderer chunk match the patched archive.
  const reuseInstalled = bundleVersion(installedBundle) === capturedVersion;
  bundleTransaction = require('./bundle-transaction.cjs').beginBundle(
    installedBundle,
    originalBundle,
    (from, to) => cp.execFileSync('/bin/cp', ['-cR', reuseInstalled ? from : originalBundle, to]),
  );
  const bundle = bundleTransaction.bundle;
  // The staged app tree is a cache; discard it when it came from another capture.
  const stagedPackage = path.join(stage, "package.json");
  if (fs.existsSync(stage) && (!fs.existsSync(stagedPackage) || JSON.parse(fs.readFileSync(stagedPackage, "utf8")).version !== capturedVersion))
    fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  if (!fs.existsSync(path.join(stage, ".vite")))
    fs.cpSync(
      path.join(capture, "extracted/app"),
      stage,
      { recursive: true },
    );
  // Replace the wrapper tree so removed source files cannot survive in the build cache.
  fs.rmSync(path.join(stage, "aster"), { recursive: true, force: true });
  fs.cpSync(path.join(base, "src"), path.join(stage, "aster"), {
    recursive: true,
  });
  require("./patch-native-capabilities.cjs")(capture, stage);
  const pkg = JSON.parse(fs.readFileSync(path.join(stage, "package.json")));
  pkg.originalMain = pkg.originalMain || pkg.main;
  pkg.main = "aster/main.cjs";
  pkg.productName = "E1 Code";
  pkg.description = "Multi-provider desktop workspace";
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(pkg, null, 2),
  );
  const asar = await import("@electron/asar");
  const archive = path.join(bundle, "Contents/Resources/app.asar");
  await asar.createPackageWithOptions(stage, archive, {
    unpack: "**/*.{node,dylib}",
    unpackDir: "resources",
  });
  const hash = crypto
    .createHash("sha256")
    .update(asar.getRawHeader(archive).headerString)
    .digest("hex");
  const svg = fs.readFileSync(path.join(base, "src/ui/logo.svg"), "utf8");
  const ionOriginal = path.join(
    capture,
    "full/original/Claude.app/Contents/Resources/ion-dist",
  );
  const ion = path.join(bundle, "Contents/Resources/ion-dist");
  require('./patch-workflow-renderer.cjs').install(ionOriginal, ion);
  require('./patch-title-renderer.cjs').install(ionOriginal, ion);
  require('./patch-model-browser.cjs').install(ionOriginal, ion);
  require('./patch-tab-actions.cjs').install(ionOriginal, ion);
  require('./patch-browser-start.cjs').install(ionOriginal, ion);
  require('./patch-mixed-tabs.cjs').install(ionOriginal, ion);
  require('./patch-settings-pages.cjs').install(ionOriginal, ion);
  require('./patch-sandbox-settings.cjs').install(ionOriginal, ion);
  const nativeDot=require('./patch-dot-native.cjs').install(ion,base);
  const brand = await require('./build-branding.cjs')(base, path.join(ion, 'assets/v1'), capture);
  fs.copyFileSync(
    path.join(base, "src/recovered-theme.css"),
    path.join(ion, "assets/v1/aster-theme.css"),
  );
  fs.writeFileSync(path.join(ion, "assets/v1/aster-logo.svg"), svg);
  fs.copyFileSync(path.join(base, 'src/billing-indicator.js'), path.join(ion, 'assets/v1/e1-billing.js'));
  fs.copyFileSync(path.join(base, 'src/native-preferences-dialog.js'), path.join(ion, 'assets/v1/e1-preferences-dialog.js'));
  fs.copyFileSync(path.join(base, 'src/model-list.js'), path.join(ion, 'assets/v1/e1-model-list.js'));
  fs.copyFileSync(path.join(base, 'src/native-model-browser.js'), path.join(ion, 'assets/v1/e1-model-browser.js'));
  fs.copyFileSync(path.join(base, 'src/workflow-picker.js'), path.join(ion, 'assets/v1/e1-workflows.js'));
  fs.copyFileSync(path.join(base, 'src/speed-picker.js'), path.join(ion, 'assets/v1/e1-speed.js'));
  fs.copyFileSync(path.join(base, 'src/new-tab-picker.js'), path.join(ion, 'assets/v1/e1-new-tab.js'));
  for(const name of ['mixed-tabs','mixed-tab-state','mixed-tab-context'])
    fs.copyFileSync(path.join(base, 'src',name+'.js'),path.join(ion,'assets/v1/e1-'+name+'.js'));
  fs.copyFileSync(path.join(base, 'src/browser-start.js'), path.join(ion, 'assets/v1/e1-browser-start.js'));
  fs.writeFileSync(path.join(ion,'assets/v1/e1-dot.js'),fs.readFileSync(path.join(base,'src/dot-sidebar.js'),'utf8').replaceAll('__E1_DOT_VERSION__',nativeDot.version));
  fs.copyFileSync(path.join(base, 'src/ui/settings/app.js'), path.join(ion, 'assets/v1/e1-settings-form.js'));
  fs.copyFileSync(path.join(base, 'src/native-settings-navigation.js'), path.join(ion, 'assets/v1/e1-settings-navigation.js'));
  fs.copyFileSync(path.join(base, 'src/native-settings-pages.js'), path.join(ion, 'assets/v1/e1-settings-pages.js'));
  fs.copyFileSync(path.join(base, 'src/freeze-watchdog.js'), path.join(ion, 'assets/v1/e1-freeze-watchdog.js'));
  fs.rmSync(path.join(ion,'assets/v1/e1-settings-modal.js'),{force:true});
  // Start from captured HTML every time. The targeted workflow and title
  // adapters preserve the original styling and motion sources.
  const injected = [], head = rendererHead();
  for (const file of fs
    .readdirSync(ionOriginal)
    .filter((f) => f.endsWith(".html"))) {
    const captured = fs.readFileSync(path.join(ionOriginal, file), "utf8");
    if (isolatedDocument(captured)) {
      fs.writeFileSync(path.join(ion, file), captured);
      continue;
    }
    if (!captured.includes("</head>")) throw Error("Captured " + file + " has no </head>; review the renderer injection.");
    const html = captured
      .replace(
        /(<link rel="icon"[^>]*href=")[^"]+/,
        "$1/assets/v1/aster-logo.svg",
      )
      .replace("</head>", () => head);
    fs.writeFileSync(path.join(ion, file), html);
    injected.push(file);
  }
  for (const file of ["index.html", "frame-shell.html", "frame-connect.html", "frame-manage.html"])
    if (!injected.includes(file)) throw Error("E1 renderer scripts were not injected into " + file + ".");
  const sharp = require("sharp");
  const iconset = path.join(base, ".icon.iconset");
  fs.mkdirSync(iconset, { recursive: true });
  const art = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="20" y="20" width="984" height="984" rx="225" fill="#e4ebe5"/><svg x="188" y="188" width="648" height="648" viewBox="${brand.viewBox}"><path d="${brand.mark}" fill="#35665b" fill-rule="evenodd"/></svg></svg>`,
  );
  await sharp(art).png().toFile(path.join(out, 'Aster-icon.png'));
  fs.copyFileSync(path.join(out, 'Aster-icon.png'), path.join(bundle, 'Contents/Resources/aster-icon.png'));
  for (const n of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      await sharp(art)
        .resize(n * scale)
        .png()
        .toFile(
          path.join(iconset, `icon_${n}x${n}${scale === 2 ? "@2x" : ""}.png`),
        );
  cp.execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(bundle, "Contents/Resources/aster.icns"),
  ]);
  cp.execFileSync("python3", [
    "-c",
    `import plistlib,sys\np=sys.argv[1]\nd=plistlib.load(open(p,'rb'))\nold=d['CFBundleExecutable'];exe=__import__('pathlib').Path(p).parent/'MacOS';(exe/old).rename(exe/'E1 Code') if old!='E1 Code' else None\nd.update(CFBundleExecutable='E1 Code',CFBundleName='E1 Code',CFBundleDisplayName='E1 Code',CFBundleIdentifier='local.aster.desktop',CFBundleIconFile='aster.icns')\nd.pop('CFBundleIconName',None)\nfor k,v in list(d.items()):\n if k.endswith('UsageDescription') and isinstance(v,str): d[k]=v.replace('Claude','E1 Code').replace('Aster','E1 Code')\nd['ElectronAsarIntegrity']={'Resources/app.asar':{'algorithm':'SHA256','hash':sys.argv[2]}}\nd.pop('CFBundleURLTypes',None)\nplistlib.dump(d,open(p,'wb'))`,
    path.join(bundle, "Contents/Info.plist"),
    hash,
  ]);
  cp.execFileSync("python3", [
    "-c",
    `import pathlib,plistlib,sys
r=pathlib.Path(sys.argv[1])/'Contents/Frameworks'
for app in list(r.glob('*Helper*.app')):
 p=app/'Contents/Info.plist';d=plistlib.load(open(p,'rb'));old=d['CFBundleExecutable'];new=old.replace('Claude','E1 Code').replace('Aster','E1 Code');(app/'Contents/MacOS'/old).rename(app/'Contents/MacOS'/new)
 d['CFBundleExecutable']=new;d['CFBundleName']=d.get('CFBundleName',old).replace('Claude','E1 Code').replace('Aster','E1 Code');d['CFBundleIdentifier']=d['CFBundleIdentifier'].replace('com.anthropic.claudefordesktop','local.aster.desktop')
 plistlib.dump(d,open(p,'wb'));app.rename(app.with_name(app.name.replace('Claude','E1 Code').replace('Aster','E1 Code')))
`,
    bundle,
  ]);
  const ent = path.join(base, ".entitlements.plist");
  // Preserve generic capabilities required by the captured native workflows.
  // Vendor team identities and Keychain access groups do not belong to this app.
  const entitlements = [
    "cs.allow-jit",
    "cs.allow-unsigned-executable-memory",
    "cs.disable-library-validation",
    "virtualization",
    "automation.apple-events",
    "device.audio-input",
    "device.camera",
    "device.bluetooth",
    "device.print",
    "device.usb",
    "personal-information.location",
    "personal-information.photos-library",
  ];
  fs.writeFileSync(
    ent,
    '<?xml version="1.0"?><plist version="1.0"><dict>' +
      entitlements
        .map((name) => `<key>com.apple.security.${name}</key><true/>`)
        .join("") +
      "</dict></plist>",
  );
  cp.execFileSync("xattr", ["-cr", bundle]);
  const helper = require('./build-keychain-helper.cjs').buildHelper(base);
  require('./build-browser-storage.cjs')(base, path.join(bundle, 'Contents/Resources/e1-browser-storage.node'));
  // Embedded CLIProxyAPI (subscription inference). The pinned upstream binary is
  // verified against its manifest, then deep-signed with the rest of the bundle.
  const proxyVendor = path.join(base, 'third_party/cliproxyapi');
  const proxyManifest = JSON.parse(fs.readFileSync(path.join(proxyVendor, 'manifest.json'), 'utf8'));
  const proxyBinary = fs.readFileSync(path.join(proxyVendor, 'cli-proxy-api'));
  if (crypto.createHash('sha256').update(proxyBinary).digest('hex') !== proxyManifest.binarySha256) throw Error('CLIProxyAPI checksum mismatch; run python3 third_party/cliproxyapi/fetch.py.');
  const proxyTarget = path.join(bundle, 'Contents/Resources/cliproxyapi');
  fs.rmSync(proxyTarget, { recursive: true, force: true });
  fs.mkdirSync(proxyTarget, { recursive: true });
  for (const name of ['cli-proxy-api', 'LICENSE', 'manifest.json']) fs.copyFileSync(path.join(proxyVendor, name), path.join(proxyTarget, name));
  fs.chmodSync(path.join(proxyTarget, 'cli-proxy-api'), 0o755);
  const signing = require('./signing.cjs').configuration();
  cp.execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", signing.identity, ...signing.args, "--entitlements", ent, bundle],
    { stdio: "pipe" },
  );
  // Restore the cached, signed helper AFTER deep signing. Its own bytes and
  // Keychain identity must not change with the surrounding application.
  const helperBundle = path.resolve(helper.executable, '../../..');
  const bundledHelper = path.join(bundle, 'Contents/Helpers/E1 Keychain Helper.app');
  fs.rmSync(bundledHelper, { recursive: true, force: true });
  fs.cpSync(helperBundle, bundledHelper, { recursive: true });
  const helperManifest = { version: helper.version, sourceSha256: helper.sourceSha256, sha256: helper.sha256,
    relativeExecutable: '../Helpers/E1 Keychain Helper.app/Contents/MacOS/E1 Keychain Helper' };
  fs.writeFileSync(path.join(bundle, 'Contents/Resources/e1-keychain-helper.json'), JSON.stringify(helperManifest, null, 2) + '\n');
  cp.execFileSync('codesign', ['--force', '--sign', signing.identity, ...signing.args, '--entitlements', ent, bundle], { stdio: 'pipe' });
  const previousBundle = bundleTransaction.commit(candidate => {
    const actualHash = crypto.createHash('sha256')
      .update(asar.getRawHeader(path.join(candidate, 'Contents/Resources/app.asar')).headerString).digest('hex');
    const metadata = JSON.parse(cp.execFileSync('plutil', ['-extract', 'ElectronAsarIntegrity', 'json', '-o', '-', path.join(candidate, 'Contents/Info.plist')], {encoding:'utf8'}));
    if(metadata['Resources/app.asar']?.hash !== actualHash) throw Error('Packaged archive checksum does not match Info.plist');
    const helperPath = path.join(candidate, 'Contents/Helpers/E1 Keychain Helper.app/Contents/MacOS/E1 Keychain Helper');
    const helperHash = crypto.createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex');
    if(helperHash !== helperManifest.sha256) throw Error('Bundled Keychain helper checksum does not match its manifest');
    cp.execFileSync('codesign', ['--verify', '--deep', '--strict', candidate], {stdio:'pipe'});
  });
  fs.writeFileSync(
    path.join(out, "build.json"),
    JSON.stringify(
      {
        bundle: installedBundle,
        previousBundle,
        capturedVersion,
        appArchiveHeaderHash: hash,
        builtAt: new Date().toISOString(),
        signature: signing.description,
        entry: "aster/main.cjs",
      },
      null,
      2,
    ),
  );
  const link = path.join(out, "E1 Code.app");
  if (!fs.existsSync(link)) fs.symlinkSync(installedBundle, link);
  console.log("Built and verified", installedBundle);
})().catch((e) => {
  try { bundleTransaction?.abort(); } catch(cleanupError) { console.error("Build cleanup:", cleanupError.message); }
  console.error(e.message);
  process.exit(1);
});
