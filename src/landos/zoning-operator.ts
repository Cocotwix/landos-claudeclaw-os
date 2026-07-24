import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getLandosDb, landosAudit } from './db.js';
import {
  createPropertyIdentityVersion,
  readCurrentPropertyIdentity,
  type PropertyIdentityVersion,
  type PropertyIdentityVersionInput,
} from './property-summary-slice.js';
import { landosArtifactPath } from './storage-profile.js';
import { analyzeZoning } from './zoning-analyst.js';
import type {
  NormalizedZoningClaim,
  ZoningArtifactView,
  ZoningCollectorJobView,
  ZoningCorrectionView,
  ZoningDomain,
  ZoningLocatorStatus,
  ZoningReadModel,
  ZoningSnapshotView,
  ZoningWorkflowState,
} from './zoning-types.js';
import { ZONING_DOMAINS } from './zoning-types.js';

const ZONING_SNAPSHOT_TYPE = 'zoning_land_use_v1';
const CORRECTION_COLLECTOR_KEY = 'zoning_operator_correction';

export interface ZoningArtifactInput {
  artifactKey: string;
  domain: ZoningDomain;
  sourceJurisdiction: string;
  authorityName?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  portalReference?: string | null;
  ordinanceTitle?: string | null;
  ordinanceEffectiveDate?: string | null;
  sectionReference?: string | null;
  districtReference?: string | null;
  documentType: string;
  mimeType: string;
  displayName: string;
  retrievedAt: string;
  pageCount?: number;
  bytes?: Buffer;
  sourcePath?: string;
  pageSourcePaths?: string[];
}

export interface ZoningClaimInput extends Omit<NormalizedZoningClaim, 'artifactId'> {
  artifactKey?: string | null;
}

export interface ZoningCollectorInput {
  identity: PropertyIdentityVersion;
  domain: ZoningDomain;
  sourceJurisdiction: string;
  platform: string;
  adapterKey: string;
  status: 'succeeded' | 'partial' | 'blocked' | 'failed';
  outcomeKind?: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'blocked';
  error?: string | null;
  claims: ZoningClaimInput[];
  artifacts: ZoningArtifactInput[];
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

export interface TrackedZoningBrowserResource {
  key: string;
  type: 'context' | 'page' | 'popup' | 'download' | 'temporary_session';
  parentKey?: string | null;
  safeUrl?: string | null;
  close(): Promise<void>;
}

export interface ZoningCollectorAdapter {
  key: string;
  platform: string;
  collect(input: {
    identity: PropertyIdentityVersion;
    domain: ZoningDomain;
    sourceJurisdiction: string;
    track(resource: TrackedZoningBrowserResource): void;
    signal: AbortSignal;
  }): Promise<Omit<ZoningCollectorInput, 'identity' | 'domain' | 'platform' | 'adapterKey' | 'sourceJurisdiction'>>;
}

interface JobRow {
  id: number;
  property_identity_version_id: number;
  collector_key: ZoningDomain;
  status: ZoningCollectorJobView['status'];
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
  domain: ZoningDomain;
  source_jurisdiction: string;
  authority_name: string | null;
  source_name: string;
  source_url: string | null;
  portal_reference: string | null;
  ordinance_title: string | null;
  ordinance_effective_date: string | null;
  section_reference: string | null;
  district_reference: string | null;
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

function jobFromRow(row: JobRow): ZoningCollectorJobView {
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

function artifactFromRow(row: ArtifactRow): ZoningArtifactView {
  return {
    id: row.id,
    domain: row.domain,
    sourceJurisdiction: row.source_jurisdiction,
    authorityName: row.authority_name,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    portalReference: row.portal_reference,
    ordinanceTitle: row.ordinance_title,
    ordinanceEffectiveDate: row.ordinance_effective_date,
    sectionReference: row.section_reference,
    districtReference: row.district_reference,
    documentType: row.document_type,
    pageCount: row.page_count,
    captureCount: row.capture_count,
    artifactHash: row.artifact_hash,
    mimeType: row.mime_type,
    displayName: row.display_name,
    retrievedAt: row.retrieved_at,
  };
}

const EMPTY_DOMAINS = (): Record<ZoningDomain, ZoningWorkflowState> =>
  Object.fromEntries(ZONING_DOMAINS.map((domain) => [domain, 'queued'])) as Record<ZoningDomain, ZoningWorkflowState>;

function snapshotFromRow(row: SnapshotRow): ZoningSnapshotView {
  const summary = parseJson<{
    versions: ZoningSnapshotView['versions'];
    analysis: ZoningSnapshotView['analysis'];
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
      identity: 'needs_resolution' as const,
      domains: EMPTY_DOMAINS(),
      percent: 0,
      missing: [...ZONING_DOMAINS] as string[],
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
  domain: ZoningDomain;
  sourceJurisdiction: string;
  platform: string;
  adapterKey: string;
  requestKey: string;
}): { jobId: number; attemptId: number; attemptNumber: number; reusedFinal: ZoningCollectorJobView | null } {
  const db = getLandosDb();
  const inputHash = digest({
    identityVersionId: input.identity.id,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.platform,
    adapterKey: input.adapterKey,
    requestKey: input.requestKey,
  });
  const idempotencyKey = `zoning:${input.domain}:${input.identity.id}:${inputHash}`;
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
  artifact: ZoningArtifactInput;
  identity: PropertyIdentityVersion;
  jobId: number;
  attemptId: number;
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
    const directory = landosArtifactPath('zoning', `deal_${input.identity.dealCardId}`);
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
      ordinanceTitle: input.artifact.ordinanceTitle,
      unavailable: true,
    });
    storagePath = '';
    manifest = [];
  }

