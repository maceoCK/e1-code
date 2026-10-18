const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codeSign, extractCertificates } = require('../scripts/install-vision-fallback.cjs');

test('codesign failures identify the phase and preserve the actual diagnostic', () => {
  for (const step of ['installed-app preflight', 'candidate signing', 'candidate verification']) {
    assert.throws(() => codeSign(step, ['--verify', 'fixture.app'], () => {
      throw Object.assign(Error('Command failed'), { status: 1, stderr: 'fixture.app: CSSMERR_TP_NOT_TRUSTED\n' });
    }), error => error.message.includes(step) && error.message.includes('exit 1') &&
      error.message.includes('fixture.app: CSSMERR_TP_NOT_TRUSTED') && !error.message.includes('sandbox'));
  }
});
test('codesign errors do not mislabel missing identities as trust or sandbox problems', () => {
  assert.throws(() => codeSign('candidate signing', [], () => {
    throw Object.assign(Error('Command failed'), { status: 1, stderr: 'The specified item could not be found in the keychain.' });
  }), /The specified item could not be found in the keychain/);
});
test('certificate extraction attaches the optional output prefix to its flag', () => {
  const bundle = '/fixture/E1 Code.app', prefix = '/fixture/staging space/signer-';
  assert.equal(extractCertificates(bundle, prefix, (bin, args) => {
    assert.equal(bin, '/usr/bin/codesign');
    assert.deepEqual(args, ['-d', '--extract-certificates=' + prefix, bundle]);
    return 'extracted';
  }), 'extracted');
});
test('certificate extraction failures identify the signing phase', () => {
  assert.throws(() => extractCertificates('fixture.app', '/fixture/signer-', () => {
    throw Object.assign(Error('Command failed'), { status: 1, stderr: 'certificate extraction failed' });
  }), /installed certificate extraction.*\ncertificate extraction failed/);
});
test('codesign wrapper returns successful output unchanged', () => {
  assert.equal(codeSign('candidate signing', ['--verify'], (bin, args) => {
    assert.equal(bin, '/usr/bin/codesign');
    assert.deepEqual(args, ['--verify']);
    return 'verified';
  }), 'verified');
});
