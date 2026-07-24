import { createHash } from 'node:crypto';

import { getLandosDb, landosAudit } from './db.js';
import type {
  CountyRecordsFinding,
  PublicEvidence,
  PublicIntelligenceRun,
  PublicIntelligenceTaskRecord,
} from './public-property-intelligence.js';

export const PROPERTY_IDENTITY_STATUSES = [
  'unresolved',
  'candidate',
  'confirmed',
  'disputed',
  'rejected',
  'archived',
] as const;

export type PropertyIdentityStatus = (typeof PROPERTY_IDENTITY_STATUSES)[number];
export type PropertyCollectorStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'blocked' | 'failed';

export interface PropertyIdentityVersionInput {
  dealCardId: number;
  propertyCardId?: number | null;
  status: PropertyIdentityStatus;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  apn?: string | null;
  owner?: string | null;
  acreage?: number | null;
  geometry?: unknown;
  basis: string;
  confidence: number;
  sourceRefs?: string[];
  changeReason: string;
  createdBy: string;
  /** Explicit operator authority to replace an already-accepted confirmed
   * identity. Automated collectors must leave this false/undefined. */
  allowAcceptedSupersession?: boolean;
}

export interface PropertyIdentityVersion {
  id: number;
  dealCardId: number;
  propertyCardId: number | null;
  version: number;
  status: PropertyIdentityStatus;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acreage: number | null;
  geometry: unknown;
  basis: string;
  confidence: number;
  sourceRefs: string[];
  changeReason: string;
  createdBy: string;
  isCurrent: boolean;
  createdAt: number;
}

export interface PropertySummaryFact {
  key: string;
  value: unknown;
  evidenceId: number;
  sourceName: string;
  sourceUrl: string | null;
  verificationStatus: string;
  retrievedAt: string;
}

export interface PropertySummarySnapshot {
  id: number;
  dealCardId: number;
  version: number;
  identityVersionId: number;
  priorSnapshotId: number | null;
  status: 'current' | 'superseded';
  inputHash: string;
  evidenceMaxId: number | null;
  completeness: {
    identity: 'complete' | 'needs_resolution';
    assessorGis: 'complete' | 'partial' | 'missing' | 'blocked';
    percent: number;
    missing: string[];
  };
  summary: {
    state: 'ready' | 'partial' | 'resolution_required';
    parcelSpecificAllowed: boolean;
    areaContext: {
      address: string | null;
      city: string | null;
      county: string | null;
      state: string | null;
      zip: string | null;
    };
    property: {
      address: string | null;
      city: string | null;
      county: string | null;
      state: string | null;
      zip: string | null;
      apn: string | null;
      owner: string | null;
      acreage: number | null;
    } | null;
    facts: PropertySummaryFact[];
    evidenceCount: number;
    message: string;
  };
  changeReason: string;
  generatedBy: string;
  createdAt: number;
}

export interface PropertyCollectorJobView {
  id: number;
  collectorKey: string;
  status: PropertyCollectorStatus;
  identityVersionId: number;
  attemptCount: number;
  lastError: string | null;
  updatedAt: number;
}

export interface PropertySummaryReadModel {
  identity: PropertyIdentityVersion;
  assessorGisJob: PropertyCollectorJobView | null;
  snapshot: PropertySummarySnapshot | null;
  evidenceCount: number;
}

interface IdentityRow {
  id: number;
  deal_card_id: number;
  property_card_id: number | null;
  version: number;
  status: PropertyIdentityStatus;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acreage: number | null;
  geometry_json: string | null;
  basis: string;
  confidence: number;
  source_refs_json: string;
  change_reason: string;
  created_by: string;
  is_current: number;
  created_at: number;
}

interface SnapshotRow {
  id: number;
  deal_card_id: number;
  version: number;
  property_identity_version_id: number;
  prior_snapshot_id: number | null;
  status: 'current' | 'superseded';
  input_hash: string;
  evidence_max_id: number | null;
  completeness_json: string;
  summary_json: string;
  change_reason: string;
  generated_by: string;
  created_at: number;
}

