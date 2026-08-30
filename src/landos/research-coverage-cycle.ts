// LandOS — Research Coverage Cycle.
//
// Re-run Research used to mean "launch the deal-intelligence mission again".
// That is a launcher, not a control system: it never asked what the Deal
// already had, never noticed which lanes came back empty, never closed the
// remaining machine-resolvable gaps, and never told the specialist layers that
// new evidence had landed. Deal 90 is the proof — five lanes returned, thirteen
// never ran, and the run reported itself finished.
//
// This module is the coordinator that was missing. It owns NO research. Every
// piece it uses already exists:
//
//   research-readiness.ts            the persistent per-Deal coverage manifest
//   research-readiness-reconcile.ts  the deterministic probes over retained state
//   research-readiness-backfill.ts   the bounded "one invocation per owning capability"
//   intelligence-stack.ts            the specialist cascade (property/market/seller/deal)
//
// What is added here is the loop between them, and the honest vocabulary that
// separates "the workflow executed" from "the required output was established".
//
// Bounded by construction: ONE plan, ONE backfill pass over the machine-owned
// gaps, ONE specialist cascade (which runs its own single critical-gap
// backfill), ONE final reconcile. No agent conversation, no retry storm. A
// requirement that cannot be satisfied ends BLOCKED with the real reason.

import type { CapabilityEntity } from './capability-contract.js';
import type { ResearchResultState } from './research-lane-outcome.js';
import type {
  ResearchReadinessManifest,
  ResearchReadinessManifestItem,
  ResearchReadinessGroup,
} from './research-readiness.js';

/**
 * The honest terminal states for one research requirement.
 *
 * The distinction the manifest colours alone could not carry to an operator:
 * REUSED is a real answer LandOS already held and deliberately did not re-run,
 * NOT_RUN is a lane nobody attempted, and PARTIAL is a lane that executed and
 * did not establish its required output (a zoning search that opened the LDR
 * PDF but never established the district).
 */
export type ResearchCoverageState =
  | 'RETURNED'
  | 'REUSED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'NOT_RUN'
  | 'NEEDS_REFRESH'
  | 'NOT_APPLICABLE';

/** What this cycle intends to do about the requirement. `waiting_prerequisite`
 *  is neither blocked nor failed: the item's own declared subject context
 *  (parcel, county, ZIP, owner, seller communications) is not available yet,
 *  and the cycle will schedule it as soon as it is. */
export type ResearchCoverageAction = 'reuse' | 'run' | 'blocked' | 'not_applicable' | 'waiting_prerequisite';

export interface ResearchCoverageEntry {
  id: string;
  label: string;
  group: ResearchReadinessGroup;
  question: string;
  state: ResearchCoverageState;
  /** Canonical cross-subsystem result vocabulary. `state` remains the richer
   * coverage-planning detail (for example REUSED vs RETURNED). */
  resultState: ResearchResultState;
  action: ResearchCoverageAction;
  /** The capability or surface that owns the answer. */
  owner: string;
  ownerCapabilityId: string | null;
  /** True only where a registered capability can close this automatically. */
  machineResolvable: boolean;
  reason: string;
  nextAction: string | null;
}

export interface ResearchCoverageCounts {
  returned: number;
  reused: number;
  partial: number;
  blocked: number;
  notRun: number;
  needsRefresh: number;
  notApplicable: number;
}

export interface ResearchCoveragePlan {
  contractVersion: 'research-coverage-plan-v1';
  dealCardId: number;
  generatedAt: string;
  entries: ResearchCoverageEntry[];
  counts: ResearchCoverageCounts;
  /** Item ids this cycle will actually attempt. */
  runItemIds: string[];
  /** Item ids deliberately reused rather than re-run. */
  reuseItemIds: string[];
  /**
   * "12 returned · 3 reused · 2 partial · 1 blocked". Execution finished and
   * research coverage complete are different sentences, and this is the second.
   */
  headline: string;
}

