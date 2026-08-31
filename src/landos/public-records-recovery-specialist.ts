// Bounded deterministic-miss -> governed public-record recovery -> guarded
// evidence admission. This is the single execution seam for the specialist;
// the Hermes profile never writes canonical LandOS state directly.

import fs from 'node:fs';
import path from 'node:path';

import { invokeHermesCli } from './acquisition-analyst.js';
import type { CapabilityEvidenceReference } from './capability-contract.js';
import { writeEvidence, type DerivedEvidenceResult } from './derived-intelligence-store.js';
import { landosArtifactPath } from './storage-profile.js';

export const PUBLIC_RECORDS_RECOVERY_PROFILE = 'landos-public-records';
export const PUBLIC_RECORDS_RECOVERY_SKILL = 'landos-public-records-recovery';
export const PUBLIC_RECORDS_RECOVERY_TIMEOUT_MS = 3 * 60_000;

export type PublicRecordsRecoveryStatus =
  | 'RETURNED' | 'PARTIAL' | 'BLOCKED' | 'NEEDS_OPERATOR_ACTION' | 'FAILED';

export interface PublicRecordsRecoverySource {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  retrievedAt: string;
  official: boolean;
}

export interface PublicRecordsRecoveryFact {
  key: string;
  label: string;
  value: string | number | boolean;
  sourceId: string;
  confidence: 'confirmed' | 'well_supported' | 'likely';
}

export interface PublicRecordsRecoveryArtifact {
  kind: string;
  label: string;
  path: string | null;
  url: string | null;
  sourceId: string;
}

export interface PublicRecordsRecoveryHandback {
  schemaVersion: '1.0';
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  status: PublicRecordsRecoveryStatus;
  deterministicFailureReason: string;
  recoveryReason: string;
  subjectMatch: 'exact' | 'mismatch' | 'unresolved';
  facts: PublicRecordsRecoveryFact[];
  sources: PublicRecordsRecoverySource[];
  artifacts: PublicRecordsRecoveryArtifact[];
  unresolvedRequirements: string[];
  exactFailureReason: string | null;
  attempts: Array<Record<string, unknown>>;
}

export interface PublicRecordsRecoveryInput {
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  subject: {
    address: string | null;
    county: string | null;
    state: string | null;
    apn: string | null;
    owner: string | null;
  };
  deterministicFailureReason: string;
  attempts: Array<{ source: string; status: string; note: string }>;
  unresolvedRequirements: string[];
  signal?: AbortSignal;
}

export interface PublicRecordsRecoveryOutcome {
  status: PublicRecordsRecoveryStatus;
  handback: PublicRecordsRecoveryHandback | null;
  outputFile: string;
  evidence: CapabilityEvidenceReference[];
  admission: DerivedEvidenceResult | null;
  error: string | null;
}

export interface PublicRecordsRecoveryDeps {
  invoke?: (args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<string>;
  readFile?: (file: string) => string;
  outputFile?: string;
  admit?: typeof writeEvidence;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function parseHandback(raw: string, input: PublicRecordsRecoveryInput): PublicRecordsRecoveryHandback {
  const parsed = object(JSON.parse(raw));
  if (!parsed) throw new Error('public-record recovery handback must be a JSON object');
  if (parsed.schemaVersion !== '1.0') throw new Error('unsupported public-record recovery schemaVersion');
  if (parsed.runId !== input.runId || parsed.dealCardId !== input.dealCardId || parsed.propertyCardId !== input.propertyCardId) {
    throw new Error('public-record recovery handback does not match the assigned run and subject');
  }
  const statuses = new Set<PublicRecordsRecoveryStatus>(['RETURNED', 'PARTIAL', 'BLOCKED', 'NEEDS_OPERATOR_ACTION', 'FAILED']);
  if (!statuses.has(parsed.status as PublicRecordsRecoveryStatus)) throw new Error('invalid public-record recovery status');
  if (!['exact', 'mismatch', 'unresolved'].includes(String(parsed.subjectMatch))) throw new Error('invalid public-record subjectMatch');
  if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.facts) || !Array.isArray(parsed.artifacts)
      || !Array.isArray(parsed.unresolvedRequirements) || !Array.isArray(parsed.attempts)) {
    throw new Error('public-record recovery arrays are missing');
  }
  const sources = parsed.sources.map((entry, index) => {
    const row = object(entry);
    const id = text(row?.id); const name = text(row?.name); const url = text(row?.url);
    const sourceType = text(row?.sourceType); const retrievedAt = text(row?.retrievedAt);
    if (!id || !name || !url || !/^https?:\/\//i.test(url) || !sourceType || !retrievedAt || Number.isNaN(Date.parse(retrievedAt))) {
      throw new Error(`invalid public-record recovery source at index ${index}`);
    }
    return { id, name, url, sourceType, retrievedAt, official: row?.official === true };
  });
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) throw new Error('public-record recovery source ids must be unique');
  const subjectMatch = parsed.subjectMatch as PublicRecordsRecoveryHandback['subjectMatch'];
  const facts = parsed.facts.map((entry, index) => {
    const row = object(entry);
    const key = text(row?.key); const label = text(row?.label); const sourceId = text(row?.sourceId);
    const confidence = text(row?.confidence) as PublicRecordsRecoveryFact['confidence'];
    if (!key || !label || !sourceIds.has(sourceId) || !['confirmed', 'well_supported', 'likely'].includes(confidence)
        || !['string', 'number', 'boolean'].includes(typeof row?.value)) {
      throw new Error(`invalid public-record recovery fact at index ${index}`);
    }
    return { key, label, value: row!.value as string | number | boolean, sourceId, confidence };
  });
  if (subjectMatch !== 'exact' && facts.length) throw new Error('non-exact public-record handback may not contain facts');
  const artifacts = parsed.artifacts.map((entry, index) => {
    const row = object(entry); const sourceId = text(row?.sourceId);
    const artifactPath = text(row?.path) || null; const url = text(row?.url) || null;
    if (!text(row?.kind) || !text(row?.label) || !sourceIds.has(sourceId) || (!artifactPath && !url)) {
      throw new Error(`invalid public-record recovery artifact at index ${index}`);
    }
    return { kind: text(row?.kind), label: text(row?.label), path: artifactPath, url, sourceId };
  });
  return {
    schemaVersion: '1.0', runId: input.runId, dealCardId: input.dealCardId,
    propertyCardId: input.propertyCardId, status: parsed.status as PublicRecordsRecoveryStatus,
    deterministicFailureReason: text(parsed.deterministicFailureReason), recoveryReason: text(parsed.recoveryReason),
    subjectMatch, facts, sources, artifacts,
    unresolvedRequirements: parsed.unresolvedRequirements.map(text).filter(Boolean),
    exactFailureReason: text(parsed.exactFailureReason) || null,
    attempts: parsed.attempts.map((entry) => object(entry) ?? {}),
  };
}

