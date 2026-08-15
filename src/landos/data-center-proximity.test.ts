import { describe, it, expect } from 'vitest';
import {
  BROCKOVICH_SITE,
  classifyReportKind,
  extractPlaceCandidate,
  resolveCandidateLocation,
  fetchBrockovichDatasets,
  haversineMiles,
  runDataCenterProximityScreen,
  screenDataCentersWithinRadius,
  type BrockovichDatasets,
  type ProximityFetch,
} from './data-center-proximity.js';

// Franklin, TN. The near ZIP is ~5 miles out; the far one ~60.
const SUBJECT = { lat: 35.9251, lng: -86.8689 };

const DATASETS: BrockovichDatasets = {
  reports: [
    { date: '2026-02-11', cityState: 'Franklin, TN', zip: '37064', type: 'data', owner: 'Acme Compute', notes: 'Hyperscale campus proposed off the highway.' },
    { date: '2025-09-02', cityState: 'Franklin, TN', zip: '37064', type: 'bess', owner: '', notes: 'Battery storage next to the substation.' },
    { date: '2026-01-04', cityState: 'Faraway, TN', zip: '38401', type: 'data', owner: 'Distant LLC', notes: 'Far outside the screen.' },
    { date: '2026-01-05', cityState: 'Nowhere, TN', zip: 'bogus', type: 'data', owner: '', notes: 'No usable ZIP.' },
  ],
  zipGeocodes: {
    '37064': { lat: 35.9800, lng: -86.9200 },
    '38401': { lat: 35.6151, lng: -87.0353 },
  },
};

describe('haversineMiles', () => {
  it('measures a known separation', () => {
    expect(haversineMiles(SUBJECT, { lat: 35.9800, lng: -86.9200 })).toBeCloseTo(4.6, 0);
  });
});

describe('classifyReportKind', () => {
  it('uses the published type first', () => {
    expect(classifyReportKind({ type: 'data' })).toBe('data_center');
    expect(classifyReportKind({ type: 'bess' })).toBe('battery_storage');
    expect(classifyReportKind({ type: 'substation' })).toBe('substation');
  });

  it('falls back to the report text, and refuses to guess', () => {
    expect(classifyReportKind({ type: '', notes: 'A new hyperscale build' })).toBe('data_center');
    expect(classifyReportKind({ type: '', notes: 'A new grocery store' })).toBe('other');
  });
});

describe('screenDataCentersWithinRadius', () => {
  it('keeps only reports inside the radius, nearest first, with approximate distance', () => {
    const screen = screenDataCentersWithinRadius({ subject: SUBJECT, datasets: DATASETS, nowIso: '2026-08-15T00:00:00.000Z' });
    expect(screen.status).toBe('found');
    expect(screen.radiusMiles).toBe(20);
    expect(screen.hits).toHaveLength(2);
    expect(screen.hits[0].distanceMiles).toBeLessThanOrEqual(screen.hits[1].distanceMiles);
    expect(screen.hits.map((hit) => hit.kind)).toContain('data_center');
    expect(screen.hits.every((hit) => hit.distanceMiles <= 20)).toBe(true);
    expect(screen.hits[0].sourceUrl).toBe(BROCKOVICH_SITE);
    expect(screen.verdict).toMatch(/within 20 miles/i);
    expect(screen.verdict).toMatch(/approximate/i);
  });

  it('counts a report it could not locate rather than dropping it silently', () => {
    const screen = screenDataCentersWithinRadius({ subject: SUBJECT, datasets: DATASETS });
    expect(screen.unlocatedReports).toBe(1);
  });

  it('states a clean screen as a real answer', () => {
    const screen = screenDataCentersWithinRadius({
      subject: { lat: 44.0, lng: -110.0 },
      datasets: DATASETS,
    });
    expect(screen.status).toBe('none_found');
    expect(screen.hits).toHaveLength(0);
    expect(screen.verdict).toMatch(/No data-center, battery-storage or substation activity is reported within 20 miles/i);
    expect(screen.verdict).toMatch(/real answer, not a gap/i);
  });

  it('measures from the subject ZIP centroid when the parcel has no coordinates, and says so', () => {
    const screen = screenDataCentersWithinRadius({
      subject: null, subjectZip: '37064', subjectZipPoint: DATASETS.zipGeocodes['37064'], datasets: DATASETS,
    });
    expect(screen.status).toBe('found');
    expect(screen.basis).toBe('subject_zip_centroid');
    expect(screen.verdict).toMatch(/ZIP 37064 centroid \(the parcel has no confirmed coordinates yet\)/i);
  });

  it('prefers real subject coordinates over the ZIP fallback', () => {
    const screen = screenDataCentersWithinRadius({
      subject: SUBJECT, subjectZip: '38401', subjectZipPoint: DATASETS.zipGeocodes['38401'], datasets: DATASETS,
    });
    expect(screen.basis).toBe('subject_coordinates');
    expect(screen.subject).toEqual(SUBJECT);
  });

  it('never claims a clean screen with neither coordinates nor a locatable ZIP', () => {
    const screen = screenDataCentersWithinRadius({ subject: null, subjectZip: '00000', subjectZipPoint: null, datasets: DATASETS });
    expect(screen.status).toBe('not_run');
    expect(screen.basis).toBeNull();
    expect(screen.verdict).toMatch(/no boundary could be retrieved for its ZIP 00000/i);
  });

  it('never claims a clean screen when the source was unreachable', () => {
    const screen = screenDataCentersWithinRadius({ subject: SUBJECT, datasets: null });
    expect(screen.status).toBe('unavailable');
    expect(screen.verdict).toMatch(/source outage, not evidence that nothing is nearby/i);
  });
});

