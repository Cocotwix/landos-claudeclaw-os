// LandOS — CONTEXTUAL UTILITY LEADS, and the gate that keeps them honest.
//
// WHY THIS EXISTS. When the subject's own road cannot be read, a competent land
// researcher does not stop at "unresolved". They look at what is around the
// parcel and reason about where the pipe must run. That instinct is right, and
// unguarded it produces two specific failures LandOS must not ship:
//
//   THE FALSE POSITIVE. A commercial building 1,000 feet away has public water,
//   so the subject "has water". It does not follow. The main may reach that
//   building from the opposite direction, down a different road, from a
//   different pressure zone. Straight-line distance is not a pipe route, and a
//   parcel two roads over shares a map square with the subject and nothing else.
//
//   THE RABBIT HOLE. One rural house near the subject becomes an afternoon of
//   septic-permit archaeology that answers nothing about the subject corridor.
//
// So this module answers one question — IS THIS LEAD ADMISSIBLE AT ALL — from
// physical relationship rather than proximity, and ranks what survives. A lead
// that passes still only ever carries AREA-level evidence: it can make the
// eventual provider inquiry far smarter, and it can never establish that the
// subject may connect.
//
// System-wide. No jurisdiction, road, subdivision or provider is named here.
//
// Pure. No I/O, no clock, no model, no browser.

import type { UtilityEvidenceLevel, UtilityKind } from './utility-availability-resolution.js';

// ── Lead kinds and their priority ────────────────────────────────────────────

/**
 * The kinds of surrounding evidence worth looking at, in the order a
 * researcher should actually spend attention on them.
 *
 * The order is the doctrine: the subject's own corridor first, then what
 * physically adjoins it, then what shares its road. "Somewhere nearby" is last
 * and is admissible only when something other than distance makes it relevant.
 */
export type UtilityContextLeadKind =
  | 'subject_road_corridor'
  | 'adjoining_residential_neighborhood'
  | 'connected_new_development'
  | 'same_road_commercial'
  | 'other_context';

const LEAD_PRIORITY: Readonly<Record<UtilityContextLeadKind, number>> = {
  subject_road_corridor: 1,
  adjoining_residential_neighborhood: 2,
  connected_new_development: 3,
  same_road_commercial: 4,
  other_context: 5,
};

export const UTILITY_CONTEXT_LEAD_LABEL: Readonly<Record<UtilityContextLeadKind, string>> = {
  subject_road_corridor: 'Subject road corridor',
  adjoining_residential_neighborhood: 'Adjoining residential neighborhood',
  connected_new_development: 'Adjacent or connected development',
  same_road_commercial: 'Same-road commercial or institutional use',
  other_context: 'Other surrounding context',
};

/**
 * The smallest number of developed lots that makes a residential CLUSTER.
 *
 * A cluster is informative because a whole street served one way is a service
 * PATTERN. One house is a household decision — it may be on a well because the
 * owner preferred one, or predates the main by forty years. Below this count
 * the lead is refused, which is what stops the rabbit hole.
 */
export const MIN_RESIDENTIAL_CLUSTER_LOTS = 8;

// ── The lead ─────────────────────────────────────────────────────────────────

/**
 * A candidate lead, described by PHYSICAL RELATIONSHIP.
 *
 * Note what this interface makes hard: there is no way to describe a lead as
 * "close" and have it admitted. `straightLineFeet` is carried for the operator
 * record and is deliberately not consulted by the gate.
 */
export interface UtilityContextLead {
  kind: UtilityContextLeadKind;
  /** What the operator would call it — a subdivision, a store, a school. */
  label: string;
  /** Shares the road the subject fronts. */
  sharesSubjectRoad: boolean;
  /** Physically abuts the subject. */
  adjoinsSubject: boolean;
  /** Reached through the same immediate street network, not a separate one. */
  sharesImmediateStreetNetwork: boolean;
  /** Developed residential lots observed, when the lead is a neighborhood. */
  developedLotCount?: number | null;
  /** Retained for the record. Never an admission argument. */
  straightLineFeet?: number | null;
  /**
   * Set only when something other than the three relationships above makes the
   * lead infrastructure-relevant — a shared easement, a known extension route.
   * The reason is required, so "it felt relevant" cannot pass.
   */
  infrastructureRelevanceReason?: string | null;
}

export interface UtilityContextLeadAssessment {
  lead: UtilityContextLead;
  admissible: boolean;
  priority: number;
  /** The ceiling on what this lead could ever carry. Never above area. */
  evidenceLevel: UtilityEvidenceLevel;
  /** Why it was admitted or refused, in words the operator can check. */
  reason: string;
}

