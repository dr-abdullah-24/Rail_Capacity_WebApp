import { CorridorDetail } from "../../api/client";

/**
 * Schematic of stations along a horizontal line.
 * When corridor station data includes n_berths (from SMART) the diagram
 * renders a capacity bar and count beneath each station node.
 */
export function RouteDiagram({ corridor, showBerths = true }:
  { corridor: CorridorDetail | null; showBerths?: boolean }) {
  if (!corridor) return null;

  const stations   = corridor.stations;
  const hasBerths  = showBerths && stations.some((s) => (s.n_berths ?? 0) > 0);
  const maxBerths  = hasBerths
    ? Math.max(...stations.map((s) => s.n_berths ?? 0), 1)
    : 0;

  const width  = Math.max(700, stations.length * 100);
  const height = hasBerths ? 175 : 140;
  const y      = 70;
  const stepX  = (width - 80) / Math.max(1, stations.length - 1);

  // Map 0–maxBerths to an orange intensity fill
  function berthFill(n: number): string {
    const t = maxBerths > 0 ? n / maxBerths : 0;
    const r = Math.round(238 + (161 - 238) * t);   // 238→161
    const g = Math.round(150 + (100 - 150) * t);   // 150→100
    const b = Math.round(75  + (50  - 75)  * t);   // 75→50
    return `rgb(${r},${g},${b})`;
  }

  return (
    <div style={{ overflowX: "auto",
                  border: "1px solid var(--border)", borderRadius: 8,
                  padding: 8, background: "#fff" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Spine */}
        <line x1={40} y1={y} x2={width - 40} y2={y}
              stroke="#3d5a80" strokeWidth={4} />

        {stations.map((s, i) => {
          const cx      = 40 + i * stepX;
          const isTerm  = i === 0 || i === stations.length - 1;
          const nb      = s.n_berths ?? 0;
          const barW    = 44;
          const barH    = 7;
          const filled  = maxBerths > 0 ? Math.round((nb / maxBerths) * barW) : 0;

          return (
            <g key={s.seq}>
              {/* Station circle */}
              <circle cx={cx} cy={y} r={10}
                      fill={isTerm ? "#b7402e" : "#3d5a80"}
                      stroke="#fff" strokeWidth={2} />
              <text x={cx} y={y + 3.5} fontSize={10} fontWeight={700}
                    fill="#fff" textAnchor="middle">{s.seq}</text>

              {/* Name above */}
              <text x={cx} y={y - 22} fontSize={11} fontWeight={600}
                    textAnchor="middle" fill="#0f172a">
                {s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name}
              </text>

              {/* TIPLOC / STANME */}
              <text x={cx} y={y + 26} fontSize={10}
                    textAnchor="middle" fill="#64748b">
                {s.tiploc || s.stanme}
              </text>

              {/* Chainage */}
              <text x={cx} y={y + 40} fontSize={10}
                    textAnchor="middle" fill="#94a3b8">
                {s.chainage_km.toFixed(1)} km
              </text>

              {/* Berth bar + count */}
              {hasBerths && (
                <>
                  {/* Background bar */}
                  <rect x={cx - barW / 2} y={y + 51}
                        width={barW} height={barH}
                        rx={3} fill="#f1f5f9" />
                  {/* Filled bar */}
                  {filled > 0 && (
                    <rect x={cx - barW / 2} y={y + 51}
                          width={filled} height={barH}
                          rx={3} fill={berthFill(nb)} />
                  )}
                  {/* Count label */}
                  <text x={cx} y={y + 73} fontSize={10} fontWeight={700}
                        textAnchor="middle"
                        fill={nb > 0 ? berthFill(nb) : "#94a3b8"}>
                    {nb > 0 ? `×${nb}` : "-"}
                  </text>
                  {/* "berths" label under first station only */}
                  {i === 0 && (
                    <text x={cx} y={y + 84} fontSize={9}
                          textAnchor="middle" fill="#94a3b8">
                      berths
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
