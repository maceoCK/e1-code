const fs=require('node:fs'),path=require('node:path');
const file='assets/v1/shared-16-Coak3mnx.js';
const replacements=[
  ['rE=R(({className:e,children:t,...n},r)=>{let{size:i,digitsActive:a}=xT("Popup");return O(Z.Popup,{',
   'rE=R(({className:e,children:t,...n},r)=>{let{size:i,digitsActive:a,catalog:catalog}=xT("Popup");return O(E1ModelPopup,{Menu:Z,models:catalog.models,'],
  ['O(Z.Group,{children:w.map(e=>O(WT,{model:e,behavior:y,showDescription:T,digit:E.get(e.id)},e.id))})',
   'isE1ModelCatalog(b)?O(E1ModelList,{Menu:Z,models:b,selected:t.model,renderModel:(e,p)=>O(WT,{model:e,behavior:y,showDescription:!1,presentation:p},e.id)}):O(Z.Group,{children:w.map(e=>O(WT,{model:e,behavior:y,showDescription:T,digit:E.get(e.id)},e.id))})'],
  ['S=b.filter(e=>e.section==="overflow")','S=isE1ModelCatalog(b)?[]:b.filter(e=>e.section==="overflow")'],
];
function patch(source){
  for(const [needle,value]of replacements){if(source.split(needle).length!==2)throw Error('Native model browser changed; review the picker adapter before building.');source=source.replace(needle,value);}
  return 'import{ModelPopup as E1ModelPopup,ModelList as E1ModelList,isE1Catalog as isE1ModelCatalog}from"./e1-model-browser.js";'+source;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
