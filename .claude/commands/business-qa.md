---
description: "Evaluate a LandOS department as a business employee"
---

# /business-qa

Use this after engineering QA and Operator QA for any implementation sprint
that affects a department, employee, or business workflow.

## Required Context

Read:

1. `LANDOS_CURRENT_STATE.md`
2. `.landos/CHAT_CONTEXT.md`
3. `.landos/CURRENT_SPRINT.md`
4. `.landos/CONTINUITY_PROTOCOL.md`
5. `.landos/HANDOVER.md`
6. `.landos/BUSINESS_QA.md`

## QA Standard

Evaluate the department as an employee.

Ask:

> Does this employee create measurable business value?

If no, continue improving unless an approval gate blocks progress.

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
