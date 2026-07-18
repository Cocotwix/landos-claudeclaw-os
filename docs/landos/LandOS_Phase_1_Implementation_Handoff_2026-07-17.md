# LandOS Phase 1 Implementation Handoff

Date: 2026-07-17
Purpose: Standalone outcome-focused prompt for a fresh implementation session
Source audit:
[LandOS_Strategic_Reset_Audit_2026-07-17.md](./LandOS_Strategic_Reset_Audit_2026-07-17.md)

## Read this first

This handoff authorizes a fresh implementation session to inspect, design,
delegate, refactor, migrate, implement, test, repair, and verify Phase 1
autonomously.

It does not prescribe files, functions, or an internal implementation plan.
The implementation session owns those decisions after inspecting current live
state.

Do not continue the paused Deal Card v2 sprint as written. Do not implement
later departments in depth during Phase 1.

Follow repository safety rules:

- Preserve all real property, seller, evidence, document, visual, activity,
  research, decision, and operator records.
- Never overwrite accepted operator information without owner confirmation.
- Back up and reconcile data before migration.
- Use only canonical managed runtime commands.
- Do not access, print, commit, or expose secrets.
- Do not commit or push unless the owner has explicitly authorized the final
  git action. The owner has stated that the completed operating skeleton and
  workflows should ultimately be updated in GitHub, while real business data
  and secrets must not be included.
- Leave the live local application running and report its PID and exact URL.

## Business objective

Deliver the first genuinely operational LandOS loop for a one-person land-
investment company:

> A human can manually enter a lead, LandOS immediately researches the
> opportunity and builds the best available discovery-call package, a human
> acquisition agent conducts the call, the transcript is pasted or uploaded,
> and Jarvis reconciles the call into the shared record with motivation,
> contradictions, research/follow-up tasks, and the best next action.

Target load: five new leads per day.

Nothing blocks the discovery call. Incomplete or conflicting research changes
the call brief and questions. It does not prevent the call.

Wrong-parcel or unresolved identity must still prevent unsupported parcel
claims, confident valuation, offer preparation, or automatic pursuit.

## Product model

### Lead Card

Every incoming lead receives one durable Lead Card, including rejected,
duplicate, unlocatable, dead, nurture, wrong-property, and do-not-contact
outcomes.

The Lead Card is the actionable workspace, not a read-only report. It combines
the reliable information presentation of the current Lead Workspace with the
useful controls currently trapped in the legacy Deal Card.

### Deal Card

When the owner decides to pursue an opportunity after discovery and initial
review, the same opportunity becomes a Deal. Do not copy it into a competing
record model.

The pursued Deal Card receives a subtle but noticeable border/glow treatment so
the owner can distinguish it at a glance.

### Shared records

The authoritative opportunity record links:

- lead;
- contacts, sellers, owners, and heirs;
- property and one-or-more parcels;
- research facts and evidence;
- comparables and valuation snapshots;
- documents, deeds, reports, and visuals;
- communications and transcripts;
- tasks, decisions, approvals, and follow-ups;
- stage/lifecycle history;
- later transaction, disposition, and financial records.

Migrate or adapt existing Property Card and Deal Card data without loss.

## Jarvis and functional agents

Jarvis is the chief of staff:

- knowledgeable across every department and opportunity;
- conversational through text and live two-way voice;
- able to see and discuss the current screen/page;
- able to delegate work to functional department agents;
- able to verify backend records and visible frontend output;
- able to reconcile contradictions and surface uncertainty;
- able to create tasks, update records from approved evidence, schedule follow-
  up, and escalate overdue work;
- allowed to communicate outbound only with the owner;
- prohibited from communicating with leads, sellers, buyers, vendors, or other
  external parties;
- prohibited from taking any paid action or spending money;
- prohibited from sending offers or contracts;
- allowed to prepare internal recommendations and drafts for owner review;
- blocked from deletions and configuration changes unless the owner later
  changes the policy explicitly.

Use functional role labels only. Do not display personal mascot names such as
Duke, Ace, Finn, Mara, Mia, Drew, Rex, Web, or Tutor.

