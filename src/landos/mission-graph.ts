// LandOS native mission graph — identity, gather, fan-out, acceptance and join.
//
// This is the ORCHESTRATION CONTRACT. It is pure: no database, no clock, no
// I/O. The store persists what this module decides; the runner executes it.
//
// The shape it describes:
//   • ONE parent mission owns a set of specialist CHILD missions.
//   • Every child carries its own IDENTITY: the parent it belongs to, its mission
//     group, the role it was assigned, the specialist agent that owns the lane,
//     and the parent contribution SLOT its handback belongs in.
//   • Children are laid out in dependency WAVES. A wave runs concurrently; the
//     next wave starts only once every child it depends on has SETTLED, in any
//     terminal state, so one failure never strands the rest of the mission.
//   • A child's result is judged by an ACCEPTANCE CONTRACT (mission-acceptance.ts),
//     never by the fact that its executor returned. A lane that exits cleanly and
//     hands back something unusable is REJECTED, not silently joined.
//   • The parent may not finish until every child has reached a terminal state.
//   • The join names every missing contribution. A failed, rejected, blocked,
//     skipped or still-outstanding child is ALWAYS visible in the parent outcome;
//     it is never dropped, and it never reads as success.
//
// Generalized from the Property Intelligence specialist wave engine
// (property-intelligence-specialists.ts), which remains in place and unchanged
// for the existing single-mission workflow.

import { getAgentDef } from './agent-roster.js';
import type {
  MissionAcceptanceContract,
  MissionAcceptanceState,
  MissionAcceptanceVerdict,
} from './mission-acceptance.js';
import type { MissionProviderAssignment, MissionProviderPolicy } from './mission-provider-routing.js';

/** `required` — a missing result is a gap the parent must name.
 *  `supporting` — useful, but its absence alone never blocks the parent. */
export type MissionChildRole = 'required' | 'supporting';

export type MissionChildStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  /** Ran to completion, but its result failed acceptance. Distinct from `failed`:
   *  nothing crashed, the lane simply did not deliver what it was asked for. */
  | 'rejected'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled';

/** Parent states. `running` is the only non-terminal one. */
export type MissionStatus =
  | 'running'
  | 'joined'
  | 'joined_with_gaps'
  | 'blocked'
  | 'failed';

export interface MissionChildSpec {
  /** Stable key. Unique within one mission definition. */
  key: string;
  label: string;
  /** One line the operator reads on the mission panel. */
  purpose: string;
  role: MissionChildRole;
  /** Children whose handbacks this one REQUIRES. If one of them did not
   *  contribute, this child is skipped: it cannot do its job without them. */
  dependsOn: string[];
  /**
   * Children this one must WAIT for but does not require.
   *
   * Ordering only. An awaited child that failed, blocked or was rejected does
   * NOT skip this one — the lane still runs and discloses what it could not
   * take into account. This is what keeps one missing research lane from
   * silently putting the whole mission on hold: a gap may change a conclusion,
   * but it may not cancel every conclusion that does not depend on it.
   *
   * Awaited handbacks that DID contribute are still handed to the executor
   * through `upstream`, so a lane can use whatever actually arrived.
   */
  awaits?: string[];
  timeoutMs: number;

  // ── Identity, role and relationship (declared) ─────────────────────────────
  /** Mission group this child belongs to. Several children may share one. */
  group?: string;
  /** The functional role this child serves in the parent's result. */
  assignedRole?: string;
  /** AGENT_ROSTER key of the specialist that owns this lane. Validated: an
   *  unknown key is a definition bug and refuses to lay out. */
  agentKey?: string;
  /** Which parent contribution this child's handback belongs to.
   *  Defaults to `key`. Two children may never claim the same slot. */
  contributionSlot?: string;

  // ── Acceptance and provider assignment (declared) ──────────────────────────
  /** What a delivered result must contain for this lane to pass. */
  acceptance?: MissionAcceptanceContract;
  /** How this lane executes and, when model-routed, what it needs. */
  provider?: MissionProviderPolicy;
}

