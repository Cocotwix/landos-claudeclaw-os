---
description: "Run a LandOS sprint through the enforced staged lifecycle (ledger, browser QA, repair loop, final review)"
---

# /landos-sprint

Use this whenever a substantial LandOS prompt arrives (any prompt with more
than one project, or any change that alters what Tyler sees in the dashboard).

Read `docs/landos/Staged_Sprint_Lifecycle.md` and follow it exactly. In brief:

1. Decompose the prompt into a plan JSON (workstreams with the 19 ledger
   fields; preserve the prompt verbatim) and run
   `npm run landos:sprint -- create --file <plan.json>`.
2. For each workstream in order: `start`, implement, record `phase` results
   (targeted tests → integration tests → typecheck → production build →
   runtime_verification via the managed runtime), then `qa-brief` and hand off
   to the **landos-browser-qa** agent. Never skip browser QA; never begin the
   next workstream first.
3. Repair every finding (`repair` with regression coverage), send back for
   `--recheck`, close findings only via `retest`.
4. `accept <wsId>` — if it refuses, fix the refusals; never work around them.
5. After all workstreams: hand off to the **landos-final-reviewer** agent for
   the final combined regression and review, then `complete`.
6. `capability freeze` for newly accepted capabilities, then
   `npm run landos:memory:checkpoint` and `npm run landos:memory:audit`.

Rules that never bend: the live operator experience is the acceptance
standard; completion claims require `[E:<id>]` ledger evidence; internally
fixable defects are never "externally blocked"; accepted operator information
never changes without Tyler; use only the managed runtime commands.
