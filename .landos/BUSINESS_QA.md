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
