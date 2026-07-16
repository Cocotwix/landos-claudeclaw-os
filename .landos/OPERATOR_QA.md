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

### 2026-07-12 - Visual-association fix: no imagery without parcel-association proof

- Root cause confirmed: card-15 Google captures (activity rows 181/191/200) were generated from the raw multi-APN intake string "APN-A and APN-B, <city> <state>" with sourceCoords null — Google geocoded the city and returned downtown/nearby-business imagery into correctly-named card-scoped files. A card-scoped filename was wrongly treated as association proof.
- Fix shipped (defense in depth, deterministic + tested): new `visual-eligibility.ts` model — every visual carries a VisualAssociation (target kind, card, APN, source coords, basis, capture query, frontage distance, eligibility) and `assessVisualAssociation` is the ONE decision. Eligible bases: verified parcel coords/centroid/geometry, APN LandPortal page, county GIS parcel page, parcel GE capture, frontage Street View ≤120 m, APN-visible screenshot. Raw intake text, multi-APN strings, city/county centroids, generic searches, nearby businesses, missing coords, cross-card inheritance, stale unresolved captures are never eligible; legacy association-less captures are never eligible.
- Layers enforcing it: capture (coords+basis REQUIRED; multi-APN/raw-address targets refused; Street View captured only when the pano stands ≤120 m from the parcel, aimed at it), persistence (superseded records skipped), eligible-only loaders in report build, report READ-time sanitizer (persisted report JSON re-proves each asset), /visual/image + /visual-intelligence(+image) routes, browser-vision analyzer input, VI gallery/hero sanitizer, HeroVisual/VisualContext UI. Hero priority now LandPortal → county GIS → verified GE/satellite → frontage Street View → NO image.
- Card 15 invalidated with audit trail (scripts/_invalidate_c15_visuals.mjs): 3 activity rows superseded (not deleted), report row 12 scrubbed (2 assets → excluded + note, 2 google inspection entries removed). Bad filenames verified ABSENT from the live report API, both image routes 404, absent from the DOM of all 7 tabs; 0 console errors. Overview hero = LandPortal parcel imagery (boundary visible).
- Orchestrator audit upgraded: imagery_association now validates SUBJECT association (eligible-set membership + cross-card + LandPortal parcel-page provenance), failure message "Displayed imagery could not be verified as belonging to the subject parcel." Card 15: 7/7 after cleanup (fail path unit-proven).
- Multi-parcel: new parcelRoster (report GET/run) + Property-tab Parcel A/B blocks — card 15 shows Parcel A resolved w/ verified imagery, Parcel B "Unresolved · awaiting parcel resolution" + exact next action; Parcel B inherits nothing.
- APN-as-ZIP fixed: `extractZipCandidate` (APN runs blanked, digit/hyphen-adjacent tokens rejected) used in discovery intake, market matrix, market-pulse; "ZIP: 07637" gone from the live Seller brief. Operator language cleanup: "Visual Signal, Not Verified Fact" chips replaced with Verified parcel image / Parcel image unavailable / excluded states.
- Tests: new visual-eligibility suite 25/25; updated visual-image-association, google-visual, visual-capture-persist, routes, deal-card-report, deal-card-audit, visual-intelligence, deal-card-ui suites. Full suite 2953 pass / 12 pre-existing fails (skill-registry 9, exfiltration-guard 2, property-card 1). tsc + vite clean. Restarted; QA shots in store/operator-qa-visual-assoc/.
- Remaining: fresh verified-coordinate Google capture for card 15 not auto-spent (operator can click Capture visuals — it now uses verified coords only); Parcel B needs Property Resolution; county GIS / GE live captures still need the authenticated browser session.

### 2026-07-09 - Deal Card trust sprint completion (memo Overview / canonical Property / Market scan / pursuit Strategy / orchestrator gate / conversational intake)

