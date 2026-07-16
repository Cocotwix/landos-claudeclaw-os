import { describe, it, expect } from 'vitest';
import {
  resolveParcelParallel,
  reconcileResolution,
  reconcileLanes,
  runResolutionLanes,
  compactApn,
  haversineMeters,
  type LaneOutcome,
  type ParallelResolutionDeps,
  type ParallelResolutionInput,
} from './parallel-resolution.js';

const officialParcel = (over: Partial<LaneOutcome['parcel']> = {}): LaneOutcome => ({
  lane: 'official_public',
  status: 'confirmed',
  confirmedIdentity: true,
  parcel: { source: 'County GIS parcel page', apn: '123-45-678', owner: 'SMITH JOHN', acres: 5.1, county: 'Pickens', state: 'SC', coordinates: { lat: 34.9, lng: -82.7 }, sourceUrl: 'https://gis.example/parcel', ...over },
  attempts: [{ source: 'County GIS', status: 'matched', note: 'exact parcel matched' }],
  note: 'official confirmed',
});

const landPortalParcel = (over: Partial<LaneOutcome['parcel']> = {}): LaneOutcome => ({
  lane: 'landportal',
  status: 'confirmed',
  confirmedIdentity: true,
  parcel: { source: 'LandPortal parcel panel', apn: '1234-5678', owner: 'John Smith', acres: 5.12, county: 'Pickens County', state: 'SC', coordinates: { lat: 34.9001, lng: -82.7001 }, sourceUrl: 'https://landportal.example/p', ...over },
  attempts: [{ source: 'LandPortal', status: 'matched', note: 'parcel panel read' }],
  note: 'landportal confirmed',
});

const unavailable = (lane: LaneOutcome['lane'], note: string): LaneOutcome => ({
  lane, status: 'unavailable', confirmedIdentity: false, parcel: null,
  attempts: [{ source: lane, status: 'unavailable', note }], note,
});

const depsFrom = (official: LaneOutcome, landportal: LaneOutcome): ParallelResolutionDeps => ({
  officialLane: async () => official,
  landPortalLane: async () => landportal,
});

const input = (apn?: string): ParallelResolutionInput => ({ fields: { address: '200 Sid Edens Rd', county: 'Pickens', state: 'SC', apn } });

describe('parallel resolution — lane execution', () => {
  it('runs both lanes concurrently and never lets one block the other', async () => {
    const order: string[] = [];
    const deps: ParallelResolutionDeps = {
      officialLane: async () => { await new Promise((r) => setTimeout(r, 30)); order.push('official'); return officialParcel(); },
      landPortalLane: async () => { order.push('landportal'); return landPortalParcel(); },
    };
    const lanes = await runResolutionLanes(input(), deps);
    // LandPortal (fast) finished first even though official was called first → concurrent.
    expect(order[0]).toBe('landportal');
    expect(lanes).toHaveLength(2);
    expect(lanes.every((l) => typeof l.elapsedMs === 'number')).toBe(true);
  });

  it('a lane that exceeds its hard budget yields a timeout outcome; the other lane still confirms', async () => {
    const deps: ParallelResolutionDeps = {
      laneTimeoutMs: 40,
      officialLane: () => new Promise(() => { /* hangs forever */ }),
      landPortalLane: async () => landPortalParcel(),
    };
    const res = await resolveParcelParallel(input(), deps);
    const official = res.lanes.find((l) => l.lane === 'official_public')!;
    expect(official.status).toBe('error');
    expect(official.note).toMatch(/time budget/i);
    expect(res.confirmed).toBe(true);          // LandPortal evidence still counted
    expect(res.laneAgreement).toBe('single_lane');
  });

  it('captures a thrown lane as an error outcome without losing the other lane', async () => {
    const deps: ParallelResolutionDeps = {
      officialLane: async () => { throw new Error('CDP attach failed'); },
      landPortalLane: async () => landPortalParcel(),
    };
    const res = await resolveParcelParallel(input(), deps);
    const official = res.lanes.find((l) => l.lane === 'official_public')!;
    expect(official.status).toBe('error');
    expect(official.note).toContain('CDP attach failed');
    // The LandPortal lane still confirmed the parcel.
    expect(res.confirmed).toBe(true);
    expect(res.laneAgreement).toBe('single_lane');
  });
});

