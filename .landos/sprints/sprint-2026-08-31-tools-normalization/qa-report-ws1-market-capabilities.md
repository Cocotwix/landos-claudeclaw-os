# Independent Browser QA - ws1-market-capabilities (FAIL)

Inspected live at http://localhost:3141/tools in a real browser tab (tab 494897935, session tab group).
Runtime verified first: npm run landos:status -> RUNNING (healthy), single verified server, port 3141, HTTP 200.
No automated operator-qa journey exists for this workstream (landos-operator-qa --list has no tools/market journey); manual browser inspection performed instead.

## Journey results
1. PASS - /tools shows "Market Research" section with input labeled "GEOGRAPHY - COUNTY OR ZIP, NO PARCEL NEEDED" and buttons Run Market Pulse / Run County Market Research / Run ZIP Market Research. Property Resolver section renders above with all 9 buttons.
2. PASS - Market Pulse "Iredell County, NC": header "Iredell, NC - reused retained run", label "LOCAL AREA CONTEXT, NOT PARCEL VERIFIED", growth +6.84% (pop 196,544), county $/acre median $50,591 across 316 sales, 2026-Q3 snapshot. No parcel/APN demanded.
3. PASS - County Market Research same input: SOLD - IREDELL COUNTY (ALL ACREAGE): $50,591/acre, DOM 97, sell-through 76.7%, absorption 43.41%, months of supply 15.86, pop 196,544. Honest "FOR SALE - NO RETAINED DATA YET". Numbers consistent with Market Pulse.
4. PASS with finding F3 - ZIP 28115: first click surfaced raw "Failed to fetch"; retry rendered ZIP 28115 metrics ($74,864/acre, DOM 202, etc., "reused retained run").
5. PASS - Negative case (28115 + Run Market Pulse): plain message "A county (with state) or county FIPS is required." API returned 400 but no raw error shown.
6. PASS - Hard refresh: page rendered cleanly, zero console errors, network log shows NO capability invocations on load (only settings/health/chat-stream) - no expensive reruns. Re-run of Market Pulse showed "reused retained run" with identical figures.
7. PASS - Consistency cross-check: $50,591 and +6.84% identical across Market Pulse, County Market Research, and post-refresh rerun; invokes observed as POST /api/landos/capabilities/{market-pulse,county-market-research,zip-market-research}/invoke.
8. PASS - No lead/Deal Card created: store/landos.db read-only counts unchanged before/after (landos_lead 0, landos_property 0, landos_deal 0, landos_property_card 24, landos_deal_card 31).

## Adversarial probe (Loving County, TX - no retained county data)
FINDING F1 (major, ws1-r2): Market Pulse presents TX statewide figures as Loving County facts: "Loving County, TX is growing... population of 30,188,424, from the retained LandOS Market Research county record" and "$82,688/acre in the county (median of 29074 comps)". Those are statewide numbers (Loving County pop ~64). Misattributed basis, not an honest data gap. patternKey same-label-different-basis.
FINDING F2 (minor, ws1-r2): County Market Research for Loving labels the block "SOLD - TX STATEWIDE (ALL ACREAGE)" (honest basis) but never states that no Loving County data is retained, under a county-titled panel.
FINDING F3 (minor, ws1-r1): transient raw "Failed to fetch" on first ZIP invoke; retry succeeded.

## Evidence
- qa-evidence-ws1-market-pulse-loving-pagetext.txt
- qa-evidence-ws1-county-loving-pagetext.txt
- qa-evidence-ws1-zip-failedfetch-pagetext.txt
Screenshot substitution note: two screenshot captures succeeded early in the session; later Page.captureScreenshot calls timed out (renderer occluded in operator Chrome); named page-text reads recorded instead, per contract section 5.

Verdict: FAIL (internally fixable findings remain in the assigned workstream).