/** Everything about WHO ran a child and WHERE its result belongs. */
export interface MissionChildIdentity {
  /** The parent mission this child belongs to. */
  missionId: string;
  group: string;
  assignedRole: string;
  /** Null when the definition assigns no roster specialist. Never invented. */
  agentKey: string | null;
  agentName: string;
  /** The specialist's own group in the LandOS org chart. */
  agentGroup: string | null;
  agentRole: string | null;
  /** The wired implementation agent id, when the roster declares one. */
  implAgentId: string | null;
  contributionSlot: string;
}

export interface MissionChildState {
  key: string;
  label: string;
  purpose: string;
  role: MissionChildRole;
  dependsOn: string[];
  /** Ordering-only predecessors from the declared mission graph. */
  awaits?: string[];
  identity: MissionChildIdentity;
  status: MissionChildStatus;
  summary: string;
  /** The acceptance verdict this child's status was decided from. */
  acceptance: MissionAcceptanceVerdict | null;
  /** Which provider (if any) the lane was assigned to. */
  provider: MissionProviderAssignment | null;
  failureCategory: string | null;
  failureMessage: string | null;
  retryable: boolean;
  /** Structured handback the parent joins. Null until the child contributes. */
  result: unknown;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
}

/** A child that did not contribute, with the reason stated plainly. */
export interface MissionGap {
  key: string;
  label: string;
  role: MissionChildRole;
  status: MissionChildStatus;
  /** The acceptance state behind the gap, so a rejection is never read as a crash. */
  acceptanceState: MissionAcceptanceState;
  group: string;
  agentName: string;
  failureCategory: string | null;
  reason: string;
}

/** Where one child's handback was routed on the parent, or why it was not. */
export interface MissionContributionRoute {
  childKey: string;
  childLabel: string;
  group: string;
  assignedRole: string;
  agentKey: string | null;
  agentName: string;
  /** The parent contribution slot this child's handback belongs in. */
  slot: string;
  acceptanceState: MissionAcceptanceState;
  /** True when the handback actually reached the slot. */
  routed: boolean;
  note: string;
}

export interface MissionJoin {
  status: MissionStatus;
  /** Structured handbacks, keyed by child. Only contributing children appear. */
  contributions: Record<string, unknown>;
  /** The same handbacks keyed by the parent contribution SLOT they belong to. */
  contributionsBySlot: Record<string, unknown>;
  /** Every child's routing decision, contributing or not. */
  routing: MissionContributionRoute[];
  /** Keys that contributed, in definition order. */
  contributed: string[];
  /** Keys whose result passed every acceptance term. */
  accepted: string[];
  /** Keys that contributed but are incomplete. Never presented as accepted. */
  incomplete: string[];
  /** Every non-contributing child, required or supporting. */
  gaps: MissionGap[];
  /** The subset of `gaps` whose absence the parent must treat as a real gap. */
  requiredGaps: MissionGap[];
  /** Children that have NOT reached a terminal state yet. */
  outstanding: MissionGap[];
  /** True once every child is terminal. The parent may not complete before this. */
  allTerminal: boolean;
  /** True once every REQUIRED child is terminal. */
  allRequiredTerminal: boolean;
  /** True only when every required child reached ACCEPTED. */
  allRequiredAccepted: boolean;
  /** One explicit, operator-readable sentence covering the whole mission. */
  outcome: string;
}

export const TERMINAL_MISSION_CHILD_STATUSES: readonly MissionChildStatus[] = [
  'completed',
  'partial',
  'rejected',
  'failed',
  'blocked',
  'skipped',
  'cancelled',
];

export function isTerminalMissionChildStatus(status: MissionChildStatus): boolean {
  return TERMINAL_MISSION_CHILD_STATUSES.includes(status);
}

/** True when the child handed back something the parent join can use. */
export function contributedMissionResult(status: MissionChildStatus): boolean {
  return status === 'completed' || status === 'partial';
}

