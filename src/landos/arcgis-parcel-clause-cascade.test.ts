import { describe, expect, it } from 'vitest';
import { searchArcgisParcel, clauseWallClockReserveMs, runArcgisAdapter } from './arcgis-adapter.js';
import type { ArcgisFetch, ArcgisLayerSummary } from './arcgis-service-discovery.js';
import { EscalationLadder } from './gis-escalation.js';
import type { NormalizedParcelSearchInput } from './gis-platform-types.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';

/**
 * A real county deployment (Hamilton County, TN Live_Parcels) stores the
 * printed key "023 003.02" as "023  003.02" with TWO spaces, and also splits it
 * across MAP and PARCEL columns. The exact-equality clause therefore answers
 * zero features on a parcel the layer holds correctly, and that zero must not
 * end the cascade: the whitespace-tolerant clause and the MAP + PARCEL clause
 * come after it and both match.
 */
const LAYER_URL = 'https://maps.example-county.gov/x/rest/services/Live_Parcels/MapServer/0';
const STORED_KEY = '023  003.02';

const FIELDS = ['OBJECTID', 'PBA_NUM', 'GISLINK', 'OWNERNAME1', 'ADDRESS', 'MAP', 'PARCEL', 'TAX_MAP_NO', 'CALCACRES']
  .map((name) => ({ name, type: 'esriFieldTypeString', alias: name }));

const LAYER: ArcgisLayerSummary = {
  id: 0,
  name: 'Parcels',
  type: 'Feature Layer',
  geometryType: 'esriGeometryPolygon',
  parentLayerId: null,
  subLayerIds: null,
  serviceUrl: LAYER_URL.replace(/\/0$/, ''),
  layerUrl: LAYER_URL,
  fields: FIELDS,
  capabilities: 'Map,Query,Data',
  maxRecordCount: 1000,
  supportsPagination: true,
  queryable: true,
  serviceName: 'Live_Parcels',
  serviceDescription: '',
  sourceRank: 0,
};

const MATCH = {
  attributes: {
    OBJECTID: 2739,
    PBA_NUM: '033023    00302P000',
    GISLINK: '033023    00302',
    OWNERNAME1: 'CAMERON NATHANIEL JOSEPH',
    ADDRESS: '5170 HWY 60',
    MAP: '023',
    PARCEL: '003.02',
    TAX_MAP_NO: STORED_KEY,
    CALCACRES: 40.5,
  },
  geometry: { rings: [[[-85.0060, 35.3740], [-85.0040, 35.3740], [-85.0040, 35.3756], [-85.0060, 35.3756], [-85.0060, 35.3740]]] },
};

const SUBJECT: NormalizedParcelSearchInput = {
  address: '5170 Hwy 60',
  city: 'Birchwood',
  county: 'Hamilton',
  state: 'TN',
  apn: '023 003.02',
  knownAcres: 40.5,
};

/**
 * Answers like the real service: exact equality on any single identifier column
 * finds nothing, the whitespace-tolerant LIKE and the MAP + PARCEL pair both
 * find the one parcel.
 */
function service(): { fetch: ArcgisFetch; wheres: string[] } {
  const wheres: string[] = [];
  const fetch: ArcgisFetch = async (url) => {
    const where = decodeURIComponent(new URL(url).searchParams.get('where') ?? '');
    wheres.push(where);
    const likeMatches = /LIKE\s+'023%003%02%'/i.test(where) && /TAX_MAP_NO/i.test(where);
    const splitMatches = /MAP\s*=\s*'023'/i.test(where) && /PARCEL\s*=\s*'003\.02'/i.test(where);
    const features = likeMatches || splitMatches ? [MATCH] : [];
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features, spatialReference: { wkid: 4326 } }),
      url,
    };
  };
  return { fetch, wheres };
}

