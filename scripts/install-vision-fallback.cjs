#!/usr/bin/env node
'use strict';

// Surgical installed-bundle patch. Never builds from .package or replaces a
// whole installed source module. No request/credential logging or log files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { beginBundle } = require('./bundle-transaction.cjs');
const base = path.resolve(__dirname, '..');
const archiveRelative = 'Contents/Resources/app.asar';
const rendererRelative = 'Contents/Resources/ion-dist';
const sandboxSettings = require('./patch-sandbox-settings.cjs');
const newModule = 'aster/vision-fallback.cjs';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const run = (bin, args, options = {}) => cp.execFileSync(bin, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });

// Each old/new pair must occur exactly once. In particular, do NOT transplant
// gateway stripSteering or providers' model-identity text from src.
const patches = {
  'recovered.cjs': [
    ['    builtinBrowserEnabled: true,\n    disableAutoUpdates: true,',
     '    builtinBrowserEnabled: true,\n    // Do not force the deployment\'s network sandbox when Local sandbox is off.\n    // Native managed-policy precedence and user command approvals still apply.\n    coworkEgressAllowedHosts: ["*"],\n    disableAutoUpdates: true,'],
  ],
  'gateway.cjs': [
    ['  const activeProviders = new Map();\n', '  const activeProviders = new Map();\n  const activeVisionProviders = new Map();\n'],
    ['    disconnectProvider: id => { disconnected.add(id); for (const [controller, provider] of activeProviders) if (provider === id) controller.abort(); },',
     '    disconnectProvider: id => { disconnected.add(id); for (const [controller, provider] of [...activeProviders, ...activeVisionProviders]) if (provider === id) controller.abort(); },'],
    ['    abortProvider: id => { for (const [controller, provider] of activeProviders) if (provider === id) controller.abort(); },',
     '    abortProvider: id => { for (const [controller, provider] of [...activeProviders, ...activeVisionProviders]) if (provider === id) controller.abort(); },'],
    ['  const health = store.data.routingHealth || {};\n',
     "  const health = store.data.routingHealth || {};\n  const prepareImages = require('./vision-fallback.cjs').createVisionFallback({ store, transport, requestFor, responseFor,\n    relay: require('./gateway-stream.cjs').relay, disconnected, health });\n"],
    ['      const outbound = Speed.applySpeed(requestFor(body, provider, actualRoute, opts),provider,speed.mode);',
     '      activeProviders.set(controller, provider.id);\n      const prepared = await prepareImages(body, actualRoute, routes, controller.signal,\n        id => id ? activeVisionProviders.set(controller, id) : activeVisionProviders.delete(controller));\n      const outbound = Speed.applySpeed(requestFor(prepared, provider, actualRoute, opts),provider,speed.mode);'],
  ],
  'providers.cjs': [
    ['      compat: m.compat || {},\n', "      compat: m.compat || {},\n      ...require('./vision-fallback.cjs').modalityMetadata(m),\n"],
    ['      name: m.display_name || m.name || m.id,\n', "      name: m.display_name || m.name || m.id,\n      ...require('./vision-fallback.cjs').modalityMetadata(m),\n"],
  ],
  'subscriptions.cjs': [
    ["const models = (d.models || []).filter(m => m.visibility === 'list' && m.slug).map(m => ({ id: m.slug, name: m.display_name || m.slug }));",
     "const models = (d.models || []).filter(m => m.visibility === 'list' && m.slug).map(m => ({ id: m.slug, name: m.display_name || m.slug, ...require('./vision-fallback.cjs').modalityMetadata(m) }));"],
  ],
  'codex-subscriptions.cjs': [
    ["reasoningEfforts:(m.supported_reasoning_levels||[]).map(v=>typeof v==='string'?v:v.effort).filter(Boolean),reasoning:true}));",
     "reasoningEfforts:(m.supported_reasoning_levels||[]).map(v=>typeof v==='string'?v:v.effort).filter(Boolean),reasoning:true,...require('./vision-fallback.cjs').modalityMetadata(m)}));"],
  ],
};

