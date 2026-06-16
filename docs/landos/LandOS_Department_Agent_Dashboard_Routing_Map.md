# LandOS Department / Agent Dashboard Routing Map

Translates `LandOS_Agent_Company_Architecture.md` into dashboard / deal-board
routing behavior: how deals move through stages, which role lane owns each
stage, which supporting roles trigger, what outputs are expected, and what hands
off next.

This is routing design only. It changes no code, no Duke behavior, no dashboard
behavior, and creates no agents.

---

## 1. Purpose

Map LandOS departments and agent role lanes to dashboard / deal-board stages and
the routing behavior between them. It is the operational bridge between the
company architecture (who owns what) and the deal board (where work moves).

---

## 2. Priority and flexibility note

- This is a **baseline routing map**, not final implementation.
- Department names and agent names are **placeholders**.
- Role ownership and handoff clarity matter more than names.
- **LandOS hard rules override this routing map** (`LandOS_Build_Rules.md`).
- Parcel verification, secrets, repo safety, paid-tool, comp-credit,
  destructive-command, and approval rules override any routing convenience here.

---

## 3. Core routing principle

The dashboard / deal board is not just a record display. It should:

- **route work** to the correct role lane,
- **track status** per stage and per role,
- **collect structured outputs** from each lane,
- **surface blockers** explicitly, and
- let the **Command Center synthesize the next best action**.

A stage is "done" only when its required outputs exist and its pass condition is
met — not when someone glanced at it.

---

## 4. Default deal-board stages

1. New Lead
2. Intake
3. Discovery
4. Parcel Verification
5. Due Diligence
6. Valuation
7. Strategy
8. Offer
9. Contract
10. Transaction Coordination
11. Closing
12. Improvement
13. Disposition
14. Sold / Archived

Stage names are provisional. **Parcel Verification is a hard gate** — nothing
downstream proceeds on an unverified parcel.

---

## 5. Stage routing table

Role lanes referenced: Command Center / Orchestrator, Acquisitions, Due
Diligence, Valuation / Comps, Market Intelligence, Marketing / Lead Generation,
CRM / GHL Success Management, Transaction Coordination, Finance / Risk,
Dispositions, Operations / Systems / Forge.

### New Lead
- **Primary:** Marketing / Lead Generation
- **Supporting:** CRM / GHL Success, Acquisitions
- **Trigger:** lead arrives from a campaign/channel
- **Inputs:** source, campaign, raw contact
- **Outputs:** captured lead with source attribution
- **Pass/block:** pass when contact + source recorded; block on missing source
- **Next:** Intake
- **Status indicators:** not_started, queued, completed

### Intake
- **Primary:** Acquisitions
- **Supporting:** CRM / GHL Success
- **Trigger:** lead accepted for work
- **Inputs:** contact, stated property/location
- **Outputs:** normalized contact + stated property, CRM record clean
- **Pass/block:** pass when contact + stated property captured; block on duplicate/contact-hygiene issue (route to CRM Success)
- **Next:** Discovery
- **Status:** not_started, running, blocked, completed

### Discovery
- **Primary:** Acquisitions
- **Supporting:** Due Diligence
- **Trigger:** seller engaged
- **Inputs:** seller context, motivation, stated parcel details
- **Outputs:** seller summary, candidate property identifiers (address/APN if stated)
- **Pass/block:** pass when enough identity signal exists to attempt verification
- **Next:** Parcel Verification
- **Status:** running, blocked, needs_tyler, completed

### Parcel Verification (hard gate)
- **Primary:** Due Diligence
- **Supporting:** —
- **Trigger:** candidate identifiers available
- **Inputs:** APN/address + county/FIPS/state context
- **Outputs:** verification_status, verification_source, confirmed APN/FIPS
- **Pass/block:** **pass only on verified single parcel**; block on unverified, multiple_candidates, or coordinate-only candidate
- **Next:** Due Diligence
- **Status:** verified, unverified, multiple_candidates, blocked

### Due Diligence
- **Primary:** Due Diligence
- **Supporting:** Valuation, Market Intelligence
- **Trigger:** parcel verified
- **Inputs:** verified parcel
- **Outputs:** access, utilities, zoning, buildability, flood/wetland, risk flags (fact-labeled)
- **Pass/block:** block if verification ever regresses to unverified
- **Next:** Valuation
- **Status:** running, blocked, completed

### Valuation
- **Primary:** Valuation / Comps
- **Supporting:** Due Diligence, Market Intelligence
- **Trigger:** DD facts available on a verified parcel
- **Inputs:** verified parcel + DD facts
- **Outputs:** comps, value, value confidence, Investor Resale / Liquidation Value
- **Pass/block:** no value before verified identity; flag low comp quality
- **Next:** Strategy
- **Status:** running, blocked, completed

