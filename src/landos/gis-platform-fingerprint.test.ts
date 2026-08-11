import { describe, expect, it } from 'vitest';
import {
  extractStructuredServices,
  fingerprintPlatform,
  type PlatformProbeInput,
} from './gis-platform-fingerprint.js';
import { buildPlatformCapabilityReport, PLATFORM_FAMILY_PROFILES, SCORED_PLATFORM_FAMILIES } from './gis-platform-registry.js';

describe('a government GIS site is classified from technical evidence, not appearance', () => {
  it('recognises a bare ArcGIS REST service regardless of the server context path', () => {
    // The context is NOT always /arcgis. A detector keyed on that string alone
    // would miss every county running /server, /mapping or a bespoke context.
    for (const context of ['arcgis', 'server', 'mapping', 'hosting']) {
      const fp = fingerprintPlatform({ url: `https://gis.example-county.gov/${context}/rest/services/Tax/Parcels/MapServer/0` });
      expect(fp.family).toBe('arcgis');
      expect(fp.recommendedAdapter).toBe('arcgis');
    }
  });

  it('will not reach high confidence on branding and markup alone', () => {
    // A page that merely SAYS Esri is not proof that it is Esri. Without a
    // hostname, path, script, config or service, the verdict stays low.
    const fp = fingerprintPlatform({
      url: 'https://county-property-lookup.example.org/lookup',
      html: '<footer>Powered by Esri</footer><div class="esri-view"></div>',
      title: 'ArcGIS Online',
    });
    expect(fp.confidence).toBe('low');
  });

  it('promotes to high confidence once a real service endpoint is observed', () => {
    const fp = fingerprintPlatform({
      url: 'https://maps.example-county.gov/apps/webappviewer/index.html?id=0123456789abcdef0123456789abcdef',
      scriptUrls: ['https://js.arcgis.com/4.29/init.js', 'https://maps.example-county.gov/jimu.js/main.js'],
      networkUrls: ['https://maps.example-county.gov/server/rest/services/Assessor/Parcels/MapServer/0/query?f=json'],
      html: '<div class="jimu-widget"></div>',
    });
    expect(fp.family).toBe('arcgis');
    expect(fp.confidence).toBe('high');
    expect(fp.variant).toBe('web_appbuilder');
  });

  it('identifies the Experience Builder variant from the application path', () => {
    const fp = fingerprintPlatform({ url: 'https://experience.arcgis.com/experience/0123456789abcdef0123456789abcdef' });
    expect(fp.family).toBe('arcgis');
    expect(fp.variant).toBe('experience_builder');
  });

  it('reports a Geocortex viewer as its own family but still routes to the ArcGIS adapter', () => {
    // The frontend is a detection fact; the data underneath is Esri. Naming a
    // second adapter for it would duplicate work that already exists.
    const fp = fingerprintPlatform({
      url: 'https://gismaps.example-city.gov/Geocortex/Essentials/REST/sites/Public',
      html: '<div class="gcx-viewer"></div>',
    });
    expect(fp.family).toBe('geocortex');
    expect(fp.recommendedAdapter).toBe('arcgis');
  });

  it('recognises the Schneider application grammar', () => {
    const fp = fingerprintPlatform({
      url: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1081&LayerID=26490&PageTypeID=4&PageID=10770',
      html: '<table class="tabular-data-two-column"><th>Parcel ID</th><td class="value-column">123</td></table>',
      configKeys: ['mapConfig', 'DefaultReportUrl'],
    });
    expect(fp.family).toBe('schneider_beacon_qpublic');
    expect(fp.recommendedAdapter).toBe('schneider_beacon_qpublic');
  });

  it('recognises iasWorld from its endpoints and cell classes', () => {
    const fp = fingerprintPlatform({
      url: 'https://www.example-county.org/PT/search/commonsearch.aspx?mode=realprop',
      html: '<td class="DataletSideHeading">Owner</td><td class="DataletData">SMITH</td>',
      scriptUrls: ['../Script/ParidControl.js'],
    });
    expect(fp.family).toBe('tyler');
  });

  it('does not classify an unrelated appraisal district as Tyler because of its hostname', () => {
    // A well-known false positive: several appraisal districts carry "tyler"
    // in the hostname and run entirely different software.
    const fp = fingerprintPlatform({ url: 'https://esearch.tylercad.net/Property/View/12345' });
    expect(fp.family).not.toBe('tyler');
  });

  it('states an unrecognised government site as a custom portal, not as a guess', () => {
    const fp = fingerprintPlatform({ url: 'https://www.example-parish.gov/assessor/property-lookup' });
    expect(fp.family).toBe('custom_government_portal');
    expect(fp.recommendedAdapter).toBe('generic_fallback');
    expect(fp.confidence).toBe('low');
  });

  it('reports a non-government unrecognised host as unknown with no confidence', () => {
    const fp = fingerprintPlatform({ url: 'https://random-listing-site.example.com/property/1' });
    expect(fp.family).toBe('unknown');
    expect(fp.confidence).toBe('none');
  });
});

