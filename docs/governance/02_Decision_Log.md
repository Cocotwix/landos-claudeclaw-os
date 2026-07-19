# 02 LandOS Decision Log

Owner: Shared
Update Rule: CC updates after major settled decisions. Concise and current — record the decision and its rationale, not the engineering detail.

This log captures decisions that are **settled** unless Tyler intentionally changes them. Implementation/provider choices are noted as current, not permanent (providers are interchangeable behind capabilities — see [00_Founder_Vision] and [07_Product_Principles]).

## Product / philosophy (foundational — stable)
- LandOS is the operating system; it is a **living deal-intelligence system, not a report generator**. Duke is only one agent (Due Diligence), not the center.
- **Deal Card is the living working record** for a deal; it updates as new information arrives.
- **Discovery Call Report is a pre-call snapshot artifact**, not the product.
- **Dashboard-first** operator workflow; fast operator experience.
- **Local Market Pulse** is part of the operating workflow (and the Discovery Call Report).
- **Visual property context** is required but is a supporting signal — **never parcel verification**.
- Facts must be **labeled**: Verified / Seller-stated / Assumed / Unknown / Needs Verification / Not Checked.
- **Unknown is better than guessed**; never fabricate parcel identity, ownership, valuation, or offers on an unverified parcel.
- Build in **business milestones**, not engineering fragments. Avoid micro-prompts / approval-drip.

## Architecture (settled)
- **Capability-over-vendor:** business logic requests capabilities (parcel identity, ownership, zoning, comps, AI reasoning, storage, …). Providers sit behind capability interfaces and are interchangeable. LandOS owns capabilities, not vendors.
- **Universal Smart Intake is the permanent front door** (`intake-router.ts`). Every transport enters one intake; it classifies + routes to the owning department's *intent*. Future departments **register an intent (data), never redesign the intake**. Only the Property Resolution route is operational today.
- **Property-first resolution, not provider-first** (`property-resolution-engine.ts`). The engine runs every practical lane and returns exactly **Matched** or **Needs Clarification**. Pre-call DD is **practical property intelligence for a seller call, not title/closing/legal verification**: a credible match (approved-provider match OR independent corroboration) runs the full report; unknown fields become **Confirm Before Offer**; offer-stage numbers still lean on approved-provider data, with county/official confirmation reserved for post-contract execution. It never stops because one provider failed and never opens an empty shell. (Supersedes the prior "verified-first, no Deal Card unless parcelVerified" Acquire contract.)
- **One Normalized Property Object** (`normalized-property.ts`) is returned by every lane and consumed by the DD engine and every future department — sourced evidence, confidence, and missing fields. Coordinates remain supporting-only, never identity.
- **Browser retrieval lanes are read-only and parked** (`browser-retrieval.ts`): public search, NETR navigation, county GIS, and STRICT read-only LandPortal/Land ID. Contracts + NETR workflow defined; execution gated on the (uninstalled) visual stack and, for LandPortal/Land ID, an existing authenticated session — credentials are never stored. Forbidden actions (paid report, credits, purchase, billing, any write) are blocked by contract.
- **Parcel identity capability router** (`parcel-capability.ts`) is the single boundary for parcel verification. The live DD path (`duke-preflight`, `property-analysis`, routes) goes through it — **never imports a vendor client directly** (guarded by a regression test).
- **Realie.ai is the intended primary parcel/DD provider** once keyed; **LandPortal is legacy/fallback only** (not the default). County Records Browser Agent is the future official-record fallback provider.
- **Provider selection is config-driven** (`LANDOS_PARCEL_PROVIDER`, default `realie`), with explicit fallback and **provenance on every result** (provider, timestamp, confidence, searched/matched identifier). No silent substitution; if no provider can verify → **Needs Verification / Local Area Context, Not Parcel Verified**.
- **Model router** is provider-agnostic with capability scoring, execution environments, and **safe mode** (Claude-only) by default. Live multi-provider routing is operator-controlled and **persisted in `dashboard_settings`** (survives restart; not `.env`-only). **High-stakes work is pinned to Claude.** Internal model ids map to real runtime tags (e.g. Ollama `gemma-4-12b-q4` → `gemma4:12b`).
- **Knowledge layer** is R2-ready behind a `KnowledgeStore` interface; **local-fs is the default** with no credentials. The R2 backend loads its SDK lazily so build/tests never require it. Selection is config-gated; forced-R2 fails loud, auto falls back to local-fs.
- **Agent training/knowledge ingestion shell** is deterministic (content-addressed, roster-validated). Raw training is stored as `raw_training` and **never auto-promotes** to an agent instruction.
- **Business DB** is local SQLite (`store/landos.db`); the GitHub repo holds **code/docs only** — no business data, secrets, or property-specific work product.

