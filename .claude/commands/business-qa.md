---
description: "Evaluate a LandOS department as a business employee"
---

# /business-qa

Use this after engineering QA and Operator QA for any implementation sprint
that affects a department, employee, or business workflow.

## Required Context

Read only:

1. `.landos/CODING_SESSION_PROTOCOL.md` (skip if already loaded this session)
2. `.landos/CHECKPOINT.md` (skip if already loaded this session)

Do not load `.landos/HANDOVER.md`, `.landos/BUSINESS_QA.md`,
`.landos/CHAT_CONTEXT.md`, `.landos/CURRENT_SPRINT.md`,
`.landos/CONTINUITY_PROTOCOL.md`, or `LANDOS_CURRENT_STATE.md`. Those are
retired or history-only. Retrieve a specific past fact with
`npm run landos:memory:retrieve -- <query>` and read only the returned excerpt.

## QA Standard

Evaluate the department as an employee.

Ask:

> Does this employee create measurable business value?

If no, record the specific missing business value and report it. Improve only
within the accepted request's scope; a gap outside it is a deferred finding, not
new work. Stop when Tyler accepts the outcome, when an approval gate is reached,
or when the remaining gap is out of scope.

## Record

Append a concise entry to `.landos/BUSINESS_QA.md`:

- business outcome expected
- operator/user served
- result
- measurable business value
- missing business value
- evidence inspected
- first business blocker
- root cause
- next exact task
- what not to repeat

## Rules

- Do not expose secrets or private deal data.
- Do not use paid APIs, money, external account mutation, or deployments without
  Tyler approval.
- Do not push.