export function publicRecordsRecoveryPrompt(input: PublicRecordsRecoveryInput, outputFile: string): string {
  return `Complete exactly one bounded LandOS public-records recovery assignment. The deterministic adapters have already run; do not repeat them. Use the preloaded ${PUBLIC_RECORDS_RECOVERY_SKILL} skill and write the required JSON handback to the exact output path.\n\n${JSON.stringify({
    assignment: 'public_records_recovery', outputFile, runId: input.runId,
    dealCardId: input.dealCardId, propertyCardId: input.propertyCardId,
    canonicalSubject: input.subject, deterministicFailureReason: input.deterministicFailureReason,
    exhaustedAttempts: input.attempts, unresolvedRequirements: input.unresolvedRequirements,
  }, null, 2)}`;
}

export async function runPublicRecordsRecovery(
  input: PublicRecordsRecoveryInput,
  deps: PublicRecordsRecoveryDeps = {},
): Promise<PublicRecordsRecoveryOutcome> {
  if (!input.runId.trim()) throw new Error('public-record recovery requires an authoritative runId');
  const outputFile = deps.outputFile ?? landosArtifactPath(
    'public-records-recovery', `deal_${input.dealCardId}`, `${input.runId}.json`,
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  if (input.signal?.aborted) return { status: 'FAILED', handback: null, outputFile, evidence: [], admission: null, error: 'run cancelled before recovery' };
  try {
    const invoke = deps.invoke ?? invokeHermesCli;
    await invoke([
      '--profile', PUBLIC_RECORDS_RECOVERY_PROFILE,
      '--skills', PUBLIC_RECORDS_RECOVERY_SKILL,
      '--oneshot', publicRecordsRecoveryPrompt(input, outputFile),
    ], PUBLIC_RECORDS_RECOVERY_TIMEOUT_MS, input.signal);
    if (input.signal?.aborted) return { status: 'FAILED', handback: null, outputFile, evidence: [], admission: null, error: 'run cancelled during recovery' };
    const raw = (deps.readFile ?? ((file) => fs.readFileSync(file, 'utf8')))(outputFile);
    const handback = parseHandback(raw, input);
    const evidence = handback.sources.map((source): CapabilityEvidenceReference => ({
      id: source.id, source: source.name, sourceUrl: source.url, sourceType: source.sourceType,
      retrievedAt: source.retrievedAt, details: { official: source.official, recovery: true },
    }));
    const artifactsBySource = new Map(handback.artifacts.map((artifact) => [artifact.sourceId, artifact]));
    const sourceById = new Map(handback.sources.map((source) => [source.id, source]));
    const admission = handback.subjectMatch === 'exact' && handback.facts.length
      ? (deps.admit ?? writeEvidence)({
          dealCardId: input.dealCardId,
          capabilityId: PUBLIC_RECORDS_RECOVERY_SKILL,
          collectorKey: PUBLIC_RECORDS_RECOVERY_SKILL,
          runId: input.runId,
          rows: handback.facts.map((fact) => {
            const source = sourceById.get(fact.sourceId)!;
            const artifact = artifactsBySource.get(fact.sourceId);
            return {
              domain: 'public_records',
              evidenceKind: source.official ? 'official_public_record' : 'public_record_recovery',
              factKey: fact.key,
              raw: fact.value, normalized: fact.value, sourceName: source.name, sourceUrl: source.url,
              sourceTier: source.official ? 'official_government_source' : source.sourceType,
              confidence: fact.confidence, retrievedAt: source.retrievedAt,
              artifactRef: artifact?.path ?? artifact?.url ?? outputFile,
              dedupeOn: `${fact.key}:${String(fact.value)}:${source.url}`,
            };
          }),
        })
      : null;
    return { status: handback.status, handback, outputFile, evidence, admission, error: admission?.skippedReason ?? null };
  } catch (error) {
    return { status: 'FAILED', handback: null, outputFile, evidence: [], admission: null, error: error instanceof Error ? error.message : String(error) };
  }
}
