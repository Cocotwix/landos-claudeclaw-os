# LandOS Current State

This is the canonical current-state document for every coding agent during the
LandOS build phase.

As LandOS becomes a fully operational business system, this file should evolve
from build handoff into an executive operating brief.

## Current Business Objective

Make the Acquisition Specialist useful in the real LandOS dashboard for seller
discovery-call preparation.

## Current Department / Employee

Acquisition Specialist.

## Current Milestone

Dashboard-visible Property Card acceptance.

Tyler should be able to open the verified Property Card and see a practical,
readable acquisition workspace with inspection facts, visuals, normalized comps,
Market Intelligence, Discovery Call Intelligence, seller questions, and clear
next actions.

## Latest Commit

Last observed latest commit during memory cleanup:

`b972087 Wire Market Matrix into Property Card and Discovery Report`

Run `git log --oneline -5` at session start to confirm this is still current.

## Current Dashboard Status

- Real dashboard DB: `store/landos.db`.
- Verified Property Card exists for the current operator acceptance property.
- A weaker duplicate card exists or existed from earlier raw-intake runs.
- Tyler reported the real UI still showed stale Duke/LandPortal credit UI and
  did not show the new inspection/discovery workspace.
- The next session must verify the live dashboard, not only code or tests.

## Current Operator Complaint

Tyler opened the real LandOS webpage and could not see the claimed Property
Card output: screenshots, overlays, inspection facts, normalized comps, and
Seller Call Brief were not visibly available in the Property Board card.

## Current Blocker

The Property Board UI and persistence/list wiring are not yet operator-usable:
duplicate cards, stale paid-credit UI, and missing dashboard-visible
inspection/discovery sections remain the business blocker.

## Failed Operator QA

See `.landos/OPERATOR_QA.md`.

Latest result: failing in real UI. Storage may contain data, but Tyler could not
visibly use it in the dashboard.

## Failed Business QA

See `.landos/BUSINESS_QA.md`.

Latest result: Acquisition Specialist is in progress. It is not production-useful
until the real Property Card prepares Tyler for a live seller discovery call.

## Next Exact Deliverable

Finish the Property Board workspace:

1. Suppress or merge weak duplicate cards when a verified same-property card
   exists.
2. Remove old Duke/LandPortal paid-credit UI from the new Property Card flow.
3. Render persisted inspection facts, visuals, overlays, normalized comps,
   Market Intelligence, and Discovery Call Intelligence.
4. Rebuild and verify the real dashboard route.
5. Record Operator QA and Business QA.

## Reference Assets

Use `docs/reference-ui/` for redacted dashboard screenshots and visual
acceptance artifacts.

Current folders:

- `docs/reference-ui/Market Intelligence/`
- `docs/reference-ui/Browser Agent/`
- `docs/reference-ui/Deal Card/`
- `docs/reference-ui/Discovery Report/`

## Lessons Learned

- Tests and DB persistence are not enough. Tyler must be able to see and use the
  output in the real dashboard.
- Smart Intake must be raw intake only; suggestions cannot rewrite, gate, or
  influence submitted lead input.
- LandPortal is a provider, not the architecture. Do not use paid LandPortal
  reports without approval.
- Property Inspection is reusable business capability memory, not Deal Card UI
  ownership.

## Decisions Made

- Default governance is autonomy.
- Approval gates are limited to secrets, `.env`, API keys/passwords, paid APIs,
  external accounts, money, destructive deletes, `git push`, and deployments.
- Every implementation sprint ends with engineering QA, Operator QA, Business
  QA, and memory updates.
- Screenshots/reference visuals are acceptance artifacts, not inspiration.

## What Not To Repeat

- Do not stop at "code exists."
- Do not rely on in-memory tests as proof of operator acceptance.
- Do not make Tyler re-explain current state if `.landos` memory already has it.
- Do not store private property work product, APNs, seller details, secrets, or
  raw parcel reports in repo memory.
