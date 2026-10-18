const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='app:'&&location.hostname==='localhost'){
 contextBridge.exposeInMainWorld('e1Dot',Object.freeze({
  request:(operation,args)=>ipcRenderer.invoke('e1:dot:request',operation,args),
  onShow:callback=>{const listener=()=>callback();ipcRenderer.on('e1:dot:show',listener);return()=>ipcRenderer.removeListener('e1:dot:show',listener);},
 }));
}
