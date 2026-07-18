# LandOS Strategic Reset Audit

Date: 2026-07-17
Status: Final read-only audit after repository, database, git-history, runtime,
live-browser, and owner-interview review  
Implementation authorized in this session: No
Durable implementation handoff:
[LandOS_Phase_1_Implementation_Handoff_2026-07-17.md](./LandOS_Phase_1_Implementation_Handoff_2026-07-17.md)

## Executive conclusion

LandOS is not currently an operational land-investment company. It is a deep
property-research and Deal Card engineering effort inside a generic ClaudeClaw
application, surrounded by partially connected agent, browser, model, and
governance systems.

The failure is not a lack of code. The repository contains substantial and
valuable acquisition research, parcel-resolution, evidence, comparable,
browser, report, and audit capabilities. The failure is that those capabilities
were repeatedly perfected as isolated subsystems while the operator workflow
remained split across competing records and screens.

The fastest credible route is a hybrid reset:

1. Preserve the valuable research, browser, evidence, document, activity,
   comparable, and data-integrity work.
2. Stop the existing Deal Card v2 roadmap and do not continue department-by-
   department backend expansion.
3. Establish one thin operational loop first: manual lead intake through a
   human discovery call and transcript reconciliation.
4. Make the Lead Card the live workspace for every lead. Promote it visibly to
   a Deal Card only when the owner elects to pursue the opportunity.
5. Make Jarvis the chief-of-staff interface over shared business records and
   functional department services.
6. Replace mandatory micro-workstream governance with outcome-level delivery
   and risk-based verification.
7. Keep the first release local and single-operator, but use portable interfaces
   and reproducible setup so the same system can later run in cloud and mobile
   environments.

Success is the owner opening LandOS and operating the business. Internal
abstractions, test volume, documents, ledgers, and backend completeness are
useful only when they support that result.

## Intended company operating model

The owner remains the decision-maker. LandOS supplies coordinated labor.

- Jarvis is the chief of staff: conversational, voice-capable, screen-aware,
  knowledgeable across every department, able to delegate work, reconcile
  results, inspect both backend records and visible UI, and surface decisions.
- Departments are functional operating structures, not personalities.
- Department agents, tools, workflows, browsers, and models perform the labor.
- The Lead Card is the live workspace for an incoming opportunity.
- A Lead Card becomes a Deal Card when the owner chooses to pursue it further
  after discovery and initial review.
- Deal Cards receive a subtle but noticeable border/glow treatment so pursued
  opportunities are immediately distinguishable.
- Shared business records are the institutional memory.
- The dashboard provides control, visibility, approvals, exceptions, workload,
  and intervention paths.
- The system must ultimately operate locally, in cloud environments, and from a
  mobile owner experience.

No department or agent should use a personal name such as Duke, Ace, Finn, or
Mara in the target product. Use functional labels such as Acquisitions Agent,
Property Research Agent, Market Analyst, Transaction Coordinator, Dispositions
Agent, Finance Agent, Operations Agent, Browser Agent, and Technical Agent.

## What currently exists

### Valuable operating capabilities

- Conversational manual lead intake.
- Property Board stage movement.
- Parcel resolution with strong wrong-parcel and identity-conflict protections.
- County/GIS/public-source research.
- Authenticated browser-based LandPortal navigation and visible-field
  extraction.
- Browser screenshots for parcel, comparable map, environmental overlays,
  terrain, satellite, and visual context where available.
- Source-aware property facts and evidence.
- Comparable collection, normalization, deduplication, and price-per-acre
  calculations.
- Preliminary valuation, strategy, readiness, and Land Score services.
- Market Matrix with meaningful county snapshots and queries.
- Seller/discovery fields and follow-up-draft capability in the legacy card.
- Document upload, report generation, PDF/Markdown downloads, visuals, and
  activity history.
- Local SQLite persistence with foreign-key enforcement, WAL mode, audit
  records, and preserved accepted property data.
- Local managed runtime, browser-session safety, paid-action guards, and
  approval concepts.

These are preservation candidates. They should be assembled and simplified,
not discarded.

### Live operator state

Authenticated browser inspection showed:

- Acquisitions Pipeline contains 21 visible cards, while Deal Library contains
  22 active Deal Cards.
- Mission Control reports zero leads and zero deals.
- LandOS Spine reports zero canonical leads, deals, sellers, tasks, and due-
  diligence records while simultaneously showing 22 legacy Deal Cards and more
  than 1,600 audit events.
