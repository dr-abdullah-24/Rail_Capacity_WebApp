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
  const inserted = (latest?.nb_inserted ?? 0) + (latest?.sb_inserted ?? 0);
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
          <div className="eyebrow"><Signal size={13} /> Network capacity intelligence</div>
          <h1>See the railway<br /><span>before you change it.</span></h1>
          <p>
            Find the path. Prove the capacity. Give planners, operators and
            investment teams one defensible view of what the network can carry.
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
          <div className="twin-route-title">
            <div><small>ACTIVE CORRIDOR</small><strong>Crewe — Parkside</strong></div>
            <span>24H VIEW</span>
          </div>
          <svg className="twin-canvas" viewBox="0 0 520 238" role="img" aria-label="Space-time diagram showing an available freight path">
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
            <path id="opportunityPath" className="opportunity-path path-underlay" d="M62 192 C145 172 216 140 282 104 S410 59 494 42" />
            <path className="opportunity-path" d="M62 192 C145 172 216 140 282 104 S410 59 494 42" />
            <circle className="moving-train" r="5" filter="url(#glow)">
              <animateMotion dur="5.5s" repeatCount="indefinite" path="M62 192 C145 172 216 140 282 104 S410 59 494 42" />
            </circle>
            <g className="path-callout">
              <rect x="292" y="117" width="147" height="40" rx="3" />
              <circle cx="307" cy="137" r="4" />
              <text x="319" y="134">FEASIBLE PATH</text><text className="callout-sub" x="319" y="147">CONFLICT-FREE</text>
            </g>
            <g className="twin-time"><text x="84" y="230">06:00</text><text x="244" y="230">12:00</text><text x="404" y="230">18:00</text></g>
          </svg>
          <div className="instrument-result">
            <div className="result-number">+{latest ? inserted : "—"}</div>
            <div><strong>paths unlocked</strong><span>{latest ? "in latest completed study" : "awaiting first study"}</span></div>
            <button aria-label="Open evidence" onClick={() => setPage("results")}><ArrowRight size={15} /></button>
          </div>
        </div>
      </section>

      <section className="status-ribbon">
        <StatusItem Icon={online ? CheckCircle2 : WifiOff} value={online ? "Operational" : "Unavailable"} label="analysis engine" tone={online ? "green" : "red"} />
        <StatusItem Icon={MapPinned} value={corridors.length || "—"} label="mapped corridors" />
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
                <div><small>NORTHBOUND</small><strong>{latest.nb_inserted ?? "—"}<em> paths</em></strong></div>
                <div><small>SOUTHBOUND</small><strong>{latest.sb_inserted ?? "—"}<em> paths</em></strong></div>
              </div>
              <div className="run-detail"><span>Model</span><strong>{latest.model_type === "diversion" ? "Diversion" : "Capacity"}</strong></div>
              <div className="run-detail"><span>Solve time</span><strong>{latest.wall_solve_time_s ? `${Math.round(latest.wall_solve_time_s)} sec` : "—"}</strong></div>
              <button className="panel-button" onClick={() => setPage(latest.status === "complete" ? "results" : "runs")}>
                {latest.status === "complete" ? "Inspect full analysis" : "Monitor study"} <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <div className="empty-run">
              <TrendingUp size={30} />
              <p>Your first optimisation result will appear here.</p>
              <button className="panel-button" onClick={() => setPage("upload")}>Begin study <ArrowRight size={15} /></button>
            </div>
          )}
        </aside>
      </section>

      <footer className="home-proof">
        <span><strong>RailInsights</strong> · operational research for UK rail capacity</span>
        <span>Developed at Liverpool John Moores University</span>
      </footer>
    </div>
  );
}

function StatusItem({ Icon, value, label, tone = "blue" }: { Icon: typeof Activity; value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="status-item">
      <span className={`status-icon ${tone}`}><Icon size={17} /></span>
      <span><strong>{value}</strong><small>{label}</small></span>
    </div>
  );
}
