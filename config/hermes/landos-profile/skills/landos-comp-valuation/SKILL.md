---
name: landos-comp-valuation
description: Recover and validate vacant-land comparable evidence for one established LandOS subject after deterministic comp collectors return an insufficient usable sample.
license: Proprietary
metadata:
  hermes:
    tags: [landos, comps, valuation, vacant-land, recovery]
---

# LandOS comp and valuation recovery

## Boundary

Use only for a bounded Comps & Valuation capability assignment after the
deterministic collectors and shared comp validator run. LandOS supplies the
canonical subject, product class, geography, acreage, existing candidates,
exclusions, source attempts, and exact missing sample requirement. Do not
re-resolve the property, accept caller-supplied prices as facts, or perform
valuation math.

## Selection doctrine

The product and buyer pool govern. Consider vacant/improved class, geography,
acreage and useful adjacent bands, utilities/access, use, sale recency, sale
validity, improvements, and explicit exclusions. A modest acreage difference
does not create a new methodology when the actual buyer/product class is the
same. Prefer the shared source order already supplied by LandOS; do not invent a
comp source hierarchy.

A returned record is not automatically a usable comp. Reject or leave pending
records with an unresolved location or sale identity, wrong product type,
material improvements, stale dates outside the supplied policy, duplicates,
or missing transaction evidence. Active listings are market context and never
closed-sale valuation evidence.

## Recovery and handback

Use one bounded alternate public/browser route only when the validated sold
sample remains insufficient. Return candidates through the same structured
fields and provenance the shared comp chokepoint accepts. LandOS re-runs its
deterministic dedupe, classification, geography, recency, and validity checks;
this skill cannot mark its own candidates accepted or compute FMV.

Classify completion as `RETURNED` only when the shared acceptance requirement
can be met by usable candidates, `PARTIAL` when useful candidates still leave a
thin sample, `BLOCKED` for an exact external wall, `NEEDS_OPERATOR_ACTION` for a
genuine human verification/login step, and `FAILED` for execution failure.

Validation scenarios: five rows with two duplicates and two improved homes do
not satisfy a three-sale vacant-land requirement; an active listing remains
context; a 1.8-acre vacant sale may remain relevant to a 1.5-acre subject when
the buyer/product class matches; recovered candidates are not valued until the
shared validator accepts them.
