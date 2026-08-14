# Current Active Task
Awaiting instruction. The fast path, the 300s subject handoff timeout, the comp date-normalization bug and the subject-as-its-own-comp defect are all fixed, proven live and COMMITTED. One comp data-quality issue is open; gaps 3 and 4 are untouched.

# Exact Operator Outcome
A new lead's LandPortal fields and visuals appear in the lead card in about a minute instead of ~18, with Hermes invoked only for items the deterministic path could not complete.

# Current State


<!-- DERIVED:START -->
- **Generated:** 2026-08-14T05:54:25.454Z
- **HEAD at generation:** `1b699d8`
- **Worktree:** DIRTY; 123 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS with one pre-existing unrelated failure at 2026-08-14T05:39:00.0000000Z; 6400 passed; the comps-valuation duplicatesMerged case fails identically without this session's changes..
- **Latest typecheck:** PASS at 2026-08-14T05:39:00.0000000Z; tsc --noEmit clean..
- **Latest production build:** PASS at 2026-08-14T05:39:00.0000000Z; vite + tsc server build clean; pre-existing chunk-size warnings only..
- **Managed runtime:** RUNNING healthy at 2026-08-14T05:40:00.0000000Z; PID 177320; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
Runtime restarted on the new build; dedicated browser UP. 5170 Hwy 60, Birchwood TN (APN 023 003.02) is the acceptance property; its identity and screening must stay correct.

SCOPE: retrieve through the EXISTING driver/importer shapes; escalate a failed item to Hermes through the EXISTING lane. OUT, stop-and-report: a capture framework or provider-agnostic abstraction; a config surface for view definitions; retry/backoff beyond the driver's; ANY change to the evidence model, SOP, or PI assembly.

# Completed and Proven
- Identity, screening and the DIRECT LANDPORTAL API path are proven live: `landportal-api.ts` maps `single-property` onto the parcel-panel labels the evidence model reads and emits comps in `parseComparableCard` shape; absent numerics are null, never zero. The capture ALWAYS runs, Hermes after.
- **GAP 1 FIXED (silent dead browser).** `captureLandPortalVisuals` uses `ensureBrowserSessionReady`; on failure it logs `landportal_capture_browser_unavailable` and throws, naming `landos:browser status`.
- **GAP 2 FIXED (stale capture gate).** A capture whose caller gave up cannot queue the next; release logs `landportal_capture_gate_released_stale`.
- **FAST PATH FIXED, committed `f178eb7`.** `BrowserSearchKey.landPortalParcelUrl` carries a verified canonical parcel URL; `captureLandPortalInspection` reads it from `promoteRetainedLandPortalParcelUrl` (logs `landportal_capture_direct_entry`) and `runLandPortalAgentic` opens that record first, skipping hops, search and typeahead once `verifyParcelSelected` passes. A stale URL costs one navigation, then search.
- **HANDOFF TIMEOUT FIXED, committed `3edda7b`.** The identity lane settled only when the WHOLE inspection finished, reporting a 300s timeout for facts it held at 36s. `captureLandPortalVisuals` fires `onSubjectFacts` after the API read; `landPortalSubjectFactsHandoff` (`routes.ts`) persists them through the ordinary cumulative merge and calls `onSubjectReady`. The lane races that against the full capture; `rawCapturePromise` stays the full capture, so late promotion and Hermes wait for the real end. IDENTITY GATE: the early path runs only when the read URL decodes to the card's own parcel.
- **LIVE PROOF, 5170 Hwy 60, 2026-08-14.** Direct entry +17s → `landportal_api_subject_read factCount=57 comps=7` +36s, against ZERO capture lines in 300s before; handoff +34.7s, lane "DELIVERED 35s", capture still running after it; run 2m45s vs 7m10s; identity unchanged.
- **DATE NORMALIZATION FIXED, committed `e77d552`.** `withinExactMonths` accepted the ISO shape alone, so an unparseable date and a pre-cutoff date were the same answer and a month-first sale silently lost its weight while `exactMonthsOld` read it correctly. `normalizeSaleDateIso` feeds both. Live: 044 068.01 (13mo) and 020 092.01 (2mo) joined the set, 047 013 (26mo) still zero-weight; set 5 → 7.
- **SUBJECT-AS-ITS-OWN-COMP FIXED, committed `1b699d8`.** The subject's APN sat in its own valuation set at weight 4.795. `comp-subject-identity.ts` (`subjectParcelMatch`) decides this on IDENTITY: the canonical LandPortal property id from the row's URL, or an APN reconciling with the subject's INSIDE the same jurisdiction. Address text decides nothing — the offending row carries ANOTHER parcel's URL, so a URL-only test misses it. No jurisdiction, or no subject identity, means no match, so a real comp is never deleted on a guess. The row is `rejected` and never eligible, still visible in the ledger; the operator include path applies the same gate. Live: accepted sales 8 → 7, set 7 → 6, the other seven comps keep their prior weights, 23 view rows and 13 persisted rows unchanged.
- Coverage: `browser-session*.test.ts`, `landportal-retained-url-entry.test.ts` (4), `landportal-subject-handoff.test.ts` (2), `comp-recency-window.test.ts` (5), `comp-subject-self-exclusion.test.ts` (8).

