// Real, bounded, keyless government-property adapters.
//
// Where a county GIS capability exists (county-gis-capabilities.ts) the
// adapters compute exact geodesic overlap acreage with the county's own
// geometry service; otherwise they fall back to authoritative federal
// services with dense local grid estimates. Every finding stays screening
// tier and carries its limitation.

import type { ParsedIntakeFields } from './intake-router.js';
import type { PropertyPatch } from './normalized-property.js';
import type {
  AdjoiningRoad,
  PublicEvidence,
  PublicIntelligenceAdapter,
  PublicIntelligenceAdapterResult,
  PublicIntelligenceSubject,
  SoilComponent,
  UtilityAvailability,
} from './public-property-intelligence.js';
import { SCREENING_DISCLAIMERS, slopeBandFor, SLOPE_BANDS } from './public-property-intelligence.js';
import { findCountyGis, computeExactOverlaps, queryLayerByPolygon, queryLayerByEnvelope, type CountyGisCapability } from './county-gis-capabilities.js';
import { interiorGrid, measureFrontage, overlapLocationDescription, ringsAreaAcres, type Rings, type LonLat } from './parcel-spatial.js';
import { addressVariantsCompatible } from './instruction-consistency.js';

type Pos = [number, number];
type ArcFeature = { attributes?: Record<string, unknown>; geometry?: { rings?: Rings; paths?: Pos[][] } };
type Arc = { features?: ArcFeature[]; error?: { message?: string } };

const TN = 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0';
const BFT = 'https://gis.beaufortcountysc.gov/server/rest/services/ArchiveParcels/MapServer/14';
const FAYETTE_PARCELS = 'https://gis.fayettecountyga.gov/arcgis/rest/services/Pictometry/parcelsRO/MapServer/0';
// Florida DEP's statewide public view of the county property-appraiser parcel
// submissions.  This is an official state-hosted geometry/identity source. The
// current public view is labelled Cadastral 2023, so ownership is retained as a
// dated county-record fact and must not silently replace a newer accepted owner.
const FL_DOR_PARCELS = 'https://ca.dep.state.fl.us/arcgis/rest/services/Map_Direct/Boundaries/MapServer/16';
// SCDOT's statewide public mirror of county parcel layers (one sublayer per SC
// county). Official state-hosted GIS; schemas vary by county, so field mapping
// is capability-probed per layer (see scdotParcel). A mirror can lag the county
// assessor — the provider label says so and the finding keeps screening tier.
const SC_PARCELS = 'https://smpesri.scdot.org/arcgis/rest/services/GISMapping/SC_Parcels/MapServer';
const NWI = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0';
const FEMA_ZONES = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';
const FEMA_PANELS = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/1';
const SDA = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';

export interface OfficialParcel {
  provider: string;
  sourceUrl: string;
  address: string;
  county: string;
  state: string;
  apn: string;
  owner: string | null;
  acres: number | null;
  coordinates: { lat: number; lng: number };
  geometry: { rings: Rings };
  datasetDate: string | null;
  facts: Record<string, string | number | null>;
}
export type OfficialParcelAttemptStatus = 'matched' | 'no_match' | 'unavailable';
export interface OfficialParcelAttempt {
  source: string;
  status: OfficialParcelAttemptStatus;
  note: string;
}
export interface OfficialParcelLookupResult {
  parcel: OfficialParcel | null;
  /**
   * Overall outcome of the whole lookup:
   *   matched      — one strategy produced an exact parcel;
   *   no_match     — every applicable strategy completed successfully and none
   *                  matched (an authoritative "this parcel is not there");
   *   unavailable  — at least one applicable strategy could not answer
   *                  (provider error/timeout), or no adapter exists at all, so
   *                  absence is NOT established.
   */
  status: OfficialParcelAttemptStatus;
  /** True only when the caller's own signal cancelled the lookup. */
  cancelled?: boolean;
  attempted: OfficialParcelAttempt[];
}

const OFFICIAL_LOOKUP_SOURCE = 'Official public parcel lookup';
const NO_ADAPTER_NOTE = 'No tested public parcel adapter is available for this jurisdiction.';

/** The caller's own AbortSignal fired. Intentional upstream cancellation: it
 *  stops every remaining strategy immediately and is never treated as a
 *  provider failure. */
export class ParcelLookupCancelledError extends Error {
  constructor(message = 'Aborted by the caller.') {
    super(message);
    this.name = 'ParcelLookupCancelledError';
  }
}

/** One provider exceeded its own bounded time budget. Provider-local, so it is
 *  isolated to that strategy and never cancels the remaining ones. */
export class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

/** One independent lookup strategy's own answer. A thrown error is a
 *  provider-local failure; `unavailable` is a strategy that answered but could
 *  not look (no county layer, unusable schema). Both keep the run going. */
interface StrategyOutcome {
  parcel: OfficialParcel | null;
  status: OfficialParcelAttemptStatus;
  note: string;
}
interface ParcelStrategy {
  source: string;
  run: () => Promise<StrategyOutcome>;
}

/**
 * Tested official paths: Fayette County GA, Beaufort County SC public archive,
 * the SCDOT statewide SC mirror, and the TN Comptroller statewide layer.
 *
 * Resilience contract (shared by every jurisdiction — no per-property paths):
 * strategies are independent. A provider-local timeout, an HTTP error, or a
 * valid no-match in one strategy records its own attempt and the run continues
 * into every later applicable strategy. Only the caller's own signal stops the
 * remaining work.
 */
export async function lookupOfficialParcel(
  input: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs = 25_000,
  signal?: AbortSignal,
): Promise<OfficialParcelLookupResult> {
  const attempted: OfficialParcelAttempt[] = [];
  const strategies = applicableParcelStrategies(input, timeoutMs, signal);
  if (!strategies.length) {
    attempted.push({ source: OFFICIAL_LOOKUP_SOURCE, status: 'unavailable', note: NO_ADAPTER_NOTE });
    return { parcel: null, status: 'unavailable', attempted };
  }
  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index];
    if (signal?.aborted) return cancelledLookup(attempted, strategies.length - index);
    try {
      const outcome = await strategy.run();
      attempted.push({ source: strategy.source, status: outcome.status, note: outcome.note });
      if (outcome.status === 'matched' && outcome.parcel) {
        return { parcel: outcome.parcel, status: 'matched', attempted };
      }
      // no_match / unavailable: this strategy cannot speak for the later ones.
    } catch (error) {
      if (isCallerCancellation(error, signal)) return cancelledLookup(attempted, strategies.length - index);
      attempted.push({ source: strategy.source, status: 'unavailable', note: providerFailureNote(error) });
    }
  }
  // Every applicable strategy ran. Absence is only established when they all
  // answered; a single provider failure leaves the question open.
  if (attempted.every((attempt) => attempt.status === 'no_match')) {
    return { parcel: null, status: 'no_match', attempted };
  }
  const failed = attempted.filter((attempt) => attempt.status === 'unavailable').length;
  attempted.push({
    source: OFFICIAL_LOOKUP_SOURCE,
    status: 'unavailable',
    note: `${failed} of ${strategies.length} applicable official parcel adapter(s) could not answer; no adapter matched the parcel, so absence is not established.`,
  });
  return { parcel: null, status: 'unavailable', attempted };
}

function cancelledLookup(attempted: OfficialParcelAttempt[], remaining: number): OfficialParcelLookupResult {
  attempted.push({
    source: OFFICIAL_LOOKUP_SOURCE,
    status: 'unavailable',
    note: `Aborted by the caller; ${remaining} applicable official parcel strateg${remaining === 1 ? 'y was' : 'ies were'} not attempted.`,
  });
  return { parcel: null, status: 'unavailable', cancelled: true, attempted };
}

/** Keep the failure KIND in the operator-visible diagnostic, not just a message. */
function providerFailureNote(error: unknown): string {
  return error instanceof ProviderTimeoutError
    ? `Provider-local timeout: ${safe(error)}`
    : `Provider error: ${safe(error)}`;
}

/** Caller cancellation (stop everything) vs a provider-local failure (isolate). */
function isCallerCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (error instanceof ParcelLookupCancelledError) return true;
  if (error instanceof ProviderTimeoutError) return false;
  return signal?.aborted === true && error instanceof Error && error.name === 'AbortError';
}

/** Every strategy this jurisdiction/identity actually supports, in precedence
 *  order. Building the list up front is what proves whether a later strategy
 *  could still produce a result. */
function applicableParcelStrategies(
  input: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs: number,
  signal?: AbortSignal,
): ParcelStrategy[] {
  const state = stateCode(input.state);
  const strategies: ParcelStrategy[] = [];

  // Strategy 1: Fayette County (GA) official tax-parcel layer, APN identity.
  if (state === 'GA' && /fayette/i.test(input.county ?? '') && input.apn) {
    const acceptedApn = input.apn;
    strategies.push({
      source: 'Fayette County official GIS tax-parcel layer',
      run: async () => {
        for (const where of fayetteWhereCandidates(acceptedApn)) {
          const url = query(FAYETTE_PARCELS, where, true);
          const hits = ((await json<Arc>(url, timeoutMs, signal)).features ?? [])
            .map((feature) => fayette(feature, url, input.address ?? null))
            .filter((value): value is OfficialParcel => !!value)
            .filter((value) => normalizedParcelId(value.apn) === normalizedParcelId(acceptedApn));
          if (hits.length === 1) {
            return { parcel: hits[0], status: 'matched', note: 'Exact APN matched in the county parcel geometry.' };
          }
        }
        return { parcel: null, status: 'no_match', note: 'No unambiguous exact APN match was returned from the county parcel geometry.' };
      },
    });
  }

  // Strategy 2: Beaufort County (SC) public archival layer, APN identity.
  if (state === 'SC' && /beaufort/i.test(input.county ?? '') && input.apn) {
    const apn = input.apn;
    strategies.push({
      source: 'Beaufort County public archival parcel layer (2024)',
      run: async () => {
        const url = query(BFT, `PIN_ = '${sql(apn)}'`, true);
        const feature = (await json<Arc>(url, timeoutMs, signal)).features?.[0];
        const parcel = feature ? beaufort(feature, url) : null;
        return {
          parcel,
          status: parcel ? 'matched' : 'no_match',
          note: parcel ? 'Exact APN matched.' : 'No exact APN matched.',
        };
      },
    });
  }

  // Strategy 3: South Carolina statewide parcel mirror (SCDOT) — one shared
  // adapter for every SC county (never a property- or county-specific patch).
  if (state === 'SC' && input.county && (input.apn || input.address)) {
    strategies.push({
      source: `South Carolina statewide parcel layer (SCDOT GIS mirror) — ${input.county}`,
      run: () => scdotLookup(input, timeoutMs, signal),
    });
  }

  // Strategy 4: Tennessee Comptroller statewide public parcel layer.
  if (state === 'TN' && (input.address || input.apn)) {
    strategies.push({
      source: 'Tennessee Comptroller public parcel layer',
      run: () => tennesseeLookup(input, timeoutMs, signal),
    });
  }

  // Strategy 5: Florida DEP / Department of Revenue statewide parcel view.
  // Require an APN because a street address alone can identify multiple tax
  // parcels. Formatting differs by county/provider, so the candidate query is
  // broad enough to tolerate separators but the accepted result is filtered by
  // the full canonical APN and must be unique.
  if (state === 'FL' && input.county && input.apn) {
    strategies.push({
      source: 'Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)',
      run: () => floridaDorLookup(input, timeoutMs, signal),
    });
  }

  return strategies;
}

