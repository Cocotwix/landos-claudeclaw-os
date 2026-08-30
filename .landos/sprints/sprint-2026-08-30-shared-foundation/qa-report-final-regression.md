# Shared Foundation Consolidation — Final Regression

Date: 2026-08-30
Result: PASS for the accepted sprint scope

## Acceptance coverage

- WS2 browser recheck passed on unresolved Deal 93 and resolved Deal 92. The
  unresolved subject showed `2 / 18 Returned`, `13 WAITING ON SUBJECT`, and one
  genuine blocker while county-safe research remained available. The resolved
  subject showed `11 / 18 Returned`. Hard refresh preserved both reads, emitted
  no writes, and left the browser console clean.
- WS3 passed with durable run `intel_92_mtgf3m07`. The running view rejoined
  after refresh, operator cancellation persisted through refresh and a managed
  restart, the run lost publication authority, and zero evidence/snapshot rows
  were written for that cancelled run.
- WS4 passed with a disposable controlled Deal 94 fixture. One extracted county
  GIS road-frontage fact was admitted to the canonical evidence table with its
  provenance and reconciled Research Readiness to RETURNED; a `not_found` fact
  was not admitted. Refresh preserved the read. The fixture was removed after
  verification.
- The live browser console was clean for the final refresh journeys, and no
  page-load or navigation research mutations were observed.

## Automated verification

- Sprint-focused contract suite: 172/172 passing across canonical subject
  state, declared prerequisites, readiness/coverage/result vocabulary, durable
  run identity/progress, guarded Property Intelligence persistence, unified
  evidence admission, mission identity, and intelligence-stack behavior.
- Route regression suite: 66/66 passing in isolation. Its one content-hash
  mismatch when run concurrently with the contract batch did not reproduce in
  isolation and the same file also passed during the full repository run.
- TypeScript: `npm run typecheck` passed.
- Production build: `npm run build:web` passed after the final implementation.
- Managed restart and health check passed; browser acceptance was repeated
  against the restarted build.

## Repository-wide suite observation

The broad repository run completed with 7,969 passing, 3 skipped, and 41
failing tests. The failures are baseline/stale contracts outside this sprint:
old source-shape UI assertions, browser-ownership fixtures, checkpoint fixture
expectations, and unrelated timing/wording assertions. Representative failures
point to files and code regions untouched by this sprint; the few failing files
that scan `routes.ts` or the V2 page assert pre-existing imports/layout and do
not intersect the foundation diffs. The sprint-specific and route behavioral
contracts above are green, so these failures were not broadened into this
accepted stabilization sprint.

## Deferred adjacent item

F3 remains deferred: direct per-panel capability POST endpoints still gate on
subject-card existence instead of consuming the declared parcel prerequisite.
Readiness, coverage, and mission planning do consume the declarations, so F3
does not block the accepted sprint outcome and remains recorded rather than
misrepresented as repaired.
