import { describe, expect, it } from 'vitest';
import { runArcgisAdapter, discoverArcgisLayers, extractJurisdictionClues } from './arcgis-adapter.js';
import type { ArcgisFetch, ArcgisLayerSummary } from './arcgis-service-discovery.js';
import { EscalationLadder } from './gis-escalation.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';
import type { NormalizedParcelSearchInput } from './gis-platform-types.js';

const ROOT = 'https://gis.example-county.gov/arcgis/rest/services';
const PARCEL_SVC = `${ROOT}/TaxMapOnline/PARCEL/MapServer`;
const ZONING_SVC = `${ROOT}/Planning/ZONING/MapServer`;

/**
 * A county deployment modelled on a real one: a parcel layer whose printed key
 * is the bare local id while the record separately carries the municipal code,
 * plus a truncated acreage field and an inline assessment classification.
 */
const PARCEL_FIELDS = [
  'OBJECTID', 'SWISPIN', 'SWIS', 'S_B_L', 'Municipali', 'Acreage_Ca', 'SCH_DIST',
  'PRINT_KEY', 'PROP_CLASS', 'LOCATION', 'OWNERS', 'LAND_SIZE', 'zoning_cd', 'Zoning_desc',
].map((name) => ({ name, type: 'esriFieldTypeString', alias: name }));

const SUBJECT_ATTRS = {
  OBJECTID: 1,
  SWISPIN: '05568901000000010640220000',
  SWIS: '055689',
  S_B_L: '10.00-1-64.22',
  Municipali: 'Sterling',
  Acreage_Ca: 11.46255616,
  SCH_DIST: 'Hannibal',
  PRINT_KEY: '10.00-1-64.22',
  PROP_CLASS: '312',
  LOCATION: '1487 Onionville Rd',
  OWNERS: 'Sterling Trail Tamers, Inc.,',
  LAND_SIZE: '11.5 ac',
  zoning_cd: '01',
  Zoning_desc: 'AR',
};

const RINGS = [[[-76.6422, 43.3146], [-76.6400, 43.3146], [-76.6400, 43.3180], [-76.6422, 43.3180], [-76.6422, 43.3146]]];

interface DeploymentOptions {
  /** Service description used for the zoning service, so a caveat can be tested. */
  zoningServiceDescription?: string;
  /** Include a dedicated zoning layer covering the parcel. */
  withZoningLayer?: boolean;
  /** Attributes returned for the parcel query. */
  parcelAttrs?: Record<string, unknown>;
  /** Return no parcel features at all. */
  parcelEmpty?: boolean;
  /** Omit geometry from the parcel feature. */
  withoutGeometry?: boolean;
}

