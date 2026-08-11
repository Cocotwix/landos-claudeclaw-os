import { describe, expect, it } from 'vitest';
import {
  ArcgisRequestError,
  type ArcgisFetch,
  type ArcgisLayerSummary,
  addressWhereCandidates,
  apnWhereCascade,
  arcgisJson,
  assessmentOnlyDisclaimer,
  candidateFieldsByPrefix,
  classifyLayerRole,
  describeArcgisService,
  enumerateArcgisServices,
  experienceBuilderLayers,
  extractItemId,
  flattenWebMapLayers,
  parcelIdFieldCandidates,
  parseArcgisUrl,
  pickLayerForRole,
  probeArcgisServicesRoot,
  queryArcgisLayer,
  resolveField,
  traverseArcgisItem,
  webAppBuilderWebMapId,
} from './arcgis-service-discovery.js';

/** Route a fake transport by URL substring. Keys are matched in order. */
function fakeFetch(routes: Array<[string | RegExp, unknown | string]>, seen?: string[]): ArcgisFetch {
  return async (url) => {
    seen?.push(url);
    for (const [match, payload] of routes) {
      const hit = typeof match === 'string' ? url.includes(match) : match.test(url);
      if (!hit) continue;
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return { status: 200, contentType: typeof payload === 'string' ? 'text/html' : 'application/json', body, url };
    }
    return { status: 404, contentType: 'text/plain', body: 'not found', url };
  };
}

function layer(overrides: Partial<ArcgisLayerSummary> = {}): ArcgisLayerSummary {
  return {
    id: 0, name: 'Parcel', type: 'Feature Layer', geometryType: 'esriGeometryPolygon',
    parentLayerId: null, subLayerIds: null,
    serviceUrl: 'https://gis.example.gov/arcgis/rest/services/Tax/Parcels/MapServer',
    layerUrl: 'https://gis.example.gov/arcgis/rest/services/Tax/Parcels/MapServer/0',
    fields: [], capabilities: 'Map,Query,Data', maxRecordCount: 2000, supportsPagination: true,
    queryable: true, serviceName: 'Parcels', serviceDescription: '', sourceRank: 0,
    ...overrides,
  };
}

const f = (...names: string[]) => names.map((name) => ({ name, type: 'esriFieldTypeString', alias: name }));

describe('an ArcGIS REST URL is split without assuming the server context', () => {
  it('parses layer, service, folder and root forms', () => {
    const l = parseArcgisUrl('https://gis.example.gov/server/rest/services/TaxAssessor/Parcels/MapServer/3');
    expect(l?.serviceUrl).toBe('https://gis.example.gov/server/rest/services/TaxAssessor/Parcels/MapServer');
    expect(l?.folder).toBe('TaxAssessor');
    expect(l?.serviceName).toBe('Parcels');
    expect(l?.layerId).toBe(3);

    const root = parseArcgisUrl('https://gis.example.gov/mapping/rest/services');
    expect(root?.servicesRoot).toBe('https://gis.example.gov/mapping/rest/services');
    expect(root?.serviceUrl).toBeNull();

    expect(parseArcgisUrl('https://beacon.schneidercorp.com/Application.aspx?AppID=1')).toBeNull();
  });

  it('extracts a 32-hex application item id from every place one appears', () => {
    const id = 'd5d2fbaab0c541b8ad23a5b96479e2c8';
    expect(extractItemId(`https://experience.arcgis.com/experience/${id}`)).toBe(id);
    expect(extractItemId(`https://x.gov/apps/webappviewer/index.html?id=${id}`)).toBe(id);
    expect(extractItemId(`https://x.gov/apps/Viewer/index.html?appid=${id}`)).toBe(id);
    expect(extractItemId('https://x.gov/viewer')).toBeNull();
  });
});

describe('the transport reports what actually happened', () => {
  it('treats an in-body ArcGIS error as an error even though HTTP said 200', () => {
    // A secured service answers 200 with the failure in the body. Trusting the
    // status alone would read a token wall as valid, empty data.
    const http = fakeFetch([['MapServer', { error: { code: 499, message: 'Token Required' } }]]);
    return expect(arcgisJson('https://gis.example.gov/arcgis/rest/services/A/B/MapServer', {}, { fetch: http }))
      .rejects.toThrow(/499/);
  });

  it('refuses an HTML body where JSON was requested', () => {
    // A login wall or bot interstitial must never be parsed as data.
    const http = fakeFetch([['MapServer', '<html><body>Just a moment...</body></html>']]);
    return expect(arcgisJson('https://gis.example.gov/arcgis/rest/services/A/B/MapServer', {}, { fetch: http }))
      .rejects.toThrow(/HTML/);
  });

  it('counts every request so an escalation budget can cap the run', () => {
    const counted: string[] = [];
    const http = fakeFetch([['MapServer', { currentVersion: 11.1 }]]);
    return arcgisJson('https://gis.example.gov/arcgis/rest/services/A/B/MapServer', {}, {
      fetch: http, onRequest: (u) => counted.push(u),
    }).then(() => expect(counted).toHaveLength(1));
  });
});

