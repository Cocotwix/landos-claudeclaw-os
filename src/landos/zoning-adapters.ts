// Reusable zoning platform adapters with jurisdiction-specific configuration.
// One adapter per PLATFORM (ArcGIS boundary layer, ArcGIS zoning layer,
// official ordinance document), never one workflow per county or city; a new
// jurisdiction is a configuration entry, not new adapter code.

import { findCountyGis, queryLayerByPolygon } from './county-gis-capabilities.js';
import type { Rings } from './parcel-spatial.js';
import { countPdfPages, extractPdfText, pdfTextIncludes } from './pdf-text.js';
import { platformKey, rememberPlatform } from './platform-library.js';
import type { PropertyIdentityVersion } from './property-summary-slice.js';
import {
  buildJurisdictionClaims,
  determineJurisdiction,
  type AuthorityZoningConfig,
  type BoundaryFinding,
} from './zoning-jurisdiction.js';
import type {
  ZoningClaimInput,
  ZoningCollectorAdapter,
  ZoningCollectorInput,
} from './zoning-operator.js';
import type { NormalizedZoningClaim, OrdinanceCitation, ZoningDomain } from './zoning-types.js';

/**
 * US Census TIGERweb official national boundary layers (current vintage).
 * These give every jurisdiction a free official incorporated-place and
 * county-subdivision determination even before a county-specific boundary
 * layer is configured.
 */
export const NATIONAL_BOUNDARY_SOURCES = {
  incorporatedPlaces: {
    name: 'US Census TIGERweb Incorporated Places (current)',
    url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4',
  },
  countySubdivisions: {
    name: 'US Census TIGERweb County Subdivisions (current)',
    url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/1',
  },
} as const;

export interface OfficialZoningSource {
  jurisdiction: string;
  authority: string;
  authorityLevel: NormalizedZoningClaim['authorityLevel'];
  url: string;
  sourceType: 'boundary' | 'zoning_gis' | 'ordinance' | 'planning_page';
  platformHint?: string | null;
  configuration?: Record<string, unknown>;
}

export interface ZoningAdapterDefinition {
  key: string;
  platform: string;
  supports(source: OfficialZoningSource): boolean;
  create(source: OfficialZoningSource): ZoningCollectorAdapter;
}

export interface ResolvedZoningCollector {
  jurisdiction: string;
  source: OfficialZoningSource;
  platform: string;
  adapterKey: string;
  resolution: 'known_adapter' | 'adaptive_browser_fallback';
  adapter: ZoningCollectorAdapter;
}

const SOURCE_PRIORITY: Record<ZoningDomain, OfficialZoningSource['sourceType'][]> = {
  jurisdiction_authority: ['boundary', 'planning_page'],
  zoning_district: ['zoning_gis', 'planning_page'],
  zoning_ordinance: ['ordinance', 'planning_page'],
  permitted_uses: ['ordinance', 'planning_page'],
  dimensional_standards: ['ordinance', 'planning_page'],
};

export class ZoningAdapterRegistry {
  private readonly definitions: ZoningAdapterDefinition[] = [];

  register(definition: ZoningAdapterDefinition): this {
    if (this.definitions.some((candidate) => candidate.key === definition.key)) {
      throw new Error(`Zoning adapter "${definition.key}" is already registered.`);
    }
    this.definitions.push(definition);
    return this;
  }

  resolve(input: {
    identity: PropertyIdentityVersion;
    domain: ZoningDomain;
    officialSources: OfficialZoningSource[];
    makeAdaptiveFallback(source: OfficialZoningSource): ZoningCollectorAdapter;
  }): ResolvedZoningCollector {
    if (input.identity.status !== 'confirmed') throw new Error('Confirmed property identity is required before zoning source resolution.');
    const priorities = SOURCE_PRIORITY[input.domain];
    const source = [...input.officialSources]
      .filter((candidate) => candidate.jurisdiction.trim())
      .sort((left, right) => priorities.indexOf(left.sourceType) - priorities.indexOf(right.sourceType))
      .find((candidate) => priorities.includes(candidate.sourceType));
    if (!source) throw new Error(`No applicable official source is configured for ${input.domain}.`);
    const known = this.definitions.find((definition) => definition.supports(source));
    if (known) {
      return {
        jurisdiction: source.jurisdiction,
        source,
        platform: known.platform,
        adapterKey: known.key,
        resolution: 'known_adapter',
        adapter: known.create(source),
      };
    }
    const adaptive = input.makeAdaptiveFallback(source);
    return {
      jurisdiction: source.jurisdiction,
      source,
      platform: adaptive.platform || platformKey(source.url),
      adapterKey: adaptive.key,
      resolution: 'adaptive_browser_fallback',
      adapter: adaptive,
    };
  }
}

