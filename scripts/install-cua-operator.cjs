#!/usr/bin/env node
'use strict';

// Upgrade only the installed, already-signed vision/sandbox baseline. Never
// rebuild from src, read app state, or transplant installed-only steering and
// provider identity customizations. No log files, trust changes or app restart.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { builtinModules } = require('node:module');
const { pathToFileURL } = require('node:url');
const { beginBundle } = require('./bundle-transaction.cjs');
const { treeManifest, compareBundle, integrity, codeSign, extractCertificates } = require('./install-vision-fallback.cjs');
const base = path.resolve(__dirname, '..');
const archiveRelative = 'Contents/Resources/app.asar';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const run = (bin, args, options = {}) => cp.execFileSync(bin, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });

// Observed directly in ~/Applications/E1 Code.app/Contents/Resources/app.asar
// on 2026-10-09, BEFORE the new operator modules were installed. Never learn a
// replacement baseline from disk at install time or accept one through the CLI.
const BASELINE_HASHES = Object.freeze({
  'aster/gateway.cjs': '198262e185047c25c5d0c956428c28e1e5aa16af3c70457957b4fd6d312046b8',
  'aster/gateway-stream.cjs': '6ae00640589cf0512bb82af18e561911594fa4b9a46369e0e7121ce4f3579a7a',
  'aster/vision-fallback.cjs': '7df9a9fd89093619e188a39dc56873a070bb25fd0fee1de2883693932ed68e24',
});
const NEW_MODULES = Object.freeze(['aster/vision-provider.cjs', 'aster/cua-operator.cjs', 'aster/cua-evidence.cjs']);
const REQUIRED_NEW_MODULES = NEW_MODULES.slice(0, 2);
const PATCHES = {
  'gateway.cjs': [
    ['    if (data.error || data.status === "failed")\n      throw Error(data.error?.message || "Provider failed.");',
     '    if (data.error || data.status === "failed")\n      throw Error(data.error?.message || "Provider failed.");\n    if (!["completed", "incomplete"].includes(data.status))\n      throw Error("Provider returned an unsupported completion state.");'],
    ['    if (!c) throw Error("Provider returned no completion.");',
     '    if (!c) throw Error("Provider returned no completion.");\n    if (c.finish_reason === "content_filter")\n      throw Error("The provider stopped the response because of its content policy");\n    if (!["stop", "tool_calls", "length"].includes(c.finish_reason))\n      throw Error("Provider returned an unsupported completion state.");'],
    ['  if (content.some((c) => c.type === "tool_use")) stop = "tool_use";',
     '  if (stop !== "max_tokens" && content.some((c) => c.type === "tool_use")) stop = "tool_use";'],
    ["  const prepareImages = require('./vision-fallback.cjs').createVisionFallback({ store, transport, requestFor, responseFor,\n    relay: require('./gateway-stream.cjs').relay, disconnected, health });",
     "  const visionDependencies = { store, transport, requestFor, responseFor,\n    relay: require('./gateway-stream.cjs').relay, disconnected, health };\n  const prepareImages = require('./vision-fallback.cjs').createVisionFallback(visionDependencies);\n  const cuaOperator = require('./cua-operator.cjs').createCuaOperator(visionDependencies);"],
    ['      const prepared = await prepareImages(body, actualRoute, routes, controller.signal,\n        id => id ? activeVisionProviders.set(controller, id) : activeVisionProviders.delete(controller));',
     '      const trackVision = id => id ? activeVisionProviders.set(controller, id) : activeVisionProviders.delete(controller);\n      const operator = await cuaOperator.prepare(body, actualRoute, routes, controller.signal, trackVision);\n      if (operator.immediate) {\n        controller.signal.throwIfAborted();\n        clearInterval(ping);\n        activeProviders.delete(controller);\n        if (body.stream) writeStream(res, operator.immediate);\n        else json(res, operator.immediate);\n        return;\n      }\n      const prepared = await prepareImages(operator.body, actualRoute, routes, controller.signal, trackVision);'],
    ['      isLiveStream = body.stream && isStream;',
     '      isLiveStream = body.stream && isStream && !operator.buffer;'],
    ['            body.stream ? gated : bufferedSink,', '            isLiveStream ? gated : bufferedSink,'],
    ['      status.actualSpeed = Speed.actualSpeed(result);\n      onStatus({...status});',
     '      if (operator.buffer) {\n        result = await operator.resolve(result);\n        controller.signal.throwIfAborted();\n      }\n      status.actualSpeed = Speed.actualSpeed(result);\n      onStatus({...status});'],
  ],
  'gateway-stream.cjs': [
    ['      if (e.type === "response.created") {\n        result.usage.input_tokens = e.response.usage?.input_tokens || 0;\n        start();\n      }',
     '      if (e.type === "response.cancelled" || e.type === "response.canceled" ||\n          (e.response?.status !== undefined && !["queued", "in_progress", "completed", "incomplete"].includes(e.response.status)))\n        throw Error("Provider returned an unsupported completion state.");\n      if (e.type === "response.created") {\n        result.usage.input_tokens = e.response.usage?.input_tokens || 0;\n        start();\n      }'],
    ['        stop = e.type === "response.incomplete" ? "max_tokens" : "end_turn";\n        complete = true;',
     '        if (e.response.status !== undefined && e.response.status !== e.type.slice("response.".length))\n          throw Error("Provider returned an unsupported completion state.");\n        stop = e.type === "response.incomplete" ? "max_tokens" : "end_turn";\n        complete = true;'],
    ['      if (c.finish_reason) {\n        if (c.finish_reason === "content_filter")\n          throw Error(\n            "The provider stopped the response because of its content policy",\n          );\n        for (const [index, state] of chatTools)\n          if (!state.item)\n            state.item = open("tool:" + index, {\n              type: "tool_use",\n              id: state.id || "toolu_" + randomUUID(),\n              name: state.name,\n              input: {},\n            });\n        stop = c.finish_reason === "length" ? "max_tokens" : "end_turn";\n        complete = true;\n      }',
     '      if (c.finish_reason !== undefined && c.finish_reason !== null) {\n        if (c.finish_reason === "content_filter")\n          throw Error(\n            "The provider stopped the response because of its content policy",\n          );\n        if (!["stop", "tool_calls", "length"].includes(c.finish_reason))\n          throw Error("Provider returned an unsupported completion state.");\n        for (const [index, state] of chatTools)\n          if (!state.item)\n            state.item = open("tool:" + index, {\n              type: "tool_use",\n              id: state.id || "toolu_" + randomUUID(),\n              name: state.name,\n              input: {},\n            });\n        stop = c.finish_reason === "length" ? "max_tokens" : "end_turn";\n        complete = true;\n      }'],
    ['    if (result.content.some((b) => b.type === "tool_use")) stop = "tool_use";',
     '    if (stop !== "max_tokens" && result.content.some((b) => b.type === "tool_use")) stop = "tool_use";'],
  ],
};
for (const pairs of Object.values(PATCHES)) { for (const pair of pairs) Object.freeze(pair); Object.freeze(pairs); }
Object.freeze(PATCHES);
const occurrences = (text, anchor) => text.split(anchor).length - 1;
function patchText(text, name) {
  if (!Object.hasOwn(PATCHES, name)) throw Error(`Not an allowed text patch: ${name}`);
  // Preflight every pair first: never treat partially upgraded input as fresh.
  for (const [old, replacement] of PATCHES[name]) {
    if (text.includes(replacement)) throw Error(`Already or partially patched: ${name}`);
    if (occurrences(text, old) !== 1) throw Error(`Expected exactly one patch anchor: ${name}`);
  }
  for (const [old, replacement] of PATCHES[name]) text = text.replace(old, () => replacement);
  return text;
}
function entries(header, prefix = '', result = new Map()) {
  if (!header.files || typeof header.files !== 'object') throw Error('Invalid archive directory');
  for (const [name, entry] of Object.entries(header.files)) {
    const key = prefix + name;
    result.set(key, entry);
    if (entry.files) entries(entry, key + '/', result);
  }
  return result;
}
function checkSyntax(data, name) {
  try { run(process.execPath, ['--check', '--input-type=commonjs'], { input: data }); }
  catch { throw Error(`JavaScript syntax check failed: ${name}`); }
}
function packedTarget(entry, name) {
  if (!entry || entry.unpacked || entry.link || entry.files) throw Error(`Patch target must be packed: ${name}`);
  if (entry.integrity?.algorithm !== 'SHA256') throw Error(`Expected SHA256 integrity: ${name}`);
}
function validateBaseline(asar, archive, expectedHashes = BASELINE_HASHES) {
  asar.uncache(archive);
  const header = asar.getRawHeader(archive).header, all = entries(header);
  if (!header.files.aster?.files || header.files.aster.unpacked || header.files.aster.link) throw Error('Expected a packed aster module directory');
  for (const name of NEW_MODULES) if (all.has(name)) throw Error(`Already or partially installed: ${name}`);
  for (const name of Object.keys(BASELINE_HASHES)) {
    const entry = all.get(name);
    packedTarget(entry, name);
    const data = asar.extractFile(archive, name);
    if (hash(data) !== expectedHashes[name]) throw Error(`Unknown installed baseline: ${name}`);
    assert.deepEqual(entry.integrity, { ...entry.integrity, ...integrity(data, entry.integrity.blockSize) }, `Baseline integrity mismatch: ${name}`);
  }
  return all;
}
function localDependencies(data, name) {
  const text = data.toString('utf8');
  const requires = [...text.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
  if (requires.length !== [...text.matchAll(/\brequire\s*\(/g)].length || /\bimport\s*\(/.test(text)) {
    throw Error(`Unreviewed dynamic module import: ${name}`);
  }
  const locals = [];
  for (const [, , specifier] of requires) {
    if (builtinModules.includes(specifier) || (specifier.startsWith('node:') && builtinModules.includes(specifier.slice(5)))) continue;
    if (!specifier.startsWith('./')) throw Error(`Unreviewed module import: ${name}: ${specifier}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
    if (!resolved.startsWith('aster/') || !resolved.endsWith('.cjs')) throw Error(`Unreviewed module import: ${name}: ${specifier}`);
    locals.push(resolved);
  }
  return locals;
}
function validateChanges(header, changes) {
  const all = entries(header), required = [...Object.keys(BASELINE_HASHES), ...REQUIRED_NEW_MODULES];
  for (const name of required) if (!changes.has(name)) throw Error(`Missing required patch: ${name}`);
  for (const name of NEW_MODULES) if (all.has(name)) throw Error(`Already or partially installed: ${name}`);
  for (const [name, data] of changes) {
    if (!Object.hasOwn(BASELINE_HASHES, name) && !NEW_MODULES.includes(name)) throw Error(`Not an allowed patch: ${name}`);
    if (!Buffer.isBuffer(data)) throw Error(`Expected module bytes: ${name}`);
    if (Object.hasOwn(BASELINE_HASHES, name)) packedTarget(all.get(name), name);
    checkSyntax(data, name);
    for (const dependency of localDependencies(data, name)) {
      if (!changes.has(dependency) && !all.has(dependency)) throw Error(`Missing or unapproved module dependency: ${name}: ${dependency}`);
    }
  }
}
function replacements(asar, archive, sourceRoot = path.join(base, 'src'), expectedHashes = BASELINE_HASHES) {
  // The fixture hash injection is an API for socket-free tests only. main() never
  // accepts a hash override, environment override, or alternative installed app.
  const all = validateBaseline(asar, archive, expectedHashes), changes = new Map();
  const readSource = name => fs.readFileSync(path.join(sourceRoot, path.posix.basename(name)));
  for (const name of Object.keys(PATCHES)) {
    const source = readSource(name).toString('utf8');
    for (const [old, replacement] of PATCHES[name]) {
      if (occurrences(source, replacement) !== 1 || occurrences(source, old) !== occurrences(replacement, old)) throw Error(`Source integration drift: ${name}`);
    }
    changes.set('aster/' + name, Buffer.from(patchText(asar.extractFile(archive, 'aster/' + name).toString('utf8'), name)));
  }
  changes.set('aster/vision-fallback.cjs', readSource('vision-fallback.cjs'));
  for (const name of REQUIRED_NEW_MODULES) changes.set(name, readSource(name));
  // Only the optional reviewed evidence module may be pulled in transitively.
  // A source import never grants permission to copy an arbitrary new module.
  for (const [name, data] of changes) {
    for (const dependency of localDependencies(data, name)) {
      if (changes.has(dependency) || all.has(dependency)) continue;
      if (!NEW_MODULES.includes(dependency)) throw Error(`Missing or unapproved module dependency: ${name}: ${dependency}`);
      changes.set(dependency, readSource(dependency));
    }
  }
  validateChanges(asar.getRawHeader(archive).header, changes);
  return changes;
}
const flags = (entry, excluded) => Object.fromEntries(Object.entries(entry).filter(([key]) => !excluded.includes(key)));
function verifyArchiveData(before, after, oldPayload, payload, changes) {
  const originalEntries = entries(before), currentEntries = entries(after);
  const additions = [...changes.keys()].filter(name => !originalEntries.has(name));
  assert.equal(currentEntries.size, originalEntries.size + additions.length, 'Unexpected archive entries');
  assert.deepEqual(flags(after, ['files']), flags(before, ['files']), 'Archive root flags changed');
  for (const [name, old] of originalEntries) {
    const current = currentEntries.get(name);
    assert.ok(current, `Removed archive entry: ${name}`);
    if (old.files) assert.deepEqual(flags(current, ['files']), flags(old, ['files']), `Directory flags changed: ${name}`);
    else if (changes.has(name)) assert.deepEqual(flags(current, ['offset', 'size', 'integrity']), flags(old, ['offset', 'size', 'integrity']), `File flags changed: ${name}`);
    else assert.deepEqual(current, old, `Unrelated archive metadata changed: ${name}`);
  }
  for (const name of currentEntries.keys()) assert.ok(originalEntries.has(name) || additions.includes(name), `Unexpected archive entry: ${name}`);
  assert.ok(payload.subarray(0, oldPayload.length).equals(oldPayload), 'Original archive payload changed');
  let offset = oldPayload.length;
  for (const [name, data] of changes) {
    const entry = currentEntries.get(name), old = originalEntries.get(name);
    assert.ok(entry, `Missing patch entry: ${name}`);
    const expected = { ...old, size: data.length, offset: String(offset), integrity: { ...old?.integrity, ...integrity(data, old?.integrity?.blockSize) } };
    assert.deepEqual(entry, expected, `Patch metadata or integrity mismatch: ${name}`);
    assert.ok(payload.subarray(offset, offset + data.length).equals(data), `Patch bytes mismatch: ${name}`);
    offset += data.length;
  }
  assert.equal(payload.length, offset, 'Unexpected archive payload length');
}
async function prepareArchive(asar, archive, changes, expectedHashes = BASELINE_HASHES) {
  validateBaseline(asar, archive, expectedHashes);
  const raw = asar.getRawHeader(archive), header = structuredClone(raw.header);
  validateChanges(header, changes);
  for (const name of Object.keys(PATCHES)) {
    const expected = Buffer.from(patchText(asar.extractFile(archive, 'aster/' + name).toString('utf8'), name));
    assert.ok(changes.get('aster/' + name).equals(expected), `Unexpected replacement beyond approved anchors: ${name}`);
  }
  if (!header.files.aster?.files || header.files.aster.unpacked || header.files.aster.link) throw Error('Expected a packed aster module directory');
  const original = fs.readFileSync(archive), payload = original.subarray(8 + raw.headerSize);
  if (payload.length !== original.length - 8 - raw.headerSize) throw Error('Invalid archive header size');
  let offset = payload.length;
  for (const [name, data] of changes) {
    const old = header.files.aster.files[path.posix.basename(name)];
    header.files.aster.files[path.posix.basename(name)] = {
      ...old, size: data.length, offset: String(offset),
      integrity: { ...old?.integrity, ...integrity(data, old?.integrity?.blockSize) },
    };
    offset += data.length;
  }
  const appended = Buffer.concat([payload, ...changes.values()]);
  verifyArchiveData(raw.header, header, payload, appended, changes);
  const { Pickle } = await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js')).href);
  const h = Pickle.createEmpty(); h.writeString(JSON.stringify(header));
  const headerBuffer = h.toBuffer(), size = Pickle.createEmpty(); size.writeUInt32(headerBuffer.length);
  return { bytes: Buffer.concat([size.toBuffer(), headerBuffer, appended]), originalHash: hash(original), headerHash: hash(JSON.stringify(header)) };
}
async function repack(asar, archive, output, changes, expectedHashes = BASELINE_HASHES) {
  const plan = await prepareArchive(asar, archive, changes, expectedHashes); // Every validation precedes the first write.
  const mode = fs.statSync(archive).mode & 0o777;
  fs.writeFileSync(output, plan.bytes, { flag: 'wx', mode });
  fs.chmodSync(output, mode); // Creation umask must not change the archive mode.
  verifyArchive(asar, archive, output, changes);
}
function verifyArchive(asar, original, candidate, changes) {
  asar.uncache(original); asar.uncache(candidate);
  const before = asar.getRawHeader(original), after = asar.getRawHeader(candidate);
  validateChanges(before.header, changes);
  verifyArchiveData(before.header, after.header,
    fs.readFileSync(original).subarray(8 + before.headerSize), fs.readFileSync(candidate).subarray(8 + after.headerSize), changes);
  for (const [name, data] of changes) assert.ok(asar.extractFile(candidate, name).equals(data), `Patch extraction mismatch: ${name}`);
}
function plist(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])); }
function validatePlist(info, headerHash) {
  const metadata = info.ElectronAsarIntegrity?.['Resources/app.asar'];
  if (metadata?.algorithm !== 'SHA256' || metadata.hash !== headerHash) throw Error('Installed Info.plist ASAR integrity does not match the baseline');
  if (typeof info.CFBundleExecutable !== 'string' || !info.CFBundleExecutable || path.basename(info.CFBundleExecutable) !== info.CFBundleExecutable || ['.', '..'].includes(info.CFBundleExecutable)) throw Error('Invalid installed executable name');
}
function signature(bundle) {
  const result = cp.spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { encoding: 'utf8' });
  if (result.status !== 0) throw Error('Cannot inspect existing bundle signature');
  const text = result.stderr;
  const found = { identifier: text.match(/^Identifier=(.*)$/m)?.[1], team: text.match(/^TeamIdentifier=(.*)$/m)?.[1], flags: text.match(/flags=(0x[0-9a-f]+)/i)?.[1], runtime: text.match(/^Runtime Version=(.*)$/m)?.[1], adhoc: /^Signature=adhoc$/m.test(text) };
  if (!found.identifier || !found.flags || (!found.adhoc && !found.team)) throw Error('Incomplete installed signature metadata');
  return found;
}
function signingIdentity(bundle, prefix, previousSignature) {
  if (previousSignature.adhoc) return '-';
  extractCertificates(bundle, prefix);
  if (!fs.existsSync(prefix + '0')) throw Error('Certificate extraction returned no signing certificate; refusing identity fallback');
  return crypto.createHash('sha1').update(fs.readFileSync(prefix + '0')).digest('hex').toUpperCase();
}
const verifySignature = (bundle, step) => codeSign(step, ['--verify', '--deep', '--strict', bundle]);
const moduleReport = changes => [...changes].map(([name, data]) => ({ name, operation: Object.hasOwn(BASELINE_HASHES, name) ? 'replace' : 'add', bytes: data.length, sha256: hash(data) }));
async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/install-cua-operator.cjs [--stage-only]\nDefault: upgrade the pinned installed baseline, sign with its current identity, verify and atomically publish with a backup. No restart.\n--stage-only: retain an unsigned candidate under TMPDIR; never sign or install.\n');
    return;
  }
  if (args.length > 1 || args.some(arg => arg !== '--stage-only')) throw Error('Only --stage-only is supported');
  const stageOnly = args.includes('--stage-only'), installed = path.join(os.homedir(), 'Applications/E1 Code.app');
  if (!fs.lstatSync(installed).isDirectory()) throw Error('Installed app must be an ordinary directory');
  const asar = await import('@electron/asar');
  let transaction, retained;
  try {
    if (!stageOnly) verifySignature(installed, 'installed-app preflight');
    const baseline = treeManifest(installed), originalArchive = path.join(installed, archiveRelative);
    for (const relative of [archiveRelative, 'Contents/Info.plist']) {
      if (!fs.lstatSync(path.join(installed, relative)).isFile()) throw Error(`Patch target must be an ordinary file: ${relative}`);
    }
    const changes = replacements(asar, originalArchive);
    const plan = await prepareArchive(asar, originalArchive, changes);
    const info = plist(path.join(installed, 'Contents/Info.plist'));
    validatePlist(info, hash(asar.getRawHeader(originalArchive).headerString));
    assert.equal(baseline.get(archiveRelative), (fs.statSync(originalArchive).mode & 0o777) + ':' + plan.originalHash, 'Installed archive changed during preflight');
    const previousSignature = stageOnly ? null : signature(installed);
    const entitlements = stageOnly ? null : run('/usr/bin/codesign', ['-d', '--entitlements', ':-', installed]);
    const requirements = stageOnly ? null : run('/usr/bin/codesign', ['-d', '-r-', installed]);
    compareBundle(baseline, treeManifest(installed), () => false);
    // No clone, lock, certificate output or archive write occurs until all module,
    // import, anchor, syntax, payload and plist validation above has succeeded.
    transaction = beginBundle(installed, installed, undefined, os.tmpdir());
    const candidate = transaction.bundle, archive = path.join(candidate, archiveRelative);
    compareBundle(baseline, treeManifest(candidate), () => false);
    // Derive the identity from the installed certificate, not signing.json,
    // provider settings, environment secrets, or an ad-hoc fallback.
    const identity = stageOnly ? null : signingIdentity(installed, path.join(path.dirname(candidate), 'installed-signer-'), previousSignature);
    const archiveMode = fs.statSync(archive).mode & 0o777;
    fs.writeFileSync(archive + '.cua-new', plan.bytes, { flag: 'wx', mode: archiveMode });
    fs.chmodSync(archive + '.cua-new', archiveMode);
    fs.renameSync(archive + '.cua-new', archive); asar.uncache(archive);
    const expectedInfo = structuredClone(info);
    expectedInfo.ElectronAsarIntegrity['Resources/app.asar'].hash = plan.headerHash;
    run('/usr/bin/plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify(expectedInfo.ElectronAsarIntegrity), path.join(candidate, 'Contents/Info.plist')]);
    const patchedOnly = key => key === archiveRelative || key === 'Contents/Info.plist';
    const verifyPayload = bundle => {
      verifyArchive(asar, originalArchive, path.join(bundle, archiveRelative), changes);
      assert.equal(hash(asar.getRawHeader(path.join(bundle, archiveRelative)).headerString), plan.headerHash, 'Candidate header hash mismatch');
      assert.deepEqual(plist(path.join(bundle, 'Contents/Info.plist')), expectedInfo, 'Info.plist changed beyond archive hash');
    };
    verifyPayload(candidate);
    compareBundle(baseline, treeManifest(candidate), patchedOnly);
    compareBundle(baseline, treeManifest(installed), () => false);
    if (stageOnly) {
      retained = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-cua-stage-'));
      const staged = path.join(retained, path.basename(installed));
      fs.renameSync(candidate, staged); transaction.abort(); transaction = null;
      process.stdout.write(JSON.stringify({ status: 'staged-not-installed', bundle: staged, signed: false, headerHash: plan.headerHash, modules: moduleReport(changes) }) + '\n');
      return;
    }
    codeSign('candidate signing', ['--force', '--sign', identity,
      '--preserve-metadata=identifier,requirements,entitlements,flags,runtime', '--timestamp=none', candidate]);
    assert.equal(signingIdentity(candidate, path.join(path.dirname(candidate), 'candidate-signer-'), previousSignature), identity, 'Signing certificate changed');
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
    const backupRoot = path.resolve(base, '../outputs/cua-operator-backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backup = path.join(backupRoot, `${Date.now()}-${crypto.randomUUID()}.app`);
    run('/bin/cp', ['-cR', installed, backup]);
    compareBundle(baseline, treeManifest(backup), () => false);
    const previous = transaction.commit(verify); transaction = null;
    if (previous) fs.rmSync(path.dirname(previous), { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ status: 'installed', bundle: installed, backup, signature: previousSignature, headerHash: plan.headerHash, modules: moduleReport(changes) }) + '\n');
  } catch (error) {
    if (retained) fs.rmSync(retained, { recursive: true, force: true });
    throw error;
  } finally { transaction?.abort(); }
}
module.exports = { BASELINE_HASHES, NEW_MODULES, PATCHES, patchText, replacements, validateBaseline, prepareArchive, repack, verifyArchive, validatePlist, main };
if (require.main === module) main().catch(error => {
  process.stderr.write('CUA operator installer failed. ' + error.message + '\n');
  process.exitCode = 1;
});