/**
 * The child status implied by an acceptance verdict.
 *
 * This is the single place where "what the executor said" becomes "what the
 * mission records". `accepted` cannot upgrade a lane that honestly reported
 * itself partial, and a clean exit with an unacceptable result becomes
 * `rejected` rather than `completed`.
 */
export function missionChildStatusForAcceptance(
  acceptance: MissionAcceptanceState,
  reported: 'completed' | 'partial' | 'blocked',
): MissionChildStatus {
  switch (acceptance) {
    case 'accepted':
      return reported === 'partial' ? 'partial' : 'completed';
    case 'incomplete':
      return 'partial';
    case 'rejected':
      return 'rejected';
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
    default:
      // Nothing was declared, so nothing was verified: record what the lane said.
      return reported;
  }
}

// ── Declared identity ───────────────────────────────────────────────────────

export const UNASSIGNED_AGENT_NAME = 'Unassigned specialist';

/**
 * Resolve a child's identity from its declaration and the agent roster.
 *
 * An unassigned lane is reported as unassigned. No agent is ever invented for a
 * child, because a fabricated owner would make the mission look accountable when
 * nothing owns the lane.
 */
export function missionChildIdentity(spec: MissionChildSpec, missionId = ''): MissionChildIdentity {
  const agent = spec.agentKey ? getAgentDef(spec.agentKey) : undefined;
  return {
    missionId,
    group: spec.group ?? 'ungrouped',
    assignedRole: spec.assignedRole ?? spec.purpose,
    agentKey: spec.agentKey ?? null,
    agentName: agent?.name ?? UNASSIGNED_AGENT_NAME,
    agentGroup: agent?.group ?? null,
    agentRole: agent?.role ?? null,
    implAgentId: agent?.implAgentId ?? null,
    contributionSlot: spec.contributionSlot ?? spec.key,
  };
}

/** The declared contribution slot for a child key, or the key itself. */
export function missionContributionSlot(spec: MissionChildSpec): string {
  return spec.contributionSlot ?? spec.key;
}

/** Everything a child must WAIT for: what it requires plus what it only orders after. */
export function missionChildPredecessors(spec: MissionChildSpec): string[] {
  const seen = new Set<string>([...spec.dependsOn, ...(spec.awaits ?? [])]);
  return [...seen];
}

/**
 * Validate a mission definition and lay its children out in execution waves.
 *
 * Throws on an unknown dependency, a dependency cycle, an unknown roster agent,
 * or two children claiming the same contribution slot. Each is a definition bug:
 * a mission that cannot be laid out must never launch and then silently strand
 * children in `queued`, and a duplicated slot would mean one child's handback
 * silently overwrote another's.
 *
 * Waves order on `dependsOn` AND `awaits`; only `dependsOn` can skip a child.
 */
export function planMissionWaves(specs: MissionChildSpec[]): string[][] {
  if (specs.length === 0) throw new Error('A mission definition must declare at least one child.');

  const byKey = new Map<string, MissionChildSpec>();
  for (const spec of specs) {
    if (byKey.has(spec.key)) throw new Error(`Duplicate mission child key: ${spec.key}`);
    byKey.set(spec.key, spec);
  }
  for (const spec of specs) {
    for (const dep of missionChildPredecessors(spec)) {
      if (!byKey.has(dep)) {
        throw new Error(`Mission child "${spec.key}" depends on unknown child "${dep}".`);
      }
      if (dep === spec.key) {
        throw new Error(`Mission child "${spec.key}" depends on itself.`);
      }
    }
    if (spec.agentKey && !getAgentDef(spec.agentKey)) {
      throw new Error(
        `Mission child "${spec.key}" is assigned to unknown specialist agent "${spec.agentKey}". ` +
        `A child may not run under an agent identity that does not exist in the roster.`,
      );
    }
  }

  const slots = new Map<string, string>();
  for (const spec of specs) {
    const slot = missionContributionSlot(spec);
    const claimed = slots.get(slot);
    if (claimed) {
      throw new Error(
        `Mission children "${claimed}" and "${spec.key}" both route their handback to contribution slot "${slot}". ` +
        `One result would overwrite the other, so the definition is refused.`,
      );
    }
    slots.set(slot, spec.key);
  }

  const waves: string[][] = [];
  const settled = new Set<string>();
  const pending = new Set<string>(specs.map((spec) => spec.key));

  while (pending.size > 0) {
    const wave = [...pending].filter((key) =>
      missionChildPredecessors(byKey.get(key)!).every((dep) => settled.has(dep)),
    );
    if (wave.length === 0) {
      throw new Error(`Mission child graph has a dependency cycle among: ${[...pending].join(', ')}.`);
    }
    waves.push(wave);
    for (const key of wave) {
      pending.delete(key);
      settled.add(key);
    }
  }
  return waves;
}

