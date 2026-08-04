---
name: landos-landportal
description: Run one bounded LandOS LandPortal specialist lookup.
version: 1.1.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, landportal, property-intelligence, cdp]
    related_skills: [driving-cdp-browser]
---

# LandOS LandPortal specialist lookup

## When to use

Use this skill only for a property assignment issued by the LandOS Property
Intelligence orchestration path. The assignment supplies the current address,
available parcel identity, and an exact JSON output path.

## Authority and isolation

- LandOS remains the canonical system of record. Do not modify LandOS, a Deal
  Card, valuation, strategy, or operator workflow.
- Address is the primary job identifier. Internal card ids are routing guards.
- Use only facts verified for the current assignment. Never reuse facts from a
  prior session, another address, a nearby parcel, or a different same-owner
  parcel.
- Read from LandPortal only. Write exactly one assigned JSON output plus an
  explicitly requested visual artifact when the work unit is `visuals`.
- Never delegate or create another worker. LandOS owns the fixed sibling set.

## Browser contract

1. Load and follow `driving-cdp-browser`.
2. Attach only to the already authenticated Chrome CDP endpoint at
   `http://127.0.0.1:9224`.
3. Do not launch another browser, change ports, or inspect unrelated tabs.
   Create or use one tab owned by this work unit and close only that tab.
4. Clear or close an obstructing popup, select the correct LandPortal search
   type, and choose the top returned suggestion for each allowed query.
5. Do not create Python or JavaScript helper scripts and do not navigate Market
   Research. LandPortal is never the source for county, ZIP, or acreage-band
   market metrics, Market Matrix, or Market Pulse numbers: do not open or
   scrape any LandPortal market panel. LandOS joins market data from its own
   Market Research store after the subject identity and acreage are verified.
6. Only the `visuals` specialist may drive map framing or overlay controls.
   Subject and comp specialists stay on their own read-only parcel surfaces.

## Bounded search sequence

Search in this exact order and add no alternatives:

1. Full address.
2. APN with state and county, when APN is supplied.
3. Owner name with state and county, when owner is supplied.

Verify the selected candidate against every supplied or visible identity field:
address, APN, owner, county, and acreage. A nearby parcel, a different
same-owner parcel, or an unverified suggestion is never the subject. Stop as
soon as the exact subject is verified or the allowed sequence is exhausted.

Target completion is under three minutes. The LandOS controller enforces an
absolute five-minute ceiling for the subject and comps work units and a
twenty-minute ceiling for the visuals work unit. The visuals specialist
writes its JSON handback incrementally: as soon as a capture is verified,
update the handback file with the artifacts verified so far instead of
deferring every write to the end of the run. Do not explore beyond the
sequence to consume the remaining time, and write the assigned JSON as soon as
the category is verified rather than deferring it to the end of the run.

## Classification

Set `subject_verification_status` to exactly one of:

- `verified_exact_subject` only when exact identity is proved.
- `context_only` when useful surrounding context exists but the exact subject
  is not proved.
- `no_match` when the allowed searches are exhausted without a defensible
  subject.
- `failed` when execution cannot complete.

Only `verified_exact_subject` is importable. For every other status, include no
subject facts and no comps.

## Base-map, overlay, 3D, buildability, and Street View workflows (visuals)

Only the `visuals` specialist performs these. Every rule below is mandatory.

**Map-click precision and misclick recovery.** Every click on the map can
select a parcel, and a click that lands outside the subject boundary selects
a NEIGHBORING parcel. Before clicking inside the parcel (soil popups,
overlay inspection), pick points well inside the red subject boundary, far
from boundary lines and slivers. After EVERY map click, verify the sidebar
still shows the subject APN. If a different parcel loaded, recover in the
SAME tab: navigate this tab back to the exact canonical subject URL from the
assignment, wait for the subject parcel to load, and continue where you left
off. NEVER open another tab to recover — one tab per work unit is an
absolute budget, and opening a second tab is a failure. If recovering from a
misclick on the same target twice, skip that click target, keep what was
already verified, and move on. If misclick recovery is needed three times in
total, stop the popup-clicking workflow entirely, keep the verified captures
and facts collected so far, write the handback honestly, and continue with
the remaining non-clicking workflows.

