# Duke Skill: Fast Default Report

Load when: Tyler provides address, APN, owner + location, or any property identifier. No comp credit requested.

Read this file before calling any external tool. This skill is self-contained for a complete Fast Default workflow.

---

## Dashboard Fast Default Budget

**Maximum external calls: 2**

1. 1 web search -- county identification only, if county or FIPS is not already known. Skip if county or FIPS is known.
2. 1 LP call -- `lp_resolve_property` (address path) or `lp_property_data` (APN/propertyid+fips path).

Do not run web searches for area statistics, comps, ordinances, listings, or any other research before delivering the report. All of that is deferred.

File writes and PDF generation do not count toward this budget. They run after the report is composed.

If Tyler explicitly asks for area stats or web comps as part of the initial request (not just an address), deliver the parcel-verified LP-based report first, then run the requested research as a follow-up.

---

## Step 1: Receive Input

Tyler may submit any of the following:

- Address only (ask for city/state if missing)
- Address + city/state
- Address + city/state + county
- APN + state
- APN + county + state
- Owner name + state
- Owner name + county/state
- LandPortal property ID + FIPS
- LandPortal URL

Work backward from whatever Tyler provides. Ask one short follow-up if a critical piece is missing.

- Address without city/state: ask "What city and state is this in?"
- Address + city + state without county: ask "What county is this in?" (required for address filter lookup)
- Identifier returns multiple matches: switch to `duke-unconfirmed-parcel.md` immediately
- Never ask for more than one missing piece at a time

**Corrected / follow-up / replacement address:** If Tyler corrects, edits, or replaces the address in the same thread (e.g. "it is actually 183 Bob Wise Road"), treat the corrected address as the active input and re-run this address path from the start against it. Do not reuse parcel assumptions, candidates, or FIPS from the prior failed address. The Lookup Timeout Recovery Ladder and the Zero-Candidate Address-Mismatch Recovery Ladder (Step 3) apply to corrected and follow-up addresses exactly as they do to a first-turn fresh address. A timeout or zero-candidate result on a corrected address must route through the ladder, never a bare dead-end.

If Tyler writes TY_LAND_BIZ explicitly in the input: tag as TY_LAND_BIZ. Otherwise tag LAND_ALLY and proceed without asking.

---

## Step 2: Identify Search Path

Use the cheapest reliable LP path for the identifier provided:

| Identifier | Search Path |
|---|---|
| LandPortal URL | Extract propertyid + fips. Call `lp_property_data` directly. |
| Property ID + FIPS | Skip `lp_search`. Call `lp_property_data` directly. |
| APN + state or county | Call `lp_resolve_property` with apn + state. |
| Owner + state or county | Call `lp_resolve_property` with owner + state. |
| Address + city + state | Address Input Path (see below). |

Request conservation rules:
- If Tyler provides propertyid + fips directly: skip `lp_search`.
- If `lp_search` already returned a confirmed match this session: do not call again.
- Call `lp_property_data` once per parcel per session unless the first call returned incomplete data.

---

## Address Input Path

When Tyler provides an address without APN, property ID, or FIPS:

1. Call `lp_resolve_property` with address, city, state, and fips.
2. If fips is not known: run one web search against reliable public sources (county GIS, assessor sites, listing pages, municipality references) to identify the county for city/state. This is county identification only -- not geocoding, not parcel lookup, not coordinate inference.
   - One reliable county found: resolve FIPS, proceed with `lp_resolve_property`.
   - Multiple county candidates: ask Tyler to confirm which county.
   - No reliable county found: ask Tyler for county or FIPS.
