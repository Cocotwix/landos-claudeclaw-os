import { describe, it, expect, beforeEach } from 'vitest';
import {
  apnFormats, addressFormats, chooseIdentifier, classifyInput, planParcelSearch, pickParcelRecordLink,
  type FormInfo,
} from './browser-navigator.js';
import { namesLikelyMatch, guessRelationship, assessSellerAuthority } from './seller-authority.js';
import { writeBrowserFact, listBrowserFacts, markStoppedByOperator, requestCancel, isCancelled, clearCancel } from './browser-fact-store.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import type { BrowserDriver, BrowserFact } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

describe('semantic navigation — identifiers + form understanding (no county logic)', () => {
  it('generates APN + address format variants', () => {
    expect(apnFormats('021 033 002')).toEqual(expect.arrayContaining(['021 033 002', '021033002', '021-033-002', '021.033.002']));
    expect(addressFormats('388 Gilstrap Road, Cleveland, GA')).toEqual(expect.arrayContaining(['388 Gilstrap Road', '388 Gilstrap Rd']));
  });

  it('chooses the strongest identifier: APN > address > owner', () => {
    expect(chooseIdentifier({ apn: '021 033 002', address: '388 Gilstrap Rd', owner: 'Doe' })!.kind).toBe('apn');
    expect(chooseIdentifier({ address: '388 Gilstrap Rd', owner: 'Doe' })!.kind).toBe('address');
    expect(chooseIdentifier({ owner: 'Doe' })!.kind).toBe('owner');
    expect(chooseIdentifier({})).toBeNull();
  });

  it('classifies inputs semantically by label/placeholder/name', () => {
    expect(classifyInput({ selector: '#a', label: 'Parcel Number' })).toBe('apn');
    expect(classifyInput({ selector: '#b', placeholder: 'Property Address' })).toBe('address');
    expect(classifyInput({ selector: '#c', name: 'ownerName' })).toBe('owner');
    expect(classifyInput({ selector: '#d', placeholder: 'Search' })).toBe('general');
    expect(classifyInput({ selector: '#e', type: 'checkbox' })).toBeNull();
  });

  it('plans a parcel search using the matching input + strongest identifier', () => {
    const forms: FormInfo[] = [{ formIndex: 0, fields: [{ selector: '#apn', label: 'Parcel ID' }, { selector: '#addr', label: 'Address' }], submitLabel: 'Search', submitSelector: '#go' }];
    const plan = planParcelSearch(forms, { apn: '021 033 002', address: '388 Gilstrap Rd' })!;
    expect(plan.idKind).toBe('apn');
    expect(plan.fieldSelector).toBe('#apn');
    expect(plan.value).toBe('021 033 002');
    expect(plan.valueAlternates.length).toBeGreaterThan(0);
    expect(plan.submitSelector).toBe('#go');
  });

  it('falls back to a general search box when no dedicated field exists', () => {
    const forms: FormInfo[] = [{ formIndex: 0, fields: [{ selector: '#q', placeholder: 'Search records' }] }];
    const plan = planParcelSearch(forms, { apn: '021 033 002' })!;
    expect(plan.fieldSelector).toBe('#q');
    expect(plan.value).toBe('021 033 002');
  });

  it('picks the most likely parcel record link from results', () => {
    const results = [
      { text: 'Home', href: 'https://county.gov/' },
      { text: 'Parcel 021 033 002 Detail', href: 'https://county.gov/parcel/detail?id=021033002' },
    ];
    expect(pickParcelRecordLink(results, { apn: '021 033 002' })!.href).toContain('detail');
  });
});

describe('inherited / representative seller (required capability)', () => {
  it('matches name regardless of order, but not different people', () => {
    expect(namesLikelyMatch('Jack Black', 'BLACK, JACK')).toBe(true);
    expect(namesLikelyMatch('Jack Black', 'Mary Black')).toBe(false); // shared surname only → not a match
    expect(namesLikelyMatch('Jack Black', 'Jack Black Living Trust')).toBe(true);
  });

  it('guesses entity relationship from the owner-of-record', () => {
    expect(guessRelationship('BLACK FAMILY TRUST')).toBe('trust');
    expect(guessRelationship('ACME HOLDINGS LLC')).toBe('llc_entity');
    expect(guessRelationship('ESTATE OF MARY BLACK')).toBe('estate_probate');
  });

  it('a name mismatch NEVER invalidates the parcel; creates verification tasks', () => {
    const a = assessSellerAuthority({ sellerName: 'Jack Black', ownerOfRecord: 'Mary Black', parcelVerified: true });
    expect(a.parcelIdentityStatus).toBe('verified');      // parcel NOT rejected
    expect(a.nameMatch).toBe(false);
    expect(a.ownerOfRecordStatus).toBe('verified');
    expect(a.sellerRelationshipStatus).toBe('seller_stated');
    expect(a.authorityToSellStatus).toBe('needs_verification');
    const tasks = a.verificationTasks.map((t) => t.task.toLowerCase()).join(' | ');
    expect(tasks).toMatch(/seller authority/);
    expect(tasks).toMatch(/probate|inheritance/);
    expect(tasks).toMatch(/power of attorney/);
    expect(a.summary).toMatch(/NOT rejected/i);
  });

  it('matching seller flags no authority tasks', () => {
    const a = assessSellerAuthority({ sellerName: 'Jack Black', ownerOfRecord: 'BLACK, JACK', parcelVerified: true });
    expect(a.nameMatch).toBe(true);
    expect(a.authorityToSellStatus).toBe('verified');
    expect(a.verificationTasks).toHaveLength(0);
  });

  it('trust / LLC owner generates entity-specific signatory tasks even if names look similar', () => {
    const t = assessSellerAuthority({ sellerName: 'Jack Black', ownerOfRecord: 'JACK BLACK FAMILY TRUST', parcelVerified: true });
    expect(t.relationshipGuess).toBe('trust');
    expect(t.verificationTasks.map((x) => x.task).join(' ')).toMatch(/trust authority|signator/i);
  });
});

