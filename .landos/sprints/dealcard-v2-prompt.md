Repair and finish the shared LandOS Deal Card v2 operator experience using the permanent staged sprint lifecycle that is now installed in the repository.

Use the compact automatic LandOS memory and current checkpoint.

Do not invoke /continue-landos.
Do not load broad historical context.
Do not create a property-specific fix.
Do not declare completion from backend tests or narrative confidence.

Repository:
C:\Users\tbutt\claudeclaw-os

PRIMARY OPERATOR OUTCOME

When Tyler opens a verified Deal Card, every visible fact, readiness state, valuation, strategy status, comparable, research status, and next action must be internally consistent, correctly qualified, and useful for making a land-investment decision.

The coding agent is not the final judge of completion.

Use the installed staged lifecycle:

requirement ledger
-> workstream implementation
-> automated checks
-> managed live-local verification
-> independent browser QA
-> repair loop
-> browser retest
-> workstream acceptance
-> next workstream
-> final combined Deal Card regression
-> independent final review
-> capability freeze

Create a real sprint ledger using the installed LandOS sprint-system tooling.

Preserve the original requirements in the ledger without silently narrowing them.

ACCEPTANCE EXAMPLE

Use this property only to reproduce and verify shared failures:

200 Sid Edens Rd, Pickens, SC 29671
APN 5105-00-44-0497

Do not hardcode its address, APN, county, acreage, comps, valuation, or displayed conclusions.

Every repair must apply through shared records, services, validation, readiness, report assembly, UI components, migrations, and browser journeys to all current and future Deal Cards.

OPERATOR-CONFIRMATION RULE

Do not change previously accepted operator information without Tyler's confirmation.

When accepted information conflicts with new evidence:

1. Preserve both values.
2. Identify the sources.
3. Record the discrepancy.
4. Do not silently select a replacement.
5. Do not use a disputed value for a gated calculation unless its permitted use is explicit.
6. Put the material decision in "Tyler decision required."

WORKSTREAM 1 - CANONICAL ACREAGE AND SPATIAL BASIS

Repair the shared acreage and spatial-basis model.

The live card currently shows:

1. Assessed acreage: 1.32 acres.
2. Mapped/provider geometry: 1.15 acres.
3. Description based on 1.15 acres.
4. Valuation based on 1.15 acres.
5. FEMA area reported as 1.32 acres.
6. Non-wetland mapped area reported from 1.15 acres.
7. No Tyler decision required.

That state is not sufficiently reconciled.

Implement one shared acreage-basis record that distinguishes:

1. Assessed acreage.
2. Deeded acreage.
3. Surveyed acreage.
4. GIS geometry acreage.
5. Provider acreage.
6. Operator-accepted acreage.
7. Valuation acreage.
8. Spatial-overlay acreage.

For every use, record:

1. Value.
2. Source.
3. Confidence.
4. Whether disputed.
5. Whether operator accepted.
6. Permitted uses.
7. Limitation.

Requirements:

1. The UI must explain why assessed and mapped acreage differ.
2. Overlay acreage must use the actual geometry queried.
3. Valuation must disclose exactly which acreage basis it uses.
4. A material unresolved acreage basis must trigger a reconciliation issue and Tyler decision when appropriate.
5. No calculation may silently use an acreage that the header treats as unresolved.
6. Flood, wetlands, soils, slope, non-wetland area, comps, valuation, maps, reports, and strategy math must identify the correct acreage basis.
7. Add consistency checks that fail when an overlay area exceeds its queried geometry without a documented explanation.
8. Do not change an accepted acreage without Tyler's confirmation.

Complete independent browser QA for this workstream before proceeding.

WORKSTREAM 2 - RESEARCH COMPLETENESS AND EVIDENCE LANGUAGE

Repair the shared research-completeness model and visible wording.

The live card currently counts seven of eight lanes as evidenced even though:

1. Zoning has not run.
2. Parcel-road contact remains researching.
3. Legal access remains unresolved.
4. Deed and easement documents have not been reviewed.
5. FEMA panel information remains pending.

Separate:

1. Provider attempted.
2. Provider retrieved data.
3. Partial evidence.
4. Business question resolved.
5. Legal confirmation complete.
6. External confirmation required.

Do not count partial proximity evidence as completed access research.

Do not count a county flood query as complete FEMA research when material FEMA tasks remain.

Repair these specific categories:

FEMA:
1. Zone X result, coverage basis, panel status, effective date, and BFE availability must be separate.
2. Do not state that BFE was screened when no BFE exists or was retrieved.
3. Do not label "exact acreage + BFE" completed unless both are genuinely supported.
4. Use the mapped geometry acreage for overlay percentages and acreage.
5. Clearly distinguish county-layer screening from federal FIRM confirmation.

Road and access:
1. Road proximity is not frontage.
2. An unnamed or non-publicly classified road is not automatically a private road.
3. Do not state that recorded private-road rights are required unless evidence supports that conclusion.
4. Separate road classification, parcel contact, right-of-way contact, physical access, driveway evidence, legal access, and maintenance.
5. Use "unknown" rather than "private" when road ownership is not established.

