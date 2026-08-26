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
  it('holds the active deal page in state, not a render-time URL read', () => {
    // A bare `const page = readPage(...)` is the defect: it only re-evaluates
    // when something else re-renders the page.
    expect(PAGE_SRC).not.toMatch(/const\s+page\s*=\s*readPage\(/);
    expect(PAGE_SRC).toMatch(/useState<WorkspaceV2Page>\(\(\) => readPage\(/);
  });

  it('re-derives the page from the URL on every nav change', () => {
    expect(PAGE_SRC).toMatch(/setPage\(readPage\(window\.location\.search\)\)/);
    // Both the click path and back/forward go through the same sync.
    const switchBody = PAGE_SRC.slice(PAGE_SRC.indexOf('const switchPage'));
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

  it('names real comparable properties before any valuation reasoning', () => {
    // A count is not evidence. The comps surface must open on actual retained
    // properties — address, acreage, price, $/acre, date, classification — not
    // on three screens of narrative with the records far below the fold.
    const strip = CV_SRC.slice(CV_SRC.indexOf('id="actual-comparables"'));
    expect(CV_SRC.indexOf('id="actual-comparables"')).toBeGreaterThan(-1);
    // It renders BEFORE the full workspace, not after it.
    expect(CV_SRC.indexOf('id="actual-comparables"')).toBeLessThan(CV_SRC.indexOf('id="comparable-sales"'));
    const head = strip.slice(0, 4000);
    expect(head).toMatch(/\{c\.address/);
    expect(head).toMatch(/<i>Acres<\/i>/);
    expect(head).toMatch(/<i>\$ \/ acre<\/i>/);
    expect(head).toMatch(/c\.priceKind === 'sale' \? 'Sold price'/);
    expect(head).toMatch(/CompKindBadge identity=\{identity\}/);
    expect(head).toMatch(/conciseReason\(c\)/);
  });

  it('states the retained universe and the strict FMV set as two separate numbers', () => {
    expect(CV_SRC).toMatch(/\{comps\.length\} retained comp[\s\S]{0,80}\{summary\.acceptedCount\} strict FMV qualifying/);
    // The preview spans evidence classes, so a thin FMV set never reads as
    // "no comparables": qualifying sales, then improved context, then the rest.
    const preview = CV_SRC.slice(CV_SRC.indexOf('const previewComps'), CV_SRC.indexOf('const previewComps') + 1200);
    expect(preview).toMatch(/take\(\[\.\.\.valuationSet\]/);
    expect(preview).toMatch(/take\(comps\.filter\(isImproved\)/);
    expect(preview).toMatch(/take\(comps\.filter\(isActive\)/);
  });

  it('gives Property & diligence an unmistakable handoff, not a duplicate list', () => {
    expect(PAGE_SRC).toMatch(/data-testid="pi-comps-handoff"/);
    expect(PAGE_SRC).toMatch(/data-testid="pi-comps-handoff-retained"/);
    expect(PAGE_SRC).toMatch(/data-testid="pi-comps-handoff-qualifying"/);
    expect(PAGE_SRC).toMatch(/data-testid="pi-comps-handoff-open"[\s\S]{0,120}onClick=\{openCompsValuation\}/);
    // Counts and a link only — the diligence view must NOT render comp cards.
    const handoff = PAGE_SRC.slice(PAGE_SRC.indexOf('data-testid="pi-comps-handoff"'));
    expect(handoff.slice(0, 1400)).not.toMatch(/\.comps\.map\(/);
  });

  it('routes the handoff through the same nav sync, so the jump actually renders', () => {
    const onOpen = PAGE_SRC.slice(PAGE_SRC.indexOf('const onOpenSection'));
    expect(onOpen.slice(0, 700)).toMatch(/syncNavFromUrl\(\)/);
    expect(onOpen.slice(0, 700)).not.toMatch(/setSection\(readSection/);
  });

  it('never fetches or reruns research when the comps surface opens', () => {
    // Opening/refreshing the card READS. The only POSTs in the comps section
    // are explicit operator actions (valuation selection, location resolve).
    expect(CV_SRC).not.toMatch(/useEffect\([^)]*apiGet/);
    expect(CV_SRC).not.toMatch(/apiPost\([^)]*\/(run|research|comps-run)/);
  });
});
