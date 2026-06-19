# LandOS Current Sprint

Current active sprint: LandOS Command + Deal Card + Department Leg Foundation.

Phase 1 Build Memory Spine is complete and committed (d8d99e4).

This sprint establishes the LandOS-wide operating shell first, not any single
department. It adds the structural spine that was missing: the category
taxonomy (department legs vs shared surfaces vs shared records vs interface
layers), the no-center-of-gravity invariant, the War Room preservation +
routing connection contract, the storage policy contract, and the
operator-facing command request/response contracts with deterministic routing.

Much of the deeper machinery already exists and is reused, not rebuilt:
- Deal Cards already persist to the local SQLite store (gitignored): see
  deal-card.ts (createDealCard / getDealCard / updateDealCard / listDealCards).
- The orchestrator already exists as planLandosIntake() -> WorkerDispatchPlan.
- Two registries already exist (department-registry.ts capability registry,
  departments.ts display registry).
- .gitignore already keeps property data/media/reports out of the repo
  (data/ deals/ transcripts/ training/ *.pdf *.csv *.xlsx ...).

## Sprint Rules

- Align to and harden existing structures. Do not create duplicate registries,
  duplicate orchestrators, duplicate dashboards, or competing department
  definitions.
- LandOS Command is the only orchestrator. No department leg is the center of
  gravity.
- Preserve Mark/ClaudeClaw's existing War Room page and its cards (Voice, Text,
  Live Meetings, Voice config, Standup roster, Open in classic). War Room work
  is additive routing/connection only, never a redesign.
- GHL/CRM is not connected. Do not pretend it is. CRM/Acquisition/GHL is a
  planned shell leg with a future integration contract only.
- Voice is an input/output interface layer, not a business-logic department.
- Stop at the cleanest compiling + tested checkpoint. Prefer a smaller clean
  pass over a larger broken pass.

## Checkpoint Status

- Checkpoint 1 (in progress): structure spine + storage policy + command
  contracts + routing v1, as pure TypeScript modules with tests. No UI changes.
- Checkpoint 2 (next): LandOS Command home tiles UI consuming the structure
  summary, War Room non-destructive visual connection entry point, Deal Card
  layout-section coverage + create/edit/save/reload/update test hardening.
