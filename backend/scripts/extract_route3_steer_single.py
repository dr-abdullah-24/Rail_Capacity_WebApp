"""
extract_route3_steer_single.py
==============================
Extract a single day's STEER Route 3 corridor events from ONE TD JSONL file.
Emits a CSV in the same schema as extract_route3_steer_2018.py so the
downstream build_baseline_traffic.py can consume it via --events.

Usage:
  python extract_route3_steer_single.py \
      --jsonl /path/to/td_YYYY-MM-DD.jsonl \
      --date  YYYY-MM-DD \
      --out   /path/to/events.csv \
      [--stations /path/to/route3_steer_stations.csv] \
      [--smart /path/to/SMART.json]

Progress lines emitted on stdout for a WebSocket-tailed webapp runner.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Bundled reference data lives under backend/data/
_BASE = Path(__file__).resolve().parents[1]         # backend/
DEFAULT_STATIONS = _BASE / "data" / "milp" / "route3_steer_stations.csv"
DEFAULT_SMART    = _BASE / "data" / "SMART.json"

ALL_TDS = {"CE", "WD", "WA"}
R3_SPECIFIC_AREAS = {"WD", "WA"}
MAX_GAP_MS = 30 * 60 * 1000


def classify_headcode(hc: str) -> str:
    if not hc: return "other"
    ch = hc[0]
    if ch in "12": return "passenger"
    if ch in "345678": return "freight"
    return "other"


def _split_pipe(v):
    return [x.strip() for x in (v or "").split("|") if x.strip()]


def build_berth_lookup(csv_path: Path):
    berths_set, berth_info = set(), {}
    with csv_path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            tds = _split_pipe(row.get("train_describers", ""))
            all_berths = set(_split_pipe(row.get("from_berths", ""))) \
                       | set(_split_pipe(row.get("to_berths", "")))
            info = {k: row.get(k, "").strip() for k in
                    ("tiploc", "crs", "name", "stanox", "chainage_km", "stanme")}
            for td in tds:
                for berth in all_berths:
                    key = (td, berth)
                    berths_set.add(key)
                    berth_info.setdefault(key, info)
    return berths_set, berth_info


def build_smart_stanme(smart_path: Path):
    lookup = {}
    data = json.load(smart_path.open(encoding="utf-8"))
    for rec in data.get("BERTHDATA", []):
        td = rec.get("TD", "").strip()
        sm = rec.get("STANME", "").strip()
        for k in ("FROMBERTH", "TOBERTH"):
            b = rec.get(k, "").strip()
            if td and b:
                lookup.setdefault((td, b), sm)
    return lookup


def stream_ca(jsonl_path: Path, date: str):
    with jsonl_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line: continue
            try:
                items = json.loads(line)
            except json.JSONDecodeError:
                continue
            for item in items:
                ca = item.get("CA_MSG")
                if ca is None: continue
                area = ca.get("area_id", "").strip()
                if area not in ALL_TDS: continue
                hc = ca.get("descr", "").strip()
                fb = ca.get("from", "").strip()
                tb = ca.get("to", "").strip()
                if not hc or not fb or not tb: continue
                if hc in ("****", "0000"): continue
                try: ts_ms = int(ca.get("time", "0"))
                except ValueError: ts_ms = 0
                yield {"date": date, "headcode": hc, "ts_ms": ts_ms,
                       "area": area, "from_berth": fb, "to_berth": tb}


def segment(events):
    if not events: return []
    ev = sorted(events, key=lambda e: e["ts_ms"])
    segs, cur = [], [ev[0]]
    for e in ev[1:]:
        if e["ts_ms"] - cur[-1]["ts_ms"] > MAX_GAP_MS:
            segs.append(cur); cur = [e]
        else:
            cur.append(e)
    segs.append(cur)
    return segs


def qualify(train_events, corridor_berths):
    out = {}
    for (date, hc), events in train_events.items():
        for j_num, seg in enumerate(segment(events), start=1):
            areas = {e["area"] for e in seg}
            hits = set()
            for e in seg:
                for b in (e["from_berth"], e["to_berth"]):
                    ab = (e["area"], b)
                    if ab in corridor_berths:
                        hits.add(ab)
            if (areas & R3_SPECIFIC_AREAS) and len(hits) >= 2:
                out[(date, hc, j_num)] = seg
    return out


def detect_direction(events):
    ev = sorted(events, key=lambda e: e["ts_ms"])
    first, last = ev[0]["area"], ev[-1]["area"]
    if first == "WA" and last in ("WD", "CE"): return "southbound"
    if first in ("CE", "WD") and last == "WA": return "northbound"
    return "northbound"


def ts_to_utc(ts_ms):
    if ts_ms == 0: return ""
    try:
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) \
                        .strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OSError, OverflowError, ValueError):
        return ""


FIELDS = ["date", "headcode", "journey_num", "train_class", "direction",
          "ts_ms", "timestamp_utc", "td_area",
          "from_berth", "to_berth", "from_stanme", "to_stanme",
          "from_station", "to_station",
          "from_chainage_km", "to_chainage_km", "corridor_hit"]


def emit(jsonl: Path, date: str, out_csv: Path,
         stations: Path, smart: Path):
    print(f"[extract] loading corridor / SMART references", flush=True)
    corridor_berths, berth_info = build_berth_lookup(stations)
    smart_stanme = build_smart_stanme(smart)

    print(f"[extract] scanning {jsonl.name}", flush=True)
    t0 = time.time()
    day_events = defaultdict(list)
    n_ca = 0
    for ev in stream_ca(jsonl, date):
        day_events[(ev["date"], ev["headcode"])].append(ev)
        n_ca += 1
        if n_ca % 100000 == 0:
            print(f"[extract]  {n_ca:,} CA events read", flush=True)
    print(f"[extract] {n_ca:,} CA events total in {time.time()-t0:.1f}s",
          flush=True)

    print(f"[extract] segmenting journeys and qualifying corridor hits",
          flush=True)
    r3 = qualify(day_events, corridor_berths)
    print(f"[extract] {len(r3)} R3 journeys qualified", flush=True)

    print(f"[extract] writing {out_csv.name}", flush=True)
    with out_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for (date, hc, jn), events in r3.items():
            cls = classify_headcode(hc)
            direction = detect_direction(events)
            for e in sorted(events, key=lambda x: x["ts_ms"]):
                fk = (e["area"], e["from_berth"])
                tk = (e["area"], e["to_berth"])
                fi = berth_info.get(fk, {})
                ti = berth_info.get(tk, {})
                w.writerow({
                    "date": date, "headcode": hc, "journey_num": jn,
                    "train_class": cls, "direction": direction,
                    "ts_ms": e["ts_ms"], "timestamp_utc": ts_to_utc(e["ts_ms"]),
                    "td_area": e["area"],
                    "from_berth": e["from_berth"],
                    "to_berth": e["to_berth"],
                    "from_stanme": smart_stanme.get(fk, ""),
                    "to_stanme":   smart_stanme.get(tk, ""),
                    "from_station": fi.get("name", ""),
                    "to_station":   ti.get("name", ""),
                    "from_chainage_km": fi.get("chainage_km", ""),
                    "to_chainage_km":   ti.get("chainage_km", ""),
                    "corridor_hit": 1 if (fk in corridor_berths
                                          or tk in corridor_berths) else 0,
                })
    print(f"[extract] done", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl", required=True, type=Path)
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--stations", type=Path, default=DEFAULT_STATIONS)
    ap.add_argument("--smart", type=Path, default=DEFAULT_SMART)
    args = ap.parse_args()

    # If --date not derivable, try filename
    date = args.date
    if not re.match(r"\d{4}-\d{2}-\d{2}", date):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", args.jsonl.name)
        if m: date = m.group(1)
        else: raise SystemExit(f"cannot derive date from {args.jsonl.name}")

    emit(args.jsonl, date, args.out, args.stations, args.smart)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
