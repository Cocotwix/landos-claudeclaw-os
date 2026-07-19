# LandOS Agent Company Architecture

The flexible department-to-agent alignment layer for LandOS. It maps how
departments, agent role lanes, CRM/GHL, transaction coordination, the deal
board, handoffs, and future async delegation fit together.

This is a baseline to build on, not a finished org chart. It changes no code,
no agent behavior, and no GHL configuration. It is architecture and intent only.

---

## 1. Purpose

LandOS should be built like an agent company, not a pile of isolated chatbots.
This document is the alignment layer that says: which departments exist, which
role lanes operate inside them, who owns which facts, how work hands off, and
how the deal board and (future) async delegation tie it together. It sits under
`LandOS_Build_Rules.md` and `LandOS_Execution_Overlay.md` and never overrides
them.

---

## 2. Editable architecture note

- This is a **baseline**, not a final org chart.
- All department names, sub-department names, and agent names are **placeholders**.
- Departments can be renamed, split, merged, or added later.
- Agent names can change; role lanes can be reassigned.
- **Role ownership and workflow boundaries matter more than labels.** When a name
  and a boundary conflict, the boundary wins and the name gets fixed later.

---

## 3. Core principle

- **Departments are the business map** — the operating system's structure.
- **Agents are workflow operators** inside departments, not the system itself.
- **LandOS is the full operating system** for the land business.
- **CRM / GHL is one operating leg inside LandOS**, a tool and workflow layer —
  not the operating system, and never the thing that defines LandOS.
- **The orchestrator (Command Center) routes and synthesizes** — it does not do
  every department's work; it assigns and reconciles.
- **The dashboard / deal board is the operating surface** where work is visible
  and moved.
- **Async delegation is future execution infrastructure** — designed now in
  concept, implemented later.

---

## 4. Draft department map (Tyler's starting 8)

The provisional starting point, names not final:

1. Strategy
2. Market Selection
3. Lead Generation
4. Acquisitions
5. Due Diligence / Deal Analysis
6. Dispositions
7. Capital / Finance
8. Operations / Systems

These are a useful seed but under-cover transaction coordination, valuation,
CRM health, data/memory, and QA/compliance. Section 5 is the cleaned map.

---

## 5. Recommended LandOS operating departments (cleaned)

Still provisional; expanded for real operating coverage:

- **Command Center / CEO Layer** — routing, synthesis, next best action
- **Market Intelligence** — county/market scoring, demand, absorption, risk
- **Marketing / Lead Generation** — campaigns, channels, list and ad performance
- **Acquisitions** — seller comms, negotiation support, pipeline movement
- **Due Diligence** — parcel verification, access, utilities, zoning, buildability, risk flags
- **Valuation / Comps** — comps, value, value confidence, resale value
- **Strategy / Exit Selection** — exit path synthesis (owned by Command Center at first)
- **Transaction Coordination** — signed deal through closing
- **Dispositions** — listing, buyers, resale packaging, price strategy
- **Finance / Risk** — capital, ROI, holding cost, exposure, budgets
- **CRM / GHL Success Management** — CRM health, workflow QA, pipeline hygiene
- **Operations / Systems** — internal ops, process, tooling
- **Data / Memory** — durable records, memory, deal/parcel data integrity
- **QA / Compliance** — verification discipline, fact labeling, audit, A2P/compliance posture

Maps onto existing repo agents where they already exist (Main, Ace/acquisitions,
Duke/DD+comps, Finn/finance, Drew/dispositions, Mia/marketing, TC, Security, AI
Watcher; Cal, Lou, Rex planned). Names remain provisional.

---

## 6. CRM / GHL Success Management lane

A real LandOS operating lane. **GHL/CRM is a tool and workflow layer inside
LandOS, not LandOS itself.** This lane monitors and routes CRM work; it does not
redefine the business around the CRM. **Architecture only — do not modify GHL.**

Covers:

- GHL setup health
- pipeline stages
- lead-source attribution
- forms
- automations
- SMS/email workflow monitoring
- A2P / compliance readiness tracking
- missed-lead alerts
- appointment tracking
- task hygiene
- follow-up workflow QA
- CRM data quality
- duplicate / contact hygiene
- campaign-to-contract visibility
- handoff between Acquisitions (Ace), Marketing (Mia), Transaction Coordination, and Dispositions
- future migration path from GHL dependency toward LandOS-native records when ready

