// Tests for the read-only Zillow/Redfin browser comp researcher. Pure logic +
// a fake BrowserDriver (no network) prove the search strategy, acreage/geography
// expansion, honest blocker reporting, and never-fabricate behavior.

import { describe, it, expect } from 'vitest';
import type { BrowserDriver, BrowserPageRead } from './browser-intelligence.js';
import {
  acreageBandOf, geographyLadder, buildZillowLandUrl, buildRedfinLandUrl,
  parseCompsFromRead, researchBrowserComps, ACREAGE_BANDS,
} from './browser-comp-research.js';

describe('acreage bands', () => {
  it('has the eight required bands', () => {
    expect(ACREAGE_BANDS.map((b) => b.label)).toEqual([
      'under 0.5 ac', '0.5 to 1 ac', '1 to 2 ac', '2 to 5 ac', '5 to 10 ac', '10 to 20 ac', '20 to 50 ac', '50+ ac',
    ]);
  });
  it('classifies acreage into the right band', () => {
    expect(acreageBandOf(0.25)?.label).toBe('under 0.5 ac');
    expect(acreageBandOf(0.5)?.label).toBe('0.5 to 1 ac');
    expect(acreageBandOf(1.2)?.label).toBe('1 to 2 ac');
    expect(acreageBandOf(128.55)?.label).toBe('50+ ac');
    expect(acreageBandOf(null)).toBeNull();
    expect(acreageBandOf(undefined)).toBeNull();
  });
});

describe('geography ladder (priority zip -> city -> county)', () => {
  it('orders by locality precision and includes only what is available', () => {
    const g = geographyLadder({ zip: '76567', city: 'Winters', state: 'TX', county: 'Runnels' });
    expect(g.map((s) => s.level)).toEqual(['zip', 'city', 'county']);
  });
  it('falls back to state when nothing else, and empty when no location', () => {
    expect(geographyLadder({ state: 'TX' }).map((s) => s.level)).toEqual(['state']);
    expect(geographyLadder({})).toEqual([]);
  });
});

describe('URL builders (vacant land, sold/active, acreage band)', () => {
  const step = { level: 'city' as const, slug: 'Winters, TX', label: 'Winters, TX' };
  const band = acreageBandOf(3); // 2 to 5 ac
  it('Zillow: land filter, region, sold view, lot-size bounds', () => {
    const active = buildZillowLandUrl(step, { sold: false, band });
    expect(active).toContain('zillow.com');
    expect(active).toContain('/land/');
    expect(decodeURIComponent(active)).toContain('"land":{"value":true}');
    expect(decodeURIComponent(active)).toContain('"house":{"value":false}');
    expect(decodeURIComponent(active)).toContain('lotSize');
    const sold = buildZillowLandUrl(step, { sold: true, band });
    expect(sold).toContain('/sold/');
  });
  it('Redfin: property-type=land, include=sold, min/max lot-size', () => {
    const active = buildRedfinLandUrl(step, { sold: false, band });
    expect(active).toContain('redfin.com');
    expect(active).toContain('property-type=land');
    expect(active).not.toContain('include=sold');
    expect(active).toContain('min-lot-size=');
    const sold = buildRedfinLandUrl(step, { sold: true, band });
    expect(sold).toContain('include=sold-3yr');
  });
});

describe('parseCompsFromRead (best-effort, never fabricates)', () => {
  it('extracts price + acres + ppa and detects sold status', () => {
    const read: BrowserPageRead = { url: 'https://redfin.com/x', fields: {}, snippets: [
      '42 results',
      '$120,000 5 acres 123 Ranch Rd, Winters TX — SOLD',
      '$60,000 2.5 acres Lot 4 County Line Rd',
    ] };
    const r = parseCompsFromRead('redfin', read, { status: 'active' });
    expect(r.visibleResultCount).toBe(42);
    expect(r.comps.length).toBe(2);
    expect(r.comps[0].price).toBe(120000);
    expect(r.comps[0].acres).toBe(5);
    expect(r.comps[0].pricePerAcre).toBe(24000);
    expect(r.comps[0].status).toBe('sold');
    expect(r.comps[1].status).toBe('active');
  });
  it('flags captcha / bot walls as blocked, extracts nothing', () => {
    const read: BrowserPageRead = { url: 'z', fields: {}, snippets: ['Press & Hold to confirm you are human'] };
    const r = parseCompsFromRead('zillow', read, { status: 'active' });
    expect(r.blocked).toBe('blocked_by_site');
    expect(r.comps).toEqual([]);
  });
  it('flags login walls as captcha_or_login', () => {
    const read: BrowserPageRead = { url: 'z', fields: {}, snippets: ['Sign in to see sold home prices'] };
    expect(parseCompsFromRead('zillow', read, { status: 'sold' }).blocked).toBe('captcha_or_login');
  });
});

