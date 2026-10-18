const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const patcher = require('../scripts/patch-sandbox-settings.cjs');
const { patchRenderer, verifyRenderer, treeManifest, compareBundle } = require('../scripts/install-vision-fallback.cjs');
const renderer = 'Contents/Resources/ion-dist';
const fixtures = {
  'assets/v1/c71860c77-CDc2iaLc.js': 'const rows=[l(wi,{}),l(yi,{}),l(mi,{}),l(_i,{})];',
  'assets/v1/c7357c32b-m4MxPvkb.js': 'const descriptors=[{storage:{api:"ClaudeCode.setLocalSandboxEnabled"},platform:"desktop",search:{localSessionRow:!0}},{storage:{api:"ClaudeCode.setStrictSandboxMode"},platform:"desktop",search:{localSessionRow:!0}},{storage:{api:"Unrelated.setting"},platform:"desktop",search:{localSessionRow:!0}}];',
};

test('sandbox settings mount is removed while neighboring rows and policy definitions survive', () => {
  const file = patcher.files[0];
  const definitions = '\nconst _i=()=>"Local sandbox", gi=()=>"Strict sandbox mode";';
  const result = patcher.patch(file, fixtures[file] + definitions);
  assert.ok(result.endsWith(definitions));
  const mounted = vm.runInNewContext(result.split(definitions)[0] + '\nJSON.stringify(rows)', {
    l: component => component, wi: 'before-one', yi: 'before-two', mi: 'before-three', _i: 'sandbox',
  });
  assert.deepEqual(JSON.parse(mounted), ['before-one', 'before-two', 'before-three']);
});
test('both sandbox descriptors are excluded from search without removing IPC metadata', () => {
  const file = patcher.files[1];
  const descriptors = JSON.parse(vm.runInNewContext(patcher.patch(file, fixtures[file]) + '\nJSON.stringify(descriptors)'));
  assert.deepEqual(descriptors.slice(0, 2).map(row => row.search), [{ exclude: true }, { exclude: true }]);
  assert.deepEqual(descriptors.slice(0, 2).map(row => row.storage.api), ['ClaudeCode.setLocalSandboxEnabled', 'ClaudeCode.setStrictSandboxMode']);
  assert.deepEqual(descriptors.filter(row => !row.search?.exclude).map(row => row.storage.api), ['Unrelated.setting']);
});
test('renderer patch rejects absent, duplicate, already patched and unknown targets', () => {
  for (const file of patcher.files) {
    assert.throws(() => patcher.patch(file, ''), /expected one anchor/);
    assert.throws(() => patcher.patch(file, fixtures[file] + fixtures[file]), /expected one anchor/);
    assert.throws(() => patcher.patch(file, patcher.patch(file, fixtures[file])), /expected one anchor/);
  }
  assert.throws(() => patcher.patch('unexpected.js', ''), /Unexpected/);
});
function bundles(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-settings-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, 'installed'), candidate = path.join(root, 'candidate');
  for (const [file, source] of Object.entries(fixtures)) {
    const target = path.join(installed, renderer, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// installed-only customization\n' + source + '\nexport {};\n');
  }
  fs.writeFileSync(path.join(installed, 'unchanged.txt'), 'preserve me');
  fs.cpSync(installed, candidate, { recursive: true });
  return { installed, candidate };
}
test('surgical renderer installer verifies exact bytes and preserves installed bundle', t => {
  const { installed, candidate } = bundles(t), baseline = treeManifest(installed);
  const changes = patchRenderer(installed, candidate);
  assert.deepEqual([...changes.keys()], patcher.files.map(file => path.join(renderer, file)));
  verifyRenderer(candidate, changes);
  compareBundle(baseline, treeManifest(candidate), file => changes.has(file));
  compareBundle(baseline, treeManifest(installed), () => false);
  for (const source of changes.values()) assert.ok(source.startsWith('// installed-only customization\n'));
  fs.appendFileSync(path.join(candidate, [...changes.keys()][0]), '// unexpected mutation');
  assert.throws(() => verifyRenderer(candidate, changes), /Renderer patch bytes mismatch/);
});
test('renderer installer validates all targets before making candidate writes', t => {
  const { installed, candidate } = bundles(t), baseline = treeManifest(candidate);
  fs.writeFileSync(path.join(installed, renderer, patcher.files[1]), 'changed upstream');
  assert.throws(() => patchRenderer(installed, candidate), /expected one anchor/);
  compareBundle(baseline, treeManifest(candidate), () => false);
});
test('renderer installer rejects invalid ESM before making candidate writes', t => {
  const { installed, candidate } = bundles(t), baseline = treeManifest(candidate);
  fs.appendFileSync(path.join(installed, renderer, patcher.files[1]), '\nconst = ;');
  assert.throws(() => patchRenderer(installed, candidate), /JavaScript syntax check failed/);
  compareBundle(baseline, treeManifest(candidate), () => false);
});
test('regular build includes the settings removal before signing', () => {
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.cjs'), 'utf8');
  const index = build.indexOf("require('./patch-sandbox-settings.cjs').install(ionOriginal, ion)");
  assert.ok(index > 0 && index < build.indexOf("const signing = require('./signing.cjs')"));
});
