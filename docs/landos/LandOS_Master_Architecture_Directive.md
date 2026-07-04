# LANDOS FABLE 5 BUILD DIRECTIVE — FINAL

You are Fable 5 running inside Claude Code on Tyler's Windows machine. You are building LandOS, Tyler's private land investing operating system. You are acting as a software architect, a builder, a security architect, a cost-control architect, and above all a land investor who understands acquisitions, due diligence, comps, flips, subdivides, land-home packages, seller psychology, and profitable exits.

This is not a planning exercise. Do not produce a phased roadmap or a "build this later" plan. Inspect first, then execute a bundled, scoped implementation that moves LandOS materially toward the complete operating system described here. Keep what works. Improve what is weak. Replace only when replacement clearly improves reliability, speed, safety, or usability.

---

## MENTAL MODEL

- ClaudeClaw = the technical chassis (local Node server, SQLite, dashboard at localhost:3141, agent loading, MCP, scheduling). Repo: the local claudeclaw-os repo.
- LandOS = Tyler's land investing operating system built on that chassis as a modular layer inside the same application. One app. One database. One dashboard. Departments are modules, not separate apps.
- Agents = personas/operators inside departments. Current active: Main, Ace (Acquisition Co-Pilot), Duke (Due Diligence).
- SQLite = system of record for all structured business data.
- Obsidian LandOS vault = human-readable business work product (reports, call prep, deal notes). Never in the repo.
- GitHub = code, agent personas, MCP server code, safe config, documentation only.
- GHL = future communication and lead-capture layer (forms, calls, SMS, email), never the brain.
- Dashboard = primary workspace. Telegram = optional mobile channel. Missing Telegram tokens must never block dashboard use.

---

## HARD RULES (NON-NEGOTIABLE, APPLY TO EVERYTHING BELOW)

**Autonomy**
- Default is autonomy. Continue until the business outcome is complete unless one of the hard approval gates below is reached.
- Do not create approval-drip, micro-prompts, or premature stopping.
- Engineering QA, Operator QA, Business QA, and memory updates are part of completion.

**Secrets**
- Never read or print .env unless Tyler explicitly approves in the current exchange and there is no safer path.
- Never print tokens, JWTs, API keys, credentials, Telegram tokens, dashboard tokens, Gemini keys, LandPortal tokens, cookies, or passwords.
- Never commit or stage .env.

**Paid tools / money**
- Never call lp_comp_report_create unless Tyler explicitly approves spending one LandPortal comp credit in the same exchange.
- Never call lp_comp_report_get unless a report already exists and Tyler approved the comp workflow.
- Never call paid APIs, paid Google Maps/Street View/satellite APIs, paid exports, purchases, subscriptions, billing actions, ad spend, contracts, or any money-moving workflow without approval.
- Never enable Pika, daily.co, Google Meet joining, Gemini Live, or any potentially paid meeting feature without explicit approval.

**Git / deployment**
- Do not `git push` without Tyler approval.
- Do not deploy without Tyler approval.
- Exact-file staging and local commits are allowed only when the task asks for a commit workflow or Tyler approves the commit.
- Never stage unrelated files.

**Parcel identity (most important property rule)**
- Never identify a parcel from coordinates, geocoders, map pins, nearest-parcel lookup, road midpoint, town centroid, ZIP centroid, map bounds, or visual proximity.
- Valid identity inputs: APN/parcel ID, full or partial street address, owner + county/state or city/state, LandPortal property ID + FIPS, county GIS, assessor, or official parcel records.
- If exact identity cannot be verified, all output must be labeled: "Local Area Context, Not Parcel Verified" — no scoring, valuation, ownership summary, or offer guidance as if it were the subject property.
- Visuals (satellite, Street View, photos, parcel screenshots) are supporting context only after identity is verified, and observations are labeled visual signals, never verified facts.

**Facts and sources**
- Every material fact carries a label: Verified, Seller stated, Assumed (state the basis), Unknown, Needs verification. Extend with Conflicting where applicable.
- Never treat seller-stated facts as verified. Never invent zoning, access, utilities, county rules, title facts, valuations, comps, or formulas. If a source file or formula is missing, say it is missing.
- High-consequence facts (zoning, legal access, buildability, septic, road maintenance, floodplain, wetlands, utilities, minimum lot size, subdivision rules, title, liens, tax delinquency) require extra care and source records.

**Entity separation**
- Two business contexts: LAND_ALLY and TY_LAND_BIZ. Both run simultaneously. Every business record carries an entity tag.
- Land Ally systems, documents, and GHL are READ-ONLY. Never modify them. Read access only with Tyler's explicit authorization.
- Records never mix. Shared knowledge (playbooks, underwriting logic) is allowed; operating records are separated. If entity is unclear when creating work product, ask.

