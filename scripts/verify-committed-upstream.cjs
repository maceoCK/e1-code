// Verify the committed upstream parts reassemble into the pinned vendor
// archives, without writing anything: hash each part, then the assembled
// whole, against upstream/<name>.parts/manifest.json and the pins in
// third_party/upstream.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pins = require('../third_party/upstream.json');

const sha256File = file => {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(8 * 1048576), fd = fs.openSync(file, 'r');
  try { for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

const problems = [];
for (const dir of fs.existsSync(path.join(root, 'upstream')) ? fs.readdirSync(path.join(root, 'upstream')).filter(name => name.endsWith('.parts')) : []) {
  const label = path.join('upstream', dir);
  const manifestPath = path.join(root, label, 'manifest.json');
  if (!fs.existsSync(manifestPath)) { problems.push(`${label}: missing manifest.json`); continue; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pin = Object.values(pins.release.assets).find(asset => asset.name === manifest.name);
  if (!pin || manifest.totalSha256 !== pin.sha256) problems.push(`${label}: assembled hash is not the pinned SHA-256`);
  const listed = fs.readdirSync(path.join(root, label)).filter(name => name !== 'manifest.json');
  const expected = manifest.parts.map(part => part.file);
  for (const name of listed) if (!expected.includes(name)) problems.push(`${label}/${name}: not in the manifest`);
  for (const part of manifest.parts) {
    const file = path.join(root, label, part.file);
    if (!fs.existsSync(file)) { problems.push(`${label}/${part.file}: missing`); continue; }
    if (fs.statSync(file).size !== part.bytes) problems.push(`${label}/${part.file}: size does not match the manifest`);
    if (sha256File(file) !== part.sha256) problems.push(`${label}/${part.file}: SHA-256 does not match the manifest`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Committed upstream parts verify against ${Object.values(pins.release.assets).length} pinned archives.`);
