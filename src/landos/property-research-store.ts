// Canonical property-research record and monotonic provider-lane persistence.
//
// One row belongs to one Property Card. Provider attempts are append-only, while
// the canonical JSON is a monotonic projection: failures, blanks, context-only
// observations, and weaker evidence can never erase a stronger retained fact.

import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';
import {
  type CanonicalPropertyInput,
  type NormalizedPropertyEvidence,
  type PropertyEvidenceStrength,
  type PropertyProviderResult,
  type PropertyProviderStatus,
  validatePropertyProviderResult,
} from './property-intelligence-contract.js';
import { apnEquivalent } from './property-intelligence-snapshot.js';
import { EXACT_ADDRESS_LANE_ID } from './exact-address-web-discovery.js';
import {
  saveSubjectListingDetail,
  type SubjectListingDiscoveryResult,
} from './subject-listing-store.js';
import { upsertNormalizedComp } from './comps.js';

const STRENGTH: Readonly<Record<PropertyEvidenceStrength, number>> = {
  context_only: 0,
  provider_observed: 1,
  provider_verified: 2,
  official_record: 3,
  operator_accepted: 4,
};

const STATUS_STRENGTH: Readonly<Record<PropertyProviderStatus, number>> = {
  failed: 0,
  unavailable: 0,
  not_applicable: 1,
  context_only: 2,
  verified: 3,
};

export interface CanonicalProviderLane {
  laneId: string;
  providerId: string;
  retainedStatus: PropertyProviderStatus;
  retainedRunId: string;
  retainedAt: string;
  latestAttemptStatus: PropertyProviderStatus;
  latestAttemptRunId: string;
  latestAttemptAt: string;
  latestFailureReason: string | null;
  durationMs: number;
}

export interface RejectedPropertyEvidence {
  evidenceId: string;
  laneId: string;
  providerId: string;
  runId: string;
  rejectedAt: string;
  reason: string;
}