describe('a services root is found by probing the contexts that really occur', () => {
  it('keeps probing after the conventional context 404s', async () => {
    // A 404 at /arcgis usually means the wrong context, not a missing server.
    const seen: string[] = [];
    const http = fakeFetch([['/server/rest/info', { currentVersion: 11.5 }]], seen);
    const found = await probeArcgisServicesRoot('https://gis.example.gov', { fetch: http });
    expect(found?.servicesRoot).toBe('https://gis.example.gov/server/rest/services');
    expect(seen.some((u) => u.includes('/arcgis/rest/info'))).toBe(true);
  });

  it('returns null when no context answers, rather than inventing a root', async () => {
    const http = fakeFetch([]);
    expect(await probeArcgisServicesRoot('https://www.example-county.gov', { fetch: http })).toBeNull();
  });
});

describe('services and layers are enumerated the cheap way', () => {
  it('recurses folders and does not re-prepend the folder to a qualified name', async () => {
    const http = fakeFetch([
      [/rest\/services\?/, { folders: ['TaxAssessor'], services: [] }],
      [/rest\/services\/TaxAssessor\?/, { services: [{ name: 'TaxAssessor/Parcels', type: 'MapServer' }] }],
    ]);
    const services = await enumerateArcgisServices('https://gis.example.gov/server/rest/services', { fetch: http });
    expect(services[0].url).toBe('https://gis.example.gov/server/rest/services/TaxAssessor/Parcels/MapServer');
  });

  it('reads all layer definitions from the bulk endpoint in one request', async () => {
    const seen: string[] = [];
    const http = fakeFetch([
      ['/MapServer/layers', { layers: [{ id: 0, name: 'Parcel', geometryType: 'esriGeometryPolygon', capabilities: 'Map,Query', fields: [{ name: 'PARCELID' }] }] }],
      ['/MapServer', { currentVersion: 10.81, capabilities: 'Map,Query,Data', serviceDescription: 'Tax parcels.', layers: [] }],
    ], seen);
    const summary = await describeArcgisService('https://gis.example.gov/arcgis/rest/services/Tax/Parcels/MapServer', { fetch: http }, 2);
    expect(summary.layers).toHaveLength(1);
    expect(summary.layers[0].serviceName).toBe('Parcels');
    expect(summary.layers[0].sourceRank).toBe(2);
    expect(seen.filter((u) => u.includes('/layers')).length).toBe(1);
  });

  it('marks a cached tile service as unable to answer attribute queries', async () => {
    const http = fakeFetch([
      ['/MapServer/layers', { layers: [] }],
      ['/MapServer', { singleFusedMapCache: true, capabilities: 'Map', layers: [] }],
    ]);
    const summary = await describeArcgisService('https://gis.example.gov/arcgis/rest/services/Base/Aerial/MapServer', { fetch: http });
    expect(summary.tiledOnly).toBe(true);
  });
});

describe('an application is walked down to real service URLs', () => {
  it('reads pre-resolved layer URLs straight out of an Experience Builder config', () => {
    const { layers, webMapItemIds } = experienceBuilderLayers({
      dataSources: {
        dataSource_1: { type: 'WEB_MAP', itemId: 'a'.repeat(32), portalUrl: 'https://org.maps.arcgis.com' },
        'dataSource_1-x-1': { url: 'http://gis.example.gov/server/rest/services/Tax/Parcels/MapServer/0', sourceLabel: 'Tax Parcels' },
      },
    });
    expect(webMapItemIds).toEqual(['a'.repeat(32)]);
    // http is upgraded before it is ever fetched.
    expect(layers[0].url.startsWith('https://')).toBe(true);
  });

  it('flattens group layers and keeps item-backed layers instead of dropping them', () => {
    const refs = flattenWebMapLayers([
      { title: 'Group', layers: [{ title: 'Parcels', url: 'https://a.gov/arcgis/rest/services/P/MapServer/0' }] },
      { title: 'Soils', itemId: 'b'.repeat(32) },
    ]);
    expect(refs).toHaveLength(2);
    expect(refs[1].itemId).toBe('b'.repeat(32));
  });

  it('finds the web map id under each app shape', () => {
    expect(webAppBuilderWebMapId({ map: { itemId: 'c'.repeat(32) } })).toBe('c'.repeat(32));
    expect(webAppBuilderWebMapId({ values: { webmap: 'd'.repeat(32) } })).toBe('d'.repeat(32));
    expect(webAppBuilderWebMapId({ nothing: true })).toBeNull();
  });

  it('traverses an app item through its web map to the operational layers', async () => {
    const app = 'e'.repeat(32);
    const map = 'f'.repeat(32);
    const http = fakeFetch([
      [`items/${app}/data`, { map: { itemId: map } }],
      [`items/${app}`, { type: 'Web Mapping Application' }],
      [`items/${map}/data`, { operationalLayers: [{ title: 'Parcels', url: 'https://gis.example.gov/arcgis/rest/services/Tax/Parcels/MapServer' }] }],
      [`items/${map}`, { type: 'Web Map' }],
    ]);
    const result = await traverseArcgisItem(app, null, { fetch: http });
    expect(result.layers[0].url).toContain('/Tax/Parcels/MapServer');
    expect(result.path).toContain('web_map');
  });
});

