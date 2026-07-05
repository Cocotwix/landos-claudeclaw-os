# LandOS Operator QA Ledger

Purpose: preserve dashboard-visible acceptance results across Claude Code and
Codex sessions. Keep this concise and safe for the repo.

Do not store secrets, tokens, raw parcel reports, real seller details, APNs, or
private property work product here. When a real property is used, refer to it as
the current operator acceptance property and keep identifiers in
`store/landos.db` or local non-repo artifacts.

Operator QA is mandatory at the end of every implementation sprint after
engineering QA. Passing tests is never enough.

Ask:

> Would Tyler actually use this instead of the existing tool?

If no, continue improving unless an approval gate blocks progress.

## Current Operator QA Status

| Date | Scenario | Result | First Remaining Blocker | Next Exact Fix |
|---|---|---|---|---|
| 2026-07-04 | Dashboard-backed Property Card acceptance for the current operator acceptance property | Failing in real UI | Verified card existed in storage, but Tyler saw duplicate cards, stale Duke/LandPortal credit UI, and missing inspection/discovery sections in Property Board | Finish dashboard-visible Property Card workspace wiring, suppress weak duplicate, render persisted inspection/comps/market/discovery output, then rebuild/restart/verify real dashboard |

### 2026-07-04 - Land Score integrated into the Due Diligence / Property Report

- Dashboard DB/store: `store/landos.db` (real). Verified deal cards #1 (128.55 ac, thin LandPortal read) and #5 (1.03 ac, full LandPortal read).
- Build/server checked: `tsc --noEmit` clean; `vite build` clean (1828 modules); server `dist` recompiled (`tsc`). Live dashboard up on :3141.
- Browser route checked: report API `GET /api/landos/deal-cards/:id/report` on the live server now returns `landScore` for both verified cards. The frontend renders it inline via the new `LandScoreSection` (rebuilt into `dist/web`).
- Result: PASS at the view (GET) layer. Root bug fixed.
- Root cause found + fixed: the Land Score endpoint (and the report) did a FRESH `runDukeVerification` that fails to re-verify a parcel verified via a persisted browser read, so Land Score returned `null` for every "verified" property. Now Land Score is computed INSIDE the report from the same persisted verified property data, and the standalone route reuses the persisted verified card too. Result survives persist/reload (spread through `rowToView`).
- Operator-visible sections (report): Land Score now renders as a first-class section (score, verdict, confidence, 6-factor bar breakdown, loud data-gap flags). Verified card #1 → 15/100, #5 → 9/100.
- Honesty guard added: browser-verified parcels carry identity + acreage only (no enriched land facts), so 4 of 6 factors are data gaps and the raw rubric verdict is "PASS" (reject). The UI now detects `severely_reduced` confidence / ≥3 gaps and shows a neutral "Data-limited" badge + a caveat banner ("reflects incomplete enrichment, not a confirmed poor property; verify access/wetlands/flood/slope/valuation"), so the operator does not misread a data-starved parcel as a bad deal.
- First failure / limitation: the live SERVER PROCESS still runs the pre-fix `dist` in memory. GET surfaces `landScore` from persisted JSON, but a POST `/report/run` on the un-restarted process would recompute without it. `dist` is rebuilt; a service restart closes this. Restart of the primary ClaudeClaw service was NOT done unprompted.
- Classification: incomplete integration (now integrated) + stale build/server (restart pending).
- Files changed: `src/landos/deal-card-report.ts`, `src/landos/routes.ts`, `web/src/components/DealCard.tsx`, `src/landos/deal-card-report.test.ts` (+3 fixture files).
- Tests/builds: `deal-card-report` 24/24, `land-score` 6/6, full touched suite 60/60; typecheck + web build clean.
- Next exact task: (1) restart the ClaudeClaw service so the compiled server also computes `landScore` on `/report/run`; (2) wire the report's live gov-DD (FEMA/NWI/USGS) into the Land Score rubric so environmental factors are scored, not data gaps, for browser-verified parcels.
- What not to repeat: do not re-resolve a persisted-verified parcel from scratch; reuse persisted verified data (as the report does). Do not present a data-limited rubric verdict as a real pass/fail.

### 2026-07-04 - Service restart + POST/GET verification (closes restart gap)

- Restarted the primary ClaudeClaw/LandOS service (Tyler-authorized). Stopped PID 223240 (freed :3141); relaunched via the supervisor scheduled task `com.claudeclaw.main` → `start.bat` (idempotent port-guarded launcher). New process PID 235948 came up on :3141 in ~3s, serving the freshly compiled `dist`.
- POST `/api/landos/deal-cards/:id/report/run` now computes `landScore` INLINE on the compiled server: card #1 → 15/100, card #5 → 9/100 (6 factors, `severely_reduced`, no warnings). GET `/report` returns the same for both. POST and GET agree.
- Dashboard render: the SERVED `index.html` references the new bundle `assets/index-BiLG6Fy9.js` (HTTP 200), which contains the Land Score section markup, the neutral "Data-limited" badge, and the caveat banner. A dashboard reload renders the Land Score section correctly.
- Result: PASS on both POST and GET paths. Restart limitation closed.
- Classification: resolved (integration + build/server both live).

