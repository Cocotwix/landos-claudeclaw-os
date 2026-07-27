// The native fan-out runner: parent mission → child missions → join.
//
// One operator action starts ONE parent mission. The parent creates every child
// mission row up front, dispatches each one as soon as its own dependencies
// have settled, and joins their structured handbacks once every child is terminal.
//
// Guarantees this runner enforces:
//   • A second launch while a mission is in flight returns the SAME mission.
//     The operator can never accidentally start two on one scope row.
//   • Every child settles. A throw, a timeout, an unmet dependency and a
//     provider refusal each produce a DIFFERENT terminal state with a stated
//     reason — none of them leave a child stranded, and none read as success.
//   • A child waits for exactly what it consumes — never for an unrelated lane
//     that happens to sit in the same dependency layer.
//   • The parent does not complete until every child is terminal. If a child is
//     still outstanding when dispatch returns (because another worker claimed
//     it), the parent waits, and on deadline it reports the outstanding child
//     explicitly instead of joining over it.
//   • The join is the ONLY thing that may declare the mission finished.
//
// Executors are injected, so the orchestration is testable without a browser,
// a provider or a network call.

import { classifyExecution } from '../failure-classification.js';
import { MissionGraphStore } from './mission-graph-store.js';
import {
  dependencyBlock,
  gatherMissionChildren,
  initialMissionChildren,
  isTerminalMissionChildStatus,
  joinMissionChildren,
  missionChildPredecessors,
  missionChildStatusForAcceptance,
  normalizeStoredMissionJoin,
  overlayDeclaredIdentity,
  planMissionWaves,
  upstreamContributions,
  type MissionChildSpec,
  type MissionChildState,
  type MissionJoin,
} from './mission-graph.js';
import { evaluateMissionAcceptance, type MissionAcceptanceVerdict } from './mission-acceptance.js';
import {
  resolveMissionProviderAssignment,
  type MissionProviderAssignment,
  type MissionProviderDeps,
} from './mission-provider-routing.js';

export interface MissionChildContext {
  missionId: string;
  scope: string;
  scopeId: number;
  /** Structured handbacks from the children this one depends on. */
  upstream: Record<string, unknown>;
  /** The provider this lane was assigned. `deterministic` means none is engaged. */
  provider: MissionProviderAssignment;
}

export interface MissionChildOutcome {
  /** `blocked` is for a real external gap; it is never a substitute for a throw. */
  status: 'completed' | 'partial' | 'blocked';
  summary: string;
  /** The structured handback the parent joins. */
  result?: unknown;
}

export type MissionChildExecutor = (ctx: MissionChildContext) => Promise<MissionChildOutcome>;

export interface FanOutMissionDefinition {
  /** Stable mission kind, e.g. `property_intelligence_fanout`. */
  kind: string;
  label: string;
  /** Scope namespace, e.g. `deal_card`. */
  scope: string;
  children: MissionChildSpec[];
  executors: Record<string, MissionChildExecutor>;
}

export interface LaunchFanOutOptions {
  definition: FanOutMissionDefinition;
  scopeId: number;
  trigger?: string;
  store?: MissionGraphStore;
  now?: () => string;
  clockMs?: () => number;
  /** Overrides every child timeout. Used by tests. */
  timeoutMsOverride?: number;
  missionIdFactory?: () => string;
  /** Called after every child state change so a caller can push progress. */
  onProgress?: (child: MissionChildState) => void;
  /** How long the parent waits for a child another worker claimed. */
  joinDeadlineMs?: number;
  joinPollMs?: number;
  /** Provider registry / live-routing injection for model-routed children. */
  providerDeps?: MissionProviderDeps;
}

export interface FanOutLaunch {
  missionId: string;
  kind: string;
  scope: string;
  scopeId: number;
  sequence: number;
  childCount: number;
  /** True when an in-flight mission already existed and was returned instead. */
  alreadyRunning: boolean;
}

const DEFAULT_JOIN_DEADLINE_MS = 120_000;
const DEFAULT_JOIN_POLL_MS = 250;