function floridaApnTokens(value: string): string[] {
  return value.toUpperCase().split(/[^A-Z0-9]+/).filter((token) => token && !/^0+$/.test(token));
}

function floridaCanonicalApn(value: string): string {
  return floridaApnTokens(value).join('');
}

async function floridaDorLookup(
  input: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const tokens = floridaApnTokens(input.apn!);
  if (!tokens.length) return { parcel: null, status: 'no_match', note: 'The supplied APN contained no usable parcel identifier.' };
  const pattern = tokens.map(sql).join('%');
  const where = `(PARCEL_ID LIKE '${pattern}' OR PARCELNO LIKE '${pattern}' OR STATE_PAR_ID LIKE '${pattern}')`;
  const url = query(FL_DOR_PARCELS, where, true);
  const target = floridaCanonicalApn(input.apn!);
  const candidates = ((await json<Arc>(url, timeoutMs, signal)).features ?? [])
    .map((feature) => floridaDorParcel(feature, url, input.county!))
    .filter((value): value is OfficialParcel => !!value)
    .filter((value) => floridaCanonicalApn(value.apn) === target);
  return {
    parcel: candidates.length === 1 ? candidates[0] : null,
    status: candidates.length === 1 ? 'matched' : 'no_match',
    note: candidates.length === 1
      ? 'Exact normalized APN matched in the official statewide parcel geometry.'
      : candidates.length > 1
        ? 'Multiple official parcels matched the normalized APN; no candidate was substituted.'
        : 'No exact normalized APN matched in the official statewide parcel geometry.',
  };
}

async function tennesseeLookup(
  input: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const county = String(input.county ?? '').replace(/\s+county$/i, '').trim();
  // APN first (strongest identity). The statewide layer stores PARCELID as
  // "CTY MAP   PARCEL INTERVAL YEAR" (county-code prefixed, fixed-width), so
  // exact equality is tried first and then ONE bounded county-filtered LIKE
  // over the map + parcel digit groups. Multiple candidates never substitute.
  if (input.apn) {
    const raw = input.apn.trim();
    const wheres = [...new Set([raw, raw.replace(/-/g, ' ').replace(/\s+/g, ' ')])]
      .map((v) => `(PARCELID = '${sql(v)}' OR PARCEL = '${sql(v)}')`);
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 6) {
      const map = digits.slice(0, 3);
      const parcelDigits = digits.slice(3);
      wheres.push(`PARCELID LIKE '%${sql(map)}%${sql(parcelDigits.padStart(5, '0'))}%'`);
    }
    for (const clause of wheres) {
      const where = `${county ? `COUNTY_NAME = '${sql(county)}' AND ` : ''}${clause}`;
      const url = query(TN, where, true);
      const hits = ((await json<Arc>(url, timeoutMs, signal)).features ?? [])
        .map((feature) => tennessee(feature, url))
        .filter((value): value is OfficialParcel => !!value);
      if (hits.length === 1) {
        return { parcel: hits[0], status: 'matched', note: 'Exact APN/parcel-id matched (county-filtered).' };
      }
    }
  }
  if (!input.address) {
    return { parcel: null, status: 'no_match', note: 'No official parcel matched the APN.' };
  }
  const where = `${county ? `COUNTY_NAME = '${sql(county)}' AND ` : ''}UPPER(ADDRESS) LIKE '%${sql(tnNeedle(input.address))}%'`;
  const url = query(TN, where, true);
  const candidates = ((await json<Arc>(url, timeoutMs, signal)).features ?? [])
    .map((feature) => tennessee(feature, url))
    .filter((value): value is OfficialParcel => !!value);
  const compatible = candidates.filter((candidate) => addressesMateriallyAgree(input.address!, candidate.address));
  // A missing official street-name token is a harmless normalization only
  // when it produces one unambiguous county candidate. Multiple compatible
  // parcel candidates remain unresolved; no nearest/proximity substitution.
  const parcel = compatible.length === 1 ? compatible[0] : null;
  return {
    parcel,
    status: parcel ? 'matched' : 'no_match',
    note: parcel
      ? 'Exact normalized street address matched.'
      : candidates.length
        ? 'Candidate street name materially differed; no candidate was substituted.'
        : 'No official parcel matched.',
  };
}

export function officialParcelPatch(p: OfficialParcel): PropertyPatch {
  return {
    address: p.address,
    normalizedAddress: p.address,
    county: p.county,
    state: p.state,
    apn: p.apn,
    owner: p.owner ?? undefined,
    acres: p.acres ?? undefined,
    coordinates: p.coordinates,
    parcelVerified: true,
    verificationSource: p.provider,
  };
}

export function publicSubjectFromOfficialParcel(p: OfficialParcel, rawInput: string): PublicIntelligenceSubject {
  return {
    rawInput,
    normalizedAddress: p.address,
    county: p.county,
    state: p.state,
    resolvedApn: p.apn,
    resolutionStatus: 'confirmed',
    resolutionExplanation: `Official parcel record matched APN ${p.apn}.`,
    parcelGeometry: p.geometry,
    coordinates: p.coordinates,
    assessedAcres: p.acres ?? undefined,
  };
}

export function makeLivePublicIntelligenceAdapters(p: OfficialParcel): PublicIntelligenceAdapter[] {
  const capability = findCountyGis(p.county, p.state);
  return [
    wetlandsAdapter(p, capability),
    floodAdapter(p, capability),
    soils(p),
    slopeAdapter(p),
    frontageAdapter(p, capability),
    zoningAdapter(p, capability),
    utilitiesAdapter(p, capability),
    imagery(p, capability),
    countyRecords(p, capability),
    marketplace(),
    landPortal(),
  ];
}

function evidence(
  id: string,
  name: string,
  url: string,
  tier: PublicEvidence['sourceTier'],
  supports: string[],
  date?: string,
  confidence: PublicEvidence['confidence'] = 'high',
  limitation?: string,
): PublicEvidence {
  return {
    evidenceId: id,
    sourceName: name,
    sourceUrl: url,
    sourceTier: tier,
    verification: tier === 'official_county_state' ? 'official_record' : 'screening',
    retrievedAt: new Date().toISOString(),
    datasetDate: date,
    confidence,
    supports,
    limitation,
    captureMode: 'live',
  };
}

function unavailable(reason: string): PublicIntelligenceAdapterResult {
  return { status: 'unavailable', evidence: [], confidence: 'none', failureReason: reason, retryEligible: true };
}

/** Plain-English translation of common NWI classification codes. */
export function describeNwiCode(code: string): string {
  const c = code.toUpperCase().trim();
  if (/^E2EM/.test(c)) return 'Estuarine emergent marsh (tidal salt/brackish marsh)';
  if (/^E2SS/.test(c)) return 'Estuarine scrub-shrub wetland (tidal)';
  if (/^E2US/.test(c)) return 'Estuarine intertidal flat/shore (tidal)';
  if (/^E1/.test(c)) return 'Estuarine open water (subtidal)';
  if (/^PEM/.test(c)) return 'Freshwater emergent marsh';
  if (/^PSS/.test(c)) return 'Freshwater scrub-shrub wetland';
  if (/^PFO/.test(c)) return 'Freshwater forested wetland (wooded swamp)';
  if (/^PUB|^PAB/.test(c)) return 'Freshwater pond/open water';
  if (/^R/.test(c)) return 'Riverine (river/stream channel)';
  if (/^L/.test(c)) return 'Lake or reservoir';
  if (/^M/.test(c)) return 'Marine (open coastal water)';
  return 'Mapped wetland';
}

