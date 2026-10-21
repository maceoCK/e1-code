const fs=require('node:fs'),path=require('node:path');
// Captured client 3.1623.0. The tile workbench (h_e, was ig) and tile renderer
// (T_e, was ag) moved to cc43287c9; the title guard moved separately to c9543da06,
// so this layout file is no longer shared with patch-title-renderer.cjs.
const file='assets/v1/cc43287c9-BDHDExZ7.js',tabsFile='assets/v1/cfe7c4b3b-DRQPHlyF.js',browserFile='assets/v1/cf580efe9-BEV_8-aB.js',anchorFile='assets/v1/c9c84d68b-DbUgbAKJ.js';
// Function replacement: compiled needles contain "$" memo-cache references.
function once(source,from,to){if(source.split(from).length!==2)throw Error('Mixed tab adapter needs review: '+from.slice(0,100));return source.replace(from,()=>to);}
function patch(source){
  // h_e locals: ce per-session store, l session id, Be tiles, K solo-hidden ids, O solo tile.
  source=once(source,'let Be=ze,He=J1($,91,_e)','let Be=ze,e1Tabs=useE1MixedTabs(ce,l,Be,K,O),He=J1($,91,_e)');
  // renderTile memo: e1Tabs replaces K (hidden ids) as a dependency, same slot.
  source=once(source,'J5($,146,Pe,Ne,re,K,H,pt,bt,a,n,Ae,I,o,te)?K5($,146,Pe,Ne,re,K,H,pt,bt,a,n,Ae,I,o,te,(e,t,r,i,s)=>p(T_e,{tile:e,isTopLeft:i,dragHandle:s,renderChatTile:n,hiddenTileIds:K,',
    'J5($,146,Pe,Ne,re,e1Tabs,H,pt,bt,a,n,Ae,I,o,te)?K5($,146,Pe,Ne,re,e1Tabs,H,pt,bt,a,n,Ae,I,o,te,(e,t,r,i,s)=>p(E1MixedTabFrame,{model:e1Tabs,tile:e,children:p(T_e,{tile:e,isTopLeft:i,dragHandle:e.id==="chat"?s:null,renderChatTile:n,hiddenTileIds:e1Tabs.hiddenIds,');
  source=once(source,'overlayShiftVars:bt})):$[159]','overlayShiftVars:bt})})):$[159]');
  // Tile host: layout, resize and hidden ids come from the mixed tab group. Each
  // replaced value also replaces its own memo dependency (P, K, mt).
  source=once(source,'Pt=J5($,188,X,P,he,K,r,N,Tt,Et)||J5($,196,ft.overlayTile,xt,St,Be,it,mt)?I5($,196,Z5($,188,p(Iu,{tiles:Be,layout:mt,layoutKey:N,config:it,onLayoutChange:P,onTileTearOff:he,onDraggingChange:X,onTileInteract:Tt,onTileUserInput:Et,tileStyle:St,instantUnmount:r,hiddenTileIds:K,overlayTile:ft.overlayTile,renderTile:xt}),X,P,he,K,r,N,Tt,Et),ft.overlayTile,xt,St,Be,it,mt):$[202]',
    'Pt=J5($,188,X,e1Tabs.onLayoutChange,he,e1Tabs.hiddenIds,r,N,Tt,Et)||J5($,196,ft.overlayTile,xt,St,Be,it,e1Tabs.layout)?I5($,196,Z5($,188,p(Iu,{tiles:Be,layout:e1Tabs.layout,layoutKey:N,config:it,onLayoutChange:e1Tabs.onLayoutChange,onTileTearOff:he,onDraggingChange:X,onTileInteract:Tt,onTileUserInput:Et,tileStyle:St,instantUnmount:r,hiddenTileIds:e1Tabs.hiddenIds,overlayTile:ft.overlayTile,renderTile:xt}),X,e1Tabs.onLayoutChange,he,e1Tabs.hiddenIds,r,N,Tt,Et),ft.overlayTile,xt,St,Be,it,e1Tabs.layout):$[202]');
  // Chat tile: hidden ids are now always defined; report whether chat itself is hidden.
  source=once(source,'o=a!==void 0,s=J3($,13,r,n,i)?K3($,13,r,n,i,i(n,r)):$[16],c=J2($,17,o,s)?K2($,17,o,s,p(qn.Provider,{value:o,children:s})):$[19]','o=a?.has("chat")===!0,s=J3($,13,r,n,i)?K3($,13,r,n,i,i(n,r)):$[16],c=J2($,17,o,s)?K2($,17,o,s,p(qn.Provider,{value:o,children:s})):$[19]');
  return 'import {useMixedTabs as useE1MixedTabs,MixedTabFrame as E1MixedTabFrame} from "./e1-mixed-tabs.js";\n'+source;
}
// Re is the native tab bar (exported as t); n is jsx.
function patchTabs(source){return 'import {useMixedNativeTabs} from "./e1-mixed-tab-context.js";\n'+once(source,'export{F as n,Re as t};','function E1NativeTabAdapter(props){const mixed=useMixedNativeTabs(props);return mixed?null:n(Re,props)}export{F as n,E1NativeTabAdapter as t};');}
// Co (browser pane): un is the pane's visibility, f its isVisible prop.
function patchBrowser(source){return 'import {useMixedPaneHidden as e1UseMixedHidden} from "./e1-mixed-tab-context.js";\n'+once(source,'un=f,dn=nn(Ro),','e1MixedHidden=e1UseMixedHidden(),un=f&&!e1MixedHidden,dn=nn(Ro),');}
// S(serverId t, visible a): O useId, k target window, s preview bridge.
function patchAnchor(source){return 'import {useMixedPreviewVisibility} from "./e1-mixed-tab-context.js";\n'+once(source,'O=n(),k=f(),A,j;J5($,3,C,O,E,t,a,k)','O=n(),k=f(),A,j;useMixedPreviewVisibility(t,O,k,s?.hidePreview);J5($,3,C,O,E,t,a,k)');}
module.exports={file,tabsFile,browserFile,anchorFile,patch,patchTabs,patchBrowser,patchAnchor,install(original,target){
  // No earlier adapter writes the layout file now, so read the captured original
  // (the build copies an existing installed bundle, which may hold stale chunks).
  fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));
  fs.writeFileSync(path.join(target,tabsFile),patchTabs(fs.readFileSync(path.join(original,tabsFile),'utf8')));
  // The browser start adapter already rewrote this file from the capture in this build.
  fs.writeFileSync(path.join(target,browserFile),patchBrowser(fs.readFileSync(path.join(target,browserFile),'utf8')));
  fs.writeFileSync(path.join(target,anchorFile),patchAnchor(fs.readFileSync(path.join(original,anchorFile),'utf8')));
}};
