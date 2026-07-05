# LandOS Current State

LandOS is the main app built on ClaudeClaw.
Departments are internal apps inside LandOS.
No department is the center of gravity.
LandOS Main is the CEO, executive-assistant, and orchestrator.
War Room can talk across departments.
Deal Cards are shared business records.
Tyler, the human operator, is the final decision-maker.
LandOS is a business operating system, not an attorney, title company, or legal-review system; Tyler is the final authority.
For pre-contract work, LandOS uses approved provider data (LandPortal, Realie, County GIS, FEMA, NWI, USGS, Census, Redfin, Zillow, + future Tyler-approved), shows where each fact came from and how confident it is, flags real gaps, and recommends the next action. Official/county confirmation is reserved for post-contract legal-financial execution.

## Operating Model

- Prefer the dashboard and shared records over private agent memory.
- Prefer source labels and confidence labels over implied certainty.
- Keep area-level context available even when parcel verification is incomplete.
- Treat technical run details as support material, not the main business surface.
- Default is autonomy. Continue until the business outcome is complete unless a
  hard approval gate is reached.
- Every implementation sprint ends with engineering QA, Operator QA, Business
  QA, and session-memory updates.
- Passing tests is not enough if Tyler cannot use the dashboard or the
  department does not create measurable business value.

## Structure Categories

LandOS structure is split into four categories so concepts are not all treated
as department legs:

- Department legs: due-diligence-research, strategy, market-research,
  crm-acquisition-ghl, marketing, dispositions, transactions, finance,
  ai-watcher, forge. Legs write to contracts/surfaces/Deal Cards; legs never
  orchestrate other legs.
- Shared surfaces: landos-command (the only orchestrator), war-room (existing
  cross-agent conversation surface, preserved as built by Mark/ClaudeClaw).
- Shared records: deal-cards.
- Interface layers: voice-layer (input/output only, not business logic).

No department is the center of gravity. LandOS Command is the only orchestrator.
The canonical structure layer (src/landos/landos-structure.ts) references the
existing department-registry.ts IDs rather than redefining departments.
