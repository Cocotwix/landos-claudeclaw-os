# Property Intelligence SOP

## 1. Purpose

This SOP defines the permanent, system-wide Property Intelligence standard for LandOS. It controls what every new lead must research, which providers and public-source attempts are required, how agents run research in parallel, how conflicting facts are preserved, what evidence is required, what completion states mean, how results are stored and displayed, how learned platform workflows become reusable LandOS capability, and how the system reaches a useful first result quickly while deeper work continues.

## 2. Scope

This SOP applies to every property research workflow in LandOS, regardless of whether the work is performed by APIs, deterministic adapters, Kilo, Codex, Claude Code, Browser Use, Hermes, or another future agent. No individual agent may independently redefine what "complete research" means.

## 3. Parcel Identity Gate

Property intelligence cannot run merely because an address geocoded. The parcel identity gate must evaluate to `confirmed` before any downstream research begins.

**Required identity evidence (at least one):**
- APN / parcel ID plus county, state, or FIPS
- LandPortal property ID plus FIPS
- Official assessor or GIS parcel record with matching APN

**Identity states:**
- `confirmed` — strong identity evidence verified
- `provisional` — candidate match pending official verification
- `conflicted` — credible disagreement between sources
- `unresolved` — no match found

**Hard stop:** If requested APN and resolved APN differ (after normalization), no downstream property intelligence may run.

## 4. Research Stages

After parcel identity is confirmed, the following stages run. Required stages must complete; conditional stages run when triggered; optional stages run when resources permit.

| Stage | Role | Timeout |
|-------|------|---------|
| Parcel identity | Required | 120s |
| Deed and ownership | Required | 120s |
| Official GIS | Required | 45s |
| Assessor and tax | Required | 45s |
| County records | Required | 120s |
| Wetlands | Required | 45s |
| FEMA flood | Required | 45s |
| Slope and topography | Required | 90s |
| Soils and septic | Required | 45s |
| Road frontage and access | Required | 30s |
| Utilities | Required | 30s |
| Zoning and land use | Required | 45s |
| Aerial imagery | Required | 30s |
| Marketplace comps | Conditional | 180s |
| LandPortal | Optional | 120s |
| Valuation synthesis | Required | 60s |

## 5. Parallel Execution

After parcel identity is confirmed, dispatch independent research branches concurrently. Provider failure, timeout, optional authentication, or CAPTCHA never cancels another task. The stable result makes incomplete research visible.

**Target operating levels:**
- Usable Deal Card: under 2 minutes
- Normal first-pass package: under 5 minutes
- Ordinary hard ceiling: under 10 minutes

A slow deed, recorder, GIS, planning, or county portal must not block the rest of the Deal Card. It should continue independently or return a precise Partial or Blocked status.

## 6. Evidence Provenance

Every fact and evidence item must retain:
- Actual source or provider
- Exact originating URL
- Retrieval timestamp
- Evidence type
- Screenshot, document, page image, or structured response
- Page number where applicable
- Confidence
- Directly stated fact versus visual observation or inference
- Associated property field or Deal Card section
- Blocker when unavailable

A fact must link to the record that actually produced it.

## 7. Conflict Handling

Preserve credible disagreements separately, including:
- Seller-reported address vs official situs address
- Assessor acreage vs official GIS acreage vs LandPortal mapped acreage vs deeded acreage
- Deeded owner vs assessor owner
- Parcel ID variants
- Legal description differences

Display the source for every value. When acreage sources disagree but remain within the same practical comp band, a consolidated comp search may be used while showing each acreage. When credible acreage values cross comp bands, search both applicable acreage scopes and identify the acreage basis used for each result and valuation scenario. Do not silently select one acreage as the only answer.

## 8. Deed and Ownership Standard

"Deed retrieval" means:
1. Locate the current recorded instrument.
2. Retrieve the complete instrument when publicly accessible.
3. Save or attach the original PDF or complete page images when permitted.
4. Capture readable visual evidence of all pages and the official source context.
5. Read the complete instrument.
6. Extract material title and ownership findings.
7. Cite the exact page supporting each finding.
8. Identify and queue referenced instruments that still need retrieval.
9. Reconcile the deed against assessor, GIS, LandPortal, and seller information.

Extract when present:
- Instrument type
- Grantor
- Grantee
- Vesting
- Ownership percentages
- Recording date
- Instrument number
- Book and page
- Legal description
- Life estate language
- Survivorship language
- Trust, entity, heir, or fractional ownership
- Easements
- Rights of way
- Access provisions
- Restrictions
- Covenants
- Reservations
- Exceptions
- Mineral rights
- Timber rights
- Water rights
- Utility rights
- Referenced plats
- Prior deeds
- Agreements, declarations, and other referenced instruments

