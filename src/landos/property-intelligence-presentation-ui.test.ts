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
const PAGE_SRC = [
  'web/src/pages/AcquisitionWorkspaceV2.tsx',
  'web/src/components/AcquisitionWorkspaceV2Overview.tsx',
].map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')).join('\n');
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

  it('puts public listing context next to the subject with honest Zillow engagement and photos', () => {
    expect(PI_SRC).toMatch(/Current listing \/ public property context/);
    expect(PI_SRC).toMatch(/primaryListing\.family\.toLowerCase\(\)\.includes\('zillow'\)/);
    expect(PI_SRC).toContain('Not collected (never shown as zero)');
    expect(PI_SRC).toMatch(/Engagement retrieved/);
    expect(PI_SRC).toMatch(/listingPhotos\[listingPhotoIndex\]/);
    expect(PI_SRC).toMatch(/Open \{primaryListing\.sourceLabel\} listing/);
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
    expect(PI_CSS_SRC).toMatch(/\.awv2-listing-layout/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-access-ladder/);
    expect(PI_CSS_SRC).toMatch(/\.awv2-lu-operator-summary/);
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