  const idempotencyKey = `zoning-artifact:${input.identity.id}:${input.artifact.domain}:${artifactHash}:${input.artifact.portalReference ?? input.artifact.artifactKey}`;
  const pageCount = input.artifact.pageCount ?? manifest.length;
  const existing = db.prepare('SELECT id FROM landos_property_zoning_artifact WHERE idempotency_key=?')
    .get(idempotencyKey) as { id: number } | undefined;
  if (existing) return { id: existing.id, artifactKey: input.artifact.artifactKey };
  const inserted = db.prepare(`
    INSERT INTO landos_property_zoning_artifact (
      deal_card_id, property_identity_version_id, domain, source_jurisdiction,
      authority_name, source_name, source_url, portal_reference, ordinance_title,
      ordinance_effective_date, section_reference, district_reference, document_type,
      page_count, capture_count, artifact_hash, mime_type, display_name,
      storage_path, capture_manifest_json, collector_job_id, collector_attempt_id,
      retrieved_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.identity.dealCardId,
    input.identity.id,
    input.artifact.domain,
    input.artifact.sourceJurisdiction,
    clean(input.artifact.authorityName),
    input.artifact.sourceName,
    clean(input.artifact.sourceUrl),
    clean(input.artifact.portalReference),
    clean(input.artifact.ordinanceTitle),
    clean(input.artifact.ordinanceEffectiveDate),
    clean(input.artifact.sectionReference),
    clean(input.artifact.districtReference),
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
  domain: ZoningDomain;
  claim: ZoningClaimInput;
  artifactId: number | null;
  collectorInputHash: string;
  collectorKey?: string;
}): number[] {
  const db = getLandosDb();
  const base = `zoning:${input.domain}:${input.identity.id}:${input.collectorInputHash}:${digest({
    claimKey: input.claim.claimKey,
    exactWording: input.claim.exactWording,
    normalizedValue: input.claim.normalizedValue,
    sourceUrl: input.claim.sourceUrl,
    districtCode: input.claim.districtCode,
    useName: input.claim.useName,
    useCategory: input.claim.useCategory,
    standardName: input.claim.standardName,
  })}`;
  const shared = {
    sourceKind: input.claim.sourceKind,
    authorityLevel: input.claim.authorityLevel,
    authorityName: input.claim.authorityName ?? null,
    sourceJurisdiction: input.claim.sourceJurisdiction,
    districtCode: input.claim.districtCode ?? null,
    districtName: input.claim.districtName ?? null,
    overlayName: input.claim.overlayName ?? null,
    useName: input.claim.useName ?? null,
    useCategory: input.claim.useCategory ?? null,
    standardName: input.claim.standardName ?? null,
    citation: input.claim.citation ?? null,
    needsManualReview: input.claim.needsManualReview ?? false,
    artifactPage: input.claim.artifactPage ?? null,
  };
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
      ...shared,
    }),
    input.claim.sourceName,
    input.claim.sourceUrl,
    input.claim.sourceTier,
    input.claim.locatorStatus,
    input.claim.confidence,
    input.collectorKey ?? input.domain,
    input.claim.retrievedAt,
    input.claim.effectiveAt ?? null,
    input.artifactId == null ? null : `zoning-artifact:${input.artifactId}`,
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
      locatorStatus: input.claim.locatorStatus,
      artifactId: input.artifactId,
      ...shared,
    }),
    input.claim.sourceName,
    input.claim.sourceUrl,
    input.claim.sourceTier,
    input.claim.locatorStatus,
    input.claim.confidence,
    input.collectorKey ?? input.domain,
    input.claim.retrievedAt,
    input.claim.effectiveAt ?? null,
    input.artifactId == null ? null : `zoning-artifact:${input.artifactId}`,
    input.claim.supersedesEvidenceId ?? null,
    input.claim.disputeGroup ?? null,
    normalizedKey,
  );
  const normalizedEvidenceId = normalizedResult.changes > 0
    ? Number(normalizedResult.lastInsertRowid)
    : (db.prepare('SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?').get(normalizedKey) as { id: number }).id;
  return [rawEvidenceId, normalizedEvidenceId];
}

function finishCollector(input: ZoningCollectorInput & {
  jobId: number;
  attemptId: number;
  collectorInputHash: string;
}): ZoningCollectorJobView {
  const db = getLandosDb();
  const artifactMap = new Map<string, number>();
  for (const artifact of input.artifacts) {
    const retained = retainArtifact({
      artifact,
      identity: input.identity,
      jobId: input.jobId,
      attemptId: input.attemptId,
    });
    artifactMap.set(retained.artifactKey, retained.id);
  }
  const evidenceIds: number[] = [];
  for (const claim of input.claims) {
    evidenceIds.push(...appendClaimEvidence({
      identity: input.identity,
      domain: input.domain,
      claim,
      artifactId: claim.artifactKey ? artifactMap.get(claim.artifactKey) ?? null : null,
      collectorInputHash: input.collectorInputHash,
    }));
  }
  if (input.alternateOfficialSourcesChecked?.length) {
    const alternateClaim: ZoningClaimInput = {
      claimKey: 'alternate_official_sources_checked',
      exactWording: `Alternate official sources checked: ${input.alternateOfficialSourcesChecked.join('; ')}`,
      normalizedValue: input.alternateOfficialSourcesChecked,
      domain: input.domain,
      locatorStatus: input.status === 'blocked' ? 'official_source_blocked' : 'record_referenced_document_unavailable',
      sourceKind: 'official_planning_page',
      authorityLevel: 'unknown',
      sourceName: input.sourceJurisdiction,
      sourceUrl: null,
      sourceJurisdiction: input.sourceJurisdiction,
      sourceTier: 'official_county_state',
      confidence: 'high',
      retrievedAt: new Date().toISOString(),
    };
    evidenceIds.push(...appendClaimEvidence({
      identity: input.identity,
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
  landosAudit('zoning-operator', 'zoning_collector_completed', `deal ${input.identity.dealCardId} ${input.domain} ${input.status}`, {
    refTable: 'landos_property_collector_job',
    refId: input.jobId,
    blocked: input.status === 'blocked' || input.status === 'failed',
  });
  return readJob(input.jobId);
}

function readJob(jobId: number): ZoningCollectorJobView {
  const row = getLandosDb().prepare(`
    SELECT j.*, a.cleanup_status, a.cleanup_error, a.owned_resource_count, a.open_resource_count_after
    FROM landos_property_collector_job j
    LEFT JOIN landos_property_collector_attempt a
      ON a.job_id=j.id AND a.attempt_number=j.attempt_count
    WHERE j.id=?
  `).get(jobId) as JobRow;
  return jobFromRow(row);
}

/**
 * Persist one zoning collector result as a durable job + attempt with
 * append-only evidence and artifacts. Idempotent per (identity, domain,
 * adapter, requestKey); an interrupted run resumes as a new attempt on the
 * same job. An unconfirmed identity is forced to a blocked result — zoning
 * research is anchored only to the confirmed subject parcel.
 */
export function persistZoningCollector(input: ZoningCollectorInput): ZoningCollectorJobView {
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
        error: 'Confirmed subject property identity and geometry are required before jurisdiction and zoning research.',
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

function registerOwnedResource(jobId: number, attemptId: number, resource: TrackedZoningBrowserResource): void {
  getLandosDb().prepare(`
    INSERT OR IGNORE INTO landos_browser_owned_resource (
      job_id, attempt_id, resource_key, resource_type, parent_resource_key, safe_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'open')
  `).run(jobId, attemptId, resource.key, resource.type, resource.parentKey ?? null, clean(resource.safeUrl));
}

async function closeOwnedResources(
  attemptId: number,
  resources: TrackedZoningBrowserResource[],
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

/**
 * Run a live zoning collector adapter with tracked browser/network resources,
 * a hard timeout, and guaranteed cleanup on success, failure, timeout, and
 * cancellation.
 */
export async function runTrackedZoningCollector(input: {
  identity: PropertyIdentityVersion;
  domain: ZoningDomain;
  sourceJurisdiction: string;
  adapter: ZoningCollectorAdapter;
  requestKey: string;
  timeoutMs: number;
}): Promise<ZoningCollectorJobView> {
  const started = beginCollector({
    identity: input.identity,
    domain: input.domain,
    sourceJurisdiction: input.sourceJurisdiction,
    platform: input.adapter.platform,
    adapterKey: input.adapter.key,
    requestKey: input.requestKey,
  });
  if (started.reusedFinal) return started.reusedFinal;
  const resources: TrackedZoningBrowserResource[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const abort = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let result: Omit<ZoningCollectorInput, 'identity' | 'domain' | 'platform' | 'adapterKey' | 'sourceJurisdiction'>;
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

export function recoverInterruptedZoningCollectors(actor = 'zoning-recovery'): {
  attemptsRecovered: number;
  jobsRequeued: number;
} {
  const db = getLandosDb();
  const now = nowSec();
  const domainList = ZONING_DOMAINS.map((domain) => `'${domain}'`).join(',');
  const attempts = db.prepare(`
    UPDATE landos_property_collector_attempt
    SET status='failed', outcome_kind='failed', finished_at=?,
        error=COALESCE(error, 'Interrupted before completion; resumable after managed restart.'),
        cleanup_status=CASE WHEN cleanup_status='not_applicable' THEN 'failed' ELSE cleanup_status END,
        cleanup_error=COALESCE(cleanup_error, 'Owning process exited; runtime context was destroyed.')
    WHERE status='running'
      AND job_id IN (
        SELECT id FROM landos_property_collector_job
        WHERE collector_key IN (${domainList})
      )
  `).run(now);
  const jobs = db.prepare(`
    UPDATE landos_property_collector_job
    SET status='queued', last_error='Interrupted attempt recovered after managed restart.', finished_at=NULL, updated_at=?
    WHERE status='running'
      AND collector_key IN (${domainList})
  `).run(now);
  if (attempts.changes || jobs.changes) {
    landosAudit(actor, 'zoning_collectors_recovered', `${attempts.changes} interrupted attempt(s), ${jobs.changes} job(s) requeued`, {
      refTable: 'landos_property_collector_job',
    });
  }
  return { attemptsRecovered: attempts.changes, jobsRequeued: jobs.changes };
}

function currentEvidenceIds(jobs: ZoningCollectorJobView[]): number[] {
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

function correctionEvidenceIds(dealCardId: number, identityVersionId: number): number[] {
  const rows = getLandosDb().prepare(`
    SELECT id FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND collector_key=? AND evidence_kind='normalized_claim'
    ORDER BY id
  `).all(dealCardId, identityVersionId, CORRECTION_COLLECTOR_KEY) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

interface NormalizedClaimWithEvidence extends NormalizedZoningClaim {
  evidenceId: number;
}

function readNormalizedClaims(dealCardId: number, identityVersionId: number, evidenceIds: number[]): NormalizedClaimWithEvidence[] {
  if (!evidenceIds.length) return [];
  const domainList = ZONING_DOMAINS.map((domain) => `'${domain}'`).join(',');
  const placeholders = evidenceIds.map(() => '?').join(',');
  const rows = getLandosDb().prepare(`
    SELECT id, domain, fact_key, raw_value_json, normalized_value_json, source_name,
           source_url, source_tier, verification_status, confidence, retrieved_at,
           effective_at, artifact_ref, supersedes_evidence_id, dispute_group
    FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND id IN (${placeholders})
      AND evidence_kind='normalized_claim'
      AND domain IN (${domainList})
    ORDER BY id
  `).all(dealCardId, identityVersionId, ...evidenceIds) as Array<Record<string, unknown>>;
  const claims = rows.map((row) => {
    const raw = parseJson<Record<string, unknown>>(row.raw_value_json, {});
    const normalized = parseJson<Record<string, unknown>>(row.normalized_value_json, {});
    const artifactRef = typeof row.artifact_ref === 'string' ? row.artifact_ref.match(/^zoning-artifact:(\d+)$/) : null;
    return {
      evidenceId: Number(row.id),
      claimKey: String(row.fact_key ?? ''),
      exactWording: String(raw.exactWording ?? ''),
      normalizedValue: normalized.value,
      domain: row.domain as ZoningDomain,
      locatorStatus: normalized.locatorStatus as ZoningLocatorStatus,
      sourceKind: (normalized.sourceKind ?? 'third_party') as NormalizedZoningClaim['sourceKind'],
      authorityLevel: (normalized.authorityLevel ?? 'unknown') as NormalizedZoningClaim['authorityLevel'],
      authorityName: clean(normalized.authorityName == null ? null : String(normalized.authorityName)),
      sourceName: String(row.source_name),
      sourceUrl: clean(row.source_url == null ? null : String(row.source_url)),
      sourceJurisdiction: String(normalized.sourceJurisdiction ?? ''),
      sourceTier: String(row.source_tier),
      confidence: row.confidence as NormalizedZoningClaim['confidence'],
      retrievedAt: String(row.retrieved_at),
      effectiveAt: clean(row.effective_at == null ? null : String(row.effective_at)),
      districtCode: clean(normalized.districtCode == null ? null : String(normalized.districtCode)),
      districtName: clean(normalized.districtName == null ? null : String(normalized.districtName)),
      overlayName: clean(normalized.overlayName == null ? null : String(normalized.overlayName)),
      useName: clean(normalized.useName == null ? null : String(normalized.useName)),
      useCategory: (normalized.useCategory ?? null) as NormalizedZoningClaim['useCategory'],
      standardName: clean(normalized.standardName == null ? null : String(normalized.standardName)),
      citation: (normalized.citation ?? null) as NormalizedZoningClaim['citation'],
      needsManualReview: normalized.needsManualReview === true,
      artifactId: artifactRef ? Number(artifactRef[1]) : normalized.artifactId == null ? null : Number(normalized.artifactId),
      artifactPage: normalized.artifactPage == null ? null : Number(normalized.artifactPage),
      supersedesEvidenceId: row.supersedes_evidence_id == null ? null : Number(row.supersedes_evidence_id),
      disputeGroup: clean(row.dispute_group == null ? null : String(row.dispute_group)),
    };
  });
  // A correction claim supersedes the claim it replaces: drop superseded rows.
  const superseded = new Set(claims.map((claim) => claim.supersedesEvidenceId).filter((id): id is number => id != null));
  return claims.filter((claim) => !superseded.has(claim.evidenceId));
}

function domainWorkflowState(
  identityConfirmed: boolean,
  job: ZoningCollectorJobView | undefined,
  claims: NormalizedClaimWithEvidence[],
): ZoningWorkflowState {
  if (!identityConfirmed) return 'blocked';
  if (!job) return 'queued';
  if (claims.some((claim) => claim.disputeGroup)) return 'conflicted';
  if (claims.some((claim) => claim.needsManualReview)) return 'manual_review_needed';
  switch (job.status) {
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'succeeded': return 'complete';
    case 'partial': return 'partial';
    case 'blocked': return 'blocked';
    case 'failed': return 'unavailable';
    default: return 'queued';
  }
}

export function generateZoningSnapshot(input: {
  identity: PropertyIdentityVersion;
  jobs: ZoningCollectorJobView[];
  changeReason: string;
  generatedBy: string;
}): ZoningSnapshotView {
  const db = getLandosDb();
  const selectedEvidenceIds = [...new Set([
    ...currentEvidenceIds(input.jobs),
    ...correctionEvidenceIds(input.identity.dealCardId, input.identity.id),
  ])];
  const claims = readNormalizedClaims(input.identity.dealCardId, input.identity.id, selectedEvidenceIds);
  const aggregate = {
    count: selectedEvidenceIds.length,
    max_id: selectedEvidenceIds.length ? Math.max(...selectedEvidenceIds) : null,
  };
  const artifacts = listArtifacts(input.identity.dealCardId, input.identity.id);
  const analysis = analyzeZoning({
    schemaVersion: 'zoning-normalized-v1',
    artifactSchemaVersion: 'zoning-artifact-v1',
    propertyIdentity: {
      id: input.identity.id,
      version: input.identity.version,
      status: input.identity.status,
      apn: input.identity.apn,
      address: input.identity.address,
      city: input.identity.city,
      county: input.identity.county,
      state: input.identity.state,
      geometryPresent: input.identity.geometry != null,
    },
    evidenceVersion: { maxEvidenceId: aggregate.max_id, evidenceCount: aggregate.count },
    claims,
    artifacts,
  });
  const identityComplete = input.identity.status === 'confirmed';
  const domains = Object.fromEntries(ZONING_DOMAINS.map((domain) => {
    const job = input.jobs.find((candidate) => candidate.collectorKey === domain);
    const domainClaims = claims.filter((claim) => claim.domain === domain);
    return [domain, domainWorkflowState(identityComplete, job, domainClaims)];
  })) as Record<ZoningDomain, ZoningWorkflowState>;
  const completedUnits = ZONING_DOMAINS.reduce((sum, domain) => {
    const state = domains[domain];
    return sum + (state === 'complete' ? 1 : state === 'partial' || state === 'conflicted' || state === 'manual_review_needed' ? 0.5 : 0);
  }, 0);
  const completeness: ZoningSnapshotView['completeness'] = {
    identity: identityComplete ? 'complete' : 'needs_resolution',
    domains,
    percent: identityComplete ? Math.round((completedUnits / ZONING_DOMAINS.length) * 100) : 0,
    missing: [
      ...(!identityComplete ? ['Confirmed property identity'] : []),
      ...ZONING_DOMAINS.filter((domain) => domains[domain] !== 'complete'),
    ],
  };
  const versions: ZoningSnapshotView['versions'] = {
    propertyIdentityVersion: input.identity.version,
    normalizedEvidenceSchema: 'zoning-normalized-v1',
    artifactSchema: 'zoning-artifact-v1',
    analystEngine: 'zoning-analyst-v1',
    snapshotSchema: 'zoning-land-use-snapshot-v1',
  };
  const inputHash = digest({
    identityVersionId: input.identity.id,
    jobs: input.jobs.map((job) => [job.id, job.status, job.attemptCount, job.cleanupStatus]),
    evidenceMaxId: aggregate.max_id,
    evidenceIds: selectedEvidenceIds,
    artifacts: artifacts.map((artifact) => [artifact.id, artifact.artifactHash]),
    versions,
    completeness,
    analysis,
  });
  const existing = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='${ZONING_SNAPSHOT_TYPE}' AND input_hash=?
  `).get(input.identity.dealCardId, inputHash) as SnapshotRow | undefined;
  if (existing) return snapshotFromRow(existing);

