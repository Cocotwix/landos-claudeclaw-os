// Acquisition Workspace V2 — instant section-switching contract.
//
// Switching between Overview and Property Intelligence must be a client-side
// state change over one already-loaded property record: no full document
// navigation, no per-switch refetch of the record, and never a research rerun.
// These source checks protect that contract in the repo idiom (node-safe;
// live behavior is proven by the browser QA journey).

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PAGE_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/pages/AcquisitionWorkspaceV2.tsx'),
  'utf8',
);
const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
  'utf8',
);
const OVERVIEW_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2Overview.tsx'),
  'utf8',
);
const PAGE_NAV_SRC = PAGE_SRC.match(
  /const navigateToPage = \(slug: string\) => \{[\s\S]*?^  \};/m,
)?.[0] ?? '';

describe('V2 section switching is client-side over one loaded record', () => {
  it('switches sections with pushState instead of full document navigation', () => {
    expect(PAGE_SRC).toMatch(/history\.pushState/);
    expect(PAGE_SRC).toMatch(/e\.preventDefault\(\)/);
    expect(PAGE_SRC).toMatch(/useState<WorkspaceV2Page>/);
  });

  it('keeps back/forward working by re-deriving the section on popstate', () => {
    expect(PAGE_SRC).toMatch(/addEventListener\('popstate'/);
    expect(PAGE_SRC).toMatch(/removeEventListener\('popstate'/);
  });

  it('loads the property record once per deal, not once per section change', () => {
    // The data effect depends only on the deal id — never on the section.
    expect(PAGE_SRC).toMatch(/\}, \[dealId\]\);/);
    expect(PAGE_SRC).not.toMatch(/\[dealId, section\]/);
    // Exactly one fetch of the property-intelligence record in the page.
    const piFetches = PAGE_SRC.match(/property-intelligence\?view=workspace-v2`/g) || [];
    expect(piFetches).toHaveLength(1);
    expect(PAGE_SRC).toContain('/acquisition?view=workspace-v2-overview`');
  });

  it('lets modified clicks (new tab) fall through to normal link behavior', () => {
    expect(PAGE_SRC).toMatch(/metaKey|ctrlKey/);
  });

  it('gives the PI section its data as props so mounting it refetches nothing', () => {
    expect(PI_SRC).not.toMatch(/apiGet/);
    expect(PI_SRC).toMatch(/soils: SoilDetail\[\] \| null/);
  });

  it('gives the extracted Overview its already-loaded projections as props', () => {
    expect(OVERVIEW_SRC).not.toMatch(/apiGet|apiPost/);
    expect(PAGE_SRC).toMatch(/<OverviewSection[\s\S]*?snap=\{snap\}[\s\S]*?compsValuation=\{compsValuation\}/);
  });

  it('never triggers research or any mutation from section navigation', () => {
    // The workspace also owns explicit operator-triggered mutations (for
    // example, opening a War Room and running intelligence). Those actions are
    // not section navigation. Scope this guard to the actual navigation
    // handler so adding a legitimate button elsewhere cannot weaken or falsely
    // fail the client-side switching contract.
    expect(PAGE_NAV_SRC).not.toBe('');
    expect(PAGE_NAV_SRC).not.toMatch(/apiPost|apiPut|apiDelete|method:\s*'POST'/);
    expect(PAGE_NAV_SRC).not.toMatch(/\/research|\/rerun|\/run\b/);
    expect(PAGE_NAV_SRC).toMatch(/history\.pushState/);
  });
});