Soils and septic:
1. Do not describe one mapped component as a split or mixed set unless multiple meaningful ratings exist.
2. Distinguish SSURGO map-unit limitation from site-specific septic feasibility.
3. Do not imply part of the parcel supports septic without adequate evidence.
4. Keep map-unit slope descriptions separate from measured parcel mean slope.

Utilities:
1. Absence of a mapped county line is not proof that service is unavailable.
2. Clearly label well and septic statements as preliminary likelihoods.
3. Record provider/service-area research and remaining confirmation separately.

Critical red flags:
1. Incomplete screening must not appear favorable.
2. Access, title, acreage, and zoning uncertainty must affect critical-risk completeness.
3. "No all-clear" language must match the actual unresolved material categories.

Complete independent browser QA for this workstream before proceeding.

WORKSTREAM 3 - UNIFIED READINESS AND STRATEGY STATUS

Repair the shared readiness service.

The live card currently shows:

1. Strategy Readiness: OK.
2. Strategies scoreable.
3. All five strategies: blocked.
4. Value Readiness: OK.
5. Offer Readiness: researching.

These states do not compute together.

Create one shared readiness record consumed by:

1. Overview.
2. Market.
3. Strategy.
4. Seller.
5. Reports.
6. RAG output.
7. Executive review.

Separate:

1. Research completeness.
2. Preliminary valuation context.
3. Defensible valuation readiness.
4. Strategy screening availability.
5. Strategy scoreability.
6. Strategy actionability.
7. Offer readiness.
8. Contract readiness.

Requirements:

1. If all five strategies are blocked, Strategy Readiness cannot display OK or actionable.
2. The UI may say strategy screening is available while actionability is blocked.
3. Value Readiness cannot be high or fully ready merely because a median can be calculated.
4. Zoning, acreage basis, access, title, and physical constraints must affect confidence and readiness according to their materiality.
5. Offer readiness must clearly explain why it remains researching or blocked.
6. All tabs and reports must consume the same readiness result.
7. The consistency audit must fail when visible statuses disagree.

Complete independent browser QA for this workstream before proceeding.

WORKSTREAM 4 - COMPARABLE VALIDATION, PROVIDER COVERAGE, AND VALUATION

Repair the shared comp and valuation workflow.

The live card currently shows 55 sold comps and a high-confidence valuation, but the selected top-five PPA values range from approximately $6,250 to $64,516 per acre.

The system must prove that the market evidence is coherent before presenting high confidence.

For every provider mission, show:

1. LandPortal attempt and result.
2. Zillow attempt and result.
3. Redfin attempt and result.
4. Realie.ai attempt and result.
5. Realtor.com/HomeHarvest attempt and result.
6. County recorded-sale attempt and result.
7. Candidate count.
8. Accepted count.
9. Duplicate count.
10. Rejected count.
11. Failure or blocker reason.

Do not claim provider coverage merely because an adapter exists.

For every selected primary comp, validate and display:

1. Address.
2. APN when available.
3. Closed status.
4. Sale price.
5. Sale date.
6. Acreage.
7. Sold PPA.
8. Straight-line distance.
9. Vacant-land or improved-property status.
10. Neighborhood/local-market relationship.
11. Zoning or development-context similarity when available.
12. Access and utility similarity when available.
13. Flood, wetlands, terrain, and constraint similarity when available.
14. Provider name.
15. Direct provider link.
16. Score components.
17. Why selected.
18. Material differences.
19. Known unknowns.
20. Why it outranked the next-best excluded candidate.

Requirements:

1. A missing provider URL must be visibly identified rather than silently omitting "view."
2. The Realie.ai comp must have a working provider link when available.
3. Weak comps must not be selected merely to fill five positions.
4. Use fewer than five when fewer are defensible.
5. Improved or unknown-improvement sales must be excluded or materially penalized.
6. Detect materially different geographic, acreage, improvement, or PPA clusters.
7. Do not blend materially different clusters into one high-confidence median.
8. Explain outliers.
9. High confidence requires a coherent validated cluster and adequate subject similarity.
10. Otherwise show preliminary, moderate, low, conflicted, or insufficient evidence.
11. The selected set, displayed sold count, valuation count, map count, and registry count must reconcile.
12. The interactive comp map and table must use the same deduplicated records.
13. Provider links must open safely in a new tab.
14. The LandPortal raw map and final LandOS selected map must remain clearly differentiated.

Valuation must disclose:

1. Subject acreage basis.
2. Selected cluster.
3. Number of qualified closed sales.
4. Median PPA.
5. Weighted PPA.
6. Simple average PPA.
7. Interquartile range.
8. Outliers removed or retained.
9. Material limitations.
10. Confidence rationale.

Do not present a high-confidence valuation when access, zoning, property type, acreage basis, or comp coherence materially undermines confidence.

Complete independent browser QA for this workstream before proceeding.

WORKSTREAM 5 - EXECUTIVE AUDIT AND OPERATOR COPY

