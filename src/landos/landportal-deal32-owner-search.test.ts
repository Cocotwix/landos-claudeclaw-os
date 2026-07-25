// Deal 32 (Roane County, TN) — the live case this sprint had to fix.
//
// LandOS had every confirmed fact it needed (owner SACHAN DILEEP S, OLD RIDGE RD,
// KINGSTON TN 37763, Roane County, state-format APN 073090 04200, 12.28 acres,
// coordinates) and still reported "40 candidates, no confident match" while the
// correct result was visibly the FIRST row of an owner search scoped to Tennessee
// → Roane. Manual verification proved the result was right there.
//
// These run the REAL shared LandPortal workflow against a fake LandPortal that
// reproduces the observed behaviour: the state-format APN collides with a
// Davidson-county (Nashville) parcel, and only the owner search reaches Roane.

import { describe, it, expect, beforeEach } from 'vitest';

import type { BrowserDriver } from './browser-intelligence.js';
import { _initTestLandosDb } from './db.js';
import { makeLandPortalBrowser } from './landportal-browser.js';

const ROANE_ROW = 'OLD RIDGE RD  090 04200  KINGSTON, TN, 37763  SACHAN DILEEP S  12.28 ac';
const NASHVILLE_ROW = '2604 COOPER LN  073-09-0-042-00  NASHVILLE, TN, 37216  SMOTHERMAN DEBRA';
// The 39 unrelated same-state rows LandPortal returns alongside the match.
const NOISE = Array.from({ length: 39 }, (_, i) => `PARCEL ${i} RD  1${i}0 0${i}100  MEMPHIS, TN, 381${String(i).padStart(2, '0')}  UNRELATED OWNER ${i}`);

/**
 * A LandPortal whose APN search lands on the Davidson-county collision and whose
 * owner search returns the correct Roane parcel first among 40 candidates.
 */
