"""
build_corridor_baseline.py
==========================
Build a capacity-MILP-compatible baseline CSV and freight-lines JSON
from extracted events for any user-defined corridor.

Inputs
------
--events            events CSV from extract_two_corridors_generic.py
                    (source_events.csv / target_events.csv)
--corridor          corridor JSON (station chain with stanme/tiploc/seq)
--date              optional YYYY-MM-DD date filter (blank = all dates)
--out-baseline      output path for baseline_traffic.csv
--out-freight-lines output path for freight_lines.json

Output baseline CSV columns (identical to Route-3 build_baseline_traffic.py)
-----------------------------------------------------------------------------
date, headcode, journey_num, train_class, direction,
junction_seq, junction_name, line, t_min
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def _stanme_map(corridor: dict) -> dict[str, tuple[int, str]]:
    """Build stanme/tiploc/crs/name → (seq, display_name) lookup."""
    m: dict[str, tuple[int, str]] = {}
    for stn in corridor.get("stations", []):
        seq  = int(stn.get("seq", 0))
        name = (stn.get("name") or "").strip()
        for field in ("stanme", "tiploc", "crs", "stanox"):
            val = (stn.get(field) or "").strip().upper()
            if val:
                m.setdefault(val, (seq, name))
        nm = name.upper()
        if nm:
            m.setdefault(nm, (seq, name))
    return m


def build(events_csv: Path, corridor: dict, date_filter: str,
          out_baseline: Path, out_freight_lines: Path) -> None:
    sm_map = _stanme_map(corridor)
    n_junc = len(corridor.get("stations", []))

    # (headcode, journey_num, junction_seq) → earliest-timestamp record
    touches: dict[tuple, dict] = {}
    n_events = 0

    with events_csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if date_filter and row.get("date", "") != date_filter:
                continue
            n_events += 1

            ts_ms = int(row.get("ts_ms") or 0)
            t_min = (ts_ms // 60_000) % 1440  # UTC minute-of-day

            for sf in ("from_stanme", "to_stanme"):
                sm = (row.get(sf) or "").strip().upper()
                if sm not in sm_map:
                    continue
                seq, jname = sm_map[sm]
                key = (row["headcode"], row["journey_num"], seq)
                if key not in touches or t_min < touches[key]["t_min"]:
                    touches[key] = {
                        "date":          row.get("date", ""),
                        "headcode":      row["headcode"],
                        "journey_num":   row["journey_num"],
                        "train_class":   row.get("train_class", ""),
                        "direction":     row.get("direction", ""),
                        "junction_seq":  seq,
                        "junction_name": jname,
                        "line":          "",
                        "t_min":         t_min,
                    }

    rows = sorted(touches.values(),
                  key=lambda r: (r["headcode"], r["junction_seq"], r["t_min"]))

    print(f"[baseline] events_read={n_events}  junction_touches={len(rows)}",
          flush=True)

    # ── Write baseline CSV ────────────────────────────────────────────────────
    out_baseline.parent.mkdir(parents=True, exist_ok=True)
    with out_baseline.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "date", "headcode", "journey_num", "train_class", "direction",
            "junction_seq", "junction_name", "line", "t_min",
        ])
        w.writeheader()
        w.writerows(rows)

    # ── Write freight_lines JSON (fallback: all-traffic, empty line token) ───
    fl: dict[str, dict] = {}
    traffic_counts: dict[tuple, int] = defaultdict(int)
    for r in rows:
        traffic_counts[(r["junction_seq"], r["direction"])] += 1

    for direction in ("northbound", "southbound"):
        for seq in range(n_junc):
            key = f"{seq}|{direction}"
            fl[key] = {
                "lines":     [""],
                "source":    "fallback-all-traffic",
                "n_freight": 0,
                "n_traffic": traffic_counts[(seq, direction)],
            }

    out_freight_lines.parent.mkdir(parents=True, exist_ok=True)
    out_freight_lines.write_text(json.dumps(fl, indent=2), encoding="utf-8")
    print(f"[baseline] wrote {out_baseline.name}  {out_freight_lines.name}",
          flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events",            required=True)
    ap.add_argument("--corridor",          required=True)
    ap.add_argument("--date",              default="")
    ap.add_argument("--out-baseline",      required=True)
    ap.add_argument("--out-freight-lines", required=True)
    args = ap.parse_args()

    corridor = json.loads(Path(args.corridor).read_text(encoding="utf-8"))
    build(
        events_csv=Path(args.events),
        corridor=corridor,
        date_filter=args.date,
        out_baseline=Path(args.out_baseline),
        out_freight_lines=Path(args.out_freight_lines),
    )


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
