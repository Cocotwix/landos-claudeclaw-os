import { describe, it, expect } from 'vitest';
import { officialResolutionLane, landPortalResolutionLane } from './parallel-resolution-lanes.js';
import type { OfficialParcelLookupResult, OfficialParcel } from './public-property-intelligence-live.js';
import type { BrowserService, BrowserEvidence } from './browser-intelligence.js';
import { emptyEvidence } from './browser-intelligence.js';

const fakeOfficialParcel: OfficialParcel = {
  provider: 'Tennessee Comptroller public parcel layer',
  sourceUrl: 'https://tn.example/parcel',
  address: '171 CAMP DAVIDSON RD',
  county: 'Monroe',
  state: 'TN',
  apn: '062 059G A 03400 000 2026',
  owner: 'DORTMUNDT FRANKLIN DAVID',
  acres: 5.0,
  coordinates: { lat: 35.6, lng: -84.2 },
  geometry: { rings: [] },
  datasetDate: null,
  facts: {},
};

const lookupMatched: () => Promise<OfficialParcelLookupResult> = async () => ({
  parcel: fakeOfficialParcel,
  attempted: [{ source: 'Tennessee Comptroller public parcel layer', status: 'matched', note: 'Exact match.' }],
});
const lookupNoAdapter: () => Promise<OfficialParcelLookupResult> = async () => ({
  parcel: null,
  attempted: [{ source: 'Official public parcel lookup', status: 'unavailable', note: 'No tested public parcel adapter is available for this jurisdiction.' }],
});

describe('officialResolutionLane', () => {
  it('maps a matched official parcel to a confirmed lane outcome', async () => {
    const out = await officialResolutionLane({ address: '171 Camp Davidson Rd', county: 'Monroe', state: 'TN' }, 5000, lookupMatched);
    expect(out.status).toBe('confirmed');
    expect(out.confirmedIdentity).toBe(true);
    expect(out.parcel?.apn).toBe('062 059G A 03400 000 2026');
    expect(out.parcel?.source).toContain('Tennessee Comptroller');
  });

  it('maps a no-adapter jurisdiction to unavailable (non-fatal), not an error', async () => {
    const out = await officialResolutionLane({ address: '200 Sid Edens Rd', county: 'Pickens', state: 'SC' }, 5000, lookupNoAdapter);
    expect(out.status).toBe('unavailable');
    expect(out.confirmedIdentity).toBe(false);
    expect(out.note).toMatch(/no tested public parcel adapter/i);
  });
});

const landPortalService = (ev: BrowserEvidence, configured = true): BrowserService => ({
  id: 'landportal',
  label: 'LandPortal',
  modes: ['workflow'],
  configured: () => configured,
  runWorkflow: async () => ev,
  ask: async () => ev,
});

describe('landPortalResolutionLane', () => {
  it('returns unavailable when there is no authenticated session', async () => {
    const out = await landPortalResolutionLane(undefined, { address: 'x' }, 5000);
    expect(out.status).toBe('unavailable');
    expect(out.confirmedIdentity).toBe(false);
  });

  it('confirms identity from a retrieved parcel panel with APN + jurisdiction + URL', async () => {
    const ev = emptyEvidence('landportal', 'workflow');
    ev.status = 'retrieved';
    ev.patch = { apn: '094-020.08', county: 'Scott', state: 'TN', owner: 'LAND JAMES ROBERT', acres: 0.98 };
    ev.sourceUrls = ['https://landportal.com/parcel/xyz'];
    ev.note = 'Parcel panel read.';
    const out = await landPortalResolutionLane(landPortalService(ev), { apn: '094-020.08' }, 5000);
    expect(out.status).toBe('confirmed');
    expect(out.confirmedIdentity).toBe(true);
    expect(out.parcel?.owner).toBe('LAND JAMES ROBERT');
    expect(out.parcel?.sourceUrl).toContain('landportal.com');
  });

  it('downgrades to candidate when the retrieved read lacks a parcel-level identity', async () => {
    const ev = emptyEvidence('landportal', 'workflow');
    ev.status = 'retrieved';
    ev.patch = { county: 'Scott', state: 'TN' }; // no APN, no URL
    const out = await landPortalResolutionLane(landPortalService(ev), { address: 'x' }, 5000);
    expect(out.status).toBe('candidate');
    expect(out.confirmedIdentity).toBe(false);
  });

  it('maps a parked/blocked run to unavailable', async () => {
    const ev = emptyEvidence('landportal', 'workflow'); // status defaults to 'parked'
    const out = await landPortalResolutionLane(landPortalService(ev), { address: 'x' }, 5000);
    expect(out.status).toBe('unavailable');
  });
});
