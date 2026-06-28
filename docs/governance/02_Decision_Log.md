# 02 LandOS Decision Log

Owner: Shared
Update Rule: CC updates after major settled decisions. Concise and current — record the decision and its rationale, not the engineering detail.

This log captures decisions that are **settled** unless Tyler intentionally changes them. Implementation/provider choices are noted as current, not permanent (providers are interchangeable behind capabilities — see [00_Founder_Vision] and [07_Product_Principles]).

## Product / philosophy (foundational — stable)
- LandOS is the operating system; it is a **living deal-intelligence system, not a report generator**. Duke is only one agent (Due Diligence), not the center.
- **Deal Card is the living source of truth**; it updates as new information arrives.
- **Discovery Call Report is a pre-call snapshot artifact**, not the product.
- **Dashboard-first** operator workflow; fast operator experience.
- **Local Market Pulse** is part of the operating workflow (and the Discovery Call Report).
- **Visual property context** is required but is a supporting signal — **never parcel verification**.
- Facts must be **labeled**: Verified / Seller-stated / Assumed / Unknown / Needs Verification / Not Checked.
- **Unknown is better than guessed**; never fabricate parcel identity, ownership, valuation, or offers on an unverified parcel.
- Build in **business milestones**, not engineering fragments. Avoid micro-prompts / approval-drip.

## Architecture (settled)
- **Capability-over-vendor:** business logic requests capabilities (parcel identity, ownership, zoning, comps, AI reasoning, storage, …). Providers sit behind capability interfaces and are interchangeable. LandOS owns capabilities, not vendors.
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

## Realie / cost governance (settled)
- Realie adapter matches the **verified official contract**: base `https://app.realie.ai/api`; `GET /public/property/address/` (state+address) and `GET /public/property/parcelId/` (state+county+parcelId); auth header `Authorization: <raw key>` (not Bearer — confirmed by live call #1); response normalized from `property.*`. Location/lat-long/nearest endpoints are not used for subject identity.
- **Canonical FIPS is the 5-digit `fipsState`+`fipsCounty`**; parts preserved; partial FIPS never faked.
- **Every live Realie call is manually approved by Tyler immediately beforehand.** A local, gitignored trial guard (`store/realie-trial-counter.json`) enforces an approved budget (15), shows a pre-call confirmation, and records each call (timestamp/endpoint/identifier-type/success/remaining) — never the key or response bodies. Tests/dashboard/workflows never auto-consume Realie calls.

## Execution policy — working-product mode (settled 2026-06-27)
- LandOS is in **working-product mode**. Configured operational providers may be used to complete approved business milestones; do not block on normal configured API usage. The agent builds without per-step approval.
- **Configured operational providers approved for normal use:** Apify Redfin (live comps/market), Google Maps / Street View / Static Maps (visual context), free government APIs (FEMA / USFWS-NWI / USGS / Census), and any other configured operational provider required to complete a department. Log usage, avoid duplicate/runaway calls, preserve provenance, protect secrets.
- **Realie** is the one budgeted provider: a local trial counter logs usage; reuse persisted verification; never waste or loop calls; stop only if a sprint's stated allowance would be exceeded.
- **The only hard stops** (require Tyler's explicit approval): (1) commands that could harm the local machine or pose a security risk, (2) exposing `.env`/keys/secrets, (3) deleting/overwriting/destroying files or data, (4) any irreversible data loss.
- **Git hygiene still applies:** stage only intended files (never `git add .`); commit/push scoped changes to complete approved milestones; never commit `.env`, secrets, logs, generated reports, property work product, or the trial counter.
- This replaces the prior per-call paid-approval regime; the old "approve every comp/paid call" rules are retired.

## Due Diligence department production-ready (settled — audit baseline fb63e94, 2026-06-28)
- The **DD / Pre-Call Intelligence department is production-ready** for real pre-call use on verified parcels (audit passed: 1391 tests, tsc clean, build clean, no code changes needed).
- **Comp provider stack:** Realie Premium Comparables is the **primary sold-comp** provider and owns the price-per-acre band; **Zillow** (ZIP search, configurable actor id) is the **supplemental** active + sold provider. **Active listings are kept structurally separate from sold comps and never drive sold-comp valuation.**
- **Provider chain:** Realie sold → Zillow supplemental (active + sold) → browser evidence → provider_error → no_comps. Provider readiness is honest per provider.
- **Environmental DD:** FEMA/NWI/USGS run live for verified parcels (coordinates are supporting-only, never identity) and appear in the DD checklist with **per-field provenance** (FEMA NFHL / USFWS NWI / USGS 3DEP).
- **Honest external gaps (non-blocking):** Census stays **not_configured** until a free key is added; Redfin stays **provider_error** (broken upstream actor); **LandWatch/Land.com deferred** (URL-format blocker); browser intelligence is current **RSS/text** evidence with a future vision/site-nav enhancement.

## Post-discovery DD (settled)
- **Two workflows:** pre-discovery stays fast (Lead → Deal Card → quick DD → market pulse → visual → Discovery Call Report). Post-discovery DD is a separate, deeper stage entered only after Tyler decides a lead is worth pursuing.
- **County Records Browser Agent is a post-discovery verification specialist** — NOT part of the automatic pre-discovery workflow. It runs only when manually triggered from a Deal Card; it stays dormant (no execution) until the visual stack is wired + approved. Tasks are bounded (max interactions/time, stop conditions); subject identity requires exact official identifiers (coordinates/nearest/geocoder can never verify).
- **Free gov DD providers** (FEMA flood, NWI wetlands, USGS slope, Census demographics) are provider-agnostic and **dormant by default** (`LANDOS_LIVE_GOV_DD`); they return Unknown / Needs Verification until activation is approved. They are free, but live activation + first smoke still require approval.
- **Seller-stated facts** recorded post-discovery are always labeled **Seller-stated, never Verified**; they affect missing-facts/risk/next-action/stage but never count as verified data.
- **Underwriting "prep" ≠ final underwriting** — placeholders + gates + readiness state only; no binding offer is computed pre- or post-discovery by the prep layer.
- **No-migration persistence:** post-discovery seller facts + county records are stored on the subject property card via `landos_card_activity` (no schema change; migrations remain gated).
- **Deal Card workflow stage** is derived: pre_discovery_ready → discovery_completed → needs_deeper_dd → county_verification_needed → underwriting_ready → offer_prep_ready.

## Governance (settled — this milestone)
- Governance lives in `docs/governance/` under version control. Authority hierarchy: **Founder Vision > Operating Charter / Product Principles > Decision Log / Roadmap / Architecture / Build Journal**.
- Founder-controlled docs (Founder Vision, Operating Charter, Product Principles, Vision pointer) are **not modified without Tyler's approval**. Implementation-maintained docs (this log, Roadmap, Architecture, Build Journal) are kept current after major milestones.
- Implementation/tech named in the Vision (Python/FastAPI, Realie, R2, Claude, etc.) are **implementation examples at time of writing**, not permanent requirements. The current implementation is Node/TypeScript; capabilities are stable, providers/tech are replaceable.
