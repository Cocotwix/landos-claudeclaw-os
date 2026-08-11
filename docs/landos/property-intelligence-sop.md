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

When LandPortal says `Land Locked: Yes`, reports zero/absent frontage with that
flag, or shows a parcel set back from the road, that is a trigger for a visual
access investigation, not a final conclusion. Retain four independent evidence
types with provenance: the LandPortal parcel flag; an apparent physical drive or
route observed in satellite/Street View; legal/easement access reported by a
listing; and legal access verified from a read recorded instrument. Only the
last verifies legal access. The investigation inspects the map for driveways,
private routes, gates, tracks, and mapped access lines, then runs Street View
from a marker placed on the nearest public road.

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

**Operator Overview capture:** retain `landportal_overview` as a deliberately
framed `parcel_context` satellite view. Start from parcel Fit and use the shared
acreage-dependent context zoom. The complete subject boundary, nearest named
public road, apparent access route, and immediately surrounding parcels must all
remain readable. A default 3D image, county-scale map, clipped frame, unloaded
tiles, or obstructed map is never promoted as Overview.

**Map-click precision and misclick recovery:**
Every click on the LandPortal map can select a parcel; a click landing
outside the subject boundary selects a neighboring parcel. Interior clicks
(soil popups, overlay inspection) use points well inside the subject
boundary, away from boundary lines. After every map click, the worker
verifies the sidebar still shows the subject APN. If a different parcel
loaded, the worker recovers in the same tab by navigating back to the
retained canonical subject URL — never by opening another tab. One tab per
work unit is an absolute budget. A click target that misclicks twice is
skipped; three total recoveries end the popup-clicking workflow, and the
verified captures and facts collected so far are handed back honestly.

**G Maps base-map rule:**
Before any base-map, overlay, or Street View workflow, open the base-map
controls, select G Maps, and visually confirm G Maps is selected. Never
assume it is already selected. The green Show on Map link beside the sidebar
comparables opens a separate comparable page; it is never a base-map or
overlay control and this rule does not apply to it.

**Overlay workflow:**
1. Select and visually confirm the G Maps base map.
2. Open Base Maps and Overlays.
3. Turn on only the selected overlay.
4. Close the overlay panel using the top-right close control.
5. Wait for the overlay to visibly finish rendering on the subject parcel.
6. Inspect the subject parcel.
7. Capture a clean screenshot only when required.
8. Reopen the overlay panel.
9. Turn off the prior overlay.
10. Turn on the next overlay.
11. Repeat.

Do not capture screenshots with the overlay panel covering the parcel.

**Default 3D capture:**
Click the LandPortal 3D control and wait for the default 3D view to finish
rendering. The initial default framing is the approved capture; do not
rotate, tilt, zoom, or reposition the camera unless the default framing
fails to show the correct subject parcel meaningfully. Close obstructing
controls, confirm the subject parcel remains visible, capture the clean
default view, and persist it as the primary 3D evidence. A 2D aerial or
contour screenshot is never a substitute for the 3D capture.

**Soil overlay rendering:**
Enable the Soil Type overlay with G Maps selected and wait until the colored
soil polygons have rendered across the subject parcel — never rely only on a
short fixed delay. Confirm visible color differentiation inside the parcel
and that the correct subject parcel remains selected, close the
overlay-selection panel, then click representative areas inside the parcel
and read each soil popup until every distinct soil unit is identified,
deduplicating repeats. Preserve Map Unit Name, Drainage Class, Farmland
Classification, Capability Class (non-irrigated), and other displayed
material fields. Capture the screenshot only after the colored polygons are
visibly present; the clean screenshot must show the colored soil regions and
the subject boundary. A screenshot showing only base imagery without soil
colors is rejected.

**Buildability view:**
In the sidebar Slope Analysis section, click Show Buildability. Wait until
LandPortal highlights the buildable area in the yellow-toned overlay — never
capture immediately. Confirm the yellow overlay has fully rendered, the
correct subject parcel is still selected, the full parcel boundary is
visible, and the highlighted buildable area is clearly visible. Close or
collapse the sidebar and any obstructing popup, tooltip, menu, or
overlay-selection panel, then capture a clean screenshot persisted with the
category Buildability, plus the structured buildability percentage and
acreage when displayed. Slope, contour, aerial, or 3D evidence is never a
substitute for the dedicated buildability capture.

