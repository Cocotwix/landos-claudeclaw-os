// LandOS — PROPERTY EVIDENCE SYNTHESIS: the source-backed Property Story.
//
// By the time a subject is research-ready, LandOS already holds most of what an
// acquisition decision needs: assessor and GIS records, provider parcel facts,
// zoning and subdivision reads, access evidence, soils and flood layers,
// retained imagery and the vision observations taken from it. What it did not
// have was a reading — one place that says what all of it means for THIS
// transaction, with every statement still attached to the source that made it.
//
// This module is that reading, and it is deliberately DETERMINISTIC. It runs no
// model, opens no browser and makes no network call: it is a pure function over
// the acquisition dossier the workspace already assembles. That matters twice
// over — the synthesis costs nothing to produce, so it can be produced
// automatically the moment research settles; and it is byte-stable, so the same
// evidence writes the same snapshot instead of a new version on every read.
//
// FOUR STANDINGS, KEPT APART BY CONSTRUCTION.
//
//   official/legal fact   an official record says it
//   record fact           a provider or LandOS record says it
//   visual observation    a vision model reported it from actual pixels
//   analytical hypothesis LandOS inferred it and says so
//
// Collapsing those is how "the aerial shows a cleared lane to the road" becomes
// "the parcel has legal access". `GUARDED_CLAIMS` below enforces the rest: FMV,
// title, legal access, entitlement approval, utility availability and
// environmental clearance are never asserted from evidence that cannot carry
// them. When the evidence is short, the topic becomes a verification need with
// its gap named — never a confident answer.
//
// It decides nothing about identity. The subject arrives already accepted from
// the Stage 1/2 path; invariants 2-4 are held there, and nothing here promotes a
// related parcel's facts into the subject's.

import { createHash } from 'node:crypto';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { ExcludedParcel, SubjectUnderstandingResult } from './subject-understanding.js';
import {
  claim,
  standingBreakdown,
  synthesizeClaims,
  type ClaimSeed,
  type ClaimStanding,
  type SourcedClaim,
  type SynthesisConflict,
} from './source-aware-synthesis.js';

export const PROPERTY_EVIDENCE_SYNTHESIS_VERSION = '1.0.0';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type DiligenceTopicKey =
  | 'access'
  | 'frontage'
  | 'utilities'
  | 'well_septic'
  | 'taxes'
  | 'zoning'
  | 'development_status'
  | 'flood'
  | 'wetlands'
  | 'soils'
  | 'site_conditions';

export const DILIGENCE_TOPIC_LABEL: Record<DiligenceTopicKey, string> = {
  access: 'Access',
  frontage: 'Road frontage',
  utilities: 'Utilities',
  well_septic: 'Well and septic',
  taxes: 'Taxes and assessment',
  zoning: 'Zoning and land use',
  development_status: 'Development status',
  flood: 'Flood',
  wetlands: 'Wetlands',
  soils: 'Soils',
  site_conditions: 'Site conditions',
};

export type DiligenceStatus = 'established' | 'partial' | 'unresolved';

export interface DiligenceTopic {
  key: DiligenceTopicKey;
  label: string;
  status: DiligenceStatus;
  /** One sentence an operator can act on. */
  headline: string;
  claims: SourcedClaim[];
  /** What is missing, named precisely enough to go and get it. Null when the
   *  topic is established. */
  gap: string | null;
  /** What still needs official, title, legal or environmental verification. */
  verificationNeeded: string[];
}

/**
 * The provider's own assessment and tax figures.
 *
 * LandOS retains these from the parcel record long before the Assessor & Tax
 * capability reaches the county's own roll. Ignoring them made the Property
 * Story say "no assessment or tax record is retained" on a screen that was, at
 * that moment, displaying an assessed value and an annual tax figure — so they
 * are carried here, labelled as the provider record they are, and the official
 * roll stays the stronger source and the open diligence item.
 */
export interface ProviderAssessmentRecord {
  assessedValue: string | null;
  totalMarketValue: string | null;
  taxAmount: string | null;
  sourceName: string;
}

export interface RelatedBoundary {
  identifier: string;
  relationship: string;
  statement: string;
  /** Fact ids from the accepted subject reading that named it. */
  basis: string[];
}

export interface VisualReviewItem {
  capture: string;
  capturedAt: string | null;
  purpose: string | null;
  /** Null when the capture is retained but was never analyzed. */
  observation: string | null;
  category: string | null;
  signal: 'positive' | 'concern' | 'neutral' | null;
  /** The vision model that received the pixels, when one did. */
  model: string | null;
  analyzedAt: string | null;
  /** Always this: a capture is evidence, never a legal or official fact. */
  standing: 'visual_observation';
}

export interface PropertyStory {
  headline: string;
  strengths: string[];
  risks: string[];
  opportunities: string[];
  /** The few facts most likely to move acquisition economics, and why. */
  economicsDrivers: Array<{ fact: string; why: string }>;
}

export interface PropertySynthesisSubject {
  apn: string | null;
  apnDisplayVariants: string[];
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  fips: string | null;
  owner: string | null;
  acres: number | null;
  acreageBasis: string | null;
  /** What is actually being conveyed, from the accepted subject reading. */
  interest: { form: string; statement: string };
  subjectVersion: string | null;
  verification: {
    researchGrade: boolean;
    officiallyVerified: boolean;
    officialSource: string | null;
    /** Plain sentence naming the boundary between research and legal proof. */
    statement: string;
  };
}

export interface PropertyEvidenceSynthesis {
  contractVersion: typeof PROPERTY_EVIDENCE_SYNTHESIS_VERSION;
  dealCardId: number;
  /**
   * When this reading was formed. NULL on a reading read back from the store:
   * the persisted payload deliberately carries no wall-clock time so that the
   * same evidence hashes to the same snapshot. The retained row's own timestamp
   * is returned beside it instead.
   */
  generatedAt: string | null;
  /** Identity of the exact evidence this reading was formed from. */
  inputFingerprint: string;
  subject: PropertySynthesisSubject;
  /** Parcels, improvements and retained areas outside the transaction. */
  relatedBoundaries: RelatedBoundary[];
  /** Physical, property and record facts, ranked, each with its source. */
  recordFacts: SourcedClaim[];
  diligence: DiligenceTopic[];
  visualReview: VisualReviewItem[];
  /** The four standings, counted and indexed, so the separation is visible. */
  separation: {
    counts: Record<ClaimStanding, number>;
    officialLegalFactIds: string[];
    visualObservationIds: string[];
    analyticalHypothesisIds: string[];
    verificationNeedIds: string[];
  };
  story: PropertyStory;
  conflicts: SynthesisConflict[];
  /** Genuine duplicates collapsed, counted rather than hidden. */
  duplicatesCollapsed: number;
  limitations: string[];
  /** What LandOS deliberately did NOT claim, and what would let it. */
  guardrails: Array<{ claimKind: string; statement: string; unlockedBy: string }>;
  coverage: { present: string[]; absent: string[] };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const clean = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text && text !== '-' && text.toLowerCase() !== 'unknown' ? text : null;
};

