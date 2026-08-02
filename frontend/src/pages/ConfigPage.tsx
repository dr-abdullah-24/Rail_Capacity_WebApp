import { useState } from "react";
import {
  AlertCircle, AlertTriangle, CalendarRange, CheckCircle2, Clock,
  Cog, FileWarning, Gauge, MoonStar, PlayCircle, Sunrise, TrainFront,
} from "lucide-react";
import { createRun } from "../api/client";
import { DateMultiPicker } from "../components/config/DateMultiPicker";
import { TractionSelect } from "../components/config/TractionSelect";
import { TRACTION_CLASSES } from "../constants/tractionClasses";
import { useAppStore } from "../stores/appStore";

export function ConfigPage() {
  const uploads = useAppStore((s) => s.uploads);
  const selectedUploadId = useAppStore((s) => s.selectedUploadId);
  const activeCorridor = useAppStore((s) => s.activeCorridor);
  const setPage = useAppStore((s) => s.setPage);
  const refresh = useAppStore((s) => s.refresh);
  const selectRun = useAppStore((s) => s.selectRun);

  const upload = uploads.find((u) => u.id === selectedUploadId) || null;
  const available = upload?.available_dates ?? [];

  const [traction, setTraction] = useState("c6");
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
    if (!upload || !dates.length) return;
    setBusy(true); setErr(null);
    try {
      let last = 0;
      for (const d of dates) {
        const r = await createRun({
          name: `${traction} @ ${d}${activeCorridor
                    ? " · " + activeCorridor.id : ""}`,
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
        });
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
      {missingUpload && (
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
      {!activeCorridor && (
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

      <div className="card">
        <div style={{ display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 12,
                      flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ReadyStep ok={!missingUpload}
                       Icon={AlertCircle}
                       label="Upload" />
            <ReadyStep ok={!missingDate}
                       Icon={CalendarRange}
                       label="Date" />
            <ReadyStep ok={!missingSrt}
                       Icon={FileWarning}
                       label="SRT" />
            {!missingUpload && !missingDate && !missingSrt && (
              <span className="badge ok"
                    style={{ padding: "4px 10px", fontSize: 12 }}>
                <CheckCircle2 size={12} />
                Ready · {dates.length} run{dates.length > 1 ? "s" : ""} queued
              </span>
            )}
          </div>
          <button className="accent"
                  disabled={busy || missingUpload || missingDate || missingSrt}
                  onClick={launch}>
            <PlayCircle size={14} />
            {busy ? "Queuing…"
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
