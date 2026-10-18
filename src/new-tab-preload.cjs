const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='app:'&&location.hostname==='localhost'){
 contextBridge.exposeInMainWorld('e1NewTab',Object.freeze({
  overlay:(key,visible)=>ipcRenderer.invoke('e1:overlay',key,visible),
  onShow:callback=>{const listener=()=>callback();ipcRenderer.on('e1:new-tab:show',listener);return()=>ipcRenderer.removeListener('e1:new-tab:show',listener);},
 }));
}
