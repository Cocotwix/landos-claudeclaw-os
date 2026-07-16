# Durable QA record — combined operator regression (all journeys)

- Latest source run: `.runtime/landos/qa/qa-2026-07-16T12-36-55-717Z/`
  (local-only, gitignored; screenshots stay local). This file preserves the
  durable conclusions for handoff. It supersedes the earlier record from runs
  `qa-2026-07-16T03-26-37-139Z` / `qa-2026-07-16T00-00-40-011Z`.
- Journey set: `all` — Base URL: http://localhost:3141
- Preflight: PASS (fresh production bundle, exactly one healthy managed
  server, served bundle == dist/web)
- Overall: exit 1 — **11 pass, 1 fail, 1 fixture-unavailable,
  2 mutation-refused** (was 10/2/1/2 at the previous record; the
  `genuine-apn-conflict` journey moved FAIL -> PASS via this sprint's
  system-wide engine fix).

## Journey results

| Journey | Result |
|---|---|
| lead-workspace-acquisitions-readonly | PASS |
| verified-property-strong-evidence | PASS |
| verified-property-incomplete-research | PASS |
| existing-unresolved-property | PASS |
| new-property-resolves | MUTATION_REFUSED (not run — QA never mutates operator data) |
| new-property-honestly-unresolved | MUTATION_REFUSED (not run) |
| genuine-apn-conflict | **PASS** (fixed by sprint-2026-07-15-lead-workspace-foundation) |
| acreage-conflict-requires-tyler | PASS |
| strong-comp-market | **FAIL** |
| thin-comp-market | FIXTURE_UNAVAILABLE |
| provider-failure-fallback | PASS |
| multi-parcel-property | PASS |
| refresh-persistence | PASS |
| managed-restart-persistence | PASS |
| dashboard-shell-health | PASS |

## Open items (owned by paused sprint-2026-07-15-dealcard-v2, WS4)

1. `strong-comp-market` — the comps API reconciles with the visible legacy
   Deal Card, but no price-per-acre values render on the legacy `/landos`
   surface. Matches the WS4-scoped seed finding
   `comp-registry-unit-suffix-under-merge` in the paused dealcard-v2 ledger
   (`ws4-comps-valuation`, status planned). Deferred there by Tyler's explicit
   direction; do not fix ad hoc. Note: the NEW Lead Workspace renders
   normalized $/acre correctly from the validated registry — the defect is
   confined to the legacy card surface.
2. `thin-comp-market` — no fixture with a genuinely thin validated comp set
   exists; the journey reports FIXTURE_UNAVAILABLE (honest gap, never a
   fabricated pass). Explicitly excluded from the Lead Workspace sprint's
   acceptance matrix. WS4 owns the fixture decision (repair criteria, add a
   stable repository-owned fixture, or retire the journey).

## Notes

- Both wrong-parcel hard stops are now covered live: the `genuine-apn-conflict`
  journey selects only fixtures with a recorded resolution `identityConflict`
  (fuzzy text matching removed) and asserts both identifiers plus the block
  reason are disclosed with no false verification.
- The genuine-conflict fixtures are QA-created deals 23 and 24
  (self-labeled). Keep-or-trash disposition is Tyler's.
