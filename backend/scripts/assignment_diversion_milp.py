"""
assignment_diversion_milp.py
============================
Shift-assignment MILP for the diversion pipeline.

Model (matches the study's original formulation):

    max  Z  =  Σ_{t,s} x_{t,s}   −   λ · Σ_{t,s} |s| · x_{t,s}

    C1  Σ_s x_{t,s} ≤ 1                        for every train t
    C2  Σ_{(t,s) ∈ Occ(k,w)} x_{t,s} ≤ n_k − b_{k,w}   for every (k,w)
    C3  x_{t,s} ≤ f_{t,s}   (infeasible pairs are pre-fixed to 0 by
                              simply not being added to the LP)

  Decision var
    x_{t,s} ∈ {0,1}   = 1 iff train t is placed at shift s ∈ S_t

  Sets / data
    T        = divertible trains (rows of candidate_paths_diversion.csv)
    S_t      = { -F, -F+step, ..., 0, ..., F }   (feasible shifts only)
    K        = stations on the target corridor (from target_corridor.json)
    W        = quarter-hour time windows of the day (96 per day)
    Occ(t,s) = set of (k,w) that train t at shift s occupies on the
               target corridor
    n_k      = platform / berth capacity of station k          (--n-berths)
    b_{k,w}  = proximity baseline load at (k,w): baseline trains within
               ±HEADWAY_MIN of the window midpoint at station k
               (from baseline_traffic_diversion.csv)
    λ        = shift penalty (default 1e-3)

The shift-shifted trajectory on the target corridor is:
    entry_min = base_entry(t) + s     (mod 1440)
    k-th visit_min(t,s) = entry_min  +  chainage_km(k) / v_kmh * 60
    occupation_window(k) = 15-min bucket containing visit_min(t,s)

Outputs
  --out   solution.csv    (path_id, inserted, dep_min, shift_min,
                            outcome, headcode, original_hhmm,
                            assigned_hhmm)
  --kpis  kpis.json       objective, gap, wall_solve_time_s, counts

"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from pulp import (LpBinary, LpMaximize, LpProblem, LpStatus, LpVariable,
                   PULP_CBC_CMD, lpSum, value)


WINDOW_MIN = 15                    # 15-minute buckets (96 per day)
HEADWAY_MIN = 15                   # ±minutes for proximity conflict check
DEFAULT_LAMBDA = 1.0e-3
DEFAULT_N_BERTHS = 6
DEFAULT_SHIFT_STEP = 5             # minute grid of allowable shifts
DEFAULT_V_KMH = 96                 # class-4 freight ≈ 60 mph
DEFAULT_TIME_LIMIT = 300


def hhmm(minute: int) -> str:
    m = int(minute) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def parse_int(v, default: int = 0) -> int:
    try: return int(v)
    except (TypeError, ValueError): return default


def load_candidates(path: Path) -> list[dict]:
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r["earliest_dep_min"] = parse_int(r.get("earliest_dep_min"))
            r["latest_dep_min"]   = parse_int(r.get("latest_dep_min"))
            r["original_dep_min"] = parse_int(r.get("original_dep_min"))
            r["origin_seq"]       = parse_int(r.get("origin_seq"))
            r["destination_seq"]  = parse_int(r.get("destination_seq"))
            # Date may or may not be present depending on prepare version
            r["date"] = (r.get("date") or "").strip()
            rows.append(r)
    return rows


def load_baseline(path: Path) -> list[dict]:
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r["junction_seq"] = parse_int(r.get("junction_seq"))
            r["t_min"]        = parse_int(r.get("t_min"))
            r["date"]         = (r.get("date") or "").strip()
            rows.append(r)
    return rows


def build_chainage_map(target_corridor: dict) -> dict[int, float]:
    """seq -> chainage_km along the target corridor."""
    out: dict[int, float] = {}
    for s in target_corridor.get("stations", []):
        try:
            out[int(s["seq"])] = float(s.get("chainage_km") or 0)
        except (TypeError, ValueError):
            pass
    return out


def bucket(t_min: int) -> int:
    """Return the quarter-hour window index (0..95) for a minute value."""
    return (int(t_min) % 1440) // WINDOW_MIN


def build_baseline_arrivals(
        baseline: list[dict]) -> dict[tuple[str, int, str], list[int]]:
    """Per (date, station, direction): sorted list of baseline arrival minutes.

    Keying by direction prevents NB and SB trains from competing for the same
    berth pool — they occupy physically separate track on a bi-directional line.
    """
    out: dict[tuple[str, int, str], list[int]] = defaultdict(list)
    for r in baseline:
        dirn = (r.get("direction") or "").strip().upper()
        out[(r["date"], r["junction_seq"], dirn)].append(r["t_min"])
    return {k: sorted(v) for k, v in out.items()}


def count_nearby(sorted_times: list[int], arrival: int, headway: int,
                 day_min: int = 1440) -> int:
    """Count baseline trains within ±headway minutes of arrival (wraps midnight)."""
    a = int(arrival) % day_min
    count = 0
    for t in sorted_times:
        diff = abs(t - a)
        diff = min(diff, day_min - diff)
        if diff < headway:
            count += 1
    return count


def build_and_solve(candidates: list[dict],
                    baseline: list[dict],
                    chainage: dict[int, float],
                    flex_min: int,
                    shift_step: int,
                    v_kmh: float,
                    n_berths: int,
                    lam: float,
                    time_limit: int,
                    solver_log: Path,
                    berths_per_station: dict[int, int] | None = None) -> dict:
    """Return dict with solution rows and KPIs."""
    if shift_step < 1: shift_step = 1
    if v_kmh <= 0: v_kmh = DEFAULT_V_KMH
    stations = sorted(chainage.keys())

    def station_berths(k: int) -> int:
        if berths_per_station and k in berths_per_station:
            return berths_per_station[k]
        return n_berths

    if not stations:
        raise SystemExit("target corridor has no stations with chainage_km")

    baseline_arrivals = build_baseline_arrivals(baseline)
    # x_{t,s} keyed by (path_id, shift_int)
    prob = LpProblem("diversion_shift_assignment", LpMaximize)
    x: dict[tuple[str, int], LpVariable] = {}
    train_shifts: dict[str, list[int]] = defaultdict(list)
    # For per-cell capacity constraint we need occupants(date, k, w, direction)
    cell_occ: dict[tuple[str, int, int, str], list[LpVariable]] = defaultdict(list)
    penalty_terms: list = []
    obj_terms: list = []
    n_pairs = n_infeasible = n_no_date = 0

    for c in candidates:
        pid   = c["path_id"]
        date  = c.get("date", "")
        dirn  = (c.get("direction") or "").strip().upper()
        if not date:
            n_no_date += 1
        base = c["original_dep_min"]
        e_min = c["earliest_dep_min"]
        l_min = c["latest_dep_min"]
        # Effective feasibility window may be narrower than ±flex_min
        s_min = max(-flex_min, e_min - base)
        s_max = min( flex_min, l_min - base)
        if s_max < s_min:
            n_infeasible += 1
            continue

        for s in range(s_min, s_max + 1, shift_step):
            n_pairs += 1
            entry_min = (base + s) % 1440
            # Occupation footprint: (k, visit_min) for proximity check
            occ_list: list[tuple[int, int]] = []
            for k in stations:
                travel_min = int(round(chainage[k] * 60.0 / v_kmh))
                visit_min  = (entry_min + travel_min) % 1440
                occ_list.append((k, visit_min))

            # C3: pre-fix infeasible shifts using ±HEADWAY_MIN proximity check.
            # If any station already has ≥ its SMART berth count of baseline
            # trains within ±HEADWAY_MIN, the slot is physically blocked.
            hard_infeasible = any(
                count_nearby(baseline_arrivals.get((date, k, dirn), []),
                             visit_min, HEADWAY_MIN) >= station_berths(k)
                for k, visit_min in occ_list)
            if hard_infeasible:
                n_infeasible += 1
                continue

            # Build bucket-keyed occupancy set for LP constraint cells
            occ_cells: set[tuple[str, int, int, str]] = {
                (date, k, bucket(visit_min), dirn) for k, visit_min in occ_list
            }

            var = LpVariable(f"x_{pid}_{s:+d}".replace("+", "p")
                              .replace("-", "n"), cat=LpBinary)
            x[(pid, s)] = var
            train_shifts[pid].append(s)
            obj_terms.append(var)
            if s != 0:
                penalty_terms.append(abs(s) * var)
            for dkw in occ_cells:
                cell_occ[dkw].append(var)

    # ── Objective
    prob += lpSum(obj_terms) - lam * lpSum(penalty_terms)

    # ── C1  at most one shift per train
    for pid, shifts in train_shifts.items():
        prob += lpSum(x[(pid, s)] for s in shifts) <= 1, f"assign_{pid}"

    # ── C2  berth capacity  (per date × station × window)
    # Use proximity count at window midpoint as conservative baseline load.
    for (d, k, w, dirn_cell), vars_ in cell_occ.items():
        w_mid = w * WINDOW_MIN + WINDOW_MIN // 2
        b_prox = count_nearby(baseline_arrivals.get((d, k, dirn_cell), []), w_mid, HEADWAY_MIN)
        cap = station_berths(k) - b_prox
        d_tag = d.replace("-", "") or "nodate"
        dirn_tag = dirn_cell or "X"
        if cap <= 0:
            for v in vars_:
                prob += v <= 0, f"cap0_{d_tag}_{k}_{w}_{dirn_tag}_{v.name}"
        else:
            prob += lpSum(vars_) <= cap, f"cap_{d_tag}_{k}_{w}_{dirn_tag}"

    n_bin = len(x)   # count directly — prob.variables() may be empty before solve
    print(f"[assign] variables (binary)={n_bin}  "
          f"pairs considered={n_pairs}  pre-infeasible={n_infeasible}"
          + (f"  no-date-candidates={n_no_date}" if n_no_date else "")
          + f"  constraints={len(prob.constraints)}", flush=True)

    solver = PULP_CBC_CMD(msg=1, timeLimit=time_limit,
                          logPath=str(solver_log),
                          options=["ratioGap 0.005"])
    t0 = time.time()
    status = prob.solve(solver)
    solve_s = round(time.time() - t0, 2)
    status_str = LpStatus[status]

    hit_time_limit = False
    try:
        with solver_log.open(encoding="utf-8", errors="replace") as fh:
            hit_time_limit = "Stopped on time limit" in fh.read()
    except FileNotFoundError:
        pass

    obj_val = value(prob.objective) if prob.objective is not None else None

    # ── Extract solution rows
    solution_rows = []
    placed = shifted = conflict = 0
    total_abs_shift = 0
    for c in candidates:
        pid = c["path_id"]
        hc  = c.get("original_headcode", "")
        base = c["original_dep_min"]
        chosen_s = None
        for s in train_shifts.get(pid, []):
            raw = value(x[(pid, s)])
            if raw is not None and raw > 0.5:
                chosen_s = s
                break
        if chosen_s is None:
            conflict += 1
            solution_rows.append({
                "path_id": pid, "inserted": 0,
                "dep_min": "", "shift_min": "",
                "headcode": hc,
                "original_hhmm": hhmm(base),
                "assigned_hhmm": "",
                "outcome": "CONFLICT",
            })
        else:
            placed += 1
            if chosen_s != 0: shifted += 1
            total_abs_shift += abs(chosen_s)
            assigned_min = (base + chosen_s) % 1440
            solution_rows.append({
                "path_id": pid, "inserted": 1,
                "dep_min": assigned_min,
                "shift_min": chosen_s,
                "headcode": hc,
                "original_hhmm": hhmm(base),
                "assigned_hhmm": hhmm(assigned_min),
                "outcome": "SLOT" if chosen_s == 0 else "RESCHEDULED",
            })

    kpis = {
        "solver_status": status_str,
        "objective_value": obj_val,
        "wall_solve_time_s": solve_s,
        "hit_time_limit": hit_time_limit,
        "n_trains": len(candidates),
        "n_placed": placed,
        "n_slot":  placed - shifted,
        "n_rescheduled": shifted,
        "n_conflict": conflict,
        "placed_pct": round(placed / len(candidates) * 100.0, 2)
                      if candidates else 0.0,
        "mean_abs_shift_min": round(total_abs_shift / placed, 2)
                               if placed else 0.0,
        "shift_step_min": shift_step,
        "flex_min": flex_min,
        "n_berths": n_berths,
        "v_kmh": v_kmh,
        "shift_penalty_lambda": lam,
    }
    return {"solution": solution_rows, "kpis": kpis}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--divertible",       required=True, type=Path,
                    help="candidate_paths_diversion.csv from "
                         "prepare_diversion_inputs.py")
    ap.add_argument("--baseline",         required=True, type=Path,
                    help="baseline_traffic_diversion.csv")
    ap.add_argument("--target-corridor",  required=True, type=Path)
    ap.add_argument("--flex-min",         type=int, default=60)
    ap.add_argument("--shift-step",       type=int,
                    default=DEFAULT_SHIFT_STEP,
                    help="Shift-grid granularity (minutes). "
                         f"Default {DEFAULT_SHIFT_STEP}.")
    ap.add_argument("--n-berths",         type=int,
                    default=DEFAULT_N_BERTHS,
                    help="Berth / platform capacity per station. "
                         f"Default {DEFAULT_N_BERTHS}.")
    ap.add_argument("--v-kmh",            type=float,
                    default=DEFAULT_V_KMH,
                    help="Assumed target-corridor traversal speed. "
                         f"Default {DEFAULT_V_KMH} km/h.")
    ap.add_argument("--lambda",           dest="lam", type=float,
                    default=DEFAULT_LAMBDA,
                    help=f"Shift-magnitude penalty. Default {DEFAULT_LAMBDA}.")
    ap.add_argument("--time-limit",       type=int,
                    default=DEFAULT_TIME_LIMIT)
    ap.add_argument("--out",              required=True, type=Path,
                    help="Solution CSV path")
    ap.add_argument("--kpis",             required=True, type=Path,
                    help="KPIs JSON path")
    ap.add_argument("--berths-json",      default=None,
                    help="Path to JSON file mapping junction_seq (int) → n_berths. "
                         "Overrides --n-berths on a per-station basis.")
    ap.add_argument("--log",              default=None,
                    help="CBC solver log path (default alongside --kpis)")
    args = ap.parse_args()

    candidates = load_candidates(args.divertible)
    baseline   = load_baseline(args.baseline)
    corridor   = json.loads(args.target_corridor.read_text(encoding="utf-8"))
    chainage   = build_chainage_map(corridor)

    berths_per_station: dict[int, int] | None = None
    if args.berths_json:
        raw = json.loads(Path(args.berths_json).read_text(encoding="utf-8"))
        berths_per_station = {int(k): int(v) for k, v in raw.items()}

    print(f"[assign] {len(candidates)} candidates  "
          f"{len(baseline)} baseline touches  "
          f"corridor stations with chainage: {len(chainage)}", flush=True)
    if berths_per_station:
        print(f"[assign] per-station berths: "
              + ", ".join(f"seq{k}={v}"
                          for k, v in sorted(berths_per_station.items())),
              flush=True)
    smart_label = ("SMART per-station active" if berths_per_station
                   else f"flat {args.n_berths} berths/station")
    print(f"[assign] flex=±{args.flex_min} min  "
          f"step={args.shift_step} min  "
          f"berths={smart_label}  "
          f"fallback={args.n_berths}  v={args.v_kmh} km/h  "
          f"λ={args.lam}", flush=True)

    solver_log = Path(args.log) if args.log \
                 else args.kpis.with_suffix(".cbc.log")
    res = build_and_solve(candidates, baseline, chainage,
                           flex_min=args.flex_min,
                           shift_step=args.shift_step,
                           v_kmh=args.v_kmh,
                           n_berths=args.n_berths,
                           lam=args.lam,
                           time_limit=args.time_limit,
                           solver_log=solver_log,
                           berths_per_station=berths_per_station)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fields = ["path_id", "inserted", "dep_min", "shift_min",
              "headcode", "original_hhmm", "assigned_hhmm", "outcome"]
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(res["solution"])

    args.kpis.write_text(json.dumps(res["kpis"], indent=2),
                          encoding="utf-8")

    k = res["kpis"]
    print(f"[assign] status={k['solver_status']}  "
          f"objective={k['objective_value']}  "
          f"placed={k['n_placed']}/{k['n_trains']}  "
          f"slot={k['n_slot']}  resched={k['n_rescheduled']}  "
          f"conflict={k['n_conflict']}  "
          f"mean|shift|={k['mean_abs_shift_min']}  "
          f"wall={k['wall_solve_time_s']}s", flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
