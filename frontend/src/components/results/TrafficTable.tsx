import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";
import { CorridorTrain } from "../../api/client";

interface Props {
  corridorNames: string[];
  existing: CorridorTrain[];
  inserted: CorridorTrain[];
}

type SortBy = "dep" | "arr" | "class" | "direction" | "kind";

export function TrafficTable({ corridorNames, existing, inserted }: Props) {
  const [filter, setFilter] = useState("");
  const [dirFilter, setDirFilter] = useState<"all" | "northbound" | "southbound">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "existing" | "inserted">("all");
  const [sortBy, setSortBy] = useState<SortBy>("dep");
  const [asc, setAsc] = useState(true);

  const rows = useMemo(() => {
    const all: CorridorTrain[] = [
      ...existing,
      ...inserted,
    ];
    let out = all;
    if (dirFilter !== "all") out = out.filter((r) => r.direction === dirFilter);
    if (kindFilter !== "all") out = out.filter((r) => r.kind === kindFilter);
    if (filter) {
      const f = filter.toLowerCase();
      out = out.filter((r) =>
        (r.headcode ?? r.path_id ?? "").toLowerCase().includes(f)
      );
    }
    out = [...out].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "dep":       cmp = a.dep_min - b.dep_min; break;
        case "arr":       cmp = a.arr_min - b.arr_min; break;
        case "class":     cmp = (a.class_digit || "z").localeCompare(b.class_digit || "z"); break;
        case "direction": cmp = a.direction.localeCompare(b.direction); break;
        case "kind":      cmp = a.kind.localeCompare(b.kind); break;
      }
      return asc ? cmp : -cmp;
    });
    return out;
  }, [existing, inserted, filter, dirFilter, kindFilter, sortBy, asc]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10,
                    flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="filter by headcode / path id"
               value={filter}
               onChange={(e) => setFilter(e.target.value)}
               style={{ minWidth: 200 }} />
        <select value={dirFilter}
                onChange={(e) => setDirFilter(e.target.value as any)}>
          <option value="all">both directions</option>
          <option value="northbound">northbound only</option>
          <option value="southbound">southbound only</option>
        </select>
        <select value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as any)}>
          <option value="all">existing + inserted</option>
          <option value="existing">existing only</option>
          <option value="inserted">inserted only</option>
        </select>
        <div style={{ marginLeft: "auto", fontSize: 12,
                      color: "var(--grey-6)" }}>
          Showing {rows.length} of {existing.length + inserted.length} trains
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, marginBottom: 8,
                    fontSize: 11, color: "var(--grey-6)",
                    alignItems: "center" }}>
        <span style={{ textTransform: "uppercase", letterSpacing: 0.05,
                       fontWeight: 600 }}>Confidence:</span>
        <LegendDot color="#22a06b" label="Green - inserted, no pathing time" />
        <LegendDot color="#dc7f00" label="Amber - inserted, needs pathing time" />
        <LegendDot color="#c92a2a" label="Red - inserted, heavy holds required" />
        <LegendDot color="#94a3b8" label="Grey - existing background traffic" />
        <span style={{ display: "inline-flex", alignItems: "center",
                       gap: 5 }}>
          <span style={{ background: "rgba(253,224,71,0.55)",
                         color: "#5b3a00", fontSize: 10,
                         padding: "1px 5px", borderRadius: 3,
                         fontWeight: 700 }}>+Xm</span>
          hold at station
        </span>
      </div>

      <div style={{ overflow: "auto",
                    maxHeight: 460,
                    border: "1px solid var(--border)",
                    borderRadius: 6 }}>
        <table className="data" style={{ width: "100%" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <SortHead label="" active={sortBy==="kind"} asc={asc}
                        onClick={() => toggle("kind")} />
              <th>Headcode / Path</th>
              <SortHead label="Dir" active={sortBy==="direction"} asc={asc}
                        onClick={() => toggle("direction")} />
              <SortHead label="Cls" active={sortBy==="class"} asc={asc}
                        onClick={() => toggle("class")} />
              <SortHead label="Dep" active={sortBy==="dep"} asc={asc}
                        onClick={() => toggle("dep")} />
              <SortHead label="Arr" active={sortBy==="arr"} asc={asc}
                        onClick={() => toggle("arr")} />
              <th>Dwell</th>
              {corridorNames.map((n, i) => (
                <th key={i} style={{ writingMode: "vertical-rl",
                                     textAlign: "left" }}>
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const bg = r.kind === "inserted"
                ? "rgba(34,160,107,0.10)" : undefined;
              const jByseq: Record<number, { hhmm: string; dwell: number }> = {};
              for (const j of r.junctions)
                jByseq[j.seq] = { hhmm: j.hhmm, dwell: j.dwell ?? 0 };
              return (
                <tr key={i} style={{ background: bg }}>
                  <td>
                    <RagDot train={r} />
                  </td>
                  <td style={{ fontFamily: "monospace" }}>
                    {r.headcode ?? r.path_id}
                  </td>
                  <td>
                    <span className={"badge " +
                      (r.direction === "northbound" ? "info" : "warn")}>
                      {r.direction === "northbound" ? "NB" : "SB"}
                    </span>
                  </td>
                  <td>{r.class_digit ?? ""}</td>
                  <td>{r.dep_hhmm}</td>
                  <td>{r.arr_hhmm}</td>
                  <td>{r.dwell_min ?? ""}</td>
                  {corridorNames.map((cn, si) => {
                    const entry = jByseq[si];
                    const dwell = entry?.dwell ?? 0;
                    const hold  = dwell > 0;
                    return (
                      <td key={si}
                          title={hold
                            ? `Hold ${dwell} min at ${cn}`
                            : undefined}
                          style={{
                            fontSize: 11,
                            color: hold ? "#8a5000" : "var(--grey-6)",
                            background: hold
                              ? "rgba(253,224,71,0.45)"
                              : undefined,
                            fontWeight: hold ? 700 : 400,
                            whiteSpace: "nowrap",
                          }}>
                        {entry?.hhmm ?? ""}
                        {hold && (
                          <span style={{ marginLeft: 4, fontSize: 10,
                                         background: "#fde68a",
                                         color: "#5b3a00",
                                         padding: "1px 4px",
                                         borderRadius: 3 }}>
                            +{dwell}m
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  function toggle(k: SortBy) {
    if (sortBy === k) setAsc(!asc);
    else { setSortBy(k); setAsc(true); }
  }
}

function SortHead({ label, active, asc, onClick }:
                   { label: string; active: boolean; asc: boolean;
                     onClick: () => void }) {
  return (
    <th style={{ cursor: "pointer", userSelect: "none" }} onClick={onClick}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {active && (asc
          ? <ArrowUpWideNarrow size={10} />
          : <ArrowDownWideNarrow size={10} />)}
      </span>
    </th>
  );
}

/** RAG dot for the confidence column, following STEER's report convention. */
function RagDot({ train }: { train: CorridorTrain }) {
  let color = "#94a3b8";     // grey - existing
  let title = "Existing corridor traffic";
  if (train.kind === "inserted") {
    const dwell = train.dwell_min ?? 0;
    if (dwell === 0) {
      color = "#22a06b";
      title = "Inserted path, clean fit (no pathing time required)";
    } else if (dwell < 5) {
      color = "#dc7f00";
      title = `Inserted path, needs ${dwell} min pathing time`;
    } else {
      color = "#c92a2a";
      title = `Inserted path, heavy pathing time required (${dwell} min)`;
    }
  }
  return (
    <span title={title}
          style={{
            display: "inline-block",
            width: 12, height: 12, borderRadius: "50%",
            background: color,
            boxShadow: `0 0 0 2px ${color}22`,
          }} />
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%",
                     background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
