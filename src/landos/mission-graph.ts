// LandOS native mission graph — gather, fan-out and join.
//
// This is the ORCHESTRATION CONTRACT. It is pure: no database, no clock, no
// I/O. The store persists what this module decides; the runner executes it.
//
// The shape it describes:
//   • ONE parent mission owns a set of specialist CHILD missions.
//   • Children are laid out in dependency WAVES. A wave runs concurrently; the
//     next wave starts only once every child it depends on has SETTLED, in any
//     terminal state, so one failure never strands the rest of the mission.
//   • The parent may not finish until every child has reached a terminal state.
//   • The join names every missing contribution. A failed, blocked, skipped or
//     still-outstanding child is ALWAYS visible in the parent outcome; it is
//     never dropped, and it never reads as success.
//
// Generalized from the Property Intelligence specialist wave engine
// (property-intelligence-specialists.ts), which remains in place and unchanged
// for the existing single-mission workflow.

/** `required` — a missing result is a gap the parent must name.
 *  `supporting` — useful, but its absence alone never blocks the parent. */
export type MissionChildRole = 'required' | 'supporting';

export type MissionChildStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
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
  /** Children whose handbacks this one consumes. */
  dependsOn: string[];
  timeoutMs: number;
}

export interface MissionChildState {
  key: string;
  label: string;
  purpose: string;
  role: MissionChildRole;
  dependsOn: string[];
  status: MissionChildStatus;
  summary: string;
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
  failureCategory: string | null;
  reason: string;
}

export interface MissionJoin {
  status: MissionStatus;
  /** Structured handbacks, keyed by child. Only contributing children appear. */
  contributions: Record<string, unknown>;
  /** Keys that contributed, in definition order. */
  contributed: string[];
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
  /** One explicit, operator-readable sentence covering the whole mission. */
  outcome: string;
}

