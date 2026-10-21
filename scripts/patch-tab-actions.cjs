const fs = require('node:fs'), path = require('node:path');
// Captured client 3.1623.0: the session-pane hook (function Rp) is React-compiled.
// Its final statement registers the keyboard actions via Cp(paneEnabled, memo(...)).
const file = 'assets/v1/c11959232-D0R2R6wT.js';
const needle = 'Cp(n,J5($,169,Fe,J,Ue,ve,He,pe,ze,s,yt,bt,xt)?K5($,169,Fe,J,Ue,ve,He,pe,ze,s,yt,bt,xt,{onTogglePane:ve,';
// Register the active native pane's actions, including its availability gates.
// The recovered renderer still owns sessions, terminal tabs and browser tabs.
// Rp locals: n paneEnabled, i owner, s onNewSession, p owner is "starting",
// U terminal enabled, _ terminal tile open, P requestTabFocus, h setSidePane,
// V preview enabled, S preview shown, Ue onNewPreviewTab, oe files enabled,
// se focusFilesTreeFilter, W diff enabled. gc is the terminal tab store.
// A starting session has no stable terminal-tab scope yet (the native terminal
// shortcut only toggles the pane then), so only open the pane in that state.
const registration = `e1RegisterTabs(n,{
 chat:s,
 terminal:U?()=>{if(_&&!p){const id=gc.getState().addTab(i.id);P(i.id,id)}h("terminal")}:null,
 browser:V?()=>{h("preview");if(S)Ue()}:null,
 files:oe?()=>{h("file");se("filter")}:null,
 changes:W?()=>h("diff"):null
});`;
// d is this module's useEffect import.
const helper = `
function e1RegisterTabs(enabled,actions){
 d(()=>{
  if(!enabled)return;
  window.e1NativeTabActions=actions;
  window.dispatchEvent(new Event('e1:tab-actions'));
  return()=>{if(window.e1NativeTabActions===actions)delete window.e1NativeTabActions;};
 },[enabled,actions.chat,actions.terminal,actions.browser,actions.files,actions.changes]);
}
`;
function patch(source) {
 if(source.includes('function e1RegisterTabs'))throw Error('Tab adapter already installed.');
 if(source.split(needle).length!==2)throw Error('Native tab actions changed; review adapter.');
 // Function replacement: the compiled needle contains "$" memo-cache references.
 return source.replace(needle,()=>registration+needle)+helper;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