function wetlandsAdapter(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'wetlands',
    adapterId: capability?.layers.wetlands ? 'county_wetlands_exact_overlap_v1' : 'usfws_nwi_grid_overlay_v3',
    timeoutMs: 45_000,
    async run(_subject, context) {
      // Preferred: county NWI layer + county geometry service (exact geodesic acreage).
      if (capability?.layers.wetlands) {
        try {
          const { overlaps, parcelAcresGeodesic } = await computeExactOverlaps(capability, p.geometry.rings, capability.layers.wetlands, '*', { signal: context.signal });
          const parcelAcres = parcelAcresGeodesic ?? ringsAreaAcres(p.geometry.rings);
          const real = overlaps.filter((o) => (o.overlapAcres ?? 0) > 0.005);
          const byClass = new Map<string, { acres: number; pct: number }>();
          for (const o of real) {
            const code = str(o.attributes.HABITAT_89) ?? str(o.attributes.ATTRIBUTE) ?? 'Mapped wetland';
            const label = `${describeNwiCode(code)} [${code}]`;
            const prior = byClass.get(label) ?? { acres: 0, pct: 0 };
            byClass.set(label, { acres: prior.acres + (o.overlapAcres ?? 0), pct: prior.pct + (o.overlapPercent ?? 0) });
          }
          const totalAcres = round([...byClass.values()].reduce((sum, v) => sum + v.acres, 0), 3);
          const totalPct = parcelAcres > 0 ? round(totalAcres / parcelAcres * 100, 1) : null;
          const method = real[0]?.method ?? 'geometry_service_geodesic';
          const featureRings = (await queryLayerByPolygon(capability.layers.wetlands, p.geometry.rings, '*', { returnGeometry: true, signal: context.signal }))
            .map((f) => f.geometry?.rings).filter((r): r is Rings => !!r?.length);
          const location = overlapLocationDescription(p.geometry.rings, featureRings) ?? undefined;
          const evidenceRef = evidence('county-wetlands-overlap', `${capability.countyLabel} NWI wetlands layer + county geometry service`, capability.layers.wetlands, 'official_county_state', ['wetlands', 'exact parcel overlay'], undefined, 'high', SCREENING_DISCLAIMERS.wetlands);
          const summary = !real.length
            ? 'No mapped wetland feature intersects the official parcel polygon.'
            : `Mapped wetlands cover approximately ${totalAcres} ac (${totalPct}% of the ${round(parcelAcres, 2)}-ac mapped parcel)${location ? `, ${location}` : ''}.`;
          return {
            status: 'succeeded', evidence: [evidenceRef], confidence: 'high', retryEligible: false,
            finding: {
              kind: 'wetlands', intersects: real.length > 0,
              areas: [...byClass.entries()].map(([classification, v]) => ({ classification, approximateAcres: round(v.acres, 3), parcelPercentage: round(v.pct, 1) })),
              approximateTotalAcres: real.length ? totalAcres : 0,
              approximateParcelPercentage: real.length ? totalPct : 0,
              overlapState: !real.length ? 'no_feature' : totalPct != null && totalPct < 0.1 ? 'trace_overlap' : 'measurable_overlap',
              calculationMethod: method === 'geometry_service_geodesic' ? 'County geometry service geodesic intersection of official parcel polygon with county NWI features.' : 'Dense local grid estimate over official geometries.',
              geometryConfidence: 'high',
              accessOrDevelopmentEffect: real.length ? `Mapped wetlands${location ? ` ${location}` : ''} reduce apparent usable area; verify whether they cross the access path.` : 'No mapped wetland constraint from this screen.',
              evidenceMapRef: capability.layers.wetlands,
              datasetName: `${capability.countyLabel} NWI wetlands layer`,
              summary,
              whyItMatters: 'Wetlands are a screening constraint for apparent usable area and development feasibility.',
              limitation: SCREENING_DISCLAIMERS.wetlands,
              classification: 'screening',
            },
          };
        } catch {
          // fall through to federal NWI
        }
      }
      const url = spatial(NWI, p.geometry, '*', true);
      const response = await spatialFetch(NWI, p.geometry, '*', true, context.timeoutMs, context.signal);
      if (response.error) return unavailable('USFWS NWI query returned an error.');
      const features = response.features ?? [];
      const overlays = features.map((feature) => feature.geometry?.rings ?? []).filter((rings) => rings.length);
      const parcelAcres = p.acres ?? ringsAreaAcres(p.geometry.rings);
      const pct = overlays.length ? gridPct(p.geometry.rings, overlays) : 0;
      const classes = [...new Set(features.map((feature) => field(feature.attributes, /wetland_type|attribute/i) || 'Mapped wetland'))]
        .map((code) => `${describeNwiCode(code)} [${code}]`);
      const acres = pct != null ? round(parcelAcres * pct / 100, 3) : null;
      const location = overlays.length ? overlapLocationDescription(p.geometry.rings, overlays) ?? undefined : undefined;
      const evidenceRef = evidence('nwi-overlay', 'USFWS National Wetlands Inventory', url, 'authoritative_federal', ['wetlands', 'parcel overlay'], undefined, 'high', SCREENING_DISCLAIMERS.wetlands);
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: acres == null && features.length ? 'medium' : 'high', retryEligible: acres == null && features.length > 0,
        finding: {
          kind: 'wetlands', intersects: features.length > 0,
          areas: acres != null && features.length ? [{ classification: classes.join('; '), approximateAcres: acres, parcelPercentage: pct! }] : [],
          approximateTotalAcres: features.length ? acres : 0,
          approximateParcelPercentage: features.length ? pct : 0,
          overlapState: !features.length ? 'no_feature' : pct != null && pct > 0 ? (pct < 0.1 ? 'trace_overlap' : 'measurable_overlap') : 'area_unavailable',
          calculationMethod: 'Official parcel polygon against NWI features; dense local grid coverage estimate.',
          geometryConfidence: 'medium',
          accessOrDevelopmentEffect: features.length ? `Mapped wetlands${location ? ` ${location}` : ''} may reduce apparent access and development area.` : 'No NWI wetland feature intersects the polygon.',
          evidenceMapRef: url,
          datasetName: 'USFWS National Wetlands Inventory',
          summary: !features.length
            ? 'No NWI wetland feature intersects the official parcel polygon.'
            : acres == null
              ? `Mapped NWI wetland feature (${classes.join('; ')}) intersects the parcel. Reliable affected acreage is not yet available.`
              : `NWI mapped ${classes.join('; ')} across approximately ${acres} ac (${pct}%)${location ? `, ${location}` : ''}.`,
          whyItMatters: 'Wetlands are a screening constraint for apparent usable area and development feasibility.',
          limitation: SCREENING_DISCLAIMERS.wetlands,
          classification: 'screening',
        },
      };
    },
  };
}

