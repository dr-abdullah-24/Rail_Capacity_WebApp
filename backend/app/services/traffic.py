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
import re
from collections import defaultdict
from pathlib import Path

# Chainage (km from Crewe) for each of the 12 Route 3 MILP junctions.
# Names match the srt_profile.csv from_name/to_name, which are what the
# baseline CSV writes into junction_name.  Values from route3_steer_stations.csv.
_ROUTE3_CHAINAGE: dict[str, float] = {
    "CREWE":             0.0,
    "WINSFORD":          11.419,
    "HARTFORD":          18.434,
    "HARTFORD JN":       19.432,
    "ACTON BRIDGE":      22.697,
    "WEAVER JN":         26.952,
    "ACTON GRANGE JN":   34.963,
    "WARRINGTON BQ":     38.277,
    "WINWICK JN":        43.979,
    "EARLESTOWN":        46.500,
    "NEWTON-LE-WILLOWS": 48.500,
    "PARKSIDE JN":       50.000,
}

def _to_hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


# Abbreviations that should stay uppercase in station names.
_UPPER_ABBREVS = {"BQ", "GDS", "RTS", "NY", "NW"}

def _display_name(raw: str) -> str:
    """Convert ALL-CAPS station name from baseline CSV to readable form.
    Preserves known uppercase abbreviations (BQ, GDS …).
    Fixes hyphenated connectives (Newton-Le-Willows → Newton-le-Willows)."""
    words = []
    for w in raw.split():
        words.append(w if w in _UPPER_ABBREVS else w.title())
    result = " ".join(words)
    # Lowercase short connectives after hyphens (Le, De, La → le, de, la)
    result = re.sub(r"-([A-Z][a-z]{1,2})-", lambda m: f"-{m.group(1).lower()}-", result)
    return result


def load_baseline(baseline_csv: Path) -> tuple[list[dict], dict, list[str]]:
    """Group baseline rows by (headcode, journey_num, direction) and emit
    one 'train' per group with its junction touches ordered by seq.
    Also compute a 15-min per-(junction, direction) count map and derive
    corridor_names from the junction_seq/junction_name pairs in the CSV."""
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    heat: dict[int, dict[str, dict[int, int]]] = {}
    seq_to_name: dict[int, str] = {}
    if not baseline_csv.exists():
        return [], heat, []
    _dir_norm = {"northbound": "up", "southbound": "down"}
    with baseline_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            d = _dir_norm.get(r["direction"], r["direction"])
            key = (r["headcode"], r["journey_num"], d)
            j = int(r["junction_seq"])
            name = _display_name(r["junction_name"])
            grouped[key].append({
                "seq":  j,
                "name": name,
                "t_min": int(r["t_min"]),
                "line": r.get("line", ""),
            })
            seq_to_name.setdefault(j, name)
            bucket = int(r["t_min"]) // 15
            heat.setdefault(j, {}).setdefault(d, {}).setdefault(bucket, 0)
            heat[j][d][bucket] += 1

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
    corridor_names = [seq_to_name[i] for i in sorted(seq_to_name)]
    return trains, heat, corridor_names


_ROUTE_TOKEN = re.compile(r"j(\d+)@(\d{2}):(\d{2})(?:\+(\d+)m)?")


def load_solution(solution_csv: Path,
                   traction: str = "c6",
                   corridor_names: list[str] | None = None) -> list[dict]:
    """Parse solution.csv rows and turn the 'route' text into a structured
    list of per-junction times + dwell.  traction is the run's traction id
    (c0..c9) and is exposed as class_digit on the inserted rows."""
    if not solution_csv.exists():
        return []
    names = corridor_names or []
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
                    "name":  names[j] if j < len(names) else str(j),
                    "t_min": t,
                    "hhmm":  _to_hhmm(t),
                    "dwell": dwell,
                })
            direction = r.get("direction", "")
            if not direction:
                direction = "up" if r["path_id"].startswith("UP") else "down"
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
    import json as _json
    baseline_csv = result_dir / f"baseline_{date_tag}.csv"
    solution_csv = result_dir / "solution.csv"
    existing, heat, corridor_names = load_baseline(baseline_csv)

    # When corridor.json is present (generic pipeline), rebuild corridor_names
    # from the FULL station list so that corridorNames[seq] == station at seq.
    # Without this, missing junction seqs in the baseline (stations with no
    # observed events) cause index ≠ seq mismatches and dots land at the wrong
    # Y position (or at the top-of-diagram fallback).
    junction_chainages: list[float] = []
    junction_seqs: list[int] = []
    corridor_json_path = result_dir / "corridor.json"
    if corridor_json_path.exists():
        _corr = _json.loads(corridor_json_path.read_text(encoding="utf-8"))
        _stations = sorted(_corr.get("stations", []), key=lambda s: int(s["seq"]))
        if _stations:
            # Full list: index == seq for all corridor stations.
            corridor_names = [
                _display_name(s.get("name", str(s["seq"])).upper())
                for s in _stations
            ]
            junction_chainages = [float(s.get("chainage_km", -1)) for s in _stations]
            if not all(c >= 0 for c in junction_chainages):
                junction_chainages = []
            junction_seqs = [int(s["seq"]) for s in _stations]
    else:
        _chn = [_ROUTE3_CHAINAGE.get(n.upper(), -1.0) for n in corridor_names]
        junction_chainages = _chn if all(c >= 0 for c in _chn) else []
        # For baseline-only runs, corridor_names rows correspond to sorted
        # unique seqs observed in the baseline (may not start at 0 or be contiguous).
        junction_seqs = sorted(heat.keys())

    # load_solution uses corridor_names for junction name labels — call it
    # after corridor_names has been resolved to the full list.
    inserted = load_solution(solution_csv, traction=traction,
                             corridor_names=corridor_names)

    # heatmap flattened for JSON friendliness
    heat_rows = []
    for j, per_dir in heat.items():
        for d, per_hour in per_dir.items():
            for h, n in per_hour.items():
                heat_rows.append({
                    "junction_seq": j, "direction": d,
                    "bucket": h, "count": n,
                })
    # inserted paths overlaid on heatmap
    inserted_rows = []
    for p in inserted:
        for jn in p["junctions"]:
            inserted_rows.append({
                "junction_seq": jn["seq"],
                "direction": p["direction"],
                "bucket": jn["t_min"] // 15,
                "path_id": p["path_id"],
            })

    return {
        "corridor_names":     corridor_names,
        "junction_chainages": junction_chainages,
        "junction_seqs":      junction_seqs,
        "existing":           existing,
        "inserted":           inserted,
        "heatmap":            heat_rows,
        "inserted_overlay":   inserted_rows,
    }
