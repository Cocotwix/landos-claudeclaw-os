# 06 LandOS Build Journal

Owner: CC
Update Rule: Update after every major LandOS sprint. Append a new dated entry; keep entries concise.

Entry format:
```
## YYYY-MM-DD — Sprint Name
Business milestone:
Summary:
Files changed:
Commits:
Tests:
Decisions made:
Risks:
Blockers:
Lessons learned:
Next business milestone:
```

## 2026-06-27 — Post-Discovery Due Diligence Expansion

Business milestone: extend LandOS from a pre-call briefing system into the post-discovery DD operating layer (after Tyler completes a discovery call and decides a lead is worth deeper review).

Summary:
- Free **government DD provider foundations** (`providers/gov-dd-providers.ts`): FEMA flood, USFWS/NWI wetlands, USGS slope, US Census demographics — provider-agnostic, **dormant by default** (`LANDOS_LIVE_GOV_DD`), canonical result + provenance + Unknown fallback. No live gov call made; injected-fetch tests only.
- **County Records Browser Agent foundation** (`county-records-tasks.ts` + `browser-agents.ts`): post-discovery, **manual-trigger only**, never auto-runs. Bounded task contracts (max interactions/time, stop conditions), evidence model, conflict detection, exact-identity rules (coordinates/nearest/geocoder can never verify), manual outcome records. Agent execution stays dormant.
- **Seller-stated facts** (`seller-stated-facts.ts`): post-discovery seller answers recorded as **Seller-stated (never Verified)**; feed missing facts, risk flags, next-best-action, workflow stage. Persisted on the subject property card (`landos_card_activity`) — **no schema migration**.
- **Underwriting prep foundation** (`underwriting-prep.ts`): cost placeholders, verify-before-offer gates, tighter comp requirement, deal killers, min-profit rules, offer-readiness state. Pure; never computes a binding offer.
- **Deal Card workflow stage** (`deal-card-readiness.ts`): pre_discovery_ready → discovery_completed → needs_deeper_dd → county_verification_needed → underwriting_ready → offer_prep_ready. UI: stage badge + Post-Discovery panel (seller facts, county verification, underwriting prep) + DD provider readiness.

Files changed: new `providers/gov-dd-providers.ts`, `county-records-tasks.ts`, `seller-stated-facts.ts`, `underwriting-prep.ts` (+ tests); edits to `deal-card-readiness.ts`, `routes.ts`, `web/src/components/DealCard.tsx`; governance docs.

Tests: full suite ~1337 green; tsc clean; web build OK. No Realie/Google/paid/live-gov calls (counters unchanged: Realie 1, Google 2).

Decisions made: gov DD providers are free but dormant until approved activation; County Records Browser is a post-discovery manual specialist, never auto-run; seller facts are Seller-stated only; underwriting "prep" ≠ final underwriting; post-discovery persistence uses card_activity (no migration).

Risks: gov-provider live parsers are unverified against real responses (fixture-shaped); county browser execution not built (dormant); seller/county facts require a linked subject property card.

Blockers: live gov-API activation + first smoke need approval; County Records Browser execution needs the visual stack (UI-TARS/Qwen) + approval.

Lessons learned: `??` does not fall through on empty strings — empty DD-worksheet values were shadowing property-card values in identifier resolution (fixed with `||`).

Next business milestone: activate the first free gov DD provider (FEMA flood) live behind the capability — guarded, with an explained smoke — to begin replacing Unknowns with verified government data.

---

## 2026-06-26 — Baseline (project to date)

**Business milestone:** Establish the LandOS operating system shell and the provider-agnostic foundation for Lead → Deal Card → Due Diligence → Discovery Call Report, and synchronize governance.

