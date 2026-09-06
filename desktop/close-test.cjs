const { app, BrowserWindow } = require('electron');
const { confirmClose } = require('./close-confirmation.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: true });
  for (const [target, expected] of [['keep', false], ['dismiss', false], ['stop', true]]) {
    const result = confirmClose(parent);
    const modal = BrowserWindow.getAllWindows().find(w => w !== parent);
    await new Promise(resolve => modal.webContents.once('did-finish-load', resolve));
    await new Promise(resolve => setTimeout(resolve, 700));
    assert(await modal.webContents.executeJavaScript(`document.activeElement.id === 'keep'`));
    assert(await modal.webContents.executeJavaScript(`document.body.scrollHeight <= innerHeight`));
    if (target === 'keep') fs.writeFileSync(require('node:path').join(__dirname, 'preview-close.png'), (await modal.webContents.capturePage()).toPNG());
    await modal.webContents.executeJavaScript(`document.getElementById('${target}').click()`);
    assert.equal(await result, expected);
  }
  parent.destroy();
  console.log('PASS: keep open, dismiss, stop confirmation, safe default focus and dialog layout.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => app.exit(process.exitCode || 0));
