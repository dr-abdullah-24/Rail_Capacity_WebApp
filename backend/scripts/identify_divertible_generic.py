"""
identify_divertible_generic.py
==============================
Generic divertibility classifier for the freight-diversion pipeline.

Given a source and target corridor and the source-route journey summary
(produced by extract_two_corridors_generic.py), classify each journey as:

  DIVERTIBLE  - passes fully through the source corridor with entry/exit
                points at the corridor endpoints (a genuine through-train
                that could take an alternative path via the target
                corridor).  ANY service class (0..9) is admissible.
  TERMINATES  - originates or terminates inside the source corridor
                (its O or D is in the middle, so cannot re-route)
  PARTIAL     - enters/exits corridor mid-route without touching either
                endpoint (probably related through-traffic but O/D outside
                our observability - safer to exclude)
  CLASS_SKIP  - wrong class digit (excluded by filter)

Only DIVERTIBLE journeys are written to divertible_trains.csv (compatible
with what freight_shifting_strategy_2018.py expects).

Rules (all three must hold):

  1. headcode[0] == class_digit               (service class filter, 0..9)
  2. AT LEAST ONE of the journey's endpoints matches a source-corridor
     terminus (so the train reaches a boundary at which it could hand
     over to the target route)
  3. neither the first nor the last station is an excluded "terminal"
     (optional user-supplied exclusion list; empty by default)

Any service class (0..9) is admissible - the filter is purely by class
digit and no longer restricted to freight (4/6).

Usage:
  python identify_divertible_generic.py \\
      --source-summary /path/source_summary.csv \\
      --source-corridor /path/source.json \\
      --target-corridor /path/target.json \\
      --class 4 \\
      --out /path/divertible_trains.csv \\
      [--exclude-terminal TIPLOC[,TIPLOC,...]]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path


def stanme_set_of(corridor: dict) -> set[str]:
    out: set[str] = set()
    for s in corridor.get("stations", []):
        for k in ("stanme", "tiploc", "name"):
            v = str(s.get(k) or "").strip()
            if v: out.add(v)
    return out


def chainage_map_of(corridor: dict) -> dict[str, float]:
    """Maps each station's name/stanme/tiploc to its chainage_km."""
    out: dict[str, float] = {}
    for s in corridor.get("stations", []):
        ch = s.get("chainage_km")
        if ch is None:
            continue
        ch = float(ch)
        for k in ("stanme", "tiploc", "name"):
            v = str(s.get(k) or "").strip()
            if v:
                out[v] = ch
    return out


def _nearest_chainage(station_name: str, ch_map: dict[str, float]) -> float | None:
    """Return the chainage_km for the nearest name match, or None."""
    v = ch_map.get(station_name.strip())
    if v is not None:
        return v
    lo = station_name.strip().upper()
    for k, vv in ch_map.items():
        if k.upper() == lo:
            return vv
    return None


def endpoints_of(corridor: dict) -> tuple[set[str], set[str]]:
    """(first-end stanmes, last-end stanmes)."""
    ss = corridor.get("stations", []) or []
    if not ss: return set(), set()
    first = ss[0]; last = ss[-1]
    def as_set(s):
        return {str(s.get(k) or "").strip()
                for k in ("stanme", "tiploc", "name")
                if s.get(k)}
    return as_set(first), as_set(last)


def classify(row: dict, class_digits: set[str],
             src_first: set[str], src_last: set[str],
             src_stanmes: set[str], tgt_stanmes: set[str],
             excluded_terminals: set[str],
             endpoint_strictness: str,
             ch_map: dict[str, float] | None = None,
             nearby_km: float = 20.0,
             min_nearby_stations: int = 7) -> tuple[str, str]:
    hc = (row.get("headcode") or "").strip()
    first = (row.get("first_station") or "").strip()
    last  = (row.get("last_station")  or "").strip()

    if not hc or hc[0] not in class_digits: return "CLASS_SKIP", ""
    if first in excluded_terminals or last in excluded_terminals:
        return "TERMINATES", ""

    # Rule 3: endpoint match.  Four strictness levels:
    #   any     - no endpoint requirement.  Any qualifying journey
    #             (i.e. one that touched >= 2 corridor stanmes) is
    #             considered divertible.
    #   relaxed - at least ONE of the journey's endpoints matches a
    #             corridor terminus.
    #   strict  - BOTH endpoints match corridor termini (classical
    #             through-train).
    #   nearby  - at least one endpoint is within nearby_km of a terminus.
    if endpoint_strictness == "any":
        return "DIVERTIBLE", ""

    if endpoint_strictness == "nearby":
        # A journey qualifies if:
        #   1. At least one endpoint is "near" a corridor terminus —
        #      either within nearby_km by chainage OR an exact terminus name.
        #   2. The train covers enough of the corridor to be a genuine
        #      through service (num_distinct_stations >= min_nearby_stations).
        #      This rejects local shuttles where both endpoints happen to be
        #      within nearby_km of the SAME terminus (e.g. Sandbach→Chelford).
        #
        # Note: journey endpoint names (from TD log STANME codes) frequently
        # do not match corridor station names, so chainage lookup may return
        # None for one or both endpoints.  The coverage filter handles this
        # gracefully regardless of which names are resolvable.
        try:
            n_stns = int(row.get("num_distinct_stations") or 0)
        except (TypeError, ValueError):
            n_stns = 0
        if n_stns < min_nearby_stations:
            return "PARTIAL", ""

        at_first_end = first in src_first or first in src_last
        at_last_end  = last  in src_first or last  in src_last
        # Quick path: exact terminus match (superset of relaxed)
        if at_first_end or at_last_end:
            return "DIVERTIBLE", ""

        # Chainage-based proximity check
        if ch_map:
            max_ch   = max(ch_map.values())
            ch_first = _nearest_chainage(first, ch_map)
            ch_last  = _nearest_chainage(last,  ch_map)
            near_start = (ch_first is not None and ch_first <= nearby_km) or \
                         (ch_last  is not None and ch_last  <= nearby_km)
            near_end   = (ch_first is not None and ch_first >= max_ch - nearby_km) or \
                         (ch_last  is not None and ch_last  >= max_ch - nearby_km)
            if near_start or near_end:
                # Identify which endpoint triggered the nearby match for the note
                for stn, ch in [(first, ch_first), (last, ch_last)]:
                    if ch is not None:
                        if ch <= nearby_km:
                            return "DIVERTIBLE", (
                                f"{stn} is {ch:.1f} km from start terminus "
                                f"(within {nearby_km:.0f} km)")
                        if ch >= max_ch - nearby_km:
                            return "DIVERTIBLE", (
                                f"{stn} is {max_ch - ch:.1f} km from end terminus "
                                f"(within {nearby_km:.0f} km)")
        return "PARTIAL", ""

    at_first_end = first in src_first or first in src_last
    at_last_end  = last  in src_first or last  in src_last
    if endpoint_strictness == "strict":
        if not (at_first_end and at_last_end):
            return "PARTIAL", ""
    else:
        if not (at_first_end or at_last_end):
            return "PARTIAL", ""

    return "DIVERTIBLE", ""


