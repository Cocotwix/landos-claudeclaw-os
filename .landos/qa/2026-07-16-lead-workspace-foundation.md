# Durable QA record — Lead Workspace foundation (journey runs)

Journey: `lead-workspace-acquisitions-readonly` — Base URL http://localhost:3141.
Source runs live under `.runtime/landos/qa/` (local-only, gitignored;
screenshots stay local). This file preserves the durable conclusions for
handoff.

## Run history

| Run | Bundle | Result |
|---|---|---|
| `qa-2026-07-16T00-27-14-098Z` | previous production bundle | **FAIL** — `refresh_persistence`: after browser reload on `/dept/acquisitions?deal=20` the Lead Workspace no longer appeared; all 11 other steps passed |
| `qa-2026-07-16T03-25-28-832Z` | fresh bundle built 2026-07-16T03:2x from the current tree | **PASS** — all 12 steps, including refresh persistence |
| `qa-2026-07-16T03-26-11-721Z` | same fresh bundle (repeat for stability) | **PASS** — all 12 steps |

## Verified journey steps (passing runs)

Safe fixture deal card 20; Acquisitions deep link `/dept/acquisitions?deal=20`;
`lead-workspace-root` present exactly once; API
`/api/landos/lead-workspace/20` -> 200 and reconciles; exactly five approved
strategies rendered; legacy `deal-card-root` absent (quarantine holds);
desktop screenshot; **reload survives (refresh persistence)**; Galaxy S24
Ultra viewport 412x915 keeps the root and all five strategies; mobile
screenshot. Preflight on the passing runs verified a fresh production build,
exactly one healthy managed server, and served bundle == `dist/web`.

## Conclusion

The refresh-persistence failure observed at 00:27Z does not reproduce on the
current tree's fresh production bundle (two consecutive passing real-browser
runs). The journey is green, but the sprint gates are NOT yet satisfied:
`ws1-workspace-contract` has no recorded phases and no formal `qa-brief` /
`qa-result` in the ledger, so LW1–LW6 remain unverified.

Next engineering action: run the staged lifecycle for
`sprint-2026-07-15-lead-workspace-foundation` — record WS1 phases
(implementation → targeted_tests → integration_tests → typecheck →
production_build → runtime_verification), issue `qa-brief`, run the
independent `landos-browser-qa` agent, record `qa-result`, then proceed to
`ws2-workspace-ui` per `docs/landos/Staged_Sprint_Lifecycle.md`. Keep the
00:27Z refresh failure in mind as a possible stale-bundle-sensitive
regression; if it recurs, treat it as a shared root-cause review candidate.
