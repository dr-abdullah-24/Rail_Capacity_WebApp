import {
  ArrowRight, BarChart3, Building2, Check, ChevronRight, Cpu, Database,
  GaugeCircle, GitBranch, LineChart, MapPinned, PlayCircle, Route,
  Settings2, TrainFront, TrendingUp, Upload as UploadIcon,
  Users, Wrench, Landmark, Clock, FileCheck, MoveHorizontal,
  Coins, Ruler, ClipboardCheck, Layers, CalendarDays, ScrollText,
} from "lucide-react";
import { useAppStore } from "../stores/appStore";

export function HomePage() {
  const setPage = useAppStore((s) => s.setPage);
  const runs = useAppStore((s) => s.runs);
  const uploads = useAppStore((s) => s.uploads);
  const corridors = useAppStore((s) => s.corridors);

  const nRuns = runs.length;
  const nUploads = uploads.length;
  const nCorridors = corridors.length;

  return (
    <>
      {/* Hero */}
      <div style={{ position: "relative",
                    background: "radial-gradient(circle at 90% 0%, "
                                + "#3d5a80 0%, #1e3d5f 40%, #142942 100%)",
                    borderRadius: 12, padding: "44px 48px",
                    color: "#fff", overflow: "hidden",
                    marginBottom: 20 }}>
        {/* Decorative rail lines */}
        <svg style={{ position: "absolute", right: 30, top: 30,
                      opacity: 0.14, pointerEvents: "none" }}
             width="360" height="220" viewBox="0 0 360 220">
          <g stroke="#fff" fill="none" strokeWidth="1.2">
            {[40, 90, 140, 190].map((y) => (
              <line key={y} x1="0" y1={y} x2="360" y2={y} />
            ))}
            {[60, 120, 180, 240, 300].map((x) => (
              <line key={x} x1={x} y1="30" x2={x} y2="200" />
            ))}
          </g>
          <TrainFront size={90} x="220" y="60" color="#ffffff" opacity="0.5" />
        </svg>

        <div style={{ maxWidth: 720 }}>
          <div style={{ display: "inline-flex", alignItems: "center",
                        gap: 6, padding: "4px 10px",
                        background: "rgba(255,255,255,0.12)",
                        borderRadius: 20, fontSize: 11, fontWeight: 600,
                        letterSpacing: 0.06,
                        textTransform: "uppercase", marginBottom: 16 }}>
            <TrainFront size={12} /> RailInsights &middot; Research platform
          </div>
          <h1 style={{ fontSize: 34, margin: 0, lineHeight: 1.15,
                       fontWeight: 700 }}>
            More freight on the network,
            <br />with the data you already have.
          </h1>
          <p style={{ fontSize: 15, opacity: 0.85, marginTop: 12,
                       maxWidth: 620, lineHeight: 1.55 }}>
            Open, defensible corridor capacity analytics from raw Train
            Describer telemetry.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <button className="accent" onClick={() => setPage("upload")}>
              <UploadIcon size={14} /> Start a study
            </button>
            <button className="secondary" onClick={() => setPage("corridor")}>
              <Route size={14} /> Corridors
            </button>
          </div>
        </div>
      </div>

      {/* Big stats strip */}
      <div className="grid cols-4"
           style={{ marginBottom: 16 }}>
        <StatCard icon={MapPinned} value="3,484" label="mapped rail locations"
                  tint="#3d5a80" />
        <StatCard icon={Route} value={nCorridors} label="corridors available"
                  tint="#22a06b" />
        <StatCard icon={UploadIcon} value={nUploads} label="TD files uploaded"
                  tint="#dc7f00" />
        <StatCard icon={PlayCircle} value={nRuns} label="MILP runs so far"
                  tint="#b7402e" />
      </div>

      {/* Workflow flow-diagram */}
      <div className="card">
        <h2><ChevronRight size={14} /> Workflow</h2>
        <div className="workflow-flow">
          {WORKFLOW.map((w, i) => (
            <div key={w.id} style={{ display: "contents" }}>
              <button className="workflow-node"
                      onClick={() => setPage(w.id as any)}>
                <div className="workflow-node-icon">
                  <w.Icon size={22} />
                </div>
                <div className="workflow-node-step">Step {i + 1}</div>
                <div className="workflow-node-title">{w.title}</div>
              </button>
              {i < WORKFLOW.length - 1 && (
                <div className="workflow-arrow">
                  <ChevronRight size={18} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Who benefits (icon-forward) */}
      <div className="card" style={{ background: "transparent",
                                     border: 0, boxShadow: "none",
                                     padding: "6px 0 4px 0",
                                     marginBottom: 4 }}>
        <h2 style={{ color: "var(--navy)", fontSize: 12,
                     letterSpacing: 0.05 }}>
          <Users size={13} /> Built for the whole freight decision chain
        </h2>
      </div>
      <div className="grid cols-3">
        <PersonaCard
          icon={TrainFront} tint="#3d5a80"
          role="Rail operators"
          headline="Prove a slot fits before you sell it"
          bullets={[
            { Icon: Clock,      text: "Same-day path feasibility from live TD data" },
            { Icon: FileCheck,  text: "Reproducible answers you can send a customer" },
            { Icon: MoveHorizontal, text: "Automatic pathing-time placement at loops" },
          ]}
          quote="Which hour of the day can accept a new class 6?" />

        <PersonaCard
          icon={Wrench} tint="#22a06b"
          role="Facility managers"
          headline="Turn utilisation into a capital-case"
          bullets={[
            { Icon: Ruler,        text: "Loop, junction and berth-level occupancy" },
            { Icon: GaugeCircle,  text: "Identify which pinch-point drives conflicts" },
            { Icon: Coins,        text: "Quantify freight uplift from small interventions" },
          ]}
          quote="Would a passing loop at Weaver Jn unlock 4 tpd?" />

        <PersonaCard
          icon={Landmark} tint="#b7402e"
          role="Policy makers"
          headline="Corridor-scale capacity, defensible answers"
          bullets={[
            { Icon: Layers,          text: "Whole-corridor NB/SB capacity in one figure" },
            { Icon: CalendarDays,    text: "Multi-day distributions, not single snapshots" },
            { Icon: ScrollText,      text: "Aligned to UK Timetable Planning Rules" },
          ]}
          quote="What is the true 2018-to-2026 headroom trend?" />
      </div>

      {/* Models roadmap */}
      <div className="card">
        <h2><GitBranch size={14} /> Analytical models</h2>
        <div className="grid cols-3" style={{ marginTop: 6 }}>
          <ModelTile icon={GaugeCircle} status="live"
                     title="Corridor Capacity" tint="#22a06b" />
          <ModelTile icon={TrendingUp} status="planned"
                     title="Freight Diversion" tint="#dc7f00" />
          <ModelTile icon={LineChart} status="planned"
                     title="Delay Attribution" tint="#94a3b8" />
        </div>
      </div>

      {/* Data foundation as icon grid */}
      <div className="card">
        <h2><Database size={14} /> Data foundation</h2>
        <div className="grid cols-4" style={{ marginTop: 6 }}>
          <DataTile icon={Cpu} name="TD feed" hint="berth-step events" />
          <DataTile icon={MapPinned} name="SMART" hint="berth locations" />
          <DataTile icon={GaugeCircle} name="BPLAN" hint="SRT + allowances" />
          <DataTile icon={Route} name="Corridors" hint="built-in + custom" />
        </div>
      </div>

      {/* CTA */}
      <div className="card"
           style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8,
            background: "linear-gradient(135deg, #b7402e, #e07856)",
            display: "grid", placeItems: "center", color: "#fff",
          }}>
            <PlayCircle size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "var(--navy)",
                          fontSize: 15 }}>
              Ready to run your first study?
            </div>
            <div style={{ fontSize: 12, color: "var(--grey-6)" }}>
              Upload → Corridor → Configure → Launch. Typically 2 minutes.
            </div>
          </div>
        </div>
        <button className="accent" onClick={() => setPage("upload")}>
          Begin <ArrowRight size={14} />
        </button>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "16px 0 4px 0",
                    fontSize: 12, color: "var(--grey-5)" }}>
        <Building2 size={12} style={{ verticalAlign: "middle",
                                      marginRight: 4 }} />
        Developed at{" "}
        <a href="https://www.ljmu.ac.uk" target="_blank" rel="noreferrer"
           style={{ fontWeight: 600 }}>
          Liverpool John Moores University
        </a>
      </div>
    </>
  );
}

