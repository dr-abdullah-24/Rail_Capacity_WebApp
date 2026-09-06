import { useState } from "react";
import {
  Activity, ArrowRight, BarChart3, CheckCircle2, ChevronRight,
  CircleDot, Clock3, Database, FileUp, Gauge, MapPinned,
  Play, Route, Settings2, ShieldCheck, Signal, Sparkles, TrainFront,
  TrendingUp, WifiOff, Zap,
} from "lucide-react";
import { Page, useAppStore } from "../stores/appStore";

const FLOW: { id: Page; label: string; Icon: typeof FileUp }[] = [
  { id: "upload", label: "Data", Icon: FileUp },
  { id: "corridor", label: "Route", Icon: Route },
  { id: "configure", label: "Model", Icon: Settings2 },
  { id: "runs", label: "Optimise", Icon: Play },
  { id: "results", label: "Evidence", Icon: BarChart3 },
];

export function HomePage() {
  const [twinModeOverride, setTwinMode] = useState<"capacity" | "diversion" | null>(null);
  const setPage = useAppStore((s) => s.setPage);
  const runs = useAppStore((s) => s.runs);
  const uploads = useAppStore((s) => s.uploads);
  const corridors = useAppStore((s) => s.corridors);
  const online = useAppStore((s) => s.online);
  const selectedUploadId = useAppStore((s) => s.selectedUploadId);
  const selectedCorridorId = useAppStore((s) => s.selectedCorridorId);

  const completed = runs.filter((run) => run.status === "complete");
  const active = runs.find((run) => run.status === "running" || run.status === "pending");
  const latest = completed[0] ?? runs[0];
  // Lead with the type of analysis the backend most recently completed,
  // while still allowing the operator to switch modes manually.
  const twinMode = twinModeOverride ?? latest?.model_type ?? "capacity";
  const latestCapacity = completed.find((run) => run.model_type === "capacity");
  const latestDiversion = completed.find((run) => run.model_type === "diversion");
  const twinRun = twinMode === "capacity" ? latestCapacity : latestDiversion;
  const twinResult = twinMode === "capacity"
    ? (twinRun?.up_inserted ?? 0) + (twinRun?.down_inserted ?? 0)
    : twinRun?.div_placed ?? 0;
  // A completed backend run proves the full workflow has been completed.
  // An additional active run must not make the overall workflow look unfinished.
  const completedSteps = completed.length > 0
    ? FLOW.length
    : active
      ? 3
      : selectedCorridorId
        ? 2
        : selectedUploadId
          ? 1
          : 0;

  return (
    <div className="control-home">
      <section className="control-hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-rail hero-rail-a" aria-hidden="true" />
        <div className="hero-rail hero-rail-b" aria-hidden="true" />

        <div className="hero-copy">
          <div className="eyebrow"><Signal size={13} /> Railway decision intelligence</div>
          <h1>See the network.<br /><span>Test every move.</span></h1>
          <p>
            Expose conflicts, test capacity, compare diversions and build
            defensible evidence before operational decisions are made.
          </p>
          <div className="hero-actions">
            <button className="signal-button" onClick={() => setPage("upload")}>
              Start capacity study <ArrowRight size={16} />
            </button>
            <button className="dark-button" onClick={() => setPage(latest ? "results" : "corridor")}>
              {latest ? "Open latest analysis" : "Explore corridors"}
            </button>
          </div>
          <div className="hero-assurances">
            <span><ShieldCheck size={12} /> Auditable</span>
            <span><Zap size={12} /> Constraint-aware</span>
            <span><Activity size={12} /> Movement-led</span>
          </div>
        </div>

        <div className="hero-instrument digital-twin" aria-label="Animated corridor digital twin">
          <div className="instrument-topline">
            <span><Activity size={13} /> CORRIDOR DIGITAL TWIN</span>
            <span className={online ? "live-dot" : "live-dot offline"}>
              {online ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <div className="twin-mode-switch" aria-label="Analysis mode">
            <button className={twinMode === "capacity" ? "active" : ""} onClick={() => setTwinMode("capacity")}>
              <Gauge size={12} /> Capacity assessment
            </button>
            <button className={twinMode === "diversion" ? "active" : ""} onClick={() => setTwinMode("diversion")}>
              <Route size={12} /> Freight diversion
            </button>
          </div>
          <div className="twin-route-title">
            <div><small>{twinMode === "capacity" ? "CAPACITY ASSESSMENT" : "DIVERSION ASSESSMENT"}</small><strong>{twinMode === "capacity" ? "Crewe to Parkside" : "Styal Line to Creweâ€“Parkside"}</strong></div>
            <span>{twinMode === "capacity" ? "CONFLICT MAP" : "ROUTE OPTIONS"}</span>
          </div>
          {twinMode === "capacity" ? (
          <svg className="twin-canvas" viewBox="0 0 520 238" role="img" aria-label="Capacity assessment showing a conflict and an optimised conflict-free path">
            <defs>
              <linearGradient id="pathGlow" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffb800" />
                <stop offset="1" stopColor="#fff0a3" />
              </linearGradient>
              <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <g className="twin-grid">
              {[42, 92, 142, 192].map((y) => <line key={`h${y}`} x1="54" y1={y} x2="500" y2={y} />)}
              {[90, 170, 250, 330, 410, 490].map((x) => <line key={`v${x}`} x1={x} y1="18" x2={x} y2="212" />)}
            </g>
            <g className="existing-paths">
              <path d="M62 196 C142 170 190 126 264 94 S402 44 492 28" />
              <path d="M58 165 C138 145 182 108 250 80 S395 45 496 36" />
              <path d="M60 206 C152 180 226 160 290 118 S410 78 498 65" />
              <path d="M65 30 C160 56 206 82 274 116 S400 169 494 198" />
              <path d="M62 61 C151 78 222 111 290 146 S408 184 495 210" />
            </g>
            <g className="twin-stations">
              <circle cx="54" cy="42" r="4" /><circle cx="54" cy="92" r="4" /><circle cx="54" cy="142" r="4" /><circle cx="54" cy="192" r="4" />
              <text x="2" y="46">PARKSIDE</text><text x="10" y="96">HARTFORD</text><text x="14" y="146">WINSFORD</text><text x="20" y="196">CREWE</text>
            </g>
            <path className="rejected-path" d="M62 192 C156 158 220 119 282 92 S405 53 494 42" />
            <g className="conflict-zone">
              <circle className="conflict-pulse" cx="282" cy="92" r="17" />
              <circle cx="282" cy="92" r="6" />
              <path d="M278 88 L286 96 M286 88 L278 96" />
            </g>
            <g className="conflict-callout">
              <rect x="306" y="30" width="133" height="35" rx="3" />
              <text x="318" y="45">CONFLICT DETECTED</text><text className="callout-sub" x="318" y="57">PATH REJECTED</text>
            </g>
            <path className="opportunity-path path-underlay" d="M62 192 C143 179 214 157 282 121 S407 65 494 42" />
            <path className="opportunity-path" d="M62 192 C143 179 214 157 282 121 S407 65 494 42" />
            <circle className="moving-train" r="5" filter="url(#glow)">
              <animateMotion dur="5.5s" repeatCount="indefinite" path="M62 192 C143 179 214 157 282 121 S407 65 494 42" />
            </circle>
            <g className="path-callout">
              <rect x="300" y="125" width="139" height="40" rx="3" />
              <circle cx="315" cy="145" r="4" />
              <text x="327" y="142">PATH OPTIMISED</text><text className="callout-sub" x="327" y="155">CONFLICT AVOIDED</text>
            </g>
            <g className="twin-time"><text x="84" y="230">06:00</text><text x="244" y="230">12:00</text><text x="404" y="230">18:00</text></g>
          </svg>
          ) : (
          <svg className="twin-canvas diversion-canvas" viewBox="0 0 520 238" role="img" aria-label="Freight diverted from a constrained source corridor to an available alternative corridor">
            <defs>
              <linearGradient id="diversionGlow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffb800" /><stop offset="1" stopColor="#fff0a3" /></linearGradient>
              <filter id="divGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <g className="diversion-grid"><line x1="35" y1="76" x2="497" y2="76" /><line x1="35" y1="168" x2="497" y2="168" /></g>
            <g className="corridor-label source"><text x="35" y="35">SOURCE CORRIDOR</text><text x="35" y="50">STYAL LINE</text></g>
            <g className="corridor-label target"><text x="35" y="198">ALTERNATIVE CORRIDOR</text><text x="35" y="213">CREWE TO PARKSIDE</text></g>
            <g className="base-tracks"><path d="M37 76 C145 60 235 91 330 72 S430 63 495 76" /><path d="M37 168 C145 153 235 182 330 164 S430 154 495 168" /></g>
            <g className="route-nodes">{[72,175,298,420,490].map((x) => <circle key={`s${x}`} cx={x} cy="76" r="4" />)}{[72,175,298,420,490].map((x) => <circle key={`t${x}`} cx={x} cy="168" r="4" />)}</g>
            <path className="blocked-route" d="M40 76 C145 60 235 91 330 72 S430 63 494 76" />
            <g className="blockage-zone"><circle className="conflict-pulse" cx="298" cy="78" r="18" /><circle cx="298" cy="78" r="8" /><path d="M293 73 L303 83 M303 73 L293 83" /></g>
            <g className="blockage-callout"><rect x="324" y="27" width="145" height="37" rx="3" /><text x="336" y="43">CORRIDOR CONFLICT</text><text className="callout-sub" x="336" y="55">FREIGHT PATH BLOCKED</text></g>
            <path className="diversion-path path-underlay" d="M40 76 C105 67 145 71 175 76 C211 83 224 147 298 168 C365 181 433 153 494 168" />
            <path className="diversion-path" d="M40 76 C105 67 145 71 175 76 C211 83 224 147 298 168 C365 181 433 153 494 168" />
            <circle className="moving-train" r="5" filter="url(#divGlow)"><animateMotion dur="5.5s" repeatCount="indefinite" path="M40 76 C105 67 145 71 175 76 C211 83 224 147 298 168 C365 181 433 153 494 168" /></circle>
            <g className="switch-label"><rect x="185" y="107" width="124" height="35" rx="3" /><circle cx="199" cy="124" r="4" /><text x="211" y="121">FREIGHT DIVERTED</text><text className="callout-sub" x="211" y="134">ALTERNATIVE PATH FITS</text></g>
          </svg>
          )}
          <div className="instrument-result">
            {twinRun && <div className="result-number">{twinResult}</div>}
            <div><strong>{twinMode === "capacity" ? "paths unlocked" : "freight paths diverted"}</strong><span>{twinRun ? "in latest completed study" : `awaiting first ${twinMode} study`}</span></div>
            <button aria-label="Open evidence" onClick={() => setPage("results")}><ArrowRight size={15} /></button>
          </div>
        </div>
      </section>

      <section className="status-ribbon">
        <StatusItem Icon={online ? CheckCircle2 : WifiOff} value={online ? "Operational" : "Unavailable"} label="analysis engine" tone={online ? "green" : "red"} />
        <StatusItem Icon={MapPinned} value={corridors.length} label="mapped corridors" />
        <StatusItem Icon={Database} value={uploads.length} label="TD datasets ready" />
        <StatusItem Icon={Gauge} value={completed.length} label="studies completed" />
        <div className="ribbon-action">
          <span>System readiness</span>
          <strong>{online ? "Ready to model" : "Backend connection required"}</strong>
        </div>
      </section>

      <section className="home-layout">
        <div className="command-panel">
          <div className="section-heading">
            <div><span className="section-kicker">MISSION WORKFLOW</span><h2>From movement data to a board-ready answer</h2></div>
            <span className="time-chip"><Clock3 size={13} /> ~2 min setup</span>
          </div>

          <div className="mission-flow">
            {FLOW.map(({ id, label, Icon }, index) => {
              const ready = index < completedSteps;
              const isCurrent = completedSteps < FLOW.length && index === completedSteps;
              return (
                <button key={id} className={`mission-step${isCurrent ? " current" : ""}${ready ? " done" : ""}`} onClick={() => setPage(id)}>
                  <span className="mission-index">{ready ? <CheckCircle2 size={16} /> : `0${index + 1}`}</span>
                  <span className="mission-icon"><Icon size={21} /></span>
                  <span><small>{isCurrent ? "NEXT ACTION" : ready ? "COMPLETE" : "STEP"}</small><strong>{label}</strong></span>
                  <ChevronRight className="mission-chevron" size={16} />
                </button>
              );
            })}
          </div>

          <div className={`decision-strip${completedSteps === FLOW.length ? " workflow-complete" : ""}`}>
            <div className="decision-icon">{completedSteps === FLOW.length ? <CheckCircle2 size={21} /> : <Sparkles size={21} />}</div>
            <div><small>{completedSteps === FLOW.length ? "EVIDENCE PACK READY" : "DECISION OUTPUT"}</small><strong>{completedSteps === FLOW.length ? "The full workflow is complete. Your capacity evidence is ready." : "Know where, when and how many services can run."}</strong></div>
            <button className="text-action" onClick={() => setPage("results")}>View evidence <ArrowRight size={14} /></button>
          </div>
        </div>

        <aside className="run-panel">
          <div className="run-panel-head">
            <div><span className="section-kicker">LATEST STUDY</span><h2>{latest ? `Run #${latest.id}` : "No studies yet"}</h2></div>
            <span className={`run-state ${latest?.status ?? "pending"}`}><CircleDot size={11} /> {latest?.status ?? "not started"}</span>
          </div>
          {latest ? (
            <>
              <div className="run-name">{latest.name}</div>
              <div className="run-metrics">
                {latest.model_type === "diversion" ? (
                  <>
                    <div><small>FREIGHT DIVERTED</small><strong>{latest.div_placed ?? 0}<em> paths</em></strong></div>
                    <div><small>CONFLICTS</small><strong>{latest.div_conflict ?? 0}<em> paths</em></strong></div>
                  </>
                ) : (
                  <>
                    <div><small>NORTHBOUND</small><strong>{latest.up_inserted ?? 0}<em> paths</em></strong></div>
                    <div><small>SOUTHBOUND</small><strong>{latest.down_inserted ?? 0}<em> paths</em></strong></div>
                  </>
                )}
              </div>
              <div className="run-detail"><span>Model</span><strong>{latest.model_type === "diversion" ? "Diversion" : "Capacity"}</strong></div>
              <div className="run-detail"><span>Solve time</span><strong>{latest.wall_solve_time_s ? `${Math.round(latest.wall_solve_time_s)} sec` : "Not recorded"}</strong></div>
              <div className="run-detail"><span>Created</span><strong>{formatStudyTime(latest.created_at)}</strong></div>
              <button className="panel-button" onClick={() => setPage(latest.status === "complete" ? "results" : "runs")}>
                {latest.status === "complete" ? "Inspect full analysis" : "Monitor study"} <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <div className="empty-run">
              <div className="empty-run-message">
                <TrendingUp size={30} />
                <p>Your first optimisation result will appear here.</p>
              </div>
              <button className="panel-button" onClick={() => setPage("upload")}>Begin study <ArrowRight size={15} /></button>
            </div>
          )}
        </aside>
      </section>

      <footer className="home-proof">
        <span><strong>Rail Insights</strong> Â· operational research for UK rail capacity</span>
        <span>Developed at Liverpool John Moores University</span>
      </footer>
    </div>
  );
}

function formatStudyTime(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusItem({ Icon, value, label, tone = "blue" }: { Icon: typeof Activity; value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="status-item">
      <span className={`status-icon ${tone}`}><Icon size={17} /></span>
      <span><strong>{value}</strong><small>{label}</small></span>
    </div>
  );
}



