---
name: landos-landportal
description: Run one bounded LandOS LandPortal subject lookup.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, landportal, property-intelligence, cdp]
    related_skills: [driving-cdp-browser]
---

# LandOS LandPortal subject lookup

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
- Read from LandPortal only. Write exactly one file: the assigned JSON output.

## Browser contract

1. Load and follow `driving-cdp-browser`.
2. Attach only to the already authenticated Chrome CDP endpoint at
   `http://127.0.0.1:9224`.
3. Do not launch another browser, change ports, or inspect unrelated tabs.
4. Clear or close an obstructing popup, select the correct LandPortal search
   type, and choose the top returned suggestion for each allowed query.
5. Do not create Python or JavaScript helper scripts and do not navigate Market
   Research.

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
absolute five-minute ceiling. Do not explore beyond the sequence to consume the
remaining time.

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

## JSON handback

Always write one JSON object to the exact assigned output path. Always include:

- `subject_verification_status`
- `subject_verification_note`
- requested `address`, `apn`, and `property_card_id`
- `captured_at`
- `canonical_property_identifier`
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

Read only the exact subject sidebar, exact subject URL, LP Estimate, and visible
comparable rows. LP Estimate total and per-acre values are subject estimates,
never comps. Each visible comp may include `price`, `acres`, `apn`, `address`,
`price_per_acre`, `sale_date`, and `source_url` when shown; never invent a
missing value.

## Verification before stopping

- The output path exactly matches the assignment.
- The status is one of the four allowed values.
- Non-importable statuses contain no subject facts or comps.
- Exact-subject status is supported by matching identity fields and the exact
  LandPortal subject URL.
- No file other than the assigned JSON was created.

Final response: output only the JSON path and `subject_verification_status`.
