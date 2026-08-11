// V2 presentation source contract for the touch-up sprint: concise Visual
// Buyer narrative by default with supporting evidence collapsed; compact
// collapsed Missing Diligence rows; the Soils & Preliminary Septic Outlook
// section; approved access terminology with no driveway-approval language.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
  'utf8',
);
const OVERVIEW_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2Overview.tsx'),
  'utf8',
);
const PAGE_SRC = [
  fs.readFileSync(path.join(process.cwd(), 'web/src/pages/AcquisitionWorkspaceV2.tsx'), 'utf8'),
  OVERVIEW_SRC,
].join('\n');
const CSS_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/styles/workspace-v2.css'), 'utf8');
const PI_CSS_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/styles/workspace-v2-property-intelligence.css'), 'utf8');
const GIS_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2OfficialParcelGis.tsx'), 'utf8');
const LAND_USE_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2LandUse.tsx'), 'utf8');

describe('Visual Buyer Analysis presentation', () => {
  it('renders the concise narrative by default and collapses the detailed A–E analysis', () => {
    expect(PI_SRC).toMatch(/narrative\.sections\.map/);
    expect(PI_SRC).toMatch(/<details class="awv2-collapse awv2-vba-details">/);
    expect(PI_SRC).toMatch(/<summary>View supporting observations and evidence<\/summary>/);
    // The detailed material is preserved inside the collapsed section.
    expect(PI_SRC).toContain('A · Directly observed features');
    expect(PI_SRC).toContain('E · Confidence &amp; evidence reconciliation');
    expect(PI_SRC).toContain('Superseded:');
  });

  it('keeps the Overview summary compact with one market line', () => {
    expect(PAGE_SRC).toMatch(/narrative\?\.overviewMarketLine/);
  });
});

