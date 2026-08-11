// LandOS — ArcGIS family ADAPTER (PART 3).
//
// Turns a set of seed URLs plus a normalized subject into the one normalized
// result contract. The whole point is that this file never learns a county: it
// discovers which service holds parcels, which field holds the parcel id, and
// which layer holds zoning, entirely at runtime from service metadata.
//
// Structured service first, always. This adapter does not open a browser and
// does not click a map; if the services cannot answer, it says so honestly and
// the escalation ladder moves on.

import {
  type ArcgisDiscoveryDeps,
  type ArcgisFeature,
  type ArcgisLayerSummary,
  FIELD_ROLE_CANDIDATES,
  addressWhereCandidates,
  apnWhereCascade,
  assessmentOnlyDisclaimer,
  candidateFieldsByPrefix,
  classifyLayerRole,
  describeArcgisService,
  enumerateArcgisServices,
  extractItemId,
  featureRings,
  parseArcgisUrl,
  parcelIdFieldCandidates,
  pickLayerForRole,
  queryArcgisLayer,
  resolveField,
  traverseArcgisItem,
} from './arcgis-service-discovery.js';
import { EscalationLadder } from './gis-escalation.js';
import { reconcileParcelCandidates } from './gis-identity-reconcile.js';
import {
  type DiscoveredMapLayer,
  type GisFailureState,
  type GisFieldState,
  type GisSearchMethod,
  type JurisdictionClue,
  type NormalizedParcelSearchInput,
  type OfficialParcelGisResult,
  type ParcelCandidate,
  type ParcelGeometryResult,
  type PlatformFingerprint,
  type ZoningAttributeFinding,
  type ZoningLayerDescriptor,
  emptyParcelGisResult,
  ringsCentroid,
  strongestSearchMethod,
} from './gis-platform-types.js';

export interface ArcgisSeed {
  url: string;
  label: string;
}

export interface ArcgisAdapterInput {
  /** Any mix of service roots, service URLs, layer URLs and app URLs. */
  seeds: ArcgisSeed[];
  search: NormalizedParcelSearchInput;
  fingerprint: PlatformFingerprint;
  /** Jurisdiction the source serves, when already known from the seed. */
  sourceJurisdiction?: string | null;
}

export interface ArcgisAdapterDeps extends ArcgisDiscoveryDeps {
  ladder?: EscalationLadder;
  now?: () => string;
  /** How many services from a large root may be described. Keeps a big county
   *  server from consuming the whole request budget. */
  maxServicesToDescribe?: number;
}

/** Service names worth describing when a root has many. Ordered by usefulness. */
const SERVICE_NAME_PRIORITY = [
  /parcel/i, /tax/i, /assessor/i, /cadastr/i, /propert/i, /zoning/i, /land\s*use/i, /planning/i, /boundar/i, /address/i,
];

function servicePriority(name: string): number {
  const flat = name.replace(/[_\-/]+/g, ' ');
  for (let i = 0; i < SERVICE_NAME_PRIORITY.length; i += 1) {
    if (SERVICE_NAME_PRIORITY[i].test(flat)) return i;
  }
  return SERVICE_NAME_PRIORITY.length;
}

function fieldValue(feature: ArcgisFeature, field: string | null): string | null {
  if (!field) return null;
  const raw = feature.attributes?.[field];
  if (raw == null) return null;
  const text = String(raw).trim();
  return text && text.toLowerCase() !== 'null' ? text : null;
}

function numericValue(feature: ArcgisFeature, field: string | null): number | null {
  if (!field) return null;
  const raw = feature.attributes?.[field];
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : null;
}

/* ─────────────────────── layer discovery from seeds ──────────────────── */

interface DiscoveredLayers {
  layers: ArcgisLayerSummary[];
  /** Service URLs actually reached, for the evidence trail. */
  servicesReached: string[];
  notes: string[];
}

/**
 * Walk every seed down to concrete, described layers. A seed may be a bare
 * layer URL (fastest), a service, a services root, or an application whose item
 * config has to be traversed first.
 */
