import { useState } from "react";
import {
  ArrowRight, Calendar, Database, FileJson, FileSpreadsheet,
  Loader2, ScanSearch, Trash2, UploadCloud,
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
  const selectUpload = useAppStore((s) => s.selectUpload);
  const refresh = useAppStore((s) => s.refresh);
  const setPage = useAppStore((s) => s.setPage);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragActive, setDrag] = useState(false);

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
    try {
      for (const f of Array.from(files)) {
        const kind = kindHint ?? detectKind(f.name);
        const m = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        const up = await uploadFile(f, kind, m?.[1] ?? "");
        // Auto scan after upload
        await scanUpload(up.id).catch(() => {});
        selectUpload(up.id);
      }
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setUploading(false);
    }
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
      </div>

      <div className="card">
        <h2><Database size={14} /> Uploaded files</h2>
        <div className="card-sub">
          Click a file to make it active; the run configurator will use the
          selected file and its detected dates.
        </div>
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>File</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Dates found</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 && (
              <tr><td colSpan={6}>
                <em style={{ color: "var(--grey-5)" }}>no uploads yet</em>
              </td></tr>
            )}
            {uploads.map((u) => (
              <tr key={u.id}
                  className={"selectable"
                    + (selectedUploadId === u.id ? " selected" : "")}
                  onClick={() => selectUpload(u.id)}>
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
            ))}
          </tbody>
        </table>

        {selectedUploadId && (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setPage("corridor")}>
              Next: choose corridor <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
