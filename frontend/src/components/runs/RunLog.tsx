import { useEffect, useRef, useState } from "react";
import { Radio, RadioTower } from "lucide-react";
import { getKpis, runLogStream } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
// note: useAppStore.getState() used below in the WS handler

export function RunLog() {
  const runId = useAppStore((s) => s.selectedRunId);
  const log = useAppStore((s) => s.log);
  const addLog = useAppStore((s) => s.addLog);
  const clearLog = useAppStore((s) => s.clearLog);
  const setKpis = useAppStore((s) => s.setKpis);
  const refresh = useAppStore((s) => s.refresh);
  const [wsStatus, setWsStatus] = useState<"idle" | "open" | "closed">("idle");
  const logRef = useRef<HTMLPreElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const online = useAppStore((s) => s.online);

  useEffect(() => {
    wsRef.current?.close();
    clearLog();
    if (!runId) { setWsStatus("idle"); return; }
    if (!online) {
      // Skip WS if backend is unreachable - avoids Vite proxy noise
      setWsStatus("closed");
      return;
    }

    const ws = runLogStream(runId, (m: any) => {
      if (m?.type === "log") addLog(m.line, m.prefix);
      else if (m?.type === "progress") {
        useAppStore.getState().setProgress({
          phase: m.phase, phase_pct: m.phase_pct,
          percent: m.percent,
          done_blocks: m.done_blocks, total_blocks: m.total_blocks,
          message: m.message,
          current_block: m.current_block ?? undefined,
          last_block_result: m.block_status ? {
            status: m.block_status,
            inserted: m.block_inserted,
            candidates: m.block_candidates,
            solve_s: m.block_solve_s,
          } : undefined,
        });
      }
      else if (m?.type === "status") {
        addLog(`[status] ${m.value}`, "status");
        if (m.value === "complete") {
          useAppStore.getState().setProgress({ percent: 100, phase: "milp" });
          getKpis(runId).then(setKpis).catch(() => {});
        }
        refresh();
      }
    }, () => setWsStatus("closed"));
    wsRef.current = ws;
    ws.onopen = () => setWsStatus("open");
    return () => ws.close();
  }, [runId, online]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  if (!runId) {
    return (
      <div style={{ color: "var(--grey-5)", fontSize: 13 }}>
        Select a run to see its output.
      </div>
    );
  }

  const Icon = wsStatus === "open" ? RadioTower : Radio;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8,
                    marginBottom: 8, fontSize: 12, color: "var(--grey-6)" }}>
        Run #{runId} output
      </div>
      <pre ref={logRef} className="log-term">
        {log.map((l, i) => (
          <div key={i}>
            <span className="prefix">
              {l.prefix ? `[${l.prefix}] ` : ""}
            </span>
            {l.line}
          </div>
        ))}
      </pre>
    </>
  );
}