// ── Fake driver ──────────────────────────────────────────────────────────────
function fakeDriver(handler: (url: string) => BrowserPageRead, opts: { configured?: boolean } = {}): BrowserDriver {
  return {
    id: 'fake',
    configured: () => opts.configured !== false,
    open: async (url: string) => handler(url),
    search: async () => ({ url: '', fields: {}, snippets: [] }),
    readFields: async () => ({ url: '', fields: {}, snippets: [] }),
    screenshot: async (purpose: string) => ({ path: `/tmp/${purpose}.png`, purpose } as never),
  } as unknown as BrowserDriver;
}

describe('researchBrowserComps orchestration', () => {
  it('records attempts for BOTH Zillow and Redfin with a real search path', async () => {
    const driver = fakeDriver((url) => ({ url, fields: {}, snippets: ['$100,000 3 acres 10 Ranch Rd, Winters TX'] }));
    const res = await researchBrowserComps({ city: 'Winters', state: 'TX', zip: '76567', county: 'Runnels', acres: 3 }, { driver, targetCount: 5 });
    const sources = new Set(res.attempts.map((a) => a.source));
    expect(sources.has('zillow')).toBe(true);
    expect(sources.has('redfin')).toBe(true);
    expect(res.searchPath.length).toBeGreaterThan(0);
    expect(res.searchPath.some((s) => /sold/.test(s))).toBe(true);
    expect(res.comps.length).toBeGreaterThan(0);
    expect(res.filtersUsed.some((f) => /vacant land/i.test(f))).toBe(true);
  });

  it('reports a site block honestly without fabricating comps', async () => {
    const driver = fakeDriver((url) => ({ url, fields: {}, snippets: ['captcha: verify you are a human'] }));
    const res = await researchBrowserComps({ zip: '76567', state: 'TX', acres: 3 }, { driver });
    expect(res.comps).toEqual([]);
    expect(res.strength).toBe('unavailable');
    expect(res.attempts.every((a) => a.outcome === 'blocked_by_site')).toBe(true);
    expect(res.summary).toMatch(/Not fabricated|No usable comps/i);
  });

  it('captures a screenshot when extraction is blocked/partial', async () => {
    const driver = fakeDriver((url) => ({ url, fields: {}, snippets: ['captcha'] }));
    const res = await researchBrowserComps({ zip: '76567', state: 'TX' }, { driver });
    expect(res.attempts.some((a) => a.screenshotPath && a.screenshotPath.endsWith('.png'))).toBe(true);
  });

  it('degrades honestly when no live browser session is available', async () => {
    const res = await researchBrowserComps({ zip: '76567', state: 'TX', acres: 3 }, { driver: undefined });
    expect(res.attempts.every((a) => a.outcome === 'not_configured')).toBe(true);
    expect(res.summary).toMatch(/no live browser session/i);
  });

  it('records acreage expansion when the subject band is empty but all-acreage has results', async () => {
    // Band URLs carry a lot-size filter; all-acreage URLs do not.
    const driver = fakeDriver((url) => {
      const isBand = /lotSize|min-lot-size/.test(decodeURIComponent(url));
      return { url, fields: {}, snippets: isBand ? [] : ['$90,000 8 acres 5 Field Rd'] };
    });
    const res = await researchBrowserComps({ zip: '76567', state: 'TX', acres: 3 }, { driver, targetCount: 5 });
    expect(res.acreageExpanded).toBe(true);
    expect(res.comps.length).toBeGreaterThan(0);
  });

  it('records geography expansion when the ZIP is empty but the city has results', async () => {
    const driver = fakeDriver((url) => {
      const isZip = /zipcode\/\d{5}|zillow\.com\/\d{5}\//.test(url);
      return { url, fields: {}, snippets: isZip ? [] : ['$75,000 4 acres 9 County Rd'] };
    });
    const res = await researchBrowserComps({ zip: '76567', city: 'Winters', state: 'TX', acres: 3 }, { driver, targetCount: 5 });
    expect(res.geographyExpanded).toBe(true);
  });

  it('returns unavailable with an honest summary when there is no location', async () => {
    const res = await researchBrowserComps({ acres: 3 }, { driver: fakeDriver(() => ({ url: '', fields: {}, snippets: [] })) });
    expect(res.strength).toBe('unavailable');
    expect(res.comps).toEqual([]);
    expect(res.summary).toMatch(/no address, ZIP, city\/state, or county/i);
  });
});
