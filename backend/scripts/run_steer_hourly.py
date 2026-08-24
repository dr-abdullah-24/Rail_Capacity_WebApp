"""
run_steer_hourly.py
===================
Rolling-horizon runner.  Solves the capacity_gap MILP for both directions
jointly in each time block, so Up and Down candidates compete for the same
infrastructure — critical on single-track or bi-directional sections.

After each block, accepted paths from BOTH directions are appended to the
shared baseline so subsequent blocks treat them as fixed traffic.

Usage:
  python run_steer_hourly.py \
      --baseline inputs/baseline_traffic_2018-04-25.csv \
      --paths    inputs/candidate_paths_steer.csv \
      --tag      steer_2018-04-25 \
      --block-hours 4 \
      --time-limit-per-block 120
"""

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from capacity_gap_milp import (  # noqa: E402
    BASE, INP, OUT, HEADWAY_MIN, DWELL_MAX, CHAT_MOSS_JUNCS,
    load_baseline, load_paths, load_srt, load_freight_lines,
    build_and_solve,
)


def group_by_dir_block(paths: list[dict], block_hours: int) -> dict:
    """{'direction': {block_idx: [candidates...]}}."""
    out: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for p in paths:
        blk = (p['earliest_dep_min'] // 60) // block_hours
        out[p['direction']][blk].append(p)
    return out


def inserted_to_baseline_rows(solution: list[dict],
                              paths: list[dict],
                              date: str,
                              freight_lines: dict | None) -> list[dict]:
    """Convert inserted paths into baseline-style rows for the next block."""
    p_by_id = {p['path_id']: p for p in paths}
    rows = []
    for s in solution:
        if not s.get('inserted'):
            continue
        p = p_by_id[s['path_id']]
        for tok in s['route'].split(' -> '):
            jstr, tstr = tok.split('@')
            j = int(jstr[1:])
            hh, mm = tstr[:5].split(':')
            t = int(hh) * 60 + int(mm)
            allowed = (freight_lines or {}).get((j, p['direction']), [''])
            line = allowed[0] if allowed else ''
            rows.append({
                'date':         date,
                'headcode':     f'X{s["path_id"]}',
                'journey_num':  '0',
                'train_class':  'inserted',
                'direction':    p['direction'],
                'junction_seq': j,
                'junction_name': '',
                'line':         line,
                't_min':        t,
            })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--paths',   required=True)
    ap.add_argument('--srt',     default=str(INP / 'srt_profile.csv'))
    ap.add_argument('--freight-lines', default=None)
    ap.add_argument('--tag',     default='hourly')
    ap.add_argument('--block-hours',          type=int, default=4)
    ap.add_argument('--time-limit-per-block', type=int, default=120)
    ap.add_argument('--headway',   type=int, default=HEADWAY_MIN)
    ap.add_argument('--dwell-max', type=int, default=DWELL_MAX)
    ap.add_argument('--generic-corridor', action='store_true',
                    help='disable Chat Moss headway override (generic corridor)')
    args = ap.parse_args()

    if args.generic_corridor:
        import capacity_gap_milp as _cmilp
        _cmilp.CHAT_MOSS_JUNCS = set()

    baseline      = load_baseline(Path(args.baseline))
    paths         = load_paths(Path(args.paths))
    srt           = load_srt(Path(args.srt))
    freight_lines = load_freight_lines(Path(args.freight_lines)) \
                    if args.freight_lines else None
    date          = baseline[0]['date'] if baseline else 'unknown'

    print(f'[hourly] baseline touches={len(baseline)}  candidates={len(paths)}')
    tl = args.time_limit_per_block
    tl_label = 'unlimited (optimal)' if tl == 0 else f'{tl}s'
    print(f'[hourly] block_hours={args.block_hours}  '
          f'time_limit_per_block={tl_label}  '
          f'joint_solve=yes  single_track_aware=yes')

    groups  = group_by_dir_block(paths, args.block_hours)
    all_blks = sorted({blk for d in groups for blk in groups[d]})

    # Shared baseline: accepted paths from either direction feed back here
    joint_baseline  = list(baseline)
    total_solution: list[dict] = []
    total_time      = 0.0
    per_block_kpis: list[dict] = []

    for blk in all_blks:
        batch: list[dict] = []
        for dirn in ('up', 'down'):
            batch.extend(groups[dirn].get(blk, []))
        if not batch:
            continue

        block_lo = blk * args.block_hours
        block_hi = block_lo + args.block_hours - 1
        up_cnt   = sum(1 for p in batch if p['direction'] == 'up')
        dn_cnt   = sum(1 for p in batch if p['direction'] == 'down')
        print(f'\n[hourly] joint block {blk}  h{block_lo:02d}-h{block_hi:02d}  '
              f'up={up_cnt}  down={dn_cnt}  background={len(joint_baseline)}')

        res = build_and_solve(joint_baseline, batch, srt,
                              args.headway, args.dwell_max,
                              args.time_limit_per_block,
                              freight_lines=freight_lines)
        k = res['kpis']
        total_time += k['solve_time_s']
        per_block_kpis.append({
            'block':      blk,
            'hour_start': block_lo,
            'hour_end':   block_hi,
            'up_candidates':   up_cnt,
            'down_candidates': dn_cnt,
            'inserted':   k['paths_inserted'],
            'candidates': k['candidate_paths'],
            'status':     k['solver_status'],
            'hit_time_limit': k.get('hit_time_limit', False),
            'solve_s':    k['solve_time_s'],
        })
        print(f'[hourly]   -> {k["solver_status"]}  '
              f'inserted={k["paths_inserted"]}/{k["candidate_paths"]}  '
              f'time={k["solve_time_s"]}s')

        total_solution.extend(res['solution'])
        joint_baseline.extend(
            inserted_to_baseline_rows(res['solution'], batch, date,
                                      freight_lines))

    # ── Aggregate & write outputs ──────────────────────────────────────────
    up_ins = sum(1 for s in total_solution
                 if s.get('inserted') and s.get('direction') == 'up')
    dn_ins = sum(1 for s in total_solution
                 if s.get('inserted') and s.get('direction') == 'down')
    total_dwell = sum(int(s.get('dwell_min', 0) or 0)
                      for s in total_solution)

    sol_csv  = OUT / f'capacity_solution_{args.tag}.csv'
    kpi_json = OUT / f'capacity_kpis_{args.tag}.json'

    with open(sol_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['path_id', 'direction', 'inserted',
                                            'dep_min', 'dep_hhmm', 'route',
                                            'dwell_min'])
        w.writeheader()
        for row in total_solution:
            w.writerow({k: row.get(k, '') for k in w.fieldnames})

    n_timeouts = sum(1 for b in per_block_kpis if b.get('hit_time_limit'))
    up_cands = sum(1 for p in paths if p['direction'] == 'up')
    dn_cands = sum(1 for p in paths if p['direction'] == 'down')
    kpis = {
        'method':           'rolling-horizon (joint Up+Down per block)',
        'date':             date,
        'block_hours':      args.block_hours,
        'headway_min':      args.headway,
        'dwell_max':        args.dwell_max,
        'candidates_total': len(paths),
        'up_candidates':    up_cands,
        'down_candidates':  dn_cands,
        'up_inserted':      up_ins,
        'down_inserted':    dn_ins,
        'total_inserted':   up_ins + dn_ins,
        'total_dwell_min':  total_dwell,
        'wall_solve_time_s': round(total_time, 1),
        'blocks_hit_time_limit': n_timeouts,
        'per_block':        per_block_kpis,
    }
    if not args.generic_corridor:
        kpis['chat_moss_headway_min'] = 4
        kpis['chat_moss_junctions']   = sorted(CHAT_MOSS_JUNCS)
        kpis['steer_target'] = {
            'up': 20, 'down': 20,
            'source': 'Steer 2021 p.24 Route 3 (Winsford Sth Jn - Parkside)',
        }
    with open(kpi_json, 'w', encoding='utf-8') as fh:
        json.dump(kpis, fh, indent=2)

    print(f'\n[hourly] FINAL  Up={up_ins}/{up_cands}  '
          f'Down={dn_ins}/{dn_cands}  '
          f'dwell_total={total_dwell}m  wall={total_time:.0f}s')
    if not args.generic_corridor:
        print('[hourly] STEER benchmark: Up=20  Down=20')
    print(f'[hourly] wrote {sol_csv.name}, {kpi_json.name}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