export async function discoverArcgisLayers(
  seeds: readonly ArcgisSeed[],
  deps: ArcgisAdapterDeps = {},
): Promise<DiscoveredLayers> {
  const ladder = deps.ladder;
  const maxDescribe = deps.maxServicesToDescribe ?? 6;
  const layers: ArcgisLayerSummary[] = [];
  const servicesReached: string[] = [];
  const notes: string[] = [];
  const describedServices = new Set<string>();

  const describe = async (serviceUrl: string, sourceRank: number): Promise<void> => {
    if (describedServices.has(serviceUrl)) return;
    if (ladder?.stageExhausted()) { notes.push('Stage request budget reached before every service could be described.'); return; }
    describedServices.add(serviceUrl);
    try {
      const summary = await describeArcgisService(serviceUrl, deps, sourceRank);
      servicesReached.push(serviceUrl);
      if (summary.tiledOnly) {
        notes.push(`${serviceUrl} is a cached tile service and cannot answer attribute queries.`);
        return;
      }
      layers.push(...summary.layers);
    } catch (error) {
      notes.push(`${serviceUrl}: ${(error as Error).message}`);
    }
  };

  for (const [seedIndex, seed] of seeds.entries()) {
    if (ladder?.stageExhausted()) break;
    const parsed = parseArcgisUrl(seed.url);

    if (parsed?.serviceUrl) { await describe(parsed.serviceUrl, seedIndex); continue; }

    if (parsed && !parsed.serviceUrl) {
      // A services root or folder. Enumerate, then describe only the services
      // whose names suggest they hold parcels or zoning.
      try {
        const services = await enumerateArcgisServices(parsed.folder ? `${parsed.servicesRoot}/${parsed.folder}` : parsed.servicesRoot, deps);
        const ranked = services
          .filter((service) => service.type === 'MapServer' || service.type === 'FeatureServer')
          .sort((a, b) => servicePriority(a.name) - servicePriority(b.name));
        const chosen = ranked.filter((service) => servicePriority(service.name) < SERVICE_NAME_PRIORITY.length).slice(0, maxDescribe);
        if (ranked.length > chosen.length) {
          notes.push(`${ranked.length} services published; described the ${chosen.length} whose names indicate parcel, zoning or boundary data.`);
        }
        for (const service of chosen) await describe(service.url, seedIndex);
      } catch (error) {
        notes.push(`${seed.url}: ${(error as Error).message}`);
      }
      continue;
    }

    // An application URL. Resolve its item down to layer references.
    const itemId = extractItemId(seed.url);
    if (!itemId) { notes.push(`${seed.url} is not an ArcGIS REST or application URL.`); continue; }
    try {
      const traversal = await traverseArcgisItem(itemId, null, deps);
      notes.push(`Resolved application item via ${traversal.path.join(' → ')}.`);
      const serviceUrls = new Set<string>();
      for (const ref of traversal.layers) {
        if (!ref.url) continue;
        const refParsed = parseArcgisUrl(ref.url);
        if (refParsed?.serviceUrl) serviceUrls.add(refParsed.serviceUrl);
      }
      for (const serviceUrl of [...serviceUrls].slice(0, maxDescribe)) await describe(serviceUrl, seedIndex);
    } catch (error) {
      notes.push(`${seed.url}: ${(error as Error).message}`);
    }
  }

  return { layers, servicesReached, notes };
}

/* ──────────────────────────── parcel search ──────────────────────────── */

interface ParcelSearchOutcome {
  features: ArcgisFeature[];
  method: GisSearchMethod | null;
  /** False when the hit came from a prefix or containment match. */
  exact: boolean;
  attempts: string[];
}

/**
 * Find the subject on a parcel layer, strongest method first.
 *
 * The APN cascade matters more than it looks: an exact match on a printed APN
 * frequently returns zero rows because the county stores the key with padding,
 * leading zeros or a roll-year suffix. Falling back to a prefix match finds the
 * parcel; marking that fallback as non-exact is what stops it being reported as
 * a verified identity without reconciliation.
 */
