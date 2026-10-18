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
          const data = readJson(file, {});
          let model = aliases.get(data.model) || data.model;
          const selected = models.find(m => m.id === model);
          // Only Code needs the native opt-in suffix; Cowork uses exact limits.
          if (folder === 'claude-code-sessions' && selected && require('./model-limits.cjs').supports1m(selected)) model = selected.id + '[1m]';
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
// Preserve exact old route preferences when accounts collapse into one model.
// Conflicting speed defaults revert to Standard instead of extending paid consent.
function migrateModelPreferences(dir, models) {
 const changed=[];
 for(const name of ['speed-preferences.json','workflow-preferences.json']){
  const file=path.join(dir,name),data=readJson(file,null);if(!data)continue;
  const before=JSON.stringify(data),speed=name.startsWith('speed');
  const buckets=[data.models,...(speed?Object.values(data.chats||{}):[])].filter(Boolean);
  for(const bucket of buckets)for(const model of models){
   if(Object.hasOwn(bucket,model.id))continue;
   const values=(model.aliases||[]).filter(id=>Object.hasOwn(bucket,id)).map(id=>bucket[id]);
   if(values.length)bucket[model.id]=speed&&new Set(values.map(v=>JSON.stringify(v))).size>1?{mode:'standard'}:values[0];
  }
  if(!speed)for(const value of [...Object.values(data.models||{}),...Object.values(data.chats||{})]){
   const model=models.find(m=>m.aliases?.includes(value.model));if(model)value.model=model.id;
  }
  if(JSON.stringify(data)===before)continue;
  const backup=path.join(dir,'model-selection-backups',name);fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});
  if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
  atomicJson(file,data);changed.push(name);
 }
 return changed;
}
module.exports = { migrateSelections, migrateModelPreferences };