function physicallyConnected(lead: UtilityContextLead): boolean {
  return lead.adjoinsSubject || lead.sharesSubjectRoad || lead.sharesImmediateStreetNetwork;
}

/**
 * Decide whether a lead may be researched at all.
 *
 * Every branch turns on physical relationship. `straightLineFeet` never
 * appears, and that omission is the module's whole defence against the
 * commercial-building-two-roads-over failure.
 */
export function assessUtilityContextLead(lead: UtilityContextLead): UtilityContextLeadAssessment {
  const priority = LEAD_PRIORITY[lead.kind];
  const base = { lead, priority };

  switch (lead.kind) {
    case 'subject_road_corridor':
      // The subject's own corridor is the question, not a lead about it. It is
      // the only kind whose ceiling is corridor-level rather than area-level.
      return {
        ...base,
        admissible: true,
        evidenceLevel: 'corridor_infrastructure',
        reason: 'The subject road corridor is the first infrastructure question and is always researched before surrounding context.',
      };

    case 'adjoining_residential_neighborhood': {
      if (!physicallyConnected(lead)) {
        return {
          ...base,
          admissible: false,
          evidenceLevel: 'area_service',
          reason: `${lead.label} neither adjoins the subject, shares its road, nor shares its immediate street network. A neighborhood that is merely near the subject may be served from an entirely different direction.`,
        };
      }
      const lots = lead.developedLotCount ?? 0;
      if (lots < MIN_RESIDENTIAL_CLUSTER_LOTS) {
        return {
          ...base,
          admissible: false,
          evidenceLevel: 'area_service',
          reason: `${lead.label} shows ${lots || 'no'} developed lot(s) — below the ${MIN_RESIDENTIAL_CLUSTER_LOTS}-lot cluster threshold. An isolated residence reflects one household's choice, not an area service pattern, and is not researched.`,
        };
      }
      return {
        ...base,
        admissible: true,
        evidenceLevel: 'area_service',
        reason: `${lead.label} is physically connected to the subject and shows ${lots} developed lots — a cluster large enough to read a service pattern from. The pattern is area context; it cannot establish service at the subject.`,
      };
    }

    case 'connected_new_development':
      if (!physicallyConnected(lead)) {
        return {
          ...base,
          admissible: false,
          evidenceLevel: 'area_service',
          reason: `${lead.label} is not adjacent to the subject and does not share its road or street network, so whatever utilities it built need not approach the subject corridor.`,
        };
      }
      return {
        ...base,
        admissible: true,
        evidenceLevel: 'area_service',
        reason: `${lead.label} adjoins or shares the subject's street network, so what it had to build to obtain service is a high-value lead. The question to answer is where that infrastructure actually runs.`,
      };

    case 'same_road_commercial':
      if (!physicallyConnected(lead)) {
        return {
          ...base,
          admissible: false,
          evidenceLevel: 'area_service',
          reason: `${lead.label} is not on the subject's road and does not adjoin it. A commercial building on another corridor is commonly served from a different direction; straight-line proximity is not an infrastructure relationship.`,
        };
      }
      return {
        ...base,
        admissible: true,
        evidenceLevel: 'area_service',
        reason: `${lead.label} sits on the subject's own corridor, so how it is served speaks to that corridor. Commercial use never by itself implies public water or public sewer — how it is actually served must be established.`,
      };

    case 'other_context':
    default: {
      const why = lead.infrastructureRelevanceReason?.trim();
      if (!why) {
        return {
          ...base,
          admissible: false,
          evidenceLevel: 'area_service',
          reason: `${lead.label} carries no stated infrastructure relevance to the subject corridor, so it is not researched.`,
        };
      }
      return {
        ...base,
        admissible: true,
        evidenceLevel: 'area_service',
        reason: `${lead.label} is researched on a stated infrastructure relationship: ${why}.`,
      };
    }
  }
}

/**
 * Rank the admissible leads and drop the rest.
 *
 * Refused leads are returned too, in `refused`, because "we deliberately did
 * not chase that" is itself an operator-visible research decision — silence
 * reads as an oversight.
 */
export function orderUtilityContextLeads(leads: readonly UtilityContextLead[]): {
  admitted: UtilityContextLeadAssessment[];
  refused: UtilityContextLeadAssessment[];
} {
  const assessed = leads.map(assessUtilityContextLead);
  const byPriority = (a: UtilityContextLeadAssessment, b: UtilityContextLeadAssessment) => a.priority - b.priority;
  return {
    admitted: assessed.filter((entry) => entry.admissible).sort(byPriority),
    refused: assessed.filter((entry) => !entry.admissible).sort(byPriority),
  };
}

// ── Neighborhood service pattern ─────────────────────────────────────────────

