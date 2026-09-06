const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('closeDialog', {
  answer: value => { if (typeof value === 'boolean') ipcRenderer.send('rail-close-answer', value); },
});
