# Current Active Task
The improved-property house-value overlay on the 9490 Elk Lake Rd Comps & Valuation workspace is corrected and live-verified: it runs only for a residential subject structure, and neighboring or off-parcel observation text no longer classifies the subject.

# Exact Operator Outcome
Comps & Valuation keeps the five LandPortal closed land comps, two Redfin active competitors, 17 Zillow improved-context records, mapping/distances, provider provenance, thumbnails, and the $625,000 land-only value untouched. The subject now reads as an existing residence, so Improvement Valuation shows $523,908 (1,701 sqft x $308/sqft, Redfin 49690 benchmark) and Whole Property Value shows $1,148,908. No panel claims the improvement value is unavailable or pending while an overlay has been calculated.

# Current State

<!-- DERIVED:START -->
- **Generated:** 2026-08-13T16:52:52.059Z
- **HEAD at generation:** `8d5e7a4`
- **Worktree:** DIRTY; 116 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS with one pre-existing unrelated failure at 2026-08-13T16:45:00.0000000Z; Full vitest run: 450 files, 6361 tests, 6360 passed. The single failure is the pre-existing comps-valuation.test.ts 'retained-comp location reconciliation > keeps the retained point when duplicate observations merge' from unrelated uncommitted comp-location-reconciliation work; it fails identically without this session's changes..
- **Latest typecheck:** PASS at 2026-08-13T16:44:00.0000000Z; tsc --noEmit clean on the working tree..
- **Latest production build:** PASS at 2026-08-13T16:47:00.0000000Z; vite production build + tsc server build completed; only the pre-existing chunk-size warnings..
- **Managed runtime:** RUNNING healthy at 2026-08-13T16:55:00.0000000Z; PID 165632; http://localhost:3141.
- **Prior tracked sprint:** sprint-2026-08-04-pi-workflow-finish (complete); it is not the Current Active Task.
- **Sprint ledger:** .landos/sprints/sprint-2026-08-04-pi-workflow-finish/ledger.json; proof report .landos/sprints/sprint-2026-08-04-pi-workflow-finish/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->
The off-parcel subject-classification fix is committed on `main` with its tests. The residential overlay gate and the Improvement Valuation / Whole Property Value text fix stay uncommitted: they sit on top of the still-uncommitted improvement-valuation feature and are interleaved in the same files with unrelated dirty work, so they cannot be separated cleanly. Managed runtime is running healthy on http://localhost:3141. Target deal is 83 / property card 73.

# Completed and Proven
- `computeImprovementValuation` gates the subject overlay on `isResidentialStructureType` (existing residence or manufactured home). A subject classified agricultural, commercial, or otherwise non-residential produces no improvement value, no whole-property value, and an operator-facing `overlaySkippedReason` instead. The Redfin ZIP benchmark is not even passed for a non-residential subject.
- The Improvement Valuation panel no longer prints "no improvement value is fabricated" when a value exists; the Whole Property Value panel prints the skip reason rather than the generic unavailable line when the overlay was deliberately skipped.
- `inferSubjectPropertyType` excludes visual observations describing off-parcel context (neighboring, adjacent, adjoining, abutting, surrounding, nearby, vicinity, roadside, streetscape, corridor, across/down the road, immediate road context) from subject classification. On Elk Lake all three unique agricultural mentions were Street View scene descriptions; nothing on the parcel was agricultural. The classification note reports how many observations were set aside, so the exclusion is visible.
- Agricultural improvements standing on the subject parcel still classify as agricultural; the exclusion only removes off-parcel scene text.
- Focused regression coverage added in `src/landos/comps-valuation.test.ts` (residential runs, non-residential skips, comp median untouched by the skip) and `src/landos/comparable-intelligence.test.ts` (neighboring orchard text does not retype the subject; on-parcel barn text still does).
- Live read of deal 83 confirmed both states: skip reason with no figure while the subject typed agricultural, then the overlay with land value unchanged after the classification fix.

# Remaining Work
Qualifying sold improved comps for the subject remain 0, so $523,908 rests entirely on the ZIP-level Redfin median rather than comps for this structure. Treat it as a benchmark overlay, not an appraisal. 15 Zillow records still have no identity-safe public provider photo URL; their non-photo fields are unchanged and honest.

# Exact Next Action
Await a new operator instruction. Do not continue work on 9490 Elk Lake Rd: Tyler closed the improved-overlay task after the live verification, and no follow-on polish was requested.

# Relevant Files
- `src/landos/comps-valuation.ts`
- `src/landos/comps-valuation.test.ts`
- `src/landos/comparable-intelligence.ts`
- `src/landos/comparable-intelligence.test.ts`
- `web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx`

# Relevant Records
- Deal card 83, property card 73.
- LandPortal comps 954-958; Zillow improved-context evidence includes 4094 Windward Way.

# Known Blockers
None for this task. Pre-existing and unrelated: `comps-valuation.test.ts > retained-comp location reconciliation > keeps the retained point when duplicate observations merge` fails with duplicatesMerged 0. It belongs to the uncommitted comp-location-reconciliation work and fails identically without this session's changes; it was recorded, not repaired.

# Do Not Inspect or Modify
Preserved runner/harness experiment, staged deletions, package.json experiment state, stash, unrelated dirty/untracked work, `.env`, credentials, tokens, cookies, secrets, and `C:/Users/tbutt/claudeclaw-os-latest`.

# Runtime State
Managed runtime running and healthy at http://localhost:3141. Leave it running.

# Verification Required
Complete. Full vitest run (6360 of 6361 passed, one pre-existing unrelated failure), typecheck clean, production build passed, managed restart healthy, and two live browser reads of the deal-83 Comps & Valuation section.

# Completed and Protected
Accepted five-sale vacant-land valuation, the $625,000 land-only indication, cleaned average $624,500 / median $600,000 / weighted $637,500, the $600,000-$637,500 retail range, the 40/50/60 land-basis references, mapped LandPortal locations/distances, Redfin active competitors, Realtor no-result behavior, Zillow improved_context classification, and zero vacant-land valuation weight for improved properties remain unchanged.
