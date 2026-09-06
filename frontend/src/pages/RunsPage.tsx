import {
  BarChart3, CheckCircle2, Clock3, Cog, GitBranch, ListChecks,
  Loader2, Route, XCircle,
} from "lucide-react";
import { Run } from "../api/client";
import { ProgressBar } from "../components/runs/ProgressBar";
import { RunLog } from "../components/runs/RunLog";
import { useAppStore } from "../stores/appStore";

function StatusIcon({ status }: { status: string }) {
  const icons = {
    complete: { I: CheckCircle2, color: "var(--success)" },
    running:  { I: Loader2,      color: "var(--steel)"   },
    pending:  { I: Clock3,       color: "var(--grey-5)"  },
    failed:   { I: XCircle,      color: "var(--danger)"  },
  } as const;
  const { I, color } = icons[status as keyof typeof icons] ?? icons.pending;
  return <I size={14} color={color} className={status === "running" ? "spin" : undefined} />;
}

export function RunsPage() {
  const runs = useAppStore((s) => s.runs);
  const selected = useAppStore((s) => s.selectedRunId);
  const selectRun = useAppStore((s) => s.selectRun);
  const setPage = useAppStore((s) => s.setPage);

  const capacityRuns = runs.filter((run) => run.model_type === "capacity");
  const diversionRuns = runs.filter((run) => run.model_type === "diversion");
  const active = runs.find((run) => run.id === selected) ?? null;

  function handleRunClick(run: Run) {
    selectRun(run.id);
    if (run.status === "complete") setPage("results");
  }

  return (
    <>
      <div className="card">
        <h2><Route size={14} /> Capacity assessment runs</h2>
        <div className="card-sub">
          Directional path insertion studies showing northbound and southbound
          capacity, holding time and solver performance.
        </div>
        <div className="runs-table-wrap">
          <table className="data">
            <thead><tr>
              <th style={{ width: 40 }}></th><th>Run</th><th>Date</th><th>Class</th>
              <th>NB placed</th><th>SB placed</th><th>Dwell</th><th>Timeouts</th>
              <th>Solve time (s)</th><th>Created</th>
            </tr></thead>
            <tbody>
              {capacityRuns.length === 0 && <EmptyRow columns={10} message="No capacity assessment runs yet" />}
              {capacityRuns.map((run) => (
                <tr key={run.id} className={`selectable${selected === run.id ? " selected" : ""}`} onClick={() => handleRunClick(run)} title={run.status === "complete" ? "Open full analysis" : "Select run"}>
                  <td><StatusIcon status={run.status} /></td>
                  <td><RunIdentity run={run} /></td>
                  <td>{run.date_tag ?? "Not available"}</td>
                  <td><TractionBadge traction={run.traction} /></td>
                  <td>{run.up_inserted ?? "Not available"}</td>
                  <td>{run.down_inserted ?? "Not available"}</td>
                  <td>{run.total_dwell_min ?? "Not available"}</td>
                  <td>{run.blocks_hit_time_limit && run.blocks_hit_time_limit > 0 ? <span className="badge warn">{run.blocks_hit_time_limit}</span> : (run.blocks_hit_time_limit ?? "Not available")}</td>
                  <td>{run.wall_solve_time_s ?? "Not available"}</td>
                  <CreatedCell value={run.created_at} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2><GitBranch size={14} /> Freight diversion runs</h2>
        <div className="card-sub">
          Alternative-corridor studies showing eligible freight, successfully
          diverted paths, remaining conflicts and timetable displacement.
        </div>
        <div className="runs-table-wrap">
          <table className="data">
            <thead><tr>
              <th style={{ width: 40 }}></th><th>Run</th><th>Class</th>
              <th>Divertible</th><th>Diverted</th><th>Conflicts</th>
              <th>Placed</th><th>Mean shift</th><th>Solve time (s)</th><th>Created</th>
            </tr></thead>
            <tbody>
              {diversionRuns.length === 0 && <EmptyRow columns={10} message="No freight diversion runs yet" />}
              {diversionRuns.map((run) => (
                <tr key={run.id} className={`selectable${selected === run.id ? " selected" : ""}`} onClick={() => handleRunClick(run)} title={run.status === "complete" ? "Open full analysis" : "Select run"}>
                  <td><StatusIcon status={run.status} /></td>
                  <td><RunIdentity run={run} /></td>
                  <td><span className="badge freight">cls {run.class_filter ?? "4"} · {run.endpoint_strictness ?? "relaxed"}</span></td>
                  <td>{run.divertible_total ?? "Not available"}</td>
                  <td>{run.div_placed ?? "Not available"}</td>
                  <td>{run.div_conflict ?? "Not available"}</td>
                  <td>{run.div_placed_pct != null ? `${run.div_placed_pct.toFixed(1)}%` : "Not available"}</td>
                  <td>{run.div_mean_abs_shift_min != null ? `${run.div_mean_abs_shift_min.toFixed(1)} min` : "Not available"}</td>
                  <td>{run.wall_solve_time_s ?? "Not available"}</td>
                  <CreatedCell value={run.created_at} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2><Cog size={14} /> Run output</h2>
        <ProgressBar />
        <RunLog />
      </div>

      {active?.status === "complete" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--grey-6)" }}>
              {active.model_type === "diversion" ? (
                <>Run #{active.id} complete: <b>{active.div_placed ?? 0} diverted</b>, <b>{active.div_conflict ?? 0} conflicts</b>.</>
              ) : (
                <>Run #{active.id} complete: <b>NB {active.up_inserted ?? 0}</b>, <b>SB {active.down_inserted ?? 0}</b>, dwell {active.total_dwell_min ?? 0} min.</>
              )}
            </div>
            <button onClick={() => setPage("results")}><BarChart3 size={14} /> View full analysis</button>
          </div>
        </div>
      )}
    </>
  );
}

function RunIdentity({ run }: { run: Run }) {
  return (
    <div>
      <div style={{ fontWeight: 600 }}>#{run.id} · {run.name}</div>
      <div style={{ fontSize: 11, color: "var(--grey-5)" }}>
        {run.model_type === "diversion"
          ? <>flex ±{run.flex_min ?? 60} min · {run.n_berths ?? 6} berths/stn · cls {run.class_filter ?? "?"}</>
          : <>headway {run.headway_min} min · dwell {run.dwell_max} min · {run.block_hours}h blocks</>}
      </div>
    </div>
  );
}

function TractionBadge({ traction }: { traction: string }) {
  const kind = ["c4","c5","c6","c7","c8"].includes(traction) ? "freight"
    : ["c1","c2","c9"].includes(traction) ? "passenger" : "other";
  return <span className={`badge ${kind}`}>{traction.toUpperCase()}</span>;
}

function CreatedCell({ value }: { value: string }) {
  return <td style={{ fontSize: 12, color: "var(--grey-6)", whiteSpace: "nowrap" }}>{new Date(value).toLocaleString()}</td>;
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return <tr><td colSpan={columns}><em style={{ color: "var(--grey-5)" }}>{message}. Start on the Configure page.</em></td></tr>;
}
