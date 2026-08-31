# Independent Browser QA — RECHECK #2 — ws1-market-capabilities

Sprint: sprint-2026-08-31-tools-normalization
Date: 2026-08-31 (~14:52–14:55Z)
Surface: http://localhost:3141/tools (operator's authenticated Chrome, own tab)
Runtime: landos:status healthy, single verified server, PID 115584, HTTP 200.

Repair under test: capability reuse is contract-version-scoped (capability_version filter; market capabilities at 1.1.0), so retained pre-repair 1.0.0 runs cannot be replayed.

## F1 / F4 — Loving County, TX Market Pulse (default mode, no refresh control) — PASS
Panel: "Growth: unknown — No county geography for Loving County, TX — growth not measurable yet." and "County $/acre: No comps with usable price-per-acre for Loving County yet." plus Data gaps lines. Absent: 30,188,424 population, ~29074 comps, $82,688/acre, "retained LandOS Market Research county record" attribution. Chip reads "Loving, TX · reused retained run"; DB (read-only) shows the reused run is a 1.1.0 post-repair invocation (14:49:23Z), not a 1.0.0 pre-repair row. Evidence: E8.

## F2 — Loving County, TX County Market Research (default) — PASS
Panel visibly contains "County Market Research: LandOS retains NO county-level market data for Loving, TX. The figures shown are TX statewide (all acreage) — a clearly wider basis, never a county fact." plus "Data gaps: No county-level snapshot is retained for Loving, TX; only the wider basis TX statewide (all acreage) exists." Statewide metrics carry the explicit label "SOLD · TX STATEWIDE (ALL ACREAGE)". Evidence: E8.

## Regression — Iredell County, NC — PASS
Market Pulse: growing +6.84%, pop 196,544, $50,591/acre median of 316 comps, county-record attribution intact. County Market Research: "SOLD · IREDELL COUNTY (ALL ACREAGE)", $50,591/acre, pop 196,544, growth 6.84%. Evidence: E9.

## Regression — ZIP 28115 — PASS
"SOLD · ZIP 28115 (ALL ACREAGE)": $74,864/acre, 202 DOM, pop 43,544. Evidence: E9.

## Hard refresh — PASS
Two Ctrl+Shift+R reloads: clean render, zero console errors, load-time network only /api/dashboard/settings, /api/chat/stream, /api/health — no capability invocations on load. Evidence: E9.

## DB adversarial check
landos_capability_invocation: this recheck produced only capability_version 1.1.0 rows (fresh Iredell 14:52:30/14:52:41Z, ZIP 14:53:08Z); retained 1.0.0 rows (14:11–14:31Z) exist but were not replayed. Version scoping confirmed effective end to end.

Screenshot substitution: screenshot capture timed out because the QA tab is a background tab in the operator's Chrome and capturing would require activating it; named page-text and network/console reads were recorded instead per contract section 5.

Findings retested: F1 pass, F2 pass, F4 pass (F3 previously closed). No new findings, none deferred.

Verdict: PASS.
