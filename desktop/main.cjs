const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
let backend, window, origin;
const { confirmClose } = require('./close-confirmation.cjs');
let closing = false;
let exiting = false;
let backendError = '';

function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { windowsHide: true });
  } else backend.kill('SIGTERM');
}

async function startBackend() {
  const localPython = path.join(root, 'backend', '.venv', 'Scripts', 'python.exe');
  const python = process.env.RAIL_INSIGHTS_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  backend = spawn(python, ['-u', 'desktop_server.py'], {
    cwd: path.join(root, 'backend'), windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.on('data', chunk => { backendError = (backendError + chunk.toString()).slice(-6000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Analysis engine startup timed out.\n' + backendError)), 60000);
    const lines = readline.createInterface({ input: backend.stdout });
    lines.on('line', line => {
      try { const data = JSON.parse(line); if (data.desktop_port) { clearTimeout(timer); resolve(data.desktop_port); } } catch {}
    });
    backend.once('error', err => { clearTimeout(timer); reject(err); });
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`Analysis engine exited (${code}).\n${backendError}`)); });
  });
  origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendError || 'Analysis engine stopped.');
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Analysis engine did not become ready.\n' + backendError);
}

async function openWindow() {
  window = new BrowserWindow({
    title: 'Rail Insights — Railway Planning', width: 1480, height: 960,
    minWidth: 1024, minHeight: 700, backgroundColor: '#eef2f3', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.origin === origin) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } };
    if (['https:', 'http:'].includes(target.protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', async event => {
    if (exiting) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    let running = true;
    try {
      const response = await fetch(`${origin}/api/runs/`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) running = (await response.json()).some(run => ['running', 'pending'].includes(run.status));
    } catch {}
    if (running) {
      const approved = await confirmClose(window);
      if (!approved) { closing = false; return; }
    }
    exiting = true;
    app.quit();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Close', accelerator: 'Alt+F4', click: () => window.close() }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About Rail Insights', click: () => dialog.showMessageBox(window, { title: 'Rail Insights', message: 'Railway capacity and diversion planning', detail: 'Liverpool John Moores University\nDesktop edition · 0.1.0' }) }] },
  ]));
  await window.loadURL(origin);
  window.show();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(startBackend).then(openWindow).catch(error => {
    dialog.showErrorBox('Rail Insights could not start', `${error.message}\n\nInstall backend requirements and build the frontend. Set RAIL_INSIGHTS_PYTHON to your Python executable if needed.`);
    exiting = true; app.quit();
  });
  app.on('before-quit', event => { if (!exiting && window && !window.isDestroyed()) { event.preventDefault(); window.close(); } else stopBackend(); });
  app.on('window-all-closed', () => { exiting = true; app.quit(); });
}
