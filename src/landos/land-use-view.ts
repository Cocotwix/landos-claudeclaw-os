// LandOS — operator projection for LAND USE & SUBDIVISION (PART 19).
//
// The panel answers four questions about every conclusion and nothing else:
//
//   What is the rule?    Who says so?    How confident are we?    What is missing?
//
// Scraping diagnostics, request counts, layer metadata, raw payloads and lane
// internals stay in the retained determination. A panel that dumps diagnostics
// stops being read, and an operator who stops reading the panel makes the
// decision without it.
//
// One rule shapes the whole projection: an unestablished value is rendered as a
// named unresolved state, never as a blank. A blank in a legal panel gets read
// as "no restriction", which is the opposite of what it means.

import {
  accessStatusLabel,
  authorityRoleLabel,
  authorityPatternLabel,
  classificationKindLabel,
  dimensionalStandardLabel,
  evidenceQualityLabel,
  landUseFailureLabel,
  landUseLaneLabel,
  objectiveConditionLabel,
  reviewPathLabel,
  scenarioSupportLabel,
  stateFrameworkKindLabel,
  structureTypeLabel,
  subdivisionPathLabel,
  useLegalStatusLabel,
  type EvidencedValue,
  type LandUseDetermination,
  type LegalSourceCitation,
  type ResolvedAuthority,
  type StructureType,
  type UseLegalStatus,
} from './land-use-types.js';
import { getLandUseDetermination } from './land-use-store.js';

/* ────────────────────────────── view shapes ──────────────────────────── */

export interface ValueView {
  /** The rule, as an operator reads it. Null when nothing is established. */
  value: string | null;
  /** Named unresolved state, present exactly when `value` is null. */
  unresolved: string | null;
  qualityLabel: string;
  quality: string;
  /** Sources behind this value, already trimmed for display. */
  sources: SourceView[];
  /** Present only when official sources disagree. */
  conflict: { statement: string; sides: Array<{ label: string; url: string; says: string }> } | null;
}

export interface SourceView {
  label: string;
  url: string;
  citation: string | null;
  publisher: string | null;
  tier: string;
  /** True for the tiers that may establish a legal conclusion. */
  isPrimary: boolean;
  excerpt: string | null;
  effectiveDate: string | null;
}

export interface AuthorityView {
  role: string;
  roleLabel: string;
  body: ValueView;
  unitType: string;
  relationship: string | null;
  officialUrl: string | null;
}

export interface UseView {
  structureType: StructureType;
  structureLabel: string;
  status: UseLegalStatus;
  statusLabel: string;
  /** True only for the two by-right statuses. Drives the badge. */
  isByRight: boolean;
  reasoning: string;
  unresolved: string | null;
  qualityLabel: string;
  conditions: Array<{ label: string; requirement: string; sourceUrl: string }>;
  statePreemption: { effectLabel: string; statement: string; interaction: string; sources: SourceView[] } | null;
  sources: SourceView[];
}

export interface ScenarioView {
  name: string;
  support: string;
  supportLabel: string;
  legalStatus: string;
  resultingLotCount: number | null;
  acreageBands: string[];
  improvementStatus: string;
  siteBuiltLabel: string;
  modularLabel: string;
  singleWideLabel: string;
  doubleWideLabel: string;
  accessConstraint: string;
  subdivisionPath: string;
  remainingVerification: string[];
  compsRequests: Array<{ label: string; acreageBand: string; status: string; rationale: string }>;
  compsRestOnVerifiedLaw: boolean;
}

export interface LandUseView {
  /** False when the lane has never run for this deal. */
  present: boolean;
  determinedAt: string | null;

  subject: { address: string | null; county: string | null; state: string | null; acres: number | null; parcelId: string | null };

  governingAuthority: {
    pattern: string;
    patternLabel: string;
    patternExplanation: string;
    incorporation: ValueView;
    authorities: AuthorityView[];
  };