// ---------- data ----------
const WORKFLOW = [
  { id: "upload",    Icon: UploadIcon, title: "Upload" },
  { id: "corridor",  Icon: MapPinned,  title: "Corridor" },
  { id: "configure", Icon: Settings2,  title: "Configure" },
  { id: "runs",      Icon: PlayCircle, title: "Run" },
  { id: "results",   Icon: BarChart3,  title: "Analyse" },
];

// ---------- sub-components ----------
function StatCard({ icon: Icon, value, label, tint }:
                   { icon: any; value: React.ReactNode;
                     label: string; tint: string }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--border)",
      borderRadius: 10, padding: 14,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 10,
        background: `${tint}18`, color: tint,
        display: "grid", placeItems: "center",
      }}>
        <Icon size={22} strokeWidth={2.2} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800,
                      color: "var(--navy)", lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: "var(--grey-6)",
                      textTransform: "uppercase",
                      letterSpacing: 0.05, marginTop: 4 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

interface PersonaBullet { Icon: any; text: string }
interface PersonaProps {
  icon: any; tint: string; role: string;
  headline: string; bullets: PersonaBullet[]; quote: string;
}
function PersonaCard({ icon: Icon, tint, role, headline,
                       bullets, quote }: PersonaProps) {
  return (
    <div className="persona"
         style={{
           background: "#fff",
           borderRadius: 12,
           border: "1px solid var(--border)",
           overflow: "hidden",
           display: "flex", flexDirection: "column",
           boxShadow: "var(--shadow-sm)",
           transition: "transform 120ms, box-shadow 120ms",
         }}
         onMouseEnter={(e) => {
           (e.currentTarget as HTMLElement).style.transform =
             "translateY(-3px)";
           (e.currentTarget as HTMLElement).style.boxShadow =
             "var(--shadow-md)";
         }}
         onMouseLeave={(e) => {
           (e.currentTarget as HTMLElement).style.transform = "";
           (e.currentTarget as HTMLElement).style.boxShadow =
             "var(--shadow-sm)";
         }}>
      {/* Coloured banner */}
      <div style={{
        background:
          `linear-gradient(135deg, ${tint} 0%, ${shade(tint, -18)} 100%)`,
        color: "#fff",
        padding: "16px 18px",
        display: "flex", alignItems: "center", gap: 12,
        position: "relative", overflow: "hidden",
      }}>
        {/* Decorative dot pattern */}
        <svg style={{ position: "absolute", right: -10, top: -10,
                       opacity: 0.20 }} width="90" height="90">
          {Array.from({ length: 5 }, (_, r) =>
            Array.from({ length: 5 }, (_, c) => (
              <circle key={`${r}-${c}`}
                      cx={c * 18 + 8} cy={r * 18 + 8}
                      r={2} fill="#fff" />
            ))).flat()}
        </svg>

        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: "rgba(255,255,255,0.20)",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Icon size={22} strokeWidth={2} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: 0.08,
                        textTransform: "uppercase",
                        opacity: 0.85 }}>{role}</div>
          <div style={{ fontSize: 15, fontWeight: 700,
                        marginTop: 3, lineHeight: 1.25 }}>
            {headline}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 18px",
                    display: "flex", flexDirection: "column",
                    gap: 10, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column",
                      gap: 8 }}>
          {bullets.map((b, i) => (
            <div key={i}
                 style={{ display: "flex", alignItems: "flex-start",
                          gap: 10 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 6,
                background: `${tint}15`,
                color: tint,
                display: "grid", placeItems: "center", flexShrink: 0,
              }}>
                <b.Icon size={14} strokeWidth={2.2} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--grey-8)",
                            lineHeight: 1.45,
                            paddingTop: 5 }}>
                {b.text}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: "1px dashed var(--grey-2)",
          fontSize: 12,
          color: "var(--grey-6)",
          fontStyle: "italic",
          display: "flex", gap: 6, alignItems: "flex-start",
        }}>
          <span style={{ color: tint, fontWeight: 700,
                         fontSize: 16, lineHeight: 1 }}>&ldquo;</span>
          {quote}
          <span style={{ color: tint, fontWeight: 700,
                         fontSize: 16, lineHeight: 1 }}>&rdquo;</span>
        </div>
      </div>
    </div>
  );
}