export const TERMINAL_MISSION_CHILD_STATUSES: readonly MissionChildStatus[] = [
  'completed',
  'partial',
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
 * Validate a mission definition and lay its children out in execution waves.
 *
 * Throws on an unknown dependency or a dependency cycle. Both are definition
 * bugs: a mission that cannot be laid out must never launch and then silently
 * strand children in `queued`.
 */
export function planMissionWaves(specs: MissionChildSpec[]): string[][] {
  if (specs.length === 0) throw new Error('A mission definition must declare at least one child.');

  const byKey = new Map<string, MissionChildSpec>();
  for (const spec of specs) {
    if (byKey.has(spec.key)) throw new Error(`Duplicate mission child key: ${spec.key}`);
    byKey.set(spec.key, spec);
  }
  for (const spec of specs) {
    for (const dep of spec.dependsOn) {
      if (!byKey.has(dep)) {
        throw new Error(`Mission child "${spec.key}" depends on unknown child "${dep}".`);
      }
      if (dep === spec.key) {
        throw new Error(`Mission child "${spec.key}" depends on itself.`);
      }
    }
  }

  const waves: string[][] = [];
  const settled = new Set<string>();
  const pending = new Set<string>(specs.map((spec) => spec.key));

  while (pending.size > 0) {
    const wave = [...pending].filter((key) => byKey.get(key)!.dependsOn.every((dep) => settled.has(dep)));
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
export function initialMissionChildren(specs: MissionChildSpec[]): MissionChildState[] {
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    purpose: spec.purpose,
    role: spec.role,
    dependsOn: [...spec.dependsOn],
    status: 'queued' as const,
    summary: spec.purpose,
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

/** Handbacks from the children this spec depends on, keyed by child. */
export function upstreamContributions(
  spec: MissionChildSpec,
  children: Map<string, MissionChildState>,
): Record<string, unknown> {
  const upstream: Record<string, unknown> = {};
  for (const dep of spec.dependsOn) {
    const child = children.get(dep);
    if (child && contributedMissionResult(child.status)) upstream[dep] = child.result;
  }
  return upstream;
}

function gapReason(child: MissionChildState): string {
  if (!isTerminalMissionChildStatus(child.status)) {
    return child.status === 'running'
      ? 'Still running; it has not reached a terminal state.'
      : 'Still queued; it has not started.';
  }
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
    failureCategory: child.failureCategory,
    reason: gapReason(child),
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
  const byKey = new Map(children.map((child) => [child.key, child]));
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
 * The parent status is decided ONLY by what the children actually produced:
 *   • every child contributed                     → joined
 *   • required all contributed, supporting missing → joined_with_gaps
 *   • a required child failed                     → failed
 *   • every required gap is blocked               → blocked
 *   • otherwise (required skipped/cancelled)      → joined_with_gaps
 *   • any child still non-terminal                → running (never a completion)
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
  const contributed: string[] = [];
  const gaps: MissionGap[] = [];
  const outstanding: MissionGap[] = [];

  for (const child of ordered) {
    if (!isTerminalMissionChildStatus(child.status)) {
      outstanding.push(toGap(child));
      gaps.push(toGap(child));
      continue;
    }
    if (contributedMissionResult(child.status)) {
      contributions[child.key] = child.result;
      contributed.push(child.key);
      continue;
    }
    gaps.push(toGap(child));
  }

  // A declared child with no record at all is a gap too — the mission must not
  // report success over a contribution that was never even created.
  for (const spec of input.specs) {
    if (gathered.has(spec.key)) continue;
    const missing: MissionGap = {
      key: spec.key,
      label: spec.label,
      role: spec.role,
      status: 'queued',
      failureCategory: null,
      reason: 'No child mission record exists for this declared specialist.',
    };
    gaps.push(missing);
    outstanding.push(missing);
  }

  const requiredGaps = gaps.filter((gap) => gap.role === 'required');
  const allTerminal = outstanding.length === 0;
  const allRequiredTerminal = outstanding.every((gap) => gap.role !== 'required');

  // A skipped child is a CONSEQUENCE of an upstream gap, not an independent
  // one. Classifying the parent off the root-cause gaps keeps a blocked
  // identity reading as `blocked` instead of being diluted into a generic
  // "with gaps" by the dependants it stranded.
  const rootRequiredGaps = requiredGaps.filter((gap) => gap.status !== 'skipped');

  let status: MissionStatus;
  if (!allTerminal) {
    status = 'running';
  } else if (gaps.length === 0) {
    status = 'joined';
  } else if (rootRequiredGaps.some((gap) => gap.status === 'failed')) {
    status = 'failed';
  } else if (rootRequiredGaps.length > 0 && rootRequiredGaps.every((gap) => gap.status === 'blocked')) {
    status = 'blocked';
  } else {
    status = 'joined_with_gaps';
  }

  return {
    status,
    contributions,
    contributed,
    gaps,
    requiredGaps,
    outstanding,
    allTerminal,
    allRequiredTerminal,
    outcome: describeMissionOutcome({ status, total: input.specs.length, contributed, gaps, requiredGaps, rootRequiredGaps, outstanding }),
  };
}

function describeMissionOutcome(input: {
  status: MissionStatus;
  total: number;
  contributed: string[];
  gaps: MissionGap[];
  requiredGaps: MissionGap[];
  rootRequiredGaps: MissionGap[];
  outstanding: MissionGap[];
}): string {
  const name = (gap: MissionGap): string => `${gap.label} (${gap.status}${gap.failureCategory ? `: ${gap.failureCategory}` : ''})`;
  const joined = `Joined ${input.contributed.length} of ${input.total} child mission(s).`;

  if (input.status === 'running') {
    return `${joined} The parent cannot complete yet: ${input.outstanding.map(name).join(', ')} ${input.outstanding.length === 1 ? 'has' : 'have'} not reached a terminal state.`;
  }
  if (input.status === 'joined') {
    return `${joined} Every child mission contributed; no contribution is missing.`;
  }
  const stranded = input.gaps.filter((gap) => gap.status === 'skipped');
  const strandedNote = stranded.length > 0
    ? ` ${stranded.map(name).join(', ')} never ran because ${stranded.length === 1 ? 'its' : 'their'} upstream contribution was missing.`
    : '';

  if (input.status === 'failed') {
    return `${joined} The mission did NOT complete: required child mission(s) failed — ${input.rootRequiredGaps.map(name).join(', ')}. Nothing is asserted from those lanes.${strandedNote}`;
  }
  if (input.status === 'blocked') {
    return `${joined} The mission is BLOCKED: every missing required contribution is blocked — ${input.rootRequiredGaps.map(name).join(', ')}. This is a LandOS coverage or input gap, not evidence that the underlying facts do not exist.${strandedNote}`;
  }
  const missing = input.gaps.map(name).join(', ');
  return `${joined} ${input.requiredGaps.length > 0
    ? `Required contribution(s) are missing — ${input.requiredGaps.map(name).join(', ')}.`
    : 'Every required contribution is present.'} Missing overall: ${missing}. The parent result is incomplete and is reported as such.`;
}