- Dashboard DB/store: real `store/landos.db`; live server rebuilt + restarted on `:3141` (fresh `dist`, start.bat). QA card: the current De Queen acceptance deal (card 15, two-parcel lead, parcel verified).
- Build/server checked: `vite build` + server `tsc` clean; full suite 2927 pass / 12 fail — all 12 PRE-EXISTING in `skill-registry` (9), `exfiltration-guard` (2), `property-card` weak-duplicate (1); none import this sprint's code.
- Browser route checked: Puppeteer opened `/landos?deal=15` live and screenshotted EVERY tab (`store/operator-qa-trust-sprint/`), 0 console errors, plus the conversational New Lead page.
- Result: PASS. Visually verified per tab:
  - **Overview** reads as an executive memo: Executive Summary FIRST (target $83,360–$125,040), "Executive review: 7/7 consistency checks passed" line, source-conflict banner with explanations, hero, key facts (owner/APN/acreage with sources), what-the-facts-mean, risks/unknowns, ONE valuation panel, best-5-of-94 comps, strategy snapshot, seller, next operator actions. Widget clutter (compact visual panel, market snapshot widget, collapsed spine) removed.
  - **Property** is the canonical parcel page: visual context + visual intelligence, verified parcel header, RECONCILED facts w/ conflict chips + per-fact source pills, at-a-glance (now reads the SAME reconciled primaries — fixed a live "Wetlands: Present vs None mapped" contradiction), Land Score 70/100, LandPortal imagery/observations, browser intel, official-records research, collapsed source-labeled facts + spine + manual DD worksheet. Multi-parcel Parcel A/B blocks render per property card with card-scoped imagery.
  - **Market** opens with "Should I want land here?", Market Pulse auto-runs (no buttons), Data Center Watch + growth signals auto-run (existence check; honest "Scan unavailable" under Gemini grounding quota; never cached as unavailable), ONE valuation, comp status. Fixed live: pulse county $/ac now quotes the SAME sold-band median as the valuation ($11,623/ac × 17 — was $3,318/ac × 3 then $15,076 × 46); MIXED market verdict recolored amber (was alarm-red).
  - **Strategy** answers ONE question: "Should I pursue this opportunity?" → Pursue with caution + attractive acquisition $83,360–$125,040 (40–60% of the one $208,400 basis), Quick Flip recommended + runner-ups w/ risks, remaining verification, confirm-before-offer. Fixed live: stale "$69,048" per-strategy pricing lines removed (single pricing story) and contradictory "Valuation not ready" blockers filtered once a primary valuation exists. "Can I buy this property?" framing replaced.
  - **Seller** now holds the Seller Call Brief (call prep, not strategy); its Estimated Market Value quotes the ONE valuation ($208,400 · sold comps) with comp-intel demoted to labeled supporting evidence.
  - **Orchestrator gate live-proven**: first GET flagged a REAL contradiction (DD checklist 17.67 ac vs reconciled 17.93 ac); fixed via read-time checklist harmonization; now 7/7. POST /report/run re-audits and auto-reruns once on repairable failures.
  - **Conversational intake live-proven over HTTP**: multi-turn conversation ("two parcels… seller says utilities… came from PPC" → parcels/county/state chips, seller-stated flagged needs-verification, Likely 83%, ready-to-run, raw turns preserved verbatim). Voice dictation (Web Speech) inserts into the same intake.
- First failure / limitation: Gemini google-search grounding is quota-limited on the free key (429) so Data Center Watch reports "unavailable" honestly and retries on next open; `gemini-2.5-flash` was retired by Google (404) — grounded + vision defaults moved to probed `gemini-3-flash-preview`. Second parcel of a multi-parcel lead is not yet persisted as its own property card (UI support exists).
- Classification: resolved (5 live contradictions found by the new audit/QA and fixed: checklist acreage, at-a-glance wetlands, pulse $/ac, strategy pricing, strategy blockers).
- Files changed: `deal-card-pursuit.ts` (+test), `deal-card-audit.ts` (+test), `market-scan.ts` (+test), `intake-conversation.ts` (+test), `deal-card-report.ts` (checklist harmonization), `routes.ts` (pursuit/orchestration/market-scan/conversation/pulse-harmonization), `db.ts` (landos_market_scan), `gemini.ts` (grounded), `browser-vision.ts` (model), `DealCard.tsx` (tab rebuild), `Acquire.tsx` (conversational+voice), tests updated.
- Next exact task: Tyler review of the live card; optionally enable a paid/grounded search tier for Data Center Watch; persist parcel B as its own card on multi-parcel leads.
- What not to repeat: never let a tab recompute its own number when a reconciled primary exists — every consumer reads the reconciliation/valuation objects.

### 2026-07-06 - LIVE Property Intelligence Operator QA

- Dashboard path used: real local dashboard on `:3141`, authenticated Browser Intelligence Chrome session, Deal Card action `Re-run Property Intelligence`. No direct DB-only shortcut and no paid LandPortal/comp/report action.
- First live run: the current unverified Lehigh Acres lead correctly remained data-limited. LandOS produced Google visuals and a readable report, but did not fabricate parcel identity, APN, owner, acreage, Land Score, or comps. This is a PASS for honesty but not the full acceptance case.
- Full acceptance run: reran the workflow from the Deal Card on an existing verified property card with LandPortal data and comps. Result: PASS with gaps.
- Visual QA evidence saved locally under `store/operator-qa-property-intel/`: `deal-5-after-run.png`, `property-board-after-run.png`, `deal-5-property-intelligence-report.pdf`, `deal-5-pdf-page-1.png`, `deal-5-pdf-last-page.png`, and `deal-5-qa-summary.json`.
- Deal Card visually verified: Property Intelligence Report section renders; `Re-run Property Intelligence` and `Download Report` are visible; Google satellite and Street View are visible; Market Pulse, Public Records Research, parcel overview, At-a-Glance facts, Land Score, strategy/discovery report sections, and LandPortal visual assets are present.
- Property Board visually verified: the verified property card shows `Inspection`, `7 visuals`, and `15 comps`, making the board scannable for operator triage.
- LandPortal screenshot QA: parcel page screenshot shows authenticated LandPortal, owner/APN/acres/frontage/landlocked fields, highlighted parcel, and safe sidebar controls. Wetlands/FEMA captures show environmental fields and 0 coverage. 3D terrain/comps-map capture shows the parcel outline and four visible sidebar comps. No paid comp/report purchase was triggered.
- Download QA: PDF downloaded successfully; file is a real PDF, 8 pages, 5 embedded images. Rendered page 1 contains the readable Property Intelligence Report and property facts; rendered last page contains the LandPortal comps-map screenshot.
- Engineering QA during live pass: `npm run build:server` clean; focused suites passed: `property-inspection`, `landportal-agentic`, and `deal-card-report` with `--testTimeout 20000`.
- Remaining operator gap: report is useful for pre-discovery/pre-offer triage, but still shows "complete with gaps" because official source evidence, title/access/utilities, and sold-comp support are not fully confirmed. This is correct for the current data, not a UI failure.

