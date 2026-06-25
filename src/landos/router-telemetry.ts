// LandOS router telemetry — the capture seam for an eventual learning router.
//
// Design-only for now (no learning loop): we define the record and a pluggable
// sink so every routing decision + outcome CAN be captured cheaply. Later, a
// learner can read these to improve routing from real performance. Recording is
// best-effort and must never affect a routing decision.

import type { RouteDecision } from './capability-router.js';

export interface RouterTelemetryRecord {
  ts: number;
  /** Execution environment + provider the model ran in (provenance of the run). */
  executionEnvironment?: string;
  provider?: string;
  runtime?: 'local' | 'cloud';
  modelUsed: string | null;
  taskType?: string;
  requiredCapabilities: string[];
  stakes?: 'low' | 'medium' | 'high';
  source: RouteDecision['source'];
  escalated: boolean;
  escalationReason?: string;
  openSourcePreferred: boolean;
  fallback: boolean;
  operatorOverride: boolean;
  overrideReason?: string;
  /** Filled post-run when known. */
  latencyMs?: number;
  costUsd?: number;
  confidence?: number;
  /** Operator feedback loop (feeds the separate operator-satisfaction track). */
  outputAccepted?: boolean | null;
  operatorFeedback?: string;
  corrections?: number;
  regenerationRequired?: boolean;
}

export interface TelemetrySink {
  record(r: RouterTelemetryRecord): void | Promise<void>;
}

/** Default sink: keeps recent records in memory (cap bounded). Swappable for a
 *  durable sink (SQLite / KnowledgeStore) when the learner is built. */
export class InMemoryTelemetrySink implements TelemetrySink {
  readonly records: RouterTelemetryRecord[] = [];
  constructor(private cap = 500) {}
  record(r: RouterTelemetryRecord): void {
    this.records.push(r);
    if (this.records.length > this.cap) this.records.shift();
  }
}

/** Build a telemetry record from a routing decision + optional outcome fields. */
export function telemetryFromDecision(
  decision: RouteDecision,
  extra: {
    taskType?: string; stakes?: RouterTelemetryRecord['stakes']; overrideReason?: string;
    executionEnvironment?: string; provider?: string; runtime?: 'local' | 'cloud';
    latencyMs?: number; costUsd?: number; confidence?: number;
    outputAccepted?: boolean | null; operatorFeedback?: string; corrections?: number; regenerationRequired?: boolean;
  } = {},
): RouterTelemetryRecord {
  return {
    ts: Date.now(),
    executionEnvironment: extra.executionEnvironment,
    provider: extra.provider,
    runtime: extra.runtime,
    modelUsed: decision.chosenModelId,
    taskType: extra.taskType,
    requiredCapabilities: decision.requiredDimensions,
    stakes: extra.stakes,
    source: decision.source,
    escalated: decision.escalated,
    escalationReason: decision.escalationReason,
    openSourcePreferred: decision.openSourcePreferred,
    fallback: decision.source === 'fallback',
    operatorOverride: decision.source === 'override',
    overrideReason: extra.overrideReason,
    latencyMs: extra.latencyMs,
    costUsd: extra.costUsd,
    confidence: extra.confidence,
    outputAccepted: extra.outputAccepted ?? null,
    operatorFeedback: extra.operatorFeedback,
    corrections: extra.corrections,
    regenerationRequired: extra.regenerationRequired,
  };
}

/** Best-effort record; never throws into the caller's routing path. */
export async function recordRouterDecision(sink: TelemetrySink, record: RouterTelemetryRecord): Promise<void> {
  try { await sink.record(record); } catch { /* telemetry is non-critical */ }
}