  stateFramework: {
    status: string;
    statusLabel: string;
    provisions: Array<{ kindLabel: string; summary: string; materiality: string; source: SourceView }>;
    localAuthorityRetained: ValueView;
    sourcesSearchedCount: number;
    sourcesReadCount: number;
  };

  zoning: {
    presence: string;
    presenceLabel: string;
    code: ValueView;
    districtName: ValueView;
    classificationLabel: string;
    governingAuthority: string | null;
    /** Present when a code value exists that is NOT adopted zoning. */
    nonZoningClassification: { code: string; description: string | null; kindLabel: string; sourceUrl: string | null; caveat: string } | null;
    sourceDisclaimer: string | null;
  };

  byRightUses: UseView[];
  manufacturedHousing: UseView[];
  privateRestrictions: Array<{ statusLabel: string; statement: string }>;

  dimensionalStandards: Array<{ label: string; originalTerm: string; statedValue: string; qualifier: string | null; source: SourceView }>;

  subdivision: {
    governingBody: string | null;
    ordinanceLabel: string | null;
    ordinanceUrl: string | null;
    paths: Array<{
      kindLabel: string;
      originalTerm: string;
      isByRight: boolean;
      maximumLots: ValueView;
      reviewPathLabel: string;
      discretionaryApprovals: string[];
      objectiveApprovals: string[];
      definition: ValueView;
    }>;
    parentTract: {
      applies: ValueView;
      lookbackPeriod: ValueView;
      priorDivisionHistoryRequired: boolean;
      requiredVerificationStep: string | null;
    };
    minimumLotArea: ValueView;
    minimumLotWidth: ValueView;
    minimumRoadFrontage: ValueView;
    flagLots: ValueView;
    sharedDriveways: ValueView;
    privateRoads: ValueView;
    newRoadTrigger: ValueView;
    surveyRequirement: ValueView;
    platRequirement: ValueView;
    reviewPathSummary: string;
  };

  /**
   * Present ONLY when the controlling local jurisdiction was not confirmed. It
   * carries its own label and blocker so the operator can never read county
   * rules as the governing rules.
   */
  countySubdivisionFallback: {
    label: string;
    blocker: string;
    county: string | null;
    state: string | null;
    summary: string;
    authorityAttempts: string[];
    minimumLotArea: ValueView;
    minimumLotWidth: ValueView;
    minimumRoadFrontage: ValueView;
    publicRoadFrontageRequired: ValueView;
    newRoadTrigger: ValueView;
    surveyRequirement: ValueView;
    platRequirement: ValueView;
    recordingRequirement: ValueView;
    septicRequirement: ValueView;
    wellRequirement: ValueView;
    utilityRequirement: ValueView;
    applicationFee: ValueView;
    publishedReviewTimeline: ValueView;
    paths: Array<{
      kindLabel: string;
      originalTerm: string;
      isByRight: boolean;
      maximumLots: ValueView;
      reviewPathLabel: string;
      definition: ValueView;
    }>;
    ordinanceLabel: string | null;
    ordinanceUrl: string | null;
    sources: SourceView[];
  } | null;

  access: {
    roadName: string | null;
    roadType: ValueView;
    statusLabel: string;
    authority: AuthorityView | null;
    drivewayPermitRequired: ValueView;
    spacingStandards: ValueView;
    constraintNotes: string[];
  };

  septicWell: {
    authority: AuthorityView | null;
    perLotApprovalRequired: ValueView;
    divisionRequiresHealthReview: ValueView;
    minimumAcreage: ValueView;
    reserveFieldRequirement: ValueView;
    existingSepticInfluence: string | null;
    existingWellInfluence: string | null;
    unresolved: string[];
    scopeNote: string;
  };

