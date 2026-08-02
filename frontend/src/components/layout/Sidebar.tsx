import {
  Upload as UploadIcon, MapPinned, Settings2, PlayCircle, BarChart3,
  TrainFront, Home,
} from "lucide-react";
import { Page, useAppStore } from "../../stores/appStore";

interface Item {
  id: Page;
  label: string;
  Icon: typeof UploadIcon;
  showStep?: boolean;
}

const ITEMS: Item[] = [
  { id: "home",      label: "Home",            Icon: Home,       showStep: false },
  { id: "upload",    label: "Upload TD data",  Icon: UploadIcon, showStep: true },
  { id: "corridor",  label: "Corridor",        Icon: MapPinned,  showStep: true },
  { id: "configure", label: "Configure run",   Icon: Settings2,  showStep: true },
  { id: "runs",      label: "Runs",            Icon: PlayCircle, showStep: true },
  { id: "results",   label: "Results",         Icon: BarChart3,  showStep: true },
];

export function Sidebar() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const runs = useAppStore((s) => s.runs);
  const activeRuns = runs.filter(
    (r) => r.status === "running" || r.status === "pending"
  ).length;

  return (
    <div className="app-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark"><TrainFront size={18} /></div>
        <div>
          <div className="sidebar-brand-name">RailInsights</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {ITEMS.map(({ id, label, Icon, showStep }, idx) => {
          // Workflow step count excludes Home (idx 0)
          const step = idx;    // Home=0 (hidden), Upload=1, ..., Results=5
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={
                "sidebar-nav-item" + (page === id ? " active" : "")
              }
            >
              <Icon size={16} strokeWidth={2} />
              {label}
              {showStep && (
                <span className="step">
                  {id === "runs" && activeRuns > 0 ? activeRuns : step}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-affiliation">
        <div className="sidebar-affiliation-label">
          A research tool developed at
        </div>
        <a href="https://www.ljmu.ac.uk" target="_blank" rel="noreferrer"
           title="Liverpool John Moores University">
          <img src="/ljmu-logo.png" alt="Liverpool John Moores University"
               className="sidebar-affiliation-logo" />
        </a>
      </div>
    </div>
  );
}
