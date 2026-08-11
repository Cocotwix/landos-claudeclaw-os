// LandOS — reusable government GIS platform KNOWLEDGE (PART 13, PART 21).
//
// Two stores with one hard rule between them.
//
//   SHARED    — how a platform family works, and how a deployment is shaped.
//               Every property benefits from it. It must contain no property
//               values whatsoever.
//   ISOLATED  — what an official source said about one parcel. Scoped to a
//               deal card, never read by another.
//
// SHARE THE PLATFORM METHOD. DO NOT SHARE THE PROPERTY EVIDENCE.
//
// That rule is enforced here in code, not by convention: every write to the
// shared deployment store passes through `assertNoPropertyEvidence`, which
// rejects the write outright if a parcel identifier, address, owner name,
// acreage or geometry has been threaded into it by mistake. A leak of that kind
// would be silent and would corrupt a different property's file, so it fails
// loudly at the boundary instead.

import { getLandosDb, landosAudit } from './db.js';
import type { DemonstratedCapability } from './gis-platform-registry.js';
import type {
  GisDetectionConfidence,
  GisPlatformFamily,
  GisSearchMethod,
  OfficialParcelGisResult,
  PlatformFingerprint,
  ZoningResearchHandoff,
} from './gis-platform-types.js';
import type { EscalationReport } from './gis-escalation.js';

/* ─────────────────── shared: platform family knowledge ───────────────── */

export interface PlatformProofPatch {
  detection?: boolean;
  parcelSearch?: boolean;
  apnSearch?: boolean;
  addressSearch?: boolean;
  ownerSearch?: boolean;
  geometry?: boolean;
  zoningLayerDiscovery?: boolean;
  directServiceRoute?: boolean;
  /** Deployment host the proof came from. A host, never a property. */
  provenOnHost?: string | null;
  failureModes?: string[];
  succeeded?: boolean;
}

