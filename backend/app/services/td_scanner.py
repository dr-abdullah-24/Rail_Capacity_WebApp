"""Fast probe of an uploaded file to extract the set of dates present.

For TD JSONL we sample the file:
  - first 500 lines and last 500 lines are parsed in full
  - if the file is longer than 20 MB, additionally sample 500 lines from
    the middle (approx a third and two-thirds of the way through)

For a TD tbz2 archive (2018-era format) we open the tar in streaming
bz2 mode and sample the first few .td members - each member is a
newline-delimited JSON stream with CA/SF/CT messages whose 'time' field
is a millisecond epoch.

For an events CSV we scan the `date` (2018 schema) or `svc_date` column.
"""
from __future__ import annotations

import csv
import io
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path


def _ts_ms_to_date(ts_ms: int) -> str | None:
    if not ts_ms:
        return None
    try:
        return datetime.fromtimestamp(ts_ms / 1000,
                                       tz=timezone.utc).strftime("%Y-%m-%d")
    except (OSError, OverflowError, ValueError):
        return None


def _extract_dates_from_jsonl_line(line: str, out: set[str]) -> None:
    try:
        items = json.loads(line)
    except json.JSONDecodeError:
        return
    if not isinstance(items, list):
        return
    for item in items:
        for key in ("CA_MSG", "CB_MSG", "CC_MSG", "SF_MSG"):
            m = item.get(key) if isinstance(item, dict) else None
            if m is None:
                continue
            t = m.get("time")
            try:
                ts = int(t) if t else 0
            except ValueError:
                ts = 0
            d = _ts_ms_to_date(ts)
            if d:
                out.add(d)
            break   # one message per item envelope


def _scan_jsonl(path: Path) -> list[str]:
    size = path.stat().st_size
    dates: set[str] = set()
    # first 500 lines
    with path.open(encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i >= 500:
                break
            _extract_dates_from_jsonl_line(line, dates)
    # last 500 lines
    if size > 512 * 1024:
        with path.open("rb") as fh:
            fh.seek(max(0, size - 1024 * 1024))
            tail = fh.read().decode("utf-8", errors="replace")
        for line in tail.splitlines()[-500:]:
            _extract_dates_from_jsonl_line(line, dates)
    # middle sample for very large files
    if size > 20 * 1024 * 1024:
        for frac in (0.33, 0.66):
            with path.open("rb") as fh:
                fh.seek(int(size * frac))
                fh.readline()   # discard partial
                chunk = fh.read(512 * 1024).decode("utf-8", errors="replace")
            for line in chunk.splitlines()[:500]:
                _extract_dates_from_jsonl_line(line, dates)
    return sorted(dates)


def _scan_tbz2(path: Path, max_members: int = 6,
               max_lines_per_member: int = 400) -> list[str]:
    """Sample up to a handful of .td members and read their message
    timestamps to build the date set."""
    dates: set[str] = set()
    try:
        with tarfile.open(str(path), "r|bz2") as tar:
            members_seen = 0
            for m in tar:
                if members_seen >= max_members:
                    break
                if not m.isfile() or not m.name.endswith(".td"):
                    continue
                f = tar.extractfile(m)
                if f is None:
                    continue
                data = f.read()
                if not data:
                    continue
                members_seen += 1
                for i, raw in enumerate(data.splitlines()):
                    if i >= max_lines_per_member:
                        break
                    try:
                        line = raw.decode("utf-8", errors="replace").strip()
                    except Exception:
                        continue
                    _extract_dates_from_jsonl_line(line, dates)
                    if len(dates) >= 5:
                        # enough breadth already - stop pulling more
                        return sorted(dates)
    except tarfile.ReadError:
        return []
    return sorted(dates)


def _scan_csv(path: Path) -> list[str]:
    dates: set[str] = set()
    with path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
        rdr = csv.DictReader(fh)
        col = None
        for row in rdr:
            if col is None:
                col = "date" if "date" in row \
                      else "svc_date" if "svc_date" in row \
                      else None
                if col is None:
                    break
            v = (row.get(col) or "").strip()
            if v and len(v) >= 10:
                dates.add(v[:10])
    return sorted(dates)


def scan(path: Path, kind: str) -> list[str]:
    """kind = td_jsonl | td_tbz2 | events_csv | baseline_csv | ..."""
    if not path.exists():
        return []
    if kind == "td_jsonl":
        return _scan_jsonl(path)
    if kind == "td_tbz2":
        return _scan_tbz2(path)
    if kind in ("events_csv", "baseline_csv"):
        return _scan_csv(path)
    if kind == "freight_lines_json":
        # No dates; the tag was already provided at upload time
        return []
    return []
