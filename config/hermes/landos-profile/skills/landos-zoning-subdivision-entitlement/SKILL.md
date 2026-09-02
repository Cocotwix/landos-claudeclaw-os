---
name: landos-zoning-subdivision-entitlement
description: Use when a LandOS Deal Card has an accepted subject and a settled Property Story. Apply the LOCAL jurisdiction's own zoning, subdivision and entitlement rules to the parcel and return one source-backed Development Path with the smallest decisive verification for every potentially viable path.
license: Proprietary
metadata:
  hermes:
    tags: [landos, zoning, subdivision, entitlement, development-path, strategy]
---

# LandOS zoning, subdivision and entitlement

## Invocation gate

Runs automatically on the Stage 3 completion boundary (ahead of the Deal
Brain), after a land-use capability rerun, and once on start for settled
records that hold no current read. It never runs on a page load. It is pure
over what LandOS has already retained: the controlling-authority record, the
official-boundary jurisdiction read, the current zoning determination, the
district standards, the subdivision regulations, the property-specific
subdivision read, the Property Story and the accepted subject. It retrieves
nothing itself; retrieval belongs to the land-use lanes.

## What you produce

One structured Development Path object, retained as
`zoning_development_intelligence_v1`, carrying:

1. **Governing authority**: state, county, municipality or township,
   incorporation status, ETJ or planning area, special authorities, the
   working zoning and subdivision authority with its weight and basis, and
   any conflict between the retained authority record and the official
   boundary evidence. Official boundary geography outranks a jurisdiction-
   level web page. A mailing city, situs locality, ZIP label, geocoder place
   name or a page that names a government without naming this parcel can
   never establish that the parcel is inside that municipality: such a claim
   is retained as NON-QUALIFYING, with its source, date and reason, and is not
   adopted. A conflict is recorded only when two subject-specific sources
   (a government acting on this parcel in its own document, or official
   boundary geometry against the parcel) genuinely disagree; then both sides,
   their applicability and dates, and the decisive written verification are
   named. Incorporation is stated only from qualifying boundary evidence or a
   parcel-specific act, never inferred from the county.
2. **Current district**: code, name, overlays, evidence kind, parcel-match
   basis, effective date, weight, source. Historical references are carried
   and are never the current district.
3. **Uses relevant to company strategies**: single-family dwelling,
   manufactured home, accessory, agricultural, division of land. Each is
   by right, conditional, prohibited, or NOT ESTABLISHED. A use not located
   in the retained ordinance text is never reported as allowed.
4. **Dimensional standards**: lot area and density, frontage, lot width,
   setbacks, height or coverage, road and access, utilities, well and
   septic, environmental, other. Each traced to its section and source or
   named as a gap.
5. **Subject screen**: acreage and basis, mapped frontage, legal access,
   wetlands, flood, septic and utility status, the theoretical lot count
   (arithmetic, never an approved yield) and the frontage ceiling.
6. **Three paths in the jurisdiction's own words**: use or resell as one
   parcel; the local minor subdivision or lot-split path; the local major
   subdivision or entitlement path. For each: local label and definition
   (verbatim), trigger, threshold, authority, review body, materials,
   requirements (plat, survey, access, road, infrastructure, utilities,
   environmental, bonding or dedication, fee), approval steps, parcel-
   specific gates, applicability (applies, may apply, not applicable, not
   established) with the reason, weight, cost and time, missing inputs, the
   smallest decisive verification, and sources.
7. **Critical gates, unknowns, source lineage, currentness** and an overall
   confidence weight.

## Hard rules

- Never hard-code a nationwide definition of "minor" or "major" subdivision,
  a lot threshold, a plat requirement or a review body. The local
  regulation's own definition is the path's label and trigger. When the
  regulation is not retained, the path is NOT ESTABLISHED and the decisive
  action is to obtain the jurisdiction's own regulation.
- Cost and time appear only when a retained source states them (for example
  a review fee in the regulation) or the operator supplied them. Otherwise
  they are missing inputs, never estimates.
- Parcel identity is gated upstream; this skill runs only over the accepted
  subject and correlates every retained product to it. A product formed
  about another parcel version is history and is not consumed.
- Facts about another parcel, owner or assignment are never evidence for the
  subject.
- A theoretical lot count is arithmetic over the stated minimum lot size and
  is never an approved yield.
- Research-grade support is not a zoning verification letter, an
  entitlement opinion, a survey or legal advice. Say which one you mean.

## Refresh behaviour

A read is superseded only when a material dimension moved: working
authority, district, a strategy-relevant use standing, a yield-deciding
standard, the local minor or major definition, a path's applicability, or
the subject screen (acreage, frontage, access, wetlands, lot count). A
restated product with the same substance writes nothing. Every refreshed read
names its cause and the before and after of each dimension that moved. The
Deal Brain consumes the exact retained row (`basedOn.developmentPathSnapshotId`)
and its own material gate includes the path.

## Evidence weight

Carry every conclusion at one weight: Confirmed, Well supported, Likely, or
Unresolved. Name the source that carried it and whether it is an official
government source, official boundary geography, a reputable secondary source
or a search result. Unresolved is the last weight, never the safe one: when a
path cannot be placed, say exactly what would place it.
