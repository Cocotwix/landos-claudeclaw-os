// LandOS — SUBJECT-SPECIFIC yield, carveouts and downstream scenarios.
//
// This module applies verified rules to the actual parcel. It is the last place
// in the engine where a fabricated number could reach an operator, so the
// arithmetic is guarded rather than trusted:
//
//   * A legal maximum is computed ONLY from constraints that are established.
//     One missing required input makes the answer `unresolved` or
//     `provisional`, never a smaller number that looks confident.
//   * Physical plausibility is screening. It is capped by the legal answer, it
//     is labelled as planning-level, and it never claims survey or engineering
//     feasibility.
//   * Scenarios carry their own verification debt forward, so the downstream
//     comps work knows which of them rest on law and which rest on assumption.
//
// Three concepts stay separate on purpose: what the law allows, what the ground
// plausibly allows, and what is worth pricing. Collapsing them is how a
// planning-level guess becomes an underwriting input.

import {
  isByRight,
  type CarveoutConcept,
  type CompsResearchRequest,
  type DimensionalStandard,
  type DiscoveryQuestion,
  type LandUseScenario,
  type LegalYield,
  type ParentTractFramework,
  type PhysicalYield,
  type SubdivisionPath,
  type SubdivisionPathKind,
  type UseDetermination,
  type UseLegalStatus,
  type StructureType,
} from './land-use-types.js';

/* ──────────────────────────── shared helpers ─────────────────────────── */

const PLANNING_SCOPE_NOTE =
  'Planning-level screening only. This is not a survey, a boundary, or an engineered feasibility opinion, and no lot line is proposed.';

export function statusFor(uses: readonly UseDetermination[], structureType: StructureType): UseLegalStatus {
  return uses.find((use) => use.structureType === structureType)?.status ?? 'unverified';
}

/** Convert a dimensional standard to acres when it is expressed in a known unit. */
export function standardToAcres(standard: DimensionalStandard | undefined): number | null {
  if (!standard || standard.numericValue == null) return null;
  if (standard.unit === 'acres') return standard.numericValue;
  if (standard.unit === 'square_feet') return standard.numericValue / 43_560;
  return null;
}

export function findStandard(
  standards: readonly DimensionalStandard[],
  kind: DimensionalStandard['kind'],
): DimensionalStandard | undefined {
  // Prefer a standard with a parseable number; a narrative standard is real
  // but cannot drive arithmetic.
  return standards.find((standard) => standard.kind === kind && standard.numericValue != null)
    ?? standards.find((standard) => standard.kind === kind);
}

/* ───────────────────────────── legal maximum ─────────────────────────── */

export interface LegalYieldInput {
  parcelAcres: number | null;
  paths: readonly SubdivisionPath[];
  standards: readonly DimensionalStandard[];
  parentTract: ParentTractFramework;
  /** True when no conventional zoning was verified for this parcel. */
  noConventionalZoning: boolean;
  /** True when the subdivision authority itself was never established. */
  subdivisionAuthorityUnresolved: boolean;
}

/**
 * The maximum number of lots the VERIFIED law supports for this parcel.
 *
 * Every branch that cannot complete returns a named reason and a null count.
 * There is deliberately no path through this function that produces a number
 * from an assumed minimum lot size, an assumed lot cap, or an assumed division
 * history — those are precisely the inputs an operator would most want to be
 * true, and inventing them would put a false entitlement number in front of a
 * purchase decision.
 */