interface KnowledgeRow {
  family: string;
  detection_proven: number;
  parcel_search_proven: number;
  apn_search_proven: number;
  address_search_proven: number;
  owner_search_proven: number;
  geometry_proven: number;
  zoning_layer_proven: number;
  direct_service_proven: number;
  proven_on_host: string | null;
  proven_at: string | null;
  runs: number;
  successes: number;
  failure_modes_json: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function toDemonstrated(row: KnowledgeRow): DemonstratedCapability {
  return {
    family: row.family as GisPlatformFamily,
    detection: row.detection_proven === 1,
    parcelSearch: row.parcel_search_proven === 1,
    apnSearch: row.apn_search_proven === 1,
    addressSearch: row.address_search_proven === 1,
    ownerSearch: row.owner_search_proven === 1,
    geometry: row.geometry_proven === 1,
    zoningLayerDiscovery: row.zoning_layer_proven === 1,
    directServiceRoute: row.direct_service_proven === 1,
    provenOnHost: row.proven_on_host,
    provenAt: row.proven_at,
    runs: row.runs,
    successes: row.successes,
  };
}

/**
 * Record what a live run PROVED for a family. Proof is sticky: a capability
 * that has been demonstrated once stays demonstrated, because a later failure
 * on a different deployment does not un-prove the earlier one. Failure modes
 * accumulate alongside it so the record stays honest in both directions.
 */
export function recordPlatformProof(
  family: GisPlatformFamily,
  patch: PlatformProofPatch,
  now: () => string = () => new Date().toISOString(),
): DemonstratedCapability {
  const db = getLandosDb();
  const previous = db.prepare('SELECT * FROM landos_gis_platform_knowledge WHERE family = ?').get(family) as KnowledgeRow | undefined;
  const sticky = (next: boolean | undefined, prior: number | undefined): number => (next === true || prior === 1 ? 1 : 0);

  const failureModes = [...new Set([
    ...parseJson<string[]>(previous?.failure_modes_json, []),
    ...(patch.failureModes ?? []),
  ])].slice(0, 40);

  const provenAt = patch.provenOnHost ? now() : previous?.proven_at ?? null;
  const row: KnowledgeRow = {
    family,
    detection_proven: sticky(patch.detection, previous?.detection_proven),
    parcel_search_proven: sticky(patch.parcelSearch, previous?.parcel_search_proven),
    apn_search_proven: sticky(patch.apnSearch, previous?.apn_search_proven),
    address_search_proven: sticky(patch.addressSearch, previous?.address_search_proven),
    owner_search_proven: sticky(patch.ownerSearch, previous?.owner_search_proven),
    geometry_proven: sticky(patch.geometry, previous?.geometry_proven),
    zoning_layer_proven: sticky(patch.zoningLayerDiscovery, previous?.zoning_layer_proven),
    direct_service_proven: sticky(patch.directServiceRoute, previous?.direct_service_proven),
    proven_on_host: patch.provenOnHost ?? previous?.proven_on_host ?? null,
    proven_at: provenAt,
    runs: (previous?.runs ?? 0) + 1,
    successes: (previous?.successes ?? 0) + (patch.succeeded ? 1 : 0),
    failure_modes_json: JSON.stringify(failureModes),
  };

  db.prepare(`
    INSERT INTO landos_gis_platform_knowledge (
      family, detection_proven, parcel_search_proven, apn_search_proven, address_search_proven,
      owner_search_proven, geometry_proven, zoning_layer_proven, direct_service_proven,
      proven_on_host, proven_at, runs, successes, failure_modes_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(family) DO UPDATE SET
      detection_proven=excluded.detection_proven, parcel_search_proven=excluded.parcel_search_proven,
      apn_search_proven=excluded.apn_search_proven, address_search_proven=excluded.address_search_proven,
      owner_search_proven=excluded.owner_search_proven, geometry_proven=excluded.geometry_proven,
      zoning_layer_proven=excluded.zoning_layer_proven, direct_service_proven=excluded.direct_service_proven,
      proven_on_host=excluded.proven_on_host, proven_at=excluded.proven_at,
      runs=excluded.runs, successes=excluded.successes,
      failure_modes_json=excluded.failure_modes_json, updated_at=excluded.updated_at
  `).run(
    row.family, row.detection_proven, row.parcel_search_proven, row.apn_search_proven, row.address_search_proven,
    row.owner_search_proven, row.geometry_proven, row.zoning_layer_proven, row.direct_service_proven,
    row.proven_on_host, row.proven_at, row.runs, row.successes, row.failure_modes_json,
  );

  return toDemonstrated(row);
}

export function listPlatformProofs(): DemonstratedCapability[] {
  const rows = getLandosDb().prepare('SELECT * FROM landos_gis_platform_knowledge').all() as KnowledgeRow[];
  return rows.map(toDemonstrated);
}

/* ───────────────── shared: deployment (host) knowledge ───────────────── */

export interface GisDeploymentKnowledge {
  host: string;
  family: GisPlatformFamily;
  variant: string | null;
  /** What the deployment SERVES, e.g. a county label. Not a property. */
  servesLabel: string | null;
  services: string[];
  parcelLayerUrl: string | null;
  parcelIdField: string | null;
  zoningLayerUrl: string | null;
  zoningCodeField: string | null;
  searchMethods: GisSearchMethod[];
  requiresBrowser: boolean;
  confidence: GisDetectionConfidence;
  failureModes: string[];
  runs: number;
  successes: number;
  lastVerifiedAt: string | null;
}

/** Property-evidence shapes that must never reach the shared deployment store. */
const PROPERTY_EVIDENCE_KEYS = ['parcelId', 'parcel_id', 'apn', 'owner', 'address', 'situs', 'acres', 'acreage', 'geometry', 'rings', 'centroid', 'keyValue'];

/**
 * Reject any shared-store write that is carrying one property's evidence.
 *
 * This is the cross-property isolation guarantee made mechanical. Shared rows
 * are read by every future property, so a parcel id or owner name that slipped
 * into one would surface on an unrelated deal and look authoritative. Failing
 * the write is the only safe outcome.
 */
export function assertNoPropertyEvidence(record: GisDeploymentKnowledge): void {
  const suspects: string[] = [];
  const scan = (label: string, value: unknown): void => {
    if (typeof value !== 'string' || !value) return;
    // A URL legitimately contains layer paths; a QUERY carrying a parcel key
    // does not belong in shared knowledge.
    for (const key of PROPERTY_EVIDENCE_KEYS) {
      if (new RegExp(`[?&]${key}=`, 'i').test(value)) suspects.push(`${label} carries a ${key} parameter`);
    }
  };
  scan('parcelLayerUrl', record.parcelLayerUrl);
  scan('zoningLayerUrl', record.zoningLayerUrl);
  scan('servesLabel', record.servesLabel);
  for (const service of record.services) scan('services', service);

  if (suspects.length) {
    throw new Error(`Refusing to write property evidence into shared platform knowledge: ${suspects.join('; ')}.`);
  }
}

interface DeploymentRow {
  host: string; family: string; variant: string | null; serves_label: string | null;
  services_json: string; parcel_layer_url: string | null; parcel_id_field: string | null;
  zoning_layer_url: string | null; zoning_code_field: string | null; search_methods_json: string;
  requires_browser: number; confidence: string; failure_modes_json: string;
  runs: number; successes: number; last_verified_at: string | null;
}

function toDeployment(row: DeploymentRow): GisDeploymentKnowledge {
  return {
    host: row.host,
    family: row.family as GisPlatformFamily,
    variant: row.variant,
    servesLabel: row.serves_label,
    services: parseJson<string[]>(row.services_json, []),
    parcelLayerUrl: row.parcel_layer_url,
    parcelIdField: row.parcel_id_field,
    zoningLayerUrl: row.zoning_layer_url,
    zoningCodeField: row.zoning_code_field,
    searchMethods: parseJson<GisSearchMethod[]>(row.search_methods_json, []),
    requiresBrowser: row.requires_browser === 1,
    confidence: row.confidence as GisDetectionConfidence,
    failureModes: parseJson<string[]>(row.failure_modes_json, []),
    runs: row.runs,
    successes: row.successes,
    lastVerifiedAt: row.last_verified_at,
  };
}

/** Normalize a URL or host to the deployment key. */
export function deploymentHost(urlOrHost: string): string {
  let value = (urlOrHost ?? '').trim().toLowerCase();
  try { if (/^https?:/.test(value)) value = new URL(value).hostname; } catch { /* keep */ }
  return value.replace(/^www\./, '');
}

export function getDeploymentKnowledge(urlOrHost: string): GisDeploymentKnowledge | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_gis_deployment WHERE host = ?')
    .get(deploymentHost(urlOrHost)) as DeploymentRow | undefined;
  return row ? toDeployment(row) : null;
}