export type NeighborhoodWaterPattern = 'public_water' | 'private_wells' | 'mixed' | 'unknown';
export type NeighborhoodWastewaterPattern = 'public_sewer' | 'individual_septic' | 'mixed' | 'unknown';

export interface NeighborhoodServicePatternInput {
  lead: UtilityContextLead;
  water: NeighborhoodWaterPattern;
  wastewater: NeighborhoodWastewaterPattern;
  /** How the pattern was determined — hydrants, service map, permits. */
  basis: string;
  source: { label: string; url?: string | null };
}

export interface NeighborhoodServicePattern {
  established: boolean;
  water: NeighborhoodWaterPattern;
  wastewater: NeighborhoodWastewaterPattern;
  evidenceLevel: UtilityEvidenceLevel;
  observedLotCount: number | null;
  statement: string;
  source: string;
  sourceUrl: string | null;
}

const WATER_PATTERN_TEXT: Readonly<Record<NeighborhoodWaterPattern, string>> = {
  public_water: 'public water',
  private_wells: 'private wells',
  mixed: 'a mix of public water and private wells',
  unknown: 'an undetermined water source',
};

const WASTEWATER_PATTERN_TEXT: Readonly<Record<NeighborhoodWastewaterPattern, string>> = {
  public_sewer: 'public sewer',
  individual_septic: 'individual septic',
  mixed: 'a mix of public sewer and individual septic',
  unknown: 'an undetermined wastewater method',
};

/**
 * Read a service pattern off an admitted cluster.
 *
 * The statement it produces always carries its own limit. This is the exact
 * sentence that, left unqualified, becomes "the subject has public water" three
 * surfaces downstream — so the qualification is generated with the claim rather
 * than left to whoever renders it.
 */
export function readNeighborhoodServicePattern(
  input: NeighborhoodServicePatternInput,
): NeighborhoodServicePattern {
  const assessment = assessUtilityContextLead(input.lead);
  const lots = input.lead.developedLotCount ?? null;
  if (!assessment.admissible) {
    return {
      established: false,
      water: 'unknown',
      wastewater: 'unknown',
      evidenceLevel: 'area_service',
      observedLotCount: lots,
      statement: assessment.reason,
      source: input.source.label,
      sourceUrl: input.source.url ?? null,
    };
  }
  const established = input.water !== 'unknown' || input.wastewater !== 'unknown';
  return {
    established,
    water: input.water,
    wastewater: input.wastewater,
    evidenceLevel: 'area_service',
    observedLotCount: lots,
    statement: established
      ? `Immediate neighborhood service pattern: ${input.lead.label} appears to be served by ${WATER_PATTERN_TEXT[input.water]} with ${WASTEWATER_PATTERN_TEXT[input.wastewater]}, from ${input.basis}${lots ? ` across ${lots} developed lots` : ''}. This is the pattern around the subject, not a finding about the subject: it does not establish that a main runs on the subject's road or that the subject may connect.`
      : `The service pattern for ${input.lead.label} could not be determined from ${input.basis}.`,
    source: input.source.label,
    sourceUrl: input.source.url ?? null,
  };
}

// ── Adjacent development infrastructure tracing ──────────────────────────────

/**
 * What an adjoining or connected project had to BUILD to get service.
 *
 * The valuable question is never "does that project have utilities" — it is
 * what route the utilities took to reach it, because that route either passes
 * the subject or it does not.
 */
export interface DevelopmentInfrastructureTrace {
  projectName: string;
  developer?: string | null;
  waterSource?: string | null;
  waterExtension?: string | null;
  sewerRouting?: string | null;
  mainSizeInches?: number | null;
  liftStation?: string | null;
  forceMain?: string | null;
  connectionPoint?: string | null;
  offsiteImprovements?: string[];
  utilityEasements?: string | null;
  /**
   * The question that decides everything: does the traced infrastructure
   * actually run along the subject's corridor? `null` means it was not traced,
   * which is different from traced and found not to.
   */
  runsAlongSubjectCorridor: boolean | null;
  source: { label: string; url?: string | null };
}

export interface DevelopmentInfrastructureFinding {
  projectName: string;
  /** Area unless the route was actually traced to the subject corridor. */
  evidenceLevel: UtilityEvidenceLevel;
  /** True only when the trace itself reached the subject corridor. */
  reachesSubjectCorridor: boolean;
  statement: string;
  details: Array<{ label: string; value: string }>;
  source: string;
  sourceUrl: string | null;
}

/**
 * Turn a trace into a finding, at the level the trace actually earned.
 *
 * A traced route that reaches the subject corridor is CORRIDOR evidence — the
 * same strength as reading the line off a map, because it is the same fact
 * arrived at from the construction record. Everything else stays area context,
 * including a project that unambiguously has service.
 */
