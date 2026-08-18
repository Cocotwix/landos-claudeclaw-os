// Deal Intelligence run lifecycle — Phase 5, Items 18 and 20.
//
// ONE operator action starts ONE parent mission and ends with ONE current
// snapshot. This module is the seam between the two, and nothing else:
//
//   launch  → the parent mission is created on the Phase 4 mission graph
//   run     → the mission graph runner fans out, waits, and joins (Phase 4)
//   assemble→ the Operator builds the input package (deal-intelligence-assembly)
//   analyse → the Analyst evaluates it            (deal-intelligence-analysis)
//   persist → the Operator writes ONE versioned current snapshot
//
// Persistence rules it enforces:
//   • The mission id and the snapshot run id are the SAME id, so an operator
//     looking at either surface can find the other without a lookup table.
//   • The previous snapshot stays the current read until this run produces a
//     new one. A run that fails never demotes a good snapshot.
//   • An OLDER attempt can never override a newer one, even if it finishes last
//     (enforced in PropertyIntelligenceStore.completeRun).
//   • Failed and incomplete attempts stay readable as history. Nothing is
//     overwritten in place.
//   • Browser pages the workflow opened are cleaned up, and the result is
//     recorded on the snapshot rather than assumed.

import { logger } from '../logger.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { classifyExecution } from '../failure-classification.js';
import {
  awaitScopedBrowserWorkDrained,
  closeSurplusSessionPages,
  createBrowserWorkflowScope,
  runInBrowserWorkflowScope,
  type BrowserWorkflowScope,
} from './browser-session.js';
import { analyseDealIntelligence } from './deal-intelligence-analysis.js';
import { resolveCompsValuationLocations } from './comps-valuation.js';
import { assembleDealIntelligencePackage, mapChildStatus } from './deal-intelligence-assembly.js';
import { buildDealOperatorAnalysis, emptyDealOperatorContext } from './deal-operator-analysis.js';
import {
  DEAL_INTELLIGENCE_CHILDREN,
  DEAL_INTELLIGENCE_KIND,
  DEAL_INTELLIGENCE_SCOPE,
  dealIntelligenceMissionDefinition,
  type DealIntelligenceCapabilities,
} from './deal-intelligence-mission.js';
import { assembleProgressiveDealIntelligence, isSettledChildStatus } from './deal-intelligence-progressive.js';
import { MissionGraphStore } from './mission-graph-store.js';
import { launchFanOutMission } from './mission-graph-runner.js';
import {
  gatherMissionChildren,
  joinMissionChildren,
  type MissionChildState,
  type MissionJoin,
} from './mission-graph.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import { reconcilePropertyIntelligenceSnapshot, type PropertyIntelligenceSnapshot, type SnapshotSpecialistRecord } from './property-intelligence-snapshot.js';
import type { SpecialistId } from './property-intelligence-specialists.js';
import type { MissionProviderDeps } from './mission-provider-routing.js';

/**
 * Bound on the post-run comparable-location pass. Long enough for the free
 * geocoders to place a run's comparables, short enough that it can never hold a
 * completed run open; an overrun leaves the pass to finish on its own.
 */
const COMP_LOCATION_RESOLUTION_MS = 30_000;

export interface BrowserCleanupResult {
  before: number;
  after: number;
  closed: number;
  note: string;
}

export interface LaunchDealIntelligenceOptions {
  dealCardId: number;
  trigger?: string;
  capabilities: DealIntelligenceCapabilities;
  missionStore?: MissionGraphStore;
  snapshotStore?: PropertyIntelligenceStore;
  now?: () => string;
  clockMs?: () => number;
  /** Overrides every child timeout. Used by tests. */
  timeoutMsOverride?: number;
  runIdFactory?: () => string;
  joinDeadlineMs?: number;
  joinPollMs?: number;
  providerDeps?: MissionProviderDeps;
  /**
   * Close pages the workflow opened. Runs after the mission settles, whatever
   * the outcome — a failed run leaves tabs behind just as readily as a good one.
   */
  browserCleanup?: () => Promise<BrowserCleanupResult>;
  /** Bound browser cleanup so a detached or unresponsive CDP page cannot leave
   * an otherwise finished Deal Intelligence run permanently in `running`. */
  browserCleanupWaitMs?: number;
  /**
   * Safety bound on waiting for this run's browser work to settle before
   * cleanup. Not a pacing timer: the wait ends the moment the owned-work count
   * reaches zero.
   */
  browserWorkDrainMs?: number;
  /** Bound post-join operator enrichment so it cannot strand a settled mission. */
  operatorWaitMs?: number;
  onProgress?: (child: MissionChildState) => void;
}