/** The initial child records written when the parent mission is created. */
export function initialMissionChildren(specs: MissionChildSpec[], missionId = ''): MissionChildState[] {
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    purpose: spec.purpose,
    role: spec.role,
    dependsOn: [...spec.dependsOn],
    awaits: [...(spec.awaits ?? [])],
    identity: missionChildIdentity(spec, missionId),
    status: 'queued' as const,
    summary: spec.purpose,
    acceptance: null,
    provider: null,
    failureCategory: null,
    failureMessage: null,
    retryable: false,
    result: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: 0,
  }));
}

/**
 * Why a child cannot run, given what its dependencies actually produced.
 *
 * A child is SKIPPED (never failed) when an upstream child it consumes did not
 * contribute — the child never ran, so calling it a failure would misreport
 * where the mission actually broke. Returns null when the child may run.
 */
export function dependencyBlock(
  spec: MissionChildSpec,
  children: Map<string, MissionChildState>,
): string | null {
  const unmet = spec.dependsOn
    .map((dep) => children.get(dep))
    .filter((dep): dep is MissionChildState => !!dep && !contributedMissionResult(dep.status));
  if (unmet.length === 0) return null;
  const named = unmet.map((dep) => `${dep.label} (${dep.status})`).join(', ');
  return `Skipped because an upstream contribution this child consumes is missing: ${named}. Nothing is asserted from this lane.`;
}

/**
 * Handbacks from the children this spec waited on, keyed by child.
 *
 * Includes AWAITED children as well as required ones: a lane that merely orders
 * after another still needs whatever that lane actually produced. Only children
 * that genuinely contributed appear, so an absent key means "this lane delivered
 * nothing", never "this lane delivered nothing useful".
 */
export function upstreamContributions(
  spec: MissionChildSpec,
  children: Map<string, MissionChildState>,
): Record<string, unknown> {
  const upstream: Record<string, unknown> = {};
  for (const dep of missionChildPredecessors(spec)) {
    const child = children.get(dep);
    if (child && contributedMissionResult(child.status)) upstream[dep] = child.result;
  }
  return upstream;
}

function acceptanceStateOf(child: MissionChildState): MissionAcceptanceState {
  return child.acceptance?.state ?? 'not_evaluated';
}

function gapReason(child: MissionChildState): string {
  if (!isTerminalMissionChildStatus(child.status)) {
    return child.status === 'running'
      ? 'Still running; it has not reached a terminal state.'
      : 'Still queued; it has not started.';
  }
  // A rejection's own reason is the acceptance verdict: it states which
  // requirement the delivered result failed, which a failure message cannot.
  if (child.status === 'rejected' && child.acceptance?.reason) return child.acceptance.reason;
  if (child.failureMessage) return child.failureMessage;
  if (child.summary) return child.summary;
  return `Ended as ${child.status} with no stated reason.`;
}

function toGap(child: MissionChildState): MissionGap {
  return {
    key: child.key,
    label: child.label,
    role: child.role,
    status: child.status,
    acceptanceState: acceptanceStateOf(child),
    group: child.identity.group,
    agentName: child.identity.agentName,
    failureCategory: child.failureCategory,
    reason: gapReason(child),
  };
}

