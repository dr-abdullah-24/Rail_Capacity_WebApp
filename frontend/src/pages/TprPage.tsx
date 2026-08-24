import { useEffect, useMemo, useState } from "react";
import {
  FileText, ExternalLink, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import {
  TprDocument, TprStructured, TprRouteYear,
  listTprDocuments, listTprStructured, tprDocumentUrl,
} from "../api/client";

const ROUTE_ORDER = ["NWC", "LNW", "LNE", "EM", "WR", "WX", "WW", "SC", "AR", "SX", "KT", "KS", "NAT"];

function fmtBytes(b: number) {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

// ── Sub-components for data sections ──────────────────────────────────────────

function EaTable({ down, up }: { down: TprRouteYear["ea"]["Down"]; up: TprRouteYear["ea"]["Up"] }) {
  if (!down.length && !up.length) return (
    <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: 0 }}>No EA specified for this route/year.</p>
  );
  const rows = [
    ...down.map((r) => ({ ...r, dir: "Down" })),
    ...up.map((r)   => ({ ...r, dir: "Up" })),
  ];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
      <thead>
        <tr style={{ background: "var(--surface-alt, #f7f8fa)" }}>
          <Th>Location</Th><Th>Direction</Th><Th>Line</Th>
          <Th align="center">EA (min)</Th><Th align="center">PA (min)</Th>
          <Th>Notes</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
            <Td><strong>{r.location}</strong></Td>
            <Td>{r.dir}</Td>
            <Td>{r.line || "SL"}</Td>
            <Td align="center">
              <span style={{ fontWeight: 600, color: "#0369a1" }}>{r.ea_min}</span>
            </Td>
            <Td align="center">{r.pa_min ?? 0}</Td>
            <Td style={{ color: "var(--muted)" }}>{r.note || ""}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SrtAdjTable({ rows }: { rows: TprRouteYear["srt_adjustments"] }) {
  if (!rows.length) return (
    <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: 0 }}>No SRT adjustments specified.</p>
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
      <thead>
        <tr style={{ background: "var(--surface-alt, #f7f8fa)" }}>
          <Th>Location</Th><Th>Direction</Th><Th align="center">Adj (min)</Th><Th>Condition / Description</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
            <Td><strong>{r.location}</strong></Td>
            <Td>{r.direction}</Td>
            <Td align="center">
              <span style={{ fontWeight: 600, color: "#7c3aed" }}>+{r.adj_min}</span>
            </Td>
            <Td style={{ color: "var(--muted)" }}>{r.condition}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LoopTable({ rows }: { rows: TprRouteYear["loops"] }) {
  if (!rows.length) return (
    <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: 0 }}>No loop data extracted for this route/year.</p>
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
      <thead>
        <tr style={{ background: "var(--surface-alt, #f7f8fa)" }}>
          <Th>Loop Name</Th><Th>Location</Th><Th>Line</Th>
          <Th align="right">Length (SLU)</Th><Th align="right">Length (m)</Th>
          <Th>Notes</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
            <Td><strong>{r.name}</strong></Td>
            <Td>{r.location}</Td>
            <Td>{r.line || ""}</Td>
            <Td align="right">{r.length_slu ?? "n/a"}</Td>
            <Td align="right">{r.length_m != null ? r.length_m : "n/a"}</Td>
            <Td style={{ color: "var(--muted)" }}>{r.note || ""}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "center" | "right" }) {
  return (
    <th style={{
      padding: "0.35rem 0.65rem", textAlign: align ?? "left",
      fontWeight: 600, fontSize: "0.75rem", color: "var(--muted)",
      borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}
function Td({ children, align, style }: {
  children: React.ReactNode; align?: "center" | "right";
  style?: React.CSSProperties;
}) {
  return (
    <td style={{ padding: "0.35rem 0.65rem", textAlign: align ?? "left", ...style }}>
      {children}
    </td>
  );
}

// ── Route+Year data panel ─────────────────────────────────────────────────────

type TabId = "ea" | "srt" | "loops";

function RouteYearPanel({
  routeId, routeName, yearKey, yearData, pdfs,
}: {
  routeId: string;
  routeName: string;
  yearKey: string;
  yearData: TprRouteYear;
  pdfs: TprDocument[];
}) {
  const [tab, setTab] = useState<TabId>("ea");

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    {
      id: "ea", label: "Engineering Allowances",
      badge: yearData.ea.Down.length + yearData.ea.Up.length,
    },
    { id: "srt", label: "SRT Adjustments", badge: yearData.srt_adjustments.length },
    { id: "loops", label: "Loops", badge: yearData.loops.length },
  ];

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 6,
      marginBottom: "1.25rem", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.75rem",
        padding: "0.6rem 0.85rem",
        background: "var(--surface-alt, #f7f8fa)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{routeId}</span>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{routeName}</span>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--muted)" }}>
          {yearKey} {yearData.version && `(${yearData.version})`}
        </span>
        {pdfs.map((doc) => (
          <a
            key={doc.filename}
            href={tprDocumentUrl(doc.folder, doc.filename)}
            target="_blank" rel="noopener noreferrer"
            title={`Open ${doc.filename}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.3rem",
              fontSize: "0.73rem", color: "#0369a1",
              textDecoration: "none",
            }}
          >
            <FileText size={12} />
            {doc.version}
            <ExternalLink size={10} />
          </a>
        ))}
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "0.45rem 0.9rem", border: "none", cursor: "pointer",
              fontSize: "0.78rem", fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "#1d4ed8" : "var(--muted)",
              background: "transparent",
              borderBottom: tab === t.id ? "2px solid #1d4ed8" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: "0.4rem",
            }}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{
                fontSize: "0.65rem", padding: "0 0.35rem",
                background: tab === t.id ? "#1d4ed8" : "#e2e8f0",
                color: tab === t.id ? "#fff" : "#475569",
                borderRadius: 99, lineHeight: "1.6",
              }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "0.75rem 0.85rem", overflowX: "auto" }}>
        {tab === "ea"    && <EaTable down={yearData.ea.Down} up={yearData.ea.Up} />}
        {tab === "srt"   && <SrtAdjTable rows={yearData.srt_adjustments} />}
        {tab === "loops" && <LoopTable rows={yearData.loops} />}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TprPage() {
  const [docs, setDocs]           = useState<TprDocument[]>([]);
  const [structured, setStructured] = useState<TprStructured | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filterRoute, setFilterRoute] = useState<string>("all");
  const [filterYear,  setFilterYear]  = useState<string>("all");
  const [expandPdfs, setExpandPdfs]   = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([listTprDocuments(), listTprStructured().catch(() => null)])
      .then(([d, s]) => { setDocs(d); setStructured(s); })
      .catch((e) => setError(e?.message ?? "Failed to load TPR data"))
      .finally(() => setLoading(false));
  }, []);

  // Derive available route/year combos from structured data.
  const routeIds = useMemo(() => {
    if (!structured) return [];
    return Object.keys(structured).sort((a, b) =>
      (structured[a].sort_order ?? 99) - (structured[b].sort_order ?? 99)
    );
  }, [structured]);

  const allYears = useMemo(() => {
    if (!structured) return [];
    const ys = new Set<string>();
    for (const r of Object.values(structured))
      Object.keys(r.years).forEach((y) => ys.add(y));
    return [...ys].sort((a, b) => Number(b) - Number(a));
  }, [structured]);

  // PDF index: folder grouped by route code.
  const pdfByRouteYear = useMemo(() => {
    const m: Record<string, Record<string, TprDocument[]>> = {};
    for (const d of docs) {
      const k = `${d.route}_${d.year}`;
      if (!m[d.route]) m[d.route] = {};
      if (!m[d.route][d.year]) m[d.route][d.year] = [];
      m[d.route][d.year].push(d);
    }
    return m;
  }, [docs]);

  const hasStructured = structured && Object.keys(structured).length > 0;

  return (
    <div className="page-content" style={{ maxWidth: 960 }}>
      <div className="page-header" style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
          TPR Library
        </h1>
        <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.83rem" }}>
          Network Rail Train Planning Rules: Engineering Allowances, SRT Adjustments and Loop Availability
          extracted per route and timetable year.
        </p>
      </div>

      {loading && (
        <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: "var(--error, #c0392b)", fontSize: "0.85rem", display: "flex", gap: "0.4rem" }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Filters */}
          {hasStructured && (
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
                <span style={{ color: "var(--muted)" }}>Route</span>
                <select
                  value={filterRoute}
                  onChange={(e) => setFilterRoute(e.target.value)}
                  style={selectStyle}
                >
                  <option value="all">All routes</option>
                  {routeIds.map((r) => (
                    <option key={r} value={r}>{r} - {structured![r].name}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
                <span style={{ color: "var(--muted)" }}>Year</span>
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  style={selectStyle}
                >
                  <option value="all">All years</option>
                  {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
          )}

          {/* Structured data panels */}
          {hasStructured ? (
            routeIds
              .filter((rid) => filterRoute === "all" || rid === filterRoute)
              .map((rid) => {
                const route = structured![rid];
                return (
                  <section key={rid} style={{ marginBottom: "2rem" }}>
                    <h2 style={{
                      fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.07em",
                      textTransform: "uppercase", color: "var(--muted)",
                      borderBottom: "1px solid var(--border)", paddingBottom: "0.35rem",
                      marginBottom: "0.85rem",
                    }}>
                      {rid}: {route.name}
                    </h2>
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "-0.5rem", marginBottom: "0.85rem" }}>
                      {route.description}
                    </p>

                    {Object.entries(route.years)
                      .filter(([yr]) => filterYear === "all" || yr === filterYear)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([yr, yd]) => {
                        // Find matching PDFs: route code may differ by year (LNW vs NWC)
                        const routeCodes = yr <= "2025" ? ["LNW"] : ["NWC"];
                        const pdfs = routeCodes.flatMap(
                          (rc) => (pdfByRouteYear[rc]?.[yr] ?? [])
                        ).sort((a, b) => b.version.localeCompare(a.version));

                        return (
                          <RouteYearPanel
                            key={yr}
                            routeId={rid}
                            routeName={route.name}
                            yearKey={yr}
                            yearData={yd}
                            pdfs={pdfs}
                          />
                        );
                      })}
                  </section>
                );
              })
          ) : (
            /* Fallback: no structured data yet, just show PDFs */
            <div style={{
              padding: "1rem", background: "var(--surface)",
              border: "1px solid var(--border)", borderRadius: 6,
              fontSize: "0.82rem", color: "var(--muted)", marginBottom: "1.5rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <AlertCircle size={14} />
                <strong style={{ color: "var(--fg)" }}>Structured data not yet available</strong>
              </div>
              TPR data is being extracted from the PDF documents. Once complete, this page will show
              Engineering Allowances, SRT Adjustments and Loop data per segment.
              The source PDFs are still accessible below.
            </div>
          )}

          {/* Collapsible PDF archive */}
          <div style={{ marginTop: "1.5rem" }}>
            <button
              onClick={() => setExpandPdfs((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                background: "none", border: "none", cursor: "pointer",
                fontSize: "0.8rem", color: "var(--muted)", padding: 0,
              }}
            >
              {expandPdfs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Source PDF archive ({docs.length} documents)
            </button>

            {expandPdfs && (
              <div style={{ marginTop: "0.85rem" }}>
                {[...new Set(docs.map((d) => d.year))].sort((a, b) => b - a).map((year) => (
                  <div key={year} style={{ marginBottom: "1rem" }}>
                    <div style={{
                      fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.06em",
                      textTransform: "uppercase", color: "var(--muted)",
                      marginBottom: "0.4rem",
                    }}>
                      {year}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {docs
                        .filter((d) => d.year === year)
                        .sort((a, b) =>
                          ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route) ||
                          b.version.localeCompare(a.version)
                        )
                        .map((doc) => (
                          <a
                            key={doc.filename}
                            href={tprDocumentUrl(doc.folder, doc.filename)}
                            target="_blank" rel="noopener noreferrer"
                            title={`${doc.filename} (${fmtBytes(doc.size_bytes)})`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: "0.3rem",
                              padding: "0.25rem 0.6rem",
                              border: "1px solid var(--border)", borderRadius: 4,
                              background: "var(--surface)", color: "var(--fg)",
                              fontSize: "0.75rem", textDecoration: "none",
                            }}
                          >
                            <FileText size={11} />
                            {doc.route} {doc.version}
                            <span style={{ color: "var(--muted)", fontSize: "0.68rem" }}>
                              {fmtBytes(doc.size_bytes)}
                            </span>
                            <ExternalLink size={10} style={{ color: "var(--muted)" }} />
                          </a>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* EA source footnote */}
          {hasStructured && (
            <div style={{
              marginTop: "1.5rem", padding: "0.75rem 0.9rem",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 6, fontSize: "0.76rem", color: "var(--muted)", lineHeight: 1.6,
              display: "flex", gap: "0.5rem", alignItems: "flex-start",
            }}>
              <CheckCircle2 size={14} style={{ color: "#0369a1", flexShrink: 0, marginTop: 1 }} />
              <span>
                EA values in the SRT preview use TPR-sourced figures for listed approach
                locations. All other segments fall back to a conservative formula (5% of SRT,
                min 1 min). Source: TPR 2021 V4 LNW, TPR 2026 V3 NWC, TPR 2027 V1 NWC.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "0.3rem 0.6rem", borderRadius: 4,
  border: "1px solid var(--border)", background: "var(--surface)",
  fontSize: "0.82rem", cursor: "pointer",
};
