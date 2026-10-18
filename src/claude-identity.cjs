// Console status omits identity fields. Read only display metadata from the
// selected official profile; never use a different profile's cached identity.
const fs = require('node:fs'), path = require('node:path');
function readObject(file) {
  try { if (fs.statSync(file).size > 1024 * 1024) return null; const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
}
function text(value) { return typeof value === 'string' && value.trim() && !/[\x00-\x1f\x7f]/.test(value) ? value.trim().slice(0, 300) : null; }
function consoleIdentity(profileDir) {
  if (!profileDir) return null;
  let profile = 'default';
  try { profile = fs.readFileSync(path.join(profileDir, 'active_config'), 'utf8').trim() || profile; } catch {}
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(profile) || profile.length > 128) return null;
  const config = readObject(path.join(profileDir, 'configs', profile + '.json'));
  if (config?.authentication?.type !== 'user_oauth' || !text(config.organization_id)) return null;
  const configuredPath = config.authentication.credentials_path;
  const credentialsPath = typeof configuredPath === 'string' && configuredPath.trim()
    ? path.resolve(profileDir, configuredPath) : path.join(profileDir, 'credentials', profile + '.json');
  const credentials = readObject(credentialsPath);
  if (!credentials || credentials.organization_uuid !== config.organization_id ||
      (config.workspace_id && credentials.workspace_id !== config.workspace_id)) return null;
  const email = text(credentials.account_email);
  return { email: email?.includes('@') ? email : null, orgId: text(config.organization_id),
    orgName: text(credentials.organization_name), workspaceId: text(config.workspace_id), workspaceName: text(credentials.workspace_name) };
}
module.exports = { consoleIdentity };
