// Entering LandPortal at the operator's own saved-map link.
//
// Measured on the live site: opening `https://landportal.com/?map=<uuid>` lands
// ON the parcel with its detail panel already rendered — Parcel ID, owner,
// acres, building area, county, all 67 fields — and the app never rewrites the
// URL to the `?property=` form. The direct-entry block required that URL shape,
// so it declared the record "NOT-A-RECORD", threw away the page it was already
// looking at, and fell back to a blind address search. On Deal 90 that search
// selected the NEIGHBOURING parcel and wrote its APN, owner and 1,404 sqft house
// onto the subject.
//
// These tests hold the repaired behaviour: the opened record is read through the
// same deterministic capture the search path uses, verified by the same parcel
// checkpoint, and the search sequence never runs. A record that does NOT verify
// still falls back to searching, exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';

import { makeLandPortalBrowser } from './landportal-browser.js';
import type { BrowserDriver } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';

const MAP_URL = 'https://landportal.com/?map=c40db262-40b0-4de4-b5a9-b1d4c3b1ad00';

/** The parcel panel as the live saved-map view actually renders it. */
const PANEL: Record<string, string> = {
  'Owner Name': 'HILL EUGENE W',
  'Parcel ID': '00083-A-03400',
  'Parcel Address': '19554 NW 137TH LN',
  Acres: '1.500',
  'Building SqFt': '0',
  'Parcel Address City': 'LAKE BUTLER',
  'Parcel Address Zip Code': '32054',
  'Parcel Address State': 'FL',
  'Parcel Address County': 'Bradford County',
  'Parcel Use Description': 'Vacant Land (General)',
  'Centroid Latitude': '30.001341270725646',
  'Centroid Longitude': '-82.27156414857723',
};

interface Calls {
  opened: string[];
  selectMethod: string[];
  typed: string[];
  candidateReads: number;
  capturedAt: string[];
}

/**
 * A LandPortal fake with the live site's defining property: the saved-map URL
 * serves the parcel panel through the CAPTURE reader only. The generic
 * label/value page reader sees nothing useful, because on the real site it
 * doesn't either — LandPortal renders the panel as tab-rows.
 */
function landPortalFake(opts: { panel?: Record<string, string> } = {}): { driver: BrowserDriver; calls: Calls } {
  const calls: Calls = { opened: [], selectMethod: [], typed: [], candidateReads: 0, capturedAt: [] };
  const panel = opts.panel ?? PANEL;
  let phase: 'search' | 'map' = 'search';
  const searchObs = () => ({
    url: 'https://landportal.com/', title: 'Land Portal', headings: ['Map Search'],
    navItems: ['Map Search'], buttons: [],
    searchControls: [{ selector: '#main_search_input', placeholder: 'APN or Parcel ID' }],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'APN' },
  });
  const mapObs = () => ({
    url: MAP_URL, title: 'Land Portal', headings: ['Map Search'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [],
    hasMap: true, hasTable: false,
    // The generic reader cannot see the panel — this is the live behaviour.
    fields: {}, loginLike: false,
  });
  const driver = {
    id: 'lp', configured: () => true,
    async open(url: string) {
      calls.opened.push(url);
      phase = url === MAP_URL ? 'map' : 'search';
      return { url, fields: {}, snippets: [] };
    },
    async search(q: string) { return { url: `search:${q}`, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: {}, snippets: [] }; },
    async screenshot(purpose: string) { return { path: '/tmp/lp-map.png', capturedAtIso: 't', purpose }; },
    async observe() { return phase === 'map' ? mapObs() : searchObs(); },
    async selectMethod(m: string) { calls.selectMethod.push(m); },
    async setScope(scope: string[]) { return scope; },
    async readScope() { return { available: true, state: 'Florida', county: 'Bradford', extras: [] }; },
    async typeSearch(_s: string, v: string) { calls.typed.push(v); },
    async readCandidates() {
      calls.candidateReads += 1;
      // What the address search actually returned live: the NEIGHBOUR first.
      return [{ index: 0, text: '19502 NW 137th Ln, Lake Butler, Bradford County, FL | APN: 00083-A-03600', kind: 'row' }];
    },
    async clickCandidate() { /* would open the neighbour */ },
    async clickByText() { /* nav */ },
    async captureLandPortalVisuals(url: string, o: { onSubjectFacts?: (p: { url: string; fields: Record<string, string> }) => void }) {
      calls.capturedAt.push(url);
      o.onSubjectFacts?.({ url, fields: panel });
      return {
        fields: panel, parcelShotPath: '/tmp/lp-parcel.png', compsMapShotPath: null,
        compRows: [], mapReached: false, capturedAtIso: 't',
      };
    },
  } as unknown as BrowserDriver;
  return { driver, calls };
}

/** The subject as the OPERATOR described it: an address and a state, no APN. */
const OPERATOR_SUBJECT = {
  address: '19554 NW 137TH LN, LAKE BUTLER, FL',
  city: 'Lake Butler',
  state: 'FL',
  zip: '32054',
};

