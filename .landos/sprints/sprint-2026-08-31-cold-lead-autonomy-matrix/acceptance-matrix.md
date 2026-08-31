# Cold-Lead Autonomy Acceptance Matrix — Sprint 3

Date: 2026-08-31
Accepted baseline: `faa6051eb7169cd11af2ed9a4cb7f23e54375f70`
Runtime: managed LandOS at `http://localhost:3141`

## Result matrix

| Case | Intake Type | Subject Established | Clarification | Market Early | Parcel Research | Recovery | Final Readiness | Intelligence | Autonomy Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 / Deal 100 | Address + APN | Yes — APN `023 003.02`, Hamilton County, TN | None | Yes — county/ZIP were available from intake | Exact provider parcel retained; official county record remained unresolved | Deterministic source limits were followed by bounded alternatives | 8 returned, 6 partial, 4 unresolved, 1 not required | Current operational market/property read; seller honestly pre-contact; no supported FMV | AUTONOMOUS PASS |
| 2 / Deal 101 | Address only | Yes — LandOS independently resolved APN `023 003.02` | None | Yes — before parcel establishment | Address → jurisdiction → parcel → canonical subject | Autonomous resolution continued after deterministic attempts | 8 returned, 6 partial, 4 unresolved, 1 not required | All persisted intelligence layers reported current; seller pre-contact | AUTONOMOUS PASS |
| 3 / Deal 102 | APN only | Yes — supplied APN plus Hamilton County uniquely resolved | None | Yes — county immediately; ZIP only after provider situs landed | Exact parcel and later situs `5170 Hwy 60` retained without inventing an input address | A transient source-unavailable result recovered through the accepted Hermes/provider route | 8 returned, 6 partial, 4 unresolved, 1 not required | Current operational read; unsupported zoning/FMV remained pending | AUTONOMOUS PASS |
| 4 / Deal 105 | Exact LandPortal pointer | Yes — decoded FIPS 47065, APN, and property ID immediately | None | Yes — county from FIPS before parcel enrichment | Exact authenticated panel and provider corroboration retained with provenance | No redundant address/APN interview; downstream work released from the pointer | 8 returned, 6 partial, 4 unresolved, 1 not required | Current operational read; seller pre-contact; no fabricated valuation | AUTONOMOUS PASS |
| 5 / Deal 113 | Messy conversational APN/locality | Yes — normalized APN plus Hamilton scope and authenticated LandPortal search | None | Yes — Hamilton County market work was available before exact parcel establishment | Exact parcel/provider facts retained; official axes stayed separate | Bounded resolution established the subject, then the repaired coverage planner ran only untouched utility gaps | 7 returned, 2 partial, 4 unresolved, 5 blocked, 1 not required | Property 54, Market 66/B, Seller pre-contact, current Deal Read; hard refresh and managed restart persisted | AUTONOMOUS PASS |

## Detailed case records

### Case 1 — address plus APN (Deal 100)

- Exact input: `Cold-lead matrix Case 1. Seller: Jordan Retry, 423-555-0111. Property: 5170 Highway 60, Birchwood, TN 37308. APN: 023-003.02. Seller is considering a sale. Fresh corrected rerun.`
- Intake extraction: complete street/city/state/ZIP, seller/contact, and punctuation-normalized parcel clue.
- Initial subject: unverified lead; county and ZIP were immediately usable for independent geography work.
- Establishment: exact APN/provider match established the working subject in about 61 seconds; the authenticated LandPortal parcel panel agreed.
- Schedule: geography-safe market work began from county/ZIP; parcel-specific lanes released after subject establishment; prerequisite-safe backfill fanned out concurrently.
- Deterministic/recovery: official county sources did not yield a current exact record; bounded provider/browser recovery landed exact-subject facts. No operator question or manual lane invocation occurred.
- Landed evidence: owner `CAMERON NATHANIEL JOSEPH`, provider situs, 40.5 provider acres, house size, road/water facts, Hamilton market bands, and explicit missing-source reasons. Provider acreage was not promoted as official assessed/survey acreage.
- Final state: 8 returned / 6 partial / 4 unresolved / 1 not required; zoning, official parcel, defensible sold-comp FMV, and parcel imagery remained honestly unavailable. Seller Intelligence stayed pre-contact.
- Duration: full mission 108.7 seconds (3 returned / 5 partial / 4 blocked at mission terminal accounting).
- Genuine operator action: discovery call and unresolved official diligence only; none required to finish autonomous research.

### Case 2 — address only (Deal 101)