/**
 * Jurisdiction-specific zoning configuration. A new county/city/township is a
 * new entry here (plus, when available, county GIS registry layers) — never a
 * new workflow.
 */
export interface ZoningJurisdictionConfig {
  label: string;
  state: string;
  match(county: string | undefined, state: string | undefined): boolean;
  /** Who administers zoning for the units around this jurisdiction, when verified. */
  authorityConfigs: AuthorityZoningConfig[];
  /** Extra official boundary layers beyond the national defaults (ETJ, MTAS, city limits). */
  extraBoundarySources?: Array<{
    kind: BoundaryFinding['kind'];
    name: string;
    url: string;
    nameField: string;
  }>;
  /** Official zoning polygon layer with its attribute field names. */
  zoningGis?: {
    sourceName: string;
    layerUrl: string;
    codeField: string;
    nameField?: string;
    mapViewerUrl?: string;
    overlayLayers?: Array<{ name: string; url: string; nameField: string; kindLabel?: string }>;
  };
  /** Official ordinance / land development code documents. */
  ordinance?: {
    title: string;
    adoptedOrEffectiveDate?: string | null;
    sourceName: string;
    documents: Array<{
      key: string;
      url: string;
      documentType: string;
      displayName: string;
      mimeType?: string;
      section?: string | null;
    }>;
    /**
     * Jurisdiction-specific deterministic extraction of use permissions and
     * dimensional standards from the retrieved document text for a given
     * district. Extraction is configuration, retrieval is the reusable adapter.
     */
    extract?(input: { documentKey: string; text: string; districtCode: string | null }): {
      useClaims?: Array<Pick<ZoningClaimInput, 'claimKey' | 'exactWording' | 'normalizedValue' | 'useName' | 'useCategory' | 'districtCode'> & { citation?: OrdinanceCitation | null; artifactPage?: number | null }>;
      dimensionalClaims?: Array<Pick<ZoningClaimInput, 'claimKey' | 'exactWording' | 'normalizedValue' | 'standardName' | 'districtCode'> & { citation?: OrdinanceCitation | null; artifactPage?: number | null }>;
      ordinanceEvidence?: { exactWording: string; effectiveDate?: string | null };
    };
  };
}

const CITRUS_LD = 'https://maps.citrusbocc.com/server/rest/services/PublicData/LandDevelopment/MapServer';
const CITRUS_LDC_TITLE = 'Citrus County Land Development Code, Chapter Two — Land Use Districts (OA-2024-00002)';

/**
 * Verified transcription of the Citrus County LDC Section 2403 CLR district
 * use table and the Chapter 2 dimensional provisions. Every entry is emitted
 * as a claim ONLY when its anchor phrase is found in the text of the retrieved
 * official document, so a changed ordinance silently drops (never invents)
 * provisions.
 */
const CITRUS_CLR_USES: Array<{ useName: string; anchor: string; category: 'permitted_by_right' | 'conditional_or_special' }> = [
  { useName: 'Single Family', anchor: 'Single Family', category: 'permitted_by_right' },
  { useName: 'Accessory Structure (must have principal residential structure in place)', anchor: 'Accessory Structure', category: 'permitted_by_right' },
  { useName: 'Passive Recreation', anchor: 'Passive Recreation', category: 'permitted_by_right' },
  { useName: 'Golf Course', anchor: 'Golf Course', category: 'permitted_by_right' },
  { useName: 'Fishing Docks/Piers', anchor: 'Fishing Docks/Piers', category: 'permitted_by_right' },
  { useName: 'Playgrounds', anchor: 'Playgrounds', category: 'permitted_by_right' },
  { useName: 'Emergency Service Facilities', anchor: 'Emergency Service Facilities', category: 'permitted_by_right' },
  { useName: 'Utility Facilities', anchor: 'Utility Facilities', category: 'permitted_by_right' },
  { useName: 'Wellfields (less than or equal to 100,000 gpd)', anchor: 'Wellfields', category: 'permitted_by_right' },
  { useName: 'Group Home', anchor: 'Group Home', category: 'conditional_or_special' },
  { useName: 'Educational Facilities (excluding public schools)', anchor: 'Educational Facilities', category: 'conditional_or_special' },
  { useName: 'Day Care Centers', anchor: 'Day Care Centers', category: 'conditional_or_special' },
  { useName: 'Houses of Worship', anchor: 'Houses of Worship', category: 'conditional_or_special' },
  { useName: 'Nursing Homes', anchor: 'Nursing Homes', category: 'conditional_or_special' },
  { useName: 'Halfway Houses', anchor: 'Halfway Houses', category: 'conditional_or_special' },
  { useName: 'Assisted Living Facilities', anchor: 'Assisted Living Facilities', category: 'conditional_or_special' },
  { useName: 'Communications/Transmission Towers (limitations apply)', anchor: 'Communications/Transmission Towers', category: 'conditional_or_special' },
  { useName: 'Government Facility', anchor: 'Government Facility', category: 'conditional_or_special' },
  { useName: 'Wellfields (greater than 100,000 gpd, BCC approval)', anchor: 'Wellfields (Greater than 100,000', category: 'conditional_or_special' },
];

