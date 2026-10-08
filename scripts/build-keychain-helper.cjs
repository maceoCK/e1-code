const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function buildHelper(base) {
  const signing = require('./signing.cjs').configuration();
  if (signing.identity === '-') throw Error('Set up a persistent signing identity before building the Keychain helper.');
  const root = path.join(os.homedir(), 'Library/Application Support/Aster/keychain');
  const bundle = path.join(root, 'E1 Keychain Helper.app');
  const executable = path.join(bundle, 'Contents/MacOS/E1 Keychain Helper');
  const manifestFile = path.join(root, 'manifest.json');
  const source = path.join(base, 'native/keychain-helper.m');
  const sourceSha256 = hash(source);
  let previous;
  if (fs.existsSync(manifestFile)) {
    const existing = JSON.parse(fs.readFileSync(manifestFile));
    if (existing.sourceSha256 !== sourceSha256 || existing.signingIdentity !== signing.identity) {
      if (process.env.E1_UPDATE_KEYCHAIN_HELPER !== '1') throw Error('Keychain helper source or signing identity changed. Review the change and set E1_UPDATE_KEYCHAIN_HELPER=1 for an explicit update; macOS may require a new approval.');
      previous = existing;
    }
    if (existing.executable !== executable || existing.sha256 !== hash(executable)) throw Error('Installed Keychain helper integrity check failed.');
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundle], { stdio: 'pipe' });
    if (!previous) return existing;
  }
  if (!previous && fs.existsSync(bundle)) throw Error('A Keychain helper exists without its manifest. Preserve it and inspect before rebuilding.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(root, '.build-'));
  try {
    const stage = path.join(temporary, 'E1 Keychain Helper.app');
    const bin = path.join(stage, 'Contents/MacOS/E1 Keychain Helper');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security', source, '-o', bin], { stdio: 'pipe' });
    fs.writeFileSync(path.join(stage, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.aster.keychain-helper</string><key>CFBundleName</key><string>E1 Keychain Helper</string><key>CFBundleExecutable</key><string>E1 Keychain Helper</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>');
    execFileSync('/usr/bin/codesign', ['--force', '--sign', signing.identity, ...signing.args, '--options', 'runtime', '--timestamp=none', stage], { stdio: 'pipe' });
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', stage], { stdio: 'pipe' });
    const manifest = { version: 2, executable, sourceSha256, sha256: hash(bin), signingIdentity: signing.identity };
    if (previous) {
      const backup = path.join(root, 'previous-' + previous.sha256);
      if (fs.existsSync(backup)) throw Error('Helper update backup already exists; inspect before retrying.');
      fs.renameSync(bundle, backup);
      fs.copyFileSync(manifestFile, backup + '.json');
    }
    fs.renameSync(stage, bundle);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return manifest;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { buildHelper };
if (require.main === module) {
  try { const result = buildHelper(path.resolve(__dirname, '..')); console.log(JSON.stringify({ version: result.version, sourceSha256: result.sourceSha256, sha256: result.sha256 })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
