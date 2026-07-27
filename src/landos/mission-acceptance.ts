// Mission acceptance — did a child mission deliver the result its mission requires?
//
// A child must NOT pass merely because its executor returned without throwing.
// The executor reports what it believes happened; this module decides whether
// what it actually handed back satisfies the child's declared contract. The
// runner settles the child on THIS verdict, never on process exit alone.
//
// The five outcomes are kept deliberately distinct, because collapsing any two
// of them hides a different kind of problem from the operator:
//
//   accepted   — the handback satisfies every required and expected term.
//   incomplete — required terms met, an expected term is missing. It contributes,
//                but the parent may never present it as a full result.
//   blocked    — a PRECISE external gap stated by the lane itself. The lane did
//                not fail; there was nothing available to deliver. Never a
//                substitute for a failure, and never diluted into one.
//   rejected   — the child ran to completion and handed back something that does
//                NOT meet its requirement, including a missing or unusable
//                handback. This is the case process exit alone cannot catch.
//   failed     — execution itself broke (a throw, a timeout).
//
// A child whose definition declares NO contract is reported `not_evaluated`, and
// settles on what its executor reported. That is the honest reading: nothing was
// declared, so nothing was verified. It is never presented as `accepted`.
//
// Pure: no database, no clock, no I/O. Every check is a deterministic function of
// the handback and the mission scope.

export type MissionAcceptanceState =
  | 'accepted'
  | 'incomplete'
  | 'blocked'
  | 'rejected'
  | 'failed'
  | 'not_evaluated';

/** `required` — failing it REJECTS the result.
 *  `expected` — failing it makes the result INCOMPLETE, not unacceptable. */
export type MissionAcceptanceSeverity = 'required' | 'expected';

export interface MissionAcceptanceCheck {
  id: string;
  /** What the mission requires, in the operator's words. */
  requirement: string;
  severity: MissionAcceptanceSeverity;
  passed: boolean;
  /** What was actually found. Stated even when the check passed. */
  detail: string;
}

export interface MissionAcceptanceVerdict {
  state: MissionAcceptanceState;
  /** One operator-readable sentence. Never "ok" — it always says why. */
  reason: string;
  checks: MissionAcceptanceCheck[];
}

export interface MissionAcceptanceContext {
  scope: string;
  scopeId: number;
  childKey: string;
  childLabel: string;
}

export interface MissionAcceptanceCheckSpec {
  id: string;
  requirement: string;
  severity: MissionAcceptanceSeverity;
  /** Pure. Must not throw; a thrown check is treated as a failed required check. */
  evaluate(handback: unknown, ctx: MissionAcceptanceContext): { passed: boolean; detail: string };
}

export interface MissionAcceptanceContract {
  /** Dot paths that must be present and non-empty. Absent → rejected. */
  requiredFields?: string[];
  /** Dot paths whose absence makes the result incomplete rather than rejected. */
  expectedFields?: string[];
  /** Domain checks beyond field presence. */
  checks?: MissionAcceptanceCheckSpec[];
}

/** What the child actually delivered, as observed by the runner. */
export type MissionDelivery =
  | { kind: 'returned'; reported: 'completed' | 'partial' | 'blocked'; summary: string; result: unknown }
  | { kind: 'threw'; summary: string };

// ── Handback field presence ─────────────────────────────────────────────────

/** Read a dot path. Returns undefined for any missing or non-traversable step. */
export function readHandbackPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Present = carries a real value.
 *
 * An empty string is NOT present: a blank field is a missing fact wearing the
 * shape of an answer. An empty ARRAY is present — a lane that genuinely found
 * zero rows delivered a real result, and calling that missing would reject an
 * honest empty answer.
 */
export function isHandbackValuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/** A handback the parent can actually join: a non-null, non-array object. */
export function isUsableHandback(result: unknown): boolean {
  return typeof result === 'object' && result !== null && !Array.isArray(result);
}

