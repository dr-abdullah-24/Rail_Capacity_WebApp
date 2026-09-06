# Rail Insights desktop

Windows desktop edition, using the existing React frontend and Python analysis engine.
The native Electron window starts a local analysis server automatically on an OS-assigned loopback port.
No browser or separate Vite server is needed for normal use.

## Start on this workstation

Double-click **Start Rail Insights.vbs** in the project root, or run `npm start` from this folder.
The File, Edit and View menus provide native close, clipboard, zoom and fullscreen actions.
File imports use the system picker. Downloads use Electron's download handling.
The app warns before closing if a study is pending or running, or its state cannot be checked.

## First-time setup

Install Python with the dependencies in `backend/requirements.txt`, then:

```powershell
cd frontend
npm install
npm run build
cd ../desktop
npm ci
npm start
```

The launcher prefers `backend/.venv/Scripts/python.exe`, otherwise `python` on PATH.
Set `RAIL_INSIGHTS_PYTHON` to an explicit Python executable if needed.
Existing data remains in `backend/data`; the desktop app uses the same runs, uploads and corridor definitions.
Close other copies of the analysis engine before working with that same database from the desktop edition.

This is a runnable desktop edition for this project checkout, not a self-contained installer.
Python, scientific dependencies and railway datasets remain local prerequisites.
Internet access is still needed for online map tiles and external links.

## Verification

`npm run check` checks the desktop entry point.
`node_modules/.bin/electron smoke.cjs` runs read-only API, rendering and navigation checks and writes window captures.
`npm run build` in the frontend folder validates the React application.

## Workbench controls

Drag the vertical dividers between the project explorer, study register and
properties inspector to resize the panes within their layout limits.
Double-click to reset a divider. Focus a divider and use Left/Right arrows
for 10-pixel adjustments, Shift + arrows for 40-pixel adjustments, or Home/End
for the minimum/maximum width. Narrow layouts hide the properties inspector.

Pane widths are retained during navigation in the current session. Because
the desktop server uses a new loopback port, they are not guaranteed to persist
across app restarts.

## Close confirmation

The desktop exit dialog uses a compact navy title bar, an interruption warning
and separate cancel/stop buttons.

- **Keep open** is focused by default and leaves the engine running.
- The **×** button or **Escape** also cancels closing.
- **Stop engine & close** exits the application and stops its local analysis
  engine. Unfinished analysis will be interrupted.
- Repeated close requests do not create duplicate dialogs.
- If no studies are pending or running and the status check succeeds, the app
  closes without the warning.

The confirmation does not appear in browser development mode.

To test the dialog independently, run from the desktop folder:

```powershell
.\node_modules\.bin\electron.cmd close-test.cjs
```

This opens isolated test windows, checks keep-open, dismiss and stop responses,
default focus and layout, and writes `preview-close.png`. It does not start
or stop a real analysis engine.

After UI changes, rebuild with `npm --prefix frontend run build` from the project
root. Reopen the desktop app to load the new frontend and desktop code, but let
active studies finish first if you do not want to interrupt them.