- QA fixtures and test properties are mixed into the operating pipeline.
- The new primary Lead Workspace is entirely read-only.
- The legacy Deal Card contains the real editing, seller, report, research,
  document, lifecycle, and activity controls.
- Discovery, Offers, Reports, and Property Intelligence top-level Acquisitions
  tabs are explanatory redirects rather than working queues.
- Jarvis is the generic ClaudeClaw Chat page, exposes generic agent selection,
  and remained in a reconnecting state during inspection.
- Mission Control shows agent-task counts rather than reliable business
  operation counts.
- LandOS Command shows placeholder pipeline value, projected net, committed
  cash, action center, exit strategy, and performance sections.
- CRM, Marketing, Competitor Intelligence, Dispositions, and Transaction
  Coordination explicitly render as shells.
- Finance links only to model/provider cost tracking, not business finance.
- Strategy and Training links to a knowledge surface, not an operating
  department.
- Operations links to generic agents and schedules, not a business operations
  queue.
- Market Research is the only meaningful non-Acquisitions department surface:
  its Market Matrix contained 55 counties and 445 snapshots at inspection.

### Repository and persistence scale

- LandOS is mounted into one Hono/Preact/SQLite ClaudeClaw process.
- The backend LandOS route registrar and legacy Deal Card component are each
  approximately five thousand lines.
- The LandOS subsystem contains roughly as many test files as production files.
- The database contains more than sixty LandOS tables.
- The canonical-looking lead, deal, property, parcel, contact, seller, task,
  approval, rule, playbook, and model-call tables were empty at audit time.
- Operational-like data is concentrated in Property Card and Deal Card tables:
  24 records, all with lifecycle status new, alongside extensive QA, browser,
  activity, and audit data.
- LandOS schema evolution is distributed across runtime CREATE TABLE and ALTER
  TABLE calls rather than a versioned LandOS migration chain.
- There is no automated CI workflow or reproducible cloud deployment
  configuration.

## What went wrong

### 1. Over-micromanagement replaced product ownership

Prompts prescribed individual fields, functions, failure cases, evidence
language, and internal implementation mechanics. Capable coding agents were
constrained into local correctness work instead of being responsible for the
complete operator outcome.

The result was a system that can explain acreage provenance in extraordinary
detail but cannot let the operator complete the next action from the primary
workspace.

### 2. Sprint fragmentation optimized depth over breadth

Git history contains more than two hundred LandOS-touching commits since
mid-May, heavily concentrated on property resolution, research, and Deal Card
repairs. The paused Deal Card v2 sprint contains six serial workstreams, 51
requirements, 13 browser findings, dozens of evidence records, and more than a
hundred lifecycle events.

The staged lifecycle requires one workstream at a time and independent browser
acceptance before the next can begin. This protects local behavior but
structurally discourages thin end-to-end delivery across the company.

### 3. Internal acceptance replaced owner usefulness

The Lead Workspace was formally completed and frozen even though:

- it is read-only;
- owner usefulness acceptance remained pending;
- the legacy Deal Card still held the actionable workflows;
- one legacy comparable journey still failed;
- one thin-market fixture remained unavailable.

Process-complete was treated as product-complete.

### 4. Parallel representations created split-brain behavior

The repository contains:

- canonical lead/deal/property tables versus active Property Card/Deal Card
  tables;
- Lead Workspace versus legacy Deal Card;
- multiple department registries;
- multiple readiness, reconciliation, and projection layers;
- two unconnected command routers;
- two provider/model systems;
- multiple current-state and roadmap documents.

Every new representation created reconciliation and regression work. Several
recurrence reviews explicitly document fields being correct in one projection
and wrong in another.

### 5. Backend truth was mistaken for operator capability

Tests proved payloads contained values and components could render them. They
did not consistently prove that a real operator could reach the component,
understand the next action, perform it, and see the result persist.

### 6. QA and operator data were not isolated

QA created visible pipeline records and at one point overwrote accepted parcel
identity information. This directly violated the rule that accepted operator
information cannot change without owner confirmation.

### 7. Roadmaps stopped steering

Documents labeled active or current described June work as planned or in
progress after git history showed it completed. Work followed successive large
prompts and ledgers rather than one current company-wide outcome roadmap.

### 8. Generic infrastructure diluted the business product

LandOS retains large portions of generic ClaudeClaw: Telegram agents, War Room,
Hive Mind, Forge, model-cost surfaces, generic schedules, and agent-task
management. Some may be reusable, but they currently compete with the business
workflow for navigation, terminology, and engineering attention.

## Material contradictions