const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** End a statement once. Several retained values already carry their own full
 *  stop, and appending a second one reads as a typo in an operator report. */
const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * Does this dossier carry an official record about the subject at all?
 *
 * Several guardrails turn on the answer, and asking it once keeps them
 * consistent: a jurisdiction-level source is not a parcel-level one.
 */
function hasOfficialParcelRecord(dossier: AcquisitionDossier): boolean {
  const record = dossier.officialAssessorRecord;
  if (!record) return false;
  const status = (record.recordStatus ?? '').toLowerCase();
  if (!status || status.includes('not_retrieved') || status.includes('unavailable')) return false;
  return !!(record.assessedAcres != null || record.ownerOfRecord || record.totalAppraisedValue != null);
}

/**
 * Claims LandOS may never assert from evidence that cannot carry them.
 *
 * Each entry states the condition under which the assertion WOULD be supported.
 * When the condition is unmet the topic degrades to a verification need with
 * its unlock named — which is a useful answer, and is not the same as silence.
 */
interface GuardedClaim {
  claimKind: string;
  /** True when the retained evidence genuinely supports the assertion. */
  supported: (dossier: AcquisitionDossier) => boolean;
  withheld: string;
  unlockedBy: string;
}

const GUARDED_CLAIMS: GuardedClaim[] = [
  {
    claimKind: 'Fair market value',
    supported: (dossier) => dossier.valuation.fairMarketValue != null
      && (dossier.valuation.acceptedCompCount ?? 0) > 0,
    withheld: 'No fair market value is asserted: no accepted comparable set supports one yet.',
    unlockedBy: 'An accepted sold-comparable set through Comps & Valuation.',
  },
  {
    claimKind: 'Title',
    // Nothing in LandOS reads a title commitment. Saying so plainly is the
    // honest answer; a deed in the document registry is not title.
    supported: () => false,
    withheld: 'No title position is asserted: LandOS holds no title commitment or examination for this parcel.',
    unlockedBy: 'A title commitment or attorney examination attached to the deal.',
  },
  {
    claimKind: 'Legal access',
    supported: (dossier) => !!clean(dossier.access.recordedLegalAccessStatement),
    withheld: 'No legal access is asserted: mapped or visible frontage is not a recorded access right.',
    unlockedBy: 'A recorded easement, plat dedication or deeded access instrument.',
  },
  {
    claimKind: 'Entitlement approval',
    supported: (dossier) => dossier.history.developmentEvents.some(
      (event) => (event.status ?? '').toLowerCase().includes('approved'),
    ),
    withheld: 'No entitlement approval is asserted: no approved application is recorded for this parcel.',
    unlockedBy: 'A recorded approval, permit or plat action on the subject parcel.',
  },
  {
    claimKind: 'Utility availability',
    supported: (dossier) => dossier.utilities.unresolved.length === 0
      && !!(clean(dossier.utilities.septicAuthority) || clean(dossier.utilities.perLotApproval)),
    withheld: 'No utility availability is asserted: no provider confirmed service to this parcel.',
    unlockedBy: 'A written availability response from the water, sewer or power provider.',
  },
  {
    claimKind: 'Environmental clearance',
    supported: () => false,
    withheld: 'No environmental clearance is asserted: flood, wetland and soil layers are screening data, not a delineation or assessment.',
    unlockedBy: 'A wetland delineation or Phase I environmental site assessment.',
  },
];

// ── Record facts ────────────────────────────────────────────────────────────

/**
 * Every physical, property and record fact the dossier carries, as claims.
 *
 * The official assessor record leads because it is the only parcel-level
 * official source LandOS retains; provider and derived figures follow and are
 * labelled as what they are. Where the two disagree the synthesis surfaces the
 * conflict rather than picking a side here.
 */