# Remaining Work
OPEN COMP DATA QUALITY, untouched: duplicate persisted rows for ONE parcel carry conflicting prices, so which value prices the subject depends on which duplicate the dedupe picks. `044 068.01` holds $550,000 and $200,000 for the same 20.55 ac ($26,764/ac vs a ~$10,300/ac median; it sets the top of the range); `058I A 042.03` holds $325,000 and $599,900 (rows 960, 968), winner changed after the date fix.

Gap 3: Terrain can read "Not supplied" while the card holds `Slope Avg`. Gap 4: map-surface comps land `unknown` not `sold` (`landPortalCompCardsFromApi` sets `sectionLabel: ''`).

The gap-2 unbounded-chain pattern still exists in `withBrowserMissionGate` (`routes.ts`): it serializes whole inspection missions with no relation to a caller's budget.

Lower priority: Hermes comps "specialist identity conflict" — the URLs parse to IDENTICAL identities; the Hermes visuals payload the importer cannot read (do NOT patch). Gemini 429s on market scans.

# Exact Next Action
Await instruction. Recommended: reconcile the duplicate comp prices before trusting the indication.

# Relevant Files
- `src/landos/comp-subject-identity.ts` (+ `comp-subject-self-exclusion.test.ts`), `comps-valuation.ts`, `comp-recency-window.ts`
- `src/landos/landportal-browser.ts`, `browser-intelligence.ts`, `browser-session.ts`, `landportal-api.ts`
- `src/landos/routes.ts` (`landPortalSubjectFactsHandoff`), `property-intelligence-live.ts`, `property-inspection.ts`

# Relevant Records
5170 Hwy 60, Birchwood TN 37308 (APN 023 003.02, FIPS 47065, LP id 172954755): deal 87, property card 77.

# Known Blockers
None. Pre-existing, unrelated: the comps-valuation duplicatesMerged test failure.

# Do Not Inspect or Modify
Runner/harness experiment, staged deletions, package.json experiment state, stash, unrelated dirty work, `.env`, secrets, `claudeclaw-os-latest`.

# Runtime State
Managed runtime healthy at http://localhost:3141; dedicated browser up on 127.0.0.1:9224. Leave both running.

# Verification Required
Operator-visible browser confirmation in the lead card. A backend "complete" is NOT acceptance.

# Completed and Protected
9490 Elk Lake Rd unchanged: five-sale vacant-land valuation, $625,000 land-only indication, cleaned average $624,500 / median $600,000 / weighted $637,500, $600,000-$637,500 retail range, 40/50/60 land-basis references, mapped LandPortal locations/distances, Redfin active competitors, Realtor no-result behavior, Zillow improved_context classification, zero vacant-land weight for improved properties, the improvement-overlay gate, the off-parcel subject-classification fix. 5170 Hwy 60: resolved identity.