1. The master directive rejects phased roadmaps, while staged governance
   mandates strictly serial workstreams.
2. Build rules define completion by business usefulness, while capability
   freezing permits internal QA completion without owner acceptance.
3. The Lead Workspace is called primary but cannot perform work.
4. The editable legacy Deal Card is hidden behind a compatibility surface.
5. Mission Control, Acquisitions, LandOS Spine, and the database disagree on
   lead and deal counts.
6. Department registries disagree on whether there are 11, 13, or 14
   departments and which are operational.
7. The frontend calls Acquisitions operational while major Acquisitions tabs
   are shells.
8. Strategy names are inconsistent; the live Command page still references
   Quick flip after the approved strategy was renamed Cash Flip.
9. Provider registries advertise multiple runtimes while general execution is
   still directly Claude-centric.
10. Documentation and API/MCP artifacts imply LandPortal API use, while the
    owner has placed that API completely off-limits and requires an
    authenticated browser session.
11. The managed runtime returned HTTP 200 but could not verify ownership of its
    own PID.
12. The root README still describes a generic ClaudeClaw assistant rather than
    the LandOS company product.

## Correct LandPortal architecture

The LandPortal API is off-limits. LandOS must not call it, configure it, use it
as a fallback, or depend on its MCP wrapper. The authenticated browser-agent
workflow is the only approved LandPortal access path.

Current code violates that target boundary. The intended acquisition escalation
and inspection path is browser-driven, but legacy token/API and MCP paths remain
reachable through older report, intake, verification, and standalone-agent
flows. The reset must disable those paths before live use, migrate any useful
non-network parsing/data, and remove the API/MCP runtime dependency safely.

LandOS must reuse the authenticated browser-agent path:

1. Reuse a dedicated persistent local browser profile with the operator's
   existing LandPortal login.
2. Navigate to LandPortal and locate the property using the supplied address,
   APN/parcel ID, city, county, and state.
3. Read only information visibly available on the parcel page.
4. Capture the parcel/highlighted-boundary view.
5. Read the visible comparable rows from the parcel page.
6. Click the free Show on Map control and capture the comparable map.
7. Capture satellite, street, overlay, and 3D/terrain views where available.
8. Persist extracted facts and screenshots with page/source provenance.
9. Continue to county assessor, GIS, recorder/deed, FEMA, wetlands, soils,
   zoning, utilities, Zillow, and Redfin lanes as required.
10. Never purchase a report, consume a credit, change settings, or perform a
    write. Paid LandPortal actions are prohibited.

Current reusable evidence includes:

- src/landos/browser-session.ts: persistent browser and real Show on Map click.
- src/landos/landportal-browser.ts: parcel facts, visible comps, overlays, and
  screenshot packaging.
- src/landos/property-inspection.ts: coordinated inspection package.
- src/landos/browser-comp-research.ts and comp extraction/registry services.
- docs/landos/Browser_Intelligence_Live_Session.md.
- Existing browser-session, LandPortal-browser, inspection, and visual tests.

The following are historical or non-target artifacts:

- landos-agents/duke-due-diligence/mcp-landportal;
- src/landos/landportal-client.ts;
- LandPortal API v2 documentation and adapter flags;
- instructions that make an API response or paid comp report the primary path.

Do not invoke these paths. Map their references, migrate any useful parsing
logic that does not call the API, remove them from runtime selection, and then
delete or archive the obsolete API/MCP implementation with regression proof.

The audit found persisted successful parcel, overlay, 3D, visible-comparable,
and Show on Map captures through July 9. Newer property-inspection activities
did not contain assets or comparable rows. The implementation session must
therefore re-prove the current authenticated browser workflow on a real lead;
old QA narrative is not sufficient proof of current reliability.

## Target product architecture

### One deployable application first

Keep Hono, Preact, TypeScript, and SQLite for the first single-operator release.
Microservices would add operational burden without solving the current
workflow problem.

Create domain boundaries inside the application:

- Lead and opportunity records
- Property/parcel and evidence
- Research orchestration
- Comparable and valuation analysis
- Seller/discovery
- Tasks and approvals
- Documents and reports
- Jarvis command/delegation
- Model execution
- External integrations

These boundaries should expose typed contracts and shared validation while
remaining one deployable process.

### One authoritative opportunity model

Use one opportunity aggregate with linked objects:

- Lead
- Contact and seller parties
- Property and one-or-more parcels
- Research facts and evidence
- Comparables and valuation snapshots
- Communications and transcripts
- Tasks, decisions, and approvals
- Documents and visuals
- Lifecycle and stage history
- Deal economics and transaction/disposition records later