function recordFactSeeds(dossier: AcquisitionDossier): ClaimSeed[] {
  const seeds: ClaimSeed[] = [];
  const record = dossier.officialAssessorRecord;
  const parcelGeography = dossier.identity.apn ? `parcel ${dossier.identity.apn}` : 'subject parcel';

  // Recorded easements and restrictions from instruments the government-record
  // screening actually read. Carried verbatim as record facts; the risk read
  // and the Deal Brain pick them up from here.
  for (const encumbrance of dossier.recordedEncumbrances ?? []) {
    seeds.push({
      topic: 'record.encumbrances',
      label: 'Recorded easements and restrictions',
      statement: encumbrance.statement,
      value: encumbrance.statement,
      standing: 'official_legal_fact',
      weight: encumbrance.grade === 'confirmed_fact' ? 'confirmed' : 'well_supported',
      sourceName: encumbrance.source,
      tier: 'official_primary',
      url: encumbrance.sourceUrl,
      geography: parcelGeography,
      retrievedAt: encumbrance.retrievedAt,
    });
  }

  if (record) {
    const source = clean(record.source) ?? clean(record.jurisdiction) ?? 'County assessor record';
    const base = {
      sourceName: source,
      tier: 'official_primary' as const,
      geography: parcelGeography,
      retrievedAt: record.retrievedAt,
      locator: clean(record.jurisdiction),
      standing: 'official_legal_fact' as const,
      weight: 'confirmed' as const,
    };
    seeds.push({
      ...base,
      topic: 'record.owner',
      label: 'Owner of record',
      statement: record.ownerOfRecord ? `Owner of record is ${record.ownerOfRecord}.` : '',
      value: record.ownerOfRecord,
    });
    seeds.push({
      ...base,
      topic: 'record.acreage',
      label: 'Assessed acreage',
      statement: record.assessedAcres != null ? `The assessor record carries ${record.assessedAcres} acres.` : '',
      value: record.assessedAcres,
    });
    seeds.push({
      ...base,
      topic: 'taxes.appraised_value',
      label: 'Total appraised value',
      statement: record.totalAppraisedValue != null
        ? `The assessor's total appraised value is $${record.totalAppraisedValue.toLocaleString('en-US')}.`
        : '',
      value: record.totalAppraisedValue,
    });
    if (record.improvements) {
      seeds.push({
        ...base,
        topic: 'record.improvements',
        label: 'Improvements of record',
        statement: [
          record.improvements.structureType,
          record.improvements.buildingSqft != null ? `${record.improvements.buildingSqft} sq ft` : null,
          record.improvements.yearBuilt != null ? `built ${record.improvements.yearBuilt}` : null,
        ].filter(Boolean).join(', '),
        value: record.improvements.structureType ?? (record.improvements.buildingSqft != null ? String(record.improvements.buildingSqft) : null),
      });
    }
  }

  // The accepted governing acreage. An analytical hypothesis by construction:
  // it is LandOS's own precedence rule over several retained figures.
  if (dossier.identity.acres != null) {
    seeds.push({
      topic: 'record.acreage',
      label: 'Governing acreage',
      statement: `LandOS carries ${dossier.identity.acres} acres as the governing subject size${
        dossier.identity.acreageBasis ? ` (${dossier.identity.acreageBasis})` : ''}.`,
      value: dossier.identity.acres,
      standing: hasOfficialParcelRecord(dossier) ? 'record_fact' : 'analytical_hypothesis',
      weight: 'well_supported',
      sourceName: clean(dossier.acreage?.source) ?? 'LandOS governing acreage basis',
      tier: 'landos_derivation',
      geography: parcelGeography,
      locator: clean(dossier.identity.acreageBasis),
    });
  }
  // Every superseded figure stays visible. A parcel that measured differently
  // before a split is history, not a competing current answer, so these are
  // preserved as provenance rather than promoted into the acreage topic.
  for (const figure of dossier.acreage?.retainedFigures ?? []) {
    if (figure.acres == null) continue;
    seeds.push({
      topic: 'record.acreage_history',
      label: 'Retained acreage figure',
      statement: `${figure.acres} acres${figure.valueType ? ` (${figure.valueType})` : ''}${
        figure.source ? ` per ${figure.source}` : ''}${figure.vintage ? `, ${figure.vintage}` : ''}.`,
      value: figure.acres,
      standing: 'record_fact',
      weight: 'likely',
      sourceName: clean(figure.source) ?? 'Retained acreage record',
      tier: 'provider_record',
      geography: parcelGeography,
      locator: clean(figure.valueType),
      asOf: clean(figure.vintage),
    });
  }

  const physical: Array<[string, string, unknown]> = [
    ['physical.buildable', 'Buildable area', dossier.physical.buildablePct],
    ['physical.buildable_acres', 'Buildable acres', dossier.physical.buildableAcres],
    ['physical.slope', 'Average slope', dossier.physical.slopeAveragePct],
    ['physical.gentle_slope_acres', 'Acres under 10% slope', dossier.physical.acresUnder10PctSlope],
    ['physical.elevation', 'Elevation', dossier.physical.elevation],
    ['physical.water', 'Surface water', dossier.physical.waterPresent],
    ['physical.improvement', 'Improvement on the parcel', dossier.physical.improvement],
    ['physical.shape', 'Parcel shape', dossier.physical.parcelShapeNote],
  ];
  for (const [topic, label, value] of physical) {
    const text = clean(value);
    if (!text) continue;
    seeds.push({
      topic,
      label,
      statement: `${label}: ${text}.`,
      value: text,
      // These arrive from the provider's own parcel analysis of GIS layers.
      // They are records of a measurement, not an official determination.
      standing: 'record_fact',
      weight: 'well_supported',
      sourceName: 'Provider parcel analysis',
      tier: 'provider_record',
      geography: parcelGeography,
    });
  }
  return seeds;
}

// ── Diligence topics ────────────────────────────────────────────────────────

interface TopicBuild {
  key: DiligenceTopicKey;
  seeds: ClaimSeed[];
  /** Present when the topic is established; otherwise the gap explains why. */
  established: boolean;
  headline: string;
  gap: string | null;
  verificationNeeded: string[];
}