function roaneLandPortal() {
  const calls = { selectMethod: [] as string[], scopes: [] as string[][], typed: [] as string[], screenshots: [] as string[] };
  let phase: 'search' | 'nashville' | 'roane' = 'search';
  let lastTyped = '';
  let lastMethod = '';

  const searchObs = () => ({
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search', 'Market research'], buttons: ['Search'],
    searchControls: [{ selector: '#main_search_input', placeholder: 'APN, Address, or Owner', value: lastTyped }],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false,
    methodToggle: { current: lastMethod === 'owner' ? 'Owner' : lastMethod === 'apn' ? 'APN' : 'Address' },
  });
  // The Nashville parcel: same APN digits, entirely different property.
  const nashvilleObs = () => ({
    url: 'https://landportal.com/?property=davidson-tn', title: 'Land Portal', headings: ['Property Overview'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: true, hasTable: false,
    fields: {
      'Owner Name': 'SMOTHERMAN DEBRA', 'Parcel ID': '073-09-0-042-00', 'Parcel Address': '2604 COOPER LN',
      'City': 'NASHVILLE', 'County': 'Davidson', 'State': 'TN', 'Acres': '0.24',
    },
    loginLike: false,
  });
  // The subject parcel, as LandPortal renders it with the county-local APN.
  const roaneObs = () => ({
    url: 'https://landportal.com/?property=roane-tn', title: 'Land Portal', headings: ['Property Overview'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: true, hasTable: false,
    fields: {
      'Owner Name': 'SACHAN DILEEP S', 'Parcel ID': '090 04200', 'Parcel Address': 'OLD RIDGE RD',
      'City': 'KINGSTON', 'County': 'Roane', 'State': 'TN', 'Acres': '12.28',
      'Latitude': '35.80044', 'Longitude': '-84.46382',
    },
    loginLike: false,
  });

  const driver = {
    id: 'lp', configured: () => true,
    async open() { phase = 'search'; lastTyped = ''; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
    async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: {}, snippets: [] }; },
    async screenshot(purpose: string) { calls.screenshots.push(purpose); return { path: '/artifacts/lp.png', capturedAtIso: '2026-07-24T18:00:00.000Z', purpose }; },
    async observe() {
      return phase === 'roane' ? roaneObs() : phase === 'nashville' ? nashvilleObs() : searchObs();
    },
    async selectMethod(m: string) { calls.selectMethod.push(m); lastMethod = m; },
    async setScope(scope: string[]) { calls.scopes.push(scope); return scope; },
    async typeSearch(_s: string, v: string) { calls.typed.push(v); lastTyped = v; phase = 'search'; },
    async readCandidates() {
      if (lastMethod === 'owner' && /SACHAN/i.test(lastTyped)) {
        return [ROANE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' }));
      }
      if (lastMethod === 'apn') {
        // Every APN variant collides with the Nashville parcel and nothing else.
        return [NASHVILLE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' }));
      }
      return [];
    },
    async clickCandidate(i: number) {
      if (lastMethod === 'owner' && i === 0) { phase = 'roane'; return; }
      if (lastMethod === 'apn' && i === 0) { phase = 'nashville'; return; }
    },
    async clickByText() { /* nav */ },
  } as unknown as BrowserDriver;

  return { driver, calls };
}

const DEAL_32_KEY = {
  apn: '073090 04200',
  apnAlternates: ['090 04200', '073090-04200', '07309004200'],
  owner: 'SACHAN DILEEP S',
  address: 'OLD RIDGE RD, KINGSTON, TN 37763',
  city: 'KINGSTON',
  county: 'Roane',
  state: 'TN',
  zip: '37763',
  // Already confirmed by the Tennessee Comptroller record — used only to
  // cross-check the parcel LandPortal opens, never to search.
  acreage: 12.28,
  lat: 35.80044080703417,
  lng: -84.46381750244866,
};

describe('Deal 32 — LandPortal owner search reaches the OLD RIDGE RD Roane parcel', () => {
  beforeEach(() => _initTestLandosDb());

  it('resolves the subject parcel instead of reporting "no confident match"', async () => {
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });

    expect(ev.status).toBe('retrieved');
    expect(ev.note).not.toMatch(/no confident match/i);
    expect(ev.inspection?.parcelUrl).toBe('https://landportal.com/?property=roane-tn');
    expect(ev.facts.find((f) => f.key === 'owner')?.value).toBe('SACHAN DILEEP S');
    expect(ev.facts.find((f) => f.key === 'apn')?.value).toBe('090 04200');
  });

  it('tries county + state + APN first, then falls back to the exact owner search', async () => {
    const { driver, calls } = roaneLandPortal();
    await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });

    expect(calls.selectMethod[0]).toBe('apn');
    expect(calls.selectMethod).toContain('owner');
    // Every search is scoped Tennessee → Roane before anything is submitted.
    for (const scope of calls.scopes) expect(scope).toEqual(['Tennessee', 'Roane']);
    expect(calls.typed).toContain('SACHAN DILEEP S');
  });

  it('rejects the cross-county Nashville APN collision and keeps adapting', async () => {
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });

    // The Davidson parcel was reached and refused, never accepted as the subject.
    expect(ev.note).toMatch(/ADDR-MISMATCH|visual\(parcel\) BLOCKED/);
    expect(ev.inspection?.parcelUrl).not.toMatch(/davidson/);
    expect(ev.facts.find((f) => f.key === 'owner')?.value).not.toBe('SMOTHERMAN DEBRA');
  });

  it('reconciles the state-format APN with the county-local APN rather than flagging a conflict', async () => {
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });
    // 073090 04200 and 090 04200 are the same Roane parcel in two formats.
    expect(ev.facts.some((f) => f.key === 'apnConflict')).toBe(false);
  });

  it('visually verifies the configured search, the result, and the selected parcel', async () => {
    const { driver, calls } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });

    const kinds = (ev.visualCheckpoints ?? []).filter((c) => c.passed).map((c) => c.kind);
    expect(kinds).toContain('search_configuration');
    expect(kinds).toContain('result_selection');
    expect(kinds).toContain('parcel_selected');
    // The agent actually looked at the page before each consequential action.
    expect(calls.screenshots).toContain('landportal_search_configuration_verify');
    expect(calls.screenshots).toContain('landportal_parcel_selection_verify');
    expect(ev.note).toMatch(/visually verified \[/);
  });

  it('the passing parcel checkpoint compared owner, road, county, state, APN and acreage', async () => {
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });
    const parcel = (ev.visualCheckpoints ?? []).filter((c) => c.kind === 'parcel_selected' && c.passed).pop();
    expect(parcel).toBeTruthy();
    const confirmed = parcel!.confirmed.join(' ');
    expect(confirmed).toMatch(/Owner of record matches: SACHAN DILEEP S/);
    expect(confirmed).toMatch(/Road\/situs matches: OLD RIDGE RD/);
    expect(confirmed).toMatch(/County matches: Roane/);
    expect(confirmed).toMatch(/APN reconciles with the subject identifier: 090 04200/);
    expect(confirmed).toMatch(/Acreage matches: 12\.28/);
  });

  it('records a capture verdict for every LandPortal screenshot', async () => {
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs: 4000 });
    expect(ev.captureVerdicts?.length).toBeGreaterThan(0);
    for (const v of ev.captureVerdicts ?? []) {
      expect(['accepted', 'recapture_required', 'unavailable']).toContain(v.result);
    }
    // Only accepted captures are presented as evidence.
    const accepted = (ev.captureVerdicts ?? []).filter((v) => v.result === 'accepted').length;
    expect(ev.screenshots.length).toBe(accepted);
  });
});
