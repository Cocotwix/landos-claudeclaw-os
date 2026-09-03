// LandOS — bounded escalation for government GIS retrieval (PART 8).
//
// THE RABBIT-HOLE BREAKER. LandOS must never spend unlimited effort trying to
// operate one county's interactive map. Jurisdiction research covers the whole
// country; a single stubborn viewer cannot be allowed to consume a lane, and it
// certainly cannot be allowed to block every other property.
//
// The ladder below is explicit, budgeted and testable. Each stage has a request
// cap, the run has a total cap and a wall-clock cap, and interactive browser
// work has the tightest cap of all — because it is the slowest, the least
// reliable, and the easiest thing to keep almost-succeeding at forever.
//
// When the interactive route runs out of budget the answer is not "keep
// trying". It is INTERACTIVE_GIS_ROUTE_DEFERRED plus a move to another official
// evidence path.

import type { GisFailureState } from './gis-platform-types.js';

/** Retrieval routes in strict preference order: cheapest and most reliable first. */
export const GIS_ESCALATION_STAGES = [
  /** Stage 1 — classify the platform from the URL and whatever the page showed. */
  'platform_fingerprint',
  /** Stage 2 — find structured services behind the page. */
  'structured_service_discovery',
  /** Stage 3 — run the family adapter that already works. */
  'known_adapter',
  /** Stage 4 — generic structured inspection for an unrecognised platform. */
  'generic_structured_inspection',
  /** Stage 5 — limited background browser interaction. Tightly capped. */
  'limited_browser_interaction',
  /** Stage 6 — give up on this source and use a different official one. */
  'alternate_official_source',
] as const;
export type GisEscalationStage = (typeof GIS_ESCALATION_STAGES)[number];

export interface EscalationBudget {
  /** Hard ceiling on network requests for the whole subject. */
  maxTotalRequests: number;
  /** Per-stage ceiling, so one stage cannot eat the whole budget. */
  maxRequestsPerStage: number;
  /** Wall-clock ceiling for the whole subject. */
  maxWallClockMs: number;
  /**
   * Ceiling on interactive browser steps. Deliberately small: this is the
   * budget whose exhaustion means "stop fighting the map", not "try harder".
   */
  maxBrowserInteractions: number;
  /** How many different official sources may be attempted before stopping. */
  maxAlternateSources: number;
}

/**
 * Defaults chosen so a healthy structured retrieval finishes in a handful of
 * requests and a hostile one is abandoned in well under two minutes.
 */
export const DEFAULT_ESCALATION_BUDGET: EscalationBudget = {
  // Sized against real county servers: enumerating a services root with ~10
  // folders and describing the handful of relevant services costs roughly 30
  // requests, so discovery must be able to finish without starving the search
  // and zoning stages that follow it.
  maxTotalRequests: 80,
  maxRequestsPerStage: 40,
  maxWallClockMs: 90_000,
  maxBrowserInteractions: 6,
  maxAlternateSources: 3,
};

export type StageOutcome = 'succeeded' | 'no_result' | 'failed' | 'budget_exhausted' | 'skipped';

export interface StageRecord {
  stage: GisEscalationStage;
  outcome: StageOutcome;
  requests: number;
  elapsedMs: number;
  /** Plain statement of what happened. Never a stack trace, never raw output. */
  note: string;
}

export type StopReason =
  | 'completed'
  | 'total_request_budget'
  | 'wall_clock_budget'
  | 'browser_interaction_budget'
  | 'alternate_source_budget';

export interface EscalationReport {
  stages: StageRecord[];
  totalRequests: number;
  browserInteractions: number;
  alternateSourcesTried: number;
  elapsedMs: number;
  stopReason: StopReason;
  /** Set when the interactive route was abandoned rather than completed. */
  deferredInteractiveRoute: boolean;
  failureStates: GisFailureState[];
}

export interface EscalationLadderDeps {
  budget?: Partial<EscalationBudget>;
  /** Injected in tests so elapsed-time behaviour is deterministic. */
  now?: () => number;
}

/**
 * A single subject's escalation state. Create one per property, pass it to
 * every adapter, and let it say when to stop.
 */
export class EscalationLadder {
  private readonly budget: EscalationBudget;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly stages: StageRecord[] = [];
  private totalRequests = 0;
  private browserInteractions = 0;
  private alternateSourcesTried = 0;
  private stopReason: StopReason = 'completed';
  private deferredInteractive = false;

  private currentStage: GisEscalationStage | null = null;
  private reservedWallClockMs = 0;
  private currentStageRequests = 0;
  private currentStageStartedAt = 0;

