"""
Extract Engineering Allowances from all TPR PDFs in backend/data/TPR <year>/ folders.
Reads Section 5.5 (Timing Allowances) from each PDF and populates tpr_structured.json
with EA entries for every route code found.

Run from the backend directory:
    python scripts/extract_tpr_all.py
"""
import json
import re
from pathlib import Path

import pypdf

DATA_DIR  = Path(__file__).resolve().parents[1] / "data"
OUT_FILE  = DATA_DIR / "tpr_structured.json"

# ── regex patterns ────────────────────────────────────────────────────────────

# Route code header in Section 5.5, e.g. "NW1001 ARMITAGE JN (INCLUSIVE) TO..."
# Route names are printed in ALL CAPS in the TPR. Reject lines with lowercase
# letters so that route codes appearing mid-remark ("NW7007 and NW7009") are
# not mistaken for route headers.
RE_ROUTE = re.compile(r"^([A-Z]{2,3}\d{3,4})\s+([A-Z][^a-z\n]+)$", re.MULTILINE)

# Direction block header
RE_DIR   = re.compile(r"^(Down|Up)\b", re.IGNORECASE | re.MULTILINE)

# Table data row: "Approaching Colwich  E  1  1   remarks..."
# Columns: location | type (E/P) | FL/ML | SL | GL | remarks
# Column values are always a single digit (1 or 2). Multi-digit tokens (e.g.
# timing values like "0545") belong to the remarks column.
RE_ROW   = re.compile(
    r"^(Approaching\s+.+?)\s+"  # location
    r"(E|P)\s+"                 # type
    r"([12])?\s*"               # FL/ML value: only 1 or 2
    r"([12])?\s*"               # SL value
    r"([12])?\s*"               # GL value
    r"(.*?)$",                  # remarks
    re.MULTILINE,
)

# Section 5.5 header
RE_55    = re.compile(r"5\.5\s+Timing Allowances?", re.IGNORECASE)

# Table header row — skip it
RE_TBL_HDR = re.compile(r"^Location\s+Type", re.IGNORECASE | re.MULTILINE)


# ── helpers ───────────────────────────────────────────────────────────────────

def read_pages(pdf_path: Path) -> list[str]:
    reader = pypdf.PdfReader(str(pdf_path))
    pages = []
    for pg in reader.pages:
        pages.append(pg.extract_text() or "")
    return pages


def find_ea_pages(pages: list[str]) -> list[str]:
    """Return the subset of pages that form Section 5.5."""
    start = None
    for i, txt in enumerate(pages):
        if RE_55.search(txt) and start is None:
            start = i
    if start is None:
        return []
    # Take from 5.5 start to the end of the PDF (appendices follow)
    return pages[start:]


def parse_line_val(v: str | None) -> int | None:
    """Return integer from a matched column value, or None if blank."""
    if v and v.strip().isdigit():
        return int(v.strip())
    return None