describe('the parcel clause cascade treats zero features as a negative answer', () => {
  it('continues past an exact TAX_MAP_NO clause that returns zero and reaches the matching clause', async () => {
    const { fetch, wheres } = service();
    const outcome = await searchArcgisParcel(LAYER, SUBJECT, { fetch, ladder: new EscalationLadder() });

    expect(outcome.features.length).toBe(1);
    expect(outcome.features[0].attributes.OBJECTID).toBe(2739);
    expect(outcome.features[0].attributes.TAX_MAP_NO).toBe(STORED_KEY);

    // The zero-feature exact clause ran FIRST and did not stop the cascade.
    const exactIndex = wheres.findIndex((w) => /TAX_MAP_NO\s*=\s*'023 003\.02'/i.test(w));
    const matchIndex = wheres.findIndex((w) => /LIKE\s+'023%003%02%'/i.test(w) || /PARCEL\s*=\s*'003\.02'/i.test(w));
    expect(exactIndex).toBeGreaterThanOrEqual(0);
    expect(matchIndex).toBeGreaterThan(exactIndex);

    // Every clause keeps its feature count as operator evidence.
    expect(outcome.attempts.some((a) => /→ 0 feature\(s\)/.test(a))).toBe(true);
    expect(outcome.attempts.some((a) => /→ 1 feature\(s\)/.test(a))).toBe(true);
  });

  it('reaches the MAP + PARCEL clause when no single identifier column matches', async () => {
    const { fetch, wheres } = service();
    const noLike: ArcgisFetch = async (url) => {
      const where = decodeURIComponent(new URL(url).searchParams.get('where') ?? '');
      if (/LIKE/i.test(where)) {
        wheres.push(where);
        return { status: 200, contentType: 'application/json', body: JSON.stringify({ features: [] }), url };
      }
      return fetch(url);
    };
    const outcome = await searchArcgisParcel(LAYER, SUBJECT, { fetch: noLike, ladder: new EscalationLadder() });

    expect(outcome.features.length).toBe(1);
    expect(wheres.some((w) => /MAP\s*=\s*'023'\s+AND\s+PARCEL\s*=\s*'003\.02'/i.test(w))).toBe(true);
  });

  it('records the clauses it could not run when the budget, not the county, stopped it', async () => {
    const { fetch, wheres } = service();
    const ladder = new EscalationLadder({ budget: { maxRequestsPerStage: 1, maxTotalRequests: 8 } });
    ladder.beginStage('known_adapter');
    const outcome = await searchArcgisParcel(LAYER, SUBJECT, { fetch, ladder, onRequest: () => ladder.noteRequest() });

    expect(outcome.features.length).toBe(0);
    expect(wheres.length).toBe(1);
    // The difference between "the county says no" and "LandOS ran out of
    // budget" stays visible in the attempt log.
    expect(outcome.attempts.some((a) => /skipped \(query budget spent\)/.test(a))).toBe(true);
  });

  it('holds wall clock back for the clauses without swallowing a small budget', () => {
    expect(clauseWallClockReserveMs(90_000, 0)).toBe(25_000);
    expect(clauseWallClockReserveMs(90_000, 80_000)).toBe(5_000);
    expect(clauseWallClockReserveMs(1_000, 0)).toBe(500);
    expect(clauseWallClockReserveMs(1_000, 5_000)).toBe(0);
  });

  it('releases the clause reserve when service discovery finds no layers', async () => {
    let clock = 0;
    const ladder = new EscalationLadder({ budget: { maxWallClockMs: 90_000 }, now: () => clock });
    const result = await runArcgisAdapter(
      {
        seeds: [],
        search: SUBJECT,
        fingerprint: fingerprintPlatform({ url: 'https://gis.example-county.gov/arcgis/rest/services/Parcels/MapServer' }),
      },
      { ladder },
    );
    expect(result.failureStates).toContain('STRUCTURED_SERVICE_NOT_FOUND');
    clock = 70_000;
    // A leaked 25 s clause reserve would make 70 s look exhausted against a
    // 90 s run. The caller must still be able to try another official source.
    expect(ladder.exhausted()).toBe(false);
  });
});
