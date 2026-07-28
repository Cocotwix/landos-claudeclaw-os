// Static contracts for the canonical Deal Card operator workspace.
//
// The browser acceptance covers the live experience. These source-level checks
// prevent the accepted ten-tab workspace from drifting back toward the removed
// report/worksheet projections or dead UI declarations.

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);
const PANEL_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/PropertyIntelligencePanel.tsx', import.meta.url)),
  'utf-8',
);
const ROUTES_SRC = fs.readFileSync(
  fileURLToPath(new URL('./routes.ts', import.meta.url)),
  'utf-8',
);

const DEAD_LEGACY_DECLARATIONS = [
  'PreCallIntelligenceSection',
  'MarketResearchStrip',
  'PropertyGradesPanel',
  'SoldCompValuationPanel',
  'OwnerStrategiesPanel',
  'DiscoverySection',
  'inspectionFactValue',
  'BrowserIntelligenceSection',
  'ConfirmBeforeOfferSection',
  'MarketCompsSection',
  'DiscoveryBriefingSection',
  'DealCardCommandCenter',
  'PostDiscoveryPanel',
  'DdFactChecklist',
  'VisualContextSection',
  'PropertyHeaderSection',
  'AtAGlanceStrip',
  'LandScoreSection',
  'MarketPulseSection',
  'ReportStatusBadge',
  'DdIdentityBadge',
  'LabeledField',
  'StrategyNote',
  'MarketDemandLane',
  'MarketNote',
  'BusinessSpineSection',
  'MarketPulseReadSection',
  'PublicRecordsResearchSection',
  'ReconciledFactsPanel',
  'CompStatePanel',
  'PursuitPanel',
  'StrategyExitsPanel',
  'OrchestrationBanner',
  'MarketScanSection',
  'RetainedLandPortalPanel',
  'LandPortalImageryPanel',
  'LandPortalCompMapEvidence',
  'LandPortalComparableTable',
  'EvidenceProvenance',
  'PropertyIntelligenceOrchestration',
  'OverviewTab',
  'DdEditForm',
  'StrategyEditForm',
  'MarketEditForm',
] as const;