function diligenceBuilds(
  dossier: AcquisitionDossier,
  providerAssessment: ProviderAssessmentRecord | null,
): TopicBuild[] {
  const parcelGeography = dossier.identity.apn ? `parcel ${dossier.identity.apn}` : 'subject parcel';
  const jurisdiction = [dossier.identity.county, dossier.identity.stateCode].filter(Boolean).join(', ')
    || 'the jurisdiction';
  const providerSeed = (topic: string, label: string, value: unknown, standing: ClaimStanding = 'record_fact'): ClaimSeed | null => {
    const text = clean(value);
    if (!text) return null;
    return {
      topic, label, statement: `${label}: ${sentence(text)}`, value: text, standing,
      weight: 'well_supported', sourceName: 'Provider parcel analysis',
      tier: 'provider_record', geography: parcelGeography,
    };
  };
  const keep = (...seeds: Array<ClaimSeed | null>): ClaimSeed[] => seeds.filter((seed): seed is ClaimSeed => seed != null);

  const builds: TopicBuild[] = [];

  // ── Access. Physical access and legal access are different questions, and
  //    conflating them is the most expensive mistake available here.
  const recordedAccess = clean(dossier.access.recordedLegalAccessStatement);
  const accessSeeds = keep(
    recordedAccess
      ? {
        topic: 'access.legal', label: 'Recorded legal access',
        statement: recordedAccess, value: 'recorded',
        standing: 'official_legal_fact', weight: 'confirmed',
        sourceName: 'Recorded instrument', tier: 'official_primary', geography: parcelGeography,
      }
      : null,
    clean(dossier.access.legalAccessStatement)
      ? {
        topic: 'access.legal_read', label: 'Access read',
        statement: clean(dossier.access.legalAccessStatement) as string,
        value: null, standing: 'analytical_hypothesis', weight: 'likely',
        sourceName: 'LandOS access evidence ladder', tier: 'landos_derivation', geography: parcelGeography,
      }
      : null,
    providerSeed('access.landlocked', 'Landlocked flag', dossier.access.landLocked),
    providerSeed('access.road', 'Road serving the parcel', dossier.access.roadName),
    clean(dossier.access.operatorStatement)
      ? {
        topic: 'access.operator', label: 'Operator statement on access',
        statement: clean(dossier.access.operatorStatement) as string, value: null,
        standing: 'record_fact', weight: 'likely',
        sourceName: 'Operator note', tier: 'operator_statement', geography: parcelGeography,
      }
      : null,
  );
  builds.push({
    key: 'access',
    seeds: accessSeeds,
    established: !!recordedAccess,
    headline: recordedAccess
      ? 'Legal access is established by a recorded instrument.'
      : dossier.access.established
        ? 'Physical access is evidenced, but no recorded legal access right is retained.'
        : 'Access is not established.',
    gap: recordedAccess ? null : 'No recorded easement, plat dedication or deeded access instrument is retained.',
    verificationNeeded: recordedAccess ? [] : ['Confirm recorded legal access through the county recorder or a title search.'],
  });

  // ── Frontage.
  const frontage = numeric(dossier.access.frontageFt);
  builds.push({
    key: 'frontage',
    seeds: keep(frontage != null
      ? {
        topic: 'frontage.feet', label: 'Road frontage',
        statement: `Mapped road frontage is ${frontage} ft.`, value: frontage,
        standing: 'record_fact', weight: 'well_supported',
        sourceName: 'Provider parcel analysis', tier: 'provider_record', geography: parcelGeography,
      }
      : null),
    established: frontage != null,
    headline: frontage != null
      ? `Mapped frontage of ${frontage} ft on ${clean(dossier.access.roadName) ?? 'the serving road'}.`
      : 'No road frontage measurement is retained.',
    gap: frontage != null ? null : 'No frontage measurement is retained for the subject parcel.',
    verificationNeeded: frontage != null
      ? ['A mapped frontage is a GIS measurement, not a surveyed dimension.']
      : ['Obtain frontage from the survey, plat or county GIS.'],
  });

  // ── Utilities.
  const utilitySeeds = keep(
    providerSeed('utilities.septic_authority', 'Septic authority', dossier.utilities.septicAuthority),
    providerSeed('utilities.per_lot_approval', 'Per-lot approval', dossier.utilities.perLotApproval),
  );
  builds.push({
    key: 'utilities',
    seeds: utilitySeeds,
    established: false,
    headline: utilitySeeds.length
      ? 'Utility context is partly retained; no provider has confirmed service to this parcel.'
      : 'No utility evidence is retained for this parcel.',
    gap: dossier.utilities.unresolved.length
      ? `Unresolved: ${dossier.utilities.unresolved.join('; ')}.`
      : 'No water, sewer or power availability response is retained.',
    verificationNeeded: ['Request written availability from the water, sewer and power providers.'],
  });

  // ── Well and septic. Soils are the screening layer that implies it.
  const soils = clean(dossier.physical.soils);
  builds.push({
    key: 'well_septic',
    seeds: keep(
      soils
        ? {
          topic: 'well_septic.soils_implication', label: 'Septic implication of retained soils',
          statement: `Retained soils (${soils}) are screening evidence for on-site septic feasibility, not a determination.`,
          value: null, standing: 'analytical_hypothesis', weight: 'likely',
          sourceName: 'USDA NRCS soil survey (retained)', tier: 'reputable_secondary', geography: parcelGeography,
        }
        : null,
      providerSeed('well_septic.authority', 'Septic permitting authority', dossier.utilities.septicAuthority),
    ),
    established: false,
    headline: soils
      ? 'On-site septic feasibility is implied by soils only; no percolation or health-department determination is retained.'
      : 'No well or septic evidence is retained.',
    gap: 'No percolation test, site evaluation or health-department septic determination is retained.',
    verificationNeeded: ['Order a site evaluation / percolation test through the county health department.'],
  });

  // ── Taxes. Three genuinely different states, and conflating the last two is
  //    how the Story once reported "no tax record" on a screen that was showing
  //    an assessed value and an annual tax figure from the provider record.
  const appraised = numeric(dossier.officialAssessorRecord?.totalAppraisedValue ?? null);
  const providerTaxSeeds = providerAssessment
    ? keep(
      providerAssessment.assessedValue
        ? {
          topic: 'taxes.assessed_value', label: 'Assessed value',
          statement: `The parcel record carries an assessed value of ${providerAssessment.assessedValue}.`,
          value: providerAssessment.assessedValue, standing: 'record_fact', weight: 'well_supported',
          sourceName: providerAssessment.sourceName, tier: 'provider_record', geography: parcelGeography,
        } as ClaimSeed
        : null,
      providerAssessment.totalMarketValue
        ? {
          topic: 'taxes.market_value', label: 'Total market value',
          statement: `The parcel record carries a total market value of ${providerAssessment.totalMarketValue}.`,
          value: providerAssessment.totalMarketValue, standing: 'record_fact', weight: 'well_supported',
          sourceName: providerAssessment.sourceName, tier: 'provider_record', geography: parcelGeography,
        } as ClaimSeed
        : null,
      providerAssessment.taxAmount
        ? {
          topic: 'taxes.annual_tax', label: 'Annual tax',
          statement: `The parcel record carries an annual tax of ${providerAssessment.taxAmount}.`,
          value: providerAssessment.taxAmount, standing: 'record_fact', weight: 'well_supported',
          sourceName: providerAssessment.sourceName, tier: 'provider_record', geography: parcelGeography,
        } as ClaimSeed
        : null,
    )
    : [];
  builds.push({
    key: 'taxes',
    seeds: appraised != null
      ? [
        {
          topic: 'taxes.appraised_value', label: 'Total appraised value',
          statement: `The assessor's total appraised value is $${appraised.toLocaleString('en-US')}.`,
          value: appraised, standing: 'official_legal_fact', weight: 'confirmed',
          sourceName: clean(dossier.officialAssessorRecord?.source) ?? 'County assessor record',
          tier: 'official_primary', geography: parcelGeography,
          retrievedAt: dossier.officialAssessorRecord?.retrievedAt ?? null,
        },
        ...providerTaxSeeds,
      ]
      : providerTaxSeeds,
    // Only the county's own roll establishes this topic. A provider echo of it
    // is real evidence and a real number, but it is not the official record.
    established: appraised != null,
    headline: appraised != null
      ? `Assessed at $${appraised.toLocaleString('en-US')} by ${clean(dossier.officialAssessorRecord?.jurisdiction) ?? jurisdiction}.`
      : providerTaxSeeds.length
        ? `Assessment and tax figures are retained from ${providerAssessment?.sourceName ?? 'the parcel record'}; `
          + `the ${jurisdiction} assessment roll remains the stronger official source.`
        : 'No assessment or tax record is retained for this parcel.',
    gap: appraised != null
      ? 'The current tax bill, exemptions and any delinquency are not retained.'
      : providerTaxSeeds.length
        ? 'No official county assessment or tax record has been retrieved, and payment status is not established.'
        : 'No assessor or tax record is retained.',
    verificationNeeded: ['Pull the current tax bill and confirm no delinquency or certificate sale.'],
  });

  // ── Zoning and land use.
  const zoningEstablished = dossier.landUse.zoningEstablished === true;
  const zoningSeeds = keep(
    clean(dossier.landUse.districtCode)
      ? {
        topic: 'zoning.district', label: 'Zoning district',
        statement: `Zoning district ${clean(dossier.landUse.districtCode)}${
          clean(dossier.landUse.authority) ? ` under ${clean(dossier.landUse.authority)}` : ''}.`,
        value: clean(dossier.landUse.districtCode),
        standing: zoningEstablished ? 'official_legal_fact' : 'analytical_hypothesis',
        weight: zoningEstablished ? 'confirmed' : 'likely',
        sourceName: clean(dossier.landUse.authority) ?? 'Jurisdiction zoning source',
        tier: zoningEstablished ? 'official_primary' : 'landos_derivation',
        geography: parcelGeography,
      }
      : null,
    clean(dossier.landUse.zoningStatement)
      ? {
        topic: 'zoning.read', label: 'Zoning read',
        statement: clean(dossier.landUse.zoningStatement) as string, value: null,
        standing: zoningEstablished ? 'record_fact' : 'analytical_hypothesis',
        weight: zoningEstablished ? 'well_supported' : 'likely',
        sourceName: clean(dossier.landUse.authority) ?? 'LandOS land-use read',
        tier: zoningEstablished ? 'officially_linked' : 'landos_derivation',
        geography: parcelGeography,
      }
      : null,
    clean(dossier.subdivision.likelyPath)
      ? {
        topic: 'zoning.subdivision_path', label: 'Likely subdivision path',
        statement: `${clean(dossier.subdivision.likelyPath)}${
          clean(dossier.subdivision.likelyPathWhy) ? ` — ${clean(dossier.subdivision.likelyPathWhy)}` : ''}`,
        value: null, standing: 'analytical_hypothesis', weight: 'likely',
        sourceName: clean(dossier.subdivision.authority) ?? 'LandOS subdivision read',
        tier: 'landos_derivation', geography: parcelGeography,
      }
      : null,
  );
  builds.push({
    key: 'zoning',
    seeds: zoningSeeds,
    established: zoningEstablished,
    headline: zoningEstablished
      ? `Zoning is established as ${clean(dossier.landUse.districtCode) ?? 'the retained district'}.`
      : 'Zoning is not established for this parcel.',
    gap: zoningEstablished ? null : `No adopted ${jurisdiction} source established the parcel's current district.`,
    verificationNeeded: zoningEstablished
      ? ['Confirm the district against the adopted map before relying on it for a development assumption.']
      : ['Obtain the parcel\'s zoning designation from the adopted zoning map or a written determination.'],
  });

  // ── Development status.
  const events = dossier.history.developmentEvents;
  builds.push({
    key: 'development_status',
    seeds: events.slice(0, 12).map((event, index): ClaimSeed => ({
      topic: 'development.event',
      label: 'Recorded development event',
      statement: `${event.date ? `${event.date}: ` : ''}${event.event} (${event.status}).`,
      value: `${event.date ?? ''}|${event.event}`,
      standing: 'record_fact',
      weight: 'well_supported',
      sourceName: 'Recorded development history',
      tier: 'official_primary',
      geography: parcelGeography,
      locator: `event ${index + 1}`,
      asOf: event.date,
    })),
    established: events.length > 0,
    headline: events.length
      ? `${events.length} recorded development event(s) on the parcel.`
      : 'No recorded development or permit activity was found for this parcel.',
    gap: events.length ? null : 'No permit, plat or approval record was located for this parcel.',
    verificationNeeded: [],
  });

  // ── Flood / wetlands / soils / site conditions: screening layers, never a
  //    delineation. Each says so in its own verification line.
  const flood = clean(dossier.physical.femaFloodZone);
  builds.push({
    key: 'flood',
    seeds: keep(
      flood
        ? {
          topic: 'flood.zone', label: 'FEMA flood zone',
          statement: `FEMA flood zone ${flood}${
            clean(dossier.physical.femaCoveragePct) ? `, covering ${clean(dossier.physical.femaCoveragePct)} of the parcel` : ''}.`,
          value: flood, standing: 'official_legal_fact', weight: 'well_supported',
          sourceName: 'FEMA National Flood Hazard Layer', tier: 'official_primary', geography: parcelGeography,
        }
        : null,
    ),
    established: !!flood,
    headline: flood ? `Mapped FEMA zone ${flood}.` : 'No FEMA flood mapping is retained for this parcel.',
    gap: flood ? null : 'No FEMA flood zone was resolved for the parcel geometry.',
    verificationNeeded: ['A mapped zone is screening data; an elevation certificate governs any actual determination.'],
  });

  const wetlandsPct = clean(dossier.physical.wetlandsPct);
  builds.push({
    key: 'wetlands',
    seeds: keep(wetlandsPct
      ? {
        topic: 'wetlands.coverage', label: 'Mapped wetlands',
        statement: `Mapped wetlands cover ${wetlandsPct} of the parcel${
          clean(dossier.physical.wetlandsAcres) ? ` (${clean(dossier.physical.wetlandsAcres)} acres)` : ''}.`,
        value: wetlandsPct, standing: 'record_fact', weight: 'well_supported',
        sourceName: 'National Wetlands Inventory (retained)', tier: 'official_primary', geography: parcelGeography,
      }
      : null),
    established: !!wetlandsPct,
    headline: wetlandsPct ? `Mapped wetlands cover ${wetlandsPct} of the parcel.` : 'No wetland mapping is retained for this parcel.',
    gap: wetlandsPct ? null : 'No wetland layer was resolved for the parcel geometry.',
    verificationNeeded: ['Mapped wetlands are screening data; only a delineation establishes the jurisdictional boundary.'],
  });

  builds.push({
    key: 'soils',
    seeds: keep(soils
      ? {
        topic: 'soils.units', label: 'Soil units',
        statement: `Retained soil units: ${soils}.`, value: soils,
        standing: 'record_fact', weight: 'well_supported',
        sourceName: 'USDA NRCS soil survey (retained)', tier: 'official_primary', geography: parcelGeography,
      }
      : null),
    established: !!soils,
    headline: soils ? 'Soil units are retained for the parcel.' : 'No soil survey data is retained for this parcel.',
    gap: soils ? null : 'No NRCS soil units were resolved for the parcel geometry.',
    verificationNeeded: ['Soil survey ratings are regional generalizations; a site evaluation governs.'],
  });

  const siteSeeds = keep(
    providerSeed('site.buildable', 'Buildable area', dossier.physical.buildablePct),
    providerSeed('site.slope', 'Average slope', dossier.physical.slopeAveragePct),
    providerSeed('site.water', 'Surface water', dossier.physical.waterPresent),
    providerSeed('site.shape', 'Parcel shape', dossier.physical.parcelShapeNote),
  );
  builds.push({
    key: 'site_conditions',
    seeds: siteSeeds,
    established: siteSeeds.length >= 2,
    headline: siteSeeds.length
      ? 'Site conditions are described by the retained parcel analysis.'
      : 'No site-condition analysis is retained for this parcel.',
    gap: siteSeeds.length ? null : 'No terrain, buildability or surface-water analysis is retained.',
    verificationNeeded: siteSeeds.length ? ['Confirm on a site visit before underwriting a specific building envelope.'] : [],
  });

  return builds;
}

