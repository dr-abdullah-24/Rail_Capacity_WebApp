"""
generate_capacity_candidates.py
================================
Generate candidate NB + SB freight-path slots for any corridor.

Multiple candidates per hour allow the MILP to insert more than one train
per hour per direction when corridor headways permit.  The departure window
for every candidate in an hour covers the full hour [h*60, h*60+59]; the
solver optimises the exact minute within that window.

Output format matches candidate_paths_steer.csv so run_steer_hourly.py
can consume it unchanged.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

SLOTS_PER_HOUR_DEFAULT = 3   # up to 3 insertions per hour per direction


def generate(corridor: dict, headway_min: int,
             op_start: int, op_end: int,
             traction: str, out: Path,
             slots_per_hour: int = SLOTS_PER_HOUR_DEFAULT) -> None:
    stations = sorted(corridor.get("stations", []), key=lambda s: int(s["seq"]))
    if len(stations) < 2:
        raise ValueError("corridor must have at least 2 stations")

    origin_seq = int(stations[0]["seq"])
    dest_seq   = int(stations[-1]["seq"])
    first_name = stations[0].get("name", str(origin_seq))
    last_name  = stations[-1].get("name", str(dest_seq))
    cls_label  = f"class{traction[1:]}" if traction.startswith("c") else traction
    n_hours    = op_end - op_start

    rows = []
    for h in range(op_start, op_end):
        hh = f"{h:02d}"
        for i in range(slots_per_hour):
            rows.append({
                "path_id":          f"NB_{hh}_{i}",
                "name":             f"{first_name} -> {last_name} @ {hh}xx slot {i}",
                "origin_seq":       origin_seq,
                "destination_seq":  dest_seq,
                "direction":        "northbound",
                "traction_class":   cls_label,
                "priority_weight":  1.0,
                "earliest_dep_min": h * 60,
                "latest_dep_min":   h * 60 + 59,
                "notes":            f"headway={headway_min}min slot={i}",
            })
            rows.append({
                "path_id":          f"SB_{hh}_{i}",
                "name":             f"{last_name} -> {first_name} @ {hh}xx slot {i}",
                "origin_seq":       dest_seq,
                "destination_seq":  origin_seq,
                "direction":        "southbound",
                "traction_class":   cls_label,
                "priority_weight":  1.0,
                "earliest_dep_min": h * 60,
                "latest_dep_min":   h * 60 + 59,
                "notes":            f"headway={headway_min}min slot={i}",
            })

    nb_total = n_hours * slots_per_hour
    sb_total = nb_total
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "path_id", "name", "origin_seq", "destination_seq",
            "direction", "traction_class", "priority_weight",
            "earliest_dep_min", "latest_dep_min", "notes",
        ])
        w.writeheader()
        w.writerows(rows)
    print(f"[candidates] {len(rows)} slots  "
          f"({nb_total} NB + {sb_total} SB  "
          f"{slots_per_hour} slots/hour × {n_hours} hours)  "
          f"-> {out.name}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corridor",       required=True)
    ap.add_argument("--headway",        type=int, default=3)
    ap.add_argument("--op-start",       type=int, default=0)
    ap.add_argument("--op-end",         type=int, default=24)
    ap.add_argument("--traction",       default="c6")
    ap.add_argument("--slots-per-hour", type=int, default=SLOTS_PER_HOUR_DEFAULT,
                    help="candidate paths generated per hour per direction "
                         "(default %(default)s); the MILP fills as many as "
                         "headway constraints allow")
    ap.add_argument("--out",            required=True)
    args = ap.parse_args()
    corridor = json.loads(Path(args.corridor).read_text(encoding="utf-8"))
    generate(corridor, args.headway, args.op_start, args.op_end,
             args.traction, Path(args.out), args.slots_per_hour)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