## Coordinate / verification rules (settled)
- **Coordinates never identify or verify the subject parcel.** Subject identity must come from exact authoritative identifiers (APN/parcel ID, owner match, legal description, official county record, or another exact source).
- **Coordinates ARE allowed for supporting workflows**: opening county GIS/imagery/maps, supporting record searches, and comparable discovery.
- **Nearest-parcel logic is banned for subject identity** and allowed **only for comparable discovery** (rural parcels often have only an APN/coordinates). Comp candidates never overwrite subject APN/ownership/acreage/identity. Subject verification and comp discovery are kept fully separate.


## Provider / cost governance (settled)
- Provider adapters preserve verified contracts and provenance. Location/lat-long/nearest endpoints are not used for subject identity.
- Canonical FIPS is the 5-digit `fipsState`+`fipsCounty`; parts are preserved and partial FIPS is never faked.
- Default is autonomy for configured non-paid provider use. Paid APIs, credit-consuming endpoints, money, external accounts, and secrets remain approval gates.


## Execution policy - autonomy mode (settled 2026-07-04)
- LandOS is in autonomy mode. The agent builds without per-step approval.
- Configured non-paid operational providers may be used to complete business milestones. Log usage, avoid duplicate/runaway calls, preserve provenance, protect secrets.
- The only approval gates are new secrets, `.env` or credential changes, API keys/passwords, paid APIs, external accounts, money, destructive deletes, `git push`, and deployments.
- Git hygiene still applies: never commit `.env`, secrets, logs, generated reports, property work product, or local trial counters. Do not `git push` without approval.
- Operator QA and Business QA are required before claiming implementation completion.

## Due Diligence department production-ready (settled — audit baseline fb63e94, 2026-06-28)
- The **DD / Pre-Call Intelligence department is production-ready** for real pre-call use on verified parcels (audit passed: 1391 tests, tsc clean, build clean, no code changes needed).
- **Comp provider stack:** Realie Premium Comparables is the **primary sold-comp** provider and owns the price-per-acre band; **Zillow** (ZIP search, configurable actor id) is the **supplemental** active + sold provider. **Active listings are kept structurally separate from sold comps and never drive sold-comp valuation.**
- **Provider chain:** Realie sold → Zillow supplemental (active + sold) → browser evidence → provider_error → no_comps. Provider readiness is honest per provider.
- **Environmental DD:** FEMA/NWI/USGS run live for verified parcels (coordinates are supporting-only, never identity) and appear in the DD checklist with **per-field provenance** (FEMA NFHL / USFWS NWI / USGS 3DEP).
- **Honest external gaps (non-blocking):** Census stays **not_configured** until a free key is added; Redfin stays **provider_error** (broken upstream actor); **LandWatch/Land.com deferred** (URL-format blocker); browser intelligence is current **RSS/text** evidence with a future vision/site-nav enhancement.

