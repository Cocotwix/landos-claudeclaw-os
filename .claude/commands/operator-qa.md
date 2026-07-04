---
description: "Run and record LandOS operator-visible dashboard QA"
---

# /operator-qa

Use this for dashboard-backed LandOS operator acceptance checks after
engineering QA.

## Required Context

Read:

1. `LANDOS_CURRENT_STATE.md`
2. `.landos/CHAT_CONTEXT.md`
3. `.landos/CURRENT_SPRINT.md`
4. `.landos/CONTINUITY_PROTOCOL.md`
5. `.landos/HANDOVER.md`
6. `.landos/OPERATOR_QA.md`

## QA Standard

The acceptance question is: can Tyler open the LandOS dashboard and use the
visible output without needing hidden logs or developer explanation?

Stronger test:

> Would Tyler actually use this instead of the existing tool?

If no, continue improving unless an approval gate blocks progress.

For Property Card work, check:

- Correct card appears in dashboard list.
- Weak duplicate cards are suppressed or clearly not operator-facing.
- Opening the verified card shows the operator workspace.
- Inspection facts are visible.
- Visuals/screenshots are visible and useful.
- Overlay results are visible.
- Comparable Intelligence is visible and not contradicted elsewhere.
- Market Intelligence is visible.
- Discovery Call Intelligence is visible.
- Acquisition strategies match the approved product scope.
- Seller questions are property-specific and concise.

## Store Results

Append a concise entry to `.landos/OPERATOR_QA.md` using its template.
Add safe redacted UI artifacts under `docs/reference-ui/` when they help future
sessions verify what Tyler saw.

## Rules

- Do not mutate external systems.
- Do not use paid tools or credit-consuming endpoints.
- Do not expose secrets or credentials.
- Do not push or deploy.
- Do not record real APNs, seller details, private addresses, or raw parcel
  reports in repo docs.
