# Current Active Task
Awaiting instruction. The retained-parcel-URL fast path and the subject-lane handoff are fixed and verified live; gaps 3 and 4 are untouched.

# Exact Operator Outcome
A new lead's LandPortal fields and visuals appear in the lead card in about a minute instead of ~18, with Hermes invoked only for items the deterministic path could not complete.

# Current State


<!-- DERIVED:START -->
- **Generated:** 2026-08-14T03:47:35.725Z
- **HEAD at generation:** `f178eb7`
- **Worktree:** DIRTY; 128 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS with one pre-existing unrelated failure at 2026-08-13T16:45:00.0000000Z; Full vitest run: 450 files, 6361 tests, 6360 passed. The single failure is the pre-existing comps-valuation.test.ts 'retained-comp location reconciliation > keeps the retained point when duplicate observations merge' from unrelated uncommitted comp-location-reconciliation work; it fails identically without this session's changes..
- **Latest typecheck:** PASS at 2026-08-13T16:44:00.0000000Z; tsc --noEmit clean on the working tree..
- **Latest production build:** PASS at 2026-08-13T16:47:00.0000000Z; vite production build + tsc server build completed; only the pre-existing chunk-size warnings..
- **Managed runtime:** RUNNING healthy at 2026-08-13T16:55:00.0000000Z; PID 165632; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
Tests, typecheck and production build re-run and PASS (one pre-existing comps-valuation failure). Runtime restarted on the new build; dedicated browser UP. 5170 Hwy 60, Birchwood TN (APN 023 003.02) is the acceptance property; its identity and screening must stay correct.

SCOPE: retrieve through the EXISTING driver/importer shapes; escalate a failed item to Hermes through the EXISTING lane. OUT, stop-and-report: a capture framework or provider-agnostic abstraction; a config surface for view definitions; retry/backoff beyond the driver's; ANY change to the evidence model, SOP, valuation, PI assembly, or UI.

# Completed and Proven
- Identity, screening, run-status strip and the DIRECT LANDPORTAL API path are proven live: `landportal-api.ts` maps `single-property` onto the parcel-panel labels the evidence model reads and emits comps in `parseComparableCard` shape; absent numerics are null, never zero. The capture ALWAYS runs, Hermes after it.
- **GAP 1 FIXED (silent dead browser).** `captureLandPortalVisuals` uses `ensureBrowserSessionReady`; on failure it logs `landportal_capture_browser_unavailable` and throws, naming `npm run landos:browser status`. Pre-run blocks log `landportal_capture_pre_run_blocked`.
- **GAP 2 FIXED (stale capture gate).** The successor waits on `Promise.race([run, staleHoldMs = opts.timeoutMs])`, so a capture whose caller gave up cannot queue the next; release logs `landportal_capture_gate_released_stale`.
- **GAP FIXED (search burned the window).** `BrowserSearchKey.landPortalParcelUrl` carries a verified canonical parcel URL; `captureLandPortalInspection` reads it from `promoteRetainedLandPortalParcelUrl` (logs `landportal_capture_direct_entry`) and `runLandPortalAgentic` opens that record first, skipping hops, ranked search and typeahead once `verifyParcelSelected` passes. A URL opening no verifying record costs one navigation, then search runs.
- **HANDOFF TIMEOUT FIXED.** The identity lane settled only when the WHOLE inspection (imagery, overlays, 3D, county deep record) finished, reporting a 300s timeout for facts it held at 36s. `captureLandPortalVisuals` now fires `onSubjectFacts` straight after the API read; the hook travels `BrowserRunHooks` → `runPropertyInspection({ onLandPortalSubjectFacts })` → `landPortalSubjectFactsHandoff` (`routes.ts`), which persists the facts through the ordinary cumulative merge, re-promotes the URL and calls `onSubjectReady`. The lane's `execute` is `Promise.race([subjectReady, fullCapture])`; `rawCapturePromise` stays the full capture, so late promotion and Hermes still wait for the real end. IDENTITY GATE: the early path runs only when the read URL decodes to the parcel the card is already bound to.
- **LIVE PROOF, 5170 Hwy 60, 2026-08-14.** 02:18: direct entry +17s → `landportal_api_subject_read factCount=57 comps=7` +36s, against ZERO capture lines in 300s before; visuals 3 → 13. 03:34: `landportal_subject_facts_handed_off factCount=60` +34.7s, lane "Parcel and LandPortal subject research DELIVERED 35s", timeout sentence GONE, capture still running after it (`landportal_visual_zoom` +50s); run 2m45s vs 7m10s, visuals 13 → 16, evidence 5 → 12 items; identity unchanged.
- Coverage: `browser-session.test.ts`, `browser-session-landportal-capture.test.ts`, `landportal-retained-url-entry.test.ts` (4), `landportal-subject-handoff.test.ts` (2 — settles on early facts mid-capture; with no handoff it still waits).