const CITRUS_DIMENSIONAL: Array<{ standardName: string; value: string; anchor: string; section: string }> = [
  { standardName: 'Maximum lot coverage', value: '40% (lots of record under 10,000 sq ft: 50%; lots 10,000 sq ft to 1 acre may add 10% ISR for non-vertical improvements)', anchor: 'Maximum Lot Coverage', section: 'Sec. 2403 Area Requirements' },
  { standardName: 'Floor area ratio (non-residential uses only)', value: '0.2', anchor: 'Floor Area Ratio', section: 'Sec. 2403 Area Requirements' },
  { standardName: 'Density / further subdivision', value: 'Density limited to the maximum in the final development order for the underlying subdivision plat; the parcel cannot be further subdivided', anchor: 'cannot be further subdivided', section: 'Sec. 2403' },
  { standardName: 'Minimum lot area (no central water and sewer)', value: '0.5 acre per unit (OSTDS/septic with individual wells or central water)', anchor: '0.5 acre per unit', section: 'Sec. 2200.B.4' },
  { standardName: 'Minimum lot width (no central water and sewer)', value: '100 feet for residential new lots (150 feet nonresidential)', anchor: 'minimum 100 feet for residential', section: 'Sec. 2200.C' },
  { standardName: 'Minimum lot width on a street', value: 'At least 40 feet on a street', anchor: 'at least 40 feet on a street', section: 'Sec. 2200.D' },
  { standardName: 'Building setback from right-of-way centerline (local street)', value: '50 feet from centerline of a local street (higher classes: 65–125 feet)', anchor: 'Local Street (public or private) 50 feet', section: 'Sec. 2300.A' },
  { standardName: 'Principal-use setback from right-of-way line', value: '25 feet from any existing right-of-way line (administrative reduction to 20 feet possible on 60-foot local streets)', anchor: '25 feet from any existing right-of-way line', section: 'Sec. 2300.A.1' },
  { standardName: 'Side and rear setbacks', value: 'No minimum for sides not abutting a right-of-way, surface water, wetlands, or springs; under 5 feet requires a maintenance easement', anchor: 'no minimum setbacks required for side and rear yards', section: 'Sec. 2300.A.3' },
  { standardName: 'Water / wetland setback', value: '35 feet minimum from mean high-water, ordinary high water, or jurisdictional wetland line (reduced options per Sec. 2300.E)', anchor: 'minimum of 35 feet', section: 'Sec. 2300.E' },
];