Every incoming lead gets a Lead Card. Rejected, duplicate, unlocatable, and
do-not-contact leads remain durable records with appropriate disposition.

When the owner chooses to pursue the opportunity after discovery and initial
review, the same record gains Deal status and Deal Card presentation. It should
not be copied into a competing record system. A subtle glow/border distinguishes
pursued deals at a glance.

### Actionable card, not read-only projection

Combine the reliable information design of Lead Workspace with the useful
controls from the legacy Deal Card. The operator should not have to choose
between trustworthy information and actionable controls.

The card must support:

- next action and owner decision;
- research status and reruns;
- transcript paste/upload;
- seller/discovery capture;
- tasks and follow-up;
- documents and report access;
- lifecycle transitions;
- evidence inspection;
- promotion from lead to pursued deal.

### Jarvis as chief of staff

Jarvis should use the same business services as the UI. It must not be a chat
skin over an unrelated generic agent runtime.

Jarvis responsibilities:

- answer questions across every department and opportunity;
- understand the currently visible page and selected opportunity;
- support live two-way voice and screen collaboration;
- delegate work to functional department agents;
- inspect completion evidence and frontend output;
- reconcile contradictions across records;
- create and assign tasks;
- update records within approved autonomy;
- surface exceptions, approvals, and overdue work;
- explain what it knows, how it knows it, and what remains uncertain.

For Phase 1, Jarvis may autonomously run free research, assign internal work,
create tasks, update Lead Cards from approved evidence, schedule follow-up, and
escalate gaps. Jarvis may communicate outbound only to the owner. It must not
communicate with leads, sellers, buyers, vendors, or other external parties.
Paid actions are prohibited, not merely approval-gated. Jarvis must not send
offers or contracts. It may prepare internal recommendations or drafts for the
owner to review. Deletions, configuration changes, and spending remain blocked
unless the owner later changes this policy explicitly.

### Functional department services

Department labels describe business responsibility:

- Executive / Jarvis
- Acquisitions
- Property Research and Due Diligence
- Market and Valuation Analysis
- CRM and Relationship Management
- Marketing and Lead Generation
- Transaction Coordination
- Dispositions
- Finance
- Operations
- Technical and AI Systems

Avoid representing browser automation, browser training, model routing, or
Forge as business departments. They are shared technical services used by the
departments.

## Local, cloud, mobile, and data architecture

### Local first

Local execution is the default:

- local web application;
- local SQLite business database;
- local authenticated browser profile;
- local files and screenshots;
- local/open-weight models through compatible endpoints whenever current
  evaluation shows they can perform the task reliably;
- cloud models used only when they add material capability or the local path
  does not meet the task's quality requirements.

### Cloud compatible

Cloud operation requires explicit replacements for local-only assumptions:

- versioned database migrations;
- a hosted relational database or correctly managed persistent storage;
- object storage for documents and screenshots;
- managed browser sessions or a secure local-browser bridge;
- authentication and encrypted secrets;
- backup, restore, and retention policies;
- one deployment manifest and health contract.

Do not build this before the Phase 1 local loop works, but do not hard-code new
local paths or provider-specific interfaces that prevent it.

### Mobile owner surface

The first mobile experience should focus on:

- Jarvis voice/chat;
- new-lead and exception alerts;
- report review;
- Lead/Deal Card summary;
- approvals and decisions;
- next actions and task review;
- transcript upload/paste;
- pursued-deal visibility.

A full desktop-equivalent mobile interface is not required first.

### GitHub and disaster recovery

GitHub should contain:

- application source;
- schemas and migrations;
- generic workflow definitions;
- provider interfaces;
- agent/department role definitions;
- prompts and report templates;
- deployment/setup automation;
- tests and synthetic fixtures;
- documentation and recovery instructions.

GitHub must not contain:

- .env files;
- passwords, tokens, API keys, or authenticated browser profiles;
- personal owner information;
- seller/contact information;
- real property records;
- deeds, contracts, transcripts, screenshots, or business documents;
- local databases or WAL files.

Cloning GitHub plus supplying an environment file restores the software, not
the business memory. Real business records and documents require a separate,
encrypted, tested backup and restore path. A correct SQLite snapshot or export
must account for WAL state. This private backup is mandatory if a computer
failure must not erase LandOS history.

QA and synthetic fixtures must use a separate database and separate artifact
root. They must never appear in the operating pipeline or mutate accepted
operator records.

