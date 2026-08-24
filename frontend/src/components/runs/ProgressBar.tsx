import { CheckCircle2, Cpu, Database, Loader2, ScanText } from "lucide-react";
import { useAppStore } from "../../stores/appStore";

const PHASES = [
  { id: "extract",  label: "Extract",  Icon: ScanText },
  { id: "baseline", label: "Baseline", Icon: Database },
  { id: "milp",     label: "MILP",     Icon: Cpu },
] as const;

export function ProgressBar() {
  const p = useAppStore((s) => s.progress);
  const runId = useAppStore((s) => s.selectedRunId);
  if (!runId || p.phase === "idle") return null;

  const done = p.percent >= 100;

  return (
    <div style={{
      background: "#fff", border: "1px solid var(--border)",
      borderRadius: 8, padding: 14, marginBottom: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center",
                      fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>
          {done ? (
            <CheckCircle2 size={16} color="var(--success)" />
          ) : (
            <Loader2 size={16} className="spin" color="var(--steel)" />
          )}
          Run #{runId} · {done ? "complete" : p.message || `${p.phase}`}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700,
                      color: done ? "var(--success)" : "var(--navy)" }}>
          {p.percent.toFixed(0)}%
        </div>
      </div>

      <div style={{ height: 10, background: "var(--grey-2)",
                    borderRadius: 6, overflow: "hidden",
                    position: "relative" }}>
        <div style={{
          height: "100%", width: `${p.percent}%`,
          background: done
            ? "linear-gradient(90deg, #22a06b, #34d399)"
            : "linear-gradient(90deg, #3d5a80, #6087b8)",
          transition: "width 300ms ease",
        }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8, marginTop: 12 }}>
        {PHASES.map((ph, i) => {
          const idx = PHASES.findIndex((x) => x.id === p.phase);
          const state = i < idx || done ? "done"
                       : i === idx ? "active"
                       : "pending";
          const color = state === "done"    ? "var(--success)"
                      : state === "active"  ? "var(--steel)"
                      :                        "var(--grey-4)";
          const bg    = state === "done"    ? "rgba(34,160,107,0.10)"
                      : state === "active"  ? "rgba(61,90,128,0.10)"
                      :                        "var(--grey-1)";
          return (
            <div key={ph.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: 6, background: bg,
              border: `1px solid ${state === "pending"
                                    ? "var(--border)" : color}`,
            }}>
              {state === "active"
                ? <Loader2 size={14} color={color} className="spin" />
                : state === "done"
                  ? <CheckCircle2 size={14} color={color} />
                  : <ph.Icon size={14} color={color} />}
              <div style={{ fontSize: 12, color, fontWeight: 600 }}>
                {ph.label}
              </div>
              {state === "active" && p.phase === "milp"
                && p.total_blocks > 0 && (
                <div style={{ marginLeft: "auto", fontSize: 11,
                              color: "var(--grey-6)" }}>
                  {p.done_blocks}/{p.total_blocks} blocks
                </div>
              )}
            </div>
          );
        })}
      </div>

      {p.current_block && !done && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--grey-6)" }}>
          Solving{" "}
          <span className="badge info" style={{ padding: "2px 8px" }}>
            {p.current_block.direction}
          </span>
          {" "}block {p.current_block.index} -{" "}
          {String(p.current_block.hour_start).padStart(2, "0")}
          :00 to {String(p.current_block.hour_end).padStart(2, "0")}:59
        </div>
      )}
    </div>
  );
}