3. Never convert an address to coordinates for parcel lookup.
4. Never use lat/lng as parcel lookup inputs under any circumstance.
5. Never use geocoding, nearest-parcel lookup, road midpoints, town centroids, ZIP centroids, or any coordinate-based method.
6. If `lp_resolve_property` returns `not_verified` or zero candidates: label as "LandPortal Search Mismatch, Parcel Not Verified" and run the Zero-Candidate Address-Mismatch Recovery Ladder in Step 3 (county/GIS exact-address recovery, then `Local Area Context, Not Parcel Verified`, then one next action). Do not jump straight to asking Tyler for an APN.
7. If `lp_resolve_property` returns `multiple_candidates` or `ambiguous_fips`: switch to `duke-unconfirmed-parcel.md`.
7b. If `lp_resolve_property` returns `status: lookup_timeout` or `timed_out: true`: run the Lookup Timeout Recovery Ladder in Step 3 (retry once, county/GIS exact-address fallback, then `Local Area Context, Not Parcel Verified`, then one next action). A timeout is not a mismatch.
8. If parcel is not verified but a reliable location anchor exists (city/state, county/state, or road/city/state): include Local Area Context, Not Parcel Verified using one area statistics web search (this is the 2nd and final allowed call in the budget).

---

## LP Coverage Gap vs LP Search Mismatch

These are different failure modes. Do not use them interchangeably.

**LP Coverage Gap:** `lp_property_data` returns no property record for a propertyid + fips that are known and valid. LP genuinely has no data for this parcel. Label: `LP Coverage Gap`.

**LandPortal Search Mismatch, Parcel Not Verified:** The LP address filter search or `lp_search` returns no results, zero candidates, or `not_verified`. This does not confirm LP lacks the parcel -- LP may have it under a different address format or spelling. Label: `LandPortal Search Mismatch, Parcel Not Verified`. Run the Zero-Candidate Address-Mismatch Recovery Ladder (county/GIS exact-address recovery, then Local Area Context, then one next action) before asking Tyler for an APN.

Never label a failed filter search or `lp_search` result as LP Coverage Gap.

---

## Step 3: Handle Search Results

- **Single match:** Proceed.
- **Multiple matches:** Switch to `duke-unconfirmed-parcel.md` immediately. Do not proceed with parcel-specific analysis.
- **Zero candidates / search mismatch / address-format mismatch / no match:** run the Zero-Candidate Address-Mismatch Recovery Ladder below. Do not dead-end by immediately asking Tyler for an APN. Treat as "Parcel Not Verified" (LandPortal Search Mismatch), never as a confirmed LP Coverage Gap.
- **Lookup timeout** (`status: lookup_timeout`, `timed_out: true`, or equivalent timeout wording): run the LandPortal Timeout Recovery Ladder. Do not treat this as a mismatch, a coverage gap, or zero matches, and do not dead-end.

**Zero-Candidate Address-Mismatch Recovery Ladder** (when LP exact-address search returns zero candidates, a search mismatch, an address-format mismatch, or no match):

This is a "Parcel Not Verified" state, not a confirmed LP coverage gap. Keep every parcel identity rule in force: do not score, do not value, do not recommend an offer, and never use coordinates, geocoding, nearest parcel lookup, map pins, road midpoints, town/ZIP centroids, map bounds, or proximity search. Use only exact address, partial address, APN, owner plus county/state, or official county records for identification.

1. **County assessor / GIS exact-address recovery.** If a county/state anchor exists, run the bounded exact-address recovery from `duke-unconfirmed-parcel.md` (Step 2 disambiguation pass): exact or partial address + county/state against county assessor or county GIS, only if reachable through the normal allowed path. Exact-address verification only -- never coordinates or proximity. If this clearly ties the exact address to a single APN, proceed to verified Fast Default.
2. **Local Area Context, Not Parcel Verified.** If county/GIS exact-address lookup cannot verify a single parcel (failed or unavailable), return `Local Area Context, Not Parcel Verified` using only the city/county/state anchor from Tyler's input for market/local context. Never identify or infer a parcel from area context.
3. **One next action.** End with exactly one next action: "Send the APN + county, or owner name + county, and I will verify the parcel and run the full Fast Default report."

State plainly what Duke tried, distinguishing: (a) LandPortal zero-candidate / address-format mismatch, (b) county/GIS exact-address recovery failed or unavailable, (c) Local Area Context, Not Parcel Verified, (d) the one next action. State that no score, valuation, or offer was produced because parcel identity was not verified. Emit the `landos-persist` block with `status: "success"`, `reportStatus: "partial"`, `verificationStatus: "not_verified"`, and `parcel.verified: false`.

