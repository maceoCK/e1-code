const fs = require('node:fs'), path = require('node:path');
const file = 'assets/v1/c11959232-BG0rcJu0.js';
const needle = '$u(e,{onTogglePane:ue';
// Register the active native pane's actions, including its availability gates.
// The recovered renderer still owns sessions, terminal tabs and browser tabs.
const registration = `e1RegisterTabs(e,{
 chat:s,
 terminal:ae?()=>{if(p){const id=ss.getState().addTab(n.id);T(n.id,id)}d("terminal")}:null,
 browser:te?()=>{d("preview");if(v)we()}:null,
 files:re?()=>{d("file");M("filter")}:null,
 changes:N?()=>d("diff"):null
}),`;
const helper = `
function e1RegisterTabs(enabled,actions){
 t(()=>{
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
 return source.replace(needle,registration+needle)+helper;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
