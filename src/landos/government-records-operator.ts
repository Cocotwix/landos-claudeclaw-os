import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getLandosDb, landosAudit } from './db.js';
import { analyzeGovernmentRecords } from './government-records-analyst.js';
import type {
  GovernmentRecordArtifactView,
  GovernmentRecordCollectorJobView,
  GovernmentRecordDomain,
  GovernmentRecordLocatorStatus,
  GovernmentRecordReadModel,
  GovernmentRecordSnapshotView,
  NormalizedGovernmentRecordClaim,
} from './government-records-types.js';
import { GOVERNMENT_RECORD_DOMAINS } from './government-records-types.js';
import {
  createPropertyIdentityVersion,
  readCurrentPropertyIdentity,
  type PropertyIdentityVersion,
  type PropertyIdentityVersionInput,
} from './property-summary-slice.js';
import { landosArtifactPath } from './storage-profile.js';

export interface GovernmentRecordArtifactInput {
  artifactKey: string;
  domain: GovernmentRecordDomain;
  sourceJurisdiction: string;
  sourceName: string;
  sourceUrl?: string | null;
  portalReference?: string | null;
  instrumentNumber?: string | null;
  bookPage?: string | null;
  parcelReference?: string | null;
  accountReference?: string | null;
  recordingFilingDate?: string | null;
  documentType: string;
  mimeType: string;
  displayName: string;
  retrievedAt: string;
  pageCount?: number;
  bytes?: Buffer;
  sourcePath?: string;
  pageSourcePaths?: string[];
}

export interface GovernmentRecordClaimInput extends Omit<NormalizedGovernmentRecordClaim, 'artifactId'> {
  artifactKey?: string | null;
}

export interface GovernmentRecordCollectorInput {
  identity: PropertyIdentityVersion;
  domain: GovernmentRecordDomain;
  sourceJurisdiction: string;
  platform: string;
  adapterKey: string;
  status: 'succeeded' | 'partial' | 'blocked' | 'failed';
  outcomeKind?: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'blocked';
  error?: string | null;
  claims: GovernmentRecordClaimInput[];
  artifacts: GovernmentRecordArtifactInput[];
  alternateOfficialSourcesChecked?: string[];
  requestKey?: string;
  cleanup?: {
    status: 'succeeded' | 'failed' | 'not_applicable';
    error?: string | null;
    ownedResourceCount?: number;
    openResourceCountAfter?: number;
    memoryBeforeBytes?: number | null;
    memoryAfterBytes?: number | null;
  };
}

export interface TrackedBrowserResource {
  key: string;
  type: 'context' | 'page' | 'popup' | 'download' | 'temporary_session';
  parentKey?: string | null;
  safeUrl?: string | null;
  close(): Promise<void>;
}

export interface GovernmentRecordCollectorAdapter {
  key: string;
  platform: string;
  collect(input: {
    identity: PropertyIdentityVersion;
    domain: GovernmentRecordDomain;
    sourceJurisdiction: string;
    track(resource: TrackedBrowserResource): void;
    signal: AbortSignal;
  }): Promise<Omit<GovernmentRecordCollectorInput, 'identity' | 'domain' | 'platform' | 'adapterKey' | 'sourceJurisdiction'>>;
}

interface JobRow {
  id: number;
  property_identity_version_id: number;
  collector_key: GovernmentRecordDomain;
  status: GovernmentRecordCollectorJobView['status'];
  attempt_count: number;
  last_error: string | null;
  source_jurisdiction: string;
  platform: string;
  adapter_key: string;
  updated_at: number;
  cleanup_status?: string | null;
  cleanup_error?: string | null;
  owned_resource_count?: number | null;
  open_resource_count_after?: number | null;
}

interface ArtifactRow {
  id: number;
  domain: GovernmentRecordDomain;
  source_jurisdiction: string;
  source_name: string;
  source_url: string | null;
  portal_reference: string | null;
  instrument_number: string | null;
  book_page: string | null;
  parcel_reference: string | null;
  account_reference: string | null;
  recording_filing_date: string | null;
  document_type: string;
  page_count: number;
  capture_count: number;
  artifact_hash: string;
  mime_type: string;
  display_name: string;
  retrieved_at: string;
  storage_path?: string;
  capture_manifest_json?: string;
}

interface SnapshotRow {
  id: number;
  deal_card_id: number;
  version: number;
  property_identity_version_id: number;
  prior_snapshot_id: number | null;
  input_hash: string;
  evidence_max_id: number | null;
  completeness_json: string;
  summary_json: string;
  change_reason: string;
  generated_by: string;
  created_at: number;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (Buffer.isBuffer(value)) return { bufferHash: createHash('sha256').update(value).digest('hex'), byteSize: value.length };
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value === undefined ? null : value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));
const digest = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');
const clean = (value: string | null | undefined): string | null => value?.trim() || null;
const nowSec = (): number => Math.floor(Date.now() / 1000);

function jobFromRow(row: JobRow): GovernmentRecordCollectorJobView {
  return {
    id: row.id,
    collectorKey: row.collector_key,
    status: row.status,
    identityVersionId: row.property_identity_version_id,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    sourceJurisdiction: row.source_jurisdiction ?? '',
    platform: row.platform ?? '',
    adapterKey: row.adapter_key ?? '',
    cleanupStatus: row.cleanup_status ?? null,
    cleanupError: row.cleanup_error ?? null,
    ownedResourceCount: row.owned_resource_count ?? 0,
    openResourceCountAfter: row.open_resource_count_after ?? 0,
    updatedAt: row.updated_at,
  };
}

function artifactFromRow(row: ArtifactRow): GovernmentRecordArtifactView {
  return {
    id: row.id,
    domain: row.domain,
    sourceJurisdiction: row.source_jurisdiction,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    portalReference: row.portal_reference,
    instrumentNumber: row.instrument_number,
    bookPage: row.book_page,
    parcelReference: row.parcel_reference,
    accountReference: row.account_reference,
    recordingFilingDate: row.recording_filing_date,
    documentType: row.document_type,
    pageCount: row.page_count,
    captureCount: row.capture_count,
    artifactHash: row.artifact_hash,
    mimeType: row.mime_type,
    displayName: row.display_name,
    retrievedAt: row.retrieved_at,
  };
}