function floodAdapter(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'fema_flood',
    adapterId: capability?.layers.floodZones ? 'county_flood_exact_overlap_v1' : 'fema_nfhl_grid_overlay_v2',
    timeoutMs: 45_000,
    async run(_subject, context) {
      let zones: Array<{ zone: string; approximateAcres: number; parcelPercentage: number; specialFloodHazardArea?: boolean }> = [];
      let bfe: string | null = null;
      let sourceUrl = '';
      let sourceName = '';
      let usedCounty = false;
      if (capability?.layers.floodZones) {
        try {
          const { overlaps, parcelAcresGeodesic } = await computeExactOverlaps(capability, p.geometry.rings, capability.layers.floodZones, 'FLD_ZONE,STATIC_BFE,SFHA_TF', { signal: context.signal });
          const parcelAcres = parcelAcresGeodesic ?? ringsAreaAcres(p.geometry.rings);
          const real = overlaps.filter((o) => (o.overlapAcres ?? 0) > 0.005);
          const byZone = new Map<string, { acres: number; sfha: boolean }>();
          const bfes = new Set<number>();
          for (const o of real) {
            const zone = str(o.attributes.FLD_ZONE) ?? 'Unclassified';
            const prior = byZone.get(zone) ?? { acres: 0, sfha: String(o.attributes.SFHA_TF ?? '').toUpperCase().startsWith('T') };
            byZone.set(zone, { ...prior, acres: prior.acres + (o.overlapAcres ?? 0) });
            const staticBfe = num(o.attributes.STATIC_BFE);
            if (staticBfe != null && staticBfe > -999) bfes.add(staticBfe);
          }
          zones = [...byZone.entries()].map(([zone, v]) => ({
            zone,
            approximateAcres: round(v.acres, 3),
            parcelPercentage: parcelAcres > 0 ? round(v.acres / parcelAcres * 100, 1) : 0,
            specialFloodHazardArea: v.sfha,
          }));
          bfe = bfes.size ? `${[...bfes].sort((a, b) => a - b).join('–')} ft (static BFE)` : null;
          sourceUrl = capability.layers.floodZones;
          sourceName = `${capability.countyLabel} flood zone layer (FEMA-derived) + county geometry service`;
          // A county flood layer often maps ONLY the studied floodplain
          // polygons. Zero intersecting features is not proof of "no flood
          // zone" — fall through to the national NFHL (which also maps Zone X).
          usedCounty = real.length > 0;
        } catch {
          // fall through to federal NFHL
        }
      }
      if (!usedCounty) {
        const url = spatial(FEMA_ZONES, p.geometry, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE', true);
        const response = await spatialFetch(FEMA_ZONES, p.geometry, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE', true, context.timeoutMs, context.signal);
        if (response.error) return unavailable('FEMA NFHL query returned an error.');
        const features = response.features ?? [];
        // Overlay area must be sampled against the queried parcel GEOMETRY, not a
        // provider/assessed acreage, so an overlay can never exceed the mapped parcel.
        const parcelAcres = ringsAreaAcres(p.geometry.rings) || p.acres || 0;
        const byZone = new Map<string, { pct: number; sfha: boolean }>();
        for (const feature of features) {
          const zone = field(feature.attributes, /^fld_zone$/i) ?? 'Unclassified';
          const pct = gridPct(p.geometry.rings, [feature.geometry?.rings ?? []]) ?? 0;
          const prior = byZone.get(zone) ?? { pct: 0, sfha: /^(A|AE|AH|AO|AR|V|VE)/i.test(zone) };
          byZone.set(zone, { ...prior, pct: prior.pct + pct });
        }
        zones = [...byZone.entries()].filter(([, v]) => v.pct > 0).map(([zone, v]) => ({
          zone,
          approximateAcres: round(parcelAcres * v.pct / 100, 3),
          parcelPercentage: round(v.pct, 1),
          specialFloodHazardArea: v.sfha,
        }));
        sourceUrl = url;
        sourceName = 'FEMA National Flood Hazard Layer';
      }
      // Best-effort FIRM panel lookup; never blocks the zone result.
      let panel: string | null = null;
      let effectiveDate: string | null = null;
      try {
        const centroid = `${p.coordinates.lng},${p.coordinates.lat}`;
        const params = new URLSearchParams({ f: 'json', geometry: centroid, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FIRM_PAN,EFF_DATE', returnGeometry: 'false' });
        const panels = await json<Arc>(`${FEMA_PANELS}/query?${params}`, 12_000, context.signal);
        const attrs = panels.features?.[0]?.attributes;
        panel = str(attrs?.FIRM_PAN);
        const effMs = num(attrs?.EFF_DATE);
        effectiveDate = effMs ? new Date(effMs).toISOString().slice(0, 10) : null;
      } catch {
        panel = null;
      }
      const sfhaPct = round(zones.filter((z) => z.specialFloodHazardArea).reduce((sum, z) => sum + z.parcelPercentage, 0), 1);
      const evidenceRef = evidence('flood-overlay', sourceName, sourceUrl, usedCounty ? 'official_county_state' : 'authoritative_federal', ['flood', 'parcel overlay'], undefined, 'high', SCREENING_DISCLAIMERS.femaFlood);
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'high', retryEligible: false,
        finding: {
          kind: 'fema_flood', zones, mapStatus: zones.length ? 'mapped' : 'not_mapped', evidenceMapRef: sourceUrl,
          panelNumber: panel, effectiveDate, baseFloodElevation: bfe,
          accessOrDevelopmentEffect: sfhaPct > 0
            ? `About ${sfhaPct}% of the parcel is in the Special Flood Hazard Area${bfe ? ` (base flood elevation ${bfe})` : ''}; development there typically requires elevation and flood insurance.`
            : zones.length ? 'Flood mapping intersects the parcel but no SFHA zone was measured.' : 'No FEMA flood-zone feature intersected the parcel polygon.',
          summary: zones.length
            ? `Flood zones cover the parcel: ${zones.map((z) => `${z.zone} ${z.parcelPercentage}% (${z.approximateAcres} ac)`).join(', ')}${bfe ? `; BFE ${bfe}` : ''}${panel ? `; FIRM panel ${panel}` : ''}.`
            : 'No FEMA flood-zone feature intersected the parcel polygon.',
          whyItMatters: 'Flood mapping can affect access, financing, elevation, and apparent buildable area.',
          limitation: SCREENING_DISCLAIMERS.femaFlood,
          classification: 'screening',
        },
      };
    },
  };
}

function soils(p: OfficialParcel): PublicIntelligenceAdapter {
  return {
    task: 'soils_septic',
    adapterId: 'usda_ssurgo_sda_wkt_v2',
    timeoutMs: 45_000,
    async run(_subject, context) {
      const wkt = polygonWkt(p.geometry.rings[0] ?? []);
      if (!wkt) return unavailable('Official geometry cannot be submitted to USDA Soil Data Access.');
      const maps = await sda(
        `SELECT mu.mukey, mu.musym, mu.muname FROM mapunit mu INNER JOIN SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}') a ON mu.mukey = a.mukey`,
        context.timeoutMs, context.signal,
      );
      const units = maps.slice(1).map((row) => ({ mukey: row[0], symbol: row[1], name: row[2] })).filter((unit) => unit.mukey);
      if (!units.length) return unavailable('USDA Soil Data Access returned no soil map units.');
      const ids = units.map((unit) => `'${sql(unit.mukey)}'`).join(',');
      const rows = await sda(
        `SELECT c.mukey, c.compname, c.comppct_r, c.drainagecl, c.hydgrp, c.slope_l, c.slope_h, ci.interphrc, ci.rulename FROM component c LEFT JOIN cointerp ci ON c.cokey = ci.cokey AND ci.mrulename = 'ENG - Septic Tank Absorption Fields' AND ci.ruledepth = 0 WHERE c.mukey IN (${ids})`,
        context.timeoutMs, context.signal,
      );
      const byUnit = new Map<string, SoilComponent[]>();
      for (const row of rows.slice(1)) {
        const list = byUnit.get(row[0]) ?? [];
        list.push({
          name: row[1] || 'Unnamed component',
          percentage: num(row[2]) ?? undefined,
          septicLimitation: septic(row[7]),
          limitingFactors: row[8] ? [row[8]] : [],
          drainageClass: row[3] || undefined,
          hydrologicSoilGroup: row[4] || undefined,
          slopeRangePct: num(row[5]) != null && num(row[6]) != null ? [num(row[5])!, num(row[6])!] : undefined,
        });
        byUnit.set(row[0], list);
      }
      // Per-unit parcel share via SDA server-side geography intersection (best effort).
      const shares = new Map<string, number>();
      try {
        const areaRows = await sda(
          `SELECT mp.mukey, SUM(mp.mupolygongeo.STIntersection(geography::STGeomFromText('${wkt}', 4326)).STArea()) FROM mupolygon mp WHERE mp.mukey IN (${ids}) GROUP BY mp.mukey`,
          context.timeoutMs, context.signal,
        );
        for (const row of areaRows.slice(1)) {
          const sqm = num(row[1]);
          if (sqm != null && sqm > 0) shares.set(row[0], sqm / 4046.8564224);
        }
      } catch {
        // shares stay empty; unit list is still valid
      }
      const totalShareAcres = [...shares.values()].reduce((sum, acres) => sum + acres, 0);
      const mapUnits = units.map((unit) => {
        const acres = shares.get(unit.mukey);
        return {
          symbol: unit.symbol,
          name: unit.name,
          approximateAcres: acres != null ? round(acres, 3) : undefined,
          parcelPercentage: acres != null && totalShareAcres > 0 ? round(acres / totalShareAcres * 100, 1) : undefined,
          components: byUnit.get(unit.mukey) ?? [],
        };
      });
      const ratings = mapUnits.flatMap((unit) => unit.components.map((component) => component.septicLimitation));
      const worst = ratings.includes('very_limited') ? 'very limited' : ratings.includes('somewhat_limited') ? 'somewhat limited' : ratings.includes('not_limited') ? 'not limited' : 'unknown';
      const bestUnit = mapUnits
        .filter((unit) => unit.components.some((component) => component.septicLimitation !== 'very_limited'))
        .sort((a, b) => (b.parcelPercentage ?? 0) - (a.parcelPercentage ?? 0))[0];
      const evidenceRef = evidence('usda-ssurgo', 'USDA NRCS Soil Data Access / SSURGO', SDA, 'authoritative_federal', ['soil map units', 'septic screen'], undefined, 'high', SCREENING_DISCLAIMERS.soilsSeptic);
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'high', retryEligible: true,
        finding: {
          kind: 'soils_septic',
          mapUnits,
          apparentInvestigationAreas: bestUnit
            ? `Investigate the ${bestUnit.name} area first${bestUnit.parcelPercentage != null ? ` (~${bestUnit.parcelPercentage}% of the parcel)` : ''}; it carries the least published limitation.`
            : 'No low-limitation soil unit was established by this screen; onsite investigation would need to disprove the mapped limitation.',
          datasetName: 'USDA NRCS SSURGO',
          summary: `SSURGO returned ${mapUnits.length} intersecting map unit(s)${mapUnits.some((unit) => unit.parcelPercentage != null) ? ` with parcel shares ${mapUnits.filter((unit) => unit.parcelPercentage != null).map((unit) => `${unit.symbol} ${unit.parcelPercentage}%`).join(', ')}` : ''}; worst reported septic limitation: ${worst}.`,
          whyItMatters: 'Official soil drainage and absorption-field interpretations are screening inputs, not a perc test.',
          limitation: SCREENING_DISCLAIMERS.soilsSeptic,
          classification: 'screening',
        },
      };
    },
  };
}

function slopeAdapter(p: OfficialParcel): PublicIntelligenceAdapter {
  return {
    task: 'slope_topography',
    adapterId: 'usgs_3dep_epqs_parcel_grid_v2',
    timeoutMs: 90_000,
    async run(_subject, context) {
      // Adaptive interior grid: enough density for a real distribution, bounded for EPQS.
      let points: LonLat[] = [];
      for (const n of [9, 12, 16]) {
        points = interiorGrid(p.geometry.rings, n);
        if (points.length >= 24) break;
      }
      if (points.length > 48) {
        const step = points.length / 48;
        points = Array.from({ length: 48 }, (_v, i) => points[Math.floor(i * step)]);
      }
      if (points.length < 4) return unavailable('Official geometry does not yield enough terrain samples.');
      const elevations = await mapLimit(points, 8, async ([lng, lat]) => {
        try {
          const value = num((await json<{ value?: string | number }>(`https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&wkid=4326&includeDate=true`, 15_000, context.signal)).value);
          return value == null ? null : { point: [lng, lat] as Pos, elevation: value };
        } catch {
          return null;
        }
      });
      const use = elevations.filter((v): v is { point: Pos; elevation: number } => !!v);
      if (use.length < 4) return unavailable('USGS 3DEP returned insufficient elevations.');
      // Neighbor-pair slopes across the sampled grid.
      const slopes: number[] = [];
      for (let i = 0; i < use.length; i += 1) {
        for (let j = i + 1; j < use.length; j += 1) {
          const dist = haversineM(use[i].point, use[j].point);
          if (dist >= 15 && dist <= 120) slopes.push(round(Math.abs(use[i].elevation - use[j].elevation) / dist * 100, 1));
        }
      }
      // Bands carry PERCENT OF SAMPLES only. Point samples never produce
      // parcel-wide slope-band acreage (and never from disputed assessed acres).
      const bands = SLOPE_BANDS.map((band) => {
        const pct = slopes.length ? round(slopes.filter((slope) => slopeBandFor(slope) === band).length / slopes.length * 100, 1) : 0;
        return { band, approximateAcres: 0, parcelPercentage: pct };
      });
      const elevationValues = use.map((v) => v.elevation);
      const url = `https://epqs.nationalmap.gov/v1/json?x=${p.coordinates.lng}&y=${p.coordinates.lat}&units=Meters&wkid=4326`;
      const evidenceRef = evidence('usgs-3dep', 'USGS 3DEP Elevation Point Query Service', url, 'authoritative_federal', ['elevation', 'slope'], undefined, 'medium', SCREENING_DISCLAIMERS.slope);
      const spacingM = Math.round(Math.sqrt((ringsAreaAcres(p.geometry.rings) * 4046.86) / Math.max(use.length, 1)));
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'medium', retryEligible: true,
        finding: {
          kind: 'slope_topography',
          minimumElevationFt: round(Math.min(...elevationValues) * 3.28084, 1),
          maximumElevationFt: round(Math.max(...elevationValues) * 3.28084, 1),
          totalReliefFt: round((Math.max(...elevationValues) - Math.min(...elevationValues)) * 3.28084, 1),
          meanSlopePct: avg(slopes),
          medianSlopePct: med(slopes),
          maximumSlopePct: slopes.length ? round(Math.max(...slopes), 1) : null,
          bands,
          largestApparentLowSlopeAreaAcres: undefined,
          elevationResolution: `USGS 3DEP grid sample: ${use.length} interior points (~${spacingM} m spacing)`,
          summary: `USGS 3DEP grid-sampled ${use.length} interior points; mean slope ${avg(slopes) ?? 'unknown'}%, relief ${round((Math.max(...elevationValues) - Math.min(...elevationValues)) * 3.28084, 1)} ft (${round(Math.min(...elevationValues) * 3.28084, 1)}–${round(Math.max(...elevationValues) * 3.28084, 1)} ft).`,
          whyItMatters: 'Slope and relief affect grading, access, septic cost, and apparent usable area.',
          limitation: `${SCREENING_DISCLAIMERS.slope} Bands are grid-sampled estimates, not raster-clipped survey results.`,
          classification: 'screening',
        },
      };
    },
  };
}

// National Census TIGERweb local-road centerlines — the shared fallback when a
// county publishes no centerline layer. Classification only; ownership stays
// unverified and the finding says so.
const TIGERWEB_ROADS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8';

