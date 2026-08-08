---
description: "Run and record LandOS operator-visible dashboard QA"
---

# /operator-qa

Use this for dashboard-backed LandOS operator acceptance checks after
engineering QA.

## Required Context

Read only:

1. `.landos/CODING_SESSION_PROTOCOL.md` (skip if already loaded this session)
2. `.landos/CHECKPOINT.md` (skip if already loaded this session)

Do not load `.landos/HANDOVER.md`, `.landos/OPERATOR_QA.md`,
`.landos/CHAT_CONTEXT.md`, `.landos/CURRENT_SPRINT.md`,
`.landos/CONTINUITY_PROTOCOL.md`, or `LANDOS_CURRENT_STATE.md`. Those are
retired or history-only. Retrieve a specific past fact with
`npm run landos:memory:retrieve -- <query>` and read only the returned excerpt.

## Proportionality

This command is for Tier 2 and Tier 3 changes as defined by the contract. A
Tier 1 change (no owner-visible effect) does not get an Operator QA pass. Check
only the sections the change actually touched; record anything else you notice
as a deferred finding rather than expanding this pass.

## QA Standard

The acceptance question is: can Tyler open the LandOS dashboard and use the
visible output without needing hidden logs or developer explanation?

Stronger test:

> Would Tyler actually use this instead of the existing tool?

If no, record what is missing and report it. Improve only within the accepted
request's scope; a gap outside it is a deferred finding, not new work. Stop when
Tyler accepts the outcome, when an approval gate is reached, or when the
remaining gap is out of scope.

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
