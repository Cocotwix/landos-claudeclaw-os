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

  it('ACCEPTANCE (Scott County TN): APN/Parcel-ID search is PRIMARY, scoped State→County, tries all variants', async () => {
    // Fake LandPortal where APN search returns the parcel ONLY for the county's
    // indexed variant ("094 02008 000"), not the pasted dashed form ("094-020.08").
    // A correct agent must select APN search FIRST (not global/address), scope
    // Tennessee → Scott, and try every APN variant until the parcel opens.
    const calls = { selectMethod: [] as string[], scopes: [] as string[][], typed: [] as string[] };
    let phase: 'search' | 'record' = 'search';
    let lastTyped = '';
    const ACCEPTED = '094 02008 000';
    const searchObs = () => ({
      url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
      navItems: ['Map Search'], buttons: [], searchControls: [{ selector: '#main_search_input', placeholder: 'APN or Parcel ID' }],
      links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
    });
    const recordObs = () => ({
      url: 'https://landportal.com/?property=scott-tn', title: 'Land Portal', headings: ['Property Overview'],
      navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false,
      fields: { 'Owner Name': 'HENSON FAMILY TRUST', 'Parcel ID': ACCEPTED, 'Parcel Address': 'HENSON LN', 'County': 'Scott', 'State': 'TN', 'Acres': '12.5' },
      loginLike: false,
    });
    const driver = {
      id: 'lp', configured: () => true,
      async open() { phase = 'search'; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: phase === 'record' ? recordObs().fields : {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() { return phase === 'record' ? recordObs() : searchObs(); },
      async selectMethod(m: string) { calls.selectMethod.push(m); },
      async setScope(scope: string[]) { calls.scopes.push(scope); return scope; },
      async typeSearch(_s: string, v: string) { calls.typed.push(v); lastTyped = v; },
      // APN search only returns the parcel for the indexed variant; the dashed form finds nothing.
      // The result row shows the parcel APN (as LandPortal's APN search does).
      async readCandidates() { return lastTyped === ACCEPTED ? [{ index: 0, text: 'Henson Lane, Helenwood, Scott County, TN | APN: 094 02008 000', kind: 'row' }] : []; },
      async clickCandidate() { phase = 'record'; },
      async clickByText() { /* nav */ },
    } as unknown as BrowserDriver;

    const lp = makeLandPortalBrowser({ driver });
    const ev = await lp.runWorkflow(
      { searchKey: { apn: '094-020.08', apnAlternates: ['094 02008 000'], address: 'Henson Lane', county: 'Scott', state: 'TN' } },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    // APN/Parcel-ID search is the PRIMARY method — chosen before any global/address search.
    expect(calls.selectMethod[0]).toBe('apn');
    expect(calls.selectMethod.includes('address')).toBe(false);
    // Scoped State FIRST then County.
    expect(calls.scopes[0]).toEqual(['Tennessee', 'Scott']);
    // Tried BOTH APN variants (dashed first, then the county-indexed spaced form).
    expect(calls.typed).toContain('094-020.08');
    expect(calls.typed).toContain('094 02008 000');
    expect(calls.typed.indexOf('094-020.08')).toBeLessThan(calls.typed.indexOf('094 02008 000'));
    // Reached + confirmed the parcel; resolved APN matches a provided variant (no conflict).
    expect(ev.facts.find((f) => f.key === 'apn')!.value).toBe('094 02008 000');
    expect(ev.facts.some((f) => f.key === 'apnConflict')).toBe(false);
    expect(ev.inspection?.parcelUrl).toBe('https://landportal.com/?property=scott-tn');
  });

  it('ACCEPTANCE (APN autocomplete checkbox): decimal FIRST, select the option, then SUBMIT to open the parcel', async () => {
    // Real LandPortal APN behavior: typing the decimal APN ("094-020.08") surfaces a
    // matching parcel as a SELECTABLE CHECKBOX row. Selecting it only TICKS the box —
    // the parcel opens only after Search is submitted. A driver that treats the click
    // as a navigating result never opens the parcel. This asserts the fixed flow:
    // APN mode → State → County → type decimal → select option → submit → confirm.
    const calls = { selectMethod: [] as string[], scopes: [] as string[][], typed: [] as string[], selectedOption: false, submitted: false };
    let phase: 'search' | 'record' = 'search';
    let optionSelected = false;
    let lastTyped = '';
    const APN = '094-020.08';
    const searchObs = () => ({
      url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
      navItems: ['Map Search'], buttons: ['Search'], searchControls: [{ selector: '#main_search_input', placeholder: 'APN or Parcel ID' }],
      links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
      // Intermediate state the failure-diagnosis layer reads: typing the APN
      // surfaces a selectable checkbox option; once ticked, hasSelection flips and a
      // Search button is present → diagnosis = submit-after-select.
      interactive: {
        checkboxes: lastTyped === APN ? 1 : 0, radios: 0, selectableOptions: lastTyped === APN ? 1 : 0,
        submit: { present: true, disabled: false, label: 'Search' }, validationMessages: [],
        hasModal: false, hasSelection: optionSelected, filterActive: false,
      },
    });
    const recordObs = () => ({
      url: 'https://landportal.com/?property=scott-tn', title: 'Land Portal', headings: ['Property Overview'],
      navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false,
      fields: { 'Owner Name': 'HENSON FAMILY TRUST', 'Parcel ID': APN, 'Parcel Address': 'HENSON LN', 'County': 'Scott', 'State': 'TN', 'Acres': '12.5' },
      loginLike: false,
    });
    const driver = {
      id: 'lp', configured: () => true,
      async open() { phase = 'search'; optionSelected = false; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: phase === 'record' ? recordObs().fields : {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() { return phase === 'record' ? recordObs() : searchObs(); },
      async selectMethod(m: string) { calls.selectMethod.push(m); },
      async setScope(scope: string[]) { calls.scopes.push(scope); return scope; },
      async typeSearch(_s: string, v: string) { calls.typed.push(v); lastTyped = v; optionSelected = false; },
      // Typing the decimal APN surfaces one checkbox autocomplete option.
      async readCandidates() { return lastTyped === APN ? [{ index: 0, text: 'Henson Lane, Helenwood, Scott County, TN | APN: 094-020.08', kind: 'row' }] : []; },
      // Selecting the option only TICKS the checkbox — it does NOT navigate.
      async clickCandidate() { calls.selectedOption = true; optionSelected = true; /* stays on search */ },
      // The parcel opens ONLY when submit is clicked AFTER an option was selected.
      async submitSearch() { calls.submitted = true; if (optionSelected) phase = 'record'; },
      async clickByText() { /* nav */ },
    } as unknown as BrowserDriver;

    const lp = makeLandPortalBrowser({ driver });
    const ev = await lp.runWorkflow(
      { searchKey: { apn: '094-020.08', apnAlternates: ['094 02008 000', '09402008', '09402008000'], address: 'Henson Lane', county: 'Scott', state: 'TN' } },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    // 1) APN/Parcel-ID mode selected first (never global/address).
    expect(calls.selectMethod[0]).toBe('apn');
    expect(calls.selectMethod.includes('address')).toBe(false);
    // 2-3) Scoped State (Tennessee) then County (Scott).
    expect(calls.scopes[0]).toEqual(['Tennessee', 'Scott']);
    // 4) Decimal format typed FIRST; it succeeded so no fallback variant was needed.
    expect(calls.typed[0]).toBe('094-020.08');
    expect(calls.typed).toEqual(['094-020.08']);
    // 5-7) Selected the autocomplete checkbox option, THEN submitted to open the parcel.
    expect(calls.selectedOption).toBe(true);
    expect(calls.submitted).toBe(true);
    // 8) ParcelIdentity confirmed from the parcel detail page; resolved APN matches.
    expect(ev.facts.find((f) => f.key === 'apn')!.value).toBe('094-020.08');
    expect(ev.facts.some((f) => f.key === 'apnConflict')).toBe(false);
    expect(ev.inspection?.parcelUrl).toBe('https://landportal.com/?property=scott-tn');
  });

  it('APN autocomplete: falls back to alternate formats when the decimal finds no option', async () => {
    // If the decimal format surfaces NO autocomplete option, the flow must fall back
    // to the next APN variant (still select-then-submit), never give up after one try.
    const calls = { typed: [] as string[], submitted: 0 };
    let phase: 'search' | 'record' = 'search';
    let optionSelected = false;
    let lastTyped = '';
    const ACCEPTED = '094 02008 000';
    const searchObs = () => ({
      url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
      navItems: ['Map Search'], buttons: ['Search'], searchControls: [{ selector: '#s', placeholder: 'APN or Parcel ID' }],
      links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
      interactive: {
        checkboxes: lastTyped === ACCEPTED ? 1 : 0, radios: 0, selectableOptions: lastTyped === ACCEPTED ? 1 : 0,
        submit: { present: true, disabled: false, label: 'Search' }, validationMessages: [],
        hasModal: false, hasSelection: optionSelected, filterActive: false,
      },
    });
    const recordObs = () => ({
      url: 'https://landportal.com/?property=scott-tn', title: 'Land Portal', headings: ['Property Overview'],
      navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false,
      fields: { 'Owner Name': 'HENSON FAMILY TRUST', 'Parcel ID': ACCEPTED, 'Parcel Address': 'HENSON LN', 'County': 'Scott', 'State': 'TN', 'Acres': '12.5' },
      loginLike: false,
    });
    const driver = {
      id: 'lp', configured: () => true,
      async open() { phase = 'search'; optionSelected = false; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: phase === 'record' ? recordObs().fields : {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() { return phase === 'record' ? recordObs() : searchObs(); },
      async selectMethod() { /* apn */ },
      async setScope(scope: string[]) { return scope; },
      async typeSearch(_s: string, v: string) { calls.typed.push(v); lastTyped = v; optionSelected = false; },
      async readCandidates() { return lastTyped === ACCEPTED ? [{ index: 0, text: 'Henson Lane, Scott County, TN | APN: 094 02008 000', kind: 'row' }] : []; },
      async clickCandidate() { optionSelected = true; },
      async submitSearch() { calls.submitted += 1; if (optionSelected) phase = 'record'; },
      async clickByText() { /* nav */ },
    } as unknown as BrowserDriver;

    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { apn: '094-020.08', apnAlternates: ['094 02008 000', '09402008', '09402008000'], address: 'Henson Lane', county: 'Scott', state: 'TN' } },
      { timeoutMs: 2000 },
    );
    expect(ev.status).toBe('retrieved');
    // Decimal was tried FIRST, then the accepted spaced variant.
    expect(calls.typed[0]).toBe('094-020.08');
    expect(calls.typed).toContain('094 02008 000');
    expect(calls.typed.indexOf('094-020.08')).toBeLessThan(calls.typed.indexOf('094 02008 000'));
    expect(ev.facts.find((f) => f.key === 'apn')!.value).toBe('094 02008 000');
  });

  it('after submit-after-select recovery is ATTEMPTED, the failure note never claims the search was not submitted', async () => {
    // A stubborn site: the APN option is selected, submitSearch IS executed, but the
    // parcel still does not open. The workflow must attempt recovery and, on failure,
    // report the POST-recovery state — never "option selected but search not submitted".
    const calls = { submitted: 0 };
    let optionSelected = false;
    let lastTyped = '';
    const APN = '094-020.08';
    const searchObs = () => ({
      url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
      navItems: ['Map Search'], buttons: ['Search'], searchControls: [{ selector: '#term', placeholder: 'APN or Parcel ID' }],
      links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
      interactive: {
        checkboxes: lastTyped === APN ? 1 : 0, radios: 0, selectableOptions: lastTyped === APN ? 1 : 0,
        submit: { present: true, disabled: false, label: 'Search' }, validationMessages: [],
        hasModal: false, hasSelection: optionSelected, filterActive: false,
      },
    });
    const driver = {
      id: 'lp', configured: () => true,
      async open() { optionSelected = false; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() { return searchObs(); },
      async selectMethod() { /* apn */ },
      async setScope(scope: string[]) { return scope; },
      async typeSearch(_s: string, v: string) { lastTyped = v; optionSelected = false; },
      async readCandidates() { return lastTyped === APN ? [{ index: 0, text: 'Scott County, TN | APN: 094-020.08', kind: 'row' }] : []; },
      async clickCandidate() { optionSelected = true; },
      // submitSearch runs but the parcel never opens (stubborn site).
      async submitSearch() { calls.submitted += 1; },
      async clickByText() { /* nav */ },
    } as unknown as BrowserDriver;

    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { apn: '094-020.08', county: 'Scott', state: 'TN' } },
      { timeoutMs: 2000 },
    );
    expect(ev.status).toBe('partial');
    // submitSearch WAS executed as part of recovery.
    expect(calls.submitted).toBeGreaterThan(0);
    // The forbidden message must NOT survive a recovery attempt.
    expect(ev.note).not.toMatch(/not submitted/i);
    expect(ev.note).not.toMatch(/was not submitted/i);
    // The note transparently reports that recovery was attempted post-select.
    expect(ev.note).toMatch(/Recovery was attempted/i);
    // No parcel reached → no facts / no ParcelIdentity (nothing downstream).
    expect(ev.facts).toHaveLength(0);
  });

  // Minimal recording fake: exposes the method chosen + candidates it returns.
  function recordingFake(candidates: string[], panel: Record<string, string>) {
    const calls = { selectMethod: [] as string[], scopes: [] as string[][], typed: [] as string[] };
    let phase: 'search' | 'record' = 'search';
    const searchObs = () => ({
      url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
      navItems: ['Map Search'], buttons: [], searchControls: [{ selector: '#s', placeholder: 'APN, Address, or Owner' }],
      links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'Address' },
    });
    const recordObs = () => ({
      url: 'https://landportal.com/?property=rec', title: 'Land Portal', headings: ['Property Overview'],
      navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false, fields: panel, loginLike: false,
    });
    const driver = {
      id: 'lp', configured: () => true,
      async open() { phase = 'search'; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: phase === 'record' ? panel : {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() { return phase === 'record' ? recordObs() : searchObs(); },
      async selectMethod(m: string) { calls.selectMethod.push(m); },
      async setScope(scope: string[]) { calls.scopes.push(scope); return scope; },
      async typeSearch(_s: string, v: string) { calls.typed.push(v); },
      async readCandidates() { return candidates.map((text, index) => ({ index, text, kind: 'row' })); },
      async clickCandidate() { phase = 'record'; },
      async clickByText() { /* nav */ },
    } as unknown as BrowserDriver;
    return { driver, calls };
  }

  it('address-only input STARTS with address/global search (no APN present)', async () => {
    const { driver, calls } = recordingFake(
      ['388, Gilstrap Road White GA'],
      { 'Owner Name': 'MAD HOUSE RENTALS LLC', 'Parcel ID': '021 033C', 'Parcel Address': 'GILSTRAP RD', 'Acres': '4.0' },
    );
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { address: '388 Gilstrap Rd, Cleveland, GA 30528', county: 'White', state: 'GA' } },
      { timeoutMs: 2000 },
    );
    expect(ev.status).toBe('retrieved');
    expect(calls.selectMethod[0]).toBe('address'); // address is the strongest available start
    expect(calls.selectMethod.includes('apn')).toBe(false);
  });

  it('owner-only input STARTS with owner search (no APN, no address)', async () => {
    const { driver, calls } = recordingFake(
      ['MAD HOUSE RENTALS LLC — White County, GA'],
      { 'Owner Name': 'MAD HOUSE RENTALS LLC', 'Parcel ID': '021 033C', 'County': 'White', 'State': 'GA' },
    );
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { owner: 'MAD HOUSE RENTALS LLC', county: 'White', state: 'GA' } },
      { timeoutMs: 2000 },
    );
    // Owner search is the chosen START; APN/address never lead when absent.
    expect(calls.selectMethod[0]).toBe('owner');
    expect(calls.selectMethod.includes('apn')).toBe(false);
    expect(calls.selectMethod.includes('address')).toBe(false);
    expect(calls.scopes[0]).toEqual(['Georgia', 'White']); // State first, County second
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