function frontageAdapter(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'road_frontage',
    adapterId: capability?.layers.roads ? 'county_road_frontage_geometry_v2' : 'tigerweb_road_proximity_v1',
    timeoutMs: 40_000,
    async run(_subject, context) {
      const roadsLayer = capability?.layers.roads ?? TIGERWEB_ROADS;
      const roadsLabel = capability?.layers.roads ? `${capability.countyLabel} road classification centerlines` : 'US Census TIGERweb road centerlines (national)';
      // Roads within ~250 m so nearby-but-not-touching roads are measured too.
      const features = await queryLayerByEnvelope(roadsLayer, p.geometry.rings, '*', 0.0025, { returnGeometry: true, signal: context.signal });
      if (!features.length) {
        const evidenceRef = evidence('road-centerline', roadsLabel, roadsLayer, capability?.layers.roads ? 'official_county_state' : 'authoritative_federal', ['road context'], undefined, 'medium', SCREENING_DISCLAIMERS.frontage);
        return {
          status: 'succeeded', evidence: [evidenceRef], confidence: 'low', retryEligible: true,
          finding: {
            kind: 'road_frontage', adjoiningRoads: [], approximateMappedFrontageFt: null,
            measurementMethod: 'Official county centerlines within 250 m of the parcel; none found.',
            geometrySource: 'Official parcel boundary + county road centerlines.',
            legalAccessStatus: 'unknown',
            accessConcerns: ['No mapped road centerline within 250 m; the parcel may be landlocked or served by an unmapped drive.'],
            summary: 'No mapped road centerline within 250 m of the parcel.',
            whyItMatters: 'Road context supports screening only; it never proves legal access.',
            limitation: SCREENING_DISCLAIMERS.frontage,
            classification: 'screening',
          },
        };
      }
      interface RoadAgg { name: string; owner: string; surface: string; paths: LonLat[][] }
      // TIGER-classified centerlines (MTFCC) carry no ownership; primary and
      // secondary highways are labeled public by classification, local roads
      // stay honestly unverified.
      const mtfccOwner = (mtfcc: string | null): string | null => {
        if (!mtfcc) return null;
        if (/^S1100$/i.test(mtfcc)) return 'Primary highway (public, TIGER classification)';
        if (/^S1200$/i.test(mtfcc)) return 'Secondary road (public, TIGER classification)';
        if (/^S1400$/i.test(mtfcc)) return 'Local road (ownership unverified, TIGER classification)';
        if (/^S17/i.test(mtfcc)) return 'Private drive or service road (TIGER classification)';
        return null;
      };
      const byName = new Map<string, RoadAgg>();
      for (const feature of features) {
        const name = str(feature.attributes?.STNME) ?? str(feature.attributes?.STREETNAME) ?? str(feature.attributes?.FULLNAME) ?? str(feature.attributes?.NAME) ?? 'Unnamed road';
        const agg = byName.get(name) ?? {
          name,
          owner: str(feature.attributes?.OWNER) ?? mtfccOwner(str(feature.attributes?.MTFCC)) ?? 'Unknown',
          surface: str(feature.attributes?.SURFACE) ?? 'Unknown',
          paths: [],
        };
        for (const path of feature.geometry?.paths ?? []) agg.paths.push(path as LonLat[]);
        byName.set(name, agg);
      }
      const measured = [...byName.values()].map((road) => ({ road, m: measureFrontage(p.geometry.rings, road.paths) }));
      const touching = measured.filter(({ m }) => m.touchesParcel || m.approximateFrontageFt > 0);
      const nearby = measured
        .filter(({ m }) => !m.touchesParcel && m.approximateFrontageFt === 0 && Number.isFinite(m.nearestDistanceFt))
        .sort((a, b) => a.m.nearestDistanceFt - b.m.nearestDistanceFt)
        .slice(0, 5);
      // Right-of-way polygon contact when the county publishes ROW.
      let rowContact: boolean | null = null;
      if (capability?.layers.rightOfWay) {
        try {
          const rowFeatures = await queryLayerByPolygon(capability.layers.rightOfWay, p.geometry.rings, '*', { signal: context.signal });
          rowContact = rowFeatures.length > 0;
        } catch {
          rowContact = null;
        }
      }
      const roadStatus = (owner: string): AdjoiningRoad['status'] => /private/i.test(owner) ? 'private' : /state|county|public|city|town|federal/i.test(owner) ? 'public' : 'unknown';
      const adjoiningRoads: AdjoiningRoad[] = touching.map(({ road, m }) => ({
        name: `${road.name} (${road.owner}, ${road.surface})`,
        status: roadStatus(road.owner),
        approximateMappedFrontageFt: m.approximateFrontageFt || undefined,
        apparentRightOfWayContact: rowContact,
      }));
      const totalFrontage = touching.reduce((sum, { m }) => sum + m.approximateFrontageFt, 0);
      const concerns: string[] = [];
      if (!touching.length) concerns.push('No mapped road touches the parcel; nearest mapped roads do not reach the boundary. Legal access requires recorded easement evidence.');
      for (const { road } of touching) {
        // A non-public/'private' road-layer tag is a classification hint, not
        // established ownership — never assert the road IS private or that
        // recorded rights ARE required from a screening tag.
        if (/private/i.test(road.owner)) concerns.push(`${road.name} carries a non-public/private tag in the road layer, but ownership is unverified; recorded access rights would be required only if it is confirmed private (unconfirmed by GIS).`);
      }
      if (rowContact === false) concerns.push('The parcel does not touch any mapped public right-of-way polygon.');
      concerns.push('Centerline proximity is approximate screening; a survey and recorded instruments control frontage and access.');
      const evidenceRef = evidence('road-frontage', `${roadsLabel} + parcel geometry`, roadsLayer, capability?.layers.roads ? 'official_county_state' : 'authoritative_federal', ['road frontage', 'access screening'], undefined, 'medium', SCREENING_DISCLAIMERS.frontage);
      const summary = touching.length
        ? `Road proximity screening: ${touching.map(({ road, m }) => `~${m.approximateFrontageFt} ft of ${road.name} (${road.owner.toLowerCase()}, ${road.surface.toLowerCase()}) centerline falls within 25 meters of the mapped parcel boundary`).join('; ')}.${nearby.length ? ` Nearby but farther: ${nearby.map(({ road, m }) => `${road.name} ~${m.nearestDistanceFt} ft away`).join(', ')}.` : ''} Parcel–road contact, right-of-way contact, physical access, and legal access remain unresolved.`
        : `No mapped road centerline within 25 m of the parcel boundary. Nearest: ${nearby.map(({ road, m }) => `${road.name} (~${m.nearestDistanceFt} ft)`).join(', ') || 'none within 250 m'}.`;
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: touching.length ? 'medium' : 'low', retryEligible: true,
        finding: {
          kind: 'road_frontage',
          adjoiningRoads,
          approximateMappedFrontageFt: touching.length ? totalFrontage : null,
          measurementMethod: 'Length of official road centerline running within 25 m of the official parcel boundary (densified centerline, local meters projection).',
          nearbyRoads: nearby.map(({ road, m }) => ({ name: `${road.name} (${road.owner}, ${road.surface})`, proximityNote: `~${m.nearestDistanceFt} ft from the parcel boundary; does not touch.` })),
          legalAccessStatus: 'unconfirmed',
          geometrySource: 'Official parcel boundary + county road centerlines + county ROW polygons.',
          accessConcerns: concerns,
          summary,
          whyItMatters: 'Road context supports screening only; it never proves legal access.',
          limitation: SCREENING_DISCLAIMERS.frontage,
          classification: 'screening',
        },
      };
    },
  };
}

function zoningAdapter(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'zoning_landuse',
    adapterId: 'county_zoning_flu_overlay_v1',
    timeoutMs: 40_000,
    async run(_subject, context) {
      if (!capability?.layers.zoning) return unavailable('No tested official zoning layer is available for this county.');
      const zoningFeatures = await queryLayerByPolygon(capability.layers.zoning, p.geometry.rings, '*', { signal: context.signal });
      const primary = zoningFeatures[0]?.attributes ?? {};
      const zoningCode = str(primary.FBCode) ?? str(primary.ZONING) ?? str(primary.ZONE) ?? null;
      const zoningName = str(primary.GisCodeName) ?? str(primary.CodeName) ?? null;
      const overlays: string[] = [];
      for (const overlay of capability.layers.zoningOverlays ?? []) {
        try {
          const hits = await queryLayerByPolygon(overlay.url, p.geometry.rings, '*', { signal: context.signal });
          if (hits.length) overlays.push(overlay.name);
        } catch {
          // an overlay probe failure never blocks base zoning
        }
      }
      let flu: string | null = null;
      let existing: string | null = null;
      if (capability.layers.futureLandUse) {
        try {
          const fluFeatures = await queryLayerByPolygon(capability.layers.futureLandUse, p.geometry.rings, '*', { signal: context.signal });
          const subject = fluFeatures.find((feature) => normalizeApn(str(feature.attributes?.PIN_)) === normalizeApn(p.apn)) ?? fluFeatures[0];
          flu = str(subject?.attributes?.FutureLandUse);
          existing = str(subject?.attributes?.ExistingLandUse);
        } catch {
          flu = null;
        }
      }
      const sourceLayerUrls = [capability.layers.zoning, capability.layers.futureLandUse].filter((url): url is string => !!url);
      const evidenceRef = evidence('county-zoning', `${capability.countyLabel} zoning and future land use layers`, capability.layers.zoning, 'official_county_state', ['zoning', 'future land use'], undefined, 'high', 'GIS zoning screening; the zoning ordinance text and county staff control dimensional and use rules.');
      const summary = zoningCode
        ? `Zoned ${zoningName ?? zoningCode}${overlays.length ? ` with overlay districts: ${overlays.join(', ')}` : ''}${flu ? `. Future land use: ${flu}` : ''}${existing ? `. Existing use: ${existing}` : ''}.`
        : 'No zoning polygon intersected the parcel; the parcel may be in a municipal zoning jurisdiction.';
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: zoningCode ? 'high' : 'low', retryEligible: !zoningCode,
        finding: {
          kind: 'zoning_landuse',
          zoningCode,
          zoningName,
          overlayDistricts: overlays,
          futureLandUse: flu,
          existingLandUse: existing,
          jurisdiction: `${p.county} County, ${p.state}`,
          minimumLotSize: null,
          allowedUsesNote: null,
          subdivisionNote: overlays.length ? `Overlay districts (${overlays.join(', ')}) can add review steps for subdivision or new construction; confirm with county planning.` : null,
          sourceLayerUrls,
          summary,
          whyItMatters: 'Zoning and future land use control what can be built, minimum lot dimensions, and subdivision potential.',
          limitation: 'GIS zoning screening only. The adopted ordinance text and a county zoning verification letter control.',
          classification: 'screening',
        },
      };
    },
  };
}