  const snapshotId = db.transaction(() => {
    const prior = db.prepare(`
      SELECT * FROM landos_deal_intelligence_snapshot
      WHERE deal_card_id=? AND snapshot_type='${ZONING_SNAPSHOT_TYPE}' AND status='current'
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
      ) VALUES (?, ?, ?, ?, '${ZONING_SNAPSHOT_TYPE}', 'current', ?, ?, ?, ?, ?, ?)
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
  landosAudit(input.generatedBy, 'deal_intelligence_snapshot_created', `deal ${input.identity.dealCardId} zoning/land-use snapshot created`, {
    refTable: 'landos_deal_intelligence_snapshot',
    refId: snapshotId,
  });
  return snapshotFromRow(db.prepare('SELECT * FROM landos_deal_intelligence_snapshot WHERE id=?').get(snapshotId) as SnapshotRow);
}

function listJobs(dealCardId: number, identityVersionId: number): ZoningCollectorJobView[] {
  const domainList = ZONING_DOMAINS.map((domain) => `'${domain}'`).join(',');
  const rows = getLandosDb().prepare(`
    SELECT j.*, a.cleanup_status, a.cleanup_error, a.owned_resource_count, a.open_resource_count_after
    FROM landos_property_collector_job j
    LEFT JOIN landos_property_collector_attempt a
      ON a.job_id=j.id AND a.attempt_number=j.attempt_count
    WHERE j.deal_card_id=? AND j.property_identity_version_id=?
      AND j.collector_key IN (${domainList})
    ORDER BY j.id
  `).all(dealCardId, identityVersionId) as JobRow[];
  const latest = new Map<ZoningDomain, JobRow>();
  for (const row of rows) latest.set(row.collector_key, row);
  return ZONING_DOMAINS
    .map((domain) => latest.get(domain))
    .filter((row): row is JobRow => !!row)
    .map(jobFromRow);
}

function listArtifacts(dealCardId: number, identityVersionId: number): ZoningArtifactView[] {
  const rows = getLandosDb().prepare(`
    SELECT * FROM landos_property_zoning_artifact
    WHERE deal_card_id=? AND property_identity_version_id=?
    ORDER BY domain, id
  `).all(dealCardId, identityVersionId) as ArtifactRow[];
  return rows.map(artifactFromRow);
}

function listCorrections(dealCardId: number): ZoningCorrectionView[] {
  const rows = getLandosDb().prepare(`
    SELECT * FROM landos_zoning_correction
    WHERE deal_card_id=? ORDER BY requested_at DESC, id DESC
  `).all(dealCardId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    status: String(row.status),
    domain: row.domain as ZoningDomain,
    priorValue: parseJson(String(row.prior_value_json), null),
    replacementValue: parseJson(String(row.replacement_value_json), null),
    evidenceRefs: parseJson(String(row.evidence_refs_json), []),
    reason: String(row.reason),
    requestedBy: String(row.requested_by),
    approvalId: row.approval_id == null ? null : Number(row.approval_id),
    declaredInvalidations: parseJson(String(row.declared_invalidations_json), []),
    requestedAt: Number(row.requested_at),
    appliedAt: row.applied_at == null ? null : Number(row.applied_at),
  }));
}

export function getZoningReadModel(dealCardId: number): ZoningReadModel | null {
  const db = getLandosDb();
  const identity = readCurrentPropertyIdentity(dealCardId);
  if (!identity) return null;
  const snapshot = db.prepare(`
    SELECT * FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='${ZONING_SNAPSHOT_TYPE}' AND status='current'
    LIMIT 1
  `).get(dealCardId) as SnapshotRow | undefined;
  const domainList = ZONING_DOMAINS.map((domain) => `'${domain}'`).join(',');
  const evidenceCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM landos_property_evidence_item
    WHERE deal_card_id=? AND property_identity_version_id=?
      AND domain IN (${domainList})
  `).get(dealCardId, identity.id) as { count: number }).count;
  const jobs = listJobs(dealCardId, identity.id);
  const snapshotView = snapshot ? snapshotFromRow(snapshot) : null;
  const domainStates = snapshotView && snapshotView.identityVersionId === identity.id
    ? snapshotView.completeness.domains
    : Object.fromEntries(ZONING_DOMAINS.map((domain) => {
        // A snapshot generated for a superseded identity version is stale.
        if (snapshotView && snapshotView.identityVersionId !== identity.id) return [domain, 'superseded'];
        const job = jobs.find((candidate) => candidate.collectorKey === domain);
        return [domain, domainWorkflowState(identity.status === 'confirmed', job, [])];
      })) as Record<ZoningDomain, ZoningWorkflowState>;
  return {
    identity: {
      id: identity.id,
      version: identity.version,
      status: identity.status,
      address: identity.address,
      city: identity.city,
      county: identity.county,
      state: identity.state,
      apn: identity.apn,
    },
    snapshot: snapshotView,
    jobs,
    domainStates,
    artifacts: listArtifacts(dealCardId, identity.id),
    evidenceCount,
    corrections: listCorrections(dealCardId),
  };
}

/**
 * Orchestrating rebuild: persist every supplied collector result, fill the
 * missing domains with an honest partial/blocked record, then generate one
 * versioned snapshot through the pure Analyst. One failed source never blocks
 * the other domains.
 */
export function synchronizeZoningSlice(input: {
  identity: PropertyIdentityVersion;
  collectors: ZoningCollectorInput[];
  changeReason: string;
  generatedBy: string;
}): ZoningReadModel {
  for (const collector of input.collectors) {
    persistZoningCollector({ ...collector, identity: input.identity });
  }
  // Latest persisted job per domain, including tracked live collectors that
  // ran before this synchronize call.
  const persisted = listJobs(input.identity.dealCardId, input.identity.id);
  for (const domain of ZONING_DOMAINS) {
    if (persisted.some((job) => job.collectorKey === domain)) continue;
    persistZoningCollector({
      identity: input.identity,
      domain,
      sourceJurisdiction: [input.identity.county, input.identity.state].filter(Boolean).join(', '),
      platform: 'unresolved',
      adapterKey: 'missing-collector',
      status: input.identity.status === 'confirmed' ? 'partial' : 'blocked',
      outcomeKind: input.identity.status === 'confirmed' ? 'completed' : 'blocked',
      error: input.identity.status === 'confirmed'
        ? 'No official-source result is available for this zoning domain yet.'
        : 'Confirmed subject property identity is required before jurisdiction and zoning research.',
      claims: [{
        claimKey: 'collection_status',
        exactWording: input.identity.status === 'confirmed'
          ? 'No official-source result is available for this zoning domain yet.'
          : 'Zoning research withheld until the subject property is confirmed.',
        normalizedValue: null,
        domain,
        locatorStatus: input.identity.status === 'confirmed' ? 'not_searched' : 'official_source_blocked',
        sourceKind: 'official_planning_page',
        authorityLevel: 'unknown',
        sourceName: [input.identity.county, input.identity.state].filter(Boolean).join(', ') || 'Official jurisdiction unresolved',
        sourceUrl: null,
        sourceJurisdiction: [input.identity.county, input.identity.state].filter(Boolean).join(', '),
        sourceTier: 'official_county_state',
        confidence: 'unknown',
        retrievedAt: new Date().toISOString(),
      }],
      artifacts: [],
      requestKey: `missing:${domain}:${input.identity.id}`,
    });
  }
  generateZoningSnapshot({
    identity: input.identity,
    jobs: listJobs(input.identity.dealCardId, input.identity.id),
    changeReason: input.changeReason,
    generatedBy: input.generatedBy,
  });
  return getZoningReadModel(input.identity.dealCardId)!;
}

/**
 * Request a zoning/jurisdiction correction. The prior value is captured from
 * the current snapshot so nothing is overwritten silently; applying the
 * correction appends new evidence and produces a new snapshot version, and
 * invalidates only the declared dependent outputs.
 */
export function requestZoningCorrection(input: {
  dealCardId: number;
  domain: ZoningDomain;
  priorValue: unknown;
  replacement: {
    claimKey: string;
    exactWording: string;
    normalizedValue: unknown;
    sourceKind: NormalizedZoningClaim['sourceKind'];
    authorityLevel: NormalizedZoningClaim['authorityLevel'];
    authorityName?: string | null;
    sourceName: string;
    sourceUrl: string | null;
    districtCode?: string | null;
    districtName?: string | null;
    citation?: NormalizedZoningClaim['citation'];
    supersedesEvidenceId?: number | null;
  };
  evidenceRefs: string[];
  reason: string;
  requestedBy: string;
  declaredInvalidations: Array<'zoning_land_use' | 'valuation' | 'strategy' | 'development_conclusions'>;
  requireApproval?: boolean;
}): { correctionId: number; approvalId: number | null } {
  const db = getLandosDb();
  const identity = readCurrentPropertyIdentity(input.dealCardId);
  if (!identity) throw new Error('A current property identity is required before a zoning correction.');
  const priorSnapshot = db.prepare(`
    SELECT id FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type='${ZONING_SNAPSHOT_TYPE}' AND status='current'
    LIMIT 1
  `).get(input.dealCardId) as { id: number } | undefined;
  let approvalId: number | null = null;
  if (input.requireApproval) {
    const approval = db.prepare(`
      INSERT INTO landos_approval (entity, action_type, title, payload, requested_by)
      VALUES (NULL, 'zoning_correction', ?, ?, ?)
    `).run(
      `Correct accepted zoning conclusion for Deal Card ${input.dealCardId}`,
      stableJson({
        dealCardId: input.dealCardId,
        domain: input.domain,
        priorValue: input.priorValue,
        replacement: input.replacement,
        evidenceRefs: input.evidenceRefs,
        reason: input.reason,
        declaredInvalidations: input.declaredInvalidations,
      }),
      input.requestedBy,
    );
    approvalId = Number(approval.lastInsertRowid);
  }
  const correction = db.prepare(`
    INSERT INTO landos_zoning_correction (
      deal_card_id, property_identity_version_id, prior_snapshot_id, domain,
      prior_value_json, replacement_value_json, evidence_refs_json, reason,
      requested_by, approval_id, declared_invalidations_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.dealCardId,
    identity.id,
    priorSnapshot?.id ?? null,
    input.domain,
    stableJson(input.priorValue),
    stableJson(input.replacement),
    stableJson(input.evidenceRefs),
    input.reason,
    input.requestedBy,
    approvalId,
    stableJson(input.declaredInvalidations),
  );
  const correctionId = Number(correction.lastInsertRowid);
  landosAudit(input.requestedBy, 'zoning_correction_requested', `deal ${input.dealCardId} zoning correction ${correctionId} (${input.domain})`, {
    refTable: 'landos_zoning_correction',
    refId: correctionId,
    blocked: input.requireApproval === true,
  });
  return { correctionId, approvalId };
}

export function applyZoningCorrection(input: {
  correctionId: number;
  actor: string;
}): ZoningReadModel {
  const db = getLandosDb();
  const row = db.prepare(`
    SELECT c.*, a.status AS approval_status, a.consumed_at
    FROM landos_zoning_correction c
    LEFT JOIN landos_approval a ON a.id=c.approval_id
    WHERE c.id=?
  `).get(input.correctionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Zoning correction not found.');
  if (row.status !== 'pending') throw new Error('Zoning correction is not pending.');
  if (row.approval_id != null && (row.approval_status !== 'approved' || row.consumed_at != null)) {
    throw new Error('An approved, unconsumed correction approval is required.');
  }
  const dealCardId = Number(row.deal_card_id);
  const identity = readCurrentPropertyIdentity(dealCardId);
  if (!identity || identity.id !== Number(row.property_identity_version_id)) {
    throw new Error('The accepted identity changed after this zoning correction was requested.');
  }
  const domain = row.domain as ZoningDomain;
  const replacement = parseJson<Record<string, unknown>>(String(row.replacement_value_json), {});
  const claim: ZoningClaimInput = {
    claimKey: String(replacement.claimKey ?? `${domain}_correction`),
    exactWording: String(replacement.exactWording ?? ''),
    normalizedValue: replacement.normalizedValue,
    domain,
    locatorStatus: 'record_located',
    sourceKind: (replacement.sourceKind ?? 'official_government_document') as NormalizedZoningClaim['sourceKind'],
    authorityLevel: (replacement.authorityLevel ?? 'unknown') as NormalizedZoningClaim['authorityLevel'],
    authorityName: replacement.authorityName == null ? null : String(replacement.authorityName),
    sourceName: String(replacement.sourceName ?? 'Operator-confirmed correction'),
    sourceUrl: replacement.sourceUrl == null ? null : String(replacement.sourceUrl),
    sourceJurisdiction: [identity.county, identity.state].filter(Boolean).join(', '),
    sourceTier: 'operator_confirmed_correction',
    confidence: 'high',
    retrievedAt: new Date().toISOString(),
    districtCode: replacement.districtCode == null ? null : String(replacement.districtCode),
    districtName: replacement.districtName == null ? null : String(replacement.districtName),
    citation: (replacement.citation ?? null) as NormalizedZoningClaim['citation'],
    supersedesEvidenceId: replacement.supersedesEvidenceId == null ? null : Number(replacement.supersedesEvidenceId),
  };
  const evidenceIds = appendClaimEvidence({
    identity,
    domain,
    claim,
    artifactId: null,
    collectorInputHash: digest({ correctionId: input.correctionId, claim }),
    collectorKey: CORRECTION_COLLECTOR_KEY,
  });
  const invalidations = parseJson<string[]>(String(row.declared_invalidations_json), []);
  db.transaction(() => {
    // Only the declared dependent outputs are invalidated. The zoning snapshot
    // itself is superseded so the next snapshot generation creates a new
    // version containing the corrective evidence. Unrelated evidence domains
    // (deed, tax, seller, environmental) are never touched.
    if (invalidations.includes('zoning_land_use')) {
      db.prepare(`
        UPDATE landos_deal_intelligence_snapshot SET status='superseded'
        WHERE deal_card_id=? AND snapshot_type='${ZONING_SNAPSHOT_TYPE}' AND status='current'
      `).run(dealCardId);
    }
    if (row.approval_id != null) {
      db.prepare(`
        UPDATE landos_approval SET consumed_at=?
        WHERE id=? AND status='approved' AND consumed_at IS NULL
      `).run(nowSec(), Number(row.approval_id));
    }
    db.prepare(`
      UPDATE landos_zoning_correction
      SET status='applied', replacement_evidence_id=?, applied_by=?, applied_at=?
      WHERE id=?
    `).run(evidenceIds[1] ?? evidenceIds[0] ?? null, input.actor, nowSec(), input.correctionId);
  })();
  const jobs = listJobs(dealCardId, identity.id);
  generateZoningSnapshot({
    identity,
    jobs,
    changeReason: `Zoning correction ${input.correctionId} applied: ${String(row.reason)}`,
    generatedBy: input.actor,
  });
  landosAudit(input.actor, 'zoning_correction_applied', `deal ${dealCardId} zoning correction ${input.correctionId} applied (${domain})`, {
    refTable: 'landos_zoning_correction',
    refId: input.correctionId,
  });
  return getZoningReadModel(dealCardId)!;
}

export function resolveZoningArtifactPage(input: {
  dealCardId: number;
  artifactId: number;
  pageNumber?: number;
}): { path: string; mimeType: string; displayName: string } | null {
  const row = getLandosDb().prepare(`
    SELECT * FROM landos_property_zoning_artifact
    WHERE id=? AND deal_card_id=?
  `).get(input.artifactId, input.dealCardId) as ArtifactRow | undefined;
  if (!row) return null;
  const manifest = parseJson<string[]>(row.capture_manifest_json, []);
  const index = Math.max(0, (input.pageNumber ?? 1) - 1);
  const file = manifest[index] ?? (index === 0 ? row.storage_path : null);
  if (!file || !fs.existsSync(file)) return null;
  return { path: file, mimeType: row.mime_type, displayName: row.display_name };
}

export function makeIdentityForZoningTest(input: PropertyIdentityVersionInput): PropertyIdentityVersion {
  return createPropertyIdentityVersion(input);
}

export function uniqueZoningRequestKey(): string {
  return randomUUID();
}
