import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, CheckCircle2, Loader2, MapPin, Plus, Save,
  Search, Trash2, X,
} from "lucide-react";
import {
  LocationHit, createCorridor, searchLocations,
} from "../../api/client";
import { useAppStore } from "../../stores/appStore";

interface Props { onDone?: () => void; }

export function CorridorBuilder({ onDone }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LocationHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [stations, setStations] = useState<LocationHit[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshCorridors = useAppStore((s) => s.refreshCorridors);
  const selectCorridor = useAppStore((s) => s.selectCorridor);

  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) { setHits([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try { setHits(await searchLocations(query, 20)); }
      catch { setHits([]); }
      finally { setSearching(false); }
    }, 200) as unknown as number;
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const keyOf = (h: LocationHit) =>
    `${h.tiploc}|${h.stanox}|${h.name}`;
  const chosenKeys = useMemo(
    () => new Set(stations.map(keyOf)), [stations]);

  function addStation(h: LocationHit) {
    if (chosenKeys.has(keyOf(h))) return;   // already added
    setStations((s) => [...s, h]);
  }
  function removeStation(idx: number) {
    setStations((s) => s.filter((_, i) => i !== idx));
  }
  function move(idx: number, delta: number) {
    setStations((s) => {
      const next = [...s];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError("name required"); return; }
    if (stations.length < 2) {
      setError("select at least two stations"); return;
    }
    setSaving(true);
    try {
      const created = await createCorridor({
        name: name.trim(),
        description: description.trim(),
        stations,
      });
      await refreshCorridors();
      selectCorridor(created.id);
      // reset
      setStations([]); setName(""); setDescription("");
      setQuery(""); setHits([]);
      onDone?.();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="grid cols-2">
        <div>
          <label style={lblStyle}>
            <Search size={12} /> Search for a rail location
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={query}
                   onChange={(e) => setQuery(e.target.value)}
                   placeholder="Crewe, HTF, WBQ, HARTFDJ, 42133 ..."
                   style={{ flex: 1 }} />
            {query && (
              <button className="ghost" onClick={() => setQuery("")}
                      title="Clear">
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ marginTop: 8, maxHeight: 340, overflowY: "auto",
                        border: "1px solid var(--border)",
                        borderRadius: 6, background: "#fff" }}>
            {!query && (
              <div style={emptyStyle}>
                Type a station name, TIPLOC, CRS, or STANOX to search
                {" "}<b>3,484 UK rail locations</b>.
              </div>
            )}
            {query && searching && (
              <div style={emptyStyle}>
                <Loader2 size={14} className="spin" /> searching&hellip;
              </div>
            )}
            {query && !searching && hits.length === 0 && (
              <div style={emptyStyle}>no matches</div>
            )}
            {hits.map((h) => {
              const already = chosenKeys.has(keyOf(h));
              return (
                <div key={keyOf(h)} style={hitStyle}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13,
                                  color: "var(--navy)" }}>
                      {h.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--grey-5)",
                                  marginTop: 2 }}>
                      {h.tiploc && <><b>TIPLOC</b> {h.tiploc} · </>}
                      {h.crs && <><b>CRS</b> {h.crs} · </>}
                      {h.stanox && <><b>STANOX</b> {h.stanox} · </>}
                      {h.lat != null
                        ? <>{h.lat.toFixed(4)}, {h.lon!.toFixed(4)}</>
                        : <span style={{ color: "var(--warn)" }}>
                            no coords
                          </span>}
                    </div>
                  </div>
                  <button
                    className={already ? "ghost" : "secondary"}
                    disabled={already || h.lat == null}
                    onClick={() => addStation(h)}
                    title={h.lat == null
                      ? "location has no coordinates - skip"
                      : already ? "already added" : "add to corridor"}>
                    {already
                      ? <CheckCircle2 size={13} color="var(--success)" />
                      : <Plus size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label style={lblStyle}>
            <MapPin size={12} /> Corridor stations ({stations.length})
          </label>
          <div style={{ border: "1px solid var(--border)",
                        borderRadius: 6, background: "#fff",
                        minHeight: 200, maxHeight: 340, overflowY: "auto" }}>
            {stations.length === 0 && (
              <div style={emptyStyle}>
                Add stations from the search on the left.
                Order them from one end of the corridor to the other.
              </div>
            )}
            {stations.map((s, i) => (
              <div key={keyOf(s) + i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--grey-1)",
              }}>
                <span style={{
                  minWidth: 24, height: 24, borderRadius: "50%",
                  background: i === 0 || i === stations.length - 1
                    ? "var(--accent)" : "var(--steel)",
                  color: "#fff", display: "grid", placeItems: "center",
                  fontSize: 11, fontWeight: 700,
                }}>{i}</span>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: "var(--navy)" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--grey-5)" }}>
                    {[s.tiploc, s.crs, s.stanox].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button className="ghost" title="Move up"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}>
                  <ArrowUp size={13} />
                </button>
                <button className="ghost" title="Move down"
                        disabled={i === stations.length - 1}
                        onClick={() => move(i, 1)}>
                  <ArrowDown size={13} />
                </button>
                <button className="ghost" title="Remove"
                        onClick={() => removeStation(i)}>
                  <Trash2 size={13} color="var(--danger)" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10,
                    gridTemplateColumns: "1fr 2fr auto" }}>
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Corridor name" />
        <input value={description}
               onChange={(e) => setDescription(e.target.value)}
               placeholder="Optional description" />
        <button className="accent"
                disabled={saving || stations.length < 2 || !name.trim()}
                onClick={save}>
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
          Save corridor
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}
    </>
  );
}

const lblStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  fontSize: 12, color: "var(--grey-6)", marginBottom: 4,
  fontWeight: 500,
};

const emptyStyle: React.CSSProperties = {
  padding: 14, fontSize: 12, color: "var(--grey-5)",
  display: "flex", alignItems: "center", gap: 6,
  justifyContent: "center", minHeight: 60,
};

const hitStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--grey-1)",
};
