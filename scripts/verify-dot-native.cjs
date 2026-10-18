const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {capture,shared,sharedSource,initial,initialSource}=require('./patch-dot-native.cjs');
const bundle=path.join(process.env.HOME,'Applications/E1 Code.app/Contents');
const root=path.join(bundle,'Resources/ion-dist/e1-native-dot');
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
const keychainHelperSha256=hash(fs.readFileSync(path.join(bundle,'Helpers/E1 Keychain Helper.app/Contents/MacOS/E1 Keychain Helper')));
if(keychainHelperSha256!=='f94fffc4c5c5a52961d3aa0a7d28e7003a17818beb97d5c8394983da60a51aac')mismatches.push('Keychain helper identity changed');
const result={checkedAt:new Date().toISOString(),bundle:version,originalBuild:13536,unchangedAssets,additiveExportsVerified:mismatches.length===0,keychainHelperSha256,mismatches};
fs.writeFileSync(path.resolve(__dirname,'../evidence/dot-native-installed-provenance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(mismatches.length)process.exitCode=1;