export function computeLegalYield(input: LegalYieldInput): LegalYield {
  const constraintsApplied: LegalYield['constraintsApplied'] = [];
  const missingInputs: string[] = [];

  if (input.parcelAcres == null) missingInputs.push('Parcel acreage from an official source');
  if (input.subdivisionAuthorityUnresolved) missingInputs.push('The body that approves land division');

  const byRightPaths = input.paths.filter((path) => path.isByRight);
  if (!byRightPaths.length) {
    missingInputs.push('A division procedure that requires no discretionary entitlement');
  }

  // The governing cap is the SMALLEST stated cap among by-right procedures, and
  // it only exists when a procedure actually states one.
  const capped = byRightPaths
    .map((path) => ({ path, cap: path.maximumLots.value }))
    .filter((entry): entry is { path: SubdivisionPath; cap: number } => typeof entry.cap === 'number');
  const governing = capped.sort((a, b) => a.cap - b.cap)[0] ?? null;
  if (!governing && byRightPaths.length) {
    missingInputs.push('A stated maximum lot count for the by-right division procedure');
  }
  if (governing) {
    constraintsApplied.push({
      constraint: `${governing.path.originalTerm} lot cap`,
      value: `${governing.cap} lots`,
      source: governing.path.maximumLots.citations[0]?.url ?? 'adopted local law',
    });
  }

  const minimumLotAcres = standardToAcres(findStandard(input.standards, 'minimum_lot_area'));
  if (minimumLotAcres != null && input.parcelAcres != null) {
    constraintsApplied.push({
      constraint: 'Minimum lot area',
      value: `${minimumLotAcres.toFixed(2)} ac`,
      source: findStandard(input.standards, 'minimum_lot_area')?.citation.url ?? 'adopted local law',
    });
  } else if (!input.noConventionalZoning) {
    missingInputs.push('A verified minimum lot area');
  }

  // Prior division history is the classic silent-failure input: the rule can be
  // fully verified and still unusable because the parcel's own history is not
  // in LandOS.
  if (input.parentTract.priorDivisionHistoryRequired) {
    missingInputs.push('The parcel\'s prior division history under the parent-tract rule');
  }

  const areaLimit = minimumLotAcres != null && input.parcelAcres != null && minimumLotAcres > 0
    ? Math.floor(input.parcelAcres / minimumLotAcres)
    : null;

  const candidates = [governing?.cap ?? null, areaLimit].filter((value): value is number => typeof value === 'number');

  if (input.parentTract.priorDivisionHistoryRequired) {
    return {
      status: 'unresolved',
      maximumLots: null,
      path: governing?.path.kind ?? null,
      constraintsApplied,
      missingInputs,
      reason: 'LEGAL MAXIMUM UNRESOLVED — PRIOR DIVISION HISTORY REQUIRED. The controlling rule counts divisions already taken from the parent tract, and that history is not in LandOS.',
    };
  }

  if (!candidates.length) {
    return {
      status: 'unresolved',
      maximumLots: null,
      path: governing?.path.kind ?? null,
      constraintsApplied,
      missingInputs,
      reason: input.noConventionalZoning
        ? 'No conventional zoning applies, and no verified division cap or lot-area minimum was located, so a legal maximum cannot be computed. The division procedure and any health-department lot minimum govern instead.'
        : 'No verified constraint was available to compute a legal maximum. LandOS will not estimate one.',
    };
  }

  const maximum = Math.max(0, Math.min(...candidates));

  // A number backed by real constraints is still provisional while any
  // required input is missing. It is published as provisional rather than
  // withheld, because a bounded answer with its gaps named is useful and a
  // silent one is not.
  if (missingInputs.length) {
    return {
      status: 'provisional',
      maximumLots: maximum,
      path: governing?.path.kind ?? null,
      constraintsApplied,
      missingInputs,
      reason: `Legal maximum is provisional: computed from the constraints that are verified, while ${missingInputs.length} required input(s) remain unresolved.`,
    };
  }

  return {
    status: 'established',
    maximumLots: maximum,
    path: governing?.path.kind ?? null,
    constraintsApplied,
    missingInputs: [],
    reason: `Computed from verified constraints only: ${constraintsApplied.map((entry) => entry.constraint).join(', ')}.`,
  };
}

/* ────────────────────────── physical plausibility ────────────────────── */

export interface PhysicalYieldInput {
  parcelAcres: number | null;
  legal: LegalYield;
  /** Retained subject evidence. Each entry is an observation, not a conclusion. */
  siteFacts: ReadonlyArray<{ factor: string; observation: string; source: string }>;
  /** Frontage the subject actually has, when an official source stated it. */
  roadFrontageStated: string | null;
  minimumFrontage: DimensionalStandard | undefined;
  /** Named constraints that reduce plausibility. */
  limitingFactors: readonly string[];
}

/**
 * A planning-level view of how many lots the GROUND plausibly supports.
 *
 * Capped by the legal answer, because a physical count above the legal one is
 * meaningless, and never published when the legal answer is unresolved — an
 * unbounded physical number reads as a yield and would be used as one.
 */