---

## 7. Transaction Coordination lane

Its **own lane**, not a sub-piece of Dispositions. It sits **between
Acquisitions, Due Diligence, Finance, and Dispositions** and owns the signed
deal through closing.

Covers:

- signed agreement intake
- title / opening checklist
- seller document collection
- probate / heirship / title-issue tracking
- closing attorney / title company coordination
- due-diligence deadline tracking
- earnest money / deposit tracking
- closing timeline
- purchase-side closing coordination
- resale-side closing coordination
- document status
- post-close handoff to improvements / dispositions
- deal-folder completeness
- communication timeline

It receives a deal once under contract, drives it to close, and hands the closed
asset to improvement/dispositions.

---

## 8. Agent company map (role lanes — names are placeholders)

| Role lane (placeholder) | Existing persona | Owns |
|---|---|---|
| Command Center / Orchestrator | Main (Lou planned) | routing, final synthesis, next best action |
| Acquisitions Agent | Ace | seller calls, follow-up, negotiation support, CRM notes |
| Due Diligence Agent | Duke | parcel verification, risk flags, access, utilities, zoning, buildability |
| Valuation Agent | Cal (planned; in Duke today) | comps, valuation, value confidence, comp quality, resale value |
| Market Intelligence Agent | Rex (planned) | county/city scoring, buyer demand, absorption, market risk |
| Marketing Agent | Mia | PPC/Facebook/Google/direct mail/list performance, campaign metrics |
| Dispositions Agent | Drew | listings, buyer management, resale packaging, price-reduction strategy |
| Finance / Risk Agent | Finn | capital, ROI, holding costs, risk exposure, budgets |
| CRM / GHL Success Manager Agent | (new lane) | CRM health, workflow QA, pipeline hygiene, follow-up monitoring, data quality |
| Transaction Coordination Agent | TC | closing workflow, title/doc/status tracking, attorney/title coordination |
| Forge / System Builder | Forge | system building, QA, docs, automation, dashboard/backend improvement |

These are **role lanes, not final agent names.** A lane may be served by an
existing agent, a planned agent, or temporarily by the orchestrator.

---

## 9. Strategy layer

Strategy should **not** be an isolated first-build agent. A good exit decision is
a synthesis of other departments' outputs:

- Due Diligence facts
- Valuation value and confidence
- Market Intelligence demand
- Acquisitions seller context
- Finance risk and economics
- Transaction status
- Disposition path

Until there is enough workflow weight to justify a dedicated strategy agent,
**the orchestrator (Command Center) owns Strategy** as a synthesis step. A
standalone Strategy agent gets promoted later if volume demands it.

---

## 10. Business-model corrections

- **Current default model: buy, improve, and resell land.**
- **Wholesale and double close are inactive / legacy modules** unless Tyler
  explicitly reactivates them.
- **"Wholesale value" is renamed "Investor Resale / Liquidation Value"** in active
  workflows.
- Strategy options to consider (only when worthwhile):
  - quick flip
  - subdivide
  - land-home package
  - improvement / value-add
  - entitlement / SUP (only when the upside justifies it)
  - owner-finance resale
  - pass / no offer

---

## 11. Shared task boundaries (single owner per concern)

- **Facts and parcel identity** — Due Diligence
- **Value and comps** — Valuation
- **Market demand** — Market Intelligence
- **Seller communication** — Acquisitions
- **Campaign performance** — Marketing
- **CRM workflow health** — CRM / GHL Success Management
- **Signed deal movement** — Transaction Coordination
- **Funding / risk** — Finance / Risk
- **Disposition execution** — Dispositions
- **Final recommendation** — Command Center
- **System fixes** — Forge / System Builder

A lane may *request* another lane's work, but does not *own* it.

---

## 12. Agent handoff rules

- Acquisitions can request Due Diligence.
- Due Diligence can request Valuation.
- Valuation can request Market Intelligence.
- Finance / Risk can reject or flag weak economics.
- CRM / GHL Success can alert Acquisitions about missed follow-up or a broken workflow.
- Transaction Coordination can alert Due Diligence, Finance, or Dispositions when a closing blocker appears.
- Dispositions can feed resale feedback back to Valuation and Market Intelligence.
- Command Center synthesizes conflicts and gives Tyler the next action.

