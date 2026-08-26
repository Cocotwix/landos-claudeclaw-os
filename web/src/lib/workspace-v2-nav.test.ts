import { describe, expect, it } from 'vitest';

import {
  readPage, pageHref, DEAL_PAGES,
  dealWorkspaceHref, lastWorkspaceDealId, rememberWorkspaceDeal, WORKSPACE_V2_PATH,
} from './workspace-v2-nav';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

describe('workspace V2 deal-page navigation', () => {
  it('exposes exactly the seven deal pages, in sidebar order', () => {
    expect(DEAL_PAGES.map((p) => p.slug)).toEqual([
      'overview', 'property', 'market', 'comps', 'strategy', 'seller', 'documents',
    ]);
    expect(DEAL_PAGES.map((p) => p.label)).toEqual([
      'Overview', 'Property', 'Market', 'Comps & Valuation',
      'Strategy & Underwriting', 'Seller & Activity', 'Documents',
    ]);
  });

  it('derives the page from the URL, defaulting to Overview', () => {
    expect(readPage('')).toBe('overview');
    expect(readPage('?deal=81')).toBe('overview');
    for (const { slug } of DEAL_PAGES) {
      expect(readPage(`?deal=81&page=${slug}`)).toBe(slug);
    }
    expect(readPage('?deal=81&page=unknown-page')).toBe('overview');
  });

  it('maps every legacy section deep link to its owning page', () => {
    expect(readPage('?deal=81&section=property-market')).toBe('property');
    expect(readPage('?deal=81&section=property-intelligence')).toBe('property');
    expect(readPage('?deal=81&section=comps-valuation')).toBe('comps');
    expect(readPage('?deal=81&section=deal-activity')).toBe('seller');
    expect(readPage('?deal=81&section=overview')).toBe('overview');
    expect(readPage('?deal=81&section=unknown-section')).toBe('overview');
  });

  it('builds page hrefs that preserve every other query param and drop legacy section params', () => {
    expect(pageHref('/dept/acquisitions/v2', '?deal=81', 'property'))
      .toBe('/dept/acquisitions/v2?deal=81&page=property');
    expect(pageHref('/dept/acquisitions/v2', '?deal=81&section=property-intelligence', 'market'))
      .toBe('/dept/acquisitions/v2?deal=81&page=market');
    expect(pageHref('/dept/acquisitions/v2', '?deal=81&page=property', 'overview'))
      .toBe('/dept/acquisitions/v2?deal=81');
  });

  it('keeps Overview as the canonical bare URL (no page param)', () => {
    expect(pageHref('/dept/acquisitions/v2', '', 'overview')).toBe('/dept/acquisitions/v2');
    expect(pageHref('/dept/acquisitions/v2', '?page=comps', 'overview'))
      .toBe('/dept/acquisitions/v2');
  });

  it('round-trips every deal page through href and back', () => {
    for (const { slug } of DEAL_PAGES) {
      const href = pageHref('/dept/acquisitions/v2', '?deal=81', slug);
      const search = href.includes('?') ? href.slice(href.indexOf('?')) : '';
      expect(readPage(search)).toBe(slug);
    }
  });
});

describe('workspace V2 canonical deal routing', () => {
  it('builds the canonical V2 href for a deal, identity preserved', () => {
    expect(dealWorkspaceHref(81, memStore())).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
  });

  it('restores the most recently used page for the same deal this session', () => {
    const store = memStore();
    rememberWorkspaceDeal(81, 'comps', store);
    expect(lastWorkspaceDealId(store)).toBe(81);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81&page=comps`);
  });

  it('maps a stored legacy section slug from a prior session to its owning page', () => {
    const store = memStore();
    rememberWorkspaceDeal(81, 'comps-valuation', store);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81&page=comps`);
  });

  it('keeps Overview canonical (bare) in restored hrefs', () => {
    const store = memStore();
    rememberWorkspaceDeal(81, 'overview', store);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
  });

  it('survives a missing store', () => {
    expect(dealWorkspaceHref(81, null)).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
    expect(lastWorkspaceDealId(null)).toBeNull();
  });
});
