// Generic compiled-knowledge read accessor.
//
// The Knowledge Compiler owns acceptance; this module owns the one shared,
// deterministic, SELECT-only read path every department reuses. It performs no
// model call, no research call, no compile and no write. It fails closed: a
// record that is not usable as settled reusable knowledge is never returned as
// a current fact, and rejected/candidate records are never visible at all.

import { readKnowledge } from './compiled-knowledge-store.js';
import type {
  KnowledgeConfidence,
  KnowledgeDomain,
  KnowledgeReadCounts,
  KnowledgeReadState,
  KnowledgeScopeKind,
  KnowledgeType,
  LandosKnowledgeRecord,
} from './knowledge-contract.js';

/** One compiled proposition projected for a downstream department. */
export interface CompiledKnowledgeFact {
  knowledgeId: string;
  domain: KnowledgeDomain;
  knowledgeType: KnowledgeType;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectKey: string;
  statement: string;
  value: unknown;
  /** Derived read state from the store. Only CURRENT is settled reusable knowledge. */
  state: KnowledgeReadState;
  confidence: KnowledgeConfidence;
  sourceAuthority: string;
  lastVerifiedAt: string;
  freshUntil: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  supersedesKnowledgeId: string | null;
  /** Set when competing verified claims were retained instead of resolved. */
  disputeGroup: string | null;
  compilerVersion: string;
  sources: Array<{
    label: string;
    url: string | null;
    retrievedAt: string | null;
    evidenceNamespace: string;
    evidenceRef: string;
    supportStillAccepted: boolean;
    fingerprintDrifted: boolean;
  }>;
}

export interface CompiledKnowledgeReadResult {
  domain: KnowledgeDomain | null;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectPrefix: string | null;
  subjectKeys: string[] | null;
  /** Every readable projected record, including non-current states. */
  items: CompiledKnowledgeFact[];
  /** Settled reusable knowledge only. */
  current: CompiledKnowledgeFact[];
  /** Verified but past its freshness policy: refresh candidates, never current. */
  stale: CompiledKnowledgeFact[];
  /** Retained competing or unresolved claims: never settled truth. */
  notSettled: CompiledKnowledgeFact[];
  counts: KnowledgeReadCounts;
  retrievedInMs: number;
  modelCalls: 0;
  researchRuns: 0;
  knowledgeWrites: 0;
}

function emptyResult(input: {
  domain: KnowledgeDomain | null;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectPrefix: string | null;
  subjectKeys: string[] | null;
}): CompiledKnowledgeReadResult {
  return {
    ...input,
    items: [],
    current: [],
    stale: [],
    notSettled: [],
    counts: { current: 0, stale: 0, conflicting: 0, unresolved: 0, superseded: 0 },
    retrievedInMs: 0,
    modelCalls: 0,
    researchRuns: 0,
    knowledgeWrites: 0,
  };
}

function factOf(item: { record: LandosKnowledgeRecord; state: KnowledgeReadState; sources: Array<{
  evidenceNamespace: string; evidenceRef: string; label: string; url: string | null;
  retrievedAt: string | null; supportStillAccepted: boolean; fingerprintDrifted: boolean;
}> }): CompiledKnowledgeFact {
  const { record } = item;
  return {
    knowledgeId: record.id,
    domain: record.domain,
    knowledgeType: record.knowledgeType,
    scopeKind: record.scopeKind,
    scopeKey: record.scopeKey,
    subjectKey: record.subjectKey,
    statement: record.statement,
    value: record.value,
    state: item.state,
    confidence: record.confidence,
    sourceAuthority: record.sourceAuthority,
    lastVerifiedAt: record.lastVerifiedAt,
    freshUntil: record.freshUntil,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    supersedesKnowledgeId: record.supersedesKnowledgeId,
    disputeGroup: record.disputeGroup,
    compilerVersion: record.compilerVersion,
    sources: item.sources.map((source) => ({
      label: source.label,
      url: source.url,
      retrievedAt: source.retrievedAt,
      evidenceNamespace: source.evidenceNamespace,
      evidenceRef: source.evidenceRef,
      supportStillAccepted: source.supportStillAccepted,
      fingerprintDrifted: source.fingerprintDrifted,
    })),
  };
}

/**
 * The shared cross-department compiled-knowledge read.
 *
 * Deterministic SELECT only. `current` is the ONLY collection a consumer may
 * treat as settled reusable knowledge; STALE, CONFLICTING, UNRESOLVED and
 * SUPERSEDED are returned separately so a consumer can say what it does not
 * yet know without ever presenting it as truth.
 */
export function readCompiledKnowledge(input: {
  domain?: KnowledgeDomain | null;
  scopeKind: KnowledgeScopeKind;
  scopeKey: string;
  subjectPrefix?: string | null;
  subjectKeys?: string[] | null;
  /** Include SUPERSEDED history. Superseded records are never `current`. */
  includeHistorical?: boolean;
  now?: string;
}): CompiledKnowledgeReadResult {
  const domain = input.domain ?? null;
  const scopeKey = (input.scopeKey ?? '').trim();
  const subjectPrefix = input.subjectPrefix?.trim() || null;
  const subjectKeys = input.subjectKeys?.map((key) => key.trim()).filter(Boolean) ?? null;
  const shape = { domain, scopeKind: input.scopeKind, scopeKey, subjectPrefix, subjectKeys };
  // Fail closed: an unresolved scope reads nothing rather than reading globally.
  if (!scopeKey) return emptyResult(shape);

  const bundle = readKnowledge({
    scopeKind: input.scopeKind,
    scopeKey,
    subjectPrefix,
    includeHistorical: input.includeHistorical,
    now: input.now,
  });

  const wanted = subjectKeys && subjectKeys.length ? new Set(subjectKeys) : null;
  const items = bundle.items
    .filter((item) => (domain ? item.record.domain === domain : true))
    .filter((item) => (wanted ? wanted.has(item.record.subjectKey) : true))
    .map(factOf);

  const counts: KnowledgeReadCounts = { current: 0, stale: 0, conflicting: 0, unresolved: 0, superseded: 0 };
  for (const item of items) {
    if (item.state === 'CURRENT') counts.current += 1;
    else if (item.state === 'STALE') counts.stale += 1;
    else if (item.state === 'CONFLICTING') counts.conflicting += 1;
    else if (item.state === 'UNRESOLVED') counts.unresolved += 1;
    else counts.superseded += 1;
  }

  return {
    ...shape,
    items,
    current: items.filter((item) => item.state === 'CURRENT'),
    stale: items.filter((item) => item.state === 'STALE'),
    notSettled: items.filter((item) => item.state === 'CONFLICTING' || item.state === 'UNRESOLVED'),
    counts,
    retrievedInMs: bundle.retrievedInMs,
    modelCalls: 0,
    researchRuns: 0,
    knowledgeWrites: 0,
  };
}
