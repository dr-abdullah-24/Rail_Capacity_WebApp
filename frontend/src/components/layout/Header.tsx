import { AlertTriangle, Bell, CircleHelp, Wifi, WifiOff } from "lucide-react";
import { Page, useAppStore } from "../../stores/appStore";

const TITLES: Record<Page, string> = {
  home:      "Study workspace",
  upload:    "Upload Train Describer data",
  corridor:  "Select and inspect corridor",
  configure: "Configure a MILP run",
  runs:      "Monitor runs",
  results:   "Analyse results",
  tpr:       "TPR Library",
};

export function Header() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const online = useAppStore((s) => s.online);
  const health = useAppStore((s) => s.health);
  const repoMissing = online && !health?.milp_repo_exists;

  return (
    <div className="app-header">
      <div className="header-heading">
        <span className="header-context">RAIL INSIGHTS PLATFORM / {page.toUpperCase()}</span>
        <div className="header-title">{TITLES[page]}</div>
      </div>
      <div className="header-status">
        <button className="header-icon" aria-label="Open planning rules" title="Train Planning Rules" onClick={() => setPage('tpr')}><CircleHelp size={16} /></button>
        <button className="header-icon" aria-label="Open run monitor" title="Run monitor" onClick={() => setPage('runs')}><Bell size={16} /></button>
        <div className={`connection-pill ${online ? "online" : "offline"}`}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {online ? "Engine online" : "Engine offline"}
        </div>
        {repoMissing && (
          <AlertTriangle size={16} strokeWidth={2.2}
                         style={{ color: "var(--warn)", marginLeft: 6 }}
                         aria-label="MILP repo missing" />
        )}
      </div>
    </div>
  );
}
