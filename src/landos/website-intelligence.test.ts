import { describe, it, expect, beforeEach } from 'vitest';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  scoreResultCandidate, pickBestCandidate, classifySurface, pageServesTask,
  findWorkSurfaceNav, deriveTaskBoundary, isForbiddenTarget,
  rankSearchMethods, isFullStreetAddress,
  type PageObservation, type ResultCandidate,
} from './website-intelligence.js';
import { rememberPlatform, getPlatformIntel, platformKey, listPlatformIntel } from './platform-library.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import type { BrowserDriver } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

function obs(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://landportal.com/', title: '', headings: [], navItems: [], searchControls: [], buttons: [],
    links: [], hasMap: false, hasTable: false, fields: {}, loginLike: false, ...over,
  };
}

describe('Website Intelligence — UNDERSTAND (classify + detect search methods)', () => {
  it('classifies a map/GIS property platform and detects its search methods', () => {
    const u = understandPlatform(obs({
      title: 'Land Portal | Land Investing & GIS Mapping Software',
      navItems: ['Map Search', 'Property search', 'Saved lists', 'Market research', 'Slope reports'],
      hasMap: true,
      searchControls: [{ selector: '#method', type: 'select-one', options: ['Address', 'APN', 'Owner', 'Latitude / Longitude'] }, { selector: '#q', placeholder: 'Search' }],
    }));
    expect(u.platformClass).toBe('gis_map');
    expect(u.availableSearchMethods).toEqual(expect.arrayContaining(['apn', 'address', 'owner', 'latlng']));
    expect(u.confidence).not.toBe('low');
  });

  it('classifies an assessor record site', () => {
    expect(understandPlatform(obs({ title: 'White County Board of Assessors', headings: ['Property Record Card'] })).platformClass).toBe('county_assessor');
  });

  it('finds guidance links for research', () => {
    const g = findGuidanceLinks(obs({ links: [{ text: 'Help Center', href: 'https://x/help' }, { text: 'Pricing', href: 'https://x/p' }] }));
    expect(g.map((l) => l.text)).toContain('Help Center');
  });
});

describe('Website Intelligence — evidence-driven search strategy (rankSearchMethods)', () => {
  const first = (k: Parameters<typeof rankSearchMethods>[0]) => rankSearchMethods(k)[0]?.method;

  it('APN present → APN/Parcel-ID search starts (strongest key), even with an address too', () => {
    expect(first({ apn: '094-020.08' })).toBe('apn');
    expect(first({ apn: '094-020.08', address: '2510 State Highway 153', owner: 'Jane Doe' })).toBe('apn');
  });

  it('full street address, no APN → address search starts', () => {
    expect(first({ address: '388 Gilstrap Rd, Cleveland GA' })).toBe('address');
    expect(rankSearchMethods({ address: '388 Gilstrap Rd' })[0].role).toBe('primary');
  });

  it('owner only, no stronger identifier → owner search starts', () => {
    expect(first({ owner: 'Henson Family Trust' })).toBe('owner');
  });

  it('mixed input → strongest identifier starts, weaker ones are fallback/cross-check', () => {
    const r = rankSearchMethods({ apn: '094 02008 000', address: '2510 State Highway 153', owner: 'Jane Doe' });
    expect(r.map((m) => m.method)).toEqual(['apn', 'address', 'owner']);
    expect(r[0].role).toBe('primary');
    expect(r.slice(1).every((m) => m.role === 'fallback')).toBe(true);
  });

  it('owner beats a BARE road name (no house number is a weak address)', () => {
    // Henson Lane has no house number → owner is the stronger start.
    const r = rankSearchMethods({ owner: 'Henson Family Trust', address: 'Henson Lane' });
    expect(r.map((m) => m.method)).toEqual(['owner', 'address']);
    expect(isFullStreetAddress('Henson Lane')).toBe(false);
    expect(isFullStreetAddress('2510 State Highway 153')).toBe(true);
  });

  it('is EVIDENCE-DRIVEN, not a fixed order — the starting method changes with the intake', () => {
    expect(first({ apn: 'A1', address: '1 Main St', owner: 'X' })).toBe('apn');
    expect(first({ address: '1 Main St', owner: 'X' })).toBe('address');
    expect(first({ owner: 'X' })).toBe('owner');
    expect(rankSearchMethods({})).toEqual([]); // nothing to search — no fabricated method
  });
});