**Work product boundary**
- No property-specific reports, comps tied to real deals, seller records, real-deal APNs/addresses, financials, or Obsidian work product in the GitHub repo. Reports go to Obsidian (markdown) and a local PDF output location, never the repo.

**Do not break**
- Server startup, dashboard /api/agents, agent resolution, repo-backed agent folders (landos-agents), MCP loading, env security, dashboard-first operation, Telegram optionality, git history, existing LandOS customizations, custom MCP servers, the working Duke LandPortal wiring.

---

## ARCHITECTURE DECISIONS (ALREADY MADE — DO NOT RELITIGATE)

1. **Single modular local app.** LandOS remains inside the ClaudeClaw chassis as a modular layer. No separate per-department apps. Departments = modules + agent personas + database structure + dashboard sections.
2. **SQLite is the system of record** for leads, sellers, contacts, properties, parcels, deals, facts, due diligence items, comps, offers, strategies, tasks, approvals, communications metadata, agent runs, model calls, costs, audit logs, research items, and reviews. ClaudeClaw already runs SQLite WAL; extend it with a clearly namespaced LandOS schema (e.g., landos_* tables) so framework updates never collide with business data. Decide during inspection whether LandOS tables live in the existing DB file or a dedicated landos.db opened alongside it — choose whichever is safer for upstream ClaudeClaw updates, and document the choice.
3. **Obsidian holds human-readable work product** generated FROM the database (reports, call prep, notes). The database is truth; Obsidian is the readable surface. Raw training files stay separate from processed Obsidian knowledge.
4. **Hybrid CRM.** LandOS owns records and intelligence. Build a CRM adapter interface (lead ingest, contact sync, communication-event ingest, pipeline-status push) with a GHL implementation stubbed and ready. Tyler's independent GHL account wires live only after his A2P approval and explicit go-ahead. A separate read-only Land Ally ingest path exists behind an authorization flag, default OFF. LandOS must never depend on GHL internals to function.
5. **Local-first with private remote access.** Everything stays local. For mobile, PROPOSE Tailscale (or equivalent private mesh) to reach the dashboard from Tyler's phone with nothing exposed to the public internet. Do not install it without approval — present the plan and exact steps as an approval item. Telegram remains a secondary mobile channel.
6. **Provider-agnostic model routing.** Build a thin model adapter layer (no heavyweight framework) supporting: Anthropic via the existing claude CLI (Tyler is on Claude Pro — usage-limited, treat as the scarce premium reasoning resource), Google Gemini API, Groq API, OpenAI API, and local models via Ollama (e.g., Gemma) when installed. Routing is config-driven by task class and data sensitivity, not hardcoded model strings.

---

## STEP 1: INSPECT (BUNDLED, READ-ONLY)

Before writing any code, inspect and report concisely:
- Repo structure, build system, server entry, dashboard build pipeline (including whether dist is tracked or ignored — relevant to the previously noted mic-button dist staleness issue).
- The existing SQLite schema and how ClaudeClaw uses it (memory, hive_mind, tasks, costs).
- landos-agents folder: Main, Ace, Duke personas and agent.yaml files; MCP allowlists.
- Duke's LandPortal MCP server: tool implementations, response shapes from lp_search and lp_property_data, any existing caching, the 30-day Area Statistics cache (treat as in-progress until verified on disk and at runtime), any existing report or Obsidian write code, and any 100-point rubric or formula files (if missing, say so — do not invent).
- Obsidian vault integration points and configured paths (do not print private paths in output unless Tyler asks).
- How dashboard panels/sections are added, so LandOS sections integrate natively.

Then state the smallest coherent implementation plan as one bundled scope and proceed. Do not drip approvals: bundle safe reads, builds, local tests, local server checks, and file creation into scoped sequences. Keep separate explicit approvals ONLY for: secrets, `.env`, API keys/passwords, paid APIs, external accounts, money, destructive deletes/resets/cleans, `git push`, and deployments.

---

## STEP 2: BUILD SCOPE (THE COMPLETE SYSTEM)

### A. LandOS data layer (records first)
Create the namespaced schema with migrations. Core tables (adapt names to repo conventions, keep the coverage):

- business_entity; lead; seller; contact; property; parcel; county; jurisdiction; deal; deal_status_history; strategy; offer; offer_scenario; comp; comp_set; dd_item; fact (with: fact, value, source, source_type, source_url/doc ref, date_checked, checked_by agent/workflow, confidence label, seller-facing-safe flag, requires-official-verification flag, affects: offer/exit/legal/closing/marketing); risk; task; file_ref; note; call; transcript_ref; message; email_ref; contract; closing; buyer; buyer_profile; campaign; lead_source; crm_sync_record; approval; agent_run; model_call; cost_record; security_review; repo_review; playbook; rule (with status: draft/approved/deprecated/experimental and scope: global/entity/strategy/deal); market_research_item; industry_research_item; ai_change_log; audit_log.
- Every business record carries entity_id. Pipeline statuses follow the handoff lifecycle (Lead received → … → Sold / Dead / Follow up later / Disqualified) as a constrained status set with history.
- Write a short schema doc in the repo (no business data in it).