/**
 * Overlay the DECLARED identity onto stored child rows.
 *
 * Identity is declared by the mission definition, not observed at run time, so a
 * row written before these fields existed can still be presented with its group,
 * role, specialist and contribution slot. A row that never ran, or that settled
 * before acceptance checks existed, is reported as `not_evaluated` rather than
 * being presented as though its result had been verified.
 */
export function overlayDeclaredIdentity(
  specs: MissionChildSpec[],
  children: MissionChildState[],
): MissionChildState[] {
  const specByKey = new Map(specs.map((spec) => [spec.key, spec]));
  return children.map((child) => {
    const spec = specByKey.get(child.key);
    const identity = spec
      ? { ...missionChildIdentity(spec, child.identity.missionId), ...stripEmptyIdentity(child.identity) }
      // No spec declares this key any more (the definition changed). Keep what was
      // stored, and fall back to the child key only for a slot that was never set.
      : { ...child.identity, contributionSlot: child.identity.contributionSlot || child.key };
    const acceptance = child.acceptance ?? {
      state: 'not_evaluated' as const,
      reason: isTerminalMissionChildStatus(child.status)
        ? 'This child settled without an acceptance verdict, so its result was never evaluated against an acceptance contract and is not presented as accepted.'
        : 'Not evaluated yet: this child has not settled.',
      checks: [],
    };
    return { ...child, awaits: [...(spec?.awaits ?? child.awaits ?? [])], identity, acceptance };
  });
}

/** Keep only the identity fields a stored row actually carried. */
function stripEmptyIdentity(identity: MissionChildIdentity): Partial<MissionChildIdentity> {
  const kept: Partial<MissionChildIdentity> = {};
  if (identity.missionId) kept.missionId = identity.missionId;
  if (identity.group && identity.group !== 'ungrouped') kept.group = identity.group;
  if (identity.assignedRole) kept.assignedRole = identity.assignedRole;
  if (identity.agentKey) {
    kept.agentKey = identity.agentKey;
    kept.agentName = identity.agentName;
    kept.agentGroup = identity.agentGroup;
    kept.agentRole = identity.agentRole;
    kept.implAgentId = identity.implAgentId;
  }
  if (identity.contributionSlot) kept.contributionSlot = identity.contributionSlot;
  return kept;
}

/**
 * Normalize a STORED join so it always satisfies the current MissionJoin shape.
 *
 * A mission joined before the identity/acceptance fields existed has a stored
 * join with none of them. Returning that raw would hand callers a MissionJoin
 * whose declared array fields are `undefined` — which is not a shape any reader
 * should have to defend against, and which blanked the operator's mission panel.
 *
 * The missing pieces are REBUILT from the definition and the stored children so a
 * pre-existing mission still shows where each handback belongs. Acceptance is NOT
 * reconstructed: a child that was never evaluated is never counted as accepted.
 */
