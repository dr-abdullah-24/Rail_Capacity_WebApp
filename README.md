# Rail Corridor Capacity Studio

Interactive web app for capacity analysis on rail freight corridors,
built as a companion to the `LIV_MAN_Capacity_MILP_2018` research
repository.

## Stack

- **Backend** – Python 3.14, FastAPI, SQLModel, SQLite. Calls the existing
  MILP scripts (`build_baseline_traffic.py`, `capacity_gap_milp.py`,
  `run_steer_hourly.py`) as subprocesses.
- **Frontend** – Vite + React 18 + TypeScript. Interactive charts via
  Plotly.js and vis-timeline.

## Local dev

```bash
# Backend  (http://127.0.0.1:8010)
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8010

# Frontend (http://127.0.0.1:5173, proxies /api -> backend)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173/ in the browser.

## Roadmap (see the presentation for context)

| Phase | Status | Notes |
|---|---|---|
| 1a Backend scaffold | done | `/health`, `/uploads`, `/runs` stubs, SQLModel setup |
| 1b Frontend scaffold | done | Vite + React + TS; health-check panel wired |
| 1c Upload + subprocess | in progress | POST files, spawn MILP scripts, WebSocket progress |
| 2 Basic UI end-to-end | | Upload -> config -> run -> results table + CSV export |
| 3 Space-time timeline | | vis-timeline with existing + inserted paths per junction |
| 4 ATTune-like editor | | Drag paths, live conflict detection, scenarios |
| 5 Stakeholder dashboards | | Operator / policy maker / facility manager views |
