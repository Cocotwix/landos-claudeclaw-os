# Duke Skill: Area Only / Local Market Context

Load when: Tyler asks for county, city, or region context with no specific property. No address, APN, or parcel ID provided. Or when Tyler explicitly asks for area context on a location without requesting parcel due diligence.

---

## What Area Only Is and Is Not

Area Only provides local market context -- demand signals, activity, and growth indicators near a location. It is not:
- Parcel verification or identification
- Title research
- Zoning confirmation for a specific parcel
- Utility confirmation for a specific parcel
- Legal access confirmation

None of it substitutes for LandPortal property data, county records, or official parcel data on a specific parcel.

---

## Hard Rules for Area Only

- Do not call LandPortal.
- Do not attempt parcel verification.
- Do not ask for APN, FIPS, property ID, or owner unless Tyler later asks for parcel DD.
- Label all output: "Area Only Local Market Context"
- State clearly at the end: "No parcel was analyzed or verified."
- Do not present area-level price trends as establishing any specific parcel's value.

---

## Step 1: Check Market Intelligence Cache

Before running a web search, check for a saved market intelligence note at:

```
C:\Users\tbutt\Documents\Obsidian Land OS -Land Acquisitions\04_Market_Intelligence\[State]\[County]\
```

Look for a file matching: `MI_[County]_[State]_*.md`

If found: read the `expires` field.
- If today is before the expires date: reuse cached data, skip the web search. Label:
  > Reused Area Statistics, pulled [date_pulled], expires [expires].
- If expired or not found: proceed to Step 2.

**Cache match rules:**
- Primary match: County + State.
- Secondary match (if county unknown): City or ZIP + State.
- If the new area is materially different from the cached area (different county or region): treat as a different market and run fresh.

---

## Step 2: One Combined Web Search

Construct one targeted search query using this template:

> [road or city or ZIP or county] [state] vacant land for sale sold acres price per acre population growth Census

Run that one search. Whatever it returns is used. If a category is not covered by the results: label it "unavailable in quick search." Do not run additional searches. Do not retry.

---

## Step 3: Area Only Output Format

Label the output section: **Area Only Local Market Context**

Include when available from the one search:

- County and city population trend (from Census, city planning, or official government sources when available)
- Nearby vacant land listings on LandWatch, Lands of America, Zillow land, or Redfin land -- price per acre if shown
- Recent sold land activity when available from reliable public sources
- Average days on market for comparable land listings if available from listing platforms
- Nearby development or growth signals (new construction permits, infrastructure, utility expansion, zoning amendments) from official county or municipal records
- County economic or planning indicators from official sources
- Flood, wetlands, zoning, or utility context from official sources only (FEMA, NRCS, NWI, county GIS, state utility commission)

**Source requirement:** Cite every source used (say where each fact came from). Label third-party aggregators as such. Approved provider data (LandPortal, Realie, County GIS, FEMA, NWI, USGS, Census, Redfin, Zillow) is usable for pre-contract work; county/official confirmation is for post-contract legal-financial execution.

**Do NOT include in Area Only output:**
- Parcel-specific ownership or land use summary
- Parcel score, underwriting, valuation, or offer guidance
- Exit strategy recommendation
- Any parcel-specific conclusion

If no reliable data is found in the one search: state "No reliable local area data found" and move on. Do not extrapolate.

Close with:

> "No parcel was analyzed or verified. Provide an address, APN, or property ID for parcel due diligence."

---

## Step 4: Save Market Intelligence Note (if fresh search was run)

After composing the response -- not before -- write one market intelligence note. This is a background file write and does not delay the response.

**File name:** `MI_[County]_[State]_[YYYY-MM-DD].md`

**Folder:**
```
C:\Users\tbutt\Documents\Obsidian Land OS -Land Acquisitions\04_Market_Intelligence\[State]\[County]\
```

Create the folder path if it does not exist. Do not overwrite an unexpired note. Replace an expired note with fresh data.

**Note contents:**

```
---
market_area: [County], [State]
location_anchor: [county or city or ZIP]
date_pulled: [YYYY-MM-DD]
expires: [YYYY-MM-DD, 30 days from date_pulled]
---

# Market Intelligence: [County], [State]

Reusable Until: [expires date]

## Vacant Land Price Per Acre

## Acreage Bands
- 1-5 acres:
- 5-10 acres:
- 10-20 acres:
- 20-50 acres:
- 50+ acres:

## Market Activity

## Growth / Demand Trend

## Data Gaps
```

**Content rules:**
- Fill from the one search where data is available
- Do not use house sales as vacant land comps unless clearly labeled: "not a vacant land comp"
- Do not turn area-level price statistics into parcel-specific valuation
- Official sources (Census, county assessor, state GIS, USDA, FEMA) may be labeled: "Verified from [Source Name]"
- Non-official sources (listing sites, news articles, aggregators): label "Supplemental -- non-official source"
- If a category has no reliable data: note it in Data Gaps
