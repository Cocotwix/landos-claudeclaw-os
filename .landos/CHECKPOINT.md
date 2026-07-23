# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-23T20:05:36.620Z
- **HEAD at generation:** `83e2c00`
- **Worktree:** DIRTY; 152 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-23T16:00:56-04:00; 295 files, 3642 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-23T16:01:30-04:00; tsc --noEmit.
- **Latest production build:** PASS at 2026-07-23T16:02:30-04:00; server TypeScript build and Vite production bundle passed; Vite emitted only the existing large-chunk advisory.
- **Managed runtime:** RUNNING healthy at 2026-07-23T16:04:38-04:00; PID 60512; http://localhost:3141.
- **Active sprint:** sprint-2026-07-17-operator-useful-leads (complete); 3/3 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-17-operator-useful-leads/ledger.json; proof report .landos/sprints/sprint-2026-07-17-operator-useful-leads/report.md; frozen capabilities: 3 (.landos/capabilities.json).
<!-- DERIVED:END -->

Live repository, database, runtime, and owner-visible behavior override anything written here.
This file is a compact continuation boundary, not an authority over current code
or data.

## Current objective

Tyler approved the July 23 architecture-recovery inspection and preservation
checkpoint. Preserve yesterday's product work on a dedicated recovery branch,
exclude machine-local/debug artifacts, restore deterministic verification, and
do not push. The next implementation step is the first versioned vertical slice:

`Property Resolution -> Canonical Property Version -> Assessor/GIS Evidence ->
Property Summary Snapshot -> Deal Card Summary`

The full Property Intelligence operating contract is under
`docs/landos/property-intelligence-sop.md`. Keep detailed reports under
`docs/landos/`; do not expand automatic memory with session history.

## Preserved work under review

- Automatic Opportunity research missions, progress/retry UI, quarantine and
  public-source parcel research.
- Property Intelligence contract/orchestrator, official parcel adapters,
  normalized comps, comp map and shared readiness/projection logic.
- Smart Intake, retained originals, resources, contacts, public-record outcomes,
  person aliases and Deal Card tab changes.
- Browser/session, LandPortal, Google visual, evidence-language and runtime
  hardening.

New product modules and their tests are currently untracked and must be staged
deliberately. Local `.claude`, `.kilo`, root debug scripts, `tmp_query*`,
`verify-deal30.mjs`, and `scripts/tmp-*` files are investigation artifacts and
must not enter the preservation commit.

## Architecture findings

- Deal Card report reads currently rehydrate and reconcile several stores,
  rebuild comps/valuation/readiness/strategy, and synthesize market context.
  Opening a card therefore computes a current projection instead of reading one
  immutable Deal Intelligence Snapshot.
- Property card, Opportunity mission, report verification, ConfirmedParcel and
  public-intelligence identity can disagree.
- Raw evidence, normalized facts, operator overrides and conclusions are spread
  across source evidence, property inspection, public-run JSON, browser facts,
  intake facts, public records, report JSON, worksheets and Activity refs.
- Opportunity missions, the report runner and the new Property Intelligence
  orchestrator overlap; some scheduling/deduplication remains in memory.

## Live acceptance examples

- Deal 31 is the verified control: official Florida APN, owner, acreage,
  environmental evidence, comps, market reads, preliminary value, visuals,
  documents and all ten tabs persisted through restart.
- Deal 10 is the unresolved control and exposes a defect: it retains area comps
  and a report, ranks five "Best comparables," and creates a blank
  parcel-boundary hero slot even though identity and acreage are unresolved.
- Deal 30 preserves yesterday's accepted Tennessee facts, comps, preliminary
  value, acquisition range, intake, resources, public records and visuals, but
  its mission can say candidate/address discrepancy while the report says the
  parcel is confirmed.

## Required first-slice invariants

1. One accepted property identity version is current.
2. Candidate and confirmed states cannot coexist in the owner read model.
3. Every accepted fact links to evidence and the identity version researched.
4. Operator corrections cannot be overwritten by weaker automation.
5. GET requests perform no provider work, reconciliation write, or valuation.
6. Collector failures are isolated and resumable after managed restart.
7. Unresolved identity cannot show parcel-specific imagery, ranked best comps,
   FMV or actionable strategy.
8. Snapshot changes cite input versions and a reason.

## Open external diligence

- Deal 30 still needs a valid authenticated LandPortal 2D replacement image; do
  not promote an account shell, logged-out page, gray frame or fabricated image.
- Obtain the cited deed and professional title/lien work before relying on title,
  easements, restrictions, liens or clear ownership.
- Confirm current taxes, exact zoning, legal access/frontage, septic, utilities
  and any split concept with the appropriate county professionals.

## Continuation boundary

Finish the approved preservation checkpoint first: deterministic tests, full
typecheck/build/test verification, managed restart/health, reviewed staging and
one local recovery-branch commit. Do not push. After that, begin the first
versioned architecture slice only with Tyler's confirmed scope.