**G Maps base-map rule.** Before any base-map, overlay, or Street View
workflow: open the base-map controls, select `G Maps`, and visually confirm
G Maps is the selected base map. Never assume it is already selected. The
green Show on Map link beside the sidebar comparables opens a separate
comparable page — it is never a base-map or overlay control and this rule
does not apply to it.

**Default 3D capture.** Click the LandPortal 3D control and wait for the
default 3D view to finish rendering. The initial default LandPortal 3D
framing is the approved capture: do not rotate, tilt, zoom, or reposition
the camera unless the default framing fails to show the correct subject
parcel meaningfully. Close obstructing controls, confirm the subject parcel
remains visible, capture the clean default view, and persist it with key
`default_3d` and requested_view `default_3d` as the primary 3D evidence.
Never substitute a 2D aerial or contour screenshot for it.

**Soil overlay rendering.** With G Maps selected, enable the Soil Type
overlay and wait until the colored soil polygons have rendered across the
subject parcel — never rely on a short fixed delay. Confirm visible color
differentiation exists inside the parcel and the correct subject parcel is
still selected, then close the overlay-selection panel. Click representative
areas inside the parcel following the map-click precision rule above —
interior points only, never near the boundary, verifying the subject APN
after each click — read each soil popup, and repeat until every distinct
soil unit is identified; deduplicate repeated units. Preserve Map
Unit Name, Drainage Class, Farmland Classification, Capability Class
(non-irrigated), and other displayed material fields. Capture the screenshot
only after the colored polygons are visibly present, showing the colored
soil regions and the subject boundary; a capture showing only base imagery
is unacceptable. Set `overlay_rendered: true` only when that is genuinely
observed — the importer rejects soil captures without it. Use key
`soil_overlay`.

**Buildability view.** In the sidebar, locate the section titled `Slope
Analysis` and click `Show Buildability` to its right. Wait until LandPortal
highlights the buildable area on the subject parcel in the yellow-toned
overlay — do not capture immediately. Confirm the yellow overlay has fully
rendered, the correct subject parcel is still selected, the full parcel
boundary is visible, and the highlighted buildable area is clearly visible.
Close or collapse the sidebar and any popup, tooltip, menu, or
overlay-selection panel, then capture a clean screenshot with key
`buildability`, requested_view `buildability`, label `Buildability`, and
`overlay_rendered: true`. Record the displayed buildability percentage and
acreage when shown (`buildability_pct`, `buildability_area_acres`). Never
substitute slope, contour, aerial, or 3D evidence for this capture.

**Street View.** Confirm G Maps is selected, then open Street View through
the existing LandPortal map workflow. Pegman placement rule: drag the pegman
onto the PUBLIC ROAD along the subject frontage — onto the blue Street View
coverage line drawn on the road itself — never onto the parcel interior,
a driveway, or open ground beside the road. Street View imagery exists only
on the road; a pegman dropped inside the parcel fails or lands somewhere
wrong. If no blue coverage line exists along the subject frontage road,
record `street_view_available: false` with a note naming the road checked.
Confirm the opened scene corresponds to the correct subject frontage or
immediate subject context, and that the subject boundary is visible in red
when LandPortal provides that overlay. Capture an initial subject-facing
view, then rotate through a full scan: left, right, across the road, and
toward the parcel. Use the navigation arrows to move
along the subject frontage where practical and inspect the visible property
border rather than one static view. Capture the most useful frontage and
surrounding-context views (keys `street_view`, `street_view_2`,
`street_view_3`). Record `street_view_available` true or false with a
`street_view_note`; unavailability is recorded, never silently skipped.

Describe visible observations in `street_view_observations`, each with
`label`, `detail`, and `basis` (`direct_observation`,
`reasonable_interpretation`, or `unconfirmed`): road surface and condition,
road width and shoulder, entrances or driveways, grade from the roadway into
the parcel, ditches, culverts, fencing, gates, barriers, neighboring
structures and land uses, vegetation and privacy, utility poles, linear
features (trails, paths, rail lines, utility corridors, drainage corridors),
water features, signs or markers, and any visible issue affecting access or
buyer appeal. Never call a feature a railroad, public trail, private road,
utility corridor, or legal access route unless the evidence supports that
conclusion; when Street View cannot confirm an interpretation, record it as
`unconfirmed` rather than forcing it.

