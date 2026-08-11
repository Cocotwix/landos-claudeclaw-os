// zoning_landuse SOURCE SELECTION, pinned on both parcel paths.
//
// The parcel-miss path was corrected first: it consumes the accepted Land Use
// determination. The parcel-SUCCESS path still ran the county GIS zoning
// polygon adapter, so the same subject got a different kind of answer depending
// on whether a parcel service happened to publish its geometry — and a county
// with no tested zoning layer returned `unavailable` for a question that was
// never about geometry at all.
//
// Zoning authority, the zoning designation, by-right uses and land division are
// properties of the LOCATION. These tests hold that: one selector, one primary
// source, on both paths, with GIS demoted to supplemental spatial evidence that
// can never gate the lane.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  PublicIntelligenceAdapter,
  PublicIntelligenceAdapterResult,
  PublicIntelligenceSubject,
  ZoningLandUseFinding,
} from './public-property-intelligence.js';
import type { LandUseDetermination } from './land-use-types.js';

const getLandUseDetermination = vi.hoisted(() => vi.fn());
vi.mock('./land-use-store.js', () => ({ getLandUseDetermination }));

const { makeZoningLandUseAdapter, mergeGisZoningSupplement } = await import('./land-use-intelligence-adapter.js');
const { whitewaterDetermination } = await import('./fixtures/whitewater-determination.fixture.js');

const SUBJECT: PublicIntelligenceSubject = {
  rawInput: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  normalizedAddress: '9490 Elk Lake Rd, Williamsburg, MI 49690',
  county: 'Grand Traverse',
  state: 'MI',
  resolutionStatus: 'confirmed',
  resolutionExplanation: 'Official parcel record matched.',
};

const CONTEXT = {
  startedAt: '2026-08-09T00:00:00.000Z',
  captureMode: 'live' as const,
  timeoutMs: 5_000,
  signal: new AbortController().signal,
};

/** A county GIS zoning lane that answers with a polygon value and an overlay. */
function gisSupplement(result: PublicIntelligenceAdapterResult): PublicIntelligenceAdapter {
  return {
    task: 'zoning_landuse',
    adapterId: 'county_zoning_flu_overlay_v1',
    async run() { return result; },
  };
}

const GIS_ANSWER: PublicIntelligenceAdapterResult = {
  status: 'succeeded',
  confidence: 'high',
  retryEligible: false,
  evidence: [{
    evidenceId: 'county-zoning',
    sourceName: 'Example County zoning layer',
    sourceUrl: 'https://gis.example.gov/zoning/0',
    sourceTier: 'official_county_state',
    verification: 'official_record',
    retrievedAt: '2026-08-09T00:00:00.000Z',
    confidence: 'high',
    supports: ['zoning'],
    captureMode: 'live',
    decisionUsable: true,
  }],
  finding: {
    kind: 'zoning_landuse',
    zoningCode: 'A-1',
    zoningName: 'Agricultural [A-1]',
    overlayDistricts: ['Shoreline Overlay'],
    futureLandUse: 'Rural Residential',
    existingLandUse: 'Vacant',
    jurisdiction: 'Grand Traverse County, MI',
    minimumLotSize: null,
    allowedUsesNote: null,
    subdivisionNote: null,
    sourceLayerUrls: ['https://gis.example.gov/zoning/0'],
    summary: 'Zoned Agricultural [A-1].',
    whyItMatters: 'Zoning controls what can be built.',
    limitation: 'GIS zoning screening only.',
    classification: 'screening',
  },
};

/** The lane's own "this county publishes no tested zoning layer" answer. */
const GIS_NO_LAYER: PublicIntelligenceAdapterResult = {
  status: 'unavailable',
  evidence: [],
  confidence: 'none',
  retryEligible: true,
  failureReason: 'No tested official zoning layer is available for this county.',
};

function accepted(determination: LandUseDetermination): void {
  getLandUseDetermination.mockReturnValue({
    id: 1, dealCardId: 83, determination, determinedAt: determination.determinedAt,
  });
}

