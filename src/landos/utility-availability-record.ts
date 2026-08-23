// LandOS — the retained utility availability record, and its projection.
//
// The research writes OBSERVATIONS here; the operator read is derived from them
// every time it is asked for. That split is deliberate. If the derived answer
// were stored, a later change to the promotion rules would leave old answers
// standing at the old confidence — exactly the failure the evidence levels
// exist to prevent. Storing observations means the guards run on every read.
//
// The record is also the reason a hard refresh costs nothing: it is retained
// operator evidence, and rendering it re-runs pure functions rather than
// research, models, or a browser.
//
// Pure. No I/O — persistence lives with the capability that owns the card.

import type { PublicServiceRead } from './access-utilities-screening.js';
import type { DevelopmentResearchDepth } from './development-intelligence.js';
import {
  resolveUtilityAvailability,
  type UtilityAreaContextObservation,
  type UtilityAvailabilityResolution,
  type UtilityCorridorObservation,
  type UtilityKind,
  type UtilityProviderDetermination,
  type UtilityProviderObservation,
  type UtilityTerritoryObservation,
} from './utility-availability-resolution.js';
import type { SubjectDevelopmentStatus } from './utility-site-position.js';
import {
  buildUtilityConfirmationRequest,
  type UtilityConfirmationRequest,
  type UtilityConfirmationSubject,
  type UtilityProviderContact,
} from './utility-confirmation-request.js';
import {
  orderUtilityContextLeads,
  readHistoricalUtilityPlan,
  readNeighborhoodServicePattern,
  traceDevelopmentInfrastructure,
  type DevelopmentInfrastructureFinding,
  type DevelopmentInfrastructureTrace,
  type HistoricalUtilityPlanInput,
  type HistoricalUtilityPlanReading,
  type NeighborhoodServicePattern,
  type NeighborhoodServicePatternInput,
  type UtilityContextLead,
  type UtilityContextLeadAssessment,
} from './utility-context-leads.js';
import {
  planUtilityResearch,
  progressFromResolution,
  type UtilityResearchPlan,
} from './utility-research-plan.js';

/** What the research established for one utility, before any derivation. */
export interface RetainedUtilityObservations {
  provider?: UtilityProviderObservation | null;
  territory?: UtilityTerritoryObservation | null;
  corridor?: UtilityCorridorObservation | null;
  determination?: UtilityProviderDetermination | null;
  blocked?: { reason: string } | null;
  notApplicable?: boolean;
  contact?: UtilityProviderContact | null;
}

export const UTILITY_AVAILABILITY_RECORD_VERSION = 1;

export interface RetainedUtilityAvailabilityRecord {
  version: typeof UTILITY_AVAILABILITY_RECORD_VERSION;
  depth: DevelopmentResearchDepth;
  /**
   * Whether the subject carries improvements today.
   *
   * Optional, and absent on records written before it existed. It is read in
   * exactly one place — how to interpret a line drawn INSIDE the boundary,
   * which on undeveloped land is often a private lateral left by a former
   * structure rather than a public main. It never conditions the favourable
   * reading of frontage or property-edge infrastructure, so an older record
   * projects identically without it.
   */
  subjectDevelopment?: SubjectDevelopmentStatus;
  water: RetainedUtilityObservations;
  sewer: RetainedUtilityObservations;
  /** Every lead considered, admitted or not. Refusals are shown too. */
  contextLeads?: UtilityContextLead[];
  /** One pattern covers both utilities — the same street answers both. */
  neighborhoodPattern?: NeighborhoodServicePatternInput | null;
  developmentTraces?: Array<{ kind: UtilityKind; trace: DevelopmentInfrastructureTrace }>;
  historicalPlans?: HistoricalUtilityPlanInput[];
  /** What the research actually did, in its own words. */
  researchNotes?: string[];
  researchedAt: string;
}

export interface UtilityAvailabilityProjection {
  depth: DevelopmentResearchDepth;
  water: UtilityAvailabilityResolution;
  sewer: UtilityAvailabilityResolution;
  /**
   * The one current interpretation consumed by every downstream question that
   * still needs a coarse "utilities known" gate. The per-utility outcomes stay
   * attached so PARTIAL/BLOCKED/UNRESOLVED is never flattened into a false yes.
   */
  knowledge: UtilityKnowledgeRead;
  waterPlan: UtilityResearchPlan;
  sewerPlan: UtilityResearchPlan;
  neighborhoodPattern: NeighborhoodServicePattern | null;
  admittedLeads: UtilityContextLeadAssessment[];
  refusedLeads: UtilityContextLeadAssessment[];
  developmentFindings: Array<{ kind: UtilityKind } & DevelopmentInfrastructureFinding>;
  historicalReadings: Array<{ kind: UtilityKind } & HistoricalUtilityPlanReading>;
  waterConfirmation: UtilityConfirmationRequest | null;
  sewerConfirmation: UtilityConfirmationRequest | null;
  researchNotes: string[];
  researchedAt: string;
}

