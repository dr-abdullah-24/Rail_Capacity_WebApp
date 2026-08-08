import { useEffect, useState } from "react";
import {
  AlertCircle, AlertTriangle, CalendarRange, CheckCircle2, Clock,
  Cog, Database, FileWarning, GaugeCircle, MapPinned, MoonStar,
  PlayCircle, PlusCircle, Route as RouteIcon, Sunrise, TrainFront,
  TrendingUp, GitBranch, Gauge, HardDrive, Maximize2, Target,
} from "lucide-react";
import { CorridorDetail, createRun, getCorridor } from "../api/client";
import { RouteDiagram } from "../components/corridor/RouteDiagram";
import { DateMultiPicker } from "../components/config/DateMultiPicker";
import { DateSinglePicker } from "../components/config/DateSinglePicker";
import { TractionSelect } from "../components/config/TractionSelect";
import { TRACTION_CLASSES } from "../constants/tractionClasses";
import { useAppStore } from "../stores/appStore";

export function ConfigPage() {
  const uploads = useAppStore((s) => s.uploads);
  const selectedUploadId = useAppStore((s) => s.selectedUploadId);
  const selectedUploadIds = useAppStore((s) => s.selectedUploadIds);
  const activeCorridor = useAppStore((s) => s.activeCorridor);
  const setPage = useAppStore((s) => s.setPage);
  const refresh = useAppStore((s) => s.refresh);
  const selectRun = useAppStore((s) => s.selectRun);

  const upload = uploads.find((u) => u.id === selectedUploadId) || null;
  const available = upload?.available_dates ?? [];

  const pendingModelType = useAppStore((s) => s.pendingModelType);
  const setPendingModelType = useAppStore((s) => s.setPendingModelType);
  const [modelType, setModelType] = useState<"capacity" | "diversion">(
    pendingModelType ?? "capacity");
  const [traction, setTraction] = useState("c6");
  const [classFilters, setClassFilters] = useState<Set<string>>(new Set(["4"]));
  const [endpointStrictness, setEndpointStrictness] =
    useState<"any" | "relaxed" | "strict" | "nearby">("relaxed");
  const [excludedTerminals, setExcludedTerminals] = useState<string>("");
  // Diversion-mode selections (multi-file). Seed from the multi-select
  // upload store if it's populated, otherwise fall back to the single
  // selectedUploadId.
  const [divUploadIds, setDivUploadIds] = useState<Set<number>>(
    () => {
      if (selectedUploadIds.length > 0) return new Set(selectedUploadIds);
      if (selectedUploadId != null) return new Set([selectedUploadId]);
      return new Set();
    });
  const [srcCorridor, setSrcCorridor] = useState<string>("");
  const [tgtCorridor, setTgtCorridor] = useState<string>("");
  const [flexMin, setFlexMin] = useState(60);
  const [nBerths, setNBerths] = useState(6);
  const [divDate, setDivDate] = useState<string>("");
  const corridors = useAppStore((s) => s.corridors);
  const [srcDetail, setSrcDetail] = useState<CorridorDetail | null>(null);
  const [tgtDetail, setTgtDetail] = useState<CorridorDetail | null>(null);

  useEffect(() => {
    if (!srcCorridor) { setSrcDetail(null); return; }
    getCorridor(srcCorridor).then(setSrcDetail).catch(() => setSrcDetail(null));
  }, [srcCorridor]);
  useEffect(() => {
    if (!tgtCorridor) { setTgtDetail(null); return; }
    getCorridor(tgtCorridor).then((detail) => {
      setTgtDetail(detail);
      // Auto-set nBerths to the average SMART berth count across the corridor
      const berths = detail.stations.map((s) => s.n_berths ?? 6).filter(Boolean);
      if (berths.length > 0) {
        const avg = Math.round(berths.reduce((a, b) => a + b, 0) / berths.length);
        setNBerths(avg);
      }
    }).catch(() => setTgtDetail(null));
  }, [tgtCorridor]);

  // Consume the one-shot pendingModelType coming from the Upload page.
  useEffect(() => {
    if (pendingModelType) {
      setModelType(pendingModelType);
      if (pendingModelType === "diversion") {
        const seed = selectedUploadIds.length > 0
                       ? selectedUploadIds
                       : selectedUploadId != null ? [selectedUploadId] : [];
        if (seed.length > 0) {
          setDivUploadIds(new Set(seed));
        }
        setDivDate("");
      }
      setPendingModelType(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dates, setDates] = useState<string[]>(
    available.length === 1 ? [available[0]] : []
  );
  const [headway, setHeadway] = useState(3);
  const [dwellMax, setDwellMax] = useState(30);
  const [blockHours, setBlockHours] = useState(4);
  const [timeLimit, setTimeLimit] = useState(180);
  const [opEnabled, setOpEnabled] = useState(false);
  const [opStart, setOpStart] = useState(5);
  const [opEnd,   setOpEnd]   = useState(24);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const missingUpload  = !upload;
  const missingDate    = dates.length === 0;
  const cls = TRACTION_CLASSES.find((c) => c.id === traction);
  const missingSrt = !cls?.hasSrtProfile;

  async function launch() {
    setBusy(true); setErr(null);
    try {
      if (modelType === "diversion") {
        const ids = [...divUploadIds];
        if (ids.length === 0 || !srcCorridor || !tgtCorridor) {
          setErr("at least one upload + source + target corridor required");
          return;
        }
        if (srcCorridor === tgtCorridor) {
          setErr("source and target corridors must be different");
          return;
        }
        const cls = [...classFilters].sort().join(",") || "4";
        if (!cls) {
          setErr("select at least one service class to include");
          return;
        }
        const r = await createRun({
          name: `divert ${srcCorridor} → ${tgtCorridor} · cls ${cls}`
                 + (ids.length > 1 ? ` · ${ids.length} files` : ""),
          model_type: "diversion",
          source_upload_id: ids[0],
          source_upload_ids: ids.sort((a,b)=>a-b).join(","),
          source_corridor_id: srcCorridor,
          target_corridor_id: tgtCorridor,
          class_filter: cls,
          date_tag: divDate || null,
          headway_min: headway,
          dwell_max: dwellMax,
          block_hours: blockHours,
          time_limit_per_block: timeLimit,
          flex_min: flexMin,
          n_berths: nBerths,
          endpoint_strictness: endpointStrictness,
          excluded_terminals: excludedTerminals,
        } as any);
        selectRun(r.id);
        await refresh();
        setPage("runs");
        return;
      }
      // capacity mode
      if (!upload || !dates.length) {
        setErr("upload + at least one date required for capacity model");
        return;
      }
      let last = 0;
      for (const d of dates) {
        const r = await createRun({
          name: `${traction} @ ${d}${activeCorridor
                    ? " · " + activeCorridor.id : ""}`,
          model_type: "capacity",
          date_tag: d,
          traction,
          headway_min: headway,
          dwell_max: dwellMax,
          block_hours: blockHours,
          time_limit_per_block: timeLimit,
          operating_hours_enabled: opEnabled,
          operating_start_hour: opStart,
          operating_end_hour:   opEnd,
          baseline_upload_id: upload.id,
        } as any);
        last = r.id;
      }
      selectRun(last);
      await refresh();
      setPage("runs");
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Model selector */}
      <div className="card">
        <h2><GitBranch size={14} /> Analytical model</h2>
        <div className="card-sub">
          Choose which MILP to run. Capacity inserts new paths into a
          corridor; Diversion reassigns observed services from one
          corridor onto an alternative corridor.
        </div>
        <div style={{ display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          <ModelChoice
            selected={modelType === "capacity"}
            onClick={() => setModelType("capacity")}
            icon={<GaugeCircle size={22} />}
            title="Corridor Capacity"
            subtitle="Insert new paths into observed traffic on a corridor" />
          <ModelChoice
            selected={modelType === "diversion"}
            onClick={() => setModelType("diversion")}
            icon={<TrendingUp size={22} />}
            title="Service Diversion"
            subtitle="Reassign observed services from one corridor onto an alternative corridor" />
        </div>
      </div>

      {modelType === "capacity" && missingUpload && (
        <div className="card" style={{ borderLeft: "4px solid var(--warn)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8,
                        color: "var(--warn)" }}>
            <AlertTriangle size={16} />
            <div>
              <b>Select an upload first.</b>{" "}
              <button className="ghost" onClick={() => setPage("upload")}>
                Open Upload
              </button>
            </div>
          </div>
        </div>
      )}
      {modelType === "capacity" && !activeCorridor && (
        <div className="card" style={{ borderLeft: "4px solid var(--warn)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8,
                        color: "var(--warn)" }}>
            <AlertTriangle size={16} />
            <div>
              <b>No corridor selected.</b>{" "}
              <button className="ghost" onClick={() => setPage("corridor")}>
                Open Corridor
              </button>
            </div>
          </div>
        </div>
      )}

      {modelType === "diversion" && (() => {
        const selectedUploads = uploads.filter((u) => divUploadIds.has(u.id));
        const totalBytes = selectedUploads.reduce(
          (s, u) => s + (u.size_bytes || 0), 0);
        const totalDates = new Set<string>();
        selectedUploads.forEach((u) =>
          (u.available_dates || []).forEach((d) => totalDates.add(d)));
        const availableDates = [...totalDates].sort();
        const toggleUpload = (id: number) => {
          setDivUploadIds((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          });
        };
        return (
        <div className="card">
          {/* --- Header --- */}
          <div style={{ display: "flex", alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 12, flex: "1 1 320px" }}>
              <div style={{ width: 42, height: 42, borderRadius: 10,
                            background: "rgba(61,90,128,0.10)",
                            color: "var(--steel)",
                            display: "grid", placeItems: "center",
                            flexShrink: 0 }}>
                <TrendingUp size={20} />
              </div>
              <div style={{ display: "flex", flexDirection: "column",
                            gap: 4, minWidth: 0 }}>
                <h2 style={{ margin: 0 }}>Diversion setup</h2>
                <div style={{ fontSize: 12.5, color: "var(--grey-6)",
                               lineHeight: 1.45 }}>
                  Specify the Train Describer dataset and the corridor
                  pair defining the diversion scenario. Eligible
                  services will be identified against the divertibility
                  rules configured in the section below.
                </div>
              </div>
            </div>
            <button className="secondary"
                    title="Open the Corridor page to browse maps or build a new corridor"
                    onClick={() => setPage("corridor")}
                    style={{ alignSelf: "flex-start" }}>
              <MapPinned size={13} /> Manage corridors
            </button>
          </div>

          {/* --- Section 1: Data source (multi-file) --- */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ ...sectionHeaderStyle, marginBottom: 0 }}>
                <span style={sectionNumStyle}>1</span>
                <Database size={12} /> Data source ·
                Train Describer uploads
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setDivUploadIds(
                          new Set(uploads.map((u) => u.id)))}>
                  Select all
                </button>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setDivUploadIds(new Set())}>
                  Clear
                </button>
              </div>
            </div>

            {uploads.length === 0 ? (
              <div style={{ padding: "12px 14px", borderRadius: 8,
                             border: "1px dashed var(--border)",
                             background: "var(--paper)",
                             fontSize: 12.5, color: "var(--grey-6)" }}>
                No uploads yet — head to the Upload page to add TD files.
              </div>
            ) : (
              <div style={{ display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(260px, 1fr))",
                            gap: 8, maxHeight: 260, overflowY: "auto",
                            padding: 4 }}>
                {uploads.map((u) => {
                  const on = divUploadIds.has(u.id);
                  return (
                    <div key={u.id}
                         role="button"
                         tabIndex={0}
                         aria-pressed={on}
                         onClick={() => toggleUpload(u.id)}
                         onKeyDown={(e) => {
                           if (e.key === "Enter" || e.key === " ") {
                             e.preventDefault();
                             toggleUpload(u.id);
                           }
                         }}
                         style={{ position: "relative",
                                   display: "flex", alignItems: "center",
                                   gap: 10, padding: "10px 12px",
                                   border: `1.5px solid ${on
                                     ? "var(--steel)" : "var(--border)"}`,
                                   borderRadius: 10,
                                   background: on
                                     ? "rgba(61,90,128,0.08)" : "#fff",
                                   boxShadow: on
                                     ? "0 1px 0 rgba(61,90,128,0.15), inset 0 0 0 1px rgba(61,90,128,0.10)"
                                     : "none",
                                   cursor: "pointer",
                                   userSelect: "none",
                                   transition: "all 120ms ease" }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8,
                                     background: on ? "var(--steel)"
                                                    : "var(--paper)",
                                     color: on ? "#fff" : "var(--steel)",
                                     display: "grid", placeItems: "center",
                                     flexShrink: 0 }}>
                        <HardDrive size={16} />
                      </div>
                      <div style={{ display: "flex",
                                     flexDirection: "column", gap: 3,
                                     minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600,
                                        color: "var(--ink)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap" }}
                             title={u.original_name}>
                          {u.original_name}
                        </div>
                        <div style={{ fontSize: 10.5,
                                       color: "var(--grey-6)",
                                       display: "flex", gap: 8,
                                       flexWrap: "wrap" }}>
                          <span>#{u.id}</span>
                          <span>· Type: {u.kind}</span>
                          <span>· {(u.size_bytes / (1024 * 1024))
                                    .toFixed(1)} MB</span>
                          {(u.available_dates?.length ?? 0) > 0 && (
                            <span>· {u.available_dates.length} date
                              {u.available_dates.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                      {on && (
                        <CheckCircle2 size={16}
                                       style={{ color: "var(--steel)",
                                                 flexShrink: 0 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Aggregate summary + date field */}
            <div style={{ marginTop: 12,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10, alignItems: "start" }}>
              <div style={{ padding: "10px 12px", borderRadius: 8,
                             border: "1px solid var(--border)",
                             background: "var(--paper)" }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase",
                               letterSpacing: 0.5, fontWeight: 700,
                               color: "var(--grey-6)", marginBottom: 6 }}>
                  Selection summary
                </div>
                <div style={{ display: "flex", flexWrap: "wrap",
                               gap: 6 }}>
                  <span className="badge"
                        style={selectedUploads.length > 0
                          ? {} : { color: "var(--brand)",
                                    borderColor: "var(--brand)" }}>
                    {selectedUploads.length} file
                    {selectedUploads.length === 1 ? "" : "s"}
                  </span>
                  {selectedUploads.length > 0 && (
                    <>
                      <span className="badge">
                        {(totalBytes / (1024 * 1024)).toFixed(1)} MB total
                      </span>
                      <span className="badge">
                        <CalendarRange size={11} />
                        {totalDates.size} unique date
                        {totalDates.size === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </div>
                {selectedUploads.length === 0 && (
                  <div style={{ marginTop: 6, fontSize: 11,
                                 color: "var(--brand)",
                                 fontStyle: "italic" }}>
                    Tick at least one upload to enable launch.
                  </div>
                )}
              </div>

              <div>
                <div style={lblStyle}>
                  Observation date
                </div>
                <DateSinglePicker
                  available={availableDates}
                  value={divDate}
                  onChange={setDivDate} />
                <div style={{ marginTop: 4, fontSize: 11,
                               color: "var(--grey-6)" }}>
                  {divDate
                    ? <>Only journeys on <b>{divDate}</b> will be extracted.</>
                    : <>All highlighted dates will be extracted — click a date to filter to one.</>}
                </div>
              </div>
            </div>
          </div>

          {/* --- Section 2: Corridor pair --- */}
          <div style={{ marginTop: 18 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionNumStyle}>2</span>
              <RouteIcon size={12} /> Corridor pair · divert
              &nbsp;FROM&nbsp;→&nbsp;ONTO
            </div>
            <div style={{ display: "grid",
                          gridTemplateColumns: "1fr 40px 1fr",
                          alignItems: "stretch", gap: 8 }}>
              <CorridorPicker
                role="source"
                value={srcCorridor}
                onChange={setSrcCorridor}
                otherId={tgtCorridor}
                corridors={corridors}
                detail={srcDetail} />
              <div style={{ display: "flex", alignItems: "center",
                            justifyContent: "center" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%",
                              background: "var(--paper)",
                              border: "1px solid var(--border)",
                              display: "grid", placeItems: "center",
                              color: "var(--steel)" }}
                     title="Divert traffic from source onto target">
                  <GitBranch size={16} />
                </div>
              </div>
              <CorridorPicker
                role="target"
                value={tgtCorridor}
                onChange={setTgtCorridor}
                otherId={srcCorridor}
                corridors={corridors}
                detail={tgtDetail} />
            </div>

            {srcCorridor && tgtCorridor && srcCorridor === tgtCorridor && (
              <div style={{ marginTop: 8, padding: "6px 10px",
                            borderRadius: 6,
                            background: "rgba(215,38,56,0.08)",
                            color: "var(--brand)", fontSize: 12,
                            display: "flex", alignItems: "center",
                            gap: 6 }}>
                <AlertTriangle size={13} /> Source and target must
                be different corridors.
              </div>
            )}
            {(srcDetail || tgtDetail) && (
              <div style={{ marginTop: 14, display: "flex",
                            flexDirection: "column", gap: 12 }}>
                {srcDetail && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600,
                                  color: "var(--steel)",
                                  marginBottom: 6,
                                  display: "flex", alignItems: "center",
                                  gap: 6 }}>
                      <span style={{ ...pillDot,
                                     background: "var(--steel)" }} />
                      Source · {srcDetail.name} ·
                      {" "}{srcDetail.stations.length} stations ·
                      {" "}{srcDetail.km_length.toFixed(1)} km
                    </div>
                    <RouteDiagram corridor={srcDetail} showBerths={false} />
                  </div>
                )}
                {tgtDetail && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600,
                                  color: "var(--accent)",
                                  marginBottom: 6,
                                  display: "flex", alignItems: "center",
                                  gap: 6 }}>
                      <span style={{ ...pillDot,
                                     background: "var(--accent)" }} />
                      Target · {tgtDetail.name} ·
                      {" "}{tgtDetail.stations.length} stations ·
                      {" "}{tgtDetail.km_length.toFixed(1)} km
                    </div>
                    <RouteDiagram corridor={tgtDetail} showBerths />
                    <div style={{ marginTop: 8, fontSize: 11,
                                  color: "var(--grey-5)", fontStyle: "italic" }}>
                      Per-station slow-line berth counts shown as circles above.
                      Adjust the SMART fallback in the MILP parameters section below.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {modelType === "diversion" && (
        <div className="card">
          <h2><FileWarning size={14} /> Divertibility rules</h2>
          <div className="card-sub">
            Choose which observed services count as divertible before the
            MILP even sees them. All rules apply together.
          </div>

          {/* --- Service classes --- */}
          <div style={{ marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
              <div style={{ ...sectionHeaderStyle, marginBottom: 0 }}>
                <span style={sectionNumStyle}>3</span>
                Service classes · click to toggle
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setClassFilters(new Set(
                          TRACTION_CLASSES.map((c) => String(c.digit))))}>
                  All
                </button>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setClassFilters(new Set(
                          TRACTION_CLASSES.filter((c) =>
                            c.category === "freight")
                            .map((c) => String(c.digit))))}>
                  Freight
                </button>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setClassFilters(new Set(
                          TRACTION_CLASSES.filter((c) =>
                            c.category === "passenger")
                            .map((c) => String(c.digit))))}>
                  Passenger
                </button>
                <button type="button" className="secondary"
                        style={quickBtn}
                        onClick={() => setClassFilters(new Set())}>
                  None
                </button>
              </div>
            </div>

            <div style={{ display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(220px, 1fr))",
                          gap: 8 }}>
              {TRACTION_CLASSES.map((c) => {
                const digit = String(c.digit);
                const on = classFilters.has(digit);
                const cat = c.category;
                const catColor = cat === "freight" ? "var(--accent)"
                              : cat === "passenger" ? "var(--steel)"
                              : cat === "empty" ? "var(--grey-6)"
                              : "var(--grey-5)";
                const tint = cat === "freight" ? "rgba(238,150,75,0.10)"
                          : cat === "passenger" ? "rgba(61,90,128,0.08)"
                          : "rgba(148,163,184,0.10)";
                const toggle = () => setClassFilters((s) => {
                  const n = new Set(s);
                  if (n.has(digit)) n.delete(digit); else n.add(digit);
                  return n;
                });
                return (
                  <div key={c.id}
                       role="button"
                       tabIndex={0}
                       aria-pressed={on}
                       onClick={toggle}
                       onKeyDown={(e) => {
                         if (e.key === "Enter" || e.key === " ") {
                           e.preventDefault(); toggle();
                         }
                       }}
                       style={{ position: "relative",
                                 display: "flex", alignItems: "center",
                                 gap: 10, padding: "10px 12px",
                                 border: `1.5px solid ${on ? catColor
                                          : "var(--border)"}`,
                                 borderRadius: 10,
                                 background: on ? tint : "#fff",
                                 boxShadow: on
                                   ? `0 1px 0 ${catColor}22, inset 0 0 0 1px ${catColor}22`
                                   : "none",
                                 cursor: "pointer",
                                 userSelect: "none",
                                 transition: "all 120ms ease" }}>
                    <span style={{ width: 30, height: 30,
                                   borderRadius: "50%",
                                   background: on ? catColor
                                                  : "var(--paper)",
                                   color: on ? "#fff" : catColor,
                                   border: `1px solid ${on ? catColor
                                                            : catColor + "55"}`,
                                   fontSize: 13, fontWeight: 700,
                                   display: "grid",
                                   placeItems: "center",
                                   flexShrink: 0,
                                   transition: "all 120ms ease" }}>
                      {digit}
                    </span>
                    <div style={{ display: "flex",
                                   flexDirection: "column", gap: 2,
                                   minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600,
                                     color: "var(--ink)",
                                     overflow: "hidden",
                                     textOverflow: "ellipsis",
                                     whiteSpace: "nowrap" }}>
                        {c.name.replace(/^Class \d+ — /, "")}
                      </div>
                      <div style={{ fontSize: 10.5,
                                     color: "var(--grey-5)",
                                     display: "flex", gap: 6 }}>
                        <span style={{ color: catColor,
                                        fontWeight: 600 }}>
                          {cat}
                        </span>
                        <span>· {c.mphTypical} mph</span>
                      </div>
                    </div>
                    {on && (
                      <CheckCircle2 size={16}
                                    style={{ color: catColor,
                                              flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 11, color: "var(--grey-6)",
                           marginTop: 8,
                           display: "flex", alignItems: "center",
                           gap: 6, flexWrap: "wrap" }}>
              <span>Included classes:</span>
              {classFilters.size === 0 ? (
                <span style={{ color: "var(--brand)",
                                fontStyle: "italic" }}>
                  none — pick at least one class to enable launch
                </span>
              ) : [...classFilters].sort().map((d) => (
                <span key={d} className="badge"
                      style={{ fontSize: 11 }}>
                  {d}
                </span>
              ))}
            </div>
          </div>

          {/* --- Endpoint match --- */}
          <div style={{ marginTop: 18 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionNumStyle}>4</span>
              Endpoint match rule
            </div>
            <div style={{ display: "grid",
                          gridTemplateColumns: "repeat(4, 1fr)",
                          gap: 8 }}>
              <EndpointOption
                selected={endpointStrictness === "any"}
                onClick={() => setEndpointStrictness("any")}
                icon={<Maximize2 size={14} />}
                badge="Widest"
                color="#64748b"
                title="Any"
                subtitle="No endpoint requirement — every qualifying journey on the corridor counts"
                helper="Widest net. Use to match the original study, where all class-N journeys observed on the corridor were considered divertible." />
              <EndpointOption
                selected={endpointStrictness === "relaxed"}
                onClick={() => setEndpointStrictness("relaxed")}
                icon={<CheckCircle2 size={14} />}
                badge="Default"
                color="#3d5a80"
                title="Relaxed"
                subtitle="At least one journey endpoint must sit at a corridor terminus"
                helper="Catches through-traffic even when only one end is observable in TD." />
              <EndpointOption
                selected={endpointStrictness === "strict"}
                onClick={() => setEndpointStrictness("strict")}
                icon={<Target size={14} />}
                badge="Tightest"
                color="#dc2626"
                title="Strict"
                subtitle="Both endpoints must sit at corridor termini"
                helper="Classical through-train filter — safest but drops more journeys when TD coverage is partial." />
              <EndpointOption
                selected={endpointStrictness === "nearby"}
                onClick={() => setEndpointStrictness("nearby")}
                icon={<MapPinned size={14} />}
                badge="Spatial"
                color="#d97706"
                title="Nearby terminus"
                subtitle="Endpoint within 20 km of a terminus + minimum station coverage"
                helper="Catches trains whose first TD-observed berth is a few km inside the corridor due to SMART gaps (e.g. Sandbach-origin trains physically starting at Crewe yard, ~12 km along the route)." />
            </div>
          </div>

          {/* --- Excluded terminals --- */}
          <div style={{ marginTop: 18 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionNumStyle}>5</span>
              Excluded terminals
            </div>
            <input value={excludedTerminals}
                   onChange={(e) => setExcludedTerminals(e.target.value)}
                   placeholder="e.g. TRAFFRPRK, TFRDPRK  (comma-separated stanmes / tiplocs — blank = none)" />
            <div style={{ fontSize: 11, color: "var(--grey-5)",
                           marginTop: 4 }}>
              Journeys that start or end at any of these stations are
              treated as non-divertible (dedicated terminals, sidings,
              yards, etc.).
            </div>
          </div>
        </div>
      )}

      {modelType === "diversion" && (
        <div className="card">
          <h2><Cog size={14} /> Diversion MILP parameters</h2>
          <div className="card-sub">
            Decision variable <code style={{ fontSize: 11 }}>X<sub>t,s</sub> ∈ {"{"} 0, 1 {"}"}</code> — does
            train <i>t</i> occupy slot <i>s</i>? The table below lists every
            set and parameter in the formulation. Rows with an input field are
            tunable; fixed rows show the internal value.
          </div>

          {/* Unified formulation + controls table */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10,
                        overflow: "hidden" }}>

            {/* --- Tunable rows --- */}
            <MilpRow
              sym="S"
              desc="Candidate time slots per train (5-min steps, symmetric around original departure)"
              fixed={false}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--grey-5)",
                                whiteSpace: "nowrap" }}>±</span>
                <input type="number" min={5} max={240} step={5}
                       value={flexMin}
                       onChange={(e) => setFlexMin(+e.target.value)}
                       style={{ width: 64 }} />
                <span style={{ fontSize: 11, color: "var(--grey-5)",
                                whiteSpace: "nowrap" }}>min</span>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--grey-5)",
                             marginTop: 4 }}>
                {Math.round(flexMin / 5) * 2 + 1} candidate slots per train ·
                each divertible can shift up to ±{flexMin} min from its
                original source departure
              </div>
            </MilpRow>

            <MilpRow
              sym={<>n<sub>k</sub></>}
              desc="Slow-line berth cap at checkpoint k — SMART per-station counts are used where available; this is the fallback for stations absent from SMART"
              fixed={false}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="number" min={1} max={30} step={1}
                       value={nBerths}
                       onChange={(e) => setNBerths(+e.target.value)}
                       style={{ width: 64 }} />
                <span style={{ fontSize: 11, color: "var(--grey-5)",
                                whiteSpace: "nowrap" }}>berths / stn</span>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--grey-5)",
                             marginTop: 4 }}>
                SMART primary where available — fallback applied to stations
                without SMART data
              </div>
            </MilpRow>

            {/* --- Fixed / internal rows --- */}
            <MilpRow sym="T"
              desc="Set of divertible trains identified by the rules above"
              fixed={true} value="from identification step" />

            <MilpRow sym="K"
              desc="Set of SMART berth checkpoints along the target corridor"
              fixed={true} value="from target corridor" />

            <MilpRow sym="h"
              desc="Minimum headway clearance used in the conflict check (C2)"
              fixed={true} value="15 min (internal)" />

            <MilpRow
              sym={<>f<sub>u,s</sub></>}
              desc="Pre-computed feasibility indicator — 1 if slot s at checkpoint k is uncongested by existing baseline traffic (C3 pre-filter)"
              fixed={true} value="computed at runtime" />

            {/* Constraints footer */}
            <div style={{ padding: "8px 14px",
                          borderTop: "1px solid var(--border)",
                          background: "rgba(61,90,128,0.03)",
                          display: "flex", gap: 16, flexWrap: "wrap",
                          fontSize: 11, color: "var(--grey-6)" }}>
              <span>
                <b style={{ color: "var(--steel)" }}>C1</b>{" "}
                Σ<sub>s</sub> x<sub>t,s</sub> ≤ 1
              </span>
              <span>
                <b style={{ color: "var(--steel)" }}>C2</b>{" "}
                Σ x<sub>·,w</sub> ≤ n<sub>k</sub> − blocked<sub>k,w</sub>
              </span>
              <span>
                <b style={{ color: "var(--steel)" }}>C3</b>{" "}
                x<sub>t,s</sub> = 0 if f<sub>u,s</sub> = 0 (pre-filter)
              </span>
            </div>
          </div>

          {/* Solver / decomposition controls */}
          <div style={{ marginTop: 16 }}>
            <div style={{ ...sectionHeaderStyle, marginBottom: 10 }}>
              Solver &amp; decomposition
            </div>
            <div className="grid cols-2">
              <label>
                <div style={lblStyle}>
                  <MoonStar size={12} /> Target dwell max (min)
                </div>
                <input type="number" min={0} max={120} value={dwellMax}
                       onChange={(e) => setDwellMax(+e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--grey-5)",
                              marginTop: 2 }}>
                  upper bound on dwell time at each target-corridor station
                </div>
              </label>
              <label>
                <div style={lblStyle}>Solver time-limit / block (s)</div>
                <input type="number" min={30} max={1800} step={30}
                       value={timeLimit}
                       onChange={(e) => setTimeLimit(+e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--grey-5)",
                              marginTop: 2 }}>
                  CBC solver budget per rolling-horizon block
                </div>
              </label>
              <label>
                <div style={lblStyle}>Rolling-horizon block hours</div>
                <input type="number" min={1} max={12} value={blockHours}
                       onChange={(e) => setBlockHours(+e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--grey-5)",
                              marginTop: 2 }}>
                  decomposes the 24-hour day into overlapping {blockHours}h
                  windows for tractable solve times
                </div>
              </label>
            </div>
          </div>
        </div>
      )}

      {modelType === "capacity" && (
      <div className="grid cols-2">
        <div className="card">
          <h2><TrainFront size={14} /> Traction / service class</h2>
          <div className="card-sub">
            Class 4 (intermodal, 75 mph) and Class 6 (heavy freight, 60 mph)
            have integrated Sectional Running Time profiles today. Other
            classes are listed for documentation — add an SRT profile to
            enable them.
          </div>
          <TractionSelect value={traction} onChange={setTraction} />
        </div>

        <div>
          <div className="card">
            <h2><CalendarRange size={14} /> Date(s) to run</h2>
            <div className="card-sub">
              Only the dates detected inside{" "}
              <b>{upload?.original_name ?? "the selected upload"}</b> are
              enabled. Selecting multiple queues one run per date.
            </div>
            <DateMultiPicker
              available={available}
              selected={dates}
              onChange={setDates}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--grey-6)" }}>
              {dates.length ? (
                <>selected: {dates.join(", ")}</>
              ) : (
                <em style={{ color: "var(--grey-5)" }}>
                  no dates selected yet
                </em>
              )}
            </div>
          </div>

          <div className="card">
            <h2><Cog size={14} /> Solver parameters</h2>
            <div className="grid cols-2">
              <label>
                <div style={lblStyle}>
                  <Gauge size={12} /> Headway (min)
                </div>
                <input type="number" min={2} max={10} value={headway}
                       onChange={(e) => setHeadway(+e.target.value)} />
              </label>
              <label>
                <div style={lblStyle}>
                  <Clock size={12} /> Max dwell (min)
                </div>
                <input type="number" min={0} max={120} value={dwellMax}
                       onChange={(e) => setDwellMax(+e.target.value)} />
              </label>
              <label>
                <div style={lblStyle}>Block hours</div>
                <input type="number" min={1} max={12} value={blockHours}
                       onChange={(e) => setBlockHours(+e.target.value)} />
              </label>
              <label>
                <div style={lblStyle}>Solver time-limit / block (s)</div>
                <input type="number" min={30} max={1800} step={30}
                       value={timeLimit}
                       onChange={(e) => setTimeLimit(+e.target.value)} />
              </label>
            </div>
          </div>

          <div className="card">
            <h2><MoonStar size={14} /> Operating hours</h2>
            <div className="card-sub">
              By default, candidates can be placed at any minute of the 24-hour
              day. Enable this to restrict placement to a corridor operating
              window (e.g. to exclude an overnight engineering possession).
            </div>
            <label style={{ display: "flex", alignItems: "center",
                            gap: 8, marginBottom: 10 }}>
              <input type="checkbox" checked={opEnabled}
                     onChange={(e) => setOpEnabled(e.target.checked)} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Restrict candidate hours
              </span>
            </label>
            <div className="grid cols-2"
                 style={{ opacity: opEnabled ? 1 : 0.5 }}>
              <label>
                <div style={lblStyle}>
                  <Sunrise size={12} /> Start hour (inclusive)
                </div>
                <input type="number" min={0} max={23} value={opStart}
                       disabled={!opEnabled}
                       onChange={(e) => setOpStart(+e.target.value)} />
              </label>
              <label>
                <div style={lblStyle}>
                  <MoonStar size={12} /> End hour (exclusive)
                </div>
                <input type="number" min={1} max={24} value={opEnd}
                       disabled={!opEnabled}
                       onChange={(e) => setOpEnd(+e.target.value)} />
              </label>
            </div>
            {opEnabled && (
              <div style={{ marginTop: 10, fontSize: 12,
                            color: "var(--grey-6)" }}>
                Candidates whose hour falls outside{" "}
                <b>{String(opStart).padStart(2,"0")}:00 –
                {" "}{String(opEnd).padStart(2,"0")}:00</b> will be dropped
                before solving.  Existing baseline traffic is unaffected.
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 12,
                      flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {modelType === "capacity" && (
              <>
                <ReadyStep ok={!missingUpload} Icon={AlertCircle} label="Upload" />
                <ReadyStep ok={!missingDate}   Icon={CalendarRange} label="Date" />
                <ReadyStep ok={!missingSrt}    Icon={FileWarning}   label="SRT" />
                {!missingUpload && !missingDate && !missingSrt && (
                  <span className="badge ok"
                        style={{ padding: "4px 10px", fontSize: 12 }}>
                    <CheckCircle2 size={12} />
                    Ready · {dates.length} run{dates.length > 1 ? "s" : ""} queued
                  </span>
                )}
              </>
            )}
            {modelType === "diversion" && (
              <>
                <ReadyStep ok={divUploadIds.size > 0}
                           Icon={AlertCircle}
                           label={`Upload${divUploadIds.size > 1
                                    ? ` ×${divUploadIds.size}` : ""}`} />
                <ReadyStep ok={!!srcCorridor}
                           Icon={AlertCircle} label="Source" />
                <ReadyStep ok={!!tgtCorridor && tgtCorridor !== srcCorridor}
                           Icon={AlertCircle} label="Target" />
                {divUploadIds.size > 0 && srcCorridor && tgtCorridor
                  && srcCorridor !== tgtCorridor && (
                  <span className="badge ok"
                        style={{ padding: "4px 10px", fontSize: 12 }}>
                    <CheckCircle2 size={12} />
                    Ready · {divUploadIds.size} file
                    {divUploadIds.size === 1 ? "" : "s"} ·
                    classes {[...classFilters].sort().join(",") || "?"} ·
                    {" "}{endpointStrictness}
                  </span>
                )}
              </>
            )}
          </div>
          <button className="accent"
                  disabled={busy ||
                    (modelType === "capacity"
                      && (missingUpload || missingDate || missingSrt)) ||
                    (modelType === "diversion" &&
                      (divUploadIds.size === 0 || !srcCorridor
                        || !tgtCorridor
                        || srcCorridor === tgtCorridor
                        || classFilters.size === 0))}
                  onClick={launch}>
            <PlayCircle size={14} />
            {busy ? "Queuing…"
                  : modelType === "diversion"
                    ? "Launch diversion run"
                    : `Launch ${dates.length || "0"} run${dates.length !== 1 ? "s" : ""}`}
          </button>
        </div>
        {err && (
          <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
            {err}
          </div>
        )}
      </div>
    </>
  );
}

const lblStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  fontSize: 12, color: "var(--grey-6)", marginBottom: 4,
};

const pillDot: React.CSSProperties = {
  width: 8, height: 8, borderRadius: "50%",
  display: "inline-block", flexShrink: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
  textTransform: "uppercase", color: "var(--grey-6)",
  marginBottom: 10,
};

const sectionNumStyle: React.CSSProperties = {
  width: 20, height: 20, borderRadius: "50%",
  background: "var(--steel)", color: "#fff",
  fontSize: 11, fontWeight: 700,
  display: "grid", placeItems: "center",
  flexShrink: 0,
};

const quickBtn: React.CSSProperties = {
  padding: "3px 10px", fontSize: 11, minHeight: 0, height: 26,
};

interface MilpRowProps {
  sym: React.ReactNode;
  desc: string;
  fixed: boolean;
  value?: string;
  children?: React.ReactNode;
}
function MilpRow({ sym, desc, fixed, value, children }: MilpRowProps) {
  return (
    <div style={{ display: "grid",
                  gridTemplateColumns: "40px 1fr auto",
                  gap: 12, alignItems: "start",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                  background: fixed ? "var(--paper)" : "#fff" }}>
      <code style={{ fontWeight: 700, fontSize: 13,
                      color: fixed ? "var(--grey-5)" : "var(--steel)",
                      paddingTop: 2 }}>
        {sym}
      </code>
      <div style={{ fontSize: 11.5, color: "var(--grey-6)",
                     lineHeight: 1.45, paddingTop: 2 }}>
        {desc}
      </div>
      <div style={{ display: "flex", flexDirection: "column",
                     alignItems: "flex-end", gap: 0, minWidth: 140 }}>
        {fixed ? (
          <span style={{ fontSize: 11, color: "var(--grey-5)",
                          fontStyle: "italic", paddingTop: 2 }}>
            {value}
          </span>
        ) : (
          children
        )}
        {!fixed && (
          <span style={{ fontSize: 9, fontWeight: 700,
                          letterSpacing: 0.4, textTransform: "uppercase",
                          color: "#3d5a80",
                          background: "rgba(61,90,128,0.10)",
                          padding: "1px 6px", borderRadius: 3,
                          marginTop: 4 }}>
            tunable
          </span>
        )}
      </div>
    </div>
  );
}

const tunablePill: React.CSSProperties = {
  marginLeft: "auto", fontSize: 9, fontWeight: 700,
  letterSpacing: 0.3, textTransform: "uppercase",
  color: "#b7402e", background: "rgba(183,64,46,0.10)",
  padding: "1px 5px", borderRadius: 3,
};

interface EndpointOptionProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge: string;
  color: string;
  title: string;
  subtitle: string;
  helper: string;
}
function EndpointOption({ selected, onClick, icon, badge, color,
                          title, subtitle, helper }: EndpointOptionProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); onClick();
        }
      }}
      style={{ position: "relative", display: "flex",
                flexDirection: "column",
                border: `1.5px solid ${selected ? color : "var(--border)"}`,
                borderRadius: 10, cursor: "pointer",
                userSelect: "none", overflow: "hidden",
                background: selected ? `${color}0f` : "#fff",
                transition: "border-color 120ms ease, background 120ms ease" }}>
      {/* Accent top stripe */}
      <div style={{ height: 3,
                    background: selected ? color : "transparent",
                    transition: "background 120ms ease" }} />
      <div style={{ padding: "10px 12px", display: "flex",
                    flexDirection: "column", gap: 7 }}>
        {/* Header: icon + title + badge */}
        <div style={{ display: "flex", alignItems: "center",
                      gap: 7, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7,
                           background: selected ? color : `${color}1a`,
                           color: selected ? "#fff" : color,
                           display: "grid", placeItems: "center",
                           flexShrink: 0,
                           transition: "all 120ms ease" }}>
              {icon}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700,
                           color: "var(--ink)" }}>
              {title}
            </div>
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 700,
                          letterSpacing: 0.4,
                          textTransform: "uppercase",
                          padding: "2px 7px", borderRadius: 4,
                          background: selected ? color : `${color}1a`,
                          color: selected ? "#fff" : color,
                          flexShrink: 0,
                          transition: "all 120ms ease" }}>
            {badge}
          </span>
        </div>
        {/* Subtitle */}
        <div style={{ fontSize: 11.5, color: "var(--grey-6)",
                       lineHeight: 1.4 }}>
          {subtitle}
        </div>
        {/* Helper note */}
        <div style={{ fontSize: 10.5, color: "var(--grey-5)",
                       fontStyle: "italic", lineHeight: 1.35 }}>
          {helper}
        </div>
        {/* Selected tick */}
        {selected && (
          <div style={{ display: "flex", alignItems: "center",
                         gap: 4, marginTop: 2 }}>
            <CheckCircle2 size={11} style={{ color }} />
            <span style={{ fontSize: 10, color, fontWeight: 600 }}>
              Selected
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface CorridorLite {
  id: string;
  name: string;
  description?: string;
  km_length: number;
  n_stations: number;
  kind?: "builtin" | "user";
}
interface CorridorPickerProps {
  role: "source" | "target";
  value: string;
  onChange: (id: string) => void;
  otherId: string;
  corridors: CorridorLite[];
  detail: CorridorDetail | null;
}
function CorridorPicker({ role, value, onChange, otherId,
                          corridors, detail }: CorridorPickerProps) {
  const isSrc = role === "source";
  const accent = isSrc ? "var(--steel)" : "var(--accent)";
  const bgTint = isSrc ? "rgba(61,90,128,0.06)"
                       : "rgba(238,150,75,0.08)";
  const label = isSrc ? "Divert FROM (source)" : "Divert ONTO (target)";
  const iconChar = isSrc ? "A" : "B";

  return (
    <div style={{ border: `1px solid ${value ? accent : "var(--border)"}`,
                  borderRadius: 10,
                  background: value ? bgTint : "#fff",
                  padding: 10,
                  display: "flex", flexDirection: "column", gap: 8,
                  minHeight: 132 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%",
                      background: accent, color: "#fff",
                      display: "grid", placeItems: "center",
                      fontSize: 12, fontWeight: 700,
                      flexShrink: 0 }}>
          {iconChar}
        </div>
        <div style={{ display: "flex", flexDirection: "column",
                      lineHeight: 1.15 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase",
                        letterSpacing: 0.4, color: "var(--grey-6)",
                        fontWeight: 700 }}>
            {label}
          </div>
          {detail && (
            <div style={{ fontSize: 13, fontWeight: 600,
                          color: accent }}>
              {detail.name}
            </div>
          )}
        </div>
      </div>

      <select value={value} onChange={(e) => onChange(e.target.value)}
              style={{ borderColor: value ? accent : undefined }}>
        <option value="">— select corridor —</option>
        {corridors.map((c) => (
          <option key={c.id} value={c.id}
                  disabled={c.id === otherId}>
            {c.kind === "user" ? "★ " : ""}
            {c.name}
            {c.id === otherId ? "  (chosen as other side)" : ""}
          </option>
        ))}
      </select>

      {detail ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6,
                      fontSize: 11, color: "var(--grey-6)" }}>
          <span className="badge" style={{ background: bgTint,
                                            color: accent,
                                            borderColor: accent }}>
            {detail.stations.length} stations
          </span>
          <span className="badge" style={{ background: bgTint,
                                            color: accent,
                                            borderColor: accent }}>
            {detail.km_length.toFixed(1)} km
          </span>
          {detail.stations.length >= 2 && (
            <span style={{ fontSize: 11, color: "var(--grey-5)",
                            marginLeft: 2 }}>
              {detail.stations[0].name} →{" "}
              {detail.stations[detail.stations.length - 1].name}
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--grey-5)",
                       fontStyle: "italic" }}>
          {isSrc
            ? "Pick the corridor whose traffic you want to divert away."
            : "Pick the alternative corridor to divert traffic onto."}
        </div>
      )}
    </div>
  );
}

interface ModelChoiceProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}
function ModelChoice({ selected, onClick, icon, title,
                       subtitle }: ModelChoiceProps) {
  return (
    <button
      onClick={onClick}
      className={selected ? "" : "secondary"}
      style={{
        justifyContent: "flex-start",
        textAlign: "left",
        padding: "14px 16px",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        border: `2px solid ${selected ? "var(--steel)" : "var(--border)"}`,
      }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: selected ? "rgba(255,255,255,0.20)"
                             : "rgba(61,90,128,0.10)",
        color: selected ? "#fff" : "var(--steel)",
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>{icon}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11,
                      color: selected ? "rgba(255,255,255,0.75)"
                                       : "var(--grey-5)" }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

interface ReadyStepProps {
  ok: boolean;
  Icon: typeof AlertCircle;
  label: string;
}
function ReadyStep({ ok, Icon, label }: ReadyStepProps) {
  return (
    <span className={"badge " + (ok ? "ok" : "warn")}
          style={{ padding: "4px 10px", fontSize: 12 }}>
      {ok ? <CheckCircle2 size={12} /> : <Icon size={12} />}
      {label}
    </span>
  );
}
