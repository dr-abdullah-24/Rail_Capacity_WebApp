"""Merge a run's baseline traffic and MILP solution into unified structures
for the web frontend.

Returns three sections:
  existing:   [ {headcode, direction, class, junctions: [{seq,name,time}] } ]
  inserted:   [ {path_id, direction, dep_hhmm, dwell_min,
                 junctions: [{seq,name,time,dwell}] } ]
  heatmap:    { junction_seq -> { direction -> { hour -> count } } }
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

CORRIDOR_NAMES = [
    "Crewe", "Winsford", "Hartford", "Hartford Jn", "Acton Bridge",
    "Weaver Jn", "Acton Grange Jn", "Warrington BQ", "Winwick Jn",
    "Earlestown", "Newton-le-Willows", "Parkside Jn",
]


def _to_hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def load_baseline(baseline_csv: Path) -> tuple[list[dict], dict]:
    """Group baseline rows by (headcode, journey_num, direction) and emit
    one 'train' per group with its junction touches ordered by seq.
    Also compute an hourly per-(junction, direction) count map."""
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    heat: dict[int, dict[str, dict[int, int]]] = {}
    if not baseline_csv.exists():
        return [], heat
    with baseline_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            key = (r["headcode"], r["journey_num"], r["direction"])
            grouped[key].append({
                "seq":  int(r["junction_seq"]),
                "name": r["junction_name"],
                "t_min": int(r["t_min"]),
                "line": r.get("line", ""),
            })
            j = int(r["junction_seq"])
            d = r["direction"]
            h = int(r["t_min"]) // 60
            heat.setdefault(j, {}).setdefault(d, {}).setdefault(h, 0)
            heat[j][d][h] += 1

    trains: list[dict] = []
    for (hc, jn, dirn), rows in grouped.items():
        rows.sort(key=lambda x: x["seq"])
        first = rows[0]
        last = rows[-1]
        # infer class from headcode digit
        cls_digit = hc[0] if hc else ""
        trains.append({
            "kind":        "existing",
            "headcode":    hc,
            "journey_num": jn,
            "direction":   dirn,
            "class_digit": cls_digit,
            "dep_min":     first["t_min"],
            "arr_min":     last["t_min"],
            "dep_hhmm":    _to_hhmm(first["t_min"]),
            "arr_hhmm":    _to_hhmm(last["t_min"]),
            "junctions":   [
                {"seq": r["seq"], "name": r["name"],
                 "t_min": r["t_min"], "hhmm": _to_hhmm(r["t_min"]),
                 "line":  r["line"]}
                for r in rows
            ],
        })
    return trains, heat


_ROUTE_TOKEN = re.compile(r"j(\d+)@(\d{2}):(\d{2})(?:\+(\d+)m)?")


def load_solution(solution_csv: Path,
                   traction: str = "c6") -> list[dict]:
    """Parse solution.csv rows and turn the 'route' text into a structured
    list of per-junction times + dwell.  traction is the run's traction id
    (c0..c9) and is exposed as class_digit on the inserted rows."""
    if not solution_csv.exists():
        return []
    class_digit = traction[1:] if traction.startswith("c") else traction
    out = []
    with solution_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if not int(r.get("inserted") or 0):
                continue
            juncs = []
            for m in _ROUTE_TOKEN.finditer(r["route"]):
                j = int(m.group(1))
                h = int(m.group(2)); mi = int(m.group(3))
                t = h * 60 + mi
                dwell = int(m.group(4)) if m.group(4) else 0
                juncs.append({
                    "seq":   j,
                    "name":  CORRIDOR_NAMES[j] if j < len(CORRIDOR_NAMES) else str(j),
                    "t_min": t,
                    "hhmm":  _to_hhmm(t),
                    "dwell": dwell,
                })
            direction = "northbound" if r["path_id"].startswith("NB") \
                        else "southbound"
            out.append({
                "kind":        "inserted",
                "path_id":     r["path_id"],
                "direction":   direction,
                "class_digit": class_digit,
                "dep_min":     int(r["dep_min"]),
                "dep_hhmm":    r["dep_hhmm"],
                "arr_min":     juncs[-1]["t_min"] if juncs else 0,
                "arr_hhmm":    juncs[-1]["hhmm"] if juncs else "",
                "dwell_min":   int(r.get("dwell_min") or 0),
                "junctions":   juncs,
            })
    return out


def bundle_run(result_dir: Path, date_tag: str,
               traction: str = "c6") -> dict:
    baseline_csv = result_dir / f"baseline_{date_tag}.csv"
    solution_csv = result_dir / "solution.csv"
    existing, heat = load_baseline(baseline_csv)
    inserted = load_solution(solution_csv, traction=traction)

    # heatmap flattened for JSON friendliness
    heat_rows = []
    for j, per_dir in heat.items():
        for d, per_hour in per_dir.items():
            for h, n in per_hour.items():
                heat_rows.append({
                    "junction_seq": j, "direction": d,
                    "hour": h, "count": n,
                })
    # inserted paths overlaid on heatmap
    inserted_rows = []
    for p in inserted:
        for jn in p["junctions"]:
            inserted_rows.append({
                "junction_seq": jn["seq"],
                "direction": p["direction"],
                "hour": jn["t_min"] // 60,
                "path_id": p["path_id"],
            })
    return {
        "corridor_names":   CORRIDOR_NAMES,
        "existing":         existing,
        "inserted":         inserted,
        "heatmap":          heat_rows,
        "inserted_overlay": inserted_rows,
    }
