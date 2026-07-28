// Execution truth for Deal Intelligence specialist projections.
//
// A persisted public-intelligence task is not automatically an executed
// screen. Identity-gated and unconnected tasks are valuable source-limit
// disclosures, but they have zero collector attempts and must never inflate a
// specialist's "screened" count.

import {
  PUBLIC_INTELLIGENCE_TASK_LABELS,
  type PublicEvidence,
  type PublicIntelligenceRun,
  type PublicIntelligenceTaskKind,
  type PublicIntelligenceTaskRecord,
} from './public-property-intelligence.js';
import type { SnapshotEvidenceItem, SnapshotFact } from './property-intelligence-snapshot.js';

export const GOVERNMENT_RECORD_TASKS = ['county_records'] as const;
export const ZONING_TASKS = ['zoning_landuse'] as const;
export const ENVIRONMENTAL_TASKS = ['wetlands', 'fema_flood', 'soils_septic', 'slope_topography'] as const;
export const ACCESS_UTILITY_TASKS = ['road_frontage', 'utilities'] as const;
export const VISUAL_EVIDENCE_TASKS = [
  'imagery',
  'county_records',
  'zoning_landuse',
  'wetlands',
  'fema_flood',
  'soils_septic',
  'slope_topography',
  'road_frontage',
  'utilities',
] as const;

export interface PublicTaskExecution {
  task: PublicIntelligenceTaskKind;
  label: string;
  status: PublicIntelligenceTaskRecord['status'] | 'not_scheduled';
  attempted: boolean;
  attemptCount: number;
  retrieved: boolean;
  evidenceCount: number;
  sourceIds: string[];
  limitation: string | null;
  record: PublicIntelligenceTaskRecord | null;
}

export interface PublicLaneExecution {
  scheduledCount: number;
  attemptedCount: number;
  retrievedCount: number;
  evidenceCount: number;
  tasks: PublicTaskExecution[];
  limitations: string[];
  summary: string;
}

const unique = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];

function providerAttempts(record: PublicIntelligenceTaskRecord): number {
  const explicit = Number(record.attempts ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.max(0, ...(record.providerOutcomes ?? []).map((outcome) => Number(outcome.attemptCount) || 0));
}

function limitationFor(
  run: PublicIntelligenceRun | null | undefined,
  record: PublicIntelligenceTaskRecord | null,
): string {
  if (!run) return 'No public-intelligence run is persisted for this subject.';
  if (!record) return 'This source task was not scheduled in the persisted run.';
  const providerNotes = (record.providerOutcomes ?? [])
    .filter((outcome) => outcome.status !== 'not_applicable')
    .map((outcome) => outcome.note);
  const details = unique([
    record.failureReason,
    ...providerNotes,
    record.operatorMessage,
    record.finding?.limitation,
  ]);
  if (details.length) return details.join(' ');
  if (record.status === 'skipped_identity_gate') return run.gate.explanation;
  return `${record.label} returned ${record.status.replace(/_/g, ' ')} with no retrievable finding.`;
}

export function publicTaskExecution(
  run: PublicIntelligenceRun | null | undefined,
  task: PublicIntelligenceTaskKind,
): PublicTaskExecution {
  const record = run?.tasks.find((candidate) => candidate.task === task) ?? null;
  const attemptCount = record ? providerAttempts(record) : 0;
  // `unavailable` with no adapter is a verified coverage limitation, not an
  // execution. Blocked/failed/timed-out tasks do count because a real collector
  // ran and returned that scoped source outcome.
  const attempted = !!record
    && attemptCount > 0
    && record.status !== 'skipped_identity_gate'
    && record.status !== 'unavailable';
  const retrieved = !!record?.finding || (record?.evidence.length ?? 0) > 0;
  const sourceIds = unique((record?.providerOutcomes ?? [])
    .filter((outcome) => outcome.status !== 'not_applicable')
    .map((outcome) => outcome.providerId));

  return {
    task,
    label: record?.label ?? PUBLIC_INTELLIGENCE_TASK_LABELS[task],
    status: record?.status ?? 'not_scheduled',
    attempted,
    attemptCount: attempted ? attemptCount : 0,
    retrieved,
    evidenceCount: record?.evidence.length ?? 0,
    sourceIds,
    limitation: !retrieved || record?.status !== 'succeeded'
      ? limitationFor(run, record)
      : record.finding?.limitation ?? null,
    record,
  };
}

export function publicLaneExecution(
  run: PublicIntelligenceRun | null | undefined,
  tasks: readonly PublicIntelligenceTaskKind[],
): PublicLaneExecution {
  const projected = tasks.map((task) => publicTaskExecution(run, task));
  const attemptedCount = projected.filter((task) => task.attempted).length;
  const retrievedCount = projected.filter((task) => task.retrieved).length;
  const evidenceCount = projected.reduce((total, task) => total + task.evidenceCount, 0);
  const limitations = unique(projected.map((task) =>
    task.limitation ? `${task.label}: ${task.limitation}` : null));
  const summary = attemptedCount === 0
    ? `No source collector ran for this lane.${limitations.length ? ` ${limitations.join(' ')}` : ''}`
    : `${attemptedCount} of ${tasks.length} source collector(s) ran; ${retrievedCount} returned a finding or retained evidence.${limitations.length ? ` Limitations: ${limitations.join(' ')}` : ''}`;
  return {
    scheduledCount: tasks.length,
    attemptedCount,
    retrievedCount,
    evidenceCount,
    tasks: projected,
    limitations,
    summary,
  };
}

function evidenceSource(evidence: PublicEvidence): string {
  return evidence.sourceName || evidence.sourceTier.replace(/_/g, ' ');
}

export function snapshotEvidenceFromPublicTasks(
  run: PublicIntelligenceRun | null | undefined,
  tasks: readonly PublicIntelligenceTaskKind[],
): SnapshotEvidenceItem[] {
  const allowed = new Set<PublicIntelligenceTaskKind>(tasks);
  return (run?.tasks ?? []).flatMap((task) => {
    if (!allowed.has(task.task)) return [];
    return task.evidence.map((evidence): SnapshotEvidenceItem => ({
      id: `public-${task.task}-${evidence.evidenceId}`,
      kind: 'source_link',
      label: evidenceSource(evidence),
      sourceType: evidence.sourceTier,
      sourceUrl: evidence.sourceUrl ?? null,
      viewUrl: null,
      retrievedAt: evidence.retrievedAt,
      confidence: evidence.confidence === 'none' ? 'low' : evidence.confidence,
      supports: task.task,
      sha256: null,
      bytes: null,
    }));
  });
}

export function countyRecordFactsFromPublicRun(
  run: PublicIntelligenceRun | null | undefined,
): SnapshotFact[] {
  const task = run?.tasks.find((candidate) => candidate.task === 'county_records');
  const finding = task?.finding;
  if (!task || finding?.kind !== 'county_records') return [];
  const evidenceById = new Map(task.evidence.map((item) => [item.evidenceId, item]));
  return finding.facts.map((fact, index): SnapshotFact => {
    const evidence = evidenceById.get(fact.sourceEvidenceId);
    return {
      key: `county_record_${index}_${fact.field.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label: fact.field,
      value: String(fact.value),
      grade: fact.classification === 'recorded_instrument' ? 'confirmed_fact' : 'likely_indication',
      source: evidence ? evidenceSource(evidence) : finding.jurisdiction,
      sourceUrl: evidence?.sourceUrl ?? null,
      retrievedAt: evidence?.retrievedAt ?? task.completedAt,
      note: finding.limitation || null,
    };
  });
}
