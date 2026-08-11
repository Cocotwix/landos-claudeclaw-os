// The accidental OfficialParcel dependency, pinned.
//
// Property Intelligence built its whole live adapter set inside the branch
// where lookupOfficialParcel() returned a parcel. A parcel miss therefore
// silenced lanes that had never read a parcel, and the orchestrator reported
// them as "<lane> is not connected" — which tells an operator LandOS was never
// wired up, not that one input was missing.
//
// These tests hold the partition: what genuinely reads the parcel polygon, what
// reads nothing from it, and what each lane says when its own input is absent.

import { describe, expect, it } from 'vitest';
import {
  PARCEL_GEOMETRY_DEPENDENT_TASKS,
  makeLivePublicIntelligenceAdapters,
  makeOfficialParcelBlockedAdapters,
  makeParcelGeometryIntelligenceAdapters,
  makeParcelIndependentIntelligenceAdapters,
  makeCountyGisZoningSupplement,
  type OfficialParcel,
} from './public-property-intelligence-live.js';
import { PUBLIC_INTELLIGENCE_TASKS, type PublicIntelligenceSubject } from './public-property-intelligence.js';
import { zoningFindingFromLandUse } from './land-use-intelligence-adapter.js';
import { landUseCitation as citation, whitewaterDetermination } from './fixtures/whitewater-determination.fixture.js';
import { unresolvedValue } from './land-use-types.js';

const PARCEL: OfficialParcel = {
  provider: 'Example County parcel service',
  sourceUrl: 'https://gis.example.gov/parcels/0',
  address: '9490 Example Rd',
  county: 'Example',
  state: 'MI',
  apn: '13-116-015-01',
  owner: 'EXAMPLE OWNER',
  acres: 60,
  coordinates: { lat: 44.82, lng: -85.4 },
  geometry: { rings: [[[-85.4, 44.82], [-85.39, 44.82], [-85.39, 44.83], [-85.4, 44.82]]] },
  datasetDate: null,
  facts: {},
};

const SUBJECT: PublicIntelligenceSubject = {
  rawInput: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  normalizedAddress: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  county: 'Grand Traverse',
  state: 'MI',
  zip: '49690',
  resolutionStatus: 'unresolved',
  discoveryUsable: true,
  resolutionExplanation: 'Exact subject correlated without an official parcel record.',
};

const RUN_CONTEXT = {
  startedAt: '2026-08-09T00:00:00.000Z',
  captureMode: 'live' as const,
  timeoutMs: 5_000,
  signal: new AbortController().signal,
};

describe('official parcel is a lane input, not a run prerequisite', () => {
  it('splits the live adapter set into parcel-geometry and parcel-independent halves without losing a lane', () => {
    const whole = makeLivePublicIntelligenceAdapters(PARCEL).map((adapter) => adapter.task).sort();
    const parts = [
      ...makeParcelGeometryIntelligenceAdapters(PARCEL),
      ...makeParcelIndependentIntelligenceAdapters(),
    ].map((adapter) => adapter.task).sort();
    expect(parts).toEqual(whole);
    // Every lane is still supplied on the confirmed-parcel path, and
    // zoning_landuse is supplied by the SHARED land-use selector rather than
    // from the parcel set — the county GIS zoning polygon is supplemental
    // evidence handed to that lane, not the lane itself.
    expect(whole).not.toContain('zoning_landuse');
    const withZoning = new Set([...whole, 'zoning_landuse']);
    expect(withZoning).toEqual(new Set(PUBLIC_INTELLIGENCE_TASKS));
    expect(makeCountyGisZoningSupplement(PARCEL).task).toBe('zoning_landuse');
  });

  it('supplies the marketplace and Land Portal lanes with no parcel at all', () => {
    const tasks = makeParcelIndependentIntelligenceAdapters().map((adapter) => adapter.task);
    expect(tasks).toContain('land_portal');
    expect(tasks).toContain('marketplace_confirmation');
    // Nothing in this set may read the parcel polygon.
    expect(tasks.some((task) => PARCEL_GEOMETRY_DEPENDENT_TASKS.includes(task))).toBe(false);
  });

  it('attributes the parcel-polygon blocker to the polygon lanes only', () => {
    const adapters = makeOfficialParcelBlockedAdapters(PUBLIC_INTELLIGENCE_TASKS, {
      requestedApn: '13-116-015-01',
      county: 'Grand Traverse',
      state: 'MI',
    });
    const geometry = adapters.filter((adapter) => adapter.adapterId === 'official_parcel_geometry_required_v1');
    expect(geometry.map((adapter) => adapter.task).sort()).toEqual([...PARCEL_GEOMETRY_DEPENDENT_TASKS].sort());
    // A lane that never reads a polygon is never described by the polygon
    // blocker; it reports its own missing-source condition instead.
    const others = adapters.filter((adapter) => adapter.adapterId !== 'official_parcel_geometry_required_v1');
    expect(others.map((adapter) => adapter.task)).toContain('county_records');
    expect(others.every((adapter) => adapter.adapterId === 'jurisdiction_source_unknown_v1')).toBe(true);
  });

  it('reports a missing-source lane as its own coverage limitation, not a parcel problem', async () => {
    const adapter = makeOfficialParcelBlockedAdapters(['county_records'], {
      county: 'Grand Traverse',
      state: 'MI',
    })[0];
    const result = await adapter!.run(SUBJECT, RUN_CONTEXT);
    expect(result.status).toBe('unavailable');
    expect(result.failureReason).toContain('no official source');
    expect(result.failureReason).toContain('Grand Traverse County, MI');
    expect(result.failureReason).not.toContain('is not connected');
    expect(result.failureReason).not.toContain('parcel polygon');
    // The doubled county suffix an operator would otherwise read.
    expect(result.failureReason).not.toContain('County County');
  });

  it('states each blocked lane\'s own missing input instead of "not connected"', async () => {
    const [adapter] = makeOfficialParcelBlockedAdapters(['wetlands'], {
      requestedApn: '13-116-015-01',
      county: 'Grand Traverse',
      state: 'MI',
      attempted: [{ source: 'Statewide parcel service', status: 'no_match', note: 'No feature matched the APN.' }],
    });
    const result = await adapter!.run(SUBJECT, RUN_CONTEXT);
    expect(result.status).toBe('unavailable');
    expect(result.failureReason).toContain('Wetlands');
    expect(result.failureReason).toContain('official parcel polygon');
    expect(result.failureReason).toContain('13-116-015-01');
    expect(result.failureReason).toContain('Grand Traverse County, MI');
    expect(result.failureReason).toContain('Statewide parcel service');
    expect(result.failureReason).not.toContain('is not connected');
    expect(result.failureReason).not.toContain('County County');
  });
});