export const ZONING_JURISDICTION_CONFIGS: ZoningJurisdictionConfig[] = [
  {
    label: 'Citrus County',
    state: 'FL',
    match: (county, state) => {
      const normalized = String(state ?? '').trim().toUpperCase();
      return (normalized === 'FL' || normalized === 'FLORIDA') && /citrus/i.test(county ?? '');
    },
    authorityConfigs: [
      { authorityName: 'Citrus County', level: 'county', administersZoning: 'yes', note: 'Citrus County Land Development Code governs unincorporated Citrus County' },
      { authorityName: 'Inverness', level: 'municipality', administersZoning: 'yes', note: 'City of Inverness administers its own zoning' },
      { authorityName: 'Crystal River', level: 'municipality', administersZoning: 'yes', note: 'City of Crystal River administers its own zoning' },
    ],
    extraBoundarySources: [
      { kind: 'municipal_boundary', name: 'Citrus County official Corporate limits layer', url: `${CITRUS_LD}/12`, nameField: 'CORPNAME' },
    ],
    zoningGis: {
      sourceName: 'Citrus County official Land Development zoning layer',
      layerUrl: `${CITRUS_LD}/9`,
      codeField: 'HANSEN__PRCLZON_ZONING',
      nameField: 'HANSEN_TBL302_DESCRIPT',
      mapViewerUrl: 'https://gis.citrusbocc.com/map-viewer.html?service=PublicData/GeneralParcel',
      overlayLayers: [
        { name: 'Citrus County Overlay Districts', url: `${CITRUS_LD}/5`, nameField: 'NAME', kindLabel: 'county overlay district' },
      ],
    },
    ordinance: {
      title: CITRUS_LDC_TITLE,
      adoptedOrEffectiveDate: '2024-07-23',
      sourceName: 'Citrus County Growth Management — Land Development Code document center',
      documents: [
        {
          key: 'ldc-chapter-2-land-use-districts',
          url: 'https://cms5.revize.com/revize/citrusfl//document_center/Department/Growth%20Management/LDD/Chapter%202%20-%20Land%20Use%20Districts%202024A12%20rem.pdf',
          documentType: 'official zoning ordinance chapter',
          displayName: 'LDC Chapter Two - Land Use Districts.pdf',
          mimeType: 'application/pdf',
          section: 'Sections 2200, 2300, 2403',
        },
      ],
      extract({ text, districtCode }) {
        if (!text || !pdfTextIncludes(text, 'CHAPTER TWO')) return {};
        const clrPresent = pdfTextIncludes(text, '2403. COASTAL AND LAKES RESIDENTIAL DISTRICT (CLR)');
        const ordinanceEvidence = {
          exactWording: `${CITRUS_LDC_TITLE} retrieved from the county's official document center; Chapter Two text present${clrPresent ? ', including Section 2403 (CLR district)' : ''}.`,
          effectiveDate: '2024-07-23',
        };
        const isClr = Boolean(districtCode && /^CLR/i.test(districtCode));
        if (!isClr || !clrPresent) return { ordinanceEvidence };
        const useClaims = CITRUS_CLR_USES
          .filter((use) => pdfTextIncludes(text, use.anchor))
          .map((use) => ({
            claimKey: `clr_use_${use.useName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`,
            exactWording: `Sec. 2403 CLR district use table: ${use.useName} — ${use.category === 'permitted_by_right' ? 'P (Permitted)' : 'C (Conditional Use)'}.`,
            normalizedValue: { useName: use.useName, category: use.category },
            useName: use.useName,
            useCategory: use.category,
            districtCode,
            citation: { ordinanceTitle: CITRUS_LDC_TITLE, adoptedOrEffectiveDate: '2024-07-23', section: 'Sec. 2403', table: 'CLR District use table' },
          }));
        const dimensionalClaims = CITRUS_DIMENSIONAL
          .filter((standard) => pdfTextIncludes(text, standard.anchor))
          .map((standard) => ({
            claimKey: `clr_std_${standard.standardName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`,
            exactWording: `${standard.standardName}: ${standard.value} (${standard.section}).`,
            normalizedValue: { standardName: standard.standardName, value: standard.value },
            standardName: standard.standardName,
            districtCode,
            citation: { ordinanceTitle: CITRUS_LDC_TITLE, adoptedOrEffectiveDate: '2024-07-23', section: standard.section },
          }));
        return { ordinanceEvidence, useClaims, dimensionalClaims };
      },
    },
  },
];

export function findZoningJurisdictionConfig(
  county: string | undefined,
  state: string | undefined,
): ZoningJurisdictionConfig | null {
  return ZONING_JURISDICTION_CONFIGS.find((config) => config.match(county, state)) ?? null;
}

type ArcFeature = { attributes?: Record<string, unknown>; geometry?: { rings?: Rings } };
type ArcResponse = { features?: ArcFeature[]; error?: { message?: string } };

