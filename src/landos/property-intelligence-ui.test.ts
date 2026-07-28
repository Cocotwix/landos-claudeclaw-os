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
const CANONICAL_WORKSPACE = DEAL_CARD.slice(
  DEAL_CARD.indexOf('role="tabpanel"'),
  DEAL_CARD.indexOf("{activeTab === 'intake'", DEAL_CARD.indexOf('role="tabpanel"')),
);

describe('Property Intelligence launch surface', () => {
  it('mounts one launch control that starts the parent mission', () => {
    expect(PANEL).toMatch(/data-testid="pi-run-button"/);
    expect(PANEL).toMatch(/property-intelligence\/run/);
    expect(DEAL_CARD).toMatch(/<PropertyIntelligenceLaunch state=\{propertyIntelligence\}/);
  });

  it('drives the whole Deal Card from ONE snapshot, preferring the promoted read', () => {
    expect(DEAL_CARD).toMatch(/const propertyIntelligence = usePropertyIntelligence\(/);
    // The promoted snapshot always wins; the progressive partial is only the
    // fallback while a run is in flight and no promoted snapshot exists yet.
    expect(DEAL_CARD).toMatch(/const piSnapshot = propertyIntelligence\.view\?\.snapshot\s*\n?\s*\?\? \(propertyIntelligence\.running \? propertyIntelligence\.view\?\.progressive\?\.snapshot \?\? null : null\);/);
  });

  it('uses discovery-usable snapshot identity in the pinned header without reviving stale spine gaps', () => {
    expect(PANEL).toMatch(/discoveryUsable\?: boolean/);
    expect(DEAL_CARD).toMatch(/function currentCriticalFacts/);
    expect(DEAL_CARD).toMatch(/snapshot\?\.identity\.state === 'provisional' && snapshot\.identity\.discoveryUsable/);
    expect(DEAL_CARD).toMatch(/currentCriticalFacts\(piSnapshot, spine\?\.header\?\.criticalFacts\)/);
    expect(DEAL_CARD).toMatch(/piSnapshot\?\.identity\.discoveryUsable \? piSnapshot\.nextActions\[0\]/);
  });

  it('renders progressive content clearly marked preliminary, never as the promoted read', () => {
    // Every tab-level section mounts the preliminary notice.
    expect(PANEL).toMatch(/data-testid="pi-preliminary"/);
    expect(PANEL).toMatch(/nothing shown here is promoted until then/i);
    const sections = ['pi-overview', 'pi-property', 'pi-market', 'pi-strategy', 'pi-visuals', 'pi-evidence'];
    for (const id of sections) {
      const start = PANEL.indexOf(`data-testid="${id}"`);
      expect(start, `section ${id} must exist`).toBeGreaterThan(-1);
      const nearby = PANEL.slice(start, start + 220);
      expect(nearby.includes('<PreliminaryNotice snapshot={snapshot} />'), `section ${id} must mount PreliminaryNotice`).toBe(true);
    }
    // The notice renders nothing on a promoted (non-preliminary) snapshot.
    expect(PANEL).toMatch(/if \(!snapshot\.preliminary\) return null;/);
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
    [
      'Property',
      /activeTab === 'property'[\s\S]{0,500}<PropertyIntelligenceProperty snapshot=\{piSnapshot\} \/>[\s\S]{0,500}<PropertyIdentityControl/,
    ],
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

  it('mounts exactly one snapshot slice in each intelligence-bearing tab', () => {
    const components = [
      'PropertyIntelligenceOverview',
      'PropertyIntelligenceProperty',
      'PropertyIntelligenceDueDiligence',
      'PropertyIntelligenceMarket',
      'PropertyIntelligenceStrategy',
      'PropertyIntelligenceVisuals',
      'PropertyIntelligenceEvidence',
    ];
    for (const component of components) {
      const mounts = CANONICAL_WORKSPACE.match(new RegExp(`<${component}\\b`, 'g')) ?? [];
      expect(mounts, `${component} must mount exactly once in the canonical workspace`).toHaveLength(1);
    }
  });

  it('keeps verified identity correction beside the canonical Property snapshot', () => {
    const propertyStart = CANONICAL_WORKSPACE.indexOf("{activeTab === 'property'");
    const propertyEnd = CANONICAL_WORKSPACE.indexOf("{activeTab === 'strategy'", propertyStart);
    const propertyWorkspace = CANONICAL_WORKSPACE.slice(propertyStart, propertyEnd);

    expect(propertyStart).toBeGreaterThan(-1);
    expect(propertyWorkspace).toMatch(/<PropertyIntelligenceProperty snapshot=\{piSnapshot\} \/>/);
    expect(propertyWorkspace).toMatch(/<PropertyIdentityControl/);
    expect(propertyWorkspace).toMatch(/onSaved=\{\(\) => load\(deal\.id\)\}/);
  });

  it('never mounts proof or legacy comp, map, valuation and report panels in the canonical workspace', () => {
    for (const legacy of [
      'MissionGraphPanel',
      'CompMap',
      'LandPortalComparableTable',
      'LandPortalCompMapEvidence',
      'SoldCompValuationPanel',
      'ValuationPanel',
      'BestCompsPanel',
      'OverviewTab',
    ]) {
      expect(CANONICAL_WORKSPACE, `${legacy} must not compete with the current snapshot`).not.toMatch(
        new RegExp(`<${legacy}\\b`),
      );
    }
  });

  it('no longer sends the operator to the Documents tab to run the workflow', () => {
    expect(DEAL_CARD).not.toMatch(/Run Property Intelligence from the <span class="text-\[var\(--color-accent\)\]">Documents<\/span> tab/);
    expect(DEAL_CARD).toMatch(/Run Property Intelligence from the <span class="text-\[var\(--color-accent\)\]">Overview<\/span> tab/);
  });
});

describe('Property Intelligence honesty rules in the UI', () => {
  it('does not expose removed current providers in the snapshot UI', () => {
    expect(PANEL).not.toMatch(/HomeHarvest|Realie/i);
    expect(CANONICAL_WORKSPACE).not.toMatch(/HomeHarvest|Realie/i);
  });

  it('renders one recommendation card and the strategy array once', () => {
    expect(PANEL.match(/title="Operator recommendation"/g) ?? []).toHaveLength(1);
    expect(PANEL.match(/strategies\.length \? strategies\.map/g) ?? []).toHaveLength(1);
  });

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

  it('consolidates failure output into one summary, one limitation section and one next-action section', () => {
    expect(PANEL).toMatch(/title="Mission summary"/);
    expect(PANEL).toMatch(/title="Risks and limitations"/);
    expect(PANEL).toMatch(/title="Next action"/);
    expect(PANEL).not.toMatch(/title="Missing information"/);
    expect(PANEL).toMatch(/Specialist evidence and source limitations/);
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
