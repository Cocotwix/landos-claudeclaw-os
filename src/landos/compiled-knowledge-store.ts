// Canonical LandOS company-knowledge storage.
//
// V1 is intentionally structured/exact. This module resolves every provenance
// reference before acceptance and stores no embeddings, chunks or search index.

import { createHash } from 'node:crypto';

import { getLandosDb, landosAudit } from './db.js';
import type {
  KnowledgeCandidateInput,
  KnowledgeEvidenceNamespace,
  KnowledgeFreshnessPolicy,
  KnowledgeReadBundle,
  KnowledgeReadItem,
  KnowledgeReadState,
  KnowledgeSourceAction,
  KnowledgeSupportInput,
  KnowledgeWriteResult,
  LandosKnowledgeRecord,
} from './knowledge-contract.js';

const VERIFIED_PROPERTY_EVIDENCE_STATUSES = new Set([
  'verified',
  'source_verified',
  // Existing derived intelligence uses this label to say the evidence is
  // retained ABOUT an already identified parcel, not that it proves identity.
  'retained_not_identity_verifying',
]);

export const JURISDICTION_PROCEDURE_FRESHNESS_DAYS = 180;
export const SOURCE_LOCATOR_FRESHNESS_DAYS = 90;

type ResolvedSupport = {
  accepted: boolean;
  reason: string;
  fingerprint: string;
  label: string;
  url: string | null;
  retrievedAt: string | null;
};

type KnowledgeRow = {
  id: string;
  domain: LandosKnowledgeRecord['domain'];
  knowledge_type: LandosKnowledgeRecord['knowledgeType'];
  scope_kind: LandosKnowledgeRecord['scopeKind'];
  scope_key: string;
  subject_key: string;
  statement: string;
  value_json: string;
  source_authority: string;
  confidence: LandosKnowledgeRecord['confidence'];
  status: LandosKnowledgeRecord['status'];
  sensitivity: LandosKnowledgeRecord['sensitivity'];
  effective_from: string | null;
  effective_to: string | null;
  retrieved_at: string;
  last_verified_at: string;
  freshness_policy: LandosKnowledgeRecord['freshnessPolicy'];
  fresh_until: string | null;
  supersedes_knowledge_id: string | null;
  dispute_group: string | null;
  content_hash: string;
  compiler_version: string;
  created_by: string;
  acceptance_reason: string;
  created_at: string;
  updated_at: string;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]),
  );
}
function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function iso(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function freshUntilFor(policy: KnowledgeFreshnessPolicy, lastVerifiedAt: string): string | null {
  const verified = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(verified)) return null;
  const days = policy === 'source_locator'
    ? SOURCE_LOCATOR_FRESHNESS_DAYS
    : JURISDICTION_PROCEDURE_FRESHNESS_DAYS;
  return new Date(verified + days * 86_400_000).toISOString();
}

