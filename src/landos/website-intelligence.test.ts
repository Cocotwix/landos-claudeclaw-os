import { describe, it, expect, beforeEach } from 'vitest';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  scoreResultCandidate, pickBestCandidate, type PageObservation, type ResultCandidate,
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