describe('Website Intelligence — PLAN (choose method by identifier, not first input)', () => {
  it('switches a method selector to APN, then fills + submits (no assuming Address)', () => {
    const o = obs({ searchControls: [{ selector: '#method', type: 'select-one', options: ['Address', 'APN', 'Owner'] }, { selector: '#term', placeholder: 'Search' }] });
    const s = planNavigationStrategy(o, { kind: 'apn', value: '021 033 002' })!;
    expect(s.method).toBe('apn');
    expect(s.steps[0]).toMatchObject({ action: 'select_method', selector: '#method' });
    expect(s.steps.find((x) => x.action === 'fill')!.value).toBe('021 033 002');
    expect(s.steps.some((x) => x.action === 'submit')).toBe(true);
  });

  it('prefers an input whose label matches the identifier kind', () => {
    const o = obs({ searchControls: [{ selector: '#addr', label: 'Address' }, { selector: '#apn', label: 'Parcel ID' }] });
    expect(planNavigationStrategy(o, { kind: 'apn', value: 'X' })!.steps.find((s) => s.action === 'fill')!.selector).toBe('#apn');
  });

  it('returns null when there is no usable search control', () => {
    expect(planNavigationStrategy(obs({ searchControls: [] }), { kind: 'apn', value: 'X' })).toBeNull();
  });

  it('uses a CUSTOM method toggle (Address ▾ → APN) before filling the search box', () => {
    const o = obs({ methodToggle: { current: 'Address' }, searchControls: [{ selector: '#q', placeholder: 'Address or zip or city' }] });
    const s = planNavigationStrategy(o, { kind: 'apn', value: '021 033 002' })!;
    const clicks = s.steps.filter((x) => x.action === 'click').map((x) => x.text);
    expect(clicks).toEqual(['Address', 'APN']); // open toggle, pick APN
    expect(s.steps.find((x) => x.action === 'fill')!.selector).toBe('#q');
  });
});

describe('Website Intelligence — VERIFY (never extract from a search form)', () => {
  it('rejects a search/filter form (the LandPortal false-fact case)', () => {
    const v = verifyTargetReached(obs({
      searchControls: [{ selector: '#a' }, { selector: '#b' }, { selector: '#c' }, { selector: '#d' }, { selector: '#e' }],
      fields: { 'APN': 'Is Is Not Is', 'Mailing': 'E N NE NW S SE SW W', 'Tax status': 'N/A Yes No', 'Tokens': 'Tokens × 25000' },
    }));
    expect(v.reached).toBe(false);
    expect(v.pageType).toBe('search_form');
  });

  it('accepts a real record detail page', () => {
    const v = verifyTargetReached(obs({
      fields: { 'Owner Name': 'SPROUL, BRITTANY', 'Parcel ID': '021 033 002', 'Deeded Acres': '5.20', 'Assessed Total': '$42,000' },
    }), { expectIdentifier: '021 033 002' });
    expect(v.reached).toBe(true);
    expect(v.pageType).toBe('record_detail');
  });

  it('rejects login + map dashboard pages', () => {
    expect(verifyTargetReached(obs({ loginLike: true })).pageType).toBe('login');
    expect(verifyTargetReached(obs({ hasMap: true, fields: {} })).reached).toBe(false);
  });
});

describe('Website Intelligence — TASK SURFACE + BOUNDARY (reach the right page, avoid forbidden)', () => {
  it('classifies the LandPortal orders page as the wrong surface', () => {
    const o = obs({ url: 'https://landportal.com/my-account/orders/', title: 'My account - Land Portal', headings: ['Orders history'] });
    expect(classifySurface(o)).toBe('orders');
    expect(pageServesTask(o, 'apn')).toBe(false); // cannot do parcel search here
  });

  it('treats billing/orders/purchase nav as FORBIDDEN, map/property search as the work surface', () => {
    expect(isForbiddenTarget('Orders history')).toBe(true);
    expect(isForbiddenTarget('Billing')).toBe(true);
    expect(isForbiddenTarget('Buy Skip Trace')).toBe(true);
    expect(isForbiddenTarget('Map Search')).toBe(false);
    const o = obs({ navItems: ['Hide Sidebar', 'Map Search', 'Orders history', 'Billing', 'Skip trace', 'Help Center'] });
    expect(findWorkSurfaceNav(o, 'apn')!.text).toBe('Map Search'); // never a forbidden target
  });

  it('derives a platform task boundary (allowed / forbidden)', () => {
    const o = obs({ navItems: ['Map Search', 'Property search', 'Market research', 'Orders history', 'Billing', 'Skip trace purchase'] });
    const b = deriveTaskBoundary(o);
    expect(b.allowed).toEqual(expect.arrayContaining(['Map Search', 'Property search', 'Market research']));
    expect(b.forbidden).toEqual(expect.arrayContaining(['Orders history', 'Billing']));
  });

  it('a search surface with a matching control serves the task', () => {
    const o = obs({ title: 'Map Search', searchControls: [{ selector: '#apn', label: 'APN' }], hasMap: true });
    expect(pageServesTask(o, 'apn')).toBe(true);
  });
});