function fieldCheck(
  path: string,
  severity: MissionAcceptanceSeverity,
  handback: unknown,
): MissionAcceptanceCheck {
  const value = readHandbackPath(handback, path);
  const passed = isHandbackValuePresent(value);
  return {
    id: `field:${path}`,
    requirement: `The handback carries "${path}".`,
    severity,
    passed,
    detail: passed
      ? `Present: ${describeValue(value)}.`
      : value === undefined
        ? `Absent: the handback has no "${path}".`
        : `Empty: "${path}" is ${describeValue(value)}, which states no fact.`,
  };
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') return value.trim().length > 0 ? `"${truncate(value, 60)}"` : 'an empty string';
  if (typeof value === 'object') return 'an object';
  return String(value);
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

// ── Reusable cross-cutting checks ───────────────────────────────────────────

/**
 * Scope integrity: a handback that names a scope row must name THIS one.
 *
 * This is the acceptance-level guard against cross-Deal contamination. A lane
 * that returns another Deal Card's data has not delivered a partially useful
 * result — it has delivered the wrong parcel's facts, which is worse than
 * nothing, so it is a REQUIRED check.
 */
export function scopeIntegrityCheck(field = 'dealCardId'): MissionAcceptanceCheckSpec {
  return {
    id: 'scope_integrity',
    requirement: `The handback's "${field}" is the mission's own scope row.`,
    severity: 'required',
    evaluate: (handback, ctx) => {
      const value = readHandbackPath(handback, field);
      if (value === undefined) {
        return { passed: true, detail: `The handback does not name a "${field}", so it cannot claim another scope row.` };
      }
      const passed = Number(value) === ctx.scopeId;
      return {
        passed,
        detail: passed
          ? `Scoped to ${ctx.scope} ${ctx.scopeId}.`
          : `Scope mismatch: the handback names ${ctx.scope} ${String(value)} but this mission is scoped to ${ctx.scopeId}. The result belongs to a different record and is not accepted.`,
      };
    },
  };
}

/** Assert a field equals one of a set of values (e.g. an identity state). */
export function fieldEqualsCheck(input: {
  id: string;
  field: string;
  allowed: readonly (string | number | boolean)[];
  severity: MissionAcceptanceSeverity;
  requirement: string;
}): MissionAcceptanceCheckSpec {
  return {
    id: input.id,
    requirement: input.requirement,
    severity: input.severity,
    evaluate: (handback) => {
      const value = readHandbackPath(handback, input.field);
      const passed = input.allowed.some((candidate) => candidate === value);
      return {
        passed,
        detail: passed
          ? `"${input.field}" is ${describeValue(value)}.`
          : `"${input.field}" is ${describeValue(value)}; the requirement allows ${input.allowed.map((v) => String(v)).join(', ')}.`,
      };
    },
  };
}

/** Assert at least one of several paths carries a value. */
export function anyFieldPresentCheck(input: {
  id: string;
  fields: readonly string[];
  severity: MissionAcceptanceSeverity;
  requirement: string;
}): MissionAcceptanceCheckSpec {
  return {
    id: input.id,
    requirement: input.requirement,
    severity: input.severity,
    evaluate: (handback) => {
      const present = input.fields.filter((path) => isHandbackValuePresent(readHandbackPath(handback, path)));
      return {
        passed: present.length > 0,
        detail: present.length > 0
          ? `Carried by ${present.join(', ')}.`
          : `None of ${input.fields.join(', ')} carries a value.`,
      };
    },
  };
}

// ── The evaluator ───────────────────────────────────────────────────────────

function runCheckSpec(
  spec: MissionAcceptanceCheckSpec,
  handback: unknown,
  ctx: MissionAcceptanceContext,
): MissionAcceptanceCheck {
  try {
    const outcome = spec.evaluate(handback, ctx);
    return { id: spec.id, requirement: spec.requirement, severity: spec.severity, passed: outcome.passed, detail: outcome.detail };
  } catch (error) {
    // A check that throws proves nothing. It must never read as a pass.
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: spec.id,
      requirement: spec.requirement,
      severity: 'required',
      passed: false,
      detail: `The acceptance check itself could not be evaluated (${message}), so this requirement is unproven.`,
    };
  }
}

