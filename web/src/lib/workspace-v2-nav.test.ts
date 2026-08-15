import { describe, expect, it } from 'vitest';

import {
  readSection, readPropertyMarketView, sectionHref, SECTION_SLUGS,
  dealWorkspaceHref, lastWorkspaceDealId, rememberWorkspaceDeal, WORKSPACE_V2_PATH,
} from './workspace-v2-nav';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

describe('workspace V2 section navigation', () => {
  it('derives the section from the URL, defaulting to Overview', () => {
    expect(readSection('')).toBe('Overview');
    expect(readSection('?deal=81')).toBe('Overview');
    expect(readSection('?deal=81&section=property-market')).toBe('Property & Market');
    expect(readSection('?deal=81&section=property-intelligence')).toBe('Property & Market');
    expect(readSection('?deal=81&section=comps-valuation')).toBe('Property & Market');
    expect(readSection('?deal=81&section=deal-activity')).toBe('Deal Activity');
    expect(readSection('?deal=81&section=unknown-section')).toBe('Overview');
  });

  it('keeps the Property & Market internal view in the URL without creating another top-level workspace', () => {
    expect(readPropertyMarketView('?section=property-intelligence')).toBe('property-intelligence');
    expect(readPropertyMarketView('?section=comps-valuation')).toBe('comps-valuation');
    expect(readPropertyMarketView('?section=property-market')).toBe('property-intelligence');
  });

  it('builds section hrefs that preserve every other query param', () => {
    expect(sectionHref('/dept/acquisitions/v2', '?deal=81', 'property-intelligence'))
      .toBe('/dept/acquisitions/v2?deal=81&section=property-intelligence');
    expect(sectionHref('/dept/acquisitions/v2', '?deal=81&section=property-intelligence', 'overview'))
      .toBe('/dept/acquisitions/v2?deal=81');
  });

  it('keeps Overview as the canonical bare URL (no section param)', () => {
    expect(sectionHref('/dept/acquisitions/v2', '', 'overview')).toBe('/dept/acquisitions/v2');
    expect(sectionHref('/dept/acquisitions/v2', '?section=property-intelligence', 'overview'))
      .toBe('/dept/acquisitions/v2');
  });

  it('round-trips every real section through href and back', () => {
    for (const [label, slug] of Object.entries(SECTION_SLUGS)) {
      const href = sectionHref('/dept/acquisitions/v2', '?deal=81', slug);
      const search = href.includes('?') ? href.slice(href.indexOf('?')) : '';
      expect(readSection(search)).toBe(label);
    }
  });
});

describe('workspace V2 canonical deal routing', () => {
  it('builds the canonical V2 href for a deal, identity preserved', () => {
    expect(dealWorkspaceHref(81, memStore())).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
  });

  it('restores the most recently used section for the same deal this session', () => {
    const store = memStore();
    rememberWorkspaceDeal(81, 'property-intelligence', store);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81&section=property-intelligence`);
    // Overview stays the canonical bare URL.
    rememberWorkspaceDeal(81, 'overview', store);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
    // A different deal has no remembered section.
    expect(dealWorkspaceHref(82, store)).toBe(`${WORKSPACE_V2_PATH}?deal=82`);
  });

  it('never writes an unknown section slug into the URL', () => {
    const store = memStore();
    rememberWorkspaceDeal(81, 'not-a-real-section', store);
    expect(dealWorkspaceHref(81, store)).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
  });

  it('tracks the last deal worked in V2 for the permanent Acquisitions entry', () => {
    const store = memStore();
    expect(lastWorkspaceDealId(store)).toBe(null);
    rememberWorkspaceDeal(81, 'overview', store);
    rememberWorkspaceDeal(93, 'property-intelligence', store);
    expect(lastWorkspaceDealId(store)).toBe(93);
  });

  it('is node-safe when no session storage exists', () => {
    expect(lastWorkspaceDealId(null)).toBe(null);
    expect(dealWorkspaceHref(81, null)).toBe(`${WORKSPACE_V2_PATH}?deal=81`);
    expect(() => rememberWorkspaceDeal(81, 'overview', null)).not.toThrow();
  });
});