**Street View workflow:**
Confirm G Maps is selected and open Street View through the existing
LandPortal map workflow. The pegman is placed on the public road along the
subject frontage — on the blue Street View coverage line drawn on the road
itself — never on the parcel interior, a driveway, or open ground beside the
road; imagery exists only on the road. When no coverage line exists along
the frontage road, Street View is recorded as unavailable with the road
named. Confirm the opened scene corresponds to the correct subject frontage
or immediate subject context, with the subject boundary visible in red when
LandPortal provides that overlay. Capture an initial subject-facing
view, rotate through a full scan (left, right, across the road, toward the
parcel), move along the subject frontage with the navigation arrows where
practical, and inspect the visible property border rather than one static
view. Capture the most useful frontage and surrounding-context views. Record
Street View unavailability explicitly rather than silently skipping it.
Observations distinguish direct visual observation, reasonable
interpretation, and unconfirmed conclusion; a feature is never called a
railroad, public trail, private road, utility corridor, or legal access
route unless the evidence supports it. When Street View resolves an earlier
satellite interpretation, the stronger reconciled conclusion is preserved.

### 10A. Hermes bounded subject lookup

Every Hermes LandPortal task must load and follow this SOP and the installed
`driving-cdp-browser` skill. Hermes must attach only to the already
authenticated Chrome CDP endpoint at `http://127.0.0.1:9224`; it must not
launch another browser, use another CDP port, or inspect unrelated tabs.

The approved search sequence is exhaustive and must be followed in this exact
order:

1. Full address.
2. APN with state and county.
3. Owner name with state and county.

For each attempted query, clear or close any obstructing popup, choose the
correct LandPortal search type, and select the top returned suggestion. Verify
the candidate against the requested address, APN, owner, county, and acreage
when each value is available. Classify the outcome as exactly one of
`verified_exact_subject`, `context_only`, or `no_match` (or `failed` for an
execution failure). A nearby parcel, a different same-owner parcel, or an
unverified suggestion is never the verified subject.

For `verified_exact_subject`, extract the approved visible sidebar fields, the
exact subject parcel URL, LP Estimate total and per-acre values, and visible
comparable rows into the property-specific JSON handback.

The approved sidebar fields include, whenever LandPortal displays them: Water
Feature Type, Zoning Code, FEMA Flood Zone Description, Last Sale Price, Last
Sale Date, Book Number, Page Number, and Assessed Value, in addition to the
established identity, acreage, frontage, environmental, slope, buildability,
and estimate fields. Each captured sidebar value preserves the exact LandPortal
label and displayed value. The zoning code is stored verbatim (for example
`01 - NOT Z`) and never reinterpreted. The FEMA flood zone description is kept
complete. Monetary and date values are normalized only into fields LandOS
already normalizes, and the displayed source value is always preserved
alongside. LandPortal is recorded as the discovery-stage source; a stronger
official record retrieved later is never overwritten by these sidebar values. For `context_only`,
`no_match`, or `failed`, write an honest property-specific JSON handback with
no subject facts and no comps, then stop. Only verified-exact-subject JSON may
enter the existing Hermes importer; context-only and no-match results must not
populate subject facts.

Hermes must not invent another LandPortal workflow, create exploratory Python
or JavaScript helper scripts, cycle through alternate search strategies,
navigate Market Research, or continue after the three approved searches are
exhausted. The only permitted output file is the requested property-specific
JSON. Target completion is under three minutes and the hard execution ceiling
is five minutes for the subject and comps work units; the visuals work unit,
whose expanded capture set (default 3D, rendered soil overlay with popup
reads, buildability, multi-angle Street View) requires vision-verified
clean-capture checks, has a twenty-minute ceiling. At the ceiling, return
`no_match` or `failed` honestly instead of continuing to explore.

**Conditional screenshot rules:**
- Wetlands: research every parcel; capture only when wetlands affect the subject parcel.
- FEMA: research every parcel; capture only when a FEMA flood zone or floodway affects the subject parcel.
- Contours: calculate or retrieve slope for every parcel; capture when a material portion exceeds 12 percent slope.
- Transmission lines: capture when a corridor crosses or materially affects the parcel.

Store the no-impact result and provenance even when no screenshot is required.

### 10B. Market Research Source Rule

LandPortal is responsible for:

1. Subject property identity
2. Owner and parcel facts
3. Acreage values
4. Road frontage
5. Landlocked status
6. Water features
7. Building information when shown
8. Wetlands
9. FEMA
10. Soil
11. Terrain
12. Slope
13. Buildability
14. Required satellite, 3D, overlay, frontage, and context images
15. Sidebar comparables
16. The separate Show on Map comparable page
17. Comparable details, thumbnails, locations, and reconciliation

