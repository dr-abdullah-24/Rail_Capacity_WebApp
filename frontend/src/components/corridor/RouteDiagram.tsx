import { CorridorDetail } from "../../api/client";

/**
 * Simple schematic — stations rendered as circles evenly along a
 * horizontal line, labeled with sequence, name and chainage.
 */
export function RouteDiagram({ corridor }:
                              { corridor: CorridorDetail | null }) {
  if (!corridor) return null;
  const stations = corridor.stations;
  const width = Math.max(700, stations.length * 100);
  const height = 140;
  const y = 60;
  const stepX = (width - 80) / Math.max(1, stations.length - 1);

  return (
    <div style={{ overflowX: "auto",
                  border: "1px solid var(--border)", borderRadius: 8,
                  padding: 8, background: "#fff" }}>
      <svg width={width} height={height}
           style={{ display: "block" }}>
        <line x1={40} y1={y} x2={width - 40} y2={y}
              stroke="#3d5a80" strokeWidth={4} />
        {stations.map((s, i) => {
          const cx = 40 + i * stepX;
          const isTerm = i === 0 || i === stations.length - 1;
          return (
            <g key={s.seq}>
              <circle cx={cx} cy={y} r={10}
                      fill={isTerm ? "#b7402e" : "#3d5a80"}
                      stroke="#fff" strokeWidth={2} />
              <text x={cx} y={y + 3} fontSize={10} fontWeight={700}
                    fill="#fff" textAnchor="middle">{s.seq}</text>
              <text x={cx} y={y - 20} fontSize={11}
                    textAnchor="middle" fill="#0f172a"
                    style={{ fontWeight: 600 }}>
                {s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name}
              </text>
              <text x={cx} y={y + 24} fontSize={10}
                    textAnchor="middle" fill="#64748b">
                {s.tiploc || s.stanme}
              </text>
              <text x={cx} y={y + 38} fontSize={10}
                    textAnchor="middle" fill="#94a3b8">
                {s.chainage_km.toFixed(1)} km
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