function utilitiesAdapter(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'utilities',
    adapterId: 'utility_screening_v1',
    timeoutMs: 30_000,
    async run(_subject, _context) {
      if (!capability) {
        return unavailable(`No tested official county utility layer or authority adapter is available for ${p.county} County, ${p.state}.`);
      }
      const attempted: string[] = [];
      let water: UtilityAvailability = 'unknown';
      let sewer: UtilityAvailability = 'unknown';
      const providers: Array<{ service: string; provider: string; contact?: string; basis: string }> = [];
      attempted.push(`${capability.countyLabel} GIS service catalog (no public water/sewer line layers are published)`);
      if (stateCode(p.state) === 'SC' && /beaufort/i.test(p.county)) {
        // Rural St Helena Island: county GIS publishes no utility lines; BJWSA is the regional authority.
        water = 'unknown';
        sewer = 'unlikely';
        providers.push(
          { service: 'Water/Sewer', provider: 'Beaufort-Jasper Water & Sewer Authority (BJWSA)', contact: 'bjwsa.org / (843) 987-9200', basis: 'Regional water and sewer authority for Beaufort County; service availability at this parcel must be confirmed with BJWSA.' },
          { service: 'Electric', provider: 'Dominion Energy SC or Palmetto Electric Cooperative', contact: 'palmetto.coop / (843) 208-5551', basis: 'Service-territory screening for the St Helena Island area; confirm the actual provider at the parcel.' },
        );
        attempted.push('BJWSA regional authority identification', 'Electric service-territory screening');
      }
      const septicRequired = (sewer as UtilityAvailability) !== 'mapped_available';
      const wellRequired = (water as UtilityAvailability) !== 'mapped_available';
      const summary = `No public water or sewer line is mapped at the parcel by county GIS${providers.length ? `; ${providers[0].provider} is the regional authority to confirm service` : ''}. Development would most likely need a well and onsite septic unless the authority confirms service.`;
      const evidenceRef = evidence('utility-screening', 'Utility availability screening (county GIS + authority identification)', capability.layers.parcels ?? capability.mapViewerUrl ?? capability.assessorSearchUrl ?? p.sourceUrl, 'official_county_state', ['utilities'], undefined, 'low', 'Screening only; the utility authority controls service availability and connection cost.');
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'low', retryEligible: true,
        finding: {
          kind: 'utilities',
          publicWater: water,
          publicSewer: sewer,
          electric: providers.length ? 'likely' : 'unknown',
          wellLikelyRequired: wellRequired,
          septicLikelyRequired: septicRequired,
          serviceProviders: providers,
          researchAttempted: attempted,
          summary,
          whyItMatters: 'Utility availability drives buildability, septic dependence, and end-buyer cost.',
          limitation: 'Desktop utility screening only. Written service confirmation from the utility authority controls.',
          classification: 'screening',
        },
      };
    },
  };
}

function imagery(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'imagery',
    adapterId: 'county_orthophoto_v2',
    timeoutMs: 20_000,
    async run(_subject, context) {
      const imageService = capability?.layers.aerialImage;
      if (!imageService) return unavailable('No tested public orthophoto adapter is available for this county.');
      await json<Record<string, unknown>>(`${imageService}?f=json`, context.timeoutMs, context.signal);
      const box = bbox(p.geometry.rings[0] ?? []);
      const url = box
        ? `${imageService}/exportImage?f=image&bbox=${box.join(',')}&bboxSR=4326&imageSR=4326&size=1100,1100&format=png32`
        : `${imageService}?f=json`;
      const evidenceRef = evidence('county-imagery', 'County aerial imagery service', url, 'official_county_state', ['imagery'], undefined, 'high', SCREENING_DISCLAIMERS.imagery);
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'high', retryEligible: true,
        finding: {
          kind: 'imagery',
          parcelOutlineShown: false,
          imagerySource: 'County aerial imagery service',
          visibleFeatures: [],
          evidenceRef: url,
          summary: 'Current official county aerial imagery is available for the parcel extent.',
          whyItMatters: 'Imagery supports visible access and land-condition screening, never identity or legal access.',
          limitation: `${SCREENING_DISCLAIMERS.imagery} The public image service does not draw the parcel outline; the visuals workflow overlays the official boundary.`,
          classification: 'supporting_context',
        },
      };
    },
  };
}

function countyRecords(p: OfficialParcel, capability: CountyGisCapability | null): PublicIntelligenceAdapter {
  return {
    task: 'county_records',
    adapterId: 'official_parcel_record_full_v2',
    timeoutMs: 30_000,
    async run(_subject, context) {
      const evidenceRef = evidence('official-parcel', p.provider, p.sourceUrl, 'official_county_state', ['parcel identity', 'county facts'], p.datasetDate ?? undefined);
      type Fact = { field: string; value: string | number; sourceEvidenceId: string; classification: 'official_record' | 'recorded_instrument' };
      const facts: Fact[] = [
        { field: 'APN', value: p.apn, sourceEvidenceId: evidenceRef.evidenceId, classification: 'official_record' },
        { field: 'Situs address', value: p.address, sourceEvidenceId: evidenceRef.evidenceId, classification: 'official_record' },
      ];
      const push = (field: string, value: string | number | null | undefined, classification: Fact['classification'] = 'official_record') => {
        if (value != null && String(value).trim() && String(value).trim() !== '0') facts.push({ field, value: typeof value === 'number' ? value : String(value).trim(), sourceEvidenceId: evidenceRef.evidenceId, classification });
      };
      push('Owner of record', p.owner);
      push(p.datasetDate ? `Owner shown in ${p.datasetDate} parcel dataset` : 'Owner shown in parcel dataset', str(p.facts.ownerAtDatasetDate));
      push('Assessed acreage', p.acres);
      push('Owner mailing address', str(p.facts.mailingAddress));
      push('GIS mapped acreage', num(p.facts.gisAcres));
      push('Land use class', str(p.facts.landUse));
      push('Tax district / area', str(p.facts.areaName));
      push('Legal description (assessor)', str(p.facts.legalDescription));
      push('Appraised value (land)', num(p.facts.landValue));
      push('Total appraised value', num(p.facts.appraisedValue));
      push('Taxable value', num(p.facts.taxableValue));
      push('Last recorded sale date', str(p.facts.saleDate), 'recorded_instrument');
      push('Last recorded sale price', num(p.facts.salePrice), 'recorded_instrument');
      push('Sale qualification', str(p.facts.saleQualification), 'recorded_instrument');
      push('Deed book/page', str(p.facts.deedBookPage), 'recorded_instrument');
      const gisAcres = num(p.facts.gisAcres);
      const acreageConflict = gisAcres != null && p.acres != null && Math.abs(gisAcres - p.acres) / Math.max(p.acres, 0.01) > 0.15;
      // Situs locality standardization: US Census geographies at the parcel centroid
      // (county subdivision + ZCTA). Official, keyless, coordinates only.
      try {
        const census = await json<{ result?: { geographies?: Record<string, Array<Record<string, unknown>>> } }>(
          `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${p.coordinates.lng}&y=${p.coordinates.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`,
          12_000, context.signal,
        );
        const geographies = census.result?.geographies ?? {};
        const subdivision = str((geographies['County Subdivisions']?.[0] as Record<string, unknown> | undefined)?.NAME)?.replace(/\s+CCD$/i, '');
        const zcta = str((geographies['2020 Census ZIP Code Tabulation Areas']?.[0] as Record<string, unknown> | undefined)?.ZCTA5);
        push('Situs locality (Census county subdivision)', subdivision ?? null);
        push('Situs ZIP (Census ZCTA)', zcta ?? null);
      } catch {
        // locality enrichment is best-effort
      }
      const links: string[] = [];
      if (capability?.assessorSearchUrl) links.push(`Assessor/tax search: ${capability.assessorSearchUrl}`);
      if (capability?.recorderSearchUrl) links.push(`Register of Deeds search: ${capability.recorderSearchUrl}`);
      if (capability?.mapViewerUrl) links.push(`County GIS viewer: ${capability.mapViewerUrl}`);
      return {
        status: 'succeeded', evidence: [evidenceRef], confidence: 'high', retryEligible: false,
        finding: {
          kind: 'county_records',
          jurisdiction: `${p.county} County, ${p.state}`,
          facts,
          accessState: 'public',
          summary: `Official parcel record retrieved: owner, mailing address, values, last sale${str(p.facts.deedBookPage) ? ` (deed book/page ${str(p.facts.deedBookPage)})` : ''}, and legal description.${acreageConflict ? ` NOTE: assessed acreage (${p.acres} ac) and mapped GIS acreage (${gisAcres} ac) disagree materially; a survey or the recorded plat controls.` : ''}${links.length ? ` ${links.join(' | ')}` : ''}`,
          whyItMatters: 'Official parcel records establish the identity baseline for all other screening.',
          limitation: 'Public GIS is not a deed, title commitment, survey, or legal boundary determination.',
          classification: 'official_record',
        },
      };
    },
  };
}

function marketplace(): PublicIntelligenceAdapter {
  return {
    task: 'marketplace_confirmation',
    adapterId: 'marketplace_public_browser_status_v1',
    async run() {
      return {
        status: 'unavailable', evidence: [], confidence: 'none', retryEligible: true,
        failureReason: 'No eligible unattended public browser session is available for marketplace collection.',
        finding: {
          kind: 'marketplace_confirmation', researchRan: false, sitesAttempted: ['Zillow', 'Redfin', 'Realtor', 'Realie'],
          addressOrListingMatches: [],
          summary: 'Marketplace research was not run in this public-provider pass.',
          whyItMatters: 'Marketplace pages can support comparable research but never prove parcel identity.',
          limitation: 'No listing or comparable is claimed unless it is actually retrieved.',
          classification: 'supporting_context', identityUse: 'supporting_only',
        },
      };
    },
  };
}