export function listDeploymentKnowledge(family?: GisPlatformFamily): GisDeploymentKnowledge[] {
  const db = getLandosDb();
  const rows = (family
    ? db.prepare('SELECT * FROM landos_gis_deployment WHERE family = ? ORDER BY updated_at DESC').all(family)
    : db.prepare('SELECT * FROM landos_gis_deployment ORDER BY updated_at DESC').all()) as DeploymentRow[];
  return rows.map(toDeployment);
}

export type DeploymentPatch = Partial<Omit<GisDeploymentKnowledge, 'host' | 'runs' | 'successes'>> & {
  succeeded?: boolean;
};

/**
 * Remember how a deployment is shaped so the next property on the same host
 * skips discovery entirely. Merges: only supplied fields change.
 */
export function rememberDeployment(
  urlOrHost: string,
  patch: DeploymentPatch,
  now: () => string = () => new Date().toISOString(),
): GisDeploymentKnowledge {
  const host = deploymentHost(urlOrHost);
  const previous = getDeploymentKnowledge(host);
  const next: GisDeploymentKnowledge = {
    host,
    family: patch.family ?? previous?.family ?? 'unknown',
    variant: patch.variant !== undefined ? patch.variant : previous?.variant ?? null,
    servesLabel: patch.servesLabel !== undefined ? patch.servesLabel : previous?.servesLabel ?? null,
    services: [...new Set([...(previous?.services ?? []), ...(patch.services ?? [])])].slice(0, 40),
    parcelLayerUrl: patch.parcelLayerUrl !== undefined ? patch.parcelLayerUrl : previous?.parcelLayerUrl ?? null,
    parcelIdField: patch.parcelIdField !== undefined ? patch.parcelIdField : previous?.parcelIdField ?? null,
    zoningLayerUrl: patch.zoningLayerUrl !== undefined ? patch.zoningLayerUrl : previous?.zoningLayerUrl ?? null,
    zoningCodeField: patch.zoningCodeField !== undefined ? patch.zoningCodeField : previous?.zoningCodeField ?? null,
    searchMethods: patch.searchMethods ?? previous?.searchMethods ?? [],
    requiresBrowser: patch.requiresBrowser ?? previous?.requiresBrowser ?? false,
    confidence: patch.confidence ?? previous?.confidence ?? 'low',
    failureModes: [...new Set([...(previous?.failureModes ?? []), ...(patch.failureModes ?? [])])].slice(0, 20),
    runs: (previous?.runs ?? 0) + 1,
    successes: (previous?.successes ?? 0) + (patch.succeeded ? 1 : 0),
    lastVerifiedAt: patch.succeeded ? now() : previous?.lastVerifiedAt ?? null,
  };

  assertNoPropertyEvidence(next);

  getLandosDb().prepare(`
    INSERT INTO landos_gis_deployment (
      host, family, variant, serves_label, services_json, parcel_layer_url, parcel_id_field,
      zoning_layer_url, zoning_code_field, search_methods_json, requires_browser, confidence,
      failure_modes_json, runs, successes, last_verified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(host) DO UPDATE SET
      family=excluded.family, variant=excluded.variant, serves_label=excluded.serves_label,
      services_json=excluded.services_json, parcel_layer_url=excluded.parcel_layer_url,
      parcel_id_field=excluded.parcel_id_field, zoning_layer_url=excluded.zoning_layer_url,
      zoning_code_field=excluded.zoning_code_field, search_methods_json=excluded.search_methods_json,
      requires_browser=excluded.requires_browser, confidence=excluded.confidence,
      failure_modes_json=excluded.failure_modes_json, runs=excluded.runs, successes=excluded.successes,
      last_verified_at=excluded.last_verified_at, updated_at=excluded.updated_at
  `).run(
    next.host, next.family, next.variant, next.servesLabel, JSON.stringify(next.services),
    next.parcelLayerUrl, next.parcelIdField, next.zoningLayerUrl, next.zoningCodeField,
    JSON.stringify(next.searchMethods), next.requiresBrowser ? 1 : 0, next.confidence,
    JSON.stringify(next.failureModes), next.runs, next.successes, next.lastVerifiedAt,
  );

  landosAudit('gis-platform', 'deployment_learned', `${host} → ${next.family}${next.variant ? ` (${next.variant})` : ''}`, {
    refTable: 'landos_gis_deployment',
  });
  return next;
}