## Model and agent execution strategy

### One execution gateway

Replace the duplicate provider systems with one capability-aware model gateway.
The gateway should normalize:

- chat/reasoning;
- structured extraction;
- vision;
- speech-to-text and text-to-speech;
- embeddings;
- tool use;
- coding-agent execution;
- local and remote endpoints.

Routing dimensions:

- task capability;
- local/cloud policy;
- latency;
- cost;
- context size;
- vision/audio/tool requirements;
- availability and fallback;
- record sensitivity;
- quality history.

The application should depend on stable task contracts and current capability
evaluations, not permanent assumptions about model names or providers.

### Provider roles

- Local/open-weight models: first choice for every task they can perform
  reliably, not only inexpensive work. Their capabilities must be re-evaluated
  regularly because model quality changes rapidly. Families such as Gemma and
  their successors may take on more reasoning, vision, extraction, and
  orchestration work as measured capability improves.
- Claude: complex reasoning, orchestration, nuanced seller/discovery analysis,
  and long-context review.
- OpenAI/Codex: coding, tool-driven implementation, structured reasoning, and
  multimodal tasks where appropriate.
- Gemini: vision and multimodal/browser interpretation where it performs well.
- NVIDIA NIM, Kimi, GLM, Ollama, LM Studio, vLLM, and future OpenAI-compatible
  providers: register through capability profiles rather than product-specific
  branches.
- Coding agents such as Codex and Claude Code: implementation-time tools, not
  business departments.

Evaluate using LiteLLM as the gateway implementation before building a custom
proxy. Its official documentation describes an OpenAI-compatible interface,
multi-provider routing, fallbacks, budgets, and support for hosted and local
providers: https://docs.litellm.ai/

LandOS should own business-task policy, approvals, audit, and capability
selection even if LiteLLM handles protocol normalization and provider failover.

## Open-source and external-system strategy

### Phase 1

- Keep the existing Hono/Preact/SQLite application.
- Keep the existing authenticated browser stack.
- Keep GoHighLevel out of the critical path until the manual workflow works.
- Do not adopt a large agent framework or workflow engine during Phase 1.
- Evaluate LiteLLM for model-gateway normalization.

### Near term

- GoHighLevel is the likely initial CRM and communications system. LandOS should
  coordinate it rather than immediately rebuilding calling, SMS, email,
  forms, and pipeline automation.
- n8n may be useful for replaceable integration workflows and webhooks, but
  should not become the authoritative business state or hide core rules inside
  an opaque workflow. Its official documentation supports self-hosting,
  integrations, source-control options, and security auditing:
  https://docs.n8n.io/hosting/ and
  https://docs.n8n.io/hosting/securing/security-audit/
- Twenty is a credible self-hosted CRM fallback to evaluate if GoHighLevel
  becomes unsuitable. It supports self-hosting, extensible objects, APIs, and
  webhooks: https://docs.twenty.com/developers/introduction and
  https://docs.twenty.com/developers/self-host/self-host
- Temporal is appropriate only if long-running, crash-resumable workflows
  become operationally necessary. It is excessive for the first local Phase 1
  loop: https://docs.temporal.io/

Do not replace working LandOS domain knowledge with a generic CRM or workflow
engine. Reuse external systems for commodity capabilities and keep land-
investment reasoning and opportunity records in LandOS.

## Phase 1: lead through discovery

### Business outcome

At a target load of five new leads per day, the owner or a human acquisition
agent can receive or manually enter a lead, obtain the best immediately
available call-preparation package, conduct a discovery call, paste or upload
the transcript, and receive an updated Lead Card with reconciled facts,
motivation analysis, contradictions, research tasks, follow-up needs, and a
recommended next action.

GoHighLevel is not required for initial acceptance. Leads are entered manually.
Call recording/transcription may occur in GoHighLevel later. Initial
transcripts enter through paste or file upload.

Nothing blocks the discovery call. Wrong-parcel, missing-property, provider
failure, thin-market, and incomplete-research states change the report and
questions; they do not prevent the call.

Wrong-parcel and unresolved identity must still block unsupported parcel facts,
valuation certainty, offer preparation, and downstream claims.

### Immediate automated workflow

1. Manual lead entry creates a durable Lead Card.
2. Research starts automatically.
3. Property resolution uses address and/or APN/parcel ID with city, county, and
   state context.
4. Browser and public-record research execute concurrently where safe.
5. The Lead Card progressively shows status, obtained facts, evidence, gaps,
   and report readiness.
