const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='app:'&&location.hostname==='localhost')contextBridge.exposeInMainWorld('e1Settings',Object.freeze({
 request:(operation,args)=>ipcRenderer.invoke('e1:settings:request',operation,args),
 onShow:callback=>{const listener=(_event,page)=>callback(page);ipcRenderer.on('e1:settings:show',listener);return()=>ipcRenderer.removeListener('e1:settings:show',listener);},
}));
