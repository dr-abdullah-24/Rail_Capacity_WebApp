"""
capacity_gap_milp.py
====================
Capacity-gap path insertion MILP for a rail corridor.

Question answered:
  Given observed traffic on the corridor (fixed background), how many
  additional freight paths can be inserted from origin -> destination
  without violating minimum-headway rules at any junction, allowing (if
  necessary) an intermediate dwell at a passing loop to let the newly
  inserted train fall behind a conflicting existing service?

Model summary:
  - Decision:  which candidate path to insert, when (departure minute),
               and where/how long to dwell at an intermediate loop.
  - Objective: MAX  sum(priority * inserted) - lambda_dwell * sum(dwell_min)
                     - lambda_slot  * sum(deviation_from_earliest_dep)
  - Headway:   min gap (default 3 min) between the inserted path and every
               existing train at every corridor junction (same direction).
  - Single-track occupation: on segments marked single_track=1 in srt_profile,
               Up and Down paths must not occupy the section simultaneously.
               Both inserted-vs-inserted and inserted-vs-existing conflicts
               are enforced via disjunctive Big-M constraints.
  - Headway:   same same-direction rule pairwise between inserted paths.
  - Dwell:     only allowed at junctions with loop_available=1 in
               srt_profile.  Bounded by DWELL_MAX minutes.

Outputs (results/):
  capacity_solution_<tag>.csv        one row per candidate: inserted / direction / where / dwell
  capacity_kpis_<tag>.json           solver metrics + summary
  capacity_gap_map_<tag>.csv         hour x junction heatmap (baseline tph vs slots used)
"""

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from pulp import (LpBinary, LpContinuous, LpInteger, LpMaximize, LpProblem,
                  LpStatus, LpVariable, PULP_CBC_CMD, lpSum, value)

BASE = Path(__file__).resolve().parents[1]
INP  = BASE / 'data' / 'milp'
OUT  = BASE / 'data' / 'milp_results'
OUT.mkdir(parents=True, exist_ok=True)

HEADWAY_MIN         = 3
DWELL_MAX           = 30
SINGLE_TRACK_CLEAR  = 2      # minutes signal-clearance after a train exits a single-track section
LAMBDA_DWELL        = 0.05
LAMBDA_SLOT         = 0.001
BIG_M               = 5000
SOLVER_SECS         = 300

# Per-junction headway override.  STEER (p.23): freight-following headway at
# Chat Moss junctions (Winwick Jn → Parkside Jn, seq 8-11) is 4 min.
CHAT_MOSS_HEADWAY = 4
CHAT_MOSS_JUNCS   = {8, 9, 10, 11}


def headway_at(j: int) -> int:
    return CHAT_MOSS_HEADWAY if j in CHAT_MOSS_JUNCS else HEADWAY_MIN


def _line_tag(L: str) -> str:
    return 'e' if L == '' else L.replace('/', '_').replace(' ', '_')


# ── I/O ─────────────────────────────────────────────────────────────────────
_DIR_NORM = {'northbound': 'up', 'southbound': 'down'}