describe('parallel resolution — confirmation verdict', () => {
  it('confirms when both lanes independently agree on the APN', async () => {
    const res = await resolveParcelParallel(input(), depsFrom(officialParcel(), landPortalParcel()));
    expect(res.confirmed).toBe(true);
    expect(res.downstreamAllowed).toBe(true);
    expect(res.laneAgreement).toBe('agree');
    expect(res.confirmedParcel?.source).toContain('County GIS'); // official wins the merge
    expect(res.confirmationBasis).toMatch(/independently confirmed the same parcel/i);
  });

  it('confirms on a single exact parcel-level source when the other lane is unavailable', async () => {
    const res = await resolveParcelParallel(input(), depsFrom(unavailable('official_public', 'No tested adapter for this county.'), landPortalParcel()));
    expect(res.confirmed).toBe(true);
    expect(res.laneAgreement).toBe('single_lane');
    expect(res.confirmedParcel?.source).toContain('LandPortal');
  });

  it('does NOT confirm when neither lane reaches a parcel (geocode-only parking case)', async () => {
    const res = await resolveParcelParallel(input(), depsFrom(
      unavailable('official_public', 'No tested public parcel adapter for this jurisdiction.'),
      unavailable('landportal', 'LandPortal session not authenticated.'),
    ));
    expect(res.confirmed).toBe(false);
    expect(res.downstreamAllowed).toBe(false);
    expect(res.laneAgreement).toBe('none');
    expect(res.confirmationBasis).toMatch(/geocoder locates an address/i);
  });

  it('a candidate-only lane (geocode, no parcel page) does not confirm identity', async () => {
    const candidate: LaneOutcome = { lane: 'official_public', status: 'candidate', confirmedIdentity: false, parcel: null, attempts: [], note: 'geocoded only' };
    const res = await resolveParcelParallel(input(), depsFrom(candidate, unavailable('landportal', 'not run')));
    expect(res.confirmed).toBe(false);
  });
});

describe('parallel resolution — reconciliation issues', () => {
  it('flags an APN conflict between the two lanes and blocks confirmation', async () => {
    const res = await resolveParcelParallel(input(), depsFrom(officialParcel({ apn: '111-11-111' }), landPortalParcel({ apn: '999-99-999' })));
    expect(res.confirmed).toBe(false);
    expect(res.laneAgreement).toBe('conflict');
    const issue = res.reconciliation.find((i) => i.field === 'apn');
    expect(issue?.severity).toBe('conflict');
    expect(issue?.values).toHaveLength(2);
  });

  it('does not flag harmless APN formatting differences (dashes/spaces)', () => {
    const issues = reconcileLanes([officialParcel({ apn: '123 45 678' }), landPortalParcel({ apn: '123-45-678' })]);
    expect(issues.find((i) => i.field === 'apn')).toBeUndefined();
  });

  it('tolerates small acreage differences but flags large ones', () => {
    const small = reconcileLanes([officialParcel({ acres: 5.1 }), landPortalParcel({ acres: 5.12 })]);
    expect(small.find((i) => i.field === 'acres')).toBeUndefined();
    const large = reconcileLanes([officialParcel({ acres: 5 }), landPortalParcel({ acres: 12 })]);
    expect(large.find((i) => i.field === 'acres')?.severity).toBe('conflict');
  });

  it('flags a county disagreement', () => {
    const issues = reconcileLanes([officialParcel({ county: 'Pickens' }), landPortalParcel({ county: 'Greenville' })]);
    expect(issues.find((i) => i.field === 'county')?.severity).toBe('conflict');
  });

  it('flags materially distant coordinates only', () => {
    const near = reconcileLanes([officialParcel({ coordinates: { lat: 34.9, lng: -82.7 } }), landPortalParcel({ coordinates: { lat: 34.9001, lng: -82.7001 } })]);
    expect(near.find((i) => i.field === 'coordinates')).toBeUndefined();
    const far = reconcileLanes([officialParcel({ coordinates: { lat: 34.9, lng: -82.7 } }), landPortalParcel({ coordinates: { lat: 35.5, lng: -82.7 } })]);
    expect(far.find((i) => i.field === 'coordinates')?.severity).toBe('conflict');
  });
});

describe('parallel resolution — wrong-parcel hard stop', () => {
  it('blocks when the operator-requested APN disagrees with a resolved parcel APN', () => {
    const res = reconcileResolution([officialParcel({ apn: '000-00-000' }), unavailable('landportal', 'n/a')], '123-45-678');
    expect(res.identityConflict).toBeDefined();
    expect(res.identityConflict?.requestedApn).toBe('123-45-678');
    expect(res.identityConflict?.resolvedApn).toBe('000-00-000');
    expect(res.confirmed).toBe(false);
    expect(res.downstreamAllowed).toBe(false);
  });

  it('does not fire when the requested APN matches (formatting aside)', () => {
    const res = reconcileResolution([officialParcel({ apn: '123-45-678' }), unavailable('landportal', 'n/a')], '1234 5678');
    expect(res.identityConflict).toBeUndefined();
    expect(res.confirmed).toBe(true);
  });
});

describe('normalization helpers', () => {
  it('compactApn strips formatting', () => {
    expect(compactApn('123-45-678')).toBe('12345678');
    expect(compactApn('123 45 678')).toBe('12345678');
    expect(compactApn(null)).toBe('');
  });
  it('haversineMeters is ~0 for identical points and grows with distance', () => {
    expect(haversineMeters({ lat: 34.9, lng: -82.7 }, { lat: 34.9, lng: -82.7 })).toBeCloseTo(0, 5);
    expect(haversineMeters({ lat: 34.9, lng: -82.7 }, { lat: 34.91, lng: -82.7 })).toBeGreaterThan(900);
  });
});
