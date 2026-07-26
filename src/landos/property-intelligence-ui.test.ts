// Property Intelligence operator surface — static contract.
//
// Proves the ONE-action workflow is actually wired into the Deal Card and that
// every required tab reads the SAME joined snapshot. A panel that exists but is
// never mounted is not an operator surface.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const DEAL_CARD = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);
const PANEL = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/PropertyIntelligencePanel.tsx', import.meta.url)),
  'utf-8',
);

describe('Property Intelligence launch surface', () => {
  it('mounts one launch control that starts the parent mission', () => {
    expect(PANEL).toMatch(/data-testid="pi-run-button"/);
    expect(PANEL).toMatch(/property-intelligence\/run/);
    expect(DEAL_CARD).toMatch(/<PropertyIntelligenceLaunch state=\{propertyIntelligence\}/);
  });

  it('drives the whole Deal Card from ONE snapshot', () => {
    expect(DEAL_CARD).toMatch(/const propertyIntelligence = usePropertyIntelligence\(/);
    expect(DEAL_CARD).toMatch(/const piSnapshot = propertyIntelligence\.view\?\.snapshot \?\? null;/);
  });

  it('renders live specialist progress with classified failures', () => {
    expect(PANEL).toMatch(/data-testid="pi-specialists"/);
    expect(PANEL).toMatch(/data-testid=\{`pi-specialist-\$\{specialist\.id\}`\}/);
    expect(PANEL).toMatch(/specialist\.failureCategory/);
    expect(PANEL).toMatch(/STATUS_TONE\[specialist\.status\]/);
  });

  it('polls only while a mission is in flight', () => {
    expect(PANEL).toMatch(/if \(!dealId \|\| !running\)/);
    expect(PANEL).toMatch(/setInterval\(\(\) => \{ void refresh\(\); \}, 3000\)/);
  });
});

describe('Property Intelligence tab coverage', () => {
  const mounts: Array<[string, RegExp]> = [
    ['Overview', /<PropertyIntelligenceOverview snapshot=\{piSnapshot\} \/>/],
    ['Property', /activeTab === 'property' && <PropertyIntelligenceProperty snapshot=\{piSnapshot\} \/>/],
    ['Due Diligence', /<PropertyIntelligenceDueDiligence snapshot=\{piSnapshot\} \/>/],
    ['Market', /<PropertyIntelligenceMarket snapshot=\{piSnapshot\} \/>/],
    ['Strategy', /activeTab === 'strategy' && <PropertyIntelligenceStrategy snapshot=\{piSnapshot\} \/>/],
    ['Visuals', /<PropertyIntelligenceVisuals snapshot=\{piSnapshot\} \/>/],
    ['Documents', /activeTab === 'documents' && <PropertyIntelligenceEvidence snapshot=\{piSnapshot\} \/>/],
  ];

  for (const [tab, pattern] of mounts) {
    it(`mounts the joined snapshot on the ${tab} tab`, () => {
      expect(pattern.test(DEAL_CARD), `${tab} tab must render the Property Intelligence snapshot`).toBe(true);
    });
  }

  it('no longer sends the operator to the Documents tab to run the workflow', () => {
    expect(DEAL_CARD).not.toMatch(/Run Property Intelligence from the <span class="text-\[var\(--color-accent\)\]">Documents<\/span> tab/);
    expect(DEAL_CARD).toMatch(/Run Property Intelligence from the <span class="text-\[var\(--color-accent\)\]">Overview<\/span> tab/);
  });
});

describe('Property Intelligence honesty rules in the UI', () => {
  it('shows an explicit empty state rather than an implied complete one', () => {
    expect(PANEL).toMatch(/No Property Intelligence snapshot exists for this Deal Card yet/);
    expect(PANEL).toMatch(/Not run yet for this Deal Card\. Nothing is asserted until it runs\./);
  });

  it('never renders a value when the snapshot is not priceable', () => {
    expect(PANEL).toMatch(/valuation\.priceable \? \(/);
    expect(PANEL).toMatch(/data-testid="pi-not-priceable"/);
    expect(PANEL).toMatch(/valuation\.nextActionToPrice/);
  });

  it('separates sold comps from active competition and quarantines improved sales', () => {
    expect(PANEL).toMatch(/Accepted sold comps/);
    expect(PANEL).toMatch(/Active competition/);
    expect(PANEL).toMatch(/Improved sales \(Land-Home Package only\)/);
    expect(PANEL).toMatch(/never establish vacant-land fair market value/);
  });

  it('surfaces every exclusion reason instead of dropping candidates silently', () => {
    expect(PANEL).toMatch(/Excluded candidates/);
    expect(PANEL).toMatch(/\{row\.reason\}/);
  });

  it('labels every fact with its evidence grade', () => {
    expect(PANEL).toMatch(/GRADE_LABEL\[fact\.grade\]/);
    expect(PANEL).toMatch(/confirmed_fact: 'Confirmed fact'/);
    expect(PANEL).toMatch(/post_contract_verification: 'Post-contract legal check'/);
  });

  it('shows blockers, missing information and next actions on the operator read', () => {
    expect(PANEL).toMatch(/title="Blockers"/);
    expect(PANEL).toMatch(/title="Missing information"/);
    expect(PANEL).toMatch(/title="Next actions"/);
  });

  it('keeps wide tables inside their own horizontal scroll container', () => {
    const scrollContainers = PANEL.match(/overflow-x-auto/g) ?? [];
    const tables = PANEL.match(/<table/g) ?? [];
    expect(scrollContainers.length).toBeGreaterThanOrEqual(tables.length);
  });

  it('never presents wholesaling as a strategy', () => {
    expect(/wholesal/i.test(PANEL)).toBe(false);
  });
});
