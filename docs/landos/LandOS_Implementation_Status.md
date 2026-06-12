# LandOS Implementation Status

Tracking doc for LandOS build blocks. No secrets, no deal data.
Master doctrine: `LandOS_Master_Architecture_Directive.md`.
Current block definition: `LandOS_OS_Spine_v1_Build_Block.md`.

Last updated: 2026-06-12 (OS Spine v1).

## OS Spine v1 — BUILT

| Piece | Status | Where |
|---|---|---|
| Architecture docs | Built | `docs/landos/` (directive, build block, this doc) |
| Dedicated business DB | Built | `store/landos.db` via `src/landos/db.ts` (lazy init, WAL, gitignored) |
| 20 landos_* tables | Built | business_entity, contact, seller, lead, property, parcel, deal, fact, task, file_ref, note, agent_run, approval, audit_log, rule, playbook, model_call, cost_record, security_review, research_item |
| Entity separation | Built | `entity` FK to landos_business_entity on all business tables; LAND_ALLY + TY_LAND_BIZ seeded; API entity filter |
| Fact labels | Built | CHECK constraint: Verified / Seller stated / Assumed / Unknown / Needs verification / Conflicting, plus source, source_type, source_ref, date_checked, checked_by, seller_facing_safe, requires_official_verification, affects |
| Approval + audit spine | Built | `createApproval` / `decideApproval` / `gateAction` (single-use approvals, blocked-until-approved, every gate event audited); 11 gated action types |
| Rules registry | Built | status: draft / approved / deprecated / experimental; scope: global / entity / strategy / deal; API creates drafts only |
| Playbook lifecycle | Built | raw_training → … → agent_instruction_update CHECK-constrained; raw training never auto-promotes |
| Department registry | Built | `src/landos/departments.ts` — 3 active (Command Center/Main, Acquisitions/Ace, DD+Comps/Duke), 5 planned (config-only, no agent folders) |
| 100-point rubric config | Built | `src/landos/rubric.ts`, encoded from Duke CLAUDE.md Section 7, status **approved** (it is Tyler's active rubric, not a draft) |
| Offer engine foundation | Built | `src/landos/offer-engine.ts` — 13 strategies; confirmed: $10k global min net, $30k subdivision min, land-home $200k–$300k verified-sales gate, risk factor list, flip 40–60% / subdivide 55–65% EV bands; everything else named UNCONFIRMED params; DRAFT labeling enforced in output |
| Model call + cost schema | Built | `landos_model_call`, `landos_cost_record` + `logModelCall` / `logCostRecord`. No providers wired, no keys read |
| Research + security foundation | Built | research_item (market / industry / ai_change), security_review with repo/package/MCP checklist fields |
| Dashboard API | Built | `/api/landos/*`: overview, entities, departments, leads, deals, dd-queue, offer-queue, approvals (+approve/reject), rules, playbooks, research, security-reviews, costs, audit, rubric, strategies, strategies/evaluate. Behind existing token auth |
| Dashboard UI shell | Built | `web/src/pages/LandOS.tsx` at `/landos` (sidebar, `g l`): entity filter tabs, module count cards, pending approvals with approve/reject, department registry |
| Tests | Built | `src/landos/landos.test.ts` (22) + `src/landos/routes.test.ts` (13) — 35 passing |

## Duke workflow proof — status

Duke's verified fast path (sub-2-minute Default Duke Report, lp_search /
lp_resolve_property / lp_property_data only, 0 comp credits) is untouched and
remains the live workflow proof. OS Spine v1 added the persistence route
points Duke's workflow will write into:

- `landos_parcel` — LP property id + FIPS, raw LP JSON, normalized JSON,
  verification source/time (steps 3–4 of the target flow)
- `landos_fact` — labeled material facts with sources (steps 5–6)
- `landos_agent_run` — run telemetry with status/duration
- `/api/landos/dd-queue` — dashboard surface

**Remaining for full Duke integration (next block):** a hook that persists
Duke's LP responses and fact labels into these tables at runtime. Duke runs
as a Claude agent through the SDK; the clean integration point is either a
small CLI Duke calls after composing a report (like gen-pdf-bg.js) or a
post-run ingest in the agent layer (`src/agent.ts` — not touched in this
block because it carries unrelated uncommitted local changes). Until then,
Duke's reports continue to flow to Obsidian + PDF exactly as today.

## Intentionally not built (per directive)

Live GHL/CRM adapter and sync, outbound SMS/email automation, full model
router and provider connections, future agents (Finn/Drew/Mia/Rex/Lou/Cal),
AI Evolution automation, external web research automation, backup automation,
Tailscale, War Room/voice/avatars, paid APIs, package installs, LandPortal
comp report calls, training-file processing, git commits/pushes.

## Known pre-existing test failures (not caused by OS Spine v1)

12 failures across 3 committed test files, none importing `src/landos`:
- `src/skill-registry.test.ts` (9) — skill folder fixture behaviors
- `src/exfiltration-guard.test.ts` (2) — hex secret pattern expectations
- `src/dashboard.contract.test.ts` (1) — stale test: expects 400 for
  `/api/chat/history` without chatId, but the committed handler was
  intentionally changed to return 200 with a default

## Needs Tyler approval / decision

1. UNCONFIRMED offer parameters: wholesale 30–50%, retail flip 45–60%,
   neighbor 40–60%, builder 40–60%, investor 35–55%, draft risk haircut
   2 pct pts per active risk factor. Visible via `/api/landos/strategies`.
2. Restarting the running ClaudeClaw process so the live dashboard picks up
   the new `/api/landos/*` routes and the LandOS page (the running process
   predates this build; routes verified in-process via contract tests).
3. Git staging/commit of the OS Spine v1 files (exact list in the build
   report; nothing staged).
4. Next block scope: Duke runtime persistence hook (see above).