async function fetchArcJson(url: string, body: URLSearchParams, timeoutMs: number, signal?: AbortSignal): Promise<ArcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, 60_000)));
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Official GIS HTTP ${response.status}.`);
    const parsed = await response.json() as ArcResponse;
    if (parsed.error) throw new Error(parsed.error.message || 'Official GIS layer query failed.');
    return parsed;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function queryArcgisLayerByPoint(
  layerUrl: string,
  point: [number, number],
  outFields: string,
  options: { timeoutMs?: number; signal?: AbortSignal; returnGeometry?: boolean } = {},
): Promise<ArcFeature[]> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: point[0], y: point[1] }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: options.returnGeometry ? 'true' : 'false',
    outSR: '4326',
  });
  const response = await fetchArcJson(`${layerUrl}/query`, params, options.timeoutMs ?? 25_000, options.signal);
  return response.features ?? [];
}

export interface ParcelGeometryInput {
  point?: [number, number] | null;
  rings?: Rings | null;
}

async function queryBoundaryLayer(input: {
  kind: BoundaryFinding['kind'];
  sourceName: string;
  layerUrl: string;
  nameField: string;
  extraFields?: string[];
  geometry: ParcelGeometryInput;
  signal: AbortSignal;
}): Promise<BoundaryFinding[]> {
  const outFields = [input.nameField, ...(input.extraFields ?? [])].join(',');
  const features = input.geometry.rings?.length
    ? await queryLayerByPolygon(input.layerUrl, input.geometry.rings, outFields, { signal: input.signal })
    : input.geometry.point
      ? await queryArcgisLayerByPoint(input.layerUrl, input.geometry.point, outFields, { signal: input.signal })
      : [];
  if (!input.geometry.rings?.length && !input.geometry.point) {
    return [{
      kind: input.kind,
      unitName: null,
      containsParcel: 'unknown',
      queried: false,
      sourceKind: 'official_boundary',
      sourceName: input.sourceName,
      sourceUrl: input.layerUrl,
      exactWording: 'No parcel geometry was available to query this official boundary layer.',
    }];
  }
  if (!features.length) {
    return [{
      kind: input.kind,
      unitName: null,
      containsParcel: 'outside',
      queried: true,
      sourceKind: 'official_boundary',
      sourceName: input.sourceName,
      sourceUrl: input.layerUrl,
      exactWording: `The official ${input.sourceName} layer returned no ${input.kind.replace(/_/g, ' ')} feature containing the parcel geometry.`,
    }];
  }
  return features.map((feature) => {
    const name = String(feature.attributes?.[input.nameField] ?? '').trim() || null;
    const funcstat = feature.attributes?.FUNCSTAT == null ? null : String(feature.attributes.FUNCSTAT);
    return {
      kind: input.kind,
      unitName: name,
      containsParcel: 'inside' as const,
      queried: true,
      sourceKind: 'official_boundary' as const,
      sourceName: input.sourceName,
      sourceUrl: input.layerUrl,
      exactWording: `The parcel geometry intersects the official boundary of ${name ?? 'an unnamed unit'} on the ${input.sourceName} layer${funcstat ? ` (functional status ${funcstat})` : ''}.`,
      functionalStatus: funcstat,
    };
  });
}

/**
 * Reusable jurisdiction-boundary adapter: national TIGERweb layers plus any
 * jurisdiction-configured boundary layers, then the deterministic
 * jurisdiction determination. Never infers authority from the mailing city.
 */
export function createBoundaryAdapter(input: {
  geometry: ParcelGeometryInput;
  config: ZoningJurisdictionConfig | null;
  onDetermination?(determination: ReturnType<typeof determineJurisdiction>): void;
}): ZoningCollectorAdapter {
  return {
    key: 'official-boundary-arcgis',
    platform: 'arcgis_boundary',
    async collect({ identity, sourceJurisdiction, signal }) {
      const retrievedAt = new Date().toISOString();
      const findings: BoundaryFinding[] = [];
      const failures: string[] = [];
      const layers: Array<{ kind: BoundaryFinding['kind']; name: string; url: string; nameField: string }> = [
        { kind: 'incorporated_place', name: NATIONAL_BOUNDARY_SOURCES.incorporatedPlaces.name, url: NATIONAL_BOUNDARY_SOURCES.incorporatedPlaces.url, nameField: 'NAME' },
        { kind: 'county_subdivision', name: NATIONAL_BOUNDARY_SOURCES.countySubdivisions.name, url: NATIONAL_BOUNDARY_SOURCES.countySubdivisions.url, nameField: 'NAME' },
        ...(input.config?.extraBoundarySources ?? []),
      ];
      for (const layer of layers) {
        try {
          findings.push(...await queryBoundaryLayer({
            kind: layer.kind,
            sourceName: layer.name,
            layerUrl: layer.url,
            nameField: layer.nameField,
            extraFields: layer.nameField === 'NAME' ? ['GEOID', 'FUNCSTAT', 'LSADC'] : [],
            geometry: input.geometry,
            signal,
          }));
        } catch (error) {
          failures.push(`${layer.name}: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
          findings.push({
            kind: layer.kind,
            unitName: null,
            containsParcel: 'unknown',
            queried: false,
            sourceKind: 'official_boundary',
            sourceName: layer.name,
            sourceUrl: layer.url,
            exactWording: `${layer.name} could not be queried: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
          });
        }
      }
      const determination = determineJurisdiction({
        parcel: {
          county: identity.county,
          state: identity.state,
          mailingCity: identity.city,
          geometryPresent: Boolean(input.geometry.rings?.length || input.geometry.point),
        },
        findings,
        authorityConfigs: input.config?.authorityConfigs ?? [],
      });
      input.onDetermination?.(determination);
      const claims = buildJurisdictionClaims({ determination, findings, sourceJurisdiction, retrievedAt });
      const queriedAny = findings.some((finding) => finding.queried);
      return {
        status: queriedAny ? (failures.length ? 'partial' : 'succeeded') : 'failed',
        outcomeKind: queriedAny ? 'completed' : 'failed',
        error: failures.length ? `Some official boundary layers failed: ${failures.join(' | ')}`.slice(0, 900) : null,
        claims,
        artifacts: [],
      } satisfies Omit<ZoningCollectorInput, 'identity' | 'domain' | 'platform' | 'adapterKey' | 'sourceJurisdiction'>;
    },
  };
}

/**
 * Reusable official zoning-map adapter over an ArcGIS zoning polygon layer.
 * The layer URL and attribute field names are jurisdiction configuration.
 */
export function createArcgisZoningAdapter(input: {
  geometry: ParcelGeometryInput;
  config: NonNullable<ZoningJurisdictionConfig['zoningGis']>;
  authorityName: string | null;
  authorityLevel: NormalizedZoningClaim['authorityLevel'];
  onDistricts?(codes: string[]): void;
}): ZoningCollectorAdapter {
  return {
    key: 'official-zoning-arcgis',
    platform: 'arcgis_zoning',
    async collect({ sourceJurisdiction, signal }) {
      const retrievedAt = new Date().toISOString();
      const claims: ZoningClaimInput[] = [];
      const outFields = [input.config.codeField, input.config.nameField].filter(Boolean).join(',') || '*';
      const features = input.geometry.rings?.length
        ? await queryLayerByPolygon(input.config.layerUrl, input.geometry.rings, outFields, { signal })
        : input.geometry.point
          ? await queryArcgisLayerByPoint(input.config.layerUrl, input.geometry.point, outFields, { signal })
          : [];
      if (!input.geometry.rings?.length && !input.geometry.point) {
        return {
          status: 'blocked',
          outcomeKind: 'blocked',
          error: 'No parcel geometry is available for the official zoning-map query.',
          claims: [],
          artifacts: [],
        };
      }
      const districts = new Map<string, { code: string; name: string | null }>();
      for (const feature of features) {
        const code = String(feature.attributes?.[input.config.codeField] ?? '').trim();
        if (!code) continue;
        const name = input.config.nameField
          ? String(feature.attributes?.[input.config.nameField] ?? '').trim() || null
          : null;
        districts.set(code, { code, name });
      }
      input.onDistricts?.([...districts.keys()]);
      for (const district of districts.values()) {
        claims.push({
          claimKey: `official_zoning_district_${district.code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          exactWording: `Official zoning layer result: district ${district.code}${district.name ? ` (${district.name})` : ''} intersects the parcel geometry.`,
          normalizedValue: { districtCode: district.code, districtName: district.name },
          domain: 'zoning_district',
          locatorStatus: 'record_located',
          sourceKind: 'official_gis',
          authorityLevel: input.authorityLevel,
          authorityName: input.authorityName,
          sourceName: input.config.sourceName,
          sourceUrl: input.config.mapViewerUrl ?? input.config.layerUrl,
          sourceJurisdiction,
          sourceTier: 'official_county_state',
          confidence: 'high',
          retrievedAt,
          districtCode: district.code,
          districtName: district.name,
          disputeGroup: districts.size > 1 ? 'multiple_official_districts_intersect_parcel' : null,
        });
      }
      if (!districts.size) {
        claims.push({
          claimKey: 'official_zoning_district_none',
          exactWording: 'The official zoning layer returned no district polygon intersecting the parcel geometry; the parcel may be in a different zoning jurisdiction or the layer may not cover it.',
          normalizedValue: null,
          domain: 'zoning_district',
          locatorStatus: 'no_matching_record_found',
          sourceKind: 'official_gis',
          authorityLevel: input.authorityLevel,
          authorityName: input.authorityName,
          sourceName: input.config.sourceName,
          sourceUrl: input.config.mapViewerUrl ?? input.config.layerUrl,
          sourceJurisdiction,
          sourceTier: 'official_county_state',
          confidence: 'medium',
          retrievedAt,
        });
      }
      for (const overlay of input.config.overlayLayers ?? []) {
        try {
          const overlayFeatures = input.geometry.rings?.length
            ? await queryLayerByPolygon(overlay.url, input.geometry.rings, overlay.nameField, { signal })
            : await queryArcgisLayerByPoint(overlay.url, input.geometry.point!, overlay.nameField, { signal });
          for (const feature of overlayFeatures) {
            const name = String(feature.attributes?.[overlay.nameField] ?? '').trim() || overlay.name;
            claims.push({
              claimKey: `official_overlay_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
              exactWording: `Official overlay layer "${overlay.name}" intersects the parcel: ${name}.`,
              normalizedValue: { overlayName: name, overlayKind: overlay.kindLabel ?? overlay.name },
              domain: 'zoning_district',
              locatorStatus: 'record_located',
              sourceKind: 'official_gis',
              authorityLevel: input.authorityLevel,
              authorityName: input.authorityName,
              sourceName: input.config.sourceName,
              sourceUrl: overlay.url,
              sourceJurisdiction,
              sourceTier: 'official_county_state',
              confidence: 'high',
              retrievedAt,
              overlayName: name,
            });
          }
        } catch (error) {
          claims.push({
            claimKey: `official_overlay_query_failed_${overlay.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            exactWording: `Official overlay layer "${overlay.name}" could not be queried: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
            normalizedValue: null,
            domain: 'zoning_district',
            locatorStatus: 'official_source_unavailable',
            sourceKind: 'official_gis',
            authorityLevel: input.authorityLevel,
            authorityName: input.authorityName,
            sourceName: overlay.name,
            sourceUrl: overlay.url,
            sourceJurisdiction,
            sourceTier: 'official_county_state',
            confidence: 'unknown',
            retrievedAt,
          });
        }
      }
      const located = claims.some((claim) => claim.locatorStatus === 'record_located');
      const failedOverlay = claims.some((claim) => claim.locatorStatus === 'official_source_unavailable');
      return {
        status: located ? (failedOverlay ? 'partial' : 'succeeded') : 'partial',
        outcomeKind: 'completed',
        error: failedOverlay ? 'One or more official overlay layers were unavailable.' : null,
        claims,
        artifacts: [],
      };
    },
  };
}

/**
 * Reusable official ordinance retrieval adapter: fetches the configured
 * official ordinance documents, retains their bytes as hashed artifacts, and
 * applies the jurisdiction-configured deterministic extraction for the
 * confirmed district. Free sources only — payment and access-control bypass
 * are never attempted.
 */
export function createOrdinanceDocumentAdapter(input: {
  config: NonNullable<ZoningJurisdictionConfig['ordinance']>;
  districtCode: string | null;
  authorityName: string | null;
  authorityLevel: NormalizedZoningClaim['authorityLevel'];
  emitDomains: ZoningDomain[];
  fetchText?(url: string, signal: AbortSignal): Promise<{ text: string; bytes: Buffer; mimeType: string }>;
}): ZoningCollectorAdapter {
  const fetchText = input.fetchText ?? (async (url: string, signal: AbortSignal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error(`Official ordinance source HTTP ${response.status}.`);
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = /pdf/i.test(mimeType) || bytes.subarray(0, 5).toString('latin1') === '%PDF-'
        ? extractPdfText(bytes)
        : /text|html|json|xml/i.test(mimeType) ? bytes.toString('utf8') : '';
      return { text, bytes, mimeType };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  });
  return {
    key: 'official-ordinance-document',
    platform: 'official_ordinance',
    async collect({ domain, sourceJurisdiction, signal }) {
      const retrievedAt = new Date().toISOString();
      const claims: ZoningClaimInput[] = [];
      const artifacts: ZoningCollectorInput['artifacts'] = [];
      const failures: string[] = [];
      let retrievedAny = false;
      for (const document of input.config.documents) {
        try {
          const fetched = await fetchText(document.url, signal);
          retrievedAny = true;
          const artifactKey = `ordinance:${document.key}`;
          // Retain the document bytes once, under the ordinance domain; the
          // use/dimensional claims cite the same official source + sections.
          if (domain === 'zoning_ordinance') artifacts.push({
            artifactKey,
            domain,
            sourceJurisdiction,
            authorityName: input.authorityName,
            sourceName: input.config.sourceName,
            sourceUrl: document.url,
            portalReference: document.key,
            ordinanceTitle: input.config.title,
            ordinanceEffectiveDate: input.config.adoptedOrEffectiveDate ?? null,
            sectionReference: document.section ?? null,
            districtReference: input.districtCode,
            documentType: document.documentType,
            mimeType: document.mimeType ?? fetched.mimeType,
            displayName: document.displayName,
            retrievedAt,
            bytes: fetched.bytes,
            pageCount: countPdfPages(fetched.bytes) ?? undefined,
          });
          const extraction = input.config.extract?.({
            documentKey: document.key,
            text: fetched.text,
            districtCode: input.districtCode,
          });
          if (domain === 'zoning_ordinance') {
            claims.push({
              claimKey: `ordinance_document_${document.key}`,
              exactWording: extraction?.ordinanceEvidence?.exactWording
                ?? `${input.config.title} — ${document.displayName} retrieved from the official source.`,
              normalizedValue: {
                ordinanceTitle: input.config.title,
                documentKey: document.key,
                effectiveDate: extraction?.ordinanceEvidence?.effectiveDate ?? input.config.adoptedOrEffectiveDate ?? null,
              },
              domain,
              locatorStatus: 'record_located',
              sourceKind: 'official_ordinance',
              authorityLevel: input.authorityLevel,
              authorityName: input.authorityName,
              sourceName: input.config.sourceName,
              sourceUrl: document.url,
              sourceJurisdiction,
              sourceTier: 'official_county_state',
              confidence: 'high',
              retrievedAt,
              effectiveAt: extraction?.ordinanceEvidence?.effectiveDate ?? input.config.adoptedOrEffectiveDate ?? null,
              citation: {
                ordinanceTitle: input.config.title,
                adoptedOrEffectiveDate: extraction?.ordinanceEvidence?.effectiveDate ?? input.config.adoptedOrEffectiveDate ?? null,
                section: document.section ?? null,
              },
              artifactKey,
            });
          }
          if (domain === 'permitted_uses') {
            for (const use of extraction?.useClaims ?? []) {
              claims.push({
                ...use,
                domain,
                locatorStatus: 'record_located',
                sourceKind: 'official_ordinance',
                authorityLevel: input.authorityLevel,
                authorityName: input.authorityName,
                sourceName: input.config.sourceName,
                sourceUrl: document.url,
                sourceJurisdiction,
                sourceTier: 'official_county_state',
                confidence: 'high',
                retrievedAt,
                citation: use.citation ?? {
                  ordinanceTitle: input.config.title,
                  adoptedOrEffectiveDate: input.config.adoptedOrEffectiveDate ?? null,
                  section: document.section ?? null,
                },
              });
            }
          }
          if (domain === 'dimensional_standards') {
            for (const standard of extraction?.dimensionalClaims ?? []) {
              claims.push({
                ...standard,
                domain,
                locatorStatus: 'record_located',
                sourceKind: 'official_ordinance',
                authorityLevel: input.authorityLevel,
                authorityName: input.authorityName,
                sourceName: input.config.sourceName,
                sourceUrl: document.url,
                sourceJurisdiction,
                sourceTier: 'official_county_state',
                confidence: 'high',
                retrievedAt,
                citation: standard.citation ?? {
                  ordinanceTitle: input.config.title,
                  adoptedOrEffectiveDate: input.config.adoptedOrEffectiveDate ?? null,
                  section: document.section ?? null,
                },
              });
            }
          }
        } catch (error) {
          failures.push(`${document.displayName}: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
        }
      }
      if (!retrievedAny) {
        claims.push({
          claimKey: `${domain}_ordinance_unavailable`,
          exactWording: `The official ordinance source "${input.config.sourceName}" could not be retrieved: ${failures.join(' | ').slice(0, 500) || 'no documents configured'}.`,
          normalizedValue: { ordinanceTitle: input.config.title },
          domain,
          locatorStatus: 'official_source_unavailable',
          sourceKind: 'official_ordinance',
          authorityLevel: input.authorityLevel,
          authorityName: input.authorityName,
          sourceName: input.config.sourceName,
          sourceUrl: input.config.documents[0]?.url ?? null,
          sourceJurisdiction,
          sourceTier: 'official_county_state',
          confidence: 'unknown',
          retrievedAt,
          citation: { ordinanceTitle: input.config.title },
        });
      }
      const status = retrievedAny
        ? (failures.length ? 'partial' : claims.length ? 'succeeded' : 'partial')
        : 'blocked';
      return {
        status,
        outcomeKind: retrievedAny ? 'completed' : 'blocked',
        error: failures.length ? `Some ordinance documents failed: ${failures.join(' | ')}`.slice(0, 900) : null,
        claims,
        artifacts,
      };
    },
  };
}

/** Resolve the county-GIS zoning layer for a jurisdiction when no explicit
 * zoningGis config exists but the county GIS registry publishes one. */
export function zoningGisFromCountyRegistry(
  county: string | undefined,
  state: string | undefined,
): { layerUrl: string; overlays: Array<{ name: string; url: string }> } | null {
  const capability = findCountyGis(county, state);
  if (!capability?.layers.zoning) return null;
  return {
    layerUrl: capability.layers.zoning,
    overlays: capability.layers.zoningOverlays ?? [],
  };
}

/**
 * Records only the value-free navigation pattern after a successful official
 * zoning retrieval so the platform library can reuse it. Property values,
 * credentials, cookies, and document bytes never enter the library.
 */
export function rememberSuccessfulZoningNavigation(input: {
  sourceUrl: string;
  domain: ZoningDomain;
  adapterKey: string;
  navigationPattern: string;
  authRequired: boolean;
}): void {
  rememberPlatform(input.sourceUrl, {
    classification: 'government_zoning_source',
    navPatterns: `${input.domain}:${input.adapterKey}:${input.navigationPattern}`,
    authRequired: input.authRequired,
    confidence: 'high',
    used: true,
    succeeded: true,
    validatedNow: true,
    knownLimitations: [],
    taskBoundary: {
      allowed: ['public zoning map lookup', 'free official ordinance retrieval', 'official boundary lookup'],
      restricted: ['free account registration under managed government-account policy'],
      forbidden: ['payment', 'access-control bypass', 'CAPTCHA bypass'],
    },
  });
}
