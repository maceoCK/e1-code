const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'app:' && location.hostname === 'localhost') {
  contextBridge.exposeInMainWorld('e1WorkflowPreferences', Object.freeze({
    read: () => ipcRenderer.invoke('e1:workflow:read'),
    save: value => ipcRenderer.invoke('e1:workflow:save', value),
  }));
  contextBridge.exposeInMainWorld('e1SpeedPreferences',Object.freeze({
    read:()=>ipcRenderer.invoke('e1:speed:read'),save:value=>ipcRenderer.invoke('e1:speed:save',value),
  }));
}