### 2026-07-06 - Property Intelligence Run wiring (Browser Agent completion pass)

- Scope: continued the existing Browser Agent / Property Inspection / Deal Card report workflow. No parallel feature or replacement report system added.
- Operator-facing changes: Deal Card now labels the one action as **Run Property Intelligence** / **Re-run Property Intelligence**, the section is **Property Intelligence Report**, and a **Download Report** action is available after a report exists. Acquire now says **Run Property Intelligence**.
- Browser route checked: focused non-watch tests passed exactly as requested: `npx vitest run src/landos/property-inspection.test.ts` (2/2) and `npx vitest run src/landos/landportal-agentic.test.ts` (2/2). Additional checks: `browser-session` 17/17, `browser-intelligence` 15/15, `deal-card-report` 25/25 with `--testTimeout 20000`.
- Build/server checked: `npm run build:server` clean; `npm run build:web` clean. The first broader report run hit Vitest's default 5s timeout on two slow report tests, but both passed isolated and the full report suite passed with a 20s timeout.
- Operator-visible sections expected from one Property Intelligence run: LandPortal parcel facts, overlay/terrain/comps screenshots where the live page exposes controls, Google visual context, comparable rows, Market Pulse, Land Score, strategy evaluation, 40-60% guidance when valuation exists, and the downloadable PDF/markdown report generated from the same current report object.
- Result: Engineering/operator-surface PASS for wiring and dashboard affordances. Manual live-property Operator QA still required: open dashboard, start the authenticated Browser Intelligence session, run a real property, and visually confirm LandPortal overlay captures, comps map extraction, Google visuals, Market Pulse, Strategy, Land Score, and the downloaded PDF contents.
- First remaining blocker: true LandPortal browser work requires Tyler's live authenticated Chrome session; this CC environment cannot log into LandPortal or visually validate a real property page.
- What not to repeat: do not declare full acceptance from tests alone; the final bar remains a real operator-run property and visual inspection of the report/download.

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

### 2026-07-05 - Property Board workspace-readiness summary (finished pre-existing work)

- Capability: each kanban card on the Property Board now shows at-a-glance badges — **Inspection · N visuals · N comps · N seller Qs** — so the operator can scan the board and see which properties already have real intelligence without opening each one. Backend `withPropertyWorkspaceSummary` decorates `GET /api/landos/board` (+ `/property-cards`); PropertyBoard.tsx renders the badges (with tooltips).
- Root defect found + fixed: the pre-existing backend summed asset/question counts across EVERY inspection re-run, inflating them (e.g. one card read **79 visuals / 48 seller questions** = ~4/2 counted ~10×). Rewrote it to read the CURRENT persisted state via `loadPropertyInspection` (latest, deduped) + `loadCardVisualCapture`, and comp count from `landos_comp`. Presence is a robust existence check (survives a malformed latest ref). No fabrication; a card with no data reads 0/false.
- Live (restarted compiled server, PID 227796) `GET /board`: card #1 inspection·10 visuals·0 comps·0 sellerQ; card #2 ·10·0·6; card #3 ·4·15·2; card #5 ·4·14·2 (card #4 correctly suppressed as a weak duplicate). Honest, no inflation.
- Dashboard: served bundle `assets/index-CvaSoLTa.js` (HTTP 200) renders the badges + tooltips. Reload verified.
- Engineering QA: typecheck clean; new `property-workspace-summary` 4/4; route/board sweep 101/101; full `src/landos` 1815/1816 (the 1 failure is the PRE-EXISTING `property-card` weak-duplicate-merge test, unrelated). Web + server builds clean.
- Result: PASS. Classification: resolved (feature finished + made honest + operator-visible).

### 2026-07-05 - VISUAL Operator QA: Acquire → Deal Card → Report (root-cause fixes)