export function normalizeStoredMissionJoin(
  join: MissionJoin,
  specs: MissionChildSpec[],
  children: MissionChildState[],
): MissionJoin {
  const complete =
    Array.isArray(join.routing) &&
    Array.isArray(join.accepted) &&
    Array.isArray(join.incomplete) &&
    !!join.contributionsBySlot;
  if (complete) return join;

  const gathered = gatherMissionChildren(specs, children);
  const contributions = join.contributions ?? {};
  const slotFor = (key: string): string =>
    gathered.get(key)?.identity.contributionSlot ?? key;

  const contributionsBySlot: Record<string, unknown> = join.contributionsBySlot ?? {};
  if (!join.contributionsBySlot) {
    for (const key of join.contributed ?? []) contributionsBySlot[slotFor(key)] = contributions[key];
  }

  const routing: MissionContributionRoute[] = Array.isArray(join.routing)
    ? join.routing
    : specs.map((spec) => {
        const child = gathered.get(spec.key);
        const identity = child?.identity ?? missionChildIdentity(spec);
        const routed = (join.contributed ?? []).includes(spec.key);
        return {
          childKey: spec.key,
          childLabel: child?.label ?? spec.label,
          group: identity.group,
          assignedRole: identity.assignedRole,
          agentKey: identity.agentKey,
          agentName: identity.agentName,
          slot: identity.contributionSlot,
          acceptanceState: 'not_evaluated' as MissionAcceptanceState,
          routed,
          note: routed
            ? `Handback routed to parent contribution "${identity.contributionSlot}". It predates mission acceptance checks, so it is not presented as accepted.`
            : `Nothing is routed to "${identity.contributionSlot}": this lane did not contribute.`,
        };
      });

  // A stored gap predates the acceptance/group/agent fields too. Fill them from
  // the child record so the operator still sees who owned a missing lane.
  const specByKey = new Map(specs.map((spec) => [spec.key, spec]));
  const fillGap = (gap: MissionGap): MissionGap => {
    // Prefer the stored child's identity (who actually ran it); fall back to the
    // DECLARED identity, which the definition knows even with no child row.
    const spec = specByKey.get(gap.key);
    const identity = gathered.get(gap.key)?.identity ?? (spec ? missionChildIdentity(spec) : undefined);
    return {
      ...gap,
      acceptanceState: gap.acceptanceState ?? 'not_evaluated',
      group: gap.group ?? identity?.group ?? 'ungrouped',
      agentName: gap.agentName ?? identity?.agentName ?? UNASSIGNED_AGENT_NAME,
    };
  };

  return {
    ...join,
    contributions,
    contributionsBySlot,
    routing,
    contributed: join.contributed ?? [],
    // Never reconstructed. An unevaluated result is not an accepted one.
    accepted: Array.isArray(join.accepted) ? join.accepted : [],
    incomplete: Array.isArray(join.incomplete) ? join.incomplete : [],
    gaps: (join.gaps ?? []).map(fillGap),
    requiredGaps: (join.requiredGaps ?? []).map(fillGap),
    outstanding: (join.outstanding ?? []).map(fillGap),
    allRequiredAccepted: join.allRequiredAccepted === true,
  };
}

/**
 * Read every child's current state into the parent's view of the mission.
 * Pure. The runner calls this after each dispatch and once more before joining.
 */
export function gatherMissionChildren(
  specs: MissionChildSpec[],
  children: MissionChildState[],
): Map<string, MissionChildState> {
  const byKey = new Map(overlayDeclaredIdentity(specs, children).map((child) => [child.key, child]));
  const gathered = new Map<string, MissionChildState>();
  for (const spec of specs) {
    const child = byKey.get(spec.key);
    if (child) gathered.set(spec.key, child);
  }
  return gathered;
}

/**
 * Join every child handback into one parent result.
 *
 * The parent status is decided ONLY by what the children actually delivered:
 *   • every child contributed                      → joined
 *   • required all contributed, supporting missing  → joined_with_gaps
 *   • a required child failed OR was rejected      → failed
 *   • every required gap is blocked                → blocked
 *   • otherwise (required skipped/cancelled)       → joined_with_gaps
 *   • any child still non-terminal                 → running (never a completion)
 *
 * A rejected required child lands in `failed` because the mission did not
 * deliver, but the outcome sentence keeps it separate from a crash: it ran and
 * returned a result that did not meet its acceptance requirement.
 */