export interface CanonicalPropertyResearchRecord {
  contractVersion: 'canonical-property-research-v1';
  propertyCardId: number;
  dealCardId: number;
  canonicalKey: string;
  identity: CanonicalPropertyInput;
  /** Best retained fact for each field. Conflicting source evidence remains in evidence[]. */
  facts: Record<string, NormalizedPropertyEvidence>;
  evidence: NormalizedPropertyEvidence[];
  lanes: Record<string, CanonicalProviderLane>;
  rejectedEvidence: RejectedPropertyEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalMergeResult {
  accepted: boolean;
  record: CanonicalPropertyResearchRecord;
  retainedEvidenceCount: number;
  rejectedEvidenceCount: number;
  reasons: string[];
}

function compactAddress(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function blank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function canonicalKey(input: CanonicalPropertyInput): string {
  return `property-card:${input.propertyCardId}`;
}

function subjectAddress(input: CanonicalPropertyInput): string {
  return [input.address.trim(), input.city?.trim(), [input.state?.trim(), input.zip?.trim()].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

function exactAddressResult(result: PropertyProviderResult): SubjectListingDiscoveryResult | null {
  if (result.laneId !== EXACT_ADDRESS_LANE_ID) return null;
  const value = result.execution.result as Partial<SubjectListingDiscoveryResult> | null;
  if (!value || !Array.isArray(value.queries) || !Array.isArray(value.pages)) return null;
  if (!['retrieved', 'none', 'blocked', 'error'].includes(String(value.status))) return null;
  return {
    status: value.status as SubjectListingDiscoveryResult['status'],
    queries: value.queries.filter((query): query is string => typeof query === 'string'),
    pages: value.pages,
    note: typeof value.note === 'string' ? value.note : '',
  };
}

function sameCanonicalProperty(a: CanonicalPropertyInput, b: CanonicalPropertyInput): boolean {
  if (a.propertyCardId !== b.propertyCardId || a.dealCardId !== b.dealCardId) return false;
  if (a.apn && b.apn && !apnEquivalent(a.apn, b.apn)) return false;
  const addressA = compactAddress(a.normalizedAddress || a.address);
  const addressB = compactAddress(b.normalizedAddress || b.address);
  if (addressA && addressB && addressA !== addressB) return false;
  if (a.landPortalPropertyId && b.landPortalPropertyId && a.landPortalPropertyId !== b.landPortalPropertyId) return false;
  return true;
}

function evidenceKey(item: NormalizedPropertyEvidence): string {
  return item.id || `${item.providerId}|${item.kind}|${item.field}|${item.sourceUrl ?? ''}|${item.retrievedAt}`;
}

function strongerEvidence(
  incoming: NormalizedPropertyEvidence,
  retained: NormalizedPropertyEvidence,
): boolean {
  if (incoming.subjectClassification === 'context_only' && retained.subjectClassification === 'verified_subject') return false;
  if (incoming.subjectClassification === 'verified_subject' && retained.subjectClassification === 'context_only') return true;
  const incomingStrength = STRENGTH[incoming.strength];
  const retainedStrength = STRENGTH[retained.strength];
  if (incomingStrength !== retainedStrength) return incomingStrength > retainedStrength;
  return incoming.retrievedAt >= retained.retrievedAt;
}

function initialRecord(result: PropertyProviderResult): CanonicalPropertyResearchRecord {
  const at = result.execution.completedAt;
  return {
    contractVersion: 'canonical-property-research-v1',
    propertyCardId: result.input.propertyCardId,
    dealCardId: result.input.dealCardId,
    canonicalKey: canonicalKey(result.input),
    identity: result.input,
    facts: {},
    evidence: [],
    lanes: {},
    rejectedEvidence: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function mergeCanonicalPropertyResearch(
  retained: CanonicalPropertyResearchRecord | null,
  result: PropertyProviderResult,
): CanonicalMergeResult {
  const violations = validatePropertyProviderResult(result);
  const base = retained ?? initialRecord(result);
  const reasons = [...violations];
  if (retained && !sameCanonicalProperty(retained.identity, result.input)) {
    reasons.push('incoming provider result belongs to a different canonical property');
  }
  if (reasons.length) {
    return { accepted: false, record: base, retainedEvidenceCount: 0, rejectedEvidenceCount: result.evidence.length, reasons };
  }

  const next: CanonicalPropertyResearchRecord = {
    ...base,
    identity: {
      ...base.identity,
      // Identity fields are fill-only here. An accepted identity reconciliation
      // is the only layer allowed to change a populated canonical value.
      city: base.identity.city || result.input.city,
      county: base.identity.county || result.input.county,
      state: base.identity.state || result.input.state,
      zip: base.identity.zip || result.input.zip,
      apn: base.identity.apn || result.input.apn,
      fips: base.identity.fips || result.input.fips,
      landPortalPropertyId: base.identity.landPortalPropertyId || result.input.landPortalPropertyId,
    },
    facts: { ...base.facts },
    evidence: [...base.evidence],
    lanes: { ...base.lanes },
    rejectedEvidence: [...base.rejectedEvidence],
    updatedAt: result.execution.completedAt,
  };

  const duplicateHashes = new Set(next.evidence.map((item) => item.artifactHash).filter((value): value is string => !!value));
  const index = new Map(next.evidence.map((item, idx) => [evidenceKey(item), idx]));
  let retainedEvidenceCount = 0;
  let rejectedEvidenceCount = 0;

  for (const item of result.evidence) {
    let rejectReason: string | null = null;
    if (blank(item.value)) rejectReason = 'blank evidence cannot overwrite a retained value';
    else if (!item.validation.valid) rejectReason = item.validation.reasons.join(' ') || 'evidence validation failed';
    else if (item.subjectClassification === 'no_match') rejectReason = 'no-match evidence cannot populate the subject record';
    else if (item.artifactHash && duplicateHashes.has(item.artifactHash) && !index.has(evidenceKey(item))) rejectReason = 'duplicate artifact already retained';
    if (rejectReason) {
      rejectedEvidenceCount += 1;
      next.rejectedEvidence.push({
        evidenceId: item.id,
        laneId: result.laneId,
        providerId: result.providerId,
        runId: result.runId,
        rejectedAt: result.execution.completedAt,
        reason: rejectReason,
      });
      continue;
    }

    const key = evidenceKey(item);
    const heldIndex = index.get(key);
    if (heldIndex == null) {
      index.set(key, next.evidence.length);
      next.evidence.push(item);
      if (item.artifactHash) duplicateHashes.add(item.artifactHash);
      retainedEvidenceCount += 1;
    } else if (strongerEvidence(item, next.evidence[heldIndex])) {
      next.evidence[heldIndex] = item;
      retainedEvidenceCount += 1;
    }

    if (item.kind === 'fact' || item.kind === 'estimate') {
      const held = next.facts[item.field];
      if (!held || strongerEvidence(item, held)) next.facts[item.field] = item;
    }
  }

  const priorLane = next.lanes[result.laneId];
  const retainIncomingLane = !priorLane || STATUS_STRENGTH[result.status] >= STATUS_STRENGTH[priorLane.retainedStatus];
  next.lanes[result.laneId] = {
    laneId: result.laneId,
    providerId: result.providerId,
    retainedStatus: retainIncomingLane ? result.status : priorLane.retainedStatus,
    retainedRunId: retainIncomingLane ? result.runId : priorLane.retainedRunId,
    retainedAt: retainIncomingLane ? result.execution.completedAt : priorLane.retainedAt,
    latestAttemptStatus: result.status,
    latestAttemptRunId: result.runId,
    latestAttemptAt: result.execution.completedAt,
    latestFailureReason: result.failureReason,
    durationMs: result.execution.durationMs,
  };

  return { accepted: true, record: next, retainedEvidenceCount, rejectedEvidenceCount, reasons: [] };
}

let ensuredDb: unknown = null;

function ensureTables(): void {
  const db = getLandosDb();
  if (ensuredDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_property_research_record (
      property_card_id INTEGER PRIMARY KEY,
      deal_card_id INTEGER NOT NULL,
      canonical_key TEXT NOT NULL UNIQUE,
      record_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_landos_property_research_deal
      ON landos_property_research_record(deal_card_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS landos_property_research_lane_attempt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      property_card_id INTEGER NOT NULL,
      deal_card_id INTEGER NOT NULL,
      lane_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      failure_reason TEXT,
      result_json TEXT NOT NULL,
      persistence_json TEXT NOT NULL,
      UNIQUE(run_id, lane_id, provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_property_research_lane_scope
      ON landos_property_research_lane_attempt(property_card_id, completed_at DESC);
  `);
  ensuredDb = db;
}

function parseRecord(value: unknown): CanonicalPropertyResearchRecord | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as CanonicalPropertyResearchRecord;
    return parsed?.contractVersion === 'canonical-property-research-v1' ? parsed : null;
  } catch {
    return null;
  }
}

export function resetPropertyResearchStoreCache(): void {
  ensuredDb = null;
}
function persistSoldImprovedEvidence(
  db: Database.Database,
  result: PropertyProviderResult,
  retained: NormalizedPropertyEvidence[],
): void {
  const retainedIds = new Set(retained.map((item) => item.id));
  const deal = db.prepare('SELECT entity FROM landos_deal_card WHERE id = ?').get(result.input.dealCardId) as { entity?: string } | undefined;
  const entity = (deal?.entity || 'TY_LAND_BIZ') as Parameters<typeof upsertNormalizedComp>[0]['entity'];
  for (const item of result.evidence) {
    if (item.kind !== 'comp' || !retainedIds.has(item.id)) continue;
    const value = item.value && typeof item.value === 'object' ? item.value as Record<string, unknown> : {};
    const status = String(value.status ?? '').toLowerCase();
    const price = typeof value.price === 'number' && value.price > 0 ? value.price : null;
    const sqft = typeof value.buildingSqft === 'number' && value.buildingSqft > 0
      ? value.buildingSqft
      : typeof value.homeSizeSqft === 'number' && value.homeSizeSqft > 0 ? value.homeSizeSqft : null;
    const typeText = [value.propertyType, value.description].filter((v): v is string => typeof v === 'string').join(' ');
    const improved = sqft != null || /\b(?:single[- ]family|house|home|residence|dwelling|condo|townhouse|bed(?:room)?s?|bath(?:room)?s?)\b/i.test(typeText);
    if (status !== 'sold' || price == null || sqft == null || !improved) continue;
    const address = typeof value.address === 'string' ? value.address.trim() : '';
    if (!address) continue;
    const sourceUrl = typeof value.url === 'string' && value.url ? value.url : item.sourceUrl;
    const acres = typeof value.acres === 'number' && value.acres > 0 ? value.acres : undefined;
    const notes = [
      `building ${Math.round(sqft).toLocaleString('en-US')} sqft`,
      typeof value.notes === 'string' ? value.notes : null,
      typeof value.caveat === 'string' ? value.caveat : null,
      typeof value.discrepancies === 'string' ? value.discrepancies : null,
    ].filter((v): v is string => !!v).join('. ');
    upsertNormalizedComp({
      entity,
      dealCardId: result.input.dealCardId,
      cardId: result.input.propertyCardId,
      sourceLabel: result.providerId as Parameters<typeof upsertNormalizedComp>[0]['sourceLabel'],
      canonicalSource: result.providerId,
      sourceUrl: sourceUrl ?? undefined,
      addressDesc: address,
      state: typeof value.state === 'string' ? value.state : result.input.state ?? undefined,
      city: typeof value.city === 'string' ? value.city : result.input.city ?? undefined,
      zip: typeof value.zip === 'string' ? value.zip : result.input.zip ?? undefined,
      price,
      priceKind: 'sale',
      saleOrListDate: typeof value.saleDate === 'string' ? value.saleDate : undefined,
      acres,
      notes,
      addedBy: `provider/${result.providerId}`,
      status: 'verified_sale',
      propertyClass: 'improved',
      classification: typeof value.propertyType === 'string' ? value.propertyType : 'improved',
      sourceAttributions: [{ provider: result.providerId, url: sourceUrl ?? null }],
      canonicalKey: `sold-improved:${address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`,
    });
  }
}


export class PropertyResearchStore {
  loadForProperty(propertyCardId: number): CanonicalPropertyResearchRecord | null {
    ensureTables();
    const row = getLandosDb().prepare(
      'SELECT record_json FROM landos_property_research_record WHERE property_card_id = ?',
    ).get(propertyCardId) as { record_json?: string } | undefined;
    return parseRecord(row?.record_json);
  }

  loadForDeal(dealCardId: number): CanonicalPropertyResearchRecord[] {
    ensureTables();
    const rows = getLandosDb().prepare(
      'SELECT record_json FROM landos_property_research_record WHERE deal_card_id = ? ORDER BY updated_at DESC',
    ).all(dealCardId) as Array<{ record_json?: string }>;
    return rows.map((row) => parseRecord(row.record_json)).filter((row): row is CanonicalPropertyResearchRecord => !!row);
  }

  persistProviderResult(result: PropertyProviderResult): PropertyProviderResult {
    ensureTables();
    const db = getLandosDb();
    const current = this.loadForProperty(result.input.propertyCardId);
    const merged = mergeCanonicalPropertyResearch(current, result);
    let persistence = {
      attempted: true,
      persisted: merged.accepted,
      retainedEvidenceCount: merged.retainedEvidenceCount,
      rejectedEvidenceCount: merged.rejectedEvidenceCount,
      reason: merged.reasons.join(' ') || null,
    };
    const apply = db.transaction(() => {
      const discovery = merged.accepted ? exactAddressResult(result) : null;
      if (discovery) {
        const subjectListingWrite = saveSubjectListingDetail({
          propertyCardId: result.input.propertyCardId,
          dealCardId: result.input.dealCardId,
          canonicalAddress: subjectAddress(result.input),
          completedAtIso: result.execution.completedAt,
          result: discovery,
        });
        persistence = {
          ...persistence,
          persisted: persistence.persisted && subjectListingWrite.persisted,
          reason: subjectListingWrite.reason,
        };
      }
      db.prepare(`
        INSERT INTO landos_property_research_lane_attempt (
          run_id, property_card_id, deal_card_id, lane_id, provider_id, status,
          started_at, completed_at, duration_ms, failure_reason, result_json, persistence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, lane_id, provider_id) DO UPDATE SET
          status=excluded.status, completed_at=excluded.completed_at,
          duration_ms=excluded.duration_ms, failure_reason=excluded.failure_reason,
          result_json=excluded.result_json, persistence_json=excluded.persistence_json
      `).run(
        result.runId,
        result.input.propertyCardId,
        result.input.dealCardId,
        result.laneId,
        result.providerId,
        result.status,
        result.execution.startedAt,
        result.execution.completedAt,
        result.execution.durationMs,
        result.failureReason,
        JSON.stringify(result),
        JSON.stringify(persistence),
      );
      if (!merged.accepted) return;
      persistSoldImprovedEvidence(db, result, merged.record.evidence);
      db.prepare(`
        INSERT INTO landos_property_research_record (
          property_card_id, deal_card_id, canonical_key, record_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(property_card_id) DO UPDATE SET
          deal_card_id=excluded.deal_card_id,
          canonical_key=excluded.canonical_key,
          record_json=excluded.record_json,
          updated_at=excluded.updated_at
      `).run(
        merged.record.propertyCardId,
        merged.record.dealCardId,
        merged.record.canonicalKey,
        JSON.stringify(merged.record),
        merged.record.createdAt,
        merged.record.updatedAt,
      );
    });
    apply();
    return { ...result, persistence };
  }

  listLaneAttempts(propertyCardId: number): PropertyProviderResult[] {
    ensureTables();
    const rows = getLandosDb().prepare(`
      SELECT result_json, persistence_json
      FROM landos_property_research_lane_attempt
      WHERE property_card_id = ? ORDER BY completed_at ASC, id ASC
    `).all(propertyCardId) as Array<{ result_json: string; persistence_json: string }>;
    return rows.flatMap((row) => {
      try {
        const result = JSON.parse(row.result_json) as PropertyProviderResult;
        result.persistence = JSON.parse(row.persistence_json);
        return [result];
      } catch {
        return [];
      }
    });
  }
}

