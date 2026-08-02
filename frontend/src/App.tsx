import { useEffect } from "react";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { ConfigPage } from "./pages/ConfigPage";
import { CorridorPage } from "./pages/CorridorPage";
import { HomePage } from "./pages/HomePage";
import { ResultsPage } from "./pages/ResultsPage";
import { RunsPage } from "./pages/RunsPage";
import { UploadPage } from "./pages/UploadPage";
import { useAppStore } from "./stores/appStore";

export function App() {
  const page = useAppStore((s) => s.page);
  const refresh = useAppStore((s) => s.refresh);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <Header />
      <div className="app-main">
        {page === "home"      && <HomePage />}
        {page === "upload"    && <UploadPage />}
        {page === "corridor"  && <CorridorPage />}
        {page === "configure" && <ConfigPage />}
        {page === "runs"      && <RunsPage />}
        {page === "results"   && <ResultsPage />}
      </div>
    </div>
  );
}