export function computePhysicalYield(input: PhysicalYieldInput): PhysicalYield {
  const evidenceUsed = [...input.siteFacts];
  const limitingFactors = [...input.limitingFactors];

  if (input.roadFrontageStated) {
    evidenceUsed.push({ factor: 'Road frontage', observation: input.roadFrontageStated, source: 'official parcel evidence' });
  }
  if (input.minimumFrontage && !input.roadFrontageStated) {
    limitingFactors.push('The ordinance sets a minimum road frontage and the subject\'s actual frontage is not established, so the number of lots that can meet it is unknown.');
  }

  if (input.legal.status === 'unresolved' || input.legal.maximumLots == null) {
    return {
      status: 'unresolved',
      plausibleLots: null,
      evidenceUsed,
      limitingFactors: [...limitingFactors, 'The legal maximum is unresolved, so a physical count would not be bounded by anything.'],
      scopeNote: PLANNING_SCOPE_NOTE,
    };
  }

  if (input.parcelAcres == null) {
    return {
      status: 'unresolved',
      plausibleLots: null,
      evidenceUsed,
      limitingFactors: [...limitingFactors, 'Parcel acreage is not established.'],
      scopeNote: PLANNING_SCOPE_NOTE,
    };
  }

  return {
    status: limitingFactors.length ? 'provisional' : 'established',
    plausibleLots: input.legal.maximumLots,
    evidenceUsed,
    limitingFactors,
    scopeNote: PLANNING_SCOPE_NOTE,
  };
}

/* ───────────────────────────── house carveout ────────────────────────── */

export interface CarveoutInput {
  parcelAcres: number | null;
  hasImprovements: boolean;
  minimumLotAcres: number | null;
  minimumLotStandard: DimensionalStandard | undefined;
  /** Site facts that a small retained lot could collide with. */
  siteConstraints: ReadonlyArray<{ factor: string; detail: string; known: boolean }>;
  /** An acreage the seller has discussed, when one exists. Never treated as optimal. */
  sellerDiscussedAcres: number | null;
}

const STANDARD_CARVEOUT_INCREMENTS = [1, 2, 3, 4, 5];

/**
 * Test candidate retained-acreage configurations around existing improvements.
 *
 * The seller's own figure is tested like any other candidate and is never
 * treated as the answer. Configurations that collide with a verified rule are
 * eliminated with the reason stated; configurations whose collision cannot be
 * checked stay `unverified` rather than being quietly accepted.
 */
export function buildCarveoutConcepts(input: CarveoutInput): CarveoutConcept[] {
  if (!input.hasImprovements || input.parcelAcres == null) return [];

  // The seller's own figure is tested FIRST so its provenance survives
  // deduplication against the standard increments. It gets no other special
  // standing: it faces exactly the same checks and can be eliminated by them.
  const candidates: Array<{ acres: number; basis: CarveoutConcept['basis'] }> = [];
  if (input.sellerDiscussedAcres != null) {
    candidates.push({ acres: input.sellerDiscussedAcres, basis: 'seller_discussed' });
  }
  if (input.minimumLotAcres != null) {
    candidates.push({ acres: Number(input.minimumLotAcres.toFixed(2)), basis: 'ordinance_minimum' });
  }
  for (const increment of STANDARD_CARVEOUT_INCREMENTS) {
    if (increment >= input.parcelAcres) break;
    candidates.push({ acres: increment, basis: 'standard_increment' });
  }

  const seen = new Set<string>();
  const concepts: CarveoutConcept[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.acres}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const checks: CarveoutConcept['checks'] = [];
    let viability: CarveoutConcept['viability'] = 'plausible';
    let eliminationReason: string | null = null;

    if (input.minimumLotAcres != null) {
      const satisfied = candidate.acres >= input.minimumLotAcres;
      checks.push({
        factor: 'Minimum lot area',
        outcome: satisfied ? 'satisfied' : 'conflict',
        detail: `${candidate.acres} ac against a verified minimum of ${input.minimumLotAcres.toFixed(2)} ac${input.minimumLotStandard ? ` (${input.minimumLotStandard.statedValue})` : ''}.`,
      });
      if (!satisfied) {
        viability = 'conflicts_with_known_rule';
        eliminationReason = `A ${candidate.acres}-acre retained lot is smaller than the verified minimum lot area.`;
      }
    } else {
      checks.push({ factor: 'Minimum lot area', outcome: 'unknown', detail: 'No minimum lot area is verified for this parcel.' });
      viability = viability === 'plausible' ? 'unverified' : viability;
    }

    const residual = input.parcelAcres - candidate.acres;
    const residualOk = residual > 0 && (input.minimumLotAcres == null || residual >= input.minimumLotAcres);
    checks.push({
      factor: 'Residual acreage',
      outcome: residual <= 0 ? 'conflict' : residualOk ? 'satisfied' : 'conflict',
      detail: `${residual.toFixed(2)} ac would remain outside the retained lot.`,
    });
    if (residual <= 0) {
      viability = 'conflicts_with_known_rule';
      eliminationReason = 'The retained acreage would consume the whole parcel, leaving nothing to divide.';
    } else if (!residualOk && input.minimumLotAcres != null) {
      viability = 'conflicts_with_known_rule';
      eliminationReason = 'The residual would be smaller than the verified minimum lot area, so it could not stand as its own lot.';
    }

    for (const constraint of input.siteConstraints) {
      checks.push({
        factor: constraint.factor,
        outcome: constraint.known ? 'unknown' : 'unknown',
        detail: constraint.detail,
      });
    }
    if (input.siteConstraints.length && viability === 'plausible') viability = 'unverified';

    concepts.push({ retainedAcres: candidate.acres, basis: candidate.basis, viability, checks, eliminationReason });
  }

  return concepts;
}