**Lookup Timeout Recovery Ladder** (when an LP lookup times out):

A timeout is a first-class unverified state, not a parcel mismatch. Keep every parcel identity rule in force: do not score, do not value, do not recommend an offer, and never use coordinates, geocoding, nearest parcel lookup, map pins, road midpoints, town/ZIP centroids, map bounds, or proximity search.

1. **Retry once.** Re-run the same exact-address `lp_resolve_property` lookup one time only, and only if still within the runtime budget. Never retry more than once.
2. **County assessor / GIS exact-address fallback.** If the retry also times out, run the bounded exact-address disambiguation pass from `duke-unconfirmed-parcel.md` (exact address + county/state against county assessor or county GIS, only if reachable through the normal allowed path). Exact-address verification only -- never coordinates or proximity.
3. **Local Area Context, Not Parcel Verified.** If still not definitively verified, return `Local Area Context, Not Parcel Verified` using only the location anchor from Tyler's input. Do not identify or infer a parcel from area context.
4. **One next action.** End with exactly one next action: "Send the APN + county, or owner name + county, and I will verify the parcel and run the full Fast Default report."

State plainly what Duke tried and that no score, valuation, or offer was produced because parcel identity was not verified. Emit the `landos-persist` block with `status: "timeout"`, `reportStatus: "partial"`, `verificationStatus: "not_verified"`, and `parcel.verified: false`.

**Address Mismatch and Rejection Rules** (when `lp_resolve_property` returns `not_verified` or `multiple_candidates`):

1. Label clearly: Address mismatch -- parcel not verified.
2. If the returned situs address is on a different road from the submitted address: reject immediately. Do not present as a candidate. Do not score.
3. Present only candidates where the road name matches the submitted address.
4. If no candidates match the submitted road: return Local Area Context, Not Parcel Verified.
5. Do not score, value, offer on, summarize ownership, or provide offer guidance on any unverified parcel.
6. Ask Tyler one clean confirmation question at the end. Stop.

---

## Owner Name Note

Owner name mismatch between lead and LP/assessor record is not an automatic parcel identity failure.

A parcel may be verified by address, APN, county GIS, or official record even if the lead name differs from the owner of record. Continue the report when the parcel itself is verified. Do not stop or suppress scoring based on a name mismatch alone.

If verified parcel but lead name differs from owner of record: flag as "Owner/Lead Mismatch, Possible Inherited or Probate Situation." Add to anomaly flags and data gaps. Continue scoring.

**ownerNameNote -- one short line in the report:**
- Full names match: "Lead name matches record owner."
- Last names match, first names differ: "Last name matches record owner. Confirm seller authority during discovery/title."
- Names do not match: "Lead name does not match record owner. Confirm seller relationship/authority during discovery/title."
- Record owner available from LP or official data, but no leadName or sellerName provided: "Record owner available from [source]. Seller authority not evaluated." Do not claim a match or mismatch when no lead/seller name was provided.
- Record owner not available: "Record owner not evaluated."

Zero extra tool calls for name comparison. Never chase ownership records unless Tyler explicitly asks.

---

## Step 4: Pull Parcel Data

When `lp_resolve_property` returned `verified:true`: use `property_summary` directly. Do not call `lp_property_data` again.

Extract these fields:

- Ownership (ownername1full)
- Tax history (annual taxes, assessed value)
- Size (acres)
- Road frontage and access
- Wetlands percentage
- FEMA flood percentage
- Zoning / use code
- Last sale (date, price)
- Mortgage
- Buildable percentage
- Slope
- Landlocked status
- LP similars (similars_count, similars_ppa_min, similars_ppa_max, similars_ppa_median, similars_most_recent_year)
- LP estimates (total_our_estimation_values_base, price_acre_county)
- building_area_sqft

If a field is not returned: mark as Unknown and add to Data Gaps. Do not silently fill defaults.

