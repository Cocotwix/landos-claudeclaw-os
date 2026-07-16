# LandOS Implementation Status

Tracking doc for LandOS build blocks. No secrets, no deal data.
Master doctrine: `LandOS_Master_Architecture_Directive.md`.
Current block definition: `LandOS_OS_Spine_v1_Build_Block.md`.

Last updated: 2026-06-25 (CP3–CP6: Knowledge layer + data providers).

## Current state — 2026-06-25

**Pushed commit:** `79dad13435b03312849746af9558cd8b2b3eb30d`
(`LandOS: R2-ready KnowledgeStore, Realie adapter, and knowledge dashboard`)

### Repo status
- `origin/main` is at `79dad13435b03312849746af9558cd8b2b3eb30d`.
- Local `main` is synced (0 ahead / 0 behind).
- Only known untracked file: `landos-agents/acquisition-copilot/.no-avatar` (pre-existing, unrelated, not staged).

### Completed sections (cumulative)
- LandOS shell and architecture foundation
- Safe upstream ClaudeClaw adoption
- SDK 0.3 migration
- Memory isolation + shared memory tier
- Provider abstraction
- Model router / capability scoring / execution environments
- Live execution service with safe mode
- Grunt helpers
- Deal Card workflow lane backend
- Operational Underwriting
- R2-ready KnowledgeStore (config-gated; local-fs default, lazy R2 SDK)
- Realie.ai live-ready adapter (behind the provider layer; never fabricates)
- Knowledge ingestion shell (deterministic, roster-validated, raw_training only)
- Knowledge dashboard tab + read-only status/manifest/scorecard routes

### Verification (this block)
- `npx vitest run src/landos` → **1233 tests / 92 files green**, 0 failures
- `npx tsc --noEmit` → clean
- `npm run build` (vite + tsc) → succeeds
- No `.env` touched · no paid/live calls · no secrets in the diff

### Remaining setup Tyler must add later
1. **R2 env keys:** `LANDOS_R2_ACCOUNT_ID`, `LANDOS_R2_ACCESS_KEY_ID`, `LANDOS_R2_SECRET_ACCESS_KEY`, `LANDOS_R2_BUCKET` (optional `LANDOS_R2_ENDPOINT`, `LANDOS_KNOWLEDGE_BACKEND=r2|local|auto`).
2. **Install `@aws-sdk/client-s3`** once approved (not installed; `auto` falls back to local-fs, forced `r2` fails loud until present).
3. **Realie API key + endpoint confirmation:** set `REALIE_API_KEY` (optional `REALIE_API_BASE`) and confirm the real lookup path (assumed `GET {base}/parcels/lookup`, bearer auth) before the first live call.
4. **Restart the dashboard** process to pick up the new routes + Knowledge tab (live restart not performed).

### Deferred by design (not bugs)
- Embeddings / indexing over ingested manifests (shell is deterministic intake only).
- Live market-data adapters feeding the County Scorecard (metrics stay `unavailable`, never fabricated).
- Approval-gated promotion of raw training → agent instruction (promotion guard returns false by design).
- Live Realie calls until credentials + endpoint are confirmed.
- Live R2 until credentials + SDK install are approved.

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

Duke's verified fast path (under-2-minute Default Duke Report preferred, up to 3 minutes acceptable; lp_search /
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

## LandOS Lead Workspace (foundation built 2026-07-15 — QA in progress)

Status update 2026-07-15: the Lead Workspace foundation is implemented and
mid-QA under sprint `sprint-2026-07-15-lead-workspace-foundation`
(`.landos/sprints/sprint-2026-07-15-lead-workspace-foundation/ledger.json`).
It ships a versioned read-only read model (`src/landos/lead-workspace.ts`),
the `/api/landos/lead-workspace/:id` endpoint, a responsive
`web/src/components/LeadWorkspace.tsx` UI reached from Acquisitions
(`/dept/acquisitions?deal=<id>`), and composition of WS1–WS3 canonical
services without recomputation. The browser journey passes on the current
bundle (see `.landos/qa/2026-07-16-lead-workspace-foundation.md`), but the
sprint's formal ledger gates (phases, qa-brief/qa-result, independent QA)
are still open; see `.landos/CHECKPOINT.md` for the exact continuation point.
The original planning note follows for historical context.

Later LandOS should support opening a lead/property card from the dashboard,
viewing the Duke PDF/report and exact LandPortal property URL inside that
lead, storing/reporting landos-persist facts, and triggering Duke or other
agents from that lead context.

Target design:

- lead list or pipeline view
- click one lead
- open property card / lead workspace
- see Duke report PDF embedded
- see exact LandPortal property URL
- see parcel verification status, facts, strategy matrix, and agent history
- run Duke, Ace, or future agents from that lead context

The landos-persist block Duke now emits carries forward-looking top-level
fields (lpPropertyUrl, sourceUrls, leadName, sellerName, recordOwnerName,
recordOwnerSource, ownerNameNote, additionalRiskScreens, verificationStatus)
specifically for this workspace; today's runtime ignores them and persists
the mirrored facts/fileRefs instead. Not in scope until Tyler opens the
block: Kanban/property-card workspace, CRM integration, lead-name matching,
title verification, probate verification, new external integrations.

## Future: Duke automatic visual evidence intake (planning note only — not built)

Inspection finding (2026-06-12): no new dependency is needed. Local Chrome
headless is already shelled by `gen-pdf-bg.js` and natively supports
`--screenshot`; the agent runtime already lets a vision-capable agent view a
local image via the Read tool (the Telegram photo path in `src/media.ts`
uses exactly this pattern). Puppeteer 24.x exists only as a transitive
dependency of whatsapp-web.js — do not rely on it.

Target design (no paid APIs, no Google Static/Street View APIs, no cloud
billing, no Zillow scraping, no login/CAPTCHA automation):

- Small repo-local capture script (gen-pdf-bg.js style spawn of local
  Chrome headless `--screenshot`) restricted to an explicit domain
  allowlist of safe public sources: county GIS public parcel viewers and
  public-domain federal imagery (USGS/NAIP, FEMA NFHL). If a page blocks
  automation, report and stop — no workarounds.
- Evidence PNGs saved OUTSIDE the repo (duke-persist fileRef validation
  refuses in-repo paths; `workspace/` is gitignored but still in-repo, so
  use an external evidence folder alongside Duke PDF output).
- Capture runs only AFTER parcel identity is verified through allowed
  sources. Coordinates/pins may frame a screenshot of an already-verified
  parcel but never identify or verify one (hard parcel rule unchanged).
- Duke Reads the PNG and classifies using the existing visual signal
  labels (improvement type, condition, debris, overgrowth, removal
  candidate, occupancy-if-visible), persists as facts + a fileRef
  (kind: visual_evidence). Bounded: one capture by default, skipped if it
  risks the 2/3-minute budget.

## Intentionally not built (per directive)

Live GHL/CRM adapter and sync, outbound SMS/email automation, full model
router and provider connections, future agents (Finn/Drew/Mia/Rex/Lou/Cal),
AI Evolution automation, external web research automation, backup automation,
Tailscale, War Room/voice/avatars, paid APIs, package installs, LandPortal
comp report calls, training-file processing, git commits/pushes.

## Dashboard persistence payload handling

The dashboard strips `landos-persist` fenced blocks from agent responses before displaying them in the chat UI. Tyler sees only the clean plain-English report. Machine persistence payloads are processed silently by `persistDukeRunPostDelivery` (which reads the raw response before stripping) and never appear in visible chat.

Duke reports must end in plain English. The `landos-persist` block is a machine artifact for the LandOS runtime only.

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