interface JobRow {
  id: number;
  property_identity_version_id: number;
  collector_key: string;
  status: PropertyCollectorStatus;
  attempt_count: number;
  last_error: string | null;
  updated_at: number;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value === undefined ? null : value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function cleanString(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function cleanNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function identityFromRow(row: IdentityRow): PropertyIdentityVersion {
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    propertyCardId: row.property_card_id,
    version: row.version,
    status: row.status,
    address: row.address,
    city: row.city,
    county: row.county,
    state: row.state,
    zip: row.zip,
    apn: row.apn,
    owner: row.owner,
    acreage: row.acreage,
    geometry: parseJson(row.geometry_json, null),
    basis: row.basis,
    confidence: row.confidence,
    sourceRefs: parseJson<string[]>(row.source_refs_json, []),
    changeReason: row.change_reason,
    createdBy: row.created_by,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
  };
}

function snapshotFromRow(row: SnapshotRow): PropertySummarySnapshot {
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    version: row.version,
    identityVersionId: row.property_identity_version_id,
    priorSnapshotId: row.prior_snapshot_id,
    status: row.status,
    inputHash: row.input_hash,
    evidenceMaxId: row.evidence_max_id,
    completeness: parseJson(row.completeness_json, {
      identity: 'needs_resolution',
      assessorGis: 'missing',
      percent: 0,
      missing: ['Property identity', 'Assessor/GIS evidence'],
    }),
    summary: parseJson(row.summary_json, {
      state: 'resolution_required',
      parcelSpecificAllowed: false,
      areaContext: { address: null, city: null, county: null, state: null, zip: null },
      property: null,
      facts: [],
      evidenceCount: 0,
      message: 'Resolve the subject parcel before property-specific intelligence is shown.',
    }),
    changeReason: row.change_reason,
    generatedBy: row.generated_by,
    createdAt: row.created_at,
  };
}

export function readCurrentPropertyIdentity(dealCardId: number): PropertyIdentityVersion | null {
  const row = getLandosDb().prepare(
    'SELECT * FROM landos_property_identity_version WHERE deal_card_id=? AND is_current=1 LIMIT 1',
  ).get(dealCardId) as IdentityRow | undefined;
  return row ? identityFromRow(row) : null;
}

function comparableIdentity(input: PropertyIdentityVersionInput | PropertyIdentityVersion): Record<string, unknown> {
  return {
    propertyCardId: input.propertyCardId ?? null,
    status: input.status,
    address: cleanString(input.address),
    city: cleanString(input.city),
    county: cleanString(input.county),
    state: cleanString(input.state),
    zip: cleanString(input.zip),
    apn: cleanString(input.apn),
    owner: cleanString(input.owner),
    acreage: cleanNumber(input.acreage),
    geometry: canonicalize('geometry' in input ? input.geometry : null),
    basis: input.basis.trim(),
    confidence: Number.isFinite(input.confidence) ? input.confidence : 0,
    sourceRefs: [...(input.sourceRefs ?? [])].sort(),
  };
}

