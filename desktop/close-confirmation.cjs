const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

function confirmClose(parent) {
  return new Promise(resolve => {
    const modal = new BrowserWindow({
      parent, modal: true, width: 520, height: 330, resizable: false,
      minimizable: false, maximizable: false, frame: false, show: false,
      backgroundColor: '#f4f6f8', title: 'Close Rail Insights?',
      webPreferences: { preload: path.join(__dirname, 'close-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let approved = false;
    const answer = (event, value) => {
      if (event.sender !== modal.webContents || typeof value !== 'boolean') return;
      approved = value;
      modal.close();
    };
    ipcMain.on('rail-close-answer', answer);
    modal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    modal.webContents.on('will-navigate', event => event.preventDefault());
    modal.once('closed', () => { ipcMain.removeListener('rail-close-answer', answer); resolve(approved); });
    modal.once('ready-to-show', () => modal.show());
    modal.loadFile(path.join(__dirname, 'close-confirmation.html')).catch(() => modal.close());
  });
}
module.exports = { confirmClose };
