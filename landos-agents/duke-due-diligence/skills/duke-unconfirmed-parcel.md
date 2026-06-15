# Duke Skill: Unconfirmed Parcel

Load when:
- `lp_resolve_property` returns `multiple_candidates`, `not_verified`, or `ambiguous_fips`
- LP address filter search or `lp_search` returns no results
- An LP lookup times out (`status: lookup_timeout`, `timed_out: true`, or equivalent) and the Lookup Timeout Recovery Ladder has reached its county/GIS or area-context step
- Tyler has not yet confirmed which parcel to proceed with

**Timeout note:** When entered via a LandPortal timeout, the parcel is unverified due to a timeout, not a mismatch. Apply the same hard rules below (no score, no value, no offer, no coordinates/proximity). Use Step 2's bounded exact-address disambiguation (county assessor / GIS) and, if still unverified, the `Local Area Context, Not Parcel Verified` fallback in Step 4, then ask one confirmation question.

---

## Hard Rules While Parcel Is Unconfirmed

Do not proceed with parcel-specific analysis until Tyler confirms the correct parcel.

**Prohibited until parcel is confirmed:**
- Obsidian writes
- PDF generation or any report file creation
- County call checklist
- Discovery call prep / Ace handoff
- Land Score rubric (no scoring)
- Expected Value calculation (no valuation)
- Offer guidance
- Buildability, zoning, access, or any parcel-specific conclusion

---

## Maximum External Calls: 2

1. 1 LP call -- `lp_resolve_property` or `lp_property_data` (whichever is correct for the identifier provided).
2. 1 combined area statistics web search -- only if no current valid (unexpired) cached market intelligence note exists for the area. If a valid cached note exists: reuse it, skip this call.

File system reads (checking MI cache) and file system writes (saving new MI note) do not count toward this budget.

If the one area statistics search does not return enough data: mark missing categories as "unavailable in quick search." Do not retry.

---

## Step 1: Show Candidates

Present the candidate list. For each candidate: APN and owner. Maximum 5 candidates.

---

## Step 2: Bounded Exact-Disambiguation Pass

Before asking Tyler to select, run one bounded disambiguation pass using the exact identifiers already available.

**Allowed disambiguation methods:**
- Search exact APN plus county/state
- Search exact APN plus address
- Search exact address plus county/state
- County assessor or county GIS -- only if accessible through normal web search or current tool path
- LandPortal property ID plus FIPS already returned by `lp_resolve_property`
- Other reliable public parcel/property records that clearly tie the exact submitted address to a specific APN

**Not allowed:**
- Coordinates, geocoding, nearest parcel lookup, road midpoint, town centroid, ZIP centroid, close-enough inference of any kind
- Guessing based on APN suffix (e.g. .001) or owner family name similarity
- Deep GIS exploration, scraping county GIS, or broad county record searches
- Paid tools or comp credits

**Outcome:**
- Official records clearly tie exact address to one APN: proceed with that parcel. Explain the verification source.
- Official records clearly show exact address covers both APNs: proceed as multi-parcel lead. Explain.
- Records remain unclear: label "Local Area Context, Not Parcel Verified." Ask Tyler for seller confirmation (APN, acreage, tax bill, deed, or property ID).

Always include this line when multiple candidates remain unresolved after the disambiguation pass:

> "Multiple candidate parcels were found. Duke attempted exact APN/address disambiguation using official or reliable public parcel records. Parcel-specific underwriting remains suppressed unless the exact APN or multi-parcel identity is verified."

---

## Step 3: Compact First Answer Format

Use this compact format for unconfirmed parcel responses. No long prose. No oversized tables. No paragraph-form explanations.

Include only:
1. Status (e.g. Address mismatch, LP coverage gap, Multiple candidates, Not verified)
2. Candidate parcel(s) if any -- APN, size, land use, one key flag per candidate
3. Mismatch or gap reason in one line
4. Cache status (Fresh Area Statistics / Reused Area Statistics / No cache found)
5. Required next step

If area context is available: keep it brief. Add one line if more detail is available: "More detail available if you want it."

Speed beats polish. First usable answer under 120 seconds.

**Mandatory output rules:**
- Always deliver available output in chat. Saving a cache entry does not replace the chat response.
- If the parcel is not verified and a reliable location anchor exists: automatically include Local Area Context, Not Parcel Verified -- including area statistics, market context, county notes, and what is needed to verify the parcel. Do not wait for Tyler to ask for this.
- Missing entity: mark as TBD and continue. Never delay output for entity resolution.

---

## Step 4: Area Context (if a Reliable Location Anchor Exists)

If Tyler provided a reliable location anchor (city/state, county/state, road/city/state) and the parcel is not verified: include area context labeled "Local Area Context, Not Parcel Verified." This is the 2nd allowed call in the budget.

**Check MI cache first:**
```
C:\Users\tbutt\Documents\Obsidian Land OS -Land Acquisitions\04_Market_Intelligence\[State]\[County]\
```
File match: `MI_[County]_[State]_*.md` -- read the `expires` field.
- Valid (not expired): reuse cached data, skip the web search. Label: "Reused Area Statistics, pulled [date_pulled], expires [expires]."
- Expired or not found: run one combined web search (see duke-area-only.md Step 2 for query template). Save new MI note after composing the response.

**The "Local Area Context, Not Parcel Verified" section may include:**
- Local/area statistics and market context
- County/local notes
- General area red flags
- What is needed to verify the parcel

**Must NOT include in this section:**
- Parcel-specific ownership or land use
- Parcel score, underwriting, valuation, or offer guidance
- Exit strategy recommendation

---

## Step 5: Ask Tyler One Clean Confirmation Question

End with exactly one confirmation question. Stop.

Examples:
- "Can you provide the APN, county, or FIPS to continue?"
- "Can the seller confirm whether this is parcel A (APN 123) or parcel B (APN 456)?"
- "What county is this in?"

Do not stack multiple questions. Stop after one question.

---

## After Tyler Confirms the Correct Parcel

Once Tyler confirms the exact parcel identity (APN, FIPS, property ID, or seller confirmation selecting one candidate): switch to Fast Default mode.

`Read: C:/Users/tbutt/claudeclaw-os/landos-agents/duke-due-diligence/skills/duke-fast-default.md`

Proceed from Step 4 (Pull Parcel Data) using the confirmed identifier. Skip Steps 1-3 of that skill.

---

## landos-persist for Unverified State

Even for an unverified parcel response: emit the landos-persist block with what is safely known.

```landos-persist
{
  "entity": "LAND_ALLY",
  "agentId": "duke-due-diligence",
  "status": "success",
  "reportStatus": "partial",
  "summary": "<status description: e.g. multiple_candidates / address_mismatch / not_verified>",
  "verificationStatus": "not_verified",
  "error": null,
  "improvementStatus": "unknown",
  "improvementTypeConfidence": "unknown",
  "parcel": {
    "address": "<submitted address if known>",
    "city": "<if known>",
    "county": "<if known>",
    "state": "<if known>",
    "apn": null,
    "lpPropertyId": null,
    "fips": null,
    "acres": null,
    "verified": false,
    "verificationSource": ""
  },
  "facts": [],
  "fileRefs": []
}
```