## Controlled specialist responsibilities

When `handback_mode` is `independent_specialist`, perform only the assigned
`specialist_category` and do not wait for sibling work:

- `subject`: exact identity and property facts.
- `comps`: the sidebar comparable rows plus the separate Show on Map
  comparable page. Click the green Show on Map link attached to the sidebar
  comparable list; it opens a separate comparable page and is never a
  base-map or overlay control. Capture every displayed comparable from both
  surfaces, then merge duplicates so each property appears once with its
  richest field set (`price`, `acres`, `apn`, `address`, `price_per_acre`,
  `sale_date`, `source_url` when shown). Never invent a missing value.
- `visuals`: requested visual and overlay evidence.

Every specialist independently verifies the exact subject first and repeats the
same exact address, APN, subject URL, Property Card guard, and canonical
LandPortal property identifier. Set `completed_categories` to an array holding
only the assigned category. Set `comps` to `[]` outside the comp work unit and
`visual_artifacts` to `[]` outside the visual work unit.

## JSON handback

Always write one JSON object to the exact assigned output path. Always include:

- `subject_verification_status`
- `subject_verification_note`
- requested `address`, `apn`, and `property_card_id`
- `captured_at`
- `canonical_property_identifier`
- `specialist_category` when assigned
- `completed_categories` when assigned
- `comps`

For `context_only`, `no_match`, or `failed`, set `comps` to `[]` and omit all
unverified subject fields.

For `verified_exact_subject`, include the following keys and use `null` for an
unavailable optional value rather than inferring it:

- `subject_url`
- `address`, `county`, `municipality`, `apn`, `owner`, `mailing_address`
- `deeded_acres`, `mls_acres`, `calculated_acres`
- `road_frontage_ft`, `landlocked_status`
- `wetlands_pct`, `fema_pct`, `average_slope_pct`
- `pct_under_10pct_slope`, `pct_under_10pct_slope_note`, `buildability_pct`
- `lp_estimate_total`, `lp_estimate_per_acre`
- `water_feature_type`, `zoning_code`, `fema_flood_zone_description`
- `last_sale_price`, `last_sale_date`, `book_number`, `page_number`
- `assessed_value`
- `canonical_property_identifier`, `property_id`,
  `landportal_property_id`
- `captured_at`
- `comps`

Sidebar fact rules for the subject specialist:

- Capture each clearly labeled sidebar field whenever LandPortal displays it,
  preserving the exact displayed value. Use `null` only when the sidebar does
  not show the field.
- `zoning_code` is the displayed code stored verbatim (for example
  `01 - NOT Z`). Never reinterpret, expand, or normalize it.
- `fema_flood_zone_description` is the complete displayed description text,
  never truncated or summarized.
- `last_sale_price`, `last_sale_date`, `book_number`, `page_number`, and
  `assessed_value` come from the Sale Info and Value Overview sidebar
  sections exactly as displayed (keep the displayed date format and any
  currency formatting).
- `water_feature_type` is the displayed Water Feature Type value (for
  example `River`).

Read only the exact subject URL plus the surface required by the assigned
specialist. LP Estimate total and per-acre values are subject estimates, never
comps. Each visible comp may include `price`, `acres`, `apn`, `address`,
`price_per_acre`, `sale_date`, and `source_url` when shown; never invent a
missing value. The visual specialist must supply every requested validation
field and retain artifacts only beneath `visual_artifact_directory`.

## Verification before stopping

- The output path exactly matches the assignment.
- The status is one of the four allowed values.
- Non-importable statuses contain no subject facts or comps.
- Exact-subject status is supported by matching identity fields and the exact
  LandPortal subject URL.
- Specialist output contains only its assigned completed category.
- No file other than the assigned JSON was created.

Final response: output only the JSON path and `subject_verification_status`.