describe('incremental browser-fact persistence + operator cancellation', () => {
  beforeEach(() => _initTestLandosDb());
  it('writes facts incrementally and lists them; idempotent', () => {
    const f: BrowserFact = { key: 'owner', label: 'Official owner', value: 'DOE, JANE', sourceName: 'White County Assessor', sourceType: 'assessor', sourceUrl: 'https://a.gov', confidence: 'high', origin: 'netr_county', status: 'extracted', extractionMethod: 'parcel search → record' };
    writeBrowserFact(7, f); writeBrowserFact(7, { ...f, value: 'DOE, JANE M' });
    const facts = listBrowserFacts(7);
    expect(facts).toHaveLength(1); // idempotent on (deal,key,url)
    expect(facts[0].value).toBe('DOE, JANE M');
    expect(facts[0].extractionMethod).toBe('parcel search → record');
  });

  it('marks still-requested items Stopped by Operator (not failed/unknown)', () => {
    writeBrowserFact(8, { key: 'owner', label: 'Owner', value: 'X', sourceName: 's', sourceType: 'assessor', sourceUrl: 'u', confidence: 'high', origin: 'netr_county', status: 'extracted' });
    const stopped = markStoppedByOperator(8, ['owner', 'acreage', 'deedRef']);
    expect(stopped.map((s) => s.key).sort()).toEqual(['acreage', 'deedRef']); // owner already found, untouched
    expect(stopped[0].value).toBe('Stopped by Operator');
  });

  it('cancellation registry toggles per deal card', () => {
    requestCancel(9); expect(isCancelled(9)).toBe(true); clearCancel(9); expect(isCancelled(9)).toBe(false);
  });
});

// Fake driver: official source has a parcel-search form → results → record fields.
function searchableCountyDriver(onSearch?: () => void): BrowserDriver {
  let onRecord = false;
  const recordFields: Record<string, string> = { 'Owner Name': 'SPROUL, BRITTANY', 'Parcel ID': '021 033 002', 'Deeded Acres': '5.20' };
  return {
    id: 'fake', configured: () => true,
    async open(url) { if (/record\/detail|\/detail\?/.test(url)) onRecord = true; return { url, fields: (onRecord ? recordFields : {}), snippets: [] }; },
    async search(q) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: (onRecord ? recordFields : {}), snippets: [] }; },
    async readLinks() { return onRecord ? [] : [{ text: 'Tax Commissioner | White County, GA', href: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.whitecountyga.gov%2F168%2FTax' }, { text: 'Parcel 021 033 002 Detail', href: 'https://www.whitecountyga.gov/record/detail?id=021033002' }]; },
    async readForms() { return [{ formIndex: 0, fields: [{ selector: '#apn', label: 'Parcel Number' }], submitLabel: 'Search', submitSelector: '#go' }]; },
    async fillAndSubmit(_s, _v) { onSearch?.(); return { url: 'results', fields: {}, snippets: [] }; },
    async screenshot(purpose) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
  };
}

describe('County workflow — AI parcel-search navigation + incremental facts', () => {
  beforeEach(() => _initTestLandosDb());
  it('locates the search form, searches by APN, opens the record, extracts + streams facts', async () => {
    let searched = false;
    const streamed: BrowserFact[] = [];
    const county = makeCountyRecordsBrowser({ driver: searchableCountyDriver(() => { searched = true; }) });
    const ev = await county.runWorkflow(
      { searchKey: { state: 'GA', county: 'White', apn: '021 033 002' }, mode: 'parcel_fact' },
      { timeoutMs: 2000, onFact: (f) => streamed.push(f) },
    );
    expect(searched).toBe(true); // it actually submitted a parcel search
    const owner = ev.facts.find((f) => f.key === 'owner');
    expect(owner!.value).toBe('SPROUL, BRITTANY');
    expect(owner!.extractionMethod).toMatch(/parcel search/);
    expect(streamed.length).toBeGreaterThan(0); // facts streamed incrementally
    expect(ev.status).toBe('retrieved');
  });

  it('honors operator cancellation mid-run (stops; preserves found facts)', async () => {
    const county = makeCountyRecordsBrowser({ driver: searchableCountyDriver() });
    const ev = await county.runWorkflow(
      { searchKey: { state: 'GA', county: 'White', apn: '021 033 002' } },
      { timeoutMs: 2000, isCancelled: () => true }, // cancelled immediately
    );
    expect(ev.note).toMatch(/Stopped by operator/i);
  });
});
