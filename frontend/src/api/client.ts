import axios from "axios";

export const api = axios.create({ baseURL: "/api", timeout: 60_000 });

export interface Health {
  status: string;
  app: string;
  milp_repo: string;
  milp_repo_exists: boolean;
}

export interface Upload {
  id: number;
  original_name: string;
  stored_path: string;
  kind: string;
  date_tag: string | null;
  size_bytes: number;
  available_dates: string[];
  uploaded_at: string;
}

export interface Run {
  id: number;
  name: string;
  status: "pending" | "running" | "complete" | "failed";
  date_tag: string | null;
  traction: string;
  headway_min: number;
  dwell_max: number;
  block_hours: number;
  time_limit_per_block: number;
  operating_hours_enabled: boolean;
  operating_start_hour: number;
  operating_end_hour: number;
  model_type: "capacity" | "diversion";
  baseline_upload_id: number | null;
  source_upload_id: number | null;
  source_upload_ids: string;
  target_upload_id: number | null;
  source_corridor_id: string | null;
  target_corridor_id: string | null;
  class_filter: string | null;
  flex_min: number;
  n_berths: number;
  endpoint_strictness: string;
  excluded_terminals: string;
  nb_inserted: number | null;
  sb_inserted: number | null;
  total_dwell_min: number | null;
  blocks_hit_time_limit: number | null;
  wall_solve_time_s: number | null;
  result_dir: string | null;
  error: string | null;
  // Diversion KPIs
  divertible_total: number | null;
  div_placed: number | null;
  div_rescheduled: number | null;
  div_conflict: number | null;
  div_placed_pct: number | null;
  div_mean_abs_shift_min: number | null;
  div_objective_value: number | null;
  div_solver_status: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CorridorSummary {
  id: string;
  name: string;
  description: string;
  km_length: number;
  n_stations: number;
  kind?: "builtin" | "user";
}

export interface LocationHit {
  name: string;
  station: string;
  tiploc: string;
  crs: string;
  stanox: string;
  stanme: string;
  lat: number | null;
  lon: number | null;
}

export interface Station {
  seq: number;
  name: string;
  tiploc: string;
  crs: string;
  stanox: string;
  stanme: string;
  lat: number;
  lon: number;
  chainage_km: number;
  n_berths: number;
}

export interface CorridorDetail extends CorridorSummary {
  stations: Station[];
}

export interface Kpis {
  method?: string;
  date?: string;
  headway_min?: number;
  chat_moss_headway_min?: number;
  nb_inserted?: number;
  sb_inserted?: number;
  total_dwell_min?: number;
  wall_solve_time_s?: number;
  blocks_hit_time_limit?: number;
  candidates_total?: number;
  nb_candidates?: number;
  sb_candidates?: number;
  steer_target?: { nb: number; sb: number; source: string };
  per_block?: {
    direction: string; block: number; inserted: number;
    candidates: number; status: string; hit_time_limit: boolean;
    solve_s: number;
  }[];
}

export async function getHealth() {
  return (await api.get<Health>("/health")).data;
}

export async function listUploads() {
  return (await api.get<Upload[]>("/uploads/")).data;
}

export async function uploadFile(
  f: File, kind: string, date_tag: string,
  onProgress?: (pct: number, loaded: number, total: number) => void
) {
  const fd = new FormData();
  fd.append("file", f);
  fd.append("kind", kind);
  if (date_tag) fd.append("date_tag", date_tag);
  const { data } = await api.post<Upload>("/uploads/", fd, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress: (e) => {
      if (!onProgress) return;
      const total = e.total ?? f.size;
      const loaded = e.loaded ?? 0;
      onProgress(total > 0 ? loaded / total : 0, loaded, total);
    },
  });
  return data;
}

export async function scanUpload(id: number) {
  return (await api.post<Upload>(`/uploads/${id}/scan`)).data;
}

export async function deleteUpload(id: number) {
  return (await api.delete(`/uploads/${id}`)).data;
}

export async function listRuns() {
  return (await api.get<Run[]>("/runs/")).data;
}

export async function createRun(cfg: Partial<Run>) {
  return (await api.post<Run>("/runs/", cfg)).data;
}

export async function getRun(id: number) {
  return (await api.get<Run>(`/runs/${id}`)).data;
}

export async function getKpis(id: number) {
  return (await api.get<Kpis>(`/runs/${id}/kpis`)).data;
}