function once(text, old, replacement, label) {
  if (text.split(old).length !== 2) throw Error(`Expected exactly one patch anchor: ${label}`);
  return text.replace(old, () => replacement);
}
function patchText(text, name) {
  if (text.includes("require('./vision-fallback.cjs')")) throw Error(`Already or partially patched: ${name}`);
  for (const [old, replacement] of patches[name]) text = once(text, old, replacement, name);
  return text;
}
function entries(header, prefix = '', result = new Map()) {
  for (const [name, entry] of Object.entries(header.files)) {
    const key = prefix + name;
    result.set(key, entry);
    if (entry.files) entries(entry, key + '/', result);
  }
  return result;
}
function integrity(data, blockSize = 4194304) {
  if (!Number.isSafeInteger(blockSize) || blockSize <= 0) throw Error('Unsupported integrity block size');
  const blocks = [];
  for (let i = 0; i < data.length; i += blockSize) blocks.push(hash(data.subarray(i, i + blockSize)));
  if (!blocks.length) blocks.push(hash(Buffer.alloc(0)));
  return { algorithm: 'SHA256', hash: hash(data), blockSize, blocks };
}
function checkSyntax(data, name, inputType = 'commonjs') {
  try { run(process.execPath, ['--check', '--input-type=' + inputType], { input: data }); }
  catch { throw Error(`JavaScript syntax check failed: ${name}`); }
}
function replacements(asar, archive, sourceRoot = path.join(base, 'src')) {
  const result = new Map();
  for (const name of Object.keys(patches)) {
    // Verify the declared patch still matches the implementation in src without
    // assuming src is otherwise identical to this installation.
    const source = fs.readFileSync(path.join(sourceRoot, name), 'utf8');
    for (const [, replacement] of patches[name]) {
      if (source.split(replacement).length !== 2) throw Error(`Source integration drift: ${name}`);
    }
    result.set('aster/' + name, Buffer.from(patchText(asar.extractFile(archive, 'aster/' + name).toString('utf8'), name)));
  }
  result.set(newModule, fs.readFileSync(path.join(sourceRoot, 'vision-fallback.cjs')));
  for (const [name, data] of result) checkSyntax(data, name);
  return result;
}

