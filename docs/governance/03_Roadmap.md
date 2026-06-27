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

## Post-discovery DD layer — FOUNDATIONS BUILT (2026-06-27)
Free gov DD providers (FEMA/NWI/USGS/Census) scaffolded + dormant; County Records Browser Agent foundation (post-discovery, manual, dormant); seller-stated facts; underwriting prep; Deal Card workflow stage + Post-Discovery panel. Remaining to activate: live gov-API activation (free, approval-gated), County Records Browser execution (visual stack + approval), comp provider.

## Deferred (per Founder Vision phases / later)
Real-time call assistant (teleprompter), full agent roster expansion (marketing, dispositions, competitor/AI/land research, system health), GHL/CRM live sync, voice/War Room expansion, second-machine/always-on infra.