export interface UtilityKnowledgeRead {
  outcome: UtilityAvailabilityResolution['laneOutcome'];
  fullyKnown: boolean;
  water: { outcome: UtilityAvailabilityResolution['laneOutcome']; known: boolean };
  sewer: { outcome: UtilityAvailabilityResolution['laneOutcome']; known: boolean };
  summary: string;
}

function utilityOutcomeIsKnown(outcome: UtilityAvailabilityResolution['laneOutcome']): boolean {
  return outcome === 'RETURNED' || outcome === 'NOT_REQUIRED';
}

/**
 * Reconcile the independent water and sewer resolutions into the canonical
 * compatibility read used by older boolean gates.
 *
 * RETURNED and NOT_REQUIRED are the only settled outcomes. A mixed pair is
 * PARTIAL, while a pair with no usable answer preserves BLOCKED/UNRESOLVED.
 * Consumers needing detail always retain the two independent outcomes.
 */
export function interpretUtilityKnowledge(
  water: UtilityAvailabilityResolution,
  sewer: UtilityAvailabilityResolution,
): UtilityKnowledgeRead {
  const waterKnown = utilityOutcomeIsKnown(water.laneOutcome);
  const sewerKnown = utilityOutcomeIsKnown(sewer.laneOutcome);
  const outcomes = [water.laneOutcome, sewer.laneOutcome];
  const fullyKnown = waterKnown && sewerKnown;
  const outcome: UtilityAvailabilityResolution['laneOutcome'] =
    outcomes.every((value) => value === 'NOT_REQUIRED') ? 'NOT_REQUIRED'
      : fullyKnown ? 'RETURNED'
        : outcomes.every((value) => value === 'UNRESOLVED') ? 'UNRESOLVED'
          : outcomes.includes('PARTIAL') || waterKnown || sewerKnown ? 'PARTIAL'
            : outcomes.includes('BLOCKED') ? 'BLOCKED'
              : 'UNRESOLVED';
  return {
    outcome,
    fullyKnown,
    water: { outcome: water.laneOutcome, known: waterKnown },
    sewer: { outcome: sewer.laneOutcome, known: sewerKnown },
    summary: `Water: ${water.laneOutcome}. Sewer: ${sewer.laneOutcome}.`,
  };
}

/**
 * Bridge the resolution into the older screening vocabulary the checklist,
 * the well outlook and the septic outlook already read.
 *
 * Two stores answering "does this parcel have public water" is how a surface
 * ends up showing a confirmed finding under a contradicting header. The
 * resolution is the stronger, more precise read, so wherever it exists it
 * DECIDES the coarse state — reconciled at read time, with the older row left
 * untouched.
 *
 * `available` is reserved for a serving-party determination. A mapped main at
 * the frontage is not enough, which means the well and septic outlooks keep
 * running until someone actually confirms service — the correct behaviour, and
 * the opposite of what a proximity-based read would do.
 */
export function publicServiceReadFromResolution(resolution: UtilityAvailabilityResolution): PublicServiceRead {
  const sourcesChecked = [
    ...resolution.provider.sources,
    ...resolution.territory.sources,
    ...resolution.infrastructure.sources,
    ...resolution.connection.sources,
  ].filter((entry, index, all) => entry && all.indexOf(entry) === index);
  const available = resolution.connection.state === 'available'
    || resolution.connection.state === 'conditionally_available';
  return {
    state: available ? 'available' : 'unresolved',
    statement: `${resolution.headline} ${resolution.connection.statement}`,
    sourcesChecked,
  };
}

function areaContextFor(
  kind: UtilityKind,
  pattern: NeighborhoodServicePattern | null,
  developmentFindings: Array<{ kind: UtilityKind } & DevelopmentInfrastructureFinding>,
  historicalReadings: Array<{ kind: UtilityKind } & HistoricalUtilityPlanReading>,
): UtilityAreaContextObservation[] {
  const context: UtilityAreaContextObservation[] = [];
  if (pattern?.established) {
    context.push({ statement: pattern.statement, source: { label: pattern.source, url: pattern.sourceUrl } });
  }
  for (const finding of developmentFindings) {
    // A traced route that reaches the subject corridor is corridor evidence and
    // belongs in the infrastructure dimension, not in the context list. It is
    // excluded here so it cannot be counted twice at two different strengths.
    if (finding.kind !== kind || finding.reachesSubjectCorridor) continue;
    context.push({ statement: finding.statement, source: { label: finding.source, url: finding.sourceUrl } });
  }
  for (const reading of historicalReadings) {
    if (reading.kind !== kind) continue;
    context.push({ statement: reading.statement, source: { label: reading.source, url: reading.sourceUrl } });
  }
  return context;
}