export function createPropertyIdentityVersion(input: PropertyIdentityVersionInput): PropertyIdentityVersion {
  if (!Number.isInteger(input.dealCardId) || input.dealCardId < 1) throw new Error('A valid Deal Card is required.');
  const db = getLandosDb();
  const existing = readCurrentPropertyIdentity(input.dealCardId);

  // An accepted confirmed identity is operator information. Any later
  // automated difference—whether labelled candidate, disputed, or even another
  // confirmed result—is retained as evidence and cannot replace the accepted
  // owner-facing identity without an explicit operator supersession.
  if (existing?.status === 'confirmed' && !input.allowAcceptedSupersession) {
    return existing;
  }
  if (existing && hash(comparableIdentity(existing)) === hash(comparableIdentity(input))) return existing;

  const create = db.transaction(() => {
    const nextVersion = (db.prepare(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM landos_property_identity_version WHERE deal_card_id=?',
    ).get(input.dealCardId) as { version: number }).version;
    db.prepare(
      'UPDATE landos_property_identity_version SET is_current=0 WHERE deal_card_id=? AND is_current=1',
    ).run(input.dealCardId);
    const result = db.prepare(`
      INSERT INTO landos_property_identity_version (
        deal_card_id, property_card_id, version, status, address, city, county, state, zip,
        apn, owner, acreage, geometry_json, basis, confidence, source_refs_json,
        change_reason, created_by, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      input.dealCardId,
      input.propertyCardId ?? null,
      nextVersion,
      input.status,
      cleanString(input.address),
      cleanString(input.city),
      cleanString(input.county),
      cleanString(input.state),
      cleanString(input.zip),
      cleanString(input.apn),
      cleanString(input.owner),
      cleanNumber(input.acreage),
      input.geometry == null ? null : stableJson(input.geometry),
      input.basis.trim(),
      Number.isFinite(input.confidence) ? input.confidence : 0,
      stableJson([...(input.sourceRefs ?? [])].sort()),
      input.changeReason,
      input.createdBy,
    );
    return result.lastInsertRowid as number;
  });
  const id = create();
  landosAudit(input.createdBy, 'property_identity_version_created', `deal ${input.dealCardId} identity version created`, {
    refTable: 'landos_property_identity_version',
    refId: id,
  });
  return identityFromRow(
    db.prepare('SELECT * FROM landos_property_identity_version WHERE id=?').get(id) as IdentityRow,
  );
}

function jobFromRow(row: JobRow): PropertyCollectorJobView {
  return {
    id: row.id,
    collectorKey: row.collector_key,
    status: row.status,
    identityVersionId: row.property_identity_version_id,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function mapTaskStatus(task: PublicIntelligenceTaskRecord | undefined, identity: PropertyIdentityVersion): PropertyCollectorStatus {
  if (identity.status !== 'confirmed') return 'blocked';
  if (!task) return 'failed';
  if (task.status === 'succeeded') return 'succeeded';
  if (task.status === 'partial' || task.status === 'unavailable') return 'partial';
  if (task.status === 'blocked' || task.status === 'skipped_identity_gate') return 'blocked';
  return 'failed';
}

function evidenceForId(task: PublicIntelligenceTaskRecord, evidenceId: string): PublicEvidence | undefined {
  return task.evidence.find((item) => item.evidenceId === evidenceId);
}

function appendEvidence(input: {
  dealCardId: number;
  identityVersionId: number;
  evidenceKind: string;
  factKey?: string | null;
  rawValue: unknown;
  normalizedValue: unknown;
  sourceName: string;
  sourceUrl?: string | null;
  sourceTier: string;
  verificationStatus: string;
  confidence: string;
  retrievedAt: string;
  effectiveAt?: string | null;
  artifactRef?: string | null;
  idempotencyKey: string;
}): number | null {
  const db = getLandosDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO landos_property_evidence_item (
      deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
      raw_value_json, normalized_value_json, source_name, source_url, source_tier,
      verification_status, confidence, collector_key, retrieved_at, effective_at,
      artifact_ref, idempotency_key
    ) VALUES (?, ?, 'assessor_gis', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assessor_gis', ?, ?, ?, ?)
  `).run(
    input.dealCardId,
    input.identityVersionId,
    input.evidenceKind,
    input.factKey ?? null,
    stableJson(input.rawValue),
    stableJson(input.normalizedValue),
    input.sourceName,
    input.sourceUrl ?? null,
    input.sourceTier,
    input.verificationStatus,
    input.confidence,
    input.retrievedAt,
    input.effectiveAt ?? null,
    input.artifactRef ?? null,
    input.idempotencyKey,
  );
  if (result.changes > 0) return result.lastInsertRowid as number;
  const row = db.prepare(
    'SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?',
  ).get(input.idempotencyKey) as { id: number } | undefined;
  return row?.id ?? null;
}

export function persistAssessorGisCollector(
  identity: PropertyIdentityVersion,
  run: PublicIntelligenceRun | null,
): PropertyCollectorJobView {
  const db = getLandosDb();
  const task = run?.tasks.find((item) => item.task === 'county_records');
  const inputHash = hash({
    identityVersionId: identity.id,
    runStatus: run?.status ?? 'not_run',
    runCompletedAt: run?.completedAt ?? null,
    task: task ?? null,
  });
  const idempotencyKey = `assessor_gis:${identity.id}:${inputHash}`;
  const existing = db.prepare(
    'SELECT * FROM landos_property_collector_job WHERE idempotency_key=?',
  ).get(idempotencyKey) as JobRow | undefined;
  if (existing && existing.status !== 'running' && existing.status !== 'queued') return jobFromRow(existing);

  const now = Math.floor(Date.now() / 1000);
  const finalStatus = mapTaskStatus(task, identity);
  const error = identity.status !== 'confirmed'
    ? 'Exact parcel identity is required before assessor/GIS collection.'
    : task?.failureReason ?? (!task ? 'No persisted assessor/GIS run is available.' : null);

  let jobId: number;
  let attemptNumber: number;
  if (existing) {
    jobId = existing.id;
    attemptNumber = existing.attempt_count + 1;
    // A process exit can strand a running attempt. Preserve it as a failed
    // historical attempt, then resume with a new attempt against the same
    // idempotent input and evidence keys.
    db.prepare(`
      UPDATE landos_property_collector_attempt
      SET status='failed', finished_at=?, error=COALESCE(error, 'Interrupted before completion; resumed after restart.')
      WHERE job_id=? AND status='running'
    `).run(now, jobId);
    db.prepare(`
      UPDATE landos_property_collector_job
      SET status='running', attempt_count=?, last_error=NULL, started_at=COALESCE(started_at, ?),
          finished_at=NULL, updated_at=?
      WHERE id=?
    `).run(attemptNumber, now, now, jobId);
  } else {
    const jobResult = db.prepare(`
      INSERT INTO landos_property_collector_job (
        deal_card_id, property_identity_version_id, collector_key, status, input_hash,
        idempotency_key, dependency_json, attempt_count, last_error, queued_at,
        started_at, finished_at, updated_at
      ) VALUES (?, ?, 'assessor_gis', 'running', ?, ?, '["confirmed_property_identity"]', 1, NULL, ?, ?, NULL, ?)
    `).run(identity.dealCardId, identity.id, inputHash, idempotencyKey, now, now, now);
    jobId = jobResult.lastInsertRowid as number;
    attemptNumber = 1;
  }
  const attemptResult = db.prepare(`
    INSERT INTO landos_property_collector_attempt (job_id, attempt_number, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(jobId, attemptNumber, now);
  const attemptId = attemptResult.lastInsertRowid as number;
  const evidenceIds: number[] = [];

  if (identity.status === 'confirmed' && task) {
    for (const evidence of task.evidence) {
      const evidenceId = appendEvidence({
        dealCardId: identity.dealCardId,
        identityVersionId: identity.id,
        evidenceKind: 'source_record',
        rawValue: {
          evidenceId: evidence.evidenceId,
          supports: evidence.supports,
          limitation: evidence.limitation ?? null,
          decisionUsable: evidence.decisionUsable ?? null,
        },
        normalizedValue: { supports: evidence.supports },
        sourceName: evidence.sourceName,
        sourceUrl: evidence.sourceUrl ?? null,
        sourceTier: evidence.sourceTier,
        verificationStatus: evidence.verification,
        confidence: evidence.confidence,
        retrievedAt: evidence.retrievedAt,
        effectiveAt: evidence.datasetDate ?? null,
        idempotencyKey: `${idempotencyKey}:source:${evidence.evidenceId}`,
      });
      if (evidenceId) evidenceIds.push(evidenceId);
    }
    if (task.finding?.kind === 'county_records') {
      const finding = task.finding as CountyRecordsFinding;
      for (const fact of finding.facts) {
        const source = evidenceForId(task, fact.sourceEvidenceId);
        const evidenceId = appendEvidence({
          dealCardId: identity.dealCardId,
          identityVersionId: identity.id,
          evidenceKind: 'normalized_fact',
          factKey: fact.field,
          rawValue: fact.value,
          normalizedValue: fact.value,
          sourceName: source?.sourceName ?? finding.jurisdiction,
          sourceUrl: source?.sourceUrl ?? null,
          sourceTier: source?.sourceTier ?? 'official_county_state',
          verificationStatus: fact.classification,
          confidence: source?.confidence ?? task.confidence,
          retrievedAt: source?.retrievedAt ?? task.completedAt,
          effectiveAt: source?.datasetDate ?? null,
          idempotencyKey: `${idempotencyKey}:fact:${fact.sourceEvidenceId}:${hash([fact.field, fact.value])}`,
        });
        if (evidenceId) evidenceIds.push(evidenceId);
      }
    }
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE landos_property_collector_attempt
      SET status=?, finished_at=?, error=?, output_evidence_ids_json=?
      WHERE id=?
    `).run(finalStatus, now, error, stableJson(evidenceIds), attemptId);
    db.prepare(`
      UPDATE landos_property_collector_job
      SET status=?, last_error=?, finished_at=?, updated_at=?
      WHERE id=?
    `).run(finalStatus, error, now, now, jobId);
  })();

  landosAudit('property-summary-harness', 'property_collector_completed', `deal ${identity.dealCardId} assessor/GIS ${finalStatus}`, {
    refTable: 'landos_property_collector_job',
    refId: jobId,
    blocked: finalStatus === 'blocked' || finalStatus === 'failed',
  });
  return jobFromRow(
    db.prepare('SELECT * FROM landos_property_collector_job WHERE id=?').get(jobId) as JobRow,
  );
}