async function repack(asar, archive, output, changes) {
  const raw = asar.getRawHeader(archive);
  const header = structuredClone(raw.header);
  const oldEntries = entries(header);
  if (!header.files.aster?.files || header.files.aster.unpacked) throw Error('Expected a packed aster module directory');
  if (oldEntries.has(newModule)) throw Error('vision-fallback.cjs already exists; refusing to reinstall');
  const original = fs.readFileSync(archive);
  // Keep the complete existing payload (including shared offsets, padding and
  // unpacked flags). Append only the reviewed modules and point those entries at
  // the new bytes. No re-extraction/reordering/recompression of other entries.
  const payload = original.subarray(8 + raw.headerSize);
  const appended = [];
  let offset = payload.length;
  for (const [name, data] of changes) {
    if (name !== newModule && !Object.hasOwn(patches, name.replace(/^aster\//, ''))) throw Error(`Not an allowed patch: ${name}`);
    const old = oldEntries.get(name);
    if (old && (old.unpacked || old.link || old.files)) throw Error(`Patch target must be packed: ${name}`);
    if (old?.integrity && old.integrity.algorithm !== 'SHA256') throw Error(`Unsupported integrity: ${name}`);
    header.files.aster.files[path.posix.basename(name)] = {
      ...old, size: data.length, offset: String(offset),
      integrity: { ...old?.integrity, ...integrity(data, old?.integrity?.blockSize) },
    };
    appended.push(data);
    offset += data.length;
  }
  const { Pickle } = await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js')).href);
  const h = Pickle.createEmpty();
  h.writeString(JSON.stringify(header));
  const headerBuffer = h.toBuffer();
  const size = Pickle.createEmpty();
  size.writeUInt32(headerBuffer.length);
  fs.writeFileSync(output, Buffer.concat([size.toBuffer(), headerBuffer, payload, ...appended]), { flag: 'wx', mode: fs.statSync(archive).mode & 0o777 });
  verifyArchive(asar, archive, output, changes);
}
function verifyArchive(asar, original, candidate, changes) {
  asar.uncache(candidate);
  const before = entries(asar.getRawHeader(original).header);
  const after = entries(asar.getRawHeader(candidate).header);
  assert.equal(after.size, before.size + 1, 'Unexpected archive entries');
  for (const [name, old] of before) {
    const current = after.get(name);
    assert.ok(current, `Removed archive entry: ${name}`);
    if (old.files) {
      const { files: _a, ...a } = old, { files: _b, ...b } = current;
      assert.deepEqual(b, a, `Directory flags changed: ${name}`);
      continue;
    }
    if (changes.has(name)) {
      const { offset: _a, size: _b, integrity: _c, ...a } = old;
      const { offset: _d, size: _e, integrity: _f, ...b } = current;
      assert.deepEqual(b, a, `File flags changed: ${name}`);
    } else {
      assert.deepEqual(current, old, `Unrelated archive metadata changed: ${name}`);
      if (!old.link && !old.unpacked) assert.equal(hash(asar.extractFile(candidate, name)), hash(asar.extractFile(original, name)), `Unrelated packed file changed: ${name}`);
    }
  }
  for (const [name, data] of changes) {
    const actual = asar.extractFile(candidate, name);
    assert.equal(hash(actual), hash(data), `Patch bytes mismatch: ${name}`);
    assert.deepEqual(after.get(name).integrity, { ...after.get(name).integrity, ...integrity(actual, after.get(name).integrity.blockSize) }, `Patch integrity mismatch: ${name}`);
    checkSyntax(actual, name);
  }
}
// Snapshot only bundle bytes/links, never app state or credentials. This also
// proves the unpacked tree, helpers and frameworks were neither rebuilt nor signed.
function treeManifest(root, prefix = '', result = new Map()) {
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name), file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) result.set(relative, 'link:' + fs.readlinkSync(file));
    else if (stat.isDirectory()) { result.set(relative, 'dir:' + (stat.mode & 0o777)); treeManifest(root, relative, result); }
    else if (stat.isFile()) result.set(relative, (stat.mode & 0o777) + ':' + hash(fs.readFileSync(file)));
    else throw Error(`Unsupported bundle entry: ${relative}`);
  }
  return result;
}
function compareBundle(before, after, allowed) {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (!allowed(key)) assert.equal(after.get(key), before.get(key), `Unrelated bundle file changed: ${key}`);
  }
}
function patchRenderer(installed, candidate) {
  const changes = sandboxSettings.replacements(path.join(installed, rendererRelative));
  // Validate every anchor and module before writing any renderer asset.
  for (const [file, source] of changes) checkSyntax(source, file, 'module');
  const result = new Map();
  for (const [file, source] of changes) {
    const relative = path.join(rendererRelative, file);
    fs.writeFileSync(path.join(candidate, relative), source);
    result.set(relative, source);
  }
  return result;
}
function verifyRenderer(bundle, changes) {
  for (const [file, source] of changes) {
    const actual = fs.readFileSync(path.join(bundle, file), 'utf8');
    assert.equal(actual, source, `Renderer patch bytes mismatch: ${file}`);
    checkSyntax(actual, file, 'module');
  }
}
function plist(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])); }
function verifyPlist(asar, bundle, before) {
  const after = plist(path.join(bundle, 'Contents/Info.plist'));
  const expected = structuredClone(before);
  expected.ElectronAsarIntegrity['Resources/app.asar'].hash = hash(asar.getRawHeader(path.join(bundle, archiveRelative)).headerString);
  assert.deepEqual(after, expected, 'Info.plist changed beyond archive hash');
}
function signature(bundle) {
  const result = cp.spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { encoding: 'utf8' });
  if (result.status !== 0) throw Error('Cannot inspect existing bundle signature');
  const text = result.stderr;
  return { identifier: text.match(/^Identifier=(.*)$/m)?.[1], team: text.match(/^TeamIdentifier=(.*)$/m)?.[1], flags: text.match(/flags=(0x[0-9a-f]+)/i)?.[1], adhoc: /^Signature=adhoc$/m.test(text) };
}
function codeSign(step, args, execute = run) {
  try { return execute('/usr/bin/codesign', args); }
  catch (error) {
    // codesign diagnostics contain bundle/certificate names, not model requests
    // or credentials. Keep the actual failure instead of guessing its cause.
    const detail = String(error.stderr || error.message || 'No diagnostic returned').trim().slice(0, 4000);
    throw Error(`Code signing failed during ${step} (exit ${error.status ?? 'unknown'}):\n${detail}`);
  }
}
function verifySignature(bundle, step) { codeSign(step, ['--verify', '--deep', '--strict', bundle]); }
function extractCertificates(bundle, prefix, execute = run) {
  // codesign's optional prefix must be attached; a separate argument is a target.
  return codeSign('installed certificate extraction', ['-d', '--extract-certificates=' + prefix, bundle], execute);
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/install-vision-fallback.cjs [--stage-only]\nDefault: verify, clone installed E1 Code.app, patch, sign outer app only, verify and commit.\n--stage-only: retain an unsigned candidate under TMPDIR; never sign or install.\n');
    return;
  }
  if (args.some(a => a !== '--stage-only') || args.length > 1) throw Error('Only --stage-only is supported');
  const stageOnly = args.includes('--stage-only');
  const installed = path.join(os.homedir(), 'Applications/E1 Code.app');
  if (!fs.lstatSync(installed).isDirectory()) throw Error('Installed app must be an ordinary directory');
  const asar = await import('@electron/asar');
  let transaction, retained;
  try {
    // Reject invalid existing signatures. Do not infer a sandbox failure from
    // certificate errors, downgrade identity, or weaken verification.
    if (!stageOnly) verifySignature(installed, 'installed-app preflight');
    const baseline = treeManifest(installed);
    transaction = beginBundle(installed, installed, undefined, os.tmpdir());
    const candidate = transaction.bundle;
    compareBundle(baseline, treeManifest(candidate), () => false);
    const originalArchive = path.join(installed, archiveRelative);
    const archive = path.join(candidate, archiveRelative);
    const changes = replacements(asar, originalArchive);
    await repack(asar, originalArchive, archive + '.vision-new', changes);
    fs.renameSync(archive + '.vision-new', archive);
    asar.uncache(archive);
    const infoFile = path.join(candidate, 'Contents/Info.plist');
    const info = plist(infoFile);
    if (info.ElectronAsarIntegrity?.['Resources/app.asar']?.algorithm !== 'SHA256') throw Error('Expected existing SHA256 ASAR integrity metadata');
    const integrityMetadata = structuredClone(info.ElectronAsarIntegrity);
    integrityMetadata['Resources/app.asar'].hash = hash(asar.getRawHeader(archive).headerString);
    run('/usr/bin/plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify(integrityMetadata), infoFile]);
    const rendererChanges = patchRenderer(installed, candidate);
    const patchedOnly = key => key === archiveRelative || key === 'Contents/Info.plist' || rendererChanges.has(key);
    const verifyPayload = bundle => {
      verifyArchive(asar, originalArchive, path.join(bundle, archiveRelative), changes);
      verifyRenderer(bundle, rendererChanges);
      verifyPlist(asar, bundle, info);
    };
    verifyPayload(candidate);
    compareBundle(baseline, treeManifest(candidate), patchedOnly);
    if (stageOnly) {
      retained = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-vision-stage-'));
      const staged = path.join(retained, path.basename(installed));
      fs.renameSync(candidate, staged);
      transaction.abort(); transaction = null;
      process.stdout.write(JSON.stringify({ status: 'staged-not-installed', bundle: staged, signed: false }) + '\n');
      return;
    }
    const signing = require('./signing.cjs').configuration(); // Signing config only; no model credentials.
    const previousSignature = signature(installed);
    if (previousSignature.adhoc !== (signing.identity === '-')) throw Error('Signing configuration would change the installed identity');
    if (!previousSignature.adhoc) {
      const prefix = path.join(path.dirname(candidate), 'signer-');
      extractCertificates(installed, prefix);
      if (!fs.existsSync(prefix + '0')) throw Error('Installed certificate extraction returned no signing certificate. The installed app was not replaced; signer identity verification cannot continue.');
      const leaf = crypto.createHash('sha1').update(fs.readFileSync(prefix + '0')).digest('hex').toUpperCase();
      if (leaf !== signing.identity) throw Error('Configured signing certificate differs from installed certificate');
    }
    const entitlements = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', installed]);
    const requirements = run('/usr/bin/codesign', ['-d', '-r-', installed]);
    codeSign('candidate signing', ['--force', '--sign', signing.identity, ...signing.args,
      '--preserve-metadata=identifier,requirements,entitlements,flags,runtime', '--timestamp=none', candidate]);
    const executable = path.join('Contents/MacOS', info.CFBundleExecutable);
    const signingOnly = key => patchedOnly(key) || key === executable || key === 'Contents/_CodeSignature/CodeResources';
    const verify = bundle => {
      verifyPayload(bundle);
      assert.deepEqual(signature(bundle), previousSignature, 'Signing identity or flags changed');
      assert.equal(run('/usr/bin/codesign', ['-d', '--entitlements', ':-', bundle]), entitlements, 'Installed entitlements changed');
      assert.equal(run('/usr/bin/codesign', ['-d', '-r-', bundle]), requirements, 'Installed signing requirements changed');
      compareBundle(baseline, treeManifest(bundle), signingOnly);
      verifySignature(bundle, 'candidate verification');
      compareBundle(baseline, treeManifest(installed), () => false);
    };
    verify(candidate);
    // Durable rollback copy, created only after verification; no .package build.
    const backupRoot = path.resolve(base, '../outputs/vision-fallback-backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backup = path.join(backupRoot, `${Date.now()}-${crypto.randomUUID()}.app`);
    run('/bin/cp', ['-cR', installed, backup]);
    compareBundle(baseline, treeManifest(backup), () => false);
    const previous = transaction.commit(verify);
    transaction = null;
    if (previous) fs.rmSync(path.dirname(previous), { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ status: 'installed', bundle: installed, backup }) + '\n');
  } catch (error) {
    if (retained) fs.rmSync(retained, { recursive: true, force: true });
    throw error;
  } finally {
    transaction?.abort();
  }
}
module.exports = { patchText, replacements, repack, verifyArchive, patchRenderer, verifyRenderer, treeManifest, compareBundle, integrity, codeSign, extractCertificates, main };
if (require.main === module) main().catch(error => {
  process.stderr.write('Vision fallback installer failed; installed app was not replaced. ' + error.message + '\n');
  process.exitCode = 1;
});