export interface DealIntelligenceLaunch {
  runId: string;
  missionId: string;
  dealCardId: number;
  sequence: number;
  childCount: number;
  /** True when an in-flight run already existed and was returned instead. */
  alreadyRunning: boolean;
}

/** The queued specialist roster, seeded from the mission definition. */
export function initialDealIntelligenceSpecialists(): SnapshotSpecialistRecord[] {
  return DEAL_INTELLIGENCE_CHILDREN.map((spec) => ({
    id: spec.key as SpecialistId,
    label: spec.label,
    role: spec.role,
    status: 'queued' as const,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: spec.purpose,
    failureCategory: null,
    failureMessage: null,
    retryable: false,
    evidenceCount: 0,
  }));
}

function defaultRunId(): string {
  return `di_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function classifyFailure(error: unknown): { category: string; message: string } {
  const outcome = classifyExecution({
    timedOut: !!(error as { __timedOut?: boolean } | null)?.__timedOut,
    error,
    stderr: error instanceof Error ? error.message : String(error),
  });
  return { category: outcome.category, message: outcome.message };
}

async function settleWithin<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Launch the Deal Intelligence parent mission for one Deal Card.
 *
 * Resolves as soon as the parent mission and its children exist, so the operator
 * watches real progress. Await `completion` when a caller needs the finished
 * snapshot.
 */
export function launchDealIntelligenceMission(options: LaunchDealIntelligenceOptions): {
  launch: DealIntelligenceLaunch;
  completion: Promise<PropertyIntelligenceSnapshot | null>;
} {
  const missionStore = options.missionStore ?? new MissionGraphStore();
  const snapshotStore = options.snapshotStore ?? new PropertyIntelligenceStore();
  const now = options.now ?? (() => new Date().toISOString());
  const { dealCardId } = options;

  // A run interrupted by a restart is not resumable in place. Close both halves
  // honestly before deciding whether anything is genuinely in flight.
  snapshotStore.reclaimStaleRuns();
  missionStore.reclaimStaleMissions();

  const activeMission = missionStore.activeMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, dealCardId);
  const activeRun = snapshotStore.activeRun(dealCardId);
  if (activeMission || activeRun) {
    const missionId = activeMission?.missionId ?? activeRun!.runId;
    return {
      launch: {
        runId: activeRun?.runId ?? missionId,
        missionId,
        dealCardId,
        sequence: activeMission?.sequence ?? activeRun?.sequence ?? 0,
        childCount: activeMission ? missionStore.listChildren(activeMission.missionId).length : DEAL_INTELLIGENCE_CHILDREN.length,
        alreadyRunning: true,
      },
      completion: Promise.resolve(null),
    };
  }

  // ONE id for the parent mission AND the versioned snapshot run.
  const runId = (options.runIdFactory ?? defaultRunId)();
  const capabilityStore = new CapabilityInvocationStore();
  const lockSubject = `deal:${dealCardId}`;
  const resolutionLock = capabilityStore.acquireExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, lockSubject, runId);
  if (!resolutionLock.acquired) {
    return {
      launch: {
        runId: resolutionLock.ownerId,
        missionId: resolutionLock.ownerId,
        dealCardId,
        sequence: 0,
        childCount: DEAL_INTELLIGENCE_CHILDREN.length,
        alreadyRunning: true,
      },
      completion: Promise.resolve(null),
    };
  }
  const browserScope = createBrowserWorkflowScope(runId);
  const startedAt = now();
  let created: ReturnType<PropertyIntelligenceStore['createRun']> | null = null;
  let launched: ReturnType<typeof launchFanOutMission>;
  try {
    created = snapshotStore.createRun({
      runId,
      dealCardId,
      trigger: options.trigger ?? 'operator',
      startedAt,
      specialists: initialDealIntelligenceSpecialists(),
    });
    const definition = dealIntelligenceMissionDefinition(options.capabilities);
    launched = runInBrowserWorkflowScope(browserScope, () => launchFanOutMission({
        definition,
        scopeId: dealCardId,
        trigger: options.trigger ?? 'operator',
        store: missionStore,
        now,
        clockMs: options.clockMs,
        timeoutMsOverride: options.timeoutMsOverride,
        missionIdFactory: () => runId,
        joinDeadlineMs: options.joinDeadlineMs,
        joinPollMs: options.joinPollMs,
        providerDeps: options.providerDeps,
        onProgress: (child) => {
        // Mirror live child state onto the snapshot run's specialist rows so the
        // existing operator progress panel shows the real mission, not a copy of
        // it that could drift.
        try {
          snapshotStore.updateSpecialist({
            runId,
            specialistId: child.key as SpecialistId,
            status: mapChildStatus(child.status),
            summary: child.status === 'rejected' ? child.acceptance?.reason ?? child.summary : child.summary,
            failureCategory: (child.failureCategory as SnapshotSpecialistRecord['failureCategory']) ?? null,
            failureMessage: child.status === 'rejected' ? child.acceptance?.reason ?? child.failureMessage : child.failureMessage,
            retryable: child.retryable,
            startedAt: child.startedAt,
            completedAt: child.completedAt,
            durationMs: child.durationMs,
          });
        } catch (err) {
          logger.warn({ err, dealCardId, runId, child: child.key }, 'deal_intelligence_progress_mirror_failed');
        }
        // Progressive content, assembled at WRITE time on each child SETTLE —
        // never on a poll GET. The partial is stored on the run row, clearly
        // preliminary, and can never touch the promoted snapshot: promotion
        // stays a completeRun decision made only at join. Synchronous on
        // purpose: the last child's partial is written before the join path
        // clears progressive content, so there is no post-completion write.
        if (isSettledChildStatus(child.status)) {
          try {
            const progress = assembleProgressiveDealIntelligence({
              dealCardId,
              runId,
              sequence: created!.sequence,
              startedAt,
              children: missionStore.listChildren(runId),
              now,
            });
            snapshotStore.updateProgress({ runId, dealCardId, progress });
          } catch (err) {
            logger.warn({ err, dealCardId, runId, child: child.key }, 'deal_intelligence_progressive_assembly_failed');
          }
        }
          options.onProgress?.(child);
        },
      }));
  } catch (error) {
    // The definition could not even be laid out. The run is closed as failed so
    // the operator never sees a run stuck at "running" with no mission behind it.
    const failure = classifyFailure(error);
    if (created) {
      snapshotStore.completeRun({
        runId,
        dealCardId,
        status: 'failed',
        completedAt: now(),
        snapshot: null,
        error: failure.message,
        failureCategory: failure.category as never,
      });
    }
    if (!resolutionLock.reentrant) capabilityStore.releaseExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, lockSubject, runId);
    return {
      launch: { runId, missionId: runId, dealCardId, sequence: created?.sequence ?? 0, childCount: DEAL_INTELLIGENCE_CHILDREN.length, alreadyRunning: false },
      completion: Promise.resolve(null),
    };
  }

  if (!created) throw new Error('Deal Intelligence run setup completed without a run record.');

  const completion = finishDealIntelligenceRun({
    options,
    missionStore,
    snapshotStore,
    now,
    runId,
    sequence: created.sequence,
    startedAt,
    browserScope,
    missionCompletion: launched.completion,
  }).finally(() => {
    if (!resolutionLock.reentrant) capabilityStore.releaseExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, lockSubject, runId);
  });

  return {
    launch: {
      runId,
      missionId: launched.launch.missionId,
      dealCardId,
      sequence: created.sequence,
      childCount: launched.launch.childCount,
      alreadyRunning: launched.launch.alreadyRunning,
    },
    completion,
  };
}

/**
 * Assemble → analyse → persist, once the parent mission settles.
 *
 * Runs even when the mission failed: a failed run must still be recorded, still
 * clean up its browser pages, and still leave the previous snapshot as the
 * current read rather than blanking the Deal Card.
 */
async function finishDealIntelligenceRun(input: {
  options: LaunchDealIntelligenceOptions;
  missionStore: MissionGraphStore;
  snapshotStore: PropertyIntelligenceStore;
  now: () => string;
  runId: string;
  sequence: number;
  startedAt: string;
  browserScope: BrowserWorkflowScope;
  missionCompletion: Promise<MissionJoin | null>;
}): Promise<PropertyIntelligenceSnapshot | null> {
  const { options, missionStore, snapshotStore, now, runId, sequence, startedAt } = input;
  const dealCardId = options.dealCardId;
  const cleanupWaitMs = Math.max(1, options.browserCleanupWaitMs ?? 10_000);
  const boundedCleanup = async (
    work: () => Promise<BrowserCleanupResult>,
    label: string,
  ): Promise<BrowserCleanupResult> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const completed = work().then(
      (result) => ({ result, error: null as unknown, timedOut: false as const }),
      (error: unknown) => ({ result: null, error, timedOut: false as const }),
    );
    const outcome = await Promise.race([
      completed,
      new Promise<{ result: null; error: null; timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ result: null, error: null, timedOut: true }), cleanupWaitMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (outcome.timedOut) {
      return {
        before: 0,
        after: 0,
        closed: 0,
        note: `${label} exceeded its ${Math.round(cleanupWaitMs / 1000)}-second safety window. The run was finalized, but pages it opened may still be open.`,
      };
    }
    if (outcome.error) throw outcome.error;
    return outcome.result!;
  };

  let join: MissionJoin | null = null;
  let missionError: string | null = null;
  try {
    join = await input.missionCompletion;
  } catch (error) {
    missionError = classifyFailure(error).message;
  }

  // ── THE BROWSER CLEANUP BOUNDARY ──────────────────────────────────────────
  // The mission joins when its CHILDREN reach terminal states, but a child can
  // settle while browser work it started is still running. Cleaning up on the
  // join therefore looked at the browser too early: the trailing operation then
  // opened its page against a scope that had already been released, so no
  // scoped cleanup could ever match it and the tab survived until a manual
  // reap. Measured on a 9490 rerun as a lane tab created at `activeScopes=0`.
  //
  // So the boundary is the WORK, not the child rows: every driver call is
  // counted against its owning scope and released in a `finally`, and cleanup
  // waits for that count to reach zero. Lanes stay fully concurrent — this
  // waits for the set to drain, it does not serialize anything — and the
  // deadline below is a safety bound for a driver that never returns, not a
  // pacing timer.
  let drain: Awaited<ReturnType<typeof awaitScopedBrowserWorkDrained>> | null = null;
  const boundary: { cleanup: BrowserCleanupResult | null } = { cleanup: null };

  /**
   * Close the run's browser boundary. Deliberately NOT called here.
   *
   * The operator-context capability runs later in this same function and is
   * itself browser-producing: it drives the Brockovich/Data Center map through
   * a live driver. Closing the boundary at the mission join therefore released
   * the scope before that legitimate trailing work had even started, so its
   * driver was constructed unowned. The boundary is now taken after every
   * browser-producing step of this run has been given its chance to run, and it
   * is idempotent so the failure paths can call it without double-cleaning.
   */
  const closeBrowserBoundary = async (): Promise<void> => {
    if (boundary.cleanup) return;
    try {
      drain = await awaitScopedBrowserWorkDrained(input.browserScope, {
        timeoutMs: Math.max(1, options.browserWorkDrainMs ?? 120_000),
      });
      if (!drain.drained) {
        logger.warn({
          runId,
          outstanding: drain.outstanding,
          waitedMs: drain.waitedMs,
        }, 'deal_intelligence_browser_work_drain_timeout');
      }
    } catch (error) {
      logger.warn({ err: error, runId }, 'deal_intelligence_browser_work_drain_failed');
    }

    // Browser cleanup runs whatever happened. A failed mission leaves tabs
    // behind just as readily as a good one, and the operator's Chrome is theirs.
    try {
      boundary.cleanup = await boundedCleanup(
        () => closeSurplusSessionPages(input.browserScope),
        'Owned browser-page cleanup',
      );
    } catch (error) {
      boundary.cleanup = {
        before: 0,
        after: 0,
        closed: 0,
        note: `Browser page cleanup could not run (${(error as Error)?.message ?? String(error)}). Pages this run opened may still be open.`,
      };
    }
    // Backward-compatible injected cleanup remains useful for tests and non-live
    // callers. It is invoked only when no connected browser existed for the
    // canonical scoped cleanup; production callbacks without a scope can never
    // perform a global page reap.
    if (options.browserCleanup && boundary.cleanup.before === 0) {
      try {
        boundary.cleanup = await boundedCleanup(options.browserCleanup, 'Fallback browser-page cleanup');
      } catch (error) {
        boundary.cleanup = {
          before: 0,
          after: 0,
          closed: 0,
          note: `Browser page cleanup could not run (${(error as Error)?.message ?? String(error)}). Pages this run opened may still be open.`,
        };
      }
    }
  };

  const children = missionStore.listChildren(runId);
  // The join returned by the runner is authoritative when it exists. When the
  // orchestration itself threw there is none, so one is computed from whatever
  // the children actually recorded — never assumed.
  const effectiveJoin: MissionJoin =
    join ?? joinMissionChildren({
      specs: DEAL_INTELLIGENCE_CHILDREN,
      children: [...gatherMissionChildren(DEAL_INTELLIGENCE_CHILDREN, children).values()],
    });

  const completedAt = now();

  // A deadline-expired join is not a completion. Never clear progressive data
  // or promote a snapshot over children that are still running. Close both
  // durable halves honestly so a new operator run is not blocked forever by a
  // parent no process is waiting to finalize.
  if (!effectiveJoin.allTerminal) {
    const message = effectiveJoin.outcome || 'The parent deadline elapsed before every provider lane reached a terminal state.';
    missionStore.abandonMission({
      missionId: runId,
      error: message,
      failureCategory: 'timeout',
      completedAt,
      join: effectiveJoin,
      outcome: message,
    });
    snapshotStore.completeRun({
      runId,
      dealCardId,
      status: 'failed',
      completedAt,
      snapshot: null,
      error: message,
      failureCategory: 'timeout',
    });
    return null;
  }

  //
  // Snapshot assembly never changes the capability root's subject. Late
  // evidence waits for a later Property Resolution invocation.
  try {
    // ── Operator: assemble the exact input package ────────────────────────
    const pkg = assembleDealIntelligencePackage({
      dealCardId,
      missionId: runId,
      join: effectiveJoin,
      children,
    });
    if (missionError) {
      pkg.packageBlockers.push(`The parent mission did not complete cleanly: ${missionError}`);
    }

    // ── Analyst: evaluate the property ────────────────────────────────────
    const previousSnapshot = snapshotStore.primaryRun(dealCardId)?.snapshot ?? null;
    let operatorContext = emptyDealOperatorContext();
    if (options.capabilities.operatorContext) {
      try {
        // BROWSER-PRODUCING TRAILING WORK, RUN INSIDE THE MISSION'S SCOPE.
        // This capability drives the Brockovich/Data Center map through a live
        // driver. Started outside the scope it built an unowned driver, so its
        // page could never be matched by scoped cleanup. Entering the scope
        // here makes the driver capture this run as its owner, and the boundary
        // below is only taken once this has settled.
        operatorContext = await settleWithin(
          runInBrowserWorkflowScope(
            input.browserScope,
            () => options.capabilities.operatorContext!(dealCardId),
          ),
          Math.max(1, options.operatorWaitMs ?? 90_000),
          'Deal operator context',
        );
      } catch (error) {
        logger.warn({ err: error, dealCardId, runId }, 'deal_operator_context_failed');
      }
    }
    let operatorAnalysis = buildDealOperatorAnalysis({
      pkg,
      context: operatorContext,
      previousSnapshot,
      generatedAt: completedAt,
    });
    if (options.capabilities.operatorAnalyst) {
      try {
        operatorAnalysis = await settleWithin(
          runInBrowserWorkflowScope(input.browserScope, () => options.capabilities.operatorAnalyst!({
            pkg,
            context: operatorContext,
            previousSnapshot,
            generatedAt: completedAt,
          })),
          Math.max(1, options.operatorWaitMs ?? 90_000),
          'Deal operator analyst',
        );
      } catch (error) {
        logger.warn({ err: error, dealCardId, runId }, 'deal_operator_analyst_failed');
      }
    }

    // EVERY browser-producing step of this run has now had its chance. Drain the
    // work it owns, then close the pages it opened.
    await closeBrowserBoundary();

    const analysed = analyseDealIntelligence({
      package: pkg,
      runId,
      sequence,
      startedAt,
      completedAt,
    });
    analysed.operatorAnalysis = operatorAnalysis;

    const assembledSnapshot: PropertyIntelligenceSnapshot = {
      ...analysed,
      missionId: runId,
      browserCleanup: boundary.cleanup,
      missingInformation: boundary.cleanup
        ? [...analysed.missingInformation, `Browser cleanup: ${boundary.cleanup.note}`]
        : analysed.missingInformation,
    };
    const reconciliation = reconcilePropertyIntelligenceSnapshot(previousSnapshot, assembledSnapshot);
    const snapshot = reconciliation.snapshot;

    // ── Operator: persist ONE versioned current snapshot ──────────────────
    //
    // What makes a run UNUSABLE — and therefore unable to replace the current
    // snapshot — is deliberately narrow:
    //
    //   • the orchestration itself broke, so there is no trustworthy join; or
    //   • the SUBJECT was never established, so the run has no parcel to be
    //     about. Replacing an identified parcel's snapshot with one that
    //     identifies nothing would lose the operator real information
    //     (invariant 7).
    //
    // A downstream lane that failed, was blocked or was rejected does NOT make
    // the run unusable. Its gap is named in the snapshot's blockers and in the
    // mission outcome, and the rest of the picture — which is the newest honest
    // read of this parcel — becomes the current one. Discarding it would be the
    // "one incomplete record puts the whole deal on hold" behaviour Phase 5
    // explicitly forbids.
    const identityContributed = (effectiveJoin.contributed ?? []).includes('parcel_identity');
    const unusable = !!missionError || !identityContributed || !reconciliation.promotable;
    const missionFailed = effectiveJoin.status === 'failed';
    snapshotStore.completeRun({
      runId,
      dealCardId,
      status: unusable ? 'failed' : snapshot.status,
      completedAt,
      // Stored either way: a run the operator cannot use as the current read is
      // still readable as history, showing exactly what the attempt produced.
      snapshot,
      // The mission's own failure is recorded even on a run that IS promoted, so
      // "a required lane did not deliver" is never hidden behind a usable snapshot.
      error: reconciliation.reason ?? missionError ?? (missionFailed ? effectiveJoin.outcome : null),
      failureCategory: unusable ? (missionError ? 'crash' : 'invalid_output') : null,
    });
    // ── Place the comparables the run just collected ─────────────────────────
    //
    // Resolving comparable locations was an operator-triggered endpoint and
    // nothing else called it, so a research run finished with its comparables
    // collected but unplaceable: no distance, no radius band, nothing on the
    // map. That is not a missing lane the operator can act on — it reads as a
    // run that found nothing. It is bounded, fill-only, uses free verified
    // geocoders, and never blocks or fails the run.
    if (!unusable) {
      try {
        await Promise.race([
          resolveCompsValuationLocations(dealCardId),
          new Promise((settle) => { setTimeout(settle, COMP_LOCATION_RESOLUTION_MS); }),
        ]);
      } catch (error) {
        logger.warn({ err: error, dealCardId, runId }, 'comp_location_resolution_failed');
      }
    }
    return snapshot;
  } catch (error) {
    const failure = classifyFailure(error);
    logger.warn({ err: error, dealCardId, runId }, 'deal_intelligence_assembly_failed');
    snapshotStore.completeRun({
      runId,
      dealCardId,
      status: 'failed',
      completedAt,
      snapshot: null,
      error: `The mission joined, but the snapshot could not be assembled: ${failure.message}`,
      failureCategory: failure.category as never,
    });
    return null;
  } finally {
    // A run that threw during assembly opened pages just as readily as one that
    // succeeded, and its scope must never stay registered. `closeBrowserBoundary`
    // is idempotent, so the success path's call is not repeated here.
    await closeBrowserBoundary();
  }
}

/** Convenience for callers that want the finished snapshot (tests, CLI). */
export async function runDealIntelligenceMission(
  options: LaunchDealIntelligenceOptions,
): Promise<PropertyIntelligenceSnapshot | null> {
  const { completion } = launchDealIntelligenceMission(options);
  return completion;
}