export function joinMissionChildren(input: {
  specs: MissionChildSpec[];
  children: MissionChildState[];
}): MissionJoin {
  const gathered = gatherMissionChildren(input.specs, input.children);
  const ordered = input.specs
    .map((spec) => gathered.get(spec.key))
    .filter((child): child is MissionChildState => !!child);

  const contributions: Record<string, unknown> = {};
  const contributionsBySlot: Record<string, unknown> = {};
  const routing: MissionContributionRoute[] = [];
  const contributed: string[] = [];
  const accepted: string[] = [];
  const incomplete: string[] = [];
  const gaps: MissionGap[] = [];
  const outstanding: MissionGap[] = [];

  const route = (child: MissionChildState, routed: boolean, note: string): void => {
    routing.push({
      childKey: child.key,
      childLabel: child.label,
      group: child.identity.group,
      assignedRole: child.identity.assignedRole,
      agentKey: child.identity.agentKey,
      agentName: child.identity.agentName,
      slot: child.identity.contributionSlot,
      acceptanceState: acceptanceStateOf(child),
      routed,
      note,
    });
  };

  for (const child of ordered) {
    const slot = child.identity.contributionSlot;
    if (!isTerminalMissionChildStatus(child.status)) {
      outstanding.push(toGap(child));
      gaps.push(toGap(child));
      route(child, false, `Nothing is routed to "${slot}" yet: the lane is still ${child.status}.`);
      continue;
    }
    if (contributedMissionResult(child.status)) {
      contributions[child.key] = child.result;
      contributionsBySlot[slot] = child.result;
      contributed.push(child.key);
      const state = acceptanceStateOf(child);
      if (state === 'accepted') accepted.push(child.key);
      else if (state === 'incomplete') incomplete.push(child.key);
      route(
        child,
        true,
        state === 'accepted'
          ? `Accepted handback routed to parent contribution "${slot}".`
          : state === 'incomplete'
            ? `Incomplete handback routed to parent contribution "${slot}"; it is not presented as a full result.`
            : `Handback routed to parent contribution "${slot}" without an acceptance verdict, so it is not presented as accepted.`,
      );
      continue;
    }
    gaps.push(toGap(child));
    route(
      child,
      false,
      child.status === 'rejected'
        ? `Nothing is routed to "${slot}": the lane ran but its result failed acceptance.`
        : `Nothing is routed to "${slot}": the lane ended as ${child.status}.`,
    );
  }

  // A declared child with no record at all is a gap too — the mission must not
  // report success over a contribution that was never even created.
  for (const spec of input.specs) {
    if (gathered.has(spec.key)) continue;
    const identity = missionChildIdentity(spec);
    const missing: MissionGap = {
      key: spec.key,
      label: spec.label,
      role: spec.role,
      status: 'queued',
      acceptanceState: 'not_evaluated',
      group: identity.group,
      agentName: identity.agentName,
      failureCategory: null,
      reason: 'No child mission record exists for this declared specialist.',
    };
    gaps.push(missing);
    outstanding.push(missing);
    routing.push({
      childKey: spec.key,
      childLabel: spec.label,
      group: identity.group,
      assignedRole: identity.assignedRole,
      agentKey: identity.agentKey,
      agentName: identity.agentName,
      slot: identity.contributionSlot,
      acceptanceState: 'not_evaluated',
      routed: false,
      note: `Nothing is routed to "${identity.contributionSlot}": no child mission record exists for this declared specialist.`,
    });
  }

  const requiredGaps = gaps.filter((gap) => gap.role === 'required');
  const allTerminal = outstanding.length === 0;
  const allRequiredTerminal = outstanding.every((gap) => gap.role !== 'required');
  const requiredKeys = input.specs.filter((spec) => spec.role === 'required').map((spec) => spec.key);
  const allRequiredAccepted = requiredKeys.length > 0 && requiredKeys.every((key) => accepted.includes(key));

  // A skipped child is a CONSEQUENCE of an upstream gap, not an independent
  // one. Classifying the parent off the root-cause gaps keeps a blocked
  // identity reading as `blocked` instead of being diluted into a generic
  // "with gaps" by the dependants it stranded.
  const rootRequiredGaps = requiredGaps.filter((gap) => gap.status !== 'skipped');
  const failedRequired = rootRequiredGaps.filter((gap) => gap.status === 'failed');
  const rejectedRequired = rootRequiredGaps.filter((gap) => gap.status === 'rejected');

  let status: MissionStatus;
  if (!allTerminal) {
    status = 'running';
  } else if (gaps.length === 0) {
    status = 'joined';
  } else if (failedRequired.length > 0 || rejectedRequired.length > 0) {
    status = 'failed';
  } else if (rootRequiredGaps.length > 0 && rootRequiredGaps.every((gap) => gap.status === 'blocked')) {
    status = 'blocked';
  } else {
    status = 'joined_with_gaps';
  }

  return {
    status,
    contributions,
    contributionsBySlot,
    routing,
    contributed,
    accepted,
    incomplete,
    gaps,
    requiredGaps,
    outstanding,
    allTerminal,
    allRequiredTerminal,
    allRequiredAccepted,
    outcome: describeMissionOutcome({
      status,
      total: input.specs.length,
      contributed,
      accepted,
      incomplete,
      gaps,
      requiredGaps,
      rootRequiredGaps,
      failedRequired,
      rejectedRequired,
      outstanding,
    }),
  };
}