/** What a previous wrong run left on the card: the NEIGHBOUR's identity. */
const CONTAMINATED_KEY = {
  apn: '00083-A-03600',
  owner: 'MADDOX LARRY H',
  address: '19502 NW 137TH LN',
  county: 'Bradford',
  state: 'FL',
};

describe('operator saved-map link enters the record directly', () => {
  beforeEach(() => _initTestLandosDb());

  it('opens the link, reads the panel and verifies it without ever searching', async () => {
    const { driver, calls } = landPortalFake();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      {
        searchKey: {
          ...CONTAMINATED_KEY,
          landPortalParcelUrl: MAP_URL,
          operatorSuppliedSubject: OPERATOR_SUBJECT,
        },
      },
      { timeoutMs: 2000 },
    );

    expect(ev.status).toBe('retrieved');
    // First navigation is the operator's own link.
    expect(calls.opened[0]).toBe(MAP_URL);
    // No surface hop, no ranked search, no typeahead — the whole point.
    expect(calls.selectMethod).toEqual([]);
    expect(calls.typed).toEqual([]);
    expect(calls.candidateReads).toBe(0);
    // The parcel is still visually verified before anything is extracted.
    expect(ev.visualCheckpoints?.some((c) => c.kind === 'parcel_selected' && c.passed)).toBe(true);
    // And the identity extracted is the record's own, not the card's stale one.
    expect(ev.facts.find((f) => f.key === 'apn')?.value).toBe('00083-A-03400');
  });

  it('captures once, not twice, when direct entry already read the record', async () => {
    const { driver, calls } = landPortalFake();
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000 },
    );
    expect(calls.capturedAt).toEqual([MAP_URL]);
  });

  it('announces the subject as VERIFIED, so the same run can admit it', async () => {
    // The announcement used to fire when the panel was read, before the parcel
    // checkpoint had judged it. The consumer therefore had no verdict to record,
    // the verdict only reached it once the full capture had persisted, and the
    // subject resolved one invocation LATE: run N verified, run N+1 admitted.
    // The run that opens and confirms the parcel must be the run that admits it.
    const { driver } = landPortalFake();
    const handoffs: Array<{ url: string; fields: Record<string, string>; verifiedParcelApn?: string | null }> = [];
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000, onSubjectFacts: (p) => handoffs.push(p) },
    );
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].fields['Parcel ID']).toBe('00083-A-03400');
    // The identifier the OPENED RECORD stated, carried with the announcement.
    expect(handoffs[0].verifiedParcelApn).toBe('00083-A-03400');
  });

  it('never announces a parcel the checkpoint refused', async () => {
    // A saved-map link pointing at a different property announces nothing, so
    // no consumer can record a verification that did not happen.
    const { driver } = landPortalFake({
      panel: { ...PANEL, 'Parcel Address': '4100 STATE ROAD 100', 'Parcel Address State': 'GA' },
    });
    const handoffs: Array<{ verifiedParcelApn?: string | null }> = [];
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000, onSubjectFacts: (p) => handoffs.push(p) },
    );
    expect(handoffs).toHaveLength(0);
  });

  it('is not vetoed by the wrong owner a previous unverified run wrote on the card', async () => {
    // Without the operator-supplied subject the checkpoint compares the real
    // owner on screen against the neighbour's owner on the card, blocks, and
    // falls back to the search that produced the neighbour in the first place.
    const { driver: blocked, calls: blockedCalls } = landPortalFake();
    await makeLandPortalBrowser({ driver: blocked }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL } },
      { timeoutMs: 2000 },
    );
    expect(blockedCalls.typed.length).toBeGreaterThan(0);

    // With it, the operator's own link wins and no search runs.
    const { driver, calls } = landPortalFake();
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000 },
    );
    expect(calls.typed).toEqual([]);
  });

  it('falls back to the ordinary search when the opened record is a different property', async () => {
    // A saved-map link pointing somewhere else entirely: the checkpoint blocks
    // on the situs and the run does what it always did.
    const { driver, calls } = landPortalFake({
      panel: { ...PANEL, 'Parcel Address': '4100 STATE ROAD 100', 'Parcel Address State': 'GA' },
    });
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000 },
    );
    expect(calls.opened[0]).toBe(MAP_URL);
    expect(calls.opened).toContain('https://landportal.com');
    expect(calls.typed.length).toBeGreaterThan(0);
  });

  it('falls back to the ordinary search when the opened page shows no parcel panel', async () => {
    const { driver, calls } = landPortalFake({ panel: {} });
    await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...CONTAMINATED_KEY, landPortalParcelUrl: MAP_URL, operatorSuppliedSubject: OPERATOR_SUBJECT } },
      { timeoutMs: 2000 },
    );
    expect(calls.opened[0]).toBe(MAP_URL);
    expect(calls.typed.length).toBeGreaterThan(0);
  });
});
