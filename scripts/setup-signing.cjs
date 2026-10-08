// One-time local development signing identity. No system trust roots are changed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { directory, configFile } = require('./signing.cjs');
if (fs.existsSync(configFile)) {
  console.log('Persistent E1 Code signing identity is already configured.');
  process.exit(0);
}
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const temporary = fs.mkdtempSync(path.join(directory, '.setup-'));
fs.chmodSync(temporary, 0o700);
const run = (command, args) => cp.execFileSync(command, args, { cwd: temporary, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const config = `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = signing\n[dn]\nCN = E1 Code Local Development\n[signing]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid\n`;
  fs.writeFileSync(path.join(temporary, 'openssl.cnf'), config, { mode: 0o600 });
  run('/usr/bin/openssl', ['req', '-new', '-newkey', 'rsa:3072', '-x509', '-nodes', '-days', '3650', '-config', 'openssl.cnf', '-keyout', 'key.pem', '-out', 'certificate.pem']);
  run('/usr/bin/openssl', ['rsa', '-in', 'key.pem', '-out', 'import-key.pem']);
  fs.chmodSync(path.join(temporary, 'key.pem'), 0o600);
  fs.chmodSync(path.join(temporary, 'import-key.pem'), 0o600);
  const keychain = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
  console.log('Importing the non-extractable signing key for /usr/bin/codesign only.');
  run('/usr/bin/security', ['import', path.join(temporary, 'import-key.pem'), '-k', keychain, '-x', '-T', '/usr/bin/codesign']);
  run('/usr/bin/security', ['import', path.join(temporary, 'certificate.pem'), '-k', keychain, '-f', 'pemseq', '-t', 'cert']);
  const sha1 = run('/usr/bin/openssl', ['x509', '-in', 'certificate.pem', '-noout', '-fingerprint', '-sha1']).split('=')[1].replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(sha1)) throw Error('Could not fingerprint local signing certificate.');
  fs.copyFileSync(path.join(temporary, 'certificate.pem'), path.join(directory, 'certificate.pem'));
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, sha1, keychain, name: 'E1 Code Local Development', createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log('Persistent local signing identity configured. No TLS or system trust settings changed.');
} finally {
  // Keep no extractable copy of the signing key outside Keychain.
  fs.rmSync(temporary, { recursive: true, force: true });
}
