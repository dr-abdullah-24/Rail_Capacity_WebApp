"""
prepare_diversion_inputs.py
===========================
Bridge the diversion pipeline to the capacity-gap MILP.

Given:
  - divertible_trains.csv         (from identify_divertible_generic.py)
  - target_events.csv             (from extract_two_corridors_generic.py)
  - target_corridor JSON          (station chain)
  - flex-window in minutes        (default 60)

Emit the three input artefacts the capacity MILP + rolling-horizon runner
consume:

  candidate_paths_diversion.csv         one row per divertible
    path_id,name,origin_seq,destination_seq,direction,traction_class,
    priority_weight,earliest_dep_min,latest_dep_min,notes,
    original_dep_min,original_headcode

  baseline_traffic_diversion.csv        target-corridor observed traffic
    date,headcode,journey_num,train_class,direction,junction_seq,
    junction_name,line,t_min

  freight_lines_by_junction_diversion.json
    {"<seq>|<dir>": {"lines":[...], "source":..., "n_freight":N, "n_traffic":N}}

The candidate window is [original_dep - flex, original_dep + flex] so the
MILP is free to slot each divertible anywhere inside that band; the MILP
then picks the departure minute that minimises conflict with existing
target traffic and internal pairwise headway.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def parse_utc(s: str) -> int:
    """Return minute-of-day (0..1439) from an ISO UTC string."""
    if not s: return 0
    try:
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2).astimezone(timezone.utc)
        return dt.hour * 60 + dt.minute
    except Exception:
        return 0


FREIGHT_CLASSES = {"class4", "class6", "class4_freight", "class6_freight",
                    "freight"}


def _load_slow_berths(smart_json: Path,
                      target_stanmes: set[str]) -> dict[str, set[str]]:
    """Return {stanme: set_of_slow_berth_codes} for target corridor stations.
    Slow = FROMLINE in (S, M, C).  Falls back to all-non-fast if none found.
    """
    import json as _j
    try:
        data = _j.loads(smart_json.read_text(encoding="utf-8"))
    except Exception:
        return {}
    slow: dict[str, set[str]] = {}
    fast: dict[str, set[str]] = {}
    all_b: dict[str, set[str]] = {}
    for r in data.get("BERTHDATA", []):
        sm = (r.get("STANME") or "").strip()
        if sm not in target_stanmes:
            continue
        fb = (r.get("FROMBERTH") or "").strip()
        fl = (r.get("FROMLINE") or "").strip()
        if not fb:
            continue
        all_b.setdefault(sm, set()).add(fb)
        if fl == "F":
            fast.setdefault(sm, set()).add(fb)
        if fl in ("S", "M", "C"):
            slow.setdefault(sm, set()).add(fb)
    result: dict[str, set[str]] = {}
    for sm in target_stanmes:
        s = slow.get(sm, set())
        result[sm] = s if s else (all_b.get(sm, set()) - fast.get(sm, set()))
    return result


def build_baseline_and_freight_lines(target_events_csv: Path,
                                     target_corridor: dict,
                                     out_baseline: Path,
                                     out_freight_lines: Path,
                                     slow_berths: dict[str, set[str]] | None = None) -> int:
    """Emit baseline_traffic_*.csv (one row per (train,junction) touch) and
    freight_lines_by_junction_*.json.  Returns number of touch rows."""
    # Build stanme -> seq / name from target corridor
    stanme_to_seq: dict[str, int] = {}
    stanme_to_name: dict[str, str] = {}
    for s in target_corridor.get("stations", []):
        for k in ("stanme", "tiploc", "name"):
            v = str(s.get(k) or "").strip()
            if v and v not in stanme_to_seq:
                stanme_to_seq[v] = s["seq"]
                stanme_to_name[v] = s["name"]

    # Aggregate to one row per (train, junction) using earliest touch
    seen: dict[tuple, dict] = {}
    with target_events_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            for stanme_col in ("from_stanme", "to_stanme"):
                stanme = (r.get(stanme_col) or "").strip()
                if stanme not in stanme_to_seq: continue
                seq = stanme_to_seq[stanme]
                # Slow-line filter: skip if berth is not in the slow set
                if slow_berths and stanme_col == "from_stanme":
                    fb = (r.get("from_berth") or "").strip()
                    stn_slow = slow_berths.get(stanme, set())
                    if stn_slow and fb and fb not in stn_slow:
                        continue
                key = (r["date"], r["headcode"], r["journey_num"], seq)
                t_min = parse_utc(r.get("timestamp_utc", ""))
                if key not in seen or t_min < seen[key]["t_min"]:
                    seen[key] = {
                        "date": r["date"], "headcode": r["headcode"],
                        "journey_num": r["journey_num"],
                        "train_class": r["train_class"],
                        "direction": r["direction"],
                        "junction_seq": seq,
                        "junction_name": stanme_to_name[stanme],
                        "line": "",   # SMART line not carried through here
                        "t_min": t_min,
                    }

    fields = ["date", "headcode", "journey_num", "train_class",
              "direction", "junction_seq", "junction_name",
              "line", "t_min"]
    with out_baseline.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(seen.values())

    # Freight-lines-by-junction (line column above is empty -> single ""
    # token; that's fine, the MILP's line-choice degenerates to a single
    # option per junction which matches the current headway-only conflict
    # rule for observed target traffic)
    fr_set: dict[tuple[int, str], set[str]] = {}
    any_set: dict[tuple[int, str], set[str]] = {}
    for r in seen.values():
        key = (r["junction_seq"], r["direction"])
        any_set.setdefault(key, set()).add(r["line"])
        if r["train_class"] in FREIGHT_CLASSES:
            fr_set.setdefault(key, set()).add(r["line"])
    out = {}
    for key in any_set:
        seq, dirn = key
        chosen = sorted(fr_set.get(key) or any_set[key])
        out[f"{seq}|{dirn}"] = {
            "lines":     chosen,
            "source":    "freight-observed" if key in fr_set
                         else "fallback-all-traffic",
            "n_freight": len(fr_set.get(key, set())),
            "n_traffic": len(any_set[key]),
        }
    out_freight_lines.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return len(seen)


def build_candidates(divertible_csv: Path,
                     target_corridor: dict,
                     flex_min: int,
                     out_path: Path) -> int:
    max_seq = max((s["seq"] for s in target_corridor.get("stations", [])),
                  default=11)
    rows = []
    seen_ids: set[str] = set()
    with divertible_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            hc = (r.get("headcode") or "").strip()
            jn = (r.get("journey_num") or "").strip()
            date = (r.get("date") or "").strip().replace("-", "")
            dirn = (r.get("direction") or "northbound").strip()
            # Original departure minute-of-day = entry_time_utc
            dep = parse_utc(r.get("entry_time_utc") or "")
            # Map to target-corridor direction convention. The source
            # extractor used seq-based direction (increasing/decreasing);
            # target corridor typically labels the same way. Northbound
            # here means origin_seq -> destination_seq ascending.
            if dirn == "northbound":
                o_seq, d_seq = 0, max_seq
            else:
                o_seq, d_seq = max_seq, 0
            cls_digit = hc[0] if hc else "6"
            cls_id = f"class{cls_digit}"
            # Path IDs must be globally unique across the whole batch;
            # otherwise the MILP emits duplicate rows and CBC rejects the
            # LP.  Include the observation date so multi-day extracts do
            # not collide on identical (headcode, journey_num) pairs.
            base_pid = f"D_{date}_{hc}_{jn}" if date else f"D_{hc}_{jn}"
            pid = base_pid
            suffix = 1
            while pid in seen_ids:
                suffix += 1
                pid = f"{base_pid}_{suffix}"
            seen_ids.add(pid)
            rows.append({
                "path_id": pid,
                "date":    r.get("date", ""),
                "name":    f"Divertible {hc} #{jn}"
                           + (f" ({date})" if date else ""),
                "origin_seq":       o_seq,
                "destination_seq":  d_seq,
                "direction":        dirn,
                "traction_class":   cls_id,
                "priority_weight":  1.0,
                "earliest_dep_min": max(0, dep - flex_min),
                "latest_dep_min":   min(1439, dep + flex_min),
                "notes": (f"original dep {dep // 60:02d}:{dep % 60:02d} "
                          f"(cls {cls_digit}"
                          + (f", {date}" if date else "") + ")"),
                "original_dep_min":  dep,
                "original_headcode": hc,
            })

    fields = ["path_id", "date", "name", "origin_seq", "destination_seq",
              "direction", "traction_class", "priority_weight",
              "earliest_dep_min", "latest_dep_min", "notes",
              "original_dep_min", "original_headcode"]
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--divertible", required=True, type=Path)
    ap.add_argument("--target-events", required=True, type=Path)
    ap.add_argument("--target-corridor", required=True, type=Path)
    ap.add_argument("--flex-min", type=int, default=60)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--smart-json", type=Path, default=None)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    target = json.loads(args.target_corridor.read_text(encoding="utf-8"))

    # Build target stanme set for slow-line filtering
    tgt_stanmes: set[str] = set()
    for s in target.get("stations", []):
        for k in ("stanme", "tiploc", "name"):
            v = str(s.get(k) or "").strip()
            if v: tgt_stanmes.add(v)
    slow_berths = None
    if args.smart_json and args.smart_json.exists():
        slow_berths = _load_slow_berths(args.smart_json, tgt_stanmes)
        total_slow = sum(len(v) for v in slow_berths.values())
        print(f"[prepare] slow-line filter: {total_slow} berths across "
              f"{len(slow_berths)} stations", flush=True)

    print(f"[prepare] building baseline + freight-lines from target events",
          flush=True)
    n_base = build_baseline_and_freight_lines(
        args.target_events, target,
        args.out_dir / "baseline_traffic_diversion.csv",
        args.out_dir / "freight_lines_by_junction_diversion.json",
        slow_berths=slow_berths)

    print(f"[prepare] building candidate paths (flex ±{args.flex_min} min)",
          flush=True)
    n_cand = build_candidates(
        args.divertible, target, args.flex_min,
        args.out_dir / "candidate_paths_diversion.csv")

    print(f"[prepare] baseline touches={n_base}  candidates={n_cand}",
          flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
