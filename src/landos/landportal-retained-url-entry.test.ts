// A subject that already carries its own verified canonical LandPortal parcel
// URL must be READ, not searched for again. On a live 300-second run the surface
// hops plus the ranked search consumed the whole window and the deterministic
// capture — which reaches the same record in seconds when handed the URL — never
// executed. These tests hold that behavior: with a retained URL the run opens the
// record directly and enters the capture there; without one, or when the retained
// URL no longer opens a record that verifies as the subject, the existing search
// path still runs.

import { describe, it, expect, beforeEach } from 'vitest';
import { makeLandPortalBrowser } from './landportal-browser.js';
import type { BrowserDriver } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = Buffer.from('fips=47065&apn=023 003.02&propertyid=172954755').toString('base64');
const RETAINED_URL = `https://landportal.com/?property=${TOKEN}`;

const SEARCH_KEY = {
  apn: '023 003.02',
  address: '5170 HIGHWAY 60, BIRCHWOOD, TN 37308',
  county: 'Hamilton',
  state: 'TN',
};

interface FakeCalls {
  opened: string[];
  selectMethod: string[];
  typed: string[];
  candidateReads: number;
  capturedAt: string[];
}

/** A LandPortal fake that serves the parcel record ONLY at the canonical URL. */
function landPortalFake(opts: { recordUrlOpens: boolean }): { driver: BrowserDriver; calls: FakeCalls } {
  const calls: FakeCalls = { opened: [], selectMethod: [], typed: [], candidateReads: 0, capturedAt: [] };
  let phase: 'search' | 'record' = 'search';
  const searchObs = () => ({
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search'], buttons: [],
    searchControls: [{ selector: '#main_search_input', placeholder: 'APN or Parcel ID' }],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
  });
  const recordObs = () => ({
    url: RETAINED_URL, title: 'Land Portal', headings: ['Property Overview'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: false, hasTable: false,
    fields: {
      'Owner Name': 'BUTTLEMAN LAND LLC', 'Parcel ID': '023 003.02', 'Parcel Address': '5170 HIGHWAY 60',
      County: 'Hamilton', State: 'TN', Acres: '40.5',
    },
    loginLike: false,
  });
  const driver = {
    id: 'lp', configured: () => true,
    async open(url: string) {
      calls.opened.push(url);
      phase = opts.recordUrlOpens && url === RETAINED_URL ? 'record' : 'search';
      return { url, fields: {}, snippets: [] };
    },
    async search(q: string) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: phase === 'record' ? recordObs().fields : {}, snippets: [] }; },
    async screenshot(purpose: string) { return { path: '/tmp/lp-retained.png', capturedAtIso: 't', purpose }; },
    async observe() { return phase === 'record' ? recordObs() : searchObs(); },
    async selectMethod(m: string) { calls.selectMethod.push(m); },
    async setScope(scope: string[]) { return scope; },
    async readScope() { return { available: true, state: 'Tennessee', county: 'Hamilton', extras: [] }; },
    async typeSearch(_s: string, v: string) { calls.typed.push(v); },
    async readCandidates() {
      calls.candidateReads += 1;
      return [{ index: 0, text: '5170 Highway 60, Birchwood, Hamilton County, TN | APN: 023 003.02', kind: 'row' }];
    },
    async clickCandidate() { phase = 'record'; },
    async clickByText() { /* nav */ },
    async captureLandPortalVisuals(url: string, opts: { onSubjectFacts?: (p: { url: string; fields: Record<string, string> }) => void }) {
      calls.capturedAt.push(url);
      // The live capture announces the parcel facts here, before any imagery.
      opts.onSubjectFacts?.({ url, fields: recordObs().fields });
      return {
        fields: recordObs().fields, parcelShotPath: null, compsMapShotPath: null,
        compRows: [], mapReached: false, capturedAtIso: 't',
      };
    },
  } as unknown as BrowserDriver;
  return { driver, calls };
}

describe('LandPortal retained parcel URL entry', () => {
  beforeEach(() => _initTestLandosDb());

  it('opens the retained parcel record directly and never runs the search sequence', async () => {
    const { driver, calls } = landPortalFake({ recordUrlOpens: true });
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...SEARCH_KEY, landPortalParcelUrl: RETAINED_URL } },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    // The record is entered at the retained URL, first navigation of the run.
    expect(calls.opened[0]).toBe(RETAINED_URL);
    // No surface hop, no ranked search, no typeahead: that is the whole point.
    expect(calls.selectMethod).toEqual([]);
    expect(calls.typed).toEqual([]);
    expect(calls.candidateReads).toBe(0);
    // The deterministic capture is entered at that same record URL.
    expect(calls.capturedAt).toEqual([RETAINED_URL]);
    // The parcel is still visually verified before anything is extracted.
    expect(ev.visualCheckpoints?.some((c) => c.kind === 'parcel_selected' && c.passed)).toBe(true);
    expect(ev.facts.find((f) => f.key === 'apn')?.value).toBe('023 003.02');
  });

  it('hands the subject facts to the run hook as soon as the capture reads them', async () => {
    const { driver } = landPortalFake({ recordUrlOpens: true });
    const handoffs: Array<{ url: string; fields: Record<string, string> }> = [];
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...SEARCH_KEY, landPortalParcelUrl: RETAINED_URL } },
      { timeoutMs: 2000, onSubjectFacts: (payload) => handoffs.push(payload) },
    );

    expect(ev.status).toBe('retrieved');
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].url).toBe(RETAINED_URL);
    expect(handoffs[0].fields['Parcel ID']).toBe('023 003.02');
  });

  it('still runs the search sequence when no parcel URL is retained', async () => {
    const { driver, calls } = landPortalFake({ recordUrlOpens: true });
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: SEARCH_KEY },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    expect(calls.opened[0]).toBe('https://landportal.com');
    expect(calls.selectMethod[0]).toBe('apn');
    expect(calls.typed).toContain('023 003.02');
  });

  it('falls back to the search sequence when the retained URL opens no parcel record', async () => {
    const { driver, calls } = landPortalFake({ recordUrlOpens: false });
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...SEARCH_KEY, landPortalParcelUrl: RETAINED_URL } },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    expect(calls.opened[0]).toBe(RETAINED_URL);
    // A stale URL costs one navigation, then the ordinary search path takes over.
    expect(calls.opened).toContain('https://landportal.com');
    expect(calls.selectMethod[0]).toBe('apn');
    expect(calls.typed).toContain('023 003.02');
  });
});
