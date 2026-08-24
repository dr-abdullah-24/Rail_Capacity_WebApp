"""
capacity_gap_milp.py
====================
Capacity-gap path insertion MILP for the STEER Route 3 corridor.

Question answered:
  Given the observed 2018 traffic on the corridor (fixed background),
  how many additional freight paths can be inserted from origin -> destination
  without violating minimum-headway rules at any junction, allowing (if
  necessary) an intermediate dwell at a passing loop to let the newly
  inserted train fall behind a conflicting existing service?

Model summary:
  - Decision:  which candidate path to insert, when (departure minute),
               and where/how long to dwell at an intermediate loop.
  - Objective: MAX  sum(priority * inserted) - lambda_dwell * sum(dwell_min)
                     - lambda_slot  * sum(deviation_from_earliest_dep)
  - Headway:   min gap (default 4 min, UK TPRs / STEER) between the inserted
               path and every existing train at every corridor junction.
  - Headway:   same rule pairwise between inserted paths.
  - Dwell:     only allowed at junctions with loop_available = 1 in
               srt_profile.csv.  Bounded by DWELL_MAX minutes.

Outputs (results/):
  capacity_solution_<tag>.csv        one row per candidate: inserted / where / dwell
  capacity_kpis_<tag>.json           solver metrics + STEER comparison summary
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

# Bundled paths (script lives at backend/scripts/, data at backend/data/milp/)
BASE = Path(__file__).resolve().parents[1]          # backend/
INP  = BASE / 'data' / 'milp'                       # bundled MILP inputs
OUT  = BASE / 'data' / 'milp_results'               # scratch for CBC logs
OUT.mkdir(parents=True, exist_ok=True)

HEADWAY_MIN   = 3       # STEER Route 3 default: UK TPR same-direction planning headway
DWELL_MAX     = 30      # max minutes a new train can sit in a passing loop
LAMBDA_DWELL  = 0.05    # per-minute penalty for chosen dwell
LAMBDA_SLOT   = 0.001   # tiny per-minute penalty on departure to force early
BIG_M         = 5000    # safely covers arr upper bound + headway
SOLVER_SECS   = 300

# Per-junction headway override.  STEER (page 23): "The headway on the Chat
# Moss Line at Parkside is 3 minutes, but 4 minutes when following a freight
# train."  We apply the freight-follow 4-min value at Chat Moss junctions
# (Winwick Jn -> Parkside Jn, seq 8..11) both directions.  This is the ONLY
# location-based rule kept; it is directly cited from the STEER report.
CHAT_MOSS_HEADWAY = 4
CHAT_MOSS_JUNCS   = {8, 9, 10, 11}


def headway_at(j: int) -> int:
    return CHAT_MOSS_HEADWAY if j in CHAT_MOSS_JUNCS else HEADWAY_MIN


def _line_tag(L: str) -> str:
    """PuLP variable names must not contain special characters; encode the
    line token (which may be empty or contain digits/letters) safely."""
    return 'e' if L == '' else L.replace('/', '_').replace(' ', '_')


# ── I/O ─────────────────────────────────────────────────────────────────────
def load_baseline(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8') as fh:
        rows = []
        for r in csv.DictReader(fh):
            r['junction_seq'] = int(r['junction_seq'])
            r['t_min'] = int(r['t_min'])
            r.setdefault('line', 'main')       # older baselines without line
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
    """(junction_seq, direction) -> ordered list of line-tokens observed
    for class-4/6 freight (or fallback all-traffic) at that junction."""
    raw = json.load(open(path, encoding='utf-8'))
    out = {}
    for k, v in raw.items():
        seq, dirn = k.split('|')
        out[(int(seq), dirn)] = list(v['lines'])
    return out


def load_srt(path: Path) -> dict[tuple[int, int], dict]:
    """(from_seq, to_seq) -> {srt_nb, srt_sb, eng_nb, eng_sb, loop}.
    Engineering allowance is added to SRT in the appropriate direction, per
    STEER's TPR-based method (applied in one direction only per route)."""
    out = {}
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            k = (int(r['from_seq']), int(r['to_seq']))
            out[k] = {
                'srt_nb': int(r['srt_min_northbound']),
                'srt_sb': int(r['srt_min_southbound']),
                'eng_nb': int(r.get('eng_alw_nb_min', 0) or 0),
                'eng_sb': int(r.get('eng_alw_sb_min', 0) or 0),
                'loop':   int(r['loop_available']),
            }
    return out


