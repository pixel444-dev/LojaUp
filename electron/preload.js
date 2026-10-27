const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lojaup', {
  call: (method, args) => ipcRenderer.invoke('api', method, args),
});