// Driver that LANDS on orders, then (after clicking Map Search) exposes an APN
// search that resolves straight to the parcel record.
function landsOnOrdersDriver(onNav?: (t: string) => void): BrowserDriver {
  let phase: 'orders' | 'search' | 'record' = 'orders';
  const record = { 'Owner Name': 'SPROUL, BRITTANY', 'Parcel ID': '021 033 002', 'Deeded Acres': '5.20', 'Situs Address': '388 Gilstrap Rd' };
  return {
    id: 'lp', configured: () => true,
    async open(url) { return { url, fields: {}, snippets: [] }; },
    async search(q) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: phase === 'record' ? record : {}, snippets: [] }; },
    async screenshot(purpose) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
    async readForms() { return phase === 'search' ? [{ formIndex: 0, fields: [{ selector: '#apn', label: 'APN' }], submitSelector: '#go' }] : []; },
    async fillAndSubmit() { if (phase === 'search') phase = 'record'; return { url: 'rec', fields: {}, snippets: [] }; },
    async observe() {
      if (phase === 'orders') return { url: 'https://landportal.com/my-account/orders/', title: 'My account - Land Portal', headings: ['Orders history'], navItems: ['Map Search', 'Orders history', 'Billing'], buttons: [], searchControls: [], links: [], hasMap: true, hasTable: true, fields: { 'Order ID': '#638785' }, loginLike: false };
      if (phase === 'search') return { url: 'https://landportal.com/map-search', title: 'Map Search', headings: ['Map Search'], navItems: ['Map Search', 'Orders history'], buttons: [], searchControls: [{ selector: '#apn', label: 'APN' }], links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false };
      return { url: 'https://landportal.com/parcel', title: 'Parcel detail', headings: ['Property Record'], navItems: [], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false, fields: record, loginLike: false };
    },
    async clickByText(text) { onNav?.(text); if (/map search/i.test(text)) phase = 'search'; },
  };
}

describe('Website Intelligence — wrong-surface recovery (orders → Map Search → record)', () => {
  beforeEach(() => _initTestLandosDb());
  it('recognizes the orders page, navigates to Map Search, then reaches the parcel record', async () => {
    const navs: string[] = [];
    const lp = makeLandPortalBrowser({ driver: landsOnOrdersDriver((t) => navs.push(t)) });
    const ev = await lp.runWorkflow({ searchKey: { state: 'GA', county: 'White', apn: '021 033 002' } }, { timeoutMs: 2000 });
    expect(navs).toContain('Map Search');      // corrected the surface
    expect(navs).not.toContain('Billing');     // never touched forbidden
    expect(ev.status).toBe('retrieved');
    expect(ev.facts.find((f) => f.key === 'owner')!.value).toBe('SPROUL, BRITTANY');
    // learned the task boundary
    const b = getPlatformIntel('landportal.com')!.taskBoundary;
    expect(b.forbidden).toEqual(expect.arrayContaining(['Orders history', 'Billing']));
  });
});

describe('Website Intelligence — INTERACT (non-anchor result selection, no weak-match)', () => {
  const cands = (xs: Array<[number, string]>): ResultCandidate[] => xs.map(([index, text]) => ({ index, text, kind: 'row' }));

  it('scores an APN result as high confidence', () => {
    const s = scoreResultCandidate({ index: 0, text: 'Parcel 021 033 002 — White County GA', kind: 'row' }, { apn: '021 033 002', county: 'White', state: 'GA' });
    expect(s.confidence).toBe('high');
    expect(s.matched).toContain('apn');
  });

  it('scores a full number+street address as high; street-only is NOT high', () => {
    expect(scoreResultCandidate({ index: 0, text: '388 Gilstrap Rd, Cleveland GA', kind: 'row' }, { address: '388 Gilstrap Rd' }).confidence).toBe('high');
    expect(scoreResultCandidate({ index: 1, text: 'Gilstrap Rd parcels', kind: 'row' }, { address: '388 Gilstrap Rd' }).confidence).not.toBe('high');
  });

  it('owner-only / county-only never reaches high confidence (no weak-match)', () => {
    expect(scoreResultCandidate({ index: 0, text: 'SPROUL parcels in White County', kind: 'row' }, { owner: 'SPROUL', county: 'White' }).confidence).not.toBe('high');
  });

  it('pickBestCandidate selects the high-confidence APN row and rejects no-match sets', () => {
    const best = pickBestCandidate(cands([[0, 'Some other parcel'], [1, 'APN 021 033 002 White GA']]), { apn: '021 033 002', county: 'White', state: 'GA' });
    expect(best!.index).toBe(1);
    expect(pickBestCandidate(cands([[0, 'Unrelated A'], [1, 'Unrelated B']]), { apn: '021 033 002' })).toBeNull();
  });
});