---

## Step 4b: Detect Improvements

Check for improvement evidence:
- LP `building_area_sqft` non-zero: structure present
- LP land use or use code is residential, improved, or non-vacant: possible structure or improvement
- Assessor improvement value significantly above land value
- User-provided photo or screenshot showing structure

If improvement evidence found: raise "Improved Property / Structure Present" anomaly flag immediately.

**Classify improvement status -- exactly one:**
- vacant land
- mobile/manufactured home present
- stick-built/brick/single-family house present
- cabin or other major structure present
- structure present but type needs verification
- unknown improvement status

**LP building sqft = 0 is not full vacancy confirmation:** When the only evidence of vacancy is LP `building_area_sqft` = 0 (or near-zero LP improvement value) and no county record, official assessor data, listing evidence, or Tyler-provided confirmation exists, do not state "Vacant land" as a fully verified fact. Use:

"Likely vacant per LandPortal (building sqft = 0). Confirm with county record or visual before treating as fully verified vacant land."

If LP land use code is labeled "Assumed": always add "Needs verification" to the improvement status line.

Reserve fully verified "vacant land" classification for parcels where at least one of the following confirms no improvements: county assessor record, official improvement value = $0 with no structure evidence, reliable listing/photo evidence reviewed and documented, or Tyler-provided confirmation.

**If stick-built house or major non-mobile structure present:** state clearly:
- Improvement Status: structure present
- Lead Type: improved residential property, not pure vacant land
- Buy Box Fit: outside Tyler's current primary vacant-land buy box unless Tyler explicitly requests improved-property analysis

**If mobile/manufactured home present:** state clearly:
- Improvement Status: mobile/manufactured home present
- Lead Type: land with mobile/manufactured home, not pure vacant land

A Zillow/Redfin/listing category of "SingleFamily" alone is a weak signal. Say "structure present, type needs verification" unless official records confirm structure type.

**Visual Signal: unavailable.** Include this line when no screenshot, photo, or satellite image has been reviewed. Do not imply visual condition without a visual source. Visual evidence capture is available on Tyler's explicit request only, after parcel verification.

Do not score as vacant land if improvement evidence is present. Do not use vacant land comps alone if a structure exists.

**Buildability when structure is present:** If LP returns 0% buildability alongside improvement evidence and residential/improved use code, the primary explanation is: existing structure occupies available buildable area on this lot. Do not treat 0% buildability as a mystery when a structure is present. State the primary explanation, note secondary possibilities (water buffer, impervious surface cap) for county verification, and label: Needs County Verification.

**Mobile/manufactured home year (if available from LP, assessor, or official record -- never from visuals):**
- Pre-1976: likely not FHA-friendly
- 1976-1984: practical financing caution
- Older than 1985 (any pre-1985 year, including the above): financing caution -- "Manufactured Home Financing Signal: Year appears older than Tyler's 1985 practical financing screen. Resale financing may be difficult. Confirm year, HUD tag, foundation, and lender requirements."
- 1985 or newer: possible financeable land-home path, subject to HUD tag, foundation, title, condition, lender, and local rules
- Year unknown: "Manufactured Home Financing Signal: Year unknown. Confirm before relying on land-home financing exit."

---

## Step 5: Score the Parcel

Apply the six-factor rubric. Always complete the full rubric even when one problem is found.

**Rule: flag loudly, deduct heavily, continue scoring.**

| Factor | Max Points |
|---|---:|
| Valuation Confidence | 25 |
| Access | 20 |
| Wetlands | 15 |
| FEMA | 15 |
| Size / Usability | 15 |
| Slope / Buildability | 10 |

Total capped at 100. No scoring bonus may push Land Score above 100.

**Factor guidance:**

