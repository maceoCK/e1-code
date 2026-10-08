const fs=require('node:fs'),path=require('node:path');
const file='assets/v1/cc924f832-BZLL41oT.js',tabsFile='assets/v1/cfe7c4b3b-GwJAekXp.js',browserFile='assets/v1/cf580efe9-BngeleLw.js',anchorFile='assets/v1/c9c84d68b-DiNaGiyl.js';
function once(source,from,to){if(source.split(from).length!==2)throw Error('Mixed tab adapter needs review: '+from.slice(0,100));return source.replace(from,to);}
function patch(source){
  source=once(source,'Se=y(()=>{let e=new Map(xe.map(', 'e1Tabs=useE1MixedTabs(G,f,xe,B,C),Se=y(()=>{let e=new Map(xe.map(');
  source=once(source,'(e,r,i,a,o)=>d(ag,{tile:e,isTopLeft:a,dragHandle:o,renderChatTile:n,hiddenTileIds:B,','(e,r,i,a,o)=>d(E1MixedTabFrame,{model:e1Tabs,tile:e,children:d(ag,{tile:e,isTopLeft:a,dragHandle:e.id==="chat"?o:null,renderChatTile:n,hiddenTileIds:e1Tabs.hiddenIds,');
  source=once(source,'overlayShiftVars:je}),[n,B,t,V,j,ee,L,J,be,Oe,je]','overlayShiftVars:je})}),[n,e1Tabs,t,V,j,ee,L,J,be,Oe,je]');
  source=once(source,'tiles:xe,layout:ke,layoutKey:D,config:De,onLayoutChange:O,','tiles:xe,layout:e1Tabs.layout,layoutKey:D,config:De,onLayoutChange:e1Tabs.onLayoutChange,');
  source=once(source,'instantUnmount:a,hiddenTileIds:B,overlayTile:X.overlayTile,renderTile:Me','instantUnmount:a,hiddenTileIds:e1Tabs.hiddenIds,overlayTile:X.overlayTile,renderTile:Me');
  source=once(source,'value:i!==void 0,children:r(t,n)','value:i?.has("chat")===!0,children:r(t,n)');
  return 'import {useMixedTabs as useE1MixedTabs,MixedTabFrame as E1MixedTabFrame} from "./e1-mixed-tabs.js";\n'+source;
}
function patchTabs(source){return 'import {useMixedNativeTabs} from "./e1-mixed-tab-context.js";\n'+once(source,'export{H as t};','function E1NativeTabAdapter(props){const mixed=useMixedNativeTabs(props);return mixed?null:s(H,props)}export{E1NativeTabAdapter as t};');}
function patchBrowser(source){return 'import {useMixedPaneHidden as e1UseMixedHidden} from "./e1-mixed-tab-context.js";\n'+once(source,'gt=m,yt=Vt(', 'e1MixedHidden=e1UseMixedHidden(),gt=m&&!e1MixedHidden,yt=Vt(');}
function patchAnchor(source){return 'import {useMixedPreviewVisibility} from "./e1-mixed-tab-context.js";\n'+once(source,'O=e(),k=l();n(()=>{','O=e(),k=l();useMixedPreviewVisibility(c,O,k,a?.hidePreview);n(()=>{');}
module.exports={file,tabsFile,browserFile,anchorFile,patch,patchTabs,patchBrowser,patchAnchor,install(original,target){
  // Title protection and the mixed tab layout share this captured module.
  fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(target,file),'utf8')));
  fs.writeFileSync(path.join(target,tabsFile),patchTabs(fs.readFileSync(path.join(original,tabsFile),'utf8')));
  fs.writeFileSync(path.join(target,browserFile),patchBrowser(fs.readFileSync(path.join(target,browserFile),'utf8')));
  fs.writeFileSync(path.join(target,anchorFile),patchAnchor(fs.readFileSync(path.join(original,anchorFile),'utf8')));
}};