6. A best-available discovery report is created immediately.
7. A human conducts the discovery call.
8. The transcript is pasted or uploaded.
9. Jarvis and the Acquisitions Agent summarize, extract, reconcile, score
   motivation, flag contradictions, update the Lead Card, create deeper-
   research/follow-up tasks, and recommend the next action.
10. The owner chooses whether to pursue. Pursuit promotes the same opportunity
    to Deal status and adds the subtle Deal Card highlight.

### Discovery report requirements

#### Lead and property identity

- Lead name and contact context available at report time.
- Lead source.
- Property location and address.
- County and state.
- APN/parcel ID.
- Resolution status, confidence, sources, and contradictions.
- Every apparent owner found in the deed or property record.

If the property cannot be identified, produce a seller-focused call brief that
asks the agent to confirm address, APN, county, acreage, ownership, neighboring
landmarks, and other identifying details.

#### Visual package

- High-resolution parcel image with highlighted parcel boundary.
- Satellite screenshot.
- Street View screenshot when available and spatially verified.
- Wetlands, flood, terrain, and other useful overlay screenshots.
- 3D/topographic screenshot when slope exceeds 10 percent.
- Vision-generated bird's-eye property description.
- Every visual carries source, capture time, parcel association, and confidence.

#### Comparable and valuation policy

- Sold comparables determine preliminary fair market value.
- Active and pending properties are informational context only.
- Return up to five best sold comparables.
- Rank by land-use relevance, shape, acreage similarity, distance, recency, and
  market similarity.
- Start within approximately 3 miles.
- Expand to 5 miles, then 10 miles only when needed.
- If still thin in a rural market, expand county-wide.
- A county-wide expansion must create a prominent disclosure on the Lead Card
  and report explaining that local comps were insufficient.
- Start with the previous 12 months.
- Expand to 18 months, then at most 24 months only when needed.
- Never use sales older than two years for this initial report.
- Show the search radius/geography, time window, filters, exclusions, and why
  each expansion occurred.
- LandPortal browser-visible comps are the first source.
- Zillow and Redfin are the next preferred sources.
- Deduplicate properties across providers.
- Thin markets still receive a clearly labeled low-confidence fair-market range
  and offer range rather than no guidance.
- The initial offer range is 40 to 60 percent of preliminary fair market value.
- Do not deduct holding, closing, cleanup, financing, improvement, or resale
  costs in this initial report; those belong to post-discovery underwriting.
- Show the range and let the owner choose. Do not select or send an offer.

#### Land characteristics and feasibility

- Acreage and acreage conflicts.
- Road frontage and whether the parcel appears landlocked.
- Legal-access evidence status.
- Wetlands and flood exposure.
- Slope and terrain.
- Soils and directional likelihood of conventional septic/percolation
  feasibility.
- Zoning and restrictions.
- Utilities and public-water availability.
- Manufactured-home allowance or nearby manufactured-home evidence.
- Apparent physical condition and improvements.
- Deed copy when publicly obtainable.
- Deed scan for apparent owners, heirs, easements, and restrictions.
- Clear disclaimer that deed extraction is research, not a title or legal
  opinion.
- Missing deed becomes a visible retrieval task; it does not block the call.

#### Market Pulse

- Overall local real-estate/land market direction.
- Price-per-acre context.
- Inventory, days on market, sell-through, and absorption where defensible.
- Population growth.
- Significant active or announced local projects and developments.
- City/county geographic basis, sources, dates, and confidence.

#### Initial Land Score

The score must combine, without hiding uncertainty:

- parcel identity confidence;
- land characteristics;
- access/frontage;
- wetlands/flood;
- slope/buildability;
- septic/utility feasibility;
- zoning/use compatibility;
- marketability;
- market strength and growth;
- comparable quality;
- exit-strategy fit.

Show subscores and missing inputs. Do not present one unexplained number.

#### Strategy screen

Return the two strongest initial strategies based on whether the opportunity
appears worth deeper effort:

- Cash Flip
- Subdivide or Minor Split
- Novation or Double Close
- Land-Home Package

Improvement Then Flip may remain available when facts support it, but Phase 1
must not force five equal strategy cards when only two are useful.

For each selected strategy show:

- why it fits;
- major unknowns;
- evidence required next;
- directional margin/opportunity logic;
- what could invalidate it.

#### Call preparation

- Executive call brief.
- Known seller/owner parties.
- Questions created from missing or conflicting facts.
- Asking-price and motivation prompts.
- Timeline, decision-maker, authority/heir, property-condition, access,
  utilities, improvements, liens, prior-offer, financing, and reason-for-sale
  questions.
