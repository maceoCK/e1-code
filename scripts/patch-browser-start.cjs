const fs=require('node:fs'),path=require('node:path');
// Captured client 3.1623.0. The preview start page (ga, was oi) and its parent
// (Co, was Ki) are React-compiled: rendered elements live in "$" memo slots, so
// replacements that capture new values either drop the memo or extend its check.
const file='assets/v1/cf580efe9-BEV_8-aB.js';
// Function replacement: compiled needles contain "$" memo-cache references.
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('Browser start adapter needs review: '+from.slice(0,90));return source.replace(from,()=>to);}
function patch(source){
  // ga props: i cwd, c serverId; L is the module's preview bridge (openPreviewTab/navigatePreview).
  // Build the navigate callback once at the top level: the empty-state branch below
  // redeclares i/e/t/n with block-scoped lets.
  source=replaceOnce(source,'var ga=f(function(e){let $=J9(99),{configs:t,configsLoaded:n,cwd:i,setupCardCwd:a,sessionId:o,sshHost:s,serverId:c,onRun:l,onSetup:u}=e,',
    'var ga=f(function(e){let $=J9(99),{configs:t,configsLoaded:n,cwd:i,setupCardCwd:a,sessionId:o,sshHost:s,serverId:c,activeTabId:e1ActiveTabId,onRun:l,onSetup:u}=e,e1Navigate=c?async url=>{const tab=e1ActiveTabId??(i?await L?.openPreviewTab?.(c,i):void 0);await L?.navigatePreview?.(c,url,tab)}:void 0,');
  // Empty states and the server list. Their memo checks do not cover e1Navigate,
  // so the start page element is created on every render (as the uncompiled original did).
  source=replaceOnce(source,'s=J4($,75,B,T,e,i)?K4($,75,B,T,e,i,r(Rr,{onSetUp:e,labels:T,detectionActive:B,detection:i})):$[79]','s=r(E1BrowserStart,{onNavigate:e1Navigate,onSetUp:e,detectionActive:B,detection:i})');
  source=replaceOnce(source,'let e=J2($,83,u,T)?K2($,83,u,T,r(Rr,{onSetUp:u,labels:T})):$[85]','let e=r(E1BrowserStart,{onNavigate:e1Navigate,onSetUp:u})');
  source=replaceOnce(source,'oe=J5($,89,V,H,F,P,y,W)?K5($,89,V,H,F,P,y,W,r(fa,{servers:y,onRun:V,onStop:H,onOpen:W,pendingId:F,labels:P})):$[95]','oe=r(E1BrowserStart,{onNavigate:e1Navigate,children:J5($,89,V,H,F,P,y,W)?K5($,89,V,H,F,P,y,W,r(fa,{servers:y,onRun:V,onStop:H,onOpen:W,pendingId:F,labels:P})):$[95]})');
  // Parent passes the active preview tab (Y). The memo slots are fixed, so also
  // rebuild when the cached ga element was rendered for a different tab.
  source=replaceOnce(source,'m=J4($,797,Tc,pc,Z,B)||J5($,801,Le.status,ir,S,t,H)||J5($,806,te?.remote,yc,Q,hc,_c,lu)?I5($,806,Z5($,801,Z4($,797,!Q&&Z&&!lu&&Le.status!=="loading"&&r(ga,{configs:hc,configsLoaded:_c,cwd:ir,setupCardCwd:yc,sessionId:H,sshHost:B?fe(te?.remote)??"":void 0,serverId:t,onRun:Tc,',
    'm=J4($,797,Tc,pc,Z,B)||J5($,801,Le.status,ir,S,t,H)||J5($,806,te?.remote,yc,Q,hc,_c,lu)||$[812]?.type===ga&&$[812].props.activeTabId!==Y?I5($,806,Z5($,801,Z4($,797,!Q&&Z&&!lu&&Le.status!=="loading"&&r(ga,{configs:hc,configsLoaded:_c,cwd:ir,setupCardCwd:yc,sessionId:H,sshHost:B?fe(te?.remote)??"":void 0,serverId:t,activeTabId:Y,onRun:Tc,');
  // These are the recovered address bars' existing URL subscriptions, not DOM observers:
  // the toolbar address bar (mo) and the pane's own URL tracker (Co).
  source=replaceOnce(source,'e===t&&na(t,n)','e===t&&(na(t,n),e1RecordBrowserVisit(n))');
  source=replaceOnce(source,'e===t&&ms({serverId:t,url:n??null})','e===t&&(ms({serverId:t,url:n??null}),e1RecordBrowserVisit(n))');
  return 'import {BrowserStart as E1BrowserStart,recordBrowserVisit as e1RecordBrowserVisit} from "./e1-browser-start.js";\n'+source;
}
module.exports={file,patch,install(original,target){fs.writeFileSync(path.join(target,file),patch(fs.readFileSync(path.join(original,file),'utf8')));}};
