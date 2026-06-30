import { describe, it, expect } from 'vitest';
import {
  routeBrowserQuestion, extractSearchKey, guardedAction, recordBlocked, emptyEvidence,
  makeParkedDriver, type BrowserDriver, type BrowserPageRead, type BrowserScreenshot,
} from './browser-intelligence.js';
import { ReadOnlyViolation } from './browser-retrieval.js';
import { makeLandPortalBrowser, extractLandPortalFields, landPortalBlockedExample, LANDPORTAL_SCREENSHOT_PURPOSE } from './landportal-browser.js';
import { makeCountyRecordsBrowser, countyStopExample } from './county-records-browser.js';
import { analyzeMissingFields } from './missing-field-analysis.js';
import { emptyNormalizedProperty, mergeNormalized } from './normalized-property.js';

// ── Fake LandPortal driver: returns a full property page read (configured live). ──
function fakeLandPortalDriver(): BrowserDriver & { screenshots: number } {
  const state = { screenshots: 0 };
  const propRead: BrowserPageRead = {
    url: 'https://www.landportal.com/property/388-gilstrap',
    fields: {
      'Property Address': '388 Gilstrap Rd', 'APN': '042 123', 'Owner': 'TEST OWNER',
      'County': 'White', 'State': 'GA', 'Acreage': '5.2 ac', 'Land Use': 'Vacant Residential',
      'FEMA': 'Zone X', 'Wetlands': 'None mapped', 'Road Frontage': '210 ft', 'Latitude': '34.59', 'Longitude': '-83.76',
    },
    snippets: ['Tax assessed value: $42,000'],
  };
  return {
    id: 'landportal-fake', screenshots: state.screenshots,
    configured() { return true; },
    async open() { return { url: 'https://www.landportal.com', fields: {}, snippets: [] }; },
    async search() { return propRead; },
    async readFields() { return propRead; },
    async screenshot(purpose): Promise<BrowserScreenshot> { state.screenshots += 1; (this as any).screenshots = state.screenshots; return { path: `/tmp/lp-${state.screenshots}.png`, capturedAtIso: '2026-06-29T00:00:00Z', purpose }; },
  };
}

describe('browser intelligence — ask-mode routing (not hardcoded commands)', () => {
  it('routes record questions to County Records and property questions to LandPortal', () => {
    expect(routeBrowserQuestion('Find the last recorded deed').service).toBe('county_records');
    expect(routeBrowserQuestion('Find the last recorded deed').intent).toBe('recorded_deed');
    expect(routeBrowserQuestion('Show me the tax history').intent).toBe('tax_history');
    expect(routeBrowserQuestion('Open the GIS map').intent).toBe('gis_map');
    expect(routeBrowserQuestion('Show me FEMA').service).toBe('landportal');
    expect(routeBrowserQuestion('Find zoning').intent).toBe('zoning');
    expect(routeBrowserQuestion('Find road frontage').intent).toBe('road_frontage');
    expect(routeBrowserQuestion('Find the mailing address').intent).toBe('mailing_address');
    expect(routeBrowserQuestion('Who owns this property?').intent).toBe('owner');
    expect(routeBrowserQuestion('Find subdivision restrictions').intent).toBe('subdivision_restrictions');
  });

  it('falls back to a full property workflow for unrecognized phrasing (never refuses)', () => {
    const r = routeBrowserQuestion('tell me everything about this lot');
    expect(r.intent).toBe('general');
    expect(r.service).toBe('landportal');
  });

  it('extracts the search key (APN / owner / address) from the question', () => {
    expect(extractSearchKey('Search this APN 042-123-09').apn).toContain('042-123-09');
    expect(extractSearchKey('Search owner: Cheryl Sann').owner).toMatch(/Cheryl/);
    expect(extractSearchKey('Search 388 Gilstrap Rd').address).toMatch(/Gilstrap/);
  });
});

describe('browser intelligence — read-only safety', () => {
  it('allows read-only actions and throws on forbidden ones', () => {
    expect(guardedAction('search')).toBe('search');
    expect(() => guardedAction('purchase')).toThrow(ReadOnlyViolation);
    expect(() => guardedAction('generate_paid_report')).toThrow(ReadOnlyViolation);
  });

  it('records a forbidden action as blocked (never performed)', () => {
    const ev = emptyEvidence('landportal', 'workflow');
    recordBlocked(ev, 'consume_credits');
    expect(ev.blocked[0].action).toBe('consume_credits');
    expect(ev.blocked[0].reason).toMatch(/Forbidden/i);
  });

  it('parked driver never opens a page or fabricates a read', async () => {
    const d = makeParkedDriver('x');
    expect(d.configured()).toBe(false);
    await expect(d.open('https://x', { timeoutMs: 100 })).rejects.toThrow(/parked/);
  });
});