LandPortal must not be used as the primary source for:

1. County market metrics
2. ZIP market metrics
3. Acreage-band market metrics
4. Market Matrix
5. Market Pulse numeric metrics

The Hermes LandPortal workflow must not scrape LandPortal market panels for
county, ZIP, or acreage-band market data, and must not navigate LandPortal
Market Research surfaces.

After the subject property's county, state, ZIP, and acreage are established,
LandOS retrieves the matching market information from its existing Market
Research data (the same tables and services already used by the Market
Research section). Required retrieval:

1. Subject county record
2. Subject ZIP record
3. Subject property acreage band
4. County sold count
5. County active count
6. County median days on market
7. County sell-through rate
8. County absorption rate
9. County inventory or months of supply
10. County median price
11. County median price per acre
12. County population
13. County growth rate
14. ZIP sold count
15. ZIP active count
16. ZIP median days on market
17. ZIP sell-through rate
18. ZIP absorption rate
19. ZIP inventory or months of supply
20. ZIP median price
21. ZIP median price per acre
22. Subject acreage-band metrics
23. The county acreage band with the highest sell-through rate
24. The sold count, active count, median DOM, sell-through rate, absorption,
    median price, and median price per acre for that fastest-selling county
    acreage band
25. Relevant snapshot dates and source periods

Do not create or duplicate Market Research data for this purpose. When no
exact ZIP or acreage-band record exists, report it honestly as unavailable;
never silently substitute a different ZIP, county, or acreage band.

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

## 11A. Conditional LandPortal 3D Capture

LandPortal Front Side 3D and Rear Side 3D are conditional evidence stages. The
deterministic direct-action runner may open LandPortal for these stages only
when retained subject-parcel slope data proves either condition:

- average slope is greater than or equal to 10 percent; or
- the parcel area above 10 percent slope is strictly greater than 10 percent.

Average slope exactly equal to 10 percent qualifies. Area exactly equal to 10
percent does not qualify unless the average-slope condition qualifies. The
runner must calculate the decision from retained facts (including the 10–15
and 15%+ bands when available), emit the decision and metrics, and enforce the
90-second action budget. If both conditions are false, both 3D stages are
completed as `not_applicable`; they must not be reported as missing, failed, or
unavailable, must not open a browser page, and must not add a missing-imagery
warning. Missing slope data is an explicit `unknown`/not-attempted outcome and
requires data before a conditional capture can be scheduled. Existing 3D
evidence remains historical evidence and is never deleted when a later parcel
is not applicable.

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

LandPortal, Zillow, Redfin, and Realtor.com are separately accountable. An
unrun lane is shown as `not run`, never as zero results. A lane that ran and
found nothing, returned candidates that were filtered, failed, was blocked, or
was disabled by policy keeps that distinct status. LandPortal success never
stops the three supplement lanes from running or being explicitly accounted for.

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
7. Drill into every sidebar row through Show on Map or its comp-detail surface;
   extract the stated address/locality, acreage, coordinates or honest unresolved
   location, detail URL, and comparable image with its source.
8. Add each property to the shared comp dataset.
9. Take one clean screenshot showing the subject and LandPortal comp pins.
10. Preserve the exact LandPortal URL.

The comp-map screenshot is supporting geographic evidence. It is not a substitute for structured comp records.
The captured thumbnail is retained on the normalized comp. Distance is computed
only by the shared geographic router when both subject and comp coordinates
resolve; otherwise the operator sees `location unresolved` and no guessed value.

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

### 20A. Verified Subject-Parcel URL

When a verified subject parcel is open, capture the exact current LandPortal
parcel URL. A valid subject URL is HTTPS on LandPortal, contains a decodable
`property` token with parcel identity fields, and is not a homepage, search,
market-research/comp map, login, paid-report, temporary-popup, or other
generic surface. Persist one canonical record with URL, source, capture time,
property-card ID, Deal Card ID, verified-subject flag, and APN/FIPS/property ID
when available. A newer observation may replace it only when it resolves to the
same canonical parcel; a different parcel, malformed URL, blank value, or
generic surface is rejected. The record is property-card scoped and survives
future refreshes and restarts without creating duplicate gallery entries.

The operator read exposes a safe, clickable `Open subject in LandPortal` link
near parcel identity on Overview and in Documents & Visuals under LandPortal
details/source. It opens a new tab with `target="_blank"` and `rel="noreferrer"`;
raw URL tokens are never rendered as text. If no verified canonical URL exists,
the link is omitted.

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
