// Deal Card workspace-navigation contract.
//
// The operator surface is intentionally a small CRM-style workspace, not the
// retired ten-report-tab layout. These source checks protect the navigation and
// retention invariants without prescribing every visual implementation detail.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/DealCard.tsx'), 'utf8');
const OVERVIEW_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/DealWorkspaceOverview.tsx'),
  'utf8',
);
const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/PropertyIntelligencePanel.tsx'),
  'utf8',
);

const WORKSPACES = [
  { id: 'overview', label: 'Overview' },
  { id: 'market', label: 'Comps & Market' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'seller', label: 'Seller & Comms' },
  { id: 'documents', label: 'Documents & Visuals' },
];

describe('Deal Card uses a compact operator workspace', () => {
  it('declares five operator-facing workspaces instead of preserving ten report tabs', () => {
    const tabBlock = SRC.slice(SRC.indexOf('const DEAL_TABS'), SRC.indexOf('const DEAL_TAB_IDS'));
    const declared = [...tabBlock.matchAll(/\{ id: '([^']+)', label: '([^']+)' \}/g)]
      .map((match) => ({ id: match[1], label: match[2] }));

    expect(declared).toEqual(WORKSPACES);
    expect(tabBlock).not.toMatch(
      /\{ id: '(?:property|diligence|visuals|activity|intake)', label:/,
    );
    expect(SRC).not.toMatch(/\{ id: 'resources', label: 'Resources' \}/);
  });

  it('keeps one identified, accessible panel controlled by the workspace switcher', () => {
    expect(SRC).toMatch(/role="tablist"/);
    expect(SRC).toMatch(/aria-label="Deal Card workspaces"/);
    expect(SRC).toMatch(/role="tab"/);
    expect(SRC).toMatch(/aria-selected=\{selected\}/);
    expect(SRC).toMatch(/aria-controls=\{`deal-panel-\$\{t\.id\}`\}/);
    expect(SRC).toMatch(/role="tabpanel"/);
    expect(SRC).toMatch(/id=\{`deal-panel-\$\{activeTab\}`\}/);
    // Smart Intake is a focused action, not a visible tab, so it must use its
    // own accessible label instead of pointing at a non-existent tab control.
    expect(SRC).toMatch(
      /aria-labelledby=\{activeTab === 'intake' \? undefined : `deal-tab-\$\{activeTab\}`\}/,
    );
    expect(SRC).toMatch(
      /aria-label=\{activeTab === 'intake' \? 'Update intake' : undefined\}/,
    );
    expect(SRC).toMatch(/data-active-tab=\{activeTab\}/);
  });

  it('every visible workspace renders useful content', () => {
    expect(SRC).toMatch(/activeTab === 'overview'[\s\S]{0,180}<DealWorkspaceOverview/);
    expect(SRC).toMatch(/activeTab === 'market'[\s\S]{0,500}<PropertyIntelligenceMarket/);
    expect(SRC).toMatch(/activeTab === 'strategy' && <PropertyIntelligenceStrategy/);
    expect(SRC).toMatch(/activeTab === 'seller'[\s\S]{0,300}<SellerCrmWorkspace/);
    expect(SRC).toMatch(
      /activeTab === 'documents'[\s\S]{0,300}<PropertyIntelligenceVisuals[\s\S]{0,180}<PropertyIntelligenceEvidence/,
    );
  });

  it('a workspace click is a read-only view change that cannot be swallowed', () => {
    expect(SRC).toMatch(
      /onClick=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); onSelect\(t\.id\); \}\}/,
    );
    expect(SRC).toMatch(/const selectTab = \(tab: DealTab\) => \{\s*setActiveTabState\(tab\);/);
    expect(SRC).toMatch(/sessionStorage\.setItem\(tabStorageKey/);
    expect(SRC).not.toMatch(/onSelect=\{[^}]*api(?:Post|Put|Patch|Delete)/);
  });

  it('navigation remains usable at narrow widths', () => {
    expect(SRC).toMatch(/role="tablist"[^>]*overflow-x-auto/);
    expect(SRC).toMatch(/whitespace-nowrap/);
    expect(SRC).toMatch(/\{t\.label\}/);
    expect(SRC).not.toMatch(/hidden md:block[^]{0,80}\{t\.label\}/);
  });
});