// Fake LandPortal driver: search lands on a results_list with NON-ANCHOR rows;
// clicking the APN row opens the parcel detail panel.
function gisFakeDriver(onClick?: (i: number) => void): BrowserDriver {
  let opened = false;
  const record = { 'Owner Name': 'SPROUL, BRITTANY', 'Parcel ID': '021 033 002', 'Deeded Acres': '5.20', 'Situs Address': '388 Gilstrap Rd' };
  const baseObs = () => ({ url: 'https://landportal.com/', title: 'Land Portal', headings: [], navItems: ['Map Search', 'Property search'], buttons: [], links: [], hasMap: true, hasTable: false, loginLike: false });
  return {
    id: 'lp', configured: () => true,
    async open(url) { return { url, fields: {}, snippets: [] }; },
    async search(q) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: opened ? record : {}, snippets: [] }; },
    async screenshot(purpose) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
    async readForms() { return [{ formIndex: 0, fields: [{ selector: '#apn', label: 'APN' }], submitSelector: '#go' }]; },
    async fillAndSubmit() { return { url: 'results', fields: {}, snippets: [] }; },
    async observe() {
      if (opened) return { ...baseObs(), hasMap: false, searchControls: [], fields: record };
      // results_list: has a table-like result set, NON-anchor rows (no links)
      return { ...baseObs(), hasTable: true, searchControls: [{ selector: '#apn', label: 'APN' }], fields: {}, links: [] };
    },
    async readCandidates() { return [{ index: 0, text: 'Parcel 044 000 111 — other', kind: 'row' }, { index: 1, text: 'Parcel 021 033 002 — 388 Gilstrap Rd, White GA', kind: 'row' }]; },
    async clickCandidate(i) { onClick?.(i); opened = true; },
  };
}

describe('Website Intelligence — LIVE-shaped non-anchor workflow (GIS results → record)', () => {
  beforeEach(() => _initTestLandosDb());
  it('reads candidates, selects the high-confidence parcel row, reaches the record, extracts', async () => {
    let clicked = -1;
    const lp = makeLandPortalBrowser({ driver: gisFakeDriver((i) => { clicked = i; }) });
    const ev = await lp.runWorkflow({ searchKey: { state: 'GA', county: 'White', apn: '021 033 002', address: '388 Gilstrap Rd' } }, { timeoutMs: 2000 });
    expect(clicked).toBe(1); // selected the matching row, not row 0
    expect(ev.status).toBe('retrieved');
    const owner = ev.facts.find((f) => f.key === 'owner');
    expect(owner!.value).toBe('SPROUL, BRITTANY');
    expect(owner!.extractionMethod).toMatch(/non-anchor result/);
    // REMEMBERED the validated interaction strategy
    expect(getPlatformIntel('landportal.com')!.validatedStrategy!.steps.some((s) => s.action === 'click')).toBe(true);
  });

  it('refuses to select when no candidate is a high-confidence match (no false facts)', async () => {
    const driver = gisFakeDriver();
    (driver as any).readCandidates = async () => [{ index: 0, text: 'Parcel 999 000 000 elsewhere', kind: 'row' }];
    const lp = makeLandPortalBrowser({ driver });
    const ev = await lp.runWorkflow({ searchKey: { state: 'GA', county: 'White', apn: '021 033 002' } }, { timeoutMs: 2000 });
    expect(ev.status).toBe('partial');
    expect(ev.facts).toHaveLength(0);
    expect(ev.note).toMatch(/no weak-match|HIGH-confidence/i);
  });
});

describe('Platform Intelligence Library — REMEMBER + IMPROVE', () => {
  beforeEach(() => _initTestLandosDb());
  it('normalizes a platform key (host, no www)', () => {
    expect(platformKey('https://www.landportal.com/foo')).toBe('landportal.com');
  });
  it('learns a platform and improves with usage', () => {
    rememberPlatform('https://landportal.com', { classification: 'gis_map', searchMethods: ['apn', 'address', 'owner', 'latlng'], authRequired: true, confidence: 'high', used: true });
    let p = getPlatformIntel('landportal.com')!;
    expect(p.classification).toBe('gis_map');
    expect(p.searchMethods).toContain('apn');
    expect(p.timesUsed).toBe(1);
    // Validating a strategy bumps success + records it for reuse.
    rememberPlatform('landportal.com', { validatedStrategy: { method: 'apn', steps: [{ action: 'fill', selector: '#q', value: 'X' }], reason: 'apn search' }, used: true, succeeded: true, validatedNow: true });
    p = getPlatformIntel('landportal.com')!;
    expect(p.timesUsed).toBe(2);
    expect(p.timesSucceeded).toBe(1);
    expect(p.validatedStrategy!.method).toBe('apn');
    expect(p.lastValidatedAt).toBeGreaterThan(0);
    expect(listPlatformIntel().length).toBe(1);
  });
});