def load_baseline(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8') as fh:
        rows = []
        for r in csv.DictReader(fh):
            r['junction_seq'] = int(r['junction_seq'])
            r['t_min'] = int(r['t_min'])
            r.setdefault('line', 'main')
            r['direction'] = _DIR_NORM.get(r['direction'], r['direction'])
            rows.append(r)
        return rows


def load_paths(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8') as fh:
        return [dict(r, origin_seq=int(r['origin_seq']),
                       destination_seq=int(r['destination_seq']),
                       priority_weight=float(r['priority_weight']),
                       earliest_dep_min=int(r['earliest_dep_min']),
                       latest_dep_min=int(r['latest_dep_min']))
                for r in csv.DictReader(fh)]


def load_freight_lines(path: Path) -> dict[tuple[int, str], list[str]]:
    raw = json.load(open(path, encoding='utf-8'))
    out = {}
    for k, v in raw.items():
        seq, dirn = k.split('|')
        dirn = _DIR_NORM.get(dirn, dirn)   # normalise old northbound/southbound keys
        out[(int(seq), dirn)] = list(v['lines'])
    return out


def load_srt(path: Path) -> dict[tuple[int, int], dict]:
    """(from_seq, to_seq) -> {srt_up, srt_down, eng_up, eng_down, loop, single_track}.
    Supports both old column names (srt_min_northbound) and new (srt_min_up)
    for backward compatibility with existing run directories."""
    out = {}
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            k = (int(r['from_seq']), int(r['to_seq']))
            # Support old (northbound/southbound) and new (up/down) column names
            srt_up   = int(r.get('srt_min_up')   or r.get('srt_min_northbound', 0) or 0)
            srt_down = int(r.get('srt_min_down')  or r.get('srt_min_southbound', 0) or 0)
            eng_up   = int(r.get('eng_alw_up_min')   or r.get('eng_alw_nb_min', 0) or 0)
            eng_down = int(r.get('eng_alw_down_min')  or r.get('eng_alw_sb_min', 0) or 0)
            out[k] = {
                'srt_up':       srt_up,
                'srt_down':     srt_down,
                'eng_up':       eng_up,
                'eng_down':     eng_down,
                'loop':         int(r['loop_available']),
                'single_track': int(r.get('single_track', 0) or 0),
            }
    return out


# ── Model construction ─────────────────────────────────────────────────────
def build_and_solve(baseline: list[dict],
                    paths:    list[dict],
                    srt:      dict,
                    headway:  int,
                    dwell_max:int,
                    time_limit: int,
                    freight_lines: dict | None = None) -> dict:
    """Solve one block.  paths may contain both Up and Down candidates.
    Single-track occupation constraints are enforced for any srt segment
    with single_track=1 — both between inserted paths of opposite directions
    and between inserted paths and existing baseline trains."""

    def h_of(j: int) -> int:
        return CHAT_MOSS_HEADWAY if j in CHAT_MOSS_JUNCS else headway

    junc_ids = sorted({r['junction_seq'] for r in baseline})

    # Group existing traffic by (junction, direction, line)
    existing_by_jdl: dict[tuple[int, str, str], list[int]] = defaultdict(list)
    for r in baseline:
        existing_by_jdl[(r['junction_seq'], r['direction'], r['line'])] \
            .append(r['t_min'])
    for k in existing_by_jdl:
        existing_by_jdl[k].sort()

    prob = LpProblem('capacity_gap', LpMaximize)

    x       = {}
    dep     = {}
    arr     = {}
    dwell   = {}
    d_on    = {}
    b_before, b_after = {}, {}
    y_before = {}

    # Precompute cumulative SRT per path (needed for window filtering)
    srt_by_path_j: dict[str, dict[int, int]] = {}

    for p in paths:
        pid  = p['path_id']
        dirn = p['direction']   # 'up' or 'down'
        step = +1 if dirn == 'up' else -1
        seq_seq = list(range(p['origin_seq'], p['destination_seq'] + step, step))

        x[pid]   = LpVariable(f'x_{pid}', cat=LpBinary)
        dep[pid] = LpVariable(f'dep_{pid}', lowBound=0, upBound=1440, cat=LpInteger)

        for j in seq_seq:
            arr[(pid, j)] = LpVariable(f'arr_{pid}_{j}',
                                       lowBound=0, upBound=2 * 1440,
                                       cat=LpContinuous)
        for j in seq_seq[1:-1]:
            k = (j, j + step) if step > 0 else (j + step, j)
            leg = srt.get(k)
            if leg and leg['loop']:
                dwell[(pid, j)] = LpVariable(f'dw_{pid}_{j}',
                                             lowBound=0, upBound=dwell_max,
                                             cat=LpInteger)
                d_on[(pid, j)]  = LpVariable(f'don_{pid}_{j}', cat=LpBinary)

        prob += dep[pid] >= p['earliest_dep_min'] - BIG_M * (1 - x[pid])
        prob += dep[pid] <= p['latest_dep_min']   + BIG_M * (1 - x[pid])

        origin = seq_seq[0]
        prob += arr[(pid, origin)] == dep[pid]

        srt_cum = 0
        cum_by_j: dict[int, int] = {seq_seq[0]: 0}
        for a, b in zip(seq_seq[:-1], seq_seq[1:]):
            k = (a, b) if step > 0 else (b, a)
            leg = srt[k]
            srt_leg = (leg['srt_up'] + leg['eng_up']) if step > 0 \
                      else (leg['srt_down'] + leg['eng_down'])
            dw = dwell.get((pid, a), 0)
            prob += arr[(pid, b)] == arr[(pid, a)] + srt_leg + dw
            srt_cum += srt_leg
            cum_by_j[b] = srt_cum

        srt_by_path_j[pid] = cum_by_j

        for j in seq_seq[1:-1]:
            if (pid, j) in dwell:
                prob += dwell[(pid, j)] <= dwell_max * d_on[(pid, j)]
                prob += dwell[(pid, j)] >= d_on[(pid, j)]
                prob += d_on[(pid, j)]  <= x[pid]

        # Headway vs existing same-direction traffic
        max_extra = dwell_max * max(1, len(seq_seq) - 2)
        line_pick: dict[tuple[int, str], LpVariable] = {}
        for j in seq_seq:
            allowed = (freight_lines or {}).get((j, dirn))
            if allowed is None:
                allowed = sorted({r['line'] for r in baseline
                                  if r['junction_seq'] == j
                                     and r['direction'] == dirn})
            if not allowed:
                allowed = ['']
            for L in allowed:
                l_var = LpVariable(f'line_{pid}_{j}_{_line_tag(L)}', cat=LpBinary)
                line_pick[(j, L)] = l_var
            prob += lpSum(line_pick[(j, L)] for L in allowed) == x[pid]

        for j in seq_seq:
            hj = h_of(j)
            allowed = sorted({L for (jj, L) in line_pick if jj == j})
            t_lo = p['earliest_dep_min'] + cum_by_j[j] - hj - 1
            t_hi = p['latest_dep_min']   + cum_by_j[j] + max_extra + hj + 1
            for L in allowed:
                for idx, t_e in enumerate(
                        existing_by_jdl.get((j, dirn, L), [])):
                    if t_e < t_lo or t_e > t_hi:
                        continue
                    tag   = f'{pid}_{j}_{_line_tag(L)}_{idx}'
                    b_bef = LpVariable(f'bef_{tag}', cat=LpBinary)
                    b_aft = LpVariable(f'aft_{tag}', cat=LpBinary)
                    b_before[(pid, j, L, idx)] = b_bef
                    b_after [(pid, j, L, idx)] = b_aft
                    lL = line_pick[(j, L)]
                    prob += b_bef + b_aft >= lL
                    prob += arr[(pid, j)] + hj <= (
                        t_e + BIG_M * (1 - b_bef) + BIG_M * (1 - lL))
                    prob += arr[(pid, j)] - hj >= (
                        t_e - BIG_M * (1 - b_aft) - BIG_M * (1 - lL))

    # ── Pairwise same-direction headway between inserted paths ───────────────
    path_by_dir = defaultdict(list)
    for p in paths:
        path_by_dir[p['direction']].append(p)

    for dirn, plist in path_by_dir.items():
        for i in range(len(plist)):
            for ki in range(i + 1, len(plist)):
                p1, p2 = plist[i], plist[ki]
                p1id, p2id = p1['path_id'], p2['path_id']
                step = +1 if dirn == 'up' else -1
                s1 = set(range(p1['origin_seq'],
                               p1['destination_seq'] + step, step))
                s2 = set(range(p2['origin_seq'],
                               p2['destination_seq'] + step, step))
                for j in sorted(s1 & s2):
                    hj = h_of(j)
                    y = LpVariable(f'y_{p1id}_{p2id}_{j}', cat=LpBinary)
                    y_before[(p1id, p2id, j)] = y
                    inserted_both = x[p1id] + x[p2id] - 1
                    prob += arr[(p1id, j)] + hj - arr[(p2id, j)] \
                            <= BIG_M * (1 - y) + BIG_M * (1 - inserted_both)
                    prob += arr[(p2id, j)] + hj - arr[(p1id, j)] \
                            <= BIG_M * y + BIG_M * (1 - inserted_both)

    # ── Single-track occupation constraints ──────────────────────────────────
    # Enumerate single-track sections (a < b always; key in srt is (low, high))
    single_track_segs = [
        (a, b, leg)
        for (a, b), leg in srt.items()
        if a < b and leg.get('single_track')
    ]

    up_paths   = [p for p in paths if p['direction'] == 'up']
    down_paths = [p for p in paths if p['direction'] == 'down']

    if single_track_segs:
        # (A) Inserted Up path vs inserted Down path on same single-track section
        for p1 in up_paths:
            p1id     = p1['path_id']
            p1_juncs = set(range(p1['origin_seq'], p1['destination_seq'] + 1))
            for p2 in down_paths:
                p2id     = p2['path_id']
                # Down path: origin > destination; covers junctions in that range
                p2_juncs = set(range(p2['destination_seq'], p2['origin_seq'] + 1))
                for a, b, _ in single_track_segs:
                    if a not in p1_juncs or b not in p1_juncs:
                        continue
                    if a not in p2_juncs or b not in p2_juncs:
                        continue
                    if (p1id, a) not in arr or (p1id, b) not in arr:
                        continue
                    if (p2id, a) not in arr or (p2id, b) not in arr:
                        continue
                    # z=1: Up clears b before Down enters b
                    # z=0: Down clears a before Up enters a
                    z = LpVariable(f'occ_{p1id}_{p2id}_{a}_{b}', cat=LpBinary)
                    prob += (arr[(p1id, b)] + SINGLE_TRACK_CLEAR - arr[(p2id, b)]
                             <= BIG_M * (1 - z)
                             + BIG_M * (1 - x[p1id])
                             + BIG_M * (1 - x[p2id]))
                    prob += (arr[(p2id, a)] + SINGLE_TRACK_CLEAR - arr[(p1id, a)]
                             <= BIG_M * z
                             + BIG_M * (1 - x[p1id])
                             + BIG_M * (1 - x[p2id]))

        # (B) Inserted Up path vs existing Down baseline trains on single-track
        for a, b, leg in single_track_segs:
            srt_dn = leg['srt_down'] + leg['eng_down']
            for line in sorted({k[2] for k in existing_by_jdl
                                if k[0] == b and k[1] == 'down'}):
                for idx, t_b in enumerate(
                        existing_by_jdl.get((b, 'down', line), [])):
                    # Existing Down: enters section at b@t_b, exits at a@(t_b+srt_dn)
                    t_exit_a = t_b + srt_dn
                    for p1 in up_paths:
                        p1id     = p1['path_id']
                        p1_juncs = set(range(p1['origin_seq'],
                                             p1['destination_seq'] + 1))
                        if a not in p1_juncs or b not in p1_juncs:
                            continue
                        if (p1id, a) not in arr or (p1id, b) not in arr:
                            continue
                        # Window filter: skip if no temporal overlap possible
                        cum = srt_by_path_j[p1id]
                        max_extra = dwell_max * max(1, len(cum) - 2)
                        t_lo_b = (p1['earliest_dep_min'] + cum.get(b, 0)
                                  - SINGLE_TRACK_CLEAR - 1)
                        t_hi_a = (p1['latest_dep_min'] + cum.get(a, 0)
                                  + max_extra + SINGLE_TRACK_CLEAR + 1)
                        if t_b > t_hi_a or t_exit_a < t_lo_b:
                            continue
                        tag = f'xdn_{p1id}_{a}_{b}_{_line_tag(line)}_{idx}'
                        fv  = LpVariable(f'f_{tag}', cat=LpBinary)
                        # fv=1: Up clears b before existing Down enters b
                        prob += (arr[(p1id, b)] + SINGLE_TRACK_CLEAR - t_b
                                 <= BIG_M * (1 - fv) + BIG_M * (1 - x[p1id]))
                        # fv=0: existing Down clears a before Up enters a
                        prob += (t_exit_a + SINGLE_TRACK_CLEAR - arr[(p1id, a)]
                                 <= BIG_M * fv + BIG_M * (1 - x[p1id]))

        # (C) Inserted Down path vs existing Up baseline trains on single-track
        for a, b, leg in single_track_segs:
            srt_up_leg = leg['srt_up'] + leg['eng_up']
            for line in sorted({k[2] for k in existing_by_jdl
                                if k[0] == a and k[1] == 'up'}):
                for idx, t_a in enumerate(
                        existing_by_jdl.get((a, 'up', line), [])):
                    # Existing Up: enters section at a@t_a, exits at b@(t_a+srt_up)
                    t_exit_b = t_a + srt_up_leg
                    for p2 in down_paths:
                        p2id     = p2['path_id']
                        p2_juncs = set(range(p2['destination_seq'],
                                             p2['origin_seq'] + 1))
                        if a not in p2_juncs or b not in p2_juncs:
                            continue
                        if (p2id, a) not in arr or (p2id, b) not in arr:
                            continue
                        cum = srt_by_path_j[p2id]
                        max_extra = dwell_max * max(1, len(cum) - 2)
                        t_lo_a = (p2['earliest_dep_min'] + cum.get(a, 0)
                                  - SINGLE_TRACK_CLEAR - 1)
                        t_hi_b = (p2['latest_dep_min'] + cum.get(b, 0)
                                  + max_extra + SINGLE_TRACK_CLEAR + 1)
                        if t_a > t_hi_b or t_exit_b < t_lo_a:
                            continue
                        tag = f'xup_{p2id}_{a}_{b}_{_line_tag(line)}_{idx}'
                        ev  = LpVariable(f'e_{tag}', cat=LpBinary)
                        # ev=1: Down clears a before existing Up enters a
                        prob += (arr[(p2id, a)] + SINGLE_TRACK_CLEAR - t_a
                                 <= BIG_M * (1 - ev) + BIG_M * (1 - x[p2id]))
                        # ev=0: existing Up clears b before Down enters b
                        prob += (t_exit_b + SINGLE_TRACK_CLEAR - arr[(p2id, b)]
                                 <= BIG_M * ev + BIG_M * (1 - x[p2id]))

    # ── Objective ────────────────────────────────────────────────────────────
    slot_dev = {}
    for p in paths:
        pid = p['path_id']
        d_p = LpVariable(f'slotdev_{pid}', lowBound=0, cat=LpContinuous)
        slot_dev[pid] = d_p
        prob += d_p >= dep[pid] - p['earliest_dep_min'] - BIG_M * (1 - x[pid])

    prob += (
        lpSum(p['priority_weight'] * x[p['path_id']] for p in paths)
        - LAMBDA_DWELL * lpSum(dwell.values())
        - LAMBDA_SLOT  * lpSum(slot_dev.values())
    )

    n_bin = sum(1 for v in prob.variables() if v.cat == 'Binary')
    n_int = sum(1 for v in prob.variables() if v.cat == 'Integer')
    n_con = sum(1 for v in prob.variables() if v.cat == 'Continuous')
    st_note = f'  single_track_segs={len(single_track_segs)}' if single_track_segs else ''
    print(f'[milp] vars: bin={n_bin} int={n_int} cont={n_con}  '
          f'constraints={len(prob.constraints)}{st_note}')

    solver_log = OUT / '_cbc_last.log'
    t0 = time.time()
    options = ['heuristicsOnOff on', 'feasibilityPump on']
    solver_kwargs: dict = dict(msg=1, logPath=str(solver_log), options=options)
    if time_limit > 0:
        solver_kwargs['timeLimit'] = time_limit
        options.insert(0, 'ratioGap 0.05')
    solver = PULP_CBC_CMD(**solver_kwargs)
    status = prob.solve(solver)
    solve_s = round(time.time() - t0, 1)

    hit_time_limit = False
    try:
        with open(solver_log, encoding='utf-8', errors='replace') as fh:
            hit_time_limit = 'Stopped on time limit' in fh.read()
    except FileNotFoundError:
        pass

    solution = []
    total_inserted = 0
    total_dwell    = 0
    integer_ok = LpStatus[status] in ('Optimal',)
    for p in paths:
        pid  = p['path_id']
        dirn = p['direction']
        raw  = value(x[pid])
        inserted = 1 if (integer_ok and raw is not None and raw > 0.5) else 0
        if not inserted:
            solution.append({'path_id': pid, 'direction': dirn, 'inserted': 0})
            continue
        total_inserted += 1
        step = +1 if dirn == 'up' else -1
        seq_seq = list(range(p['origin_seq'], p['destination_seq'] + step, step))
        entries = []
        for j in seq_seq:
            t_j  = int(round(value(arr[(pid, j)])))
            dw_j = int(round(value(dwell.get((pid, j), 0)) or 0)) \
                     if (pid, j) in dwell else 0
            total_dwell += dw_j
            entries.append(f'j{j}@{t_j // 60:02d}:{t_j % 60:02d}'
                           + (f'+{dw_j}m' if dw_j else ''))
        solution.append({
            'path_id':   pid,
            'direction': dirn,
            'inserted':  1,
            'dep_min':   int(round(value(dep[pid]))),
            'dep_hhmm':  f'{int(value(dep[pid])) // 60:02d}:{int(value(dep[pid])) % 60:02d}',
            'route':     ' -> '.join(entries),
            'dwell_min': sum(int(round(value(dwell.get((pid, j), 0)) or 0))
                              for j in seq_seq if (pid, j) in dwell),
        })

    reported_status = LpStatus[status]
    if hit_time_limit:
        reported_status = 'TimeLimit'
    kpis = {
        'solver_status':   reported_status,
        'hit_time_limit':  hit_time_limit,
        'objective_value': round(value(prob.objective) or 0.0, 3),
        'solve_time_s':    solve_s,
        'n_variables':     len(prob.variables()),
        'n_constraints':   len(prob.constraints),
        'headway_min':     headway,
        'dwell_max':       dwell_max,
        'candidate_paths': len(paths),
        'paths_inserted':  total_inserted,
        'total_dwell_min': total_dwell,
        'baseline_trains': len({(r['headcode'], r['journey_num'])
                                for r in baseline}),
    }
    return {'solution': solution, 'kpis': kpis, 'baseline': baseline}


def write_gap_map(baseline: list[dict], solution: list[dict],
                  paths: list[dict], out_csv: Path) -> None:
    p_by_id = {p['path_id']: p for p in paths}
    grid = defaultdict(int)
    for r in baseline:
        grid[('base', r['junction_seq'], r['direction'], r['t_min'] // 60)] += 1
    for s in solution:
        if not s.get('inserted'):
            continue
        p = p_by_id[s['path_id']]
        for tok in s['route'].split(' -> '):
            jstr, tstr = tok.split('@')
            j  = int(jstr[1:])
            hh = int(tstr[:2])
            grid[('new', j, p['direction'], hh)] += 1

    with open(out_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['category', 'junction_seq', 'direction', 'hour_utc', 'count'])
        for (cat, j, d, h), c in sorted(grid.items()):
            w.writerow([cat, j, d, h, c])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--paths',   default=str(INP / 'candidate_paths.csv'))
    ap.add_argument('--srt',     default=str(INP / 'srt_profile.csv'))
    ap.add_argument('--freight-lines', default=None)
    ap.add_argument('--tag',     default='run')
    ap.add_argument('--headway',    type=int, default=HEADWAY_MIN)
    ap.add_argument('--dwell-max',  type=int, default=DWELL_MAX)
    ap.add_argument('--time-limit', type=int, default=SOLVER_SECS)
    args = ap.parse_args()

    print(f'[milp] loading {Path(args.baseline).name}')
    baseline = load_baseline(Path(args.baseline))
    paths    = load_paths(Path(args.paths))
    srt      = load_srt(Path(args.srt))
    freight_lines = load_freight_lines(Path(args.freight_lines)) \
                    if args.freight_lines else None
    print(f'[milp] baseline touches={len(baseline)}  candidates={len(paths)}'
          f'  line-aware={"yes" if freight_lines else "no"}')

    res = build_and_solve(baseline, paths, srt,
                          args.headway, args.dwell_max, args.time_limit,
                          freight_lines=freight_lines)

    sol_csv  = OUT / f'capacity_solution_{args.tag}.csv'
    kpi_json = OUT / f'capacity_kpis_{args.tag}.json'
    gap_csv  = OUT / f'capacity_gap_map_{args.tag}.csv'

    with open(sol_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['path_id', 'direction', 'inserted',
                                            'dep_min', 'dep_hhmm', 'route',
                                            'dwell_min'])
        w.writeheader()
        for row in res['solution']:
            w.writerow({k: row.get(k, '') for k in w.fieldnames})

    with open(kpi_json, 'w', encoding='utf-8') as fh:
        json.dump(res['kpis'], fh, indent=2)

    write_gap_map(res['baseline'], res['solution'], paths, gap_csv)

    print(f'[milp] status={res["kpis"]["solver_status"]}  '
          f'inserted={res["kpis"]["paths_inserted"]}/{len(paths)}  '
          f'time={res["kpis"]["solve_time_s"]}s')
    print(f'[milp] wrote {sol_csv.name}, {kpi_json.name}, {gap_csv.name}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