def parse_ea_section(ea_pages: list[str]) -> dict[str, dict]:
    """
    Parse EA entries from the Section 5.5 page texts.
    Returns dict: {route_code: {name, ea: {Down: [...], Up: [...]}}}
    """
    # Join pages with a separator so we can do multi-line parsing
    full = "\n\n".join(ea_pages)

    # Remove table header rows
    full = RE_TBL_HDR.sub("", full)

    routes: dict[str, dict] = {}
    current_route: str | None = None
    current_dir: str | None   = None

    for line in full.splitlines():
        line = line.strip()
        if not line:
            continue

        # Route header?
        m_route = RE_ROUTE.match(line)
        if m_route:
            code = m_route.group(1)
            name = m_route.group(2).strip()
            # Tidy up name (collapse multiple spaces)
            name = re.sub(r"\s{2,}", " ", name)
            current_route = code
            current_dir   = None
            if code not in routes:
                routes[code] = {"name": name, "ea": {"Down": [], "Up": []}}
            continue

        # Direction block?
        m_dir = RE_DIR.match(line)
        if m_dir and current_route:
            raw = m_dir.group(1).capitalize()
            current_dir = raw  # "Down" or "Up"
            continue

        # EA/PA data row?
        m_row = RE_ROW.match(line)
        if m_row and current_route and current_dir:
            location = re.sub(r"^Approaching\s+", "", m_row.group(1).strip())
            ea_type  = m_row.group(2).upper()   # E or P
            fl_val   = parse_line_val(m_row.group(3))
            sl_val   = parse_line_val(m_row.group(4))
            gl_val   = parse_line_val(m_row.group(5))
            remarks  = m_row.group(6).strip()

            # Build one entry per line type that has a value
            line_map = {"FL/ML": fl_val, "SL": sl_val, "GL": gl_val}
            for line_type, val in line_map.items():
                if val is None:
                    continue
                entry = {
                    "location": location,
                    "line":     line_type,
                    "ea_min":   val if ea_type == "E" else 0,
                    "pa_min":   val if ea_type == "P" else 0,
                    "note":     remarks,
                }
                dir_key = current_dir  # "Down" or "Up"
                if dir_key in routes[current_route]["ea"]:
                    routes[current_route]["ea"][dir_key].append(entry)
            continue

    # Deduplicate: keep first occurrence of each (location, line, type) per direction.
    # Routes appear in multiple timing subsections (SX Daytime, SO, EWD etc.).
    for code, rdata in routes.items():
        for direction in ("Down", "Up"):
            seen: set[tuple] = set()
            deduped = []
            for entry in rdata["ea"][direction]:
                key = (entry["location"], entry["line"])
                if key not in seen:
                    seen.add(key)
                    deduped.append(entry)
            rdata["ea"][direction] = deduped

    return routes


# ── main ─────────────────────────────────────────────────────────────────────

def tpr_dirs() -> list[tuple[int, str, Path]]:
    """Return sorted list of (year, version+route, pdf_path) for all TPR PDFs."""
    results = []
    re_dir = re.compile(r"^TPR\s+(\d{4})$", re.IGNORECASE)
    re_pdf = re.compile(r"^TPR\s+(\d{4})\s+(V\d+)\s+([A-Z]+)\.pdf$", re.IGNORECASE)
    for d in sorted(DATA_DIR.iterdir()):
        if not d.is_dir() or not re_dir.match(d.name):
            continue
        year = int(re_dir.match(d.name).group(1))
        for pdf in sorted(d.glob("*.pdf")):
            m = re_pdf.match(pdf.name)
            if m:
                version = m.group(2)
                region  = m.group(3).upper()
                results.append((year, version, region, pdf))
    return results


def main():
    # Load existing manually-curated data (preserve srt_adjustments + loops)
    existing: dict = {}
    if OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text(encoding="utf-8"))

    # Result structure: {route_code: {name, description, sort_order, years: {year: {...}}}}
    merged: dict = dict(existing)

    for year, version, region, pdf_path in tpr_dirs():
        print(f"Processing {pdf_path.name} …")
        try:
            pages   = read_pages(pdf_path)
            ea_pgs  = find_ea_pages(pages)
            if not ea_pgs:
                print(f"  Section 5.5 not found, skipping.")
                continue
            routes = parse_ea_section(ea_pgs)
            print(f"  Found {len(routes)} route codes")

            year_str = str(year)
            ver_str  = f"{version} {region}"

            for code, data in routes.items():
                if code not in merged:
                    merged[code] = {
                        "name":        data["name"],
                        "description": "",
                        "sort_order":  999,
                        "years":       {},
                    }
                else:
                    # Update name from latest PDF
                    merged[code]["name"] = data["name"]

                if year_str not in merged[code]["years"]:
                    merged[code]["years"][year_str] = {
                        "version":         ver_str,
                        "ea":              {"Down": [], "Up": []},
                        "srt_adjustments": [],
                        "loops":           [],
                    }

                # Merge EA — replace extracted EA (keep existing srt/loops)
                merged[code]["years"][year_str]["version"] = ver_str
                merged[code]["years"][year_str]["ea"] = data["ea"]

        except Exception as e:
            print(f"  ERROR: {e}")

    # Sort each route's years descending
    for code in merged:
        merged[code]["years"] = dict(
            sorted(merged[code]["years"].items(), key=lambda x: x[0], reverse=True)
        )

    # Sort routes by code
    merged = dict(sorted(merged.items()))

    OUT_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(merged)} routes to {OUT_FILE}")


if __name__ == "__main__":
    main()