DIVERTIBLE_FIELDS = ["date", "headcode", "journey_num", "direction",
                     "train_class", "entry_time_utc", "exit_time_utc",
                     "duration_mins", "num_events", "num_distinct_stations",
                     "first_station", "last_station", "stations_sequence",
                     "nearby_note"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-summary", required=True, type=Path)
    ap.add_argument("--source-corridor", required=True, type=Path)
    ap.add_argument("--target-corridor", required=True, type=Path)
    ap.add_argument("--class", dest="class_digit", default=None,
                    help='(deprecated) single class digit; use --classes')
    ap.add_argument("--classes", default=None,
                    help='Comma-separated class digits (0-9). '
                         'e.g. "4" or "4,6" or "1,2,4,6"')
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--exclude-terminal", default="",
                    help="Comma-separated tiploc/stanme values that mean "
                         "the train terminates and cannot be diverted")
    ap.add_argument("--endpoint-strictness", default="relaxed",
                    choices=["any", "relaxed", "strict", "nearby"],
                    help="any = no endpoint requirement (accept every "
                         "qualifying journey); relaxed = at least one "
                         "endpoint at a corridor terminus; strict = both "
                         "endpoints must match; nearby = endpoint within "
                         "--nearby-km of a corridor terminus")
    ap.add_argument("--nearby-km", type=float, default=20.0,
                    help="km threshold for nearby strictness")
    ap.add_argument("--min-nearby-stations", type=int, default=7,
                    help="minimum num_distinct_stations for a nearby match "
                         "to qualify — filters local shuttles where both "
                         "endpoints are near the same terminus")
    args = ap.parse_args()

    source = json.loads(args.source_corridor.read_text(encoding="utf-8"))
    target = json.loads(args.target_corridor.read_text(encoding="utf-8"))
    src_stanmes = stanme_set_of(source)
    tgt_stanmes = stanme_set_of(target)
    src_first, src_last = endpoints_of(source)
    excluded = {t.strip().upper() for t in args.exclude_terminal.split(",")
                if t.strip()}
    ch_map = chainage_map_of(source)

    # Assemble the class-digit filter set. --classes (multi) takes
    # precedence; --class (singular) is a back-compat fallback.
    raw = args.classes or args.class_digit or ""
    class_digits = {d.strip() for d in raw.replace(",", " ").split()
                    if d.strip()}
    if not class_digits:
        raise SystemExit("--classes or --class required "
                         "(e.g. '4' or '4,6' or '1,2,4,6')")

    print(f"[divert] source ends: first={sorted(src_first)}  "
          f"last={sorted(src_last)}", flush=True)
    print(f"[divert] target stanmes: {len(tgt_stanmes)}", flush=True)
    print(f"[divert] class filter: {sorted(class_digits)}", flush=True)
    print(f"[divert] endpoint strictness: {args.endpoint_strictness}",
          flush=True)
    if excluded: print(f"[divert] excluded terminals: {sorted(excluded)}",
                       flush=True)
    if args.endpoint_strictness == "nearby":
        print(f"[divert] nearby: km={args.nearby_km}  "
              f"min_stations={args.min_nearby_stations}", flush=True)

    counts = {"DIVERTIBLE": 0, "TERMINATES": 0, "PARTIAL": 0,
              "CLASS_SKIP": 0}
    kept: list[dict] = []
    with args.source_summary.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            label, note = classify(row, class_digits,
                                   src_first, src_last, src_stanmes, tgt_stanmes,
                                   excluded, args.endpoint_strictness,
                                   ch_map=ch_map, nearby_km=args.nearby_km,
                                   min_nearby_stations=args.min_nearby_stations)
            counts[label] += 1
            if label == "DIVERTIBLE":
                kept.append({**row, "nearby_note": note})

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=DIVERTIBLE_FIELDS,
                            extrasaction="ignore")
        w.writeheader()
        w.writerows(kept)

    print(f"[divert] wrote {len(kept):,} divertible trains -> "
          f"{args.out.name}", flush=True)
    for k, v in counts.items():
        print(f"[divert]   {k:12} {v:>7,}", flush=True)
    nearby_n = sum(1 for r in kept if r.get("nearby_note"))
    print(f"[divert]   NEARBY_MATCHES  {nearby_n:>7,}", flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
