const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const directory = path.join(os.homedir(), 'Library/Application Support/Aster/signing');
const configFile = path.join(directory, 'identity.json');
function configuration() {
  if (!fs.existsSync(configFile)) return { identity: '-', description: 'local ad-hoc; deep strict verification passed', args: [] };
  const value = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!/^[A-F0-9]{40}$/.test(value.sha1) || !path.isAbsolute(value.keychain)) throw Error('Invalid local signing identity configuration.');
  // Once configured, never silently revert to ad-hoc signing: that would change
  // the app identity and restart the Keychain approval cycle.
  return { identity: value.sha1, description: 'persistent local certificate; deep strict verification passed', args: ['--keychain', value.keychain] };
}
module.exports = { directory, configFile, configuration };
