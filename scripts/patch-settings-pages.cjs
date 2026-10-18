const fs=require('node:fs'),path=require('node:path');
const sections=[{id:'e1-accounts',name:'Accounts',component:'Accounts'},{id:'e1-models',name:'Models & connections',component:'Models'},{id:'e1-usage',name:'Usage & fallback',component:'Usage'}];
const files=['assets/v1/shared-6-D6JLSylx.js','assets/v1/shared-25-OW0mzOGf.js','assets/v1/cc011544b-BXgF5vJq.js'];
function replace(source,needle,value){if(source.split(needle).length!==2)throw Error('Native Settings changed; review integration: '+needle);return source.replace(needle,value);}
function patch(file,source){
 if(file===files[0])return replace(source,'var Ug=["general",','var Ug=['+sections.map(s=>JSON.stringify(s.id)).join(',')+',"general",');
 if(file===files[1]){source=replace(source,'var eS={','var eS={'+sections.map(s=>JSON.stringify(s.id)+':"account"').join(',')+',');return replace(source,'}];i&&t.push({id:"data-privacy-controls"','}];window.e1Settings&&t.push('+sections.map(s=>JSON.stringify({id:s.id,href:'/settings/'+s.id,label:s.name,name:s.name,testId:'settings-nav-'+s.id}).replace(/}$/,',icon:Mb}')).join(',')+');i&&t.push({id:"data-privacy-controls"');}
 if(file===files[2])return replace(source,'var it={general:','var it={'+sections.map(s=>JSON.stringify(s.id)+':Q('+JSON.stringify(s.id)+',()=>import("./e1-settings-pages.js"),module=>module.'+s.component+')').join(',')+',general:');
 throw Error('Unexpected native Settings file.');
}
module.exports={files,sections,patch,install(original,target){for(const file of files)fs.writeFileSync(path.join(target,file),patch(file,fs.readFileSync(path.join(original,file),'utf8')));}};