**Required statuses:**
- Deed retrieved and fully reviewed
- Deed retrieved but partially unreadable
- Deed reference found, document not retrieved
- Referenced instrument still required
- Recorder blocked
- No recorder result located

A book and page reference is not a retrieved deed. Do not state that no easement, restriction, reservation, or exception exists unless the complete readable instrument was reviewed.

## 9. Official GIS, Road Frontage, and Access

Retrieve and preserve:
- Official GIS parcel match
- Parcel polygon
- GIS acreage
- Road relationship
- Road name
- Road surface observation
- Measured or estimated frontage
- Existing driveway or entrance
- Neighboring parcel relationships
- Possible intervening parcels
- Recorded access evidence
- Landlocked or unresolved access status

Keep these findings separate:
- Parcel appears near a road
- Parcel physically touches a road
- Visible access exists
- Recorded legal access exists
- Usable legal access is confirmed

Do not prove legal access solely from aerial imagery, GIS, or LandPortal. Official GIS evidence must remain separate from LandPortal mapping.

## 10. LandPortal Specialist Workflow

Create or strengthen a dedicated LandPortal workflow or adapter that knows the approved LandPortal research process.

It must retrieve:
- Owner and parcel information
- Property characteristics
- Property prompts or insights
- Acreage and mapped characteristics
- Road and parcel context
- Wetlands
- FEMA floodplain
- Contours and slope context
- Transmission lines
- LandPortal comparables
- Comp map evidence

**Overlay workflow:**
1. Open Base Maps and Overlays.
2. Turn on only the selected overlay.
3. Close the overlay panel using the top-right close control.
4. Wait for the map to render.
5. Inspect the subject parcel.
6. Capture a clean screenshot only when required.
7. Reopen the overlay panel.
8. Turn off the prior overlay.
9. Turn on the next overlay.
10. Repeat.

Do not capture screenshots with the overlay panel covering the parcel.

**Conditional screenshot rules:**
- Wetlands: research every parcel; capture only when wetlands affect the subject parcel.
- FEMA: research every parcel; capture only when a FEMA flood zone or floodway affects the subject parcel.
- Contours: calculate or retrieve slope for every parcel; capture when a material portion exceeds 12 percent slope.
- Transmission lines: capture when a corridor crosses or materially affects the parcel.

Store the no-impact result and provenance even when no screenshot is required.

## 11. Water, Sewer, Well, Septic, and Electricity

Research only utilities that materially affect acquisition, buildability, and resale. Do not research internet, cable television, or similar household services.

**Required distinctions:**
- On parcel
- At parcel frontage
- At road
- Nearby
- Provider-confirmed available
- Existing tap
- Existing meter
- Seller-reported
- Visually observed
- Unknown

"Nearby" must never be displayed as "available."

When public sewer is not confirmed, automatically trigger soil and septic analysis.

Provide a preliminary soil-based septic outlook:
- Likely favorable
- Potentially workable with limitations
- Significant limitations
- Uncertain
- Perc test required

Do not represent soil interpretation as a completed or passed perc test.

## 12. Environmental and Buildability

Retrieve and reconcile:
- Wetland coverage
- FEMA flood zone and floodway coverage
- Soils and septic limitations
- Average slope
- Material steep-slope area
- Contours
- Elevation
- Water features
- Drainage indicators
- Transmission-line impact
- Estimated buildable acreage
- Estimated buildable percentage

Preserve the method and source used for every calculation. Visual observations must remain labeled as observations.

## 13. Zoning and Development Constraints

Retrieve only decision-relevant rules:
- Current zoning
- Future land use
- Permitted uses
- Minimum lot size
- Density
- Required road frontage
- Setbacks
- Subdivision or minor-split process
- Manufactured-home rules when relevant
- Conditional or special-use requirements
- Overlay districts
- Moratoriums
- Material pending planning changes
- Major nearby developments that materially affect the property

Cite the exact official source and relevant ordinance or official record. Do not create an oversized municipal report containing unrelated regulations.

## 14. Multi-Source Comparable System

Run independent comparable searches in parallel using available sources:
- Home Harvest API
- Realie API
- Zillow browser workflow
- Redfin browser workflow
- Realtor browser workflow
- LandPortal specialist workflow
- County assessor or deed-transfer evidence when useful

One provider returning results must not stop the others.

Each provider must return one of:
- Results retrieved
- No qualifying results
- Blocked
- Timed out
- Unavailable
- Skipped with a documented reason

**Search expansion:**
- Immediate nearby area
- Relevant ZIP code
- Countywide

Record the geographic search level that produced each comp.

## 15. LandPortal Comparables

