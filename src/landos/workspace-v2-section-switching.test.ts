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

describe('V2 section switching is client-side over one loaded record', () => {
  it('switches sections with pushState instead of full document navigation', () => {
    expect(PAGE_SRC).toMatch(/history\.pushState/);
    expect(PAGE_SRC).toMatch(/e\.preventDefault\(\)/);
    expect(PAGE_SRC).toMatch(/useState<WorkspaceV2Section>/);
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
    const piFetches = PAGE_SRC.match(/property-intelligence`/g) || [];
    expect(piFetches).toHaveLength(1);
  });

  it('lets modified clicks (new tab) fall through to normal link behavior', () => {
    expect(PAGE_SRC).toMatch(/metaKey|ctrlKey/);
  });

  it('gives the PI section its data as props so mounting it refetches nothing', () => {
    expect(PI_SRC).not.toMatch(/apiGet/);
    expect(PI_SRC).toMatch(/soils: SoilDetail\[\] \| null/);
  });

  it('never triggers research or any mutation from section navigation', () => {
    for (const src of [PAGE_SRC, PI_SRC]) {
      expect(src).not.toMatch(/apiPost|apiPut|apiDelete|method:\s*'POST'/);
      expect(src).not.toMatch(/\/research|\/rerun|\/run\b/);
    }
  });
});