  subjectPotential: {
    legal: { statusLabel: string; maximumLots: number | null; reason: string; constraintsApplied: Array<{ constraint: string; value: string }>; missingInputs: string[] };
    physical: { statusLabel: string; plausibleLots: number | null; limitingFactors: string[]; scopeNote: string };
    carveouts: Array<{ retainedAcres: number; basisLabel: string; viabilityLabel: string; eliminationReason: string | null; checks: Array<{ factor: string; outcome: string; detail: string }> }>;
    scenarios: ScenarioView[];
  };

  discoveryQuestions: Array<{ question: string; because: string; unblocks: string }>;

  /** PART 19 — the explicit "what could change this" block. */
  whatCouldChangeThis: string[];
  failureStates: Array<{ code: string; label: string }>;
  sources: SourceView[];
  lanes: Array<{ label: string; status: string; detail: string }>;
}

/* ─────────────────────────────── mapping ─────────────────────────────── */

const PRIMARY_TIERS = new Set(['secondary_discovery_only']);

function toSource(citation: LegalSourceCitation): SourceView {
  return {
    label: citation.label,
    url: citation.url,
    citation: citation.citation,
    publisher: citation.publisher,
    tier: citation.tier,
    isPrimary: !PRIMARY_TIERS.has(citation.tier),
    excerpt: citation.excerpt,
    effectiveDate: citation.effectiveDate,
  };
}

/**
 * Project an evidenced value.
 *
 * `value` and `unresolved` are mutually exclusive by construction, so the panel
 * can never render an empty rule row that reads as "no requirement".
 */
export function toValueView<T>(value: EvidencedValue<T>, format?: (raw: T) => string): ValueView {
  const rendered = value.value == null
    ? null
    : format ? format(value.value)
      : typeof value.value === 'boolean' ? (value.value ? 'Yes' : 'No')
        : String(value.value);
  return {
    value: rendered,
    unresolved: rendered == null ? value.unresolvedReason ?? 'Not established.' : null,
    quality: value.quality,
    qualityLabel: evidenceQualityLabel(value.quality),
    sources: value.citations.slice(0, 4).map(toSource),
    conflict: value.conflict
      ? {
          statement: value.conflict.statement,
          sides: value.conflict.sides.map((side) => ({ label: side.citation.label, url: side.citation.url, says: side.says })),
        }
      : null,
  };
}

function toAuthorityView(authority: ResolvedAuthority): AuthorityView {
  return {
    role: authority.role,
    roleLabel: authorityRoleLabel(authority.role),
    body: toValueView(authority.name),
    unitType: authority.unitType.replace(/_/g, ' '),
    relationship: authority.relationship,
    officialUrl: authority.officialUrl,
  };
}

function toUseView(use: LandUseDetermination['uses'][number]): UseView {
  return {
    structureType: use.structureType,
    structureLabel: structureTypeLabel(use.structureType),
    status: use.status,
    statusLabel: useLegalStatusLabel(use.status),
    isByRight: use.status === 'allowed_by_right' || use.status === 'allowed_by_right_with_objective_conditions',
    reasoning: use.reasoning,
    unresolved: use.unresolvedReason,
    qualityLabel: evidenceQualityLabel(use.quality),
    conditions: use.conditions.slice(0, 12).map((condition) => ({
      label: objectiveConditionLabel(condition.kind),
      requirement: condition.requirement,
      sourceUrl: condition.citation.url,
    })),
    statePreemption: use.statePreemption
      ? {
          effectLabel: use.statePreemption.effect.replace(/_/g, ' '),
          statement: use.statePreemption.statement,
          interaction: use.statePreemption.interaction,
          sources: use.statePreemption.citations.map(toSource),
        }
      : null,
    sources: use.citations.slice(0, 4).map(toSource),
  };
}