### Strategy
- **Primary:** Command Center / Orchestrator (owns Strategy at first)
- **Supporting:** Valuation, Finance / Risk, Market Intelligence, Dispositions
- **Trigger:** value + DD + market + economics available
- **Inputs:** DD facts, value, market demand, seller context, risk
- **Outputs:** recommended exit path (flip / subdivide / land-home / value-add / entitlement / owner-finance / pass)
- **Pass/block:** "no_offer" is a valid terminal output
- **Next:** Offer (or Sold/Archived if no_offer)
- **Status:** running, needs_tyler, pass, no_offer

### Offer
- **Primary:** Acquisitions
- **Supporting:** Finance / Risk, Command Center
- **Trigger:** strategy approved
- **Inputs:** strategy, value, economics
- **Outputs:** offer terms draft (Tyler sends; no auto-send)
- **Pass/block:** requires_tyler_approval before sending
- **Next:** Contract
- **Status:** needs_tyler, completed

### Contract
- **Primary:** Transaction Coordination
- **Supporting:** Acquisitions, Finance / Risk
- **Trigger:** signed agreement
- **Inputs:** signed agreement
- **Outputs:** contract record, key dates captured
- **Pass/block:** block on missing signed doc
- **Next:** Transaction Coordination
- **Status:** running, blocked, completed

### Transaction Coordination
- **Primary:** Transaction Coordination
- **Supporting:** Finance / Risk, Due Diligence
- **Trigger:** under contract
- **Inputs:** contract, deadlines, parties
- **Outputs:** title/closing checklist, deadline tracking, doc status, blocker flags
- **Pass/block:** block on title/probate/heirship/earnest-money issue (route to relevant lane)
- **Next:** Closing
- **Status:** running, blocked, needs_tyler, completed

### Closing
- **Primary:** Transaction Coordination
- **Supporting:** Finance / Risk
- **Trigger:** checklist complete
- **Inputs:** clear-to-close
- **Outputs:** closing confirmation, funding status
- **Pass/block:** block on outstanding closing condition
- **Next:** Improvement
- **Status:** running, blocked, completed

### Improvement
- **Primary:** Operations / Systems / Forge
- **Supporting:** Finance / Risk, Dispositions
- **Trigger:** acquired asset
- **Inputs:** improvement scope, budget
- **Outputs:** improvement status, cost tracking
- **Pass/block:** block on budget overrun (route to Finance)
- **Next:** Disposition
- **Status:** running, blocked, completed

### Disposition
- **Primary:** Dispositions
- **Supporting:** Valuation, Market Intelligence, Marketing
- **Trigger:** asset ready to sell
- **Inputs:** resale value, market demand
- **Outputs:** listing, buyer pipeline, resale packaging, price strategy
- **Pass/block:** feeds resale feedback back to Valuation/Market Intelligence
- **Next:** Sold / Archived
- **Status:** running, completed

### Sold / Archived
- **Primary:** Command Center / Orchestrator
- **Supporting:** Finance / Risk, Data / Memory
- **Trigger:** resale closed or deal terminated
- **Inputs:** final outcome
- **Outputs:** outcome record, lessons to Data/Memory
- **Pass/block:** terminal
- **Next:** —
- **Status:** archived

---

## 6. Agent handoff matrix

Each handoff: trigger → required payload → receiving-role output → blocker handling.

| Handoff | Trigger | Required payload | Receiving output | Blocker handling |
|---|---|---|---|---|
| Acquisitions → Due Diligence | identity signal captured | stated address/APN + county/state | verification attempt | block if no identity signal; ask Acquisitions for more |
| Due Diligence → Valuation | parcel verified | verified parcel + DD facts | comps + value | block if unverified/multiple_candidates |
| Valuation → Market Intelligence | value needs demand context | parcel + value | demand/absorption read | flag if market data thin |
| Valuation → Strategy | value + confidence ready | value + DD facts | exit recommendation | block if value confidence too low |
| Finance / Risk → Strategy | economics computed | ROI/holding/risk | accept/flag/reject economics | reject weak economics → no_offer |
| CRM / GHL Success → Acquisitions | missed follow-up / broken workflow | lead/contact + issue | re-engage or fix | escalate if repeated |
| Acquisitions → Transaction Coordination | signed agreement | contract + dates | TC checklist opened | block on missing signed doc |
| Transaction Coordination → DD / Finance / Dispositions | closing blocker appears | blocker detail + deadline | resolve or escalate | needs_tyler if external party stalls |
| Dispositions → Valuation / Market Intelligence | resale feedback | listing/buyer feedback | value/market refresh | none |
| Any role → Command Center | conflict or decision needed | structured result + blockers | synthesis + next action | route to Tyler if approval needed |
| Command Center → Tyler | approval/decision required | options + recommendation + cost/credit status | Tyler decision | wait; never auto-proceed on gated action |

