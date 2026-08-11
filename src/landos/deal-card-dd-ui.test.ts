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
const OVERVIEW_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealWorkspaceOverview.tsx', import.meta.url)),
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
      /const seller = people\.find\(\(person\) => person\.role === 'seller' \|\| person\.role === 'lead_contact'\) \?\? people\[0\]/,
    );
    expect(SRC).toMatch(/Seller contacts stay separate from the government owner-of-record identity/);
    expect(SRC).toMatch(/Primary seller contact/);
    expect(SRC).toMatch(/relationshipNote: form\.relationshipToOwner/);
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

  it('the legacy detailed-DD dump is gone and canonical screening is an Overview drill-down', () => {
    expect(OVERVIEW_SRC).toMatch(/<PropertyIntelligenceDueDiligence snapshot=\{snapshot\}/);
    expect(OVERVIEW_SRC).toMatch(/Property screening/);
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
    expect(launchMounts).toHaveLength(1);
    expect(SRC).toMatch(/activeTab === 'overview'[\s\S]{0,1200}<PropertyIntelligenceLaunch/);
    expect(OVERVIEW_SRC).toMatch(/Refresh research/);
    expect(PI_SRC).toMatch(/data-testid="pi-run-button"/);
    expect(PI_SRC).toMatch(/view\?\.snapshot \? 'Re-run Property Intelligence' : 'Run Property Intelligence'/);
  });

  it('shows distinct acquisition thresholds and CRM operating status without inventing missing values', () => {
    for (const label of ['Opening position', 'Target negotiation range', 'Maximum supported acquisition', 'Walk-away level']) {
      expect(OVERVIEW_SRC).toContain(label);
    }
    for (const label of ['Lead stage', 'Next operational step', 'Follow-up date', 'Task owner', 'Offer status', 'Latest meaningful activity']) {
      expect(OVERVIEW_SRC).toContain(label);
    }
    expect(OVERVIEW_SRC).toMatch(/openingPosition/);
    expect(OVERVIEW_SRC).toMatch(/practicalMaximumAcquisitionPrice/);
    expect(OVERVIEW_SRC).toMatch(/walkAwayLevel/);
    expect(OVERVIEW_SRC).toMatch(/'Not scheduled'/);
    expect(OVERVIEW_SRC).toMatch(/'Unassigned'/);
    expect(OVERVIEW_SRC).toMatch(/'Not started'/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{id\}\/acquisition/);
    expect(SRC).toMatch(/crmStatus=\{crmStatus\}/);
  });

  it('does not label an official county URL as a LandPortal parcel page', () => {
    expect(SRC).not.toMatch(/Open LandPortal parcel page|LandPortal property facts & visuals/);
    expect(PI_SRC).toMatch(/fact\.sourceUrl[\s\S]{0,180}<a href=\{fact\.sourceUrl\}/);
    expect(PI_SRC).toMatch(/item\.sourceUrl && <a href=\{item\.sourceUrl\}/);
    expect(PI_SRC).toMatch(/>\{fact\.source \?\? 'source'\}<\/a>/);
  });

  it('projects canonical identity into the owner header and keeps visuals and seller identity separate', () => {
    expect(SRC).toMatch(/piSnapshot\?\.identity\.owner \?\? prop\?\.owner \?\? '—'/);
    expect(SRC).toMatch(/piSnapshot\?\.identity\.apn \?\? prop\?\.apn \?\? '—'/);
    expect(OVERVIEW_SRC).toMatch(/<PropertyIntelligenceProperty snapshot=\{snapshot\}/);
    expect(PI_SRC).toMatch(/<Field label="Acreage" value=\{identity\.acres == null \? '—' : `\$\{identity\.acres\.toFixed\(2\)\} ac`\}/);
    expect(SRC).toMatch(/Primary seller contact/);
    expect(SRC).toMatch(/Seller contacts stay separate from the government owner-of-record identity/);
    expect(PI_SRC).toMatch(/data-testid="pi-visuals"/);
    expect(SRC).toMatch(/activeTab === 'documents'[\s\S]{0,260}<PropertyIntelligenceVisuals snapshot=\{piSnapshot\}/);
    expect(SRC).not.toMatch(/data-testid="landportal-(?:fact-sheet|visual-gallery|comparables)"/);
  });

  it('provides normal owner controls for property correction and a separate idempotent lead/contact', () => {
    expect(SRC).toMatch(/Correct property identity/);
    expect(SRC).toMatch(/Save verified property identity/);
    expect(SRC).toMatch(/showResolution[\s\S]*?<PropertyIdentityControl/);
    expect(SRC).toMatch(/activeTab === 'overview'[\s\S]*?<PropertyIdentityControl/);
    expect(SRC.match(/<PropertyIdentityControl/g)?.length).toBe(2);
    expect(SRC).toMatch(/Add contact/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{dealId\}\/people/);
    expect(SRC).toMatch(/people\/\$\{editing\}/);
    expect(SRC).toMatch(/people\/\$\{person\.id\}/);
    expect(SRC).toMatch(/\}, \[prop\.id, snapshot\?\.runId\]\)/);
    expect(SRC).toMatch(/Seller contacts stay separate from the government owner-of-record identity/);
  });
});
