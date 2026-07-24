import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DEAL_CARD_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'web/src/components/DealCard.tsx'),
  'utf8',
);
const PANEL_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'web/src/components/PropertySummarySnapshotPanel.tsx'),
  'utf8',
);

describe('Deal Card versioned Property Summary UI contract', () => {
  it('loads the read model through GET and rebuilds only through an explicit POST command', () => {
    expect(DEAL_CARD_SOURCE).toContain('`/api/landos/deal-cards/${id}/property-summary`');
    expect(DEAL_CARD_SOURCE).toContain('`/api/landos/deal-cards/${deal.id}/property-summary/rebuild`');
    expect(DEAL_CARD_SOURCE).toContain('<PropertySummarySnapshotPanel');
    expect(PANEL_SOURCE).toContain('Build summary');
    expect(PANEL_SOURCE).toContain('Refresh summary');
  });

  it('withholds every parcel-specific decision surface when the versioned identity is unresolved', () => {
    expect(DEAL_CARD_SOURCE).toContain("propertySummary.identity.status !== 'confirmed'");
    expect(DEAL_CARD_SOURCE).toContain('versionedParcelSpecificAllowed === false');
    expect(DEAL_CARD_SOURCE).toContain('versionedResolutionRequired');
    expect(PANEL_SOURCE).toContain('Resolution required');
    expect(PANEL_SOURCE).toContain('Parcel-specific aerials, ranked comparables, value, and strategy remain withheld.');
    expect(PANEL_SOURCE).toContain('snapshot?.summary.parcelSpecificAllowed === false');
  });

  it('shows versions, completeness, evidence provenance, and collector state for a confirmed parcel', () => {
    expect(PANEL_SOURCE).toContain('Snapshot v{snapshot.version}');
    expect(PANEL_SOURCE).toContain('Identity v{props.value?.identity.version}');
    expect(PANEL_SOURCE).toContain('{snapshot.completeness.percent}% complete');
    expect(PANEL_SOURCE).toContain('immutable evidence item');
    expect(PANEL_SOURCE).toContain('Evidence #{fact.evidenceId}');
    expect(PANEL_SOURCE).toContain('Assessor/GIS:');
  });
});
