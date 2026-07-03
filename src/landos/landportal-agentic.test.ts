import { describe, it, expect, beforeEach } from 'vitest';
import { makeLandPortalBrowser } from './landportal-browser.js';
import type { BrowserDriver, BrowserFact } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

// Fake LandPortal that mimics the real agentic path: a map-search surface with an
// address typeahead; clicking the matching row opens a parcel detail panel whose
// APN differs from the (wrong) APN the operator supplied.
function landPortalFake(opts: { panelAddress: string; panelApn: string; candidates: string[] }): BrowserDriver {
  let phase: 'search' | 'record' = 'search';
  const calls = { selectMethod: [] as string[], typed: [] as string[], clicked: -1 };
  const searchObs = () => ({
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search', 'Orders history', 'Market research'], buttons: [],
    searchControls: [{ selector: '#main_search_input', placeholder: 'Address or zip or city or county or state' }],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'Address' },
  });
  const recordObs = () => ({
    url: 'https://landportal.com/?property=abc', title: 'Land Portal', headings: ['Property Overview'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false,
    // real parcel fields + global chrome (token counter / cart) that must NOT block verification
    fields: { 'Tokens × 25000': 'Tokens × 25000', 'Subtotal': '$0', 'Owner Name': 'MAD HOUSE RENTALS LLC', 'Parcel ID': opts.panelApn, 'Parcel Address': opts.panelAddress, 'Acres': '4.000', 'Calc Acres': '3.75' },
    loginLike: false,
  });
  return {
    id: 'lp', configured: () => true,
    async open() { phase = 'search'; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
    async search(q) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: phase === 'record' ? recordObs().fields : {}, snippets: [] }; },
    async screenshot(purpose) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
    async observe() { return phase === 'record' ? recordObs() : searchObs(); },
    async selectMethod(m) { calls.selectMethod.push(m); },
    async typeSearch(_s, v) { calls.typed.push(v); },
    async readCandidates() { return opts.candidates.map((text, index) => ({ index, text, kind: 'row' })); },
    async clickCandidate(i) { calls.clicked = i; phase = 'record'; },
    async clickByText() { /* nav */ },
    async setScope() { return []; },
    // expose calls for assertions
    ...( { _calls: calls } as Record<string, unknown> ),
  } as BrowserDriver;
}

describe('LandPortal agentic retrieval (Observe→Reason→Act→Verify→Learn)', () => {
  beforeEach(() => _initTestLandosDb());

  it('resolves the parcel by ADDRESS, extracts real facts, and FLAGS the wrong APN', async () => {
    const streamed: BrowserFact[] = [];
    const lp = makeLandPortalBrowser({ driver: landPortalFake({
      panelAddress: 'GILSTRAP RD', panelApn: '021 033C',
      candidates: ['388, Gilstrap Road White GA', '388, Gilstrap Drive Pickens SC', '388, Gilstrap Road Butler KY'],
    }) });
    // operator gave a WRONG apn (021 033 002) + the correct address.
    const ev = await lp.runWorkflow(
      { searchKey: { apn: '021 033 002', address: '388 GILSTRAP RD, CLEVELAND, GA 30528', county: 'White', state: 'GA' } },
      { timeoutMs: 2000, onFact: (f) => streamed.push(f) },
    );
    expect(ev.status).toBe('retrieved');
    const owner = ev.facts.find((f) => f.key === 'owner');
    expect(owner!.value).toBe('MAD HOUSE RENTALS LLC');
    expect(ev.facts.find((f) => f.key === 'apn')!.value).toBe('021 033C');
    expect(ev.facts.find((f) => f.key === 'acreage')!.value).toBe('4.000');
    // wrong APN is flagged as an identifier mismatch (needs_verification), not silently accepted
    const conflict = ev.facts.find((f) => f.key === 'apnConflict');
    expect(conflict).toBeTruthy();
    expect(conflict!.status).toBe('needs_verification');
    expect(conflict!.value).toMatch(/021 033 002.*does not match.*021 033C/);
    expect(ev.inspection?.parcelUrl).toBe('https://landportal.com/?property=abc');
    expect(ev.inspection?.parcelFacts['Parcel ID']).toBe('021 033C');
    expect((ev.inspection?.assets ?? []).some((a) => a.kind === 'parcel_page')).toBe(true);
    // facts streamed incrementally to the Deal Card
    expect(streamed.length).toBe(ev.facts.length);
    expect(streamed.some((f) => f.key === 'owner')).toBe(true);
  });

  it('refuses to extract when NO candidate is a confident, address-consistent match (no false facts)', async () => {
    const lp = makeLandPortalBrowser({ driver: landPortalFake({
      panelAddress: 'NOWHERE LANE', panelApn: '021 033C',
      candidates: ['100, Nowhere Lane Butte CA', '200, Elsewhere St Macon MO'], // none matches 388 Gilstrap
    }) });
    const ev = await lp.runWorkflow(
      { searchKey: { address: '388 GILSTRAP RD, CLEVELAND, GA 30528', county: 'White', state: 'GA' } },
      { timeoutMs: 2000 },
    );
    expect(ev.status).toBe('partial');
    expect(ev.facts).toHaveLength(0);
    expect(ev.note).toMatch(/no weak-match|no false facts/i);
  });
});
