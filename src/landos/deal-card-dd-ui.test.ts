// Static checks: the manual DD worksheet was REMOVED from the operator Deal
// Card (canonical reconciled facts + the DD business-status panel own that
// read now), and no unsafe access/identity language can render.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);
const PANELS_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCardPanels.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card DD — canonical records, not a worksheet', () => {
  it('removed the manual DD worksheet from the Property tab', () => {
    expect(SRC).toMatch(/Manual DD worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual DD \/ research worksheet"/);
  });

  it('does not render the internal DD business-status/readiness panel', () => {
    expect(SRC).not.toMatch(/<DdBusinessStatusPanel\b/);
    expect(SRC).not.toMatch(/<UnifiedReadinessStrip\b/);
    expect(SRC).not.toMatch(/<BusinessSpineSection\b/);
    expect(SRC).not.toMatch(/completeness=\{report\.ddCompleteness\}/);
    expect(SRC).not.toMatch(/confidence: \{es\.confidence\}/);
    expect(SRC).not.toMatch(/confidence: \{ls\.confidence/);
    expect(SRC).not.toMatch(/\{ls\.note\}/);
    expect(PANELS_SRC).not.toMatch(/confidence \{ls\.confidence/);
    expect(PANELS_SRC).not.toMatch(/\{ls\.note\}/);
    expect(SRC).not.toMatch(/<EvidenceGallery dealId=/);
    expect(SRC).not.toMatch(/\{false && activeTab === 'property' && prop\?\.id && \(/);
  });

  it('keeps structured parcel intake history out of the seller snapshot', () => {
    expect(SRC).toMatch(/function ownerFacingSellerNote/);
    expect(SRC).toMatch(/structuredParcelIntake \? '' : note/);
  });

  it('uses no coordinate/map-pin identity language, and proximity is never called frontage', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
    expect(/ft mapped frontage/i.test(SRC)).toBe(false);
    expect(/mapped frontage ft/i.test(SRC)).toBe(false);
    expect(/road and frontage screen/i.test(SRC)).toBe(false);
    expect(SRC).toMatch(/Frontage footage is not established/);
  });

  it('the legacy detailed-DD dump is gone from the Property tab', () => {
    expect(SRC).toMatch(/Legacy "Detailed Due Diligence & Research" dump removed/);
  });

  it('renders concise public findings and source links without orchestration or provenance diagnostics', () => {
    expect(SRC).not.toMatch(/<PropertyIntelligenceOrchestration\b/);
    expect(SRC).not.toMatch(/<EvidenceProvenance\b/);
    expect(SRC).toMatch(/task\.evidence\.map\(\(source, index\)/);
    expect(SRC).toMatch(/task\.finding\?\.whyItMatters/);
  });

  it('hydrates persisted reports and orchestration after refresh even while parcel identity is blocked', () => {
    expect(SRC).toMatch(/await Promise\.all\(\[loadDd\(id\), loadStrategy\(id\), loadMarket\(id\), loadReport\(id\), loadPropertySummary\(id\)\]\)/);
    expect(SRC).not.toMatch(/if \(rres\.confirmed\) \{\s*await loadDd/);
    expect(SRC).toMatch(/identityBlocked/);
    expect(SRC).toMatch(/saved\?\.orchestration\?\.status === 'blocked_identity'/);
  });

  it('keeps the Property Intelligence refresh action on Overview after a report already exists', () => {
    const refreshLabels = SRC.match(/report\?\.exists \? 'Re-run Property Intelligence' : 'Run Property Intelligence'/g) ?? [];
    expect(refreshLabels.length).toBeGreaterThanOrEqual(2);
    expect(SRC).toMatch(/always available so a newly resolved parcel can refresh/);
  });

  it('does not label an official county URL as a LandPortal parcel page', () => {
    expect(SRC).toMatch(/<Section title="LandPortal property facts & visuals">/);
    expect(SRC).toMatch(/parcelUrlIsLandPortal \? 'Open LandPortal parcel page' : 'Open official parcel source'/);
    expect(SRC).not.toMatch(/<Section title="LandPortal imagery & observations">/);
  });

  it('projects the retained LandPortal asset into the owner header and keeps seller separate from parcel ownership', () => {
    expect(SRC).toMatch(/function preferredLandPortalHero/);
    expect(SRC).toMatch(/sellerLead=\{seller\?\.name \?\? null\}/);
    expect(SRC).toMatch(/heroSrc=\{headerHeroSrc\}/);
    expect(SRC).toMatch(/data-testid="landportal-fact-sheet"/);
    expect(SRC).toMatch(/data-testid="landportal-visual-gallery"/);
    expect(SRC).toMatch(/data-testid="landportal-comparables"/);
  });

  it('provides normal owner controls for property correction and a separate idempotent lead/contact', () => {
    expect(SRC).toMatch(/Correct property identity/);
    expect(SRC).toMatch(/Save verified property identity/);
    expect(SRC).toMatch(/Add lead or contact/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{dealId\}\/people/);
    expect(SRC).toMatch(/\}, \[prop\.id\]\)/);
    expect(SRC).toMatch(/\}, \[dealId\]\)/);
  });
});