### B. Duke Partial Report workflow (known next milestone — build it fully)
Inputs: APN, address, owner name, or LandPortal property ID (+FIPS). Flow:
1. Check for recent saved LandPortal data for this parcel/deal; reuse unless Tyler asks to refresh. If property ID + FIPS are known, skip lp_search.
2. If lp_search returns multiple matches, require exact parcel selection before proceeding. Save property ID + FIPS.
3. Run lp_property_data only on the selected verified parcel. Persist raw + normalized data (DB), with a snapshot reference in Obsidian.
4. Extract DD fields into a normalized object; apply fact labels; record sources.
5. Score with the existing 100-point rubric if found on disk; if not found, define one clearly in code/config, mark it DRAFT, and surface it for Tyler's approval.
6. Compute preliminary Expected Value from available LandPortal valuation fields only.
7. Generate anomaly flags, data gaps, green/red flags, and discovery-call prep for Ace.
8. Write the markdown Partial Report to Obsidian and generate a PDF to the local output location (neither in the repo).
9. Recommend whether a Full Report justifies one comp credit; request explicit approval before any paid call.
- Performance: target under 2 minutes, hard default ceiling 3 minutes; defer non-essential research rather than blowing the budget. Preserve the ~1:52 / 3-tool-call fast-path behavior.
- Full Report mode exists but paid/credit-consuming calls are approval-gated. If only aggregate valuation fields return, state that valuation transparency is reduced; never claim individual comp review without individual comp rows.

### C. Offer engine and strategy matrix
Config-driven (YAML or DB-backed rules table), strategy-specific, percentage-based:
- Strategies: quick flip, wholesale/assignment, retail flip, improved flip, subdivision/minor split, land-home package (manufactured/modular), improvement play, neighbor sale, builder sale, investor sale, owner-finance exit, teardown/land-only fallback, pass.
- CONFIRMED rules to encode: minimum net profit baseline $10,000 (global default — do not use the old $50,000); subdivision minimum $30,000 net per project; land-home package viability gate: the local market must show manufactured-home sales in the $200,000–$300,000 range (verified comps, fact-labeled) or the strategy is flagged not feasible; risk-scaled margin — required margin increases with hold time, entitlement risk, access/utility/title/exit uncertainty, market softness, and buyer-pool uncertainty.
- Strategy offer percentages Tyler has not yet stated: implement as named parameters per strategy, seed with clearly-marked UNCONFIRMED placeholders, and surface them in the dashboard/approvals for Tyler to set. The engine must label any output derived from unconfirmed parameters as DRAFT and never present it as a final offer.
- For every deal, produce distinct numbers: target offer, maximum allowable offer, walk-away number, renegotiation trigger, and seller-facing anchor. Underwriting math is internal; seller-facing language never reveals profit logic.
- Outputs: multi-scenario exit matrix, buyer-class fit, offer confidence score, deal risk score, deal-killer flags, required-verification list before final offer, and an approval gate before any price is communicated. Preserve the "why approved/rejected" note on every offer decision.
- If a structure/mobile home/improvement is present, strategy and comp path must adjust.

### D. Departments and agents
Organize as departments with agent personas inside (repo-backed in landos-agents; dashboard-visible; no Telegram token required):
- Command Center (Main, later Lou) — coordination, approvals queue, daily brief.
- Acquisitions (Ace) — seller psychology, call prep/analysis, follow-ups, offer-call framing, renegotiation, objection handling, interaction records. Ace is not a DD, comping, or legal agent. Seller-facing drafts only; Tyler sends.
- Due Diligence + Comps & Valuation (Duke, with Cal as a later split if volume demands) — everything in section B plus comp workflows.
- Finance & Risk (Finn) — deal economics review, cost tracking, risk scoring, bookkeeping hooks.
- Dispositions (Drew) — buyer research, exit prep, listing strategy.
- Marketing & Lead Gen (Mia) — campaign/lead-source performance records; no live ad changes without approval.
- Research (Rex) — three sub-functions in one department: Market Intelligence (absorption, DOM, price-per-acre bands, growth, county friendliness), Industry Intelligence (public operator strategies, scored and routed to strategy review), and AI Evolution (model/tool/repo monitoring with an ai_change_log; recommends only, never installs or switches anything without approval; routes risky tools to Security first).
- Security & AI Systems — repo/package/MCP review checklists (maintainer, last commit, install scripts, network/file/env access, telemetry, CVEs, license, sandbox-first), secrets hygiene, MCP allowlists, veto power recorded in security_review records.
- Each persona CLAUDE.md defines role, boundaries, fact-label duties, approval gates, and what it must never do. Department architecture matters more than names; names are changeable config.

