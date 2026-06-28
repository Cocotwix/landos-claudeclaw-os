# 04 LandOS Architecture

Owner: CC
Update Rule: CC updates when the implementation architecture changes. Describe the **current** system accurately.

> Implementation note: the Founder Vision describes a Python/FastAPI reference stack. The **current implementation is Node.js + TypeScript** (Hono dashboard API, better-sqlite3, vitest, `@anthropic-ai/claude-agent-sdk`, React/Preact + Vite web). Per governance, the Vision's stack names are implementation examples, not requirements — capabilities are stable, tech/providers are replaceable.

## Pillars
- **Dashboard-first local operating system.** Hono API mounted under token auth; React/Preact SPA (`/landos`) with tabs: Command, Org/Agents, Model Router, Acquire, Deal Card, Intake Planner, Cost Control, Knowledge.
- **Deal Card-centered workflow.** Living record persisted in local SQLite (`store/landos.db`, gitignored) with labeled facts + provenance.
- **Capability-based provider routing.** Business logic requests capabilities; providers are interchangeable adapters behind them.

## Parcel identity capability (the DD spine)
- `parcel-capability.ts` — `resolveParcelIdentity(args, timeoutMs, deps)` selects the configured provider (`LANDOS_PARCEL_PROVIDER`, default `realie`), falls back only to other configured providers, and returns the canonical result + **provenance** (provider, fellBack, attempted, reason, timestamp). No silent substitution; no provider → Needs Verification.
- Providers behind it: **Realie** (`providers/data-registry.ts`, verified official contract, raw-key auth, address/parcelId endpoints, canonical normalization incl. 5-digit FIPS), **LandPortal** (legacy fallback, wraps the existing resolver), **County Records Browser** (placeholder, future official-record provider).
- Live DD entry points (`duke-preflight.ts`, `property-analysis.ts`, dashboard routes) call the capability — **never a vendor client directly** (enforced by `parcel-capability-wiring.test.ts`).
- **Coordinates** are never forwarded for subject identity; allowed only for supporting/comp workflows.

## Model router
- Provider-agnostic registry (`provider-registry.ts`) over execution environments; capability scoring + routing (`capability-router.ts`); execution clients (`model-execution.ts`: Claude via injected SDK runner, OpenAI/OpenRouter/LM Studio/vLLM OpenAI-compatible, Gemini, Ollama).
- `model-router-service.ts` — safe-mode-aware execution: override → route by capability → execute → deterministic Claude fallback → telemetry. **Safe mode (Claude-only) is the default.**
- `router-runtime-config.ts` — effective live-routing + Ollama host + internal-id→Ollama-tag map resolved as **persisted dashboard_settings → env → default** (single source of truth; survives restart). High-stakes pinned to Claude.

## Knowledge layer
- `knowledge-store.ts` (interface + `LocalFsKnowledgeStore`, default, no creds) and `knowledge-store-r2.ts` (R2/S3 backend, lazy SDK, config-gated selection, presence-only status). Path conventions under `R2_PATHS`.
- `knowledge-ingestion.ts` — deterministic training/knowledge ingestion shell (sha256-addressed, roster-validated, manifest-tracked, `raw_training`, promotion blocked).

## Post-discovery DD layer
- `providers/gov-dd-providers.ts` — free government DD providers (FEMA flood, NWI wetlands, USGS slope, Census demographics) behind a capability; dormant by default (`LANDOS_LIVE_GOV_DD`), canonical result + provenance + Unknown fallback; no live call until activated.
- `county-records-tasks.ts` + `browser-agents.ts` — County Records Browser Agent foundation: post-discovery, manual-trigger, bounded task contracts, exact-identity rules, conflict detection, manual outcome records (`landos_card_activity`). Execution dormant.
- `seller-stated-facts.ts` — seller answers recorded as Seller-stated (never Verified), persisted on the subject property card (`landos_card_activity`).
- `underwriting-prep.ts` — post-discovery underwriting prep (placeholders + gates + readiness; no offer).
- `deal-card-readiness.ts` — derives the Deal Card workflow stage + next-best-action + provenance; surfaced on the Deal Card UI (Command Center + Post-Discovery panel) and list chips.
- Post-discovery persistence uses `landos_card_activity` only — **no schema migration**.

## Browser-capable agents (planned capability — must not be blocked)
Two browser agents are recognized product requirements; the architecture leaves room for both:
- **County Records Browser Agent** — manual post-discovery official-record verification (`county-records-tasks.ts` + `browser-agents.ts`; dormant, bounded, exact-identity-only).
- **General Browser Research Assistant** — broad public-web research (listing pages, public context, address/listing clues, screenshots/evidence). Complements structured providers (Apify), not a replacement. Not built; provider-registry + capability layer can host it when added.

## Market Intelligence layer (DD production-ready, 2026-06-28)
- `realie-comps.ts` — **primary sold comps** via Realie Premium Comparables (`/public/premium/comparables/`, by coordinates); acreage/recency/non-nominal filtering; sold vs valuation split; owns the p25–p75 $/ac band.
- `zillow-comps.ts` — **supplemental** active + sold via the configurable Zillow ZIP-search actor (`LANDOS_ZILLOW_ACTOR`); active and sold kept separate; active never enters the sold-comp band.
- `browser-market-intelligence.ts` — Google News RSS evidence backend (sourced; selectable open-weight model architecture for a future vision/site-nav backend).
- `census-demographics.ts` — county ACS demographics (honest `not_configured` until a free key is set).
- Comp failover chain (in `deal-card-report.ts` market lane): Realie sold → Zillow supplemental → browser evidence → provider_error → no_comps; all rows provider-attributed; persisted in `marketComps` (sold/active/supplementalSold/valuation/metrics/providers/providerChain).
- DD checklist (`dd-checklist.ts`) carries **per-field provenance**; FEMA/NWI/USGS merge with their own source labels.

## Cost / safety governance (working-product mode, 2026-06-27)
- **Configured operational providers are approved for normal use** to complete business milestones (Apify Redfin, Google Maps/Street View/Static Maps, free gov APIs). Usage is logged; provenance preserved; no duplicate/runaway calls; secrets never leaked.
- `realie-trial-guard.ts` — local, gitignored trial counter that **logs** Realie usage and enforces a per-sprint allowance; reuse persisted verification first.
- Hard stops only: machine safety, secret exposure, deletion/destruction, irreversible data loss.
- Approval/audit spine, rubric, offer engine, departments/agent roster (`db.ts`, `rubric.ts`, `offer-engine.ts`, `departments.ts`, `agent-roster.ts`). Cost + model-call logging tables.

## Storage separation
- **GitHub repo:** code + docs only (no business data, secrets, or property work product).
- **Local machine:** running system, `store/landos.db`, `.env` secrets (gitignored), local model inference (Ollama).
- **Cloudflare R2 (when keyed):** business knowledge/artifacts behind the `KnowledgeStore` interface.

## Tech reality (current)
Node 22 + TypeScript; Hono (dashboard API); better-sqlite3; React/Preact + Vite (web); vitest (1200+ tests); `@anthropic-ai/claude-agent-sdk` (Claude auth via local session); Ollama (local Gemma). Playwright is install-gated (imagery); no heavy browser-automation deps installed.