Use the repo handoff convention: `HANDOFF → [Department / Agent]: [one-line]`.

---

## 7. Deal card fields by stage (draft)

Fields the deal card should eventually track (aligns with existing property/deal
card concepts; names provisional):

- `lead_id`, `deal_id`
- `source`, `campaign`
- `seller_contact`
- `property_identifiers`, `apn`, `fips`, `county_state`
- `verification_status`, `verification_source`
- `due_diligence_status`
- `valuation_status`
- `strategy_status`
- `offer_status`
- `contract_status`
- `tc_status`
- `closing_status`
- `disposition_status`
- `assigned_primary_role`, `supporting_roles`
- `blockers`
- `next_best_action`
- `requires_tyler_approval`
- `paid_tool_approval_status`
- `comp_credit_used`
- `last_updated`

Secrets never enter deal cards. Property-specific private work product stays out
of the repo; deal cards live in the runtime store, not in committed docs.

---

## 8. Status model

Common statuses across stages and roles:

- `not_started`
- `queued`
- `running`
- `blocked`
- `needs_tyler`
- `verified`
- `unverified`
- `multiple_candidates`
- `completed`
- `failed`
- `pass`
- `no_offer`
- `archived`

---

## 9. Guardrail routing rules

- No scoring, valuation, or offer before verified parcel identity.
- Due Diligence **must block** if parcel identity is `unverified` or `multiple_candidates`.
- Address ambiguity must **never** auto-select a parcel.
- Coordinates / point lookup / visual / map-pin / proximity **never** verify identity (candidate discovery only, pending APN/address/official-record confirmation).
- Paid comp tools require explicit Tyler approval; `paid_tool_approval_status` gates them.
- Comp credit use must be tracked (`comp_credit_used`).
- Secrets never enter deal cards.
- Property-specific private work product is not written into the repo.

These restate `LandOS_Build_Rules.md` and the Execution Overlay; they always win
over routing convenience.

---

## 10. CRM / GHL routing lane

CRM / GHL Success Management interacts with routing as a monitor and feeder, not
a controller. **No direct GHL modifications in this doc.**

- missed-lead alerts → Acquisitions
- overdue follow-up → Acquisitions
- appointment status tracking
- pipeline-stage hygiene (stale/mis-staged deals)
- duplicate / contact issues
- form / source attribution integrity
- automation health monitoring
- handoff to Acquisitions on any actionable gap

GHL/CRM remains one leg inside LandOS; this lane watches and routes it.

---

## 11. Transaction Coordination routing lane

- starts **after** signed agreement / contract
- tracks title / attorney / title-company communication
- DD deadline tracking
- closing date
- seller document collection
- probate / heirship / title blockers
- earnest money / deposit status
- purchase-side and resale-side closing coordination
- handoff to Improvement / Disposition post-close

TC sits between Acquisitions, Due Diligence, Finance, and Dispositions and owns
the signed deal until the asset is handed off post-close.

---

## 12. Async delegation future hooks (concept only)

- each stage can later create background tasks
- the dashboard should track task status per delegated task
- results re-enter the deal card
- Command Center synthesizes results into a recommendation
- **no async implementation in this doc**

---

## 13. MVP dashboard implication (smallest future step)

The smallest useful future implementation:

- add stage-owner metadata (primary role per stage)
- add per-role status fields
- add blocker fields
- add a `next_best_action` field
- show `verification_status` prominently
- show `paid_tool_approval_status`
- **do not add an async queue yet**

---

## 14. Build order recommendation

1. Routing map doc (this file)
2. Dashboard metadata / schema inspection
3. Duke v2 dashboard wiring behind a flag
4. Duke Partial Report workflow
5. Deal card role / status display
6. Cal valuation layer
7. Command Center synthesis
8. CRM / GHL Success lane
9. Transaction Coordination lane
10. Async delegation later

Order is a recommendation; Tyler can resequence.

---

## 15. Explicit non-goals

This document is **not**:

- dashboard code implementation
- async queue implementation
- new agent creation
- a Duke behavior change
- a GHL modification
- paid-tool approval
- a final naming decision

If anything here appears to permit something a hard rule forbids, the hard rule
controls and this document is wrong in that moment.