- Report directly in the Lead Card.
- Concise call-prep view.
- Downloadable PDF.
- Later synchronization link/attachment for GoHighLevel.

### Post-call reconciliation

From pasted/uploaded transcript:

- summarize the call;
- preserve the original transcript;
- extract seller statements separately from verified property facts;
- identify all sellers, heirs, owners, and decision-makers mentioned;
- score motivation with explainable evidence;
- capture asking price, timeline, property knowledge, condition, access,
  utilities, improvements, liens, prior offers, and financing interest;
- find contradictions against the research record;
- create deeper-research tasks;
- create follow-up tasks/call requirements;
- recommend one of: deeper underwriting, more research, prepare offer, follow
  up, nurture, dead lead, wrong property, or do-not-contact;
- require owner decision for pursuit/promotion to Deal.

## Department-wide thin build after Phase 1

Do not spend months completing Acquisitions before touching the rest of the
company. After Phase 1 acceptance, add one thin operating loop per department,
each using the same opportunity records:

1. CRM: GoHighLevel synchronization for lead, contact, transcript, task,
   appointment, stage, report link, and follow-up.
2. Deeper Research/Underwriting: validate title/access/zoning/utilities,
   refine comps, estimate costs and profit, and prepare owner decision.
3. Offer: owner-selected range/amount, approval, draft, delivery, response, and
   follow-up.
4. Transaction Coordination: contract, title, earnest money, inspection,
   survey, deadlines, funding, documents, and closing checklist.
5. Dispositions: exit plan, pricing, listing channels, buyer matching,
   owner-finance options, buyer qualification, contract, and resale closing.
6. Finance: available cash, committed capital, basis, projected/realized
   profit, expenses, marketing ROI, debt, and receivables.
7. Marketing: campaign intake, lead attribution, spend, CPL, quality, and
   owner-approved changes.
8. Operations: cross-department exceptions, capacity, overdue work, vendor
   coordination, backups, and system health.
9. Technical/AI: provider health, model quality/cost, browser reliability,
   integrations, security, and recovery.

Each loop should be intentionally thin but performable before deeper automation
or analytics are added.

## Governance and delivery reset

### Stop doing

- Do not resume Deal Card v2 WS4 as the next product priority.
- Do not create another replacement card or projection.
- Do not split Phase 1 into dozens of implementation prompts.
- Do not freeze behavior before owner usefulness acceptance.
- Do not require independent browser QA after every small internal workstream.
- Do not count a department, agent directory, route, or data schema as
  operational functionality.
- Do not use mutable operator data as QA fixtures.
- Do not let coding agents declare success from tests, API responses, or
  screenshots alone.

### Keep, but use proportionally

- Managed runtime commands.
- Critical parcel-identity and accepted-data protections.
- Evidence/source provenance.
- Absolute paid-action prohibition and owner-only outbound communication
  guards.
- Targeted unit and integration tests.
- A small stable end-to-end operator regression suite.
- Recurrence review when the same failure repeats.
- Live owner acceptance for product outcomes.

### New delivery unit

The unit of delivery is an operator outcome, not a department backend or a
field-level workstream.

For Phase 1, one implementation session receives the complete outcome,
constraints, acceptance criteria, and current evidence. It may inspect, design,
delegate, refactor, migrate, implement, test, and repair autonomously. It should
report internal decisions rather than request approval for every reversible
technical choice.

Risk-based gates:

- Critical data-integrity, owner-only outbound, paid-action, offer, and contract
  prohibitions require focused tests.
- Database migration requires backup, rollback, and preservation proof.
- Browser extraction requires live authenticated browser acceptance.
- The complete lead-to-discovery journey requires combined live operator QA.
- Final acceptance requires the owner to use the workflow on a real lead.

## Realistic milestone sequence

### Milestone 0: stabilization and data separation

- Freeze new feature expansion.
- Inventory and back up real business data.
- Separate QA database/artifacts from operating data.
- Define the opportunity migration map.
- Mark stale API-first LandPortal paths and named-agent terminology as
  deprecated.
- Repair runtime ownership diagnostics.

### Milestone 1: unified actionable Lead Card

- One opportunity record and one operator card.
- Preserve existing records through migration.
- Progressive research state.
- Action controls from the legacy card.
- Lead-to-Deal promotion with subtle visual distinction.
- Reliable dashboard counts.

### Milestone 2: discovery research package

