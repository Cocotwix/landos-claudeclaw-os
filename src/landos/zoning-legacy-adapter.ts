// Deal Card entry points for the zoning slice: a SELECT-only read adapter and
// the explicit Operator rebuild command that performs live jurisdiction and
// zoning research through the reusable adapters.

import { getDealCard } from './deal-card.js';
import { getLandosDb } from './db.js';
import type { Rings } from './parcel-spatial.js';
import { synchronizePropertySummaryForDeal } from './property-summary-legacy-adapter.js';
import { readCurrentPropertyIdentity, type PropertyIdentityVersion } from './property-summary-slice.js';
import {
  createArcgisZoningAdapter,
  createBoundaryAdapter,
  createOrdinanceDocumentAdapter,
  findZoningJurisdictionConfig,
  zoningGisFromCountyRegistry,
  type ParcelGeometryInput,
  type ZoningJurisdictionConfig,
} from './zoning-adapters.js';
import type { JurisdictionDetermination } from './zoning-jurisdiction.js';
import {
  getZoningReadModel,
  persistZoningCollector,
  runTrackedZoningCollector,
  synchronizeZoningSlice,
  type ZoningCollectorInput,
} from './zoning-operator.js';
import type { ZoningDomain, ZoningReadModel } from './zoning-types.js';

const LIVE_ADAPTER_VERSION = 'zoning-live-adapter-v1';
const COLLECTOR_TIMEOUT_MS = 90_000;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function parcelGeometry(identity: PropertyIdentityVersion): ParcelGeometryInput {
  const geometry = identity.geometry as { rings?: Rings } | null;
  const rings = Array.isArray(geometry?.rings) && geometry.rings.length ? geometry.rings : null;
  if (rings) return { rings, point: null };
  if (identity.propertyCardId != null) {
    const row = getLandosDb().prepare('SELECT lat, lng FROM landos_property_card WHERE id=?')
      .get(identity.propertyCardId) as { lat: number | null; lng: number | null } | undefined;
    if (row && typeof row.lat === 'number' && typeof row.lng === 'number') {
      return { rings: null, point: [row.lng, row.lat] };
    }
  }
  return { rings: null, point: null };
}

/** Retry ordinal so failed/blocked live runs retry on the next explicit
 * rebuild while completed runs stay idempotent (no duplicate evidence). */
function liveRetryOrdinal(identityVersionId: number, domain: ZoningDomain): number {
  const row = getLandosDb().prepare(`
    SELECT COUNT(*) AS count FROM landos_property_collector_job
    WHERE property_identity_version_id=? AND collector_key=?
      AND status IN ('failed','blocked')
  `).get(identityVersionId, domain) as { count: number };
  return row.count;
}

function readPersistedDetermination(identity: PropertyIdentityVersion): JurisdictionDetermination | null {
  const row = getLandosDb().prepare(`
    SELECT normalized_value_json FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND domain='jurisdiction_authority' AND evidence_kind='normalized_claim'
      AND fact_key='jurisdiction_determination'
    ORDER BY id DESC LIMIT 1
  `).get(identity.dealCardId, identity.id) as { normalized_value_json: string } | undefined;
  if (!row) return null;
  const value = parseJson<Record<string, unknown>>(row.normalized_value_json, {}).value as Record<string, unknown> | undefined;
  if (!value || typeof value !== 'object') return null;
  return {
    determination: (value.determination ?? 'undetermined') as JurisdictionDetermination['determination'],
    incorporationStatus: (value.incorporationStatus ?? 'undetermined') as JurisdictionDetermination['incorporationStatus'],
    controllingAuthorityName: (value.controllingAuthorityName ?? null) as string | null,
    controllingAuthorityLevel: (value.controllingAuthorityLevel ?? 'unknown') as JurisdictionDetermination['controllingAuthorityLevel'],
    officialBoundaryEvidence: value.officialBoundaryEvidence === true,
    mailingCityDiffersFromAuthority: value.mailingCityDiffersFromAuthority === true,
    candidateAuthoritiesConsidered: Array.isArray(value.candidateAuthoritiesConsidered)
      ? value.candidateAuthoritiesConsidered.map(String) : [],
    basis: '',
    missingInformation: Array.isArray(value.missingInformation) ? value.missingInformation.map(String) : [],
  };
}