- **Valuation Confidence (25):** Based on comp quality, quantity, distance, and valuation transparency. Weak or unusable comps = severe deduction. No LP valuation = maximum deduction, flag loudly, continue.
- **Access (20):** Road frontage, legal access indicators, landlocked status. Landlocked or zero road frontage = maximum deduction. Flag it, add to county call checklist, continue scoring -- there may be an easement.
- **Wetlands (15):** Percentage in wetlands. 75%+ = 0 points in this factor. Continue all other factors.
- **FEMA (15):** Percentage in flood zone. 75%+ = 0 points in this factor. Continue all other factors.
- **Size / Usability (15):** Acreage, shape, usable area. Under 1 acre = deduct points. If raw land comp value >= $40,000, continue evaluating. If under $40,000, score low but still complete the full rubric.
- **Slope / Buildability (10):** Terrain, slope, buildable area. In Appalachia, Ozarks, or similar mountain terrain: slope thresholds may shift up 10%. Flag when this modifier is active. Do not use it unless market context supports it.

**Verdict Tiers:**
- 75-100 = PURSUE
- 50-74 = PURSUE WITH CAUTION
- 0-49 = PASS

**Tier-Downgrade Override:** If 2 or more factors land in the lowest tier, drop verdict by one level regardless of total score.

**Hard Override -- Landlocked + Zero Buildability:** When BOTH of the following conditions are present simultaneously:
- Landlocked = true OR road frontage = 0 ft (Access score = 0)
- Buildability = 0% OR buildable area not confirmed from any source accessed

Replace the standard verdict tier with:

  PASS / LEGAL ACCESS NOT VERIFIED

This override takes priority over the Tier-Downgrade Override and all standard verdict tiers. Add this note directly below the verdict:

> No confirmed road access and no confirmed buildable area. Standard scoring produces PASS regardless of other factors. No verdict upgrade is possible until legal access is verified through county land records, easement documentation, or official survey. Mechanical offer range is shown below as a non-actionable reference only. Required first step: county land records and easement/right-of-way verification before any offer or acquisition decision.

Never reverse a verdict because of pushback. Walk through the rubric instead.

---

## Step 6: Calculate Expected Value (Partial Report)

Partial Report formula (no comp credit used):

- 60% LP platform estimate (total_our_estimation_values_base)
- 40% county/ZIP average (price_acre_county)
- Label: PRELIMINARY VALUATION -- comp report not run

If LP platform estimate is missing:
- 100% county/ZIP average
- Label: PRELIMINARY VALUATION -- LP estimate not returned. Confidence severely reduced.

If neither is available:
- Label: VALUATION UNKNOWN -- insufficient data from LandPortal. Comp report or supplemental sources required.

If values are per-acre: multiply by subject acreage.

EV range: EV-low = EV x 0.95 / EV-high = EV x 1.05

Show each available valuation input separately before blending.

---

## Step 7: Offer Strategy Snapshot

For the Fast Default Report: maximum 3 strategies with name, viability, and offer range in dollars. No prose.

**Key formulas (condensed):**

**FLIP (default):** 40-60% of EV. Applied when no special conditions push to a different strategy.

**FLIP CAUTIOUS:** 30-50% of EV. Apply when verdict = PURSUE WITH CAUTION.

**FLIP FAST MARKET:** 45-55% of EV. Apply only when 5+ comps available and average DOM < 150 days. If DOM unavailable: do not assume fast-market status.

**SUBDIVIDE:** 55-65% of EV. Apply only when: size >= 5 acres, buildable >= 50%, wetlands < 30%, FEMA < 30%, not landlocked, verdict = PURSUE. Frontage requirements are county-specific -- flag subdivision potential as "county-rule dependent" unless county rules confirm minimum frontage. If any condition is missing or uncertain: list as "Possible -- needs county verification" not as primary strategy.

**DOUBLE CLOSE (secondary / IF SELLER RESISTS):** EV-low minus $10,000 minimum profit. Auto-suppress if the double-close ceiling is not at least 5% above the primary strategy's high offer.

**LAND-HOME PACKAGE:** Label as "Needs verification" unless area data already returned manufactured/mobile home resale comps in the $200k+ range. If qualifying: formula = projected land-home resale minus manufactured home cost, utility tie-ins, permits/site work, holding/closing/selling costs, minimum $10k profit. Label numeric output "Unavailable -- missing inputs" if key figures are not available.