- New capability: visual Operator QA is now real. Puppeteer (bundled Chrome) opens the live dashboard, screenshots the Deal Card, and the screenshot is read back like an operator would see it. Backend payloads/tests are no longer the acceptance bar.
- Deep-link added: `/landos?deal=<id>` opens a Deal Card directly (linkable + deterministic QA).
- ROOT CAUSE (found visually, invisible to backend tests): the ENTIRE rich report block failed to render. `DiscoveryCallReportSection` called `dashboardToken()` but `dashboardToken` is a const value, not a function → TypeError crashed the block. The backend report was complete; the UI threw and rendered nothing (no At-a-Glance, Land Score, comps, visuals, discovery). This is exactly why the operator saw a Deal Card "missing too much." Fixed (use the value).
- Second bug: the Discovery "Property Snapshot" read wrong LandPortal keys (`'Buildability'` → Building SqFt = 0) and read FEMA/Wetlands/Slope from overlays that don't exist → showed Buildability 0 / FEMA Not Found / Wetlands Not Found / Slope Not Found while the rest of the card had the real values (contradictory panels). Fixed to read the parsed `factSheet` (Buildability 95.04%, FEMA "Not in a flood hazard area · coverage 0%", Wetlands 0%, Slope 6.13%).
- Third fix: report header showed a 7-deep nested `(orig: (orig: ...))` verification-source from repeated re-runs. Now unwrapped to one level.
- VISUALLY CONFIRMED on a verified card (screenshots in gitignored `store/`: _dc5_before crash, _dc5_after rendered, _dc5_atglance, _dc5_visual): At a Glance (slope ~5.9° from USGS, flood Zone X, wetlands); Land Score 77/100 PURSUE with all six factor bars + the LandPortal-vs-USGS buildability conflict flag; Seller Call Brief; Property Snapshot (road frontage 166 ft, landlocked No, buildability 95%, FEMA 0%, wetlands 0%, slope 6.13%); Comparable Intelligence (~$11.9k est.); Market Pulse; Strategy; Next Action; and Google Visual Context showing REAL satellite + Street View images.
- Fresh Acquire lead run end-to-end (deal 8, "matched, not parcel-verified"): renders with no crash; gov-DD slope 4.2° + FEMA + NWI verified; Google satellite/Street View captured; demographics + Market Pulse. Land Score correctly NULL (never scored from unverified). Parcel facts thin (area context) — see limitations.
- Discovery-ready: YES for the verified card. Offer-ready: NO (no sold comps — paid comp credits gated; valuation is asking-market only; access/title/utilities unconfirmed).
- Screenshots captured (NOT committed — contain a real property/owner): store/_dc5_before.png, _dc5_after.png, _dc5_atglance.png, _dc5_visual.png, _dc8.png.
- Engineering QA: server tsc clean; `deal-card-report` + `land-score-provider-data` 33/33 (incl. new source-unwrap test); web + server builds clean; my web files (DealCard/LandOS) typecheck clean. Restarted; 0 browser console errors on the Deal Card.
- Result: PASS for making the report operator-visible/usable. Classification: resolved (2 render bugs + 1 data-label bug).

### 2026-07-05 - Per-field selector capture (teach fields by voice → Deal Card facts)

- Dashboard DB/store: new `landos_training_field_binding` table (session_id, field, selector, label, sample_value, confidence, strategy; UNIQUE per session+field). `ExtractedField` gained confidence + strategy.
- Build/server checked: server tsc clean; `vite build` clean; "Learned fields" panel + the binding hint copy ("this is the road frontage") confirmed present in the production bundle.
- Browser route checked: live capture flows over `/ws/landos/training` (`field_binding` message + auto-capture when operator speech matches a field phrase → `field_binding_captured` back to the client). Synthesis attaches `body.fieldSelectors`; execution extracts + (live) writes them back — verified end to end in tests through the store + fake CDP page, and the execute HTTP path in the smoke test.
- Operator-visible: LIVE view now shows a "Learned fields" panel (field → selector/label + confidence colour) that fills as Tyler names fields; the draft-review shows a "Learned fields (n)" section; execution results already list extracted fields + how many were written to the Deal Card.
- LandPortal fields supported (aliases): owner, APN, acreage, road frontage, landlocked, wetlands, FEMA/flood, buildability, slope, valuation, sidebar counts.
- Selector strategy + confidence: provided/click selector or data-testid or stable id → high; real observed label anchor → medium; generic label fallback → low; framework/generated ids rejected (`isStableId`). Extraction is selector-first with a label-match fallback so a changed selector still resolves.
- Safety re-verified: paid step still stops before any extraction/writeback (status blocked, approvalRequired, 0 fields written, 0 facts); dry-run extracts but writes nothing to the Deal Card; capture + extraction scripts are read-only (no clicks/typing, never touch cookies/storage).
- Tests: `field-binding` 13/13 (phrase→field incl. no-false-positive, selector priority/confidence, fallback, script builders), `field-binding-capture` 9/9 (probe/label-search/label-only capture, re-bind, synthesis attaches selectors, selector + label-fallback extraction, live writeback confidence, dry-run no-write, paid-block). Full suite 2579 passing; same 3 pre-existing unrelated failing files.
- Live limit: DOM-based binding + live extraction need the operator's authenticated Chrome (BROWSER_INTEL_LIVE); without it, capture still stores a label-only binding usable via runtime label matching. Recorded in KNOWN_LIMITATIONS.
- Classification: integration complete for capture + extraction + writeback + safety; a real live LandPortal session is the remaining manual acceptance.
- Next exact task: run a real live LandPortal Map Search from the operator browser, bind the 11 fields by voice, then dry-run + live-run and confirm facts land on the Deal Card.

