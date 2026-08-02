import { create } from "zustand";
import {
  CorridorDetail, CorridorSummary, Health, Kpis, Run, RunTraffic, Upload,
  getHealth, listCorridors, listRuns, listUploads,
} from "../api/client";

export interface RunProgress {
  phase: "extract" | "baseline" | "milp" | "idle";
  phase_pct: number;
  percent: number;
  done_blocks: number;
  total_blocks: number;
  message: string;
  current_block?: { direction: string; index: number;
                     hour_start: number; hour_end: number };
  last_block_result?: { status: string; inserted: number;
                        candidates: number; solve_s: number };
}
const IDLE: RunProgress = { phase: "idle", phase_pct: 0, percent: 0,
                             done_blocks: 0, total_blocks: 0, message: "" };

export type Page = "home" | "upload" | "corridor" | "configure" | "runs" | "results";

interface AppState {
  page: Page;
  setPage: (p: Page) => void;

  health: Health | null;
  online: boolean;

  uploads: Upload[];
  selectedUploadId: number | null;
  selectUpload: (id: number | null) => void;

  corridors: CorridorSummary[];
  activeCorridor: CorridorDetail | null;
  selectedCorridorId: string | null;
  setActiveCorridor: (c: CorridorDetail | null) => void;
  selectCorridor: (id: string | null) => void;
  refreshCorridors: () => Promise<void>;

  runs: Run[];
  selectedRunId: number | null;
  selectedKpis: Kpis | null;
  selectedTraffic: RunTraffic | null;
  progress: RunProgress;
  log: { line: string; prefix?: string; ts?: string }[];
  selectRun: (id: number | null) => void;
  addLog: (line: string, prefix?: string) => void;
  clearLog: () => void;
  setKpis: (k: Kpis | null) => void;
  setTraffic: (t: RunTraffic | null) => void;
  setProgress: (p: Partial<RunProgress>) => void;
  resetProgress: () => void;

  refresh: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  page: "home",
  setPage: (p) => set({ page: p }),

  health: null,
  online: false,

  uploads: [],
  selectedUploadId: null,
  selectUpload: (id) => set({ selectedUploadId: id }),

  corridors: [],
  activeCorridor: null,
  selectedCorridorId: "crewe_parkside",
  setActiveCorridor: (c) => set({ activeCorridor: c }),
  selectCorridor: (id) => set({ selectedCorridorId: id }),
  refreshCorridors: async () => {
    const c = await listCorridors().catch(() => []);
    set({ corridors: c });
  },

  runs: [],
  selectedRunId: null,
  selectedKpis: null,
  selectedTraffic: null,
  progress: { ...IDLE },
  log: [],
  selectRun: (id) => set({
    selectedRunId: id, log: [], selectedKpis: null,
    selectedTraffic: null, progress: { ...IDLE },
  }),
  addLog: (line, prefix) => set((s) => ({
    log: [...s.log, { line, prefix, ts: new Date().toISOString() }],
  })),
  clearLog: () => set({ log: [] }),
  setKpis: (k) => set({ selectedKpis: k }),
  setTraffic: (t) => set({ selectedTraffic: t }),
  setProgress: (p) => set((s) => ({ progress: { ...s.progress, ...p } })),
  resetProgress: () => set({ progress: { ...IDLE } }),

  refresh: async () => {
    const [h, u, r, c] = await Promise.all([
      getHealth().catch(() => null),
      listUploads().catch(() => []),
      listRuns().catch(() => []),
      listCorridors().catch(() => []),
    ]);
    set({ health: h, online: !!h, uploads: u, runs: r, corridors: c });
  },
}));
