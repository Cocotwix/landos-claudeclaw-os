import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyCountyLink, officialDomainScore, extractCountySources, netrIsStale,
  officialSearchQuery, pickOfficialResult, searchEngineUrl, unwrapSearchResults,
  governmentSourceScope, orderCountySourcesLocalFirst,
} from './netr-routing.js';
import { extractRecordFacts, unresolvedFact, extractAgencyContact, parcelRecordSignal } from './semantic-extract.js';
import { saveCountySources, getCountySources, isCountyCacheFresh } from './county-source-map.js';
import {
  acclaimDetailFieldsFromText,
  findAcclaimSubjectRow,
  makeCountyRecordsBrowser,
} from './county-records-browser.js';
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

  it('rejects same-name counties in another state and non-official directory aggregators', () => {
    const picked = pickOfficialResult([
      { text: 'Pickens County Planning & Development', href: 'https://www.pickenscountyga.gov/171/Planning-Development' },
      { text: 'Pickens County Building Departments', href: 'https://www.countyoffice.org/sc-pickens-county-building-departments/' },
      { text: 'Pickens County, SC Code of Ordinances — Planning', href: 'https://library.municode.com/sc/pickens_county/codes/code_of_ordinances?nodeId=COOR_CH30PLDE' },
    ], 'planning', 'Pickens', 'SC');
    expect(picked?.url).toContain('/sc/pickens_county/');
    expect(officialDomainScore('https://www.countyoffice.org/sc-pickens-county-building-departments/', 'Pickens', 'SC')).toBe(0);
  });

  it('always prefers a local county/city/township source before a statewide index', () => {
    const localClerk = { type: 'recorder' as const, url: 'https://fccottweb.fayettecountyga.gov/external/', label: 'Fayette County Clerk eSearch', origin: 'search_fallback' as const, confidence: 0.64 };
    const statewideIndex = { type: 'recorder' as const, url: 'https://records.georgia.gov/statewide-records', label: 'Georgia Statewide Recorder Index', origin: 'search_fallback' as const, confidence: 0.96 };
    expect(governmentSourceScope(localClerk, { county: 'Fayette', city: 'Fayetteville', state: 'GA' })).toBe('county');
    expect(governmentSourceScope(statewideIndex, { county: 'Fayette', city: 'Fayetteville', state: 'GA' })).toBe('statewide');
    expect(orderCountySourcesLocalFirst([statewideIndex, localClerk], { county: 'Fayette', city: 'Fayetteville', state: 'GA' })[0]).toBe(localClerk);
    const selected = extractCountySources([
      { text: statewideIndex.label, href: statewideIndex.url },
      { text: localClerk.label, href: localClerk.url },
    ], { origin: 'search_fallback', county: 'Fayette', state: 'GA' });
    expect(selected.find((source) => source.type === 'recorder')!.url).toBe(localClerk.url);
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
  it('correlates an Acclaim recorder row by exact APN and parses its instrument detail', () => {
    const row = findAcclaimSubjectRow([{
      TransactionItemId: 1433732,
      InstrumentNumber: '202518326',
      BookPage: '2895/123',
      ParcelNumber: '4165-00-51-3961',
      Comments: '(13.21)AC TRACT B ET AL',
      Party: 'To',
      Name: 'NATURALAND TRUST',
      CrossPartyName: 'STROTHER BRADLEY L TST',
      DocType: 'DEED',
    }], '4165-00-51-3961');
    expect(row).toMatchObject({
      transactionItemId: 1433732,
      instrumentNumber: '202518326',
      parcelNumber: '4165-00-51-3961',
    });
    expect(findAcclaimSubjectRow([{
      TransactionItemId: 1,
      InstrumentNumber: 'OTHER',
      ParcelNumber: '4154-00-64-0929',
    }], '4165-00-51-3961')).toBeNull();

    const fields = acclaimDetailFieldsFromText(`
      Book / Page:
      / Go
      Instrument Number:
      Go
      Search Results
      Record Date:
      12/10/2025
      Book Type:
      DE - DEED
      Book / Page:
      2895/123
      Instrument Number:
      202518326
      Number Of Pages:
      3
      Doc Type:
      DEED - DEED
      Grantor:
      BRADLEY L STROTHER REVOCABLE TRUST THE
      STROTHER BRADLEY L TST
      Grantee:
      NATURALAND TRUST
      Consideration:
      $490,000.00
      Description:
      (13.21)AC TRACT B ET AL
      Related DocLink:
      DE 2806/70
      PL 595/205
      TMS Number:
      4165-00-51-3961
      Mailback:
      Horton Law Firm PA
    `);
    expect(fields).toMatchObject({
      'Recording Date': '12/10/2025',
      'Deed Book / Page': '2895/123',
      'Instrument Number': '202518326',
      'Number Of Pages': '3',
      'Current Deed': 'DEED - DEED',
      Grantor: 'BRADLEY L STROTHER REVOCABLE TRUST THE; STROTHER BRADLEY L TST',
      Grantee: 'NATURALAND TRUST',
      Consideration: '$490,000.00',
      'Legal Description': '(13.21)AC TRACT B ET AL',
      'Recorded Plat': 'PL 595/205',
      'Parcel ID': '4165-00-51-3961',
    });
  });

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
    // Routed source URLs remain evidence, never masquerade as extracted facts.
    expect(ev.facts.some((f) => /Link$/.test(f.key))).toBe(false);
    expect(ev.sourceUrls.some((url) => url.includes('gis.white.ga.gov'))).toBe(true);
    expect(ev.sourceAttempts?.map((attempt) => attempt.sourceType)).toEqual(
      expect.arrayContaining(['assessor', 'tax', 'gis', 'recorder']),
    );
    expect(ev.sourceAttempts?.some((attempt) =>
      attempt.result === 'retrieved' && attempt.factCount > 0)).toBe(true);
    expect(ev.sourceAttempts?.every((attempt) => !!attempt.attemptedAt && !!attempt.note)).toBe(true);
    // a screenshot captured for the record page
    expect(ev.screenshots.length).toBeGreaterThanOrEqual(1);
    // routing persisted to the County Source Map
    expect(getCountySources('GA', 'White')!.sources.length).toBeGreaterThanOrEqual(3);
    expect(ev.note).toMatch(/NETR/);
  });

  it('resolves and attempts planning even when the county routing cache is fresh', async () => {
    saveCountySources({
      state: 'GA',
      county: 'White',
      netrUrl: 'https://publicrecords.netronline.com/georgia/White',
      sources: [
        { type: 'assessor', url: 'https://www.whitecountyga.gov/assessor', label: 'Assessor', origin: 'search_fallback', confidence: 0.9 },
        { type: 'tax', url: 'https://www.whitecountyga.gov/tax', label: 'Tax', origin: 'search_fallback', confidence: 0.9 },
        { type: 'gis', url: 'https://www.whitecountyga.gov/gis', label: 'GIS', origin: 'search_fallback', confidence: 0.9 },
        { type: 'recorder', url: 'https://www.whitecountyga.gov/deeds', label: 'Deeds', origin: 'search_fallback', confidence: 0.9 },
      ],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Fresh core source map without planning.',
    });
    let current = '';
    const driver: BrowserDriver = {
      id: 'cached-departments',
      configured: () => true,
      async open(url) { current = url; return { url, fields: {}, snippets: [] }; },
      async search(q) { current = `search:${q}`; return { url: current, fields: {}, snippets: [] }; },
      async readFields() { return { url: current, fields: {}, snippets: [] }; },
      async readLinks() {
        const decoded = decodeURIComponent(current).toLowerCase();
        if (decoded.includes('planning')) return [{ text: 'White County Planning and Development', href: 'https://www.whitecountyga.gov/planning' }];
        return [];
      },
      async screenshot(purpose) { return { path: '/tmp/departments.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: { state: 'GA', county: 'White', apn: '021 033 002' },
      mode: 'deep_record',
    }, { timeoutMs: 5_000 });
    expect(ev.sourcesUsed.map((source) => source.type)).toContain('planning');
    expect(ev.sourceAttempts?.map((attempt) => attempt.sourceType)).toContain('planning');
    expect(getCountySources('GA', 'White')?.sources.map((source) => source.type)).toContain('planning');
  });

  it('uses generic SPA controls and non-anchor result rows to reach and extract the subject record', async () => {
    saveCountySources({
      state: 'SC',
      county: 'Pickens',
      netrUrl: null,
      sources: [
        { type: 'assessor', url: 'https://maps.pickenscountysc.gov/property', label: 'Pickens County property search', origin: 'search_fallback', confidence: 0.9 },
      ],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Test SPA route.',
    });
    const recordFields = {
      'Owner Name': 'NATURALAND TRUSTEES',
      'Parcel ID': '4165-00-51-3961',
      'Deeded Acres': '52.84',
      'Property Class': 'Vacant land',
      Improvements: 'None listed',
      'Current Deed': 'Warranty deed',
      Grantor: 'MOUNTAIN HOLDINGS LLC',
      Grantee: 'NATURALAND TRUSTEES',
      'Recording Date': '2020-04-17',
      'Instrument Number': '20200417001234',
      'Legal Description': 'Tract 3, Highway 11',
      'Plat Book': 'PB 44 / 18',
    };
    let recordReached = false;
    const driver: BrowserDriver = {
      id: 'spa-government-records',
      configured: () => true,
      async open(url) { return { url, fields: {}, snippets: [] }; },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() {
        return {
          url: recordReached ? 'https://maps.pickenscountysc.gov/property/416500513961' : 'https://maps.pickenscountysc.gov/property',
          fields: recordReached ? recordFields : {},
          snippets: [],
        };
      },
      async readLinks() { return []; },
      async readForms() { return []; },
      async observe() {
        return {
          url: 'https://maps.pickenscountysc.gov/property',
          title: 'Pickens County Property Search',
          headings: ['Property Search'],
          navItems: [],
          buttons: ['Search'],
          searchControls: [{ selector: '#parcel-search', label: 'Parcel ID', type: 'text' }],
          links: [],
          hasMap: true,
          hasTable: recordReached,
          fields: recordReached ? recordFields : {},
          loginLike: false,
        };
      },
      async typeSearch() {},
      async readCandidates() {
        return [{ index: 0, kind: 'row', text: 'Parcel 4165-00-51-3961 NATURALAND TRUSTEES Pickens SC' }];
      },
      async clickCandidate() { recordReached = true; },
      async submitSearch() {},
      async screenshot(purpose) { return { path: '/tmp/pickens-record.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: {
        state: 'SC',
        county: 'Pickens',
        apn: '4165-00-51-3961',
        owner: 'NATURALAND TRUSTEES',
      },
    }, { timeoutMs: 5_000 });

    expect(ev.status).toBe('retrieved');
    expect(Object.fromEntries(ev.facts.map((fact) => [fact.key, fact.value]))).toMatchObject({
      owner: 'NATURALAND TRUSTEES',
      apn: '4165-00-51-3961',
      acreage: '52.84',
      improvements: 'None listed',
      currentDeed: 'Warranty deed',
      grantor: 'MOUNTAIN HOLDINGS LLC',
      grantee: 'NATURALAND TRUSTEES',
      recordingDate: '2020-04-17',
      instrumentNumber: '20200417001234',
      legalDescription: 'Tract 3, Highway 11',
      recordedPlat: 'PB 44 / 18',
    });
    const attempt = ev.sourceAttempts?.[0];
    expect(attempt).toMatchObject({
      result: 'retrieved',
      failureCode: undefined,
      reachedUrl: 'https://maps.pickenscountysc.gov/property/416500513961',
    });
    expect(attempt?.alternateRoutesAttempted).toEqual(expect.arrayContaining(['interactive_spa', 'interactive_result_row']));
    expect(attempt?.searchMethods).toContain('apn:4165-00-51-3961');
    expect(attempt?.steps?.map((step) => step.stage)).toEqual(['navigate', 'retrieve', 'extract', 'interpret']);
  });

  it('reports delinquent taxes, improvement facts and a separately assessed home owned by someone else', async () => {
    const assessorUrl = 'https://assessor.pickenscountysc.gov/property';
    const taxUrl = 'https://tax.pickenscountysc.gov/property';
    saveCountySources({
      state: 'SC',
      county: 'Pickens',
      netrUrl: null,
      sources: [
        { type: 'assessor', url: assessorUrl, label: 'Pickens County assessor search', origin: 'search_fallback', confidence: 0.9 },
        { type: 'tax', url: taxUrl, label: 'Pickens County tax search', origin: 'search_fallback', confidence: 0.9 },
      ],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Tax and manufactured-home regression source.',
    });
    const assessorFields = {
      'Parcel ID': '4165-00-51-3961',
      'Owner Name': 'LAND OWNER LLC',
      'Building Type': 'Double-wide manufactured home',
      'Year Built': '1998',
      'Living Area': '1,680 sq ft',
    };
    const taxFields = {
      'Parcel ID': '4165-00-51-3961',
      'Owner Name': 'LAND OWNER LLC',
      'Property Tax Amount': '$1,842.33',
      'Tax Year': '2026',
      'Tax Payment Status': 'Delinquent',
      'Delinquent Tax Amount': '$4,986.12',
      'Unpaid Tax Years': '2024, 2025, 2026',
      'Penalty & Interest': '$612.44 through 2026-08-15',
      'Tax Sale Status': 'Eligible for 2027 tax sale; no sale scheduled',
      'Manufactured Home Account': 'MH-009184',
      'Manufactured Home Owner': 'HOME OWNER LLC',
    };
    let currentUrl = assessorUrl;
    const fieldsForCurrent = () => currentUrl.startsWith(taxUrl) ? taxFields : assessorFields;
    const driver: BrowserDriver = {
      id: 'tax-improvement-record',
      configured: () => true,
      async open(url) { currentUrl = url; return { url, fields: fieldsForCurrent(), snippets: [] }; },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() { return { url: `${currentUrl}/416500513961`, fields: fieldsForCurrent(), snippets: [] }; },
      async readLinks() { return []; },
      async readForms() { return []; },
      async screenshot(purpose) { return { path: '/tmp/tax-improvement.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: { state: 'SC', county: 'Pickens', apn: '4165-00-51-3961', owner: 'LAND OWNER LLC' },
      neededFields: ['tax_status', 'tax_values', 'improvements', 'manufactured_home_account'],
    }, { timeoutMs: 5_000 });

    expect(ev.sourceAttempts?.map((attempt) => attempt.sourceType)).toEqual(['assessor', 'tax']);
    expect(ev.sourceAttempts?.map((attempt) => [attempt.result, attempt.failureCode])).toEqual([
      ['retrieved', undefined], ['retrieved', undefined],
    ]);
    const facts = Object.fromEntries(ev.facts.map((fact) => [fact.key, fact.value]));
    expect(facts).toMatchObject({
      taxAmount: '$1,842.33',
      taxYear: '2026',
      taxStanding: 'Delinquent',
      delinquentAmount: '$4,986.12',
      unpaidTaxYears: '2024, 2025, 2026',
      taxPenaltyInterest: '$612.44 through 2026-08-15',
      taxSaleStatus: 'Eligible for 2027 tax sale; no sale scheduled',
      structureType: 'Double-wide manufactured home',
      yearBuilt: '1998',
      buildingSqft: '1,680 sq ft',
      manufacturedHomeAccount: 'MH-009184',
      manufacturedHomeAssessmentStatus: 'Separate tax/account record',
      manufacturedHomeOwner: 'HOME OWNER LLC',
      manufacturedHomeOwnershipMatch: 'Different owner — home: HOME OWNER LLC; land: LAND OWNER LLC',
    });
    expect(ev.sourceAttempts?.every((attempt) => attempt.result === 'retrieved')).toBe(true);
  });

  it('reports current taxes and matches an explicitly titled home owner to the land owner', async () => {
    const taxUrl = 'https://tax.whitecountyga.gov/property';
    saveCountySources({
      state: 'GA', county: 'White', netrUrl: null,
      sources: [{ type: 'tax', url: taxUrl, label: 'White County tax search', origin: 'search_fallback', confidence: 0.9 }],
      usedSearchFallback: true, status: 'routed', confidence: 'high', notes: 'Current-tax regression source.',
    });
    const fields = {
      'Parcel ID': '021-033-002',
      'Owner Name': 'DOE, JANE',
      'Property Tax Amount': '$912.08',
      'Tax Year': '2026',
      'Tax Payment Status': 'Paid — current',
      'Building Type': 'Mobile home',
      'Manufactured Home Assessment': 'Assessed with the land as real property',
      'Manufactured Home Title Owner': 'JANE DOE',
    };
    const driver: BrowserDriver = {
      id: 'current-tax-home-owner', configured: () => true,
      async open(url) { return { url, fields, snippets: [] }; },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() { return { url: `${taxUrl}/021033002`, fields, snippets: [] }; },
      async readLinks() { return []; }, async readForms() { return []; },
      async screenshot(purpose) { return { path: '/tmp/current-tax.png', capturedAtIso: 't', purpose }; },
    };
    const ev = await makeCountyRecordsBrowser({ driver }).runWorkflow({
      searchKey: { state: 'GA', county: 'White', apn: '021-033-002', owner: 'DOE, JANE' },
      neededFields: ['tax_status', 'tax_values', 'improvements', 'manufactured_home_account'],
    }, { timeoutMs: 5_000 });
    const facts = Object.fromEntries(ev.facts.map((fact) => [fact.key, fact.value]));
    expect(facts).toMatchObject({
      taxAmount: '$912.08',
      taxStanding: 'Current / no delinquency shown by the public tax record',
      manufacturedHomeAssessmentStatus: 'Assessed with the land',
      manufacturedHomeTitleOwner: 'JANE DOE',
      manufacturedHomeOwnershipMatch: 'Same owner — JANE DOE',
    });
  });

  it('rejects a commercial redirect returned by an official department search form', async () => {
    const officialUrl = 'https://www.co.pickens.sc.us/departments/register_of_deeds/index.php';
    saveCountySources({
      state: 'SC',
      county: 'Pickens',
      netrUrl: null,
      sources: [{ type: 'recorder', url: officialUrl, label: 'Pickens County Register of Deeds', origin: 'search_fallback', confidence: 0.9 }],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Commercial redirect rejection regression.',
    });
    let currentUrl = officialUrl;
    const driver: BrowserDriver = {
      id: 'commercial-redirect',
      configured: () => true,
      async open(url) {
        currentUrl = url;
        return { url, fields: {}, snippets: [] };
      },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() { return { url: currentUrl, fields: {}, snippets: [] }; },
      async readLinks() { return []; },
      async readForms() {
        return currentUrl === officialUrl
          ? [{ formIndex: 0, fields: [{ selector: '#search', label: 'Search' }], submitLabel: 'Search', submitSelector: '#go' }]
          : [];
      },
      async fillAndSubmit() {
        currentUrl = 'https://www.zillow.com/homedetails/6940-Highway-11-Sunset-SC/123_zpid/';
        return { url: currentUrl, fields: {}, snippets: [] };
      },
      async screenshot(purpose) { return { path: '/tmp/commercial-rejected.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: { state: 'SC', county: 'Pickens', apn: '4165-00-51-3961', address: '6940 Highway 11' },
      mode: 'deep_record',
    }, { timeoutMs: 5_000 });

    const attempt = ev.sourceAttempts?.find((row) => row.sourceUrl === officialUrl);
    expect(attempt?.reachedUrl).toBe(officialUrl);
    expect(attempt?.note).not.toMatch(/zillow/i);
    expect(attempt?.alternateRoutesAttempted).toContain('commercial_result_rejected');
    expect(ev.facts).toHaveLength(0);
  });

  it('extracts labeled planning rules as jurisdiction facts without pretending a parcel record was reached', async () => {
    saveCountySources({
      state: 'SC',
      county: 'Pickens',
      netrUrl: null,
      sources: [
        { type: 'planning', url: 'https://pickenscountysc.gov/planning/rules', label: 'Planning rules', origin: 'search_fallback', confidence: 0.9 },
      ],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Test planning route.',
    });
    const fields = {
      'Zoning Jurisdiction': 'Pickens County',
      'Permitted Uses': 'Single-family dwellings and agriculture',
      'Minimum Lot Size': '1 acre without public sewer',
      'Minimum Frontage': '50 feet',
      'Minor Subdivision Threshold': '5 lots',
      'Flag Lot Requirements': 'Access stem must meet frontage standard',
      'Shared Access Requirements': 'Recorded maintenance agreement required',
      'Private Road Requirements': 'County fire access standard applies',
      'Water Provider': 'City service areas vary by address',
    };
    const driver: BrowserDriver = {
      id: 'planning-government-records',
      configured: () => true,
      async open(url) { return { url, fields, snippets: [] }; },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() { return { url: 'https://pickenscountysc.gov/planning/rules', fields, snippets: [] }; },
      async readLinks() { return []; },
      async readForms() { return []; },
      async screenshot(purpose) { return { path: '/tmp/planning.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: { state: 'SC', county: 'Pickens', apn: '4165-00-51-3961' },
      neededFields: ['zoning'],
    }, { timeoutMs: 5_000 });

    expect(ev.status).toBe('retrieved');
    expect(ev.facts.map((fact) => fact.key)).toEqual(expect.arrayContaining([
      'zoningJurisdiction',
      'permittedUses',
      'minimumLotSize',
      'minimumFrontage',
      'minorSubdivisionRules',
      'flagLotRules',
      'sharedAccessRules',
      'privateRoadRequirements',
      'utilityProvider',
    ]));
    expect(ev.sourceAttempts?.[0]).toMatchObject({
      result: 'retrieved',
      factCount: 9,
      searchMethods: [],
    });
  });

  it('rejects an explicitly different parcel record and diagnoses the subject mismatch', async () => {
    saveCountySources({
      state: 'GA',
      county: 'White',
      netrUrl: null,
      sources: [
        { type: 'assessor', url: 'https://whitecountyga.gov/property', label: 'Property record', origin: 'search_fallback', confidence: 0.9 },
      ],
      usedSearchFallback: true,
      status: 'routed',
      confidence: 'high',
      notes: 'Test subject mismatch.',
    });
    const wrongRecord = {
      'Owner Name': 'ANOTHER OWNER',
      'Parcel ID': '999-999',
      'Deeded Acres': '3.00',
    };
    const driver: BrowserDriver = {
      id: 'wrong-parcel',
      configured: () => true,
      async open(url) { return { url, fields: wrongRecord, snippets: [] }; },
      async search(q) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
      async readFields() { return { url: 'https://whitecountyga.gov/property', fields: wrongRecord, snippets: [] }; },
      async readLinks() { return []; },
      async readForms() { return []; },
      async screenshot(purpose) { return { path: '/tmp/wrong.png', capturedAtIso: 't', purpose }; },
    };
    const county = makeCountyRecordsBrowser({ driver });
    const ev = await county.runWorkflow({
      searchKey: { state: 'GA', county: 'White', apn: '021 033 002' },
    }, { timeoutMs: 5_000 });

    expect(ev.status).toBe('partial');
    expect(ev.facts.some((fact) => fact.key === 'owner')).toBe(false);
    expect(ev.sourceAttempts?.[0]).toMatchObject({
      result: 'attempted_inconclusive',
      factCount: 0,
      failureCode: 'no_subject_match',
    });
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
    expect(ev.status).toBe('partial');
    // sources came from the search fallback, labeled correctly
    expect(ev.sourcesUsed.length).toBeGreaterThanOrEqual(1);
    expect(ev.sourcesUsed.every((s) => s.origin === 'search_fallback')).toBe(true);
    expect(ev.facts).toHaveLength(0);
    expect(ev.sourceAttempts?.every((attempt) =>
      attempt.result !== 'retrieved'
      && attempt.factCount === 0
      && !!attempt.failureCode
      && attempt.steps?.map((step) => step.stage).join(',') === 'navigate,retrieve,extract,interpret')).toBe(true);
    expect(getCountySources('GA', 'White')!.usedSearchFallback).toBe(true);
  });
});
