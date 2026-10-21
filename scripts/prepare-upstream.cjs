// Prepare the third-party build inputs this repository does not contain: the
// pinned Claude Desktop and ChatGPT releases, and the pinned CLIProxyAPI runtime.
//
// Apps come from a matching local install when there is one, otherwise from the
// vendor's official download URL in third_party/upstream.json. Either way the
// app must pass the same checks before use: valid Developer ID signature from
// the pinned team, bundle id, version, and the signed ElectronAsarIntegrity
// hash of its app.asar. Nothing proprietary is ever committed; captures/ is
// gitignored.
//
//   node scripts/prepare-upstream.cjs [claude] [chatgpt] [cliproxyapi] [--source=auto|installed|download]
//
// E1_UPSTREAM_SOURCE sets the default source. E1_UPSTREAM_APP_<KEY> points at
// another local copy of an app; E1_UPSTREAM_URL_<KEY> at a mirror of its zip
// (the downloaded app is verified the same way).
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pins = require('../third_party/upstream.json');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const run = (bin, args) => cp.execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const infoPlist = app => path.join(app, 'Contents/Info.plist');
function plistValue(app, key, format = 'raw') {
  try { return run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', infoPlist(app)]).trim(); } catch { return null; }
}
const megabytes = bytes => Math.round(bytes / 1048576);

async function verifyApp(app, pin) {
  if (!fs.existsSync(infoPlist(app))) return ['not an application bundle'];
  const problems = [];
  const id = plistValue(app, 'CFBundleIdentifier'), version = plistValue(app, 'CFBundleShortVersionString');
  if (id !== pin.bundleId) problems.push(`bundle id ${id}, expected ${pin.bundleId}`);
  if (version !== pin.version) problems.push(`version ${version}, expected ${pin.version}`);
  if (pin.build && plistValue(app, 'CFBundleVersion') !== pin.build) problems.push(`build ${plistValue(app, 'CFBundleVersion')}, expected ${pin.build}`);
  if (problems.length) return problems;
  try { run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); }
  catch (error) { return ['code signature does not verify: ' + String(error.stderr || error.message).trim().split('\n')[0]]; }
  const details = cp.spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' }).stderr;
  if (!new RegExp(`^TeamIdentifier=${pin.teamId}$`, 'm').test(details)) problems.push(`not signed by team ${pin.teamId}`);
  if (!/^Authority=Developer ID Application: /m.test(details)) problems.push('not a Developer ID signature');
  const integrity = JSON.parse(plistValue(app, 'ElectronAsarIntegrity', 'json') || '{}')['Resources/app.asar']?.hash;
  if (integrity !== pin.asarHeaderSha256) problems.push(`app.asar integrity ${integrity}, expected ${pin.asarHeaderSha256}`);
  const asar = await import('@electron/asar');
  if (sha256(asar.getRawHeader(path.join(app, 'Contents/Resources/app.asar')).headerString) !== integrity)
    problems.push('app.asar does not match its signed integrity hash');
  return problems;
}

