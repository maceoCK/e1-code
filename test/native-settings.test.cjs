const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { nativePicker } = require('../src/model-picker.cjs');
const os = require('node:os');
const capture = process.env.E1_CAPTURE_ROOT || require('../scripts/prepare-upstream.cjs').capturePath('claude');
const patcher = require('../scripts/patch-native-capabilities.cjs');
const available = fs.existsSync(path.join(capture, 'extracted/app', patcher.file));
// Apply the build's capability patch to the locally supplied capture.
let source = 'function JJt(){}function ';
if (available) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-native-settings-'));
  fs.mkdirSync(path.join(stage, '.vite/build'), { recursive: true });
  patcher(capture, stage);
  source = fs.readFileSync(path.join(stage, patcher.file), 'utf8');
  fs.rmSync(stage, { recursive: true, force: true });
}
// 3.1623.0 managed CLI settings builder (was _Tr); its policy helpers now arrive via `t`.
const start = source.indexOf('function JJt(');
const end = source.indexOf('function ', start + 9);
const builder = vm.runInNewContext('(' + source.slice(start, end) + ')', {
  ZMe: config => config.pricing, qJt: value => value,
  require: id => { assert.equal(id, '../../aster/model-picker.cjs'); return { nativePicker }; },
});
const routing = managesProviderRouting => ({
  managesProviderRouting,
  isRestrictedModel: name => name === 'sonnet',
  modelNamesNeedingUpdate: models => new Set(models.filter(m => m.minDesktopVersion).map(m => m.name)),
});
const id = 'claude-aster-0000000000000001';
const excluded = 'claude-aster-0000000000000002';
const config = { models: { list: [
  { name: id, labelOverride: 'Configured model', supports1m: true },
  { name: excluded, minDesktopVersion: '999' },
  { name: 'sonnet' },
] }, pricing: { preserve: true } };

test('native routing settings register curated aliases without changing policy or pricing', { skip: !available }, () => {
  const output = JSON.parse(JSON.stringify(builder(config, routing(true))));
  assert.deepEqual(output.availableModels, [id]);
  assert.equal(output.enforceAvailableModels, false);
  assert.deepEqual(output.modelPricing, config.pricing);
  assert.deepEqual(output.modelPicker.options.map(m => m.model), [id, id + '[1m]']);
  assert.equal(output.modelPicker.replaceBuiltInOptions, false);
});
test('native picker patch does not affect non-gateway provider management', { skip: !available }, () => {
  assert.equal(JSON.stringify(builder(config, routing(false))), '{}');
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
  assert.ok(source.includes('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:c==="legacy"?"":"1"'));
});
