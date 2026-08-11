// LandOS — Government GIS PLATFORM FAMILY registry (PART 1, PART 13, PART 14).
//
// Reusable platform knowledge, keyed by FAMILY. A county is a deployment; it
// never gets an entry here and never gets adapter code. When LandOS meets an
// unfamiliar county site the win is recognising which family it belongs to, so
// an adapter that already works applies immediately.
//
// The profiles below record what a family is DESIGNED to support. What LandOS
// has actually PROVEN on a live deployment is recorded separately, per family,
// in `gis-platform-knowledge.ts`. The capability report merges the two and
// labels them apart, so the registry can never quietly claim support that was
// never demonstrated.

import type {
  GisAdapterId,
  GisDetectionConfidence,
  GisPlatformFamily,
  GisSearchMethod,
} from './gis-platform-types.js';

export const CAPABILITY_LEVELS = ['supported', 'partial', 'deployment_dependent', 'not_supported'] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export interface PlatformCapabilityMatrix {
  detection: CapabilityLevel;
  parcelSearch: CapabilityLevel;
  apnSearch: CapabilityLevel;
  addressSearch: CapabilityLevel;
  ownerSearch: CapabilityLevel;
  geometry: CapabilityLevel;
  zoningLayerDiscovery: CapabilityLevel;
  directServiceRoute: 'preferred' | 'available' | 'unavailable';
  browserFallback: 'available' | 'unavailable';
}

/** Pattern bundle a detector scores a probe against. All regexes are case-insensitive. */
export interface PlatformSignalPatterns {
  hostnames: RegExp[];
  paths: RegExp[];
  scripts: RegExp[];
  htmlMarkers: RegExp[];
  metadata: RegExp[];
  /** Keys that appear in the page's embedded JS/JSON application configuration. */
  configKeys: string[];
  /** URLs the page fetches that reveal the underlying data platform. */
  serviceUrls: RegExp[];
  /** Text a vendor stamps on the page. Weakest signal; never sufficient alone. */
  branding: RegExp[];
}

export interface PlatformVariantProfile {
  variant: string;
  description: string;
  patterns: Partial<PlatformSignalPatterns>;
}

export interface PlatformFamilyProfile {
  family: GisPlatformFamily;
  vendor: string;
  /** What the family actually is, in one operator-readable sentence. */
  summary: string;
  patterns: PlatformSignalPatterns;
  variants: PlatformVariantProfile[];
  searchMethods: GisSearchMethod[];
  /** Descriptive only. Never used to validate or reject a real county APN. */
  parcelIdShapes: string[];
  geometryAvailability: CapabilityLevel;
  zoningLayerAvailability: CapabilityLevel;
  /** Whether querying the backing service directly is normally possible. */
  directServiceQuery: 'preferred' | 'available' | 'unavailable';
  authNormallyRequired: boolean;
  /** How much a deployment of this family differs from its siblings. */
  deploymentVariance: 'low' | 'moderate' | 'high';
  capabilities: PlatformCapabilityMatrix;
  adapter: GisAdapterId;
  knownFailureModes: string[];
  /** Confidence that a single reusable adapter is justified for the family. */
  adapterJustification: GisDetectionConfidence;
  justificationReason: string;
}

/* ────────────────────────────── profiles ─────────────────────────────── */

