# 03 LandOS Roadmap

Owner: Shared
Update Rule: CC updates after major milestones. Frame in **business capabilities**, not engineering tasks.

The shell is stable: **Lead → Deal Card → Due Diligence → Discovery Call Report → Underwriting → Offer Prep.** Providers behind it may change at any time.

## Current business milestone
**Operationalize Lead → Deal Card → Due Diligence → Discovery Call Report on real leads**, with Realie as the configured primary parcel/DD provider behind the capability layer.

Status: capability plumbing in place (parcel-identity capability routes to Realie; adapter matches the verified contract; Realie live call #1 succeeded). Remaining to "operational on real leads" is gated by **per-call Realie approval** (manual) and real-lead validation.

## Capability status
| Business capability | State |
|---|---|
| Parcel identity / ownership / characteristics | Live via Realie (primary, configured); LandPortal legacy fallback; County Records Browser planned |
| Local Market Pulse | Working (county/area context; source-backed, never invented) |
| Comparable discovery | Scaffold (Apify providers honest-stubbed until keyed/approved); nearest-parcel allowed for comps only |
| Discovery Call Report (pre-call snapshot) | Generates from verified parcel + labeled facts (local PDF, no key) |
| AI reasoning / routing | Live model router; safe-mode default; high-stakes pinned to Claude; local Gemma for grunt work |
| Knowledge / storage | Local-fs default; R2-ready when keyed |
| Underwriting (post-discovery) | Operational scaffold (deterministic gate; no model approves offers) |
| Zoning / flood / wetlands / slope / utilities / demographics | Not yet wired → return Unknown/Needs Verification by design |
| County Records Browser Agent | Placeholder provider (official-record fallback) |
| General Visual Browser Assistant | Placeholder (separate, general web tasks) |

## Next business milestones (capability-framed)
1. **Validate the real lead workflow** end-to-end on a live lead (Realie verify → Deal Card → DD → Discovery Call Report), one approved Realie call at a time.
2. **Complete the Deal Card working experience** — the operator-facing living record (facts, labels, provenance, market pulse, strategy, history) in the dashboard.
3. **Complete the Due Diligence capability shell** — fill remaining DD fields (zoning/flood/wetlands/slope/utilities) via capabilities, each provider-agnostic, Unknown when unavailable.
4. **Improve the Discovery Call Report** — tighten the pre-call snapshot (parcel data, score, market pulse, comps, strategy/offer ranges) for real calls.
5. **Provider readiness visibility** — operator can see, per capability, configured/available/healthy providers and fallbacks.
6. **Comparable discovery capability** — radius/nearest comp candidates (comps-only), kept separate from subject verification; wire an approved comp provider.
7. **County Records Browser Agent foundation** — official-record provider behind parcel/ownership/zoning/county capabilities, following all verification rules.
8. **Underwriting + Offer Prep** — post-discovery deep underwriting feeding offer-range guidance (only on verified parcels).

## Due Diligence department — PRODUCTION-READY ✅ (audit baseline fb63e94, 2026-06-28)
The DD / Pre-Call Intelligence department is production-ready for real pre-call use on verified parcels. Stack: **Realie Premium Comparables = primary sold comps** (owns the $/ac band); **Zillow ZIP search = supplemental active + sold** (separated — active never drives sold valuation); **FEMA/NWI/USGS = live environmental DD** with per-field provenance in the checklist; **browser market intelligence = Google News RSS evidence** (sourced); honest provider readiness throughout; everything persists + reloads. Audit passed 1391 tests / tsc clean / build clean; no code changes needed. Honest external gaps (non-blocking): **Census not_configured** (needs free key), **Redfin provider_error** (broken upstream actor; Zillow covers the lane), **LandWatch/Land.com deferred** (URL-format blocker), browser is RSS/text (vision/site-nav is a future enhancement). **Next leg: Underwriting + Offer Prep** (see Next business milestones #8).

## Post-discovery DD layer — FOUNDATIONS BUILT (2026-06-27)
Free gov DD providers (FEMA/NWI/USGS/Census) scaffolded + dormant; County Records Browser Agent foundation (post-discovery, manual, dormant); seller-stated facts; underwriting prep; Deal Card workflow stage + Post-Discovery panel. Remaining to activate: live gov-API activation (free, approval-gated), County Records Browser execution (visual stack + approval), comp provider.

## Browser-capable agents (product requirement — recognized 2026-06-27)
LandOS needs **two** browser-capable agents (architecture must not block them):
1. **County Records Browser Agent** — manual post-discovery official-record verification (assessor/GIS/tax/legal). Foundation built + dormant; bounded, exact-identity-only.
2. **General Browser Research Assistant** — broad public-web research: find listing pages, verify public context, pull address/listing clues, collect screenshots/evidence, support non-county tasks; eventually fast public property lookup. Complements (does not replace) structured providers like Apify. Not built yet — documented so the architecture leaves room.

## Working-product mode (2026-06-27)
Governance relaxed to working-product mode: configured operational providers (Apify Redfin, Google Maps/Street View/Static Maps, free gov APIs, Realie within budget) are approved for normal use; build proceeds without per-step approval. Only hard stops: machine safety, secret exposure, deletion/destruction, irreversible loss.

## Deferred (per Founder Vision phases / later)
Real-time call assistant (teleprompter), full agent roster expansion (marketing, dispositions, competitor/AI/land research, system health), GHL/CRM live sync, voice/War Room expansion, second-machine/always-on infra.

## Due Diligence Department — SYNTHESIS + IMAGERY FOUNDATION IMPLEMENTED (in progress, 2026-06-29)
Implemented and live: parcel verification, Realie facts + sold comps, Zillow active, FEMA/NWI/USGS, Executive Summary synthesis (market pulse, 40–60% preliminary acquisition range, 8-lane strategy ranking, deal economics), Browser-Intelligence growth summary, and the Google imagery foundation (.env key fix + geocode-the-verified-address fallback). See 08_DD_Capability_Matrix.md.

**NOT yet complete (DD is not frozen):**
- Final Deal Card UX / layout (visual-to-top, header/seller/APN/acreage redesign, font/readability, declutter).
- Model-router investigation (Gemma / ChatGPT "Not Wired").
- Smart browser comp verification + enrichment; Zillow vacant-land comp retrieval; vision-based improvement status.
- Valuation cleanup — 2123 Panola still inflated because Realie comp rows omit building data (needs wider comp radius / comp building data; outlier guard alone insufficient).
- Parcel boundary geometry; the deferred Interactive Intelligence Map.

The department will be marked COMPLETE / FROZEN only after the above are resolved.