**Profit-Rule Note (required when margin is tight):** Always show the mechanical/preliminary offer range first. Never hide it, replace it with only a lower number, or suppress it because it is tight.

If the offer range or its upper end may not protect Tyler's $10,000 minimum net profit target after acquisition, closing, title, holding, resale, cleanup, and risk costs, add this note immediately below the range:

Offer range: $X to $Y.

Profit-rule note:
This is the mechanical/preliminary range based on EV. However, at this EV, the upper part of the range, or the entire range if applicable, may not protect Tyler's $10,000 minimum net profit target after closing, holding, title, resale, cleanup, and risk costs. Treat the top end as aggressive unless EV is verified higher, the parcel/use status is confirmed, and resale friction is low.

**Sub-1-acre and low-EV discipline:** The profit-rule note above applies especially to sub-1-acre infill lots or any low-EV parcel. Always include both the mechanical offer range and the $10,000 net-profit warning.

Apply the same logic to the Strategy Snapshot offer range. The strategy table keeps the range, but add the profit-rule note below the table or inside Preliminary Offer Guidance when the math is tight.

Label all offer guidance: PRELIMINARY -- comp report not run.

**Access Override (apply when the Hard Override from Step 5 is active):** Do not present any strategy or offer range as actionable. For each strategy in the snapshot, replace the viability rating with: NOT VIABLE -- legal access not verified. Prepend all offer range output with:

  PRELIMINARY -- DO NOT USE FOR OFFER UNTIL LEGAL ACCESS IS VERIFIED

Standard flip is not viable until legal access is confirmed. The first item under Most Viable Strategy and Preliminary Offer Guidance must be:

  Recommended action: county land records search and easement/right-of-way verification before any offer. No acquisition decision until access is confirmed.

Show dollar amounts, not just percentages.

---

## Step 8: Check for Anomalies

Anomaly flags are surfaced loudly in the report, even when the parcel still receives a score.

| Flag | Trigger |
|---|---|
| Improved Property / Structure Present | LP, assessor, county, MLS, or visual evidence indicates structure |
| Tax anomaly | Annual tax > assessed value. Possible delinquency or data error. |
| Sparse/distant comps | Fewer than 3 local comps, or nearest comp > 15 miles |
| Back taxes | Tax delinquency detected. Factor into acquisition cost. |
| Recent sale | Sold within last 12 months. Investigate why seller is selling again. |
| Boundary irregularity | Unusual shape, narrow lot, possible encroachment |
| No LP valuation | LP returned no valuation estimate. Confidence severely reduced. |
| Owner/Lead Mismatch | Lead name differs from owner of record |
| Visual Signal -- Structure | User-provided image or screenshot shows possible structure |

**Escalation -- surface for human/professional review when detected. Do not resolve:**
- Probate signals
- Federal or IRS liens
- Section 404 environmental issues
- Boundary disputes
- Conservation easement indicators
- Access/easement uncertainty
- Title irregularity beyond standard mortgage
- Any contradiction between LP data and official data

---

## Step 9: Label Facts

Every material data point carries one label:

| Label | Meaning |
|---|---|
| Verified | Confirmed by a named source Duke accessed and recorded |
| Seller-stated | Provided by the seller. Not independently confirmed. (In report prose: Seller-stated. In landos-persist facts array: "Seller stated" with a space.) |
| Assumed | Duke inferred this. Basis always stated. |
| Unknown | Data not available from any source accessed. |
| Needs verification | Data exists but reliability or legal significance is uncertain. Add to county call checklist. |

LP data: label "Verified from LandPortal" when retrieved directly from the API. LP data is not final legal, title, zoning, or county verification. Flag official verification for high-consequence items.

---

## Fast Default Report Format

Deliver this format for every dashboard default run on an address-only, APN-only, or owner-plus-location input.

Sections in order:

