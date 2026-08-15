// LandOS — RACING THE SOURCES for one land-use question.
//
// This is the retrieval doctrine for post-resolution land-use intelligence,
// and it is the same shape as `resolveSubjectProperty`: launch every method
// that could answer the question CONCURRENTLY, release the moment one of them
// produces evidence that passes the gate, and let the rest keep running and
// corroborate afterwards.
//
// What this fixes, concretely. Before this module the zoning lane ran its
// ArcGIS probe to completion, THEN searched, THEN opened pages, in one serial
// chain. A jurisdiction with no ArcGIS presence paid the probe's full cost
// before discovery even started, and a jurisdiction whose GIS answered in
// 200ms still waited on nothing. Neither is a property of the evidence; both
// were properties of the loop.
//
// Three rules the engine enforces, because getting any of them wrong turns a
// research system into a plausible-sounding one:
//
//   1. FIRST SUFFICIENT WINS — never first to arrive. Every candidate goes
//      through the caller's `gate`, which decides authority, parcel match and
//      currentness. A search snippet that returns in 40ms loses to nothing;
//      it simply is not sufficient, so the race continues without it.
//   2. LOSING LANES ARE NOT CANCELLED. They finish, and what they produce
//      becomes corroboration, or a conflict the caller must resolve. An answer
//      released fast and contradicted later is a conflict, not a silent win.
//   3. RE-AIM IS BOUNDED. A lane that learns something another lane needed
//      (the municipality, the district code, an ordinance URL) may re-aim it —
//      at most once per lane, and at most `maxReAims` times overall. This is
//      progressive enrichment, not a retry loop.
//
// Deliberately narrow. It knows nothing about zoning, subdivision or parcels;
// the domain modules supply the lanes and the gate. It is not an agent
// framework and it does not model a property.

export const LAND_USE_METHODS = [
  /** Already persisted by LandOS. Costs a SELECT, so it always races. */
  'retained_evidence',
  /** Governed keyless DDGS. A DISCOVERY method: it finds sources, never facts. */
  'indexed_web_search',
  /** ArcGIS REST, municipal/county/state GIS, parcel and planning APIs. */
  'direct_gis_api',
  /** Adopted ordinances, zoning maps, use tables, regulation PDFs. */
  'official_document',
  /** Chrome/CDP. Escalation only: started when the cheap methods fall short. */
  'browser_escalation',
] as const;
export type LandUseMethod = (typeof LAND_USE_METHODS)[number];

export const LAND_USE_QUESTIONS = [
  'zoning_authority',
  'subdivision_authority',
  'current_zoning',
  'allowed_uses',
  'dimensional_standards',
  'overlays',
  'subdivision_rules',
] as const;
export type LandUseQuestion = (typeof LAND_USE_QUESTIONS)[number];

/**
 * The temporal state of a piece of evidence. Kept as one vocabulary across
 * every land-use question so a recommendation can never quietly read as an
 * approval, and a 2024 statement can never read as the 2026 rule.
 */
export const CURRENTNESS_STATES = [
  'current',
  'adopted',
  'approved',
  'recommended',
  'requested',
  'proposed',
  'historical',
  'denied',
  'superseded',
  'unknown',
] as const;
export type Currentness = (typeof CURRENTNESS_STATES)[number];

/** States that may speak for what is true TODAY. Everything else is context. */
export const CURRENT_STATES: readonly Currentness[] = ['current', 'adopted', 'approved'];

export function isCurrentState(state: Currentness): boolean {
  return CURRENT_STATES.includes(state);
}

export type EvidenceTier = 'official_government_source' | 'reputable_secondary' | 'search_result';

export interface LandUseEvidence<T> {
  method: LandUseMethod;
  laneId: string;
  /** The domain payload: a district, an authority assignment, a rule set. */
  value: T;
  /** The government this evidence speaks for, when it names one. */
  authorityName: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  sourceTier: EvidenceTier;
  /** How this was tied to THIS parcel or jurisdiction. Never "it was nearby". */
  parcelMatchBasis: string | null;
  currentness: Currentness;
  effectiveOrAsOf: string | null;
  /** The source's own words. Never a paraphrase. */
  quote: string;
  retrievedAt: string;
}