# ── Model construction ─────────────────────────────────────────────────────
def build_and_solve(baseline: list[dict],
                    paths:    list[dict],
                    srt:      dict,
                    headway:  int,      # baseline headway when no per-junc override
                    dwell_max:int,
                    time_limit: int,
                    freight_lines: dict | None = None) -> dict:
    """freight_lines: {(junction_seq, direction): [line_token, ...]}.
    If given, the candidate freight picks ONE line from the allowed set at
    each junction and only conflicts with existing traffic on that line.
    If None, every existing train at every junction conflicts (single-line
    fallback that reproduces the pre-line-aware behaviour)."""

    def h_of(j: int) -> int:
        """Per-junction headway (STEER Chat Moss rule)."""
        return CHAT_MOSS_HEADWAY if j in CHAT_MOSS_JUNCS else headway

    # Junction sequence covered
    junc_ids = sorted({r['junction_seq'] for r in baseline})
    max_seq  = max(junc_ids)

    # Group existing traffic by (junction, direction, line) for headway
    # lookup.  Line-aware filtering is applied at constraint generation.
    existing_by_jdl: dict[tuple[int, str, str], list[int]] = defaultdict(list)
    for r in baseline:
        existing_by_jdl[(r['junction_seq'], r['direction'], r['line'])] \
            .append(r['t_min'])
    for k in existing_by_jdl:
        existing_by_jdl[k].sort()

    prob = LpProblem('capacity_gap', LpMaximize)

    x       = {}   # x[p] = 1 if inserted
    dep     = {}   # dep[p] = departure minute (integer)
    arr     = {}   # arr[p,j] = arrival minute at junction j on path p
    dwell   = {}   # dwell[p,j] = dwell minutes added at junction j
    d_on    = {}   # d_on[p,j] = binary: is dwell active at j?

    # Headway disjunctive binaries.
    # For each (path, junction) x (existing train at same junction/direction):
    #   b_before[p,j,e] = 1  =>  arr[p,j] + h <= t_e
    #   b_after[p,j,e]  = 1  =>  arr[p,j] >= t_e + h
    b_before, b_after = {}, {}
    # Pairwise between two inserted paths at same junction/direction:
    y_before = {}   # y_before[p1,p2,j] = 1 -> p1 first at j

    for p in paths:
        pid = p['path_id']
        x[pid] = LpVariable(f'x_{pid}', cat=LpBinary)
        dep[pid] = LpVariable(f'dep_{pid}',
                              lowBound=0, upBound=1440, cat=LpInteger)

        step = +1 if p['direction'] == 'northbound' else -1
        seq_seq = list(range(p['origin_seq'], p['destination_seq'] + step, step))

        # arrival vars along the path (including origin)
        for j in seq_seq:
            arr[(pid, j)] = LpVariable(f'arr_{pid}_{j}',
                                       lowBound=0, upBound=2 * 1440,
                                       cat=LpContinuous)
        # dwell only at intermediate loops (not origin, not destination)
        for j in seq_seq[1:-1]:
            k = (j, j + step) if step > 0 else (j + step, j)
            leg = srt.get(k, None)
            if leg and leg['loop']:
                dwell[(pid, j)] = LpVariable(f'dw_{pid}_{j}',
                                             lowBound=0, upBound=dwell_max,
                                             cat=LpInteger)
                d_on[(pid, j)]  = LpVariable(f'don_{pid}_{j}', cat=LpBinary)

        # ── Path activation & departure window
        # If not inserted, dep is unconstrained but arrivals will be forced
        # to sink so the constraints are inactive via BIG_M multipliers.
        prob += dep[pid] >= p['earliest_dep_min'] - BIG_M * (1 - x[pid])
        prob += dep[pid] <= p['latest_dep_min']   + BIG_M * (1 - x[pid])

        # arr[origin] = dep
        origin = seq_seq[0]
        prob += arr[(pid, origin)] == dep[pid]

        # Time propagation between consecutive junctions.  Engineering
        # allowance from srt_profile.csv is added to the direction where it
        # is defined (STEER: TPR eng allowance applies to one direction
        # only per route).
        for a, b in zip(seq_seq[:-1], seq_seq[1:]):
            k = (a, b) if step > 0 else (b, a)
            leg = srt[k]
            if step > 0:
                srt_leg = leg['srt_nb'] + leg['eng_nb']
            else:
                srt_leg = leg['srt_sb'] + leg['eng_sb']
            dw = dwell.get((pid, a), 0)
            prob += arr[(pid, b)] == arr[(pid, a)] + srt_leg + dw

        # Dwell activation link
        for j in seq_seq[1:-1]:
            if (pid, j) in dwell:
                prob += dwell[(pid, j)] <= dwell_max * d_on[(pid, j)]
                prob += dwell[(pid, j)] >= d_on[(pid, j)]      # >=1 if active
                prob += d_on[(pid, j)]  <= x[pid]              # only if inserted

        # ── Headway vs existing traffic at every junction on the path.
        # Restrict to a plausible arrival window per junction to keep the
        # binary count tractable (otherwise every existing train pairs
        # with every candidate path, creating tens of thousands of vars).
        # Cumulative SRT includes engineering allowance in the applicable dir.
        srt_cum = 0
        srt_by_j = {seq_seq[0]: 0}
        for a, b in zip(seq_seq[:-1], seq_seq[1:]):
            k = (a, b) if step > 0 else (b, a)
            leg = srt[k]
            srt_cum += (leg['srt_nb'] + leg['eng_nb']) if step > 0 \
                       else (leg['srt_sb'] + leg['eng_sb'])
            srt_by_j[b] = srt_cum
        max_extra = dwell_max * max(1, len(seq_seq) - 2)
        # Line-choice binaries per junction: candidate picks exactly one
        # line-token from the freight-observed set at each (j, direction).
        line_pick: dict[tuple[int, str], LpVariable] = {}
        for j in seq_seq:
            allowed = (freight_lines or {}).get((j, p['direction']))
            if allowed is None:
                # Fallback: use every line-token seen at this junction
                allowed = sorted({r['line'] for r in baseline
                                  if r['junction_seq'] == j
                                     and r['direction'] == p['direction']})
            if not allowed:
                allowed = ['']   # last-resort empty token
            for L in allowed:
                l_var = LpVariable(f'line_{pid}_{j}_{_line_tag(L)}',
                                   cat=LpBinary)
                line_pick[(j, L)] = l_var
            # Exactly one line if inserted, zero otherwise
            prob += lpSum(line_pick[(j, L)] for L in allowed) == x[pid]

        for j in seq_seq:
            hj = h_of(j)
            allowed = sorted({L for (jj, L) in line_pick if jj == j})
            t_lo = p['earliest_dep_min'] + srt_by_j[j] - hj - 1
            t_hi = p['latest_dep_min']   + srt_by_j[j] + max_extra + hj + 1
            for L in allowed:
                # Existing traffic on the same line-token at (j, direction).
                existing_times = existing_by_jdl.get(
                    (j, p['direction'], L), [])
                for idx, t_e in enumerate(existing_times):
                    if t_e < t_lo or t_e > t_hi:
                        continue
                    tag = f'{pid}_{j}_{_line_tag(L)}_{idx}'
                    b_bef = LpVariable(f'bef_{tag}', cat=LpBinary)
                    b_aft = LpVariable(f'aft_{tag}', cat=LpBinary)
                    b_before[(pid, j, L, idx)] = b_bef
                    b_after [(pid, j, L, idx)] = b_aft
                    lL = line_pick[(j, L)]
                    # b_bef + b_aft must be >=1 only when the candidate is
                    # inserted AND has picked this line.
                    prob += b_bef + b_aft >= lL
                    # b_bef=1 AND lL=1 => arr + h <= t_e
                    prob += arr[(pid, j)] + hj <= (
                        t_e + BIG_M * (1 - b_bef) + BIG_M * (1 - lL))
                    # b_aft=1 AND lL=1 => arr - h >= t_e
                    prob += arr[(pid, j)] - hj >= (
                        t_e - BIG_M * (1 - b_aft) - BIG_M * (1 - lL))

    # ── Pairwise headway between two inserted paths (same direction, same j)
    path_by_dir = defaultdict(list)
    for p in paths:
        path_by_dir[p['direction']].append(p)

    for dirn, plist in path_by_dir.items():
        for i in range(len(plist)):
            for k in range(i + 1, len(plist)):
                p1, p2 = plist[i], plist[k]
                p1id, p2id = p1['path_id'], p2['path_id']
                # Common junctions on both paths
                s1 = set(range(p1['origin_seq'], p1['destination_seq']
                              + (1 if p1['direction'] == 'northbound' else -1),
                              1 if p1['direction'] == 'northbound' else -1))
                s2 = set(range(p2['origin_seq'], p2['destination_seq']
                              + (1 if p2['direction'] == 'northbound' else -1),
                              1 if p2['direction'] == 'northbound' else -1))
                for j in sorted(s1 & s2):
                    hj = h_of(j)
                    y = LpVariable(f'y_{p1id}_{p2id}_{j}', cat=LpBinary)
                    y_before[(p1id, p2id, j)] = y
                    inserted_both = x[p1id] + x[p2id] - 1  # >=1 if both
                    # y=1 => arr1 + h <= arr2 (p1 before p2)
                    prob += arr[(p1id, j)] + hj - arr[(p2id, j)] \
                            <= BIG_M * (1 - y) + BIG_M * (1 - inserted_both)
                    # y=0 => arr2 + h <= arr1
                    prob += arr[(p2id, j)] + hj - arr[(p1id, j)] \
                            <= BIG_M * y + BIG_M * (1 - inserted_both)

    # ── Objective.  Slot penalty is tied to insertion via a per-path
    # deviation variable so the LP relaxation cannot game uninserted paths.
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
    print(f'[milp] vars: bin={n_bin} int={n_int} cont={n_con}  '
          f'constraints={len(prob.constraints)}')

    # Capture solver stdout via a per-problem log file so we can detect the
    # 'Stopped on time limit' text that PuLP silently maps to Optimal.
    # time_limit == 0 means run to proven optimality (no wall-clock cap,
    # no ratio-gap early exit).
    solver_log = OUT / f'_cbc_last.log'
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

    # ── Extract solution
    solution = []
    total_inserted = 0
    total_dwell    = 0
    integer_ok = LpStatus[status] in ('Optimal',)
    for p in paths:
        pid = p['path_id']
        raw = value(x[pid])
        inserted = 1 if (integer_ok and raw is not None and raw > 0.5) else 0
        if not inserted:
            solution.append({'path_id': pid, 'inserted': 0})
            continue
        total_inserted += 1
        step = +1 if p['direction'] == 'northbound' else -1
        seq_seq = list(range(p['origin_seq'], p['destination_seq'] + step, step))
        entries = []
        for j in seq_seq:
            t_j = int(round(value(arr[(pid, j)])))
            dw_j = int(round(value(dwell.get((pid, j), 0)) or 0)) \
                     if (pid, j) in dwell else 0
            total_dwell += dw_j
            entries.append(f'j{j}@{t_j // 60:02d}:{t_j % 60:02d}'
                           + (f'+{dw_j}m' if dw_j else ''))
        solution.append({
            'path_id':    pid,
            'inserted':   1,
            'dep_min':    int(round(value(dep[pid]))),
            'dep_hhmm':   f'{int(value(dep[pid])) // 60:02d}:{int(value(dep[pid])) % 60:02d}',
            'route':      ' -> '.join(entries),
            'dwell_min':  sum(int(round(value(dwell.get((pid, j), 0)) or 0))
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
    return {'solution': solution, 'kpis': kpis,
            'baseline': baseline}


def write_gap_map(baseline: list[dict], solution: list[dict],
                  paths: list[dict], out_csv: Path) -> None:
    """Hour x junction traffic map: existing + inserted, per direction."""
    p_by_id = {p['path_id']: p for p in paths}
    # existing per (junction, dir, hour)
    grid = defaultdict(int)
    for r in baseline:
        grid[('base', r['junction_seq'], r['direction'], r['t_min'] // 60)] += 1
    # inserted
    for s in solution:
        if not s.get('inserted'):
            continue
        p = p_by_id[s['path_id']]
        for tok in s['route'].split(' -> '):
            # tokens like 'j3@07:04' or 'j3@07:04+5m'
            jstr, tstr = tok.split('@')
            j = int(jstr[1:])
            hh = int(tstr[:2])
            grid[('new', j, p['direction'], hh)] += 1

    with open(out_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['category', 'junction_seq', 'direction', 'hour_utc', 'count'])
        for (cat, j, d, h), c in sorted(grid.items()):
            w.writerow([cat, j, d, h, c])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True,
                    help='inputs/baseline_traffic_<tag>.csv')
    ap.add_argument('--paths', default=str(INP / 'candidate_paths.csv'))
    ap.add_argument('--srt',   default=str(INP / 'srt_profile.csv'))
    ap.add_argument('--freight-lines', default=None,
                    help='inputs/freight_lines_by_junction_<tag>.json '
                         '(enables line-token-aware conflict filter)')
    ap.add_argument('--tag',   default='run')
    ap.add_argument('--headway',  type=int, default=HEADWAY_MIN)
    ap.add_argument('--dwell-max', type=int, default=DWELL_MAX)
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
        w = csv.DictWriter(fh,
                fieldnames=['path_id', 'inserted', 'dep_min', 'dep_hhmm',
                            'route', 'dwell_min'])
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
