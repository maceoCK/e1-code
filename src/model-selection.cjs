const fs = require('node:fs'), path = require('node:path');
const { readJson, atomicJson } = require('./library-identity.cjs');

// Migrate only the selected-model field in native chat metadata, before the
// native engine loads it. Transcripts, session IDs and account ownership stay put.
function migrateSelections(profile, models) {
  const aliases = new Map(models.flatMap(model => (model.aliases || []).map(alias => [alias, model.id])));
  const changed = [];
  for (const folder of ['claude-code-sessions', 'local-agent-mode-sessions']) {
    const visit = (dir, depth) => {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory() && depth < 2) visit(file, depth + 1);
        else if (entry.isFile() && /^local_.*\.json$/.test(entry.name)) {
          const data = readJson(file, {}), model = aliases.get(data.model);
          if (!model || model === data.model) continue;
          const backup = path.join(profile, 'model-selection-backups', path.relative(profile, file));
          fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
          if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
          atomicJson(file, { ...data, model }); changed.push(path.relative(profile, file));
        }
      }
    };
    visit(path.join(profile, folder), 0);
  }
  return changed;
}
module.exports = { migrateSelections };