describe('Missing Diligence presentation', () => {
  it('renders compact rows collapsed by default with status and short next action', () => {
    expect(PI_SRC).toMatch(/<details class=\{`awv2-md-row\$\{item\.urgent \? ' urgent' : ''\}`\}>/);
    expect(PI_SRC).toMatch(/\{item\.shortStatus \|\| item\.currentFinding\.slice\(0, 64\)\}/);
    expect(PI_SRC).toMatch(/item\.shortNext \? `Next: \$\{item\.shortNext\}` : ''/);
    // The full reconciled record stays available on expansion.
    for (const marker of ['Current finding', 'Still unresolved', 'Why it matters', 'Next source']) {
      expect(PI_SRC).toContain(marker);
    }
  });

  it('styles collapsed rows and urgent prominence', () => {
    expect(CSS_SRC).toMatch(/\.awv2-md-row \{/);
    expect(CSS_SRC).toMatch(/\.awv2-md-row\.urgent \{/);
  });
});

describe('Soils & Preliminary Septic Outlook', () => {
  it('has the dedicated section with honest empties and the required next step', () => {
    expect(PI_SRC).toMatch(/id="soils-septic"/);
    expect(PI_SRC).toContain('Soils &amp; Preliminary Septic Outlook');
    expect(PI_SRC).toMatch(/Preliminary Septic Outlook:/);
    expect(PI_SRC).toContain('No official rating retained');
    expect(PI_SRC).toMatch(/Required next step:/);
  });

  it('surfaces the compact septic outlook on Overview', () => {
    expect(PAGE_SRC).toMatch(/Septic outlook/);
    expect(PAGE_SRC).toMatch(/Field testing remains required\./);
    expect(PAGE_SRC).toMatch(/soils-septic/);
  });
});

describe('access terminology', () => {
  it('shows one four-rung access ladder instead of duplicated access claims', () => {
    expect(PI_SRC).not.toMatch(/k="Legal access"/);
    expect(PI_SRC).toMatch(/Four-part access evidence ladder/);
    for (const tier of ['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal']) {
      expect(PI_SRC).toContain(`'${tier}'`);
    }
    expect(PI_SRC).toMatch(/accessView\?\.evidence\?\.rungs/);
    expect(PI_SRC).toMatch(/accessView\?\.evidence\?\.byTier/);
    expect(PI_SRC).toMatch(/accessRungs\.map/);
    expect(PI_SRC).toMatch(/Reconciled operator read:/);
    expect(LAND_USE_SRC).not.toMatch(/<div class="awv2-opg-sub">Access<\/div>/);
  });

  it('never shows driveway-approval or permit language in the V2 surfaces', () => {
    for (const src of [PI_SRC, PAGE_SRC]) {
      expect(src).not.toMatch(/driveway approval/i);
      expect(src).not.toMatch(/driveway permit/i);
      expect(src).not.toMatch(/entrance permit/i);
      expect(src).not.toMatch(/highway permit/i);
    }
  });

  it('the hero caption states the reconciled access evidence instead of a collapsed legal-access claim', () => {
    // The caption leads with the reconciled four-tier operator conclusion.
    expect(PAGE_SRC).toMatch(/accessView\?\.evidence\?\.operatorConclusion/);
    // Its fallback still says something from evidence rather than a blanket
    // unresolved claim, but never calls mapped frontage "Legal access".
    expect(PAGE_SRC).toMatch(/accessView\?\.established/);
    expect(PAGE_SRC).toMatch(/Mapped road abutment: \$\{accessView\.legalAccess\}/);
    expect(PAGE_SRC).not.toMatch(/Legal access: \$\{accessView\.legalAccess\}/);
    // Each evidence type is surfaced on its own, never collapsed into one flag.
    expect(PAGE_SRC).toMatch(/accessView\?\.evidence\?\.parcelFlagged/);
    expect(PAGE_SRC).toMatch(/accessView\?\.evidence\?\.apparentPhysicalAccess/);
    expect(PAGE_SRC).toMatch(/accessView\?\.evidence\?\.reportedLegalAccess/);
    expect(PAGE_SRC).toMatch(/accessView\?\.evidence\?\.verifiedLegalAccess/);
    // A recorded instrument stays outstanding diligence until one is read.
    expect(PAGE_SRC).toMatch(/Recorded-instrument access remains separate diligence/);
  });
});

describe('operator-question hierarchy', () => {
  it('shows canonical subject identity once and treats equivalent acreage observations as reconciled', () => {
    expect(PI_SRC.match(/<Kv k="Acreage"/g)).toHaveLength(1);
    expect(PI_SRC.match(/<Kv k="Owner of record"/g)).toHaveLength(1);
    expect(PI_SRC).toMatch(/numerically equivalent observations reconciled/);
    expect(PI_SRC).not.toMatch(/Sources disagree \(\{acreNumbers/);
    expect(PI_SRC).toMatch(/workspace-v2-property-intelligence\.css/);
  });

  it('puts the reconciled public listing next to the subject with availability-gated engagement', () => {
    expect(PI_SRC).toMatch(/Current public listing/);
    // The reconciled subject decides the current record. Picking whichever
    // source sorted first is what let a stale off-market duplicate speak for an
    // actively listed property.
    expect(PI_SRC).toMatch(/exactAddressListings\?\.listingCard/);
    expect(PI_SRC).toMatch(/reconciliation\?\.currentRecord\?\.sourceUrl/);
    expect(PI_SRC).not.toMatch(/primaryListing\.family\.toLowerCase\(\)\.includes\('zillow'\)/);
    // Engagement is read per provider from its own availability flag, so an
    // unpublished measure is unavailable and never zero.
    expect(PI_SRC).toMatch(/engagementMeasure\(signal\.views, signal\.viewsAvailability\)/);
    expect(PI_SRC).toMatch(/engagementMeasure\(signal\.saves, signal\.savesAvailability\)/);
    expect(PI_SRC).toMatch(/availability === 'available' && value != null/);
    expect(PI_SRC).toContain('Not collected (never shown as zero)');
    expect(PI_SRC).toMatch(/Engagement retrieved/);
    expect(PI_SRC).toMatch(/Open \{listingCard\.sourceLabel\} listing/);
    // The reconciliation itself is readable, and superseded records are kept.
    expect(PI_SRC).toMatch(/data-testid="ea-superseded-record"/);
    expect(PI_SRC).toMatch(/reconciliation\.canonical\.identityNote/);
  });

  it('separates the listing block into status, listing-reported facts and imagery without repeating it', () => {
    // One panel per question, each rendered exactly once.
    // Exactly two rendered titles: the reconciled card and the unresolved fallback.
    expect(PI_SRC.match(/awv2-panel-title">\s*Current public listing/g)).toHaveLength(2);
    expect(PI_SRC.match(/awv2-panel-title">\s*Listing-reported property intelligence/g)).toHaveLength(1);
    expect(PI_SRC.match(/id="listing-reported-intelligence"/g)).toHaveLength(1);
    expect(PI_SRC.match(/id="listing-imagery"/g)).toHaveLength(1);
    // Improvement facts live in exactly one panel, at listing weight.
    expect(PI_SRC).toMatch(/never an assessor or recorded fact/);
    expect(PI_SRC.match(/<Kv k="Year built"/g)).toHaveLength(1);
    expect(PI_SRC.match(/<Kv k="Beds \/ baths"/g)).toHaveLength(1);
  });

  it('surfaces listing imagery through the existing gallery and never substitutes a photo', () => {
    expect(PI_SRC).toMatch(/<AcquisitionWorkspaceV2CompPhotoGallery/);
    expect(PI_SRC).toMatch(/listingCard\.primaryPhotoUrl, \.\.\.\(listingCard\.additionalPhotoUrls \?\? \[\]\)/);
    expect(PI_SRC).toContain('No listing photograph was retained for this subject, so none is shown.');
    // No second image subsystem: the manual one-off carousel is gone.
    expect(PI_SRC).not.toMatch(/setListingPhotoIndex/);
  });

  it('reads physical access and legal access as two separate questions', () => {
    expect(PI_SRC).toMatch(/Physical access evidence — what the retained evidence shows, never legal proof/);
    expect(PI_SRC).toMatch(/Legal access status — only what a source reports or a recorded instrument proves/);
    expect(PI_SRC).toMatch(/ACCESS_GROUPS\.map/);
    // Driveway and directions wording supports tier 2 only, and appears once.
    expect(PI_SRC.match(/Listing-reported driveway \/ directions wording/g)).toHaveLength(1);
    expect(PI_SRC).toMatch(/supporting apparent physical access only/);
    expect(PI_SRC).not.toMatch(/Listing-reported access wording/);
  });

  it('renders Street View findings only when a real panorama capture exists', () => {
    expect(PI_SRC).toMatch(/streetView && streetView\.available && hasStreetViewCapture/);
    expect(PI_SRC).toMatch(/!!observation\.evidence\?\.trim\(\)/);
    expect(PI_SRC).toMatch(/supportedStreetObservations\.map/);
    expect(PI_SRC).toContain('No real captured Street View panorama is retained, so no Street View observation is shown.');
    expect(PI_SRC).not.toContain('Street View observations were recorded; no capture is retained yet.');
  });

  it('separates research lane delivery from diligence-question resolution', () => {
    expect(PI_SRC).toContain('Research lanes completed');
    expect(PI_SRC).toContain('Diligence questions resolved');
    expect(PI_SRC).toContain('does not mean every diligence question is resolved');
  });

  it('keeps market and collector detail collapsed behind the operator read', () => {
    expect(PI_SRC).toMatch(/market\.read\?\.resolvedVia/);
    expect(PI_SRC).toContain("market.liquidity?.competition != null ? market.liquidity.competition : 'unmeasured'");
    expect(PI_SRC).toMatch(/<summary>Market records and methodology<\/summary>/);
    expect(PI_SRC).toMatch(/<summary>Collection diagnostics<\/summary>/);
  });

  it('loads lane-owned responsive styles', () => {
    expect(PI_CSS_SRC).toMatch(/\.awv2-listing-metrics/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-listing-engagement/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-access-ladder/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-access-group/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-lu-operator-summary/);
  });
});

describe('Overview listing card', () => {
  it('tells the truth when the reconciled subject has a supported current listing', () => {
    // The subject's reconciled listing state decides the card. Overview no
    // longer re-derives one from whichever retained source sorted first.
    expect(OVERVIEW_SRC).toMatch(/exactAddressListings\?\.listingCard \?\? null/);
    expect(OVERVIEW_SRC).not.toMatch(/No active public listing retained/);
    expect(OVERVIEW_SRC).not.toMatch(/for\[\\s_-\]\?sale/);
    // Summary-first listing facts: status, both prices, age, MLS, brokerage.
    expect(OVERVIEW_SRC).toMatch(/\{listing\.statusLabel\}/);
    expect(OVERVIEW_SRC).toMatch(/Current asking price/);
    expect(OVERVIEW_SRC).toMatch(/Original list price/);
    expect(OVERVIEW_SRC).toMatch(/Listing age/);
    expect(OVERVIEW_SRC).toMatch(/listing\.mlsNumbers\.length \? listing\.mlsNumbers\.join/);
    expect(OVERVIEW_SRC).toMatch(/listing\.brokerage \|\| listing\.listingAgent/);
    expect(OVERVIEW_SRC).toMatch(/listingFacts\.join\(' · '\)/);
    expect(OVERVIEW_SRC).toMatch(/latestPriceChange\(listing, formatUsd\)/);
    // A way into the photos and the full evidence, without a research dump.
    expect(OVERVIEW_SRC).toMatch(/Open listing &amp; photos/);
    expect(OVERVIEW_SRC).toMatch(/openListingEvidence/);
    expect(OVERVIEW_SRC).toMatch(/exact-address-listing-evidence/);
  });

  it('reads engagement from published availability and never renders it as zero', () => {
    // Zillow keeps its two operator-familiar tiles, stated as uncollected when
    // Zillow published nothing; every other provider appears only when it did.
    expect(OVERVIEW_SRC).toMatch(/zillowEngagement\?\.viewsAvailability === 'available'/);
    expect(OVERVIEW_SRC).toMatch(/zillowEngagement\?\.savesAvailability === 'available'/);
    expect(OVERVIEW_SRC).toMatch(/Not collected \(never shown as zero\)/);
    expect(OVERVIEW_SRC).toMatch(/signal\.viewsAvailability === 'available' && signal\.views != null/);
    expect(OVERVIEW_SRC).toMatch(/signal\.savesAvailability === 'available' && signal\.saves != null/);
    // No zero-filled engagement tile can be produced on this surface.
    expect(OVERVIEW_SRC).not.toMatch(/views \?\? 0/);
    expect(OVERVIEW_SRC).not.toMatch(/saves \?\? 0/);
  });

  it('never renders the dedicated Zillow tiles alongside a per-provider Zillow tile', () => {
    // "Zillow views 134" beside "zillow.com views 134" is one measure shown
    // twice. Zillow is excluded from the per-provider tiles BY PROVIDER, so a
    // second Zillow read can never re-render the same counter.
    expect(OVERVIEW_SRC).toMatch(/engagementByProvider\.filter\(\(signal\) => signal\.provider !== 'zillow'\)/);
    expect(OVERVIEW_SRC).not.toMatch(/signal !== zillowEngagement/);
    // The dedicated tiles still exist, and still state an unpublished measure.
    expect(OVERVIEW_SRC).toMatch(/<span>Zillow views<\/span>/);
    expect(OVERVIEW_SRC).toMatch(/<span>Zillow saves<\/span>/);
  });

  it('states an off-market subject as itself instead of claiming nothing was retained', () => {
    expect(OVERVIEW_SRC).toMatch(/listing\.onMarket \? 'active' : 'retained'/);
    expect(OVERVIEW_SRC).toMatch(/!listing\.onMarket && <p class="listing-price-change">\{listing\.statusNote\}<\/p>/);
    expect(OVERVIEW_SRC).toMatch(/No public listing record retained/);
  });

  it('carries no malformed JSX closing tags on any V2 surface', () => {
    // The defect report named `<\span>`, `<\h2>` and `<\div>` in the listing
    // metrics, septic and valuation sections. This keeps them impossible.
    for (const src of [PI_SRC, PAGE_SRC]) {
      expect(src).not.toMatch(/<\\\s*[A-Za-z]/);
    }
  });
});

describe('official source and land-use summaries', () => {
  it('collapses unresolved official GIS without repeating subject identity fields', () => {
    expect(GIS_SRC).toContain('Official county parcel source — not resolved');
    expect(GIS_SRC).toMatch(/<button type="button" onClick=\{run\} disabled=\{running\}>Retry<\/button>/);
    expect(GIS_SRC).toMatch(/<summary>Details<\/summary>/);
    expect(GIS_SRC).not.toMatch(/<Row k="Owner of record"/);
    expect(GIS_SRC).not.toMatch(/<Row k="Acreage"/);
    expect(GIS_SRC).not.toMatch(/<Row k="Parcel ID"/);
  });

  it('leads land use with a scannable matrix and says the missing-rule caveat once', () => {
    expect(LAND_USE_SRC).toMatch(/awv2-lu-operator-summary/);
    expect(LAND_USE_SRC).toContain('absence from the retained research is not evidence that no rule exists');
    expect(LAND_USE_SRC).toMatch(/<summary>Rules matrix, scenarios, sources and diagnostics<\/summary>/);
  });
});
