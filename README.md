# Rail Insights

Railway capacity and diversion planning tool, built as a companion to the
`LIV_MAN_Capacity_MILP_2018` research repository.

The Windows desktop edition combines a React workbench with the existing Python
analysis engine. It starts its local server automatically; normal desktop use
does not require a browser or a separate Vite development server.

## Desktop setup

Install Node.js, npm and Python, then run from the project root:

```powershell
python -m pip install -r backend/requirements.txt
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix desktop ci
npm --prefix desktop start
```

After setup, double-click **Start Rail Insights.vbs** to launch the app.
This runs from the project checkout, not a self-contained installer. Railway
datasets and analysis dependencies must be available locally.

See [the desktop guide](desktop/README.md) for Python configuration, shared-data
precautions and verification commands.

## Workbench

- Left navigation provides access to studies, data, network, model setup,
  runs, results and planning rules.
- The study workspace contains a project explorer, study register and
  properties inspector. Drag the vertical dividers to resize the panes.
  Double-click a divider to reset it; use arrow keys for 10-pixel adjustments
  or Shift + arrow keys for 40-pixel adjustments. Home and End move to the
  allowed minimum and maximum.
- Filter studies by model or search text. Select a study to inspect its
  properties; double-click it to open the run or completed analysis.
- The sidebar includes the LJMU logo. The top bar omits the selected-corridor
  label and connection/notification indicators.
- If a study is pending or running, or its state cannot be checked, closing
  opens a styled confirmation. **Keep open**, the × button and Escape cancel
  the exit. **Stop engine & close** exits and stops the local engine, interrupting
  unfinished analysis. Keep open is the default focused action.

The interface changes do not alter the underlying analysis workflows.

## Stack

- **Desktop** — Electron, with sandboxed rendering and context isolation.
- **Backend** — Python, FastAPI, SQLModel and SQLite. Invokes the existing
  MILP scripts as subprocesses.
- **Frontend** — Vite, React and TypeScript, with Plotly.js and vis-timeline.

## Browser development

Run the backend and frontend in separate terminals from the project root:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8010
```

```powershell
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173/. The development server proxies API requests to
the backend on port 8010. The desktop exit confirmation is Electron-only.

## Updating and checking

After frontend changes, run `npm --prefix frontend run build` and reopen the
desktop app when it is safe to interrupt any running studies. Desktop code
changes also require restarting the app.

```powershell
npm --prefix frontend run build
npm --prefix desktop run check
npm --prefix desktop test
```

See [desktop verification](desktop/README.md#verification) for the isolated
close-dialog test.