  constructor(deps: EscalationLadderDeps = {}) {
    this.budget = { ...DEFAULT_ESCALATION_BUDGET, ...(deps.budget ?? {}) };
    this.now = deps.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  get elapsedMs(): number { return this.now() - this.startedAt; }

  /** The run's wall-clock ceiling, so a caller can split it between stages. */
  get wallClockBudgetMs(): number { return this.budget.maxWallClockMs; }

  /**
   * Wall-clock time held back for work that MUST still run after the current
   * optional stage. Discovery is the reason this exists: finding a source is
   * worthless if it leaves no time to query it, so the search stage runs
   * against a lowered ceiling and the reserve belongs to the query cascade.
   */
  reserveWallClockMs(ms: number): void { this.reservedWallClockMs = Math.max(0, ms); }
  releaseWallClockReserve(): void { this.reservedWallClockMs = 0; }
  /** Milliseconds the ladder still allows under the current reserve. */
  remainingWallClockMs(): number {
    return Math.max(0, this.budget.maxWallClockMs - this.reservedWallClockMs - this.elapsedMs);
  }

  /** True when the run has hit a hard ceiling and must stop entirely. */
  exhausted(): boolean {
    if (this.totalRequests >= this.budget.maxTotalRequests) { this.stopReason = 'total_request_budget'; return true; }
    if (this.elapsedMs >= this.budget.maxWallClockMs - this.reservedWallClockMs) {
      // Only a genuinely spent clock is a stop reason. Hitting the reserved
      // ceiling stops the optional stage, not the run.
      if (this.reservedWallClockMs === 0) this.stopReason = 'wall_clock_budget';
      return true;
    }
    return false;
  }

  /** True when THIS stage has spent its share and should hand off to the next. */
  stageExhausted(): boolean {
    return this.currentStageRequests >= this.budget.maxRequestsPerStage || this.exhausted();
  }

  beginStage(stage: GisEscalationStage): void {
    this.currentStage = stage;
    this.currentStageRequests = 0;
    this.currentStageStartedAt = this.now();
  }

  /** Record one network request. Call this from the transport, not by hand. */
  noteRequest(): void {
    this.totalRequests += 1;
    this.currentStageRequests += 1;
  }

  /**
   * Ask permission before an interactive browser step. Returning false is the
   * rabbit-hole breaker firing: the caller must stop interacting and fall back.
   */
  allowBrowserInteraction(): boolean {
    if (this.exhausted()) return false;
    if (this.browserInteractions >= this.budget.maxBrowserInteractions) {
      this.deferredInteractive = true;
      this.stopReason = 'browser_interaction_budget';
      return false;
    }
    this.browserInteractions += 1;
    return true;
  }

  /** Ask permission before trying a different official source. */
  allowAlternateSource(): boolean {
    if (this.exhausted()) return false;
    if (this.alternateSourcesTried >= this.budget.maxAlternateSources) {
      this.stopReason = 'alternate_source_budget';
      return false;
    }
    this.alternateSourcesTried += 1;
    return true;
  }

  /** Mark the interactive route abandoned even when budget remains, e.g. a
   *  viewer that answers but yields nothing usable. */
  deferInteractiveRoute(note: string): void {
    this.deferredInteractive = true;
    this.endStage('limited_browser_interaction', 'budget_exhausted', note);
  }

  endStage(stage: GisEscalationStage, outcome: StageOutcome, note: string): void {
    this.stages.push({
      stage,
      outcome,
      requests: this.currentStage === stage ? this.currentStageRequests : 0,
      elapsedMs: this.currentStage === stage ? this.now() - this.currentStageStartedAt : 0,
      note,
    });
    if (this.currentStage === stage) { this.currentStage = null; this.currentStageRequests = 0; }
  }

  report(): EscalationReport {
    const failureStates: GisFailureState[] = [];
    if (this.deferredInteractive) failureStates.push('INTERACTIVE_GIS_ROUTE_DEFERRED');
    return {
      stages: [...this.stages],
      totalRequests: this.totalRequests,
      browserInteractions: this.browserInteractions,
      alternateSourcesTried: this.alternateSourcesTried,
      elapsedMs: this.elapsedMs,
      stopReason: this.stopReason,
      deferredInteractiveRoute: this.deferredInteractive,
      failureStates,
    };
  }
}

/** Operator-readable one-liner for why a run stopped where it did. */
export function describeStopReason(report: EscalationReport): string {
  switch (report.stopReason) {
    case 'completed':
      return `Completed in ${report.stages.length} stage(s) using ${report.totalRequests} request(s).`;
    case 'total_request_budget':
      return `Stopped after the ${report.totalRequests}-request ceiling for one subject was reached.`;
    case 'wall_clock_budget':
      return `Stopped after ${Math.round(report.elapsedMs / 1000)}s, the time ceiling for one subject.`;
    case 'browser_interaction_budget':
      return `Stopped interacting with the map after ${report.browserInteractions} step(s) and moved to another official source.`;
    case 'alternate_source_budget':
      return `Stopped after trying ${report.alternateSourcesTried} official sources without a usable result.`;
  }
}