export function traceDevelopmentInfrastructure(
  kind: UtilityKind,
  trace: DevelopmentInfrastructureTrace,
): DevelopmentInfrastructureFinding {
  const details: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value == null || value === '') return;
    details.push({ label, value: String(value) });
  };
  push('Developer', trace.developer);
  if (kind === 'water') {
    push('Water source', trace.waterSource);
    push('Water extension', trace.waterExtension);
  } else {
    push('Sewer routing', trace.sewerRouting);
    push('Lift or pump station', trace.liftStation);
    push('Force main', trace.forceMain);
  }
  push('Main size', trace.mainSizeInches ? `${trace.mainSizeInches} inch` : null);
  push('Connection point', trace.connectionPoint);
  push('Utility easements', trace.utilityEasements);
  for (const item of trace.offsiteImprovements ?? []) push('Offsite improvement', item);

  const reaches = trace.runsAlongSubjectCorridor === true;
  const utility = kind === 'water' ? 'water' : 'sewer';
  return {
    projectName: trace.projectName,
    evidenceLevel: reaches ? 'corridor_infrastructure' : 'area_service',
    reachesSubjectCorridor: reaches,
    statement: reaches
      ? `${trace.projectName} obtained ${utility} service by infrastructure that runs along the subject's corridor. That places pipe on this corridor; it still does not establish the subject's right to connect, its capacity, or who would pay for the tap and any upsizing.`
      : trace.runsAlongSubjectCorridor === false
        ? `${trace.projectName} obtained ${utility} service by infrastructure that was traced and does NOT run along the subject's corridor. It is context about the area only, and specifically not evidence of a main at the subject.`
        : `${trace.projectName} obtained ${utility} service, but the route that infrastructure takes was not traced. Until it is, this says nothing about whether pipe approaches the subject corridor.`,
    details,
    source: trace.source.label,
    sourceUrl: trace.source.url ?? null,
  };
}

// ── Historical on-subject development records ────────────────────────────────

/**
 * What a previous project ON the subject proposed to build for utilities.
 *
 * This is the strongest-feeling and most dangerous class of context: it is
 * about the right parcel, from a real record, and it describes infrastructure
 * that in all likelihood was never built. It is retained because it reveals the
 * utility solution the site's own engineers expected — which is exactly the
 * thing to put in front of the provider — and it is never a current fact.
 */
export interface HistoricalUtilityPlanInput {
  projectName: string;
  kind: UtilityKind;
  /** What the plan proposed, e.g. two pump stations, a gravity outfall. */
  proposedInfrastructure: string[];
  /** What that infrastructure was intended to serve, where the record says. */
  intendedToServe?: string | null;
  /** Whether anything in the record shows it was built. Usually `false`. */
  constructionEvidenced: boolean;
  planDate?: string | null;
  source: { label: string; url?: string | null };
}

export interface HistoricalUtilityPlanReading {
  projectName: string;
  evidenceLevel: UtilityEvidenceLevel;
  establishesCurrentAvailability: false;
  proposedInfrastructure: string[];
  statement: string;
  /** Why this belongs in the provider inquiry rather than in the answer. */
  useInConfirmation: string;
  source: string;
  sourceUrl: string | null;
}

export function readHistoricalUtilityPlan(input: HistoricalUtilityPlanInput): HistoricalUtilityPlanReading {
  const utility = input.kind === 'water' ? 'water' : 'sewer';
  const proposed = input.proposedInfrastructure.filter((entry) => entry.trim());
  const dated = input.planDate ? ` (${input.planDate})` : '';
  return {
    projectName: input.projectName,
    evidenceLevel: 'area_service',
    establishesCurrentAvailability: false,
    proposedInfrastructure: proposed,
    statement: proposed.length
      ? `A prior development proposal for this site, ${input.projectName}${dated}, contemplated ${proposed.join(' and ')} for ${utility}${input.intendedToServe ? `, intended to serve ${input.intendedToServe}` : ''}. ${input.constructionEvidenced ? 'The record indicates this was built; whether it remains in service and available to a new project is a provider question.' : 'Nothing in the record indicates it was built. A proposal is a statement of what the site\'s own engineers expected to be necessary — not evidence that service exists today.'}`
      : `A prior development proposal for this site, ${input.projectName}${dated}, is on record but describes no ${utility} infrastructure.`,
    useInConfirmation: proposed.length
      ? `Put this to the provider directly: the site's prior engineering assumed ${proposed.join(' and ')}. Ask whether that is still the expected solution, and what has changed since${input.planDate ? ` ${input.planDate}` : ''}.`
      : 'No proposed infrastructure to raise with the provider.',
    source: input.source.label,
    sourceUrl: input.source.url ?? null,
  };
}
