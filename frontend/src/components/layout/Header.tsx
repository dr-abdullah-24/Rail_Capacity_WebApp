import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { Page, useAppStore } from "../../stores/appStore";

const TITLES: Record<Page, string> = {
  home:      "Welcome",
  upload:    "Upload Train Describer data",
  corridor:  "Select and inspect corridor",
  configure: "Configure a MILP run",
  runs:      "Monitor runs",
  results:   "Analyse results",
};

export function Header() {
  const page = useAppStore((s) => s.page);
  const online = useAppStore((s) => s.online);
  const health = useAppStore((s) => s.health);
  const repoMissing = online && !health?.milp_repo_exists;

  return (
    <div className="app-header">
      <div className="header-title">{TITLES[page]}</div>
      <div className="header-status">
        {online ? (
          <Wifi size={16} strokeWidth={2.2}
                style={{ color: "var(--success)" }} />
        ) : (
          <WifiOff size={16} strokeWidth={2.2}
                   style={{ color: "var(--danger)" }} />
        )}
        {repoMissing && (
          <AlertTriangle size={16} strokeWidth={2.2}
                         style={{ color: "var(--warn)", marginLeft: 6 }}
                         aria-label="MILP repo missing" />
        )}
      </div>
    </div>
  );
}
