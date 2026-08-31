// LandOS — targeted research backfill.
//
// The manifest decides WHAT needs attention. The existing registered
// capabilities decide HOW the data is obtained. This module is only the bounded
// bridge between them, and it is deliberately small:
//
//   1. reconcile the manifest from retained state
//   2. select ONLY red machine-resolvable items (plus blue when asked)
//   3. invoke each owning capability exactly once
//   4. reconcile again
//   5. stop
//
// It never chooses a browser, a URL, a provider or a tool; it never reruns a
// green item; it never loops on a yellow unresolved result; it never starts
// research for a gray human item. No language model picks anything here.

import { invokeRuntimeCapability, type RuntimeCapabilityRuntime } from './capability-registry.js';
import type { CapabilityEntity, CapabilityInvocationMode, JsonObject } from './capability-contract.js';
import { runPublicRecordsRecovery } from './public-records-recovery-specialist.js';
import {
  isReconcileError,
  reconcileResearchReadiness,
  type ResearchReadinessReconcileError,
} from './research-readiness-reconcile.js';
import {
  selectResearchBackfill,
  type BackfillSelectionRequest,
  type BackfillSkip,
  type ResearchReadinessManifest,
} from './research-readiness.js';

/**
 * The parameters each capability wants when a backfill drives it.
 *
 * These are the SAME parameters the Deal Card's own per-capability controls
 * already send — the backfill adds no second research path, it just calls the
 * one that exists.
 */
const BACKFILL_PARAMETERS: Record<string, JsonObject | undefined> = {
  'landportal-research': { lane: 'parcel_facts' },
  'comps-valuation': { lane: 'retained_valuation' },
  'zoning-subdivision': { lane: 'research' },
  'property-development-history': { lane: 'research' },
};

export interface BackfillRunItem {
  capabilityId: string;
  /** The manifest items this invocation was run for. */
  itemIds: string[];
  labels: string[];
  status: 'succeeded' | 'needs_input' | 'failed';
  invocationId: string | null;
  summary: string;
}

export interface ResearchBackfillReport {
  dealCardId: number;
  /** The manifest as it stood BEFORE anything ran. */
  before: ResearchReadinessManifest;
  /** The manifest reconciled AFTER the selected capabilities finished. */
  after: ResearchReadinessManifest;
  ran: BackfillRunItem[];
  skipped: BackfillSkip[];
  /** True when the selection was empty — nothing needed machine attention. */
  nothingToDo: boolean;
}

export interface ResearchBackfillDeps {
  /** Injected for tests; production uses the registered capability runtime. */
  invoke?: typeof invokeRuntimeCapability;
  runtime?: RuntimeCapabilityRuntime;
  now?: () => string;
  /** Durable authority owned by the parent intelligence/coverage run. */
  runId?: string;
  signal?: AbortSignal;
  isRunAuthoritative?: (runId: string) => boolean;
}

/**
 * Run a bounded targeted backfill for one Deal Card.
 *
 * Bounded in the literal sense: the number of capability invocations can never
 * exceed the number of DISTINCT capabilities that own a selected red item —
 * at most five, and normally one or two.
 */
export async function runResearchReadinessBackfill(
  dealCardId: number,
  entity: CapabilityEntity,
  request: BackfillSelectionRequest = {},
  deps: ResearchBackfillDeps = {},
): Promise<ResearchBackfillReport | ResearchReadinessReconcileError> {
  const now = deps.now ?? (() => new Date().toISOString());
  const invoke = deps.invoke ?? invokeRuntimeCapability;
  const runtime: RuntimeCapabilityRuntime = {
    ...(deps.runtime ?? {}),
    ...(deps.runId ? {
      recoverPublicRecords: async (input) => {
        if (deps.signal?.aborted || (deps.isRunAuthoritative && !deps.isRunAuthoritative(input.runId))) {
          return {
            status: 'FAILED' as const, handback: null,
            outputFile: '', evidence: [], admission: null,
            error: 'The parent run is no longer authoritative; public-record recovery was not started.',
          };
        }
        return runPublicRecordsRecovery({ ...input, signal: deps.signal });
      },
    } : {}),
  };

  const before = reconcileResearchReadiness(dealCardId, now());
  if (isReconcileError(before)) return before;

  const selection = selectResearchBackfill(before, request);
  const ran: BackfillRunItem[] = [];

  for (const target of selection.targets) {
    // A blue item is a refresh; a red item may still legitimately reuse a
    // result the store already holds under the same key. Asking for `refresh`
    // in both cases is the honest reading of "this item has no usable answer".
    const mode: CapabilityInvocationMode = 'refresh';
    if (deps.signal?.aborted || (deps.runId && deps.isRunAuthoritative && !deps.isRunAuthoritative(deps.runId))) {
      ran.push({
        capabilityId: target.capabilityId, itemIds: target.itemIds, labels: target.labels,
        status: 'failed', invocationId: null,
        summary: 'The parent run was cancelled or superseded before this capability started.',
      });
      continue;
    }
    try {
      const result = await invoke({
        capabilityId: target.capabilityId,
        caller: { type: 'deal_card', ref: `deal:${dealCardId}:research-backfill` },
        subject: {
          kind: 'canonical_property',
          entity,
          propertyCardId: before.propertyCardId as number,
          dealCardId,
        },
        mode,
        parameters: BACKFILL_PARAMETERS[target.capabilityId],
        context: {
          surface: 'research_readiness_backfill', dealCardId, items: target.itemIds,
          ...(deps.runId ? { runId: deps.runId } : {}),
        },
      }, runtime);
      ran.push({
        capabilityId: target.capabilityId,
        itemIds: target.itemIds,
        labels: target.labels,
        status: result.status === 'SUCCEEDED' ? 'succeeded' : result.status === 'NEEDS_INPUT' ? 'needs_input' : 'failed',
        invocationId: result.invocationId,
        summary: result.warnings[0] ?? `${target.labels.join(' and ')} ran through ${target.capabilityId}.`,
      });
    } catch (error) {
      // A capability that refuses to run is a recorded failure, not a reason to
      // abandon the remaining targets.
      ran.push({
        capabilityId: target.capabilityId,
        itemIds: target.itemIds,
        labels: target.labels,
        status: 'failed',
        invocationId: null,
        summary: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const after = reconcileResearchReadiness(dealCardId, now());
  return {
    dealCardId,
    before,
    after: isReconcileError(after) ? before : after,
    ran,
    skipped: selection.skipped,
    nothingToDo: selection.targets.length === 0,
  };
}
