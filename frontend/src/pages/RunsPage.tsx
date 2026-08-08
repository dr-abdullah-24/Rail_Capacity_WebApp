import {
  BarChart3, CheckCircle2, Clock3, Cog, ListChecks, Loader2, XCircle,
} from "lucide-react";
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
  const key = (status as keyof typeof icons);
  const { I, color } = icons[key] ?? icons.pending;
  const spinning = status === "running";
  return <I size={14} color={color}
             className={spinning ? "spin" : undefined} />;
}

export function RunsPage() {
  const runs = useAppStore((s) => s.runs);
  const selected = useAppStore((s) => s.selectedRunId);
  const selectRun = useAppStore((s) => s.selectRun);
  const setPage = useAppStore((s) => s.setPage);

  const active = runs.find((r) => r.id === selected) ?? null;

  return (
    <>
      <div className="card">
        <h2><ListChecks size={14} /> Runs</h2>
        <div className="card-sub">
          Every launched MILP run is listed here. Click a row to stream its
          progress live. Completed runs show summary KPIs; click through to
          the Results page for full analysis.
        </div>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Run</th>
              <th>Date</th>
              <th>Class</th>
              <th>NB · placed</th>
              <th>SB · conflict</th>
              <th>Dwell</th>
              <th>Timeouts</th>
              <th>Solve time (s)</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr><td colSpan={10}>
                <em style={{ color: "var(--grey-5)" }}>
                  no runs yet — start on the Configure page
                </em>
              </td></tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}
                  className={"selectable"
                    + (selected === r.id ? " selected" : "")}
                  onClick={() => selectRun(r.id)}>
                <td><StatusIcon status={r.status} /></td>
                <td>
                  <div style={{ fontWeight: 600,
                                display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={"badge " +
                      (r.model_type === "diversion" ? "warn" : "info")}
                          style={{ fontSize: 10 }}>
                      {r.model_type === "diversion" ? "diversion" : "capacity"}
                    </span>
                    #{r.id} · {r.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--grey-5)" }}>
                    {r.model_type === "diversion"
                      ? <>flex ±{r.flex_min ?? 60} min · {r.n_berths ?? 6} berths/stn (SMART fallback) · cls {r.class_filter ?? "?"}</>
                      : <>hw {r.headway_min} · dwell {r.dwell_max} · blk {r.block_hours}h</>}
                  </div>
                </td>
                <td>{r.date_tag ?? "—"}</td>
                <td>
                  {r.model_type === "diversion"
                    ? <span className="badge freight"
                            style={{ fontSize: 11 }}>
                        cls {r.class_filter ?? "4"} · {r.endpoint_strictness ?? "relaxed"}
                      </span>
                    : <span className={"badge " +
                        (["c4","c5","c6","c7","c8"].includes(r.traction)
                          ? "freight"
                          : ["c1","c2","c9"].includes(r.traction)
                            ? "passenger"
                            : "other")}>
                        {r.traction.toUpperCase()}
                      </span>}
                </td>
                <td>{r.model_type === "diversion"
                       ? (r.div_placed ?? "—")
                       : (r.nb_inserted ?? "—")}</td>
                <td>{r.model_type === "diversion"
                       ? (r.div_conflict ?? "—")
                       : (r.sb_inserted ?? "—")}</td>
                <td>{r.total_dwell_min ?? "—"}</td>
                <td>
                  {r.blocks_hit_time_limit != null
                    && r.blocks_hit_time_limit > 0 ? (
                      <span className="badge warn">
                        {r.blocks_hit_time_limit}
                      </span>
                    ) : (r.blocks_hit_time_limit ?? "—")}
                </td>
                <td>{r.wall_solve_time_s ?? "—"}</td>
                <td style={{ fontSize: 12, color: "var(--grey-6)" }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2><Cog size={14} /> Live output</h2>
        <ProgressBar />
        <RunLog />
      </div>

      {active?.status === "complete" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--grey-6)" }}>
              Run #{active.id} complete —{" "}
              <b>NB {active.nb_inserted}</b>, <b>SB {active.sb_inserted}</b>,
              dwell {active.total_dwell_min} min.
            </div>
            <button onClick={() => setPage("results")}>
              <BarChart3 size={14} /> View full analysis
            </button>
          </div>
        </div>
      )}
    </>
  );
}
