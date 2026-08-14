# Current Active Task
Awaiting instruction. The retained-parcel-URL fast path is fixed and verified live; gaps 3 and 4 are untouched.

# Exact Operator Outcome
A new lead's LandPortal fields and visuals appear in the lead card in about a minute instead of ~18, with Hermes invoked only for items the deterministic path could not complete.

# Current State


<!-- DERIVED:START -->
- **Generated:** 2026-08-14T02:27:59.499Z
- **HEAD at generation:** `d5dbc07`
- **Worktree:** DIRTY; 130 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS with one pre-existing unrelated failure at 2026-08-13T16:45:00.0000000Z; Full vitest run: 450 files, 6361 tests, 6360 passed. The single failure is the pre-existing comps-valuation.test.ts 'retained-comp location reconciliation > keeps the retained point when duplicate observations merge' from unrelated uncommitted comp-location-reconciliation work; it fails identically without this session's changes..
- **Latest typecheck:** PASS at 2026-08-13T16:44:00.0000000Z; tsc --noEmit clean on the working tree..
- **Latest production build:** PASS at 2026-08-13T16:47:00.0000000Z; vite production build + tsc server build completed; only the pre-existing chunk-size warnings..
- **Managed runtime:** RUNNING healthy at 2026-08-13T16:55:00.0000000Z; PID 165632; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
This session re-ran all three: tests PASS (6384 of 6385, same pre-existing comps-valuation failure), typecheck PASS, production build PASS. Runtime restarted on the new build; dedicated browser UP. All changes uncommitted. 5170 Hwy 60, Birchwood TN (APN 023 003.02) is the acceptance property; its identity and screening are correct and must stay correct.

SCOPE: retrieve through the EXISTING driver/importer shapes; escalate a failed item to Hermes through the EXISTING lane. OUT, stop-and-report: a capture framework or provider-agnostic abstraction; a config surface for view definitions; retry/backoff beyond the driver's; ANY change to the evidence model, SOP, valuation, PI assembly, or UI. Endpoints: `landportal-internal-api` auto-memory.

# Completed and Proven
- Identity, screening, run-status strip and the DIRECT LANDPORTAL API path are proven live: `landportal-api.ts` maps `single-property` onto the exact parcel-panel labels the evidence model reads and emits comps in `parseComparableCard` shape; absent numerics are null, never zero. The deterministic capture ALWAYS runs, Hermes after it.
- **GAP 1 FIXED (silent dead browser).** `captureLandPortalVisuals` uses `ensureBrowserSessionReady` (relaunches the dedicated Chrome); on failure it logs `landportal_capture_browser_unavailable` at error level and throws, naming `npm run landos:browser status`. Pre-run blocks log `landportal_capture_pre_run_blocked`; the trace carries `lpVisuals FAILED: <message>`.
- **GAP 2 FIXED (stale capture gate).** The successor waits on `Promise.race([run, staleHoldMs = opts.timeoutMs])`, so a capture whose caller gave up cannot queue the next; release logs `landportal_capture_gate_released_stale`. Nothing is cancelled.
- Coverage for both: `browser-session.test.ts`, `browser-session-landportal-capture.test.ts`.
- **GAP FIXED (search burned the window).** `BrowserSearchKey.landPortalParcelUrl` carries an already-verified canonical parcel URL. `captureLandPortalInspection` (`routes.ts`) reads it from `promoteRetainedLandPortalParcelUrl` and logs `landportal_capture_direct_entry`. `runLandPortalAgentic` opens that record FIRST and, when `verifyParcelSelected` passes, skips the surface hops, ranked search, typeahead and scope work; `usedMethod` becomes `retained parcel URL` (no search strategy learned). A URL opening no verifying record costs one navigation, then the search path runs.
- **LIVE PROOF, 5170 Hwy 60, 2026-08-14 02:18 local, operator re-run research.** `landportal_capture_direct_entry` +17s → `landportal_capture_entered queuedMs=2` +27s → `_navigated` +32s → `landportal_api_subject_read factCount=57 comps=7` +36s. Prior run: ZERO capture lines in 300s. Persisted note: "opened the retained verified parcel URL → visually verified [parcel_selected] → confirmed the parcel record"; trace `direct-entry:retained parcel URL | direct(parcel) OK:3 confirmed | capture(accepted) | lpVisuals: fields=60 comps=3 mapReached=true`. Run 7m10s, 10/10 lanes; visuals 3 → 13; identity unchanged.
- Regression coverage: `landportal-retained-url-entry.test.ts` (3 — direct entry runs no search and captures at the retained URL; no URL still searches; a stale URL falls back).