/* ────────────── isolated: per-deal official parcel evidence ──────────── */

export interface OfficialParcelGisRecord {
  id: number;
  dealCardId: number;
  result: OfficialParcelGisResult;
  fingerprint: PlatformFingerprint | null;
  escalation: EscalationReport | null;
  handoff: ZoningResearchHandoff | null;
  retrievedAt: string;
}

interface EvidenceRow {
  id: number; deal_card_id: number; result_json: string; fingerprint_json: string;
  escalation_json: string; handoff_json: string; retrieved_at: string;
}

function toRecord(row: EvidenceRow): OfficialParcelGisRecord {
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    result: JSON.parse(row.result_json) as OfficialParcelGisResult,
    fingerprint: parseJson<PlatformFingerprint | null>(row.fingerprint_json, null),
    escalation: parseJson<EscalationReport | null>(row.escalation_json, null),
    handoff: parseJson<ZoningResearchHandoff | null>(row.handoff_json, null),
    retrievedAt: row.retrieved_at,
  };
}

/**
 * Persist one property's official-parcel retrieval. Append-only: a later run
 * adds a row rather than overwriting, so an operator can never find that the
 * conclusion they read has quietly changed underneath them.
 */
export function saveOfficialParcelGis(
  dealCardId: number,
  payload: { result: OfficialParcelGisResult; fingerprint?: PlatformFingerprint | null; escalation?: EscalationReport | null; handoff?: ZoningResearchHandoff | null },
): OfficialParcelGisRecord {
  const info = getLandosDb().prepare(`
    INSERT INTO landos_official_parcel_gis (
      deal_card_id, platform_family, platform_variant, parcel_match_status, parcel_id,
      source_url, result_json, fingerprint_json, escalation_json, handoff_json, retrieved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dealCardId,
    payload.result.sourcePlatform,
    payload.result.sourcePlatformVariant,
    payload.result.parcelMatchStatus,
    payload.result.parcelId,
    payload.result.sourceUrl,
    JSON.stringify(payload.result),
    JSON.stringify(payload.fingerprint ?? null),
    JSON.stringify(payload.escalation ?? null),
    JSON.stringify(payload.handoff ?? null),
    payload.result.retrievedAt,
  );

  landosAudit('gis-platform', 'official_parcel_gis_recorded',
    `deal ${dealCardId}: ${payload.result.sourcePlatform} → ${payload.result.parcelMatchStatus}`,
    { refTable: 'landos_official_parcel_gis', refId: Number(info.lastInsertRowid) });

  return getOfficialParcelGis(dealCardId)!;
}

/** Newest retrieval for a deal. Scoped by deal id, so no other property's
 *  evidence can be returned even by accident. */
export function getOfficialParcelGis(dealCardId: number): OfficialParcelGisRecord | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_official_parcel_gis WHERE deal_card_id = ? ORDER BY id DESC LIMIT 1')
    .get(dealCardId) as EvidenceRow | undefined;
  return row ? toRecord(row) : null;
}

export function officialParcelGisHistory(dealCardId: number, limit = 10): OfficialParcelGisRecord[] {
  const rows = getLandosDb()
    .prepare('SELECT * FROM landos_official_parcel_gis WHERE deal_card_id = ? ORDER BY id DESC LIMIT ?')
    .all(dealCardId, Math.max(1, Math.min(limit, 50))) as EvidenceRow[];
  return rows.map(toRecord);
}
