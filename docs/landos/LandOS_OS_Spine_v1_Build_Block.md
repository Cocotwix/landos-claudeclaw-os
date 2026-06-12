# LandOS OS Spine v1 — Build Block

Scoped executable build derived from `LandOS_Master_Architecture_Directive.md`.
This document defines what OS Spine v1 builds. Progress and outcomes are tracked
in `LandOS_Implementation_Status.md`. No secrets, no deal data.

## Objective

Build the operating spine for LandOS inside the ClaudeClaw chassis so future
departments, workflows, approvals, rules, and dashboard modules extend a shared
foundation instead of being rebuilt agent by agent. Duke remains the first live
workflow proof; this block does not rebuild Duke.

## Architecture decisions made in this block

1. **Dedicated `store/landos.db`** opened alongside `store/claudeclaw.db`.
   Reason: Tyler pulls upstream ClaudeClaw updates (fork + upstream merge
   workflow). Framework schema migrations rewrite `claudeclaw.db` and
   `src/db.ts`; a separate business DB file guarantees zero collision with
   upstream changes, allows independent backup/restore of business data, and
   is already covered by `.gitignore` (`*.db`). Same conventions: WAL,
   busy_timeout 5000, chmod 0600, idempotent `CREATE TABLE IF NOT EXISTS`.
2. **All tables namespaced `landos_*`** even inside the dedicated file, so a
   future consolidation into one DB file (if ever wanted) is a file merge,
   not a rename.
3. **Lazy initialization** (`getLandosDb()`), so no chassis startup file
   (`src/index.ts`) needs modification and agent subprocesses that never touch
   LandOS data never open the DB.
4. **Routes mounted into the existing dashboard Hono app** behind the existing
   token auth middleware, registered before the SPA catch-all.
5. **Entity separation** via `entity` column constrained to
   `LAND_ALLY` / `TY_LAND_BIZ` on every business record table, seeded in
   `landos_business_entity`. Land Ally operating systems remain read-only;
   this DB stores LandOS-side records only.

## Scope

### A. Data layer — `src/landos/db.ts`
Tables (all `landos_` prefixed): business_entity, contact, seller, lead,
property, parcel, deal, fact, task, file_ref, note, agent_run, approval,
audit_log, rule, playbook, model_call, cost_record, security_review,
research_item.

- Facts: label CHECK (Verified / Seller stated / Assumed / Unknown /
  Needs verification / Conflicting) plus source, source_type, source_ref,
  date_checked, checked_by, seller_facing_safe, requires_official_verification,
  affects (offer/exit/legal/closing/marketing).
- Rules: status CHECK (draft / approved / deprecated / experimental), scope
  CHECK (global / entity / strategy / deal).
- Playbooks: lifecycle stage CHECK (raw_training → transcript → cleaned →
  summary → extracted_lessons → candidate_playbook → reviewed_playbook →
  approved_rule → agent_instruction_update). Raw training never auto-promotes.
- Leads: constrained pipeline status set with the handoff lifecycle.
- Parcel: persists LP property id + FIPS, raw LP JSON, normalized JSON,
  verification source and timestamp (Duke workflow route point).

### B. Approval + audit spine — in `src/landos/db.ts`
- `createApproval` / `decideApproval` / `gateAction`. Gated actions block
  (return `allowed:false` and a pending approval id) until an approval row is
  approved; approvals are single-use (`consumed_at`). Every gate check and
  decision writes `landos_audit_log`.
- Gated action types: seller_message, crm_change, paid_credit, offer_price,
  file_deletion, package_install, config_security_change, data_export,
  external_connection, ad_change, contract_edit.

### C. Department registry — `src/landos/departments.ts`
Command Center (Main, active), Acquisitions (Ace, active), Due Diligence +
Comps (Duke, active), Finance & Risk, Dispositions, Marketing & Lead Gen,
Research, Security & AI Systems (planned, config-only — no agent folders
created; department architecture over names).

### D. Rubric — `src/landos/rubric.ts`
Machine-readable encoding of the existing 100-point rubric from Duke's
CLAUDE.md Section 7 (six factors, verdict tiers, tier-downgrade override,
mountain market modifier). Status: approved (it is Tyler's active rubric);
source reference recorded.

### E. Offer engine foundation — `src/landos/offer-engine.ts`
13 strategies. Confirmed rules encoded: $10,000 global minimum net profit
(replaces old $50,000), $30,000 subdivision minimum net per project,
land-home package gate (verified local manufactured-home sales $200k–$300k
or strategy flagged not feasible), risk-scaled margin factor list, plus the
EV percentage bands already confirmed in Duke's persona (flip 40–60%,
subdivide 55–65%). All other strategy percentages are named parameters
marked UNCONFIRMED; any scenario derived from them is labeled DRAFT and never
presented as a final offer. No seller-facing pricing automation.

### F. Model call + cost foundation — schema + `logModelCall` /
`logCostRecord` helpers. No providers wired, no keys read, no routing.

### G. Research + Security foundation — research_item (market / industry /
ai_change) and security_review with repo/package/MCP checklist fields.
No external feeds, no installs, no auto-switching.

### H. Dashboard shell
- Backend: `src/landos/routes.ts` — `/api/landos/overview, departments,
  entities, leads, deals, dd-queue, offer-queue, approvals (+ approve/reject),
  rules, playbooks, research, security-reviews, costs, audit`, all entity
  filterable where applicable.
- Frontend: one LandOS overview page (`web/src/pages/LandOS.tsx`) with entity
  filter, module section cards, pending approvals with approve/reject, and the
  department registry. Sidebar route `/landos`. No big UI redesign.

### I. Duke route points (workflow proof wiring)
`landos_parcel` / `landos_fact` / `landos_agent_run` give Duke's existing
fast-path workflow a place to persist raw + normalized LP data, fact labels,
and run telemetry. Hooking Duke's live runtime into these tables is reported
in the status doc as remaining work — Duke's verified fast-path behavior is
not modified in this block.

## Explicitly out of scope (deferred)
Live GHL/CRM sync, outbound automation, full model router, future agents,
AI Evolution automation, external research automation, backups, Tailscale,
War Room/voice/avatars, paid APIs, package installs, LandPortal comp calls,
training-file processing, git commits/pushes.

## Acceptance checks
Typecheck + tests pass; vite + tsc build passes; dashboard 200 on 3141 and
`/api/agents` lists Main, Ace, Duke (verified if safe to test); approval gate
blocks until approved with audit entries; entity filter separates LAND_ALLY /
TY_LAND_BIZ; offer engine enforces confirmed rules and labels UNCONFIRMED
params DRAFT; zero comp credits; no secrets printed; no property work product
in the repo; git status shown with nothing staged.
