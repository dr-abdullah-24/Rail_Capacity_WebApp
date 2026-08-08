"""
build_baseline_traffic.py
=========================
Extract existing 2018 traffic on the STEER Route 3 corridor
(Crewe -> Parkside via WCML slow line + Chat Moss) for one or more
representative days, and emit a per-junction time-snapshot CSV that
the capacity MILP consumes as fixed background traffic.

Output: inputs/baseline_traffic_<date>.csv
  columns: date, headcode, journey_num, train_class, direction,
           junction_seq, junction_name, t_min

Also emits inputs/baseline_summary_<date>.json with headway
percentiles per junction/direction (STEER-comparable diagnostics).
"""

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

# Bundled paths (backend/scripts/ + backend/data/milp/)
_BASE     = Path(__file__).resolve().parents[1]               # backend/
_DATA     = _BASE / 'data' / 'milp'
EVENTS    = _DATA / 'route3_steer_train_events.csv'          # optional; usually passed via --events
STATIONS  = _DATA / 'route3_steer_stations.csv'
OUT_DIR   = _BASE / 'data' / 'milp_scratch'
OUT_DIR.mkdir(parents=True, exist_ok=True)
BERTH_LINES_JSON = _DATA / 'berth_lines.json'

# Ordered corridor junctions (subset of route3_steer_stations.csv, one per
# STEER pathing reference point).  stanme values match the events file.
CORRIDOR = [
    ('CREWE',              0.000, ['CREWE CS', 'CWECOALYD']),
    ('WINSFORD',          11.419, ['WINSFORD']),
    ('HARTFORD',          18.434, ['HARTFORD']),
    ('HARTFORD JN',       19.432, ['HARTFORDJ']),
    ('ACTON BRIDGE',      22.697, ['ACTONBDGE']),
    ('WEAVER JN',         26.952, ['WEAVER JN']),
    ('ACTON GRANGE JN',   34.963, ['ACTNGNGJN']),
    ('WARRINGTON BQ',     38.277, ['WARRTN BQ']),
    ('WINWICK JN',        43.979, ['WINWICK J']),
    ('EARLESTOWN',        46.500, ['EARLESTWN']),
    ('NEWTON-LE-WILLOWS', 48.500, ['NEWTONLEW']),
    ('PARKSIDE JN',       50.000, ['PARKSIDEJ']),
]
STANME_TO_SEQ  = {s: i for i, (_, _, keys) in enumerate(CORRIDOR) for s in keys}
STANME_TO_NAME = {s: n for n, _, keys in CORRIDOR for s in keys}


def ts_to_minute(ts_iso: str) -> int:
    """UTC ISO timestamp -> minute-of-day (0..1439)."""
    dt = datetime.fromisoformat(ts_iso.replace('Z', '+00:00'))
    dt = dt.astimezone(timezone.utc)
    return dt.hour * 60 + dt.minute


def load_berth_lines() -> dict[str, str]:
    if not BERTH_LINES_JSON.exists():
        print(f'[warn] {BERTH_LINES_JSON} missing; all lines default to "". '
              f'Run build_berth_line_lookup.py first.')
        return {}
    return json.load(open(BERTH_LINES_JSON, encoding='utf-8'))


def line_for(td: str, berth: str, lookup: dict[str, str]) -> str:
    """Look up (td, berth) raw FROMLINE token from SMART.  Unknown -> ''.
    Treated as an opaque identifier by the MILP - two trains share track
    only if their tokens match byte-for-byte."""
    return lookup.get(f'{td}|{berth}', '')