describe('fetchBrockovichDatasets', () => {
  const ok = (body: unknown): Awaited<ReturnType<ProximityFetch>> => ({ ok: true, status: 200, json: async () => body });

  it('reads both published datasets', async () => {
    const fetchImpl: ProximityFetch = async (url) => (url.includes('community-reports')
      ? ok(DATASETS.reports)
      : ok(DATASETS.zipGeocodes));
    const datasets = await fetchBrockovichDatasets({ fetchImpl });
    expect(datasets?.reports).toHaveLength(4);
    expect(datasets?.zipGeocodes['37064']).toEqual({ lat: 35.98, lng: -86.92 });
  });

  it('returns null (never a partial screen) when either dataset fails', async () => {
    const fetchImpl: ProximityFetch = async (url) => (url.includes('community-reports')
      ? ok(DATASETS.reports)
      : { ok: false, status: 503, json: async () => ({}) });
    expect(await fetchBrockovichDatasets({ fetchImpl })).toBeNull();
  });

  it('returns null when the transport throws', async () => {
    const fetchImpl: ProximityFetch = async () => { throw new Error('network down'); };
    expect(await fetchBrockovichDatasets({ fetchImpl })).toBeNull();
  });
});

describe('runDataCenterProximityScreen', () => {
  it('screens live datasets against the subject', async () => {
    const fetchImpl: ProximityFetch = async (url) => ({
      ok: true, status: 200,
      json: async () => (url.includes('community-reports') ? DATASETS.reports : DATASETS.zipGeocodes),
    });
    const screen = await runDataCenterProximityScreen({ lat: SUBJECT.lat, lng: SUBJECT.lng, fetchImpl });
    expect(screen.status).toBe('found');
    expect(screen.hits).toHaveLength(2);
  });

  it('does not reach the network with nothing to measure from', async () => {
    let called = 0;
    const fetchImpl: ProximityFetch = async () => { called += 1; return { ok: true, status: 200, json: async () => [] }; };
    const screen = await runDataCenterProximityScreen({ lat: null, lng: null, zip: null, zipPoint: null, fetchImpl });
    expect(called).toBe(0);
    expect(screen.status).toBe('not_run');
  });

  it('still screens a coordinate-less lead from its ZIP', async () => {
    const fetchImpl: ProximityFetch = async (url) => ({
      ok: true, status: 200,
      json: async () => (url.includes('community-reports') ? DATASETS.reports : DATASETS.zipGeocodes),
    });
    const screen = await runDataCenterProximityScreen({
      lat: null, lng: null, zip: '37064', zipPoint: DATASETS.zipGeocodes['37064'], fetchImpl,
    });
    expect(screen.status).toBe('found');
    expect(screen.basis).toBe('subject_zip_centroid');
  });
});

describe('extractPlaceCandidate', () => {
  it('reads an explicit county or city phrase', () => {
    expect(extractPlaceCandidate('Laramie County approves construction of a data center in Laramie County, WY'))
      .toBe('Laramie County, WY');
    expect(extractPlaceCandidate('A hyperscale campus is planned near New Carlisle, Indiana'))
      .toBe('New Carlisle, Indiana');
  });

  it('never treats a bare capitalised word as a location', () => {
    expect(extractPlaceCandidate('Hyperscale Data Center Approved')).toBeNull();
    expect(extractPlaceCandidate('')).toBeNull();
  });
});

describe('resolveCandidateLocation', () => {
  const subject = { lat: 36.6770111, lng: -93.868811 }; // Cassville, MO

  it('measures a real distance once the place resolves', async () => {
    const geocode = async (place: string) => (place === 'Paducah, KY' ? { lat: 37.0833893, lng: -88.6000478 } : null);
    const resolved = await resolveCandidateLocation('AI campus planned at Paducah, KY site', subject, geocode);
    expect(resolved?.place).toBe('Paducah, KY');
    expect(resolved?.distanceMiles).toBeGreaterThan(20);
  });

  it('resolves a nearby place inside the radius', async () => {
    const geocode = async () => ({ lat: 36.72, lng: -93.85 });
    const resolved = await resolveCandidateLocation('Data center proposed in Purdy, MO', subject, geocode);
    expect(resolved?.distanceMiles).toBeLessThan(20);
  });

  it('stays unresolved rather than guessing when the geocoder cannot answer', async () => {
    const geocode = async () => null;
    expect(await resolveCandidateLocation('Data center in Nowhere, ZZ', subject, geocode)).toBeNull();
    expect(await resolveCandidateLocation('Data center approved somewhere', subject, geocode)).toBeNull();
  });
});