function currentFacts(dealCardId: number, identityVersionId: number): PropertySummaryFact[] {
  const rows = getLandosDb().prepare(`
    SELECT id, fact_key, normalized_value_json, source_name, source_url,
           verification_status, retrieved_at
    FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND domain='assessor_gis' AND evidence_kind='normalized_fact' AND fact_key IS NOT NULL
    ORDER BY id DESC
  `).all(dealCardId, identityVersionId) as Array<{
    id: number;
    fact_key: string;
    normalized_value_json: string;
    source_name: string;
    source_url: string | null;
    verification_status: string;
    retrieved_at: string;
  }>;
  const seen = new Set<string>();
  const result: PropertySummaryFact[] = [];
  for (const row of rows) {
    const key = row.fact_key.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    result.push({
      key,
      value: parseJson(row.normalized_value_json, null),
      evidenceId: row.id,
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      verificationStatus: row.verification_status,
      retrievedAt: row.retrieved_at,
    });
  }
  return result.sort((left, right) => left.key.localeCompare(right.key));
}

export function generatePropertySummarySnapshot(input: {
  identity: PropertyIdentityVersion;
  collectorJob: PropertyCollectorJobView;
  changeReason: string;
  generatedBy: string;
}): PropertySummarySnapshot {
  const db = getLandosDb();
  const identityConfirmed = input.identity.status === 'confirmed';
  const facts = identityConfirmed ? currentFacts(input.identity.dealCardId, input.identity.id) : [];
  const evidenceAggregate = db.prepare(`
    SELECT COUNT(*) AS count, MAX(id) AS max_id
    FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
  `).get(input.identity.dealCardId, input.identity.id) as { count: number; max_id: number | null };
  const assessorGis = !identityConfirmed
    ? 'blocked'
    : input.collectorJob.status === 'succeeded'
      ? 'complete'
      : input.collectorJob.status === 'partial'
        ? 'partial'
        : 'missing';
  const missing: string[] = [];
  if (!identityConfirmed) missing.push('Confirmed property identity');
  if (assessorGis !== 'complete') missing.push('Complete assessor/GIS evidence');
  const percent = identityConfirmed
    ? (assessorGis === 'complete' ? 100 : assessorGis === 'partial' ? 75 : 50)
    : 0;
  const completeness: PropertySummarySnapshot['completeness'] = {
    identity: identityConfirmed ? 'complete' : 'needs_resolution',
    assessorGis,
    percent,
    missing,
  };
  const areaContext = {
    address: input.identity.address,
    city: input.identity.city,
    county: input.identity.county,
    state: input.identity.state,
    zip: input.identity.zip,
  };
  const summary: PropertySummarySnapshot['summary'] = identityConfirmed
    ? {
        state: assessorGis === 'complete' ? 'ready' : 'partial',
        parcelSpecificAllowed: true,
        areaContext,
        property: {
          address: input.identity.address,
          city: input.identity.city,
          county: input.identity.county,
          state: input.identity.state,
          zip: input.identity.zip,
          apn: input.identity.apn,
          owner: input.identity.owner,
          acreage: input.identity.acreage,
        },
        facts,
        evidenceCount: evidenceAggregate.count,
        message: assessorGis === 'complete'
          ? 'Confirmed property identity and assessor/GIS evidence are available.'
          : 'Property identity is confirmed; assessor/GIS evidence is incomplete and can be resumed independently.',
      }
    : {
        state: 'resolution_required',
        parcelSpecificAllowed: false,
        areaContext,
        property: null,
        facts: [],
        evidenceCount: 0,
        message: 'Resolve the exact subject parcel before LandOS shows parcel-specific imagery, ranked comps, value, or strategy.',
      };
  const inputHash = hash({
    identityVersionId: input.identity.id,
    collectorJobId: input.collectorJob.id,
    collectorStatus: input.collectorJob.status,
    evidenceMaxId: evidenceAggregate.max_id,
    completeness,
    summary,
  });
  const existing = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND input_hash=?
  `).get(input.identity.dealCardId, inputHash) as SnapshotRow | undefined;
  if (existing) return snapshotFromRow(existing);

  const create = db.transaction(() => {
    const prior = db.prepare(`
      SELECT * FROM landos_deal_intelligence_snapshot
      WHERE deal_card_id=? AND snapshot_type='property_summary_v1' AND status='current'
      LIMIT 1
    `).get(input.identity.dealCardId) as SnapshotRow | undefined;
    const nextVersion = (db.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?
    `).get(input.identity.dealCardId) as { version: number }).version;
    if (prior) {
      db.prepare('UPDATE landos_deal_intelligence_snapshot SET status=\'superseded\' WHERE id=?').run(prior.id);
    }
    const result = db.prepare(`
      INSERT INTO landos_deal_intelligence_snapshot (
        deal_card_id, version, property_identity_version_id, prior_snapshot_id,
        snapshot_type, status, input_hash, evidence_max_id, completeness_json,
        summary_json, change_reason, generated_by
      ) VALUES (?, ?, ?, ?, 'property_summary_v1', 'current', ?, ?, ?, ?, ?, ?)
    `).run(
      input.identity.dealCardId,
      nextVersion,
      input.identity.id,
      prior?.id ?? null,
      inputHash,
      evidenceAggregate.max_id,
      stableJson(completeness),
      stableJson(summary),
      input.changeReason,
      input.generatedBy,
    );
    return result.lastInsertRowid as number;
  });
  const id = create();
  landosAudit(input.generatedBy, 'deal_intelligence_snapshot_created', `deal ${input.identity.dealCardId} property summary snapshot created`, {
    refTable: 'landos_deal_intelligence_snapshot',
    refId: id,
  });
  return snapshotFromRow(
    db.prepare('SELECT * FROM landos_deal_intelligence_snapshot WHERE id=?').get(id) as SnapshotRow,
  );
}

