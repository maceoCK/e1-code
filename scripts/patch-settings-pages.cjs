const fs=require('node:fs'),path=require('node:path');
// Registers the E1 panes in the native Settings UI of Claude Desktop 3.1623.0.
// Anchors (old 2.19675.0 equivalents in port-notes/C-settings-html-build.md):
//  shared-156: route parser section list (rg), feeds `/settings/<id>` parsing.
//  shared-46:  section -> nav group map (mm) and the nav item builder (zm), whose
//              list variable is `e` and whose General item uses icon `Op`.
//  cc011544b:  lazy pane map (Vt) built with loader Q(id, load, pick).
const sections=[{id:'e1-accounts',name:'Accounts',component:'Accounts'},{id:'e1-models',name:'Models & connections',component:'Models'},{id:'e1-usage',name:'Usage & fallback',component:'Usage'}];
const files=['assets/v1/shared-156-DPjCa3x4.js','assets/v1/shared-46-Bz932s42.js','assets/v1/cc011544b-DIVBr1d7.js'];
const anchors={
 sectionIds:'var rg=["general",',
 sectionGroups:'var mm={"customize-skills":',
 navList:'let e=[{id:"general",href:"/settings/general",',
 navIcon:'icon:Op,testId:"general-settings"}];',
 navItems:'})}if(c){let t=J0($,40)?K0($,40,o(Q,{defaultMessage:"Privacy",id:"cXBJ7U9LBe"})):$[40];e.push({id:"data-privacy-controls"',
 loader:'function Q(e,t,n){let{Component:r,handle:i}=',
 pageMap:'var Vt={general:',
};
function count(source,needle){return source.split(needle).length-1;}
function replace(source,needle,value){if(count(source,needle)!==1)throw Error('Native Settings changed; review integration: '+needle);return source.replace(needle,()=>value);}
function requireOne(source,needle){if(count(source,needle)!==1)throw Error('Native Settings changed; review integration: '+needle);}
function patch(file,source){
 if(file===files[0])return replace(source,anchors.sectionIds,'var rg=['+sections.map(s=>JSON.stringify(s.id)).join(',')+',"general",');
 if(file===files[1]){
  // The pushed items must land in the same list as General and reuse its icon.
  requireOne(source,anchors.navList);requireOne(source,anchors.navIcon);
  // Each needle is consumed by its replacement, so patching twice fails loudly.
  source=replace(source,anchors.sectionGroups,'var mm={'+sections.map(s=>JSON.stringify(s.id)+':"account"').join(',')+',"customize-skills":');
  const items=sections.map(s=>JSON.stringify({id:s.id,href:'/settings/'+s.id,label:s.name,name:s.name,testId:'settings-nav-'+s.id}).replace(/}$/,',icon:Op}')).join(',');
  return replace(source,anchors.navItems,'})}window.e1Settings&&e.push('+items+');'+anchors.navItems.slice(3));
 }
 if(file===files[2]){
  requireOne(source,anchors.loader);
  return replace(source,anchors.pageMap,'var Vt={'+sections.map(s=>JSON.stringify(s.id)+':Q('+JSON.stringify(s.id)+',()=>import("./e1-settings-pages.js"),module=>module.'+s.component+')').join(',')+',general:');
 }
 throw Error('Unexpected native Settings file.');
}
// e1-settings-pages.js is an ES module that imports React straight from the
// captured vendor-frame chunk by its minified export names. Those names change
// with every Claude build, so check them against the capture before shipping.
const pagesSource=path.join(__dirname,'../src/native-settings-pages.js');
const reactBindings={h:'jsx',useEffect:'useEffect',useRef:'useRef',useState:'useState'};
function verifyPagesImports(ionRoot,source=fs.readFileSync(pagesSource,'utf8')){
 const imported=source.match(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(vendor-frame-[\w-]+\.js)';/m);
 if(!imported)throw Error('e1-settings-pages.js must import React from the captured vendor-frame chunk.');
 const vendorPath=path.join(ionRoot,'assets/v1',imported[2]);
 if(!fs.existsSync(vendorPath))throw Error('e1-settings-pages.js imports a renderer chunk missing from the capture: '+imported[2]);
 const vendor=fs.readFileSync(vendorPath,'utf8'),list=vendor.match(/export\{([^}]*)\};?\s*$/);
 if(!list)throw Error('Cannot read exports of '+imported[2]);
 const exported=new Map(list[1].split(',').map(part=>{const [local,name=local]=part.trim().split(/\s+as\s+/);return [name,local];}));
 for(const binding of imported[1].split(',')){
  const [name,alias=name]=binding.trim().split(/\s+as\s+/),expected=reactBindings[alias],local=exported.get(name);
  if(!expected)throw Error('Unexpected React binding in e1-settings-pages.js: '+alias);
  const escaped=String(local).replace(/\$/g,'\\$');
  if(!local||!new RegExp('[,;{ ]'+escaped+'=[\\w$]+\\.'+expected+'[,;]').test(vendor))
   throw Error('e1-settings-pages.js imports '+name+' as '+alias+', but '+imported[2]+' does not export React '+expected+' under that name.');
 }
 return imported[2];
}
module.exports={files,sections,anchors,patch,verifyPagesImports,install(original,target){verifyPagesImports(original);for(const file of files)fs.writeFileSync(path.join(target,file),patch(file,fs.readFileSync(path.join(original,file),'utf8')));}};