function deployment(options: DeploymentOptions = {}): { fetch: ArcgisFetch; seen: string[] } {
  const seen: string[] = [];
  const attrs = options.parcelAttrs ?? SUBJECT_ATTRS;

  const fetch: ArcgisFetch = async (url) => {
    seen.push(url);
    const json = (payload: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(payload), url });

    if (url.includes('/rest/info')) return json({ currentVersion: 10.81 });

    if (url.includes('PARCEL/MapServer/4400/query')) {
      if (options.parcelEmpty) return json({ features: [] });
      // Only the prefix strategy hits, exactly as the real deployment behaves:
      // an exact match on the printed key returns nothing.
      if (!url.includes('LIKE')) return json({ features: [] });
      return json({
        features: [{ attributes: attrs, ...(options.withoutGeometry ? {} : { geometry: { rings: RINGS } }) }],
      });
    }
    if (url.includes('ZONING/MapServer/0/query')) {
      return json({ features: [{ attributes: { ZONING: 'RA-1', ZONEDESC: 'Rural Agricultural' } }] });
    }

    if (url.includes('PARCEL/MapServer/layers')) {
      return json({
        layers: [
          { id: 4300, name: 'Parcel Number', geometryType: 'esriGeometryPolygon', capabilities: 'Map,Query,Data', fields: [{ name: 'AnnotationClassID' }, { name: 'TextString' }] },
          { id: 4400, name: 'Parcel', geometryType: 'esriGeometryPolygon', capabilities: 'Map,Query,Data', fields: PARCEL_FIELDS },
        ],
      });
    }
    if (url.includes('ZONING/MapServer/layers')) {
      return json({
        layers: [{ id: 0, name: 'Zoning Districts', geometryType: 'esriGeometryPolygon', capabilities: 'Map,Query,Data', fields: [{ name: 'ZONING' }, { name: 'ZONEDESC' }] }],
      });
    }

    if (url.includes('PARCEL/MapServer?')) return json({ currentVersion: 10.81, capabilities: 'Map,Query,Data', serviceDescription: 'Tax parcels.', layers: [] });
    if (url.includes('ZONING/MapServer?')) {
      return json({ currentVersion: 10.81, capabilities: 'Map,Query,Data', serviceDescription: options.zoningServiceDescription ?? 'Official adopted zoning districts.', layers: [] });
    }

    if (url.includes('/rest/services?')) {
      return json({
        folders: ['TaxMapOnline', ...(options.withZoningLayer ? ['Planning'] : [])],
        services: [],
      });
    }
    if (url.includes('/rest/services/TaxMapOnline?')) return json({ services: [{ name: 'TaxMapOnline/PARCEL', type: 'MapServer' }] });
    if (url.includes('/rest/services/Planning?')) return json({ services: [{ name: 'Planning/ZONING', type: 'MapServer' }] });

    return { status: 404, contentType: 'text/plain', body: 'not found', url };
  };
  return { fetch, seen };
}

const SUBJECT: NormalizedParcelSearchInput = {
  address: '1487 Onionville Rd',
  city: 'Sterling',
  county: 'Cayuga',
  state: 'NY',
  apn: '055689 10.00-1-64.22',
  knownAcres: 11.46,
};

const FINGERPRINT = fingerprintPlatform({ url: PARCEL_SVC });

describe('the ArcGIS adapter resolves a real county deployment with no county-specific code', () => {
  it('finds the parcel, its geometry and its acreage through the structured service alone', async () => {
    const { fetch, seen } = deployment();
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch, ladder: new EscalationLadder() },
    );

    expect(result.parcelMatchStatus).toBe('verified');
    expect(result.parcelId).toBe('10.00-1-64.22');
    expect(result.parcelAddress).toBe('1487 Onionville Rd');
    expect(result.owner).toContain('Sterling Trail Tamers');
    expect(result.geometry?.vertexCount).toBe(5);
    expect(result.geometry?.spatialReference).toBe(4326);
    expect(result.retrievalMethod).toBe('structured_service');
    // The whole point: no browser, no map interaction, only service calls.
    expect(seen.every((u) => u.includes('/rest/'))).toBe(true);
  });

  it('reads acreage from a field whose name was truncated upstream', async () => {
    // Acreage_Ca matches no exact candidate; the value is what validates it.
    const { fetch } = deployment();
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.acres).toBeCloseTo(11.4625, 3);
  });

  it('accepts a parcel whose printed key is prefixed with a code the record also carries', async () => {
    // LandOS holds "055689 10.00-1-64.22"; the layer stores "10.00-1-64.22"
    // and the municipal code separately. Comparing only the primary field
    // would report a conflict on a correctly matched parcel.
    const { fetch } = deployment();
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    const apnCheck = result.reconciliation?.checks.find((c) => c.dimension === 'apn');
    expect(apnCheck?.outcome).toBe('match');
  });

  it('captures jurisdiction clues as evidence, without deciding legal authority', async () => {
    const { fetch } = deployment();
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    const levels = result.jurisdictionClues.map((c) => c.level);
    expect(levels).toContain('school_district');
    expect(result.localGovernment).toBe('Sterling');
    // Every clue keeps the field it came from so the next sprint can re-read it.
    expect(result.jurisdictionClues.every((c) => !!c.sourceField && !!c.sourceUrl)).toBe(true);
    // Incorporation is never inferred from a town name.
    expect(result.incorporatedStatus).toBeNull();
  });
});