export async function searchArcgisParcel(
  layer: ArcgisLayerSummary,
  search: NormalizedParcelSearchInput,
  deps: ArcgisAdapterDeps = {},
): Promise<ParcelSearchOutcome> {
  const ladder = deps.ladder;
  const attempts: string[] = [];
  const supported: GisSearchMethod[] = [];
  const parcelIdField = resolveField(layer.fields, 'parcelId');
  const situsField = resolveField(layer.fields, 'situsAddress');
  const ownerField = resolveField(layer.fields, 'owner');
  if (parcelIdField) supported.push('apn');
  if (situsField) supported.push('address');
  if (ownerField) supported.push('owner');
  if (layer.geometryType === 'esriGeometryPolygon') supported.push('coordinate');

  const runWhere = async (where: string, method: GisSearchMethod, exact: boolean): Promise<ParcelSearchOutcome | null> => {
    if (ladder?.stageExhausted()) return null;
    attempts.push(where);
    try {
      const result = await queryArcgisLayer(layer.layerUrl, { where, returnGeometry: true, resultRecordCount: 12 }, deps);
      if (result.features.length) return { features: result.features, method, exact, attempts };
    } catch (error) {
      attempts.push(`(failed: ${(error as Error).message})`);
    }
    return null;
  };

  // Try methods in preference order, and keep trying weaker ones only when the
  // stronger one genuinely found nothing.
  for (const method of ['apn', 'address', 'owner', 'coordinate'] as const) {
    const strongest = strongestSearchMethod(search, supported);
    if (!strongest) break;
    if (!supported.includes(method)) continue;

    if (method === 'apn' && search.apn && parcelIdField) {
      // Try every identifier column the layer publishes, not just the first one
      // that resolved: a deployment can store the padded spelling in one column
      // and the compact spelling in another, and only one will match.
      //
      // Ordered by STRATEGY STRENGTH across all fields, not field by field.
      // Depth-first would let a weak containment match on the first column fire
      // before an exact match on the second — returning a dozen unrelated
      // parcels and reporting a conflict on a parcel the layer holds correctly.
      const fields = parcelIdFieldCandidates(layer.fields);
      const byStrength = new Map<number, Array<{ where: string; exact: boolean }>>();
      for (const field of fields) {
        apnWhereCascade(search.apn, field).forEach((strategy, rank) => {
          const bucket = byStrength.get(rank) ?? [];
          bucket.push({ where: strategy.where, exact: strategy.exact });
          byStrength.set(rank, bucket);
        });
      }
      for (const rank of [...byStrength.keys()].sort((a, b) => a - b)) {
        for (const strategy of byStrength.get(rank)!) {
          const hit = await runWhere(strategy.where, 'apn', strategy.exact);
          if (hit) return hit;
        }
        if (ladder?.stageExhausted()) break;
      }
      continue;
    }
    if (method === 'address' && search.address && situsField) {
      const candidates = addressWhereCandidates(search.address, situsField);
      for (let i = 0; i < candidates.length; i += 1) {
        const hit = await runWhere(candidates[i], 'address', i === 0);
        if (hit) return hit;
      }
      continue;
    }
    if (method === 'owner' && search.owner && ownerField) {
      const owner = search.owner.trim().replace(/'/g, "''").toUpperCase();
      const hit = await runWhere(`UPPER(${ownerField}) LIKE '%${owner}%'`, 'owner', false);
      if (hit) return hit;
      continue;
    }
    if (method === 'coordinate' && typeof search.latitude === 'number' && typeof search.longitude === 'number') {
      if (ladder?.stageExhausted()) break;
      attempts.push(`point(${search.longitude}, ${search.latitude})`);
      try {
        const result = await queryArcgisLayer(
          layer.layerUrl,
          { geometry: { x: search.longitude, y: search.latitude }, returnGeometry: true, resultRecordCount: 6 },
          deps,
        );
        if (result.features.length) return { features: result.features, method: 'coordinate', exact: false, attempts };
      } catch (error) {
        attempts.push(`(failed: ${(error as Error).message})`);
      }
    }
  }

  return { features: [], method: null, exact: false, attempts };
}

/* ─────────────────────── attribute normalization ─────────────────────── */

/**
 * Fields whose values are a JURISDICTION code that a county prefixes onto its
 * printed parcel identifier. Composing one with the local key reproduces the
 * spelling LandOS holds, which is how a real match stops reading as a conflict.
 */
const JURISDICTION_CODE_FIELDS = ['SWIS', 'MUNICODE', 'MUNICIPALITYCODE', 'CITYTOWNSWIS', 'TAXDIST', 'TADCODE', 'COUNTYFIPS', 'CVTTXCD'];

/**
 * Every identifier the record itself publishes for this parcel: each parcel-id
 * field it carries, plus each of those composed with each jurisdiction code it
 * carries. All of it comes from the one official record, so none of it can
 * pull in a different parcel.
 */
function alternateIdentifiers(feature: ArcgisFeature, layer: ArcgisLayerSummary, primary: string | null): string[] {
  const normalize = (name: string) => name.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const idFields = new Set(FIELD_ROLE_CANDIDATES.parcelId as readonly string[]);

  const ids: string[] = [];
  const codes: string[] = [];
  for (const field of layer.fields) {
    const key = normalize(field.name);
    const value = fieldValue(feature, field.name);
    if (!value) continue;
    if (JURISDICTION_CODE_FIELDS.includes(key)) codes.push(value);
    else if (idFields.has(key)) ids.push(value);
  }

  const out = new Set<string>(ids);
  for (const code of codes) {
    for (const id of [primary, ...ids].filter((v): v is string => !!v)) {
      out.add(`${code} ${id}`);
      out.add(`${code}${id}`);
    }
  }
  if (primary) out.delete(primary);
  return [...out].slice(0, 24);
}

/**
 * Acreage, tolerating the two shapes county data actually arrives in: a field
 * whose name was truncated upstream, and a text field like "11.5 ac".
 *
 * A prefix match is only trusted once the VALUE parses as a plausible acreage,
 * so a field that merely shares an opening word can never be read as acres.
 */
function resolveAcres(feature: ArcgisFeature, layer: ArcgisLayerSummary): number | null {
  const exact = numericValue(feature, resolveField(layer.fields, 'acres'));
  if (exact != null && exact > 0) return exact;

  for (const field of candidateFieldsByPrefix(layer.fields, 'acres')) {
    const value = numericValue(feature, field);
    if (value != null && value > 0) return value;
  }

  // Text acreage, e.g. "11.5 ac". Read only from a field whose name says so.
  for (const field of layer.fields) {
    if (!/acre|land[_\s]?size|lot[_\s]?size/i.test(field.name)) continue;
    const raw = fieldValue(feature, field.name);
    const parsed = raw ? Number(/([\d,]+(?:\.\d+)?)/.exec(raw.replace(/,/g, ''))?.[1]) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function toCandidate(feature: ArcgisFeature, layer: ArcgisLayerSummary): ParcelCandidate {
  const parcelId = fieldValue(feature, resolveField(layer.fields, 'parcelId'));
  return {
    parcelId,
    alternateIds: alternateIdentifiers(feature, layer, parcelId),
    address: fieldValue(feature, resolveField(layer.fields, 'situsAddress')),
    owner: fieldValue(feature, resolveField(layer.fields, 'owner')),
    acres: resolveAcres(feature, layer),
    county: fieldValue(feature, resolveField(layer.fields, 'county')),
    state: null,
    handle: String(feature.attributes?.OBJECTID ?? ''),
  };
}

/** Municipality-ish field names mapped to the jurisdiction level they imply. */
const JURISDICTION_FIELD_LEVELS: Array<{ pattern: RegExp; level: JurisdictionClue['level'] }> = [
  { pattern: /^(township|twp|twn)/i, level: 'township' },
  { pattern: /^(village)/i, level: 'village' },
  { pattern: /^(borough)/i, level: 'borough' },
  { pattern: /citytown/i, level: 'county_subdivision' },
  { pattern: /^(city)/i, level: 'city' },
  { pattern: /^(town)/i, level: 'town' },
  { pattern: /(muni)/i, level: 'municipality' },
  { pattern: /(jurisdiction|juris)/i, level: 'planning_jurisdiction' },
];

/**
 * PART 12 — record what the official source SAYS about who governs the parcel.
 * No legal conclusion is drawn: each clue keeps the field it came from and a
 * verbatim statement, so the next sprint can reconcile authority itself.
 */
export function extractJurisdictionClues(
  feature: ArcgisFeature,
  layer: ArcgisLayerSummary,
  sourceUrl: string,
): JurisdictionClue[] {
  const clues: JurisdictionClue[] = [];
  const push = (level: JurisdictionClue['level'], field: string | null) => {
    const value = fieldValue(feature, field);
    if (!value || !field) return;
    if (clues.some((c) => c.level === level && c.name === value)) return;
    clues.push({
      level,
      name: value,
      sourceUrl,
      sourceField: field,
      statement: `Official parcel layer "${layer.name}" reports ${field} = ${value}.`,
    });
  };

  push('county', resolveField(layer.fields, 'county'));
  push('school_district', resolveField(layer.fields, 'schoolDistrict'));

  const municipalityField = resolveField(layer.fields, 'municipality');
  if (municipalityField) {
    const level = JURISDICTION_FIELD_LEVELS.find((entry) => entry.pattern.test(municipalityField))?.level ?? 'municipality';
    push(level, municipalityField);
  }
  return clues;
}

/* ────────────────────────── zoning discovery ─────────────────────────── */

/**
 * PART 11 — determine whether zoning is EXPOSED, and read the code when it is.
 * Nothing is interpreted. Two exposure shapes are handled: the parcel layer
 * carries zoning as its own attribute, or a separate zoning layer covers the
 * parcel geometrically.
 */
export async function discoverArcgisZoning(
  parcelFeature: ArcgisFeature,
  parcelLayer: ArcgisLayerSummary,
  allLayers: readonly ArcgisLayerSummary[],
  centroid: { lat: number; lng: number } | null,
  deps: ArcgisAdapterDeps = {},
): Promise<{ zoning: ZoningAttributeFinding | null; layer: ZoningLayerDescriptor | null; failure: GisFailureState | null }> {
  // Shape 1: zoning lives on the parcel record itself. Cheapest and most exact,
  // because there is no spatial join to get wrong.
  const codeField = resolveField(parcelLayer.fields, 'zoningCode');
  const descField = resolveField(parcelLayer.fields, 'zoningDescription');
  const inlineCode = fieldValue(parcelFeature, codeField);
  const inlineDesc = fieldValue(parcelFeature, descField);
  if (codeField && (inlineCode || inlineDesc)) {
    const descriptor: ZoningLayerDescriptor = {
      layerName: parcelLayer.name,
      layerId: String(parcelLayer.id),
      serviceUrl: parcelLayer.serviceUrl,
      jurisdiction: fieldValue(parcelFeature, resolveField(parcelLayer.fields, 'municipality')),
      codeField,
      descriptionField: descField,
      geometryRelationship: 'parcel_attribute',
    };
    return {
      zoning: {
        code: inlineCode ?? inlineDesc,
        description: inlineDesc,
        layer: descriptor,
        // A code stored on the ASSESSMENT record is an assessment
        // classification, not adopted zoning, regardless of what the field is
        // called. Reporting it as legal zoning would be a false entitlement
        // claim, so it is labeled for what it is and the caveat travels with it.
        authority: 'assessment_classification',
        sourceDisclaimer:
          assessmentOnlyDisclaimer(parcelLayer.serviceDescription)
          ?? 'Read from a field on the assessment parcel record, which is an assessment classification rather than adopted zoning.',
        interpreted: false,
      },
      layer: descriptor,
      failure: null,
    };
  }

  // Shape 2: a separate zoning layer. Requires a point to test against.
  const zoningPick = pickLayerForRole(allLayers, 'zoning');
  if (!zoningPick) return { zoning: null, layer: null, failure: 'ZONING_LAYER_NOT_FOUND' };

  const zoningLayer = zoningPick.layer;
  const zCodeField = resolveField(zoningLayer.fields, 'zoningCode');
  const zDescField = resolveField(zoningLayer.fields, 'zoningDescription');
  const descriptor: ZoningLayerDescriptor = {
    layerName: zoningLayer.name,
    layerId: String(zoningLayer.id),
    serviceUrl: zoningLayer.serviceUrl,
    jurisdiction: null,
    codeField: zCodeField,
    descriptionField: zDescField,
    geometryRelationship: 'not_evaluated',
  };

  if (!centroid) return { zoning: null, layer: descriptor, failure: 'GEOMETRY_UNAVAILABLE' };
  if (deps.ladder?.stageExhausted()) return { zoning: null, layer: descriptor, failure: 'ZONING_ATTRIBUTE_UNAVAILABLE' };

  try {
    const result = await queryArcgisLayer(
      zoningLayer.layerUrl,
      { geometry: { x: centroid.lng, y: centroid.lat }, returnGeometry: false, resultRecordCount: 4 },
      deps,
    );
    if (!result.features.length) {
      return { zoning: null, layer: { ...descriptor, geometryRelationship: 'no_intersection' }, failure: 'ZONING_ATTRIBUTE_UNAVAILABLE' };
    }
    const feature = result.features[0];
    const code = fieldValue(feature, zCodeField);
    const description = fieldValue(feature, zDescField);
    const covering: ZoningLayerDescriptor = { ...descriptor, geometryRelationship: 'contains_subject' };
    if (!code && !description) {
      return { zoning: null, layer: covering, failure: 'ZONING_ATTRIBUTE_UNAVAILABLE' };
    }
    // A dedicated zoning layer is adopted zoning UNLESS the publisher's own
    // service description says it is for assessment only — several do.
    const disclaimer = assessmentOnlyDisclaimer(zoningLayer.serviceDescription);
    return {
      zoning: {
        code: code ?? description,
        description,
        layer: covering,
        authority: disclaimer ? 'assessment_classification' : 'official_zoning_layer',
        sourceDisclaimer: disclaimer,
        interpreted: false,
      },
      layer: covering,
      failure: null,
    };
  } catch {
    return { zoning: null, layer: descriptor, failure: 'ZONING_ATTRIBUTE_UNAVAILABLE' };
  }
}

/* ──────────────────────────── the adapter ────────────────────────────── */

function toAvailableLayers(layers: readonly ArcgisLayerSummary[]): DiscoveredMapLayer[] {
  return layers
    .map((layer) => ({ layer, verdict: classifyLayerRole(layer) }))
    .filter((entry) => entry.verdict.role !== 'other')
    .slice(0, 40)
    .map((entry) => ({
      name: entry.layer.name,
      url: entry.layer.layerUrl,
      role: entry.verdict.role,
      queryable: entry.layer.queryable,
    }));
}

/**
 * Run the ArcGIS family adapter end to end. Every outcome — including total
 * failure — comes back as the same normalized contract with named states, so a
 * caller never has to interpret an exception to know what happened.
 */
export async function runArcgisAdapter(
  input: ArcgisAdapterInput,
  deps: ArcgisAdapterDeps = {},
): Promise<OfficialParcelGisResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const ladder = deps.ladder ?? new EscalationLadder();
  const retrievedAt = now();
  const failureStates: GisFailureState[] = [];
  const fieldStates: Record<string, GisFieldState> = {};
  const unresolvedFields: string[] = [];

  const base = emptyParcelGisResult({
    sourcePlatform: input.fingerprint.family,
    sourcePlatformVariant: input.fingerprint.variant,
    sourceJurisdiction: input.sourceJurisdiction ?? null,
    sourceUrl: input.fingerprint.sourceUrl || input.seeds[0]?.url || '',
    retrievedAt,
    retrievalMethod: 'structured_service',
  });

  ladder.beginStage('structured_service_discovery');
  const discovered = await discoverArcgisLayers(input.seeds, { ...deps, ladder });
  ladder.endStage('structured_service_discovery', discovered.layers.length ? 'succeeded' : 'no_result',
    discovered.layers.length
      ? `Described ${discovered.servicesReached.length} service(s) and ${discovered.layers.length} layer(s).`
      : `No queryable layer was reachable. ${discovered.notes.join(' ')}`.trim());

  if (!discovered.layers.length) {
    return { ...base, failureStates: ['STRUCTURED_SERVICE_NOT_FOUND'], retrievalConfidence: 'none', unresolvedFields: ['parcelId', 'geometry', 'zoning'] };
  }

  const availableLayers = toAvailableLayers(discovered.layers);
  const parcelPick = pickLayerForRole(discovered.layers, 'parcel');
  if (!parcelPick) {
    return {
      ...base,
      availableLayers,
      failureStates: ['PARCEL_NOT_FOUND'],
      retrievalConfidence: 'low',
      unresolvedFields: ['parcelId', 'geometry'],
      fieldStates: { parcelId: 'not_exposed_by_deployment' },
    };
  }

  ladder.beginStage('known_adapter');
  const parcelLayer = parcelPick.layer;
  const search = await searchArcgisParcel(parcelLayer, input.search, { ...deps, ladder });

  if (!search.features.length) {
    ladder.endStage('known_adapter', 'no_result', `Parcel layer "${parcelLayer.name}" returned no candidate for the subject.`);
    return {
      ...base,
      sourceServiceUrl: parcelLayer.serviceUrl,
      availableLayers,
      failureStates: ['PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId', 'parcelAddress', 'owner', 'acres', 'geometry', 'zoning'],
    };
  }

  const candidates = search.features.map((feature) => toCandidate(feature, parcelLayer));
  // A municipal/jurisdiction code published in the SAME record is what lets a
  // prefixed identifier reconcile against a bare local key without guessing.
  const municipalityField = resolveField(parcelLayer.fields, 'municipality');
  const observedJurisdictionCode = fieldValue(search.features[0], municipalityField);
  const reconciliation = reconcileParcelCandidates(input.search, candidates, {
    observedJurisdictionCode,
    searchWasExact: search.exact,
  });

  if (reconciliation.acceptedIndex == null) {
    ladder.endStage('known_adapter', 'failed', reconciliation.reason);
    return {
      ...base,
      sourceServiceUrl: parcelLayer.serviceUrl,
      availableLayers,
      searchMethod: search.method,
      parcelMatchStatus: reconciliation.status,
      reconciliation,
      failureStates: [reconciliation.status === 'conflict' ? 'PARCEL_IDENTITY_CONFLICT' : 'PARCEL_NOT_FOUND'],
      retrievalConfidence: 'none',
      unresolvedFields: ['parcelId', 'geometry', 'zoning'],
    };
  }

  const feature = search.features[reconciliation.acceptedIndex];
  const candidate = candidates[reconciliation.acceptedIndex];

  const rings = featureRings(feature);
  let geometry: ParcelGeometryResult | null = null;
  if (rings) {
    geometry = {
      rings,
      spatialReference: 4326,
      centroid: ringsCentroid(rings),
      sourceAcres: candidate.acres,
      vertexCount: rings.reduce((sum, ring) => sum + ring.length, 0),
    };
  } else {
    failureStates.push('GEOMETRY_UNAVAILABLE');
    fieldStates.geometry = parcelLayer.geometryType === 'esriGeometryPolygon' ? 'unresolved' : 'not_exposed_by_deployment';
    unresolvedFields.push('geometry');
  }

  const jurisdictionClues = extractJurisdictionClues(feature, parcelLayer, parcelLayer.layerUrl);
  const zoningResult = await discoverArcgisZoning(feature, parcelLayer, discovered.layers, geometry?.centroid ?? null, { ...deps, ladder });
  if (zoningResult.failure) {
    failureStates.push(zoningResult.failure);
    fieldStates.zoning = zoningResult.failure === 'ZONING_LAYER_NOT_FOUND' ? 'not_exposed_by_deployment' : 'unresolved';
    unresolvedFields.push('zoning');
  }

  for (const [field, value] of [
    ['parcelId', candidate.parcelId],
    ['parcelAddress', candidate.address],
    ['owner', candidate.owner],
    ['acres', candidate.acres],
  ] as const) {
    if (value == null) {
      fieldStates[field] = resolveField(parcelLayer.fields, field === 'parcelAddress' ? 'situsAddress' : field === 'acres' ? 'acres' : field === 'owner' ? 'owner' : 'parcelId')
        ? 'unresolved'
        : 'not_exposed_by_deployment';
      unresolvedFields.push(field);
    } else {
      fieldStates[field] = 'supported';
    }
  }

  ladder.endStage('known_adapter', 'succeeded',
    `Matched on ${search.method} via the ${search.exact ? 'exact' : 'non-exact'} strategy; reconciliation returned ${reconciliation.status}.`);

  const localGovernment = jurisdictionClues.find((clue) =>
    ['city', 'town', 'township', 'village', 'borough', 'municipality', 'county_subdivision'].includes(clue.level))?.name ?? null;

  return {
    ...base,
    sourceJurisdiction: input.sourceJurisdiction ?? candidate.county ?? null,
    sourceServiceUrl: parcelLayer.layerUrl,
    searchMethod: search.method,
    parcelMatchStatus: reconciliation.status,
    parcelId: candidate.parcelId,
    parcelAddress: candidate.address,
    owner: candidate.owner,
    acres: candidate.acres,
    geometry,
    // Incorporation status is only stated when a source states it; a town name
    // alone does not establish that a parcel is incorporated.
    incorporatedStatus: null,
    localGovernment,
    jurisdictionClues,
    zoning: zoningResult.zoning,
    zoningLayer: zoningResult.layer,
    availableLayers,
    officialPlanningLinks: zoningResult.layer ? [{ label: `Official zoning layer: ${zoningResult.layer.layerName}`, url: zoningResult.layer.serviceUrl }] : [],
    retrievalMethod: 'structured_service',
    retrievalConfidence: reconciliation.status === 'verified' ? 'high' : reconciliation.status === 'provisional' ? 'medium' : 'low',
    failureStates,
    fieldStates,
    unresolvedFields: [...new Set(unresolvedFields)],
    reconciliation,
  };
}
