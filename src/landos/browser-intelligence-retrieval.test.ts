import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyCountyLink, officialDomainScore, extractCountySources, netrIsStale,
  officialSearchQuery, pickOfficialResult, searchEngineUrl, unwrapSearchResults,
} from './netr-routing.js';
import { extractRecordFacts, unresolvedFact, extractAgencyContact, parcelRecordSignal } from './semantic-extract.js';
import { saveCountySources, getCountySources, isCountyCacheFresh } from './county-source-map.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import type { BrowserDriver, BrowserPageRead } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

describe('NETR routing — semantic link classification (no county scrapers)', () => {
  it('classifies official sources by text/URL across states', () => {
    expect(classifyCountyLink({ text: 'White County Tax Commissioner', href: 'https://whitecountytax.gov' })).toBe('tax');
    expect(classifyCountyLink({ text: 'Property Appraiser', href: 'https://x.paqpublic.net' })).toBe('appraiser');
    expect(classifyCountyLink({ text: 'GIS Parcel Viewer', href: 'https://maps.arcgis.com/x' })).toBe('gis');
    expect(classifyCountyLink({ text: 'Register of Deeds', href: 'https://deeds.county.gov' })).toBe('recorder');
    expect(classifyCountyLink({ text: 'Planning & Zoning', href: 'https://county.gov/planning' })).toBe('planning');
    expect(classifyCountyLink({ text: 'Board of Assessors', href: 'https://assessor.county.gov' })).toBe('assessor');
    expect(classifyCountyLink({ text: 'About NETR', href: 'https://netronline.com' })).toBeNull();
  });

  it('prefers .gov / county domains and rejects data brokers', () => {
    expect(officialDomainScore('https://qpublic.county.gov', 'White', 'GA')).toBeGreaterThan(0.6);
    expect(officialDomainScore('https://www.zillow.com/x')).toBe(0);
    expect(officialDomainScore('https://publicrecords.netronline.com/x')).toBe(0);
  });

  it('extracts best official source per type, dropping brokers', () => {
    const links = [
      { text: 'Tax Commissioner', href: 'https://whitecountytax.gov/search' },
      { text: 'Tax info on Zillow', href: 'https://zillow.com/tax' },
      { text: 'GIS Map', href: 'https://gis.white.ga.gov' },
      { text: 'Assessor', href: 'https://qpublic.schneidercorp.com/white' },
    ];
    const sources = extractCountySources(links, { origin: 'netr', county: 'White', state: 'GA' });
    const types = sources.map((s) => s.type).sort();
    expect(types).toContain('tax');
    expect(types).toContain('gis');
    expect(sources.find((s) => s.type === 'tax')!.url).toContain('whitecountytax.gov'); // not zillow
    expect(sources.every((s) => s.origin === 'netr')).toBe(true);
  });

  it('flags stale NETR (no core records) and builds an official search query', () => {
    expect(netrIsStale([])).toBe(true);
    expect(netrIsStale([{ type: 'gis', url: 'u', label: 'g', origin: 'netr', confidence: 0.8 }])).toBe(true);
    expect(netrIsStale([{ type: 'assessor', url: 'u', label: 'a', origin: 'netr', confidence: 0.8 }])).toBe(false);
    expect(officialSearchQuery('recorder', 'White', 'GA')).toMatch(/White County GA.*recorder/i);
  });

  it('search fallback picks the official result, not the broker', () => {
    const results = [
      { text: 'White County GA Tax', href: 'https://realtor.com/x' },
      { text: 'White County Tax Commissioner Official', href: 'https://whitecountytax.gov' },
    ];
    const picked = pickOfficialResult(results, 'tax', 'White', 'GA');
    expect(picked!.url).toContain('whitecountytax.gov');
    expect(picked!.origin).toBe('search_fallback');
  });

  it('builds a static-results search URL and unwraps DuckDuckGo redirects', () => {
    expect(searchEngineUrl('White County GA tax')).toMatch(/^https:\/\/html\.duckduckgo\.com\/html\/\?q=/);
    const raw = [
      { text: 'Tax Commissioner | White County, GA', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.whitecountyga.gov%2F168%2FTax-Commissioner&rut=x' },
      { text: 'DuckDuckGo', href: 'https://duckduckgo.com/about' },
    ];
    const unwrapped = unwrapSearchResults(raw);
    expect(unwrapped).toHaveLength(1); // engine's own link dropped
    expect(unwrapped[0].href).toBe('https://www.whitecountyga.gov/168/Tax-Commissioner');
    expect(pickOfficialResult(unwrapped, 'tax', 'White', 'GA')!.url).toContain('whitecountyga.gov');
  });
});

describe('Semantic record extraction (multi-state synonyms, never guesses)', () => {
  const ctx = { sourceName: 'White County Assessor', sourceType: 'assessor', sourceUrl: 'https://assessor.gov', origin: 'netr_county' as const };
  it('maps common labels to normalized facts with provenance', () => {
    const facts = extractRecordFacts({
      'Owner Name': 'DOE, JANE', 'Mailing Address': '1 Main St, Cleveland GA', 'Parcel ID': '021 033 002',
      'Deeded Acres': '5.20', 'Property Class': 'Residential Vacant', 'Assessed Total': '$42,000',
      'Last Sale Date': '2019-06-01', 'Deed Book': 'Book 123 Page 45',
    }, ctx);
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f]));
    expect(byKey.owner.value).toBe('DOE, JANE');
    expect(byKey.apn.value).toBe('021 033 002');
    expect(byKey.acreage.value).toBe('5.20');
    expect(byKey.assessedValue.value).toContain('42,000');
    expect(byKey.deedRef.value).toMatch(/Book 123/);
    expect(facts.every((f) => f.sourceName === 'White County Assessor' && f.origin === 'netr_county' && f.status === 'extracted')).toBe(true);
  });
  it('does NOT emit a fact for unlabeled / non-matching fields (no guessing)', () => {
    const facts = extractRecordFacts({ 'Random Header': 'Welcome', 'Acres': 'N/A (no digit)' }, ctx);
    expect(facts).toHaveLength(0); // acreage requires a digit; header matches nothing
  });
  it('unresolvedFact marks needs_verification (not a value)', () => {
    expect(unresolvedFact('taxStatus', ctx).status).toBe('needs_verification');
    expect(unresolvedFact('taxStatus', ctx).value).toBe('');
  });
});