def extract(dates: list[str]) -> tuple[list[dict], dict]:
    """Scan events file once, keep only rows on requested dates that hit
    a corridor junction. Reduce to one row per (train, junction) using
    earliest observed timestamp at that junction.  Tag each row with the
    line class (slow/fast/main) derived from the berth code via SMART."""
    date_set = set(dates)
    berth_lines = load_berth_lines()
    seen: dict[tuple, int] = {}          # (date, hc, jrn, junc_seq) -> t_min
    meta: dict[tuple, dict] = {}

    with open(EVENTS, newline='', encoding='utf-8') as fh:
        rdr = csv.DictReader(fh)
        for row in rdr:
            if row['date'] not in date_set:
                continue
            td = row.get('td_area', '').strip()
            # Emit at every corridor junction the train touches; take the
            # earlier of the from_ / to_ side that maps to that junction.
            for side, stanme_col, berth_col in (
                ('from', 'from_stanme', 'from_berth'),
                ('to',   'to_stanme',   'to_berth'),
            ):
                stanme = row[stanme_col].strip()
                if stanme not in STANME_TO_SEQ:
                    continue
                junc_seq = STANME_TO_SEQ[stanme]
                key = (row['date'], row['headcode'], row['journey_num'], junc_seq)
                t_min = ts_to_minute(row['timestamp_utc'])
                line = line_for(td, row.get(berth_col, '').strip(), berth_lines)
                if key not in seen or t_min < seen[key]:
                    seen[key] = t_min
                    meta[key] = {
                        'train_class': row['train_class'],
                        'direction':   row['direction'],
                        'line':        line,
                    }

    out = []
    for (date, hc, jrn, seq), t in sorted(seen.items()):
        out.append({
            'date': date,
            'headcode': hc,
            'journey_num': jrn,
            'train_class': meta[(date, hc, jrn, seq)]['train_class'],
            'direction':   meta[(date, hc, jrn, seq)]['direction'],
            'junction_seq': seq,
            'junction_name': CORRIDOR[seq][0],
            'line':        meta[(date, hc, jrn, seq)]['line'],
            't_min': t,
        })

    # Headway diagnostics per (junction, direction, line).
    per_jdl = defaultdict(list)
    for r in out:
        per_jdl[(r['junction_seq'], r['direction'], r['line'])].append(r['t_min'])

    diag = {}
    for (seq, dirn, line), times in per_jdl.items():
        times.sort()
        if len(times) < 2:
            diag[f'{CORRIDOR[seq][0]}|{dirn}|{line}'] = {
                'n_trains': len(times)}
            continue
        gaps = [t2 - t1 for t1, t2 in zip(times, times[1:])]
        gaps.sort()
        n = len(gaps)
        p5  = gaps[max(0, int(0.05 * (n - 1)))]
        p50 = gaps[max(0, int(0.50 * (n - 1)))]
        p95 = gaps[max(0, int(0.95 * (n - 1)))]
        hour_counts = defaultdict(int)
        for t in times:
            hour_counts[t // 60] += 1
        peak_hour, peak_tph = max(hour_counts.items(), key=lambda kv: kv[1])
        diag[f'{CORRIDOR[seq][0]}|{dirn}|{line}'] = {
            'n_trains': len(times),
            'headway_p5_min':  p5,
            'headway_p50_min': p50,
            'headway_p95_min': p95,
            'peak_hour_utc':   peak_hour,
            'peak_tph':        peak_tph,
        }
    return out, diag


FREIGHT_CLASSES = {'class4', 'class6', 'class4_freight', 'class6_freight',
                   'freight'}   # tolerant to labelling variants


def freight_lines_by_junction(rows: list[dict]) -> dict:
    """For each (junction_seq, direction), collect line-token set observed
    for freight-class trains.  Fallback to full-traffic set when no freight
    was observed there so downstream MILP always has >=1 line to pick."""
    fr_set: dict[tuple[int, str], set[str]] = {}
    any_set: dict[tuple[int, str], set[str]] = {}
    for r in rows:
        key = (r['junction_seq'], r['direction'])
        any_set.setdefault(key, set()).add(r['line'])
        if r['train_class'] in FREIGHT_CLASSES:
            fr_set.setdefault(key, set()).add(r['line'])
    out = {}
    for key in any_set:
        seq, dirn = key
        chosen = sorted(fr_set.get(key) or any_set[key])
        out[f'{seq}|{dirn}'] = {
            'lines':          chosen,
            'source':         'freight-observed' if key in fr_set
                              else 'fallback-all-traffic',
            'n_freight':      len(fr_set.get(key, set())),
            'n_traffic':      len(any_set[key]),
        }
    return out


def main() -> None:
    global EVENTS
    ap = argparse.ArgumentParser()
    ap.add_argument('--dates', nargs='+', required=True,
                    help='YYYY-MM-DD list, e.g. --dates 2018-04-25 (Wed)')
    ap.add_argument('--tag', default=None,
                    help='Output filename tag (default = first date)')
    ap.add_argument('--events', default=str(EVENTS),
                    help='Events CSV path (default = 2018 file)')
    args = ap.parse_args()

    # Allow overriding the events file location (e.g. for 2026 data)
    EVENTS = Path(args.events)

    tag = args.tag or args.dates[0]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_csv  = OUT_DIR / f'baseline_traffic_{tag}.csv'
    out_json = OUT_DIR / f'baseline_summary_{tag}.json'
    out_frjs = OUT_DIR / f'freight_lines_by_junction_{tag}.json'

    print(f'[baseline] scanning {EVENTS.name} for {len(args.dates)} date(s)...')
    rows, diag = extract(args.dates)
    print(f'[baseline] kept {len(rows)} (train,junction) touches')

    with open(out_csv, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    with open(out_json, 'w', encoding='utf-8') as fh:
        json.dump({
            'dates': args.dates,
            'corridor': [n for n, _, _ in CORRIDOR],
            'per_junction_direction': diag,
        }, fh, indent=2)

    with open(out_frjs, 'w', encoding='utf-8') as fh:
        json.dump(freight_lines_by_junction(rows), fh, indent=2)

    print(f'[baseline] wrote {out_csv.name}')
    print(f'[baseline] wrote {out_json.name}')
    print(f'[baseline] wrote {out_frjs.name}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
