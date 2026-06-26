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

## Safety / git hygiene (settled)
- Never print `.env` or secrets; never run paid/credit-consuming calls without explicit approval.
- Stage only intended files (never `git add .`); never commit `.env`, logs, generated reports, property work product, or the trial counter.
- Restarting the live server and pushing require explicit approval.

## Governance (settled — this milestone)
- Governance lives in `docs/governance/` under version control. Authority hierarchy: **Founder Vision > Operating Charter / Product Principles > Decision Log / Roadmap / Architecture / Build Journal**.
- Founder-controlled docs (Founder Vision, Operating Charter, Product Principles, Vision pointer) are **not modified without Tyler's approval**. Implementation-maintained docs (this log, Roadmap, Architecture, Build Journal) are kept current after major milestones.
- Implementation/tech named in the Vision (Python/FastAPI, Realie, R2, Claude, etc.) are **implementation examples at time of writing**, not permanent requirements. The current implementation is Node/TypeScript; capabilities are stable, providers/tech are replaceable.