/** Darken or lighten a hex color by percent (-100..100). */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  const f = 1 + pct / 100;
  r = Math.max(0, Math.min(255, Math.round(r * f)));
  g = Math.max(0, Math.min(255, Math.round(g * f)));
  b = Math.max(0, Math.min(255, Math.round(b * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function ModelTile({ icon: Icon, status, title, tint }:
                    { icon: any; status: "live" | "planned";
                      title: string; tint: string }) {
  const alive = status === "live";
  return (
    <div style={{
      background: "#fff", border: `1px solid ${alive
        ? "var(--border)" : "var(--grey-2)"}`,
      borderRadius: 10, padding: 14,
      display: "flex", alignItems: "center", gap: 12,
      opacity: alive ? 1 : 0.7,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: alive ? `${tint}20` : "var(--grey-1)",
        color: alive ? tint : "var(--grey-4)",
        display: "grid", placeItems: "center",
      }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: "var(--navy)",
                      fontSize: 13 }}>{title}</div>
        <span className={"badge " + (alive ? "ok" : "pending")}
              style={{ fontSize: 10, marginTop: 4 }}>
          {alive ? "Live" : "Planned"}
        </span>
      </div>
    </div>
  );
}

function DataTile({ icon: Icon, name, hint }:
                   { icon: any; name: string; hint: string }) {
  return (
    <div style={{
      background: "var(--grey-0)", border: "1px solid var(--border)",
      borderRadius: 10, padding: 12,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: "#fff", color: "var(--steel)",
        display: "grid", placeItems: "center",
        border: "1px solid var(--border)",
      }}>
        <Icon size={17} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: "var(--navy)",
                      fontSize: 13 }}>{name}</div>
        <div style={{ fontSize: 11, color: "var(--grey-6)" }}>{hint}</div>
      </div>
    </div>
  );
}