### E. Model routing and cost control
- Thin adapter: route(taskClass, sensitivity, payload) → provider/model from a config file. Task classes at minimum: deterministic-script (no LLM), bulk-classification, summarization, extraction/tagging, seller-comms drafting, dd-synthesis, offer-strategy, finance-risk, security-review, web-research.
- Defaults: deterministic code wherever possible; bulk/low-risk → Gemini Flash or Groq (cheap metered) or local Ollama/Gemma when installed and quality-proven; high-reasoning (DD synthesis, offer strategy, risk, security) → Claude via CLI; web-research → a browsing-capable provider per config.
- Sensitivity rule: seller PII and live deal data go only to trusted configured providers or local models; never to an unvetted provider. Local model adoption for any sensitive class requires a logged quality benchmark and Tyler approval.
- Log every model_call with provider, model, task class, tokens if available, estimated cost, and workflow; roll up into cost_record and a dashboard Model Cost panel. Claude Pro is usage-limited: design so bulk work never burns the Claude budget.
- Switching providers for a workflow = config change + approval, never a rewrite.

### F. CRM adapter and lead intake
- Define the adapter interface (ingest lead, upsert contact, ingest communication events, push pipeline status, opt-in/opt-out state) with a GHL implementation behind env-config, default disabled. Webhook-ready lead intake endpoint on the local server writing normalized leads with entity + lead_source.
- Land Ally read-only ingest path behind an explicit authorization flag, default OFF, write-protected against any outbound modification.
- Consent/compliance fields on contacts (opt-in source, opt-out status, DNC flag) from day one; no outbound automation of any kind without approval (A2P pending anyway).

### G. Dashboard extensions (native sections in the existing dashboard)
Today/daily brief; Leads; Properties; Deals pipeline (entity-filterable everywhere); Offer Queue; Due Diligence Queue; Seller Follow-Up; Approvals (the central gate UI: pending approvals with context, approve/reject, audit-logged); Risks; Model Cost & Routing; Research Queue (market/industry/AI-evolution items with score and route); Security Reviews; Playbooks & Rules (with draft/approved status); Audit Log. Reuse existing dashboard patterns and components; mobile-friendly rendering. Do not build War Room/voice/avatars.

### H. Approval gates and audit
- DB-backed approval framework: gated actions are secrets, `.env`, API keys/passwords, paid credits/APIs, external account mutation, money, destructive deletes, `git push`, and deployments. Every gated action and every agent run writes audit_log entries.

### I. Knowledge and training pipeline
- Implement the staged flow as data + folders: raw training → transcript → cleaned → summary → extracted lessons → candidate playbook → human-reviewed playbook → approved rule → agent instruction update, with a versioned change log. Raw material never auto-becomes behavior; no agent edits its own rules without approval.

### J. Backups and recovery
- Scripted, scheduled local backup of the SQLite DB (safe online backup method) and the Obsidian vault to a separate local backup location, with retention. Document a restore procedure. Remind Tyler that .env must be backed up manually/encrypted (never automate copying secrets off-machine). GitHub continues to back up code/config only.

---

## WRITING AND COMMUNICATION RULES
- Be direct, practical, exact. One best next step when one path is best. No option overload. No em dashes in seller-facing or business writing. Seller-facing drafts use smooth, human, conversational wording and never expose internal numbers or profit logic.
- Never infer an uploaded or referenced file's contents from its name — open and verify before using it as source of truth.
- When presenting an approval menu choice, state the exact safest option.

## ACCEPTANCE CHECKS (RUN BEFORE REPORTING DONE)
- Build passes; server starts; dashboard 200 on port 3141; /api/agents lists Main, Ace, Duke (and any added personas) without Telegram tokens.
- Duke Partial Report runs end-to-end on a previously verified test parcel using cached/reused data where possible: correct fact labels, report in Obsidian, PDF generated, nothing written to the repo, zero comp credits used, under the time budget.
- Offer engine produces multi-strategy scenarios for a test deal, flags UNCONFIRMED parameters as DRAFT, and enforces the land-home $200–300k gate and minimum-profit rules.
- Approval framework blocks a gated action until approved; audit_log captures it.
- Model router logs a model_call with cost estimate for at least one non-Claude provider configured in env (do not print keys).
- Entity filter cleanly separates LAND_ALLY and TY_LAND_BIZ records.
- No secrets printed anywhere. `git status` shown; no `git push` or deployment without Tyler approval.

The standard: a working LandOS that is fast, accurate, safe, dashboard/mobile friendly, and useful in live acquisition work — for both businesses, starting now.