## Post-discovery DD (settled)
- **Two workflows:** pre-discovery stays fast (Lead → Deal Card → quick DD → market pulse → visual → Discovery Call Report). Post-discovery DD is a separate, deeper stage entered only after Tyler decides a lead is worth pursuing.
- **County Records Browser Agent is a post-discovery verification specialist** - NOT part of the automatic pre-discovery workflow. Tasks are bounded (max interactions/time, stop conditions); subject identity requires exact official identifiers (coordinates/nearest/geocoder can never verify). Browser execution is autonomous when read-only and non-paid; external mutation, paid tools, secrets, and account changes remain gated.
- **Free gov DD providers** (FEMA flood, NWI wetlands, USGS slope, Census demographics) are provider-agnostic. Free/read-only activation and smoke tests are autonomous when credentials are already configured or not required; secrets, paid APIs, external accounts, money, destructive deletes, `git push`, and deployments remain gated.
- **Seller-stated facts** recorded post-discovery are always labeled **Seller-stated, never Verified**; they affect missing-facts/risk/next-action/stage but never count as verified data.
- **Underwriting "prep" ≠ final underwriting** — placeholders + gates + readiness state only; no binding offer is computed pre- or post-discovery by the prep layer.
- **No-migration persistence:** post-discovery seller facts + county records are stored on the subject property card via `landos_card_activity` (no schema change; migrations remain gated).
- **Deal Card workflow stage** is derived: pre_discovery_ready → discovery_completed → needs_deeper_dd → county_verification_needed → underwriting_ready → offer_prep_ready.

## Governance (settled — this milestone)
- Governance lives in `docs/governance/` under version control. Authority hierarchy: **Founder Vision > Operating Charter / Product Principles > Decision Log / Roadmap / Architecture / Build Journal**.
- Founder-controlled docs preserve Tyler's product doctrine. When Tyler explicitly asks for a governance reset, update the affected docs directly and keep LandOS's operating doctrine intact.
- Implementation/tech named in the Vision (Python/FastAPI, Realie, R2, Claude, etc.) are **implementation examples at time of writing**, not permanent requirements. The current implementation is Node/TypeScript; capabilities are stable, providers/tech are replaceable.
## 2026-07-04 - Autonomy is the default governance standard

- Default is autonomy for LandOS, future ClaudeClaw-based systems, Codex,
  Claude Code, and future build agents.
- The only approval gates are new secrets, `.env` or credential changes, API keys/passwords, paid APIs,
  external accounts, money, destructive deletes, `git push`, and deployments.
- Everything else is approved for autonomous execution inside the current
  mission.
- Agents should continue until the business outcome is complete, including
  engineering QA, Operator QA, Business QA, and memory updates.
- Approval-drip, micro-prompts, premature stopping, and "tests passed but the
  operator cannot use it" are governance failures.

## 2026-07-04 - Approved provider data is usable for pre-contract work (product correction)

- LandOS is not an attorney, title company, regulator, or legal-review system.
  It had drifted toward legal-style verification and started treating approved
  provider data as missing/unusable, which blocked normal business execution.
  This decision reverses that drift.
- **For pre-contract business work, LandOS uses approved provider data.** Approved
  providers: LandPortal, Realie, County GIS, FEMA, NWI, USGS, Census, Redfin,
  Zillow, and any future provider Tyler approves.
- Provider-returned deal data (road frontage, wetlands, FEMA/flood, slope,
  acreage, zoning, comps, market data, utilities, etc.) is **used** in reports,
  scoring (incl. Land Score), recommendations, Deal Cards, Discovery Call
  Reports, strategy, market research, and underwriting. Do not treat it as
  missing just because it did not come from a county website.
- **Unknown** = no approved provider gave us the info — NOT "it came from
  LandPortal instead of the county."
- **Post-contract / legal-financial execution** (title, deeds, liens, ownership
  disputes, closing, money movement, recording, permitting) is where the
  standard tightens and official confirmation is required.
- Banned language: *source of truth, canonical source, legal-grade verification,
  authoritative source, ultimate verification.* Use plain business language.
- Guardrails unchanged: never fabricate, never hallucinate, never hide the
  source; if approved providers materially disagree, show the conflict.
- See 07_Product_Principles.md "Approved provider data — use it (pre-contract)".
- Supersedes the ".landos/DECISIONS.md" line that ranked assessor/official
  records above approved-provider lookups for pre-contract work.

