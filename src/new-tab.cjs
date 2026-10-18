const path = require('node:path');
function installNewTab(electron, mainWindow) {
 const {app, MenuItem} = electron, sessions = new WeakSet();
 const overlays=new Map(),hidden=new Map();let timer;
 function syncOverlays(){
  const blocked=[...overlays.values()].some(keys=>keys.size);
  const children=mainWindow()?.contentView?.children||[];
  if(blocked){
   for(const view of children){
    const contents=view.webContents;
    if(!contents||contents.isDestroyed()||contents===mainWindow()?.webContents||/^app:\/\/localhost\//.test(contents.getURL()))continue;
    if(!hidden.has(view)){
     const record={set:view.setVisible,visible:view.getVisible()};hidden.set(view,record);
     view.setVisible=function(visible){record.visible=visible;return record.set.call(view,false);};
    }
    hidden.get(view).set.call(view,false);
   }
   timer||=(setInterval(syncOverlays,100));timer.unref?.();
  }else{
   clearInterval(timer);timer=undefined;
   for(const [view,record] of hidden){view.setVisible=record.set;if(!view.webContents.isDestroyed()&&children.includes(view))record.set.call(view,record.visible);}
   hidden.clear();
  }
 }
 function open() {
  const win=mainWindow();
  if(!win||win.isDestroyed())return;
  if(win.isMinimized())win.restore();
  win.show();win.focus();
  // E1 hosts its app:// workspace in a child view of the file:// shell.
  const renderer=(win.contentView?.children||[]).map(view=>view.webContents).find(contents=>contents&&!contents.isDestroyed()&&/^app:\/\/localhost\//.test(contents.getURL()))||win.webContents;
  renderer.focus?.();renderer.send('e1:new-tab:show');
 }
 app.on('web-contents-created',(_event,contents)=>{
  // The native browser handles Cmd+T before Electron's menu accelerator.
  // Give this app-wide command priority over those per-content listeners.
  const emit=contents.emit;
  contents.emit=function(name,event,input,...rest){
   if(name==='before-input-event'&&input?.type==='keyDown'&&
      (process.platform==='darwin'?input.meta:input.control)&&!input.shift&&!input.alt&&String(input.key).toLowerCase()==='t'){
    event.preventDefault();if(!input.isAutoRepeat)open();return true;
   }
   return emit.call(this,name,event,input,...rest);
  };
  if(!sessions.has(contents.session)){
   contents.session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'new-tab-preload.cjs')});
   sessions.add(contents.session);
  }
  contents.ipc.handle('e1:overlay',async(event,key,visible)=>{
   if(event.senderFrame!==contents.mainFrame||!/^app:\/\/localhost\//.test(event.senderFrame?.url||''))throw Error('Invalid overlay sender.');
   if(!['dot','new-tab','settings'].includes(key)||typeof visible!=='boolean')throw Error('Invalid overlay.');
   const keys=overlays.get(contents)||new Set();overlays.set(contents,keys);visible?keys.add(key):keys.delete(key);syncOverlays();
  });
  const reset=()=>{overlays.delete(contents);syncOverlays();};
  contents.on('destroyed',reset);contents.on('did-start-loading',reset);
 });
 function menu(menu) {
  const file=menu?.items.find(item=>item.role==='fileMenu'||item.label.replace(/&/g,'')==='File')?.submenu;
  if(!file)return;
  // One app-wide accelerator, including focus in embedded browser contents.
  const clear=items=>{for(const item of items){if(/^(?:CmdOrCtrl|CommandOrControl|Command|Cmd)\+T$/i.test(item.accelerator||''))item.accelerator=undefined;if(item.submenu)clear(item.submenu.items);}};
  clear(menu.items);
  const previous=file.getMenuItemById('e1-new-tab');
  if(previous){previous.accelerator='CommandOrControl+T';return;}
  file.insert(0,new MenuItem({id:'e1-new-tab',label:'New tab…',accelerator:'CommandOrControl+T',click:open}));
 }
 return {open,menu};
}
module.exports={installNewTab};
