const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const E1ModelList = require('../src/model-list.js');
const { resolvePickerModel } = E1ModelList;
const capable = { id:'claude-aster-0123456789abcdef', name:'Claude Opus 5.5', aliases:['claude-aster-0123456789abcdef[1m]'] };
const ordinary = { id:'claude-aster-fedcba9876543210', name:'Other model', aliases:[] };

test('native 1M and ordinary labels resolve to the original canonical route object', () => {
  const rows = [capable, ordinary];
  assert.equal(resolvePickerModel(rows, capable.name), capable);
  assert.equal(resolvePickerModel(rows, capable.name + ' 1M'), capable);
  assert.equal(resolvePickerModel(rows, ordinary.name), ordinary);
  assert.equal(capable.id, 'claude-aster-0123456789abcdef');
});
test('1M labels require an explicitly declared variant of that same route', () => {
  assert.equal(resolvePickerModel([ordinary], ordinary.name + ' 1M'), undefined);
  assert.equal(resolvePickerModel([{ ...ordinary, aliases:capable.aliases }], ordinary.name + ' 1M'), undefined);
  assert.equal(resolvePickerModel([{ ...ordinary, supports1m:true }], ordinary.name + ' 1M'), undefined);
});
test('unknown labels and CLI-only decorations do not fuzzy-match a billing route', () => {
  for (const label of ['claude opus 5.5', capable.name + ' (1M context)', capable.name + '[1m]', capable.name + ' 1M extra'])
    assert.equal(resolvePickerModel([capable], label), undefined);
  assert.equal(resolvePickerModel(undefined, capable.name), undefined);
});
test('duplicate exact or decorated labels fail closed across distinct routes', () => {
  const duplicate = { ...capable, id:ordinary.id, aliases:[ordinary.id + '[1m]'] };
  assert.equal(resolvePickerModel([capable, duplicate], capable.name), undefined);
  assert.equal(resolvePickerModel([capable, duplicate], capable.name + ' 1M'), undefined);
});
test('literal names ending in 1M remain valid but collisions with native variants fail closed', () => {
  const literal = { ...ordinary, name:capable.name + ' 1M' };
  assert.equal(resolvePickerModel([literal], literal.name), literal);
  assert.equal(resolvePickerModel([capable, literal], literal.name), undefined);
  assert.equal(resolvePickerModel([literal, capable], literal.name), undefined);
});
function picker(label, ids = ['chat-1']) {
  return {
    textContent:'ignored when aria-label exists',
    getAttribute:name => name === 'aria-label' ? 'Model: ' + label : null,
    closest:selector => selector === '[data-session-id]' ? null : {
      querySelectorAll:() => ids.map(id => ({ getAttribute:() => id })),
    },
  };
}
for (const file of ['speed-picker.js', 'workflow-picker.js']) {
  test(file + ' keeps canonical preference identity and unique chat scope for 1M', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    const context = source.match(/function context\(picker\) \{[\s\S]*?\n  \}/)?.[0];
    assert.ok(context);
    const resolve = vm.runInNewContext('(' + context + ')', { window:{ E1ModelList }, state:{ models:[capable, ordinary] } });
    const result = resolve(picker(capable.name + ' 1M'));
    assert.equal(result.model, capable);
    assert.equal(result.chatId, 'chat-1');
    assert.equal(resolve(picker(capable.name + ' 1M', ['chat-1', 'chat-2'])).chatId, null);
    assert.equal(resolve(picker(ordinary.name + ' 1M')), null);
  });
}
test('billing lookup preserves canonical route and tolerates helper loading after the billing script', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/billing-indicator.js'), 'utf8');
  const expression = source.match(/const route = ([^;]+);\n      const chatId/)?.[1];
  assert.ok(expression);
  const scope = { window:{ E1ModelList }, snapshot:{ catalog:[capable, ordinary] }, label:capable.name + ' 1M' };
  assert.equal(vm.runInNewContext(expression, scope), capable);
  assert.equal(vm.runInNewContext(expression, { ...scope, window:{} }), undefined);
});