Repair the consistency audit and operator-facing wording.

The live card currently claims 25/25 checks pass despite visible readiness and acreage-basis issues.

Extend the audit to fail on:

1. Strategy Readiness OK while all strategies are blocked.
2. Value confidence inconsistent with unresolved material facts.
3. Missing Tyler decision for a material acreage discrepancy.
4. Overlay acreage inconsistent with geometry acreage.
5. BFE claims unsupported by evidence.
6. Partial access evidence counted as completed access research.
7. Unknown road ownership described as private.
8. Provider coverage claims without actual provider results.
9. Selected comp missing provider link.
10. High-confidence valuation with incoherent comp clusters.
11. Research-progress report wording that implies completed underwriting.
12. Any frontend and backend readiness mismatch.

Repair awkward or misleading copy, including:

1. "1.15-acre parcel on Pickens, Pickens County."
2. "0 of 1 component ratings are very limited."
3. Statements asserting a private road without proof.
4. Seller questions referring to "Unnamed road" as though it were a confirmed usable access route.
5. Repeated duplicate access and septic paragraphs.
6. Technical language that does not help Tyler determine what matters next.

Generate seller questions from actual unresolved facts, but keep them natural and useful.

Complete independent browser QA for this workstream before proceeding.

WORKSTREAM 6 - COMPLETE DEAL CARD BROWSER REGRESSION

After the first five workstreams pass independently, run the full Deal Card operator regression.

The independent browser QA agent must inspect, click through, and reconcile:

1. Overview.
2. Property.
3. Due Diligence.
4. Market.
5. Strategy.
6. Visuals.
7. Seller.
8. Documents.
9. Activity.
10. Interactive comp map.
11. Every selected comp popup.
12. Provider links.
13. Research status.
14. Readiness states.
15. Reports.
16. Refresh persistence.
17. Managed restart persistence.

Use:

1. 200 Sid Edens Rd, Pickens, SC 29671, APN 5105-00-44-0497.
2. At least two unrelated verified properties in different jurisdictions.
3. One verified property with incomplete research.
4. One unresolved property.
5. One genuine APN-conflict fixture.
6. One thin-market fixture.
7. One multi-parcel fixture.

Do not alter accepted real-property information during QA.

The QA agent must compare:

1. Frontend.
2. API payload.
3. Database state.
4. Accepted operator facts.
5. Requirement ledger.

Capture fresh screenshots.

Every finding must return to the builder and receive a browser retest.

FINAL CAPABILITY FREEZE

When every workstream and the final independent regression pass:

1. Freeze Deal Card v2 as an accepted capability.
2. Register its golden journeys.
3. Register its invariants.
4. Register its regression suites.
5. Register known limitations and true external blockers.
6. Require future shared-dependency changes to rerun the protected Deal Card regression.
7. Do not allow unrelated department work to casually reopen or redesign Deal Card v2.

Do not mark Tyler acceptance complete merely because automated QA passes. Mark it ready for Tyler's final usefulness review.

TESTING

Run:

1. Targeted tests for every repaired invariant.
2. Sprint-system ledger validation.
3. Relevant integration tests.
4. Full test suite.
5. Typecheck.
6. Production build.
7. git diff --check.
8. The installed operator-QA command.
9. Independent final review.

Do not proceed to the next workstream until the current workstream passes its live browser-QA gate.

LIVE-LOCAL REQUIREMENT

Use only:

npm run landos:status
npm run landos:start
npm run landos:stop
npm run landos:restart
npm run landos:logs
npm run landos:health

Never run a foreground production server.
Never kill generic Node processes.

At completion confirm:

1. Exactly one managed process.
2. HTTP and health response.
3. Current production bundle.
4. Persistence after restart.
5. Server PID.
6. Exact live URLs identified by full address and APN.

SAFETY

Do not commit.
Do not push.
Do not deploy.
Do not edit .env.
Do not reset.
Do not restore.
Do not stash.
Do not delete real properties or operator data.
Do not use paid APIs.
Do not purchase LandPortal reports.
Do not expose credentials or dashboard tokens.
Preserve unrelated dirty work.

FINAL REPORT

Generate the final report from the sprint ledger and linked evidence.

Report:

1. Workstreams created.
2. Shared root causes.
3. Repairs made.
4. Browser-QA findings and repair cycles for each workstream.
5. Acreage-basis behavior.
6. Research-completeness behavior.
7. Readiness behavior.
8. Comp-provider coverage.
9. Selected-comp validation.
10. Valuation confidence and clustering.
11. Consistency-audit behavior.
12. Operator-copy improvements.
13. Full Deal Card regression results.
14. Accepted-capability freeze result.
15. Tests.
16. Typecheck.
17. Build.
18. git diff check.
19. Independent-review result.
20. Remaining true external blockers.
21. Pending Tyler decisions.
22. Proof paths.
23. Server PID.
24. Exact live URLs.
25. Confirmation that no prohibited action occurred.

Do not claim completion unless every internally fixable requirement has linked automated proof and independent live-browser proof.
