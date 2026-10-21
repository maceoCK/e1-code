const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {build,capture,shared,sharedSource,initial,initialSource,components}=require('./patch-dot-native.cjs');
// Verifies the installed app by default. E1_DOT_ION verifies another ion-dist
// (for example a temporary install()) and skips the installed-app-only checks.
const bundle=path.join(process.env.HOME,'Applications/E1 Code.app/Contents');
const installed=!process.env.E1_DOT_ION;
const root=path.join(installed?path.join(bundle,'Resources/ion-dist'):path.resolve(process.env.E1_DOT_ION),'e1-native-dot');
const versions=fs.readdirSync(root).filter(name=>/^v-[a-f0-9]{12}$/.test(name));
if(versions.length!==1)throw Error('Expected one installed native Dot version.');
const version=versions[0],dest=path.join(root,version),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
let unchangedAssets=0;const mismatches=[];
function verify(directory,prefix=''){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const relative=path.join(prefix,entry.name),source=path.join(directory,entry.name);
  if(entry.isDirectory()){verify(source,relative);continue;}
  if(relative===shared||relative===initial)continue;
  const target=path.join(dest,'assets',relative);
  if(!fs.existsSync(target)||hash(fs.readFileSync(source))!==hash(fs.readFileSync(target)))mismatches.push(relative);else unchangedAssets++;
 }
}
verify(path.join(capture,'assets'));
for(const [name,expected] of [[shared,sharedSource()],[initial,initialSource()]])if(fs.readFileSync(path.join(dest,'assets',name),'utf8')!==expected)mismatches.push(name);
let provenance=null;try{provenance=JSON.parse(fs.readFileSync(path.join(dest,'provenance.json'),'utf8'));}catch{}
if(provenance?.build!==build)mismatches.push('Provenance build is '+provenance?.build+', expected '+build);
if(JSON.stringify(provenance?.components)!==JSON.stringify(components))mismatches.push('Provenance components differ from the adapter');
let keychainHelperSha256=null;
if(installed){keychainHelperSha256=hash(fs.readFileSync(path.join(bundle,'Helpers/E1 Keychain Helper.app/Contents/MacOS/E1 Keychain Helper')));if(keychainHelperSha256!=='f94fffc4c5c5a52961d3aa0a7d28e7003a17818beb97d5c8394983da60a51aac')mismatches.push('Keychain helper identity changed');}
const result={checkedAt:new Date().toISOString(),root,bundle:version,originalBuild:build,unchangedAssets,additiveExportsVerified:mismatches.length===0,keychainHelperSha256,mismatches};
const evidence=process.env.E1_DOT_EVIDENCE?path.resolve(process.env.E1_DOT_EVIDENCE):path.resolve(__dirname,'../evidence');fs.mkdirSync(evidence,{recursive:true});
fs.writeFileSync(path.join(evidence,'dot-native-installed-provenance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(mismatches.length)process.exitCode=1;
