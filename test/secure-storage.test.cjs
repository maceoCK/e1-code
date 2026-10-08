const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createStorage } = require('../src/secure-storage.cjs');
function fixture(t, launch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'helper'); fs.writeFileSync(executable, 'fixture');
  return { executable, storage: createStorage({ executable, sha256: crypto.createHash('sha256').update('fixture').digest('hex') }, launch) };
}
test('vault sends credentials only through the private pipe, with no inherited provider environment', t => {
  const calls = [];
  const { storage } = fixture(t, (executable, args, options) => {
    calls.push({ args, options });
    const request = JSON.parse(options.input);
    return { status: 0, stdout: JSON.stringify({ data: request.data }) };
  });
  const message = 'test secret with unicode: é 🔐';
  assert.equal(storage.decryptString(storage.encryptString(message)), message);
  assert.equal(storage.isEncryptionAvailable(), true);
  for (const { args, options } of calls) {
    assert.deepEqual(args, []);
    assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'PATH']);
    assert.equal(options.shell, undefined);
  }
});
test('vault refuses replaced helpers and never leaks secret output into errors', t => {
  let calls = 0;
  const { storage, executable } = fixture(t, () => { calls++; return { status: 1, stdout: 'private-output', stderr: 'private-error' }; });
  assert.throws(() => storage.encryptString('secret'), error => !error.message.includes('private-'));
  fs.writeFileSync(executable, 'replaced');
  assert.equal(storage.isEncryptionAvailable(), false);
  assert.throws(() => storage.encryptString('secret'), /helper changed/);
  assert.equal(calls, 1);
});
