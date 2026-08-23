// LandOS — how much utility research a property actually deserves, and which
// step to take next.
//
// WHY THIS EXISTS. The full chain in the utility doctrine — provider, service
// territory, subject-corridor GIS, provider engineering maps, neighborhood
// service pattern, adjacent-development tracing, same-road commercial,
// historical site records, adaptive web discovery, written confirmation — is
// the right chain for a parcel whose whole thesis is a subdivision. Run
// mechanically on a five-acre residential lot it is an afternoon spent proving
// something the operator already assumed and does not underwrite.
//
// Two rules, then:
//
//   DEPTH BOUNDS THE CHAIN. A STANDARD property gets provider, territory, the
//   subject corridor, and one fallback. Infrastructure archaeology is not
//   authorized for it. A DEEP_DEVELOPMENT property may use the whole chain.
//
//   THE PLAN IS ADAPTIVE, NOT A SEQUENCE. Steps are skipped the moment they
//   have nothing left to add — the next step is chosen from what is still
//   unestablished, cheapest and highest-signal first, and the plan ends as soon
//   as only the provider can answer what remains. More searching cannot produce
//   a will-serve letter, and pretending otherwise is how a lane burns budget
//   and still reports unresolved.
//
// Pure. No I/O, no clock, no model, no browser.

import type { DevelopmentResearchDepth } from './development-intelligence.js';
import type {
  UtilityAvailabilityResolution,
  UtilityKind,
} from './utility-availability-resolution.js';
import { corridorInfrastructureShown } from './utility-availability-resolution.js';

export type { DevelopmentResearchDepth };

/** The steps of the system-wide utility research chain, in doctrine order. */
export type UtilityResearchStep =
  | 'provider'
  | 'service_territory'
  | 'subject_corridor_gis'
  | 'provider_engineering_map'
  | 'neighborhood_service_pattern'
  | 'adjacent_development_trace'
  | 'same_road_commercial'
  | 'historical_site_records'
  | 'adaptive_web_discovery'
  | 'written_provider_confirmation';

export const UTILITY_RESEARCH_STEP_LABEL: Readonly<Record<UtilityResearchStep, string>> = {
  provider: 'Identify the serving provider',
  service_territory: 'Establish the service territory relationship',
  subject_corridor_gis: 'Read the subject and subject-road utility layers on official GIS',
  provider_engineering_map: 'Read the provider utility atlas or engineering map',
  neighborhood_service_pattern: 'Establish the immediate neighborhood service pattern',
  adjacent_development_trace: 'Trace what adjoining development had to build for service',
  same_road_commercial: 'Establish how same-corridor commercial or institutional use is served',
  historical_site_records: 'Read the utility content of prior development records for this site',
  adaptive_web_discovery: 'Adaptive source discovery for a stronger utility map or record',
  written_provider_confirmation: 'Request a written availability determination from the provider',
};

/**
 * What a STANDARD property may spend on utilities.
 *
 * Deliberately short. `subject_corridor_gis` is the one real infrastructure
 * step, and exactly one fallback follows it. The neighborhood pattern is the
 * chosen fallback because it is the cheapest read that materially changes the
 * answer; development archaeology is not on this list at all.
 */
const STANDARD_STEPS: readonly UtilityResearchStep[] = [
  'provider',
  'service_territory',
  'subject_corridor_gis',
  'neighborhood_service_pattern',
  'written_provider_confirmation',
];

const DEEP_STEPS: readonly UtilityResearchStep[] = [
  'provider',
  'service_territory',
  'subject_corridor_gis',
  'provider_engineering_map',
  'neighborhood_service_pattern',
  'adjacent_development_trace',
  'same_road_commercial',
  'historical_site_records',
  'adaptive_web_discovery',
  'written_provider_confirmation',
];

export function authorizedUtilitySteps(depth: DevelopmentResearchDepth): readonly UtilityResearchStep[] {
  return depth === 'DEEP_DEVELOPMENT' ? DEEP_STEPS : STANDARD_STEPS;
}

export function stepAuthorized(depth: DevelopmentResearchDepth, step: UtilityResearchStep): boolean {
  return authorizedUtilitySteps(depth).includes(step);
}

/** What the research has established so far, as the planner needs to see it. */
export interface UtilityResearchProgress {
  providerIdentified: boolean;
  territoryEstablished: boolean;
  /** A subject/subject-road utility layer was actually read, either way. */
  corridorRead: boolean;
  /** Pipe was drawn on the subject corridor. */
  corridorInfrastructureShown: boolean;
  providerEngineeringMapRead: boolean;
  neighborhoodPatternEstablished: boolean;
  adjacentDevelopmentTraced: boolean;
  sameRoadCommercialRead: boolean;
  historicalRecordsRead: boolean;
  adaptiveDiscoveryRun: boolean;
  /** The provider has actually issued a determination. Ends the chain. */
  providerDeterminationHeld: boolean;
  /** A real external wall. Ends the chain with a blocker, not a next step. */
  blocked: boolean;
}

