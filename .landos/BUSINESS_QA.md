# LandOS Business QA Ledger

Purpose: evaluate every department as an employee and preserve business-value
findings across Claude Code and Codex sessions.

Business QA happens after engineering QA and Operator QA.

Core question:

> Does this employee create measurable business value?

If no, continue working unless an approval gate blocks progress. Record the
business blocker and next exact fix here.

Do not store secrets, raw seller records, real APNs, private addresses, or
property-specific work product in this file.

## Current Business QA Status

| Date | Department / Employee | Result | Business Value Finding | Next Exact Fix |
|---|---|---|---|---|
| 2026-07-04 | Acquisition Specialist | In progress | Reusable inspection/intelligence capabilities exist, but the dashboard-visible Property Card must become a usable seller-call workspace before the employee is production-useful | Finish Property Board workspace, then rerun Operator QA and Business QA |
| 2026-07-04 | Due Diligence (Property Report) | In progress — improved | Land Score is now a working, decision-relevant part of the ONE report (was silently broken / null for every verified property, and absent from the report body). Now live end-to-end on the restarted compiled server: POST `/report/run` and GET both return the inline score, so it is durable across operator re-runs. For the current browser-verified acceptance properties it renders "Data-limited" with an actionable enrichment checklist rather than a misleading pass/fail. It reaches full investor-grade value only once land facts are enriched (Realie verification, or gov-DD wired into the rubric). Valuation/offer-range remain empty for these properties because paid comps are gated and no comp band exists — honest, not a bug. | (1) Wire live gov-DD (FEMA/NWI/USGS) into the Land Score rubric so environmental factors score instead of gapping; (2) evaluate offer-guidance/valuation once a comp source is available. |
| 2026-07-04 | Due Diligence (Property Report) — provider-data correction | Improved — meaningfully | Under the corrected philosophy (LandOS uses approved provider data for pre-contract work), the Land Score now consumes LandPortal's returned road frontage, wetlands, FEMA, buildability, acreage, and valuation instead of ignoring them. A fully-read parcel (card #5) went from a misleading 9/100 all-gaps to a real **77/100 PURSUE, full confidence** — an investor-grade, decision-useful score. A thin-read parcel (card #1) scores 50/100 and honestly marks the two fields no provider returned as gaps. This is the DD employee producing a report Tyler can actually decide on, without over-conservative verification blocking execution. | (1) Post-contract legal/financial execution still tightens to county/official confirmation (by design); (2) offer-guidance/valuation depends on a comp source (paid comps gated); (3) enrich thin-read parcels (Realie or a fuller LandPortal read) to close remaining gaps. |
| 2026-07-05 | Due Diligence (Deal Card / Property Report) — visual acceptance | Usable (discovery-ready) | Judged like Tyler by actually opening the Deal Card in the dashboard: for a verified property the operator can now, before a discovery call, understand the property (parcel facts: frontage/landlocked/wetlands/FEMA/buildability/slope), the market (Market Pulse + county $/acre), the risks (Land Score flags incl. buildability terrain conflict), the comps (Comparable Intelligence estimate), the visuals (real satellite + Street View), and the next move (Seller Call Brief + next action). Before this sprint the whole report block silently crashed and the operator saw almost none of it. That is fixed and visually confirmed. | Offer-ready NOT yet: no SOLD comps (paid comp credits gated) so valuation is asking-market only; access/title/utilities unconfirmed; 3D/terrain + a parcel-facing Street View still missing. A fresh unverified-matched lead is discovery-useful (gov-DD, visuals, market) but has no Land Score until strong-identity verification. |
| 2026-07-05 | Acquisition / Property Board — workspace-readiness summary | Usable | The Property Board is now scannable: each kanban card shows which properties already have inspection, visuals, comps, and seller questions, so Tyler can prioritise which leads to open and work next instead of clicking blindly. Previously the backend counts existed but were inflated (79 "visuals") — now honest and operator-visible. This turns latent backend workspace data into a real board-level triage signal. | (1) Visual count is inspection assets + Google captures (a rough "how much visual context exists"), not a curated gallery; (2) a future enhancement could make a badge click deep-link to that section of the card. |
| 2026-07-04 | Due Diligence (Property Report) — USGS slope in Buildability | Improved | The Buildability read now uses two approved sources together: LandPortal buildability % and USGS 3DEP terrain slope. Where LandPortal didn't return buildability (card #1) USGS terrain now fills it (0→8/10) so the parcel scores honestly instead of gapping; where both exist (card #5) LandPortal is scored and a terrain disagreement is surfaced as a visible conflict for Tyler to verify before pricing. This is a more trustworthy buildability read — two independent providers cross-checking each other, with disagreements shown rather than hidden. | (1) The USGS 33 m EPQS cross is a coarse point estimate ("confirm with full DEM in deeper DD") — treat a lone USGS-derived buildability as directional; (2) full-parcel slope distribution (vs a single average) is a later enhancement. |

## Business QA Template

```markdown
### YYYY-MM-DD - <department / employee>

- Business outcome expected:
- Operator/user:
- Result:
- Measurable business value:
- Missing business value:
- Current dashboard/output state:
- Evidence inspected:
- First business blocker:
- Root cause:
- Files changed:
- Tests/builds:
- Operator QA link:
- Reference artifacts:
- Next exact task:
- What not to repeat:
```
