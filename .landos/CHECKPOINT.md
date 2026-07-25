# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-25T05:56:34.277Z
- **HEAD at generation:** `150a9db`
- **Worktree:** DIRTY; 89 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-25T01:54:23-04:00; 321 files, 3963 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-25T01:55:10-04:00; tsc --noEmit (server). Frontend web/tsconfig.json is not green and has no npm script: 92 pre-existing errors, 35 in files this sprint never touched, 0 in changed regions.
- **Latest production build:** PASS at 2026-07-25T01:56:02-04:00; server TypeScript build and Vite production bundle passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-25T01:56:20-04:00; PID 71864; http://localhost:3141.
- **Active sprint:** sprint-2026-07-24-zoning-land-use (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-24-zoning-land-use/ledger.json; proof report .landos/sprints/sprint-2026-07-24-zoning-land-use/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository state, database state, runtime, and owner-visible behavior override anything written here.
Detailed reports remain under `docs/landos/`. Do not
commit or push until Tyler explicitly authorizes it.

## Current objective and state

The LandPortal + Deal Card recovery sprint is COMPLETE and committed locally on
`main` (not pushed). It repaired the BROWSER AND DEAL CARD FOUNDATION only. It
did NOT complete the Property Intelligence workflow, LandPortal comps,
government-records research, or full Deal Card research; those remain open.

Committed capability set:

1. Shared LandPortal capability (`landportal-capability.ts`) with mandatory
   visual checkpoints at every consequential action: configured search before
   submit, result before selection, parcel before extraction, capture before and
   after saving.
2. Jurisdiction filters are applied AND read back off the page. A filter counts
   only when the widget displays it; a search whose filters cannot be seen is not
   submitted. A driver that cannot see the controls is never called verified.
3. Owner ranking for surname-first records with trailing initials, and rural
   road-only situs matching that needs no house number; exact owner + exact road
   + correct jurisdiction is a strong identifier.
4. Screenshot-quality contract is the ONLY route into the evidence set: two gate
   functions, no ungated push, pinned by a structural test. Ineffective captures
   are rejected and kept as honest history.
5. LandPortal-owned page cleanup on success, partial, failure, timeout and visual
   rejection; pages already open belong to the operator and are preserved.
6. Canonical identity propagation into the versioned Property Summary, ending the
   confirmed-versus-unresolved contradiction. Reads never write.
7. Deal Card tab navigation works and is read-only (view state plus a
   sessionStorage preference); Smart Intake evidence is docked at card level so no
   tab change or identity confirmation can hide it; honest empty states.
8. Duplicate protection across submissions, artifacts, candidates, identity
   versions and browser resources.

Verification before commit: full suite 321 files / 3963 tests / 0 failures;
server `tsc --noEmit` PASS; server build and Vite production build PASS (only the
pre-existing large-chunk advisory); live store `quick_check ok`, 0 foreign-key
violations; memory audit PASS; managed runtime healthy.

## Deal 32 live proof (Roane County, TN)

The supplied screenshot PNG (2,949,777 bytes, SHA-256
`df2e1d2c898c9726daca94fbdb0db600ced3a59339a4ca9d012fdbb850ea09f3`) yielded
nine editable candidates. Multi-path resolution via the operator button
confirmed the parcel on the official Tennessee Comptroller public parcel
layer: APN `073090 04200` (GISLINK ordered-group match, Roane-filtered),
owner `SACHAN DILEEP S`, situs `OLD RIDGE RD`, 12.28 deeded acres,
coordinates and source URL. LandPortal was genuinely searched (4 APN variants
+ owner + address) and honestly refused a Davidson-county APN collision. No
Ridge Trail Road exists in stored state; a regression test pins the wrong-road
rejection. Identity `confirmed` (confidence 1.0); property card 32 verified
from the official record (never screenshot text) and linked subject;
downstream follows the confirmed-parcel gate. Refresh and managed restart
preserved one submission, one artifact (same SHA-256), and nine candidates
with no duplicates.

## Prior slice proof to preserve

- Deal 31 verified control (identity/snapshot v1, 100%, nine immutable
  evidence items) and Deal 10 unresolved control (imagery/comps/valuation/
  strategy withheld) both persist through restart.
- Deal 14 government record snapshot v5: identity v1, 60% screened, medium
  confidence; deed/ownership complete, other lanes honestly partial; seven
  retained pages for instrument 1997O31519 with SHA-256 + official source.

## Exclusions

Never stage local `.claude`, `.kilo`, root debug scripts, `tmp_query*`,
`verify-deal30.mjs`, or `scripts/tmp-*`; they are unrelated investigation
artifacts and stay uncommitted.

## Required invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Accepted facts link to evidence and the researched identity version.
4. Operator corrections beat weaker automation.
5. GET requests perform no provider work or reconciliation writes.
6. Collector failures are isolated and restart-resumable.
7. Unresolved identity cannot show parcel-specific imagery, ranked best comps,
   FMV, or actionable strategy.
8. Screenshot text/geometry never establishes official identity or boundaries.
9. Lead/seller/wholesaler identity never must match screenshot owner.

## Known limitations and next action

- This sprint repaired the browser and Deal Card foundation ONLY. Property
  Intelligence end to end, LandPortal comps, government-records research and full
  Deal Card research are NOT finished.
- The frontend `web/tsconfig.json` typecheck is not green and has no npm script:
  92 pre-existing errors (68 unused declarations), 35 of them in files this sprint
  never touched. The authoritative build path (`vite build && tsc`) passes.
- The screenshot contract judges parcel identity, boundary visibility, tile load,
  byte size and obstruction — not zoom framing, so an accepted capture can still
  be framed wider than ideal.
- LandPortal's collapsed parcel panel does not display county, state or
  coordinates; those stay honestly unverified on that view.
- `readScope` reads select2 and native selects. A bespoke non-select2 dropdown
  reports no scope controls and downgrades the filter checks to unverified.
- `/overlay/aerial` returns an honest 502 for Roane (no county aerial overlay
  capability configured); it surfaces once a parcel is confirmed.
- Deal 30 still needs a valid authenticated LandPortal 2D replacement image.
- Professional deed/title/lien, tax, zoning, access, septic, utility, and split
  verification remain required before relying on those conclusions.