### 2026-07-05 - Trained playbooks executable by the Browser Agent (Dry run / Run live)

- Dashboard DB/store: new `landos_training_execution` table (status, mode, screenshots, extracted fields, blocked actions, errors, QA notes, deal_card_id, agent_run_id). Verified via store round-trip tests.
- Build/server checked: server tsc clean; `vite build` clean; "Run live" action string present in the production bundle (`dist/web/assets/index-*.js`).
- Browser route checked: `POST /api/landos/training/playbooks/:id/execute` (dry_run/live) + `GET .../executions`. Exercised through the real Hono app (`buildDashboardApp`) in `browser-training.smoke.test.ts`.
- Result: PASS (endpoint + safety + storage). The Browser Training page now renders Dry run / Run live buttons on each APPROVED playbook (drafts show "Approve to make executable") and an inline execution-result panel (status, extracted fields + fields-written-to-Deal-Card, screenshot count, blocked actions with Approval-Required banner, QA notes).
- Safety verified (unit + HTTP):
  - Approved-only: executing a DRAFT returns 400 "only approved playbooks can be executed"; no browser action, no result row.
  - Paid-action stop: a "Buy Report" click / `/checkout` URL step stops immediately, status=blocked, approvalRequired=true, a `landos_approval` row is created, no fields written. Blocks even in dry-run.
  - Dry-run non-mutating: navigation + screenshots + field reads only; 0 clicks, 0 typing, no Deal Card writeback.
  - Scope audit: a step navigating off the playbook's declared host stops with an "off-scope" error (rogue step URLs do NOT self-authorize).