export interface JunctionStop {
  seq: number; name: string; t_min: number; hhmm: string;
  line?: string; dwell?: number;
}
export interface CorridorTrain {
  kind: "existing" | "inserted";
  headcode?: string;
  path_id?: string;
  journey_num?: string;
  direction: string;
  class_digit?: string;
  dep_min: number;
  arr_min: number;
  dep_hhmm: string;
  arr_hhmm: string;
  dwell_min?: number;
  junctions: JunctionStop[];
}
export interface HeatmapCell {
  junction_seq: number; direction: string; bucket: number; count: number;
}
export interface InsertedOverlayCell {
  junction_seq: number; direction: string; bucket: number; path_id: string;
}
export interface RunTraffic {
  corridor_names: string[];
  junction_chainages?: number[];
  junction_seqs?: number[];
  existing: CorridorTrain[];
  inserted: CorridorTrain[];
  heatmap: HeatmapCell[];
  inserted_overlay: InsertedOverlayCell[];
}
export async function getTraffic(id: number) {
  return (await api.get<RunTraffic>(`/runs/${id}/traffic`)).data;
}

export interface DiversionOutcomeRow {
  path_id: string;
  headcode: string;
  original_hhmm: string;
  assigned_hhmm: string;
  shift_min: number;
  outcome: "SLOT" | "RESCHEDULED" | "CONFLICT";
  dep_min: number | null;
  original_dep_min: number;
  direction: string;
  first_station: string;
  last_station: string;
  nearby_baseline: { t_min: number; headcode: string; journey_num: string; train_class: string; junction_name: string }[];
}
export interface DiversionOutcome {
  run_id: number;
  flex_min: number;
  divertible_total: number | null;
  div_placed: number | null;
  div_rescheduled: number | null;
  div_conflict: number | null;
  div_placed_pct: number | null;
  div_mean_abs_shift_min: number | null;
  source_corridor_id: string | null;
  target_corridor_id: string | null;
  class_filter: string | null;
  target_first_station: string;
  target_last_station: string;
  outcomes: DiversionOutcomeRow[];
}
export async function getDiversionOutcome(id: number) {
  return (await api.get<DiversionOutcome>(`/runs/${id}/diversion`)).data;
}

export interface SmartBerths {
  by_stanme: Record<string, number>;
  by_stanox: Record<string, number>;
}

export async function getSmartBerths() {
  return (await api.get<SmartBerths>("/corridors/smart/berths")).data;
}

export async function listCorridors() {
  return (await api.get<CorridorSummary[]>("/corridors/")).data;
}

export async function getCorridor(id: string) {
  return (await api.get<CorridorDetail>(`/corridors/${id}`)).data;
}

export async function searchLocations(q: string, limit = 25) {
  const { data } = await api.get<LocationHit[]>("/locations/search",
                                                 { params: { q, limit } });
  return data;
}

export async function createCorridor(payload: {
  name: string; description: string; stations: LocationHit[];
}) {
  const { data } = await api.post<CorridorDetail>("/corridors/", payload);
  return data;
}

export async function deleteCorridor(id: string) {
  return (await api.delete(`/corridors/${id}`)).data;
}

export interface SrtSegment {
  from_seq: number;
  to_seq: number;
  from_name: string;
  to_name: string;
  srt_nb: number;
  srt_sb: number;
  eng_nb: number;
  eng_sb: number;
  loop_available: number;  // 0 | 1
  notes?: string;
}

export async function previewSrt(corridor_id: string, traction: string) {
  return (await api.post<SrtSegment[]>("/srt/preview", { corridor_id, traction })).data;
}

export interface TprDocument {
  year: number;
  version: string;
  route: string;
  route_label: string;
  filename: string;
  folder: string;
  size_bytes: number;
}

export async function listTprDocuments() {
  return (await api.get<TprDocument[]>("/tpr/index")).data;
}

export function tprDocumentUrl(folder: string, filename: string) {
  return `/api/tpr/document?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`;
}

export interface TprEaEntry {
  location: string;
  line: string;
  ea_min: number;
  pa_min: number;
  note: string;
}

export interface TprSrtAdj {
  location: string;
  direction: string;
  movement: string;
  adj_min: string;
  train_type: string;
  condition: string;
}

export interface TprLoop {
  name: string;
  location: string;
  line: string;
  length_slu: number | null;
  length_m: number | null;
  note: string;
}

export interface TprRouteYear {
  version: string;
  ea: { Down: TprEaEntry[]; Up: TprEaEntry[] };
  srt_adjustments: TprSrtAdj[];
  loops: TprLoop[];
}

export interface TprRoute {
  name: string;
  description: string;
  sort_order?: number;
  years: Record<string, TprRouteYear>;
}

export type TprStructured = Record<string, TprRoute>;

export async function listTprStructured() {
  return (await api.get<TprStructured>("/tpr/structured")).data;
}

export function runLogStream(id: number,
                              onMessage: (m: any) => void,
                              onClose?: () => void): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${window.location.host}/api/ws/runs/${id}`);
  ws.onmessage = (ev) => {
    try { onMessage(JSON.parse(ev.data)); }
    catch { onMessage(ev.data); }
  };
  if (onClose) ws.onclose = onClose;
  return ws;
}
