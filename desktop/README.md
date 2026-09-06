# Rail Insights desktop

Windows desktop edition, using the existing React frontend and Python analysis engine.
The native Electron window starts a local analysis server automatically on an OS-assigned loopback port.
No browser or separate Vite server is needed for normal use.

## Start on this workstation

Double-click **Start Rail Insights.vbs** in the project root, or run `npm start` from this folder.
The File, Edit and View menus provide native close, clipboard, zoom and fullscreen actions.
File imports use the system picker. Downloads use Electron's download handling.
The app warns before closing if a study is running or its state cannot be checked.

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
