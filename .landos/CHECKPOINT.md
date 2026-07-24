# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-24T04:55:03.816Z
- **HEAD at generation:** `4cc64c2`
- **Worktree:** DIRTY; 54 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-23T23:51:25-04:00; 304 files, 3728 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-24T00:07:00-04:00; tsc --noEmit.
- **Latest production build:** PASS at 2026-07-24T00:07:45-04:00; server TypeScript build and Vite production bundle passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-24T00:55:00-04:00; PID 53840; http://localhost:3141.
- **Active sprint:** sprint-2026-07-17-operator-useful-leads (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-17-operator-useful-leads/ledger.json; proof report .landos/sprints/sprint-2026-07-17-operator-useful-leads/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository state, database state, runtime, and owner-visible behavior override anything written here.
Detailed reports remain under `docs/landos/`. Do not
commit or push until Tyler explicitly authorizes it.

## Current objective and state

PR #2 (recovery/deal-card-preservation-2026-07-23 -> main) is MERGED; local
main == origin/main == merge commit `4cc64c2f4d3480811c2eb793400bea35f01655c1`
containing feature commits `e614d515a454c848491c19b095f90db176aa67da`
(government-record risk slice + Smart Intake artifacts) and
`3213fa991befbbaccde10ec7853c286aff3fb2d0` (multi-path parcel resolution).
The recovery branch remains locally and on origin. Merged capability set:

1. Government-record risk slice: durable collector jobs/attempts, append-only
   immutable pages/claims with SHA-256 artifacts, pure Analyst producing a
   versioned Government Record Risk snapshot (deed/survey/encumbrance/tax/
   lien/judgment lanes), persisted Deal Card Documents panel.
2. Smart Intake: native text paste plus screenshot paste/upload/drag-drop;
   immutable original-image retention with labeled full-resolution viewer
   (fit/100%); editable extracted candidates; no automatic canonical
   promotion; owner/contact mismatch never blocks research.
3. Multi-path parcel resolution: state/county + APN primary with
   jurisdiction-appropriate normalization variants; LandPortal parcel-level
   browser lane wired (property id/FIPS discovered, never required input);
   county + owner as an independent lookup key (never a seller-authority
   gate); address as secondary corroboration with materially different roads
   rejected; full source-by-source evidence, accept/reject reasons, and an
   honest smallest-next-identifier shown to the operator; canonical promotion
   through the standard approved path on confirmation, with accepted-parcel
   contradiction protection.

Verification at merge: full suite 304 files / 3728 tests / 0 failures; server
tsc, server build, and Vite production build PASS (only the pre-existing
large-chunk advisory); memory audit PASS; managed runtime healthy.

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

- `/overlay/aerial` returns an honest 502 for Roane (no county aerial overlay
  capability configured); it surfaces once a parcel is confirmed.
- Deal 30 still needs a valid authenticated LandPortal 2D replacement image.
- Professional deed/title/lien, tax, zoning, access, septic, utility, and split
  verification remain required before relying on those conclusions.