function resolveSupport(support: KnowledgeSupportInput): ResolvedSupport {
  const db = getLandosDb();
  if (!/^\d+$/.test(support.evidenceRef)) {
    return { accepted: false, reason: 'the evidence reference is not a numeric LandOS row id', fingerprint: '', label: '', url: null, retrievedAt: null };
  }
  const id = Number(support.evidenceRef);

  if (support.evidenceNamespace === 'property_evidence') {
    const row = db.prepare(`
      SELECT id, domain, evidence_kind, fact_key, normalized_value_json, source_name,
             source_url, source_tier, verification_status, confidence, retrieved_at
      FROM landos_property_evidence_item WHERE id=?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return { accepted: false, reason: 'the property evidence row does not exist', fingerprint: '', label: '', url: null, retrievedAt: null };
    const sourceUrl = row.source_url == null ? null : String(row.source_url);
    const accepted = VERIFIED_PROPERTY_EVIDENCE_STATUSES.has(String(row.verification_status))
      && String(row.source_tier) === 'official_government_source'
      && /^https?:\/\//i.test(sourceUrl ?? '');
    return {
      accepted,
      reason: accepted
        ? 'verified official property evidence resolved'
        : 'property evidence is not retained verified official-source evidence with a source URL',
      fingerprint: hash(stableJson(row)),
      label: String(row.source_name ?? 'Official source'),
      url: sourceUrl,
      retrievedAt: row.retrieved_at == null ? null : String(row.retrieved_at),
    };
  }

  if (support.evidenceNamespace === 'regulation_document') {
    const row = db.prepare(`
      SELECT id, state, jurisdiction_key, unit_type, jurisdiction, doc_kind, url,
             label, adopted_or_as_of, draft_or_proposed, last_verified_at
      FROM landos_regulation_document WHERE id=?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return { accepted: false, reason: 'the regulation document row does not exist', fingerprint: '', label: '', url: null, retrievedAt: null };
    const sourceUrl = String(row.url ?? '');
    const accepted = Number(row.draft_or_proposed) === 0 && /^https?:\/\//i.test(sourceUrl);
    return {
      accepted,
      reason: accepted ? 'retained adopted official regulation document resolved' : 'the regulation document is draft/proposed or lacks an official URL',
      fingerprint: hash(stableJson(row)),
      label: String(row.label ?? sourceUrl),
      url: sourceUrl || null,
      retrievedAt: Number.isFinite(Number(row.last_verified_at))
        ? new Date(Number(row.last_verified_at) * 1_000).toISOString()
        : null,
    };
  }

  if (support.evidenceNamespace === 'official_site') {
    const row = db.prepare(`
      SELECT id, state, jurisdiction_key, unit_type, jurisdiction, url, label,
             verified_via, basis, last_verified_at
      FROM landos_official_site WHERE id=?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return { accepted: false, reason: 'the official-site row does not exist', fingerprint: '', label: '', url: null, retrievedAt: null };
    const sourceUrl = String(row.url ?? '');
    const accepted = /^https?:\/\//i.test(sourceUrl) && Boolean(String(row.verified_via ?? '').trim());
    return {
      accepted,
      reason: accepted ? 'verified official-site record resolved' : 'the official-site record is not verified',
      fingerprint: hash(stableJson(row)),
      label: String(row.label ?? sourceUrl),
      url: sourceUrl || null,
      retrievedAt: Number.isFinite(Number(row.last_verified_at))
        ? new Date(Number(row.last_verified_at) * 1_000).toISOString()
        : null,
    };
  }

  return {
    accepted: false,
    reason: `${support.evidenceNamespace} is not an accepted deterministic support namespace in Jurisdiction Knowledge V1`,
    fingerprint: '',
    label: '',
    url: null,
    retrievedAt: null,
  };
}
function recordOf(row: KnowledgeRow): LandosKnowledgeRecord {
  return {
    id: row.id,
    domain: row.domain,
    knowledgeType: row.knowledge_type,
    scopeKind: row.scope_kind,
    scopeKey: row.scope_key,
    subjectKey: row.subject_key,
    statement: row.statement,
    value: parseJson(row.value_json),
    sourceAuthority: row.source_authority,
    confidence: row.confidence,
    status: row.status,
    sensitivity: row.sensitivity,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    retrievedAt: row.retrieved_at,
    lastVerifiedAt: row.last_verified_at,
    freshnessPolicy: row.freshness_policy,
    freshUntil: row.fresh_until,
    supersedesKnowledgeId: row.supersedes_knowledge_id,
    disputeGroup: row.dispute_group,
    contentHash: row.content_hash,
    compilerVersion: row.compiler_version,
    createdBy: row.created_by,
    acceptanceReason: row.acceptance_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stateOf(record: LandosKnowledgeRecord, now: number): KnowledgeReadState {
  if (record.status === 'conflicting') return 'CONFLICTING';
  if (record.status === 'unresolved') return 'UNRESOLVED';
  if (record.status === 'superseded') return 'SUPERSEDED';
  const freshUntil = record.freshUntil == null ? Number.NaN : Date.parse(record.freshUntil);
  return Number.isFinite(freshUntil) && now <= freshUntil ? 'CURRENT' : 'STALE';
}

function sourceActions(knowledgeId: string): KnowledgeSourceAction[] {
  const rows = getLandosDb().prepare(`
    SELECT evidence_namespace, evidence_ref, role, evidence_fingerprint
    FROM landos_knowledge_support WHERE knowledge_id=? ORDER BY id
  `).all(knowledgeId) as Array<{
    evidence_namespace: KnowledgeEvidenceNamespace;
    evidence_ref: string;
    role: KnowledgeSourceAction['role'];
    evidence_fingerprint: string;
  }>;
  return rows.map((row) => {
    const resolved = resolveSupport({ evidenceNamespace: row.evidence_namespace, evidenceRef: row.evidence_ref, role: row.role });
    return {
      evidenceNamespace: row.evidence_namespace,
      evidenceRef: row.evidence_ref,
      role: row.role,
      label: resolved.label || row.evidence_namespace.replace(/_/g, ' '),
      url: resolved.url,
      retrievedAt: resolved.retrievedAt,
      fingerprintDrifted: !resolved.accepted || resolved.fingerprint !== row.evidence_fingerprint,
      supportStillAccepted: resolved.accepted,
    };
  });
}

function audit(action: string, input: KnowledgeCandidateInput, knowledgeId: string | null, detail: string): void {
  landosAudit(
    input.createdBy,
    action,
    `${knowledgeId ?? 'none'} | ${input.domain}/${input.scopeKey}/${input.subjectKey} | compiler=${input.compilerVersion} | ${detail}`,
    { refTable: 'landos_knowledge_record' },
  );
}

/**
 * Accept one deterministic candidate after resolving every support reference.
 * A different value without controlling effective/version evidence opens a
 * conflict; retrieval never guesses which legal rule wins.
 */
export function acceptKnowledgeCandidate(input: KnowledgeCandidateInput): KnowledgeWriteResult {
  const scopeKey = input.scopeKey.trim();
  const subjectKey = input.subjectKey.trim();
  const statement = input.statement.replace(/\s+/g, ' ').trim().slice(0, 1_000);
  if (!scopeKey || !subjectKey || !statement || input.supports.length === 0) {
    const reason = 'knowledge requires a scope, subject, bounded statement and at least one evidence support';
    audit('knowledge_rejected', input, null, reason);
    return { outcome: 'rejected', knowledgeId: null, replacedKnowledgeId: null, reason };
  }
  if (input.domain === 'jurisdiction' && (input.scopeKind !== 'jurisdiction'
    || !['public', 'internal'].includes(input.sensitivity)
    || input.sourceAuthority !== 'official_government_source'
    || !['confirmed', 'well_supported', 'unresolved'].includes(input.confidence))) {
    const reason = 'jurisdiction knowledge must be jurisdiction-scoped, public/internal, and confirmed by official-government evidence';
    audit('knowledge_rejected', input, null, reason);
    return { outcome: 'rejected', knowledgeId: null, replacedKnowledgeId: null, reason };
  }

  const supports = input.supports.map((support) => ({ input: support, resolved: resolveSupport(support) }));
  const invalid = supports.find((support) => !support.resolved.accepted);
  if (invalid) {
    const reason = `support ${invalid.input.evidenceNamespace}:${invalid.input.evidenceRef} rejected: ${invalid.resolved.reason}`;
    audit('knowledge_rejected', input, null, reason);
    return { outcome: 'rejected', knowledgeId: null, replacedKnowledgeId: null, reason };
  }

  const valueJson = stableJson(input.value);
  const contentHash = hash(stableJson({ domain: input.domain, scopeKind: input.scopeKind, scopeKey, subjectKey, value: input.value }));
  const effectiveFrom = input.effectiveFrom ? iso(input.effectiveFrom) ?? input.effectiveFrom.trim() : null;
  const retrievedAt = iso(input.retrievedAt) ?? input.retrievedAt;
  const lastVerifiedAt = iso(input.lastVerifiedAt) ?? input.lastVerifiedAt;
  const freshUntil = freshUntilFor(input.freshnessPolicy, lastVerifiedAt);
  const id = `kn_${hash(`${input.domain}|${input.scopeKind}|${scopeKey}|${subjectKey}|${effectiveFrom ?? 'no-effective-date'}|${contentHash}`).slice(0, 32)}`;
  const now = new Date().toISOString();
  const db = getLandosDb();
  const existing = db.prepare(`
    SELECT * FROM landos_knowledge_record
    WHERE domain=? AND scope_kind=? AND scope_key=? AND subject_key=?
      AND status IN ('active','conflicting','unresolved')
    ORDER BY created_at, id
  `).all(input.domain, input.scopeKind, scopeKey, subjectKey) as KnowledgeRow[];
  const same = existing.find((row) => row.content_hash === contentHash);

  if (same) {
    db.transaction(() => {
      db.prepare(`
        UPDATE landos_knowledge_record
        SET statement=?, retrieved_at=?, last_verified_at=?, fresh_until=?, compiler_version=?,
            acceptance_reason=?, updated_at=? WHERE id=?
      `).run(statement, retrievedAt, lastVerifiedAt, freshUntil, input.compilerVersion, input.acceptanceReason, now, same.id);
      const insertSupport = db.prepare(`
        INSERT INTO landos_knowledge_support (
          knowledge_id, evidence_namespace, evidence_ref, role, evidence_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(knowledge_id, evidence_namespace, evidence_ref, role)
        DO UPDATE SET evidence_fingerprint=excluded.evidence_fingerprint
      `);
      for (const support of supports) insertSupport.run(
        same.id,
        support.input.evidenceNamespace,
        support.input.evidenceRef,
        support.input.role ?? 'supports',
        support.resolved.fingerprint,
        now,
      );
    })();
    audit('knowledge_reverified', input, same.id, 'same structured value; support/freshness advanced');
    return { outcome: 'reverified', knowledgeId: same.id, replacedKnowledgeId: null, reason: 'same structured value reverified' };
  }

  const active = existing.filter((row) => row.status === 'active');
  const newEffective = effectiveFrom == null ? Number.NaN : Date.parse(effectiveFrom);
  const replaceable = active.length === 1
    && Number.isFinite(newEffective)
    && active[0].effective_from != null
    && Number.isFinite(Date.parse(active[0].effective_from))
    && newEffective > Date.parse(active[0].effective_from);
  const disputeGroup = existing.length && !replaceable
    ? `kd_${hash(`${input.domain}|${input.scopeKind}|${scopeKey}|${subjectKey}`).slice(0, 24)}`
    : null;
  const status = input.confidence === 'unresolved' ? 'unresolved' : disputeGroup ? 'conflicting' : 'active';
  const replacedId = replaceable ? active[0].id : null;

  db.transaction(() => {
    if (replaceable) {
      db.prepare(`
        UPDATE landos_knowledge_record
        SET status='superseded', effective_to=?, updated_at=? WHERE id=?
      `).run(effectiveFrom, now, replacedId);
    } else if (disputeGroup) {
      db.prepare(`
        UPDATE landos_knowledge_record
        SET status='conflicting', dispute_group=?, updated_at=?
        WHERE domain=? AND scope_kind=? AND scope_key=? AND subject_key=?
          AND status IN ('active','conflicting','unresolved')
      `).run(disputeGroup, now, input.domain, input.scopeKind, scopeKey, subjectKey);
    }

    db.prepare(`
      INSERT INTO landos_knowledge_record (
        id, domain, knowledge_type, scope_kind, scope_key, subject_key, statement,
        value_json, source_authority, confidence, status, sensitivity,
        effective_from, effective_to, retrieved_at, last_verified_at,
        freshness_policy, fresh_until, supersedes_knowledge_id, dispute_group,
        content_hash, compiler_version, created_by, acceptance_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.domain, input.knowledgeType, input.scopeKind, scopeKey, subjectKey,
      statement, valueJson, input.sourceAuthority, input.confidence, status,
      input.sensitivity, effectiveFrom, input.effectiveTo ?? null, retrievedAt,
      lastVerifiedAt, input.freshnessPolicy, freshUntil, replacedId, disputeGroup,
      contentHash, input.compilerVersion, input.createdBy, input.acceptanceReason,
      now, now,
    );
    const insertSupport = db.prepare(`
      INSERT INTO landos_knowledge_support (
        knowledge_id, evidence_namespace, evidence_ref, role, evidence_fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const support of supports) insertSupport.run(
      id,
      support.input.evidenceNamespace,
      support.input.evidenceRef,
      support.input.role ?? 'supports',
      support.resolved.fingerprint,
      now,
    );
  })();

  const outcome = replacedId ? 'superseded' : disputeGroup ? 'conflicting' : 'accepted';
  audit(
    replacedId ? 'knowledge_superseded' : disputeGroup ? 'knowledge_conflict_opened' : 'knowledge_accepted',
    input,
    id,
    replacedId ? `supersedes=${replacedId}` : disputeGroup ? `dispute=${disputeGroup}` : 'deterministic acceptance policy passed',
  );
  return {
    outcome,
    knowledgeId: id,
    replacedKnowledgeId: replacedId,
    reason: replacedId ? 'newer effective version superseded prior knowledge' : disputeGroup ? 'different verified claims retained as conflicting' : 'deterministic acceptance policy passed',
  };
}

/** Exact structured retrieval. No model, provider, network, FTS or vector call. */
export function readKnowledge(input: {
  scopeKind: LandosKnowledgeRecord['scopeKind'];
  scopeKey: string;
  subjectPrefix?: string | null;
  includeHistorical?: boolean;
  now?: string;
}): KnowledgeReadBundle {
  const started = performance.now();
  const scopeKey = input.scopeKey.trim();
  const subjectPrefix = input.subjectPrefix?.trim() || null;
  const statuses = input.includeHistorical
    ? "('active','conflicting','unresolved','superseded')"
    : "('active','conflicting','unresolved')";
  const params: unknown[] = [input.scopeKind, scopeKey];
  let subjectSql = '';
  if (subjectPrefix) {
    subjectSql = ' AND subject_key LIKE ?';
    params.push(`${subjectPrefix}%`);
  }
  const rows = getLandosDb().prepare(`
    SELECT * FROM landos_knowledge_record
    WHERE scope_kind=? AND scope_key=? AND status IN ${statuses}${subjectSql}
    ORDER BY subject_key, created_at, id
  `).all(...params) as KnowledgeRow[];
  const now = Date.parse(input.now ?? new Date().toISOString());
  const items: KnowledgeReadItem[] = rows.map((row) => {
    const record = recordOf(row);
    return { record, state: stateOf(record, now), sources: sourceActions(record.id) };
  });
  const counts = { current: 0, stale: 0, conflicting: 0, unresolved: 0, superseded: 0 };
  for (const item of items) {
    if (item.state === 'CURRENT') counts.current += 1;
    else if (item.state === 'STALE') counts.stale += 1;
    else if (item.state === 'CONFLICTING') counts.conflicting += 1;
    else if (item.state === 'UNRESOLVED') counts.unresolved += 1;
    else counts.superseded += 1;
  }
  return {
    scopeKind: input.scopeKind,
    scopeKey,
    subjectPrefix,
    items,
    counts,
    retrievedInMs: Math.max(0, performance.now() - started),
    modelCalls: 0,
    researchRuns: 0,
  };
}
