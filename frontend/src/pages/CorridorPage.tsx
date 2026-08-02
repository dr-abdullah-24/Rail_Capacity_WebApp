import { useEffect, useState } from "react";
import {
  ArrowRight, MapPin, Milestone, PenSquare, PlusCircle,
  Route as RouteIcon, Trash2, User2, X,
} from "lucide-react";
import { deleteCorridor, getCorridor } from "../api/client";
import { CorridorBuilder } from "../components/corridor/CorridorBuilder";
import { CorridorMap } from "../components/corridor/CorridorMap";
import { RouteDiagram } from "../components/corridor/RouteDiagram";
import { useAppStore } from "../stores/appStore";

export function CorridorPage() {
  const corridors = useAppStore((s) => s.corridors);
  const selectedId = useAppStore((s) => s.selectedCorridorId);
  const selectCorridor = useAppStore((s) => s.selectCorridor);
  const activeCorridor = useAppStore((s) => s.activeCorridor);
  const setActiveCorridor = useAppStore((s) => s.setActiveCorridor);
  const refreshCorridors = useAppStore((s) => s.refreshCorridors);
  const setPage = useAppStore((s) => s.setPage);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    getCorridor(selectedId)
      .then(setActiveCorridor)
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete corridor "${name}"?`)) return;
    setBusy(true);
    try {
      await deleteCorridor(id);
      if (selectedId === id) selectCorridor("crewe_parkside");
      await refreshCorridors();
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", gap: 10 }}>
          <div>
            <h2><RouteIcon size={14} /> 2. Choose corridor</h2>
            <div className="card-sub">
              Pick a predefined corridor or build your own by searching
              rail locations. TIPLOC / CRS / STANOX / STANME identifiers
              are visible on the map.
            </div>
          </div>
          <button className={building ? "secondary" : "accent"}
                  onClick={() => setBuilding((b) => !b)}>
            {building
              ? <><X size={13} /> Cancel</>
              : <><PlusCircle size={13} /> Build new</>}
          </button>
        </div>

        {building && <CorridorBuilder onDone={() => setBuilding(false)} />}

        {!building && (
          <div style={{ display: "grid", gap: 10, marginTop: 4,
                        gridTemplateColumns:
                        "repeat(auto-fit, minmax(260px,1fr))" }}>
            {corridors.map((c) => {
              const isUser = c.kind === "user";
              const selected = selectedId === c.id;
              return (
                <div key={c.id} style={{
                  display: "flex", flexDirection: "column",
                  border: `1px solid ${selected
                    ? "var(--steel)" : "var(--border)"}`,
                  borderRadius: 6,
                  background: selected ? "var(--navy)" : "#fff",
                  color: selected ? "#fff" : "var(--navy)",
                  boxShadow: selected ? "var(--shadow-md)"
                                       : "var(--shadow-sm)",
                }}>
                  <button onClick={() => selectCorridor(c.id)}
                          className="ghost"
                          style={{
                            justifyContent: "flex-start",
                            textAlign: "left", padding: "10px 12px",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 4, background: "transparent",
                            color: "inherit",
                            border: 0,
                          }}>
                    <div style={{ display: "flex", alignItems: "center",
                                  gap: 6, fontWeight: 700, fontSize: 13 }}>
                      {isUser ? <User2 size={13} /> : <MapPin size={13} />}
                      {c.name}
                      {isUser && (
                        <span className="badge info"
                              style={{ marginLeft: "auto",
                                       fontSize: 10, padding: "1px 6px" }}>
                          custom
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.75 }}>
                      {c.n_stations} stations · {c.km_length.toFixed(1)} km
                    </div>
                    {c.description && (
                      <div style={{ fontSize: 11, opacity: 0.6,
                                    marginTop: 2 }}>
                        {c.description.length > 70
                          ? c.description.slice(0, 68) + "…"
                          : c.description}
                      </div>
                    )}
                  </button>
                  {isUser && (
                    <div style={{ borderTop: `1px solid ${selected
                                      ? "rgba(255,255,255,0.1)"
                                      : "var(--grey-1)"}`,
                                  display: "flex",
                                  justifyContent: "flex-end",
                                  padding: "6px 8px" }}>
                      <button className="ghost"
                              disabled={busy}
                              onClick={() => onDelete(c.id, c.name)}
                              style={{ color: selected ? "#fff"
                                                       : "var(--danger)" }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeCorridor && (
        <>
          <div className="card">
            <h2><Milestone size={14} /> Route diagram</h2>
            <div className="card-sub">
              {activeCorridor.description}
            </div>
            <RouteDiagram corridor={activeCorridor} />
          </div>

          <div className="card">
            <h2><MapPin size={14} /> Geographic map</h2>
            <div className="card-sub">
              Click a marker to see its TIPLOC / CRS / STANOX / STANME.
            </div>
            <CorridorMap corridor={activeCorridor} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setPage("configure")}
                    disabled={loading}>
              Next: configure run <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
    </>
  );
}