/**
 * Decide whether a child delivered what its mission requires.
 *
 * Ordering matters and is deliberate:
 *   1. A throw is a FAILURE — never re-read as an unacceptable result.
 *   2. A stated block is a BLOCKER — never re-read as a failure or a rejection.
 *   3. Only then is the handback judged, and a missing or unusable handback is a
 *      REJECTION rather than a quiet pass.
 *   4. An executor that honestly reported `partial` can never be upgraded to
 *      `accepted` by this module.
 */
export function evaluateMissionAcceptance(
  contract: MissionAcceptanceContract | undefined,
  delivery: MissionDelivery,
  ctx: MissionAcceptanceContext,
): MissionAcceptanceVerdict {
  if (delivery.kind === 'threw') {
    return { state: 'failed', reason: delivery.summary, checks: [] };
  }

  if (delivery.reported === 'blocked') {
    return {
      state: 'blocked',
      reason: delivery.summary,
      checks: [],
    };
  }

  if (!contract) {
    return {
      state: 'not_evaluated',
      reason: `No acceptance contract is declared for "${ctx.childKey}", so the result was reported as the lane returned it and nothing about it is verified.`,
      checks: [],
    };
  }

  if (!isUsableHandback(delivery.result)) {
    return {
      state: 'rejected',
      reason:
        delivery.result === undefined || delivery.result === null
          ? `${ctx.childLabel} reported "${delivery.reported}" but handed back no structured result, so there is nothing for the parent to join. The lane did not deliver what its mission requires.`
          : `${ctx.childLabel} reported "${delivery.reported}" but handed back ${describeValue(delivery.result)} instead of a structured result the parent can join.`,
      checks: [],
    };
  }

  const checks: MissionAcceptanceCheck[] = [
    ...(contract.requiredFields ?? []).map((path) => fieldCheck(path, 'required', delivery.result)),
    ...(contract.expectedFields ?? []).map((path) => fieldCheck(path, 'expected', delivery.result)),
    ...(contract.checks ?? []).map((spec) => runCheckSpec(spec, delivery.result, ctx)),
  ];

  const failedRequired = checks.filter((check) => check.severity === 'required' && !check.passed);
  if (failedRequired.length > 0) {
    return {
      state: 'rejected',
      reason:
        `${ctx.childLabel} ran to completion but its result does not meet ${failedRequired.length} required acceptance term(s): ` +
        `${failedRequired.map((check) => `${check.requirement} ${check.detail}`).join(' ')} ` +
        `The result is NOT accepted and nothing is asserted from this lane.`,
      checks,
    };
  }

  const failedExpected = checks.filter((check) => check.severity === 'expected' && !check.passed);
  if (failedExpected.length > 0) {
    return {
      state: 'incomplete',
      reason:
        `${ctx.childLabel} delivered every required term but ${failedExpected.length} expected term(s) are missing: ` +
        `${failedExpected.map((check) => `${check.requirement} ${check.detail}`).join(' ')} ` +
        `The result contributes but is incomplete.`,
      checks,
    };
  }

  if (delivery.reported === 'partial') {
    return {
      state: 'incomplete',
      reason: `${ctx.childLabel} met every declared acceptance term but reported its own result as partial: ${delivery.summary}`,
      checks,
    };
  }

  return {
    state: 'accepted',
    reason: `${ctx.childLabel} delivered every required and expected acceptance term (${checks.length} check(s) passed).`,
    checks,
  };
}

/** True when the verdict is one the parent may join a contribution from. */
export function acceptanceContributes(state: MissionAcceptanceState): boolean {
  return state === 'accepted' || state === 'incomplete';
}

/** Short operator label for the acceptance column. */
export function acceptanceLabel(state: MissionAcceptanceState): string {
  switch (state) {
    case 'accepted': return 'accepted';
    case 'incomplete': return 'incomplete';
    case 'blocked': return 'blocked';
    case 'rejected': return 'rejected';
    case 'failed': return 'failed';
    default: return 'not evaluated';
  }
}