# Remaining Work
NEW, OBSERVED 2026-08-14, NOT DIAGNOSED: downstream lanes now start ~4 minutes earlier, so comps run while the background capture is still writing. That run accepted 5 closed sales (land-only $423,000) where the slower run accepted 7 ($431,000), 2 rows held back for unstated status — gap 4's symptom, but the timing shift may contribute. Rerun and compare before trusting either number.

Gap 3 (SNAPSHOT PREDATES THE CAPTURE): Terrain can read "Not supplied" while the card holds `Slope Avg`. Gap 4 (COMP STATUS): comps land `unknown` not `sold`; `landPortalCompCardsFromApi` sets `sectionLabel: ''`.

The gap-2 unbounded-chain pattern still exists in `withBrowserMissionGate` (`routes.ts`): it serializes whole inspection missions with no relation to any caller's budget. Not touched.

Lower priority: Hermes comps "specialist identity conflict (LandPortal subject URL)" — the URLs parse to IDENTICAL identities; the Hermes visuals payload the importer cannot read (do NOT patch); Overview contradictions in `AcquisitionWorkspaceV2.tsx`.

# Exact Next Action
Await instruction. Recommended: rerun 5170 Hwy 60 and compare accepted comps against the two runs above before touching gap 3 or 4.

# Relevant Files
- `src/landos/landportal-browser.ts`, `landportal-retained-url-entry.test.ts`, `landportal-subject-handoff.test.ts`
- `src/landos/browser-intelligence.ts` (`landPortalParcelUrl`, `onSubjectFacts`)
- `src/landos/routes.ts` (`landPortalSubjectFactsHandoff`), `property-intelligence-live.ts`, `property-inspection.ts`
- `src/landos/browser-session.ts` (+ its two tests), `src/landos/landportal-api.ts`

# Relevant Records
5170 Hwy 60, Birchwood TN 37308 (APN 023 003.02, FIPS 47065, LP id 172954755): deal 87, property card 77.

# Known Blockers
None. Pre-existing, unrelated: the comps-valuation duplicatesMerged failure; Gemini 429 quota exhaustion on market-scan lanes.

# Do Not Inspect or Modify
Runner/harness experiment, staged deletions, package.json experiment state, stash, unrelated dirty work, `.env`, secrets, `C:/Users/tbutt/claudeclaw-os-latest`.

# Runtime State
Managed runtime healthy at http://localhost:3141; dedicated browser up on 127.0.0.1:9224. Leave both running.

# Verification Required
Operator-visible browser confirmation in the lead card. A backend "complete" is NOT acceptance.

# Completed and Protected
9490 Elk Lake Rd unchanged: five-sale vacant-land valuation, $625,000 land-only indication, cleaned average $624,500 / median $600,000 / weighted $637,500, $600,000-$637,500 retail range, 40/50/60 land-basis references, mapped LandPortal locations/distances, Redfin active competitors, Realtor no-result behavior, Zillow improved_context classification, zero vacant-land weight for improved properties, the improvement-overlay gate, the off-parcel subject-classification fix. On 5170 Hwy 60: resolved identity.