Stable legacy IDs may remain temporarily as migration aliases, but visible
terminology and new contracts should use roles such as:

- Acquisitions Agent
- Property Research Agent
- Market and Valuation Analyst
- Browser Agent
- Transaction Coordinator
- Dispositions Agent
- Finance Agent
- Operations Agent
- Technical/AI Agent

## Required Phase 1 journey

1. Operator manually enters lead and seller-provided property clues.
2. LandOS creates a Lead Card immediately.
3. Research starts automatically and reports progressive status.
4. Property resolution uses address and/or APN with city, county, and state.
5. Authenticated LandPortal browser work, public records, visual capture,
   comparable research, and market research run where available.
6. The Lead Card and downloadable report become usable as evidence arrives.
7. The discovery call occurs even when the property is unresolved.
8. Operator pastes transcript or uploads a transcript file.
9. Jarvis and the Acquisitions Agent preserve the transcript, summarize it,
   update seller statements, score motivation, identify contradictions, create
   research and follow-up work, and recommend a next action.
10. Owner chooses whether to pursue and promote the opportunity to Deal status.
11. The complete state survives refresh and managed restart.

## LandPortal non-negotiable

The LandPortal API is off-limits. Do not call it, configure it, use it as a
fallback, or route through its MCP wrapper. The only approved LandPortal access
path is the authenticated browsing agent.

Required browser behavior:

- reuse the operator's authenticated persistent browser session;
- search/navigate using address, APN, city, county, and state;
- read only visible parcel data and seller/owner information;
- capture high-resolution parcel/boundary imagery;
- read visible comparable rows;
- click the free Show on Map link and capture the comparable map;
- capture satellite and relevant overlay/terrain views;
- persist facts and images with page/source provenance;
- never buy a report, consume a credit, change settings, or perform a write;
  paid LandPortal actions are prohibited.

Current reusable code exists in browser-session, landportal-browser,
property-inspection, comp extraction/registry, visual/report services, and
their tests.

Important current-state warning: the repository has not fully completed the
browser pivot. Legacy LandPortal token/API and MCP paths remain reachable in
some reports, manual endpoints, intake screens, and the named due-diligence
agent. Disable them before live use. Map references, preserve only useful
non-network parsing/data, remove them from runtime selection, and delete or
archive the obsolete implementation safely. Do not claim that current
production is already browser-only until this is proven.

Recent persisted successful LandPortal screenshot/comparable captures found
during the audit dated to July 9; newer inspection activities did not contain
assets/comps. Re-prove the current browser flow live rather than trusting old
acceptance narrative.

Preferred comp sources:

1. LandPortal visible browser rows and Show on Map.
2. Zillow.
3. Redfin.

County, recorder, GIS, and public sources remain important for property and
deed verification.

## Discovery-call report

The same current report object must drive the Lead Card call-prep view and
downloadable PDF. Avoid separate contradictory projections.

### Identity and seller

- lead identity and available contact context;
- lead source;
- property location/address, county, state, and APN;
- resolution status, confidence, sources, and contradictions;
- apparent record owners;
- deed-extracted owners, heirs, easements, and restrictions;
- clear statement that automated deed review is research, not title/legal
  confirmation.

If the property is unresolved, create a call brief that asks the human agent to
confirm the missing identity clues.

### Visuals and land characteristics

- high-definition parcel image with highlighted boundary;
- satellite capture;
- spatially valid Street View capture when available;
- 3D/topographic capture when slope exceeds 10 percent;
- wetlands, flood, terrain, and useful overlay captures;
- vision-generated bird's-eye description;
- acreage/conflicts;
- road frontage and landlocked/access assessment;
- wetlands/flood;
- slope/buildability;
- soil-based directional septic/percolation likelihood;
- zoning and restrictions;
- utilities/public water;
- manufactured-home allowance or nearby evidence;
- property condition and improvements;
- source, date, parcel association, and confidence for every fact/visual.

### Comparable policy

- sold properties determine preliminary value;
- pending and active properties are informational only;
- return up to five best sold comparables;
- prioritize land relevance, shape, acreage similarity, distance, recency, and
  market similarity;