describe('which layer is which is decided from evidence, not from its name', () => {
  it('picks the parcel layer over an identically named annotation class', () => {
    // A cartographic label layer can be polygon-shaped, named "Parcel Number"
    // and sit in the same service. Its fields give it away.
    const annotation = layer({ id: 4300, name: 'Parcel Number', fields: f('OBJECTID', 'AnnotationClassID', 'TextString', 'FontName') });
    const real = layer({ id: 4400, name: 'Parcel', fields: f('SWISPIN', 'PRINT_KEY', 'OWNERS', 'LOCATION', 'Acreage_Ca') });
    expect(classifyLayerRole(annotation).role).toBe('other');
    expect(classifyLayerRole(real).role).toBe('parcel');
    expect(pickLayerForRole([annotation, real], 'parcel')?.layer.id).toBe(4400);
  });

  it('matches a layer name whose words are separated by underscores', () => {
    // Underscore is a word character, so a naive word-boundary test fails on
    // the single most common county naming style.
    expect(classifyLayerRole(layer({ name: 'NYS_Tax_Parcels_Public', fields: f('PRINT_KEY', 'PRIMARY_OWNER', 'PARCEL_ADDR', 'ACRES') })).role).toBe('parcel');
    expect(classifyLayerRole(layer({ name: 'NYS_Tax_Parcels_Public_Footprint', fields: f('NAME') })).role).not.toBe('parcel');
  });

  it('uses the service name to classify layers that are named after towns', () => {
    // A county publishing one layer per municipality inside a ZONING service
    // gives each the full parcel schema. Only the service name distinguishes.
    const zoningTown = layer({
      name: 'Sterling', serviceName: 'ZONING_CODE',
      fields: f('SWISPIN', 'PRINT_KEY', 'OWNERS', 'LOCATION', 'zoning_cd', 'Zoning_desc'),
    });
    expect(classifyLayerRole(zoningTown).role).toBe('zoning');

    const boundaryTown = layer({ name: 'Sterling', serviceName: 'MUNICIPALITY', fields: f('SWISPIN', 'OWNERS', 'LOCATION', 'Acreage_Ca') });
    expect(classifyLayerRole(boundaryTown).role).toBe('boundary');
  });

  it('prefers the county source over a statewide mirror of the same parcels', () => {
    const county = layer({ name: 'Parcel', sourceRank: 0, fields: f('PRINT_KEY', 'OWNERS', 'LOCATION', 'Acreage_Ca') });
    const statewide = layer({ name: 'Statewide Tax Parcels', sourceRank: 5, fields: f('PRINT_KEY', 'PRIMARY_OWNER', 'PARCEL_ADDR', 'ACRES', 'COUNTY_NAME') });
    expect(pickLayerForRole([statewide, county], 'parcel')?.layer.sourceRank).toBe(0);
  });

  it('never selects a layer that cannot answer a query', () => {
    const renderOnly = layer({ name: 'Parcels', queryable: false, capabilities: 'Map', fields: f('PARCELID', 'OWNER', 'SITUS', 'ACRES') });
    expect(pickLayerForRole([renderOnly], 'parcel')).toBeNull();
  });
});

describe('field roles are resolved from what the deployment actually publishes', () => {
  it('prefers the more specific candidate when several are present', () => {
    expect(resolveField(f('ACRES', 'CALC_ACRES'), 'acres')).toBe('CALC_ACRES');
    expect(resolveField(f('NAME', 'PRIMARY_OWNER'), 'owner')).toBe('PRIMARY_OWNER');
  });

  it('returns null rather than guessing when the field is absent', () => {
    expect(resolveField(f('OBJECTID', 'SHAPE'), 'zoningCode')).toBeNull();
  });

  it('offers truncated field names as candidates that the caller must validate', () => {
    // County pipelines truncate names to ten characters, so a real acreage
    // field arrives as something like Acreage_Ca and matches nothing exactly.
    expect(resolveField(f('Acreage_Ca'), 'acres')).toBeNull();
    expect(candidateFieldsByPrefix(f('Acreage_Ca'), 'acres')).toContain('Acreage_Ca');
  });
});