- Exact input: `Cold-lead matrix Case 2. Seller: Avery Test, 423-555-0102. Property address: 5170 Highway 60, Birchwood, TN 37308. Seller is considering a sale. No parcel number was supplied.`
- Intake extraction: address/city/state/ZIP and seller/contact; APN correctly absent.
- Initial subject: address candidate, not a fabricated parcel.
- Establishment: autonomous address resolution found APN `023 003.02` in about 54 seconds, then canonical subject consumers converged on it.
- Schedule: county/ZIP market work started from the submitted address while parcel lanes waited for canonical subject.
- Deterministic/recovery: no request for an APN; accepted resolution/provider paths continued after deterministic limitations.
- Final evidence/readiness: same exact parcel facts and honest gaps as Case 1; 8 returned / 6 partial / 4 unresolved / 1 not required.
- Intelligence: persisted Property, Market, Seller, and Deal products were checked with all stale flags false. Seller remained pre-contact and FMV remained unestablished.
- Duration: 87.0 seconds (4 returned / 5 partial / 3 blocked at mission terminal accounting).
- Genuine operator action: none for research completion.

### Case 3 — APN only (Deal 102)

- Exact input: `Cold-lead matrix Case 3. Seller: Morgan Test, 423-555-0103. Parcel APN 023 003.02 in Hamilton County, Tennessee. No street address is available.`
- Intake extraction: APN, county/state, seller/contact; no input address.
- Initial subject: jurisdiction-scoped parcel candidate.
- Establishment: an early transient unavailable result self-recovered through the accepted Hermes/provider JSON route by roughly 21 seconds; the final provider record later added `5170 Hwy 60` as sourced evidence, not as an invented intake fact.
- Schedule: Hamilton County work ran immediately; ZIP-scoped work became eligible only when the sourced situs/ZIP arrived; subject-dependent lanes followed the exact match.
- Final readiness: 8 returned / 6 partial / 4 unresolved / 1 not required. No redundant address clarification.
- Duration: 102.0 seconds (5 returned / 4 partial / 3 blocked at mission terminal accounting).
- Genuine operator action: none for research completion.

### Case 4 — exact alternate pointer (Deal 105)

- Exact input: `Cold-lead matrix Case 4 rebuilt rerun. Seller: Riley Test, 423-555-0104. Exact property pointer: https://landportal.com/?property=Zmlwcz00NzA2NSZhcG49MDIzKzAwMy4wMiZwcm9wZXJ0eWlkPTE3Mjk1NDc1NQ%3D%3D`
- Intake extraction: decoded FIPS `47065`, APN `023 003.02`, LandPortal property ID `172954755`, and Tennessee jurisdiction. The exact supplied URL was retained.
- Initial subject: exact supported pointer with unverified official axis.
- Establishment: pointer identity released the subject immediately; authenticated parcel-panel evidence and provider corroboration preserved exact-subject scope.
- Schedule/recovery: county market work did not wait for official parcel proof; parcel consumers used canonical subject and did not reopen identity or ask for an address.
- Final readiness: 8 returned / 6 partial / 4 unresolved / 1 not required; official parcel, zoning, imagery, and FMV stayed unresolved where source evidence did not support them.
- Duration: 98.5 seconds (5 returned / 4 partial / 3 blocked at mission terminal accounting).
- Genuine operator action: none for research completion.

### Case 5 — messy conversational input (Deal 113)

- Exact input: `Cold-lead matrix Case 5 accepted-build proof. Spoke with Sidney, 423-555-0113. They may sell the forty-acre tract near Highway 60 outside Birchwood, Hamilton Co TN. Their parcel note says 023.003-02; they live out of town and want a straightforward sale. Please verify the details.`
- Intake extraction at creation: punctuation-form APN `023.003-02`, Hamilton County, TN, and Birchwood locality. The word `forty` was not silently promoted to canonical acreage, and the conversational contact sentence was not treated as ownership evidence.
- Initial subject: unverified parcel lead. Hamilton County market context was visible immediately while exact parcel resolution continued.
- Acceptance rule: this fresh equivalent run was submitted through the normal operator New Lead UI after the fixes and production build. No database edits, subject changes, manual capability calls, evidence injections, readiness edits, or forced intelligence are permitted during the run.
- Establishment: normalized APN `023 003.02`, Hamilton County scope, and authenticated LandPortal search established the exact subject in approximately 2m24s. The operator header enriched to `5170 HIGHWAY 60`, owner of record `CAMERON NATHANIEL JOSEPH`, and 40.5 provider acres without promoting those facts to official evidence.
- Mission: 4m10s, with 5 returned / 4 partial / 3 blocked across the 12 terminal lanes. No clarification, database edit, subject correction, manual capability invocation, evidence injection, or forced intelligence occurred.
- Automatic coverage: the accepted-build plan reused seven retained requirements, marked two partial, six not run, three blocked, and one not applicable; it attempted only the untouched public-water, public-sewer, well-outlook, and septic-outlook gaps. Read-only invocation evidence confirms the specialist preflight did not retry assessor or zoning. Final readiness settled at 7 returned / 2 partial / 4 unresolved / 5 blocked / 1 not required.
- Intelligence: Property 54/Moderate, Market 66/Good (grade B), deterministic pre-contact Seller, and a current Deal Read that keeps FMV unestablished and subdivision upside at zero until verified. A hard refresh and a final managed server restart loaded the same current products and canonical header.
- Total autonomous elapsed time through settled coverage and refreshed intelligence: approximately 14m38s. The approximately ten-minute acquisition-analyst tail remains visible; the eliminated duplicate 180-second assessor/zoning preflight did not recur.