describe('one canonical snapshot drives the hybrid workspace', () => {
  it('selects one promoted snapshot, with progressive output only while running', () => {
    expect(SRC).toMatch(/const propertyIntelligence = usePropertyIntelligence\(/);
    expect(SRC).toMatch(
      /const piSnapshot = propertyIntelligence\.view\?\.snapshot\s*\n?\s*\?\? \(propertyIntelligence\.running \? propertyIntelligence\.view\?\.progressive\?\.snapshot \?\? null : null\);/,
    );
    expect(SRC).toMatch(/snapshot=\{piSnapshot\}/);
    expect(SRC).not.toMatch(/const (?:overview|property|market|strategy)Snapshot\s*=/);
  });

  it('puts property facts and diligence in Overview drill-downs, not competing top-level tabs', () => {
    expect(OVERVIEW_SRC).toMatch(/<PropertyIntelligenceProperty snapshot=\{snapshot\}/);
    expect(OVERVIEW_SRC).toMatch(/<PropertyIntelligenceDueDiligence snapshot=\{snapshot\}/);
    expect(OVERVIEW_SRC).toMatch(/Property & public records/);
    expect(OVERVIEW_SRC).toMatch(/Property screening/);
    expect(SRC).not.toMatch(/activeTab === '(?:property|diligence|visuals|activity)'/);
  });

  it('does not revive a competing report, comp, valuation, or mission workspace', () => {
    for (const legacy of [
      'OverviewTab',
      'CompMap',
      'LandPortalComparableTable',
      'SoldCompValuationPanel',
      'ValuationPanel',
      'BestCompsPanel',
      'MissionGraphPanel',
    ]) {
      expect(SRC, `${legacy} must not compete with the canonical workspace`).not.toMatch(
        new RegExp(`<${legacy}\\b`),
      );
    }
  });
});

describe('Activity and Smart Intake remain retained and reachable', () => {
  it('keeps meaningful Activity with documents rather than dropping history', () => {
    const documents = SRC.slice(
      SRC.indexOf("{activeTab === 'documents'"),
      SRC.indexOf('data-testid="smart-intake-dock"'),
    );
    expect(documents).toMatch(/<Section title="Activity">/);
    expect(documents).toMatch(/<ActivityTimeline events=\{activityEvents\}/);
    expect(documents).not.toMatch(/<PropertyIntelligenceHistory/);
  });

  it('keeps one focused Smart Intake mount in the confirmed workspace', () => {
    expect(SRC).toMatch(/const DEAL_TAB_IDS = new Set<string>\(\[\.\.\.DEAL_TABS\.map\(\(t\) => t\.id\), 'intake'\]\)/);
    expect(SRC).toMatch(/data-testid="open-smart-intake"/);
    expect(SRC).toMatch(/selectTab\('intake'\)/);
    expect(SRC).toMatch(
      /activeTab === 'intake' && \(\s*<div data-testid="smart-intake-dock"[^>]*>\s*<SmartIntakePanel/,
    );
    expect(SRC.match(/<SmartIntakePanel\b/g) ?? []).toHaveLength(2);
  });

  it('reloads Smart Intake without changing the selected workspace', () => {
    expect(SRC).toMatch(/onChanged=\{\(\) => void load\(deal\.id, false\)\}/);
    expect(SRC).toMatch(
      /if \(resetTab && openedDealIdRef\.current !== id\) setActiveTabState\(restoreDealTab\(id\)\)/,
    );
  });

  it('keeps honest empty states in the deeper workspaces', () => {
    expect(SRC).toMatch(/No strategy read yet/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="strategy" \/>/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="retained imagery" \/>/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="retained evidence" \/>/);
  });
});

describe('workspace state and unresolved cards remain safe', () => {
  it('restores a remembered per-deal workspace and defaults to Overview', () => {
    expect(SRC).toMatch(/function restoreDealTab\(dealCardId: number\): DealTab/);
    expect(SRC).toMatch(/if \(isDealTab\(saved\)\) return saved;/);
    expect(SRC).toMatch(/return 'overview';/);
    expect(SRC).toMatch(
      /const tabStorageKey = \(dealCardId: number\) => `landos\.dealCard\.\$\{dealCardId\}\.tab`/,
    );
  });

  it('shows the resolution workspace for unresolved cards while preserving intake access', () => {
    expect(SRC).toMatch(/showResolution && \(/);
    expect(SRC).toMatch(/\{!terminalParcel && \(/);
    expect(SRC).toMatch(/Smart Intake evidence and editable candidates remain available/);
    expect(SRC).toMatch(/!showResolution && \(/);
    expect(SRC).toMatch(/<DealTabBar/);
  });
});
