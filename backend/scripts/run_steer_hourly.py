"""
run_steer_hourly.py
===================
STEER-style rolling-horizon runner.  Solves the capacity_gap MILP
direction-by-direction in blocks of consecutive hours.  After each block,
the inserted paths' junction arrivals are appended to the baseline
traffic so the next block's MILP treats them as fixed (identical to
how STEER's ATTune workflow locks in accepted paths hour-by-hour).

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
    out = defaultdict(lambda: defaultdict(list))
    for p in paths:
        blk = (p['earliest_dep_min'] // 60) // block_hours
        out[p['direction']][blk].append(p)
    return out


def inserted_to_baseline_rows(solution: list[dict],
                              paths: list[dict],
                              date: str,
                              freight_lines: dict | None) -> list[dict]:
    """Convert inserted paths into baseline-style rows so the next block
    respects them as fixed traffic.  The line-token is the FIRST allowed
    line-token from freight_lines at each junction (deterministic choice
    that matches what the previous block's MILP would have picked most
    permissively).  If freight_lines is missing, tag as '' (default)."""
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
                'date': date,
                'headcode': f'X{s["path_id"]}',
                'journey_num': '0',
                'train_class': 'inserted',
                'direction':   p['direction'],
                'junction_seq': j,
                'junction_name': '',
                'line':        line,
                't_min': t,
            })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--paths',    required=True)
    ap.add_argument('--srt',      default=str(INP / 'srt_profile.csv'))
    ap.add_argument('--freight-lines', default=None,
                    help='freight_lines_by_junction_<tag>.json - enables '
                         'line-token conflict filter')
    ap.add_argument('--tag',      default='hourly')
    ap.add_argument('--block-hours', type=int, default=4)
    ap.add_argument('--time-limit-per-block', type=int, default=120)
    ap.add_argument('--headway',   type=int, default=HEADWAY_MIN)
    ap.add_argument('--dwell-max', type=int, default=DWELL_MAX)
    args = ap.parse_args()

    baseline = load_baseline(Path(args.baseline))
    paths    = load_paths(Path(args.paths))
    srt      = load_srt(Path(args.srt))
    freight_lines = load_freight_lines(Path(args.freight_lines)) \
                    if args.freight_lines else None
    date     = baseline[0]['date'] if baseline else 'unknown'

    print(f'[hourly] baseline touches={len(baseline)}  candidates={len(paths)}')
    print(f'[hourly] block_hours={args.block_hours}  '
          f'time_limit_per_block={args.time_limit_per_block}s')

    groups = group_by_dir_block(paths, args.block_hours)
    total_solution: list[dict] = []
    total_time = 0.0
    per_block_kpis = []

    for direction in ('northbound', 'southbound'):
        # baseline grows within a direction as we accept new paths
        dir_baseline = list(baseline)
        for blk in sorted(groups[direction].keys()):
            batch = groups[direction][blk]
            block_lo = blk * args.block_hours
            block_hi = block_lo + args.block_hours - 1
            print(f'\n[hourly] {direction} block {blk}  '
                  f'h{block_lo:02d}-h{block_hi:02d}  '
                  f'candidates={len(batch)}  '
                  f'background={len(dir_baseline)}')

            res = build_and_solve(dir_baseline, batch, srt,
                                  args.headway, args.dwell_max,
                                  args.time_limit_per_block,
                                  freight_lines=freight_lines)
            k = res['kpis']
            total_time += k['solve_time_s']
            per_block_kpis.append({
                'direction': direction, 'block': blk,
                'inserted': k['paths_inserted'],
                'candidates': k['candidate_paths'],
                'status': k['solver_status'],
                'hit_time_limit': k.get('hit_time_limit', False),
                'solve_s': k['solve_time_s'],
            })
            print(f'[hourly]   -> {k["solver_status"]}  '
                  f'inserted={k["paths_inserted"]}/{k["candidate_paths"]}  '
                  f'time={k["solve_time_s"]}s')

            total_solution.extend(res['solution'])
            # append inserted paths' junction touches as fixed traffic
            dir_baseline.extend(
                inserted_to_baseline_rows(res['solution'], batch, date,
                                          freight_lines))

    # ── Aggregate & write final outputs
    nb_ins = sum(1 for s in total_solution
                 if s.get('inserted') and s['path_id'].startswith('NB'))
    sb_ins = sum(1 for s in total_solution
                 if s.get('inserted') and s['path_id'].startswith('SB'))
    total_dwell = sum(int(s.get('dwell_min', 0) or 0)
                      for s in total_solution)

    sol_csv  = OUT / f'capacity_solution_{args.tag}.csv'
    kpi_json = OUT / f'capacity_kpis_{args.tag}.json'

    with open(sol_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh,
                fieldnames=['path_id', 'inserted', 'dep_min', 'dep_hhmm',
                            'route', 'dwell_min'])
        w.writeheader()
        for row in total_solution:
            w.writerow({k: row.get(k, '') for k in w.fieldnames})

    n_timeouts = sum(1 for b in per_block_kpis if b.get('hit_time_limit'))
    kpis = {
        'method':          'rolling-horizon (STEER-style)',
        'date':            date,
        'block_hours':     args.block_hours,
        'headway_min':     args.headway,
        'chat_moss_headway_min': 4,
        'chat_moss_junctions':   sorted(CHAT_MOSS_JUNCS),
        'dwell_max':       args.dwell_max,
        'candidates_total': len(paths),
        'nb_candidates':   sum(1 for p in paths
                               if p['direction'] == 'northbound'),
        'sb_candidates':   sum(1 for p in paths
                               if p['direction'] == 'southbound'),
        'nb_inserted':     nb_ins,
        'sb_inserted':     sb_ins,
        'total_inserted':  nb_ins + sb_ins,
        'total_dwell_min': total_dwell,
        'wall_solve_time_s': round(total_time, 1),
        'blocks_hit_time_limit': n_timeouts,
        'per_block':       per_block_kpis,
        'steer_target':    {'nb': 20, 'sb': 20,
                            'source': 'Steer 2021 p.24 Route 3 (Winsford Sth Jn - Parkside)'},
    }
    with open(kpi_json, 'w', encoding='utf-8') as fh:
        json.dump(kpis, fh, indent=2)

    print(f'\n[hourly] FINAL  NB={nb_ins}/{kpis["nb_candidates"]}  '
          f'SB={sb_ins}/{kpis["sb_candidates"]}  '
          f'dwell_total={total_dwell}m  wall={total_time:.0f}s')
    print(f'[hourly] STEER benchmark: NB=20  SB=20')
    print(f'[hourly] wrote {sol_csv.name}, {kpi_json.name}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
