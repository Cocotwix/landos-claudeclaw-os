# Independent browser QA recheck — ws1-market-capabilities

Date: 2026-08-31. Runtime: single healthy verified server (PID 276116, port 3141, HTTP 200). Journey run live at http://localhost:3141/tools in operator Chrome (authenticated).

- Iredell County, NC — Market Pulse: real county figures, "LOCAL AREA CONTEXT, NOT PARCEL VERIFIED", +6.84% growth on 196,544 population, $50,591/acre over 316 comps. County Market Research: "SOLD · IREDELL COUNTY (ALL ACREAGE)". No regression.
- ZIP 28115 — ZIP Market Research: "SOLD · ZIP 28115 (ALL ACREAGE) Price per Acre: $74,864". No raw "Failed to fetch" appeared anywhere in the session. F3 PASS (operator message shipped: web/src/pages/Tools.tsx:15, string present in served bundle index-CrM1aamM.js).
- Loving County, TX — Market Pulse: F1 RETEST FAIL. Panel replays pre-repair narrative via "reused retained run": "$82,688/acre in the county (median of 29074 comps)", "population of 30,188,424, from the retained LandOS Market Research county record (2026-Q3)".
- Loving County, TX — County Market Research: F2 RETEST FAIL. "SOLD · TX STATEWIDE (ALL ACREAGE)" with no "LandOS retains NO county-level market data for Loving, TX" sentence and no Data gaps line; "reused retained run".
- Negative case: "28115" + Run Market Pulse renders "A county (with state) or county FIPS is required." (invoke -> 400). PASS.
- Hard refresh x2: clean render, zero console errors, only /tools, assets, /api/dashboard/settings, /api/chat/stream, /api/health on load; no capability invocations fired. PASS.

Root cause of F1/F2 recheck failure (new finding): Tools market invoke routes use mode 'reuse'; retained runs recorded before the repair are replayed verbatim and are never invalidated when the capability's narrative contract changes (contractVersion still 1.0.0). The repaired code in src/landos/market-geography-capabilities.ts is correct but unreachable for any geography holding a pre-repair retained run.

Verdict: FAIL (recheck). Evidence: E5, E6, E7.