Use the existing handoff convention from `LandOS_Agent_Department_Index.md`:
`HANDOFF → [Department / Agent]: [one-line description]`.

---

## 13. Dashboard / deal board workflow

Draft default stages, with the likely primary role and supporting roles. (Stage
names provisional.)

| Stage | Primary role | Supporting roles |
|---|---|---|
| New Lead | Marketing | CRM Success, Acquisitions |
| Intake | Acquisitions | CRM Success |
| Discovery | Acquisitions | Due Diligence |
| Parcel Verification | Due Diligence | — |
| Due Diligence | Due Diligence | Valuation, Market Intelligence |
| Valuation | Valuation | Due Diligence, Market Intelligence |
| Strategy | Command Center | Valuation, Finance, Market Intelligence, Dispositions |
| Offer | Acquisitions | Finance, Command Center |
| Contract | Transaction Coordination | Acquisitions, Finance |
| Transaction Coordination | Transaction Coordination | Finance, Due Diligence |
| Closing | Transaction Coordination | Finance |
| Improvement | Operations / Systems | Finance, Dispositions |
| Disposition | Dispositions | Valuation, Market Intelligence, Marketing |
| Sold / Archived | Command Center | Finance, Data / Memory |

Parcel Verification is a hard gate: no scoring, valuation, strategy, offer, or
disposition work proceeds on an unverified parcel.

---

## 14. Async delegation design (concept only — do not implement)

Future LandOS async delegation should provide:

- a **task queue** for delegated work
- a **task handle / status** the orchestrator and dashboard can poll
- **specialist assignment** by department/role lane
- a **result schema** (see Section 15)
- **result re-injection** into the deal card
- an **orchestrator synthesis step** that reconciles results into a recommendation
- **dashboard status indicators** per delegated task
- **failure handling** (timeout, error, blocked, needs-approval)
- **cost and credit guardrails** — no paid tools or comp credits unless explicitly approved
- a clear rule that a delegated task can never silently spend money or bypass verification

---

## 15. Agent result schema (concept only — do not implement)

Draft fields:

- `task_id`
- `deal_id`
- `agent_or_role`
- `department`
- `status` (queued | running | done | blocked | needs_approval | failed)
- `verified_facts`
- `assumptions`
- `blockers`
- `confidence`
- `recommended_next_action`
- `cost_or_credit_used`
- `requires_tyler_approval`
- `handoff_to`

Fact entries carry the standard labels (Verified / Seller stated / Assumed /
Unknown / Needs verification).

---

## 16. Hard guardrails (reaffirmed)

- No geocoder / coordinate / proximity / map-pin parcel verification.
- No scoring, valuation, or offer before verified parcel identity.
- No paid comp credits without explicit, same-exchange approval.
- No secrets in the repo. `.env` and stored credentials are read only: usable
  privately for an approved workflow, never printed, modified, or committed.
- No property-specific private work product in the repo.
- No `git add .`; exact file staging only.
- No push without Tyler's approval on the exact staged file list.

These come from `LandOS_Build_Rules.md` and the Execution Overlay and always
override anything in this document.

---

## 17. Build order recommendation

A suggested sequence (each step is its own scoped, approved build):

1. Agent Company Architecture doc (this file)
2. Department / agent dashboard routing map
3. Duke v2 dashboard wiring behind a flag
4. Duke Partial Report workflow
5. Valuation / Cal layer
6. Command Center / Lou synthesis layer
7. Market Intelligence / Rex layer
8. Finance / Risk / Finn layer
9. CRM / GHL Success Manager lane
10. Transaction Coordination lane
11. Marketing / Mia metrics
12. Dispositions / Drew lane
13. Async delegation implementation

Order is a recommendation, not a commitment; Tyler can resequence.

---

## 18. Explicit non-goals

This document is **not**:

- a final naming decision
- agent implementation
- async queue implementation
- a dashboard code change
- a Duke behavior change
- a GHL modification
- a CRM replacement plan
- permission to use paid tools
- permission to weaken parcel verification

If anything here appears to permit something a hard rule forbids, the hard rule
controls and this document is wrong in that moment.