1. **Verification status:** 1 line. Verified / Not Verified / Coverage Gap + source.
2. **Key parcel facts:** Address, APN, acres, land use, road frontage, wetlands %, FEMA %, buildable %, last sale. LP data only. 5-8 lines maximum.
3. **Improvement status:** 1 line. Classification + confidence label.
4. **Land Score:** Score + verdict. One line per factor: factor name, score/max, brief reason. Total + verdict.
5. **Major anomaly flags:** 1 line per flag. Maximum 5.
6. **Green flags:** 1 line per flag. Maximum 3.
7. **Data gaps:** 1 line per item. Maximum 5.
8. **Strategy snapshot:** Maximum 3 strategies. For each: name, viability, offer range in dollars. No prose. If the profit-rule condition applies (see Step 7), add the profit-rule note below the strategy table.
9. **Most viable strategy:** 2-3 sentences. Why it leads. What to verify first.
10. **Preliminary offer guidance:** 1 short paragraph. Include only if parcel is verified and LP valuation data exists. Skip if not. Show the mechanical offer range first. If the profit-rule condition applies (Step 7), add the profit-rule note immediately below the range — do not hide or replace the range. If the Hard Override (Step 5 landlocked + zero buildability) is active: prepend the paragraph with "PRELIMINARY -- DO NOT USE FOR OFFER UNTIL LEGAL ACCESS IS VERIFIED." All dollar figures are non-actionable references only.
11. **Credit usage:** 1 line. (e.g., "0 comp credits used.")
12. **Deferred:** 1 line listing what is available on request: Full Exit Strategy Matrix, county call checklist, Ace discovery handoff, web comps, area stats, comp report. When listing the comp report, always phrase it as: "comp report (available only with Tyler's explicit approval to use 1 LandPortal comp credit)." Never phrase the comp report as casually available or omit the approval requirement.
13. **landos-persist block:** Always required as the very last item.

Do NOT include in Fast Default Report:
- Full Exit Strategy Matrix
- County call checklist
- Ace discovery handoff / DD handoff
- Comp source summary section (note comp quality in 1 sentence inside offer guidance only)
- Area statistics or web research
- Obsidian markdown write
- PDF generation
- Download PDF link

Close after the landos-persist block with:

> Want the full report with county checklist, Ace handoff, and area stats? Just ask.

---

## Comp Quality Reference

When LP similars data is available:

| Tier | Criteria | Action |
|---|---|---|
| Strong | 4+ sold comps, all within 18 months, spread < 2x min/max | Normal confidence |
| Workable | 2-3 comps, or 4+ with one outside ideal criteria | Flag limitation, adjusted confidence |
| Weak | Fewer than 2 sold, or stale (>24 months), or spread too wide | Range only, not point estimate. Label Weak. |
| Unusable | No comp data available | No valuation estimate. State comp data unavailable. |

If similars_most_recent_year is older than 24 months: treat as Thin-market context only. Evaluate all criteria before assigning tier -- do not automatically assign Weak based on age alone.

Active listings: market context only. Never sold comp proof.

---

## landos-persist Schema

Every Fast Default Report ends with exactly one `landos-persist` fenced JSON block as the very last item. One block per response. Strict JSON -- double quotes, no comments, no trailing commas. An invalid block is dropped by the runtime but the report still stands.

```landos-persist
{
  "entity": "LAND_ALLY",
  "agentId": "duke-due-diligence",
  "status": "success",
  "reportStatus": "delivered",
  "summary": "<one line: address -- Land Score X/100, verdict>",
  "verificationStatus": "verified",
  "lpPropertyUrl": null,
  "sourceUrls": [],
  "leadName": null,
  "sellerName": null,
  "recordOwnerName": null,
  "recordOwnerSource": null,
  "ownerNameNote": "Record owner available from LandPortal. Seller authority not evaluated.",
  "error": null,
  "additionalRiskScreens": [],
  "improvementStatus": "vacant_land",
  "improvementTypeConfidence": "unknown",
  "visualImprovementSignal": null,
  "visualConditionSignal": "unknown_or_not_available",
  "yardDebrisSignal": "unknown_or_not_available",
  "occupancySignal": null,
  "manufacturedHomeYearBuilt": null,
  "manufacturedHomeFinancingSignal": "not_applicable",
  "parcel": {
    "address": "",
    "city": "",
    "county": "",
    "state": "",
    "apn": null,
    "lpPropertyId": null,
    "fips": null,
    "acres": null,
    "verified": false,
    "verificationSource": ""
  },
  "facts": [
    { "fact": "acreage", "value": "", "label": "Verified", "source": "lp_property_data" }
  ],
  "fileRefs": []
}
```