- search approximately 3 miles, then 5, then 10;
- expand county-wide only when the local rural market remains thin;
- prominently disclose county-wide expansion on the Lead Card and report;
- search 12 months, then 18, then at most 24 months;
- never use a sale older than two years in the initial report;
- show radius/geography, time window, exclusions, sample count, and expansion
  reasons;
- deduplicate the same property across providers;
- provide a clearly labeled low-confidence range even when the market is thin.

Initial offer guidance is 40 to 60 percent of preliminary fair market value.
Do not deduct closing, holding, cleanup, financing, improvement, or resale
costs until post-discovery underwriting. Show the range; the owner chooses.

### Market Pulse and Land Score

Market Pulse is mandatory:

- real-estate/land market direction;
- price-per-acre context;
- inventory, days on market, sell-through, and absorption where defensible;
- population growth;
- meaningful active/announced local projects;
- geography, sources, dates, and confidence.

Initial Land Score must expose subscores and gaps for:

- identity;
- land characteristics;
- frontage/access;
- wetlands/flood;
- slope/buildability;
- septic/utilities;
- zoning/use;
- marketability;
- market strength/growth;
- comp quality;
- strategy fit.

### Strategies

Show the two strongest first-look strategies rather than forcing a large matrix:

- Cash Flip
- Subdivide or Minor Split
- Novation or Double Close
- Land-Home Package
- Improvement Then Flip when facts support it

For each show fit, opportunity logic, unknowns, validation work, and
disqualifiers.

### Call preparation and output

- executive call brief;
- source-aware known facts;
- questions derived from gaps and contradictions;
- motivation, price, timeline, authority/heirs, access, utilities, condition,
  improvements, liens, prior offers, financing, and reason-for-sale prompts;
- directly visible Lead Card report;
- concise call-prep mode;
- downloadable PDF;
- stable future synchronization point for GoHighLevel.

Missing deed, comps, provider failure, or unresolved identity creates visible
work and call questions. It does not block the discovery call.

## Transcript reconciliation

Support pasted text and uploaded transcript files initially.

Required outputs:

- immutable original transcript;
- concise call summary;
- seller statements distinguished from verified facts;
- all named sellers, owners, heirs, and decision-makers;
- motivation score with evidence;
- asking price and timeline;
- property statements;
- contradictions with current research;
- deeper-research tasks;
- follow-up call/tasks;
- recommended next action:
  - deeper underwriting;
  - more research;
  - prepare offer;
  - follow up;
  - nurture;
  - dead lead;
  - wrong property;
  - do-not-contact.

## Dashboard requirements

Mission Control and LandOS Spine currently disagree with Acquisitions and the
database. Phase 1 must make executive counts derive from the same opportunity
records.

At minimum show:

- new leads;
- research running/failed/incomplete;
- discovery calls needing preparation;
- calls completed awaiting transcript;
- transcripts awaiting reconciliation;
- owner decisions;
- follow-ups due/overdue;
- pursued deals;
- browser/provider failures;
- approval-required actions.

Jarvis must be able to explain every count and open the underlying records.

## Data, privacy, and recovery

- Local execution is the default.
- Cloud models are allowed for ordinary seller/property work under routing
  policy.
- Owner-personal information, credentials, passwords, tokens, API keys, and
  authenticated browser profiles stay local and out of git.
- Real seller, property, deed, transcript, contract, visual, and business
  records stay out of GitHub.
- Use a separate operating database and QA database/artifact root.
- Create an encrypted private backup/restore path for business data.
- A GitHub clone plus .env restores software configuration, not business data;
  verify recovery with an actual backup/restore drill.

GitHub should contain source, generic workflows, schemas/migrations, templates,
tests, setup/deployment automation, and recovery documentation.

## Model gateway

Local/open-weight models are the first choice whenever current evaluation shows
they can perform the task reliably. Re-evaluate them routinely because their
quality and capabilities improve rapidly; model families such as Gemma and
their successors should assume more work as measured performance permits.
Cloud and closed models remain available when they add material capability or
the local path does not meet the task's quality requirements.