/**
 * Derive the whole operator read from the retained observations.
 *
 * Every promotion rule in `utility-availability-resolution` and every relevance
 * gate in `utility-context-leads` runs here, on every call. A record written
 * before a rule tightened is re-judged by the current rule, which is the only
 * way a stored answer can stay honest.
 */
export function projectUtilityAvailability(
  record: RetainedUtilityAvailabilityRecord,
  subject: UtilityConfirmationSubject,
): UtilityAvailabilityProjection {
  const leads = record.contextLeads ?? [];
  const { admitted, refused } = orderUtilityContextLeads(leads);

  const pattern = record.neighborhoodPattern
    ? readNeighborhoodServicePattern(record.neighborhoodPattern)
    : null;

  const developmentFindings = (record.developmentTraces ?? []).map((entry) => ({
    kind: entry.kind,
    ...traceDevelopmentInfrastructure(entry.kind, entry.trace),
  }));

  const historicalReadings = (record.historicalPlans ?? []).map((plan) => ({
    kind: plan.kind,
    ...readHistoricalUtilityPlan(plan),
  }));

  const resolve = (kind: UtilityKind, observations: RetainedUtilityObservations): UtilityAvailabilityResolution => {
    // A traced route that reaches the subject corridor stands in for a map read
    // when no layer was read — it is the same corridor fact from a different
    // record. It never overrides a layer that WAS read: direct subject evidence
    // outranks context, including strong context.
    const traced = developmentFindings.find((finding) => finding.kind === kind && finding.reachesSubjectCorridor);
    const corridor: UtilityCorridorObservation | null = observations.corridor
      ?? (traced
        ? {
          relationship: 'ON_SUBJECT_ROAD',
          layerName: null,
          source: { label: `${traced.projectName} infrastructure trace — ${traced.source}`, url: traced.sourceUrl },
        }
        : null);
    return resolveUtilityAvailability({
      kind,
      subjectDevelopment: record.subjectDevelopment ?? 'unknown',
      provider: observations.provider ?? null,
      territory: observations.territory ?? null,
      corridor,
      determination: observations.determination ?? null,
      areaContext: areaContextFor(kind, pattern, developmentFindings, historicalReadings),
      blocked: observations.blocked ?? null,
      notApplicable: observations.notApplicable === true,
    });
  };

  const water = resolve('water', record.water);
  const sewer = resolve('sewer', record.sewer);

  const planFor = (kind: UtilityKind, resolution: UtilityAvailabilityResolution): UtilityResearchPlan => planUtilityResearch({
    kind,
    depth: record.depth,
    progress: progressFromResolution(resolution, {
      adjacentDevelopmentTraced: developmentFindings.some((finding) => finding.kind === kind),
      historicalRecordsRead: historicalReadings.some((reading) => reading.kind === kind),
      neighborhoodPatternEstablished: pattern?.established === true,
      sameRoadCommercialRead: admitted.some((entry) => entry.lead.kind === 'same_road_commercial'),
    }),
  });

  const extraContextFor = (kind: UtilityKind): string[] => [
    ...developmentFindings.filter((finding) => finding.kind === kind && finding.reachesSubjectCorridor)
      .map((finding) => finding.statement),
    ...historicalReadings.filter((reading) => reading.kind === kind).map((reading) => reading.useInConfirmation),
  ];

  return {
    depth: record.depth,
    water,
    sewer,
    knowledge: interpretUtilityKnowledge(water, sewer),
    waterPlan: planFor('water', water),
    sewerPlan: planFor('sewer', sewer),
    neighborhoodPattern: pattern,
    admittedLeads: admitted,
    refusedLeads: refused,
    developmentFindings,
    historicalReadings,
    waterConfirmation: water.confirmationRequired
      ? buildUtilityConfirmationRequest({
        kind: 'water',
        subject,
        resolution: water,
        contact: record.water.contact ?? null,
        extraContext: extraContextFor('water'),
      })
      : null,
    sewerConfirmation: sewer.confirmationRequired
      ? buildUtilityConfirmationRequest({
        kind: 'sewer',
        subject,
        resolution: sewer,
        contact: record.sewer.contact ?? null,
        extraContext: extraContextFor('sewer'),
      })
      : null,
    researchNotes: record.researchNotes ?? [],
    researchedAt: record.researchedAt,
  };
}