function describeMissionOutcome(input: {
  status: MissionStatus;
  total: number;
  contributed: string[];
  accepted: string[];
  incomplete: string[];
  gaps: MissionGap[];
  requiredGaps: MissionGap[];
  rootRequiredGaps: MissionGap[];
  failedRequired: MissionGap[];
  rejectedRequired: MissionGap[];
  outstanding: MissionGap[];
}): string {
  const name = (gap: MissionGap): string => `${gap.label} (${gap.status}${gap.failureCategory ? `: ${gap.failureCategory}` : ''})`;
  const joined = `Joined ${input.contributed.length} of ${input.total} child mission(s).`;
  // Acceptance is stated on every outcome, so "joined" can never be mistaken for
  // "everything was accepted" when some lanes only delivered a partial result.
  const acceptanceLine =
    `Acceptance: ${input.accepted.length} accepted` +
    (input.incomplete.length > 0 ? `, ${input.incomplete.length} incomplete (${input.incomplete.join(', ')})` : '') +
    '.';

  if (input.status === 'running') {
    return `${joined} ${acceptanceLine} The parent cannot complete yet: ${input.outstanding.map(name).join(', ')} ${input.outstanding.length === 1 ? 'has' : 'have'} not reached a terminal state.`;
  }
  if (input.status === 'joined') {
    return `${joined} ${acceptanceLine} Every child mission contributed; no contribution is missing.`;
  }
  const stranded = input.gaps.filter((gap) => gap.status === 'skipped');
  const strandedNote = stranded.length > 0
    ? ` ${stranded.map(name).join(', ')} never ran because ${stranded.length === 1 ? 'its' : 'their'} upstream contribution was missing.`
    : '';

  if (input.status === 'failed') {
    // Execution failure and an unacceptable result are named separately: they
    // call for different operator action, so collapsing them would mislead.
    const parts: string[] = [];
    if (input.failedRequired.length > 0) {
      parts.push(`required child mission(s) failed to execute — ${input.failedRequired.map(name).join(', ')}`);
    }
    if (input.rejectedRequired.length > 0) {
      parts.push(`required child mission(s) ran but returned a result that did NOT meet their acceptance requirement — ${input.rejectedRequired.map(name).join(', ')}`);
    }
    return `${joined} ${acceptanceLine} The mission did NOT complete: ${parts.join('; ')}. Nothing is asserted from those lanes.${strandedNote}`;
  }
  if (input.status === 'blocked') {
    return `${joined} ${acceptanceLine} The mission is BLOCKED: every missing required contribution is blocked — ${input.rootRequiredGaps.map(name).join(', ')}. This is a LandOS coverage or input gap, not evidence that the underlying facts do not exist.${strandedNote}`;
  }
  const missing = input.gaps.map(name).join(', ');
  return `${joined} ${acceptanceLine} ${input.requiredGaps.length > 0
    ? `Required contribution(s) are missing — ${input.requiredGaps.map(name).join(', ')}.`
    : 'Every required contribution is present.'} Missing overall: ${missing}. The parent result is incomplete and is reported as such.`;
}