function readPersistedDistrictCode(identity: PropertyIdentityVersion): string | null {
  const rows = getLandosDb().prepare(`
    SELECT normalized_value_json FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND domain='zoning_district' AND evidence_kind='normalized_claim'
      AND verification_status='record_located'
    ORDER BY id DESC
  `).all(identity.dealCardId, identity.id) as Array<{ normalized_value_json: string }>;
  for (const row of rows) {
    const normalized = parseJson<Record<string, unknown>>(row.normalized_value_json, {});
    const sourceKind = String(normalized.sourceKind ?? '');
    const code = normalized.districtCode == null ? null : String(normalized.districtCode);
    if (code && sourceKind.startsWith('official')) return code;
  }
  return null;
}

function unavailableCollector(input: {
  identity: PropertyIdentityVersion;
  domain: ZoningDomain;
  sourceJurisdiction: string;
  reason: string;
  authorityName?: string | null;
}): ZoningCollectorInput {
  return {
    identity: input.identity,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: 'unconfigured',
    adapterKey: LIVE_ADAPTER_VERSION,
    status: 'partial',
    outcomeKind: 'completed',
    error: input.reason,
    claims: [{
      claimKey: `${input.domain}_source_not_configured`,
      exactWording: input.reason,
      normalizedValue: null,
      domain: input.domain,
      locatorStatus: 'official_source_unavailable',
      sourceKind: 'official_planning_page',
      authorityLevel: 'unknown',
      authorityName: input.authorityName ?? null,
      sourceName: input.sourceJurisdiction || 'Official zoning source',
      sourceUrl: null,
      sourceJurisdiction: input.sourceJurisdiction,
      sourceTier: 'official_county_state',
      confidence: 'unknown',
      retrievedAt: new Date().toISOString(),
    }],
    artifacts: [],
    requestKey: `unconfigured:${input.domain}:${input.identity.id}`,
  };
}

/**
 * Explicit Operator rebuild: live jurisdiction determination from official
 * boundary layers, official zoning-map and ordinance retrieval through the
 * configured reusable adapters, honest partial results when a source is
 * unavailable, then one versioned Analyst snapshot. Never triggered by GET.
 */
