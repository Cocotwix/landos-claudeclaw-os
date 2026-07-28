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
const PI_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/PropertyIntelligencePanel.tsx', import.meta.url)),
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
    expect(SRC).toMatch(
      /const seller = deal\?\.people\?\.find\(\(p\) => p\.role === 'seller'\)[\s\S]{0,180}p\.role === 'lead' \|\| p\.role === 'lead_contact'/,
    );
    expect(SRC).toMatch(/const ownerName = piSnapshot\?\.identity\.owner \?\? prop\?\.owner \?\? ''/);
    expect(SRC).toMatch(/Lead \/ contact and owner of record/);
    expect(SRC).toMatch(/Lead \/ contact/);
    expect(SRC).toMatch(/Original official-record formatting remains available in Public Records and Activity/);
    expect(SRC).not.toMatch(/seller\s*=\s*piSnapshot\?\.identity\.owner/);
  });

  it('uses no coordinate/map-pin identity language, and proximity is never called frontage', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
    expect(/ft mapped frontage/i.test(SRC)).toBe(false);
    expect(/mapped frontage ft/i.test(SRC)).toBe(false);
    expect(/road and frontage screen/i.test(SRC)).toBe(false);
    expect(SRC).toMatch(/does not prove frontage, access, utilities, or buildability/);
    expect(PI_SRC).toMatch(/Still open/);
    expect(PI_SRC).toMatch(/item\.missing/);
  });

  it('the legacy detailed-DD dump is gone from the Property tab', () => {
    expect(SRC).toMatch(/<PropertyIntelligenceDueDiligence snapshot=\{piSnapshot\}/);
    expect(SRC).not.toMatch(/<Section title="Detailed Due Diligence & Research"/);
  });

  it('renders concise public findings and source links without orchestration or provenance diagnostics', () => {
    expect(SRC).not.toMatch(/<PropertyIntelligenceOrchestration\b/);
    expect(SRC).not.toMatch(/<EvidenceProvenance\b/);
    expect(PI_SRC).toMatch(/snapshot\.dueDiligence\.map\(\(item\)/);
    expect(PI_SRC).toMatch(/item\.sourceUrl && <a href=\{item\.sourceUrl\}/);
    expect(PI_SRC).toMatch(/\{item\.headline\}/);
    expect(PI_SRC).toMatch(/\{item\.detail\}/);
    expect(PI_SRC).toMatch(/<Bullets rows=\{item\.missing\}/);
  });

  it('hydrates the canonical snapshot records after refresh even while parcel identity is blocked', () => {
    expect(SRC).toMatch(/async function loadCanonicalExtras\(id: number\)/);
    expect(SRC).toMatch(/'\/api\/landos\/deal-cards\/' \+ id \+ '\/property-intelligence'/);
    expect(SRC).toMatch(
      /const \[rres\] = await Promise\.all\(\[[\s\S]{0,180}\/resolution[\s\S]{0,180}loadCanonicalExtras\(id\)/,
    );
    expect(SRC).not.toMatch(/if \(rres\.confirmed\)[\s\S]{0,120}loadCanonicalExtras/);
    expect(SRC).not.toMatch(/\bload(?:Dd|Strategy|Market|Report|PropertySummary|ZoningLandUse)\b/);
    expect(SRC).toMatch(/No legacy[\s\S]{0,100}projection is rebuilt or fetched/);
  });

  it('keeps the Property Intelligence launch and refresh action on Overview', () => {
    const launchMounts = SRC.match(/<PropertyIntelligenceLaunch state=\{propertyIntelligence\} \/>/g) ?? [];
    expect(launchMounts).toHaveLength(2);
    expect(SRC).toMatch(/activeTab === 'overview'[\s\S]{0,180}<PropertyIntelligenceLaunch/);
    expect(PI_SRC).toMatch(/data-testid="pi-run-button"/);
    expect(PI_SRC).toMatch(/view\?\.snapshot \? 'Re-run Property Intelligence' : 'Run Property Intelligence'/);
  });

  it('does not label an official county URL as a LandPortal parcel page', () => {
    expect(SRC).not.toMatch(/Open LandPortal parcel page|LandPortal property facts & visuals/);
    expect(PI_SRC).toMatch(/fact\.sourceUrl[\s\S]{0,180}<a href=\{fact\.sourceUrl\}/);
    expect(PI_SRC).toMatch(/item\.sourceUrl && <a href=\{item\.sourceUrl\}/);
    expect(PI_SRC).toMatch(/>\{fact\.source \?\? 'source'\}<\/a>/);
  });

  it('projects canonical identity into the owner header and keeps visuals and seller identity separate', () => {
    expect(SRC).toMatch(/<HeaderField label="Owner of record" value=\{piSnapshot\?\.identity\.owner \?\? prop\?\.owner\}/);
    expect(SRC).toMatch(/<HeaderField label="APN \/ Parcel ID" value=\{piSnapshot\?\.identity\.apn \?\? prop\?\.apn\}/);
    expect(SRC).toMatch(/<HeaderField label="Acreage" value=\{piSnapshot\?\.identity\.acres/);
    expect(SRC).toMatch(/const ownerName = piSnapshot\?\.identity\.owner \?\? prop\?\.owner \?\? ''/);
    expect(SRC).toMatch(/<div[^>]*>Lead \/ contact<\/div>/);
    expect(PI_SRC).toMatch(/data-testid="pi-visuals"/);
    expect(SRC).toMatch(/activeTab === 'visuals'[\s\S]{0,180}<PropertyIntelligenceVisuals snapshot=\{piSnapshot\}/);
    expect(SRC).not.toMatch(/data-testid="landportal-(?:fact-sheet|visual-gallery|comparables)"/);
  });

  it('provides normal owner controls for property correction and a separate idempotent lead/contact', () => {
    expect(SRC).toMatch(/Correct property identity/);
    expect(SRC).toMatch(/Save verified property identity/);
    expect(SRC).toMatch(/showResolution[\s\S]*?<PropertyIdentityControl/);
    expect(SRC).toMatch(/activeTab === 'property'[\s\S]*?<PropertyIdentityControl/);
    expect(SRC.match(/<PropertyIdentityControl/g)?.length).toBe(2);
    expect(SRC).toMatch(/Add lead or contact/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{dealId\}\/people/);
    expect(SRC).toMatch(/\}, \[prop\.id, snapshot\?\.runId\]\)/);
    expect(SRC).toMatch(/\}, \[dealId\]\)/);
    expect(SRC).toMatch(/Contact identity is separate from the parcel.*owner-of-record field/);
  });
});
