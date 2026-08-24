import { useMemo } from "react";
import { HeatmapCell, InsertedOverlayCell } from "../../api/client";

interface Props {
  corridorNames: string[];
  junctionSeqs?: number[];
  heatmap: HeatmapCell[];
  overlay: InsertedOverlayCell[];
  direction: "northbound" | "southbound";
}

const BUCKETS = 96;   // 24 hours × 4 quarter-hours
const CELL_W  = 10;
const CELL_H  = 22;
const MARGIN_L = 130;
const MARGIN_T = 44;
const MARGIN_B = 24;

function bucketLabel(b: number): string {
  // Only label the first bucket of each hour (every 4th bucket)
  if (b % 4 !== 0) return "";
  return String(b / 4).padStart(2, "0");
}

/**
 * 15-minute × junction heatmap of existing traffic count, with
 * inserted-path cells overlaid as green dots.
 *
 * Each column is a 15-minute window (96 columns = full day).
 * Column labels show the hour number at each hour boundary (every 4th column).
 */
export function CapacityHeatmap(props: Props) {
  const { corridorNames, junctionSeqs, heatmap, overlay, direction } = props;

  // jSeqs[row_index] = actual junction_seq for that row.
  // Falls back to index==seq assumption when not provided.
  const jSeqs = useMemo(
    () => junctionSeqs ?? corridorNames.map((_, i) => i),
    [junctionSeqs, corridorNames],
  );

  // Reverse map: junction_seq → row index, for overlay dot positioning.
  const seqToRow = useMemo(
    () => new Map(jSeqs.map((seq, row) => [seq, row])),
    [jSeqs],
  );

  const filtered        = heatmap.filter((c) => c.direction === direction);
  const filteredOverlay = overlay.filter((c) => c.direction === direction);

  const maxCount = useMemo(
    () => filtered.reduce((m, c) => Math.max(m, c.count), 1),
    [filtered],
  );

  const W = MARGIN_L + BUCKETS * CELL_W + 12;
  const H = MARGIN_T + corridorNames.length * CELL_H + MARGIN_B;

  const cellAt = (row: number, b: number) =>
    filtered.find((c) => c.junction_seq === jSeqs[row] && c.bucket === b);

  const shade = (n: number) => {
    if (n === 0) return "#f8fafc";
    const t = n / maxCount;
    const r = Math.round(232 - t * 189);
    const g = Math.round(236 - t * 195);
    const b = Math.round(241 - t * 179);
    return `rgb(${r},${g},${b})`;
  };

  const bucketToHHMM = (b: number) => {
    const totalMin = b * 15;
    return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={W}
        height={H}
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 6,
          display: "block",
        }}
      >
        {/* Hour boundary labels (every 4th bucket) */}
        {Array.from({ length: BUCKETS }, (_, b) => {
          const label = bucketLabel(b);
          if (!label) return null;
          return (
            <text
              key={b}
              x={MARGIN_L + b * CELL_W + CELL_W / 2}
              y={MARGIN_T - 14}
              fontSize={10}
              textAnchor="middle"
              fill="#334155"
            >
              {label}
            </text>
          );
        })}

        {/* Tick marks at hour boundaries */}
        {Array.from({ length: BUCKETS }, (_, b) => {
          if (b % 4 !== 0) return null;
          return (
            <line
              key={b}
              x1={MARGIN_L + b * CELL_W}
              y1={MARGIN_T - 6}
              x2={MARGIN_L + b * CELL_W}
              y2={MARGIN_T - 2}
              stroke="#94a3b8"
              strokeWidth={1}
            />
          );
        })}

        <text
          x={MARGIN_L - 8}
          y={MARGIN_T - 14}
          fontSize={10}
          textAnchor="end"
          fill="#64748b"
        >
          hour
        </text>

        {corridorNames.map((name, j) => (
          <g key={j}>
            <text
              x={MARGIN_L - 8}
              y={MARGIN_T + j * CELL_H + CELL_H / 2 + 3}
              fontSize={11}
              textAnchor="end"
              fill="#334155"
            >
              {name}
            </text>

            {Array.from({ length: BUCKETS }, (_, b) => {
              const c     = cellAt(j, b);
              const count = c?.count ?? 0;
              const isHourBoundary = b % 4 === 0;
              return (
                <rect
                  key={b}
                  x={MARGIN_L + b * CELL_W}
                  y={MARGIN_T + j * CELL_H}
                  width={CELL_W - 0.5}
                  height={CELL_H - 1}
                  fill={shade(count)}
                  stroke={isHourBoundary ? "#cbd5e1" : "#e2e8f0"}
                  strokeWidth={isHourBoundary ? 0.8 : 0.3}
                >
                  <title>
                    {name} @ {bucketToHHMM(b)}-{bucketToHHMM(b + 1)} - {count} train{count === 1 ? "" : "s"}
                  </title>
                </rect>
              );
            })}
          </g>
        ))}

        {/* Inserted path overlays - green dot per 15-min bucket */}
        {filteredOverlay.map((c, i) => {
          const row = seqToRow.get(c.junction_seq);
          if (row == null) return null;
          return (
            <circle
              key={i}
              cx={MARGIN_L + c.bucket * CELL_W + CELL_W / 2}
              cy={MARGIN_T + row * CELL_H + CELL_H / 2}
              r={3}
              fill="rgba(34,160,107,0.85)"
              stroke="#0f6a45"
              strokeWidth={0.8}
            >
              <title>Inserted {c.path_id}</title>
            </circle>
          );
        })}
      </svg>

      <div style={{ fontSize: 11, color: "var(--grey-5)", marginTop: 6 }}>
        Each column = 15 minutes · hour labels at hour boundaries ·
        cell shade = existing trains in that window ·
        green dots = MILP-inserted freight paths
      </div>
    </div>
  );
}
