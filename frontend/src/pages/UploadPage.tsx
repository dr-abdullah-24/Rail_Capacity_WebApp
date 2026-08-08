import { useState } from "react";
import {
  ArrowRight, Calendar, CheckCircle2, Circle, Database, FileJson,
  FileSpreadsheet, Loader2, ScanSearch, Trash2, TrendingUp,
  UploadCloud,
} from "lucide-react";
import {
  deleteUpload, scanUpload, uploadFile,
} from "../api/client";
import { useAppStore } from "../stores/appStore";

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` :
  n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` :
  n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(1)} MB` :
  `${(n / 1024 ** 3).toFixed(2)} GB`;

export function UploadPage() {
  const uploads = useAppStore((s) => s.uploads);
  const selectedUploadId = useAppStore((s) => s.selectedUploadId);
  const selectedUploadIds = useAppStore((s) => s.selectedUploadIds);
  const selectUpload = useAppStore((s) => s.selectUpload);
  const toggleUploadSelection = useAppStore((s) => s.toggleUploadSelection);
  const setUploadSelection = useAppStore((s) => s.setUploadSelection);
  const clearUploadSelection = useAppStore((s) => s.clearUploadSelection);
  const refresh = useAppStore((s) => s.refresh);
  const setPage = useAppStore((s) => s.setPage);
  const setPendingModelType = useAppStore((s) => s.setPendingModelType);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragActive, setDrag] = useState(false);
  interface UploadTask { name: string; size: number; loaded: number;
                          pct: number; done: boolean; err?: string; }
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const selectedSet = new Set(selectedUploadIds);

  function detectKind(name: string): string {
    const n = name.toLowerCase();
    if (/\.(tbz2|tar\.bz2|tbz)$/.test(n)) return "td_tbz2";
    if (/\.jsonl?$/.test(n))               return "td_jsonl";
    if (/\.csv$/.test(n))                  return "events_csv";
    return "events_csv";
  }

  async function handleFiles(files: FileList | null, kindHint?: string) {
    if (!files?.length) return;
    setUploading(true); setErr(null);
    const arr = Array.from(files);
    const initial: UploadTask[] = arr.map((f) => ({
      name: f.name, size: f.size, loaded: 0, pct: 0, done: false,
    }));
    setTasks(initial);
    const newlyUploaded: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      try {
        const kind = kindHint ?? detectKind(f.name);
        const m = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        const up = await uploadFile(f, kind, m?.[1] ?? "",
          (pct, loaded) => {
            setTasks((t) => {
              const next = [...t];
              next[i] = { ...next[i], pct, loaded };
              return next;
            });
          });
        await scanUpload(up.id).catch(() => {});
        newlyUploaded.push(up.id);
        setTasks((t) => {
          const next = [...t];
          next[i] = { ...next[i], done: true, pct: 1,
                       loaded: next[i].size };
          return next;
        });
      } catch (e: any) {
        setTasks((t) => {
          const next = [...t];
          next[i] = { ...next[i], err: e?.message ?? String(e) };
          return next;
        });
        setErr(e?.message ?? String(e));
      }
    }
    await refresh();
    if (newlyUploaded.length) {
      setUploadSelection([...selectedUploadIds, ...newlyUploaded]);
    }
    setUploading(false);
    setTimeout(() => setTasks([]), 4000);
  }

  async function onScan(id: number) {
    setBusyId(id);
    try { await scanUpload(id); await refresh(); }
    finally { setBusyId(null); }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this upload?")) return;
    setBusyId(id);
    try { await deleteUpload(id); await refresh(); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <div className="card">
        <h2><UploadCloud size={14} /> 1. Upload TD Data</h2>
        <div className="card-sub">
          Drop or select one or more Train Describer sources.  Supported
          formats: raw <code>.jsonl</code> per-day logs, compressed
          {" "}<code>.tbz2</code> archives (2018-era format), or a
          pre-extracted corridor events <code>.csv</code>.
          Files are stored locally under <code>backend/data/uploads/</code>.
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false);
            handleFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragActive ? "var(--steel)" : "var(--border)"}`,
            background: dragActive ? "rgba(61,90,128,0.05)" : "var(--grey-0)",
            padding: 28, borderRadius: 8, textAlign: "center",
            transition: "border 120ms, background 120ms",
          }}
        >
          <UploadCloud size={30} color="var(--steel)"
                        style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {uploading ? "Uploading…" : "Drop TD files here"}
          </div>
          <div style={{ fontSize: 12, color: "var(--grey-5)" }}>
            or&nbsp;
            <label style={{ color: "var(--steel)", cursor: "pointer",
                            textDecoration: "underline" }}>
              browse
              <input type="file" multiple hidden
                     onChange={(e) => handleFiles(e.target.files)} />
            </label>
          </div>
          {err && (
            <div style={{ color: "var(--danger)", marginTop: 8, fontSize: 13 }}>
              {err}
            </div>
          )}
        </div>

        {tasks.length > 0 && (
          <div style={{ marginTop: 12, display: "flex",
                        flexDirection: "column", gap: 6 }}>
            {tasks.map((t, i) => (
              <div key={i}
                   style={{ padding: "8px 10px",
                             border: "1px solid var(--border)",
                             borderRadius: 8, background: "#fff",
                             display: "flex", flexDirection: "column",
                             gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center",
                              gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap" }}
                        title={t.name}>
                    {t.name}
                  </span>
                  <span style={{ color: "var(--grey-6)",
                                  fontVariantNumeric: "tabular-nums" }}>
                    {fmtSize(t.loaded)} / {fmtSize(t.size)}
                  </span>
                  <span style={{ minWidth: 46, textAlign: "right",
                                  fontWeight: 600,
                                  color: t.err ? "var(--brand)"
                                       : t.done ? "var(--ok)"
                                       : "var(--steel)" }}>
                    {t.err ? "fail"
                      : t.done ? "done"
                      : `${Math.round(t.pct * 100)}%`}
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 2,
                               background: "var(--grey-1)",
                               overflow: "hidden" }}>
                  <div style={{ width: `${t.pct * 100}%`,
                                 height: "100%",
                                 background: t.err ? "var(--brand)"
                                             : t.done ? "var(--ok)"
                                             : "var(--steel)",
                                 transition: "width 100ms linear" }} />
                </div>
                {t.err && (
                  <div style={{ fontSize: 11, color: "var(--brand)" }}>
                    {t.err}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center",
                       justifyContent: "space-between", gap: 8,
                       flexWrap: "wrap" }}>
          <div>
            <h2><Database size={14} /> Uploaded files</h2>
            <div className="card-sub">
              Tick one or more files to select them for the diversion
              pipeline. For capacity runs, the last-ticked file is used.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="secondary"
                    style={{ padding: "3px 10px", fontSize: 11,
                              minHeight: 0, height: 26 }}
                    disabled={uploads.length === 0}
                    onClick={() =>
                      setUploadSelection(uploads.map((u) => u.id))}>
              Select all
            </button>
            <button className="secondary"
                    style={{ padding: "3px 10px", fontSize: 11,
                              minHeight: 0, height: 26 }}
                    disabled={selectedUploadIds.length === 0}
                    onClick={() => clearUploadSelection()}>
              Clear
            </button>
          </div>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              <th></th>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Dates found</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 && (
              <tr><td colSpan={7}>
                <em style={{ color: "var(--grey-5)" }}>no uploads yet</em>
              </td></tr>
            )}
            {uploads.map((u) => {
              const on = selectedSet.has(u.id);
              return (
              <tr key={u.id}
                  className={"selectable" + (on ? " selected" : "")}
                  onClick={() => toggleUploadSelection(u.id)}>
                <td style={{ width: 34 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleUploadSelection(u.id);
                    }}>
                  {on
                    ? <CheckCircle2 size={18} color="var(--steel)" />
                    : <Circle size={18} color="var(--grey-4)" />}
                </td>
                <td style={{ width: 30 }}>
                  {u.kind === "td_jsonl" || u.kind === "td_tbz2"
                    ? <FileJson size={16} color="var(--steel)" />
                    : <FileSpreadsheet size={16} color="var(--steel)" />}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.original_name}</div>
                  <div style={{ fontSize: 11, color: "var(--grey-5)" }}>
                    #{u.id} · {new Date(u.uploaded_at).toLocaleString()}
                  </div>
                </td>
                <td>
                  <span className={"badge " +
                    (u.kind === "td_jsonl" ? "info" : "pending")}>
                    {u.kind}
                  </span>
                </td>
                <td>{fmtSize(u.size_bytes)}</td>
                <td>
                  {u.available_dates?.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {u.available_dates.slice(0, 6).map((d) => (
                        <span key={d} className="badge">
                          <Calendar size={11} /> {d}
                        </span>
                      ))}
                      {u.available_dates.length > 6 && (
                        <span className="badge">
                          +{u.available_dates.length - 6}
                        </span>
                      )}
                    </div>
                  ) : (
                    <em style={{ color: "var(--grey-5)", fontSize: 12 }}>
                      not scanned
                    </em>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="ghost"
                            disabled={busyId === u.id}
                            onClick={() => onScan(u.id)}
                            title="Scan file for dates">
                      {busyId === u.id
                        ? <Loader2 size={14} className="spin" />
                        : <ScanSearch size={14} />}
                    </button>
                    <button className="ghost"
                            disabled={busyId === u.id}
                            onClick={() => onDelete(u.id)}
                            title="Delete upload">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {(selectedUploadIds.length > 0 || selectedUploadId) && (
          <div style={{ marginTop: 14, display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between", gap: 8,
                        flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "var(--grey-6)" }}>
              {selectedUploadIds.length > 0
                ? <><b>{selectedUploadIds.length}</b> file
                    {selectedUploadIds.length === 1 ? "" : "s"} selected</>
                : "1 file selected"}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="secondary"
                      disabled={selectedUploadIds.length === 0}
                      onClick={() => {
                        setPendingModelType("diversion");
                        setPage("configure");
                      }}
                      title="Jump straight to diversion setup with the ticked files preselected">
                <TrendingUp size={14} /> Configure diversion run
                {selectedUploadIds.length > 1
                  && ` (${selectedUploadIds.length} files)`}
              </button>
              <button onClick={() => {
                        setPendingModelType("capacity");
                        setPage("corridor");
                      }}>
                Next: choose corridor <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