export interface SufficiencyVerdict {
  sufficient: boolean;
  /** Why. Recorded whether it passed or not, so a refusal is auditable. */
  reason: string;
}

export type SufficiencyGate<T> = (evidence: LandUseEvidence<T>) => SufficiencyVerdict;

export interface LaneContext {
  /** Milliseconds since the race started. For a lane's own budgeting. */
  elapsedMs: () => number;
  /** True once another lane has already released a sufficient answer. */
  released: () => boolean;
}

export interface LandUseLane<T, A> {
  id: string;
  method: LandUseMethod;
  label: string;
  /** Returns every candidate it found. [] is a normal, non-failing outcome. */
  run: (aim: A, ctx: LaneContext) => Promise<Array<LandUseEvidence<T>>>;
  /**
   * Escalation lanes do not start with the others. They start only when the
   * ordinary lanes have settled without a sufficient answer, or when
   * `escalateAfterMs` elapses. That is what keeps the browser available
   * without making it mandatory.
   */
  escalation?: boolean;
  /** May be re-run once with an improved aim. */
  reAimable?: boolean;
  /**
   * Settles without I/O — the retained-evidence lane. With
   * `instantFastPath`, these are dispatched one tick ahead of the rest, so a
   * question storage can already answer never spends a network round trip.
   */
  instant?: boolean;
}

export type LaneStatus = 'pending' | 'evidence' | 'no_evidence' | 'error' | 'skipped';

export interface LandUseLaneRecord {
  laneId: string;
  method: LandUseMethod;
  label: string;
  status: LaneStatus;
  startedAtMs: number;
  settledAtMs: number | null;
  durationMs: number | null;
  candidateCount: number;
  sufficientCount: number;
  /** Why each candidate was refused, when none passed. Operator-readable. */
  note: string;
  won: boolean;
  /** True when this lane had NOT settled at the moment the answer released. */
  runningAtRelease: boolean;
  reAimed: boolean;
}

export interface LandUseEnrichment<T> {
  /** Evidence that agrees with the released answer. */
  corroborating: Array<LandUseEvidence<T>>;
  /** Sufficient evidence that DISAGREES. Always a conflict, never discarded. */
  contradicting: Array<LandUseEvidence<T>>;
  /** Everything that landed after release, agreeing or not. */
  lateEvidence: Array<LandUseEvidence<T>>;
  conflicts: string[];
  lanes: LandUseLaneRecord[];
  settledAtMs: number;
}

export interface LandUseRaceResult<T> {
  question: LandUseQuestion;
  released: boolean;
  winner: LandUseEvidence<T> | null;
  winningMethod: LandUseMethod | null;
  winningLaneId: string | null;
  /** Milliseconds from race start to the sufficient answer. */
  releasedAtMs: number | null;
  /** Milliseconds the caller actually waited. */
  elapsedMs: number;
  lanes: LandUseLaneRecord[];
  /** Lanes still running when the answer released. The point of the race. */
  pendingAtRelease: string[];
  /** Every candidate any lane had produced by release time. */
  evidence: Array<LandUseEvidence<T>>;
  conflicts: string[];
  notes: string[];
  /**
   * Settles when every lane has finished. Never awaited on the release path.
   * The caller may await it to reconcile, or ignore it entirely.
   */
  enrichment: Promise<LandUseEnrichment<T>>;
}

export interface RaceLandUseSourcesOptions<T, A> {
  question: LandUseQuestion;
  aim: A;
  lanes: Array<LandUseLane<T, A>>;
  gate: SufficiencyGate<T>;
  /**
   * Improve the aim from what a lane just learned. Return null when nothing
   * new was learned — that is what stops the re-aim from looping.
   */
  reAim?: (aim: A, settled: Array<LandUseEvidence<T>>, all: Array<LandUseEvidence<T>>) => A | null;
  maxReAims?: number;
  /** Bounds the WAIT, never the lanes. They keep running past it. */
  deadlineMs?: number;
  /** Start escalation lanes this early even if the others have not settled. */
  escalateAfterMs?: number;
  /**
   * Give `instant` lanes one tick before the network lanes start.
   *
   * Racing everything is right when the answer is genuinely uncertain. It is
   * waste when LandOS already holds the answer: four search round trips to
   * re-learn what a SELECT returned in the same tick is the operator's time
   * spent for nothing. One tick costs about a millisecond and buys the
   * difference.
   */
  instantFastPath?: boolean;
  /** Do two candidates say the same thing? Used to sort corroboration. */
  sameAnswer?: (a: T, b: T) => boolean;
  clockMs?: () => number;
  onLaneSettled?: (record: LandUseLaneRecord) => void;
}

