import { describe, it, expect, beforeEach } from 'vitest';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  type PageObservation,
} from './website-intelligence.js';
import { rememberPlatform, getPlatformIntel, platformKey, listPlatformIntel } from './platform-library.js';
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