describe('a zoning value is never allowed to overstate its own authority', () => {
  it('labels a code stored on the assessment record as an assessment classification', async () => {
    const { fetch } = deployment();
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.zoning?.code).toBe('01');
    expect(result.zoning?.authority).toBe('assessment_classification');
    expect(result.zoning?.sourceDisclaimer).toBeTruthy();
    expect(result.zoning?.interpreted).toBe(false);
  });

  it('labels a dedicated zoning layer as official zoning', async () => {
    const { fetch } = deployment({ withZoningLayer: true, parcelAttrs: { ...SUBJECT_ATTRS, zoning_cd: null, Zoning_desc: null } });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.zoning?.code).toBe('RA-1');
    expect(result.zoning?.authority).toBe('official_zoning_layer');
    expect(result.zoningLayer?.geometryRelationship).toBe('contains_subject');
  });

  it("downgrades a zoning layer that says it is assessment-only in its own description", async () => {
    const { fetch } = deployment({
      withZoningLayer: true,
      parcelAttrs: { ...SUBJECT_ATTRS, zoning_cd: null, Zoning_desc: null },
      zoningServiceDescription: 'Zoning codes are used for assessment purposes only and are not indicative of local zoning maps.',
    });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.zoning?.authority).toBe('assessment_classification');
    expect(result.zoning?.sourceDisclaimer).toContain('assessment purposes only');
  });

  it('reports the absence of a zoning layer rather than leaving it blank', async () => {
    const { fetch } = deployment({ parcelAttrs: { ...SUBJECT_ATTRS, zoning_cd: null, Zoning_desc: null } });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.zoning).toBeNull();
    expect(result.failureStates).toContain('ZONING_LAYER_NOT_FOUND');
    expect(result.fieldStates.zoning).toBe('not_exposed_by_deployment');
  });
});

describe('the adapter refuses to accept the wrong parcel', () => {
  it('reports an identity conflict when the record disagrees on a material dimension', async () => {
    const { fetch } = deployment({
      parcelAttrs: { ...SUBJECT_ATTRS, PRINT_KEY: '99.00-9-99', S_B_L: '99.00-9-99', SWISPIN: '05568999009999', LOCATION: '4 Some Other Rd', Acreage_Ca: 140 },
    });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.parcelMatchStatus).toBe('conflict');
    expect(result.failureStates).toContain('PARCEL_IDENTITY_CONFLICT');
    expect(result.parcelId).toBeNull();
  });

  it('reports parcel-not-found honestly when the source returns nothing', async () => {
    const { fetch } = deployment({ parcelEmpty: true });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.parcelMatchStatus).toBe('not_found');
    expect(result.failureStates).toContain('PARCEL_NOT_FOUND');
  });

  it('names geometry as unavailable rather than returning an empty shape', async () => {
    const { fetch } = deployment({ withoutGeometry: true });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch },
    );
    expect(result.geometry).toBeNull();
    expect(result.failureStates).toContain('GEOMETRY_UNAVAILABLE');
    expect(result.unresolvedFields).toContain('geometry');
  });

  it('states when no queryable service could be reached at all', async () => {
    const dead: ArcgisFetch = async (url) => ({ status: 404, contentType: 'text/plain', body: 'no', url });
    const result = await runArcgisAdapter(
      { seeds: [{ url: ROOT, label: 'county root' }], search: SUBJECT, fingerprint: FINGERPRINT },
      { fetch: dead },
    );
    expect(result.failureStates).toContain('STRUCTURED_SERVICE_NOT_FOUND');
    expect(result.retrievalConfidence).toBe('none');
  });
});

