---
description: "Resume LandOS with shared operating memory"
---

# /continue-landos

Load LandOS operating memory, orient the session, identify the next recommended
task, then wait for Tyler.

## Read First

1. `LANDOS_CURRENT_STATE.md`
2. `.landos/CHAT_CONTEXT.md`
3. `.landos/CURRENT_SPRINT.md`
4. `.landos/PROJECT_MEMORY.md`
5. `.landos/DECISIONS.md`
6. `.landos/OPERATOR_QA.md`
7. `.landos/BUSINESS_QA.md`
8. `.landos/KNOWN_LIMITATIONS.md`
9. `.landos/CONTINUITY_PROTOCOL.md`
10. `.landos/HANDOVER.md`
11. `docs/landos/LandOS_Build_Rules.md`
12. `docs/governance/07_Product_Principles.md`

## Inspect

- `git status --short`
- `git log --oneline -5`
- `docs/reference-ui/` for latest safe visual acceptance artifacts
- If the current task is dashboard-backed, inspect `store/landos.db` read-only.
  Do not print secrets or write real property identifiers into repo docs.

## Report Before Work

Return a concise start summary:

- Latest commit
- Current business objective
- Current department / employee
- Current milestone
- Current dashboard state
- Current operator complaint
- Current blocker
- Failed Operator QA, if any
- Latest Business QA finding, if any
- Reference assets
- Conversation context
- Next exact deliverable
- Things already attempted
- What not to repeat
- Recommended next task
- Uncommitted changes

Then stop and wait for Tyler.

## Rules

- `/continue-landos` is orientation-only by default. Do not start
  implementation, tests, builds, or edits beyond the orientation/status pass.
- Only begin execution if Tyler explicitly says one of the following:
  - `continue execution`
  - `run the next sprint`
  - `start the build`
  - `implement it`
- Approval gates are secrets, `.env`, API keys/passwords, paid APIs, external
  account mutation, money, destructive deletes, `git push`, and deployments.
- Do not push or deploy.
- Do not replace LandOS architecture, governance, product principles, commands,
  or docs.
- Do not write property-specific business work product into repo memory.
- Preserve LandOS as the source of truth.
