const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'app:' && location.hostname === 'localhost') {
  contextBridge.exposeInMainWorld('e1ModelBrowser',Object.freeze({
    read:()=>ipcRenderer.invoke('e1:models:read'),
    save:value=>ipcRenderer.invoke('e1:models:save',value),
    onChange:callback=>{const listener=()=>callback();ipcRenderer.on('e1:models:changed',listener);return()=>ipcRenderer.removeListener('e1:models:changed',listener);},
  }));
  contextBridge.exposeInMainWorld('e1WorkflowPreferences', Object.freeze({
    read: () => ipcRenderer.invoke('e1:workflow:read'),
    save: value => ipcRenderer.invoke('e1:workflow:save', value),
  }));
  contextBridge.exposeInMainWorld('e1SpeedPreferences',Object.freeze({
    read:()=>ipcRenderer.invoke('e1:speed:read'),save:value=>ipcRenderer.invoke('e1:speed:save',value),
  }));
}