function landPortal(): PublicIntelligenceAdapter {
  return {
    task: 'land_portal',
    adapterId: 'landportal_optional_status_v1',
    async run() {
      return {
        status: 'unavailable', evidence: [], confidence: 'none', retryEligible: true,
        failureReason: 'Land Portal is optional and was not started by the public-first run.',
        finding: {
          kind: 'land_portal', available: false, crossChecks: [], screenshotRefs: [], highResolutionImageryRefs: [],
          summary: 'Land Portal was not used; official and federal sources ran independently.',
          whyItMatters: 'Land Portal can add corroborating visuals but cannot overwrite official evidence.',
          limitation: 'Optional provider not used.',
          classification: 'supporting_context', identityUse: 'cross_check_only',
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// shared plumbing

function query(base: string, where: string, geometry: boolean): string {
  const params = new URLSearchParams({ f: 'json', where, outFields: '*', returnGeometry: geometry ? 'true' : 'false', outSR: '4326' });
  return `${base}/query?${params}`;
}

/** POST variant of the spatial query — real parcel polygons exceed the GET
 *  URL-length limits some ArcGIS hosts enforce. The GET-style URL remains the
 *  evidence reference; the fetch itself is form-encoded POST. */
async function spatialFetch(base: string, geometry: { rings: Rings }, outFields: string, returnGeometry: boolean, timeout: number, signal?: AbortSignal): Promise<Arc> {
  const params = new URLSearchParams({
    f: 'json', geometry: JSON.stringify(geometry), geometryType: 'esriGeometryPolygon', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: returnGeometry ? 'true' : 'false', outSR: '4326',
  });
  return await json<Arc>(`${base}/query`, timeout, signal, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params });
}

function spatial(base: string, geometry: { rings: Rings }, outFields: string, returnGeometry: boolean): string {
  const params = new URLSearchParams({
    f: 'json', geometry: JSON.stringify(geometry), geometryType: 'esriGeometryPolygon', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: returnGeometry ? 'true' : 'false', outSR: '4326',
  });
  return `${base}/query?${params}`;
}

/** Every bounded provider request carries its OWN deadline. Because both a
 *  blown deadline and a caller abort surface from fetch as the same generic
 *  AbortError, the deadline is tracked explicitly so the caller can tell a
 *  provider-local timeout (isolate, keep going) from an intentional upstream
 *  cancellation (stop everything). */
interface BoundedRequest {
  controller: AbortController;
  budgetMs: number;
  timedOut: () => boolean;
  release: () => void;
}

function boundedRequest(timeout: number, signal?: AbortSignal): BoundedRequest {
  if (signal?.aborted) throw new ParcelLookupCancelledError();
  const controller = new AbortController();
  const budgetMs = Math.max(1000, Math.min(timeout, 60_000));
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, budgetMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  return {
    controller,
    budgetMs,
    timedOut: () => expired,
    release: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

/** Classify a failed provider request. Caller cancellation wins over a
 *  coincident deadline: it is the intentional signal. */
function requestFailure(error: unknown, bounded: BoundedRequest, signal: AbortSignal | undefined, provider: string): Error {
  if (error instanceof ParcelLookupCancelledError) return error;
  if (signal?.aborted) return new ParcelLookupCancelledError();
  if (bounded.timedOut()) return new ProviderTimeoutError(`${provider} did not respond within ${bounded.budgetMs}ms.`);
  return error instanceof Error ? error : new Error(String(error));
}

async function json<T>(url: string, timeout: number, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const bounded = boundedRequest(timeout, signal);
  try {
    const response = await fetch(url, { ...init, signal: bounded.controller.signal, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`Public provider HTTP ${response.status}.`);
    return await response.json() as T;
  } catch (error) {
    throw requestFailure(error, bounded, signal, 'The public provider');
  } finally {
    bounded.release();
  }
}

async function sda(queryText: string, timeout: number, signal?: AbortSignal): Promise<string[][]> {
  const bounded = boundedRequest(timeout, signal);
  try {
    const response = await fetch(SDA, {
      method: 'POST', signal: bounded.controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ format: 'JSON+COLUMNNAME', query: queryText }),
    });
    if (!response.ok) throw new Error(`USDA Soil Data Access HTTP ${response.status}.`);
    const payload = await response.json() as { Table?: unknown[][] };
    return (payload.Table ?? []).map((row) => row.map((value) => String(value ?? '')));
  } catch (error) {
    throw requestFailure(error, bounded, signal, 'USDA Soil Data Access');
  } finally {
    bounded.release();
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── SCDOT statewide SC parcel mirror ─────────────────────────────────────────

let scLayerIndex: Map<string, number> | null = null;
const scFieldCache = new Map<number, string[]>();

async function scdotCountyLayerId(county: string, timeoutMs: number, signal?: AbortSignal): Promise<number | null> {
  if (!scLayerIndex) {
    const root = await json<{ layers?: Array<{ id: number; name: string }> }>(`${SC_PARCELS}?f=json`, timeoutMs, signal);
    scLayerIndex = new Map((root.layers ?? []).map((layer) => [layer.name.trim().toLowerCase(), layer.id]));
  }
  const key = county.replace(/\s+county$/i, '').trim().toLowerCase();
  return scLayerIndex.get(key) ?? null;
}

async function scdotLayerFields(layerId: number, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
  const cached = scFieldCache.get(layerId);
  if (cached) return cached;
  const meta = await json<{ fields?: Array<{ name: string }> }>(`${SC_PARCELS}/${layerId}?f=json`, timeoutMs, signal);
  const fields = (meta.fields ?? []).map((f) => f.name);
  scFieldCache.set(layerId, fields);
  return fields;
}

/** Resolve the first present field from an ordered candidate list (schemas vary
 *  per county on the statewide mirror; nothing is guessed beyond this allowlist). */
function scField(fields: string[], candidates: string[]): string | null {
  const lower = new Map(fields.map((f) => [f.toLowerCase(), f]));
  for (const c of candidates) {
    const hit = lower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function scdotLookup(
  input: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const layerId = await scdotCountyLayerId(input.county!, timeoutMs, signal);
  if (layerId == null) {
    return { parcel: null, status: 'unavailable', note: 'The statewide mirror publishes no layer for this county.' };
  }
  const fields = await scdotLayerFields(layerId, timeoutMs, signal);
  const pinField = scField(fields, ['PIN', 'TMS', 'TMSNUMBER', 'MAPBLOLOT', 'PARCELID', 'PARCEL', 'TAXMAP']);
  const addrField = scField(fields, ['LOCADD', 'Address', 'SITEADD', 'SITUS', 'LOCATION']);
  if (!pinField && !addrField) {
    return { parcel: null, status: 'unavailable', note: 'The county layer publishes no recognizable parcel-id or situs-address field.' };
  }
  const layerUrl = `${SC_PARCELS}/${layerId}`;
  const tryWhere = async (where: string): Promise<ArcFeature[]> =>
    (await json<Arc>(query(layerUrl, where, true), timeoutMs, signal)).features ?? [];

  let feature: ArcFeature | null = null;
  let matchedBy = '';
  if (input.apn && pinField) {
    const exact = await tryWhere(`${pinField} = '${sql(input.apn)}'`);
    if (exact.length === 1) { feature = exact[0]; matchedBy = 'Exact APN matched.'; }
  }
  if (!feature && input.address && addrField) {
    const needle = tnNeedle(input.address);
    if (needle) {
      const rows = await tryWhere(`UPPER(${addrField}) LIKE '%${sql(needle)}%'`);
      const mapped = rows.map((f) => scdotParcel(f, layerUrl, input.county!, pinField, addrField, fields)).filter((p): p is OfficialParcel => !!p);
      const compatible = mapped.filter((p) => addressesMateriallyAgree(input.address!, p.address));
      if (compatible.length === 1) {
        return { parcel: compatible[0], status: 'matched', note: 'Exact normalized street address matched (single unambiguous candidate).' };
      }
      return {
        parcel: null,
        status: 'no_match',
        note: compatible.length > 1 ? 'Multiple compatible candidates; no candidate substituted.' : 'No official parcel matched the address.',
      };
    }
  }
  const parcel = feature ? scdotParcel(feature, layerUrl, input.county!, pinField, addrField, fields) : null;
  return {
    parcel,
    status: parcel ? 'matched' : 'no_match',
    note: parcel ? matchedBy : 'No official parcel matched.',
  };
}

function scdotParcel(
  feature: ArcFeature,
  layerUrl: string,
  county: string,
  pinField: string | null,
  addrField: string | null,
  fields: string[],
): OfficialParcel | null {
  const attrs = feature.attributes ?? {};
  const rings = feature.geometry?.rings;
  const apn = pinField ? str(attrs[pinField]) : null;
  const rawAddr = addrField ? str(attrs[addrField]) : null;
  if (!rings?.length || !apn) return null;
  const cityField = scField(fields, ['LOCCITY', 'CityStZip']);
  const city = cityField ? str(attrs[cityField]) : null;
  const address = rawAddr ? `${rawAddr.replace(/\s{2,}/g, ' ').trim()}${city && !/,/.test(rawAddr) ? `, ${city}, SC` : ''}` : `APN ${apn}, ${county} County, SC`;
  const ownerField = scField(fields, ['NAME1', 'OwnerAll', 'OwnerName', 'OWNER', 'CMPNMN']);
  const acresField = scField(fields, ['ACRES', 'Acres']);
  const calcAcresField = scField(fields, ['CalcAcres', 'CALCACRES', 'Calculated']);
  const valueField = scField(fields, ['ACTUALVAL', 'TotalValue', 'TOTALVALUE']);
  const saleDateField = scField(fields, ['SALEDT', 'SaleDate']);
  const salePriceField = scField(fields, ['SALEP', 'SalePrice']);
  const zoningCodeField = scField(fields, ['ZONINGCODE']);
  const zoningDescField = scField(fields, ['ZONINGDESC']);
  const mailField = scField(fields, ['ADD1', 'MailingAdd']);
  const mailCityField = scField(fields, ['CITY', 'MailingCity']);
  const taxAreaField = scField(fields, ['TAXAREA']);
  const saleMs = saleDateField ? num(attrs[saleDateField]) : null;
  const assessedAcres = acresField ? num(attrs[acresField]) : null;
  const calcAcres = calcAcresField ? num(attrs[calcAcresField]) : null;
  const mailing = [mailField ? str(attrs[mailField]) : null, mailCityField ? str(attrs[mailCityField]) : null].filter(Boolean).join(', ');
  return {
    provider: `South Carolina statewide parcel layer (SCDOT GIS mirror) — ${county} County`,
    sourceUrl: layerUrl,
    address,
    county: county.replace(/\s+county$/i, '').trim(),
    state: 'SC',
    apn,
    owner: ownerField ? str(attrs[ownerField]) : null,
    // Assessed acreage is the official acreage fact; the GIS-calculated acreage
    // is preserved separately so a discrepancy is recorded, never collapsed.
    acres: assessedAcres ?? (calcAcres != null ? round(calcAcres, 2) : null),
    coordinates: center(rings[0]),
    geometry: { rings },
    datasetDate: null,
    facts: {
      mailingAddress: mailing || null,
      gisAcres: calcAcres != null ? round(calcAcres, 2) : null,
      areaName: taxAreaField ? str(attrs[taxAreaField]) : null,
      appraisedValue: valueField ? num(attrs[valueField]) : null,
      saleDate: saleMs ? new Date(saleMs).toISOString().slice(0, 10) : null,
      salePrice: salePriceField ? num(attrs[salePriceField]) : null,
      landUse: zoningDescField ? str(attrs[zoningDescField]) : null,
      zoningCodeAssessor: zoningCodeField ? str(attrs[zoningCodeField]) : null,
    },
  };
}

function floridaDorParcel(feature: ArcFeature, url: string, county: string): OfficialParcel | null {
  const attrs = feature.attributes ?? {};
  const rings = feature.geometry?.rings;
  const apn = str(attrs.PARCEL_ID) ?? str(attrs.PARCELNO) ?? str(attrs.STATE_PAR_ID);
  const street = [str(attrs.PHY_ADDR1), str(attrs.PHY_ADDR2)].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!rings?.length || !apn || !street) return null;
  const city = str(attrs.PHY_CITY);
  const zip = num(attrs.PHY_ZIPCD);
  const mailing = [str(attrs.OWN_ADDR1), str(attrs.OWN_ADDR2), str(attrs.OWN_CITY), str(attrs.OWN_STATE), num(attrs.OWN_ZIPCD)]
    .filter((value) => value != null && String(value).trim())
    .join(', ');
  const mappedAcres = round(ringsAreaAcres(rings), 3);
  return {
    provider: 'Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)',
    sourceUrl: url,
    address: [street, city, 'FL', zip ? String(Math.trunc(zip)).padStart(5, '0') : null].filter(Boolean).join(', '),
    county: county.replace(/\s+county$/i, '').trim(),
    state: 'FL',
    apn,
    // The public view is explicitly dated 2023. Keep its owner in the factual
    // payload for provenance, but do not promote it as the current card owner.
    owner: null,
    acres: null,
    coordinates: center(rings[0]),
    geometry: { rings },
    datasetDate: '2023',
    facts: {
      ownerAtDatasetDate: str(attrs.OWN_NAME),
      mailingAddress: mailing || null,
      gisAcres: mappedAcres,
      legalDescription: str(attrs.S_LEGAL),
      stateParcelId: str(attrs.STATE_PAR_ID),
    },
  };
}

function beaufort(feature: ArcFeature, url: string): OfficialParcel | null {
  const attrs = feature.attributes ?? {};
  const rings = feature.geometry?.rings;
  const apn = str(attrs.PIN_) ?? str(attrs.PIN);
  const address = str(attrs.SitusAddre);
  if (!rings?.length || !apn || !address) return null;
  const saleMs = num(attrs.SaleDate);
  const mailing = [str(attrs.MailingAdd), str(attrs.City), [str(attrs.State), str(attrs.ZIP)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const book = str(attrs.Book);
  const page = str(attrs.Page);
  return {
    provider: 'Beaufort County public archival parcel layer (2024)',
    sourceUrl: url,
    address,
    county: 'Beaufort',
    state: 'SC',
    apn,
    owner: [str(attrs.Owner1), str(attrs.Owner2)].filter(Boolean).join(' & ') || null,
    acres: num(attrs.Acres),
    coordinates: center(rings[0]),
    geometry: { rings },
    datasetDate: '2024',
    facts: {
      keyNo: str(attrs.KEYNO),
      landUse: str(attrs.ClassCode),
      areaName: str(attrs.AreaName),
      mailingAddress: mailing || null,
      gisAcres: num(attrs.GIS_ACRES) != null ? round(num(attrs.GIS_ACRES)!, 2) : null,
      legalDescription: str(attrs.LegalDescr),
      landValue: num(attrs.Land),
      appraisedValue: num(attrs.Appraised),
      taxableValue: num(attrs.Taxable),
      saleDate: saleMs ? new Date(saleMs).toISOString().slice(0, 10) : null,
      salePrice: num(attrs.SalePrice),
      saleQualification: str(attrs.SaleQualif),
      deedBookPage: book && page ? `Book ${book}, Page ${page}` : null,
    },
  };
}

function normalizedParcelId(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** Fayette's published parcel service carries both a formatted PARCEL_NO and
 * its component fields.  Try exact formatted identifiers first, then the
 * component form; neither path accepts a nearest or partial candidate. */
function fayetteWhereCandidates(apn: string): string[] {
  const clean = apn.trim();
  const parts = clean.split(/[^a-z0-9]+/i).filter(Boolean);
  const candidates = [
    `PARCEL_NO = '${sql(clean)}'`,
    `PARCEL_KEY = '${sql(clean)}'`,
  ];
  if (parts.length === 4) {
  const [district, square, lot, parcel] = parts.map((part, index) => part.padStart(index === 3 ? 3 : 2, '0'));
    candidates.push(`DISTRICT = '${sql(district)}' AND SQUARE = '${sql(square)}' AND LOT = '${sql(lot)}' AND PARCEL = '${sql(parcel)}'`);
  }
  return [...new Set(candidates)];
}

function fayette(feature: ArcFeature, url: string, suppliedAddress: string | null): OfficialParcel | null {
  const attrs = feature.attributes ?? {};
  const rings = feature.geometry?.rings;
  const components = [str(attrs.DISTRICT), str(attrs.SQUARE), str(attrs.LOT), str(attrs.PARCEL)].filter(Boolean);
  const apn = str(attrs.PARCEL_NO) ?? str(attrs.PARCEL_KEY) ?? (components.length === 4 ? components.join('-') : null);
  if (!rings?.length || !apn) return null;
  return {
    provider: 'Fayette County official GIS tax-parcel layer',
    sourceUrl: url,
    // The public geometry layer does not publish a situs field. The title uses
    // the already accepted card address; the exact APN/geometry is the official
    // evidence and is never presented as an address verification by this lane.
    address: suppliedAddress?.trim() || `APN ${apn}`,
    county: 'Fayette',
    state: 'GA',
    apn,
    owner: null,
    acres: num(attrs.acres),
    coordinates: center(rings[0]),
    geometry: { rings },
    datasetDate: null,
    facts: {
      parcelNumber: apn,
      gisAcres: num(attrs.acres),
      zoning: str(attrs.Zoning),
    },
  };
}

function tennessee(feature: ArcFeature, url: string): OfficialParcel | null {
  const attrs = feature.attributes ?? {};
  const rings = feature.geometry?.rings;
  const apn = str(attrs.PARCELID) ?? str(attrs.PARCEL);
  const address = tnAddress(str(attrs.ADDRESS) ?? '');
  if (!rings?.length || !apn || !address) return null;
  return {
    provider: 'Tennessee Comptroller public parcel layer',
    sourceUrl: url,
    address,
    county: str(attrs.COUNTY_NAME) ?? '',
    state: 'TN',
    apn,
    owner: str(attrs.OWNER),
    acres: num(attrs.DEEDAC),
    coordinates: center(rings[0]),
    geometry: { rings },
    datasetDate: '2026',
    facts: { parcel: str(attrs.PARCEL) },
  };
}

function gridPct(subject: Rings, overlays: Rings[]): number | null {
  const points = interiorGrid(subject, 48);
  if (!points.length) return null;
  const hit = points.filter((point) => overlays.some((rings) => rings.some((ring) => pointInRingLocal(point, ring)))).length;
  return round(hit / points.length * 100, 2);
}

function pointInRingLocal([x, y]: Pos, ring: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function center(ring: Pos[]): { lat: number; lng: number } {
  const pts = ring.slice(0, ring.length > 1 ? -1 : undefined);
  const sum = pts.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
  return { lat: sum.y / pts.length, lng: sum.x / pts.length };
}

function bbox(ring: Pos[]): [number, number, number, number] | null {
  return ring.length
    ? [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]
    : null;
}

function polygonWkt(ring: Pos[]): string | null {
  if (ring.length < 4) return null;
  const pts = [...ring];
  if (pts[0][0] !== pts.at(-1)![0] || pts[0][1] !== pts.at(-1)![1]) pts.push(pts[0]);
  return `POLYGON((${pts.map(([x, y]) => `${x} ${y}`).join(',')}))`;
}

function stateCode(value?: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw === 'SOUTH CAROLINA' ? 'SC' : raw === 'TENNESSEE' ? 'TN' : raw;
}

function tnAddress(value: string): string {
  const parts = value.trim().split(/\s+/);
  return parts.length > 1 && /^\d/.test(parts.at(-1)!)
    ? `${parts.at(-1)} ${parts.slice(0, -1).join(' ').replace(/\bRD\b/i, 'Road')}`
    : value;
}

function tnNeedle(value: string): string {
  // The layer's ADDRESS field is the street line only — search on the segment
  // before the first comma so city/state/ZIP tokens can never break the match.
  const streetLine = value.split(',')[0] ?? value;
  const parts = streetLine.toUpperCase().replace(/\bROAD\b/g, 'RD').replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/);
  const streetNumber = parts.find((part) => /^\d+[A-Z]?$/.test(part));
  return parts.filter((part) => part !== streetNumber && !['RD', 'TN', 'TENNESSEE'].includes(part) && !/^\d{5}$/.test(part)).join(' ');
}

export function addressesMateriallyAgree(a: string, b: string): boolean {
  return addressVariantsCompatible(a, b);
}

function normalizeApn(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function field(attrs: Record<string, unknown> | undefined, re: RegExp): string | null {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (re.test(key) && str(value)) return str(value);
  }
  return null;
}

function str(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && text !== 'null' ? text : null;
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sql(value: string): string {
  return String(value).replace(/'/g, "''");
}

function septic(value: unknown): SoilComponent['septicLimitation'] {
  const text = String(value ?? '').toLowerCase();
  if (/very|severe/.test(text)) return 'very_limited';
  if (/somewhat|moderate/.test(text)) return 'somewhat_limited';
  if (/not limited|slight/.test(text)) return 'not_limited';
  return 'unknown';
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function avg(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : null;
}

function med(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)], 1);
}

function haversineM([x1, y1]: Pos, [x2, y2]: Pos): number {
  const rad = Math.PI / 180;
  const a = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function safe(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/token|password|cookie|secret/ig, '[redacted]').slice(0, 300);
}
