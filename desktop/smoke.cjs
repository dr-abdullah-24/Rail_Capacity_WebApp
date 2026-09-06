// Read-only desktop integration checks. Run with: electron smoke.cjs
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const assert = require('node:assert/strict');
let child;
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  child = spawn(process.env.RAIL_INSIGHTS_PYTHON || 'python', ['-u', 'desktop_server.py'], { cwd: path.join(root, 'backend'), windowsHide: true });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timeout')), 45000);
    child.on('error', reject);
    readline.createInterface({ input: child.stdout }).on('line', line => { try { const data = JSON.parse(line); if (data.desktop_port) { clearTimeout(timeout); resolve(data.desktop_port); } } catch {} });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 80; n++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  for (const endpoint of ['/api/health', '/api/uploads/', '/api/corridors/', '/api/runs/', '/ljmu-logo.png', '/rail-insights-mark.svg']) {
    assert.equal((await fetch(base + endpoint)).status, 200, endpoint);
  }
  const runs = await (await fetch(base + '/api/runs/')).json();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  await win.loadURL(base);
  await new Promise(r => setTimeout(r, 2500));
  assert(await win.webContents.executeJavaScript(`document.body.textContent.includes('Study workspace')`));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.study-register tbody tr').length`), runs.length);
  for (const side of ['left', 'right']) {
    const selector = '.pane-divider-' + side;
    const before = await win.webContents.executeJavaScript(`Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`);
    const point = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 100) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + (side === 'left' ? 60 : -60), y: point.y });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: point.x + (side === 'left' ? 60 : -60), y: point.y });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(await win.webContents.executeJavaScript(`Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`), before + 60, side + ' drag resize');
    await win.webContents.executeJavaScript(`document.querySelector('${selector}').dispatchEvent(new KeyboardEvent('keydown', { key: '${side === 'left' ? 'ArrowRight' : 'ArrowLeft'}', bubbles: true }))`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await win.webContents.executeJavaScript(`Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`), before + 70, side + ' keyboard resize');
    await win.webContents.executeJavaScript(`document.querySelector('${selector}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await win.webContents.executeJavaScript(`Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`), before, side + ' reset');
  }
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.register-tabs button')).find(b => b.textContent.startsWith('Diversion')).click()`);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.study-register tbody tr').length`), runs.filter(r => r.model_type === 'diversion').length);
  for (const width of [1440, 1920]) {
  assert(await win.webContents.executeJavaScript(`!document.querySelector('.connection-pill') && !document.querySelector('[aria-label="Open run monitor"]')`), 'No connection or notification controls');
  await win.webContents.executeJavaScript(`document.querySelectorAll('.study-select')[1]?.click()`);
  await new Promise(r => setTimeout(r, 100));
  assert(await win.webContents.executeJavaScript(`document.querySelector('.property-identity h2').textContent === document.querySelectorAll('.study-select')[1].textContent`), 'Selection inspector follows row');
    win.setSize(width, 960);
    await new Promise(r => setTimeout(r, 200));
    assert(await win.webContents.executeJavaScript(`document.documentElement.scrollWidth <= window.innerWidth`), `Overflow at ${width}`);
    fs.writeFileSync(path.join(__dirname, `preview-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  for (const label of ['Upload TD data', 'Corridor', 'Configure run', 'Runs', 'Results', 'TPR Library', 'Home']) {
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.sidebar-nav-item')).find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
    await new Promise(r => setTimeout(r, 300));
    assert(await win.webContents.executeJavaScript(`document.querySelector('.app-main').textContent.length > 0`), label);
  }
  assert(await win.webContents.executeJavaScript(`new Promise(resolve => { const ws = new WebSocket('ws://' + location.host + '/api/ws/runs/${runs[0]?.id ?? 0}'); ws.onopen = () => { ws.close(); resolve(true); }; ws.onerror = () => resolve(false); setTimeout(() => { ws.close(); resolve(false); }, 3000); })`), 'WebSocket connection');
  assert.equal(errors.filter(e => !e.includes('ERR_CONNECTION_CLOSED')).length, 0, errors.join('\n'));
  console.log('PASS: API, assets, real study data, model filter, seven screens, WebSocket and 1440/1920 layout checks.');
  win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (child) child.kill();
  app.exit(process.exitCode || 0);
});