describe('Address classification — evidence-first (Unknown over incorrect)', () => {
  const ctx = { sourceName: 'Runnels County Assessor', sourceType: 'assessor', sourceUrl: 'https://runnelscad.org', origin: 'search_fallback' as const };
  // The exact CAD office/contact page that produced the bug.
  const cadContactPage = { 'Physical Address': '502 2nd Street, Ballinger, TX 76821', 'Mailing Address': 'PO Box 524, Ballinger, TX 76821', 'Office Hours': '8-5' };
  // A real parcel record.
  const parcelRecord = { 'Owner Name': 'SMITH, JOHN', 'Parcel ID': 'R12345', 'Deeded Acres': '20.0', 'Situs': '2510 State Highway 153, Winters, TX', 'Assessed Total': '$88,000' };

  it('parcelRecordSignal: a contact/office page has NO parcel signal; a record has several', () => {
    expect(parcelRecordSignal(cadContactPage)).toBe(0);
    expect(parcelRecordSignal(parcelRecord)).toBeGreaterThanOrEqual(2);
  });

  it('does NOT write the CAD office address as parcel situs/mailing on a non-record page', () => {
    const facts = extractRecordFacts(cadContactPage, ctx, { pageIsRecord: false });
    expect(facts.find((f) => f.key === 'situsAddress')).toBeUndefined();
    expect(facts.find((f) => f.key === 'mailingAddress')).toBeUndefined();
  });

  it('classifies the office address as an Agency contact address (needs_verification, preserved)', () => {
    const agency = extractAgencyContact(cadContactPage, ctx);
    expect(agency.length).toBeGreaterThanOrEqual(1);
    const first = agency[0];
    expect(first.key).toBe('agencyContact');
    expect(first.value).toMatch(/502 2nd Street, Ballinger/);
    expect(first.status).toBe('needs_verification'); // never a verified parcel fact
    expect(first.label).toMatch(/agency contact address \(not parcel\)/i);
    expect(first.sourceName).toBe('Runnels County Assessor'); // provenance preserved
  });

  it('DOES extract situs/mailing on a confirmed parcel record', () => {
    const facts = extractRecordFacts(parcelRecord, ctx, { pageIsRecord: true });
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f]));
    expect(byKey.situsAddress.value).toMatch(/2510 State Highway 153/);
    expect(byKey.owner.value).toBe('SMITH, JOHN');
    expect(byKey.acreage.value).toBe('20.0');
  });
});

describe('County Source Map (persistent, reusable routing)', () => {
  beforeEach(() => _initTestLandosDb());
  it('saves and reloads county routing; freshness reflects usable + recent', () => {
    const saved = saveCountySources({ state: 'GA', county: 'White', netrUrl: 'https://publicrecords.netronline.com/georgia/White', sources: [{ type: 'assessor', url: 'https://qpublic.com/white', label: 'Assessor', origin: 'netr', confidence: 0.9 }], usedSearchFallback: false, status: 'routed', confidence: 'high', notes: 'ok' });
    expect(saved.lastCheckedAt).toBeGreaterThan(0);
    const got = getCountySources('ga', 'white county'); // case + "county" suffix tolerant
    expect(got!.sources[0].type).toBe('assessor');
    expect(isCountyCacheFresh(got)).toBe(true);
    expect(isCountyCacheFresh(null)).toBe(false);
  });
});