- Authenticated LandPortal browser workflow.
- County/public research.
- Visual capture.
- comps policy and disclosures.
- Market Pulse, Land Score, two-strategy screen, deed analysis, PDF.
- Best-available report even when incomplete.

### Milestone 3: transcript and Jarvis coordination

- Paste/upload transcript.
- Summarization and structured extraction.
- Motivation and contradiction analysis.
- shared tasks and next action.
- Jarvis delegation and verification.
- voice/screen collaboration foundation.

### Milestone 4: Phase 1 live acceptance

- Five-lead/day simulation in isolated QA data.
- One real lead end to end.
- restart and recovery verification.
- local backup/restore drill.
- owner acceptance.

### Milestone 5 onward

Add the thin department loops listed above, prioritizing GoHighLevel,
underwriting/offer, transaction coordination, and dispositions.

## Major risks and tradeoffs

- Consolidating records risks data loss; migration must be additive, backed up,
  reversible, and reconciled.
- Browser automation is inherently sensitive to site UI changes; visible
  failures and fallback tasks are mandatory.
- County and recorder sites vary widely; the workflow must tolerate manual
  completion without blocking the call.
- Cloud models improve capability but create availability, cost, and data-
  handling dependencies.
- A local-first browser login is difficult to reproduce in cloud environments;
  cloud browser strategy is a later explicit design.
- A low-confidence value in a thin market can be useful but dangerous; its
  geography, age, sample size, and limitations must be prominent.
- Deed language extraction cannot replace title/legal review.
- Full live screen-and-voice Jarvis is valuable but should not delay the
  actionable Lead Card and transcript workflow.
- Adding an external CRM, workflow engine, or model gateway can reduce custom
  work but also add operational dependencies. Adopt only when it removes more
  complexity than it adds.

## Preserve, simplify, replace, postpone

### Preserve

- Real business and accepted operator records.
- Parcel identity and wrong-parcel protections.
- Browser session, LandPortal visible extraction, screenshot, and playbook
  work.
- County/public research.
- comp normalization and evidence provenance.
- Market Matrix.
- report, document, visual, task, activity, audit, and approval capabilities.
- local Hono/Preact/SQLite stack for Phase 1.

### Simplify

- Lead/Property/Deal records into one opportunity aggregate.
- Lead Workspace and legacy Deal Card into one actionable card.
- department definitions into functional business responsibilities.
- readiness/score displays into explainable operator decisions.
- tests into a risk-based pyramid plus a small live journey suite.
- automatic memory into one compact checkpoint plus durable reports.

### Replace

- generic Jarvis chat with a business command/delegation surface.
- duplicate provider systems with one execution gateway.
- runtime schema mutation with versioned migrations.
- micro-workstream lifecycle as default with outcome-level delivery.
- QA-on-operator-data with isolated test storage.
- named agents with functional role labels.

### Postpone

- microservices.
- full cloud deployment.
- full desktop-equivalent mobile UI.
- any lead/seller/buyer/vendor outbound communication unless the owner later
  changes the policy explicitly.
- custom CRM replacement.
- generic browser-training platform expansion.
- Forge and broad self-building systems.
- advanced model cost dashboards.
- Temporal-scale workflow infrastructure.

## Immediate next action

Start a fresh implementation session using the companion handoff. Its first
task is to validate live state, protect and separate data, and produce the
smallest coherent design that turns the existing Lead Workspace and legacy
Deal Card capabilities into the Phase 1 lead-to-discovery workflow.

Do not resume the paused Deal Card v2 sprint as written.

## Audit evidence map

Key repository evidence reviewed:

- AGENTS.md, README.md, CLAUDE.md.
- .landos/PERMANENT_MEMORY.md and .landos/CHECKPOINT.md.
- .landos handoffs, decisions, QA, limitations, sprint ledgers, recurrence
  records, and frozen capabilities.
- docs/landos architecture, roadmap, build-rule, migration, contradiction,
  memory, and sprint-lifecycle documents.
- git status, recent diffs, and LandOS history.
- package manifests and runtime scripts.
- store/landos.db and store/claudeclaw.db in read-only mode.
- src/landos services, routes, schemas, providers, browser, agents, reports,
  comps, and tests.
- web/src application routing, navigation, Acquisitions, Lead Workspace, Deal
  Card, Mission Control, Jarvis, department pages, and shared components.
- live authenticated localhost walkthrough on 2026-07-16.
- owner interview across 2026-07-16 and 2026-07-17.

No implementation, runtime, database, package, configuration, secret, commit,
push, or deployment change was performed during this audit.
