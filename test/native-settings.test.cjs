const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { nativePicker } = require('../src/model-picker.cjs');
const os = require('node:os');
const capture = process.env.E1_CAPTURE_ROOT || path.resolve(__dirname, '../../outputs/claude-desktop-decomp');
const available = fs.existsSync(path.join(capture, 'extracted/app/.vite/build/index.chunk-BZdcw7TE.js'));
// Apply the build's capability patch to the locally supplied capture.
let source = 'function _Tr(){}function ';
if (available) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-native-settings-'));
  fs.mkdirSync(path.join(stage, '.vite/build'), { recursive: true });
  require('../scripts/patch-native-capabilities.cjs')(capture, stage);
  source = fs.readFileSync(path.join(stage, '.vite/build/index.chunk-BZdcw7TE.js'), 'utf8');
  fs.rmSync(stage, { recursive: true, force: true });
}
const start = source.indexOf('function _Tr(');
const end = source.indexOf('function ', start + 9);
const builder = vm.runInNewContext('(' + source.slice(start, end) + ')', {
  jGt: models => new Set(models.filter(m => m.minDesktopVersion).map(m => m.name)),
  qC: name => name === 'sonnet', a: { app: { getVersion: () => '2.19675.0' } },
  MMe: config => config.pricing, gTr: value => value,
  require: id => { assert.equal(id, '../../aster/model-picker.cjs'); return { nativePicker }; },
});
const id = 'claude-aster-0000000000000001';
const excluded = 'claude-aster-0000000000000002';
const config = { models: { list: [
  { name: id, labelOverride: 'Configured model', supports1m: true },
  { name: excluded, minDesktopVersion: '999' },
  { name: 'sonnet' },
] }, pricing: { preserve: true } };

test('native routing settings register curated aliases without changing policy or pricing', { skip: !available }, () => {
  const output = JSON.parse(JSON.stringify(builder(config, { managesProviderRouting: () => true })));
  assert.deepEqual(output.availableModels, [id]);
  assert.equal(output.enforceAvailableModels, false);
  assert.deepEqual(output.modelPricing, config.pricing);
  assert.deepEqual(output.modelPicker.options.map(m => m.model), [id, id + '[1m]']);
  assert.equal(output.modelPicker.replaceBuiltInOptions, false);
});
test('native picker patch does not affect non-gateway provider management', { skip: !available }, () => {
  assert.equal(JSON.stringify(builder(config, { managesProviderRouting: () => false })), '{}');
});

test('explicit search disable is retained in generated native configuration', { skip: !available }, () => {
  const recovered = fs.readFileSync(path.join(__dirname, '../src/recovered.cjs'), 'utf8');
  const expression = recovered.match(/toolSearchEnabled: (.*),/)[1];
  for (const value of ['false', '0', 'off', 'FALSE']) {
    assert.equal(vm.runInNewContext(expression, { process: { env: { ENABLE_TOOL_SEARCH: value } } }), false);
  }
  for (const value of [undefined, 'true', 'force']) {
    assert.equal(vm.runInNewContext(expression, { process: { env: { ENABLE_TOOL_SEARCH: value } } }), true);
  }
  assert.ok(source.includes('env:{ENABLE_TOOL_SEARCH:"force"}'));
  assert.ok(source.includes('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:l==="legacy"?"":"1"'));
});
