import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Download,
  Route, Split, Table2, TrainFront,
} from "lucide-react";
import {
  DiversionOutcome, Run, getDiversionOutcome,
} from "../../api/client";
import { TRACTION_CLASSES } from "../../constants/tractionClasses";

export function DiversionResults({ run }: { run: Run }) {
  const [outcome, setOutcome] = useState<DiversionOutcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] =
    useState<"all" | "SLOT" | "RESCHEDULED" | "CONFLICT">("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (run.status !== "complete") return;
    getDiversionOutcome(run.id).then(setOutcome)
      .catch((e) => setErr(e?.message ?? String(e)));
  }, [run.id, run.status]);

  if (run.status !== "complete") {
    return (
      <div className="card">
        <div style={{ color: "var(--grey-5)" }}>
          Diversion run #{run.id} is <b>{run.status}</b> - results appear
          here when complete.
        </div>
      </div>
    );
  }

  const total    = outcome?.divertible_total       ?? run.divertible_total ?? 0;
  const placed   = outcome?.div_placed             ?? run.div_placed       ?? 0;
  const resched  = outcome?.div_rescheduled        ?? run.div_rescheduled  ?? 0;
  const slot     = Math.max(0, placed - resched);
  const conflict = outcome?.div_conflict           ?? run.div_conflict     ?? 0;
  const pct      = outcome?.div_placed_pct         ?? run.div_placed_pct   ?? 0;
  const meanShift = outcome?.div_mean_abs_shift_min ?? run.div_mean_abs_shift_min ?? 0;

  const donutData = [
    { name: "Slot (kept time)", value: slot,     fill: "#22a06b" },
    { name: "Rescheduled",       value: resched,  fill: "#dc7f00" },
    { name: "Conflict",          value: conflict, fill: "#c92a2a" },
  ];

  const shifts = (outcome?.outcomes ?? [])
    .filter((r) => r.outcome !== "CONFLICT")
    .map((r) => r.shift_min);
  const histBins: Record<string, number> = {};
  const binSize = 5;
  for (const s of shifts) {
    const b = Math.round(s / binSize) * binSize;
    histBins[String(b)] = (histBins[String(b)] ?? 0) + 1;
  }
  const histData = Object.entries(histBins)
    .map(([k, v]) => ({ bin: Number(k), count: v }))
    .sort((a, b) => a.bin - b.bin);

  const filteredRows = (outcome?.outcomes ?? [])
    .filter((r) => filter === "all" ? true : r.outcome === filter);
  const verdict = pct >= 90 ? "Strong diversion case"
    : pct >= 70 ? "Viable with timetable intervention"
    : "Material constraints remain";
  const classFilter = outcome?.class_filter ?? run.class_filter ?? "";
  const trainClassLabel = classFilter.split(",").map((value) => {
    const digit = value.trim();
    const match = TRACTION_CLASSES.find((item) => String(item.digit) === digit);
    return match ? `Class ${match.digit} · ${match.category} · ${match.mphTypical} mph` : `Class ${digit}`;
  }).filter(Boolean).join(" | ") || "Train class not specified";

  return (
    <>
      <section className="results-hero diversion-results-hero">
        <div className="results-hero-copy">
          <div className="results-eyebrow"><CheckCircle2 size={13} /> RUN #{run.id} COMPLETE · FREIGHT DIVERSION</div>
          <h1><span>{placed}</span> of {total} freight paths can be diverted</h1>
          <div className="results-class-chip"><TrainFront size={14} /><span>TRAIN CLASS</span><strong>{trainClassLabel}</strong></div>
          <p><Route size={15} /> {run.source_corridor_id || "Source corridor"} <span className="route-arrow">→</span> {run.target_corridor_id || "Target corridor"}</p>
          <div className={`results-verdict ${pct >= 90 ? "positive" : pct >= 70 ? "caution" : "risk"}`}>
            {pct >= 70 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            <div><small>OPERATOR VERDICT</small><strong>{verdict}</strong></div>
          </div>
        </div>
        <div className="results-score" style={{ "--score": `${Math.max(0, Math.min(100, pct)) * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{pct.toFixed(1)}%</strong><span>successfully<br />placed</span></div>
        </div>
        <div className="results-hero-facts">
          <div><small>CONFLICTS REMAINING</small><strong className={conflict > 0 ? "danger-text" : "success-text"}>{conflict}</strong></div>
          <div><small>MEAN TIMETABLE SHIFT</small><strong>{meanShift.toFixed(1)} <em>min</em></strong></div>
          <div><small>SOLVER TIME</small><strong>{Math.round(run.wall_solve_time_s ?? 0)} <em>sec</em></strong></div>
        </div>
      </section>

      {/* ── Outcome breakdown bar ── */}
      <div className="card" style={{ padding: "14px 20px" }}>
        {(() => {
          const slotPct    = total > 0 ? (slot    / total) * 100 : 0;
          const reschedPct = total > 0 ? (resched / total) * 100 : 0;
          const conflictPct= total > 0 ? (conflict/ total) * 100 : 0;
          const segments = [
            { label: "Slot (kept time)", value: slot,    pct: slotPct,     color: "#22a06b" },
            { label: "Rescheduled",      value: resched,  pct: reschedPct,  color: "#dc7f00" },
            { label: "Conflict",         value: conflict, pct: conflictPct, color: "#c92a2a" },
          ];
          return (
            <>
              <div style={{ display: "flex", justifyContent: "space-between",
                             alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600,
                                color: "var(--ink)" }}>
                  Outcome breakdown
                </span>
                <span style={{ fontSize: 11, color: "var(--grey-6)" }}>
                  {total} divertible trains total
                </span>
              </div>

              {/* stacked bar */}
              <div style={{ display: "flex", height: 24, borderRadius: 6,
                             overflow: "hidden", gap: 2 }}>
                {segments.map((s) =>
                  s.pct > 0 && (
                    <div key={s.label}
                         title={`${s.label}: ${s.value} (${s.pct.toFixed(1)}%)`}
                         style={{ flex: s.pct, background: s.color,
                                   display: "flex", alignItems: "center",
                                   justifyContent: "center",
                                   fontSize: 11, fontWeight: 700,
                                   color: "#fff",
                                   minWidth: s.pct > 6 ? 0 : undefined }}>
                      {s.pct > 8 ? `${s.pct.toFixed(0)}%` : ""}
                    </div>
                  )
                )}
              </div>

              {/* legend */}
              <div style={{ display: "flex", gap: 20, marginTop: 10,
                             flexWrap: "wrap", alignItems: "center" }}>
                {segments.map((s) => (
                  <div key={s.label} style={{ display: "flex",
                                               alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2,
                                    background: s.color, flexShrink: 0,
                                    display: "inline-block" }} />
                    <span style={{ fontSize: 12, color: "var(--grey-6)" }}>
                      {s.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700,
                                    color: s.color }}>
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
                <div style={{ marginLeft: "auto", display: "flex",
                               alignItems: "center", gap: 6,
                               padding: "3px 10px", borderRadius: 6,
                               background: "rgba(34,160,107,0.08)",
                               border: "1px solid rgba(34,160,107,0.25)" }}>
                  <span style={{ fontSize: 12, color: "var(--grey-6)" }}>
                    Total placed (Slot + Rescheduled)
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700,
                                  color: "#22a06b" }}>
                    {(slotPct + reschedPct).toFixed(1)}%
                  </span>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2><Split size={14} /> Assignment outcome</h2>
          <div className="card-sub">
            Slot = kept original time (&plusmn;5 min); Rescheduled = shifted
            inside the &plusmn;60 min flex window; Conflict = no feasible
            target slot.
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={donutData} dataKey="value" nameKey="name"
                   cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                   paddingAngle={2} label />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h2><Clock size={14} /> Shift distribution</h2>
          <div className="card-sub">
            Signed shift from each divertible&apos;s original source departure
            to its assigned target-corridor slot (5-min bins).
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={histData}
                      margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"
                              vertical={false} />
              <XAxis dataKey="bin" fontSize={11}
                     label={{ value: "shift (min)",
                              position: "insideBottom",
                              offset: -2, fontSize: 11 }} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#3d5a80" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2><Table2 size={14} /> Per-train outcome</h2>
        <div className="card-sub">
          Click any row to see the target-corridor timetable slot: existing
          baseline traffic (grey ticks) within the ±{outcome?.flex_min ?? run.flex_min ?? 60} min
          flex window, the original departure (dashed line) and where the
          train was placed (coloured dot).
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10,
                      alignItems: "center", flexWrap: "wrap" }}>
          {(["all", "SLOT", "RESCHEDULED", "CONFLICT"] as const).map((f) => (
            <button key={f}
                    className={filter === f ? "" : "secondary"}
                    onClick={() => { setFilter(f); setExpanded(null); }}
                    style={{ padding: "4px 10px", fontSize: 12 }}>
              {f}
            </button>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 12,
                        color: "var(--grey-6)" }}>
            {filteredRows.length} of {outcome?.outcomes?.length ?? 0} rows
            · click row to expand
          </div>
        </div>
        <div style={{ maxHeight: 520, overflow: "auto",
                      border: "1px solid var(--border)", borderRadius: 6 }}>
          <table className="data" style={{ width: "100%" }}>
            <thead style={{ position: "sticky", top: 0 }}>
              <tr>
                <th rowSpan={2} style={{ width: 20 }}></th>
                <th rowSpan={2}>Outcome</th>
                <th rowSpan={2}>Headcode / Path</th>
                <th rowSpan={2}>Direction</th>
                <th colSpan={2} style={{
                      textAlign: "center", fontSize: 10,
                      color: "var(--steel)",
                      borderBottom: "2px solid var(--steel)",
                      letterSpacing: "0.04em" }}>
                  Source corridor
                </th>
                <th colSpan={2} style={{
                      textAlign: "center", fontSize: 10,
                      color: "#d97706",
                      borderBottom: "2px solid #d97706",
                      letterSpacing: "0.04em" }}>
                  Target (diverted) corridor
                </th>
                <th rowSpan={2}>Original</th>
                <th rowSpan={2}>Assigned</th>
                <th rowSpan={2}>Shift (min)</th>
              </tr>
              <tr>
                <th style={{ color: "var(--steel)", fontWeight: 500 }}>From</th>
                <th style={{ color: "var(--steel)", fontWeight: 500 }}>To</th>
                <th style={{ color: "#d97706", fontWeight: 500 }}>From</th>
                <th style={{ color: "#d97706", fontWeight: 500 }}>To</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => {
                const badge = r.outcome === "SLOT"        ? "ok"
                            : r.outcome === "RESCHEDULED" ? "warn"
                            :                                "err";
                const isOpen = expanded === i;
                const flexMin = outcome?.flex_min ?? run.flex_min ?? 60;
                return (
                  <>
                    <tr key={i}
                        style={{ cursor: "pointer" }}
                        className={isOpen ? "selected" : "selectable"}
                        onClick={() => setExpanded(isOpen ? null : i)}>
                      <td style={{ color: "var(--grey-5)", paddingRight: 4 }}>
                        {isOpen
                          ? <ChevronDown size={12} />
                          : <ChevronRight size={12} />}
                      </td>
                      <td>
                        <span className={"badge " + badge}
                              style={{ fontSize: 10 }}>{r.outcome}</span>
                      </td>
                      <td style={{ fontFamily: "monospace" }}>
                        {r.headcode || r.path_id}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--grey-6)" }}>
                        {r.direction || "-"}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 130,
                                   overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap",
                                   color: "var(--steel)" }}
                          title={r.first_station}>
                        {r.first_station || "-"}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 130,
                                   overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap",
                                   color: "var(--steel)" }}
                          title={r.last_station}>
                        {r.last_station || "-"}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 130,
                                   overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap",
                                   color: "#d97706" }}
                          title={outcome?.target_first_station}>
                        {outcome?.target_first_station || "-"}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 130,
                                   overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap",
                                   color: "#d97706" }}
                          title={outcome?.target_last_station}>
                        {outcome?.target_last_station || "-"}
                      </td>
                      <td>{r.original_hhmm}</td>
                      <td>{r.assigned_hhmm || "-"}</td>
                      <td style={{
                            color: r.shift_min > 0 ? "var(--warn)"
                                 : r.shift_min < 0 ? "var(--steel)"
                                 :                    "var(--success)",
                            fontWeight: 600 }}>
                        {r.shift_min
                          ? (r.shift_min > 0 ? "+" : "") + r.shift_min
                          : r.outcome !== "CONFLICT" ? "0" : ""}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${i}-detail`}>
                        <td colSpan={11}
                            style={{ padding: "12px 16px",
                                     background: "var(--paper)",
                                     borderTop: "none" }}>
                          <SlotDetail
                            origMin={r.original_dep_min}
                            assignedMin={r.dep_min}
                            flexMin={flexMin}
                            baseline={r.nearby_baseline ?? []}
                            outcome={r.outcome}
                            origHhmm={r.original_hhmm}
                            assignedHhmm={r.assigned_hhmm} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {err && (
          <div style={{ marginTop: 8, color: "var(--danger)",
                        fontSize: 13 }}>
            {err}
          </div>
        )}
      </div>

      <div className="card">
        <h2><Download size={14} /> Downloads</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["divertible_trains.csv", "diversion_outcome.csv",
            "candidate_paths_diversion.csv", "solution.csv",
            "baseline_traffic_diversion.csv",
            "source_events.csv", "source_summary.csv",
            "target_events.csv", "target_summary.csv",
            "source_corridor.json", "target_corridor.json",
            "kpis.json"].map((n) => (
            <a key={n}
               href={`/api/runs/${run.id}/file/${n}`}
               className="badge info"
               style={{ padding: "6px 12px", fontSize: 12,
                        textDecoration: "none" }}>
              {n}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

// ── SlotDetail ─────────────────────────────────────────────────────────────
// Shown inside an expanded per-train row. Renders a mini timetable strip:
//   grey ticks  = existing baseline trains at their corridor entry time
//   dashed line = original departure on source corridor
//   coloured dot = where this train was placed (or ✕ for CONFLICT)

const OUTCOME_COLOR: Record<string, string> = {
  SLOT:        "#22a06b",
  RESCHEDULED: "#dc7f00",
  CONFLICT:    "#c92a2a",
};

function hhmm(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type BaselineTrain = {
  t_min: number;
  headcode: string;
  journey_num: string;
  train_class: string;
  junction_name: string;
};

interface SlotDetailProps {
  origMin: number;
  assignedMin: number | null;
  flexMin: number;
  baseline: BaselineTrain[];
  outcome: string;
  origHhmm: string;
  assignedHhmm: string;
}

// A train is "blocking" if it is within the 15-min headway window of
// the reference slot (assigned for SLOT/RESCHEDULED, original for CONFLICT).
const HEADWAY = 15;

function SlotDetail({
  origMin, assignedMin, flexMin, baseline, outcome,
  origHhmm, assignedHhmm,
}: SlotDetailProps) {
  const color  = OUTCOME_COLOR[outcome] ?? "#64748b";
  const refMin = assignedMin ?? origMin;
  // Logical coordinate width - SVG uses viewBox so it fills 100% of cell.
  const W = 1000, H = 44;
  const lo    = origMin - flexMin;
  const hi    = origMin + flexMin;
  const range = hi - lo || 1;
  const toX   = (m: number) => Math.max(0, Math.min(W, ((m - lo) / range) * W));
  const origX     = toX(origMin);
  const assignedX = assignedMin !== null ? toX(assignedMin) : null;

  const inWindow  = baseline.filter((b) => b.t_min >= lo && b.t_min <= hi);
  const outWindow = baseline.filter((b) => b.t_min < lo || b.t_min > hi);

  const blocking    = inWindow.filter((b) => Math.abs(b.t_min - refMin) <= HEADWAY);
  const blockingSet = new Set(blocking.map((b) => b.headcode + b.journey_num));

  const tickMins: number[] = [];
  const start15 = Math.ceil(lo / 15) * 15;
  for (let m = start15; m <= hi; m += 15) tickMins.push(m);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── SVG timeline - fills full expanded-row width ── */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
           style={{ display: "block", overflow: "visible" }}>
        {/* Background rail */}
        <rect x={0} y={14} width={W} height={16} rx={4} fill="#f1f5f9" />

        {/* 15-min grid ticks + time labels */}
        {tickMins.map((m) => {
          const x = toX(m);
          return (
            <g key={m}>
              <line x1={x} y1={24} x2={x} y2={34}
                    stroke="#cbd5e1" strokeWidth={1} />
              <text x={x} y={44} fontSize={10} fill="#94a3b8"
                    textAnchor="middle">
                {hhmm(m)}
              </text>
            </g>
          );
        })}

        {/* 15-min headway band */}
        {(() => {
          const lx = toX(refMin - HEADWAY);
          const rx = toX(refMin + HEADWAY);
          return (
            <rect x={lx} y={12} width={Math.max(0, rx - lx)} height={20} rx={2}
                  fill={blocking.length > 0
                    ? "rgba(201,42,42,0.09)"
                    : "rgba(34,160,107,0.09)"} />
          );
        })()}

        {/* Baseline trains - red if blocking, grey otherwise */}
        {inWindow.map((b, idx) => {
          const x = toX(b.t_min);
          const isBlk = blockingSet.has(b.headcode + b.journey_num);
          return (
            <line key={idx} x1={x} y1={11} x2={x} y2={33}
                  stroke={isBlk ? "#c92a2a" : "#94a3b8"}
                  strokeWidth={isBlk ? 2.5 : 1.5} />
          );
        })}

        {/* Original departure - dashed steel line */}
        <line x1={origX} y1={8} x2={origX} y2={36}
              stroke="#3d5a80" strokeWidth={2} strokeDasharray="5,3" />

        {/* Assigned slot dot */}
        {assignedX !== null && (
          <circle cx={assignedX} cy={22} r={7} fill={color} />
        )}

        {/* CONFLICT cross */}
        {outcome === "CONFLICT" && (
          <>
            <line x1={origX - 7} y1={16} x2={origX + 7} y2={28}
                  stroke={color} strokeWidth={2.5} />
            <line x1={origX + 7} y1={16} x2={origX - 7} y2={28}
                  stroke={color} strokeWidth={2.5} />
          </>
        )}
      </svg>

      {/* ── Legend (HTML, never overlaps) ── */}
      <div style={{ display: "flex", gap: 16, fontSize: 10.5,
                    color: "var(--grey-6)", alignItems: "center",
                    flexWrap: "wrap", marginTop: -4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <svg width={18} height={12} style={{ flexShrink: 0 }}>
            <line x1={9} y1={0} x2={9} y2={12}
                  stroke="#3d5a80" strokeWidth={2} strokeDasharray="4,2" />
          </svg>
          Original departure ({origHhmm})
        </span>
        {assignedHhmm && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width={18} height={12} style={{ flexShrink: 0 }}>
              <circle cx={9} cy={6} r={5} fill={color} />
            </svg>
            Placed at {assignedHhmm}
          </span>
        )}
        {outcome === "CONFLICT" && (
          <span style={{ display: "flex", alignItems: "center", gap: 5,
                          color: "#c92a2a" }}>
            <svg width={18} height={12} style={{ flexShrink: 0 }}>
              <line x1={3} y1={2} x2={15} y2={10}
                    stroke="#c92a2a" strokeWidth={2} />
              <line x1={15} y1={2} x2={3} y2={10}
                    stroke="#c92a2a" strokeWidth={2} />
            </svg>
            No feasible slot (conflict)
          </span>
        )}
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <svg width={18} height={12} style={{ flexShrink: 0 }}>
            <line x1={9} y1={0} x2={9} y2={12}
                  stroke="#94a3b8" strokeWidth={1.5} />
          </svg>
          Existing traffic
        </span>
        {blocking.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 5,
                          color: "#c92a2a" }}>
            <svg width={18} height={12} style={{ flexShrink: 0 }}>
              <line x1={9} y1={0} x2={9} y2={12}
                    stroke="#c92a2a" strokeWidth={2.5} />
            </svg>
            Within {HEADWAY}-min headway (blocking)
          </span>
        )}
      </div>

      {/* ── Text panels ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap",
                    fontSize: 11, alignItems: "flex-start" }}>

        {/* Summary */}
        <div style={{ minWidth: 190 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
            Slot summary
          </div>
          <div style={{ color: "var(--grey-6)", lineHeight: 1.6 }}>
            <div>Original: <b>{origHhmm}</b></div>
            {assignedHhmm
              ? <div>
                  Placed: <b style={{ color }}>{assignedHhmm}</b>{" "}
                  ({outcome === "SLOT" ? "no shift"
                    : `${assignedMin! - origMin >= 0 ? "+" : ""}${assignedMin! - origMin} min`})
                </div>
              : <div style={{ color }}>No feasible slot - <b>conflict</b></div>}
            <div>Flex window: ±{flexMin} min</div>
            <div>
              Trains in window: <b>{inWindow.length}</b>
              {outWindow.length > 0 &&
                <span style={{ color: "var(--grey-5)" }}>
                  {" "}(+{outWindow.length} outside)
                </span>}
            </div>
          </div>
        </div>

        {/* Blocking trains */}
        {blocking.length > 0 && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, marginBottom: 4,
                           display: "flex", alignItems: "center", gap: 6,
                           color: outcome === "CONFLICT"
                             ? "#c92a2a" : "var(--ink)" }}>
              {outcome === "CONFLICT"
                ? `⛔ Blocked by (within ${HEADWAY} min)`
                : `⚠ Close headway (within ${HEADWAY} min of placed slot)`}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {blocking.map((b, i) => (
                <div key={i}
                     style={{ display: "flex", flexDirection: "column",
                               padding: "4px 8px", borderRadius: 6,
                               background: "rgba(201,42,42,0.07)",
                               border: "1px solid rgba(201,42,42,0.25)" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700,
                                  fontSize: 11.5, color: "#c92a2a" }}>
                    {b.headcode}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--grey-6)" }}>
                    {hhmm(b.t_min)}
                    {b.junction_name
                      ? <> · {b.junction_name}</>
                      : <> · jn {b.journey_num}</>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All trains in window (excluding blocking - already shown) */}
        {inWindow.filter((b) =>
            !blockingSet.has(b.headcode + b.journey_num)).length > 0 && (
          <div style={{ flex: 2, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)",
                           marginBottom: 4 }}>
              Other traffic in window
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {inWindow
                .filter((b) => !blockingSet.has(b.headcode + b.journey_num))
                .map((b, i) => (
                  <span key={i}
                        style={{ fontFamily: "monospace", fontSize: 10.5,
                                  padding: "2px 7px", borderRadius: 4,
                                  background: "rgba(148,163,184,0.12)",
                                  border: "1px solid rgba(148,163,184,0.25)",
                                  color: "var(--grey-6)" }}>
                    {b.headcode}
                    <span style={{ fontSize: 9, marginLeft: 4,
                                    color: "var(--grey-5)" }}>
                      {hhmm(b.t_min)}
                      {b.junction_name ? ` · ${b.junction_name}` : ""}
                    </span>
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