describe('zoning_landuse consumes the accepted Land Use determination on both parcel paths', () => {
  beforeEach(() => { getLandUseDetermination.mockReset(); });

  it('reports the same governing authority whether or not an official parcel was found', async () => {
    accepted(whitewaterDetermination());

    const onMiss = await makeZoningLandUseAdapter({ dealCardId: 83, mailingCity: 'Williamsburg' })
      .run(SUBJECT, CONTEXT);
    const onSuccess = await makeZoningLandUseAdapter({
      dealCardId: 83, mailingCity: 'Williamsburg', gisSupplement: gisSupplement(GIS_ANSWER),
    }).run(SUBJECT, CONTEXT);

    const missFinding = onMiss.finding as ZoningLandUseFinding;
    const successFinding = onSuccess.finding as ZoningLandUseFinding;
    expect(missFinding.jurisdiction).toBe('Whitewater township');
    // The parcel-success path reaches the SAME legal conclusion. The county GIS
    // polygon does not displace the township that actually zones.
    expect(successFinding.jurisdiction).toBe('Whitewater township');
    expect(successFinding.summary).toContain('Whitewater township');
    expect(onSuccess.status).toBe(onMiss.status);
  });

  it('keeps the GIS zoning value supplemental and out of the legal zoning slot', async () => {
    accepted(whitewaterDetermination());
    const result = await makeZoningLandUseAdapter({
      dealCardId: 83, mailingCity: 'Williamsburg', gisSupplement: gisSupplement(GIS_ANSWER),
    }).run(SUBJECT, CONTEXT);

    const finding = result.finding as ZoningLandUseFinding;
    // The GIS polygon's code is NOT promoted into the determination's zoning
    // slot; the accepted determination established no district here.
    expect(finding.zoningCode).toBeNull();
    expect(finding.zoningName).toBeNull();
    // It is still shown, as spatial screening, with its layer reachable.
    expect(finding.summary).toContain('Supplemental county GIS screening');
    expect(finding.summary).toContain('A-1');
    expect(finding.overlayDistricts).toContain('Shoreline Overlay');
    expect(finding.futureLandUse).toBe('Rural Residential');
    expect(finding.sourceLayerUrls).toContain('https://gis.example.gov/zoning/0');
    // The township's own citation survives alongside it.
    expect(finding.sourceLayerUrls.some((url) => url.includes('whitewatertownshipmi.gov'))).toBe(true);
  });

  it('is not made unavailable by a county that publishes no zoning GIS layer', async () => {
    accepted(whitewaterDetermination());
    const result = await makeZoningLandUseAdapter({
      dealCardId: 83, mailingCity: 'Williamsburg', gisSupplement: gisSupplement(GIS_NO_LAYER),
    }).run(SUBJECT, CONTEXT);

    expect(result.status).not.toBe('unavailable');
    expect((result.finding as ZoningLandUseFinding).jurisdiction).toBe('Whitewater township');
    expect(result.failureReason).toBeUndefined();
  });

  it('survives a GIS supplement that throws, without losing the legal determination', async () => {
    accepted(whitewaterDetermination());
    const thrower: PublicIntelligenceAdapter = {
      task: 'zoning_landuse',
      adapterId: 'county_zoning_flu_overlay_v1',
      async run() { throw new Error('layer query failed'); },
    };
    const result = await makeZoningLandUseAdapter({
      dealCardId: 83, mailingCity: 'Williamsburg', gisSupplement: thrower,
    }).run(SUBJECT, CONTEXT);

    expect(result.status).not.toBe('unavailable');
    expect((result.finding as ZoningLandUseFinding).jurisdiction).toBe('Whitewater township');
  });

  it('reports the land-use lane\'s own condition, never a parcel problem, when nothing is accepted', async () => {
    getLandUseDetermination.mockReturnValue(null);
    const result = await makeZoningLandUseAdapter({ dealCardId: 83 }).run(SUBJECT, CONTEXT);
    expect(result.status).toBe('unavailable');
    expect(result.failureReason).toContain('Land Use lane');
    expect(result.failureReason).not.toContain('parcel polygon');
  });

  it('still shows GIS screening when nothing legal is accepted, but never as the determination', async () => {
    getLandUseDetermination.mockReturnValue(null);
    const result = await makeZoningLandUseAdapter({
      dealCardId: 83, gisSupplement: gisSupplement(GIS_ANSWER),
    }).run(SUBJECT, CONTEXT);

    expect(result.status).toBe('partial');
    expect((result.finding as ZoningLandUseFinding).classification).toBe('screening');
    expect(result.failureReason).toContain('Land Use lane');
  });
});

describe('the GIS merge itself', () => {
  it('returns the legal result untouched when there is no supplement', () => {
    const legal: PublicIntelligenceAdapterResult = {
      status: 'succeeded', evidence: [], confidence: 'high', retryEligible: false,
      finding: { ...(GIS_ANSWER.finding as ZoningLandUseFinding), classification: 'official_record' },
    };
    expect(mergeGisZoningSupplement(legal, null)).toBe(legal);
    expect(mergeGisZoningSupplement(legal, GIS_NO_LAYER)).toBe(legal);
  });
});