/* ───────────── zoning runs from location, never from parcel GIS ────────── */

describe('zoning and land use run from the resolved location', () => {
  it('reports the township as the governing authority with no parcel and no county GIS', () => {
    const result = zoningFindingFromLandUse(whitewaterDetermination(), 'Williamsburg');
    expect(result.status).not.toBe('unavailable');
    const finding = result.finding as { jurisdiction: string | null; summary: string; sourceLayerUrls: string[] };
    expect(finding.jurisdiction).toBe('Whitewater township');
    expect(finding.summary).toContain('Whitewater township');
    // The citation an operator can click is the township's own page, not a
    // parcel layer.
    expect(finding.sourceLayerUrls.some((url) => url.includes('whitewatertownshipmi.gov'))).toBe(true);
  });

  it('surfaces the county fallback rules and its blocker instead of only unknown', () => {
    const fallbackCitation = citation('https://www.gtcountymi.gov/land-division', 'Grand Traverse County land division');
    const determination = whitewaterDetermination({
      countySubdivisionFallback: {
        label: 'County fallback rules — controlling local jurisdiction not yet confirmed',
        blocker: 'Controlling local jurisdiction not yet confirmed',
        county: 'Grand Traverse County',
        state: 'MI',
        framework: whitewaterDetermination().subdivision,
        authorityAttempts: ['Whitewater township: no body that approves land division was established.'],
        sources: [fallbackCitation],
        summary: 'Grand Traverse County\'s own published land-division rules are shown here.',
        retrievedAt: '2026-08-09T00:00:00.000Z',
      },
    });
    const result = zoningFindingFromLandUse(determination, 'Williamsburg');
    const finding = result.finding as { subdivisionNote: string };
    expect(finding.subdivisionNote).toContain('County fallback rules');
    expect(finding.subdivisionNote).toContain('Controlling local jurisdiction not yet confirmed');
  });

  it('refuses to produce a finding when neither an authority nor a zoning determination exists', () => {
    const empty = whitewaterDetermination();
    const unknownAuthority = {
      unitType: 'unknown' as const,
      name: unresolvedValue<string>('Not established.'),
      relationship: null,
      officialUrl: null,
    };
    empty.authority.zoningAuthority = { role: 'zoning', ...unknownAuthority };
    empty.authority.localUnit = { role: 'local_unit', ...unknownAuthority };
    const result = zoningFindingFromLandUse(empty);
    expect(result.status).toBe('unavailable');
    expect(result.finding).toBeUndefined();
    expect(result.failureReason).toContain('land-use lane');
    expect(result.failureReason).not.toContain('parcel');
  });
});