/**
 * A structured evidence requirement one specialist layer needs.
 *
 * This is the machine-readable form of "Property Intelligence needs the current
 * zoning district because subdivision feasibility depends on it". It is derived
 * from the same manifest the coverage plan reads, so a specialist can never ask
 * for something the checklist does not track, and MiniMax can later answer
 * "why don't we have zoning?" from persisted state instead of a transcript.
 */
export interface SpecialistEvidenceRequirement {
  itemId: string;
  need: string;
  requestedBy: 'property' | 'market' | 'seller' | 'deal';
  reason: string;
  /** A hard blocker stops the layer's conclusion; otherwise it only lowers confidence. */
  priority: 'hard_blocker' | 'confidence';
  acceptableOutput: string;
  status: ResearchCoverageState;
  /** The exact next retrieval action, or null when nothing machine-owned remains. */
  nextRetrievalAction: string | null;
}

const GROUP_LAYER: Record<ResearchReadinessGroup, SpecialistEvidenceRequirement['requestedBy']> = {
  property: 'property',
  market: 'market',
  seller: 'seller',
};

/**
 * Map one reconciled manifest item to its honest coverage state.
 *
 * `ranThisCycle` distinguishes REUSED from RETURNED: a green item the cycle did
 * not touch is evidence LandOS already held, and saying it "returned" would
 * claim work that did not happen.
 */
export function coverageStateFor(
  item: ResearchReadinessManifestItem,
  ranThisCycle = false,
): ResearchCoverageState {
  if (item.status === 'gray') return 'NOT_APPLICABLE';
  if (item.status === 'blue') return 'NEEDS_REFRESH';
  if (item.status === 'green') return ranThisCycle ? 'RETURNED' : 'REUSED';
  // A proper attempt that established no firm answer. Partial when it left
  // usable-but-incomplete evidence behind, unresolved-but-attempted otherwise.
  if (item.status === 'yellow') return 'PARTIAL';
  // An item waiting on its own declared subject context has not been refused
  // by any source — it simply cannot be attempted yet. NOT_RUN, never BLOCKED.
  if ((item.unmetPrerequisites?.length ?? 0) > 0) return 'NOT_RUN';
  // Red. Never attempted is NOT_RUN; attempted and still empty is BLOCKED,
  // because something outside LandOS refused the answer.
  return item.attempted ? 'BLOCKED' : 'NOT_RUN';
}

