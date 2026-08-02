import { useEffect, useMemo, useState } from "react";
import { CorridorTrain } from "../../api/client";
import { Pause, Play, StepForward, RotateCcw } from "lucide-react";

type Dir = "northbound" | "southbound" | "both";

interface Props {
  corridorNames: string[];
  existing: CorridorTrain[];
  inserted: CorridorTrain[];
  direction: Dir;
  onDirectionChange?: (d: Dir) => void;
  operatingStart?: number;   // 0-23, if window enabled
  operatingEnd?: number;     // 1-24, if window enabled
}

/**
 * Space-time diagram.
 *   X = time of day (minutes 0-1440)
 *   Y = corridor junction sequence (0 top, high seq bottom)
 * Existing traffic drawn as thin grey polylines behind.
 * Inserted paths drawn as thick colored polylines, revealed one-by-one
 * on the animation clock.
 */
export function SpaceTimeDiagram(props: Props) {
  const { corridorNames, existing, inserted, direction,
          onDirectionChange, operatingStart, operatingEnd } = props;

  const filteredExisting = useMemo(
    () => direction === "both"
      ? existing
      : existing.filter((t) => t.direction === direction),
    [existing, direction]);
  const filteredInserted = useMemo(
    () => direction === "both"
      ? inserted
      : inserted.filter((t) => t.direction === direction),
    [inserted, direction]);

  const nJunc = corridorNames.length;
  const W = 1080, H = 460;
  const marginL = 130, marginR = 12, marginT = 12, marginB = 30;
  const innerW = W - marginL - marginR;
  const innerH = H - marginT - marginB;
  const xFor = (m: number) => marginL + (m / 1440) * innerW;
  const yFor = (seq: number) =>
    marginT + (seq / Math.max(1, nJunc - 1)) * innerH;

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);

  const insertedSorted = useMemo(
    () => [...filteredInserted].sort((a, b) => a.dep_min - b.dep_min),
    [filteredInserted]);

  useEffect(() => {
    if (!playing) return;
    if (step >= insertedSorted.length) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((s) => s + 1), 500);
    return () => clearTimeout(t);
  }, [playing, step, insertedSorted.length]);

  const shownInserted = insertedSorted.slice(0, step);

  const hourTicks = Array.from({ length: 25 }, (_, i) => i);
  const dirColor = (d: string) =>
    d === "northbound" ? "#3d5a80" : "#8b5a2b";

  const insertedColors = ["#b7402e", "#22a06b", "#dc7f00",
                          "#4c6ef5", "#8b5cf6", "#e83e8c"];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center",
                    flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button className={direction === "both" ? "" : "secondary"}
                onClick={() => onDirectionChange?.("both")}>Both</button>
        <button className={direction === "northbound" ? "" : "secondary"}
                onClick={() => onDirectionChange?.("northbound")}>NB</button>
        <button className={direction === "southbound" ? "" : "secondary"}
                onClick={() => onDirectionChange?.("southbound")}>SB</button>
        <span style={{ width: 1, height: 24,
                       background: "var(--border)", margin: "0 4px" }} />
        <button className="secondary" onClick={() => setStep(0)}>
          <RotateCcw size={12} /> Reset
        </button>
        <button onClick={() => {
                  if (step >= insertedSorted.length) setStep(0);
                  setPlaying((p) => !p);
                }}>
          {playing
            ? <><Pause size={12} /> Pause</>
            : <><Play size={12} /> Play</>}
        </button>
        <button className="secondary"
                onClick={() => setStep((s) =>
                  Math.min(insertedSorted.length, s + 1))}>
          <StepForward size={12} /> Step
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12,
                      color: "var(--grey-6)" }}>
          Inserted {shownInserted.length} / {insertedSorted.length}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{
             background: "#fff", border: "1px solid var(--border)",
             borderRadius: 6, display: "block",
             width: "100%", height: "auto",
           }}>
        {/* Y-axis (junction labels) */}
        {corridorNames.map((n, i) => (
          <g key={i}>
            <text x={marginL - 8} y={yFor(i) + 3} fontSize={11}
                  textAnchor="end" fill="#334155">
              {n}
            </text>
            <line x1={marginL} y1={yFor(i)}
                  x2={W - marginR} y2={yFor(i)}
                  stroke="#e2e8f0" strokeWidth={1} />
          </g>
        ))}
        {/* X-axis (hour labels) */}
        {hourTicks.map((h) => (
          <g key={h}>
            <line x1={xFor(h * 60)} y1={marginT}
                  x2={xFor(h * 60)} y2={H - marginB}
                  stroke={h % 6 === 0 ? "#cbd5e1" : "#f1f5f9"}
                  strokeWidth={1} />
            <text x={xFor(h * 60)} y={H - 10} fontSize={10}
                  textAnchor="middle" fill="#64748b">
              {String(h).padStart(2, "0")}
            </text>
          </g>
        ))}
        {/* Closed / non-operating hours band */}
        {operatingStart != null && operatingEnd != null &&
          (operatingStart > 0 || operatingEnd < 24) && (
          <g>
            {operatingStart > 0 && (
              <rect x={xFor(0)} y={marginT}
                    width={xFor(operatingStart * 60) - xFor(0)}
                    height={innerH}
                    fill="rgba(202,138,4,0.10)" />
            )}
            {operatingEnd < 24 && (
              <rect x={xFor(operatingEnd * 60)} y={marginT}
                    width={xFor(24 * 60) - xFor(operatingEnd * 60)}
                    height={innerH}
                    fill="rgba(202,138,4,0.10)" />
            )}
            <text x={xFor(operatingStart * 60 / 2)}
                  y={marginT + 14} fontSize={10}
                  fill="#9a5b00" textAnchor="middle"
                  style={{ fontStyle: "italic" }}>
              closed
            </text>
          </g>
        )}
        {/* Existing traffic (grey) */}
        {filteredExisting.map((t, i) => (
          <polyline key={"e" + i}
                    fill="none"
                    stroke={dirColor(t.direction)}
                    strokeOpacity={0.20}
                    strokeWidth={1}
                    points={t.junctions
                      .map((j) => `${xFor(j.t_min)},${yFor(j.seq)}`)
                      .join(" ")} />
        ))}
        {/* Inserted paths (color) */}
        {shownInserted.map((t, i) => {
          const c = insertedColors[i % insertedColors.length];
          const pts = t.junctions
                       .map((j) => `${xFor(j.t_min)},${yFor(j.seq)}`)
                       .join(" ");
          return (
            <g key={"i" + i}>
              <polyline fill="none" stroke={c} strokeWidth={3}
                        strokeLinejoin="round" strokeLinecap="round"
                        points={pts}
                        style={{
                          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
                        }} />
              {/* dwells highlighted as small circles */}
              {t.junctions.filter((j) => (j.dwell ?? 0) > 0).map((j, k) => (
                <circle key={"d" + k}
                        cx={xFor(j.t_min)} cy={yFor(j.seq)}
                        r={5} fill="#fde68a" stroke={c} strokeWidth={2}>
                  <title>Dwell {j.dwell} min at {j.name}</title>
                </circle>
              ))}
              {/* departure marker */}
              <circle cx={xFor(t.dep_min)}
                      cy={yFor(t.junctions[0].seq)} r={4} fill={c}>
                <title>
                  {t.path_id} · dep {t.dep_hhmm} ({t.direction})
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, color: "var(--grey-5)", marginTop: 6 }}>
        Faint lines = existing corridor traffic ·
        thick coloured = newly inserted freight paths ·
        amber dots = holding at intermediate loop.
      </div>
    </div>
  );
}