export function synchronizePropertySummarySlice(input: {
  identity: PropertyIdentityVersionInput;
  publicRun: PublicIntelligenceRun | null;
}): PropertySummaryReadModel {
  const identity = createPropertyIdentityVersion(input.identity);
  const collectorJob = persistAssessorGisCollector(identity, input.publicRun);
  generatePropertySummarySnapshot({
    identity,
    collectorJob,
    changeReason: input.identity.changeReason,
    generatedBy: input.identity.createdBy,
  });
  return getPropertySummaryReadModel(identity.dealCardId) as PropertySummaryReadModel;
}

export function getPropertySummaryReadModel(dealCardId: number): PropertySummaryReadModel | null {
  const db = getLandosDb();
  const identity = readCurrentPropertyIdentity(dealCardId);
  if (!identity) return null;
  const jobRow = db.prepare(`
    SELECT id, property_identity_version_id, collector_key, status, attempt_count, last_error, updated_at
    FROM landos_property_collector_job
    WHERE deal_card_id=? AND collector_key='assessor_gis'
    ORDER BY id DESC LIMIT 1
  `).get(dealCardId) as JobRow | undefined;
  const snapshotRow = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='property_summary_v1' AND status='current'
    LIMIT 1
  `).get(dealCardId) as SnapshotRow | undefined;
  const evidenceCount = (db.prepare(
    'SELECT COUNT(*) AS count FROM landos_property_evidence_item WHERE deal_card_id=?',
  ).get(dealCardId) as { count: number }).count;
  return {
    identity,
    assessorGisJob: jobRow ? jobFromRow(jobRow) : null,
    snapshot: snapshotRow ? snapshotFromRow(snapshotRow) : null,
    evidenceCount,
  };
}
