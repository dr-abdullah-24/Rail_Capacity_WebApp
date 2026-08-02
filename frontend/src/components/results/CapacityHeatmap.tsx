import { useMemo } from "react";
import { HeatmapCell, InsertedOverlayCell } from "../../api/client";

interface Props {
  corridorNames: string[];
  heatmap: HeatmapCell[];
  overlay: InsertedOverlayCell[];
  direction: "northbound" | "southbound";
}

/**
 * Hour x junction heatmap of existing traffic count, with inserted-path
 * cells overlaid as small green diamonds.
 */
export function CapacityHeatmap(props: Props) {
  const { corridorNames, heatmap, overlay, direction } = props;

  const filtered = heatmap.filter((c) => c.direction === direction);
  const filteredOverlay = overlay.filter((c) => c.direction === direction);

  const maxCount = useMemo(
    () => filtered.reduce((m, c) => Math.max(m, c.count), 1),
    [filtered]);

  const cellW = 28, cellH = 22;
  const marginL = 130, marginT = 40, marginB = 30;
  const W = marginL + 24 * cellW + 12;
  const H = marginT + corridorNames.length * cellH + marginB;

  const idx = (j: number, h: number) =>
    filtered.find((c) => c.junction_seq === j && c.hour === h);

  const shade = (n: number) => {
    if (n === 0) return "#f8fafc";
    const t = n / maxCount;
    // navy gradient 0 -> 1
    const r = 232 - t * 189;
    const g = 236 - t * 195;
    const b = 241 - t * 179;
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{
        background: "#fff", border: "1px solid var(--border)",
        borderRadius: 6, display: "block",
      }}>
        {/* Hour headers */}
        {Array.from({ length: 24 }, (_, h) => (
          <text key={h}
                x={marginL + h * cellW + cellW / 2}
                y={marginT - 12}
                fontSize={10} textAnchor="middle" fill="#334155">
            {String(h).padStart(2, "0")}
          </text>
        ))}
        <text x={marginL - 8} y={marginT - 12} fontSize={10}
              textAnchor="end" fill="#64748b">hour</text>

        {corridorNames.map((n, j) => (
          <g key={j}>
            <text x={marginL - 8} y={marginT + j * cellH + cellH / 2 + 3}
                  fontSize={11} textAnchor="end" fill="#334155">{n}</text>
            {Array.from({ length: 24 }, (_, h) => {
              const c = idx(j, h);
              const count = c?.count ?? 0;
              return (
                <g key={h}>
                  <rect x={marginL + h * cellW}
                        y={marginT + j * cellH}
                        width={cellW - 1} height={cellH - 1}
                        fill={shade(count)}
                        stroke="#e2e8f0" strokeWidth={0.5}>
                    <title>{n} @ {h}:00 — {count} train{count === 1 ? "" : "s"}</title>
                  </rect>
                  {count > 0 && (
                    <text x={marginL + h * cellW + cellW / 2}
                          y={marginT + j * cellH + cellH / 2 + 3}
                          fontSize={9} textAnchor="middle"
                          fill={count > maxCount / 2 ? "#f8fafc" : "#334155"}>
                      {count}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* Inserted overlays */}
        {filteredOverlay.map((c, i) => (
          <circle key={i}
                  cx={marginL + c.hour * cellW + cellW / 2}
                  cy={marginT + c.junction_seq * cellH + cellH / 2}
                  r={4}
                  fill="rgba(34,160,107,0.85)"
                  stroke="#0f6a45" strokeWidth={1}>
            <title>Inserted {c.path_id}</title>
          </circle>
        ))}
      </svg>
      <div style={{ fontSize: 11, color: "var(--grey-5)", marginTop: 6 }}>
        Cell shade = existing trains per hour at that junction ·
        green dots = MILP-inserted freight paths ·
        empty (white) cells indicate slots where new freight can fit.
      </div>
    </div>
  );
}
