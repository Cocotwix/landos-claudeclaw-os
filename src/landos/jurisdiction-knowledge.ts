// Jurisdiction Knowledge V1: deterministic compilation and exact retrieval.
//
// This compiler reads retained evidence and current accepted land-use records.
// It performs no research and makes no model call. Current parcel zoning and
// property subdivision conclusions are deliberately excluded.

import { createHash } from 'node:crypto';

import { getLandosDb } from './db.js';
import type { AuthorityAssignment, ControllingLandUseAuthority, LandUseAuthorityLevel } from './controlling-land-use-authority.js';
import {
  readAuthorityEvidence,
  readControllingAuthority,
  readSubdivisionRegulations,
  readSubdivisionRuleEvidence,
} from './land-use-intelligence-store.js';
import { jurisdictionKey } from './official-site-store.js';
import type { RegulationJurisdiction } from './regulation-document-store.js';
import type { SubdivisionRule } from './subdivision-regulations.js';
import type { KnowledgeReadBundle, KnowledgeWriteOutcome } from './knowledge-contract.js';
import { acceptKnowledgeCandidate, readKnowledge } from './compiled-knowledge-store.js';

export const JURISDICTION_KNOWLEDGE_COMPILER_VERSION = 'jurisdiction-v1.0.0';

export interface JurisdictionKnowledgeCompileResult {
  dealCardId: number;
  scopeKey: string | null;
  attempted: number;
  accepted: number;
  reverified: number;
  conflicting: number;
  superseded: number;
  rejected: number;
  compileTimeMs: number;
  modelCalls: 0;
  researchRuns: 0;
  skippedReason: string | null;
}

export interface JurisdictionKnowledgeRule {
  key: string;
  label: string;
  value: string;
  section: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  authorityName: string | null;
  confidence: string;
}

type EvidenceRow = ReturnType<typeof readSubdivisionRuleEvidence>[number];

