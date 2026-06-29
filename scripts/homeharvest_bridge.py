#!/usr/bin/env python3
"""LandOS HomeHarvest bridge — open-source nationwide land/farm comp retrieval.

Reads a JSON request on stdin, runs HomeHarvest (Realtor.com scraper, MIT, no
API key), and writes a JSON response on stdout. Never raises to the caller: any
failure is reported as {"status": "error", "error": "..."} so the Node provider
can degrade honestly instead of crashing the DD report.

Request (stdin JSON):
  { "location": "166 Thamon Rd, Shelby, NC 28150",  # address | "City, ST" | ZIP | county
    "listing_type": ["sold", "for_sale"],            # which lanes to pull
    "property_type": ["land", "farm"],               # land focus
    "radius": 10.0,                                   # miles (address locations only)
    "past_days": 365,                                 # sold recency window
    "limit": 60 }

Response (stdout JSON):
  { "status": "collected" | "no_comps" | "error",
    "rows": [ { normalized comp fields } ],
    "count": N, "error": null }

Only the fields LandOS needs are emitted (never the full agent/office PII blob).
"""
import sys
import json
import math

try:
    import pandas as pd
except Exception:  # noqa: BLE001
    pd = None


# Normalized columns LandOS consumes. Everything else (agent/office/broker PII,
# photos, schools) is deliberately dropped at the boundary.
KEEP = [
    "property_url", "style", "status", "mls_status",
    "list_price", "sold_price", "last_sold_price",
    "list_date", "last_sold_date", "days_on_mls",
    "lot_sqft", "sqft", "year_built",
    "latitude", "longitude",
    "formatted_address", "full_street_line", "city", "state", "zip_code", "county",
    "text",
]


def _clean(v):
    """JSON-safe scalar. Handles numpy scalars (pandas), NaN/NaT/inf -> None,
    and pandas/py timestamps -> ISO string. numpy NaN is NOT a python float, so a
    bare isinstance(float) check misses it and json.dump would emit invalid NaN."""
    if v is None:
        return None
    # pandas-aware null check: catches NaN, NaT, None, and pd.NA (NAType), which
    # a bare `v != v` cannot (pd.NA != pd.NA returns pd.NA, not True).
    if pd is not None:
        try:
            if bool(pd.isna(v)):
                return None
        except (TypeError, ValueError):
            pass  # array-like / non-scalar: fall through
    # numpy/pandas scalar -> native python scalar (so NaN checks + json work)
    item = getattr(v, "item", None)
    if callable(item) and not isinstance(v, (str, bytes)):
        try:
            v = v.item()
        except Exception:
            pass
    # NaN / NaT are the only values not equal to themselves.
    try:
        if v != v:
            return None
    except Exception:
        pass
    if isinstance(v, float) and math.isinf(v):
        return None
    # pandas Timestamp / datetime -> ISO via isoformat when available
    iso = getattr(v, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:
            return str(v)
    return v


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        json.dump({"status": "error", "rows": [], "count": 0, "error": f"bad request json: {e}"}, sys.stdout)
        return 0

    location = (req.get("location") or "").strip()
    if not location:
        json.dump({"status": "error", "rows": [], "count": 0, "error": "no location"}, sys.stdout)
        return 0

    try:
        from homeharvest import scrape_property
    except Exception as e:  # noqa: BLE001
        json.dump({"status": "error", "rows": [], "count": 0, "error": f"homeharvest not importable: {e}"}, sys.stdout)
        return 0

    listing_type = req.get("listing_type") or ["sold", "for_sale"]
    property_type = req.get("property_type") or ["land", "farm"]
    radius = req.get("radius")
    past_days = req.get("past_days")
    limit = int(req.get("limit") or 60)

    all_rows = []
    errors = []
    # One call per listing_type so a failure in one lane (e.g. sold) does not lose
    # the other (e.g. for_sale). HomeHarvest accepts a list but per-lane isolation
    # is safer for honest partial results.
    for lt in (listing_type if isinstance(listing_type, list) else [listing_type]):
        kwargs = dict(location=location, listing_type=lt, property_type=property_type,
                      return_type="pandas", limit=limit)
        if radius is not None:
            kwargs["radius"] = float(radius)
        if past_days is not None and lt == "sold":
            kwargs["past_days"] = int(past_days)
        try:
            df = scrape_property(**kwargs)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{lt}: {e}")
            continue
        if df is None or len(df) == 0:
            continue
        cols = [c for c in KEEP if c in df.columns]
        for _, r in df[cols].iterrows():
            row = {c: _clean(r[c]) for c in cols}
            row["listing_type"] = lt
            all_rows.append(row)

    if not all_rows and errors:
        json.dump({"status": "error", "rows": [], "count": 0, "error": "; ".join(errors)}, sys.stdout)
        return 0
    status = "collected" if all_rows else "no_comps"
    json.dump({"status": status, "rows": all_rows, "count": len(all_rows),
               "error": ("; ".join(errors) if errors else None)}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