async function download(url, destination, expectedBytes, log) {
  if (new URL(url).protocol !== 'https:') throw Error('Upstream downloads must use HTTPS: ' + url);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw Error(`Download failed (HTTP ${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length')) || expectedBytes || 0;
  const part = destination + '.part', out = fs.createWriteStream(part);
  let received = 0, reported = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      if (total && Date.now() - reported > 2000) { reported = Date.now(); log(`  ${megabytes(received)} / ${megabytes(total)} MB`); }
    }
    await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
  } catch (error) { out.destroy(); fs.rmSync(part, { force: true }); throw error; }
  if (total && received !== total) { fs.rmSync(part, { force: true }); throw Error(`Incomplete download (${received} of ${total} bytes): ${url}`); }
  fs.renameSync(part, destination);
}

function layoutComplete(key, capture) {
  const required = key === 'claude'
    ? ['full/original/Claude.app/Contents/Info.plist', 'full/original/Claude.app/Contents/Resources/ion-dist/index.html', 'extracted/app/package.json']
    : ['asar/webview/assets'];
  return required.every(relative => fs.existsSync(path.join(capture, relative)));
}

async function prepareApp(key, { source = process.env.E1_UPSTREAM_SOURCE || 'auto', log = console.log } = {}) {
  const pin = pins[key];
  if (!pin) throw Error('Unknown upstream app: ' + key);
  if (!['auto', 'installed', 'download'].includes(source)) throw Error('Upstream source must be auto, installed or download.');
  const capture = path.join(root, pin.capture), marker = path.join(capture, '.prepared.json'), fingerprint = sha256(JSON.stringify(pin));
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).pin === fingerprint && layoutComplete(key, capture)) return capture;
  const label = `${pin.name} ${pin.version}`, envKey = key.toUpperCase();
  let app = null, origin = null, scratch = null;
  const installed = process.env['E1_UPSTREAM_APP_' + envKey] || pin.installed;
  if (source !== 'download') {
    const problems = fs.existsSync(installed) ? await verifyApp(installed, pin) : ['not installed'];
    if (!problems.length) { app = installed; origin = installed; }
    else if (source === 'installed') throw Error(`${label}: ${installed} cannot be used (${problems.join('; ')}).`);
    else log(`${label}: ${installed} is not the pinned build (${problems.join('; ')}); using the official download.`);
  }
  try {
    if (!app) {
      const url = process.env['E1_UPSTREAM_URL_' + envKey] || pin.url;
      const downloads = path.join(root, 'captures/.downloads'), zip = path.join(downloads, path.basename(new URL(url).pathname));
      if (!fs.existsSync(zip)) {
        log(`Downloading ${label} from ${new URL(url).host} (${megabytes(pin.downloadBytes)} MB)…`);
        await download(url, zip, null, log);
      }
      fs.mkdirSync(downloads, { recursive: true });
      scratch = fs.mkdtempSync(path.join(downloads, 'unpack-'));
      run('/usr/bin/ditto', ['-x', '-k', zip, scratch]);
      const bundles = fs.readdirSync(scratch).filter(name => name.endsWith('.app'));
      if (bundles.length !== 1) throw Error(`${label}: expected one app in ${path.basename(zip)}, found ${bundles.length}.`);
      app = path.join(scratch, bundles[0]);
      const problems = await verifyApp(app, pin);
      if (problems.length) { fs.rmSync(zip, { force: true }); throw Error(`${label} download failed verification: ${problems.join('; ')}.`); }
      origin = url;
    }
    log(`${label}: verified (${pin.teamId}); preparing ${pin.capture}`);
    fs.rmSync(capture, { recursive: true, force: true });
    const asar = await import('@electron/asar');
    if (key === 'claude') {
      const original = path.join(capture, 'full/original/Claude.app');
      fs.mkdirSync(path.dirname(original), { recursive: true });
      run('/bin/cp', ['-cR', app, original]);
      asar.extractAll(path.join(original, 'Contents/Resources/app.asar'), path.join(capture, 'extracted/app'));
    } else {
      asar.extractAll(path.join(app, 'Contents/Resources/app.asar'), path.join(capture, 'asar'));
    }
    if (!layoutComplete(key, capture)) throw Error(`${label}: prepared layout is incomplete.`);
    fs.writeFileSync(marker, JSON.stringify({ pin: fingerprint, version: pin.version, source: origin, preparedAt: new Date().toISOString() }, null, 2) + '\n');
    return capture;
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// CLIProxyAPI is MIT-licensed upstream; its release binary is pinned by hash.
async function prepareProxy({ log = console.log } = {}) {
  const directory = path.join(root, 'third_party/cliproxyapi'), binary = path.join(directory, 'cli-proxy-api');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (fs.existsSync(binary) && sha256(fs.readFileSync(binary)) === manifest.binarySha256) return binary;
  log(`Downloading CLIProxyAPI ${manifest.version} from ${new URL(manifest.url).host}…`);
  const archive = path.join(root, 'captures/.downloads', path.basename(new URL(manifest.url).pathname));
  if (!fs.existsSync(archive)) await download(manifest.url, archive, null, log);
  if (sha256(fs.readFileSync(archive)) !== manifest.archiveSha256) { fs.rmSync(archive, { force: true }); throw Error('CLIProxyAPI archive checksum mismatch.'); }
  const scratch = fs.mkdtempSync(path.join(path.dirname(archive), 'cliproxy-'));
  try {
    run('/usr/bin/tar', ['-xzf', archive, '-C', scratch, 'cli-proxy-api']);
    const data = fs.readFileSync(path.join(scratch, 'cli-proxy-api'));
    if (sha256(data) !== manifest.binarySha256) throw Error('CLIProxyAPI binary checksum mismatch.');
    fs.writeFileSync(binary, data, { mode: 0o755 });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return binary;
}

async function prepare(targets = ['claude', 'chatgpt', 'cliproxyapi'], options = {}) {
  const result = {};
  for (const target of targets) result[target] = target === 'cliproxyapi' ? await prepareProxy(options) : await prepareApp(target, options);
  return result;
}

module.exports = { pins, verifyApp, prepareApp, prepareProxy, prepare, capturePath: key => path.join(root, pins[key].capture) };

if (require.main === module) {
  const args = process.argv.slice(2), source = args.find(arg => arg.startsWith('--source='))?.slice('--source='.length);
  prepare(args.filter(arg => !arg.startsWith('--')).length ? args.filter(arg => !arg.startsWith('--')) : undefined, source ? { source } : {})
    .then(result => { for (const [key, location] of Object.entries(result)) console.log(`${key}: ${path.relative(root, location)}`); })
    .catch(error => { console.error(error.message); process.exit(1); });
}
