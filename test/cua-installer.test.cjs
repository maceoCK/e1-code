'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const installer = require('../scripts/install-cua-operator.cjs');
const { integrity, treeManifest, compareBundle } = require('../scripts/install-vision-fallback.cjs');
const { BASELINE_HASHES, NEW_MODULES, PATCHES, patchText, replacements, validateBaseline, prepareArchive, repack, verifyArchive, validatePlist } = installer;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const libraries = Promise.all([
  import('@electron/asar'),
  import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js')).href),
]);
async function writeArchive(file, header, payload) {
  const [asar, { Pickle }] = await libraries;
  const h = Pickle.createEmpty(); h.writeString(JSON.stringify(header));
  const bytes = h.toBuffer(), size = Pickle.createEmpty(); size.writeUInt32(bytes.length);
  fs.writeFileSync(file, Buffer.concat([size.toBuffer(), bytes, payload]));
  asar.uncache(file);
}
async function fixture(t, evidence = false) {
  const [asar] = await libraries;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-cua-installer-test-'));
  t.after(() => { asar.uncacheAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const archive = path.join(root, 'original.asar'), source = path.join(root, 'src'), output = path.join(root, 'candidate.asar');
  fs.mkdirSync(source);
  const custom = 'const stripSteering = text => "installed-only-identity:" + text;\n';
  const gateway = custom + 'async function installedGateway() {\n' + PATCHES['gateway.cjs'].map(([old]) => old.trim().endsWith(',') ? 'void [\n' + old + '\n];' : old).join('\n') + '\n}\nmodule.exports = { stripSteering };\n';
  const stream = 'function installedRelay() {\n' + PATCHES['gateway-stream.cjs'].map(([old]) => old).join('\n') + '\n}\nmodule.exports = { installedRelay };\n';
  const original = new Map([
    ['gateway.cjs', Buffer.from(gateway)], ['gateway-stream.cjs', Buffer.from(stream)],
    ['vision-fallback.cjs', Buffer.from('module.exports = { baseline: true };\n')],
    ['providers.cjs', Buffer.from('module.exports = { identity: "installed-only-provider-customization" };\n')],
    ['routing.cjs', Buffer.from('module.exports = {};\n')],
    ['recovered.cjs', Buffer.from('module.exports = { coworkEgressAllowedHosts: ["*"] };\n')],
  ]);
  const header = { fixtureRootFlag: true, files: {
    aster: { fixtureDirectoryFlag: 'keep', files: {} },
    assets: { files: { 'unpacked.bin': { size: 13, unpacked: true, executable: true }, alias: { link: 'aster/providers.cjs' } } },
  } };
  let offset = 11; const chunks = [Buffer.from('PADDING-OLD')];
  for (const [name, data] of original) {
    header.files.aster.files[name] = { size: data.length, offset: String(offset), executable: name === 'gateway.cjs', customFlag: name,
      integrity: { ...integrity(data, 64), customIntegrityFlag: 'retained' } };
    chunks.push(data); offset += data.length;
  }
  // Shared offsets and payload padding are intentional: reconstruction by
  // extracting/repacking individual files would fail these preservation tests.
  header.files.assets.files['shared-copy.cjs'] = structuredClone(header.files.aster.files['providers.cjs']);
  chunks.push(Buffer.from([0, 9, 255, 0, 13]));
  await writeArchive(archive, header, Buffer.concat(chunks));
  const expected = Object.fromEntries([...original].filter(([name]) => Object.hasOwn(BASELINE_HASHES, 'aster/' + name)).map(([name, data]) => ['aster/' + name, hash(data)]));
  fs.writeFileSync(path.join(source, 'gateway.cjs'), patchText(gateway, 'gateway.cjs').replace('installed-only-identity:', 'SOURCE-identity-must-not-be-copied:'));
  fs.writeFileSync(path.join(source, 'gateway-stream.cjs'), patchText(stream, 'gateway-stream.cjs'));
  fs.writeFileSync(path.join(source, 'vision-fallback.cjs'), "const provider = require('./vision-provider.cjs'); const Routing = require('./routing.cjs'); module.exports = { provider, Routing };\n");
  fs.writeFileSync(path.join(source, 'vision-provider.cjs'), 'module.exports = { provider: true };\n');
  fs.writeFileSync(path.join(source, 'cua-operator.cjs'), "const provider = require('./vision-provider.cjs'); const vision = require('./vision-fallback.cjs');\n" + (evidence ? "const evidence = require('./cua-evidence.cjs');\n" : '') + 'module.exports = { provider, vision };\n');
  if (evidence) fs.writeFileSync(path.join(source, 'cua-evidence.cjs'), 'const crypto = require("node:crypto"); module.exports = { evidence: true, crypto };\n');
  return { asar, root, archive, source, output, expected, original, custom,
    changes: () => replacements(asar, archive, source, expected),
    mutate: async mutate => {
      asar.uncache(archive);
      const raw = asar.getRawHeader(archive), h = structuredClone(raw.header), payload = Buffer.from(fs.readFileSync(archive).subarray(8 + raw.headerSize));
      await mutate(h, payload);
      await writeArchive(archive, h, payload);
    },
  };
}
function flatten(header, prefix = '', result = new Map()) {
  for (const [name, entry] of Object.entries(header.files)) { result.set(prefix + name, entry); if (entry.files) flatten(entry, prefix + name + '/', result); }
  return result;
}

test('production baseline is pinned to the exact pre-upgrade installed modules', () => {
  assert.deepEqual(BASELINE_HASHES, {
    'aster/gateway.cjs': '198262e185047c25c5d0c956428c28e1e5aa16af3c70457957b4fd6d312046b8',
    'aster/gateway-stream.cjs': '6ae00640589cf0512bb82af18e561911594fa4b9a46369e0e7121ce4f3579a7a',
    'aster/vision-fallback.cjs': '7df9a9fd89093619e188a39dc56873a070bb25fd0fee1de2883693932ed68e24',
  });
  assert.ok(Object.isFrozen(BASELINE_HASHES));
});
for (const evidence of [false, true]) test(`append-only upgrade preserves bytes, flags, offsets and ${evidence ? 'three' : 'two'} new entries`, async t => {
  const f = await fixture(t, evidence), changes = f.changes(), originalBytes = fs.readFileSync(f.archive);
  const beforeRaw = f.asar.getRawHeader(f.archive), before = flatten(beforeRaw.header);
  assert.equal(changes.size, evidence ? 6 : 5);
  const plan = await prepareArchive(f.asar, f.archive, changes, f.expected);
  assert.equal(fs.existsSync(f.output), false, 'planning is entirely read-only');
  assert.equal(plan.originalHash, hash(originalBytes));
  await repack(f.asar, f.archive, f.output, changes, f.expected);
  verifyArchive(f.asar, f.archive, f.output, changes);
  const afterRaw = f.asar.getRawHeader(f.output), after = flatten(afterRaw.header);
  assert.equal(after.size, before.size + (evidence ? 3 : 2));
  assert.equal(plan.headerHash, hash(afterRaw.headerString));
  assert.ok(fs.readFileSync(f.archive).equals(originalBytes));
  const oldPayload = originalBytes.subarray(8 + beforeRaw.headerSize);
  assert.ok(fs.readFileSync(f.output).subarray(8 + afterRaw.headerSize, 8 + afterRaw.headerSize + oldPayload.length).equals(oldPayload));
  for (const [name, old] of before) if (!changes.has(name) && !old.files) assert.deepEqual(after.get(name), old);
  assert.equal(after.get('aster/gateway.cjs').executable, true);
  assert.equal(after.get('aster/gateway.cjs').customFlag, 'gateway.cjs');
  assert.equal(after.get('aster/gateway.cjs').integrity.customIntegrityFlag, 'retained');
  assert.equal(after.get('aster/gateway.cjs').integrity.blockSize, 64);
  assert.equal(after.get('assets/shared-copy.cjs').offset, before.get('aster/providers.cjs').offset);
  const gateway = f.asar.extractFile(f.output, 'aster/gateway.cjs').toString();
  assert.ok(gateway.startsWith(f.custom));
  assert.doesNotMatch(gateway, /SOURCE-identity/);
  assert.ok(f.asar.extractFile(f.output, 'aster/providers.cjs').equals(f.original.get('providers.cjs')));
  assert.ok(f.asar.extractFile(f.output, 'aster/recovered.cjs').equals(f.original.get('recovered.cjs')));
  for (const [name, data] of changes) assert.ok(f.asar.extractFile(f.output, name).equals(data));
});
test('unused optional source files are not silently installed', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.source, 'cua-evidence.cjs'), 'broken unused syntax {{{');
  assert.equal(f.changes().has('aster/cua-evidence.cjs'), false);
});
test('source integrations must match each reviewed replacement exactly', async t => {
  const f = await fixture(t), source = path.join(f.source, 'gateway.cjs');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('!operator.buffer', '!operator.changed'));
  assert.throws(f.changes, /Source integration drift: gateway.cjs/);
  assert.equal(fs.existsSync(f.output), false);
});
test('duplicate source integration anchors are rejected', async t => {
  const f = await fixture(t);
  fs.appendFileSync(path.join(f.source, 'gateway.cjs'), '\n' + PATCHES['gateway.cjs'][0][1]);
  assert.throws(f.changes, /Source integration drift/);
});
for (const name of Object.keys(PATCHES)) test(`${name} requires unique unpatched anchors and refuses partial/already patched input`, () => {
  const original = PATCHES[name].map(([old]) => old).join('\n');
  const patched = patchText(original, name);
  assert.throws(() => patchText(original + '\n' + PATCHES[name][0][0], name), /exactly one patch anchor/);
  assert.throws(() => patchText(original.replace(PATCHES[name][0][0], '// drift'), name), /exactly one patch anchor/);
  assert.throws(() => patchText(patched, name), /Already or partially patched/);
  assert.throws(() => patchText(original.replace(...PATCHES[name][0]), name), /Already or partially patched/);
  for (const [, replacement] of PATCHES[name]) assert.equal(patched.split(replacement).length, 2);
});
for (const name of Object.keys(BASELINE_HASHES)) test(`unknown or tampered ${name} baseline is refused even with updated entry integrity`, async t => {
  const f = await fixture(t);
  await f.mutate((header, payload) => {
    const entry = header.files.aster.files[path.posix.basename(name)], offset = Number(entry.offset);
    payload[offset] ^= 1;
    entry.integrity = integrity(payload.subarray(offset, offset + entry.size), entry.integrity.blockSize);
  });
  assert.throws(f.changes, /Unknown installed baseline/);
  assert.equal(fs.existsSync(f.output), false);
});
test('valid fixture modules cannot pass the production baseline gate', async t => {
  const f = await fixture(t);
  assert.throws(() => validateBaseline(f.asar, f.archive), /Unknown installed baseline/);
});
test('tampered baseline integrity is refused independently of module hashes', async t => {
  const f = await fixture(t);
  await f.mutate(header => { header.files.aster.files['vision-fallback.cjs'].integrity.blocks[0] = '0'.repeat(64); });
  assert.throws(f.changes, /Baseline integrity mismatch/);
});
for (const name of NEW_MODULES) test(`an existing ${name} refuses a partial installation`, async t => {
  const f = await fixture(t);
  await f.mutate(header => { header.files.aster.files[path.posix.basename(name)] = { link: 'aster/providers.cjs' }; });
  assert.throws(f.changes, /Already or partially installed/);
});
for (const flag of ['unpacked', 'link', 'files']) test(`baseline ${flag} targets are refused before writing`, async t => {
  const f = await fixture(t);
  await f.mutate(header => { header.files.aster.files['vision-fallback.cjs'][flag] = flag === 'files' ? {} : flag === 'link' ? 'aster/providers.cjs' : true; });
  assert.throws(f.changes, /must be packed/);
});
test('malformed syntax in any replacement is refused before archive writes', async t => {
  const f = await fixture(t);
  for (const name of ['vision-fallback.cjs', 'vision-provider.cjs', 'cua-operator.cjs']) {
    const file = path.join(f.source, name), original = fs.readFileSync(file);
    fs.writeFileSync(file, 'function invalid( {');
    assert.throws(f.changes, /JavaScript syntax check failed/);
    fs.writeFileSync(file, original);
  }
  const changes = f.changes(); changes.set('aster/cua-operator.cjs', Buffer.from('function invalid( {'));
  await assert.rejects(repack(f.asar, f.archive, f.output, changes, f.expected), /JavaScript syntax check failed/);
  assert.equal(fs.existsSync(f.output), false);
});
test('required patches and new-module allowlist are enforced before writes', async t => {
  const f = await fixture(t), original = f.changes();
  for (const name of original.keys()) {
    const incomplete = new Map(original); incomplete.delete(name);
    await assert.rejects(repack(f.asar, f.archive, f.output, incomplete, f.expected), /Missing required patch/);
  }
  const unreviewed = new Map(original); unreviewed.set('aster/arbitrary.cjs', Buffer.from('module.exports = {};'));
  await assert.rejects(repack(f.asar, f.archive, f.output, unreviewed, f.expected), /Not an allowed patch/);
  assert.equal(fs.existsSync(f.output), false);
});
test('missing, dynamic and unapproved dependencies fail without copying arbitrary source', async t => {
  const f = await fixture(t), file = path.join(f.source, 'cua-operator.cjs');
  for (const code of ["require('./unreviewed.cjs');", 'require(name);', "require('unreviewed-package');", "import('./dynamic.cjs');", "require('../outside.cjs');"]) {
    fs.writeFileSync(file, code);
    assert.throws(f.changes, /[Uu]nreviewed|unapproved/);
  }
  fs.writeFileSync(file, "require('./cua-evidence.cjs');");
  assert.throws(f.changes, /ENOENT/);
});
test('missing existing local dependency is rejected', async t => {
  const f = await fixture(t);
  await f.mutate(header => { delete header.files.aster.files['routing.cjs']; });
  assert.throws(f.changes, /Missing or unapproved module dependency/);
});
test('gateway cannot be fully replaced or changed outside the reviewed anchors', async t => {
  const f = await fixture(t), changes = f.changes();
  changes.set('aster/gateway.cjs', Buffer.from(changes.get('aster/gateway.cjs').toString().replace('installed-only-identity:', 'source-identity:')));
  await assert.rejects(repack(f.asar, f.archive, f.output, changes, f.expected), /Unexpected replacement beyond approved anchors/);
  assert.equal(fs.existsSync(f.output), false);
});
test('baseline mutation between planning steps is caught before the output write', async t => {
  const f = await fixture(t), changes = f.changes();
  await f.mutate((header, payload) => { payload[Number(header.files.aster.files['gateway.cjs'].offset)] ^= 1; });
  await assert.rejects(repack(f.asar, f.archive, f.output, changes, f.expected), /Unknown installed baseline/);
  assert.equal(fs.existsSync(f.output), false);
});
test('archive verification catches unrelated bytes, offsets, flags and undeclared entries', async t => {
  const f = await fixture(t), changes = f.changes();
  await repack(f.asar, f.archive, f.output, changes, f.expected);
  const raw = f.asar.getRawHeader(f.output), pristine = fs.readFileSync(f.output), payload = pristine.subarray(8 + raw.headerSize);
  const attempts = [
    (header, bytes) => { bytes[0] ^= 1; },
    header => { header.files.aster.files['providers.cjs'].offset = '0'; },
    header => { header.files.assets.files['unpacked.bin'].unpacked = false; header.files.assets.files['unpacked.bin'].offset = '0'; },
    header => { header.files.aster.fixtureDirectoryFlag = 'changed'; },
    header => { header.files.aster.files['extra.cjs'] = { size: 0, offset: '0' }; },
    header => { header.fixtureRootFlag = false; },
    header => { delete header.files.aster.files['providers.cjs']; },
  ];
  for (const mutate of attempts) {
    const header = structuredClone(raw.header), bytes = Buffer.from(payload); mutate(header, bytes);
    await writeArchive(f.output, header, bytes);
    assert.throws(() => verifyArchive(f.asar, f.archive, f.output, changes), /changed|Unexpected|Removed/);
  }
});
test('archive verification checks new module bytes, metadata, hashes and exact appended length', async t => {
  const f = await fixture(t), changes = f.changes();
  await repack(f.asar, f.archive, f.output, changes, f.expected);
  const raw = f.asar.getRawHeader(f.output), payload = fs.readFileSync(f.output).subarray(8 + raw.headerSize);
  for (const mode of ['bytes', 'hash', 'flags', 'extra-bytes']) {
    const header = structuredClone(raw.header), bytes = Buffer.from(payload), entry = header.files.aster.files['cua-operator.cjs'];
    if (mode === 'bytes') bytes[Number(entry.offset)] ^= 1;
    if (mode === 'hash') entry.integrity.hash = '0'.repeat(64);
    if (mode === 'flags') entry.unpacked = true;
    await writeArchive(f.output, header, mode === 'extra-bytes' ? Buffer.concat([bytes, Buffer.from([0])]) : bytes);
    assert.throws(() => verifyArchive(f.asar, f.archive, f.output, changes), /Patch|Unexpected archive payload length/);
  }
});
test('exclusive candidate creation never overwrites an existing output', async t => {
  const f = await fixture(t), changes = f.changes();
  fs.writeFileSync(f.output, 'existing candidate');
  await assert.rejects(repack(f.asar, f.archive, f.output, changes, f.expected), /EEXIST/);
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'existing candidate');
});
test('archive filesystem mode survives a restrictive creation umask', async t => {
  const f = await fixture(t), changes = f.changes();
  fs.chmodSync(f.archive, 0o664);
  const previous = process.umask(0o077);
  try {
    await repack(f.asar, f.archive, f.output, changes, f.expected);
    assert.equal(fs.statSync(f.output).mode & 0o777, 0o664);
  } finally { process.umask(previous); }
});
test('plist preflight requires the current archive hash and a safe executable name', () => {
  const info = { CFBundleExecutable: 'E1 Code', ElectronAsarIntegrity: { 'Resources/app.asar': { algorithm: 'SHA256', hash: 'known' } } };
  validatePlist(info, 'known');
  assert.throws(() => validatePlist(info, 'changed'), /does not match/);
  for (const executable of ['', '..', '../Frameworks/helper', '/tmp/app', null]) assert.throws(() => validatePlist({ ...info, CFBundleExecutable: executable }, 'known'), /executable name/);
});
test('bundle verification protects renderer, sandbox baseline, helpers and unpacked resources', async t => {
  const f = await fixture(t), bundle = path.join(f.root, 'fixture.app');
  for (const name of ['Contents/Resources/app.asar', 'Contents/Info.plist', 'Contents/Resources/ion-dist/settings.js', 'Contents/Resources/app.asar.unpacked/helper', 'Contents/Frameworks/Helper.app/helper']) {
    fs.mkdirSync(path.dirname(path.join(bundle, name)), { recursive: true }); fs.writeFileSync(path.join(bundle, name), name);
  }
  const before = treeManifest(bundle), allowed = name => name === 'Contents/Resources/app.asar' || name === 'Contents/Info.plist';
  fs.writeFileSync(path.join(bundle, 'Contents/Resources/app.asar'), 'new');
  compareBundle(before, treeManifest(bundle), allowed);
  fs.writeFileSync(path.join(bundle, 'Contents/Resources/ion-dist/settings.js'), 'accidental overwrite');
  assert.throws(() => compareBundle(before, treeManifest(bundle), allowed), /Unrelated bundle file changed/);
});