### 2026-07-04 - Approved-provider data correction: Land Score consumes LandPortal data

- Context: product-correction sprint. LandOS had drifted to legal-style verification and was treating approved provider data as missing. The Land Score was the clearest symptom.
- Root cause: the rubric read only `verification.propertyData.landFacts`, which is empty for a parcel verified via a persisted LandPortal browser read — so LandPortal's own returned road frontage, wetlands, FEMA, buildability, and valuation were IGNORED and scored as data gaps.
- Fix: `landFactsForScore()` now feeds the Land Score from approved-provider data the report already has — verified property data, then the LandPortal parcel fact sheet (road frontage, landlocked, wetlands %, FEMA %, buildability %, acreage, LP valuation), cross-checked by live gov-DD (FEMA/NWI verified "outside the hazard" → 0%). Gap-fill only; a value no approved provider gave stays an honest gap, never fabricated. Report + `/land-score` route both use it.
- Live result (restarted compiled server, PID 13724), POST and GET agree:
  - **Card #5 (full LandPortal read): 9/100 all-gaps → 77/100, verdict PURSUE, full confidence, 0 gaps.** Scores road frontage 16/20, wetlands 15/15, FEMA 15/15, buildability 10/10, size 9/15, valuation 12/25.
  - **Card #1 (thin LandPortal read): 15 → 50/100, reduced confidence.** Access 20/20 + wetlands 15/15 (NWI-verified) + size 15/15 now score; FEMA + buildability correctly STAY gaps (no approved provider returned them — never fabricated).
- Dashboard: served bundle `assets/index-BiLG6Fy9.js` (HTTP 200) renders the Land Score section; card #5 shows a real PURSUE verdict (not "Data-limited"). Reload verified.
- Engineering QA: typecheck clean; new `land-score-provider-data` 3/3, `deal-card-report` 24/24, `land-score` 6/6; full `src/landos` suite 1806/1807 (the 1 failure — `property-card.test.ts` weak-duplicate-merge — is PRE-EXISTING at commit 60c8378, confirmed by stashing my changes; unrelated to this sprint, I do not touch property-card.ts/db.ts). Web + server builds clean.
- Result: PASS. Classification: resolved.

### 2026-07-04 - USGS slope wired into the Buildability factor

- Change: `reconcileBuildability()` scores the Land Score Buildability factor from TWO approved-provider sources — LandPortal buildability % (direct usable-area measure) and USGS 3DEP average slope (converted from degrees to slope-percent). Thresholds (flatter is better): <5% strong (best), 5–10% workable, 10–15% reduced, ≥15% major concern. Both used: aligned → cross-checked note; materially different (≥25 pt gap) → scored on LandPortal (never ignored) with a loud conflict flag; USGS-only → fills a buildability the provider didn't return (no artificial gap). Report + `/land-score` route both apply it.
- Live (restarted compiled server, PID 226380), POST and GET agree:
  - **Card #1 (thin read, no LandPortal buildability): Buildability 0/10 gap → 8/10; total 50 → 58/100.** Basis "USGS avg slope 9.6% → ~70% usable (LandPortal buildability not returned)". Confirms buildability score changes where USGS data exists.
  - **Card #5 (full read): Buildability stays 10/10 on LandPortal 95.04%; total 77/100.** USGS avg slope 10.3% (~40% usable) materially disagrees → conflict flag surfaced ("scored on LandPortal, verify terrain"). Confirms LandPortal buildability still works and conflicts are shown.
- Dashboard: served bundle renders the Land Score section, each factor's basis (the Buildability source line), and Score flags (the conflict) — HTTP 200, reload verified.
- Engineering QA: typecheck clean; `land-score-provider-data` 8/8 (5 new slope tests), `deal-card-report` 24/24, `land-score` 6/6, report-consumer sweep 35/35. Web + server builds clean.
- Result: PASS. Classification: resolved.

## QA Entry Template

```markdown
### YYYY-MM-DD - <scenario>

- Dashboard DB/store:
- Build/server checked:
- Browser route checked:
- Result:
- Operator-visible sections:
  - Property Snapshot:
  - Inspection facts:
  - Visuals/screenshots:
  - Overlay results:
  - Comparable Intelligence:
  - Market Intelligence:
  - Discovery Call Intelligence:
  - Acquisition strategies:
  - Seller questions:
- First failure:
- Root cause:
- Classification: UI wiring | persistence | stale build/server | data-source | credential | incomplete integration | hard stop
- Files changed:
- Tests/builds:
- Reference artifacts:
- Next exact task:
- What not to repeat:
```
