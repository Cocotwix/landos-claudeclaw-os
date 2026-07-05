# Due Diligence Report — Reference UI

Acceptance artifacts for the integrated Due Diligence / Property Report (the ONE
investor-ready report the operator uses to evaluate land before making an offer).

Store only REDACTED screenshots here: no real APNs, seller names, private
addresses, or property-specific work product. Use the current operator
acceptance property and blur/omit identifiers.

## Report standard (target)

One integrated report that synthesizes every LandOS source (LandPortal parcel +
valuation, Zillow/Redfin comps, browser-extracted facts, Google + LandPortal
imagery, gov-DD FEMA/NWI/USGS, Market Pulse, Market Matrix, demographics) into a
single decision document. Minimum sections: Executive Summary, Parcel Overview,
Physical DD, Valuation, Comparable Sales, Land Score, Red/Green Flags, Strategy
Evaluation, Offer Guidance, DD Agent Opinion, Discovery Call Prep, Market Pulse,
Visual Context, Market Intelligence, Unknowns. Must exceed the LandPortal
University "AI Due Diligence Agent" webinar baseline.

## Section status (2026-07-04)

Most sections are already produced by the backend report engine
(`deal-card-report.ts`) and rendered in `DealCard.tsx`. This sprint integrated
**Land Score** into the report body (previously broken/null for verified
parcels and hidden behind an on-demand button in the collapsed legacy area).
