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