## Defects exposed and repaired

1. Address-only resolution backfill was needlessly serialized. Backfill now fans out prerequisite-safe independent work concurrently while preserving manifest order.
2. Exact LandPortal links were stored but not decoded early enough to seed subject identity. New Lead now decodes APN/FIPS/property ID/state and retains the original URL.
3. Mixed APN punctuation such as `023.003-02` did not generate the canonical `023 003.02` lookup variants. Normalization now recombines the final parcel segment deterministically.
4. Conversational locality parsing treated `Hamilton Co TN` as a city or missed the county; qualifiers such as `outside Birchwood` also polluted locality identity. Intake, router, source adapter, and identity normalization now agree on county/state/city.
5. Authenticated LandPortal SPA results could be discarded solely because navigation ended at the root URL. Exact panel APN plus county/state scope can now persist a trusted checkpoint; discovery consumers require the same scope agreement.
6. A synthetic `Parcel <APN>` label could be mistaken for a street. It is now parcel identity only.
7. Provider acreage was being projected as assessed acreage. Provider-only acreage remains `providerAcres`; assessed and surveyed axes stay null without their authority.
8. A provider-confirmed subject could be described as officially verified. Canonical subject establishment and official verification are now separate axes; only authority-specific official evidence sets the latter.
9. Automatic coverage planning could classify already-attempted machine lanes as runnable. Automatic cycles now run only NOT_RUN/NEEDS_REFRESH work; an explicit operator rerun may retry still-required PARTIAL/BLOCKED lanes.
10. The intelligence stack had a second preflight that immediately retried attempted red critical gaps even after the outer coverage cycle correctly declined them. Specialist preflight now backfills only untouched critical gaps; explicit Research Re-run remains the retry control.

## Honest source outcomes

- No case fabricated zoning when parcel-specific official zoning could not be established.
- Returned comp candidates were not treated as accepted closed sales; FMV stayed pending with zero qualifying sold comps.
- Unsuccessful visual navigation did not count as parcel imagery. The operator UI says imagery was not retained.
- Conflicting road-frontage values remain explicit and unresolved.
- LandPortal/provider 40.5 acres is usable provider evidence, not an official assessment or survey conclusion.
- Survey acceptance: **NOT TESTED**. No safe subject-matching survey fixture was manufactured.
- A pre-fix messy proof (Deal 110) correctly refused to choose among statewide same-APN candidates after county parsing failed. That was honest refusal, and the parser defect was repaired before the fresh final case.

## Performance and test notes

- Successful research missions measured 87.0–108.7 seconds for the first four matrix cases.
- The final pre-fix diagnostic Deal 112 completed its mission in 6m14s and its full analyst cascade in approximately 23m38s, exposing the duplicate critical-gap retry. The final accepted-build Deal 113 completed its mission in 4m10s and settled in approximately 14m38s without that retry.
- Focused regression: 345 passed across 16 files after the final repair; the exact LandPortal route scenario passed in isolation. A broader earlier route run had one recurrent async discovery-package hash race, recorded rather than hidden.
- Post-commit Control policy surfaced three stale Workspace V2 source-contract files. Their assertions were aligned to the accepted routed UI, and both mandatory capability suites passed without a product-code change.
- Broad repository regression: 7,998 passed / 43 failed / 3 skipped across 576 files. Failures were outside this sprint's accepted change surface and included existing source-contract drift, timeout-sensitive browser/report tests, and repository-wide baseline assertions; the full failing inventory remains in the terminal evidence rather than being represented as green.
- Standalone typecheck passed.
- Production build passed after the expected sandbox-only esbuild directory restriction was rerun with approved access.

## Operator-facing acceptance

The normal Deal Card was inspected for subject header, acreage basis, retained facts, readiness, market bands, comps/FMV, intelligence, action messaging, and gaps. It presents operational language rather than worker/run/fingerprint vocabulary. Deal 113 passed hard-refresh persistence, final managed-restart persistence, and independent repository browser QA (5/5 assertions, two screenshots, zero browser diagnostics).