const ARCGIS: PlatformFamilyProfile = {
  family: 'arcgis',
  vendor: 'Esri',
  summary:
    'The Esri stack. Powers a large share of U.S. county parcel and zoning maps, very often behind county-branded frontends that look bespoke.',
  patterns: {
    hostnames: [
      /(^|\.)arcgis\.com$/i,
      /(^|\.)arcgisonline\.com$/i,
      /(^|\.)arcgis\.app$/i,
      /^services\d*\./i,
      /^tiles\d*\./i,
      /^gisservices?\./i,
    ],
    paths: [
      // The server context is NOT fixed. `/arcgis`, `/server`, `/mapping`,
      // `/hosting` and bespoke contexts are all real; only `/rest/services`
      // is invariant, so that is what the detector keys on.
      /\/rest\/services(\/|\?|$)/i,
      /\/rest\/info(\?|$)/i,
      /\/rest\/services\/.+\/(MapServer|FeatureServer|ImageServer|GeocodeServer|GeometryServer|VectorTileServer)/i,
      /\/apps\/(webappviewer|instant|mapviewer|View|Embed|dashboards|experiencebuilder|opsdashboard)/i,
      /\/experience\/[0-9a-f]{20,}/i,
      /\/home\/webmap\/viewer\.html/i,
      /\/sharing\/rest\/content\/items\//i,
    ],
    scripts: [
      /js\.arcgis\.com/i,
      /\/jsapi\/(esri|arcgis)/i,
      /arcgis[-_]?js[-_]?api/i,
      /\/dojo\/dojo\.js/i,
      /webappbuilder/i,
      /experience-builder|exb-/i,
      /@arcgis\/core/i,
    ],
    htmlMarkers: [
      /esri-view|esri-widget|esri-ui/i,
      /id=["']?(esri_)?map(Div)?["']?/i,
      /jimu-/i,
      /calcite-/i,
    ],
    metadata: [/ArcGIS (Online|Enterprise|Experience|Web AppBuilder|Instant Apps)/i],
    configKeys: ['operationalLayers', 'baseMap', 'itemId', 'webmap', 'appItemId', 'portalUrl', 'exbVersion', 'dataSources'],
    serviceUrls: [
      /\/rest\/services\/.+\/(MapServer|FeatureServer|ImageServer)(\/|\?|$)/i,
      /\/sharing\/rest\/content\/items\/[0-9a-f]{20,}/i,
      /\/rest\/info(\?|$)/i,
    ],
    branding: [/Powered by (Esri|ArcGIS)/i, /\bEsri\b/i],
  },
  variants: [
    {
      variant: 'experience_builder',
      description: 'ArcGIS Experience Builder app; the app item config lists dataSources pointing at feature services.',
      patterns: {
        paths: [/\/experience\/[0-9a-f]{20,}/i, /experiencebuilder/i],
        scripts: [/exb-|experience-builder/i],
        configKeys: ['exbVersion', 'dataSources', 'widgets'],
      },
    },
    {
      variant: 'web_appbuilder',
      description: 'ArcGIS Web AppBuilder or a legacy configurable app; config.json names the web map and operational layers.',
      patterns: {
        paths: [/\/apps\/webappviewer\/index\.html/i, /\/webappbuilder\//i],
        scripts: [/webappbuilder|jimu/i],
        htmlMarkers: [/jimu-/i],
        configKeys: ['configJson', 'appId', 'itemId'],
      },
    },
    {
      variant: 'instant_app',
      description: 'ArcGIS Instant App / Map Viewer; the web map item id is on the URL.',
      patterns: { paths: [/\/apps\/instant\//i, /\/apps\/mapviewer\//i, /\/home\/webmap\/viewer\.html/i] },
    },
    {
      variant: 'arcgis_online',
      description: 'Hosted on ArcGIS Online (arcgis.com); items and layers are reachable through the public sharing API.',
      patterns: { hostnames: [/(^|\.)arcgis\.com$/i] },
    },
    {
      variant: 'arcgis_enterprise',
      description: 'Self-hosted ArcGIS Enterprise or ArcGIS Server; a REST services directory is normally browsable.',
      patterns: { paths: [/\/(arcgis|server)\/rest\/services/i, /\/portal\/sharing\/rest/i] },
    },
    {
      variant: 'rest_service',
      description: 'A bare ArcGIS REST endpoint with no app around it. The fastest possible route.',
      patterns: { paths: [/\/rest\/services\/.+\/(MapServer|FeatureServer|ImageServer)/i] },
    },
  ],
  searchMethods: ['apn', 'address', 'owner', 'coordinate'],
  parcelIdShapes: [
    'County-defined. ArcGIS imposes no format; the field holding it varies by deployment.',
    'A printed APN frequently does not match the stored value verbatim (leading zeros, run-of-spaces padding, a trailing roll year), so exact match alone is not a valid test.',
  ],
  geometryAvailability: 'supported',
  zoningLayerAvailability: 'deployment_dependent',
  directServiceQuery: 'preferred',
  authNormallyRequired: false,
  deploymentVariance: 'moderate',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'supported',
    apnSearch: 'supported',
    addressSearch: 'supported',
    ownerSearch: 'supported',
    geometry: 'supported',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'preferred',
    browserFallback: 'available',
  },
  adapter: 'arcgis',
  knownFailureModes: [
    'Layer requires a token; the service answers HTTP 200 with an error body of code 499 (token required) or 498 (invalid token), so the HTTP status must not be trusted.',
    'The services root answers 404 because the server context is not /arcgis; individual services under the real context stay reachable.',
    'The REST services directory is disabled while individual services stay reachable.',
    'Layer capabilities omit Query, so only Map rendering is possible and identify/find is the only attribute route.',
    'maxRecordCount silently truncates a broad query; only exceededTransferLimit reveals it.',
    'Geometry is returned in the layer spatial reference (commonly Web Mercator or State Plane) unless outSR=4326 is requested.',
    'A long polygon or objectIds query exceeds a host URL length limit and must be sent as POST.',
    'A services directory answers HTML instead of JSON when f=json is stripped by a proxy or a WAF interstitial intervenes.',
    'An exact match on the printed APN silently returns zero features because the stored key is formatted differently.',
  ],
  adapterJustification: 'high',
  justificationReason:
    'Esri is the single most common technical substrate for U.S. county parcel and zoning GIS, the REST contract is uniform across deployments, and one adapter therefore generalises across counties with no per-county code.',
};

const GEOCORTEX: PlatformFamilyProfile = {
  family: 'geocortex',
  vendor: 'VertiGIS',
  summary:
    'A VertiGIS/Geocortex viewer. Detecting it matters mainly so LandOS looks THROUGH it: the data underneath is ArcGIS and should be queried directly.',
  patterns: {
    hostnames: [/geocortex/i, /vertigis/i],
    paths: [/\/geocortex\//i, /\/essentials\//i, /\/vertigisstudio\//i, /\/Html5Viewer\//i],
    scripts: [/geocortex|vertigis/i],
    htmlMarkers: [/gcx-|geocortex/i],
    metadata: [/Geocortex|VertiGIS/i],
    configKeys: ['viewerConfig', 'essentialsUrl', 'geocortex'],
    serviceUrls: [/\/geocortex\/essentials\/.+\/REST\//i],
    branding: [/Geocortex|VertiGIS/i],
  },
  variants: [
    { variant: 'essentials', description: 'Geocortex Essentials viewer.', patterns: { paths: [/\/essentials\//i] } },
    { variant: 'vertigis_studio', description: 'VertiGIS Studio Web.', patterns: { paths: [/\/vertigisstudio\//i] } },
  ],
  searchMethods: ['apn', 'address', 'coordinate'],
  parcelIdShapes: ['County-defined; inherited from the underlying ArcGIS layer.'],
  geometryAvailability: 'supported',
  zoningLayerAvailability: 'deployment_dependent',
  directServiceQuery: 'preferred',
  authNormallyRequired: false,
  deploymentVariance: 'moderate',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'supported',
    apnSearch: 'supported',
    addressSearch: 'supported',
    ownerSearch: 'deployment_dependent',
    geometry: 'supported',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'preferred',
    browserFallback: 'available',
  },
  // Deliberately routed to the ArcGIS adapter: the frontend is a detection
  // fact, the data path is Esri. Building a second adapter would duplicate it.
  adapter: 'arcgis',
  knownFailureModes: [
    'The viewer config is fetched from an Essentials REST site that itself needs discovery.',
    'The map appears bespoke while all real data lives in ordinary ArcGIS services.',
  ],
  adapterJustification: 'medium',
  justificationReason:
    'Prevalent enough to be worth recognising, but it is a frontend over Esri services, so recognition plus reuse of the ArcGIS adapter is the correct and cheaper answer.',
};

const SCHNEIDER: PlatformFamilyProfile = {
  family: 'schneider_beacon_qpublic',
  vendor: 'Schneider Geospatial',
  summary:
    'Beacon and qPublic. Very widely deployed for county assessor/parcel search, especially across the Southeast and Midwest. HTML-only with a stable URL grammar.',
  patterns: {
    hostnames: [/(^|\.)schneidercorp\.com$/i, /(^|\.)qpublic\.net$/i],
    paths: [/\/Application\.aspx/i, /\/api\/globalsearch\//i],
    scripts: [/\/cdn\/[0-9a-f]{6,}\/js\/(core|libs)\.min\.js/i, /schneidercorp|qpublic/i],
    // The report template is identical across deployments; these class names
    // are the stable extraction contract even where field labels differ.
    htmlMarkers: [/tabular-data-two-column/i, /\bvalue-column\b/i, /\bmodule-(header|content)\b/i, /SearchIntent\s*=/i],
    metadata: [/qPublic|Beacon/i],
    // Every rendered page embeds this object; it carries the tab manifest, the
    // search-capability flags and a templated parcel deep link.
    configKeys: ['mapConfig', 'DefaultReportUrl', 'AppId', 'LayerId', 'PageTypeId'],
    serviceUrls: [/\/api\/globalsearch\/framework/i, /(qpublic|beacon)\.schneidercorp\.com/i],
    branding: [/Schneider Geospatial/i, /qPublic/i, /\bBeacon\b/i],
  },
  variants: [
    {
      variant: 'qpublic',
      description: 'qPublic hostname. AppID + LayerID identify the jurisdiction; PageTypeID selects map/search/results/report.',
      patterns: { hostnames: [/qpublic/i] },
    },
    {
      variant: 'beacon',
      description: 'Beacon hostname. The same multi-tenant application as qPublic, reachable by the same grammar.',
      patterns: { hostnames: [/beacon\./i] },
    },
  ],
  searchMethods: ['apn', 'address', 'owner'],
  parcelIdShapes: [
    'County-defined and highly variable, passed verbatim through the KeyValue parameter.',
    'The application publishes its own KeyValue deep-link template, so the shape never has to be guessed.',
  ],
  geometryAvailability: 'not_supported',
  zoningLayerAvailability: 'deployment_dependent',
  // The vendor publishes a nationwide deployment directory as JSON. That is a
  // genuine structured route, even though the transport must be a browser.
  directServiceQuery: 'available',
  authNormallyRequired: false,
  deploymentVariance: 'moderate',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'supported',
    apnSearch: 'supported',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    // Schneider serves attribute pages over its own tile stack, not Esri.
    // Parcel polygons live in the county's separate GIS, so geometry is out of
    // scope for this family and the parcel lane falls back to that GIS.
    geometry: 'not_supported',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'available',
    browserFallback: 'available',
  },
  adapter: 'schneider_beacon_qpublic',
  knownFailureModes: [
    'Bot protection rejects a server-side fetch on TLS/header fingerprint, not on user agent, so a browser-class transport is mandatory even with correct headers.',
    'A challenge widget is preloaded on every page and can fire under request volume, so the lane must stay low-rate.',
    'Which search modes a deployment offers varies; some publish no parcel-id search at all.',
    'Report section names and field labels are driven by state law and the local CAMA vendor, so a fixed field map would be wrong.',
    'Page identifiers are per-deployment integers and must be resolved from the published directory rather than assumed.',
  ],
  adapterJustification: 'high',
  justificationReason:
    'One vendor-operated multi-tenant application with one URL grammar, a public directory enumerating every deployment with its search page, and a per-page config object that publishes the parcel deep-link template. Recognition, jurisdiction resolution and parcel retrieval all generalise with no per-county code.',
};

const TYLER: PlatformFamilyProfile = {
  family: 'tyler',
  vendor: 'Tyler Technologies',
  summary:
    'Tyler iasWorld Public Access, the assessment/parcel search product. The application chrome is uniform nationwide; the configuration on top of it is local.',
  patterns: {
    // Deliberately NOT a bare "tyler" host match. Several unrelated Texas
    // appraisal-district sites carry "tyler" in the hostname and run entirely
    // different software, and matching them would be a false classification.
    hostnames: [/(^|\.)tylerhost\.net$/i],
    paths: [
      /\/search\/commonsearch\.aspx/i,
      /\/Datalets?\/Datalet\.aspx/i,
      /\/Search\/Disclaimer\.aspx/i,
      /\/PublicAccess\/search\//i,
    ],
    scripts: [/\/Script\/ParidControl\.js/i, /\/Search\/Script\/Search\.js/i, /\/script\/(soap|xapi)\.js/i],
    // The datalet cell classes are the actual extraction contract.
    htmlMarkers: [/DataletSideHeading/i, /DataletData/i, /datalet_header_row/i, /tr class="SearchResults"/i, /var search_Params/i],
    metadata: [/iasWorld/i],
    configKeys: [],
    serviceUrls: [/tylerhost\.net\/(PublicAccess|iasworld)/i],
    branding: [/Powered by iasWorld Public Access/i, /iasWorld/i],
  },
  variants: [
    {
      variant: 'iasworld_public_access',
      description: 'iasWorld Public Access. Search runs through commonsearch.aspx; records render from Datalet.aspx.',
      patterns: { paths: [/commonsearch\.aspx/i, /Datalet\.aspx/i], htmlMarkers: [/DataletSideHeading/i] },
    },
  ],
  searchMethods: ['apn', 'address', 'owner'],
  parcelIdShapes: [
    'County-defined. Record pages are frequently keyed on a session-scoped result index rather than the printed parcel number.',
  ],
  geometryAvailability: 'not_supported',
  zoningLayerAvailability: 'not_supported',
  directServiceQuery: 'unavailable',
  authNormallyRequired: false,
  deploymentVariance: 'high',
  capabilities: {
    detection: 'supported',
    // Honest scoping. Recognition generalises; retrieval does not, because a
    // cold parcel deep link is permitted on some deployments and refused on
    // others, and the record-page vocabulary is local configuration. LandOS
    // records the family and the official URL and routes the parcel lane to
    // the county GIS rather than pretending one scraper fits every site.
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'not_supported',
    zoningLayerDiscovery: 'not_supported',
    directServiceRoute: 'unavailable',
    browserFallback: 'available',
  },
  adapter: 'tyler',
  knownFailureModes: [
    'A cold parcel deep link returns full data on one deployment and an access error on another, so the stateful search path must always remain available.',
    'A disclaimer page must be accepted before search works on many deployments, and the acceptance is session-scoped.',
    'Record pages are keyed on a session result index, so a link cannot be replayed later.',
    'The record-page tab vocabulary is local configuration and must be discovered per site, not assumed.',
    'No structured output of any kind is published; every field is rendered HTML.',
    'No geometry: the site links out to a separate county GIS viewer.',
  ],
  adapterJustification: 'medium',
  justificationReason:
    'The application chrome recurs nationwide, so detection and the official-source record are worth generic code. Full structured extraction is not, because deep-link permission, disclaimer gating and record vocabulary are per-deployment configuration and a single extractor would be a per-county script in disguise.',
};

const VISION: PlatformFamilyProfile = {
  family: 'vision_government_solutions',
  vendor: 'Vision Government Solutions',
  summary: 'Vision assessor databases, concentrated in the Northeast. HTML parcel cards keyed on an internal parcel id.',
  patterns: {
    hostnames: [/(^|\.)vgsi\.com$/i, /(^|\.)visiongov\./i],
    paths: [/\/Parcel\.aspx/i, /\/Search\.aspx/i, /\/Sales\.aspx/i, /\/Streets\.aspx/i],
    scripts: [/vgsi|visiongov/i],
    // Element ids are stable across every deployment and are a far stronger
    // signal than the footer text, which a municipality can restyle.
    htmlMarkers: [/MainContent_lbl(Location|Mblu|GenOwner|Pid|AcctNum)/i, /Vision Government Solutions/i],
    metadata: [/Vision Government Solutions/i],
    configKeys: [],
    serviceUrls: [/vgsi\.com/i],
    branding: [/Vision Government Solutions/i],
  },
  variants: [{ variant: 'vgsi_parcel', description: 'gis.vgsi.com parcel card.', patterns: { paths: [/Parcel\.aspx/i] } }],
  searchMethods: ['apn', 'address', 'owner'],
  parcelIdShapes: ['Vision-internal pid on the URL; the printed map/lot is a separate displayed field.'],
  geometryAvailability: 'not_supported',
  zoningLayerAvailability: 'deployment_dependent',
  directServiceQuery: 'unavailable',
  authNormallyRequired: false,
  deploymentVariance: 'moderate',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'not_supported',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'unavailable',
    browserFallback: 'available',
  },
  adapter: 'vision_government_solutions',
  knownFailureModes: [
    'Parcel pages are keyed on an internal pid, so a printed APN must be resolved through search first.',
    'Some deployments gate search behind a disclaimer.',
  ],
  adapterJustification: 'medium',
  justificationReason:
    'Common in the Northeast with a consistent URL grammar; recognised now, with extraction left to the generic route until a real LandOS lead proves the retrieval path.',
};

const SDG: PlatformFamilyProfile = {
  family: 'sdg_image_mate',
  vendor: 'SDG (Systems Development Group)',
  summary:
    'Image Mate Online, the standard county assessment-record portal across New York State. Assessment records only; parcel polygons come from the county or state GIS.',
  patterns: {
    hostnames: [/(^|\.)sdgnys\.com$/i, /imagemate/i],
    paths: [/\/imate\//i, /ImageMate/i, /\/pt\/imate/i],
    scripts: [/sdgnys|imagemate/i],
    htmlMarkers: [/Image Mate/i, /SDG/i],
    metadata: [/Image Mate/i],
    configKeys: [],
    serviceUrls: [/sdgnys\.com/i],
    branding: [/Image Mate/i, /Systems Development Group/i],
  },
  variants: [{ variant: 'image_mate_online', description: 'Image Mate Online county deployment.', patterns: { paths: [/imate/i] } }],
  searchMethods: ['apn', 'address', 'owner'],
  parcelIdShapes: ['New York SWIS + section-block-lot print key, e.g. "055689 10.00-1-64.22".'],
  geometryAvailability: 'not_supported',
  zoningLayerAvailability: 'not_supported',
  directServiceQuery: 'unavailable',
  authNormallyRequired: false,
  deploymentVariance: 'moderate',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'not_supported',
    zoningLayerDiscovery: 'not_supported',
    directServiceRoute: 'unavailable',
    browserFallback: 'available',
  },
  adapter: 'sdg_image_mate',
  knownFailureModes: [
    'Assessment roll data only; no geometry and no zoning layer.',
    'Some counties require a subscription for full record detail.',
  ],
  adapterJustification: 'medium',
  justificationReason:
    'Near-universal in New York State, so recognition prevents wasted effort and correctly redirects the parcel lane to the county or statewide ArcGIS service that does carry geometry.',
};

const MAPGEO: PlatformFamilyProfile = {
  family: 'mapgeo',
  vendor: 'MapGeo (Applied Geographics / Sanborn)',
  summary:
    'A municipal parcel viewer with a first-party public JSON API that returns parcel polygons, values and zoning in one call. Unusual among vendor portals in publishing structured data rather than only HTML.',
  patterns: {
    hostnames: [/(^|\.)mapgeo\.io$/i],
    paths: [/\/api\/(communities|datasets|config|ui)\//i, /\/datasets\/[a-z]+\//i],
    scripts: [/mapgeo-map-bootstrap/i, /matomo\.appgeo\.com/i],
    htmlMarkers: [/ember-load-indicator/i, /window\.community\s*=/i],
    metadata: [/MapGeo/i],
    configKeys: ['community', 'datasets', 'defaultDataset', 'geometryMapping'],
    serviceUrls: [/\/api\/(datasets|config|ui)\//i, /matomo\.appgeo\.com/i],
    branding: [/MapGeo/i, /Applied Geographics/i, /Sanborn/i],
  },
  variants: [{ variant: 'mapgeo_community', description: 'A per-community MapGeo deployment with a public dataset API.', patterns: { hostnames: [/mapgeo\.io$/i] } }],
  searchMethods: ['apn', 'address', 'owner'],
  parcelIdShapes: ['Municipality-defined; used directly as the dataset record id.'],
  geometryAvailability: 'supported',
  zoningLayerAvailability: 'supported',
  directServiceQuery: 'preferred',
  authNormallyRequired: false,
  deploymentVariance: 'low',
  capabilities: {
    detection: 'supported',
    // Detection is generic and cheap. Retrieval is left to the generic route
    // until a real LandOS lead sits in a MapGeo jurisdiction: building a full
    // adapter for a region LandOS has no property in would be speculative, and
    // the sprint's own rule is not to build adapters on assumption.
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'deployment_dependent',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'available',
    browserFallback: 'available',
  },
  adapter: 'generic_fallback',
  knownFailureModes: [
    'A catch-all route serves the application shell for unmatched API paths, so blind probing looks like a wall when the API is in fact open.',
    'Concentrated in the Northeast, so most jurisdictions will not be on it.',
  ],
  adapterJustification: 'medium',
  justificationReason:
    'The API is uniform across deployments and returns geometry and zoning together, which would make a dedicated adapter cheap and valuable. It is recognised now and deferred rather than built, because no real LandOS property currently sits in its region and an unexercised adapter would be an unproven claim.',
};

const STATEWIDE: PlatformFamilyProfile = {
  family: 'statewide_gis_program',
  vendor: 'State GIS program office',
  summary:
    'A state-operated official parcel or boundary service. Usually Esri REST underneath, but distinguished because it is a state authority covering many counties at once.',
  patterns: {
    // Deliberately narrow. A bare `.gov` host is not evidence of a statewide
    // program, and a loose pattern here would swallow every county site.
    hostnames: [/^gisservices?[-.]/i, /\.its\.[a-z]{2}\.(gov|us)$/i, /\.state\.[a-z]{2}\.us$/i],
    paths: [/\/rest\/services\/[^/]*(state|statewide|ny[s_]|nys|_public)/i],
    scripts: [],
    htmlMarkers: [],
    metadata: [],
    configKeys: [],
    serviceUrls: [/\/rest\/services\/.*(parcel|cadastr)/i],
    branding: [],
  },
  variants: [
    {
      variant: 'statewide_parcel_service',
      description: 'A statewide tax-parcel feature/map service published by the state GIS office.',
      patterns: { serviceUrls: [/(tax_?parcels|parcels_public|cadastral)/i] },
    },
  ],
  searchMethods: ['apn', 'address', 'owner', 'coordinate'],
  parcelIdShapes: ['State-normalized parcel key, often county code plus the county print key.'],
  geometryAvailability: 'supported',
  zoningLayerAvailability: 'not_supported',
  directServiceQuery: 'preferred',
  authNormallyRequired: false,
  deploymentVariance: 'low',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'supported',
    apnSearch: 'supported',
    addressSearch: 'supported',
    ownerSearch: 'supported',
    geometry: 'supported',
    // States publish parcels; zoning is a local power and is not in statewide services.
    zoningLayerDiscovery: 'not_supported',
    directServiceRoute: 'preferred',
    browserFallback: 'available',
  },
  adapter: 'arcgis',
  knownFailureModes: [
    'Coverage is partial: a state may only publish parcels for counties that granted permission.',
    'The roll year lags the county by a season, so acreage and owner can be stale.',
  ],
  adapterJustification: 'high',
  justificationReason:
    'A statewide official service covers many counties from one endpoint, which is the highest-leverage possible fallback when a county publishes nothing usable.',
};

const OGC: PlatformFamilyProfile = {
  family: 'ogc_open_geo',
  vendor: 'Open geospatial stack',
  summary: 'WMS / WFS / GeoServer / MapServer / vector tiles fronting official data. Structured, standards-based, and queryable.',
  patterns: {
    hostnames: [],
    paths: [/\/geoserver\//i, /\/mapserv/i, /\/ows(\?|$)/i, /\/wms(\?|$)/i, /\/wfs(\?|$)/i],
    scripts: [/openlayers|leaflet|maplibre|mapbox-gl/i],
    htmlMarkers: [/ol-viewport|leaflet-container|maplibregl/i],
    metadata: [],
    configKeys: ['tilejson', 'sources', 'layers'],
    serviceUrls: [/service=(WMS|WFS)/i, /\/geoserver\//i, /\.geojson(\?|$)/i, /tilejson/i, /\/\{z\}\/\{x\}\/\{y\}/i],
    branding: [/GeoServer|MapServer|OpenLayers/i],
  },
  variants: [
    { variant: 'wfs', description: 'WFS GetFeature is available, so attributes and geometry can be requested directly.', patterns: { serviceUrls: [/service=WFS/i] } },
    { variant: 'wms', description: 'WMS only; GetFeatureInfo may answer attributes but geometry is not guaranteed.', patterns: { serviceUrls: [/service=WMS/i] } },
    { variant: 'vector_tiles', description: 'Vector tile source with a TileJSON descriptor.', patterns: { serviceUrls: [/tilejson|\/\{z\}\/\{x\}\/\{y\}/i] } },
  ],
  searchMethods: ['apn', 'address', 'coordinate'],
  parcelIdShapes: ['Publisher-defined.'],
  geometryAvailability: 'deployment_dependent',
  zoningLayerAvailability: 'deployment_dependent',
  directServiceQuery: 'available',
  authNormallyRequired: false,
  deploymentVariance: 'high',
  capabilities: {
    detection: 'supported',
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'deployment_dependent',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'available',
    browserFallback: 'available',
  },
  adapter: 'generic_fallback',
  knownFailureModes: [
    'WMS alone exposes imagery, not attributes.',
    'A WFS may cap feature counts or refuse CQL filters.',
  ],
  adapterJustification: 'low',
  justificationReason:
    'Too heterogeneous for a dedicated adapter, but the standards are uniform enough that the generic fallback can recognise and use them.',
};

const CUSTOM: PlatformFamilyProfile = {
  family: 'custom_government_portal',
  vendor: 'Jurisdiction-built',
  summary: 'A recognisably official government site with no recurring vendor product behind it.',
  patterns: {
    hostnames: [/\.gov$/i, /\.us$/i, /(county|parish|borough|township|city)/i],
    paths: [/(assessor|appraiser|parcel|property|gis|planning|zoning|tax)/i],
    scripts: [],
    htmlMarkers: [],
    metadata: [],
    configKeys: [],
    serviceUrls: [],
    branding: [],
  },
  variants: [],
  searchMethods: ['address', 'apn'],
  parcelIdShapes: ['Jurisdiction-defined.'],
  geometryAvailability: 'deployment_dependent',
  zoningLayerAvailability: 'deployment_dependent',
  directServiceQuery: 'available',
  authNormallyRequired: false,
  deploymentVariance: 'high',
  capabilities: {
    detection: 'partial',
    parcelSearch: 'deployment_dependent',
    apnSearch: 'deployment_dependent',
    addressSearch: 'deployment_dependent',
    ownerSearch: 'deployment_dependent',
    geometry: 'deployment_dependent',
    zoningLayerDiscovery: 'deployment_dependent',
    directServiceRoute: 'available',
    browserFallback: 'available',
  },
  adapter: 'generic_fallback',
  knownFailureModes: ['By definition it has no shared architecture; only the generic fallback applies.'],
  adapterJustification: 'low',
  justificationReason:
    'Not a family in the technical sense. It exists so an official site is never mislabeled as an unknown third-party one, and so the generic fallback still runs.',
};

const UNKNOWN: PlatformFamilyProfile = {
  family: 'unknown',
  vendor: 'Unidentified',
  summary: 'No family reached the evidence bar.',
  patterns: { hostnames: [], paths: [], scripts: [], htmlMarkers: [], metadata: [], configKeys: [], serviceUrls: [], branding: [] },
  variants: [],
  searchMethods: [],
  parcelIdShapes: [],
  geometryAvailability: 'not_supported',
  zoningLayerAvailability: 'not_supported',
  directServiceQuery: 'unavailable',
  authNormallyRequired: false,
  deploymentVariance: 'high',
  capabilities: {
    detection: 'not_supported',
    parcelSearch: 'not_supported',
    apnSearch: 'not_supported',
    addressSearch: 'not_supported',
    ownerSearch: 'not_supported',
    geometry: 'not_supported',
    zoningLayerDiscovery: 'not_supported',
    directServiceRoute: 'unavailable',
    browserFallback: 'available',
  },
  adapter: 'generic_fallback',
  knownFailureModes: [],
  adapterJustification: 'none',
  justificationReason: 'Placeholder so an unrecognised site is stated as unknown rather than guessed into a family.',
};

export const PLATFORM_FAMILY_PROFILES: Record<GisPlatformFamily, PlatformFamilyProfile> = {
  arcgis: ARCGIS,
  geocortex: GEOCORTEX,
  schneider_beacon_qpublic: SCHNEIDER,
  tyler: TYLER,
  vision_government_solutions: VISION,
  sdg_image_mate: SDG,
  mapgeo: MAPGEO,
  statewide_gis_program: STATEWIDE,
  ogc_open_geo: OGC,
  custom_government_portal: CUSTOM,
  unknown: UNKNOWN,
};

/**
 * Families the detector scores, most specific first. `custom_government_portal`
 * and `unknown` are terminal and are never scored as positive matches; a site
 * falls into them only when nothing else clears the bar.
 */
export const SCORED_PLATFORM_FAMILIES: readonly GisPlatformFamily[] = [
  'schneider_beacon_qpublic',
  'tyler',
  'vision_government_solutions',
  'sdg_image_mate',
  'mapgeo',
  'geocortex',
  'arcgis',
  'statewide_gis_program',
  'ogc_open_geo',
];

export function platformProfile(family: GisPlatformFamily): PlatformFamilyProfile {
  return PLATFORM_FAMILY_PROFILES[family];
}

export function adapterForFamily(family: GisPlatformFamily): GisAdapterId {
  return PLATFORM_FAMILY_PROFILES[family].adapter;
}

/* ───────────────────── PART 14 capability registry ───────────────────── */

/** What a live run actually proved for a family. Supplied by the knowledge store. */
export interface DemonstratedCapability {
  family: GisPlatformFamily;
  detection: boolean;
  parcelSearch: boolean;
  apnSearch: boolean;
  addressSearch: boolean;
  ownerSearch: boolean;
  geometry: boolean;
  zoningLayerDiscovery: boolean;
  directServiceRoute: boolean;
  /** Deployment host the proof came from. Never a property value. */
  provenOnHost: string | null;
  provenAt: string | null;
  runs: number;
  successes: number;
}

export interface PlatformCapabilityReportRow {
  family: GisPlatformFamily;
  vendor: string;
  adapter: GisAdapterId;
  /** What the adapter is built to do. */
  designed: PlatformCapabilityMatrix;
  /** What a real run has proven. Absent until a live run proves something. */
  demonstrated: DemonstratedCapability | null;
  deploymentVariance: PlatformFamilyProfile['deploymentVariance'];
  adapterJustification: GisDetectionConfidence;
  justificationReason: string;
  knownFailureModes: string[];
}

/**
 * PART 14 — the registry answer. `designed` and `demonstrated` stay separate on
 * purpose: a claim of support is only credible where a live deployment proved
 * it, and the operator must be able to see which is which.
 */
export function buildPlatformCapabilityReport(
  demonstrated: readonly DemonstratedCapability[] = [],
): PlatformCapabilityReportRow[] {
  const byFamily = new Map(demonstrated.map((d) => [d.family, d]));
  return SCORED_PLATFORM_FAMILIES.map((family) => {
    const profile = PLATFORM_FAMILY_PROFILES[family];
    return {
      family,
      vendor: profile.vendor,
      adapter: profile.adapter,
      designed: profile.capabilities,
      demonstrated: byFamily.get(family) ?? null,
      deploymentVariance: profile.deploymentVariance,
      adapterJustification: profile.adapterJustification,
      justificationReason: profile.justificationReason,
      knownFailureModes: profile.knownFailureModes,
    };
  });
}
