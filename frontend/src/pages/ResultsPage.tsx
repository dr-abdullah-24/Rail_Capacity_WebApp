import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUpNarrowWide, ArrowUpRight, Bell, Clock, Download, GaugeCircle,
  Grid3x3, Route as RouteIcon, Sparkles, Table2, Timer, Zap,
} from "lucide-react";
import { getKpis, getTraffic } from "../api/client";
import { CapacityHeatmap } from "../components/results/CapacityHeatmap";
import { SpaceTimeDiagram } from "../components/results/SpaceTimeDiagram";
import { TrafficTable } from "../components/results/TrafficTable";
import { useAppStore } from "../stores/appStore";

export function ResultsPage() {
  const runId  = useAppStore((s) => s.selectedRunId);
  const runs   = useAppStore((s) => s.runs);
  const kpis   = useAppStore((s) => s.selectedKpis);
  const setKpis = useAppStore((s) => s.setKpis);
  const traffic = useAppStore((s) => s.selectedTraffic);
  const setTraffic = useAppStore((s) => s.setTraffic);
  const setPage = useAppStore((s) => s.setPage);
  const run = runs.find((r) => r.id === runId) ?? null;

  const [stDir, setStDir] = useState<"northbound"|"southbound"|"both">("both");
  const [hmDir, setHmDir] = useState<"northbound"|"southbound">("northbound");

  useEffect(() => {
    if (runId && !kpis) getKpis(runId).then(setKpis).catch(() => {});
    if (runId && !traffic) getTraffic(runId).then(setTraffic).catch(() => {});
  }, [runId]);

  const insertionData = useMemo(() => {
    if (!run) return [];
    return [
      { direction: "NB", inserted: run.nb_inserted ?? 0 },
      { direction: "SB", inserted: run.sb_inserted ?? 0 },
    ];
  }, [run]);

  if (!run) {
    return (
      <div className="card">
        <div style={{ color: "var(--grey-5)" }}>
          Select a run on the Runs page first.{" "}
          <button className="ghost" onClick={() => setPage("runs")}>
            Go to Runs
          </button>
        </div>
      </div>
    );
  }
  if (run.status !== "complete") {
    return (
      <div className="card">
        <div style={{ color: "var(--grey-5)" }}>
          Run #{run.id} is <b>{run.status}</b> — results appear here when
          complete.
        </div>
      </div>
    );
  }

  const nb = run.nb_inserted ?? 0;
  const sb = run.sb_inserted ?? 0;
  const nbCandidates = kpis?.nb_candidates ?? 24;
  const sbCandidates = kpis?.sb_candidates ?? 24;
  const nbPct = nbCandidates ? Math.round((nb / nbCandidates) * 100) : 0;
  const sbPct = sbCandidates ? Math.round((sb / sbCandidates) * 100) : 0;

  return (
    <>
      <div className="grid cols-4">
        <div className="kpi">
          <div className="kpi-label">
            <ArrowUpNarrowWide size={12} /> NB inserted
          </div>
          <div className="kpi-value">{nb}</div>
          <div className="kpi-hint">
            {nbPct}% of {nbCandidates} candidates
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <ArrowUpRight size={12} /> SB inserted
          </div>
          <div className="kpi-value">{sb}</div>
          <div className="kpi-hint">
            {sbPct}% of {sbCandidates} candidates
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <Clock size={12} /> Total dwell
          </div>
          <div className="kpi-value">
            {run.total_dwell_min ?? 0}
            <span style={{ fontSize: 14, color: "var(--grey-5)" }}> min</span>
          </div>
          <div className="kpi-hint">holding at intermediate loops</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            <Timer size={12} /> Solve time
          </div>
          <div className="kpi-value">
            {Math.round(run.wall_solve_time_s ?? 0)}
            <span style={{ fontSize: 14, color: "var(--grey-5)" }}> s</span>
          </div>
          <div className="kpi-hint">
            {run.blocks_hit_time_limit
              ? <span style={{ color: "var(--warn)" }}>
                  <Bell size={11} /> {run.blocks_hit_time_limit} block(s) hit
                  time limit
                </span>
              : "all blocks Optimal"}
          </div>
        </div>
      </div>

      <div className="card">
        <h2><RouteIcon size={14} /> Space-time diagram</h2>
        <div className="card-sub">
          Corridor junctions on the vertical axis, time-of-day on the
          horizontal. Faint lines = existing traffic. Coloured lines =
          MILP-inserted freight paths — press Play to see the placement
          order.
        </div>
        {traffic ? (
          <SpaceTimeDiagram
            corridorNames={traffic.corridor_names}
            existing={traffic.existing}
            inserted={traffic.inserted}
            direction={stDir}
            onDirectionChange={setStDir}
            operatingStart={run.operating_hours_enabled
              ? run.operating_start_hour : undefined}
            operatingEnd={run.operating_hours_enabled
              ? run.operating_end_hour : undefined} />
        ) : (
          <div style={{ color: "var(--grey-5)", fontSize: 13 }}>
            Loading corridor traffic…
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card"
             style={{ display: "flex", flexDirection: "column" }}>
          <h2><Zap size={14} /> Freight paths inserted by direction</h2>
          <div className="card-sub">
            New freight paths the MILP successfully fitted into the corridor
            for each direction.
          </div>
          <div style={{ flex: 1, minHeight: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={insertionData}
                        barCategoryGap="30%"
                        margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"
                                vertical={false} />
                <XAxis dataKey="direction" fontSize={13}
                       tick={{ fill: "var(--grey-7)" }} />
                <YAxis fontSize={12} allowDecimals={false}
                       width={40}
                       domain={[0, "dataMax + 2"]}
                       tick={{ fill: "var(--grey-6)" }}
                       label={{ value: "paths inserted",
                                angle: -90, position: "insideLeft",
                                fontSize: 11, fill: "var(--grey-6)" }} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} />
                <Bar dataKey="inserted"
                     name="Inserted paths"
                     barSize={80}
                     radius={[6, 6, 0, 0]}>
                  {insertionData.map((d, i) => (
                    <Cell key={i}
                          fill={d.direction === "NB" ? "#3d5a80" : "#b7402e"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2><Grid3x3 size={14} /> Hourly capacity heatmap</h2>
          <div className="card-sub">
            How busy is each corridor junction, each hour? Green dots mark
            the MILP-inserted paths — pale cells reveal where new services
            can fit. Toggle direction:
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className={hmDir === "northbound" ? "" : "secondary"}
                    onClick={() => setHmDir("northbound")}>NB</button>
            <button className={hmDir === "southbound" ? "" : "secondary"}
                    onClick={() => setHmDir("southbound")}>SB</button>
          </div>
          {traffic ? (
            <CapacityHeatmap
              corridorNames={traffic.corridor_names}
              heatmap={traffic.heatmap}
              overlay={traffic.inserted_overlay}
              direction={hmDir} />
          ) : (
            <div style={{ color: "var(--grey-5)", fontSize: 13 }}>
              Loading…
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2><Table2 size={14} /> Complete corridor traffic</h2>
        <div className="card-sub">
          All existing trains on the corridor for this date plus the newly
          inserted freight paths (highlighted green with the{" "}
          <Sparkles size={11} style={{ verticalAlign: "middle" }} /> chip).
          Sort by any column; filter by headcode or direction.
        </div>
        {traffic ? (
          <TrafficTable corridorNames={traffic.corridor_names}
                        existing={traffic.existing}
                        inserted={traffic.inserted} />
        ) : (
          <div style={{ color: "var(--grey-5)", fontSize: 13 }}>
            Loading corridor traffic…
          </div>
        )}
      </div>

      <div className="card">
        <h2><Download size={14} /> Downloads</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/api/runs/${run.id}/solution`}
             className="badge info"
             style={{ padding: "6px 12px", fontSize: 12,
                      textDecoration: "none" }}>
            <Download size={12} /> solution.csv
          </a>
          <a href={`/api/runs/${run.id}/kpis`}
             className="badge info"
             style={{ padding: "6px 12px", fontSize: 12,
                      textDecoration: "none" }}>
            <Download size={12} /> kpis.json
          </a>
          <a href={`/api/runs/${run.id}/baseline`}
             className="badge info"
             style={{ padding: "6px 12px", fontSize: 12,
                      textDecoration: "none" }}>
            <Download size={12} /> baseline.csv
          </a>
          <a href={`/api/runs/${run.id}/traffic`}
             className="badge info"
             style={{ padding: "6px 12px", fontSize: 12,
                      textDecoration: "none" }}>
            <Download size={12} /> traffic.json
          </a>
        </div>
      </div>
    </>
  );
}
