# Durable QA record — combined operator regression (all journeys)

- Latest source run: `.runtime/landos/qa/qa-2026-07-16T03-26-37-139Z/`
  (local-only, gitignored; screenshots stay local). An earlier run at
  `qa-2026-07-16T00-00-40-011Z` produced the same journey verdicts. This file
  preserves the durable conclusions for handoff.
- Journey set: `all` — Base URL: http://localhost:3141
- Preflight: PASS (fresh production bundle, exactly one healthy managed
  server, served bundle == dist/web)
- Overall: **FAIL** (exit code 1) — 10 pass, 2 fail, 1 fixture-unavailable,
  2 mutation-refused

## Journey results

| Journey | Result |
|---|---|
| lead-workspace-acquisitions-readonly | PASS |
| verified-property-strong-evidence | PASS |
| verified-property-incomplete-research | PASS |
| existing-unresolved-property | PASS |
| new-property-resolves | MUTATION_REFUSED (not run — QA never mutates operator data) |
| new-property-honestly-unresolved | MUTATION_REFUSED (not run) |
| genuine-apn-conflict | **FAIL** |
| acreage-conflict-requires-tyler | PASS |
| strong-comp-market | **FAIL** |
| thin-comp-market | FIXTURE_UNAVAILABLE |
| provider-failure-fallback | PASS |
| multi-parcel-property | PASS |
| refresh-persistence | PASS |
| managed-restart-persistence | PASS |
| dashboard-shell-health | PASS |

## Open failure details (legacy journeys, unrelated to Lead Workspace)

1. `genuine-apn-conflict` — the APN is visible on the conflict fixture card,
   but the conflict itself is not disclosed: none of "conflict" / "Conflict" /
   "mismatch" appears on the live page. The conflict must be surfaced, not
   hidden.
2. `strong-comp-market` — the comps API (`/api/landos/deal-cards/15/comps`)
   reconciles with the visible card, but no price-per-acre values are visible
   (none of "/ac", "per acre", "$" on the live page). Consistent with the
   WS4-scoped seed finding `comp-registry-unit-suffix-under-merge`.
3. `thin-comp-market` — no fixture available; needs a thin-market fixture
   before the journey can run.

## Conclusion

Both failures are legacy Deal Card surfaces owned by the paused
`sprint-2026-07-15-dealcard-v2` (WS4 comps/valuation and APN-conflict
surfacing). They are recorded here so a fresh engineer does not rediscover
them; do not fix them ad hoc — route them through the staged sprint
lifecycle in their owning workstreams.