describe('LandPortal Browser', () => {
  it('is parked by default (no session) — honest, no fabrication', async () => {
    const lp = makeLandPortalBrowser();
    expect(lp.configured()).toBe(false);
    const ev = await lp.runWorkflow({ searchKey: { address: '388 Gilstrap Rd', county: 'White', state: 'GA' } }, { timeoutMs: 1000 });
    expect(ev.status).toBe('parked');
    expect(ev.screenshots).toHaveLength(0);
    expect(ev.note).toMatch(/no.*authenticated session|parked/i);
  });

  it('runs the workflow with a live driver: ONE screenshot + structured extraction', async () => {
    const driver = fakeLandPortalDriver();
    const lp = makeLandPortalBrowser({ driver });
    const ev = await lp.runWorkflow({ searchKey: { address: '388 Gilstrap Rd', county: 'White', state: 'GA' } }, { timeoutMs: 1000 });
    expect(ev.status).toBe('retrieved');
    expect(ev.screenshots).toHaveLength(1); // exactly one per property
    expect(ev.screenshots[0].purpose).toBe(LANDPORTAL_SCREENSHOT_PURPOSE);
    expect(ev.patch.apn).toBe('042 123');
    expect(ev.patch.owner).toBe('TEST OWNER');
    expect(ev.patch.county).toBe('White');
    expect(ev.patch.acres).toBeCloseTo(5.2);
    expect(ev.patch.coordinates).toEqual({ lat: 34.59, lng: -83.76 });
    expect(Object.keys(ev.fields)).toContain('FEMA');
  });

  it('never sets parcelVerified from a browser read (evidence, not named-source verification)', async () => {
    const { patch } = extractLandPortalFields({ url: 'x', fields: { APN: 'A1', Owner: 'X' }, snippets: [] });
    expect((patch as any).parcelVerified).toBeUndefined();
  });

  it('blocks billing/credit actions in the read-only contract', () => {
    const ev = landPortalBlockedExample();
    expect(ev.blocked.map((b) => b.action)).toContain('generate_paid_report');
    expect(ev.blocked.map((b) => b.action)).toContain('paid_export');
  });

  it('ask mode answers a property question via the workflow', async () => {
    const lp = makeLandPortalBrowser({ driver: fakeLandPortalDriver() });
    const ev = await lp.ask('Show me FEMA', { county: 'White', state: 'GA', address: '388 Gilstrap Rd' }, { timeoutMs: 1000 });
    expect(ev.mode).toBe('ask');
    expect(ev.fields).toHaveProperty('FEMA');
  });
});

describe('missing-field analysis (no duplicate retrieval)', () => {
  it('excludes fields LandPortal already provided; lists county gaps + authoritative records', async () => {
    const lp = makeLandPortalBrowser({ driver: fakeLandPortalDriver() });
    const ev = await lp.runWorkflow({ searchKey: { address: '388 Gilstrap Rd', county: 'White', state: 'GA' } }, { timeoutMs: 1000 });
    const property = emptyNormalizedProperty();
    mergeNormalized(property, 'landportal_readonly', 'LandPortal Browser', ev.patch);
    const mfa = analyzeMissingFields(property, ev);
    // LandPortal gave APN/owner/county/acreage/land_use/fema/wetlands/road_frontage → not re-collected.
    expect(mfa.have).toEqual(expect.arrayContaining(['apn', 'owner', 'county', 'acreage', 'land_use', 'fema_flood', 'wetlands', 'road_frontage']));
    // Deed/plat/tax_status/ownership/GIS are county-authoritative → always county.
    expect(mfa.countyVerifies).toEqual(expect.arrayContaining(['recorded_deed', 'plat', 'tax_status', 'ownership_verification', 'gis_parcel']));
    expect(mfa.missing).not.toContain('apn'); // never collected twice
    expect(mfa.countyWorkflows).toEqual(expect.arrayContaining(['recorder', 'tax_office', 'gis']));
  });
});

describe('County Records Browser', () => {
  it('is parked by default and plans gap-fill workflows from NETR', async () => {
    const cr = makeCountyRecordsBrowser();
    expect(cr.configured()).toBe(false);
    const ev = await cr.runWorkflow({ searchKey: { county: 'White', state: 'GA' }, neededFields: ['recorded_deed', 'tax_status', 'gis_parcel'] }, { timeoutMs: 1000 });
    expect(ev.status).toBe('parked');
    expect(ev.sourceUrls[0]).toContain('georgia');
    expect(ev.note).toMatch(/recorder|tax_office|gis/);
  });

  it('ask mode routes a deed question to the recorder workflow', async () => {
    const cr = makeCountyRecordsBrowser();
    const ev = await cr.ask('Find the last recorded deed', { county: 'White', state: 'GA' }, { timeoutMs: 1000 });
    expect(ev.mode).toBe('ask');
    expect(ev.note).toMatch(/recorded_deed|recorder|parked/i);
  });

  it('stops only for payment/login/destructive/CAPTCHA (recorded as blocked)', () => {
    expect(countyStopExample('payment').blocked[0].action).toBe('purchase');
    expect(countyStopExample('credentialed_login').blocked[0].action).toBe('store_credentials');
    expect(countyStopExample('payment').status).toBe('blocked');
  });
});