function snapshotFromRow(row: SnapshotRow): GovernmentRecordSnapshotView {
  const summary = parseJson<{
    versions: GovernmentRecordSnapshotView['versions'];
    analysis: GovernmentRecordSnapshotView['analysis'];
  }>(row.summary_json, {} as never);
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    version: row.version,
    identityVersionId: row.property_identity_version_id,
    priorSnapshotId: row.prior_snapshot_id,
    inputHash: row.input_hash,
    evidenceMaxId: row.evidence_max_id,
    completeness: parseJson(row.completeness_json, {
      identity: 'needs_resolution',
      domains: Object.fromEntries(GOVERNMENT_RECORD_DOMAINS.map((domain) => [domain, 'missing'])) as GovernmentRecordSnapshotView['completeness']['domains'],
      percent: 0,
      missing: [...GOVERNMENT_RECORD_DOMAINS],
    }),
    versions: summary.versions,
    analysis: summary.analysis,
    changeReason: row.change_reason,
    generatedBy: row.generated_by,
    createdAt: row.created_at,
  };
}

function beginCollector(input: {
  identity: PropertyIdentityVersion;
  domain: GovernmentRecordDomain;
  sourceJurisdiction: string;
  platform: string;
  adapterKey: string;
  requestKey: string;
}): { jobId: number; attemptId: number; attemptNumber: number; reusedFinal: GovernmentRecordCollectorJobView | null } {
  const db = getLandosDb();
  const inputHash = digest({
    identityVersionId: input.identity.id,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.platform,
    adapterKey: input.adapterKey,
    requestKey: input.requestKey,
  });
  const idempotencyKey = `government-record:${input.domain}:${input.identity.id}:${inputHash}`;
  const existing = db.prepare(`
    SELECT j.*, a.cleanup_status, a.cleanup_error, a.owned_resource_count, a.open_resource_count_after
    FROM landos_property_collector_job j
    LEFT JOIN landos_property_collector_attempt a
      ON a.job_id=j.id AND a.attempt_number=j.attempt_count
    WHERE j.idempotency_key=?
  `).get(idempotencyKey) as JobRow | undefined;
  if (existing && !['queued', 'running'].includes(existing.status)) {
    return { jobId: existing.id, attemptId: 0, attemptNumber: existing.attempt_count, reusedFinal: jobFromRow(existing) };
  }

  const now = nowSec();
  let jobId: number;
  let attemptNumber: number;
  if (existing) {
    jobId = existing.id;
    attemptNumber = existing.attempt_count + 1;
    db.prepare(`
      UPDATE landos_property_collector_attempt
      SET status='failed', outcome_kind='failed', finished_at=?,
          error=COALESCE(error, 'Interrupted before completion; resumed after restart.')
      WHERE job_id=? AND status='running'
    `).run(now, jobId);
    db.prepare(`
      UPDATE landos_property_collector_job
      SET status='running', attempt_count=?, last_error=NULL,
          source_jurisdiction=?, platform=?, adapter_key=?,
          started_at=COALESCE(started_at, ?), finished_at=NULL, updated_at=?
      WHERE id=?
    `).run(attemptNumber, input.sourceJurisdiction, input.platform, input.adapterKey, now, now, jobId);
  } else {
    const inserted = db.prepare(`
      INSERT INTO landos_property_collector_job (
        deal_card_id, property_identity_version_id, collector_key, status, input_hash,
        idempotency_key, dependency_json, attempt_count, source_jurisdiction, platform,
        adapter_key, queued_at, started_at, updated_at
      ) VALUES (?, ?, ?, 'running', ?, ?, '["confirmed_property_identity"]', 1, ?, ?, ?, ?, ?, ?)
    `).run(
      input.identity.dealCardId, input.identity.id, input.domain, inputHash, idempotencyKey,
      input.sourceJurisdiction, input.platform, input.adapterKey, now, now, now,
    );
    jobId = Number(inserted.lastInsertRowid);
    attemptNumber = 1;
  }
  const attempt = db.prepare(`
    INSERT INTO landos_property_collector_attempt (
      job_id, attempt_number, status, started_at, outcome_kind, cleanup_status
    ) VALUES (?, ?, 'running', ?, 'completed', 'not_applicable')
  `).run(jobId, attemptNumber, now);
  return {
    jobId,
    attemptId: Number(attempt.lastInsertRowid),
    attemptNumber,
    reusedFinal: null,
  };
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function retainArtifact(input: {
  artifact: GovernmentRecordArtifactInput;
  identity: PropertyIdentityVersion;
  jobId: number;
  attemptId: number;
  collectorInputHash: string;
}): { id: number; artifactKey: string } {
  const db = getLandosDb();
  const pagePaths = (input.artifact.pageSourcePaths ?? []).filter((file) => fs.existsSync(file));
  const singleSource = input.artifact.sourcePath && fs.existsSync(input.artifact.sourcePath)
    ? input.artifact.sourcePath
    : null;
  const manifestSources = pagePaths.length ? pagePaths : singleSource ? [singleSource] : [];
  let artifactHash: string;
  let storagePath: string;
  let manifest: string[];

  if (input.artifact.bytes) {
    artifactHash = createHash('sha256').update(input.artifact.bytes).digest('hex');
    const extension = path.extname(input.artifact.displayName).replace(/[^.A-Za-z0-9]/g, '') || '.bin';
    const directory = landosArtifactPath('government-records', `deal_${input.identity.dealCardId}`);
    fs.mkdirSync(directory, { recursive: true });
    storagePath = path.join(directory, `${artifactHash}${extension}`);
    if (!fs.existsSync(storagePath)) fs.writeFileSync(storagePath, input.artifact.bytes);
    manifest = [storagePath];
  } else if (manifestSources.length > 0) {
    artifactHash = createHash('sha256')
      .update(manifestSources.map((file) => fileHash(file)).join(':'))
      .digest('hex');
    storagePath = manifestSources[0];
    manifest = manifestSources;
  } else {
    artifactHash = digest({
      officialReference: input.artifact.portalReference,
      sourceUrl: input.artifact.sourceUrl,
      instrumentNumber: input.artifact.instrumentNumber,
      unavailable: true,
    });
    storagePath = '';
    manifest = [];
  }

  const idempotencyKey = `artifact:${input.identity.id}:${input.artifact.domain}:${artifactHash}:${input.artifact.instrumentNumber ?? input.artifact.artifactKey}`;
  const pageCount = input.artifact.pageCount ?? manifest.length;
  const existing = db.prepare('SELECT id FROM landos_property_record_artifact WHERE idempotency_key=?')
    .get(idempotencyKey) as { id: number } | undefined;
  if (existing) return { id: existing.id, artifactKey: input.artifact.artifactKey };
  const inserted = db.prepare(`
    INSERT INTO landos_property_record_artifact (
      deal_card_id, property_identity_version_id, domain, source_jurisdiction,
      source_name, source_url, portal_reference, instrument_number, book_page,
      parcel_reference, account_reference, recording_filing_date, document_type,
      page_count, capture_count, artifact_hash, mime_type, display_name,
      storage_path, capture_manifest_json, collector_job_id, collector_attempt_id,
      retrieved_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.identity.dealCardId,
    input.identity.id,
    input.artifact.domain,
    input.artifact.sourceJurisdiction,
    input.artifact.sourceName,
    clean(input.artifact.sourceUrl),
    clean(input.artifact.portalReference),
    clean(input.artifact.instrumentNumber),
    clean(input.artifact.bookPage),
    clean(input.artifact.parcelReference),
    clean(input.artifact.accountReference),
    clean(input.artifact.recordingFilingDate),
    input.artifact.documentType,
    pageCount,
    manifest.length,
    artifactHash,
    input.artifact.mimeType,
    input.artifact.displayName,
    storagePath,
    stableJson(manifest),
    input.jobId,
    input.attemptId,
    input.artifact.retrievedAt,
    idempotencyKey,
  );
  return { id: Number(inserted.lastInsertRowid), artifactKey: input.artifact.artifactKey };
}

function appendClaimEvidence(input: {
  identity: PropertyIdentityVersion;
  jobId: number;
  domain: GovernmentRecordDomain;
  claim: GovernmentRecordClaimInput;
  artifactId: number | null;
  collectorInputHash: string;
}): number[] {
  const db = getLandosDb();
  const base = `${input.domain}:${input.identity.id}:${input.collectorInputHash}:${digest({
    claimKey: input.claim.claimKey,
    exactWording: input.claim.exactWording,
    normalizedValue: input.claim.normalizedValue,
    sourceUrl: input.claim.sourceUrl,
    instrumentNumber: input.claim.instrumentNumber,
    association: input.claim.association,
  })}`;
  const rawKey = `${base}:raw`;
  const rawResult = db.prepare(`
    INSERT OR IGNORE INTO landos_property_evidence_item (
      deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
      raw_value_json, normalized_value_json, source_name, source_url, source_tier,
      verification_status, confidence, collector_key, retrieved_at, effective_at,
      artifact_ref, supersedes_evidence_id, dispute_group, idempotency_key
    ) VALUES (?, ?, ?, 'raw_official_record', ?, ?, 'null', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.identity.dealCardId,
    input.identity.id,
    input.domain,
    input.claim.claimKey,
    stableJson({
      exactWording: input.claim.exactWording,
      locatorStatus: input.claim.locatorStatus,
      association: input.claim.association,
      sourceJurisdiction: input.claim.sourceJurisdiction,
      instrumentNumber: input.claim.instrumentNumber ?? null,
      bookPage: input.claim.bookPage ?? null,
      parcelReference: input.claim.parcelReference ?? null,
      accountReference: input.claim.accountReference ?? null,
      recordingFilingDate: input.claim.recordingFilingDate ?? null,
      documentType: input.claim.documentType ?? null,
      artifactPage: input.claim.artifactPage ?? null,
    }),
    input.claim.sourceName,
    input.claim.sourceUrl,
    input.claim.sourceTier,
    input.claim.locatorStatus,
    input.claim.confidence,
    input.domain,
    input.claim.retrievedAt,
    input.claim.effectiveAt ?? null,
    input.artifactId == null ? null : `artifact:${input.artifactId}`,
    input.claim.supersedesEvidenceId ?? null,
    input.claim.disputeGroup ?? null,
    rawKey,
  );
  const rawEvidenceId = rawResult.changes > 0
    ? Number(rawResult.lastInsertRowid)
    : (db.prepare('SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?').get(rawKey) as { id: number }).id;
  const normalizedKey = `${base}:normalized`;
  const normalizedResult = db.prepare(`
    INSERT OR IGNORE INTO landos_property_evidence_item (
      deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
      raw_value_json, normalized_value_json, source_name, source_url, source_tier,
      verification_status, confidence, collector_key, retrieved_at, effective_at,
      artifact_ref, supersedes_evidence_id, dispute_group, idempotency_key
    ) VALUES (?, ?, ?, 'normalized_claim', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.identity.dealCardId,
    input.identity.id,
    input.domain,
    input.claim.claimKey,
    stableJson({ rawEvidenceId, exactWording: input.claim.exactWording }),
    stableJson({
      value: input.claim.normalizedValue,
      association: input.claim.association,
      locatorStatus: input.claim.locatorStatus,
      sourceJurisdiction: input.claim.sourceJurisdiction,
      instrumentNumber: input.claim.instrumentNumber ?? null,
      bookPage: input.claim.bookPage ?? null,
      parcelReference: input.claim.parcelReference ?? null,
      accountReference: input.claim.accountReference ?? null,
      recordingFilingDate: input.claim.recordingFilingDate ?? null,
      documentType: input.claim.documentType ?? null,
      artifactId: input.artifactId,
      artifactPage: input.claim.artifactPage ?? null,
    }),
    input.claim.sourceName,
    input.claim.sourceUrl,
    input.claim.sourceTier,
    input.claim.locatorStatus,
    input.claim.confidence,
    input.domain,
    input.claim.retrievedAt,
    input.claim.effectiveAt ?? null,
    input.artifactId == null ? null : `artifact:${input.artifactId}`,
    input.claim.supersedesEvidenceId ?? null,
    input.claim.disputeGroup ?? null,
    normalizedKey,
  );
  const normalizedEvidenceId = normalizedResult.changes > 0
    ? Number(normalizedResult.lastInsertRowid)
    : (db.prepare('SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?').get(normalizedKey) as { id: number }).id;
  return [rawEvidenceId, normalizedEvidenceId];
}

function finishCollector(input: GovernmentRecordCollectorInput & {
  jobId: number;
  attemptId: number;
  collectorInputHash: string;
}): GovernmentRecordCollectorJobView {
  const db = getLandosDb();
  const artifactMap = new Map<string, number>();
  for (const artifact of input.artifacts) {
    const retained = retainArtifact({
      artifact,
      identity: input.identity,
      jobId: input.jobId,
      attemptId: input.attemptId,
      collectorInputHash: input.collectorInputHash,
    });
    artifactMap.set(retained.artifactKey, retained.id);
  }
  const evidenceIds: number[] = [];
  for (const claim of input.claims) {
    evidenceIds.push(...appendClaimEvidence({
      identity: input.identity,
      jobId: input.jobId,
      domain: input.domain,
      claim,
      artifactId: claim.artifactKey ? artifactMap.get(claim.artifactKey) ?? null : null,
      collectorInputHash: input.collectorInputHash,
    }));
  }
  if (input.alternateOfficialSourcesChecked?.length) {
    const alternateClaim: GovernmentRecordClaimInput = {
      claimKey: 'alternate_official_sources_checked',
      exactWording: `Alternate official sources checked: ${input.alternateOfficialSourcesChecked.join('; ')}`,
      normalizedValue: input.alternateOfficialSourcesChecked,
      domain: input.domain,
      association: 'not_applicable',
      locatorStatus: input.status === 'blocked' ? 'official_source_blocked' : 'record_referenced_document_unavailable',
      sourceName: input.sourceJurisdiction,
      sourceUrl: null,
      sourceJurisdiction: input.sourceJurisdiction,
      sourceTier: 'official_county_state',
      confidence: 'high',
      retrievedAt: new Date().toISOString(),
    };
    evidenceIds.push(...appendClaimEvidence({
      identity: input.identity,
      jobId: input.jobId,
      domain: input.domain,
      claim: alternateClaim,
      artifactId: null,
      collectorInputHash: input.collectorInputHash,
    }));
  }
  const now = nowSec();
  const cleanup = input.cleanup ?? { status: 'not_applicable' as const };
  db.transaction(() => {
    db.prepare(`
      UPDATE landos_property_collector_attempt
      SET status=?, outcome_kind=?, finished_at=?, error=?,
          output_evidence_ids_json=?, cleanup_status=?, cleanup_error=?,
          owned_resource_count=?, open_resource_count_after=?,
          memory_before_bytes=?, memory_after_bytes=?
      WHERE id=?
    `).run(
      input.status,
      input.outcomeKind ?? (input.status === 'failed' ? 'failed' : input.status === 'blocked' ? 'blocked' : 'completed'),
      now,
      input.error ?? null,
      stableJson([...new Set(evidenceIds)]),
      cleanup.status,
      cleanup.error ?? null,
      cleanup.ownedResourceCount ?? 0,
      cleanup.openResourceCountAfter ?? 0,
      cleanup.memoryBeforeBytes ?? null,
      cleanup.memoryAfterBytes ?? null,
      input.attemptId,
    );
    db.prepare(`
      UPDATE landos_property_collector_job
      SET status=?, last_error=?, finished_at=?, updated_at=?
      WHERE id=?
    `).run(input.status, input.error ?? null, now, now, input.jobId);
  })();
  landosAudit('government-records-operator', 'government_record_collector_completed', `deal ${input.identity.dealCardId} ${input.domain} ${input.status}`, {
    refTable: 'landos_property_collector_job',
    refId: input.jobId,
    blocked: input.status === 'blocked' || input.status === 'failed',
  });
  return readJob(input.jobId);
}

function readJob(jobId: number): GovernmentRecordCollectorJobView {
  const row = getLandosDb().prepare(`
    SELECT j.*, a.cleanup_status, a.cleanup_error, a.owned_resource_count, a.open_resource_count_after
    FROM landos_property_collector_job j
    LEFT JOIN landos_property_collector_attempt a
      ON a.job_id=j.id AND a.attempt_number=j.attempt_count
    WHERE j.id=?
  `).get(jobId) as JobRow;
  return jobFromRow(row);
}

export function persistGovernmentRecordCollector(input: GovernmentRecordCollectorInput): GovernmentRecordCollectorJobView {
  const collectorInputHash = digest({
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.platform,
    adapterKey: input.adapterKey,
    status: input.status,
    outcomeKind: input.outcomeKind,
    error: input.error,
    claims: input.claims,
    artifacts: input.artifacts,
    alternateOfficialSourcesChecked: input.alternateOfficialSourcesChecked,
  });
  const started = beginCollector({
    identity: input.identity,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.platform,
    adapterKey: input.adapterKey,
    requestKey: input.requestKey ?? collectorInputHash,
  });
  if (started.reusedFinal) return started.reusedFinal;
  const effective = input.identity.status === 'confirmed'
    ? input
    : {
        ...input,
        status: 'blocked' as const,
        outcomeKind: 'blocked' as const,
        error: 'Confirmed subject property identity and geometry are required before recorded-government research.',
        claims: [],
        artifacts: [],
      };
  return finishCollector({
    ...effective,
    jobId: started.jobId,
    attemptId: started.attemptId,
    collectorInputHash,
  });
}

function registerOwnedResource(jobId: number, attemptId: number, resource: TrackedBrowserResource): void {
  getLandosDb().prepare(`
    INSERT OR IGNORE INTO landos_browser_owned_resource (
      job_id, attempt_id, resource_key, resource_type, parent_resource_key, safe_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'open')
  `).run(jobId, attemptId, resource.key, resource.type, resource.parentKey ?? null, clean(resource.safeUrl));
}

async function closeOwnedResources(
  attemptId: number,
  resources: TrackedBrowserResource[],
): Promise<{ status: 'succeeded' | 'failed'; error: string | null; openAfter: number }> {
  const db = getLandosDb();
  const errors: string[] = [];
  for (const resource of [...resources].reverse()) {
    try {
      await resource.close();
      db.prepare(`
        UPDATE landos_browser_owned_resource
        SET status='closed', closed_at=?, cleanup_error=NULL
        WHERE attempt_id=? AND resource_key=?
      `).run(nowSec(), attemptId, resource.key);
    } catch (error) {
      const safe = String((error as Error)?.message ?? error).slice(0, 300);
      errors.push(`${resource.type}:${resource.key} ${safe}`);
      db.prepare(`
        UPDATE landos_browser_owned_resource
        SET status='cleanup_failed', cleanup_error=?
        WHERE attempt_id=? AND resource_key=?
      `).run(safe, attemptId, resource.key);
    }
  }
  const openAfter = (db.prepare(`
    SELECT COUNT(*) AS count FROM landos_browser_owned_resource
    WHERE attempt_id=? AND status IN ('open','cleanup_failed')
  `).get(attemptId) as { count: number }).count;
  return {
    status: errors.length || openAfter ? 'failed' : 'succeeded',
    error: errors.length ? errors.join(' | ').slice(0, 1000) : null,
    openAfter,
  };
}

export async function runTrackedGovernmentRecordCollector(input: {
  identity: PropertyIdentityVersion;
  domain: GovernmentRecordDomain;
  sourceJurisdiction: string;
  adapter: GovernmentRecordCollectorAdapter;
  requestKey: string;
  timeoutMs: number;
}): Promise<GovernmentRecordCollectorJobView> {
  const started = beginCollector({
    identity: input.identity,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.adapter.platform,
    adapterKey: input.adapter.key,
    requestKey: input.requestKey,
  });
  if (started.reusedFinal) return started.reusedFinal;
  const resources: TrackedBrowserResource[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const abort = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let result: Omit<GovernmentRecordCollectorInput, 'identity' | 'domain' | 'platform' | 'adapterKey' | 'sourceJurisdiction'>;
  try {
    result = await Promise.race([
      input.adapter.collect({
        identity: input.identity,
        domain: input.domain,
        sourceJurisdiction: input.sourceJurisdiction,
        track(resource) {
          if (resources.some((candidate) => candidate.key === resource.key)) return;
          resources.push(resource);
          registerOwnedResource(started.jobId, started.attemptId, resource);
        },
        signal: abort.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          abort.abort();
          reject(new Error(`Collector timed out after ${input.timeoutMs} ms.`));
        }, Math.max(50, input.timeoutMs));
      }),
    ]);
  } catch (error) {
    const timedOut = /timed out/i.test(String((error as Error)?.message ?? error));
    result = {
      status: 'failed',
      outcomeKind: timedOut ? 'timed_out' : 'failed',
      error: String((error as Error)?.message ?? error).slice(0, 1000),
      claims: [],
      artifacts: [],
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const cleanup = await closeOwnedResources(started.attemptId, resources);
  const collectorInputHash = digest({
    requestKey: input.requestKey,
    result,
  });
  return finishCollector({
    identity: input.identity,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.adapter.platform,
    adapterKey: input.adapter.key,
    ...result,
    requestKey: input.requestKey,
    cleanup: {
      status: cleanup.status,
      error: cleanup.error,
      ownedResourceCount: resources.length,
      openResourceCountAfter: cleanup.openAfter,
      memoryBeforeBytes: memoryBefore,
      memoryAfterBytes: process.memoryUsage().rss,
    },
    jobId: started.jobId,
    attemptId: started.attemptId,
    collectorInputHash,
  });
}

/** Fallback janitor: touches only resources previously registered to LandOS. */
export async function runBrowserResourceJanitor(input: {
  activeResources: Map<string, TrackedBrowserResource>;
  abandonedBefore: number;
}): Promise<{ inspected: number; closed: number; failed: number; unavailable: number }> {
  const db = getLandosDb();
  const rows = db.prepare(`
    SELECT id, resource_key FROM landos_browser_owned_resource
    WHERE status IN ('open','cleanup_failed') AND opened_at <= ?
    ORDER BY id
  `).all(input.abandonedBefore) as Array<{ id: number; resource_key: string }>;
  let closed = 0;
  let failed = 0;
  let unavailable = 0;
  for (const row of rows) {
    const handle = input.activeResources.get(row.resource_key);
    if (!handle) {
      unavailable += 1;
      db.prepare(`
        UPDATE landos_browser_owned_resource
        SET status='abandoned', closed_at=?, cleanup_error='Runtime handle unavailable; owning process/context no longer exists.'
        WHERE id=?
      `).run(nowSec(), row.id);
      continue;
    }
    try {
      await handle.close();
      closed += 1;
      db.prepare(`
        UPDATE landos_browser_owned_resource
        SET status='closed', closed_at=?, cleanup_error=NULL
        WHERE id=?
      `).run(nowSec(), row.id);
    } catch (error) {
      failed += 1;
      db.prepare(`
        UPDATE landos_browser_owned_resource
        SET status='cleanup_failed', cleanup_error=?
        WHERE id=?
      `).run(String((error as Error)?.message ?? error).slice(0, 300), row.id);
    }
  }
  return { inspected: rows.length, closed, failed, unavailable };
}

export function recoverInterruptedGovernmentRecordCollectors(actor = 'government-records-recovery'): {
  attemptsRecovered: number;
  jobsRequeued: number;
} {
  const db = getLandosDb();
  const now = nowSec();
  const attempts = db.prepare(`
    UPDATE landos_property_collector_attempt
    SET status='failed', outcome_kind='failed', finished_at=?,
        error=COALESCE(error, 'Interrupted before completion; resumable after managed restart.'),
        cleanup_status=CASE WHEN cleanup_status='not_applicable' THEN 'failed' ELSE cleanup_status END,
        cleanup_error=COALESCE(cleanup_error, 'Owning process exited; runtime context was destroyed.')
    WHERE status='running'
      AND job_id IN (
        SELECT id FROM landos_property_collector_job
        WHERE collector_key IN ('deed_ownership','surveys_plats','recorded_encumbrances','property_tax','lien_judgment')
      )
  `).run(now);
  const jobs = db.prepare(`
    UPDATE landos_property_collector_job
    SET status='queued', last_error='Interrupted attempt recovered after managed restart.', finished_at=NULL, updated_at=?
    WHERE status='running'
      AND collector_key IN ('deed_ownership','surveys_plats','recorded_encumbrances','property_tax','lien_judgment')
  `).run(now);
  if (attempts.changes || jobs.changes) {
    landosAudit(actor, 'government_record_collectors_recovered', `${attempts.changes} interrupted attempt(s), ${jobs.changes} job(s) requeued`, {
      refTable: 'landos_property_collector_job',
    });
  }
  return { attemptsRecovered: attempts.changes, jobsRequeued: jobs.changes };
}

function currentEvidenceIds(jobs: GovernmentRecordCollectorJobView[]): number[] {
  if (!jobs.length) return [];
  const placeholders = jobs.map(() => '?').join(',');
  const rows = getLandosDb().prepare(`
    SELECT output_evidence_ids_json
    FROM landos_property_collector_attempt
    WHERE job_id IN (${placeholders})
      AND attempt_number = (
        SELECT MAX(latest.attempt_number)
        FROM landos_property_collector_attempt latest
        WHERE latest.job_id=landos_property_collector_attempt.job_id
      )
  `).all(...jobs.map((job) => job.id)) as Array<{ output_evidence_ids_json: string }>;
  return [...new Set(rows.flatMap((row) => parseJson<number[]>(row.output_evidence_ids_json, [])))];
}

function readNormalizedClaims(dealCardId: number, identityVersionId: number, evidenceIds: number[]) {
  if (!evidenceIds.length) return [];
  const placeholders = evidenceIds.map(() => '?').join(',');
  const rows = getLandosDb().prepare(`
    SELECT id, domain, fact_key, raw_value_json, normalized_value_json, source_name,
           source_url, source_tier, verification_status, confidence, retrieved_at,
           effective_at, artifact_ref, supersedes_evidence_id, dispute_group
    FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND id IN (${placeholders})
      AND evidence_kind='normalized_claim'
      AND domain IN ('deed_ownership','surveys_plats','recorded_encumbrances','property_tax','lien_judgment')
    ORDER BY id
  `).all(dealCardId, identityVersionId, ...evidenceIds) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const raw = parseJson<Record<string, unknown>>(row.raw_value_json, {});
    const normalized = parseJson<Record<string, unknown>>(row.normalized_value_json, {});
    const artifactRef = typeof row.artifact_ref === 'string' ? row.artifact_ref.match(/^artifact:(\d+)$/) : null;
    return {
      evidenceId: Number(row.id),
      claimKey: String(row.fact_key ?? ''),
      exactWording: String(raw.exactWording ?? ''),
      normalizedValue: normalized.value,
      domain: row.domain as GovernmentRecordDomain,
      association: normalized.association as NormalizedGovernmentRecordClaim['association'],
      locatorStatus: normalized.locatorStatus as GovernmentRecordLocatorStatus,
      sourceName: String(row.source_name),
      sourceUrl: clean(row.source_url == null ? null : String(row.source_url)),
      sourceJurisdiction: String(normalized.sourceJurisdiction ?? ''),
      sourceTier: String(row.source_tier),
      confidence: row.confidence as NormalizedGovernmentRecordClaim['confidence'],
      retrievedAt: String(row.retrieved_at),
      effectiveAt: clean(row.effective_at == null ? null : String(row.effective_at)),
      instrumentNumber: clean(normalized.instrumentNumber == null ? null : String(normalized.instrumentNumber)),
      bookPage: clean(normalized.bookPage == null ? null : String(normalized.bookPage)),
      parcelReference: clean(normalized.parcelReference == null ? null : String(normalized.parcelReference)),
      accountReference: clean(normalized.accountReference == null ? null : String(normalized.accountReference)),
      recordingFilingDate: clean(normalized.recordingFilingDate == null ? null : String(normalized.recordingFilingDate)),
      documentType: clean(normalized.documentType == null ? null : String(normalized.documentType)),
      artifactId: artifactRef ? Number(artifactRef[1]) : normalized.artifactId == null ? null : Number(normalized.artifactId),
      artifactPage: normalized.artifactPage == null ? null : Number(normalized.artifactPage),
      supersedesEvidenceId: row.supersedes_evidence_id == null ? null : Number(row.supersedes_evidence_id),
      disputeGroup: clean(row.dispute_group == null ? null : String(row.dispute_group)),
    };
  });
}

function leadContactNames(dealCardId: number): string[] {
  const rows = getLandosDb().prepare(`
    SELECT p.name
    FROM landos_person_link l
    JOIN landos_person p ON p.id=l.person_id
    WHERE l.deal_card_id=?
    ORDER BY p.id
  `).all(dealCardId) as Array<{ name: string }>;
  return [...new Set(rows.map((row) => row.name.trim()).filter(Boolean))];
}

export function generateGovernmentRecordSnapshot(input: {
  identity: PropertyIdentityVersion;
  jobs: GovernmentRecordCollectorJobView[];
  changeReason: string;
  generatedBy: string;
}): GovernmentRecordSnapshotView {
  const db = getLandosDb();
  const selectedEvidenceIds = currentEvidenceIds(input.jobs);
  const claims = readNormalizedClaims(input.identity.dealCardId, input.identity.id, selectedEvidenceIds);
  const aggregate = {
    count: selectedEvidenceIds.length,
    max_id: selectedEvidenceIds.length ? Math.max(...selectedEvidenceIds) : null,
  };
  const artifacts = listArtifacts(input.identity.dealCardId, input.identity.id);
  const analysis = analyzeGovernmentRecords({
    schemaVersion: 'government-record-normalized-v1',
    artifactSchemaVersion: 'government-record-artifact-v1',
    propertyIdentity: {
      id: input.identity.id,
      version: input.identity.version,
      status: input.identity.status,
      apn: input.identity.apn,
      address: input.identity.address,
      county: input.identity.county,
      state: input.identity.state,
      geometryPresent: input.identity.geometry != null,
    },
    evidenceVersion: { maxEvidenceId: aggregate.max_id, evidenceCount: aggregate.count },
    leadContacts: leadContactNames(input.identity.dealCardId),
    claims,
    artifacts,
  });
  const identityComplete = input.identity.status === 'confirmed';
  const domains = Object.fromEntries(GOVERNMENT_RECORD_DOMAINS.map((domain) => {
    const job = input.jobs.find((candidate) => candidate.collectorKey === domain);
    const state: GovernmentRecordSnapshotView['completeness']['domains'][GovernmentRecordDomain] =
      !identityComplete || job?.status === 'blocked' ? 'blocked'
        : job?.status === 'succeeded' ? 'complete'
          : job?.status === 'partial' ? 'partial' : 'missing';
    return [domain, state];
  })) as GovernmentRecordSnapshotView['completeness']['domains'];
  const completedUnits = GOVERNMENT_RECORD_DOMAINS.reduce((sum, domain) => {
    const state = domains[domain];
    return sum + (state === 'complete' ? 1 : state === 'partial' ? 0.5 : 0);
  }, 0);
  const completeness: GovernmentRecordSnapshotView['completeness'] = {
    identity: identityComplete ? 'complete' : 'needs_resolution',
    domains,
    percent: identityComplete ? Math.round((completedUnits / GOVERNMENT_RECORD_DOMAINS.length) * 100) : 0,
    missing: [
      ...(!identityComplete ? ['Confirmed property identity'] : []),
      ...GOVERNMENT_RECORD_DOMAINS.filter((domain) => domains[domain] !== 'complete'),
    ],
  };
  const versions: GovernmentRecordSnapshotView['versions'] = {
    propertyIdentityVersion: input.identity.version,
    normalizedEvidenceSchema: 'government-record-normalized-v1',
    artifactSchema: 'government-record-artifact-v1',
    analystEngine: 'government-record-analyst-v1',
    snapshotSchema: 'government-record-risk-snapshot-v1',
  };
  const inputHash = digest({
    identityVersionId: input.identity.id,
    jobs: input.jobs.map((job) => [job.id, job.status, job.attemptCount, job.cleanupStatus]),
    evidenceMaxId: aggregate.max_id,
    artifacts: artifacts.map((artifact) => [artifact.id, artifact.artifactHash]),
    versions,
    completeness,
    analysis,
  });
  const existing = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='government_record_risk_v1' AND input_hash=?
  `).get(input.identity.dealCardId, inputHash) as SnapshotRow | undefined;
  if (existing) return snapshotFromRow(existing);

  const snapshotId = db.transaction(() => {
    const prior = db.prepare(`
      SELECT * FROM landos_deal_intelligence_snapshot
      WHERE deal_card_id=? AND snapshot_type='government_record_risk_v1' AND status='current'
      LIMIT 1
    `).get(input.identity.dealCardId) as SnapshotRow | undefined;
    const nextVersion = (db.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?
    `).get(input.identity.dealCardId) as { version: number }).version;
    if (prior) db.prepare(`UPDATE landos_deal_intelligence_snapshot SET status='superseded' WHERE id=?`).run(prior.id);
    const result = db.prepare(`
      INSERT INTO landos_deal_intelligence_snapshot (
        deal_card_id, version, property_identity_version_id, prior_snapshot_id,
        snapshot_type, status, input_hash, evidence_max_id, completeness_json,
        summary_json, change_reason, generated_by
      ) VALUES (?, ?, ?, ?, 'government_record_risk_v1', 'current', ?, ?, ?, ?, ?, ?)
    `).run(
      input.identity.dealCardId,
      nextVersion,
      input.identity.id,
      prior?.id ?? null,
      inputHash,
      aggregate.max_id,
      stableJson(completeness),
      stableJson({ versions, analysis }),
      input.changeReason,
      input.generatedBy,
    );
    return Number(result.lastInsertRowid);
  })();
  landosAudit(input.generatedBy, 'deal_intelligence_snapshot_created', `deal ${input.identity.dealCardId} government-record snapshot created`, {
    refTable: 'landos_deal_intelligence_snapshot',
    refId: snapshotId,
  });
  return snapshotFromRow(db.prepare('SELECT * FROM landos_deal_intelligence_snapshot WHERE id=?').get(snapshotId) as SnapshotRow);
}

function listJobs(dealCardId: number, identityVersionId: number): GovernmentRecordCollectorJobView[] {
  const rows = getLandosDb().prepare(`
    SELECT j.*, a.cleanup_status, a.cleanup_error, a.owned_resource_count, a.open_resource_count_after
    FROM landos_property_collector_job j
    LEFT JOIN landos_property_collector_attempt a
      ON a.job_id=j.id AND a.attempt_number=j.attempt_count
    WHERE j.deal_card_id=? AND j.property_identity_version_id=?
      AND j.collector_key IN ('deed_ownership','surveys_plats','recorded_encumbrances','property_tax','lien_judgment')
    ORDER BY j.id
  `).all(dealCardId, identityVersionId) as JobRow[];
  const latest = new Map<GovernmentRecordDomain, JobRow>();
  for (const row of rows) latest.set(row.collector_key, row);
  return GOVERNMENT_RECORD_DOMAINS
    .map((domain) => latest.get(domain))
    .filter((row): row is JobRow => !!row)
    .map(jobFromRow);
}

function listArtifacts(dealCardId: number, identityVersionId: number): GovernmentRecordArtifactView[] {
  const rows = getLandosDb().prepare(`
    SELECT * FROM landos_property_record_artifact
    WHERE deal_card_id=? AND property_identity_version_id=?
    ORDER BY domain, id
  `).all(dealCardId, identityVersionId) as ArtifactRow[];
  return rows.map(artifactFromRow);
}

export function getGovernmentRecordReadModel(dealCardId: number): GovernmentRecordReadModel | null {
  const db = getLandosDb();
  const identity = readCurrentPropertyIdentity(dealCardId);
  if (!identity) return null;
  const snapshot = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='government_record_risk_v1' AND status='current'
    LIMIT 1
  `).get(dealCardId) as SnapshotRow | undefined;
  const corrections = db.prepare(`
    SELECT * FROM landos_property_identity_correction
    WHERE deal_card_id=? ORDER BY requested_at DESC, id DESC
  `).all(dealCardId) as Array<Record<string, unknown>>;
  const evidenceCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND domain IN ('deed_ownership','surveys_plats','recorded_encumbrances','property_tax','lien_judgment')
  `).get(dealCardId, identity.id) as { count: number }).count;
  return {
    identity: {
      id: identity.id,
      version: identity.version,
      status: identity.status,
      address: identity.address,
      county: identity.county,
      state: identity.state,
      apn: identity.apn,
    },
    snapshot: snapshot ? snapshotFromRow(snapshot) : null,
    jobs: listJobs(dealCardId, identity.id),
    artifacts: listArtifacts(dealCardId, identity.id),
    evidenceCount,
    corrections: corrections.map((row) => ({
      id: Number(row.id),
      status: String(row.status),
      reason: String(row.reason),
      requestedBy: String(row.requested_by),
      approvalId: Number(row.approval_id),
      priorIdentityVersionId: Number(row.prior_identity_version_id),
      replacementIdentityVersionId: row.replacement_identity_version_id == null ? null : Number(row.replacement_identity_version_id),
      declaredInvalidations: parseJson(String(row.declared_invalidations_json), []),
      requestedAt: Number(row.requested_at),
      appliedAt: row.applied_at == null ? null : Number(row.applied_at),
    })),
  };
}

export function synchronizeGovernmentRecordSlice(input: {
  identity: PropertyIdentityVersion;
  collectors: GovernmentRecordCollectorInput[];
  changeReason: string;
  generatedBy: string;
}): GovernmentRecordReadModel {
  const jobs = input.collectors.map((collector) => persistGovernmentRecordCollector({
    ...collector,
    identity: input.identity,
  }));
  for (const domain of GOVERNMENT_RECORD_DOMAINS) {
    if (jobs.some((job) => job.collectorKey === domain)) continue;
    jobs.push(persistGovernmentRecordCollector({
      identity: input.identity,
      domain,
      sourceJurisdiction: [input.identity.county, input.identity.state].filter(Boolean).join(', '),
      platform: 'unresolved',
      adapterKey: 'missing-collector',
      status: input.identity.status === 'confirmed' ? 'partial' : 'blocked',
      outcomeKind: input.identity.status === 'confirmed' ? 'completed' : 'blocked',
      error: input.identity.status === 'confirmed'
        ? 'No persisted official-source result is available for this domain.'
        : 'Confirmed subject property identity is required before recorded-government research.',
      claims: [{
        claimKey: 'collection_status',
        exactWording: input.identity.status === 'confirmed'
          ? 'No persisted official-source result is available for this domain.'
          : 'Research withheld until the subject property is confirmed.',
        normalizedValue: null,
        domain,
        association: 'not_applicable',
        locatorStatus: input.identity.status === 'confirmed' ? 'not_searched' : 'official_source_blocked',
        sourceName: [input.identity.county, input.identity.state].filter(Boolean).join(', ') || 'Official jurisdiction unresolved',
        sourceUrl: null,
        sourceJurisdiction: [input.identity.county, input.identity.state].filter(Boolean).join(', '),
        sourceTier: 'official_county_state',
        confidence: 'unknown',
        retrievedAt: new Date().toISOString(),
      }],
      artifacts: [],
      requestKey: `missing:${domain}:${input.identity.id}`,
    }));
  }
  generateGovernmentRecordSnapshot({
    identity: input.identity,
    jobs,
    changeReason: input.changeReason,
    generatedBy: input.generatedBy,
  });
  return getGovernmentRecordReadModel(input.identity.dealCardId)!;
}

export function requestPropertyIdentityCorrection(input: {
  dealCardId: number;
  replacement: Partial<PropertyIdentityVersionInput>;
  evidenceRefs: string[];
  reason: string;
  requestedBy: string;
  declaredInvalidations: Array<'property_summary' | 'government_records' | 'assessor_gis'>;
}): { correctionId: number; approvalId: number } {
  const db = getLandosDb();
  const prior = readCurrentPropertyIdentity(input.dealCardId);
  if (!prior) throw new Error('A current property identity is required before correction.');
  const approval = db.prepare(`
    INSERT INTO landos_approval (entity, action_type, title, payload, requested_by)
    VALUES (NULL, 'canonical_property_identity_correction', ?, ?, ?)
  `).run(
    `Correct accepted property identity for Deal Card ${input.dealCardId}`,
    stableJson({
      dealCardId: input.dealCardId,
      priorIdentityVersionId: prior.id,
      replacement: input.replacement,
      evidenceRefs: input.evidenceRefs,
      reason: input.reason,
      declaredInvalidations: input.declaredInvalidations,
    }),
    input.requestedBy,
  );
  const approvalId = Number(approval.lastInsertRowid);
  const correction = db.prepare(`
    INSERT INTO landos_property_identity_correction (
      deal_card_id, prior_identity_version_id, replacement_json, evidence_refs_json,
      reason, requested_by, approval_id, declared_invalidations_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.dealCardId,
    prior.id,
    stableJson(input.replacement),
    stableJson(input.evidenceRefs),
    input.reason,
    input.requestedBy,
    approvalId,
    stableJson(input.declaredInvalidations),
  );
  const correctionId = Number(correction.lastInsertRowid);
  landosAudit(input.requestedBy, 'property_identity_correction_requested', `deal ${input.dealCardId} correction ${correctionId}`, {
    refTable: 'landos_property_identity_correction',
    refId: correctionId,
    blocked: true,
  });
  return { correctionId, approvalId };
}

export function applyApprovedPropertyIdentityCorrection(input: {
  correctionId: number;
  actor: string;
}): PropertyIdentityVersion {
  const db = getLandosDb();
  const row = db.prepare(`
    SELECT c.*, a.status AS approval_status, a.consumed_at
    FROM landos_property_identity_correction c
    JOIN landos_approval a ON a.id=c.approval_id
    WHERE c.id=?
  `).get(input.correctionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Property identity correction not found.');
  if (row.status !== 'pending') throw new Error('Property identity correction is not pending.');
  if (row.approval_status !== 'approved' || row.consumed_at != null) throw new Error('An approved, unconsumed correction approval is required.');
  const prior = readCurrentPropertyIdentity(Number(row.deal_card_id));
  if (!prior || prior.id !== Number(row.prior_identity_version_id)) throw new Error('The accepted identity changed after this correction was requested.');
  const replacement = parseJson<Partial<PropertyIdentityVersionInput>>(String(row.replacement_json), {});
  const evidenceRefs = parseJson<string[]>(String(row.evidence_refs_json), []);
  const invalidations = parseJson<string[]>(String(row.declared_invalidations_json), []);
  const next = createPropertyIdentityVersion({
    dealCardId: prior.dealCardId,
    propertyCardId: replacement.propertyCardId ?? prior.propertyCardId,
    status: replacement.status ?? prior.status,
    address: replacement.address ?? prior.address,
    city: replacement.city ?? prior.city,
    county: replacement.county ?? prior.county,
    state: replacement.state ?? prior.state,
    zip: replacement.zip ?? prior.zip,
    apn: replacement.apn ?? prior.apn,
    owner: replacement.owner ?? prior.owner,
    acreage: replacement.acreage ?? prior.acreage,
    geometry: replacement.geometry ?? prior.geometry,
    basis: replacement.basis ?? prior.basis,
    confidence: replacement.confidence ?? prior.confidence,
    sourceRefs: evidenceRefs.length ? evidenceRefs : prior.sourceRefs,
    changeReason: String(row.reason),
    createdBy: input.actor,
    allowAcceptedSupersession: true,
  });
  db.transaction(() => {
    if (invalidations.includes('property_summary')) {
      db.prepare(`
        UPDATE landos_deal_intelligence_snapshot SET status='superseded'
        WHERE deal_card_id=? AND snapshot_type='property_summary_v1' AND status='current'
      `).run(prior.dealCardId);
    }
    if (invalidations.includes('government_records')) {
      db.prepare(`
        UPDATE landos_deal_intelligence_snapshot SET status='superseded'
        WHERE deal_card_id=? AND snapshot_type='government_record_risk_v1' AND status='current'
      `).run(prior.dealCardId);
    }
    if (invalidations.includes('assessor_gis')) {
      db.prepare(`
        UPDATE landos_property_collector_job
        SET status='blocked', last_error='Invalidated by approved property identity correction.', updated_at=?
        WHERE deal_card_id=? AND collector_key='assessor_gis'
          AND property_identity_version_id=?
      `).run(nowSec(), prior.dealCardId, prior.id);
    }
    db.prepare(`
      UPDATE landos_approval SET consumed_at=?
      WHERE id=? AND status='approved' AND consumed_at IS NULL
    `).run(nowSec(), Number(row.approval_id));
    db.prepare(`
      UPDATE landos_property_identity_correction
      SET status='applied', replacement_identity_version_id=?, applied_by=?, applied_at=?
      WHERE id=?
    `).run(next.id, input.actor, nowSec(), input.correctionId);
  })();
  landosAudit(input.actor, 'property_identity_correction_applied', `deal ${prior.dealCardId} identity v${prior.version} -> v${next.version}`, {
    refTable: 'landos_property_identity_correction',
    refId: input.correctionId,
  });
  return next;
}

export function resolveGovernmentRecordArtifactPage(input: {
  dealCardId: number;
  artifactId: number;
  pageNumber?: number;
}): { path: string; mimeType: string; displayName: string } | null {
  const row = getLandosDb().prepare(`
    SELECT * FROM landos_property_record_artifact
    WHERE id=? AND deal_card_id=?
  `).get(input.artifactId, input.dealCardId) as ArtifactRow | undefined;
  if (!row) return null;
  const manifest = parseJson<string[]>(row.capture_manifest_json, []);
  const index = Math.max(0, (input.pageNumber ?? 1) - 1);
  const file = manifest[index] ?? (index === 0 ? row.storage_path : null);
  if (!file || !fs.existsSync(file)) return null;
  return { path: file, mimeType: row.mime_type, displayName: row.display_name };
}

export function makeIdentityForGovernmentRecordTest(input: PropertyIdentityVersionInput): PropertyIdentityVersion {
  return createPropertyIdentityVersion(input);
}

export function uniqueCollectorRequestKey(): string {
  return randomUUID();
}
