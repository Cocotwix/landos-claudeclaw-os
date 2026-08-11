import { describe, expect, it } from 'vitest';
import {
  buildSchneiderReportUrl,
  findSchneiderDeployment,
  parseSchneiderDirectory,
  parseSchneiderMapConfig,
  parseSchneiderReport,
  parseSchneiderUrl,
  runSchneiderAdapter,
  type SchneiderDeployment,
} from './schneider-adapter.js';
import {
  extractGisHandoffLinks,
  iasWorldAppRoot,
  iasWorldRecordUrl,
  parseIasWorldRecord,
  runTylerAdapter,
} from './tyler-adapter.js';
import { arcgisSeedsFromInspection, extractConfigKeys, extractSubresources, inspectUnknownGovernmentSite } from './gis-generic-fallback.js';
import { looksBlocked, type GovFetchText } from './gis-transport.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';

function textFetch(routes: Array<[string | RegExp, { body: string; status?: number; contentType?: string }]>): GovFetchText {
  return async (url) => {
    for (const [match, res] of routes) {
      const hit = typeof match === 'string' ? url.includes(match) : match.test(url);
      if (!hit) continue;
      const status = res.status ?? 200;
      const contentType = res.contentType ?? 'text/html';
      return { status, body: res.body, url, contentType, blocked: looksBlocked(status, res.body, contentType), via: 'server_fetch' };
    }
    return { status: 404, body: 'not found', url, contentType: 'text/plain', blocked: false, via: 'server_fetch' };
  };
}

/* ───────────────────────────── Schneider ─────────────────────────────── */

const MAP_CONFIG = `
  <script>
    var mapConfig = {"AppId":1316,"LayerId":44911,"PageId":17333,"PageTypeId":4,
      "Tabs":[{"Name":"Map","PageId":17330,"PageTypeId":1},{"Name":"Search","PageId":17331,"PageTypeId":2},{"Name":"Report","PageId":17333,"PageTypeId":4}],
      "Search":{"Name":true,"Address":true,"ParcelId":true,"AlternateId":false},
      "DefaultReportUrl":"/Application.aspx?AppID=1316&LayerID=44911&PageTypeID=4&PageID=17333&KeyValue={0}"};
    Beacon.API.Initialize();
  </script>`;

const REPORT_HTML = `
  <title>qPublic - Example County - Report</title>
  <div class="module-header"><h2 class="title">Summary</h2></div>
  <div class="module-content">
    <table class="tabular-data-two-column">
      <tr><th>Parcel ID</th><td class="value-column">030200143.75-1-13</td></tr>
      <tr><th>Property Address</th><td class="value-column">1487 Onionville Rd</td></tr>
      <tr><th>Acres</th><td class="value-column">11.46</td></tr>
      <tr><th>Zoning</th><td class="value-column">AR</td></tr>
      <tr><th>Municipality</th><td class="value-column">Sterling</td></tr>
    </table>
  </div>
  <div class="module-header"><h2 class="title">Owners</h2></div>
  <table class="tabular-data-two-column"><tr><th>Owner</th><td class="value-column">Sterling Trail Tamers, Inc.</td></tr></table>`;