describe('Deal Card — canonical operator workspace', () => {
  it('defines exactly the accepted ten tabs and restores each deal workspace independently', () => {
    expect(SRC).toMatch(
      /type DealTab =\s*'overview' \| 'property' \| 'diligence' \| 'market' \| 'strategy' \| 'visuals' \| 'seller' \| 'documents' \| 'activity' \| 'intake'/,
    );
    for (const label of [
      'Overview',
      'Property',
      'Due Diligence',
      'Market',
      'Strategy',
      'Visuals',
      'Seller',
      'Documents',
      'Activity',
      'Smart Intake',
    ]) {
      expect(SRC, `missing tab ${label}`).toContain(`label: '${label}'`);
    }
    expect(SRC).not.toMatch(/label: 'Resources'|label: 'Browser Intelligence'/);
    expect(SRC).toMatch(/useState<DealTab>\('overview'\)/);
    expect(SRC).toMatch(/setActiveTabState\(restoreDealTab\(id\)\)/);
    expect(SRC).toMatch(/landos\.dealCard\.\$\{dealCardId\}\.tab/);
  });

  it('renders every intelligence-bearing tab from the one promoted snapshot', () => {
    expect(SRC).toMatch(/const propertyIntelligence = usePropertyIntelligence\(/);
    expect(SRC).toMatch(
      /const piSnapshot = propertyIntelligence\.view\?\.snapshot\s*\n?\s*\?\? \(propertyIntelligence\.running \? propertyIntelligence\.view\?\.progressive\?\.snapshot \?\? null : null\);/,
    );
    for (const component of [
      'PropertyIntelligenceOverview',
      'PropertyIntelligenceProperty',
      'PropertyIntelligenceDueDiligence',
      'PropertyIntelligenceMarket',
      'PropertyIntelligenceStrategy',
      'PropertyIntelligenceVisuals',
      'PropertyIntelligenceEvidence',
    ]) {
      expect(SRC, `${component} must consume the canonical snapshot`).toMatch(
        new RegExp(`<${component} snapshot=\\{piSnapshot\\}`),
      );
    }
  });

  it('keeps verified identity correction beside the Property snapshot', () => {
    const propertyStart = SRC.indexOf("{activeTab === 'property'");
    const propertyEnd = SRC.indexOf("{activeTab === 'strategy'", propertyStart);
    const propertyBlock = SRC.slice(propertyStart, propertyEnd);

    expect(propertyStart).toBeGreaterThan(-1);
    expect(propertyBlock).toMatch(/<PropertyIntelligenceProperty snapshot=\{piSnapshot\} \/>/);
    expect(propertyBlock).toMatch(/<PropertyIdentityControl/);
    expect(propertyBlock).toMatch(/onSaved=\{\(\) => load\(deal\.id\)\}/);
    expect(SRC).toMatch(/Save verified property identity/);
    expect(SRC).toMatch(/Official acreage \(if shown\)/);
    expect(SRC).toMatch(/acres: form\.acres\.trim\(\) \? Number\(form\.acres\) : null/);
  });

  it('gates unresolved and rejected identities without discarding retained intake evidence', () => {
    expect(SRC).toMatch(/const showResolution =/);
    expect(SRC).toMatch(/!resolution\.confirmed/);
    expect(SRC).toMatch(/<ResolutionView/);
    expect(SRC).toMatch(/mode === 'view' && deal && !showResolution/);
    expect(SRC).toContain("const rejectedMismatch = prop?.verification_status === 'rejected_mismatch'");
    expect(SRC).toContain(
      'No property intelligence, facts, valuation, Land Score, strategy, report, or offer is shown',
    );
    expect(SRC).toMatch(/Smart Intake evidence and editable candidates remain available/);
    expect(SRC).toMatch(/activeTab === 'intake' && \([\s\S]{0,300}<SmartIntakePanel/);
  });

  it('keeps automatic research progress and historical mission reads visible', () => {
    expect(SRC).toMatch(/data-testid="deal-card-research-progress"/);
    expect(SRC).toMatch(/Automatic property research is running/);
    expect(SRC).toMatch(/setInterval[\s\S]{0,180}3_000/);
    expect(SRC).toMatch(/load\(deal\.id, false\)/);
    expect(SRC).toMatch(/mission\.safeNextAction && !canonicalConfirmed && !missionSuperseded/);
    expect(SRC).toMatch(/activeTab === 'activity'[\s\S]{0,800}<PropertyIntelligenceHistory/);
  });

  it('keeps owner of record separate from the seller or lead contact', () => {
    expect(PANEL_SRC).toMatch(/<Field label="Owner" value=\{identity\.owner/);
    expect(SRC).toMatch(/Owner of record/);
    expect(SRC).toMatch(/Lead \/ contact/);
    expect(SRC).toMatch(/seller\.name\.trim\(\)\.toLowerCase\(\) === String\(ownerName\)/);
  });

  it('keeps current value, acquisition, strategy, visual and evidence outputs on canonical slices', () => {
    expect(PANEL_SRC).toMatch(/data-testid="pi-working-value"/);
    expect(PANEL_SRC).toMatch(/<Field label="Supported range" value=\{range\(valuation\.range\)\}/);
    expect(PANEL_SRC).toMatch(/recommendation\.targetBuyRange/);
    expect(PANEL_SRC).toMatch(/title="Operator recommendation"/);
    expect(PANEL_SRC).toMatch(/recommendation\.preferredStrategy/);
    expect(PANEL_SRC).toMatch(/recommendation\.posture/);
    expect(PANEL_SRC).toMatch(/data-testid="pi-visuals"/);
    expect(PANEL_SRC).toMatch(/data-testid="pi-evidence"/);
  });

  it('keeps create, edit, save, reload, library and document actions intact', () => {
    expect(SRC).toMatch(/New Deal Card/);
    expect(SRC).toMatch(/saving \? 'Saving…' : 'Save'/);
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/deal-cards'/);
    expect(SRC).toMatch(/apiPatch<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{deal\.id\}`/);
    expect(SRC).toMatch(/await load\(res\.dealCard\.id\)/);
    expect(SRC).toMatch(/Section title="Deal Library"/);
    expect(SRC).toMatch(/← Deal Library/);
    expect(SRC).toMatch(/report\/download\?format=pdf/);
    expect(SRC).toMatch(/report\/download\?format=md/);
  });
});

describe('Deal Card — removed legacy surface does not return', () => {
  it('contains none of the 44 unreferenced legacy declarations', () => {
    expect(DEAD_LEGACY_DECLARATIONS).toHaveLength(44);
    for (const name of DEAD_LEGACY_DECLARATIONS) {
      expect(SRC, `${name} must be deleted, not merely unmounted`).not.toMatch(
        new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
      );
    }
  });

  it('does not leave cascading private function declarations unreferenced', () => {
    const privateDeclarations = [
      ...SRC.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm),
    ].map((match) => match[1]);
    const unreferenced = privateDeclarations.filter((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (SRC.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length === 1;
    });
    expect(unreferenced, 'private helpers/components must be used or deleted').toEqual([]);
  });

  it('does not load or mutate retired worksheet and report projections', () => {
    for (const endpoint of [
      '/dd',
      '/strategy',
      '/market',
      '/report',
      '/property-summary',
      '/zoning-land-use',
      '/public-intelligence',
    ]) {
      const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(SRC, `retired projection call ${endpoint} must be absent`).not.toMatch(
        new RegExp(`deal-cards/\\$\\{(?:id|deal\\.id)\\}${escaped}[\`'"]`),
      );
    }
    for (const loader of [
      'loadDd',
      'loadStrategy',
      'loadMarket',
      'loadReport',
      'loadPropertySummary',
      'loadZoningLandUse',
    ]) {
      expect(SRC, `${loader} must not remain as a competing projection loader`).not.toMatch(
        new RegExp(`\\b(?:async\\s+)?function\\s+${loader}\\b`),
      );
    }
    expect(SRC).not.toMatch(/\b(?:dd|strategy|market|report|propertySummary|zoningLandUse),\s*set[A-Z]/);
    expect(SRC).not.toMatch(/<PropertySummarySnapshotPanel|<ZoningLandUsePanel|<PublicPropertyIntelligencePanel/);
  });

  it('does not mount competing comp, value, strategy or report panels', () => {
    for (const legacyMount of [
      'CompMap',
      'LandPortalComparableTable',
      'LandPortalCompMapEvidence',
      'SoldCompValuationPanel',
      'ValuationPanel',
      'BestCompsPanel',
      'PursuitPanel',
      'OverviewTab',
      'DdEditForm',
      'StrategyEditForm',
      'MarketEditForm',
    ]) {
      expect(SRC, `${legacyMount} must not compete with the current snapshot`).not.toMatch(
        new RegExp(`<${legacyMount}\\b`),
      );
    }
    expect(SRC).not.toMatch(/Manual DD \/ research worksheet|Manual market research worksheet/);
  });

  it('declares only the canonical current runtime endpoints, not retired workflows', () => {
    for (const declaration of [
      "app.get('/api/landos/deal-cards/:id/dd'",
      "app.put('/api/landos/deal-cards/:id/dd'",
      "app.get('/api/landos/deal-cards/:id/strategy'",
      "app.put('/api/landos/deal-cards/:id/strategy'",
      "app.get('/api/landos/deal-cards/:id/market'",
      "app.put('/api/landos/deal-cards/:id/market'",
      "app.get('/api/landos/deal-cards/:id/report'",
      "app.post('/api/landos/deal-cards/:id/report/run'",
      "app.post('/api/landos/acquire/run'",
      "app.get('/api/landos/deal-cards/:id/public-intelligence'",
      "app.post('/api/landos/deal-cards/:id/public-intelligence/run'",
    ]) {
      expect(ROUTES_SRC, `obsolete route must be removed: ${declaration}`).not.toContain(declaration);
    }

    expect(ROUTES_SRC).toContain("app.get('/api/landos/deal-cards/:id/property-intelligence'");
    expect(ROUTES_SRC).toContain("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'");
    expect(ROUTES_SRC).toContain("app.post('/api/landos/deal-cards/:id/property-intelligence/run'");
    expect(ROUTES_SRC).toMatch(/const propertyIntelligenceStore = new PropertyIntelligenceStore\(\)/);
  });
});

describe('Deal Card — safety', () => {
  it('never fabricates CRM state or uses imagery as parcel identity', () => {
    expect(SRC).toMatch(/No external CRM\/GHL mutation/);
    expect(/apiPost\([^)]*ghl|crm.*sync|sendMessage/i.test(SRC)).toBe(false);
    expect(SRC).toMatch(/negotiation context only/);
    expect(SRC).toMatch(/Supporting context only — never parcel identity/);
  });

  it('keeps preliminary and non-priceable outputs explicitly qualified', () => {
    expect(PANEL_SRC).toMatch(/data-testid="pi-preliminary"/);
    expect(PANEL_SRC).toMatch(/nothing shown here is promoted until then/i);
    expect(PANEL_SRC).toMatch(/data-testid="pi-not-priceable"/);
    expect(PANEL_SRC).toMatch(/valuation\.nextActionToPrice/);
  });
});
