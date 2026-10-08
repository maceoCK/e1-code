const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw Error(`Cannot read ${path.basename(file)}. The existing file has been preserved.`); }
}
// Local library identity is never derived from a credential, email, provider,
// model, payment method, or remote OAuth account. Retain the existing namespace.
function ensureLibraryIdentity(dataDir, profileDir) {
  const file = path.join(dataDir, 'library-identity.json');
  const saved = readJson(file, null);
  const deviceFile = path.join(profileDir, 'ant-did');
  let device;
  try { device = Buffer.from(fs.readFileSync(deviceFile, 'utf8'), 'base64').toString('utf8').trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (device !== undefined && !UUID.test(device)) throw Error('The local chat identity is damaged. It was preserved for recovery.');
  const config = readJson(path.join(profileDir, 'config.json'), {});
  const lastKnown = config.lastKnownAccountUuid;
  if (saved && (!UUID.test(saved.accountUuid) || !UUID.test(saved.organizationUuid)))
    throw Error('The saved library identity is invalid. It was preserved for recovery.');
  if (saved && device && saved.accountUuid !== device)
    throw Error('The chat library identity changed unexpectedly. Existing chats are preserved; restore the original library identity before opening.');
  const identity = saved || {
    version: 1,
    accountUuid: device || (UUID.test(lastKnown || '') ? lastKnown : crypto.randomUUID()),
    organizationUuid: DEFAULT_ORG,
    createdAt: new Date().toISOString(),
  };
  if (!saved) {
    const meta = readJson(path.join(profileDir, 'configLibrary/_meta.json'), {});
    const selected = meta.appliedId && /^[a-zA-Z0-9_-]+$/.test(meta.appliedId)
      ? readJson(path.join(profileDir, 'configLibrary', meta.appliedId + '.json'), {}) : {};
    if (UUID.test(selected.deploymentOrganizationUuid || ''))
      identity.organizationUuid = selected.deploymentOrganizationUuid;
    atomicJson(file, identity);
  }
  if (!device) {
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(deviceFile, Buffer.from(identity.accountUuid).toString('base64'), { mode: 0o600, flag: 'wx' });
  }
  return identity;
}
module.exports = { atomicJson, readJson, ensureLibraryIdentity };
