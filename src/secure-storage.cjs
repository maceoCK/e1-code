// The helper is copied unchanged into each application build. Its binary hash
// is sealed into the outer app; it also verifies the live parent's signer.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
function createStorage(manifest, launch = spawnSync) {
  if (!manifest || !path.isAbsolute(manifest.executable) || !/^[a-f0-9]{64}$/.test(manifest.sha256))
    throw Error('Invalid Keychain helper manifest. Rebuild E1 Code.');
  const check = () => {
    if (crypto.createHash('sha256').update(fs.readFileSync(manifest.executable)).digest('hex') !== manifest.sha256)
      throw Error('The Keychain helper changed. Rebuild E1 Code before accessing saved credentials.');
  };
  const call = (operation, value) => {
    check();
    const result = launch(manifest.executable, [], { input: JSON.stringify({ operation, data: value.toString('base64') }),
      encoding: 'utf8', timeout: 120000, maxBuffer: 48 * 1024 * 1024, windowsHide: true,
      env: { PATH: '/usr/bin:/bin', HOME: require('node:os').homedir(), LANG: 'en_US.UTF-8' } });
    // Never include captured stdout (which may contain decrypted credentials) in errors.
    if (result.error || result.status !== 0)
      throw Error('E1 Keychain Helper could not unlock saved credentials. If macOS prompts, choose Always Allow for E1 Code Safe Storage.');
    let reply;
    try { reply = JSON.parse(result.stdout); } catch { throw Error('Invalid response from the Keychain helper.'); }
    if (typeof reply.data !== 'string') throw Error('Invalid response from the Keychain helper.');
    return Buffer.from(reply.data, 'base64');
  };
  return Object.freeze({
    isEncryptionAvailable() { try { check(); return true; } catch { return false; } },
    encryptString(value) { if (typeof value !== 'string') throw TypeError('Expected a string.'); return call('encrypt', Buffer.from(value, 'utf8')); },
    decryptString(value) { if (!Buffer.isBuffer(value)) throw TypeError('Expected an encrypted Buffer.'); return call('decrypt', value).toString('utf8'); },
    getSelectedStorageBackend() { return 'keychain'; },

  });
}
function install() {
  if (process.platform !== 'darwin') return require('electron');
  const Module = require('node:module');
  const electron = require('electron');
  const manifest = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'e1-keychain-helper.json'), 'utf8'));
  const descriptors = Object.getOwnPropertyDescriptors(electron);
  // Do not evaluate Electron's original safeStorage getter: some versions
  // eagerly access Keychain when the native object is constructed at app-ready.
  if (manifest.relativeExecutable !== '../Helpers/E1 Keychain Helper.app/Contents/MacOS/E1 Keychain Helper')
    throw Error('Invalid bundled Keychain helper path.');
  descriptors.safeStorage = { value: createStorage({ ...manifest, executable: path.resolve(process.resourcesPath, manifest.relativeExecutable) }), enumerable: true };
  const wrapped = Object.defineProperties({}, descriptors);
  if (!wrapped.safeStorage.isEncryptionAvailable()) throw Error('Keychain helper integrity check failed.');
  const browserName = require(path.join(process.resourcesPath, 'e1-browser-storage.node')).prepare(path.resolve(process.resourcesPath, manifest.relativeExecutable));
  if (!/^E1 Browser [a-f0-9]{40}$/.test(browserName)) throw Error('Invalid browser storage identity.');
  const app = wrapped.app, setName = app.setName.bind(app);
  // Electron snapshots this name into its native cookie encryption backend
  // before ready. Keep the visible product name once initialization completes.
  setName(browserName);
  app.setName = name => { if (app.isReady()) setName(name); };
  app.once('ready', () => { setName('E1 Code'); app.setName = setName; });
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron' || request === 'electron/main') return wrapped;
    return originalLoad.call(this, request, parent, isMain);
  };
  return wrapped;
}
module.exports = { createStorage, install };