/** An honest empty view, so a Deal Card that never ran the lane says so. */
export function emptyLandUseView(): LandUseView {
  const empty: ValueView = { value: null, unresolved: 'Not researched.', quality: 'unverified', qualityLabel: 'Unverified', sources: [], conflict: null };
  return {
    present: false,
    determinedAt: null,
    subject: { address: null, county: null, state: null, acres: null, parcelId: null },
    governingAuthority: { pattern: 'unresolved', patternLabel: 'Not researched', patternExplanation: '', incorporation: empty, authorities: [] },
    stateFramework: { status: 'unverified', statusLabel: 'Not researched', provisions: [], localAuthorityRetained: empty, sourcesSearchedCount: 0, sourcesReadCount: 0 },
    zoning: {
      presence: 'zoning_unverified', presenceLabel: 'Not researched', code: empty, districtName: empty,
      classificationLabel: 'Kind not established', governingAuthority: null, nonZoningClassification: null, sourceDisclaimer: null,
    },
    byRightUses: [],
    manufacturedHousing: [],
    privateRestrictions: [],
    dimensionalStandards: [],
    subdivision: {
      governingBody: null, ordinanceLabel: null, ordinanceUrl: null, paths: [],
      parentTract: { applies: empty, lookbackPeriod: empty, priorDivisionHistoryRequired: false, requiredVerificationStep: null },
      minimumLotArea: empty, minimumLotWidth: empty, minimumRoadFrontage: empty, flagLots: empty,
      sharedDriveways: empty, privateRoads: empty, newRoadTrigger: empty, surveyRequirement: empty,
      platRequirement: empty, reviewPathSummary: 'Not researched.',
    },
    countySubdivisionFallback: null,
    access: { roadName: null, roadType: empty, statusLabel: 'Not researched', authority: null, drivewayPermitRequired: empty, spacingStandards: empty, constraintNotes: [] },
    septicWell: {
      authority: null, perLotApprovalRequired: empty, divisionRequiresHealthReview: empty,
      minimumAcreage: empty, reserveFieldRequirement: empty, existingSepticInfluence: null,
      existingWellInfluence: null, unresolved: [], scopeNote: '',
    },
    subjectPotential: {
      legal: { statusLabel: 'Not researched', maximumLots: null, reason: '', constraintsApplied: [], missingInputs: [] },
      physical: { statusLabel: 'Not researched', plausibleLots: null, limitingFactors: [], scopeNote: '' },
      carveouts: [], scenarios: [],
    },
    discoveryQuestions: [],
    whatCouldChangeThis: [],
    failureStates: [],
    sources: [],
    lanes: [],
  };
}

const ZONING_PRESENCE_LABELS: Record<string, string> = {
  zoning_established: 'Zoning established',
  no_conventional_zoning: 'No conventional zoning',
  zoning_unverified: 'Zoning unverified',
};

const STATE_FRAMEWORK_LABELS: Record<string, string> = {
  present: 'Present',
  not_found: 'Not found',
  not_applicable: 'Not applicable',
  unverified: 'Unverified',
};

const YIELD_LABELS: Record<string, string> = {
  established: 'Established',
  provisional: 'Provisional',
  unresolved: 'Unresolved',
};