describe('structured services are found before any adapter runs', () => {
  it('classifies each ArcGIS service kind at its most specific level', () => {
    const probe: PlatformProbeInput = {
      url: 'https://county.example.gov/viewer',
      html: `
        <a href="https://gis.example.gov/server/rest/services/Tax/Parcels/FeatureServer/0">f</a>
        <a href="https://gis.example.gov/server/rest/services/Plan/Zoning/MapServer">m</a>
        <a href="https://gis.example.gov/server/rest/services">root</a>
      `,
    };
    const kinds = extractStructuredServices(probe).map((s) => s.kind);
    expect(kinds).toContain('arcgis_feature_server');
    expect(kinds).toContain('arcgis_map_server');
    // The root is the least specific and must not shadow the two above it.
    expect(kinds).toContain('arcgis_server_root');
  });

  it('finds an Esri application embedded in a county-branded shell', () => {
    // Several vendors ship a page whose entire body is an iframe to an Esri
    // app. Resolving that embedded id is what makes those counties work with
    // no vendor-specific code at all.
    const services = extractStructuredServices({
      url: 'https://ford-il.example-maps.com/',
      html: '<iframe id="MapFrame" src="https://experience.arcgis.com/experience/d5d2fbaab0c541b8ad23a5b96479e2c8"></iframe>',
    });
    expect(services.some((s) => s.kind === 'arcgis_portal_item')).toBe(true);
  });

  it('finds OGC services on an open-geo stack', () => {
    const services = extractStructuredServices({
      url: 'https://maps.example.gov/viewer',
      networkUrls: ['https://maps.example.gov/geoserver/ows?service=WFS&version=1.1.0&request=GetFeature&typeNames=parcels'],
    });
    expect(services.some((s) => s.kind === 'wfs')).toBe(true);
  });
});

describe('the platform capability registry separates designed from demonstrated support', () => {
  it('reports every scored family with no demonstrated capability until a live run proves one', () => {
    const rows = buildPlatformCapabilityReport([]);
    expect(rows).toHaveLength(SCORED_PLATFORM_FAMILIES.length);
    expect(rows.every((row) => row.demonstrated === null)).toBe(true);
  });

  it('attaches proof to the family it was proven on and to no other', () => {
    const rows = buildPlatformCapabilityReport([{
      family: 'arcgis',
      detection: true, parcelSearch: true, apnSearch: true, addressSearch: false, ownerSearch: false,
      geometry: true, zoningLayerDiscovery: true, directServiceRoute: true,
      provenOnHost: 'gis.example-county.gov', provenAt: '2026-01-01T00:00:00.000Z', runs: 1, successes: 1,
    }]);
    expect(rows.find((r) => r.family === 'arcgis')?.demonstrated?.geometry).toBe(true);
    expect(rows.find((r) => r.family === 'tyler')?.demonstrated).toBeNull();
  });

  it('never claims a family supports geometry it cannot deliver', () => {
    // Assessment portals serve attribute pages; parcel polygons live in the
    // county GIS. Claiming otherwise would fabricate a boundary.
    expect(PLATFORM_FAMILY_PROFILES.schneider_beacon_qpublic.capabilities.geometry).toBe('not_supported');
    expect(PLATFORM_FAMILY_PROFILES.tyler.capabilities.geometry).toBe('not_supported');
    expect(PLATFORM_FAMILY_PROFILES.arcgis.capabilities.geometry).toBe('supported');
  });
});
