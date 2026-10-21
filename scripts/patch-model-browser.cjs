const fs=require('node:fs'),path=require('node:path');
// Captured client 3.1623.0 (React-compiler output): ModelSelector lives in
// shared-7. Popup = ZC (was rE), list body = GC (was eE), row = NC (was WT),
// Menu namespace = H (was Z), jsx = h (was O), all models = w (was b),
// state = n (was t). The Popup return is memoized on (rest, ref, size, class,
// digits attr, children) only, so the E1 popup is rendered unmemoized to stay
// in sync with catalog changes.
const file='assets/v1/shared-7-Bv_2m9Lo.js';
const replacements=[
  ['let{size:a,digitsActive:o,fieldTrigger:s}=iC("Popup")',
   'let{size:a,digitsActive:o,fieldTrigger:s,catalog:e1Catalog}=iC("Popup")'],
  ['return J5($,14,i,t,a,l,u,f)?K5($,14,i,t,a,l,u,f,h(H.Popup,{...i,ref:t,"data-cds":"ModelSelector","data-size":a,className:l,...u,children:f})):$[20]}',
   'return h(E1ModelPopup,{Menu:H,models:e1Catalog.models,...i,ref:t,"data-cds":"ModelSelector","data-size":a,className:l,...u,children:f})}'],
  ['J1($,41,R)?(O=h(H.Group,{children:R}),K1($,41,R,O))',
   'J1($,41,R)?(O=isE1ModelCatalog(w)?h(E1ModelList,{Menu:H,models:w,selected:n.model,renderModel:(e1m,e1p)=>h(NC,{model:e1m,behavior:C,showDescription:!1,presentation:e1p},e1m.id)}):h(H.Group,{children:R}),K1($,41,R,O))'],
  ['let e=w.filter(qC),t=w.filter(KC),','let e=w.filter(qC),t=isE1ModelCatalog(w)?[]:w.filter(KC),'],
];
function patch(source){
  for(const [needle,value]of replacements){if(source.split(needle).length!==2)throw Error('Native model browser changed; review the picker adapter before building.');source=source.replace(needle,value);}
  return 'import{ModelPopup as E1ModelPopup,ModelList as E1ModelList,isE1Catalog as isE1ModelCatalog}from"./e1-model-browser.js";'+source;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