/* ──────────────────────────────── scenarios ──────────────────────────── */

export interface ScenarioInput {
  parcelAcres: number | null;
  hasImprovements: boolean;
  legal: LegalYield;
  physical: PhysicalYield;
  carveouts: readonly CarveoutConcept[];
  uses: readonly UseDetermination[];
  paths: readonly SubdivisionPath[];
  accessConstraint: string;
  /** Verification debt that applies to every scenario. */
  globalVerification: readonly string[];
}

function acreageBand(acres: number): string {
  const low = Math.max(0.25, acres * 0.85);
  const high = acres * 1.15;
  return `${low.toFixed(1)}–${high.toFixed(1)} ac`;
}

function compsRequestFor(
  scenario: { lots: number | null; houseBand: string | null; lotBand: string | null },
  uses: readonly UseDetermination[],
  restsOnVerifiedLaw: boolean,
): CompsResearchRequest {
  const requests: CompsResearchRequest['requests'] = [];
  if (scenario.houseBand) {
    requests.push({
      label: `Site-built homes on ${scenario.houseBand}`,
      propertyKind: 'improved_residential',
      acreageBand: scenario.houseBand,
      status: 'both',
      rationale: 'Prices the retained improved lot the scenario creates.',
    });
  }
  if (scenario.lotBand) {
    requests.push({
      label: `Closed vacant land ${scenario.lotBand}`,
      propertyKind: 'vacant_land',
      acreageBand: scenario.lotBand,
      status: 'closed',
      rationale: 'Establishes realized value for the residual lots.',
    });
    requests.push({
      label: `Active vacant land ${scenario.lotBand}`,
      propertyKind: 'vacant_land',
      acreageBand: scenario.lotBand,
      status: 'active',
      rationale: 'Shows current competition for the residual lots.',
    });
  }

  // A manufactured-eligible comp set is requested only where the legal status
  // makes it material — asking for it everywhere would generate noise, and
  // omitting it where a double-wide is by right would understate the market.
  const singleWide = statusFor(uses, 'manufactured_single_wide');
  const doubleWide = statusFor(uses, 'manufactured_double_wide');
  if (scenario.lotBand && (isByRight(singleWide) || isByRight(doubleWide))) {
    requests.push({
      label: `Manufactured-home-eligible vacant land ${scenario.lotBand}`,
      propertyKind: 'manufactured_eligible_land',
      acreageBand: scenario.lotBand,
      status: 'both',
      rationale: 'A manufactured home is allowed by right on the resulting lots, which widens the buyer pool materially.',
    });
  }

  return { requests, restsOnVerifiedLaw };
}

/**
 * Build the candidate scenarios handed to Comps & Valuation and Strategy.
 *
 * Scenarios are generated from the resolved facts, so a property whose legal
 * yield is unresolved still produces the one scenario that is always available
 * — keeping the parcel intact — rather than an empty section.
 */
