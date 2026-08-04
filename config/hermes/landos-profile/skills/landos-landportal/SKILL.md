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
twelve-minute ceiling for the visuals work unit. Do not explore beyond the
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
- `canonical_property_identifier`, `property_id`,
  `landportal_property_id`
- `captured_at`
- `comps`

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