**Summary (cumulative milestones, oldest → newest):**
- **Shell & foundation** — LandOS shell, safe upstream ClaudeClaw adoption, SDK 0.3 migration, memory isolation + shared tier, provider engine bridge + SDK env hardening (`46cb932`, `1c92f41`, `c87e82f`, `b53fb3a`).
- **OS Spine v1** — `store/landos.db`, approval/audit spine, rules/playbook lifecycle, department registry, 100-pt rubric, offer engine, model-call/cost schema, dashboard API + LandOS page.
- **Property Analysis & intake** — one-button Property Analysis (DD + Market Pulse + Strategy + Markdown/PDF), flexible intake, concurrent research lanes, LandPortal v2 wiring (`f0066a0`, `aece249`, `d8cd05c`, `2e67734`, `3eb8dd5`).
- **Model router** — capability profiles/scoring, routing, override, telemetry, execution dispatch; execution environments + provenance; live execution service + safe mode; grunt helpers; Deal Card lane; operational Underwriting (`f633df2`, `643ca05`, `a08a9d3`, `3e7ae2c`, `d98fd97`).
- **CP3–CP6** — R2-ready KnowledgeStore + Realie adapter scaffold + knowledge dashboard tab/routes + ingestion shell; status doc (`79dad13`, `83c899a`).
- **Live model router fix** — persist live routing + Ollama runtime config in `dashboard_settings`; internal-id→Ollama-tag mapping; regression tests; verified live ON / Ollama healthy end-to-end (`0a6527b`, `7e2cf25`).
- **Provider/capability abstraction for DD** — live DD routed through the parcel-identity capability (not direct LandPortal); Realie intended primary; County Records Browser + General Visual Browser placeholders (`dd5d954`).
- **Realie contract + trial guard** — adapter rewritten to the verified official contract; manual gitignored trial guard; **Realie live call #1 succeeded** (verified an exact GA parcel); **5-digit FIPS normalization** applied (`949b6c5` + follow-up).
- **Governance sync (this entry)** — governance docs added under `docs/governance/`; founder docs preserved verbatim; implementation docs populated.

**Files changed (this governance sprint):** `docs/governance/` (00 Founder Vision, 01 Vision, 05 Operating Charter, 07 Product Principles — verbatim; 02 Decision Log, 03 Roadmap, 04 Architecture, 06 Build Journal — authored; README).

**Commits (recent, newest first):** `949b6c5` Realie adapter contract + trial guard · `dd5d954` Route DD through parcel capability · `7e2cf25` live-routing endpoint tests · `0a6527b` persist live routing/Ollama config · `83c899a` CP3–CP6 status · `79dad13` R2 KnowledgeStore + Realie + knowledge tab · `d98fd97` grunt helpers/Deal Card lane/Underwriting.

**Tests:** full LandOS suite green at baseline (~1265 tests across ~96 files); `tsc --noEmit` clean; production build succeeds. Realie/parcel-capability/trial-guard covered by fixture-based tests (no live API calls in tests).

**Decisions made:** see `02_Decision_Log.md` (capability-over-vendor; Realie primary/LandPortal legacy; coordinates never verify identity; manual per-call Realie approval; safe-mode default; repo holds code/docs only).

**Risks:** Realie trial budget is small (manual per-call approval mandatory); zoning/flood/wetlands/slope/utilities capabilities not yet wired (return Unknown by design); canonical parcel model still bridges through `LpResolveResult` transitionally.

**Blockers:** real-lead workflow completion is gated by **per-call Realie approval** (by design); R2 live + `@aws-sdk/client-s3` install pending Tyler approval.

**Lessons learned:** scaffolded adapters must be validated against the real provider contract before trusting them (the Realie scaffold mismatched on base/path/auth/fields); env config must be reachable at runtime (live-routing persisted via dashboard_settings, not `.env`-only); restart only takes effect on a rebuilt `dist`.

**Next business milestone:** validate the real lead workflow (Lead → Realie verify → Deal Card → DD → Discovery Call Report) one approved Realie call at a time; then complete the Deal Card working experience and DD capability shell.
