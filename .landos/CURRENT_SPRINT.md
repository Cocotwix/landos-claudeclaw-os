# LandOS Current Sprint (superseded — history only)

Superseded 2026-07-14 by `.landos/CHECKPOINT.md`. Do not update this file and
do not treat it as current; the content below is a stale 2026-07-04 snapshot
retained as on-demand history.

## Current Sprint

**Name:** Acquisition Specialist dashboard-visible Property Card acceptance
**Status:** In progress
**Department / employee:** Acquisition Specialist
**Business objective:** Tyler can open the real LandOS dashboard and use the
verified Property Card as a practical discovery-call workspace.

## Autonomy Standard

Default is autonomy. Continue until the business outcome works unless the task
hits one of the approval gates in `docs/landos/LandOS_Build_Rules.md`.

Every implementation sprint ends with:

1. Engineering QA.
2. Operator QA.
3. Business QA.
4. Memory updates.

## Current Status

- Smart Intake accepts raw operator input and autocomplete is not authoritative.
- Property Resolution owns identity resolution and browser escalation.
- Property Inspection, Comparable Intelligence, Market Intelligence, and
  Discovery Call Intelligence have implementation paths.
- The current blocker is dashboard visibility and usability in Property Board,
  not raw intake.
- Session-memory commands and QA ledgers now exist for CC/Codex continuity.

## Sprint Rules

- Do not redesign LandOS architecture.
- Preserve reusable Property Inspection and Discovery Call workflow.
- Do not move intelligence ownership into a one-off UI dump.
- Do not call paid LandPortal reports or credit-consuming endpoints.
- Do not write private property work product into repo memory.
- The dashboard-visible card must be operator-first, not developer-trace-first.

## Current Blocker

The real Property Board UI still needs to visibly render the persisted
inspection/discovery output and suppress confusing duplicate cards.

## Next Exact Task

Finish the Property Board workspace:

1. Suppress or merge weak duplicate cards when a verified same-property card
   exists.
2. Remove old Duke/LandPortal paid-credit UI from the new Property Card flow.
3. Render persisted inspection facts, visuals, overlays, normalized comps,
   Market Intelligence, and Discovery Call Intelligence.
4. Rebuild and verify the real dashboard route.
5. Record Operator QA and Business QA.

## Already Attempted

- Raw Smart Intake acceptance path.
- Real dashboard-backed workflow against `store/landos.db`.
- Property Inspection persistence into Property Card activity.
- Initial command/memory scaffolding.
- Governance reset to autonomy by default.

## Do Not Repeat

- Do not treat passing tests as operator acceptance.
- Do not treat storage existence as dashboard visibility.
- Do not let autocomplete influence submitted raw lead input.
- Do not call paid LandPortal reports or credit-consuming endpoints.