function clean(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unitBucket(level: LandUseAuthorityLevel): string {
  return level === 'county' ? 'county' : level === 'state' ? 'state' : 'local';
}

export function jurisdictionKnowledgeScopeKey(jurisdiction: RegulationJurisdiction): string | null {
  const state = clean(jurisdiction.state).toUpperCase();
  const key = jurisdictionKey(jurisdiction.authorityName);
  if (!state || !key) return null;
  return `${state}:${jurisdiction.level}:${key}`;
}

export function jurisdictionKnowledgeJurisdiction(
  authority: ControllingLandUseAuthority | null,
): RegulationJurisdiction | null {
  const assignment = authority?.subdivisionAuthority;
  const state = clean(authority?.state);
  if (!assignment?.name || !state) return null;
  if (assignment.determination === 'unresolved' || assignment.determination === 'ambiguous') return null;
  return { authorityName: assignment.name, level: assignment.level, state };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function outcomeCounts(outcomes: KnowledgeWriteOutcome[]): Omit<JurisdictionKnowledgeCompileResult, 'dealCardId' | 'scopeKey' | 'compileTimeMs' | 'modelCalls' | 'researchRuns' | 'skippedReason'> {
  return {
    attempted: outcomes.length,
    accepted: outcomes.filter((outcome) => outcome === 'accepted').length,
    reverified: outcomes.filter((outcome) => outcome === 'reverified').length,
    conflicting: outcomes.filter((outcome) => outcome === 'conflicting').length,
    superseded: outcomes.filter((outcome) => outcome === 'superseded').length,
    rejected: outcomes.filter((outcome) => outcome === 'rejected').length,
  };
}

function compileAuthority(
  role: 'zoning' | 'subdivision',
  assignment: AuthorityAssignment,
  scopeKey: string,
  evidence: ReturnType<typeof readAuthorityEvidence>,
  actor: string,
): KnowledgeWriteOutcome | null {
  if (!assignment.name || !['confirmed', 'well_supported'].includes(assignment.determination)) return null;
  const confidence = assignment.determination === 'confirmed' ? 'confirmed' : 'well_supported';
  const factKey = `${role}_authority`;
  const supports = evidence.filter((row) => {
    const normalized = record(row.normalized);
    return row.factKey === factKey
      && clean(String(normalized.name ?? '')) === clean(assignment.name)
      && String(normalized.level ?? '') === assignment.level
      && row.sourceTier === 'official_government_source';
  });
  const result = acceptKnowledgeCandidate({
    domain: 'jurisdiction',
    knowledgeType: 'factual',
    scopeKind: 'jurisdiction',
    scopeKey,
    subjectKey: `authority.${role}`,
    statement: `${role === 'zoning' ? 'Zoning' : 'Subdivision'} authority: ${assignment.name}.`,
    value: { name: assignment.name, level: assignment.level },
    sourceAuthority: 'official_government_source',
    confidence,
    sensitivity: 'public',
    retrievedAt: supports.at(-1)?.retrievedAt ?? new Date().toISOString(),
    lastVerifiedAt: supports.at(-1)?.retrievedAt ?? new Date().toISOString(),
    freshnessPolicy: 'jurisdiction_procedure',
    supports: supports.map((row) => ({ evidenceNamespace: 'property_evidence', evidenceRef: String(row.evidenceId) })),
    compilerVersion: JURISDICTION_KNOWLEDGE_COMPILER_VERSION,
    createdBy: actor,
    acceptanceReason: `Current retained ${role}-authority determination matched verified official evidence exactly.`,
  });
  return result.outcome;
}

function evidenceForRule(rule: SubdivisionRule, evidence: EvidenceRow[]): EvidenceRow[] {
  return evidence.filter((row) => {
    const normalized = record(row.normalized);
    return row.factKey === rule.key
      && String(normalized.value ?? '') === rule.value
      && clean(row.sourceUrl) === clean(rule.sourceUrl)
      && row.sourceTier === 'official_government_source';
  });
}

function compileRule(
  rule: SubdivisionRule,
  scopeKey: string,
  evidence: EvidenceRow[],
  actor: string,
): KnowledgeWriteOutcome {
  const supports = evidenceForRule(rule, evidence);
  const result = acceptKnowledgeCandidate({
    domain: 'jurisdiction',
    knowledgeType: 'factual',
    scopeKind: 'jurisdiction',
    scopeKey,
    subjectKey: `subdivision.${rule.key}`,
    statement: `${rule.label}: ${rule.value}`,
    value: {
      key: rule.key,
      label: rule.label,
      value: rule.value,
      section: rule.section,
      authorityName: rule.authorityName,
    },
    sourceAuthority: 'official_government_source',
    confidence: rule.confidence,
    sensitivity: 'public',
    effectiveFrom: rule.effectiveOrAsOf,
    retrievedAt: supports.at(-1)?.retrievedAt ?? rule.effectiveOrAsOf ?? new Date().toISOString(),
    lastVerifiedAt: supports.at(-1)?.retrievedAt ?? new Date().toISOString(),
    freshnessPolicy: 'jurisdiction_procedure',
    supports: supports.map((row) => ({ evidenceNamespace: 'property_evidence', evidenceRef: String(row.evidenceId) })),
    compilerVersion: JURISDICTION_KNOWLEDGE_COMPILER_VERSION,
    createdBy: actor,
    acceptanceReason: 'Current retained subdivision rule matched verified official evidence by subject, structured value and source URL.',
  });
  return result.outcome;
}

function compileSourceDocuments(
  jurisdiction: RegulationJurisdiction,
  scopeKey: string,
  actor: string,
): KnowledgeWriteOutcome[] {
  const key = jurisdictionKey(jurisdiction.authorityName);
  const rows = getLandosDb().prepare(`
    SELECT id, url, label, adopted_or_as_of, last_verified_at
    FROM landos_regulation_document
    WHERE state=? AND jurisdiction_key=? AND unit_type=?
      AND doc_kind='subdivision_regulations' AND draft_or_proposed=0
    ORDER BY url, id
  `).all(clean(jurisdiction.state).toUpperCase(), key, unitBucket(jurisdiction.level)) as Array<{
    id: number; url: string; label: string; adopted_or_as_of: string | null; last_verified_at: number;
  }>;
  return rows.map((row) => acceptKnowledgeCandidate({
    domain: 'jurisdiction',
    knowledgeType: 'procedural',
    scopeKind: 'jurisdiction',
    scopeKey,
    subjectKey: `source.subdivision_regulations.${createHash('sha256').update(row.url).digest('hex').slice(0, 16)}`,
    statement: `${row.label || 'Subdivision regulations'} is a retained official subdivision-regulation source for ${jurisdiction.authorityName}.`,
    value: { url: row.url, label: row.label, adoptedOrAsOf: row.adopted_or_as_of },
    sourceAuthority: 'official_government_source',
    confidence: 'confirmed',
    sensitivity: 'public',
    effectiveFrom: row.adopted_or_as_of,
    retrievedAt: new Date(row.last_verified_at * 1_000).toISOString(),
    lastVerifiedAt: new Date(row.last_verified_at * 1_000).toISOString(),
    freshnessPolicy: 'source_locator',
    supports: [{ evidenceNamespace: 'regulation_document', evidenceRef: String(row.id) }],
    compilerVersion: JURISDICTION_KNOWLEDGE_COMPILER_VERSION,
    createdBy: actor,
    acceptanceReason: 'The retained regulation-document store identifies this adopted official source for the exact jurisdiction.',
  }).outcome);
}

/** Compile the current retained authority/rules for one deal; never researches. */
export function compileJurisdictionKnowledgeFromDeal(
  dealCardId: number,
  actor = 'jurisdiction-knowledge-compiler',
): JurisdictionKnowledgeCompileResult {
  const started = performance.now();
  const authority = readControllingAuthority(dealCardId);
  const jurisdiction = jurisdictionKnowledgeJurisdiction(authority);
  const scopeKey = jurisdiction ? jurisdictionKnowledgeScopeKey(jurisdiction) : null;
  if (!authority || !jurisdiction || !scopeKey) {
    return {
      dealCardId, scopeKey: null, attempted: 0, accepted: 0, reverified: 0,
      conflicting: 0, superseded: 0, rejected: 0,
      compileTimeMs: Math.max(0, performance.now() - started),
      modelCalls: 0, researchRuns: 0,
      skippedReason: 'No confirmed controlling subdivision jurisdiction is retained for this deal.',
    };
  }

  const outcomes: KnowledgeWriteOutcome[] = [];
  const authorityEvidence = readAuthorityEvidence(dealCardId);
  const zoningAuthority = compileAuthority('zoning', authority.zoningAuthority, scopeKey, authorityEvidence, actor);
  const subdivisionAuthority = compileAuthority('subdivision', authority.subdivisionAuthority, scopeKey, authorityEvidence, actor);
  if (zoningAuthority) outcomes.push(zoningAuthority);
  if (subdivisionAuthority) outcomes.push(subdivisionAuthority);

  const regulations = readSubdivisionRegulations(dealCardId);
  const ruleEvidence = readSubdivisionRuleEvidence(dealCardId);
  for (const rule of regulations?.rules ?? []) {
    const sourceDocument = regulations?.documents.find((document) => document.url === rule.sourceUrl);
    // A draft/proposed instrument is evidence of a proposal, never accepted
    // current law. A rule also needs the current retained record to identify
    // the document it came from before it can cross the deal boundary.
    if (!sourceDocument || sourceDocument.draftOrProposed) continue;
    outcomes.push(compileRule(rule, scopeKey, ruleEvidence, actor));
  }
  outcomes.push(...compileSourceDocuments(jurisdiction, scopeKey, actor));

  return {
    dealCardId,
    scopeKey,
    ...outcomeCounts(outcomes),
    compileTimeMs: Math.max(0, performance.now() - started),
    modelCalls: 0,
    researchRuns: 0,
    skippedReason: null,
  };
}

/** Exact current/historical bundle for one resolved controlling jurisdiction. */
export function readJurisdictionKnowledge(
  jurisdiction: RegulationJurisdiction,
  options: { subjectPrefix?: string | null; includeHistorical?: boolean; now?: string } = {},
): KnowledgeReadBundle {
  const scopeKey = jurisdictionKnowledgeScopeKey(jurisdiction);
  if (!scopeKey) {
    return {
      scopeKind: 'jurisdiction', scopeKey: '', subjectPrefix: options.subjectPrefix ?? null,
      items: [], counts: { current: 0, stale: 0, conflicting: 0, unresolved: 0, superseded: 0 },
      retrievedInMs: 0, modelCalls: 0, researchRuns: 0,
    };
  }
  return readKnowledge({
    scopeKind: 'jurisdiction',
    scopeKey,
    subjectPrefix: options.subjectPrefix,
    includeHistorical: options.includeHistorical,
    now: options.now,
  });
}

/** Project only CURRENT jurisdiction rules onto the existing capability shape. */
export function currentJurisdictionRuleFacts(bundle: KnowledgeReadBundle): JurisdictionKnowledgeRule[] {
  return bundle.items
    .filter((item) => item.state === 'CURRENT' && item.record.subjectKey.startsWith('subdivision.'))
    .map((item) => {
      const value = record(item.record.value);
      const source = item.sources.find((row) => row.url) ?? item.sources[0] ?? null;
      return {
        key: String(value.key ?? item.record.subjectKey.slice('subdivision.'.length)),
        label: String(value.label ?? item.record.statement.split(':')[0] ?? item.record.subjectKey),
        value: String(value.value ?? ''),
        section: value.section == null ? null : String(value.section),
        sourceLabel: source?.label ?? null,
        sourceUrl: source?.url ?? null,
        authorityName: value.authorityName == null ? null : String(value.authorityName),
        confidence: item.record.confidence,
      };
    })
    .filter((rule) => rule.value.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}