// URL-aware fake driver: NETR state page → county link → county sources → assessor record.
function fakeNetrDriver(): BrowserDriver {
  let current = '';
  const linksByUrl: Record<string, Array<{ text: string; href: string }>> = {
    'https://publicrecords.netronline.com/georgia': [{ text: 'White County', href: 'https://publicrecords.netronline.com/georgia/White' }],
    'https://publicrecords.netronline.com/georgia/White': [
      { text: 'White County Board of Assessors', href: 'https://qpublic.schneidercorp.com/Application.aspx?App=WhiteCountyGA' },
      { text: 'White County Tax Commissioner', href: 'https://whitecountytax.gov' },
      { text: 'GIS Parcel Viewer', href: 'https://gis.white.ga.gov' },
      { text: 'Clerk of Court / Deeds', href: 'https://deeds.white.ga.gov' },
    ],
  };
  const fieldsByUrl: Record<string, Record<string, string>> = {
    'https://qpublic.schneidercorp.com/Application.aspx?App=WhiteCountyGA': { 'Owner Name': 'SPROUL, BRITTANY', 'Parcel ID': '021 033 002', 'Deeded Acres': '5.20', 'Assessed Total': '$42,000', 'Property Class': 'Residential' },
  };
  return {
    id: 'fake-netr', configured: () => true,
    async open(url): Promise<BrowserPageRead> { current = url; return { url, fields: fieldsByUrl[url] ?? {}, snippets: [] }; },
    async search(q): Promise<BrowserPageRead> { current = 'search:' + q; return { url: current, fields: {}, snippets: [] }; },
    async readFields(): Promise<BrowserPageRead> { return { url: current, fields: fieldsByUrl[current] ?? {}, snippets: [] }; },
    async readLinks() { return linksByUrl[current] ?? []; },
    async screenshot(purpose) { return { path: '/tmp/c.png', capturedAtIso: 't', purpose }; },
  };
}

describe('County Records Browser — NETR-routed semantic retrieval (end to end)', () => {
  beforeEach(() => _initTestLandosDb());
  it('routes via NETR, finds official sources, extracts facts with provenance', async () => {
    const county = makeCountyRecordsBrowser({ driver: fakeNetrDriver() });
    const ev = await county.runWorkflow({ searchKey: { state: 'GA', county: 'White', apn: '021 033 002' } }, { timeoutMs: 2000 });
    expect(ev.status).toBe('retrieved');
    // routed through NETR → found official sources
    const types = ev.sourcesUsed.map((s) => s.type).sort();
    expect(types).toEqual(expect.arrayContaining(['assessor', 'tax', 'gis', 'recorder']));
    expect(ev.sourcesUsed.every((s) => s.origin === 'netr_county')).toBe(true);
    // extracted facts with provenance
    const owner = ev.facts.find((f) => f.key === 'owner');
    expect(owner!.value).toBe('SPROUL, BRITTANY');
    expect(owner!.origin).toBe('netr_county');
    expect(owner!.sourceName).toMatch(/White County Assessor/);
    expect(owner!.sourceUrl).toContain('qpublic');
    // GIS/recorder kept as labeled links
    expect(ev.facts.some((f) => f.key === 'gisLink')).toBe(true);
    // a screenshot captured for the record page
    expect(ev.screenshots.length).toBeGreaterThanOrEqual(1);
    // routing persisted to the County Source Map
    expect(getCountySources('GA', 'White')!.sources.length).toBeGreaterThanOrEqual(3);
    expect(ev.note).toMatch(/NETR Online/);
  });

  it('parked driver returns honest plan, no fabrication', async () => {
    const county = makeCountyRecordsBrowser();
    const ev = await county.runWorkflow({ searchKey: { state: 'GA', county: 'White' } }, { timeoutMs: 1000 });
    expect(ev.status).toBe('parked');
    expect(ev.facts).toHaveLength(0);
  });

  it('falls back to official web search when NETR is stale (real-world path)', async () => {
    // NETR yields no usable county sources; the search engine returns official .gov.
    const driver: BrowserDriver = {
      id: 'fb', configured: () => true,
      async open(url) { return { url, fields: {}, snippets: [] }; },
      async search(q) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: {}, snippets: [] }; },
      async readLinks() {
        // NETR state page → no county link; search engine → official results.
        // (current url is tracked by open(); emulate by returning search results
        // whenever asked after a search URL open.)
        return [
          { text: 'Tax Commissioner | White County, GA', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.whitecountyga.gov%2F168%2FTax-Commissioner' },
          { text: 'White County Board of Assessors', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.whitecountyga.gov%2F351%2FProperty-Record' },
        ];
      },
      async screenshot(purpose) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({ searchKey: { state: 'GA', county: 'White' } }, { timeoutMs: 2000 });
    expect(ev.status).toBe('retrieved');
    // sources came from the search fallback, labeled correctly
    expect(ev.sourcesUsed.length).toBeGreaterThanOrEqual(1);
    expect(ev.sourcesUsed.every((s) => s.origin === 'search_fallback')).toBe(true);
    expect(ev.facts.some((f) => /whitecountyga\.gov/.test(f.value))).toBe(true);
    expect(getCountySources('GA', 'White')!.usedSearchFallback).toBe(true);
  });
});
