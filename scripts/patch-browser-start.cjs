const fs=require('node:fs'),path=require('node:path');
const file='assets/v1/cf580efe9-BngeleLw.js';
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('Browser start adapter needs review: '+from.slice(0,90));return source.replace(from,to);}
function patch(source){
  source=replaceOnce(source,'var oi=d(function({configs:t,configsLoaded:n,cwd:r,setupCardCwd:i,sessionId:o,serverId:s,onRun:l,onSetup:u})','var oi=d(function({configs:t,configsLoaded:n,cwd:r,setupCardCwd:i,sessionId:o,serverId:s,activeTabId:e1ActiveTabId,onRun:l,onSetup:u})');
  const navigate='onNavigate:s?async url=>{const tab=e1ActiveTabId??(r?await _?.openPreviewTab?.(s,r):void 0);await _?.navigatePreview?.(s,url,tab)}:void 0,';
  source=replaceOnce(source,'a(cr,{onSetUp:E??u,labels:x,detectionActive:O','a(E1BrowserStart,{'+navigate+'onSetUp:E??u,detectionActive:O');
  source=replaceOnce(source,'a(cr,{onSetUp:u,labels:x})','a(E1BrowserStart,{'+navigate+'onSetUp:u})');
  source=replaceOnce(source,'a(ii,{servers:b,onRun:A,onStop:j,onOpen:s?M:void 0,pendingId:w,labels:S})','a(E1BrowserStart,{'+navigate+'children:a(ii,{servers:b,onRun:A,onStop:j,onOpen:s?M:void 0,pendingId:w,labels:S})})');
  source=replaceOnce(source,'a(oi,{configs:Ya,configsLoaded:Za,cwd:Dn,setupCardCwd:$a,sessionId:F,serverId:o,onRun:no','a(oi,{configs:Ya,configsLoaded:Za,cwd:Dn,setupCardCwd:$a,sessionId:F,serverId:o,activeTabId:U,onRun:no');
  // These are the recovered address bars' existing URL subscriptions, not DOM observers.
  source=replaceOnce(source,'e===n&&x(t)','e===n&&(x(t),e1RecordBrowserVisit(t))');
  source=replaceOnce(source,'e===n&&E(t)','e===n&&(E(t),e1RecordBrowserVisit(t))');
  return 'import {BrowserStart as E1BrowserStart,recordBrowserVisit as e1RecordBrowserVisit} from "./e1-browser-start.js";\n'+source;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