**Field rules:**

- entity: LAND_ALLY unless Tyler specified TY_LAND_BIZ.
- status: success / failed / timeout. reportStatus: delivered / partial / failed / not_generated.
- verificationSource: must name the authoritative lookup (e.g. "lp_property_data record match (APN + FIPS)", "lp_resolve_property address filter, verified:true"). Never mention coordinates, geocoding, map pins, satellite, aerial, or street view. The runtime refuses the payload if these words appear in verificationSource.
- parcel.verified: true only when identity verified through allowed sources. Never from coordinates, proximity, or visual inference.
- facts: label values are "Verified", "Seller stated" (space, not hyphen), "Assumed", "Unknown", "Needs verification". Name source on every Verified fact.
- improvementStatus values: vacant_land / mobile_or_manufactured_home_present / stick_built_or_single_family_home_present / cabin_or_other_structure_present / major_improvement_present / structure_present_type_needs_verification / unknown
- improvementTypeConfidence values: verified_official_record / seller_stated / listing_signal_needs_verification / visual_signal_needs_verification / unknown
- visualConditionSignal values: clean_livable_signal / dated_repair_needed_signal / rough_poor_condition_signal / possible_removal_candidate_signal / unknown_or_not_available
- manufacturedHomeFinancingSignal values: likely_not_fha_friendly_pre_1976 / practical_financing_caution_1976_to_1984 / practical_financing_caution_older_than_1985 / possible_financeable_land_home_path_1985_or_newer / year_unknown_needs_verification / not_applicable
- **Mirroring required:** ownerNameNote also as a facts entry (fact: "owner_name_note"). leadName/sellerName/recordOwnerName when present also as facts entries. lpPropertyUrl also as a fileRefs entry (kind: "lp_property_url").
- **fileRefs field names:** Use `kind`, `pathOrRef`, `note`. Never use `value`. Example: `{ "kind": "lp_property_url", "pathOrRef": null, "note": "lpPropertyId + FIPS recorded. Exact URL not exposed by current wrapper." }`
- On failure or unverified parcel: still emit block with what is safely known (status, reportStatus, error, location anchors, verified false).

**LandPortal property URL:** Include in the report and in landos-persist when the exact URL is available. Never invent or construct a LandPortal URL from propertyid/FIPS patterns -- the current wrapper does not return a property URL in its output. If lpPropertyId + FIPS are known but no exact URL exists: set lpPropertyUrl null and add to Data Gaps: "Exact LandPortal property URL not exposed by current wrapper. lpPropertyId + FIPS recorded."

---

## LandPortal Tools Reference

```
lp_resolve_property  -- primary parcel identification. Use this first.
lp_search            -- search by parcelnumb or owner. Used internally by lp_resolve_property.
lp_property_data     -- retrieve detailed property data. Requires propertyid + fips only.
lp_comp_report_create -- NEVER call without Tyler's explicit comp credit approval.
lp_comp_report_get   -- NEVER call without Tyler's explicit comp credit approval.
```

`lp_resolve_property` returns:
- verified (true/false)
- status: "verified" | "multiple_candidates" | "not_verified" | "ambiguous_fips"
- propertyid, fips, apn, situs_address, city, state, owner
- match_notes
- candidates (for multiple_candidates)
- property_summary (full property fields when verified)

When `verified:true`: use property_summary directly. Do not call `lp_property_data` again.

`lp_property_data` returns lat and lng in its output for reference context only. These must never be used as lookup inputs for parcel identification.