export function buildScenarios(input: ScenarioInput): LandUseScenario[] {
  const scenarios: LandUseScenario[] = [];
  const siteBuilt = statusFor(input.uses, 'site_built_single_family');
  const modular = statusFor(input.uses, 'modular_home');
  const singleWide = statusFor(input.uses, 'manufactured_single_wide');
  const doubleWide = statusFor(input.uses, 'manufactured_double_wide');

  const byRightPath = input.paths.find((path) => path.isByRight);
  const pathLabel = byRightPath
    ? `${byRightPath.originalTerm}${byRightPath.objectiveApprovals.length ? `, subject to ${byRightPath.objectiveApprovals.slice(0, 4).join(', ')}` : ''}`
    : 'No by-right division path is established.';

  const baseVerification = [...input.globalVerification];

  /* A. Keep intact. Always available and always legally clean. */
  scenarios.push({
    name: 'Keep intact',
    support: 'supported_for_comp_research',
    legalStatus: 'No division is proposed, so no subdivision approval is required.',
    resultingLotCount: 1,
    acreageBands: input.parcelAcres != null ? [acreageBand(input.parcelAcres)] : [],
    improvementStatus: input.hasImprovements ? 'Existing improvements retained on the whole parcel.' : 'Vacant parcel retained whole.',
    siteBuiltStatus: siteBuilt,
    modularStatus: modular,
    manufacturedSingleWideStatus: singleWide,
    manufacturedDoubleWideStatus: doubleWide,
    accessConstraint: input.accessConstraint,
    subdivisionPath: 'None required.',
    remainingVerification: baseVerification,
    compsResearchRequest: compsRequestFor(
      {
        lots: 1,
        houseBand: input.hasImprovements && input.parcelAcres != null ? acreageBand(input.parcelAcres) : null,
        lotBand: !input.hasImprovements && input.parcelAcres != null ? acreageBand(input.parcelAcres) : null,
      },
      input.uses,
      true,
    ),
  });

  /* B/C. House carveout scenarios, from concepts that survived the checks. */
  const viableCarveouts = input.carveouts.filter((concept) => concept.viability !== 'conflicts_with_known_rule');
  for (const concept of viableCarveouts.slice(0, 3)) {
    if (input.parcelAcres == null) continue;
    const residual = input.parcelAcres - concept.retainedAcres;
    if (residual <= 0) continue;

    const legalLots = input.legal.maximumLots;
    const residualLots = legalLots != null && legalLots > 1 ? Math.max(1, legalLots - 1) : 1;
    const residualEach = residual / residualLots;

    const support: LandUseScenario['support'] =
      input.legal.status === 'established' && concept.viability === 'plausible' && !!byRightPath
        ? 'supported_for_comp_research'
        : !byRightPath && input.legal.status === 'unresolved'
          ? 'not_currently_supported'
          : 'requires_verification';

    scenarios.push({
      // The retained acreage is part of the NAME. Three carveout concepts that
      // differ only in retained size otherwise arrive downstream as three
      // identically-titled scenarios, which is indistinguishable from a bug and
      // makes the comps requests impossible to tell apart.
      name: residualLots > 1
        ? `House carveout at ${concept.retainedAcres} ac + ${residualLots} residual lots`
        : `House carveout at ${concept.retainedAcres} ac + one residual parcel`,
      support,
      legalStatus: byRightPath
        ? `Relies on the ${byRightPath.originalTerm} procedure, which requires no discretionary entitlement.`
        : 'No by-right division path is established for this parcel.',
      resultingLotCount: support === 'not_currently_supported' ? null : residualLots + 1,
      acreageBands: [acreageBand(concept.retainedAcres), acreageBand(residualEach)],
      improvementStatus: `Improvements retained on approximately ${concept.retainedAcres} ac (${concept.basis.replace(/_/g, ' ')}).`,
      siteBuiltStatus: siteBuilt,
      modularStatus: modular,
      manufacturedSingleWideStatus: singleWide,
      manufacturedDoubleWideStatus: doubleWide,
      accessConstraint: input.accessConstraint,
      subdivisionPath: pathLabel,
      remainingVerification: [
        ...baseVerification,
        ...concept.checks.filter((check) => check.outcome === 'unknown').map((check) => `${check.factor}: ${check.detail}`),
        ...(input.legal.status !== 'established' ? [input.legal.reason] : []),
      ],
      compsResearchRequest: compsRequestFor(
        { lots: residualLots + 1, houseBand: acreageBand(concept.retainedAcres), lotBand: acreageBand(residualEach) },
        input.uses,
        support === 'supported_for_comp_research',
      ),
    });
  }

  /* D. The maximum legally allowed division, when one is established. */
  if (input.legal.maximumLots != null && input.legal.maximumLots > 1 && input.parcelAcres != null) {
    const each = input.parcelAcres / input.legal.maximumLots;
    scenarios.push({
      name: `Maximum by-right division (${input.legal.maximumLots} lots)`,
      support: input.legal.status === 'established' ? 'supported_for_comp_research' : 'requires_verification',
      legalStatus: input.legal.reason,
      resultingLotCount: input.legal.maximumLots,
      acreageBands: [acreageBand(each)],
      improvementStatus: input.hasImprovements ? 'Existing improvements would sit on one of the resulting lots.' : 'No improvements.',
      siteBuiltStatus: siteBuilt,
      modularStatus: modular,
      manufacturedSingleWideStatus: singleWide,
      manufacturedDoubleWideStatus: doubleWide,
      accessConstraint: input.accessConstraint,
      subdivisionPath: pathLabel,
      remainingVerification: [...baseVerification, ...input.legal.missingInputs.map((item) => `Required input still missing: ${item}.`)],
      compsResearchRequest: compsRequestFor(
        { lots: input.legal.maximumLots, houseBand: null, lotBand: acreageBand(each) },
        input.uses,
        input.legal.status === 'established',
      ),
    });
  }

  return scenarios;
}

