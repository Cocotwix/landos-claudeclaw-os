# Acquisitions three-page sprint — acceptance record

Status: **acceptance blocked; not approved for commit or push**  
Acceptance attempt: 2026-08-11 (America/New_York)

This note records only repository-safe acceptance evidence. Deal-linked parcel
identifiers, private lead data, and property financial figures are deliberately
excluded.

## Runtime and visual acceptance

The prescribed managed restart did not complete. `npm run landos:restart`
reported that port 3141 was owned by unrelated PID 161196 and did not touch it.
`npm run landos:health` observed HTTP 200 at the root but HTTP 401 at the health
endpoint and failed for the same ownership condition.

The in-app browser had no available browser backend. The LandOS protocol permits
a named full page-text read when screenshot capture is unavailable, but the
runtime health/auth mismatch prevented a trustworthy authenticated operator-page
read. Therefore no Overview, Property Intelligence, or Comps & Valuation visual
check is claimed, and refresh/section-slug persistence was not accepted.

No artifacts existed under `.runtime/landos/acceptance/` in this lane. In
particular, the recon lane's BEFORE artifacts were not present, so no BEFORE /
AFTER pairing could be produced. Expected artifact locations remain:

- `.runtime/landos/acceptance/before/overview.*`
- `.runtime/landos/acceptance/before/property-intelligence.*`
- `.runtime/landos/acceptance/before/comps-valuation.*`
- `.runtime/landos/acceptance/after/overview.*`
- `.runtime/landos/acceptance/after/property-intelligence.*`
- `.runtime/landos/acceptance/after/comps-valuation.*`

## Source-visible sprint state

These observations are source inspection, not substitutes for operator-page
acceptance.

### Overview

- Reads the Comps & Valuation projection and presents a separate land indication
  and pending whole-property value for an improved subject.
- Keeps seller/lead fields separate from the owner-of-record field.
- Still contains local comparable category/count derivations in
  `AcquisitionWorkspaceV2`, so the one-canonical-state acceptance property is
  not yet protected in this checkout.

### Property Intelligence

- The section is organized into subject, listing/public context, access,
  terrain/environmental, land-use, utilities/septic, market, evidence, and
  unresolved-diligence areas.
- The inspected checkout still computes an acreage conflict from formatted
  strings and retains multiple source-specific acreage rows. Thus the prior
  `Sources disagree (60 vs 60.00 ac)` defect and repeated-acreage presentation
  cannot be signed off as removed here.
- The component does not yet receive the Comps & Valuation canonical summary,
  so its comp count and valuation state cannot be proven cross-page consistent.

### Comps & Valuation

- The section has one comparable workspace, accepted/candidate/context roles,
  a combined map, visual provenance, and expanded comp details.
- It explicitly renders `Land-only indication` and `Whole-property value —
  Pending` for an improved subject.
- The displayed Opening / Target / Ceiling group still needs live verification
  that its land-basis label is visible adjacent to those figures.

## Required acceptance results not established

The following requested results remain **not verified** because the real
operator workflow was unavailable to this lane:

- stale contradiction removal, including the prior `No usable comps found
  after searching Zillow and Redfin…` conclusion;
- exact-address web discovery execution and durable persistence;
- active/current listing state, Zillow facts, views, saves, unavailable-not-zero
  handling, retrieval timestamp, and subject listing photos;
- retained LandPortal terrain/buildability/environmental facts and usable parcel
  capture framing;
- real aerial-route tracing, public-road junction selection, Street View
  panorama inspection, and retained screenshot (including confirmation that no
  unsupported gate observation remains);
- official-GIS collapsed failure state and the zoning/subdivision matrix;
- Zillow, Redfin, Realtor.com, and LandPortal comp reconciliation;
- LandPortal comp enrichment, same-property deduplication, thumbnails, and photo
  gallery behavior;
- Market Research geography isolation. The stored research inventory has no
  Michigan rows, so any Michigan market score or internal county-band count must
  remain treated as a possible cross-geography leak until disproved live.

## Fresh-address New Lead acceptance

Not run. The mission requires the fresh-address smoke only after the primary
subject passes; that prerequisite did not pass. No claim is made about automatic
exact-address discovery, listing detection, property-specific comp isolation,
Street View isolation, new-geography market resolution, or refresh persistence.
The fresh-address run must explicitly reject any phantom market counts from a
different geography.

## Contract test and validation

Added `src/landos/workspace-v2-canonical-state.test.ts`, a node-safe source-text
contract over the workspace page and the Property Intelligence and Comps &
Valuation components. It also includes an optional extracted Overview component
when that file exists. The contract requires:

- one workspace-level `compsValuation.summary`;
- Overview, Property Intelligence, and Comps & Valuation to read
  `acceptedCount` and `status` from that same canonical summary;
- no second accepted-comp count derived from snapshot arrays, category counts,
  or filtered comp rows;
- explicit land-only / land-basis labels and a pending whole-property value.

Per the lane execution constraint, tests and builds were not run here; the
integration harness owns them. Required harness commands are:

- `npx vitest run src/landos/workspace-v2-canonical-state.test.ts`
- `npm run typecheck`

The managed runtime commands were attempted and failed as recorded above.

## Timing and concurrency

Request-to-valid-mission time, peak build concurrency, and total mission wall
clock are harness-level measurements and were not available in this lane.

## Genuine unresolved items

1. Restore managed ownership/authentication of the runtime, then restart and
   obtain a clean health result using only `npm run landos:*` commands.
2. Integrate the product lanes and make the new canonical-state contract pass.
3. Perform authenticated visual acceptance for all three sections, including a
   refresh and section-slug round trip.
4. Produce and pair the six BEFORE/AFTER artifacts, or record named full
   page-text reads if capture would activate Tyler's Chrome.
5. Only after the primary subject passes, run the fresh-address New Lead smoke
   and verify cross-property and market-geography isolation.

No future acquisition page and no whole-property improvement valuation work was
started by this lane.
