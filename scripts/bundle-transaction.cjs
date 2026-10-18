const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');

// Never package directly over the app Finder launches. All archive, metadata,
// renderer and signing work happens in a candidate on the same volume.
// Callers may use os.tmpdir(); the default remains a sibling for existing builds.
function beginBundle(installed, original, copy=(from,to)=>cp.execFileSync('/bin/cp',['-cR',from,to]), temporaryRoot=path.dirname(installed)) {
  fs.mkdirSync(path.dirname(installed),{recursive:true});
  const lock=installed+'.build-lock';
  try { fs.mkdirSync(lock); } catch(e) { if(e.code==='EEXIST')throw Error('Another E1 build owns '+lock);throw e; }
  let directory,finished=false;
  try {
    if(fs.statSync(temporaryRoot).dev!==fs.statSync(path.dirname(installed)).dev)throw Error('Bundle staging must be on the installed app volume');
    directory=fs.mkdtempSync(path.join(temporaryRoot,'.e1-package-'));
    const candidate=path.join(directory,path.basename(installed));
    copy(fs.existsSync(installed)?installed:original,candidate);
    return {
      bundle:candidate,
      commit(verify) {
        if(finished)throw Error('Bundle transaction already finished');
        if(typeof verify!=='function')throw Error('Verification is required before publishing');
        verify(candidate);
        const backup=path.join(directory,'previous.bundle');
        const existed=fs.existsSync(installed);
        if(existed)fs.renameSync(installed,backup);
        try { fs.renameSync(candidate,installed); }
        catch(e) { if(existed)fs.renameSync(backup,installed);throw e; }
        finished=true;fs.rmdirSync(lock);
        if(!existed)fs.rmdirSync(directory);
        return existed?backup:null;
      },
      abort() { if(finished)return;fs.rmSync(directory,{recursive:true,force:true});fs.rmdirSync(lock);finished=true; }
    };
  } catch(e) { if(directory)fs.rmSync(directory,{recursive:true,force:true});fs.rmdirSync(lock);throw e; }
}
module.exports={beginBundle};
