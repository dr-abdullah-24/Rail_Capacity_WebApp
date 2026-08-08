"""
extract_two_corridors_generic.py
================================
Takes ANY TD data source (a .jsonl file, a .tbz2 archive, or a
pre-extracted events CSV) and TWO corridor definitions, and emits per-
corridor events + journey summaries suitable for the diversion pipeline.

Corridor JSON schema (as ingested by the web app from corridors.json):

  {
    "id": "...",
    "name": "...",
    "stations": [
      {"seq": 0, "name": "Crewe", "tiploc": "CREWE",
       "crs": "CRE", "stanox": "42112", "stanme": "CREWE",
       "lat": 53.09, "lon": -2.43},
      ...
    ]
  }

The extractor matches events by BOTH `from_stanme` and `to_stanme`
against the union of the corridor's `stanme` field values.

Usage:
  python extract_two_corridors_generic.py \\
      --td-source /path/to/data.jsonl        \\  # or .tbz2 or events.csv
      --source-corridor /path/source.json    \\  # corridor JSON
      --target-corridor /path/target.json    \\
      --date YYYY-MM-DD                      \\  # or blank = all dates
      --out-dir /path/to/run_output_dir      \\
      [--smart /path/SMART.json]

Outputs into --out-dir:
  source_events.csv    source_summary.csv
  target_events.csv    target_summary.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import tarfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE_2018 = Path(r"C:\Users\LOQ\OneDrive - Liverpool John Moores University\LIV_2_MAN_2018_MILP")
BASE_ANA  = Path(r"C:\Users\LOQ\OneDrive - Liverpool John Moores University\LIV_2_MAN_Analysis_&_Data")
DEFAULT_SMART = BASE_ANA / "Fixed_Data" / "SMART.json"

# TD areas of interest for the corridor search (broad — we filter by
# corridor stanme afterward)
ALL_TDS = {"CE", "MS", "MP", "M3", "WD", "WA", "M0", "M1", "M2", "M5",
           "MD", "MJ", "MK", "SS", "XL", "XE"}
MAX_GAP_MS = 30 * 60 * 1000


def classify_headcode(hc: str) -> str:
    if not hc: return "other"
    ch = hc[0]
    if ch in "12": return "passenger"
    if ch in "345678": return "freight"
    return "other"


def build_smart_stanme(smart_path: Path) -> dict[tuple[str, str], str]:
    lookup: dict[tuple[str, str], str] = {}
    data = json.load(smart_path.open(encoding="utf-8"))
    for rec in data.get("BERTHDATA", []):
        td = rec.get("TD", "").strip()
        sm = rec.get("STANME", "").strip()
        for k in ("FROMBERTH", "TOBERTH"):
            b = rec.get(k, "").strip()
            if td and b:
                lookup.setdefault((td, b), sm)
    return lookup


def ts_to_utc(ts_ms: int) -> str:
    if ts_ms == 0: return ""
    try:
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) \
                        .strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OSError, OverflowError, ValueError):
        return ""


def ts_to_date(ts_ms: int) -> str:
    if ts_ms == 0: return ""
    try:
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) \
                        .strftime("%Y-%m-%d")
    except (OSError, OverflowError, ValueError):
        return ""


# ─────────────────────────────────────────────────────────────────────
# Data source readers
# ─────────────────────────────────────────────────────────────────────
def stream_ca_from_jsonl(jsonl_path: Path, date_filter: str | None):
    with jsonl_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line: continue
            try:
                items = json.loads(line)
            except json.JSONDecodeError:
                continue
            for item in items:
                ca = item.get("CA_MSG") if isinstance(item, dict) else None
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
                date = ts_to_date(ts_ms)
                if date_filter and date != date_filter:
                    continue
                yield {"date": date, "headcode": hc, "ts_ms": ts_ms,
                       "area": area, "from_berth": fb, "to_berth": tb}


def stream_ca_from_tbz2(tbz2_path: Path, date_filter: str | None):
    with tarfile.open(str(tbz2_path), "r|bz2") as tar:
        for m in tar:
            if not m.isfile() or not m.name.endswith(".td"):
                continue
            f = tar.extractfile(m)
            if f is None: continue
            for raw in f.read().splitlines():
                line = raw.strip()
                if not line: continue
                try:
                    items = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for item in items:
                    ca = item.get("CA_MSG") if isinstance(item, dict) else None
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
                    date = ts_to_date(ts_ms)
                    if date_filter and date != date_filter:
                        continue
                    yield {"date": date, "headcode": hc, "ts_ms": ts_ms,
                           "area": area, "from_berth": fb, "to_berth": tb}


def stream_events_from_csv(csv_path: Path, date_filter: str | None):
    """Consume a pre-extracted route*_train_events.csv (from the existing
    2018/2026 pipeline). Columns: date, headcode, ts_ms, td_area,
    from_berth, to_berth, from_stanme, to_stanme, ..."""
    with csv_path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if date_filter and row.get("date", "") != date_filter:
                continue
            try: ts_ms = int(row.get("ts_ms") or 0)
            except ValueError: ts_ms = 0
            yield {"date": row.get("date", ""),
                   "headcode": row.get("headcode", ""),
                   "ts_ms": ts_ms,
                   "area": row.get("td_area", ""),
                   "from_berth": row.get("from_berth", ""),
                   "to_berth": row.get("to_berth", ""),
                   "from_stanme_pre": row.get("from_stanme", ""),
                   "to_stanme_pre":   row.get("to_stanme", "")}


def stream_ca_from_source(source_path: Path, date_filter: str | None):
    suffix = source_path.suffix.lower()
    if suffix in {".jsonl", ".ndjson", ""} and "jsonl" in source_path.name:
        yield from stream_ca_from_jsonl(source_path, date_filter)
    elif suffix == ".jsonl" or suffix == ".ndjson":
        yield from stream_ca_from_jsonl(source_path, date_filter)
    elif suffix in {".tbz2", ".tbz", ".bz2"} or source_path.name.endswith(".tar.bz2"):
        yield from stream_ca_from_tbz2(source_path, date_filter)
    elif suffix == ".csv":
        yield from stream_events_from_csv(source_path, date_filter)
    else:
        # Best-effort based on content
        yield from stream_ca_from_jsonl(source_path, date_filter)


# ─────────────────────────────────────────────────────────────────────
# Corridor filter
# ─────────────────────────────────────────────────────────────────────
def corridor_stanmes(corridor: dict) -> set[str]:
    """Return the set of station STANMEs the corridor recognises. We
    accept variants: some corridor JSONs have `stanme`, some don't;
    fall back to `tiploc`."""
    out: set[str] = set()
    for s in corridor.get("stations", []):
        for key in ("stanme", "tiploc", "name"):
            v = str(s.get(key) or "").strip()
            if v:
                out.add(v)
    return out


def segment_into_journeys(events: list[dict]) -> list[list[dict]]:
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


def qualify(train_events: dict, corridor_stanmes: set[str]) -> dict:
    out = {}
    for (date, hc), events in train_events.items():
        for j_num, seg in enumerate(segment_into_journeys(events), start=1):
            hits = set()
            for e in seg:
                for sm in (e.get("from_stanme"), e.get("to_stanme")):
                    if sm and sm in corridor_stanmes:
                        hits.add(sm)
            if len(hits) >= 2:
                out[(date, hc, j_num)] = seg
    return out


def detect_direction(events: list[dict], corridor: dict) -> str:
    """northbound = journey moves from earlier corridor seq to later."""
    if not events: return "unknown"
    seq_by_stanme: dict[str, int] = {}
    for s in corridor.get("stations", []):
        for key in ("stanme", "tiploc", "name"):
            v = str(s.get(key) or "").strip()
            if v:
                seq_by_stanme.setdefault(v, s["seq"])
    ev = sorted(events, key=lambda e: e["ts_ms"])
    first_seq = None; last_seq = None
    for e in ev:
        for sm in (e.get("from_stanme"), e.get("to_stanme")):
            if sm in seq_by_stanme:
                if first_seq is None: first_seq = seq_by_stanme[sm]
                last_seq = seq_by_stanme[sm]
    if first_seq is None or last_seq is None: return "unknown"
    if last_seq > first_seq: return "northbound"
    if last_seq < first_seq: return "southbound"
    return "unknown"


EVENT_FIELDS = ["date", "headcode", "journey_num", "train_class", "direction",
                "ts_ms", "timestamp_utc", "td_area",
                "from_berth", "to_berth", "from_stanme", "to_stanme"]
SUMMARY_FIELDS = ["date", "headcode", "journey_num", "train_class",
                  "direction", "entry_time_utc", "exit_time_utc",
                  "duration_mins", "num_events", "num_corridor_hits",
                  "num_distinct_stations", "stations_sequence",
                  "first_station", "last_station"]


def write_outputs(qualified: dict, corridor: dict,
                  smart_stanme: dict,
                  out_events: Path, out_summary: Path) -> None:
    ev_rows, sm_rows = [], []
    for (date, hc, jn), events in qualified.items():
        cls = classify_headcode(hc)
        direction = detect_direction(events, corridor)
        ev = sorted(events, key=lambda x: x["ts_ms"])
        for e in ev:
            fs = e.get("from_stanme") or \
                 smart_stanme.get((e["area"], e["from_berth"]), "")
            ts = e.get("to_stanme")   or \
                 smart_stanme.get((e["area"], e["to_berth"]),   "")
            ev_rows.append({
                "date": date, "headcode": hc, "journey_num": jn,
                "train_class": cls, "direction": direction,
                "ts_ms": e["ts_ms"], "timestamp_utc": ts_to_utc(e["ts_ms"]),
                "td_area": e["area"],
                "from_berth": e["from_berth"], "to_berth": e["to_berth"],
                "from_stanme": fs, "to_stanme": ts,
            })
        entry, exit_ = ev[0]["ts_ms"], ev[-1]["ts_ms"]
        seq, seen = [], set()
        for e in ev:
            for sm in (e.get("from_stanme")
                       or smart_stanme.get((e["area"], e["from_berth"]), ""),
                       e.get("to_stanme")
                       or smart_stanme.get((e["area"], e["to_berth"]), "")):
                if sm and sm not in seen:
                    seen.add(sm); seq.append(sm)
        sm_rows.append({
            "date": date, "headcode": hc, "journey_num": jn,
            "train_class": cls, "direction": direction,
            "entry_time_utc": ts_to_utc(entry),
            "exit_time_utc":  ts_to_utc(exit_),
            "duration_mins":  round((exit_ - entry) / 60000.0, 2)
                              if exit_ > entry else 0,
            "num_events":     len(ev),
            "num_corridor_hits": sum(1 for e in ev
                if (e.get("from_stanme") in seen)
                or (e.get("to_stanme") in seen)),
            "num_distinct_stations": len(seq),
            "stations_sequence": "|".join(seq),
            "first_station": seq[0]  if seq else "",
            "last_station":  seq[-1] if seq else "",
        })
    with out_events.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=EVENT_FIELDS, extrasaction="ignore")
        w.writeheader(); w.writerows(ev_rows)
    with out_summary.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=SUMMARY_FIELDS, extrasaction="ignore")
        w.writeheader(); w.writerows(sm_rows)


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--td-source", type=Path, nargs="+", default=[],
                    help="One or more TD data files (.jsonl / .tbz2 / "
                         "events CSV). All are concatenated.")
    ap.add_argument("--td-source-list", type=Path, default=None,
                    help="Text file with one TD source path per line "
                         "(avoids Windows command-line length limits).")
    ap.add_argument("--source-corridor", required=True, type=Path,
                    help="Corridor JSON (source route the freight comes from)")
    ap.add_argument("--target-corridor", required=True, type=Path,
                    help="Corridor JSON (target route the freight goes on)")
    ap.add_argument("--date", default="",
                    help="Restrict to a single YYYY-MM-DD (blank = all)")
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--smart", type=Path, default=DEFAULT_SMART)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    source = json.loads(args.source_corridor.read_text(encoding="utf-8"))
    target = json.loads(args.target_corridor.read_text(encoding="utf-8"))
    src_stanmes = corridor_stanmes(source)
    tgt_stanmes = corridor_stanmes(target)
    print(f"[extract2] source: {source.get('name')} - "
          f"{len(src_stanmes)} stanmes", flush=True)
    print(f"[extract2] target: {target.get('name')} - "
          f"{len(tgt_stanmes)} stanmes", flush=True)

    print(f"[extract2] loading SMART lookup", flush=True)
    smart_stanme = build_smart_stanme(args.smart)

    date_filter = args.date.strip() or None
    sources: list[Path] = list(args.td_source)
    if args.td_source_list:
        for line in args.td_source_list.read_text(encoding="utf-8").splitlines():
            p = line.strip()
            if p:
                sources.append(Path(p))
    if not sources:
        raise SystemExit("--td-source or --td-source-list is required")
    print(f"[extract2] scanning {len(sources)} file(s) "
          f"(date_filter={date_filter or 'all'})", flush=True)
    for src in sources:
        print(f"[extract2]   - {src.name}", flush=True)
    t0 = time.time()
    day_events: dict[tuple[str, str], list[dict]] = defaultdict(list)
    n_read = 0

    def _stream_all():
        for src in sources:
            print(f"[extract2] reading {src.name}", flush=True)
            for ev in stream_ca_from_source(src, date_filter):
                yield ev

    for ev in _stream_all():
        # For CSV sources we already have stanmes; for jsonl/tbz2, look
        # them up now (avoids O(N) work later)
        if "from_stanme_pre" in ev:
            ev["from_stanme"] = ev["from_stanme_pre"]
            ev["to_stanme"]   = ev["to_stanme_pre"]
        else:
            ev["from_stanme"] = smart_stanme.get(
                (ev["area"], ev["from_berth"]), "")
            ev["to_stanme"]   = smart_stanme.get(
                (ev["area"], ev["to_berth"]),   "")
        # Only keep events that touch either corridor - saves memory
        if not ((ev["from_stanme"] in src_stanmes
                 or ev["to_stanme"] in src_stanmes)
             or (ev["from_stanme"] in tgt_stanmes
                 or ev["to_stanme"] in tgt_stanmes)):
            continue
        day_events[(ev["date"], ev["headcode"])].append(ev)
        n_read += 1
        if n_read % 200_000 == 0:
            print(f"[extract2]   kept {n_read:,} corridor events", flush=True)
    print(f"[extract2] kept {n_read:,} corridor-touching events "
          f"({time.time()-t0:.1f}s)", flush=True)

    print(f"[extract2] segmenting + qualifying journeys", flush=True)
    src_journeys = qualify(day_events, src_stanmes)
    tgt_journeys = qualify(day_events, tgt_stanmes)
    print(f"[extract2] source journeys={len(src_journeys)}  "
          f"target journeys={len(tgt_journeys)}", flush=True)

    print(f"[extract2] writing outputs to {args.out_dir}", flush=True)
    write_outputs(src_journeys, source, smart_stanme,
                  args.out_dir / "source_events.csv",
                  args.out_dir / "source_summary.csv")
    write_outputs(tgt_journeys, target, smart_stanme,
                  args.out_dir / "target_events.csv",
                  args.out_dir / "target_summary.csv")
    print(f"[extract2] done", flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