/** Read progress straight off a resolution, so callers cannot drift from it. */
export function progressFromResolution(
  resolution: UtilityAvailabilityResolution,
  extra: Partial<UtilityResearchProgress> = {},
): UtilityResearchProgress {
  return {
    providerIdentified: resolution.provider.state === 'identified',
    territoryEstablished: resolution.territory.state !== 'unresolved',
    corridorRead: resolution.infrastructure.state !== 'UNKNOWN',
    corridorInfrastructureShown: corridorInfrastructureShown(resolution.infrastructure.state),
    providerEngineeringMapRead: false,
    neighborhoodPatternEstablished: resolution.areaContext.length > 0,
    adjacentDevelopmentTraced: false,
    sameRoadCommercialRead: false,
    historicalRecordsRead: false,
    adaptiveDiscoveryRun: false,
    providerDeterminationHeld: resolution.connection.state === 'available'
      || resolution.connection.state === 'conditionally_available'
      || resolution.connection.state === 'not_available',
    blocked: /research blocked/i.test(resolution.headline),
    ...extra,
  };
}

export interface UtilityResearchPlan {
  kind: UtilityKind;
  depth: DevelopmentResearchDepth;
  /** The next step to take, or `null` when research itself is finished. */
  nextStep: UtilityResearchStep | null;
  /** Why that step, or why none. Operator-readable. */
  rationale: string;
  /** Everything still open and authorized, in order. */
  remainingSteps: UtilityResearchStep[];
  /** Steps the depth policy deliberately withholds, with the reason. */
  withheldSteps: Array<{ step: UtilityResearchStep; reason: string }>;
  /** True when only the serving party can move the answer further. */
  researchExhausted: boolean;
}

/**
 * Choose the next step from what is still unestablished.
 *
 * The ordering inside the function is the cheapest-first heuristic: the
 * corridor read is attempted before any contextual research, because context is
 * only worth gathering when the direct question failed — and a subject-corridor
 * line, once found, makes most of the contextual chain pointless.
 */
export function planUtilityResearch(input: {
  kind: UtilityKind;
  depth: DevelopmentResearchDepth;
  progress: UtilityResearchProgress;
}): UtilityResearchPlan {
  const { kind, depth, progress } = input;
  const authorized = authorizedUtilitySteps(depth);
  const withheld = DEEP_STEPS
    .filter((step) => !authorized.includes(step))
    .map((step) => ({
      step,
      reason: `Withheld: this parcel is screened at ${depth} depth, where ${UTILITY_RESEARCH_STEP_LABEL[step].toLowerCase()} is not proportionate to the decision.`,
    }));

  const done: Readonly<Record<UtilityResearchStep, boolean>> = {
    provider: progress.providerIdentified,
    service_territory: progress.territoryEstablished,
    subject_corridor_gis: progress.corridorRead,
    provider_engineering_map: progress.providerEngineeringMapRead,
    neighborhood_service_pattern: progress.neighborhoodPatternEstablished,
    adjacent_development_trace: progress.adjacentDevelopmentTraced,
    same_road_commercial: progress.sameRoadCommercialRead,
    historical_site_records: progress.historicalRecordsRead,
    adaptive_web_discovery: progress.adaptiveDiscoveryRun,
    written_provider_confirmation: progress.providerDeterminationHeld,
  };

  const remaining = authorized.filter((step) => !done[step]);

  if (progress.blocked) {
    return {
      kind,
      depth,
      nextStep: null,
      rationale: 'A real external wall stopped this lane. The next action is clearing the block, not more searching.',
      remainingSteps: remaining,
      withheldSteps: withheld,
      researchExhausted: false,
    };
  }

  if (progress.providerDeterminationHeld) {
    return {
      kind,
      depth,
      nextStep: null,
      rationale: `The serving party has issued a determination for ${kind}. Nothing further is researchable; the question is answered.`,
      remainingSteps: [],
      withheldSteps: withheld,
      researchExhausted: true,
    };
  }

  // Once the corridor is settled, contextual research cannot improve the
  // answer: only the provider can, and the remaining contextual steps would
  // spend budget to restate what the map already showed.
  if (progress.corridorInfrastructureShown) {
    return {
      kind,
      depth,
      nextStep: 'written_provider_confirmation',
      rationale: `Infrastructure is established on the subject corridor for ${kind}. Connection, capacity and extension are determinations only the serving party makes, so contextual research is skipped and the written request is the next step.`,
      remainingSteps: ['written_provider_confirmation'],
      withheldSteps: withheld,
      researchExhausted: false,
    };
  }

  const next = remaining.find((step) => step !== 'written_provider_confirmation') ?? null;
  if (!next) {
    return {
      kind,
      depth,
      nextStep: 'written_provider_confirmation',
      rationale: `Every authorized public research route for ${kind} has been run at ${depth} depth without settling connection availability. What remains is a determination, not a document, so the written request is the next step.`,
      remainingSteps: ['written_provider_confirmation'],
      withheldSteps: withheld,
      researchExhausted: true,
    };
  }

  return {
    kind,
    depth,
    nextStep: next,
    rationale: next === 'subject_corridor_gis'
      ? `The subject and its own road are the first infrastructure question for ${kind}; surrounding context is not researched before it.`
      : `${UTILITY_RESEARCH_STEP_LABEL[next]} is the cheapest remaining route that could still establish ${kind} infrastructure on the subject corridor.`,
    remainingSteps: remaining,
    withheldSteps: withheld,
    researchExhausted: false,
  };
}
