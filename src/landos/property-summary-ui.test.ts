import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DEAL_CARD_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'web/src/components/DealCard.tsx'),
  'utf8',
);
const PI_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'web/src/components/PropertyIntelligencePanel.tsx'),
  'utf8',
);
const OVERVIEW_SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'web/src/components/DealWorkspaceOverview.tsx'),
  'utf8',
);

describe('Deal Card canonical Property snapshot UI contract', () => {
  it('loads the canonical snapshot and never loads or rebuilds the retired Property Summary projection', () => {
    expect(DEAL_CARD_SOURCE).toContain("'/api/landos/deal-cards/' + id + '/property-intelligence'");
    expect(DEAL_CARD_SOURCE).toContain('<DealWorkspaceOverview');
    expect(OVERVIEW_SOURCE).toContain('<PropertyIntelligenceProperty snapshot={snapshot} />');
    expect(OVERVIEW_SOURCE).toContain('Property & public records');
    expect(DEAL_CARD_SOURCE).not.toMatch(/property-summary(?:\/rebuild)?/);
    expect(DEAL_CARD_SOURCE).not.toMatch(/PropertySummarySnapshotPanel|loadPropertySummary|rebuildPropertySummary/);
  });

  it('withholds every parcel-specific decision surface while canonical identity is unresolved', () => {
    expect(DEAL_CARD_SOURCE).toMatch(/const showResolution =/);
    expect(DEAL_CARD_SOURCE).toMatch(/!resolution\.confirmed/);
    expect(DEAL_CARD_SOURCE).toMatch(/<ResolutionView/);
    expect(DEAL_CARD_SOURCE).toContain(
      'No property intelligence, facts, valuation, Land Score, strategy, report, or offer is shown',
    );
    expect(DEAL_CARD_SOURCE).toMatch(/Smart Intake evidence and editable candidates remain available/);
  });

  it('shows source-labelled facts, official records, snapshot version and identity correction for a confirmed parcel', () => {
    expect(PI_SOURCE).toMatch(/data-testid="pi-property"/);
    expect(PI_SOURCE).toMatch(/title="Reconciled parcel facts"/);
    expect(PI_SOURCE).toMatch(/title="Government records"/);
    expect(PI_SOURCE).toMatch(/<FactTable facts=\{snapshot\.facts\}/);
    expect(PI_SOURCE).toMatch(/fact\.sourceUrl/);
    expect(PI_SOURCE).toMatch(/data-testid="pi-snapshot-source"/);
    expect(PI_SOURCE).toMatch(/run #\{snapshot\.sequence\}/);
    expect(PI_SOURCE).toMatch(/primary read for this Deal Card/);
    expect(DEAL_CARD_SOURCE).toMatch(/<PropertyIdentityControl[\s\S]{0,180}snapshot=\{piSnapshot\}/);
  });
});
