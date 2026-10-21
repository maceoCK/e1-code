// Prepare the third-party build inputs: the pinned Claude Desktop and ChatGPT
// releases, and the pinned CLIProxyAPI runtime (third_party/upstream.json).
//
// Sources, in order (E1_UPSTREAM_SOURCE=auto):
//   installed  a matching local install (/Applications)
//   release    this private repository's release assets, via your gh login
//   download   the vendors' official download URLs
// Whatever the source, an app must pass the same checks before use: valid
// Developer ID signature from the pinned team, bundle id, version, and the
// signed ElectronAsarIntegrity hash of its app.asar. Release assets are also
// pinned by SHA-256. Prepared inputs live in the gitignored captures/.
//
//   node scripts/prepare-upstream.cjs [claude] [chatgpt] [cliproxyapi] [--source=auto|installed|release|download]
//
// E1_UPSTREAM_APP_<KEY> points at another local copy of an app;
// E1_UPSTREAM_URL_<KEY> at a mirror of its official zip.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pins = require('../third_party/upstream.json');
const sources = { auto: ['installed', 'release', 'download'], installed: ['installed'], release: ['release'], download: ['download'] };
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function sha256File(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(8 * 1048576), fd = fs.openSync(file, 'r');
  try { for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
const run = (bin, args) => cp.execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const firstLine = error => String(error.stderr || error.message).trim().split('\n')[0];
const infoPlist = app => path.join(app, 'Contents/Info.plist');
function plistValue(app, key, format = 'raw') {
  try { return run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', infoPlist(app)]).trim(); } catch { return null; }
}
const megabytes = bytes => Math.round(bytes / 1048576);
const downloads = path.join(root, 'captures/.downloads');

async function verifyApp(app, pin) {
  if (!fs.existsSync(infoPlist(app))) return ['not an application bundle'];
  const problems = [];
  const id = plistValue(app, 'CFBundleIdentifier'), version = plistValue(app, 'CFBundleShortVersionString');
  if (id !== pin.bundleId) problems.push(`bundle id ${id}, expected ${pin.bundleId}`);
  if (version !== pin.version) problems.push(`version ${version}, expected ${pin.version}`);
  if (pin.build && plistValue(app, 'CFBundleVersion') !== pin.build) problems.push(`build ${plistValue(app, 'CFBundleVersion')}, expected ${pin.build}`);
  if (problems.length) return problems;
  try { run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); }
  catch (error) { return ['code signature does not verify: ' + firstLine(error)]; }
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

// A release asset of this repository, fetched with the GitHub CLI so a private
// repository works with the user's existing login. Returns null when the
// release, the CLI or the login is unavailable; a hash mismatch is an error.
function releaseAsset(key, log) {
  const release = pins.release, asset = release?.assets?.[key];
  if (!asset) return null;
  const file = path.join(downloads, asset.name);
  if (fs.existsSync(file) && sha256File(file) === asset.sha256) return file;
  fs.mkdirSync(downloads, { recursive: true });
  log(`Downloading ${asset.name} from the ${release.repo} release ${release.tag}…`);
  try { cp.execFileSync('gh', ['release', 'download', release.tag, '--repo', release.repo, '--pattern', asset.name, '--dir', downloads, '--clobber'], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { log(`  not available (${firstLine(error)}).`); fs.rmSync(file, { force: true }); return null; }
  if (sha256File(file) !== asset.sha256) { fs.rmSync(file, { force: true }); throw Error(`${asset.name} from ${release.repo} does not match its pinned SHA-256.`); }
  return file;
}

function layoutComplete(key, capture) {
  const required = key === 'claude'
    ? ['full/original/Claude.app/Contents/Info.plist', 'full/original/Claude.app/Contents/Resources/ion-dist/index.html', 'extracted/app/package.json']
    : ['asar/webview/assets'];
  return required.every(relative => fs.existsSync(path.join(capture, relative)));
}

async function prepareApp(key, { source = process.env.E1_UPSTREAM_SOURCE || 'auto', log = console.log } = {}) {
  const pin = pins[key];
  if (!pin?.bundleId) throw Error('Unknown upstream app: ' + key);
  if (!sources[source]) throw Error('Upstream source must be auto, installed, release or download.');
  // Releases are architecture-specific (native modules change the app.asar hash),
  // and E1's other native parts are arm64. Build on Apple silicon.
  if (pin.arch && process.arch !== pin.arch) throw Error(`E1 builds target ${pin.arch} (Apple silicon); this Node is ${process.arch}.`);
  const capture = path.join(root, pin.capture), marker = path.join(capture, '.prepared.json'), fingerprint = sha256(JSON.stringify(pin));
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).pin === fingerprint && layoutComplete(key, capture)) return capture;
  const label = `${pin.name} ${pin.version}`, envKey = key.toUpperCase();
  let app = null, origin = null, scratch = null;
  try {
    for (const candidate of sources[source]) {
      if (candidate === 'installed') {
        const installed = process.env['E1_UPSTREAM_APP_' + envKey] || pin.installed;
        const problems = fs.existsSync(installed) ? await verifyApp(installed, pin) : ['not installed'];
        if (!problems.length) { app = installed; origin = installed; break; }
        log(`${label}: ${installed} is not the pinned build (${problems.join('; ')}).`);
        continue;
      }
      let zip;
      if (candidate === 'release') {
        zip = releaseAsset(key, log);
        if (!zip) continue;
        origin = `${pins.release.repo} release ${pins.release.tag}`;
      } else {
        const url = process.env['E1_UPSTREAM_URL_' + envKey] || pin.url;
        zip = path.join(downloads, path.basename(new URL(url).pathname));
        if (!fs.existsSync(zip)) {
          log(`Downloading ${label} from ${new URL(url).host} (${megabytes(pin.downloadBytes)} MB)…`);
          await download(url, zip, null, log);
        }
        origin = url;
      }
      fs.mkdirSync(downloads, { recursive: true });
      scratch = fs.mkdtempSync(path.join(downloads, 'unpack-'));
      run('/usr/bin/ditto', ['-x', '-k', zip, scratch]);
      const bundles = fs.readdirSync(scratch).filter(name => name.endsWith('.app'));
      if (bundles.length !== 1) throw Error(`${label}: expected one app in ${path.basename(zip)}, found ${bundles.length}.`);
      app = path.join(scratch, bundles[0]);
      const problems = await verifyApp(app, pin);
      if (problems.length) { fs.rmSync(zip, { force: true }); throw Error(`${label} from ${origin} failed verification: ${problems.join('; ')}.`); }
      break;
    }
    if (!app) throw Error(`${label}: no usable source (${sources[source].join(', ')}).`);
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
async function prepareProxy({ source = process.env.E1_UPSTREAM_SOURCE || 'auto', log = console.log } = {}) {
  const directory = path.join(root, 'third_party/cliproxyapi'), binary = path.join(directory, 'cli-proxy-api');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (fs.existsSync(binary) && sha256File(binary) === manifest.binarySha256) return binary;
  if (!sources[source]) throw Error('Upstream source must be auto, installed, release or download.');
  if (sources[source].includes('release')) {
    const asset = releaseAsset('cliproxyapi', log);
    if (asset) {
      if (sha256File(asset) !== manifest.binarySha256) throw Error('CLIProxyAPI release asset does not match manifest.json.');
      fs.copyFileSync(asset, binary); fs.chmodSync(binary, 0o755);
      return binary;
    }
  }
  if (!sources[source].includes('download')) throw Error(`CLIProxyAPI ${manifest.version}: no usable source (${sources[source].join(', ')}).`);
  log(`Downloading CLIProxyAPI ${manifest.version} from ${new URL(manifest.url).host}…`);
  const archive = path.join(downloads, path.basename(new URL(manifest.url).pathname));
  if (!fs.existsSync(archive)) await download(manifest.url, archive, null, log);
  if (sha256File(archive) !== manifest.archiveSha256) { fs.rmSync(archive, { force: true }); throw Error('CLIProxyAPI archive checksum mismatch.'); }
  const scratch = fs.mkdtempSync(path.join(downloads, 'cliproxy-'));
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