export function coverageResultState(
  state: ResearchCoverageState,
  item: ResearchReadinessManifestItem,
): ResearchResultState {
  if (state === 'RETURNED' || state === 'REUSED') return 'RETURNED';
  if (state === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (state === 'NOT_RUN') return 'NOT_RUN';
  if (state === 'PARTIAL' || state === 'NEEDS_REFRESH') return 'PARTIAL';
  if (state === 'BLOCKED' && item.attempted && !item.machineBackfillAllowed) return 'NEEDS_OPERATOR_ACTION';
  return 'BLOCKED';
}

function actionFor(state: ResearchCoverageState, item: ResearchReadinessManifestItem): ResearchCoverageAction {
  if (state === 'NOT_APPLICABLE') return 'not_applicable';
  if (state === 'RETURNED' || state === 'REUSED') return 'reuse';
  if ((item.unmetPrerequisites?.length ?? 0) > 0) return 'waiting_prerequisite';
  if (!item.machineBackfillAllowed) return 'blocked';
  // PARTIAL, BLOCKED, NOT_RUN and NEEDS_REFRESH are all attemptable when a
  // registered capability owns them. A PARTIAL lane is re-attempted exactly
  // once per cycle and then left alone; it never loops.
  return 'run';
}

function countStates(entries: ResearchCoverageEntry[]): ResearchCoverageCounts {
  const count = (state: ResearchCoverageState) => entries.filter((entry) => entry.state === state).length;
  return {
    returned: count('RETURNED'),
    reused: count('REUSED'),
    partial: count('PARTIAL'),
    blocked: count('BLOCKED'),
    notRun: count('NOT_RUN'),
    needsRefresh: count('NEEDS_REFRESH'),
    notApplicable: count('NOT_APPLICABLE'),
  };
}

function headlineFor(counts: ResearchCoverageCounts): string {
  const parts = [
    counts.returned ? `${counts.returned} returned` : null,
    counts.reused ? `${counts.reused} reused` : null,
    counts.partial ? `${counts.partial} partial` : null,
    counts.needsRefresh ? `${counts.needsRefresh} needs refresh` : null,
    counts.notRun ? `${counts.notRun} not run` : null,
    counts.blocked ? `${counts.blocked} blocked` : null,
    counts.notApplicable ? `${counts.notApplicable} not applicable` : null,
  ].filter((part): part is string => part != null);
  return parts.length ? parts.join(' · ') : 'no applicable research requirements';
}

/**
 * Build the coverage plan from a reconciled manifest.
 *
 * Pure. This is what "show the planned delta before running anything" means:
 * every applicable requirement, its honest current state, and whether this
 * cycle will reuse it, run it, or report it blocked.
 */
export function planResearchCoverage(
  manifest: ResearchReadinessManifest,
  options: { ranItemIds?: readonly string[]; now?: string } = {},
): ResearchCoveragePlan {
  const ran = new Set(options.ranItemIds ?? []);
  const entries = manifest.items.map((item): ResearchCoverageEntry => {
    const state = coverageStateFor(item, ran.has(item.id));
    return {
      id: item.id,
      label: item.label,
      group: item.group,
      question: item.question,
      state,
      resultState: coverageResultState(state, item),
      action: actionFor(state, item),
      owner: item.owner.label,
      ownerCapabilityId: item.owner.capabilityId,
      machineResolvable: item.machineBackfillAllowed,
      reason: item.reason,
      nextAction: item.nextAction,
    };
  });
  const counts = countStates(entries);
  return {
    contractVersion: 'research-coverage-plan-v1',
    dealCardId: manifest.dealCardId,
    generatedAt: options.now ?? manifest.generatedAt,
    entries,
    counts,
    runItemIds: entries.filter((entry) => entry.action === 'run').map((entry) => entry.id),
    reuseItemIds: entries.filter((entry) => entry.action === 'reuse').map((entry) => entry.id),
    headline: headlineFor(counts),
  };
}

/**
 * Derive the specialist layers' structured evidence requirements.
 *
 * The specialists do not passively wait for whatever arrives: every unsatisfied
 * applicable requirement becomes a named request with a reason, a priority and
 * an acceptable output. `intelligenceCritical` on the manifest item is already
 * the "this blocks the layer's conclusion" flag, so a hard blocker here is the
 * same fact the intelligence stack itself enforces — not a second opinion.
 */
export function specialistEvidenceRequirements(
  plan: ResearchCoveragePlan,
  manifest: ResearchReadinessManifest,
): SpecialistEvidenceRequirement[] {
  const critical = new Map(manifest.items.map((item) => [item.id, item.blocksIntelligence]));
  return plan.entries
    .filter((entry) => entry.state !== 'RETURNED' && entry.state !== 'REUSED' && entry.state !== 'NOT_APPLICABLE')
    .map((entry): SpecialistEvidenceRequirement => ({
      itemId: entry.id,
      need: entry.label,
      requestedBy: GROUP_LAYER[entry.group],
      reason: entry.question,
      priority: critical.get(entry.id) ? 'hard_blocker' : 'confidence',
      acceptableOutput: `Authoritative evidence from ${entry.owner} that establishes: ${entry.question}`,
      status: entry.state,
      nextRetrievalAction: entry.action === 'run'
        ? (entry.nextAction ?? `Invoke ${entry.owner} for ${entry.label}.`)
        : entry.nextAction,
    }));
}

export interface ResearchCoverageCycleResult {
  dealCardId: number;
  /** The planned delta, computed BEFORE anything ran. */
  plan: ResearchCoveragePlan;
  /** The requirements the specialist layers declared against that plan. */
  requirements: SpecialistEvidenceRequirement[];
  /** Item ids the bounded backfill actually attempted this cycle. */
  attemptedItemIds: string[];
  /** Coverage after retrieval and the specialist cascade. */
  after: ResearchCoveragePlan | null;
  /** Which intelligence layers recomputed, and which honestly could not. */
  cascade: { refreshed: string[]; reused: string[]; outcome: string; reason: string | null } | null;
  warnings: string[];
}

export interface ResearchCoverageCycleDeps {
  reconcile: (dealCardId: number) => ResearchReadinessManifest | { error: string };
  /** The existing bounded backfill. Returns the manifest it reconciled after running. */
  backfill: (
    dealCardId: number,
    entity: CapabilityEntity,
    itemIds: string[],
    options?: { includeUnresolved?: boolean },
  ) => Promise<ResearchReadinessManifest | null>;
  /** The existing specialist cascade (property → market → seller → deal). */
  cascade?: (dealCardId: number) => Promise<{
    outcome: string;
    reason: string | null;
    refreshedLayers: string[];
    reusedLayers: string[];
    warnings?: string[];
  }>;
  log?: (event: string, detail: Record<string, unknown>) => void;
  now?: () => string;
}

const isManifest = (value: ResearchReadinessManifest | { error: string }): value is ResearchReadinessManifest =>
  !('error' in value);

/** Passes one cycle will work the delta for. Dependency chains here are a few
 *  links deep (identity → zoning → subdivision → valuation → strategy), so this
 *  covers them with room to spare while keeping a cycle bounded. */
const MAX_COVERAGE_PASSES = 5;

/**
 * Close this Deal's research gaps, then let the specialists reevaluate.
 *
 * Re-run Research means this, not "run every workflow from step one": inspect
 * what is already satisfied, attempt only what is missing or stale, confirm
 * what actually landed, and notify the layers that consume it. A requirement no
 * registered capability owns is reported honestly and left alone — LandOS does
 * not invent a second research implementation to make a checklist look full.
 */
export async function runResearchCoverageCycle(
  input: {
    dealCardId: number;
    entity: CapabilityEntity;
    /**
     * `automatic` is the cycle a Deal runs on its own; `operator_rerun` is
     * Tyler pressing Re-run Research. Only the second re-opens PARTIAL lanes,
     * and only those a specialist still explicitly requires.
     */
    trigger?: 'automatic' | 'operator_rerun';
  },
  deps: ResearchCoverageCycleDeps,
): Promise<ResearchCoverageCycleResult | { error: string }> {
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const warnings: string[] = [];

  const before = deps.reconcile(input.dealCardId);
  if (!isManifest(before)) return { error: before.error };

  const plan = planResearchCoverage(before, { now: now() });
  const requirements = specialistEvidenceRequirements(plan, before);
  log('research_coverage_plan', {
    dealCardId: input.dealCardId,
    headline: plan.headline,
    reuse: plan.reuseItemIds,
    run: plan.runItemIds,
    blocked: plan.entries.filter((entry) => entry.action === 'blocked').map((entry) => entry.id),
    notApplicable: plan.entries.filter((entry) => entry.action === 'not_applicable').map((entry) => entry.id),
    hardBlockers: requirements.filter((req) => req.priority === 'hard_blocker').map((req) => req.itemId),
  });

  // ── Retrieval: only the machine-owned gaps, one invocation per capability ──
  // On an operator Re-run, a PARTIAL lane a specialist still explicitly needs is
  // re-opened for ONE more bounded attempt so a different existing route can
  // try. An automatic cycle never does this; a lane nobody still asks for is
  // left settled at PARTIAL rather than re-run forever.
  const stillRequired = new Set(requirements.map((requirement) => requirement.itemId));
  const reopenUnresolved = input.trigger === 'operator_rerun'
    && plan.entries.some((entry) => entry.state === 'PARTIAL' && entry.machineResolvable && stillRequired.has(entry.id));

  // One fan-out is not the checklist. An item can only become runnable once the
  // item it depended on has landed, so a single pass settles the first layer of
  // gaps and then reports the ones it just unblocked as untouched. The cycle
  // keeps working the remaining delta instead: re-plan after each retrieval and
  // attempt whatever became runnable, until nothing new is or the ceiling is
  // reached.
  //
  // The stop condition is progress, not attempts. An item that was attempted
  // and came back in the same state is settled for this cycle and never asked
  // again, so a lane no route can close costs one attempt rather than looping.
  const attemptedItemIds: string[] = [];
  const settledForCycle = new Set<string>();
  let manifest: ResearchReadinessManifest = before;
  let workingPlan = plan;

  const stateById = (candidate: ResearchCoveragePlan): Map<string, ResearchCoverageState> =>
    new Map(candidate.entries.map((entry) => [entry.id, entry.state]));

  for (let pass = 0; pass < MAX_COVERAGE_PASSES; pass += 1) {
    const runnable = workingPlan.entries
      .filter((entry) => entry.action === 'run' && entry.machineResolvable)
      .filter((entry) => !settledForCycle.has(entry.id))
      .filter((entry) => entry.state !== 'PARTIAL' || (reopenUnresolved && stillRequired.has(entry.id)))
      .map((entry) => entry.id);
    if (!runnable.length) break;

    const stateBefore = stateById(workingPlan);
    let retrieved: ResearchReadinessManifest | null = null;
    try {
      retrieved = await deps.backfill(input.dealCardId, input.entity, runnable, {
        includeUnresolved: reopenUnresolved,
      });
    } catch (error) {
      warnings.push(`Coverage retrieval did not complete: ${error instanceof Error ? error.message : String(error)}.`);
      for (const id of runnable) settledForCycle.add(id);
      attemptedItemIds.push(...runnable.filter((id) => !attemptedItemIds.includes(id)));
      break;
    }
    for (const id of runnable) if (!attemptedItemIds.includes(id)) attemptedItemIds.push(id);
    if (retrieved) manifest = retrieved;

    const reconciled = deps.reconcile(input.dealCardId);
    if (!isManifest(reconciled)) {
      warnings.push(`Coverage could not be re-reconciled between passes: ${reconciled.error}.`);
      break;
    }
    manifest = reconciled;
    workingPlan = planResearchCoverage(reconciled, { ranItemIds: attemptedItemIds, now: now() });
    const stateAfter = stateById(workingPlan);
    // An attempt that did not move the item is the item's answer.
    for (const id of runnable) {
      if (stateBefore.get(id) === stateAfter.get(id)) settledForCycle.add(id);
    }
    log('research_coverage_pass', {
      dealCardId: input.dealCardId,
      pass: pass + 1,
      attempted: runnable,
      settled: [...settledForCycle],
      headline: workingPlan.headline,
    });
  }

  // ── Cascade: the specialists reevaluate on whatever honestly landed ───────
  // They are expected to produce a useful current read from incomplete-but-
  // sufficient evidence and state their remaining uncertainties. One pass.
  let cascade: ResearchCoverageCycleResult['cascade'] = null;
  if (deps.cascade) {
    try {
      const result = await deps.cascade(input.dealCardId);
      cascade = {
        refreshed: result.refreshedLayers,
        reused: result.reusedLayers,
        outcome: result.outcome,
        reason: result.reason,
      };
      warnings.push(...(result.warnings ?? []));
    } catch (error) {
      warnings.push(`Intelligence cascade did not complete: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }

  const settled = deps.reconcile(input.dealCardId);
  const after = isManifest(settled)
    ? planResearchCoverage(settled, { ranItemIds: attemptedItemIds, now: now() })
    : null;
  if (!isManifest(settled)) warnings.push(`Coverage could not be re-reconciled: ${settled.error}.`);

  log('research_coverage_settled', {
    dealCardId: input.dealCardId,
    headline: after?.headline ?? plan.headline,
    attempted: attemptedItemIds,
    cascade: cascade?.outcome ?? 'skipped',
    refreshedLayers: cascade?.refreshed ?? [],
  });

  return {
    dealCardId: input.dealCardId,
    plan,
    requirements: after ? specialistEvidenceRequirements(after, isManifest(settled) ? settled : before) : requirements,
    attemptedItemIds,
    after,
    cascade,
    warnings,
  };
}