The LandPortal workflow must:
1. Open the subject parcel.
2. Read the property prompts or insights.
3. Read the comparable properties in the sidebar.
4. Extract structured comp records rather than treating the sidebar screenshot as the data.
5. Capture price, acreage, APN or parcel ID, and all displayed fields.
6. Click the green Show on Map link.
7. Extract addresses and additional details from the map page.
8. Add each property to the shared comp dataset.
9. Take one clean screenshot showing the subject and LandPortal comp pins.
10. Preserve the exact LandPortal URL.

The comp-map screenshot is supporting geographic evidence. It is not a substitute for structured comp records.

## 16. Normalized Comp Records

Store when available:
- Primary listing thumbnail
- Address
- APN or parcel ID
- Latitude and longitude
- Sold or active status
- Sale price or list price
- Acreage
- Price per acre
- Sale date
- Days on market
- Distance from subject
- Property type
- Improvements
- Road characteristics
- Utility characteristics
- Buildability characteristics
- Provider
- Exact source URL
- Retrieval timestamp
- Geographic search level
- Acreage basis used

## 17. Comp Reconciliation

A shared governing comp service must:
- Merge duplicate properties
- Preserve all provider evidence
- Reconcile conflicting prices, dates, and acreage
- Calculate distance
- Calculate price per acre
- Rank similarity
- Explain why recommended comps were selected
- Identify weak or rejected comps
- Separate sold comparables from active competition
- Produce valuation confidence and range

There is no mandatory minimum.

**Normal presentation target:**
- Three to six strongest sold comps when available
- Two or three relevant active listings
- Additional qualifying properties in an expanded view

Active listings must remain separate from sold-comp valuation calculations.

## 18. Interactive Comp Map Inside LandOS

Implement a functional interactive map in the Deal Card comps area. It must:
- Show the subject parcel polygon when available
- Use a distinct subject marker
- Show sold-comp pins
- Show active-listing pins separately
- Show a brief hover summary
- Show a larger click popup
- Include the primary listing thumbnail when available
- Link to the original source
- Synchronize comp-card selection with map-pin selection
- Synchronize map-pin selection with the comp list

Hover or popup details should include:
- Thumbnail
- Address
- Acreage
- Sold or list price
- Price per acre
- Distance
- Status
- Provider
- Original source link

Support useful filters such as:
- Sold
- Active
- Provider
- Distance
- Acreage range
- Recommended
- Rejected
- Geographic search level

Keep the normal ranked comp list alongside the map.

## 19. Investment Snapshot Data

Ensure the top-level Deal Card data model can provide:
- High-definition aerial image
- Subject parcel outline
- Seller name
- Deeded owner
- Parcel ID
- County and state
- Acreage from each credible source
- Property type
- Road frontage
- Physical access
- Legal access status
- Road surface
- Water status
- Sewer status
- Well status
- Septic status and preliminary outlook
- Wetland coverage
- FEMA coverage
- Average slope
- Material steep-slope area
- Estimated buildable acreage or percentage
- Zoning
- Preliminary value range
- Major risks
- Important discrepancies
- Research completeness

Do not redesign the full top-of-card UI yet. Make the data and statuses reliable and available for the later redesign.

## 20. System Learning

Every successful external-site workflow should be capable of becoming reusable LandOS knowledge through:
- Platform recognition
- Reusable adapter
- County or jurisdiction configuration
- Portal URLs
- Jurisdiction codes
- Parcel-number formatting
- Working selectors
- Extraction rules
- Evidence-capture rules
- Known limitations
- Failure history
- Successful recovery path
- Timing and success telemetry

**Expected execution path:**
1. Recognize platform
2. Load known adapter
3. Apply county configuration
4. Run deterministic workflow
5. Escalate to browser agent only when needed
6. Persist safe reusable improvements
7. Use those improvements on future leads

Agents discover workflows. LandOS keeps them.

Do not store credentials, cookies, tokens, or private session data as learned configuration.

## 21. Completion States

**Complete:** All required outputs produced with sufficient evidence. Business question resolved.

**Partial:** Some evidence exists but the business question is unresolved. Example: road proximity without contact/legal access, county flood layer without panel/BFE.

**Blocked:** Provider access blocked by payment, login, CAPTCHA, or similar limitation. Exact blocker and deepest URL persisted.

**No Result:** Provider ran but returned no usable data.

**Not Applicable:** Stage does not apply to this parcel (e.g., no wetlands in desert).

**Not Attempted:** No provider ran this lane.

Every required worker must end with an explicit outcome. Nothing should remain silently blank.

## 22. Agent Contract Consumption

All agents must:
1. Load `src/landos/property-intelligence-contract.ts`
2. Read the `PROPERTY_INTELLIGENCE_CONTRACT` constant
3. Use `validateStageOutput()` to verify their output meets contract requirements
4. Report completion state using the contract's `CompletionState` enum
5. Never redefine what "complete research" means locally

The contract is the single source of truth for research standards across all agents.
