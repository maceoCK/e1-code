const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { patchText } = require('../scripts/install-vision-fallback.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/recovered.cjs'), 'utf8');

test('E1 deployment does not impose an egress allowlist or override command permissions', () => {
  const configSource = source.split('  const config = {')[1]?.split('  for (const [name, data] of [')[0];
  assert.ok(configSource, 'expected native deployment configuration');
  const config = vm.runInNewContext('const config = {' + configSource + '\nJSON.stringify(config)', {
    libraryIdentity: { organizationUuid: 'fixture-org' }, gateway: { origin: 'http://localhost:1', token: 'fixture-token' }, routes: [], process: { env: {} },
  });
  const result = JSON.parse(config);
  assert.deepEqual(result.coworkEgressAllowedHosts, ['*']);
  assert.equal(result.builtinBrowserEnabled, true);
  assert.equal(Object.hasOwn(result, 'sandbox'), false);
  assert.equal(Object.hasOwn(result, 'permissions'), false);
  assert.equal(Object.hasOwn(result, 'allowedWorkspaceFolders'), false);
});
test('surgical deployment patch preserves all unrelated installed customizations', () => {
  const old = '    builtinBrowserEnabled: true,\n    disableAutoUpdates: true,';
  const fixture = '// installed-only prefix\n' + old + '\n// installed-only suffix\n';
  const result = patchText(fixture, 'recovered.cjs');
  assert.ok(result.startsWith('// installed-only prefix\n'));
  assert.ok(result.endsWith('\n// installed-only suffix\n'));
  assert.equal(result.match(/coworkEgressAllowedHosts/g).length, 1);
  const replacement = result.slice('// installed-only prefix\n'.length, -'\n// installed-only suffix\n'.length);
  assert.ok(source.includes(replacement), 'installer matches source configuration');
  assert.throws(() => patchText(result, 'recovered.cjs'), /exactly one patch anchor/);
  assert.throws(() => patchText(old + old, 'recovered.cjs'), /exactly one patch anchor/);
});
