# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-16T12:53:02.346Z
- **HEAD at generation:** `69dff67`
- **Worktree:** DIRTY; 47 modified/untracked paths at refresh time. Preserve unrelated changes.
- **Latest tests:** PASS at 2026-07-15T23:20:46-04:00; 264 files, 3391 tests, 0 failures (vitest run, full suite).
- **Latest typecheck:** PASS at 2026-07-15T23:14:00-04:00; tsc --noEmit.
- **Latest production build:** PASS at 2026-07-15T23:21:30-04:00; Vite production bundle and server TypeScript build; managed runtime restarted on the fresh bundle.
- **Managed runtime:** RUNNING healthy at 2026-07-15T23:32:00-04:00; PID 122616; http://localhost:3141.
- **Active sprint:** sprint-2026-07-15-lead-workspace-foundation (complete); 2/2 accepted, 0 QA-passed; current workstream none in flight; 0 open QA findings.
- **Sprint ledger:** .landos/sprints/sprint-2026-07-15-lead-workspace-foundation/ledger.json; proof report .landos/sprints/sprint-2026-07-15-lead-workspace-foundation/report.md; frozen capabilities: 2 (.landos/capabilities.json).
<!-- DERIVED:END -->

Replace this file in place. Live repository and managed-runtime inspection
override anything written here when implementation facts differ; the HEAD
above advances with each commit, so `git log` at read time wins.

## Sprint state (2026-07-16)

- **`sprint-2026-07-15-lead-workspace-foundation` is COMPLETE**: WS1 (read
  model/endpoint) and WS2 (operator UI) both accepted through the full staged
  lifecycle — phases, independent browser QA (initial FAIL both times, 8
  findings F1-F8 all repaired system-wide and closed_retested across three
  recheck passes), LW1-LW6 verified with evidence, final combined regression
  pass, independent final review pass (landos-final-reviewer), capability
  `lead-workspace` frozen (regression protection; Tyler acceptance NOT yet
  granted). Session tests: 266 files / 3422 tests pass; typecheck and
  production build pass; managed runtime restarted on the final bundle.
- **The Lead Workspace is now the primary Acquisitions operator surface**:
  identity header + resolution chip, WRONG PARCEL hard-stop banner, blockers +
  Tyler decisions, canonical acreage-basis table with dispute callout,
  research/evidence status, unified readiness grid, market/valuation/comps
  with normalized $/acre (per-lane top rows + honest showing line), exactly
  five approved strategies, seller, evidence/visuals, work, activity. Pure
  view-model helpers in `web/src/lib/lead-workspace-view.ts` (node-tested;
  vitest include now covers `web/src/**/*.test.ts`).
- **Five approved strategies renamed system-wide per Tyler's prompt**:
  Cash Flip; Novation or Double Close; Subdivide or Minor Split; Land-Home
  Package; Improvement Then Flip (was Quick Flip / Land Home Package) in
  `strategy-readiness.ts` and every consumer/test.
- **System-wide integrity fixes landed this sprint** (each with named
  regression tests): official-parcel-lane APNs join the wrong-parcel hard
  stop; requested-APN-vs-requested-address two-parcel contradiction is a hard
  stop; accepted identity records are preserved at both storage boundaries
  (`upsertPropertyCard`, `persistParcelIdentityFromResolution`); conflicted
  intakes route to their own research record; gated-off screening runs
  contribute zero facts to the operator record; `apn_conflict` QA fixture
  selection requires a genuine recorded identityConflict; `expect_test_id`
  polls bounded; `click_text` substitutes `{dealId}`.
- **The previous Deal Card v2 sprint (`sprint-2026-07-15-dealcard-v2`)
  remains paused**; it resumes at WS4 (`ws4-comps-valuation`).

## Deferred dependencies owned by dealcard-v2 WS4 (per Tyler's direction)

1. `strong-comp-market` journey FAIL: legacy Deal Card `/landos` surface shows
   no comp $/acre values (seed finding `comp-registry-unit-suffix-under-merge`).
   The NEW Lead Workspace renders normalized $/acre correctly from the
   validated registry — the defect is confined to the legacy card surface.
2. `thin-comp-market` journey: fixture honestly unavailable; excluded from the
   Lead Workspace acceptance matrix; WS4 owns the fixture decision (repair
   criteria, add a stable repository-owned fixture, or retire the journey).

## Current QA state (durable records in .landos/qa/)

- Combined regression (run qa-2026-07-16T12-36-55-717Z): **11 pass, 1 fail
  (strong-comp-market, WS4-owned), 1 fixture-unavailable (thin-comp-market),
  2 mutation-refused**. `genuine-apn-conflict` moved FAIL -> PASS via this
  sprint's engine fix. See `.landos/qa/2026-07-16-combined-regression.md` and
  `.landos/qa/2026-07-16-lead-workspace-foundation.md`.

## Next engineering action (exact)

Resume `sprint-2026-07-15-dealcard-v2` at `ws4-comps-valuation` (comparable
validation, provider coverage, valuation) per
`docs/landos/Staged_Sprint_Lifecycle.md`: fix
`comp-registry-unit-suffix-under-merge` so legacy-card comp $/acre renders,
decide the thin-comp-market fixture, then continue WS5/WS6 per that ledger.
Frozen capabilities `lead-workspace` and `landos-operator-qa-platform` protect
their journeys; work touching their shared dependency paths must rerun them
(`npm run landos:sprint -- capability touched --paths ...`).

## Prior accepted work (summary)

- Deal Card v2 WS1 canonical acreage/spatial basis, WS2 research completeness/
  evidence language, WS3 unified readiness/approved-strategy status: all
  browser-QA-passed with closed findings F1-F13; shared services in
  `src/landos/`. Evidence ids `[E:n]` in the dealcard-v2 ledger.
- Acceptance example only (never implementation scope): 200 Sid Edens Rd,
  Pickens SC 29671, APN 5105-00-44-0497 (Deal Card 19).

## Blockers / pending Tyler decisions

- Tyler's usefulness review of the Lead Workspace as the primary operator
  surface (capability freeze is regression protection only).
- QA fixture disposition: deals 21-24 were created additively by independent
  QA this sprint (21 unresolved, 22 resolved, 23/24 genuine wrong-parcel
  hard-stop research cards). Keep or trash is Tyler's call.
- Deal 19 restoration review: a QA intake through the (now fixed) defective
  dedupe path overwrote accepted identity records; everything operator-visible
  was restored from QA-captured payloads (activity kind
  `accepted_identity_restored`, agent `landos-repair`); the original
  lane-level resolution-snapshot detail was not recoverable (disclosed).
- 2026-07-15: Tyler explicitly authorized committing and pushing completed
  LandOS work to origin/main (no deployment). Nothing was committed or pushed
  this session pending his review of the above items; local-only exclusions
  are listed in `.gitignore` under the LandOS scratch block.