- Deal Card writeback: LIVE mode + linked Deal Card writes captured facts via `writeBrowserFact` (origin landportal, status extracted, extractionMethod "trained playbook: <slug> v<n>"); dry-run writes nothing. Verified with `listBrowserFacts`.
- Live browser limit: headless CC env has `BROWSER_INTEL_LIVE=0`, so a live run here returns honest `not_configured` (nothing fabricated). True live LandPortal replay must be driven from Tyler's authenticated Chrome — recorded in KNOWN_LIMITATIONS.
- Tests: `trained-playbook-runner` 9/9, `browser-training.smoke` 3/3, `browser-training` 20/20. Full suite: 2557 passing; the only 3 failing files (skill-registry, exfiltration-guard, property-card) are pre-existing and unrelated (don't import training code).
- Classification: UI wiring + persistence + integration — complete for dry-run + safety; live LandPortal replay pending operator Chrome.
- Next exact task: capture per-field selectors during training so extraction populates automatically, then run a real live LandPortal Map Search from the operator browser.

### 2026-07-05 - Runtime wiring fix: Browser Training usage 404 (stale server build)

- Symptom: `/browser-training` loaded but immediately showed `GET /api/landos/training/usage failed: 404`.
- Root cause: NOT a routing bug. The route exists in source (`routes.ts` `app.get('/api/landos/training/usage')`) and `registerLandosRoutes` is mounted (`dashboard.ts:4016`). The RUNNING service was `node dist\index.js` (PID 218872) built from a STALE `dist` dated Jul 5 02:13 — before this sprint's training work — so the compiled server had no training routes. Confirmed: running server returned 404 for training/usage but 200 for the older browser-agent/status. There is no prod hot-reload; `dist` must be rebuilt and the service restarted after route changes.
- Fix: `npm run build` (vite + tsc) → `dist/landos/routes.js` recompiled (17:03) and now contains `training/usage` + all training modules. Killed the stale listener on :3141 and started a fresh detached `node dist/index.js` (PID 45932) with the same `logs/start-*.log` redirection as start.bat.
- Verified LIVE on :3141 (post-restart): `/browser-training` SPA 200; training/usage 200 (real body: gemini model, today/week/month/lifetime + playbooksCreated); training/sessions 200; training/playbooks 200; training/knowledge 200. WS bridge registered — log line "Browser Training WebSocket active at /ws/landos/training" (PID 45932) in both start-out.log and main.log.
- Backend session flow exercised live (API): created a test session (id 1), a normal nav event recorded (approvalRequired=false), a paid "Buy Report" click STOPPED by the guard (approvalRequired=true, "Stopped — Approval Required", session→paused), GET session returned status=paused/approvalRequired=true/3 events, and `/end` synthesized a draft playbook (Gemini reachable on the live key). The 404 is gone.
- Next failure (expected, not a bug): the actual voice/screen loop (getDisplayMedia + mic + Gemini Live WebSocket) can only be exercised from a real browser with mic + screen share — headless API/CLI can't drive it. That is the remaining manual acceptance.
- QA residue in the LIVE landos.db: one ended test session + one `qa_runtime_wiring_test` DRAFT playbook (drafts cannot execute; harmless). Usage now shows 1 lifetime session / 1 playbook. Tyler may delete if he wants a clean counter (no delete endpoint yet; would need a direct DB op).
- Classification: stale build/server (resolved by rebuild + restart). Files changed this step: none (source already correct); only `dist` rebuilt + service restarted.

### 2026-07-06 - Live session made obviously-working (silent-session acceptance failure)

- Symptom (operator acceptance): Tyler clicked Start Training, shared screen, talked, clicked through LandPortal — LandOS never talked back, never showed it was listening, no transcript, no confirmation. Silent run = fail.
- ROOT CAUSE (found via `scripts/_live_probe.mjs` + `_live_ws_probe.mjs`): the configured Live model id `gemini-2.5-flash-preview-native-audio-dialog` (and `gemini-2.0-flash-live-001`, `gemini-live-2.5-flash-preview`) are "not found for API version v1beta / not supported for bidiGenerateContent" on THIS project's Google key. The socket opened then immediately closed — so nothing was ever spoken. Only `gemini-2.5-flash-native-audio-preview-09-2025` stays open and streams audio+transcript on this key. Fixed `GEMINI_LIVE_MODEL` to that id. Secondary: the bridge never greeted (native-audio models stay silent until prompted) and the UI surfaced none of the subsystem state.
- Fixes: (1) correct Live model; (2) backend triggers a spoken greeting ~500ms after connect ("I can see your screen now. Please walk me through the workflow."); (3) backend surfaces the EXACT failure reason (errText) on connect-fail / model-error / close; (4) full operator-visible LiveView — the 15 required states: screen-share, mic, WebSocket, Live-AI (with reason), recording, live audio METER (WebAudio analyser), live transcript (Gemini + local Web-Speech fallback), AI response text + "speaking…" indicator, live SCREEN PREVIEW (video element), captured steps, learned fields, Pause/Stop/End buttons, and LOUD red/amber banners ("Microphone not connected.", "Live AI not connected: <reason>", screen-active-but-no-audio). Review screen now shows transcript + captured steps + screenshots/frames + learned fields + draft playbook + extracted knowledge.
- VERIFIED LIVE on localhost:3141 (real Gemini):
  - In-process bridge probe (`_live_bridge_probe.mjs`): greeting transcript "I can see your screen now. Please walk me through the workflow." + 65 ai_audio chunks + 8 transcript msgs forwarded.
  - Through the real dashboard WebSocket (`/ws/landos/training`): statuses connecting→live→greeting_sent, then 72 ai_audio chunks + transcript + usage delivered to the client. i.e. the operator would HEAR LandOS greet within ~2s.
  - Model probe: only `gemini-2.5-flash-native-audio-preview-09-2025` returns audio; others close with "not found for API version".
  - New UI strings confirmed in the production bundle ("What LandOS sees", "Live AI not connected", "Microphone not connected", "Audio input").
- Tests: new `browser-training-live` 4/4 (errText, connect-fail reason, no-key reason, greeting-fires-with-audio). Training suite 58/58. Full suite 2583 passing; same 3 pre-existing unrelated failures.
- Honest remaining gap: I cannot operate a real mic/screen headlessly, so the two-way loop where LandOS responds to TYLER'S speech (not just the greeting) needs Tyler at the keyboard; the greeting + audio-out + transcript pipeline is proven. Also the Google key appears to allow limited concurrent Live sessions — back-to-back probe runs occasionally returned 0 audio (transient throttle), single sessions work.
- Classification: provider misconfig (wrong model id) + missing greeting + missing operator-visible UI — all fixed and live-verified. Service rebuilt + restarted (PID 235916).

### 2026-07-06 - Live session made USEFUL: latency, steps, screenshots, transcript, narrated playbook

- Second real acceptance (Tyler ran LandPortal): AI connected + spoke, but ~20s latency, 0 captured steps, 0 learned fields, 380 frames/0 screenshots, playbook "No browser steps captured", transcript fragmented into one-word turns.
- Root truth: a `getDisplayMedia` screen-share of Tyler's OWN tab gives pixels, not DOM — there is NO CDP/browser-event access to that tab, so steps/fields/screenshots-via-CDP were always going to be 0. Fixed by owning that honestly + capturing visually.
- Fixes shipped:
  1. LATENCY — frames were streamed at a constant 1/sec (380 in ~6min), flooding the model. Now the client sends a frame ONLY on material change (8×8 grayscale signature diff) or a 6s heartbeat, JPEG quality 0.55. Cuts frame volume ~5-10×. Latency estimate (operator-utterance-end → first AI audio) is shown live.
  2. SCREENSHOTS — captured CLIENT-side from the same shared-frame canvas: a start-of-session shot, on voice cue ("take screenshot"/"this is important"), and on material page change (rate-limited). Sent over WS, saved to `store/training-shots/<session>` (gitignored, 0600), recorded as screenshot events. Live "Screenshots saved" count. VERIFIED live: `screenshot_saved count=1`.
  3. BROWSER EVENTS — a `browser_events {connected:false, reason}` message + a loud "Browser events not connected" banner explaining the shared tab has no DOM. Never a silent 0.
  4. TRANSCRIPT — backend `makeTranscriptCoalescer` merges Gemini's word-shards into whole utterances (flush on turnComplete / speaker-change / 1.4s pause); records ONE speech event per utterance; client shows a live partial + finalized turns. VERIFIED live: the greeting arrived as ONE sentence, not shards.
  5. FIELD LEARNING — voice-named fields bind label-only (shared tab has no DOM) with a visible "learned by name; selector needs confirmation" note; no longer probes the wrong LandOS Chrome.
  6. PLAYBOOK — never empty now: if no DOM events but transcript/screenshots exist, synthesis builds a VISUAL/NARRATED workflow (narrated action steps from utterances + screenshot anchors), sets `captureMode='visual_narrated'` + `needsSelectorConfirmation=true` + a plain-English `learningSummary` ("built from N spoken instructions + M screenshots… needs one CDP pass to confirm selectors"). Review screen shows this banner.
  7. STATUS — added Screenshots-saved, Browser-events, Steps/Fields counts, Frames-sent, and Latency estimate to the live status strip.
- VERIFIED LIVE on localhost:3141 (real Gemini) via `scripts/_live_ws_probe.mjs`: statuses connecting→live→greeting_sent; 87 ai_audio chunks; transcript FINALS = 1 full sentence (coalesced); browser_events connected=false + reason; screenshot_saved count=1. New UI strings confirmed in the production bundle.
- Tests: `browser-training-live` 6/6 (adds transcript coalescing incl. speaker-switch flush), `browser-training` 21/21 (adds visual/narrated synthesis: nonzero steps, captureMode, needsSelectorConfirmation, shard-dropping). Full suite 2585 passing; same 3 pre-existing unrelated failing files.
- Remaining (can't be headless-verified): true end-to-end LATENCY under a real screen-share, and DOM-accurate steps/selectors (needs a CDP training mode against the LandOS-driven Chrome, not a screen-share). QA residue: probe test sessions + `store/training-shots` images in the live store (gitignored).
- Classification: architecture (no DOM on shared tab) owned honestly + quality fixes (frames/screenshots/transcript/synthesis) — live-verified. Rebuilt + restarted.

### 2026-07-06 - Property Resolution identity gate (correct workflow ordering)

- Dashboard DB/store: real `store/landos.db` on `:3141` (rebuilt server + web, restarted PID from fresh `dist`). Live acquire pipeline exercised via `POST /api/landos/acquire/run` with the dashboard token.
- Business problem fixed: downstream Property Intelligence was starting before the parcel was confidently identified — a lead reaching confidence 0.7 purely from the operator's own echoed APN + county + road name auto-ran full Property Intelligence/comps/Market Pulse. Now Property Resolution is a MANDATORY GATE.
- Change: new `parcelIdentityEstablished()` predicate — identity is established ONLY when (1) a named source verified the parcel, (2) the Browser Agent read the parcel on LandPortal (APN + jurisdiction + source URL), or (3) ≥2 independent lanes corroborate identity, or (4) a full house-numbered street address was geocoded to a point in a known county/state. The acquire route now runs Property Inspection + Deal Card report ONLY when `identityEstablished`; otherwise it creates the lead card + public-records research plan and returns `status: resolution_pending` with downstream on hold. Browser Agent also now retries the ALTERNATE APN format before falling back to owner.
- LIVE acceptance (Scott County TN example: "County: Scott County, Tennessee / Location: Henson Lane, near Oneida, near Helenwood / Parcel ID: 094-020.08 / Alternate Parcel ID: 094 02008 000"):
  - Resolved to a RESEARCH card (confidence 0.4, parcelVerified false). Downstream Property Intelligence did NOT run. Deal Card #9 created as an unverified lead.
  - Browser Agent searched LandPortal by APN `094-020.08` (12 candidates, no confident match) THEN by alternate `094 02008 000` (3 candidates) — the alternate-APN retry fired live. No weak-match, no fabricated facts.
  - County Records lane retrieved 4 official sources (assessor, tax, recorder, GIS) + 3 public-record facts with provenance.
- Self-validation battery (messy inputs, live):
  - County only ("Scott County, Tennessee") → research_card, conf 0.2, no downstream. Card #10.
  - APN only ("APN 094-020.08") → research_card, conf 0.2, no downstream. Card #11.
  - Partial address ("Henson Lane, Oneida, TN") → matched conf 0.7 BUT `identityEstablished:false` → NEW gate → `status: resolution_pending`, downstream held. Card #12, geography TN/Scott, kanban `needs_parcel_verification`.
- Visual QA: `store/operator-qa-resolution/property-board-gate.png`. Property Board shows the gated Scott County / road-name / APN-only / county-only leads in the **Needs Parcel Verification** column, all marked **unverified** with correct geography (Scott, TN) and NO parcel-verified comps; pre-existing verified cards (Gilstrap, Lehigh Acres, Jackson Gap) retain full Inspection/comps/seller-Qs in **Researching**.
- Engineering QA: `tsc` clean (server); web build clean; `property-resolution-engine` 14/14 (5 new gate tests incl. Scott-County-not-established, geocoded-address-established, browser-confirmed-established, 2-lane-corroboration), plus landportal-agentic/browser-intelligence/comparable-intelligence/market-pulse/acquisitions 60/60 and deal-card-report/intake/smart-intake/property-inspection/comp 86/86. No regressions.
- First remaining blocker: I cannot complete a live authenticated LandPortal parcel confirmation for the Scott County APN headlessly (geocoders returned nothing for the house-number-less road; LandPortal APN search found candidates but no confident match without the operator's logged-in map session). The continuous "Browser Agent reaches the Scott County parcel → auto-runs the full pipeline" acceptance is Tyler's live step. What is proven headlessly: correct ORDERING/GATING, the alternate-APN search, correct geography, and downstream withheld until confirmation.
- What not to repeat: do not let a lead reach downstream on echoed operator input alone; a populated Deal Card must mean the parcel was actually confirmed.

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

### 2026-07-13 - LandOS-wide Deal Card canonical reconciliation sprint (PASS, live-verified)

- Shared architecture shipped (no property-specific hardcoding): unique comparable
  registry (`comp-registry.ts` — property+transaction dedup, wrong-market/no-price
  validation, provider coverage, rejection audit), document asset registry + county
  deed page viewer (`document-registry.ts` + `/document-page/:file` route + full-screen
  zoom/page-nav viewer), strategy-readiness record (`strategy-readiness.ts` — exactly
  the 5 approved strategies, blocked/provisional/viable/weak/not-viable, shared
  pricing gate), research-mission model (`research-mission.ts` — accepted/rejected/
  superseded/failed/pending classification + grouped repeats), canonical assembler +
  in-place idempotent Reconcile action (`deal-card-canonical.ts`, model v2).
- Pricing gate CLOSED by default: pursuit shows NO attractive band, winner, or
  runner-up until ≥3 validated unique sold comps + no valuation conflict + resolved
  acreage. The acceptance card's one-comp "$60k–$91k attractive band" is gone; the
  card now answers "Not priceable yet — one observation is not a market."
- Consistency audit expanded 7 → 17 checks (one-comp pricing, registry-vs-display
  counts, wetlands/FEMA cross-tab agreement, acreage-conflict preservation, five
  approved strategies, pricing-gate agreement, documents viewable, Land Score
  currency, blocked-offer agreement, unsafe-language screen). The new audit CAUGHT
  two real live contradictions (collapsed acreage conflict, checklist quoting the
  assessed number) which were then fixed at the projection layer — 17/17 now passes
  on the acceptance card by fixing data, not by loosening checks.
- Land Score rebuilt from the reconciled operator record (per-factor accepted-evidence
  basis, conflict-capped confidence) at read time whenever a public-intelligence run
  exists; unavailable-with-reason otherwise. Owner text: raw official value preserved
  verbatim + clean working label + explicit malformed/trust warnings.
- Seller tab: Call Guardrails panel (no value/offer/PPA/strategy quoting while gated);
  Estimated Market Value line gated; discovery headline gated.
- Migration: read-time projection applies the new model to EVERY existing card
  automatically; the Reconcile Deal Card button (model-version chip) revalidates
  persisted rows in place — acceptance card run 1 fixed 1 wrong-market row, run 2
  no-op; extra existing card run fixed 8 rows; deal count unchanged (no duplicates);
  CRM/seller data untouched.
- Live visual QA (Puppeteer, real dashboard, all 9 tabs, 0 console errors): CRM
  header w/ cyan parcel outline + acreage CONFLICT + owner warnings; Strategy tab 5
  blocked strategies + "Pricing gated — no offer numbers yet"; Market tab unique-comp
  registry (27 candidates → 11 unique, 1 sold / 10 active validated, 16 rejected w/
  reasons, per-provider coverage); Documents tab actual 7-page county deed viewer
  (full-screen, zoom, prev/next) + 6 findings + 5 open research tasks (survey = the
  only Tyler item); Activity mission view (reconcile=Accepted, history grouped);
  county $/acre tile refuses a 1-sale figure. TN safety control unchanged: resolution
  view, downstream on hold; new-workflow test card (deal 18) gated as research card
  with all 5 strategies blocked and idempotent reconcile.
- Screenshots: `store/operator-qa-canonical/` (14-overview/strategy/market/
  market-comp-registry/seller-guardrails/documents/deed-viewer-fullscreen/activity-
  mission, 11-*, 16-tn-control*, 18-new-test-card).
- Engineering QA: typecheck clean; suite 3098 pass / 12 pre-existing fails
  (skill-registry, exfiltration-guard, property-card — unchanged set); vite+tsc
  build clean; canonical runtime restart; git diff --check clean. Not committed.