function defaultMissionId(kind: string): string {
  return `${kind.slice(0, 12)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function timeoutAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      const error = new Error(`Child mission exceeded its ${Math.round(ms / 1000)}s time budget.`);
      (error as Error & { __timedOut?: boolean }).__timedOut = true;
      reject(error);
    }, ms);
  });
  return { promise, cancel: () => clearTimeout(handle!) };
}

function classifyFailure(error: unknown): { category: string; message: string; retryable: boolean } {
  const timedOut = !!(error as { __timedOut?: boolean } | null)?.__timedOut;
  const outcome = classifyExecution({
    timedOut,
    error,
    stderr: error instanceof Error ? error.message : String(error),
  });
  return { category: outcome.category, message: outcome.message, retryable: outcome.retryable };
}

/**
 * Launch a parent fan-out mission. Resolves as soon as the parent and its
 * children exist; the children continue in the background so the operator can
 * watch progress. Await `completion` when a caller needs the joined result.
 */
export function launchFanOutMission(options: LaunchFanOutOptions): {
  launch: FanOutLaunch;
  completion: Promise<MissionJoin | null>;
} {
  const store = options.store ?? new MissionGraphStore();
  const now = options.now ?? (() => new Date().toISOString());
  const { definition, scopeId } = options;

  // Validate the graph BEFORE anything is written. A mission that cannot be
  // laid out must never launch and then strand children in `queued`.
  const waves = planMissionWaves(definition.children);

  store.reclaimStaleMissions();
  const active = store.activeMission(definition.kind, definition.scope, scopeId);
  if (active) {
    return {
      launch: {
        missionId: active.missionId,
        kind: definition.kind,
        scope: definition.scope,
        scopeId,
        sequence: active.sequence,
        childCount: store.listChildren(active.missionId).length,
        alreadyRunning: true,
      },
      completion: Promise.resolve(null),
    };
  }

  const missionId = (options.missionIdFactory ?? (() => defaultMissionId(definition.kind)))();
  const startedAt = now();
  const created = store.createMission({
    missionId,
    kind: definition.kind,
    scope: definition.scope,
    scopeId,
    trigger: options.trigger ?? 'operator',
    startedAt,
    children: definition.children,
  });

  const completion = executeFanOut({ ...options, store, now }, missionId, waves).catch((error) => {
    const failure = classifyFailure(error);
    store.abandonMission({
      missionId,
      error: failure.message,
      failureCategory: failure.category,
      completedAt: now(),
      join: null,
      outcome: `The parent mission failed before it could join any child result: ${failure.message}`,
    });
    return null;
  });

  return {
    launch: {
      missionId,
      kind: definition.kind,
      scope: definition.scope,
      scopeId,
      sequence: created.sequence,
      childCount: definition.children.length,
      alreadyRunning: false,
    },
    completion,
  };
}

async function executeFanOut(
  options: LaunchFanOutOptions & { store: MissionGraphStore; now: () => string },
  missionId: string,
  /** Validated layout. Dispatch schedules per child; this proves the graph is legal. */
  waves: string[][],
): Promise<MissionJoin> {
  const { store, now, definition } = options;
  const clockMs = options.clockMs ?? (() => Date.now());
  const specByKey = new Map(definition.children.map((spec) => [spec.key, spec]));

  // Local mirror of child state, seeded from the definition and kept in step
  // with the store so wave dispatch can read upstream handbacks without a
  // re-query per child.
  const local = new Map<string, MissionChildState>(
    initialMissionChildren(definition.children, missionId).map((child) => [child.key, child]),
  );

  const settle = (
    key: string,
    status: MissionChildState['status'],
    summary: string,
    extras: Partial<MissionChildState> = {},
  ): void => {
    const completedAt = now();
    const next: MissionChildState = {
      ...local.get(key)!,
      ...extras,
      status,
      summary,
      completedAt,
    };
    local.set(key, next);
    store.settleChild({
      missionId,
      childKey: key,
      status,
      summary,
      result: next.result,
      acceptance: next.acceptance,
      provider: next.provider,
      failureCategory: next.failureCategory,
      failureMessage: next.failureMessage,
      retryable: next.retryable,
      completedAt,
      durationMs: next.durationMs,
    });
    options.onProgress?.(next);
  };

  const acceptanceContext = (spec: MissionChildSpec) => ({
    scope: definition.scope,
    scopeId: options.scopeId,
    childKey: spec.key,
    childLabel: spec.label,
  });

  const runChild = async (key: string): Promise<void> => {
    const spec = specByKey.get(key)!;
    const startMs = clockMs();

    // Resolve the provider assignment FIRST, so every child carries a visible
    // assignment even when it is later skipped or has no executor. A
    // deterministic lane resolves to "no provider, no spend" and touches nothing.
    let provider: MissionProviderAssignment | null = null;
    try {
      provider = await resolveMissionProviderAssignment(spec.provider, options.providerDeps);
    } catch (error) {
      // Provider resolution must never take a lane down: record the gap and let
      // the lane run (a deterministic lane does not need a provider at all).
      const message = error instanceof Error ? error.message : String(error);
      provider = {
        mode: spec.provider?.mode ?? 'deterministic',
        providerId: null,
        providerLabel: null,
        modelId: null,
        environmentId: null,
        source: 'unavailable',
        available: false,
        liveRouting: false,
        reason: `The provider assignment for this lane could not be resolved (${message}), so no provider is claimed for it.`,
      };
    }
    local.set(key, { ...local.get(key)!, provider });

    // An unmet dependency SKIPS the child. It never ran, so calling it a
    // failure would misreport where the mission actually broke.
    const blocked = dependencyBlock(spec, local);
    if (blocked) {
      settle(key, 'skipped', blocked, {
        durationMs: 0,
        // Nothing was delivered, so there is nothing to evaluate. Saying so is
        // not the same as saying the result was acceptable.
        acceptance: { state: 'not_evaluated', reason: blocked, checks: [] },
      });
      return;
    }

    const executor = definition.executors[key];
    if (!executor) {
      const message = `No executor is registered for child mission "${key}".`;
      settle(key, 'failed', message, {
        failureCategory: 'configuration',
        failureMessage: message,
        durationMs: 0,
        acceptance: { state: 'failed', reason: message, checks: [] },
      });
      return;
    }

    // Independent claim. If another worker already took this child, leave it
    // alone — the join below waits for whatever that worker records.
    const startedAt = now();
    if (!store.claimChild(missionId, key, startedAt, provider)) {
      return;
    }
    const claimed: MissionChildState = {
      ...local.get(key)!,
      status: 'running',
      startedAt,
      attempt: local.get(key)!.attempt + 1,
    };
    local.set(key, claimed);
    options.onProgress?.(claimed);

    const budget = options.timeoutMsOverride ?? spec.timeoutMs;
    const timer = timeoutAfter(budget);
    try {
      const outcome = await Promise.race([
        executor({
          missionId,
          scope: definition.scope,
          scopeId: options.scopeId,
          upstream: upstreamContributions(spec, local),
          provider,
        }),
        timer.promise,
      ]);

      // ── ACCEPTANCE ────────────────────────────────────────────────────────
      // The executor reports what it believes happened; the acceptance contract
      // decides what the mission records. A lane that returned without throwing
      // but handed back nothing usable is REJECTED here, not joined.
      const verdict = evaluateMissionAcceptance(
        spec.acceptance,
        { kind: 'returned', reported: outcome.status, summary: outcome.summary, result: outcome.result ?? null },
        acceptanceContext(spec),
      );
      const status = missionChildStatusForAcceptance(verdict.state, outcome.status);

      settle(key, status, verdict.state === 'rejected' ? verdict.reason : outcome.summary, {
        // The handback is retained on a rejection for diagnosis. It is never
        // joined: a rejected child does not contribute.
        result: outcome.result ?? null,
        acceptance: verdict,
        durationMs: clockMs() - startMs,
        failureCategory: verdict.state === 'rejected' ? 'unacceptable_result' : null,
        failureMessage: verdict.state === 'rejected' ? verdict.reason : null,
        retryable: false,
      });
    } catch (error) {
      const failure = classifyFailure(error);
      const verdict: MissionAcceptanceVerdict = evaluateMissionAcceptance(
        spec.acceptance,
        { kind: 'threw', summary: failure.message },
        acceptanceContext(spec),
      );
      settle(key, 'failed', failure.message, {
        result: null,
        acceptance: verdict,
        durationMs: clockMs() - startMs,
        failureCategory: failure.category,
        failureMessage: failure.message,
        retryable: failure.retryable,
      });
    } finally {
      timer.cancel();
    }
  };

  // ── Fan-out: each child starts as soon as ITS OWN predecessors are terminal ──
  //
  // Not a wave barrier. Waves are still computed up front to VALIDATE the graph
  // (unknown dependency, cycle, duplicate slot), but dispatching strictly
  // wave-by-wave would make every child wait for the slowest unrelated child in
  // the wave above it. Observed live: one slow supporting refresh lane held back
  // valuation and strategy, which depend on nothing it produces.
  //
  // Scheduling on each child's own predecessors gives the same ordering
  // guarantee the contract states — a child never runs before what it consumes
  // has settled — without coupling lanes that have no relationship.
  void waves;
  const scheduled = new Map<string, Promise<void>>();
  const runWhenReady = (key: string): Promise<void> => {
    const existing = scheduled.get(key);
    if (existing) return existing;
    const spec = specByKey.get(key)!;
    // Safe from infinite recursion: planMissionWaves already refused a cycle
    // before anything was written.
    const promise = (async () => {
      await Promise.all(missionChildPredecessors(spec).map((dep) => runWhenReady(dep)));
      await runChild(key);
    })();
    scheduled.set(key, promise);
    return promise;
  };
  await Promise.all(definition.children.map((spec) => runWhenReady(spec.key)));

  // ── Gather: read every child back from the store, not from local memory ────
  // A child another worker claimed is only visible in the store, and the store
  // is what survives a restart.
  const children = await awaitChildren(store, missionId, options, clockMs);
  const gathered = gatherMissionChildren(definition.children, children);
  const join = joinMissionChildren({ specs: definition.children, children: [...gathered.values()] });

  // ── Join: the ONLY thing that may declare the mission finished ─────────────
  if (!join.allTerminal) {
    // Deadline reached with a child still outstanding. The mission stays
    // `running` in the store and the outcome names exactly who is missing.
    return join;
  }

  const completedAt = now();
  const failureCategory = join.requiredGaps.find((gap) => gap.failureCategory)?.failureCategory ?? null;
  store.completeMission({
    missionId,
    status: join.status,
    outcome: join.outcome,
    join,
    completedAt,
    error: join.status === 'failed' ? join.outcome : null,
    failureCategory: join.status === 'failed' || join.status === 'blocked' ? failureCategory : null,
  });
  return join;
}

/**
 * Wait for every child to reach a terminal state.
 *
 * The wave loop settles the children it ran itself, so this normally returns on
 * the first read. It exists for the child another worker claimed: the parent
 * must not join over a lane that is still in flight.
 */
async function awaitChildren(
  store: MissionGraphStore,
  missionId: string,
  options: LaunchFanOutOptions,
  clockMs: () => number,
): Promise<MissionChildState[]> {
  const deadlineMs = options.joinDeadlineMs ?? DEFAULT_JOIN_DEADLINE_MS;
  const pollMs = options.joinPollMs ?? DEFAULT_JOIN_POLL_MS;
  const start = clockMs();

  let children = store.listChildren(missionId);
  while (children.some((child) => !isTerminalMissionChildStatus(child.status))) {
    if (clockMs() - start >= deadlineMs) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    children = store.listChildren(missionId);
  }
  return children;
}

/** Read the current parent + children view for a scope. SELECT-only. */
export function readFanOutMission(
  definition: Pick<FanOutMissionDefinition, 'kind' | 'scope' | 'label' | 'children'>,
  scopeId: number,
  store: MissionGraphStore = new MissionGraphStore(),
): {
  mission: ReturnType<MissionGraphStore['latestMission']>;
  children: MissionChildState[];
  join: MissionJoin | null;
  history: Array<{ missionId: string; sequence: number; status: string; startedAt: string; completedAt: string | null }>;
} {
  const mission = store.latestMission(definition.kind, definition.scope, scopeId);
  // Declared identity is overlaid on the stored rows so a mission written before
  // the identity layer existed still reads with its group, role, specialist and
  // contribution slot instead of showing blanks.
  const children = mission
    ? overlayDeclaredIdentity(definition.children, store.listChildren(mission.missionId))
    : [];
  // A running mission has no stored join yet — compute the live one so the
  // operator sees honest in-flight progress instead of an empty panel. A join
  // STORED before the identity/acceptance fields existed is normalized, so every
  // reader gets the full shape and a pre-existing mission still renders.
  const join = mission
    ? mission.join
      ? normalizeStoredMissionJoin(mission.join, definition.children, children)
      : joinMissionChildren({ specs: definition.children, children })
    : null;
  const history = store
    .listMissions(definition.kind, definition.scope, scopeId)
    .map((row) => ({
      missionId: row.missionId,
      sequence: row.sequence,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));
  return { mission, children, join, history };
}
