const fs=require('node:fs'),path=require('node:path');
const ROUTES=new Set(['state','provider','models','model-browser','preferences','preview','subscription/login','subscription/cancel','subscription/reopen','subscription/acknowledge','subscription/logout','claude/existing','claude/login','claude/refresh','claude/reopen','claude/cancel','claude/disconnect','routing','routing/reset','plan/usage']);
function installSettings(electron,mainWindow,getService){
 const sessions=new WeakSet();let cookiePromise,pendingOpen=null;
 async function request(route,data){
  if(!ROUTES.has(route))throw Error('Unknown settings request.');
  const service=await getService();
  cookiePromise||=(async()=>{const response=await fetch(service.origin+'/api/session',{method:'POST',headers:{Origin:service.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(service.url).hash.slice(1)})});if(!response.ok)throw Error('Could not open settings session.');return response.headers.get('set-cookie').split(';')[0];})().catch(error=>{cookiePromise=null;throw error;});
  const cookie=await cookiePromise;
  const response=await fetch(service.origin+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Origin:service.origin,Cookie:cookie,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Settings request failed.');return result;
 }
 electron.app.on('web-contents-created',(_event,contents)=>{
  contents.on?.('did-finish-load',()=>{if(pendingOpen&&/^app:\/\/localhost\//.test(contents.getURL()))void open(pendingOpen);});
  if(!sessions.has(contents.session)){contents.session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'settings-preload.cjs')});sessions.add(contents.session);}
  contents.ipc.handle('e1:settings:request',async(event,operation,args={})=>{
   if(event.senderFrame!==contents.mainFrame||!/^app:\/\/localhost\//.test(event.senderFrame?.url||''))throw Error('Invalid settings sender.');
   if(operation==='assets')return{html:fs.readFileSync(path.join(__dirname,'ui/settings/index.html'),'utf8'),css:fs.readFileSync(path.join(__dirname,'ui/settings/modal.css'),'utf8')};
   if(operation==='api')return request(args.route,args.data);
   if(operation==='external'){const url=new URL(args.url);if(url.protocol!=='https:')throw Error('Invalid settings link.');await electron.shell.openExternal(url.href);return{};}
   throw Error('Unknown settings operation.');
  });
 });
 async function open(page='models'){
  page=['accounts','models','usage'].includes(page)?page:'models';
  await electron.app.whenReady();const win=mainWindow();if(!win||win.isDestroyed()){pendingOpen=page;return;}
  const renderer=(win.contentView?.children||[]).map(v=>v.webContents).find(c=>c&&!c.isDestroyed()&&/^app:\/\/localhost\//.test(c.getURL()));
  if(!renderer||renderer.isLoading?.()){pendingOpen=page;return;}
  pendingOpen=null;
  if(win.isMinimized())win.restore();win.show();win.focus();renderer.focus();renderer.send('e1:settings:show',page);
 }
 return{open};
}
module.exports={installSettings};
