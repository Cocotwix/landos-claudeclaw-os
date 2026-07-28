// Deal Card tab navigation contract.
//
// The reported defect: clicking Overview, Property, Due Diligence, Market,
// Strategy, Visuals, Seller, Resources, Documents, Activity, or Smart Intake did
// not visibly switch the workspace. Three causes, all fixed here:
//
//  1. Smart Intake and the Property Summary rendered ABOVE every tab, so the
//     visible top of the page was identical whichever tab was selected.
//  2. Smart Intake had no tab of its own — it was a scroll-to button.
//  3. Any in-place reload snapped the operator back to Overview.
//
// These assertions read the shipped source so the contract cannot silently
// regress. Deal Card navigation is a VIEW concern: selecting a tab renders a
// panel and does nothing else — no research, no writes.

import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

const SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/DealCard.tsx'), 'utf8');
const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/PropertyIntelligencePanel.tsx'),
  'utf8',
);

const REQUIRED_TABS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'property', label: 'Property' },
  { id: 'diligence', label: 'Due Diligence' },
  { id: 'market', label: 'Market' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'seller', label: 'Seller' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
  { id: 'intake', label: 'Smart Intake' },
];

describe('every Deal Card tab exists and changes the rendered active panel', () => {
  it('declares exactly the ten canonical tabs, including Smart Intake and no Resources', () => {
    const declared = [...SRC.matchAll(/\{ id: '([^']+)', label: '([^']+)' \}/g)]
      .map((match) => ({ id: match[1], label: match[2] }));
    expect(declared).toEqual(REQUIRED_TABS);
    for (const tab of REQUIRED_TABS) {
      expect(SRC.includes(`{ id: '${tab.id}', label: '${tab.label}' }`), `missing tab ${tab.label}`).toBe(true);
    }
    expect(SRC).not.toMatch(/\{ id: 'resources', label: 'Resources' \}/);
  });

  it('every tab has a panel gated on the active tab', () => {
    for (const tab of REQUIRED_TABS) {
      expect(SRC.includes(`activeTab === '${tab.id}'`), `tab ${tab.id} renders no panel`).toBe(true);
    }
  });

  it('exactly one identified tabpanel is rendered, named by the active tab', () => {
    expect(SRC).toMatch(/role="tabpanel"/);
    expect(SRC).toMatch(/id=\{`deal-panel-\$\{activeTab\}`\}/);
    expect(SRC).toMatch(/data-testid=\{`deal-panel-\$\{activeTab\}`\}/);
    expect(SRC).toMatch(/data-active-tab=\{activeTab\}/);
  });

  it('the tab bar is a real tablist with a clear selected state', () => {
    expect(SRC).toMatch(/role="tablist"/);
    expect(SRC).toMatch(/role="tab"/);
    expect(SRC).toMatch(/aria-selected=\{selected\}/);
    expect(SRC).toMatch(/data-active=\{selected \? 'true' : 'false'\}/);
    expect(SRC).toMatch(/data-testid=\{`deal-tab-\$\{t\.id\}`\}/);
  });

  it('a tab click cannot be swallowed by a surrounding container, form, or handler', () => {
    // The handler stops propagation and prevents default so no parent card,
    // section, or nested form submit intercepts the selection, and the control
    // sits above sibling content in the stacking order.
    expect(SRC).toMatch(/onClick=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); onSelect\(t\.id\); \}\}/);
    expect(SRC).toMatch(/class=\{`relative z-10 px-3/);
    expect(SRC).toMatch(/type="button"/);
  });

  it('Smart Intake is dedicated to its tab and is not mounted beside other workspaces', () => {
    // CORRECTED CONTRACT. Smart Intake gets a tab, but the panel itself is NOT
    // gated on that tab: retained originals are Deal Card evidence and stay
    // mounted on every tab (see the retention suite). Selecting the tab reorders
    // the docked panel to the top of the workspace — it never re-mounts it.
    expect(SRC).toMatch(/data-testid="smart-intake-dock"/);
    expect(SRC).toMatch(/activeTab === 'intake' && \(\s*<div data-testid="smart-intake-dock"[^>]*>\s*<SmartIntakePanel/);
    expect(SRC).not.toMatch(/class=\{activeTab === 'intake' \? 'order-first' : ''\}/);
    // The header button opens the tab rather than scrolling down a long page.
    expect(SRC).toMatch(/data-testid="open-smart-intake"/);
    expect(SRC).toMatch(/selectTab\('intake'\)/);
  });

  it('Due Diligence, Documents and Smart Intake remain reachable in their one-purpose tabs', () => {
    expect(SRC).toMatch(
      /activeTab === 'diligence' && \([\s\S]{0,220}<PropertyIntelligenceDueDiligence snapshot=\{piSnapshot\}/,
    );
    const documents = SRC.slice(
      SRC.indexOf("{activeTab === 'documents' && <PropertyIntelligenceEvidence"),
      SRC.indexOf("{activeTab === 'activity'", SRC.indexOf("{activeTab === 'documents' && (")),
    );
    expect(documents).toMatch(/<PropertyIntelligenceEvidence snapshot=\{piSnapshot\}/);
    expect(documents).toMatch(/<DocumentRegistryPanel/);
    expect(documents).toMatch(/<DocumentUploadPanel/);
    expect(SRC).toMatch(/activeTab === 'intake' && \([\s\S]{0,300}<SmartIntakePanel/);
  });

  it('no legacy summary or permanently docked intake panel competes with the selected workspace', () => {
    // The Property Summary is pinned only on an UNRESOLVED card, where it is the
    // whole story. On a tabbed card it belongs to Overview and Property.
    const workspaceStart = SRC.indexOf('role="tabpanel"');
    const workspaceEnd = SRC.indexOf("{activeTab === 'intake'", workspaceStart);
    const workspace = SRC.slice(workspaceStart, workspaceEnd);
    expect(workspace).not.toMatch(/<OverviewTab\b|<PropertySummarySnapshotPanel\b/);
    // Smart Intake sits BELOW the workspace in the document (its dock follows the
    // tabpanel), so it no longer competes with the selected tab for the viewport;
    // selecting its tab reorders it visually rather than moving it in the DOM.
    expect(workspace).not.toMatch(/data-intake-active=\{activeTab/);
  });
});

describe('no Deal Card tab renders an empty workspace', () => {
  it('Strategy says what is missing instead of rendering nothing before a report exists', () => {
    // Live finding: Strategy is composed entirely from Property Intelligence, so
    // on a card with no result the panel had zero height and zero content —
    // indistinguishable from a broken tab. The tab now always renders the joined
    // snapshot panel (which carries its own honest empty state), and the
    // explainer appears only while the canonical snapshot is absent.
    expect(SRC).toMatch(/activeTab === 'strategy' && <PropertyIntelligenceStrategy snapshot=\{piSnapshot\} \/>/);
    expect(SRC).toMatch(/activeTab === 'strategy' && !piSnapshot && \(/);
    expect(SRC).toMatch(/No strategy read yet/);
    expect(SRC).toMatch(/Run Property Intelligence from the/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="strategy" \/>/);
  });

  it('Visuals and Documents already carry their own honest empty states', () => {
    expect(SRC).toMatch(/<PropertyIntelligenceVisuals snapshot=\{piSnapshot\} \/>/);
    expect(SRC).toMatch(/<PropertyIntelligenceEvidence snapshot=\{piSnapshot\} \/>/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="retained imagery" \/>/);
    expect(PI_SRC).toMatch(/if \(!snapshot\) return <NoSnapshot label="retained evidence" \/>/);
    expect(PI_SRC).toMatch(/No Property Intelligence snapshot exists for this Deal Card yet/);
    expect(SRC).toMatch(/No report generated yet/);
  });
});

describe('Deal Card tab navigation is read-only', () => {
  it('selecting a tab only sets view state and remembers the preference', () => {
    expect(SRC).toMatch(/const selectTab = \(tab: DealTab\) => \{\s*setActiveTabState\(tab\);/);
    // The remembered tab is a browser view preference, never a database write.
    expect(SRC).toMatch(/sessionStorage\.setItem\(tabStorageKey/);
    expect(SRC).not.toMatch(/onSelect=\{[^}]*apiPost/);
    expect(SRC).not.toMatch(/onSelect=\{[^}]*apiPut/);
    expect(SRC).not.toMatch(/onSelect=\{[^}]*apiPatch/);
    expect(SRC).not.toMatch(/onSelect=\{[^}]*apiDelete/);
  });

  it('the tab bar is wired to the read-only selector', () => {
    expect(SRC).toMatch(/<DealTabBar active=\{activeTab\} onSelect=\{selectTab\} \/>/);
  });
});

describe('Deal Card tab state survives reload and refresh', () => {
  it('reloading the SAME card keeps the operator in their workspace', () => {
    expect(SRC).toMatch(/if \(resetTab && openedDealIdRef\.current !== id\) setActiveTabState\(restoreDealTab\(id\)\)/);
    // The Smart Intake panel reloads without resetting the tab.
    expect(SRC).toMatch(/onChanged=\{\(\) => void load\(deal\.id, false\)\}/);
  });

  it('a refresh deterministically restores the remembered tab, defaulting to Overview', () => {
    expect(SRC).toMatch(/function restoreDealTab\(dealCardId: number\): DealTab/);
    expect(SRC).toMatch(/if \(isDealTab\(saved\)\) return saved;/);
    expect(SRC).toMatch(/return 'overview';/);
  });

  it('opening a DIFFERENT card restores that card\'s own workspace', () => {
    expect(SRC).toMatch(/const tabStorageKey = \(dealCardId: number\) => `landos\.dealCard\.\$\{dealCardId\}\.tab`/);
  });
});

describe('Deal Card tab navigation works on desktop and 412x915 mobile', () => {
  it('the tab bar wraps and scrolls instead of overflowing a narrow viewport', () => {
    expect(SRC).toMatch(/class="flex flex-wrap gap-0\.5 -mb-px overflow-x-auto"/);
    expect(SRC).toMatch(/whitespace-nowrap/);
  });

  it('the header row holding the tab bar wraps on a narrow screen', () => {
    expect(SRC).toMatch(/<div class="flex flex-wrap items-center gap-2">\s*<div class="min-w-0 flex-1"><DealTabBar/);
  });

  it('tab controls stay tappable rather than collapsing to icons', () => {
    // Labels are rendered as text at every width; nothing is hidden behind a
    // desktop-only breakpoint that would strip navigation on mobile.
    expect(SRC).toMatch(/\{t\.label\}/);
    expect(SRC).not.toMatch(/hidden md:block[^]{0,80}\{t\.label\}/);
  });
});

describe('Deal Card tab navigation works on confirmed, unresolved and conflicted cards', () => {
  it('an unresolved or terminal card shows the resolution workspace, with Smart Intake still available', () => {
    expect(SRC).toMatch(/showResolution && \(/);
    expect(SRC).toMatch(/\{!terminalParcel && \(/);
    expect(SRC).toMatch(/Smart Intake evidence and editable candidates remain available/);
  });

  it('a confirmed card renders the full tab bar', () => {
    expect(SRC).toMatch(/!showResolution && \(/);
    expect(SRC).toMatch(/<DealTabBar/);
  });
});