/* ────────────────────────── discovery questions ──────────────────────── */

export interface DiscoveryQuestionInput {
  parentTractHistoryRequired: boolean;
  surveyUnknown: boolean;
  accessAgreementsUnknown: boolean;
  drivewayPermitUnknown: boolean;
  wellSepticLocationUnknown: boolean;
  reserveFieldUnknown: boolean;
  utilitiesUnknown: boolean;
  privateRestrictionsUnknown: boolean;
  manufacturedHomePresent: boolean;
}

/**
 * Questions generated from real unresolved property facts.
 *
 * Every question traces to something the research could not settle, so the
 * discovery call asks about what actually blocks a conclusion rather than
 * working through a generic checklist. Answers remain seller-reported and never
 * become legal verification.
 */
export function buildDiscoveryQuestions(input: DiscoveryQuestionInput): DiscoveryQuestion[] {
  const questions: DiscoveryQuestion[] = [];
  const add = (question: string, because: string, unblocks: string) =>
    questions.push({ question, because, unblocks, answerStatus: 'seller_reported' });

  if (input.parentTractHistoryRequired) {
    add(
      'Has any part of this property ever been split off or sold separately, and when?',
      'The controlling division rule counts divisions already taken from the parent tract.',
      'Converts the legal maximum from unresolved to a computable number.',
    );
  }
  if (input.surveyUnknown) {
    add('Do you have a survey of the property, and how recent is it?', 'No survey is on file, so boundaries and frontage are unverified.', 'Lets frontage and lot-configuration screening use real dimensions.');
  }
  if (input.accessAgreementsUnknown) {
    add('Are there any recorded access or easement agreements affecting the property?', 'Recorded private access rights are not established.', 'Determines whether shared or private access is already available.');
  }
  if (input.drivewayPermitUnknown) {
    add('Is the existing driveway permitted, and do you have the permit?', 'An existing access point does not by itself establish a permitted one.', 'Decides whether existing access can be relied on and whether a new one is needed.');
  }
  if (input.wellSepticLocationUnknown) {
    add('Where exactly are the well and the septic system on the property?', 'Their locations constrain where a retained lot line can go.', 'Makes the house-carveout screening realistic.');
  }
  if (input.reserveFieldUnknown) {
    add('Is there a designated replacement or reserve septic field, and where?', 'Reserve field requirements can consume usable area.', 'Determines whether the retained lot can meet health requirements.');
  }
  if (input.utilitiesUnknown) {
    add('What utilities are connected, and are there additional connections on the property?', 'Utility service to resulting lots is not established.', 'Affects lot marketability and any utility requirement in the division procedure.');
  }
  if (input.privateRestrictionsUnknown) {
    add('Are there any deed restrictions, covenants or HOA rules on the property?', 'Private restrictions are separate from zoning and were not researched.', 'Reveals private limits that governmental research cannot see.');
  }
  if (input.manufacturedHomePresent) {
    add('If there is a manufactured home on the property, is it separately titled or converted to real property?', 'Titling determines whether the home conveys with the land.', 'Affects how the improvement is valued and what transfers at closing.');
  }
  return questions;
}

/** Path kinds that never count as by-right, regardless of how they are written. */
export const NEVER_BY_RIGHT_PATHS: readonly SubdivisionPathKind[] = ['major_subdivision'];