describe('a weak match on one column never pre-empts a strong match on another', () => {
  it('tries every identifier column at each strength before weakening', async () => {
    // The failure this guards against: a containment match on the first
    // identifier column returns a dozen unrelated parcels and reports a
    // conflict, while an exact match on a second column would have found the
    // right one. Strategy strength must outrank column order.
    const attrs = { OBJECTID: 1, PARCELID: '073 090    04200 000 2026', GISLINK: '073090    04200', OWNER: 'SACHAN DILEEP S', ADDRESS: 'OLD RIDGE RD', DEEDAC: 12.28, COUNTY_NAME: 'Roane' };
    const wrong = { OBJECTID: 2, PARCELID: '001 002    04200 000 2026', GISLINK: '001002    04200', OWNER: 'SOMEONE ELSE', ADDRESS: '9 OTHER RD', DEEDAC: 400, COUNTY_NAME: 'Roane' };

    const fetch: ArcgisFetch = async (url) => {
      const json = (p: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(p), url });
      if (url.includes('/layers')) {
        return json({ layers: [{ id: 0, name: 'Parcels', geometryType: 'esriGeometryPolygon', capabilities: 'Query', fields: Object.keys(attrs).map((name) => ({ name })) }] });
      }
      if (url.includes('/query')) {
        const where = decodeURIComponent(url.replace(/\+/g, ' '));
        // Only the compact column carries a contiguous, anchorable spelling.
        if (where.includes("GISLINK LIKE '073090%04200%'")) {
          return json({ features: [{ attributes: attrs, geometry: { rings: RINGS } }] });
        }
        // The padded column only ever answers the weakest containment, and it
        // answers with the wrong parcels.
        if (where.includes("PARCELID LIKE '%04200%'")) return json({ features: [{ attributes: wrong }] });
        return json({ features: [] });
      }
      if (url.includes('FeatureServer?')) return json({ currentVersion: 11, capabilities: 'Query', serviceDescription: '', layers: [] });
      return { status: 404, contentType: 'text/plain', body: 'no', url };
    };

    const result = await runArcgisAdapter(
      {
        seeds: [{ url: 'https://services1.arcgis.com/ORG/arcgis/rest/services/State_Parcels/FeatureServer', label: 'statewide' }],
        search: { apn: '073090 04200', address: 'Old Ridge Rd', county: 'Roane', state: 'TN', knownAcres: 12.28 },
        fingerprint: fingerprintPlatform({ url: 'https://services1.arcgis.com/ORG/arcgis/rest/services/State_Parcels/FeatureServer' }),
      },
      { fetch },
    );
    expect(result.parcelMatchStatus).toBe('verified');
    expect(result.owner).toBe('SACHAN DILEEP S');
    expect(result.acres).toBeCloseTo(12.28, 2);
  });
});

describe('discovery stays inside its request budget', () => {
  it('stops describing services once the stage budget is spent', async () => {
    const { fetch } = deployment();
    const ladder = new EscalationLadder({ budget: { maxRequestsPerStage: 2, maxTotalRequests: 4 } });
    ladder.beginStage('structured_service_discovery');
    const discovered = await discoverArcgisLayers([{ url: ROOT, label: 'root' }], {
      fetch, ladder, onRequest: () => ladder.noteRequest(),
    });
    expect(discovered.notes.some((n) => /budget/i.test(n))).toBe(true);
  });
});

describe('jurisdiction clue extraction', () => {
  const layer: ArcgisLayerSummary = {
    id: 0, name: 'Parcel', type: 'Feature Layer', geometryType: 'esriGeometryPolygon',
    parentLayerId: null, subLayerIds: null, serviceUrl: PARCEL_SVC, layerUrl: `${PARCEL_SVC}/0`,
    fields: [{ name: 'TOWNSHIP', type: 's', alias: 'TOWNSHIP' }, { name: 'COUNTY_NAME', type: 's', alias: 'COUNTY_NAME' }],
    capabilities: 'Query', maxRecordCount: 1000, supportsPagination: true, queryable: true,
    serviceName: 'PARCEL', serviceDescription: '', sourceRank: 0,
  };

  it('maps a township field to the township level rather than a generic municipality', () => {
    const clues = extractJurisdictionClues({ attributes: { TOWNSHIP: 'Sterling', COUNTY_NAME: 'Cayuga' } }, layer, `${PARCEL_SVC}/0`);
    expect(clues.find((c) => c.name === 'Sterling')?.level).toBe('township');
    expect(clues.find((c) => c.name === 'Cayuga')?.level).toBe('county');
  });

  it('emits nothing when the source published no jurisdiction attribute', () => {
    expect(extractJurisdictionClues({ attributes: {} }, layer, `${PARCEL_SVC}/0`)).toHaveLength(0);
  });
});