# Remaining Work
NEW, NOT STARTED: the `landportal_subject` PROVIDER WRAPPER still reports "capture exceeded the 300-second identity handoff window" though its parcel data now lands at +36s. `captureLandPortalInspection` returns only after the whole `runPropertyInspection` (visuals, overlays, 3D, county deep-record) finishes, so the wrapper times out and evidence arrives by late-capture promotion. Fix candidate: settle the handoff on the subject read, not the full inspection. Search is no longer the cost.

Gap 3 (SNAPSHOT PREDATES THE CAPTURE): the run assembles at ~7m, the capture lands after, so Terrain can read "Not supplied" while the card holds `Slope Avg`. Gap 4 (COMP STATUS): comps land `unknown` not `sold`; `landPortalCompCardsFromApi` sets `sectionLabel: ''`.

The gap-2 unbounded-chain pattern still exists in `withBrowserMissionGate` (`routes.ts:1494`): it serializes whole inspection missions with no relation to any caller's budget. Not touched.

Lower priority: Hermes comps "specialist identity conflict (LandPortal subject URL)" — the URLs parse to IDENTICAL identities; the Hermes visuals payload the importer cannot read (do NOT patch); Overview contradictions (`AcquisitionWorkspaceV2.tsx:275`, `comps-valuation.ts:400`). TEMPORARY: the capture entered/navigated logs remain.

# Exact Next Action
Await instruction. Recommended: settle the `landportal_subject` handoff on the subject read so the lane stops reporting a 300s timeout for data it already holds at 36s. Nothing is committed; ask before committing.

# Relevant Files
- `src/landos/landportal-browser.ts`, `src/landos/landportal-retained-url-entry.test.ts`
- `src/landos/browser-intelligence.ts` (`BrowserSearchKey.landPortalParcelUrl`)
- `src/landos/routes.ts` (captureLandPortalInspection), `src/landos/property-intelligence-live.ts`
- `src/landos/browser-session.ts` (+ `.test.ts`, `browser-session-landportal-capture.test.ts`), `src/landos/landportal-api.ts`

# Relevant Records
5170 Hwy 60, Birchwood TN 37308 (APN 023 003.02, FIPS 47065, LP id 172954755): deal card 87, property card 77.

# Known Blockers
None for this task. Pre-existing and unrelated: the comps-valuation duplicatesMerged failure above; Gemini 429 quota exhaustion on the market-scan lanes.

# Do Not Inspect or Modify
Runner/harness experiment, staged deletions, package.json experiment state, stash, unrelated dirty work, `.env`, credentials, secrets, `C:/Users/tbutt/claudeclaw-os-latest`.

# Runtime State
Managed runtime running and healthy at http://localhost:3141. Dedicated browser up on 127.0.0.1:9224. Leave both running.

# Verification Required
Operator-visible browser confirmation in the lead card. A backend "complete" is NOT acceptance.

# Completed and Protected
9490 Elk Lake Rd unchanged: five-sale vacant-land valuation, $625,000 land-only indication, cleaned average $624,500 / median $600,000 / weighted $637,500, $600,000-$637,500 retail range, 40/50/60 land-basis references, mapped LandPortal locations/distances, Redfin active competitors, Realtor no-result behavior, Zillow improved_context classification, zero vacant-land weight for improved properties, the residential improvement-overlay gate, the off-parcel subject-classification fix. On 5170 Hwy 60: resolved identity.
