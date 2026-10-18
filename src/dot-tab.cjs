const path=require('node:path');
const {DotService}=require('./dot-service.cjs');
function installDotTab(electron,mainWindow,{openConnections}={}){
 const {app}=electron,preloaded=new WeakSet();let service,native;const owners=new Map();
 const backend=()=>service??=new DotService(require('./subscriptions.cjs').subscriptionsFor(path.join(app.getPath('appData'),'Aster'),null),{transport:require('./dot-transport.cjs').createDotTransport(electron)});
 const open=async()=>{await app.whenReady();const win=mainWindow();if(!win||win.isDestroyed())throw Error('Open the E1 Code main window first.');win.webContents.send('e1:dot:show');win.show();return{open:true};};
 app.on('web-contents-created',(_event,contents)=>{
  const sessions=new Set(),cleanup=()=>{for(const id of sessions){owners.delete(id);native?.close(id);}sessions.clear();};
  contents.once('destroyed',cleanup);contents.on('render-process-gone',cleanup);
  if(!preloaded.has(contents.session)){contents.session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'dot-preload.cjs')});preloaded.add(contents.session);}
  contents.ipc.handle('e1:dot:request',async(event,operation,args={})=>{
   const frame=event.senderFrame,url=frame?.url||'';const nativeFrame=/^app:\/\/localhost\/e1-native-dot\/(?:v-[a-f0-9]{12}\/)?index\.html(?:[?]|$)/.test(url);
   if(!/^app:\/\/localhost\//.test(url)||(frame!==contents.mainFrame&&!nativeFrame))throw Error('Invalid Dot sender.');
   if(operation==='connections'){await openConnections?.();return{};}
   const api=backend();
   try{
   if(operation.startsWith('native-')){
    if(!nativeFrame&&frame!==contents.mainFrame)throw Error('Invalid native Dot sender.');
    native??=new (require('./dot-native-service.cjs').NativeDotService)(api,{diagnostic:entry=>{if(entry.event==='response'&&entry.method==='GET'&&entry.status<400)return;try{require('node:fs').appendFileSync(path.join(app.getPath('logs'),'e1-native-dot.log'),JSON.stringify({time:new Date().toISOString(),...entry})+'\n');}catch{}}});
    const owner=frame.processId+':'+frame.routingId;
    if(operation==='native-open'){for(const id of sessions)if(owners.get(id)===owner){owners.delete(id);native.close(id);sessions.delete(id);}const result=await native.open(args.accountId,args.dotId);if(contents.isDestroyed()){native.close(result.sessionId);throw Error('Dot window closed.');}owners.set(result.sessionId,owner);sessions.add(result.sessionId);return result;}
    if(owners.get(args.sessionId)!==owner)throw Error('Invalid native Dot session.');
    if(operation==='native-catalog')return native.catalog(args.sessionId);
    if(operation==='native-thread')return native.thread(args.sessionId,args.threadId);
    if(operation==='native-turns')return native.turns(args.sessionId,args);
    if(operation==='native-fetch')return native.fetch(args.sessionId,args.requestId,args.request);
    if(operation==='native-pull')return native.pull(args.sessionId,args.requestId);
    if(operation==='native-cancel')return native.cancel(args.sessionId,args.requestId);
    if(operation==='native-close'){owners.delete(args.sessionId);sessions.delete(args.sessionId);return native.close(args.sessionId);}
   }
   if(operation==='accounts')return api.accounts();
   if(operation==='list')return await api.list(args.accountId);
   if(operation==='detail')return await api.detail(args.accountId,args.dotId);
   if(operation==='avatar')return await api.avatar(args.accountId,args.dotId);
   if(operation==='task')return await api.task(args.accountId,args.dotId,args.threadId,{turns:args.turns===true,before:args.before});
   if(operation==='resources')return await api.resources(args.accountId,args.dotId);
   if(operation==='older')return await api.older(args.accountId,args.dotId,args.before);
   if(operation==='runtime')return await api.runtime(args.accountId,args.dotId,args.action);
   throw Error('Unknown Dot request.');
   }catch(error){if(error.code&&['browser_verification','sign_in','access_denied','request_failed'].includes(error.code))return{dotError:{code:error.code,message:error.message}};throw error;}
  });
 });
 return{open};
}
module.exports={installDotTab};