export async function synchronizeZoningLandUseForDeal(input: {
  dealCardId: number;
  actor: string;
  changeReason: string;
}): Promise<ZoningReadModel> {
  const deal = getDealCard(input.dealCardId);
  if (!deal) throw new Error('Deal Card not found.');
  let identity = readCurrentPropertyIdentity(input.dealCardId);
  if (!identity) {
    synchronizePropertySummaryForDeal({
      dealCardId: input.dealCardId,
      actor: input.actor,
      changeReason: 'Established the versioned property identity before zoning research.',
    });
    identity = readCurrentPropertyIdentity(input.dealCardId);
  }
  if (!identity) throw new Error('The versioned subject property identity could not be established.');
  const jurisdictionLabel = [identity.county ? `${identity.county} County` : null, identity.state].filter(Boolean).join(', ');

  if (identity.status !== 'confirmed') {
    // Unconfirmed identity: every domain records an honest blocked result.
    return synchronizeZoningSlice({
      identity,
      collectors: [],
      changeReason: input.changeReason,
      generatedBy: input.actor,
    });
  }

  const geometry = parcelGeometry(identity);
  const config: ZoningJurisdictionConfig | null = findZoningJurisdictionConfig(identity.county ?? undefined, identity.state ?? undefined);
  let determination: JurisdictionDetermination | null = null;

  // 1) Jurisdiction: official boundary layers (national defaults + config).
  await runTrackedZoningCollector({
    identity,
    domain: 'jurisdiction_authority',
    sourceJurisdiction: jurisdictionLabel,
    adapter: createBoundaryAdapter({
      geometry,
      config,
      onDetermination(result) { determination = result; },
    }),
    requestKey: `live:${identity.id}:jurisdiction_authority:r${liveRetryOrdinal(identity.id, 'jurisdiction_authority')}`,
    timeoutMs: COLLECTOR_TIMEOUT_MS,
  });
  determination = determination ?? readPersistedDetermination(identity);
  const authorityName = determination?.controllingAuthorityName ?? null;
  const authorityLevel = determination?.controllingAuthorityLevel ?? 'unknown';

  // 2) Official zoning map for the controlling authority.
  const extraCollectors: ZoningCollectorInput[] = [];
  const zoningGis = config?.zoningGis
    ?? (() => {
      const registry = zoningGisFromCountyRegistry(identity.county ?? undefined, identity.state ?? undefined);
      if (!registry || authorityLevel === 'municipality') return null;
      return {
        sourceName: `${jurisdictionLabel} official county GIS zoning layer`,
        layerUrl: registry.layerUrl,
        codeField: 'ZONING',
        overlayLayers: registry.overlays.map((overlay) => ({ name: overlay.name, url: overlay.url, nameField: 'NAME' })),
      };
    })();
  if (zoningGis) {
    await runTrackedZoningCollector({
      identity,
      domain: 'zoning_district',
      sourceJurisdiction: jurisdictionLabel,
      adapter: createArcgisZoningAdapter({
        geometry,
        config: zoningGis,
        authorityName,
        authorityLevel,
      }),
      requestKey: `live:${identity.id}:zoning_district:r${liveRetryOrdinal(identity.id, 'zoning_district')}`,
      timeoutMs: COLLECTOR_TIMEOUT_MS,
    });
  } else {
    extraCollectors.push(unavailableCollector({
      identity,
      domain: 'zoning_district',
      sourceJurisdiction: jurisdictionLabel,
      authorityName,
      reason: `No official zoning-map source is configured yet for ${authorityName ?? jurisdictionLabel ?? 'this jurisdiction'}; the district cannot be stated without the authority's own map or parcel lookup.`,
    }));
  }
  const districtCode = readPersistedDistrictCode(identity);

  // 3) Governing ordinance, use permissions, dimensional standards.
  const ordinanceDomains: ZoningDomain[] = ['zoning_ordinance', 'permitted_uses', 'dimensional_standards'];
  if (config?.ordinance) {
    for (const domain of ordinanceDomains) {
      await runTrackedZoningCollector({
        identity,
        domain,
        sourceJurisdiction: jurisdictionLabel,
        adapter: createOrdinanceDocumentAdapter({
          config: config.ordinance,
          districtCode,
          authorityName,
          authorityLevel,
          emitDomains: [domain],
        }),
        requestKey: `live:${identity.id}:${domain}:d${districtCode ?? 'none'}:r${liveRetryOrdinal(identity.id, domain)}`,
        timeoutMs: COLLECTOR_TIMEOUT_MS,
      });
    }
  } else {
    for (const domain of ordinanceDomains) {
      extraCollectors.push(unavailableCollector({
        identity,
        domain,
        sourceJurisdiction: jurisdictionLabel,
        authorityName,
        reason: `No official ordinance source is configured yet for ${authorityName ?? jurisdictionLabel ?? 'this jurisdiction'}; uses and standards are not stated without the governing ordinance text.`,
      }));
    }
  }

  // Persist honest placeholders for unconfigured domains, then snapshot.
  return synchronizeZoningSlice({
    identity,
    collectors: extraCollectors,
    changeReason: input.changeReason,
    generatedBy: input.actor,
  });
}

/** SELECT-only read adapter for the Deal Card route. */
export function readZoningLandUseForDeal(dealCardId: number): ZoningReadModel | null {
  return getZoningReadModel(dealCardId);
}

/** Test/QA helper: persist externally collected zoning results (fixtures). */
export function persistZoningFixtureCollector(input: ZoningCollectorInput): ReturnType<typeof persistZoningCollector> {
  return persistZoningCollector(input);
}