// ── The Property Story ──────────────────────────────────────────────────────

/**
 * The short reading. Strictly derived from what the topics above concluded, so
 * the story can never assert something the evidence section does not carry.
 */
function buildStory(input: {
  subject: PropertySynthesisSubject;
  topics: DiligenceTopic[];
  dossier: AcquisitionDossier;
  conflicts: SynthesisConflict[];
  relatedBoundaries: RelatedBoundary[];
}): PropertyStory {
  const { subject, topics, dossier, conflicts, relatedBoundaries } = input;
  const topic = (key: DiligenceTopicKey): DiligenceTopic | undefined => topics.find((entry) => entry.key === key);
  const established = topics.filter((entry) => entry.status === 'established');
  const unresolved = topics.filter((entry) => entry.status === 'unresolved');

  const size = subject.acres != null ? `${subject.acres} acre` : 'an unstated';
  const where = [subject.city, subject.county ? `${subject.county} County` : null, subject.state]
    .filter(Boolean).join(', ');
  const headline = `${size} ${subject.interest.form.replace(/_/g, ' ')}${where ? ` in ${where}` : ''}: `
    + `${established.length} of ${topics.length} diligence topics established, `
    + `${unresolved.length} unresolved${conflicts.filter((entry) => entry.resolution === 'unresolved').length
      ? `, ${conflicts.filter((entry) => entry.resolution === 'unresolved').length} open source conflict(s)` : ''}.`;

  const strengths: string[] = [];
  const risks: string[] = [];
  const opportunities: string[] = [];

  if (subject.verification.officiallyVerified) {
    strengths.push(`Parcel identity is confirmed by ${subject.verification.officialSource ?? 'an official record'}.`);
  }
  for (const entry of established) strengths.push(entry.headline);
  if (numeric(dossier.access.frontageFt) != null && (dossier.access.landLocked ?? '').toLowerCase().includes('not')) {
    strengths.push('The parcel is mapped with frontage and is not flagged landlocked.');
  }

  for (const entry of unresolved) risks.push(`${entry.label}: ${entry.gap ?? entry.headline}`);
  for (const entry of conflicts) {
    if (entry.resolution === 'unresolved') risks.push(`Unresolved source conflict — ${entry.statement}`);
  }
  for (const blocker of dossier.blockers.slice(0, 5)) risks.push(blocker);
  if (relatedBoundaries.length) {
    risks.push(
      `${relatedBoundaries.length} parcel(s) or improvement(s) sit beside the subject and are excluded from it; `
      + 'confirm the conveyed boundary before pricing.',
    );
  }

  const flood = topic('flood');
  if (flood?.status === 'established' && /\bx\b/i.test(flood.headline)) {
    opportunities.push('The mapped flood zone is outside the special flood hazard area, which keeps insurable value simple.');
  }
  for (const path of dossier.history.developmentPaths.slice(0, 3)) {
    opportunities.push(`${path.path}: ${path.practicalYield}`);
  }
  if (topic('zoning')?.status !== 'established') {
    opportunities.push('Establishing zoning is the single cheapest unlock: it gates yield, subdivision and exit product.');
  }

  // The few facts most likely to move acquisition economics. Size, buildable
  // share, access and zoning are the ones that actually reprice a land deal.
  const economicsDrivers: Array<{ fact: string; why: string }> = [];
  if (subject.acres != null) {
    economicsDrivers.push({
      fact: `Governing acreage ${subject.acres}${subject.acreageBasis ? ` (${subject.acreageBasis})` : ''}.`,
      why: 'Every price-per-acre comparison and the market band selection resolve from this number.',
    });
  }
  const buildable = clean(dossier.physical.buildablePct);
  if (buildable) {
    economicsDrivers.push({
      fact: `Buildable share ${buildable}.`,
      why: 'Unbuildable acreage carries the same purchase price and none of the resale value.',
    });
  }
  economicsDrivers.push({
    fact: topic('access')?.headline ?? 'Access is not established.',
    why: 'A parcel without recorded legal access prices as landlocked regardless of what the aerial shows.',
  });
  economicsDrivers.push({
    fact: topic('zoning')?.headline ?? 'Zoning is not established.',
    why: 'Zoning sets the exit product, and the exit product sets the comparable set.',
  });
  if (dossier.valuation.fairMarketValue == null) {
    economicsDrivers.push({
      fact: 'No supported fair market value is established.',
      why: 'Until an accepted comparable set exists, every offer figure is a placeholder, not an underwriting number.',
    });
  }

  return {
    headline,
    strengths: [...new Set(strengths)].slice(0, 8),
    risks: [...new Set(risks)].slice(0, 10),
    opportunities: [...new Set(opportunities)].slice(0, 6),
    economicsDrivers: economicsDrivers.slice(0, 6),
  };
}