Use one gateway for local OpenAI-compatible endpoints and hosted providers.
Route by capability, privacy, quality, latency, cost, context, modality, tools,
and availability.

Evaluate LiteLLM before building a custom protocol gateway. LandOS still owns
business policy, approvals, task contracts, and audit.

Do not let model-router work delay the operational Lead Card. A minimal stable
gateway contract with one local and one cloud-capable path is sufficient for
Phase 1.

## Implementation freedom

The implementation session may:

- consolidate or replace current UI components;
- refactor monoliths;
- add versioned migrations;
- introduce shared runtime schemas and typed contracts;
- deprecate stale paths;
- reuse or remove generic ClaudeClaw surfaces;
- adopt a small external library or service when it materially shortens the
  path and obeys approval rules;
- delegate independent work to subagents.

It must not:

- delete or reset real records;
- silently reinterpret accepted facts;
- create another parallel card/record system;
- use real operating data as QA fixtures;
- invoke, configure, or retain LandPortal API/MCP as a live fallback;
- display personal mascot agent names;
- treat tests or backend payloads as operator acceptance;
- start deep work on later departments before Phase 1 acceptance.

## Acceptance criteria

Phase 1 is complete only when all are true:

1. Manual lead entry creates one durable Lead Card and automatically starts
   research.
2. Real and QA data are visibly and physically separated.
3. Dashboard, Acquisitions, Jarvis, and database counts reconcile.
4. The Lead Card progressively updates and remains actionable.
5. A real authenticated LandPortal browser session extracts visible parcel
   facts, visible comps, Show on Map screenshot, and relevant visual evidence
   without API dependence or paid action.
6. County/public/property research and provider failures are visible and
   recoverable.
7. The comp policy implements radius, recency, county-wide disclosure,
   deduplication, and sold-versus-context rules.
8. The report contains identity, visuals, land characteristics, deed findings,
   Market Pulse, Land Score, preliminary value/offer range, two strategies,
   gaps, sources, confidence, and call questions.
9. An incomplete or unresolved property still produces a useful call brief.
10. Transcript paste and upload both work.
11. Jarvis/Acquisitions reconciliation preserves the transcript and produces
    summary, motivation, contradictions, tasks, follow-up, and next action.
12. Owner can promote the same opportunity from Lead to Deal; the Deal Card has
    the subtle visual highlight.
13. Refresh and managed restart preserve the full state.
14. Five-lead/day synthetic simulation passes in isolated QA storage.
15. One real lead completes the entire workflow live.
16. A private backup/restore drill restores business data into a clean local
    installation.
17. The owner judges the workflow useful.

Tests, build, API responses, and screenshots support these criteria but do not
replace live operator acceptance.

## Verification approach

Use risk-based verification:

- migration backup, rollback, row-count, and record-reconciliation proof;
- focused invariants for parcel identity, accepted facts, the absolute paid-
  action prohibition, owner-only outbound communication, and offer/contract
  sending prohibition;
  and comp policy;
- component/integration coverage for actions and transcript reconciliation;
- isolated synthetic browser journeys;
- one combined authenticated local browser journey;
- hard refresh and managed-restart persistence;
- direct frontend/API/database reconciliation;
- owner acceptance on a real lead.

Do not require a full formal browser gate after every small internal change.
Repair findings and rerun the affected journey, then run the combined Phase 1
journey at the end.

## Required final state

- Production build succeeds.
- Managed LandOS runtime is healthy and remains running.
- Exact server PID and http://localhost:3141 are reported.
- Phase 1 journey is demonstrably usable.
- No real data is lost or mixed with QA.
- Durable documentation and recovery instructions are current.
- Git diff is reviewed for secrets and real business data.
- GitHub update occurs only under explicit final authorization and contains no
  private operating data.

## First implementation action

Inspect live disk, database, runtime, and current operator UI. Then design the
smallest reversible consolidation/migration that can deliver the complete
Phase 1 journey while preserving existing data and reusing the proven browser,
research, comp, report, document, visual, and activity capabilities.

Return an outcome-level plan to the owner only if a decision would materially
change the business workflow, data safety, cost, or external systems. Otherwise
proceed autonomously through implementation and repair.