describe('a printed parcel identifier is searched for the way counties really store it', () => {
  it('cascades exact, then normalized, then prefix, and marks which are exact', () => {
    const cascade = apnWhereCascade('055689 10.00-1-64.22', 'PRINT_KEY');
    expect(cascade[0]).toMatchObject({ strategy: 'exact', exact: true });
    expect(cascade[0].where).toContain("PRINT_KEY = '055689 10.00-1-64.22'");
    // A prefix hit still finds the parcel but must be reconciled, so it is not
    // allowed to claim it was an exact identifier match.
    expect(cascade.some((c) => c.strategy === 'prefix' && c.exact === false)).toBe(true);
  });

  it('interleaves the identifier tokens so internal padding cannot hide a parcel', () => {
    // A county prints "073090 04200" and stores "073 090    04200 000 2026".
    // Neither an exact match nor whole-string containment finds that parcel.
    const cascade = apnWhereCascade('073090 04200', 'PARCELID');
    expect(cascade.some((c) => c.where.includes("LIKE '073090%04200%'"))).toBe(true);
    expect(cascade.some((c) => c.where.includes("LIKE '%073090%04200%'"))).toBe(true);
  });

  it('never builds a clause on a SQL function that hosted services reject', () => {
    // Hosted layers run standardized queries and refuse REPLACE outright, so a
    // normalization built on it would fail exactly where it is needed most.
    for (const strategy of apnWhereCascade('073090 04200', 'PARCELID')) {
      expect(strategy.where).not.toMatch(/REPLACE\s*\(/i);
    }
  });

  it('offers several identifier columns so one spelling is not the only chance', () => {
    const candidates = parcelIdFieldCandidates(f('OBJECTID', 'GISLINK', 'PARCELID', 'SHAPE'));
    expect(candidates).toContain('PARCELID');
    expect(candidates).toContain('GISLINK');
  });

  it('escapes a quote rather than producing a broken clause', () => {
    expect(apnWhereCascade("O'BRIEN-1", 'PID')[0].where).toContain("O''BRIEN-1");
  });

  it('builds address clauses from most to least selective', () => {
    const candidates = addressWhereCandidates('1487 Onionville Rd', 'PARCEL_ADDR');
    expect(candidates[0]).toContain("= '1487 ONIONVILLE RD'");
    expect(candidates[candidates.length - 1]).toContain('ONIONVILLE RD');
  });
});

describe('queries always come back in a usable spatial reference', () => {
  it('requests WGS84 output so geometry and acreage are never in map units', async () => {
    const seen: string[] = [];
    const http = fakeFetch([['/query', { features: [{ attributes: { PARCELID: '1' } }], exceededTransferLimit: false }]], seen);
    await queryArcgisLayer('https://gis.example.gov/arcgis/rest/services/T/P/MapServer/0', { where: "PARCELID='1'" }, { fetch: http });
    expect(seen[0]).toContain('outSR=4326');
  });

  it('surfaces a truncated result set instead of presenting it as complete', async () => {
    const http = fakeFetch([['/query', { features: [{ attributes: {} }], exceededTransferLimit: true }]]);
    const result = await queryArcgisLayer('https://gis.example.gov/arcgis/rest/services/T/P/MapServer/0', {}, { fetch: http });
    expect(result.exceededTransferLimit).toBe(true);
  });

  it('sends a point query with the input spatial reference declared', async () => {
    const seen: string[] = [];
    const http = fakeFetch([['/query', { features: [] }]], seen);
    await queryArcgisLayer('https://gis.example.gov/arcgis/rest/services/T/Z/MapServer/0', { geometry: { x: -76.6, y: 43.3 } }, { fetch: http });
    expect(seen[0]).toContain('inSR=4326');
    expect(seen[0]).toContain('esriGeometryPoint');
  });
});

describe("a publisher's own caveat about a zoning code is honoured", () => {
  it('extracts the surrounding sentence when a service says it is assessment-only', () => {
    const disclaimer = assessmentOnlyDisclaimer(
      'Municipal boundaries. Zoning codes are used for assessment purposes only and are not indicative of local zoning maps. Updated annually.',
    );
    expect(disclaimer).toContain('assessment purposes only');
  });

  it('returns null when the service makes no such claim', () => {
    expect(assessmentOnlyDisclaimer('Official adopted zoning districts for the county.')).toBeNull();
  });
});

describe('errors carry enough detail to act on', () => {
  it('names the endpoint and the ArcGIS code', async () => {
    const http = fakeFetch([['MapServer', { error: { code: 498, message: 'Invalid Token' } }]]);
    await expect(arcgisJson('https://gis.example.gov/arcgis/rest/services/A/B/MapServer', {}, { fetch: http }))
      .rejects.toBeInstanceOf(ArcgisRequestError);
  });
});