// ── The builder ─────────────────────────────────────────────────────────────

export interface PropertyEvidenceSynthesisInput {
  dealCardId: number;
  dossier: AcquisitionDossier;
  /** The accepted subject. Null falls back to the dossier's identity block. */
  subject?: CanonicalSubjectState | null;
  /** The Stage 2 reading, for the transaction interest and excluded parcels. */
  understanding?: Pick<SubjectUnderstandingResult, 'subject' | 'excludedParcels'> | null;
  /** The provider's retained assessment and tax figures, when it carries any. */
  providerAssessment?: ProviderAssessmentRecord | null;
  /**
   * Did the retained subject reading answer about the CURRENT accepted subject?
   *
   * Default true. `false` withholds the reading's transaction interest and
   * excluded parcels — a scope statement about a different parcel version is
   * not a scope statement about this one.
   */
  understandingIsCurrent?: boolean;
  now?: () => Date;
}

/**
 * PURE. Build the source-backed Property Intelligence report.
 *
 * No model, no browser, no network — every statement below already exists in
 * the retained record, and this arranges it into one reading whose provenance
 * survives the arrangement.
 */
export function buildPropertyEvidenceSynthesis(
  input: PropertyEvidenceSynthesisInput,
): PropertyEvidenceSynthesis {
  const { dossier } = input;
  const now = (input.now ?? (() => new Date()))().toISOString();
  const understood = input.understanding?.subject ?? null;
  const canonical = input.subject ?? null;

  // IDENTITY COMES FROM THE ACCEPTED SUBJECT, NOT FROM THE STAGE 2 READING.
  //
  // The understanding snapshot is a DERIVED read. It can outlive the parcel it
  // answered about — a Deal Card re-accepted onto a different parcel keeps the
  // old reading until Subject Understanding runs again — and letting it lead
  // meant a story could carry the previous parcel's APN and address under the
  // new subject's heading. Canonical identity outranks a derived snapshot; the
  // understanding fills in only where the accepted record is silent.
  //
  // What the understanding legitimately owns is the TRANSACTION INTEREST and
  // the parcels excluded from it, because canonical state carries neither — and
  // `interestIsCurrent` withholds even those when the reading answered about a
  // different subject version.
  const interestIsCurrent = input.understandingIsCurrent !== false;
  const interest = interestIsCurrent ? understood?.interest ?? null : null;
  const subject: PropertySynthesisSubject = {
    apn: canonical?.apn ?? dossier.identity.apn ?? understood?.apn ?? null,
    apnDisplayVariants: interestIsCurrent ? understood?.apnDisplayVariants ?? [] : [],
    address: canonical?.address ?? dossier.identity.displayAddress ?? understood?.address ?? null,
    city: canonical?.city ?? dossier.identity.city ?? understood?.city ?? null,
    county: canonical?.county ?? dossier.identity.county ?? understood?.county ?? null,
    state: canonical?.state ?? dossier.identity.stateCode ?? understood?.state ?? null,
    zip: canonical?.zip ?? (interestIsCurrent ? understood?.zip ?? null : null),
    fips: canonical?.fips ?? (interestIsCurrent ? understood?.fips ?? null : null),
    owner: dossier.officialAssessorRecord?.ownerOfRecord ?? dossier.identity.owner ?? null,
    // The dossier's acreage already carries the canonical reconciliation, which
    // outranks the understanding reading's own figure.
    acres: dossier.identity.acres ?? (interestIsCurrent ? understood?.acres ?? null : null),
    // The ACCEPTED governing basis, not the dossier's own label for the same
    // number. The header prints "Operator-accepted governing acreage"; a story
    // printing "assessed" beside it describes the same 1.5 acres with a
    // different provenance and invites the operator to ask which is right.
    acreageBasis: canonical?.governingAcreage.source
      ?? canonical?.governingAcreage.kind
      ?? dossier.identity.acreageBasis
      ?? dossier.acreage?.source
      ?? null,
    interest: interest
      ? { form: interest.form, statement: interest.statement }
      : {
        form: 'undetermined',
        statement: interestIsCurrent
          ? 'No accepted subject reading states what portion of the holding is being conveyed.'
          : 'The retained subject reading answered about a different parcel version, so what portion is being conveyed is not established for this subject.',
      },
    subjectVersion: canonical?.subjectVersion ?? null,
    verification: {
      researchGrade: canonical?.subjectResolved ?? dossier.identity.confirmed,
      officiallyVerified: canonical?.officiallyVerified ?? false,
      officialSource: canonical?.officialVerificationSource
        ?? (hasOfficialParcelRecord(dossier) ? clean(dossier.officialAssessorRecord?.source) : null),
      statement: (canonical?.officiallyVerified ?? false)
        ? 'An official parcel record confirms this identity. Title, legal access and entitlement status remain separate questions.'
        : 'This is a research-grade subject: strong enough to research against, and not an official, title or legal verification.',
    },
  };

  // Related and retained boundaries. Invariant 4 lives here: these are named
  // and kept OUT of the subject, never merged into it.
  const relatedBoundaries: RelatedBoundary[] = interestIsCurrent
    ? [
      ...(input.understanding?.excludedParcels ?? []).map((parcel: ExcludedParcel): RelatedBoundary => ({
        identifier: parcel.identifier,
        relationship: parcel.relationship,
        statement: parcel.reason,
        basis: parcel.factIds,
      })),
      ...(interest?.excluded ?? []).map((excluded): RelatedBoundary => ({
        identifier: excluded.identifier,
        relationship: 'excluded_from_transaction',
        statement: excluded.reason,
        basis: [],
      })),
    ]
    // A reading about another parcel version names ANOTHER parcel's neighbours.
    : [];

  // ── Claims ──
  const topicLabels: Record<string, string> = {};
  const allSeeds: ClaimSeed[] = [];
  const recordSeeds = recordFactSeeds(dossier);
  allSeeds.push(...recordSeeds);
  for (const seed of recordSeeds) topicLabels[seed.topic] = seed.label;

  const builds = diligenceBuilds(dossier, input.providerAssessment ?? null);
  for (const build of builds) {
    allSeeds.push(...build.seeds);
    for (const seed of build.seeds) topicLabels[seed.topic] = seed.label;
  }

  // Guardrails become real verification-need claims, so an operator reading the
  // evidence list sees the withheld assertion rather than an absence.
  const guardrails: PropertyEvidenceSynthesis['guardrails'] = [];
  for (const guard of GUARDED_CLAIMS) {
    if (guard.supported(dossier)) continue;
    guardrails.push({ claimKind: guard.claimKind, statement: guard.withheld, unlockedBy: guard.unlockedBy });
    const topic = `guardrail.${guard.claimKind.toLowerCase().replace(/[^a-z]+/g, '_')}`;
    topicLabels[topic] = guard.claimKind;
    allSeeds.push({
      topic,
      label: guard.claimKind,
      statement: `${guard.withheld} ${guard.unlockedBy}`,
      value: null,
      standing: 'verification_need',
      weight: 'unresolved',
      sourceName: 'LandOS evidence guardrail',
      tier: 'landos_derivation',
      geography: subject.apn ? `parcel ${subject.apn}` : 'subject parcel',
    });
  }

  const claims = allSeeds
    .map((seed, index) => claim('pes', index, seed))
    .filter((entry): entry is SourcedClaim => entry != null);
  const synthesis = synthesizeClaims({ claims, topicLabels });

  const claimsFor = (build: TopicBuild): SourcedClaim[] => {
    const keys = new Set(build.seeds.map((seed) => seed.topic));
    return synthesis.claims.filter((entry) => keys.has(entry.topic));
  };

  const diligence: DiligenceTopic[] = builds.map((build) => {
    const topicClaims = claimsFor(build);
    const status: DiligenceStatus = build.established
      ? 'established'
      : topicClaims.length > 0 ? 'partial' : 'unresolved';
    return {
      key: build.key,
      label: DILIGENCE_TOPIC_LABEL[build.key],
      status,
      headline: build.headline,
      claims: topicClaims,
      gap: status === 'established' ? null : build.gap,
      verificationNeeded: build.verificationNeeded,
    };
  });

  // ── Visual and neighborhood review ──
  const observationsByCapture = new Map<string, typeof dossier.visualObservations>();
  for (const observation of dossier.visualObservations) {
    const key = observation.sourceImage ?? '';
    const bucket = observationsByCapture.get(key);
    if (bucket) bucket.push(observation);
    else observationsByCapture.set(key, [observation]);
  }
  const visualReview: VisualReviewItem[] = [];
  for (const visual of dossier.visuals) {
    const observations = observationsByCapture.get(visual.label) ?? observationsByCapture.get(visual.key) ?? [];
    if (!observations.length) {
      visualReview.push({
        capture: visual.label,
        capturedAt: visual.capturedAt,
        purpose: visual.purpose,
        observation: null,
        category: null,
        signal: null,
        model: null,
        analyzedAt: null,
        standing: 'visual_observation',
      });
      continue;
    }
    for (const observation of observations) {
      visualReview.push({
        capture: visual.label,
        capturedAt: observation.capturedAt ?? visual.capturedAt,
        purpose: visual.purpose,
        observation: observation.observation,
        category: observation.category,
        signal: observation.signal,
        model: observation.model,
        analyzedAt: observation.analyzedAt,
        standing: 'visual_observation',
      });
    }
  }
  // Observations whose capture is no longer listed still count as review: the
  // pixels were seen, and dropping them would hide evidence.
  const listedLabels = new Set(dossier.visuals.flatMap((visual) => [visual.label, visual.key]));
  for (const observation of dossier.visualObservations) {
    if (observation.sourceImage && listedLabels.has(observation.sourceImage)) continue;
    visualReview.push({
      capture: observation.sourceImage ?? 'Retained capture',
      capturedAt: observation.capturedAt,
      purpose: null,
      observation: observation.observation,
      category: observation.category,
      signal: observation.signal,
      model: observation.model,
      analyzedAt: observation.analyzedAt,
      standing: 'visual_observation',
    });
  }

  // Material disagreements the dossier already reconciled travel forward whole,
  // beside the ones this synthesis found across its own claims.
  const conflicts: SynthesisConflict[] = [
    ...synthesis.conflicts,
    ...dossier.conflicts.map((entry): SynthesisConflict => {
      // An acreage disagreement the ACCEPTED SUBJECT has already settled is not
      // an open conflict, and presenting it as one contradicts the header on
      // the same screen — which states the superseded figure is "not a current
      // alternative and not an open conflict". The operator's acceptance IS the
      // resolution, so it is recorded as one rather than re-litigated here.
      // Matched on the CONTENT, not on the dossier's subject bucket. The same
      // acreage disagreement is filed under `acreage` by one reconciliation and
      // under `identity` by another, and its values arrive either as clean
      // figures ("1.5") or as the whole sentence ("assessed 1.5 ac vs mapped
      // 1.846 ac"). A story that trusts the label or the shape leaves the
      // conflict open under one spelling and closed under the other, which is
      // how the Property Story came to report an open acreage conflict beside a
      // header stating that same figure is "not an open conflict".
      //
      // So: the conflict must actually be ABOUT acreage, and one of the figures
      // it names must be the accepted governing acreage. Both conditions
      // together keep a parcel-identifier conflict open, which it must stay.
      const governing = canonical?.governingAcreage;
      const conflictText = [entry.statement, ...entry.values.map((value) => String((value as { value?: unknown }).value ?? ''))].join(' ');
      const aboutAcreage = String(entry.subject) === 'acreage'
        || /\bacres?\b|\bacreage\b|\bac\b/i.test(conflictText);
      const namesGoverningAcreage = (): boolean => {
        if (governing?.value == null) return false;
        for (const match of conflictText.matchAll(/\d+(?:\.\d+)?/g)) {
          const stated = Number(match[0]);
          if (!Number.isFinite(stated) || stated <= 0) continue;
          const high = Math.max(stated, governing.value);
          if (Math.abs(stated - governing.value) / high <= 0.02) return true;
        }
        return false;
      };
      const settledByAcceptance = governing?.value != null
        && governing.disputed === false
        && aboutAcreage
        && namesGoverningAcreage();
      return {
        topic: `dossier.${String(entry.subject)}`,
        label: String(entry.subject),
        statement: entry.statement,
        sides: entry.values.map((value) => ({
          value: String((value as { value?: unknown }).value ?? ''),
          claimIds: [],
          sources: [String((value as { source?: unknown }).source ?? 'retained source')],
          tier: 'provider_record',
          weight: 'likely',
          asOf: null,
        })),
        resolution: settledByAcceptance ? 'resolved' : entry.resolution,
        reason: settledByAcceptance
          ? `Settled by the accepted governing acreage: ${governing?.value} acres`
            + `${governing?.source ? ` (${governing.source})` : ''}. `
            + 'The other figure is retained as history, not as a current alternative.'
          : entry.reason,
        material: !settledByAcceptance,
      };
    }),
  ];

  const story = buildStory({ subject, topics: diligence, dossier, conflicts, relatedBoundaries });

  const limitations: string[] = [
    ...dossier.missingInformation.map(String),
    ...dossier.truncation.map(String),
  ];
  if (!subject.verification.officiallyVerified) {
    limitations.push('Parcel identity is research-grade; no official county record has confirmed it.');
  }
  if (!dossier.visuals.length) limitations.push('No retained imagery was available for visual review.');

  const bySt = standingBreakdown(synthesis.claims);
  const idsWith = (standing: ClaimStanding): string[] =>
    synthesis.claims.filter((entry) => entry.standing === standing).map((entry) => entry.claimId);

  const fingerprintPayload = {
    subject,
    relatedBoundaries,
    claims: synthesis.claims.map((entry) => [entry.claimId, entry.value, entry.statement]),
    diligence: diligence.map((entry) => [entry.key, entry.status, entry.headline]),
    visualReview: visualReview.map((entry) => [entry.capture, entry.observation, entry.analyzedAt]),
    conflicts: conflicts.map((entry) => [entry.topic, entry.statement, entry.resolution]),
    guardrails,
    coverage: dossier.coverage,
  };

  return {
    contractVersion: PROPERTY_EVIDENCE_SYNTHESIS_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: now,
    inputFingerprint: createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
    subject,
    relatedBoundaries,
    recordFacts: synthesis.claims.filter((entry) => entry.topic.startsWith('record.') || entry.topic.startsWith('physical.')),
    diligence,
    visualReview,
    separation: {
      counts: bySt,
      officialLegalFactIds: idsWith('official_legal_fact'),
      visualObservationIds: idsWith('visual_observation'),
      analyticalHypothesisIds: idsWith('analytical_hypothesis'),
      verificationNeedIds: idsWith('verification_need'),
    },
    story,
    conflicts,
    duplicatesCollapsed: synthesis.duplicatesCollapsed.reduce((total, entry) => total + entry.collapsed.length, 0),
    limitations: [...new Set(limitations)],
    guardrails,
    coverage: dossier.coverage,
  };
}
