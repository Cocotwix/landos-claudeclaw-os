# 08 Due Diligence Capability Coverage Matrix

Owner: Tyler · Status: **Due Diligence Department COMPLETE (operational for pre-call use) — 2026-06-29**

Legend: R=Retrieved, M=Mapped, P=Persisted, S=Synthesized, D=Displayed, T=Regression-tested, A=Live-accepted. ✅ done · ⚠️ provider-limited (honest) · — n/a.

| Capability | Provider | R | M | P | S | D | T | A | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Parcel identity (verified) | Realie | ✅|✅|✅|✅|✅|✅|✅ | Address / APN+county+state → parcel record. Unlocks pipeline. |
| Owner | Realie | ✅|✅|✅|✅|✅|✅|✅ | |
| APN | Realie | ✅|✅|✅|✅|✅|✅|✅ | |
| Address / county / state | Realie | ✅|✅|✅|✅|✅|✅|✅ | Drives market target. |
| Acreage | Realie | ✅|✅|✅|✅|✅|✅|✅ | Feeds value/range. |
| Land use | Realie | ✅|✅|✅|✅|✅|✅|✅ | Raw use code shown when that's all the provider returns. |
| Zoning | Realie | ✅|✅|✅|✅|✅|✅|⚠️ | Present when Realie returns it; else labeled DD gap. |
| Building area / improvement | Realie | ✅|✅|✅|✅|✅|✅|⚠️ | Drives improved-resale strategy. |
| Assessed value / taxes | Realie | ✅|✅|✅|✅|✅|✅|⚠️ | When returned. |
| Sale history | Realie | ✅|✅|✅|✅|✅|✅|⚠️ | |
| Road frontage / legal access | Realie/DD | ⚠️|✅|✅|✅|✅|✅|⚠️ | Often unknown pre-call → labeled DD gap + seller question. |
| Utilities | — | ⚠️|—|—|✅|✅|✅|⚠️ | No pre-call provider → DD gap + seller question (honest). |
| FEMA flood | FEMA NFHL | ✅|✅|✅|✅|✅|✅|✅ | |
| NWI wetlands | USFWS NWI | ✅|✅|✅|✅|✅|✅|✅ | Occasional WIM transient error → honest not_run. |
| USGS slope | USGS 3DEP | ✅|✅|✅|✅|✅|✅|✅ | |
| Buildability / buildable acres | derived | ⚠️|✅|✅|✅|✅|✅|⚠️ | From slope/wetlands when present; else DD gap. |
| Realie sold comps | Realie Premium | ✅|✅|✅|✅|✅|✅|✅ | Primary; p25/median/p75 PPA band. |
| Zillow active listings | Apify maxcopell/zillow-scraper | ✅|✅|✅|✅|✅|✅|✅ | Coordinate mapBounds search. |
| Zillow supplemental sold | Apify zillow-scraper | ✅|✅|✅|✅|✅|✅|⚠️ | Thin when active fills the item budget; Realie is primary for sold. |
| Google satellite | Google Static Maps | ✅|✅|✅|✅|✅|✅|✅ | Geocodes verified address for coords when Realie returns none (imagery-only). |
| Google Street View | Google Street View | ✅|✅|✅|✅|✅|✅|⚠️ | Best-effort; absent on roads Google never drove (provider limitation). |
| Google Maps / Earth links | keyless | ✅|✅|✅|✅|✅|✅|✅ | Always available for verified parcels. |
| Browser market evidence | Google News RSS | ✅|✅|✅|✅|✅|✅|✅ | Public evidence with provenance. |
| Local growth summary | Browser intel synth | ✅|✅|—|✅|✅|✅|✅ | Classified drivers + "what this means for Tyler." |
| Market Pulse | Realie+Zillow+Browser | ✅|✅|✅|✅|✅|✅|✅ | Band + supply/demand/liquidity + growth narrative + interpretation. |
| Preliminary acquisition range | synth | —|—|—|✅|✅|✅|✅ | 40/50/60% of est. market value; pre-call only. |
| Deal Economics | synth | —|—|—|✅|✅|✅|✅ | Value low/mid/high + gross spread + missing costs. |
| Strategy ranking | synth | —|—|—|✅|✅|✅|✅ | 8 lanes, property-specific, ranked. |
| Risks / unknowns | synth | ✅|✅|✅|✅|✅|✅|✅ | Incl. verified FEMA/NWI/slope. |
| Seller call prep | synth | —|—|—|✅|✅|✅|✅ | Objective + questions + verify-before-offer + next actions. |
| Executive Summary | synth | —|—|—|✅|✅|✅|✅ | First section; operator verdict. |
| Source table | report | ✅|✅|✅|✅|✅|✅|✅ | Per-source status + confidence. |

## Honest provider limitations (NOT implementation gaps)
- **Utilities**: no free pre-call provider → seller question / DD gap.
- **Street View**: absent where Google has no coverage (rural roads) → honest "no coverage" message.
- **Census ACS demographics**: `not_configured` until a free key is added.
- **Realie coordinates**: not always returned → we geocode the verified address for imagery only (never identity).
- **Zillow supplemental sold**: can be thin (shared item budget) — Realie is the primary sold-comp source.

## Deferred by design (out of DD scope)
- Interactive Intelligence Map (MapLibre + Mapbox) — the Visual Context section is structured to swap to it later without Deal Card architecture changes.
- County Records Browser Agent (post-discovery official-record verification).
- Deeper per-strategy confidence modeling; Census demographics.

## Freeze
The Due Diligence Department is operationally complete for pre-call use. Future DD work is limited to: genuine bugs, provider changes, small UX refinements, and the deferred Interactive Intelligence Map.
