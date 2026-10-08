const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  crypto = require("node:crypto");
(async () => {
  const base = path.resolve(__dirname, ".."),
    capture = process.env.E1_CAPTURE_ROOT && path.resolve(process.env.E1_CAPTURE_ROOT),
    out = path.join(base, "dist"),
    bundle = process.env.E1_APP_BUNDLE ? path.resolve(process.env.E1_APP_BUNDLE) : path.join(out, "E1 Code.app"),
    stage = path.join(base, ".package");
  if (process.platform !== 'darwin') throw Error('Native builds require macOS.');
  if (!capture) throw Error('Set E1_CAPTURE_ROOT to your local compatible capture. Proprietary application files are not included in this repository. See docs/native-build.md.');
  for (const relative of ['full/original/Claude.app/Contents/Info.plist', 'extracted/app/package.json', 'extracted/app/.vite/build/index.chunk-BZdcw7TE.js', 'readable/resources/ion-dist/assets/v1/cf2613ee5-Btwr9m9F.js'])
    if (!fs.existsSync(path.join(capture, relative))) throw Error('Missing local build input: ' + relative + '. See docs/native-build.md.');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(base, 'evidence'), { recursive: true });
  fs.mkdirSync(path.dirname(bundle), { recursive: true });
  if (!fs.existsSync(bundle))
    cp.execFileSync("/bin/cp", [
      "-cR",
      path.join(capture, "full/original/Claude.app"),
      bundle,
    ]);
  fs.mkdirSync(stage, { recursive: true });
  if (!fs.existsSync(path.join(stage, ".vite")))
    fs.cpSync(
      path.join(capture, "extracted/app"),
      stage,
      { recursive: true },
    );
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
  const brand = await require('./build-branding.cjs')(base, path.join(ion, 'assets/v1'), capture);
  fs.copyFileSync(
    path.join(base, "src/recovered-theme.css"),
    path.join(ion, "assets/v1/aster-theme.css"),
  );
  fs.writeFileSync(path.join(ion, "assets/v1/aster-logo.svg"), svg);
  fs.copyFileSync(path.join(base, 'src/billing-indicator.js'), path.join(ion, 'assets/v1/e1-billing.js'));
  fs.copyFileSync(path.join(base, 'src/workflow-picker.js'), path.join(ion, 'assets/v1/e1-workflows.js'));
  fs.copyFileSync(path.join(base, 'src/speed-picker.js'), path.join(ion, 'assets/v1/e1-speed.js'));
  // Start from captured HTML every time. The workflow hook above is the only
  // renderer JS change; original styling and motion sources are preserved.
  for (const file of fs
    .readdirSync(ionOriginal)
    .filter((f) => f.endsWith(".html"))) {
    const html = fs
      .readFileSync(path.join(ionOriginal, file), "utf8")
      .replace(
        /(<link rel="icon"[^>]*href=")[^"]+/,
        "$1/assets/v1/aster-logo.svg",
      )
      .replace(
        "</head>",
        '<link rel="stylesheet" href="/assets/v1/aster-theme.css" data-aster-theme><script defer src="/assets/v1/aster-branding.js"></script><script defer src="/assets/v1/e1-billing.js"></script><script defer src="/assets/v1/e1-workflows.js"></script><script defer src="/assets/v1/e1-speed.js"></script></head>',
      );
    fs.writeFileSync(path.join(ion, file), html);
  }
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
  const signing = require('./signing.cjs').configuration();
  cp.execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", signing.identity, ...signing.args, "--entitlements", ent, bundle],
    { stdio: "pipe" },
  );
  cp.execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {
    stdio: "pipe",
  });
  fs.writeFileSync(
    path.join(out, "build.json"),
    JSON.stringify(
      {
        bundle,
        capturedVersion: "2.19675.0",
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
  if (!fs.existsSync(link)) fs.symlinkSync(bundle, link);
  console.log("Built and verified", bundle);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
