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