describe('the Schneider adapter treats the jurisdiction as a parameter, never as a code path', () => {
  it('parses the application grammar shared by every deployment', () => {
    const parsed = parseSchneiderUrl('https://beacon.schneidercorp.com/Application.aspx?AppID=1081&LayerID=26490&PageTypeID=4&PageID=10770&KeyValue=06974-040-000');
    expect(parsed).toMatchObject({ appId: 1081, layerId: 26490, pageTypeId: 4, pageId: 10770, keyValue: '06974-040-000' });
    expect(parseSchneiderUrl('https://gis.example-county.gov/arcgis/rest/services')).toBeNull();
  });

  it("reads the application's own config instead of guessing page identifiers", () => {
    const config = parseSchneiderMapConfig(MAP_CONFIG);
    expect(config?.appId).toBe(1316);
    expect(config?.tabs).toHaveLength(3);
    expect(config?.search.parcelId).toBe(true);
    expect(config?.search.alternateId).toBe(false);
    expect(config?.defaultReportUrlTemplate).toContain('{0}');
  });

  it("builds the parcel deep link from the application's own template", () => {
    const config = parseSchneiderMapConfig(MAP_CONFIG)!;
    const url = buildSchneiderReportUrl(config, '10.00-1/64.22', 'beacon.schneidercorp.com');
    expect(url).toContain('KeyValue=10.00-1%2F64.22');
  });

  it('resolves a county to its deployment through the published directory', () => {
    const deployments = parseSchneiderDirectory({
      States: [{ Name: 'New York', Apps: [{ ID: 1316, DisplayName: 'Broome County, NY' }, { ID: 1317, DisplayName: 'Cayuga County, NY' }] }],
      Quickstart: { '1317': [{ Description: 'Property Search', URL: 'Application.aspx?AppID=1317&LayerID=1&PageTypeID=2&PageID=2' }] },
    });
    const found = findSchneiderDeployment(deployments, 'Cayuga', 'NY');
    expect(found?.appId).toBe(1317);
    expect(found?.searchUrl).toContain('AppID=1317');
    // A county the vendor does not serve must resolve to nothing, not to a
    // neighbouring county's application.
    expect(findSchneiderDeployment(deployments, 'Nowhere', 'NY')).toBeNull();
  });

  it('reads the report structurally rather than against a fixed label vocabulary', () => {
    const report = parseSchneiderReport(REPORT_HTML);
    expect(report.sections).toEqual(['Summary', 'Owners']);
    expect(report.pairs.find((p) => p.label === 'Parcel ID')?.value).toBe('030200143.75-1-13');
  });

  it('retrieves a parcel through the deep link and labels the zoning value honestly', async () => {
    const fetchText = textFetch([
      ['PageTypeID=4', { body: REPORT_HTML }],
      ['Application.aspx', { body: MAP_CONFIG }],
    ]);
    const result = await runSchneiderAdapter(
      {
        search: { apn: '030200143.75-1-13', address: '1487 Onionville Rd', county: 'Broome', state: 'NY', knownAcres: 11.46 },
        fingerprint: fingerprintPlatform({ url: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1316' }),
        applicationUrl: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1316&LayerID=44911&PageTypeID=2&PageID=17331',
      },
      { fetchText },
    );
    expect(result.parcelMatchStatus).toBe('verified');
    expect(result.acres).toBeCloseTo(11.46, 2);
    expect(result.localGovernment).toBe('Sterling');
    // An assessment report's zoning field is not adopted zoning.
    expect(result.zoning?.authority).toBe('assessment_classification');
    // This family serves attribute pages; polygons live in the county GIS.
    expect(result.geometry).toBeNull();
    expect(result.fieldStates.geometry).toBe('not_exposed_by_deployment');
    expect(result.failureStates).toContain('GEOMETRY_UNAVAILABLE');
  });

  it('distinguishes an edge refusal from an empty source', async () => {
    // Reporting "no data" when the transport was refused would tell the
    // operator something false about the county.
    const fetchText = textFetch([['Application.aspx', { status: 403, body: '<html>Attention Required! | Cloudflare</html>' }]]);
    const result = await runSchneiderAdapter(
      { search: { apn: '1', county: 'Broome', state: 'NY' }, fingerprint: fingerprintPlatform({ url: 'https://beacon.schneidercorp.com/Application.aspx' }), applicationUrl: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1316' },
      { fetchText },
    );
    expect(result.failureStates).toContain('OFFICIAL_SOURCE_UNAVAILABLE');
    expect(result.failureStates).not.toContain('PARCEL_NOT_FOUND');
  });

  it('does not claim a search mode the deployment never published', async () => {
    const noParcelSearch = MAP_CONFIG.replace('"ParcelId":true', '"ParcelId":false');
    const fetchText = textFetch([['Application.aspx', { body: noParcelSearch }]]);
    const result = await runSchneiderAdapter(
      { search: { apn: '1', county: 'Broome', state: 'NY' }, fingerprint: fingerprintPlatform({ url: 'https://beacon.schneidercorp.com/Application.aspx' }), applicationUrl: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1316' },
      { fetchText },
    );
    expect(result.fieldStates.parcelId).toBe('not_exposed_by_deployment');
  });
});

/* ─────────────────────────────── Tyler ───────────────────────────────── */

const DATALET_HTML = `
  <tr class="DataletHeaderTop"><td>PARID: 01A001A000010</td></tr>
  <table>
    <tr><td class="DataletSideHeading">Parcel Number</td><td class="DataletData">01A001A000010</td></tr>
    <tr><td class="DataletSideHeading">Parcel Address</td><td class="DataletData">3159 GENUNG ST</td></tr>
    <tr><td class="DataletSideHeading">Parcel Owner</td><td class="DataletData">LORENZ TINA L</td></tr>
    <tr><td class="DataletSideHeading">Municipality</td><td class="DataletData">01 - MADISON TOWNSHIP</td></tr>
    <tr><td class="DataletSideHeading">Acres</td><td class="DataletData">2.51</td></tr>
  </table>
  <a class="SideBarTabs" href="/Datalets/Datalet.aspx?mode=sales">Sales</a>
  <a href="https://gis.example-county.gov/navigator/?find=01A001A000010">Map - County GIS</a>`;

describe('the Tyler adapter is scoped to what actually generalises', () => {
  it('derives the application root instead of assuming a fixed prefix', () => {
    expect(iasWorldAppRoot('https://www.example.org/PT/search/commonsearch.aspx?mode=realprop')).toBe('https://www.example.org/PT/');
    expect(iasWorldAppRoot('https://auditor.example.gov/Datalets/Datalet.aspx?pin=1')).toBe('https://auditor.example.gov/');
    expect(iasWorldAppRoot('https://www.example.org/')).toBeNull();
  });

  it('builds a cold record link with the canonical parameters', () => {
    expect(iasWorldRecordUrl('https://auditor.example.gov/', '01A001A000010'))
      .toContain('Datalets/Datalet.aspx?mode=profileall&UseSearch=no&pin=01A001A000010');
  });

  it('reads the record grid and the outbound GIS link', () => {
    const record = parseIasWorldRecord(DATALET_HTML, 'https://auditor.example.gov/Datalets/Datalet.aspx');
    expect(record.header).toContain('PARID: 01A001A000010');
    expect(record.pairs.find((p) => p.label === 'Parcel Owner')?.value).toBe('LORENZ TINA L');
    expect(record.tabs).toContain('Sales');
    // This product ships no map; the county GIS link is the correct next hop.
    expect(extractGisHandoffLinks(record)[0].url).toContain('gis.example-county.gov');
  });

  it('retrieves a record where the deployment permits a cold deep link', async () => {
    const fetchText = textFetch([['Datalet.aspx', { body: DATALET_HTML }]]);
    const result = await runTylerAdapter(
      {
        search: { apn: '01A001A000010', address: '3159 GENUNG ST', county: 'Lake', state: 'OH', knownAcres: 2.5 },
        fingerprint: fingerprintPlatform({ url: 'https://auditor.example.gov/search/commonsearch.aspx?mode=realprop' }),
        observedUrl: 'https://auditor.example.gov/search/commonsearch.aspx?mode=realprop',
      },
      { fetchText },
    );
    expect(result.parcelMatchStatus).toBe('verified');
    expect(result.localGovernment).toContain('MADISON TOWNSHIP');
    expect(result.officialPlanningLinks.length).toBeGreaterThan(0);
    expect(result.fieldStates.geometry).toBe('not_exposed_by_deployment');
  });

  it('reads the parcel id from the record header whichever label a deployment uses', async () => {
    // One deployment prints "PARID", another "Parcel Number". Keying on one
    // loses the identifier — and the whole match — on the other.
    const html = DATALET_HTML.replace('PARID: 01A001A000010', 'Parcel Number: 01A001A000010')
      .replace('<td class="DataletSideHeading">Parcel Number</td><td class="DataletData">01A001A000010</td>', '');
    const result = await runTylerAdapter(
      {
        search: { apn: '01A001A000010', county: 'Lake', state: 'OH' },
        fingerprint: fingerprintPlatform({ url: 'https://auditor.example.gov/search/commonsearch.aspx' }),
        observedUrl: 'https://auditor.example.gov/search/commonsearch.aspx?mode=realprop',
      },
      { fetchText: textFetch([['Datalet.aspx', { body: html }]]) },
    );
    expect(result.parcelId).toBe('01A001A000010');
    expect(result.parcelMatchStatus).toBe('verified');
  });

  it('never treats the subject county as corroboration coming from the source', async () => {
    // Copying the subject into the candidate makes it agree by construction,
    // and a record with no real data would then look corroborated.
    const empty = '<tr class="DataletHeaderTop"><td>PARID: 99</td></tr><table><tr><td class="DataletSideHeading">Nothing</td><td class="DataletData">-</td></tr></table>';
    const result = await runTylerAdapter(
      {
        search: { apn: '01A001A000010', county: 'Lake', state: 'OH' },
        fingerprint: fingerprintPlatform({ url: 'https://auditor.example.gov/search/commonsearch.aspx' }),
        observedUrl: 'https://auditor.example.gov/search/commonsearch.aspx?mode=realprop',
      },
      { fetchText: textFetch([['Datalet.aspx', { body: empty }]]) },
    );
    expect(result.parcelMatchStatus).not.toBe('verified');
  });

  it('reports a refused deep link as a deferred route, not as a missing parcel', async () => {
    // The same request succeeds on one deployment and is refused on another.
    // Calling that "parcel not found" would libel the county's records.
    const fetchText = textFetch([['Datalet.aspx', { body: "Sorry, You don't have access to requested page." }]]);
    const result = await runTylerAdapter(
      {
        search: { apn: '10025B01001', county: 'Chatham', state: 'GA' },
        fingerprint: fingerprintPlatform({ url: 'https://www.example.org/PT/search/commonsearch.aspx' }),
        observedUrl: 'https://www.example.org/PT/search/commonsearch.aspx?mode=address',
      },
      { fetchText },
    );
    expect(result.failureStates).toContain('INTERACTIVE_GIS_ROUTE_DEFERRED');
    expect(result.failureStates).not.toContain('PARCEL_NOT_FOUND');
  });
});

/* ──────────────────────────── generic fallback ───────────────────────── */

describe('an unknown government site is inspected, not driven', () => {
  it('reveals an Esri deployment hiding behind a county-branded shell', async () => {
    // The single highest-value outcome of the fallback: notice that the
    // bespoke-looking viewer is a family LandOS already handles.
    const shell = `<!-- version: 1/14/2026 -->
      <iframe id="MapFrame" src="https://experience.arcgis.com/experience/d5d2fbaab0c541b8ad23a5b96479e2c8"></iframe>`;
    const inspection = await inspectUnknownGovernmentSite('https://county-maps.example.com/', {
      fetchText: textFetch([['county-maps.example.com', { body: shell }]]),
    });
    expect(inspection.revealedHiddenPlatform).toBe(true);
    expect(inspection.refinedFingerprint.family).toBe('arcgis');
    expect(arcgisSeedsFromInspection(inspection)).toHaveLength(1);
  });

  it('surfaces other official search pages on the same domain', async () => {
    const html = `
      <a href="/assessor/parcel-search">Parcel Search</a>
      <a href="/planning/zoning-map">Zoning Map</a>
      <a href="https://unrelated-broker.example.net/search">Broker Search</a>
      <a href="/downloads/parcels.geojson">Parcel download</a>`;
    const inspection = await inspectUnknownGovernmentSite('https://www.example-county.gov/gis', {
      fetchText: textFetch([['example-county.gov', { body: html }]]),
    });
    expect(inspection.alternateSearchPages.some((l) => l.url.includes('/assessor/parcel-search'))).toBe(true);
    expect(inspection.planningLinks.some((l) => l.url.includes('/planning/zoning-map'))).toBe(true);
    expect(inspection.downloads.some((l) => l.url.endsWith('.geojson'))).toBe(true);
    // An off-domain commercial site is not an official alternate source.
    expect(inspection.alternateSearchPages.some((l) => l.url.includes('unrelated-broker'))).toBe(false);
  });

  it('says the transport was refused rather than that the site was empty', async () => {
    const inspection = await inspectUnknownGovernmentSite('https://portal.example.gov/', {
      fetchText: textFetch([['portal.example.gov', { status: 403, body: '<html>Just a moment...</html>' }]]),
    });
    expect(inspection.blocked).toBe(true);
    expect(inspection.notes.join(' ')).toMatch(/transport refusal/i);
  });

  it('pulls script and iframe sources and inline config keys out of a page', () => {
    const html = `<script src="/assets/app.js"></script><iframe src="https://x.example.gov/embed"></iframe>
      <script>var appConfig = {"parcelLayerUrl":"https://a","zoningLayerUrl":"https://b"};</script>`;
    const subs = extractSubresources(html, 'https://www.example-county.gov/gis');
    expect(subs.scripts[0]).toBe('https://www.example-county.gov/assets/app.js');
    expect(subs.frames[0]).toBe('https://x.example.gov/embed');
    expect(extractConfigKeys(html)).toContain('parcelLayerUrl');
  });
});
