// Acquisition Workspace V2 — the canonical comp universe must actually reach
// the operator surface.
//
// Node-safe source-contract test (the LandOS vitest setup has no DOM), guarding
// the exact wiring defect that made the Comps & Valuation surface show ZERO
// comparables while the canonical read model held the full persisted candidate
// universe:
//
//   1. The Property & Market inner view was derived at render time from
//      window.location.search. Both inner views share ONE top-level section, so
//      switching between them left `section` unchanged, nothing re-rendered,
//      and the URL said comps-valuation while the property view stayed mounted.
//      The comps workspace never rendered at all.
//   2. The comps section seeded its projection into component state once at
//      mount and never adopted a later one, so a projection that arrived or was
//      refreshed after mount was silently ignored.
//
// Both are the same root: the comp display path must track the canonical
// projection and the canonical URL instead of a one-time snapshot of either.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');

describe('the comps surface renders the canonical persisted comp universe', () => {
  it('holds the Property & Market inner view in state, not a render-time URL read', () => {
    // A bare `const propertyMarketView = readPropertyMarketView(...)` is the
    // defect: it only re-evaluates when something else re-renders the page.
    expect(PAGE_SRC).not.toMatch(/const\s+propertyMarketView\s*=\s*readPropertyMarketView\(/);
    expect(PAGE_SRC).toMatch(/useState<PropertyMarketView>\(\s*\n?\s*\(\)\s*=>\s*readPropertyMarketView\(/);
  });

  it('re-derives BOTH the section and the inner view from the URL on every nav change', () => {
    expect(PAGE_SRC).toMatch(/setSection\(readSection\(window\.location\.search\)\)/);
    expect(PAGE_SRC).toMatch(/setPropertyMarketView\(readPropertyMarketView\(window\.location\.search\)\)/);
    // Both the click path and back/forward go through the same sync.
    const switchBody = PAGE_SRC.slice(PAGE_SRC.indexOf('const switchSection'));
    expect(switchBody.slice(0, 600)).toMatch(/syncNavFromUrl\(\)/);
    const popBody = PAGE_SRC.slice(PAGE_SRC.indexOf('const onPop'));
    expect(popBody.slice(0, 200)).toMatch(/syncNavFromUrl\(\)/);
  });

  it('renders the comps section only from the canonical page projection', () => {
    expect(PAGE_SRC).toMatch(/<CompsValuationSection[^>]*initial=\{compsValuation\}/);
    expect(PAGE_SRC).toMatch(/setCompsValuation\(i\?\.propertyIntelligence\?\.compsValuation \?\? null\)/);
  });

  it('adopts a newer canonical projection instead of keeping its mount-time snapshot', () => {
    expect(CV_SRC).toMatch(/seeded\s*=\s*useRef<CompsValuationViewData \| null>\(initial\)/);
    expect(CV_SRC).toMatch(/if \(initial !== seeded\.current\)/);
    expect(CV_SRC).toMatch(/if \(initial && initial !== view\) setView\(initial\)/);
  });

  it('keeps every retained classification visible: category never removes a candidate', () => {
    // Core / Directional / Excluded evidence is retained evidence. Filters
    // group the universe; the "All" filter must still show every record, and
    // excluded rows keep their own visible group.
    expect(CV_SRC).toMatch(/key: 'all', label: 'All', match: \(\) => true/);
    expect(CV_SRC).toMatch(/key: 'excluded', label: 'Excluded', match: isExcluded/);
    expect(CV_SRC).toMatch(/key: 'improved', label: 'Improved context', match: isImproved/);
  });

  it('never fetches or reruns research when the comps surface opens', () => {
    // Opening/refreshing the card READS. The only POSTs in the comps section
    // are explicit operator actions (valuation selection, location resolve).
    expect(CV_SRC).not.toMatch(/useEffect\([^)]*apiGet/);
    expect(CV_SRC).not.toMatch(/apiPost\([^)]*\/(run|research|comps-run)/);
  });
});