/** A stable identity for an aim, so "did the aim move?" is answerable. */
const stableKey = (value: unknown): string => {
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
};

const defaultSameAnswer = <T,>(a: T, b: T): boolean => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
};

/**
 * Race every method that could answer this question.
 *
 * Never throws and never rejects: a lane that fails is a recorded outcome, and
 * a question no lane could answer returns `released: false` with every refusal
 * reason attached — which is a usable answer, and the only honest one.
 */
export async function raceLandUseSources<T, A>(
  options: RaceLandUseSourcesOptions<T, A>,
): Promise<LandUseRaceResult<T>> {
  const clockMs = options.clockMs ?? (() => Date.now());
  const sameAnswer = options.sameAnswer ?? defaultSameAnswer;
  const gate = options.gate;
  const maxReAims = Math.max(0, options.maxReAims ?? 2);
  const startedMs = clockMs();

  const records = new Map<string, LandUseLaneRecord>();
  const allEvidence: Array<LandUseEvidence<T>> = [];
  const notes: string[] = [];
  const conflicts: string[] = [];

  // A holder rather than two `let`s: the winner is assigned inside async lane
  // closures, and control-flow narrowing on a bare `let` collapses it to
  // `never` at every read site outside them.
  const state: { winner: LandUseEvidence<T> | null; releasedAtMs: number | null } = { winner: null, releasedAtMs: null };
  let currentAim = options.aim;

  const ordinary = options.lanes.filter((lane) => !lane.escalation);
  const escalation = options.lanes.filter((lane) => lane.escalation);
  if (!ordinary.length && !escalation.length) {
    return {
      question: options.question,
      released: false,
      winner: null,
      winningMethod: null,
      winningLaneId: null,
      releasedAtMs: null,
      elapsedMs: 0,
      lanes: [],
      pendingAtRelease: [],
      evidence: [],
      conflicts: [],
      notes: ['No retrieval lane was wired for this question, so nothing was attempted.'],
      enrichment: Promise.resolve({
        corroborating: [], contradicting: [], lateEvidence: [], conflicts: [], lanes: [], settledAtMs: 0,
      }),
    };
  }

  // ── The race ──────────────────────────────────────────────────────────────
  let settleWait: ((reason: 'won' | 'exhausted' | 'deadline') => void) | null = null;
  const waited = new Promise<'won' | 'exhausted' | 'deadline'>((resolve) => { settleWait = resolve; });
  let settleAll: (() => void) | null = null;
  const allSettled = new Promise<void>((resolve) => { settleAll = resolve; });

  let outstanding = 0;
  let escalationStarted = false;
  /** True while the instant lanes hold the floor. Nothing may finish yet. */
  let fastPathPending = false;
  const reAimed = new Set<string>();
  /** What each lane was aimed WITH, so a later settle can see the aim moved. */
  const lastAim = new Map<string, string>();
  let reAimsUsed = 0;

  const context: LaneContext = {
    elapsedMs: () => clockMs() - startedMs,
    released: () => state.winner != null,
  };

  const finishIfDone = (): void => {
    if (outstanding > 0 || fastPathPending) return;
    if (!escalationStarted && !state.winner && escalation.length) {
      // The cheap methods are exhausted and nothing was sufficient. THIS is
      // when the browser earns its cost, and not a moment before.
      startEscalation('the ordinary retrieval lanes settled without a sufficient answer');
      return;
    }
    settleWait?.('exhausted');
    settleAll?.();
  };

  const dispatch = (lane: LandUseLane<T, A>, aim: A, isReAim: boolean): void => {
    outstanding += 1;
    lastAim.set(lane.id, stableKey(aim));
    const startedAtMs = clockMs() - startedMs;
    records.set(lane.id, {
      laneId: lane.id,
      method: lane.method,
      label: lane.label,
      status: 'pending',
      startedAtMs,
      settledAtMs: null,
      durationMs: null,
      candidateCount: 0,
      sufficientCount: 0,
      note: isReAim ? 'Re-aimed with what another lane established.' : 'Running.',
      won: false,
      runningAtRelease: false,
      reAimed: isReAim,
    });

    void (async () => {
      let found: Array<LandUseEvidence<T>> = [];
      let failure: string | null = null;
      try {
        // The LANE knows how it retrieved; a reader shared by four lanes does
        // not. Stamping here is what stops a retained-evidence win from being
        // reported as a document fetch.
        found = ((await lane.run(aim, context)) ?? []).map((candidate) => ({
          ...candidate,
          method: lane.method,
          laneId: lane.id,
        }));
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      const settledAtMs = clockMs() - startedMs;
      const record = records.get(lane.id)!;
      record.settledAtMs = settledAtMs;
      record.durationMs = settledAtMs - record.startedAtMs;
      record.candidateCount = found.length;

      if (failure != null) {
        record.status = 'error';
        record.note = `Lane failed: ${failure}`;
      } else if (!found.length) {
        record.status = 'no_evidence';
        record.note = 'Ran and found no candidate for this question.';
      } else {
        record.status = 'evidence';
      }

      // Evidence is retained whether or not it is sufficient, and whether or
      // not the race is already won. Corroboration depends on it.
      const refusals: string[] = [];
      let firstSufficient: LandUseEvidence<T> | null = null;
      for (const candidate of found) {
        allEvidence.push(candidate);
        const verdict = gate(candidate);
        if (verdict.sufficient) {
          record.sufficientCount += 1;
          firstSufficient = firstSufficient ?? candidate;
        } else {
          refusals.push(`${candidate.sourceLabel || candidate.sourceUrl || 'candidate'}: ${verdict.reason}`);
        }
      }
      if (found.length && !record.sufficientCount) {
        record.note = `Found ${found.length} candidate(s), none sufficient. ${refusals.slice(0, 3).join(' | ')}`;
      } else if (record.sufficientCount) {
        record.note = `Found ${found.length} candidate(s); ${record.sufficientCount} passed the sufficiency gate.`;
      }

      options.onLaneSettled?.({ ...record });

      if (!state.winner && firstSufficient) {
        state.winner = firstSufficient;
        state.releasedAtMs = settledAtMs;
        record.won = true;
        for (const [id, row] of records) {
          if (id !== lane.id && row.status === 'pending') row.runningAtRelease = true;
        }
        outstanding -= 1;
        settleWait?.('won');
        if (outstanding <= 0) finishIfDone();
        return;
      }

      // ── Bounded progressive enrichment ────────────────────────────────────
      //
      // Two steps, deliberately separate. First: did THIS settle teach the race
      // anything? Second: is any already-settled lane now holding a staler aim
      // than the race has? The second matters on its own, because the lane that
      // learns the district is usually the one that finishes FIRST, while the
      // lane that needed it is still running — and checking only at the moment
      // of learning would never re-aim it.
      if (!state.winner && options.reAim) {
        const improved = options.reAim(currentAim, found, [...allEvidence]);
        if (improved != null) currentAim = improved;
      }
      if (!state.winner) tryReAim(lane.label);

      outstanding -= 1;
      finishIfDone();
    })();
  };

  /** Aim a settled, unsuccessful, re-aimable lane again — once, and bounded. */
  const tryReAim = (learnedFrom: string): void => {
    if (!options.reAim) return;
    const aimKey = stableKey(currentAim);
    for (const target of options.lanes) {
      if (reAimsUsed >= maxReAims) break;
      if (!target.reAimable || reAimed.has(target.id)) continue;
      const targetRecord = records.get(target.id);
      // Only a lane that has ALREADY answered, and answered with nothing
      // sufficient, is worth aiming again.
      if (!targetRecord || targetRecord.status === 'pending' || targetRecord.sufficientCount > 0) continue;
      if ((lastAim.get(target.id) ?? '') === aimKey) continue;
      reAimed.add(target.id);
      reAimsUsed += 1;
      notes.push(`The ${target.label} lane was re-aimed once with what the ${learnedFrom} lane established.`);
      dispatch(target, currentAim, true);
    }
  };

  const startEscalation = (why: string): void => {
    if (escalationStarted || !escalation.length) return;
    escalationStarted = true;
    notes.push(`Browser escalation started because ${why}.`);
    for (const lane of escalation) dispatch(lane, currentAim, false);
  };

  const instant = ordinary.filter((lane) => lane.instant);
  const networked = ordinary.filter((lane) => !lane.instant);
  if (options.instantFastPath && instant.length) {
    fastPathPending = true;
    // Pre-register the network lanes as skipped. If an instant lane wins, the
    // caller's snapshot is taken on that same tick — before the timer below
    // could have marked them — and a lane that never ran must not read as
    // "still pending" in the timing report.
    for (const lane of networked) {
      records.set(lane.id, {
        laneId: lane.id, method: lane.method, label: lane.label, status: 'skipped',
        startedAtMs: 0, settledAtMs: 0, durationMs: 0,
        candidateCount: 0, sufficientCount: 0,
        note: 'Not started: retained evidence answered this question sufficiently in the same tick, so no network round trip was spent.',
        won: false, runningAtRelease: false, reAimed: false,
      });
    }
    if (networked.length) {
      notes.push(`${networked.length} network lane(s) are held behind the retained-evidence fast path and start only if storage cannot answer.`);
    }
    for (const lane of instant) dispatch(lane, currentAim, false);
    // One macrotask: enough for the synchronous lanes to settle, and short
    // enough that a miss costs nothing measurable.
    setTimeout(() => {
      fastPathPending = false;
      if (state.winner) { finishIfDone(); return; }
      // Storage could not answer. Everything else starts now.
      notes.push('Retained evidence did not answer sufficiently, so the network lanes were started.');
      for (const lane of networked) dispatch(lane, currentAim, false);
      if (!networked.length) finishIfDone();
    }, 0).unref?.();
  } else {
    for (const lane of ordinary) dispatch(lane, currentAim, false);
  }
  if (!ordinary.length) startEscalation('no non-browser lane was wired for this question');

  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  if (options.deadlineMs && options.deadlineMs > 0) {
    deadlineTimer = setTimeout(() => settleWait?.('deadline'), options.deadlineMs);
    deadlineTimer.unref?.();
  }
  let escalationTimer: ReturnType<typeof setTimeout> | null = null;
  if (options.escalateAfterMs && options.escalateAfterMs > 0 && escalation.length) {
    escalationTimer = setTimeout(() => {
      if (!state.winner) startEscalation(`${Math.round((options.escalateAfterMs ?? 0) / 1000)}s elapsed without a sufficient answer`);
    }, options.escalateAfterMs);
    escalationTimer.unref?.();
  }

  const reason = await waited;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (escalationTimer) clearTimeout(escalationTimer);
  if (reason === 'deadline') {
    notes.push(`The ${Math.round((options.deadlineMs ?? 0) / 1000)}s wait elapsed before any lane produced sufficient evidence; the lanes continue independently.`);
  }

  const pendingAtRelease = [...records.values()]
    .filter((row) => (state.winner ? row.runningAtRelease : row.status === 'pending'))
    .map((row) => row.laneId);
  const evidenceAtRelease = [...allEvidence];

  // Two sufficient candidates that disagree, already visible at release.
  const released = state.winner;
  if (released) {
    for (const candidate of evidenceAtRelease) {
      if (candidate === released) continue;
      if (!gate(candidate).sufficient) continue;
      if (sameAnswer(candidate.value, released.value)) continue;
      conflicts.push(
        `Conflicting sufficient evidence for ${options.question.replace(/_/g, ' ')}: `
        + `${released.sourceLabel || released.sourceUrl} (${released.method}) disagrees with ${candidate.sourceLabel || candidate.sourceUrl} (${candidate.method}).`,
      );
    }
  }

  const enrichment = allSettled.then((): LandUseEnrichment<T> => {
    const settledAtMs = clockMs() - startedMs;
    const late = allEvidence.filter((row) => !evidenceAtRelease.includes(row));
    const corroborating: Array<LandUseEvidence<T>> = [];
    const contradicting: Array<LandUseEvidence<T>> = [];
    const lateConflicts: string[] = [];
    if (released) {
      for (const candidate of late) {
        if (sameAnswer(candidate.value, released.value)) { corroborating.push(candidate); continue; }
        if (!gate(candidate).sufficient) continue;
        contradicting.push(candidate);
        lateConflicts.push(
          `A slower lane produced sufficient evidence that disagrees with the released answer: `
          + `${candidate.sourceLabel || candidate.sourceUrl} (${candidate.method}) vs ${released.sourceLabel || released.sourceUrl} (${released.method}).`,
        );
      }
    }
    return {
      corroborating,
      contradicting,
      lateEvidence: late,
      conflicts: lateConflicts,
      lanes: [...records.values()].map((row) => ({ ...row })),
      settledAtMs,
    };
  });
  // The caller may ignore enrichment entirely; an unhandled rejection here
  // must never surface as a process-level error.
  enrichment.catch(() => undefined);

  return {
    question: options.question,
    released: released != null,
    winner: released,
    winningMethod: released?.method ?? null,
    winningLaneId: released?.laneId ?? null,
    releasedAtMs: state.releasedAtMs,
    elapsedMs: clockMs() - startedMs,
    lanes: [...records.values()].map((row) => ({ ...row })),
    pendingAtRelease,
    evidence: evidenceAtRelease,
    conflicts: [...new Set(conflicts)],
    notes,
    enrichment,
  };
}

// ── Reusable gate pieces ────────────────────────────────────────────────────

/**
 * The gate most land-use questions want.
 *
 * Three refusals, and each one is a mistake LandOS has actually made:
 *   • not an official government source — a search snippet is a pointer;
 *   • not tied to this parcel or jurisdiction — the district next door;
 *   • not current — a 2024 packet describing 2024.
 */
export function officialCurrentParcelGate<T>(options: {
  /** Set false for jurisdiction-wide answers (a rule set, an ordinance). */
  requireParcelMatch?: boolean;
  requireCurrent?: boolean;
  /** Extra domain check. Runs last, and only if the rest passed. */
  also?: (evidence: LandUseEvidence<T>) => SufficiencyVerdict | null;
} = {}): SufficiencyGate<T> {
  const requireParcelMatch = options.requireParcelMatch !== false;
  const requireCurrent = options.requireCurrent !== false;
  return (evidence) => {
    if (evidence.sourceTier !== 'official_government_source') {
      return {
        sufficient: false,
        reason: `the source is ${evidence.sourceTier.replace(/_/g, ' ')}, and a land-use determination may only rest on an official government source`,
      };
    }
    if (requireParcelMatch && !evidence.parcelMatchBasis) {
      return { sufficient: false, reason: 'it states no basis for applying to this parcel' };
    }
    if (requireCurrent && !isCurrentState(evidence.currentness)) {
      return {
        sufficient: false,
        reason: `it is ${evidence.currentness}, which describes a point in time rather than what controls today`,
      };
    }
    return options.also?.(evidence) ?? { sufficient: true, reason: 'official, parcel-matched and current' };
  };
}

/** One line per lane, for the operator-facing timing report. */
export function describeRace<T>(result: LandUseRaceResult<T>): string[] {
  const lines = result.lanes
    .sort((a, b) => (a.settledAtMs ?? Number.MAX_SAFE_INTEGER) - (b.settledAtMs ?? Number.MAX_SAFE_INTEGER))
    .map((lane) => {
      const timing = lane.settledAtMs == null
        ? 'still running at release'
        : `${lane.settledAtMs}ms`;
      return `${lane.won ? '→ WON  ' : '       '}${lane.label} [${lane.method}] ${timing}: ${lane.note}`;
    });
  lines.unshift(result.released
    ? `${result.question}: released at ${result.releasedAtMs}ms via ${result.winningMethod} (${result.winningLaneId}); ${result.pendingAtRelease.length} lane(s) still running.`
    : `${result.question}: NOT released after ${result.elapsedMs}ms; no lane produced sufficient evidence.`);
  return lines;
}