export function toLandUseView(determination: LandUseDetermination): LandUseView {
  const { authority, zoning, subdivision, access, septicWell } = determination;
  const fallback = determination.countySubdivisionFallback ?? null;

  const manufacturedTypes = new Set<StructureType>([
    'modular_home', 'manufactured_single_wide', 'manufactured_double_wide',
    'manufactured_multi_section', 'pre_hud_mobile_home', 'used_manufactured_home',
    'new_manufactured_home', 'manufactured_replacement_of_existing',
  ]);

  // The headline residential uses an operator judges a deal on. Ordered so the
  // three that move price most sit at the top rather than buried in a list.
  const headline: StructureType[] = [
    'site_built_single_family', 'modular_home',
    'manufactured_single_wide', 'manufactured_double_wide',
    'manufactured_replacement_of_existing',
  ];

  const useByType = new Map(determination.uses.map((use) => [use.structureType, use]));

  const nonZoning = zoning.nonZoningClassification;

  return {
    present: true,
    determinedAt: determination.determinedAt,
    subject: {
      address: determination.subject.address,
      county: determination.subject.county,
      state: determination.subject.state,
      acres: determination.subject.acres,
      parcelId: determination.subject.parcelId,
    },

    governingAuthority: {
      pattern: authority.pattern,
      patternLabel: authorityPatternLabel(authority.pattern),
      patternExplanation: authority.patternExplanation,
      incorporation: toValueView(authority.incorporation, (value) => value === 'incorporated' ? 'Incorporated' : value === 'unincorporated' ? 'Unincorporated' : 'Unverified'),
      authorities: [
        authority.state, authority.county, authority.localUnit,
        authority.zoningAuthority, authority.subdivisionAuthority,
        authority.septicHealthAuthority, authority.roadAccessAuthority,
        ...authority.otherAuthorities,
      ].map(toAuthorityView),
    },

    stateFramework: {
      status: determination.stateFramework.status,
      statusLabel: STATE_FRAMEWORK_LABELS[determination.stateFramework.status] ?? determination.stateFramework.status,
      provisions: determination.stateFramework.provisions.map((provision) => ({
        kindLabel: stateFrameworkKindLabel(provision.kind),
        summary: provision.summary,
        materiality: provision.materiality,
        source: toSource(provision.citation),
      })),
      localAuthorityRetained: toValueView(determination.stateFramework.localAuthorityRetained),
      sourcesSearchedCount: determination.stateFramework.sourcesSearched.length,
      sourcesReadCount: determination.stateFramework.sourcesSearched.filter((entry) => entry.outcome === 'read').length,
    },

    zoning: {
      presence: zoning.presence,
      presenceLabel: ZONING_PRESENCE_LABELS[zoning.presence] ?? zoning.presence,
      code: toValueView(zoning.code),
      districtName: toValueView(zoning.districtName),
      classificationLabel: classificationKindLabel(zoning.classificationKind),
      governingAuthority: zoning.governingAuthority,
      // The whole point of this block: a value that is NOT adopted zoning is
      // shown, labelled, and accompanied by a plain-language warning rather
      // than being silently dropped or silently promoted.
      nonZoningClassification: nonZoning
        ? {
            code: nonZoning.code,
            description: nonZoning.description,
            kindLabel: classificationKindLabel(nonZoning.kind),
            sourceUrl: nonZoning.sourceUrl,
            caveat: nonZoning.kind === 'assessment_classification'
              ? 'This is an assessment classification, not adopted zoning. It drives assessment and must not be treated as what may lawfully be built.'
              : 'LandOS could not confirm this value is adopted zoning, so it is not presented as the zoning district.',
          }
        : null,
      sourceDisclaimer: zoning.sourceDisclaimer,
    },

    byRightUses: headline.map((type) => useByType.get(type)).filter(Boolean).map((use) => toUseView(use!)),
    manufacturedHousing: determination.uses.filter((use) => manufacturedTypes.has(use.structureType)).map(toUseView),
    privateRestrictions: determination.privateRestrictions.map((restriction) => ({
      statusLabel: restriction.status.replace(/_/g, ' '),
      statement: restriction.statement,
    })),

    dimensionalStandards: determination.dimensionalStandards.map((standard) => ({
      label: dimensionalStandardLabel(standard.kind),
      originalTerm: standard.originalTerm,
      statedValue: standard.statedValue,
      qualifier: standard.qualifier,
      source: toSource(standard.citation),
    })),

    subdivision: {
      governingBody: subdivision.governingBody,
      ordinanceLabel: subdivision.ordinanceLabel,
      ordinanceUrl: subdivision.ordinanceUrl,
      paths: subdivision.paths.map((path) => ({
        kindLabel: subdivisionPathLabel(path.kind),
        originalTerm: path.originalTerm,
        isByRight: path.isByRight,
        maximumLots: toValueView(path.maximumLots, (value) => `${value} lots`),
        reviewPathLabel: reviewPathLabel(path.reviewPath),
        discretionaryApprovals: path.discretionaryApprovals,
        objectiveApprovals: path.objectiveApprovals,
        definition: toValueView(path.definition),
      })),
      parentTract: {
        applies: toValueView(subdivision.parentTract.applies),
        lookbackPeriod: toValueView(subdivision.parentTract.lookbackPeriod),
        priorDivisionHistoryRequired: subdivision.parentTract.priorDivisionHistoryRequired,
        requiredVerificationStep: subdivision.parentTract.requiredVerificationStep,
      },
      minimumLotArea: toValueView(subdivision.minimumLotArea),
      minimumLotWidth: toValueView(subdivision.minimumLotWidth),
      minimumRoadFrontage: toValueView(subdivision.minimumRoadFrontage),
      flagLots: toValueView(subdivision.flagLots),
      sharedDriveways: toValueView(subdivision.sharedDriveways),
      privateRoads: toValueView(subdivision.privateRoads),
      newRoadTrigger: toValueView(subdivision.newRoadTrigger),
      surveyRequirement: toValueView(subdivision.surveyRequirement),
      platRequirement: toValueView(subdivision.platRequirement),
      reviewPathSummary: subdivision.paths.length
        ? subdivision.paths.map((path) => `${path.originalTerm}: ${reviewPathLabel(path.reviewPath)}`).join('; ')
        : 'No division procedure was located, so the review path is unresolved.',
    },

    countySubdivisionFallback: fallback ? {
      label: fallback.label,
      blocker: fallback.blocker,
      county: fallback.county,
      state: fallback.state,
      summary: fallback.summary,
      authorityAttempts: fallback.authorityAttempts,
      minimumLotArea: toValueView(fallback.framework.minimumLotArea),
      minimumLotWidth: toValueView(fallback.framework.minimumLotWidth),
      minimumRoadFrontage: toValueView(fallback.framework.minimumRoadFrontage),
      publicRoadFrontageRequired: toValueView(fallback.framework.publicRoadFrontageRequired, (value) => value ? 'Required' : 'Not required'),
      newRoadTrigger: toValueView(fallback.framework.newRoadTrigger),
      surveyRequirement: toValueView(fallback.framework.surveyRequirement),
      platRequirement: toValueView(fallback.framework.platRequirement),
      recordingRequirement: toValueView(fallback.framework.recordingRequirement),
      septicRequirement: toValueView(fallback.framework.septicRequirement),
      wellRequirement: toValueView(fallback.framework.wellRequirement),
      utilityRequirement: toValueView(fallback.framework.utilityRequirement),
      applicationFee: toValueView(fallback.framework.applicationFee),
      publishedReviewTimeline: toValueView(fallback.framework.publishedReviewTimeline),
      paths: fallback.framework.paths.map((path) => ({
        kindLabel: subdivisionPathLabel(path.kind),
        originalTerm: path.originalTerm,
        isByRight: path.isByRight,
        maximumLots: toValueView(path.maximumLots, (value) => `${value} lots`),
        reviewPathLabel: reviewPathLabel(path.reviewPath),
        definition: toValueView(path.definition),
      })),
      ordinanceLabel: fallback.framework.ordinanceLabel,
      ordinanceUrl: fallback.framework.ordinanceUrl,
      sources: fallback.sources.map(toSource),
    } : null,

    access: {
      roadName: access.roadName,
      roadType: toValueView(access.roadType, (value) => value.replace(/_/g, ' ')),
      statusLabel: accessStatusLabel(access.status),
      authority: access.accessAuthority ? toAuthorityView(access.accessAuthority) : null,
      drivewayPermitRequired: toValueView(access.drivewayPermitRequired),
      spacingStandards: toValueView(access.spacingStandards),
      constraintNotes: access.constraintNotes,
    },

    septicWell: {
      authority: septicWell.authority ? toAuthorityView(septicWell.authority) : null,
      perLotApprovalRequired: toValueView(septicWell.perLotApprovalRequired),
      divisionRequiresHealthReview: toValueView(septicWell.divisionRequiresHealthReview),
      minimumAcreage: toValueView(septicWell.minimumAcreageForOnsiteSystem),
      reserveFieldRequirement: toValueView(septicWell.reserveFieldRequirement),
      existingSepticInfluence: septicWell.existingSepticInfluence,
      existingWellInfluence: septicWell.existingWellInfluence,
      unresolved: septicWell.unresolved,
      scopeNote: septicWell.scopeNote,
    },

    subjectPotential: {
      legal: {
        statusLabel: YIELD_LABELS[determination.legalYield.status] ?? determination.legalYield.status,
        maximumLots: determination.legalYield.maximumLots,
        reason: determination.legalYield.reason,
        constraintsApplied: determination.legalYield.constraintsApplied.map((entry) => ({ constraint: entry.constraint, value: entry.value })),
        missingInputs: determination.legalYield.missingInputs,
      },
      physical: {
        statusLabel: YIELD_LABELS[determination.physicalYield.status] ?? determination.physicalYield.status,
        plausibleLots: determination.physicalYield.plausibleLots,
        limitingFactors: determination.physicalYield.limitingFactors,
        scopeNote: determination.physicalYield.scopeNote,
      },
      carveouts: determination.carveouts.map((concept) => ({
        retainedAcres: concept.retainedAcres,
        basisLabel: concept.basis.replace(/_/g, ' '),
        viabilityLabel: concept.viability.replace(/_/g, ' '),
        eliminationReason: concept.eliminationReason,
        checks: concept.checks.map((check) => ({ factor: check.factor, outcome: check.outcome, detail: check.detail })),
      })),
      scenarios: determination.scenarios.map((scenario) => ({
        name: scenario.name,
        support: scenario.support,
        supportLabel: scenarioSupportLabel(scenario.support),
        legalStatus: scenario.legalStatus,
        resultingLotCount: scenario.resultingLotCount,
        acreageBands: scenario.acreageBands,
        improvementStatus: scenario.improvementStatus,
        siteBuiltLabel: useLegalStatusLabel(scenario.siteBuiltStatus),
        modularLabel: useLegalStatusLabel(scenario.modularStatus),
        singleWideLabel: useLegalStatusLabel(scenario.manufacturedSingleWideStatus),
        doubleWideLabel: useLegalStatusLabel(scenario.manufacturedDoubleWideStatus),
        accessConstraint: scenario.accessConstraint,
        subdivisionPath: scenario.subdivisionPath,
        remainingVerification: scenario.remainingVerification,
        compsRequests: scenario.compsResearchRequest.requests.map((request) => ({
          label: request.label,
          acreageBand: request.acreageBand,
          status: request.status,
          rationale: request.rationale,
        })),
        compsRestOnVerifiedLaw: scenario.compsResearchRequest.restsOnVerifiedLaw,
      })),
    },

    discoveryQuestions: determination.discoveryQuestions.map((question) => ({
      question: question.question,
      because: question.because,
      unblocks: question.unblocks,
    })),

    whatCouldChangeThis: determination.unresolved.slice(0, 20),
    failureStates: determination.failureStates.map((code) => ({ code, label: landUseFailureLabel(code) })),
    sources: determination.sources.map(toSource),
    lanes: determination.lanes.map((lane) => ({
      label: landUseLaneLabel(lane.lane),
      status: lane.status.replace(/_/g, ' '),
      detail: lane.detail,
    })),
  };
}

/**
 * The panel's data for one deal. SELECT-only and scoped by deal id, so no other
 * property's legal research can reach this surface.
 */
export function buildLandUseView(dealCardId: number): LandUseView {
  const record = getLandUseDetermination(dealCardId);
  if (!record) return emptyLandUseView();
  return toLandUseView(record.determination);
}
