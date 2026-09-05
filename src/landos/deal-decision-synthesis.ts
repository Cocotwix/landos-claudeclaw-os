// LandOS — landos-deal-decision-synthesis.
//
// Property Intelligence says what the parcel is. Market Intelligence says what
// its band is doing. Seller Intelligence says what the owner has actually said.
// None of them is a decision, and Stage 0 found the consequence: Deal 115 held
// nine research snapshots, two settled stories, and a Deal Brain that was blank
// because value and seller data were incomplete. The operator was left to
// assemble the posture by hand from three panels.
//
// This capability forms the posture. It has two output modes and it never has
// none:
//
//   PRELIMINARY ACQUISITION POSTURE   research is usable but seller, value,
//                                     zoning, access, title or another material
//                                     input is incomplete. The decision says
//                                     what to do NEXT and why no price yet.
//   OFFER / STRATEGY POSTURE          the required source-backed evidence is
//                                     sufficiently complete to price and act.
//
// Rules held by construction:
//
//   • Seller claims come only from `landos-seller-discovery`, which draws them
//     only from retained communications. Nothing here infers motivation,
//     price, timeline or intent from the property or its records.
//   • A price is guided only when the Property Story's fair-market-value
//     guardrail is lifted; otherwise the no-price rationale is explicit.
//   • Every risk and opportunity keeps the standing and source of the evidence
//     that raised it. The story is ranked, not restated.
//   • The material fingerprint covers exactly the inputs that may change the
//     decision, so the lifecycle can refresh on material evidence and stay
//     still on everything else.
//
// Pure: no model, no browser, no network, no clock in the persisted payload.

import { createHash } from 'node:crypto';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { MarketResearchAndPulse } from './market-research-and-pulse.js';
import { STRATEGIES, type StrategyId } from './offer-engine.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  currentClaims,
  SELLER_CLAIM_DIMENSION_LABEL,
  type SellerClaim,
  type SellerClaimDimension,
  type SellerDiscoverySynthesis,
} from './seller-discovery.js';
import type { ClaimStanding, ClaimWeight } from './source-aware-synthesis.js';
import type { PathKind, ZoningDevelopmentIntelligence } from './zoning-development-intelligence.js';

export const DEAL_DECISION_SYNTHESIS_VERSION = '1.5.2';
export const DEAL_DECISION_SNAPSHOT = 'deal_decision_synthesis_v1';
export const DEAL_DECISION_SKILL = 'landos-deal-decision-synthesis';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type DecisionMode = 'preliminary_acquisition_posture' | 'offer_strategy_posture';

export const DECISION_MODE_LABEL: Record<DecisionMode, string> = {
  preliminary_acquisition_posture: 'Preliminary acquisition posture',
  offer_strategy_posture: 'Offer / strategy posture',
};

export type RecommendationKind = 'continue_diligence' | 'request_information' | 'make_offer' | 'renegotiate' | 'pass';

export const RECOMMENDATION_LABEL: Record<RecommendationKind, string> = {
  continue_diligence: 'Continue targeted diligence',
  request_information: 'Request specific information',
  make_offer: 'Make an offer',
  renegotiate: 'Renegotiate',
  pass: 'Pass',
};

export type EvidenceKey = 'subject' | 'value' | 'zoning' | 'access' | 'title' | 'seller' | 'utilities' | 'environmental' | 'market';

export interface EvidenceRequirement {
  key: EvidenceKey;
  label: string;
  status: 'sufficient' | 'partial' | 'missing';
  statement: string;
  /** Must be sufficient before the Offer / Strategy posture may form. */
  requiredForOffer: boolean;
  unlock: string;
}

export interface RankedItem {
  rank: number;
  key: string;
  title: string;
  statement: string;
  magnitude: 'high' | 'medium' | 'low';
  standing: ClaimStanding | 'seller_reported' | 'market_record';
  /** The source that raised it, in the operator's terms. */
  basis: string;
  /** What resolves or captures it. */
  action: string | null;
}

export type ExitStrategyStatus = 'supported' | 'conditional' | 'not_supported' | 'unknown';

export interface ExitStrategyRead {
  id: StrategyId;
  label: string;
  status: ExitStrategyStatus;
  statusWhy: string;
  keyRequirement: string;
  criticalGate: string;
  economicBasis: string;
  economicBasisConfirmed: boolean;
}

export interface ValueGuidance {
  status: 'supported' | 'withheld';
  fmv: { low: number | null; central: number; high: number | null } | null;
  basis: string | null;
  acceptedCompCount: number;
  offerGuidance: {
    strategy: StrategyId;
    strategyLabel: string;
    lowPct: number;
    highPct: number;
    low: number;
    high: number;
    confirmed: boolean;
  } | null;
  askingPrice: number | null;
  askingPriceSource: string | null;
  askingVsGuidance: string | null;
  noPriceRationale: string | null;
  /** The complete current valuation package. Combined LandOS FMV governs
   *  `fmv.central`; the two lane FMVs stay visible as supporting components. */
  package: {
    landPortalFmv: number | null;
    landPortalCompCount: number | null;
    nonLandPortalFmv: number | null;
    nonLandPortalCompCount: number | null;
    nonLandPortalSources: string[];
    combinedFmv: number | null;
    combinedMethod: string | null;
    combinedMethodLabel: string | null;
    combinedLimitation: string | null;
    confidence: string | null;
    offer40: number | null;
    offer60: number | null;
    collectiveComparison: string | null;
    collectivePosture: string | null;
    activeCompetitionCount: number | null;
    activeCompetitionSummary: string | null;
    landWatchApplicable: boolean;
    landPortalAssociatedCount?: number | null;
    landPortalAssociatedNote?: string | null;
    landHome?: {
      physicalMet: boolean | null;
      usableAcres: number | null;
      physicalNote: string | null;
      marketMet: boolean;
      qualifyingSaleCount: number | null;
      topSalePrice: number | null;
      marketNote: string | null;
      marketBrief?: string | null;
      searchComplete?: boolean;
      soldCompCount: number | null;
      activeCompCount: number | null;
      excludedCount: number | null;
      triggered: boolean;
    } | null;
  } | null;
}

export type LandHomePosture = 'WORTH EXPLORING' | 'MARGINAL' | 'NOT VIABLE';

// ── Stage 5: exit scenarios and the strategy comparison ─────────────────────

export type ScenarioId =
  | 'as_is_quick_flip'
  | 'light_improvement'
  | 'minor_subdivision'
  | 'major_subdivision_entitlement'
  | 'land_home_manufactured'
  | 'novation_double_close'
  | 'owner_finance';

export type ScenarioStatus = 'viable' | 'conditional' | 'not_supported' | 'unknown';

/** Preliminary Land Home Package posture, from the package screen plus the
 *  retained zoning standing. Only a clear prohibition blocks the strategy;
 *  an unestablished permission never produces NOT VIABLE on its own. Null
 *  when the manufactured-home search has not returned any sale yet. */
export function landHomePostureFor(
  screen: NonNullable<NonNullable<ValueGuidance['package']>['landHome']> | null | undefined,
  standing: string | null | undefined,
): { posture: LandHomePosture | null; why: string; nextVerification: string } {
  const permission = standing === 'by_right' ? 'allowed' : standing === 'conditional' ? 'conditional' : standing === 'prohibited' ? 'prohibited' : 'not established';
  const nextVerification = permission === 'conditional'
    ? 'Confirm the conditional-use or special-exception approval for a manufactured home.'
    : permission === 'not established'
      ? 'Verify from the adopted code whether the district permits manufactured housing.'
      : permission === 'prohibited' ? 'None: manufactured housing is prohibited on the retained evidence.' : 'Placement and building permits.';
  if (!screen) return { posture: null, why: 'No Land Home Package screen is retained.', nextVerification };
  if (permission === 'prohibited') {
    return { posture: 'NOT VIABLE', why: 'A clear prohibition on manufactured housing is established; any manufactured-home market evidence stays as context.', nextVerification };
  }
  if (screen.physicalMet === false) {
    return { posture: 'NOT VIABLE', why: screen.physicalNote ?? 'The retained terrain read fails the 0.50-acre-under-10%-slope screen.', nextVerification };
  }
  if (!screen.marketMet) {
    // UNSCREENED (null) only while the approved source search genuinely could
    // not be completed; a completed search with no qualifying sale is NOT VIABLE.
    if (!screen.searchComplete) {
      return { posture: null, why: screen.marketNote ?? 'The manufactured-home market search could not be completed.', nextVerification };
    }
    return { posture: 'NOT VIABLE', why: screen.marketNote ?? 'No manufactured-home sale above $200,000 within about five miles.', nextVerification };
  }
  if (screen.physicalMet == null) {
    return { posture: 'MARGINAL', why: `${screen.marketBrief ?? screen.marketNote ?? 'The market signal exists.'} ${screen.physicalNote ?? 'The physical screen is incomplete.'}`, nextVerification };
  }
  // WORTH EXPLORING: the brief reason is the market evidence in the operator's
  // words, and the next verification is the practical one for this posture:
  // whether a home, well and septic actually fit inside the usable ground.
  const usable = screen.usableAcres != null ? ` (about ${screen.usableAcres} usable acre${screen.usableAcres === 1 ? '' : 's'})` : '';
  return {
    posture: 'WORTH EXPLORING',
    why: `${screen.marketBrief ?? screen.marketNote ?? 'A credible manufactured-home sale above $200,000 lies within about five miles.'} Physical screen passed${usable}. Permission: ${permission}.`,
    nextVerification: `Confirm practical placement of a manufactured home, well and septic within the usable portion of the acquisition parcel${usable}.${permission === 'not established' ? ' Then verify from the adopted code whether the district permits manufactured housing.' : permission === 'conditional' ? ' Then confirm the conditional-use or special-exception approval for the home.' : ''}`,
  };
}

export interface CostLine {
  key: string;
  label: string;
  /** Null when the input is missing; never a placeholder number. */
  amount: number | null;
  basis: string;
  source: 'landos_operating_assumption' | 'retained_source' | 'operator_supplied' | 'market_record' | 'missing';
}

export interface ExitScenario {
  id: ScenarioId;
  label: string;
  strategyId: StrategyId | null;
  pathKind: PathKind | null;
  /** What the scenario actually sells: the whole parcel, N lots, a home site. */
  subjectScope: string;
  status: ScenarioStatus;
  /** Preliminary Land Home Package posture; only the land-home scenario carries it. */
  landHomePosture?: LandHomePosture | null;
  confidence: ClaimWeight;
  statusWhy: string;
  grossExit: { amount: number; basis: string; asOf: string | null } | null;
  purchasePriceCapacity: { low: number; high: number; lowPct: number; highPct: number; basis: string; confirmed: boolean } | null;
  directCosts: CostLine[];
  softCosts: CostLine[];
  capitalAtRisk: { amount: number; basis: string } | null;
  timeToExit: { statement: string; basis: string } | null;
  keyApprovals: string[];
  /** Only when gross exit, purchase price and every cost line are visible. */
  returnMetrics: {
    purchasePrice: number;
    purchasePriceBasis: string;
    totalCost: number;
    netProfit: number;
    returnOnCapital: number;
    minimumNet: number;
    meetsMinimumNet: boolean;
    basis: string;
  } | null;
  missingInputs: string[];
  complexity: 'low' | 'medium' | 'high';
  buyerDemand: string;
  risks: string[];
  nextDecisiveAction: string;
}

export interface PriceSensitivityPoint {
  label: 'low' | 'base' | 'high';
  price: number;
  /** Scenarios whose purchase-price capacity still covers this price. */
  plausible: ScenarioId[];
  /** Scenarios not ruled out, but with no capacity to test the price against. */
  undetermined: ScenarioId[];
  /** Scenarios whose capacity the price exceeds. */
  exceeded: ScenarioId[];
  statement: string;
}

export interface PriceSensitivity {
  mode: 'no_price' | 'asking_price' | 'seller_range';
  source: string | null;
  points: PriceSensitivityPoint[];
  statement: string;
  missingInputs: string[];
}

export interface StrategyComparison {
  developmentPathStatus: 'current' | 'pending';
  scenarios: ExitScenario[];
  priceSensitivity: PriceSensitivity;
  ranking: Array<{ id: ScenarioId; rank: number; why: string }>;
  criteria: string[];
  statement: string;
  /** Always true: LandOS never auto-selects the highest gross profit. */
  notAutoSelected: true;
}

export interface NextAction {
  action: string;
  why: string;
  capabilityId: string | null;
  unlocks: string;
}

export interface DecisionSubject {
  apn: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  acres: number | null;
  acreageBasis: string | null;
  interest: { form: string; statement: string } | null;
  subjectVersion: string | null;
  confidence: ClaimWeight;
  verification: {
    researchGrade: boolean;
    /** True only when the exact qualifying official record is reachable
     *  (`lineage.reached`), never from a flag alone. */
    officiallyVerified: boolean;
    officialSource: string | null;
    statement: string;
    /** The exact retained record behind the identity, when Stage 4 can reach
     *  it, and the distinction between official evidence, operator acceptance
     *  and history. */
    lineage: IdentityLineage;
  };
  caveats: string[];
}

/** A retained source-evidence row supporting the subject's parcel identity. */
export interface IdentityEvidenceRecord {
  recordId: string;
  fact: string;
  sourceUrl: string | null;
  /** ISO timestamp the source was accessed, when the row recorded one. */
  accessedAt: string | null;
  note: string | null;
}

export interface IdentityEvidenceInput {
  propertyCardId: number | null;
  verificationStatus: string | null;
  verificationSource: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  fips: string | null;
  records: IdentityEvidenceRecord[];
}

export interface IdentityLineage {
  /** Whether the exact qualifying official record was reached by this reader. */
  reached: boolean;
  sourceName: string | null;
  sourceType: 'official_parcel_record' | 'provider_record' | 'operator_supplied' | 'none';
  recordId: string | null;
  sourceHost: string | null;
  matchedFields: { apn: string | null; county: string | null; state: string | null; fips: string | null };
  observedAt: string | null;
  /** The exact statement when no date is retained. */
  observedAtStatement: string;
  subjectVersion: string | null;
  /** Official-record evidence, operator acceptance and historical evidence,
   *  kept apart. */
  distinctions: string[];
}

export interface DecisionSellerStatus {
  status: 'no_communications' | 'communications_retained';
  statement: string;
  communications: number;
  discoveryExtractions: number;
  lastContactAt: string | null;
  /** Only the seller's CURRENT, ASSERTED positions, each carried by a retained
   *  communication. Negated, withdrawn and superseded statements stay in the
   *  seller discovery as history and never reach the decision. */
  claims: Array<{
    dimension: SellerClaimDimension; label: string; statement: string; value: string | null;
    weight: ClaimWeight; confidence: string; modality: string; speaker: string; source: string; at: string | null;
  }>;
  /** Statements the seller later moved, denied or withdrew. */
  historicalClaims: number;
  conflicts: number;
  unanswered: SellerClaimDimension[];
  operatorProfileNotes: Array<{ field: string; value: string }>;
}

export interface DealDecisionSynthesis {
  contractVersion: typeof DEAL_DECISION_SYNTHESIS_VERSION;
  dealCardId: number;
  /** Null in the persisted payload; the row's own timestamp is the answer. */
  generatedAt: string | null;
  inputFingerprint: string;
  /** Hash of the material dimensions only. Equal fingerprints mean no
   *  material evidence arrived, whatever else moved. */
  materialFingerprint: string;
  /** The material dimensions, so a refresh can say exactly what changed. */
  materialDimensions: Record<string, string>;
  mode: DecisionMode;
  modeWhy: string;
  subject: DecisionSubject;
  propertyStory: {
    headline: string;
    strengths: string[];
    risks: string[];
    opportunities: string[];
    establishedTopics: number;
    totalTopics: number;
  } | null;
  marketStory: {
    headline: string;
    liquidityRead: string;
    demandRead: string;
    competitionRead: string;
    subjectBand: { label: string | null; available: boolean; medianPricePerAcre: number | null; sampleCount: number | null; period: string | null };
    /** Never the subject's band; shown for contrast only. */
    mostLiquidBand: { label: string | null; medianPricePerAcre: number | null } | null;
  } | null;
  seller: DecisionSellerStatus;
  evidence: EvidenceRequirement[];
  risks: RankedItem[];
  opportunities: RankedItem[];
  exitStrategies: ExitStrategyRead[];
  /** Stage 5: every relevant exit scenario over the Development Path, the
   *  seller's price as a sensitivity, and a transparent, non-selecting
   *  comparison. */
  strategyComparison: StrategyComparison;
  value: ValueGuidance;
  nextActions: { landos: NextAction; operator: NextAction };
  recommendation: { kind: RecommendationKind; label: string; statement: string; rationale: string[] };
  limitations: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const clean = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== '-' && text.toLowerCase() !== 'unknown' ? text : null;
};
const usd = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}`;
const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const topicOf = (property: PropertyEvidenceSynthesis | null, key: string) =>
  property?.diligence.find((topic) => topic.key === key) ?? null;
const guardOf = (property: PropertyEvidenceSynthesis | null, kind: string) =>
  property?.guardrails.find((guard) => guard.claimKind === kind) ?? null;

const strategyParams = (id: StrategyId) => STRATEGIES.find((strategy) => strategy.id === id)!;

function economicBasisFor(id: StrategyId): { text: string; confirmed: boolean } {
  const params = strategyParams(id);
  if (params.offerPctLowOfEv != null && params.offerPctHighOfEv != null) {
    return {
      text: `Offer ${params.offerPctLowOfEv}–${params.offerPctHighOfEv}% of expected value; minimum net ${usd(params.minNetProfitUsd)}${params.confirmed ? '' : ' (band unconfirmed: draft)'}.`,
      confirmed: params.confirmed,
    };
  }
  return { text: `${params.notes} Minimum net ${usd(params.minNetProfitUsd)}.`, confirmed: params.confirmed };
}

// ── Subject ─────────────────────────────────────────────────────────────────

const OFFICIAL_SOURCE = /official|assessor|property[ -]?appraiser|cadastral|government|(?:county|state|municipal).{0,32}(?:gis|parcel (?:map|layer|record)|property record)|(?:gis|parcel (?:map|layer)).{0,32}(?:county|state|municipal)/i;
const PROVIDER_SOURCE = /landportal|provider:|realie|regrid|propertyradar|attom|data ?tree/i;

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
};

/**
 * PURE. The exact retained record behind "confirmed", or the honest absence.
 *
 * Official confirmation needs the exact qualifying source: a verified card
 * whose verification source is an official parcel record, AND a retained
 * source-evidence row that supports the parcel identity or APN. A flag, a
 * provider record, a geocode, a locality or the operator's acceptance never
 * qualifies. When the record cannot be reached, the strongest research-grade
 * support is stated and official confirmation is named as pending.
 */
function identityLineageFor(
  evidence: IdentityEvidenceInput | null,
  subject: CanonicalSubjectState | null,
  subjectApn: string | null,
): IdentityLineage {
  const sourceName = clean(evidence?.verificationSource) ?? clean(subject?.officialVerificationSource) ?? null;
  const sourceType: IdentityLineage['sourceType'] = !sourceName
    ? 'none'
    : PROVIDER_SOURCE.test(sourceName)
      ? 'provider_record'
      : OFFICIAL_SOURCE.test(sourceName)
        ? 'official_parcel_record'
        : 'operator_supplied';
  const normalize = (value: string | null | undefined): string => String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const apnMatches = !!evidence?.apn && !!subjectApn && normalize(evidence.apn) === normalize(subjectApn);
  // The row filed under "Parcel identity" is the record; APN, owner and
  // acreage rows from the same source corroborate it.
  const supporting = (evidence?.records ?? [])
    .filter((record) => /parcel identity|apn|parcel/i.test(record.fact))
    .sort((a, b) => Number(/parcel identity/i.test(b.fact)) - Number(/parcel identity/i.test(a.fact)));
  const record = supporting[0] ?? null;
  const corroborating = [...new Set(supporting.slice(1).map((entry) => entry.fact.toLowerCase()).filter((fact) => fact !== record?.fact.toLowerCase()))];
  const reached = sourceType === 'official_parcel_record'
    && evidence?.verificationStatus === 'verified_property'
    && apnMatches
    && record != null;
  const distinctions: string[] = [];
  if (reached) {
    distinctions.push(`Official-record evidence: ${sourceName} (${record!.recordId}) supports the parcel identity${corroborating.length ? `, corroborated by its ${corroborating.join(', ')} row(s)` : ''}; public GIS is not a deed, title commitment, survey or legal-boundary determination.`);
  } else if (sourceName) {
    distinctions.push(`${sourceType === 'provider_record' ? 'Provider' : 'Research-grade'} support: ${sourceName}; this is not official parcel confirmation.`);
  }
  const acreageSource = subject?.governingAcreage?.source ?? null;
  if (subject?.governingAcreage?.kind === 'operator_accepted' || (acreageSource && /operator/i.test(acreageSource))) {
    distinctions.push(`Operator acceptance: the governing acreage ${subject?.governingAcreage?.value != null ? `${subject.governingAcreage.value} ac ` : ''}is operator-accepted (${acreageSource ?? 'operator-supplied basis'}); any acreage the official layer reports is retained as history, not the current subject.`);
  }
  if (subject?.subjectVersion) {
    distinctions.push(`Accepted subject version ${subject.subjectVersion}; earlier identity versions are retained as historical evidence.`);
  }
  return {
    reached,
    sourceName,
    sourceType,
    recordId: record ? record.recordId : null,
    sourceHost: hostOf(record?.sourceUrl ?? null),
    matchedFields: {
      apn: reached ? evidence!.apn : null,
      county: reached ? clean(evidence!.county) : null,
      state: reached ? clean(evidence!.state) : null,
      fips: reached ? clean(evidence!.fips) : null,
    },
    observedAt: record?.accessedAt ?? null,
    observedAtStatement: record?.accessedAt ? `retrieved ${record.accessedAt.slice(0, 10)}` : 'observation date not recorded',
    subjectVersion: subject?.subjectVersion ?? null,
    distinctions,
  };
}

function subjectFor(
  subject: CanonicalSubjectState | null,
  property: PropertyEvidenceSynthesis | null,
  dossier: AcquisitionDossier,
  identityEvidence: IdentityEvidenceInput | null,
): DecisionSubject {
  const fromStory = property?.subject ?? null;
  const subjectApn = fromStory?.apn ?? subject?.apn ?? dossier.identity.apn;
  const lineage = identityLineageFor(identityEvidence, subject, subjectApn);
  // A flag alone never confirms: the exact qualifying record has to be reached.
  const officiallyVerified = lineage.reached;
  const researchGrade = fromStory?.verification.researchGrade ?? !!subject?.subjectResolved;
  const confidence: ClaimWeight = officiallyVerified ? 'confirmed' : researchGrade ? 'well_supported' : subject?.subjectResolved ? 'likely' : 'unresolved';
  const caveats: string[] = [];
  const acreageBasis = fromStory?.acreageBasis ?? subject?.governingAcreage.source ?? dossier.identity.acreageBasis ?? null;
  if (acreageBasis && /not yet supplied|held by the operator/i.test(acreageBasis)) {
    caveats.push('The governing acreage rests on a survey LandOS has not seen; supplying the document settles size and boundary.');
  }
  if (fromStory?.interest.form === 'proposed_split') {
    caveats.push('The subject is a proposed split; the conveyed portion, not the parent parcel, is what every figure describes.');
  }
  const acreageConflict = property?.conflicts.find((conflict) => conflict.topic.includes('acreage') && conflict.resolution === 'unresolved');
  if (acreageConflict) caveats.push(acreageConflict.statement);
  if (!officiallyVerified) {
    caveats.push(lineage.sourceName && (subject?.officiallyVerified || fromStory?.verification.officiallyVerified)
      ? `Official confirmation is pending in this decision: the retained ${lineage.sourceName} record could not be reached by the Deal Brain, so identity is carried as research-grade only.`
      : 'No official assessor or GIS record has confirmed this parcel; identity is research-grade only.');
  }
  const fields = [lineage.matchedFields.apn ? `APN ${lineage.matchedFields.apn}` : null, lineage.matchedFields.county ? `${lineage.matchedFields.county} County` : null, lineage.matchedFields.state].filter(Boolean).join(', ');
  const statement = officiallyVerified
    ? `Parcel identity is confirmed by ${lineage.sourceName} (official public parcel record, ${lineage.recordId}${lineage.sourceHost ? ` via ${lineage.sourceHost}` : ''}, ${lineage.observedAtStatement}): ${fields} matched${lineage.subjectVersion ? `; accepted subject ${lineage.subjectVersion}` : ''}. Title, legal access and entitlement status remain separate questions.`
    : lineage.sourceName
      ? `Strongest support: ${lineage.sourceName} (${lineage.sourceType === 'provider_record' ? 'provider record' : 'research-grade'}); official parcel confirmation is pending${lineage.subjectVersion ? ` for accepted subject ${lineage.subjectVersion}` : ''}.`
      : 'Parcel identity is not officially confirmed; no qualifying source record is retained.';
  return {
    apn: fromStory?.apn ?? subject?.apn ?? dossier.identity.apn,
    address: fromStory?.address ?? subject?.address ?? dossier.identity.displayAddress,
    city: fromStory?.city ?? subject?.city ?? dossier.identity.city,
    county: fromStory?.county ?? subject?.county ?? dossier.identity.county,
    state: fromStory?.state ?? subject?.state ?? dossier.identity.stateCode,
    zip: fromStory?.zip ?? subject?.zip ?? null,
    acres: fromStory?.acres ?? subject?.governingAcreage.value ?? dossier.identity.acres,
    acreageBasis,
    interest: fromStory?.interest ?? null,
    subjectVersion: subject?.subjectVersion ?? fromStory?.subjectVersion ?? null,
    confidence,
    verification: {
      researchGrade,
      officiallyVerified,
      officialSource: officiallyVerified ? lineage.sourceName : null,
      statement,
      lineage,
    },
    caveats,
  };
}

// ── Seller status ───────────────────────────────────────────────────────────

function sellerStatusFor(discovery: SellerDiscoverySynthesis | null): DecisionSellerStatus {
  if (!discovery || discovery.status === 'no_communications') {
    return {
      status: 'no_communications',
      statement: 'No seller conversation, inbound message or discovery note is retained. Motivation, price expectation, timeline and decision maker are unknown, and nothing about them is inferred from the property or its records.',
      communications: discovery?.record.communications ?? 0,
      discoveryExtractions: discovery?.record.discoveryExtractions ?? 0,
      lastContactAt: discovery?.record.lastContactAt ?? null,
      claims: [],
      historicalClaims: 0,
      conflicts: 0,
      unanswered: discovery?.unanswered ?? ['motivation', 'price', 'timeline', 'decision_maker', 'constraint', 'commitment'],
      operatorProfileNotes: discovery?.operatorProfileNotes ?? [],
    };
  }
  const latest = (dimension: SellerClaimDimension): SellerClaim | null => discovery.extraction[dimension]?.latest ?? null;
  const known = (['motivation', 'price', 'timeline', 'decision_maker'] as SellerClaimDimension[]).filter((dimension) => latest(dimension));
  const statement = `${discovery.record.conversationRecords + discovery.record.sellerMessages + discovery.record.discoveryExtractions} seller communication record(s) are retained`
    + (known.length
      ? `; the seller has spoken to ${known.map((dimension) => SELLER_CLAIM_DIMENSION_LABEL[dimension].toLowerCase()).join(', ')}.`
      : ', but none states motivation, price, timeline or who decides.')
    + (discovery.unanswered.length ? ` Still unanswered: ${discovery.unanswered.map((dimension) => SELLER_CLAIM_DIMENSION_LABEL[dimension].toLowerCase()).join(', ')}.` : '');
  return {
    status: 'communications_retained',
    statement,
    communications: discovery.record.communications,
    discoveryExtractions: discovery.record.discoveryExtractions,
    lastContactAt: discovery.record.lastContactAt,
    claims: currentClaims(discovery.claims).slice(0, 24).map((claim) => ({
      dimension: claim.dimension,
      label: SELLER_CLAIM_DIMENSION_LABEL[claim.dimension],
      statement: claim.statement,
      value: claim.value,
      weight: claim.weight,
      confidence: claim.confidence,
      modality: claim.modality,
      speaker: claim.speaker.label,
      source: claim.source.attribution,
      at: claim.source.at,
    })),
    historicalClaims: discovery.claims.filter((claim) => claim.status === 'historical').length,
    conflicts: discovery.conflicts?.length ?? 0,
    unanswered: discovery.unanswered,
    operatorProfileNotes: discovery.operatorProfileNotes,
  };
}

// ── Evidence sufficiency ────────────────────────────────────────────────────

function evidenceFor(
  subject: DecisionSubject,
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  dossier: AcquisitionDossier,
  seller: DecisionSellerStatus,
  value: ValueGuidance,
): EvidenceRequirement[] {
  const rows: EvidenceRequirement[] = [];
  rows.push({
    key: 'subject', label: 'Working Acquisition Subject',
    status: subject.confidence === 'confirmed' ? 'sufficient' : subject.confidence === 'well_supported' ? 'partial' : 'missing',
    statement: subject.verification.statement,
    requiredForOffer: true,
    unlock: subject.verification.officiallyVerified ? 'Established.' : 'An official assessor or GIS parcel record for the subject.',
  });
  rows.push({
    key: 'value', label: 'Qualified sale and value support',
    status: value.status === 'supported'
      ? (value.package?.combinedMethod === 'closest_evidence' ? 'partial' : 'sufficient')
      : value.acceptedCompCount > 0 ? 'partial' : 'missing',
    statement: value.status === 'supported'
      ? `Combined LandOS FMV ${usd(value.fmv!.central)}${value.basis ? ` (${value.basis})` : ''}.`
      : value.noPriceRationale ?? 'No supported fair market value exists.',
    requiredForOffer: true,
    unlock: guardOf(property, 'Fair market value')?.unlockedBy ?? 'An accepted sold-comparable set through Comps & Valuation.',
  });
  const zoning = topicOf(property, 'zoning');
  rows.push({
    key: 'zoning', label: 'Zoning and permitted use',
    status: zoning?.status === 'established' ? 'sufficient' : zoning?.status === 'partial' ? 'partial' : 'missing',
    statement: zoning?.headline ?? 'Zoning has not been read.',
    requiredForOffer: true,
    unlock: zoning?.verificationNeeded[0] ?? zoning?.gap ?? 'The parcel\'s zoning designation from the adopted map or a written determination.',
  });
  const access = topicOf(property, 'access');
  const legalAccessWithheld = !!guardOf(property, 'Legal access');
  rows.push({
    key: 'access', label: 'Legal access',
    status: !legalAccessWithheld && access?.status === 'established' ? 'sufficient' : access?.status === 'partial' ? 'partial' : 'missing',
    statement: legalAccessWithheld ? guardOf(property, 'Legal access')!.statement : (access?.headline ?? 'Access has not been read.'),
    requiredForOffer: true,
    unlock: guardOf(property, 'Legal access')?.unlockedBy ?? access?.verificationNeeded[0] ?? 'A recorded easement, plat dedication or deeded access instrument.',
  });
  const titleGuard = guardOf(property, 'Title');
  rows.push({
    key: 'title', label: 'Title',
    status: titleGuard ? 'missing' : 'sufficient',
    statement: titleGuard?.statement ?? 'A title position is retained.',
    requiredForOffer: false,
    unlock: titleGuard?.unlockedBy ?? 'Established.',
  });
  const sellerKnown = seller.claims.filter((claim) => claim.dimension === 'price' || claim.dimension === 'motivation').length > 0;
  rows.push({
    key: 'seller', label: 'Seller price and motivation',
    status: sellerKnown ? 'sufficient' : seller.status === 'communications_retained' ? 'partial' : 'missing',
    statement: seller.statement,
    requiredForOffer: true,
    unlock: sellerKnown ? 'Established from retained communications.' : 'A retained seller conversation or message that states a price expectation or a reason for selling.',
  });
  const utilities = topicOf(property, 'utilities');
  const wellSeptic = topicOf(property, 'well_septic');
  rows.push({
    key: 'utilities', label: 'Utilities, well and septic',
    status: utilities?.status === 'established' && wellSeptic?.status === 'established' ? 'sufficient'
      : utilities?.status === 'partial' || wellSeptic?.status === 'partial' ? 'partial' : 'missing',
    statement: [utilities?.headline, wellSeptic?.headline].filter(Boolean).join(' ') || 'Utility evidence has not been read.',
    requiredForOffer: false,
    unlock: guardOf(property, 'Utility availability')?.unlockedBy ?? 'A written availability response and a septic site evaluation.',
  });
  const environmental = ['flood', 'wetlands', 'soils'].map((key) => topicOf(property, key));
  rows.push({
    key: 'environmental', label: 'Flood, wetlands and soils',
    status: environmental.every((topic) => topic?.status === 'established') ? 'sufficient'
      : environmental.some((topic) => topic?.status === 'established') ? 'partial' : 'missing',
    statement: environmental.map((topic) => topic?.headline).filter(Boolean).join(' ') || 'Environmental screening has not been read.',
    requiredForOffer: false,
    unlock: guardOf(property, 'Environmental clearance')?.unlockedBy ?? 'A wetland delineation or environmental assessment.',
  });
  rows.push({
    key: 'market', label: 'Subject-band market record',
    status: market?.subjectBand.available ? (market.subjectBand.isStale ? 'partial' : 'sufficient') : 'missing',
    statement: market?.story.headline ?? 'No Market Story is retained.',
    requiredForOffer: false,
    unlock: market?.subjectBand.available ? 'Established.' : 'A retained market record for the subject\'s county and acreage band.',
  });
  void dossier;
  return rows;
}

// ── Value ───────────────────────────────────────────────────────────────────

function valueFor(
  property: PropertyEvidenceSynthesis | null,
  dossier: AcquisitionDossier,
  seller: DecisionSellerStatus,
): ValueGuidance {
  const fmvGuard = guardOf(property, 'Fair market value');
  const accepted = dossier.valuation.acceptedCompCount ?? 0;
  const pkg = dossier.valuation.package ?? null;
  // Combined LandOS FMV is the governing current value. The single central
  // figure is only a fallback for a property file written before the package
  // existed; LandPortal-only, non-LandPortal-only, asking price, assessment and
  // band references never substitute for it here.
  const central = pkg?.combinedFmv ?? dossier.valuation.fairMarketValue;
  const askingFromSeller = seller.claims.find((claim) => claim.dimension === 'price');
  const askingPrice = dossier.seller.askingPrice ?? null;
  const askingPriceSource = askingPrice != null
    ? (askingFromSeller ? `Deal Card asking price; the seller also spoke to price (${askingFromSeller.source})` : 'Deal Card asking price on file; no retained communication confirms it')
    : askingFromSeller ? `Seller communication only: ${askingFromSeller.statement}` : null;

  if (central == null || (pkg == null && (fmvGuard || accepted < 1))) {
    const rationale = [
      fmvGuard?.statement ?? 'No fair market value is asserted.',
      ...property?.limitations.filter((limit) => /closed .*sale|valuation|value/i.test(limit)).slice(0, 2) ?? [],
      ...dossier.valuation.blockers.slice(0, 2),
    ];
    return {
      status: 'withheld',
      fmv: null,
      basis: null,
      acceptedCompCount: accepted,
      offerGuidance: null,
      askingPrice,
      askingPriceSource,
      askingVsGuidance: null,
      noPriceRationale: [...new Set(rationale.map(sentence))].join(' '),
      package: pkg,
    };
  }

  // The standard 40% / 60% operator benchmarks derive from Combined LandOS FMV
  // only. Strategy-specific maximums live in the exit scenarios, never here.
  const flip = strategyParams('quick_flip');
  const low = pkg?.offer40 ?? Math.round(central * 0.4);
  const high = pkg?.offer60 ?? Math.round(central * 0.6);
  const askingVsGuidance = askingPrice == null
    ? null
    : askingPrice > high
      ? `The asking price ${usd(askingPrice)} is above the ${usd(high)} 60% benchmark of Combined LandOS FMV: a renegotiation, not an acceptance.`
      : askingPrice < low
        ? `The asking price ${usd(askingPrice)} is below the ${usd(low)} 40% benchmark of Combined LandOS FMV: confirm the seller's number before offering less.`
        : `The asking price ${usd(askingPrice)} sits inside the standard ${usd(low)}–${usd(high)} (40–60%) benchmark of Combined LandOS FMV.`;
  const basisParts = [
    pkg ? `Combined LandOS FMV: ${pkg.combinedMethodLabel ?? pkg.combinedMethod ?? 'combined'}` : null,
    pkg?.landPortalFmv != null ? `LandPortal FMV ${usd(pkg.landPortalFmv)}` : pkg ? 'LandPortal FMV unavailable' : null,
    pkg?.nonLandPortalFmv != null ? `Non-LandPortal FMV ${usd(pkg.nonLandPortalFmv)} from ${pkg.nonLandPortalCompCount ?? 0} closed sale(s)` : pkg ? 'Non-LandPortal FMV unavailable' : null,
    pkg?.confidence ? `confidence ${pkg.confidence}` : null,
    pkg?.combinedLimitation ?? null,
    fmvGuard?.statement ?? null,
  ].filter((part): part is string => !!part);
  return {
    status: 'supported',
    fmv: { low: null, central, high: null },
    basis: basisParts.length ? basisParts.join('; ') : dossier.valuation.basis,
    acceptedCompCount: accepted,
    offerGuidance: {
      strategy: 'quick_flip',
      strategyLabel: pkg ? 'Standard acquisition benchmark' : flip.label,
      lowPct: 40,
      highPct: 60,
      low,
      high,
      confirmed: pkg != null || flip.confirmed,
    },
    askingPrice,
    askingPriceSource,
    askingVsGuidance,
    noPriceRationale: null,
    package: pkg,
  };
}

// ── Risks and opportunities ─────────────────────────────────────────────────

const RISK_MAGNITUDE: Record<string, RankedItem['magnitude']> = {
  access: 'high', zoning: 'high', value: 'high', title: 'high', subject: 'high',
  well_septic: 'medium', utilities: 'medium', taxes: 'medium', wetlands: 'medium', flood: 'medium',
  development_status: 'low', soils: 'low', site_conditions: 'low', frontage: 'low',
};
const MAGNITUDE_RANK: Record<RankedItem['magnitude'], number> = { high: 0, medium: 1, low: 2 };

function rankedRisks(
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  value: ValueGuidance,
  subject: DecisionSubject,
): RankedItem[] {
  const items: Omit<RankedItem, 'rank'>[] = [];
  if (value.status === 'withheld') {
    items.push({
      key: 'value', title: 'No supported value',
      statement: value.noPriceRationale ?? 'No fair market value is supported.',
      magnitude: 'high', standing: 'verification_need',
      basis: 'Property Story guardrail: fair market value',
      action: guardOf(property, 'Fair market value')?.unlockedBy ?? 'An accepted sold-comparable set.',
    });
  }
  if (value.status === 'supported' && value.package && (value.package.confidence === 'low' || value.package.combinedMethod === 'closest_evidence')) {
    items.push({
      key: 'value_confidence', title: 'Low confidence in the current value',
      statement: `Combined LandOS FMV ${usd(value.fmv!.central)} is ${value.package.combinedMethodLabel?.toLowerCase() ?? 'thinly supported'}${value.package.combinedLimitation ? `: ${value.package.combinedLimitation}` : '.'}`,
      magnitude: 'medium', standing: 'verification_need',
      basis: 'Comps & Valuation package', action: 'Admit more qualified closed vacant-land sales through Comps & Valuation.',
    });
  }
  if ((value.package?.activeCompetitionCount ?? 0) >= 3) {
    items.push({
      key: 'resale_competition', title: `${value.package!.activeCompetitionCount} active listings compete for the resale buyer`,
      statement: value.package!.activeCompetitionSummary ?? 'Active land listings compete for the same buyers.',
      magnitude: 'medium', standing: 'market_record',
      basis: 'Comps & Valuation active competition', action: 'Price the resale against the active asks, not against FMV alone.',
    });
  }
  for (const guard of property?.guardrails ?? []) {
    if (guard.claimKind === 'Fair market value') continue;
    const key = guard.claimKind === 'Legal access' ? 'access' : guard.claimKind === 'Title' ? 'title' : guard.claimKind.toLowerCase().replace(/\s+/g, '_');
    if (key === 'entitlement_approval' || key === 'environmental_clearance' || key === 'utility_availability') continue;
    items.push({
      key, title: `${guard.claimKind} not established`,
      statement: guard.statement, magnitude: RISK_MAGNITUDE[key] ?? 'medium', standing: 'verification_need',
      basis: `Property Story guardrail: ${guard.claimKind.toLowerCase()}`, action: guard.unlockedBy,
    });
  }
  for (const topic of property?.diligence ?? []) {
    if (topic.status === 'established') continue;
    if (items.some((item) => item.key === topic.key)) continue;
    items.push({
      key: topic.key, title: `${topic.label}: ${topic.status}`,
      statement: topic.gap ?? topic.headline, magnitude: RISK_MAGNITUDE[topic.key] ?? 'low', standing: 'verification_need',
      basis: `Property Story diligence: ${topic.label.toLowerCase()}`, action: topic.verificationNeeded[0] ?? null,
    });
  }
  for (const conflict of property?.conflicts ?? []) {
    if (conflict.resolution !== 'unresolved' || !conflict.material) continue;
    items.push({
      key: `conflict:${conflict.topic}`, title: `Open source conflict: ${conflict.label.toLowerCase()}`,
      statement: conflict.statement, magnitude: 'medium', standing: 'verification_need',
      basis: `Sources: ${conflict.sides.flatMap((side) => side.sources).join('; ')}`, action: conflict.reason,
    });
  }
  // Recorded easements and restrictions read from the instrument itself are a
  // record fact the buyer inherits, so they rank as a risk even though nothing
  // is "missing": the restrictions bind the resale and any division.
  const encumbrance = (property?.recordFacts ?? []).find((entry) => entry.topic === 'record.encumbrances');
  if (encumbrance) {
    items.push({
      key: 'recorded_encumbrances', title: 'Recorded easements and restrictions',
      statement: encumbrance.statement, magnitude: 'medium', standing: 'record_fact',
      basis: encumbrance.source?.name ?? 'County recorded government records',
      action: 'Read the referenced restriction and easement instruments before contract; a title commitment is the only authority on what binds the parcel.',
    });
  }
  const wetlands = topicOf(property, 'wetlands');
  const wetShare = wetlands?.claims.map((claim) => Number((claim.value ?? '').replace('%', ''))).find((share) => Number.isFinite(share));
  if (wetShare != null && wetShare >= 40) {
    items.push({
      key: 'wet_share', title: `Mapped wetlands cover ${wetShare}% of the parcel`,
      statement: `${wetlands!.headline} A large wet share shrinks the buildable envelope and the buyer pool; only a delineation establishes the real boundary.`,
      magnitude: wetShare >= 60 ? 'high' : 'medium', standing: 'record_fact',
      basis: wetlands!.claims[0]?.source.name ?? 'Retained parcel record', action: guardOf(property, 'Environmental clearance')?.unlockedBy ?? 'A wetland delineation.',
    });
  }
  for (const claim of seller.claims.filter((entry) => entry.dimension === 'constraint').slice(0, 3)) {
    items.push({
      key: `seller_constraint:${claim.statement.slice(0, 24)}`, title: 'Seller-stated constraint',
      statement: claim.statement, magnitude: 'medium', standing: 'seller_reported',
      basis: claim.source, action: 'Confirm against the record before it changes the offer.',
    });
  }
  if (seller.status === 'no_communications') {
    items.push({
      key: 'seller_unknown', title: 'Seller position unknown',
      statement: 'No retained communication states a price expectation, motivation, timeline or decision maker. An offer formed now would be priced against silence.',
      magnitude: 'high', standing: 'verification_need', basis: 'Seller Intelligence: no communications retained',
      action: 'A first seller conversation from the discovery brief.',
    });
  }
  if (market?.subjectBand.available && market.subjectBand.monthsOfSupply != null && market.subjectBand.monthsOfSupply >= 12) {
    items.push({
      key: 'supply', title: `${market.subjectBand.monthsOfSupply} months of supply in the subject band`,
      statement: market.story.liquidityRead, magnitude: 'medium', standing: 'market_record',
      basis: `${market.subjectBand.source ?? 'Retained market record'} · ${market.subjectBand.resolvedKeyLabel ?? ''}`.trim(),
      action: 'Underwrite hold time and price to the resale timeline, not to list-to-sale days alone.',
    });
  }
  for (const caveat of subject.caveats.slice(0, 2)) {
    if (/survey/i.test(caveat)) {
      items.push({
        key: 'survey', title: 'Governing acreage rests on an unseen survey',
        statement: caveat, magnitude: 'medium', standing: 'verification_need',
        basis: 'Accepted subject: acreage basis', action: 'Supply the signed boundary survey to LandOS.',
      });
    }
  }
  return items
    .sort((a, b) => MAGNITUDE_RANK[a.magnitude] - MAGNITUDE_RANK[b.magnitude])
    .slice(0, 10)
    .map((item, index) => ({ rank: index + 1, ...item }));
}

function rankedOpportunities(
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  dossier: AcquisitionDossier,
): RankedItem[] {
  const items: Omit<RankedItem, 'rank'>[] = [];
  const pkg = dossier.valuation.package;
  if (pkg?.combinedFmv != null && pkg.askingPrice != null && pkg.offer60 != null && pkg.askingPrice <= pkg.offer60) {
    items.push({
      key: 'asking_inside_benchmark', title: 'Asking price sits at or below the 60% benchmark',
      statement: `The seller's ${usd(pkg.askingPrice)} is at or below ${usd(pkg.offer60)} (60% of Combined LandOS FMV ${usd(pkg.combinedFmv)}).`,
      magnitude: 'high', standing: 'record_fact', basis: 'Deal Card asking price against the valuation package', action: 'Confirm the seller number, then offer inside the 40–60% benchmark.',
    });
  }
  if (pkg?.combinedFmv != null && (pkg.activeCompetitionCount ?? 0) === 0) {
    items.push({
      key: 'no_active_competition', title: 'No retained active listing competes for the resale',
      statement: pkg.activeCompetitionSummary ?? 'No active land listing is retained as resale competition.',
      magnitude: 'low', standing: 'market_record', basis: 'Comps & Valuation active competition', action: null,
    });
  }
  for (const opportunity of property?.story.opportunities ?? []) {
    items.push({
      key: `story:${opportunity.slice(0, 24)}`, title: opportunity.split(':')[0] ?? opportunity,
      statement: opportunity, magnitude: /cheapest unlock|single/i.test(opportunity) ? 'high' : 'medium',
      standing: 'analytical_hypothesis', basis: 'Property Story', action: null,
    });
  }
  if (market?.subjectBand.available) {
    const ppa = market.subjectBand.medianPricePerAcre;
    items.push({
      key: 'band_record', title: `The subject band carries a retained sales record`,
      statement: `${market.story.headline}${ppa != null && dossier.identity.acres != null ? ` At the band median that is roughly ${usd(ppa * dossier.identity.acres)} for ${dossier.identity.acres} acres — a market reference, not a subject value.` : ''}`,
      magnitude: 'medium', standing: 'market_record',
      basis: `${market.subjectBand.source ?? 'Retained market record'} · ${market.subjectBand.resolvedKeyLabel ?? ''}`.trim(),
      action: 'Turn the band reference into subject value with qualified closed sales.',
    });
  }
  const frontage = topicOf(property, 'frontage');
  if (frontage?.status === 'established') {
    items.push({
      key: 'frontage', title: 'Mapped road frontage',
      statement: frontage.headline, magnitude: 'medium', standing: 'record_fact',
      basis: frontage.claims[0]?.source.name ?? 'Retained parcel record', action: 'Convert mapped frontage into recorded legal access.',
    });
  }
  const flood = topicOf(property, 'flood');
  if (flood?.status === 'established' && /minimal/i.test(flood.headline)) {
    items.push({
      key: 'flood', title: 'Minimal mapped flood hazard',
      statement: flood.headline, magnitude: 'low', standing: 'record_fact',
      basis: flood.claims[0]?.source.name ?? 'Retained parcel record', action: null,
    });
  }
  for (const claim of seller.claims.filter((entry) => entry.dimension === 'motivation' || entry.dimension === 'timeline').slice(0, 2)) {
    items.push({
      key: `seller:${claim.dimension}`, title: `Seller ${claim.label.toLowerCase()} stated`,
      statement: claim.statement, magnitude: 'medium', standing: 'seller_reported', basis: claim.source,
      action: 'Shape terms to what the seller said they need.',
    });
  }
  for (const path of dossier.history.developmentPaths.slice(0, 2)) {
    items.push({
      key: `path:${path.path.slice(0, 24)}`, title: path.path, statement: `${path.practicalYield} ${path.economics}`.trim(),
      magnitude: 'medium', standing: 'analytical_hypothesis', basis: 'Retained development-history read', action: path.process,
    });
  }
  return items
    .sort((a, b) => MAGNITUDE_RANK[a.magnitude] - MAGNITUDE_RANK[b.magnitude])
    .slice(0, 8)
    .map((item, index) => ({ rank: index + 1, ...item }));
}

// ── Exit strategies ─────────────────────────────────────────────────────────

function exitStrategiesFor(
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  dossier: AcquisitionDossier,
  value: ValueGuidance,
  seller: DecisionSellerStatus,
): ExitStrategyRead[] {
  const zoning = topicOf(property, 'zoning');
  const zoningEstablished = zoning?.status === 'established';
  const accessEstablished = !guardOf(property, 'Legal access');
  const septic = topicOf(property, 'well_septic')?.status === 'established';
  const utilities = topicOf(property, 'utilities')?.status === 'established';
  const improved = !!clean(dossier.physical.improvement) && !/none|vacant|no improvement/i.test(dossier.physical.improvement ?? '');
  const acres = dossier.identity.acres;
  // A retained "Not researched." placeholder is an absence, not a lot size.
  const minLotRaw = clean(dossier.subdivision.minimumLotArea);
  const minLot = minLotRaw && !/not (researched|established|retained|found)|unresolved|n\/a|none|pending/i.test(minLotRaw) ? minLotRaw : null;
  const bandLiquid = !!market?.subjectBand.available && (market.subjectBand.daysOnMarket == null || market.subjectBand.daysOnMarket <= 120);
  const sellerTimeline = seller.claims.find((claim) => claim.dimension === 'timeline')?.statement ?? null;
  const manufactured = dossier.landUse.manufacturedHousing;

  const read = (
    id: StrategyId,
    status: ExitStrategyStatus,
    statusWhy: string,
    keyRequirement: string,
    criticalGate: string,
  ): ExitStrategyRead => {
    const basis = economicBasisFor(id);
    return {
      id, label: strategyParams(id).label, status, statusWhy: sentence(statusWhy), keyRequirement: sentence(keyRequirement),
      criticalGate: sentence(criticalGate), economicBasis: basis.text, economicBasisConfirmed: basis.confirmed,
    };
  };

  const valueGate = value.status === 'supported'
    ? `Expected value ${usd(value.fmv!.central)} is supported by ${value.acceptedCompCount} accepted sale(s)`
    : 'A supported expected value from accepted closed sales';
  const strategies: ExitStrategyRead[] = [];

  strategies.push(read(
    'quick_flip',
    value.status === 'supported' && accessEstablished ? 'supported' : value.status === 'supported' || bandLiquid ? 'conditional' : 'unknown',
    value.status === 'supported'
      ? (accessEstablished ? 'Value and access are supported; the band is the base exit.' : 'Value is supported but legal access is not; a flip prices as landlocked until it is.')
      : bandLiquid ? 'The subject band is moving, but no subject value exists to apply the flip band to.' : 'Neither a subject value nor a liquid subject band is established.',
    valueGate,
    accessEstablished ? 'Resale at or near the band median inside the retained days-on-market' : 'Recorded legal access, then resale inside the retained days-on-market',
  ));

  strategies.push(read(
    'wholesale_assignment',
    value.status === 'supported' ? 'conditional' : 'unknown',
    value.status === 'supported' ? 'An assignment needs a buyer at the wholesale band; the band itself is an unconfirmed draft.' : 'No expected value to set an assignment price against.',
    'A buyer willing to close at the assignment price with the same diligence gaps',
    'Contract assignability and a confirmed wholesale band',
  ));

  strategies.push(read(
    'retail_flip',
    accessEstablished && septic && zoningEstablished ? 'supported' : value.status === 'supported' ? 'conditional' : 'unknown',
    accessEstablished && septic && zoningEstablished
      ? 'Access, septic feasibility and zoning are all established: an end-user home site can be marketed.'
      : `An end-user buyer needs ${[!accessEstablished && 'recorded access', !septic && 'septic feasibility', !zoningEstablished && 'a known zoning district'].filter(Boolean).join(', ')} before the parcel reads as a home site.`,
    'A home-site story an end user can finance: access, septic, zoning and utilities',
    septic ? 'Recorded legal access' : 'A septic site evaluation or percolation test',
  ));

  const splitStatus: ExitStrategyStatus = acres != null && acres < 2 && !minLot
    ? 'not_supported'
    : zoningEstablished && minLot ? 'conditional' : 'unknown';
  strategies.push(read(
    'subdivision_minor_split',
    splitStatus,
    splitStatus === 'not_supported'
      ? `${acres} acres with no retained minimum lot size leaves no evidence a further split is possible; the subject is already the split product.`
      : minLot && zoningEstablished
        ? `The retained minimum lot area is ${minLot}; yield depends on the district's dimensional standards.`
        : minLot
          ? `Subdivision rules are retained (minimum lot area ${minLot}), but the parcel's zoning district is not established, so no yield can be read.`
          : 'Zoning and subdivision rules are not established for this parcel.',
    'A zoning district whose minimum lot size and frontage permit more than one lot',
    zoningEstablished ? 'County subdivision approval' : 'Zoning established, then the subdivision ordinance read against it',
  ));

  strategies.push(read(
    'land_home_package',
    manufactured.length && septic ? 'conditional' : 'unknown',
    manufactured.length
      ? `Manufactured housing rules are retained (${manufactured[0]}); the gate is verified manufactured-home sales in the market.`
      : 'Whether manufactured housing is permitted is not established, and no home-sale comparables are retained.',
    'Verified manufactured-home sales at $200k–$300k+ in the market and a permitted placement',
    septic ? 'Manufactured-home resale evidence' : 'Septic feasibility, then manufactured-home resale evidence',
  ));

  strategies.push(read(
    'owner_finance_exit',
    value.status === 'supported' ? 'conditional' : 'unknown',
    value.status === 'supported' ? 'Terms-based; needs a note buyer or hold appetite and a supported value to price the note.' : 'No supported value to price a note against.',
    'A supported value, a down payment the market bears, and a hold or note-sale plan',
    'Legal access and clear title before any note is written',
  ));

  strategies.push(read(
    'neighbor_sale',
    property?.relatedBoundaries.length ? 'conditional' : 'unknown',
    property?.relatedBoundaries.length
      ? `${property.relatedBoundaries.length} related boundary(ies) are retained; an adjoiner is a natural buyer for a small split.`
      : 'No adjoining owner is identified in the retained record.',
    'An identified adjoining owner with a reason to add the acreage',
    'Adjoiner outreach after legal access is established',
  ));

  if (improved) {
    strategies.push(read(
      'improved_flip',
      'unknown',
      `An improvement is recorded (${dossier.physical.improvement}); improved-property comparables are not retained.`,
      'Improved-property resale comparables and a condition read',
      'Structure condition and insurability',
    ));
  }

  if (sellerTimeline) {
    for (const strategy of strategies) {
      if (strategy.status === 'unknown') continue;
      strategy.statusWhy += ` Seller timeline: ${sellerTimeline}`;
    }
  }
  return strategies;
}

// ── Stage 5: exit scenarios and the strategy comparison ─────────────────────

/**
 * The as-is cost assumptions Comps & Valuation's quick-flip underwriting
 * uses, restated here so the pure synthesis carries no database import. A
 * test pins them to `QUICK_FLIP` in comps-valuation.ts.
 */
export const AS_IS_COST_ASSUMPTIONS = {
  sellingCostPct: 0.07,
  sellerClosingPct: 0.02,
  carryingCostPct: 0.015,
  riskReservePct: 0.05,
} as const;

const SCENARIO_LABEL: Record<ScenarioId, string> = {
  as_is_quick_flip: 'As-is resale / quick flip',
  light_improvement: 'Light improvement, then flip',
  minor_subdivision: 'Minor subdivision / lot split',
  major_subdivision_entitlement: 'Major subdivision / entitlement',
  land_home_manufactured: 'Land-home or manufactured-home package',
  novation_double_close: 'Novation or double close',
  owner_finance: 'Owner-finance exit',
};

const COMPLEXITY_RANK: Record<ExitScenario['complexity'], number> = { low: 0, medium: 1, high: 2 };
const SCENARIO_STATUS_RANK: Record<ScenarioStatus, number> = { viable: 0, conditional: 1, unknown: 2, not_supported: 3 };

const missingLine = (key: string, label: string, basis: string): CostLine => ({ key, label, amount: null, basis, source: 'missing' });

/** A seller price claim's numbers, when it states any. */
function sellerPriceNumbers(claim: DecisionSellerStatus['claims'][number] | undefined): number[] {
  if (!claim) return [];
  const text = `${claim.value ?? ''} ${claim.statement}`;
  const amounts = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|thousand)?/gi)]
    .map((match) => Math.round(Number(match[1].replace(/,/g, '')) * (match[2] ? 1000 : 1)))
    .filter((amount) => Number.isFinite(amount) && amount >= 1000);
  return [...new Set(amounts)].sort((a, b) => a - b);
}

function strategyComparisonFor(
  developmentPath: ZoningDevelopmentIntelligence | null,
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  dossier: AcquisitionDossier,
  value: ValueGuidance,
  seller: DecisionSellerStatus,
  subject: DecisionSubject,
): StrategyComparison {
  const pathOf = (kind: PathKind) => developmentPath?.paths.find((path) => path.kind === kind) ?? null;
  const useOf = (key: string) => developmentPath?.uses.find((use) => use.key === key) ?? null;
  const gateActions = (kinds: PathKind[]) => (developmentPath?.criticalGates ?? []).filter((gate) => gate.blocks.some((kind) => kinds.includes(kind))).map((gate) => gate.gate);
  const accessEstablished = !guardOf(property, 'Legal access');
  const septic = topicOf(property, 'well_septic')?.status === 'established';
  const districtEstablished = developmentPath?.zoning.established ?? (topicOf(property, 'zoning')?.status === 'established');
  const dwelling = useOf('single_family_dwelling');
  const manufactured = useOf('manufactured_home');
  const acres = subject.acres ?? dossier.identity.acres;
  const band = market?.subjectBand;
  const liquidity = band?.available
    ? `${band.bandUsedLabel ?? 'Subject band'}: ${band.sampleCount ?? '?'} sales, ${band.daysOnMarket != null ? `${Math.round(band.daysOnMarket)} days on market` : 'days on market not stated'}${band.monthsOfSupply != null ? `, ${band.monthsOfSupply} months of supply` : ''} (${band.source ?? 'retained market record'}).`
    : 'No retained market record for the subject band; buyer demand is not established.';
  const timeFromMarket: ExitScenario['timeToExit'] = band?.available && band.daysOnMarket != null
    ? { statement: `About ${Math.round(band.daysOnMarket)} days median list-to-sale in the ${band.bandUsedLabel ?? 'subject'} band plus roughly 45 days to close; ${band.monthsOfSupply != null && band.monthsOfSupply >= 12 ? 'months of supply say the realistic hold is longer' : 'supply does not contradict it'}.`, basis: `${band.source ?? 'Retained market record'} · ${band.resolvedKeyLabel ?? ''} · ${band.period ?? ''}`.replace(/\s·\s$/, '').trim() }
    : null;

  // The seller's price, as a sensitivity input only.
  const askingPrice = value.askingPrice;
  const priceClaim = seller.claims.find((claim) => claim.dimension === 'price');
  const claimNumbers = sellerPriceNumbers(priceClaim);
  const purchase: { price: number; basis: string } | null = askingPrice != null
    ? { price: askingPrice, basis: value.askingPriceSource ?? 'Deal Card asking price' }
    : claimNumbers.length
      ? { price: claimNumbers.length > 1 ? Math.round((claimNumbers[0] + claimNumbers[claimNumbers.length - 1]) / 2) : claimNumbers[0], basis: `Seller communication: ${priceClaim!.statement} (${priceClaim!.source})` }
      : null;

  const scenarios: ExitScenario[] = [];

  // ── As-is / quick flip ──
  {
    const flip = strategyParams('quick_flip');
    const asIs = pathOf('as_is');
    const exit = value.status === 'supported' ? { amount: value.fmv!.central, basis: `${value.basis ?? 'Accepted closed sales'}; ${value.acceptedCompCount} accepted sale(s)`, asOf: null } : null;
    const capacity = exit ? { low: Math.round(exit.amount * flip.offerPctLowOfEv! / 100), high: Math.round(exit.amount * flip.offerPctHighOfEv! / 100), lowPct: flip.offerPctLowOfEv!, highPct: flip.offerPctHighOfEv!, basis: `${flip.label} band, ${flip.offerPctLowOfEv}–${flip.offerPctHighOfEv}% of expected value`, confirmed: flip.confirmed } : null;
    const direct: CostLine[] = exit
      ? [
        { key: 'selling', label: 'Selling costs', amount: Math.round(exit.amount * AS_IS_COST_ASSUMPTIONS.sellingCostPct), basis: '7% of sale price', source: 'landos_operating_assumption' },
        { key: 'seller_closing', label: 'Seller-side closing', amount: Math.round(exit.amount * AS_IS_COST_ASSUMPTIONS.sellerClosingPct), basis: '2% of sale price', source: 'landos_operating_assumption' },
      ]
      : [missingLine('selling', 'Selling and closing costs', 'Computed as a share of the sale price once a supported value exists.')];
    const soft: CostLine[] = exit
      ? [
        { key: 'carrying', label: 'Carrying costs', amount: Math.round(exit.amount * AS_IS_COST_ASSUMPTIONS.carryingCostPct), basis: '1.5% of sale price across the marketing period', source: 'landos_operating_assumption' },
        { key: 'reserve', label: 'Risk reserve', amount: Math.round(exit.amount * AS_IS_COST_ASSUMPTIONS.riskReservePct), basis: '5% of sale price', source: 'landos_operating_assumption' },
        missingLine('purchase_closing', 'Purchase-side closing and title', 'No operator figure; typically title, recording and closing fees at acquisition.'),
      ]
      : [missingLine('carrying', 'Carrying costs and risk reserve', 'Computed once a supported value exists.')];
    const costTotal = [...direct, ...soft].filter((line) => line.amount != null).reduce((sum, line) => sum + (line.amount ?? 0), 0);
    const allCostsVisible = [...direct, ...soft].every((line) => line.amount != null);
    const missing: string[] = [];
    if (!exit) missing.push(value.noPriceRationale ?? 'A supported fair market value from accepted closed sales.');
    if (!purchase) missing.push('A purchase price: no Deal Card asking price and no retained seller price statement.');
    if (!allCostsVisible && exit) missing.push('Purchase-side closing and title cost (operator figure).');
    if (!timeFromMarket) missing.push('A retained subject-band days-on-market record for time to exit.');
    const metrics: ExitScenario['returnMetrics'] = exit && purchase && allCostsVisible
      ? (() => {
        const totalCost = purchase.price + costTotal;
        const net = exit.amount - totalCost;
        return { purchasePrice: purchase.price, purchasePriceBasis: purchase.basis, totalCost, netProfit: net, returnOnCapital: Number((net / (purchase.price + costTotal - direct.reduce((sum, line) => sum + (line.amount ?? 0), 0))).toFixed(3)), minimumNet: flip.minNetProfitUsd, meetsMinimumNet: net >= flip.minNetProfitUsd, basis: `Expected value ${usd(exit.amount)} less the purchase price and every cost line above; LandOS operating assumptions pending operator confirmation.` };
      })()
      : null;
    const status: ScenarioStatus = exit && accessEstablished && districtEstablished ? 'viable' : exit || band?.available ? 'conditional' : 'unknown';
    scenarios.push({
      id: 'as_is_quick_flip', label: SCENARIO_LABEL.as_is_quick_flip, strategyId: 'quick_flip', pathKind: 'as_is',
      subjectScope: `The whole ${acres ?? '?'} ac parcel, sold as vacant land without division.`,
      status, confidence: exit ? (accessEstablished ? 'well_supported' : 'likely') : 'unresolved',
      statusWhy: exit
        ? (accessEstablished && districtEstablished ? 'Value, access and the district are supported; this is the base exit.' : `Value is supported but ${[!accessEstablished && 'legal access', !districtEstablished && 'the current district'].filter(Boolean).join(' and ')} ${!accessEstablished && !districtEstablished ? 'are' : 'is'} not established.`)
        : band?.available ? 'The subject band is moving, but no subject value exists to price the flip against.' : 'Neither a subject value nor a subject-band record is established.',
      grossExit: exit,
      purchasePriceCapacity: capacity,
      directCosts: direct, softCosts: soft,
      capitalAtRisk: purchase && exit ? { amount: purchase.price + (soft.find((line) => line.key === 'carrying')?.amount ?? 0), basis: 'Purchase price plus carrying costs until resale.' } : null,
      timeToExit: timeFromMarket,
      keyApprovals: asIs?.approvalSteps.length ? asIs.approvalSteps : ['None beyond title and recorded access; no subdivision review.'],
      returnMetrics: metrics,
      missingInputs: missing,
      complexity: 'low',
      buyerDemand: liquidity,
      risks: gateActions(['as_is']),
      nextDecisiveAction: !exit ? 'Admit qualified closed sales through Comps & Valuation to support a value.' : asIs?.decisiveVerification.action ?? 'Record legal access.',
    });
  }

  // ── Light improvement, then flip ──
  {
    const params = strategyParams('improvement_play');
    const asIs = pathOf('as_is');
    const status: ScenarioStatus = districtEstablished && dwelling?.standing === 'by_right' && accessEstablished ? 'conditional' : dwelling?.standing === 'prohibited' ? 'not_supported' : 'unknown';
    scenarios.push({
      id: 'light_improvement', label: SCENARIO_LABEL.light_improvement, strategyId: 'improvement_play', pathKind: 'as_is',
      subjectScope: 'The whole parcel, sold as a prepared home site (cleared, driveway, well/septic or utility taps as the market expects).',
      status, confidence: status === 'conditional' ? 'likely' : 'unresolved',
      statusWhy: status === 'conditional'
        ? 'A dwelling is by right and access is established, so a home-site product is possible; the improved-lot resale value and the improvement quotes are not retained.'
        : status === 'not_supported' ? `${dwelling!.label} is prohibited; there is no home-site product to prepare.` : `A home-site product needs ${[!districtEstablished && 'the current district', dwelling?.standing !== 'by_right' && 'a by-right dwelling use', !accessEstablished && 'recorded access'].filter(Boolean).join(', ')} before it can be read.`,
      grossExit: null,
      purchasePriceCapacity: null,
      directCosts: [missingLine('clearing', 'Clearing and driveway', 'Operator or contractor quote.'), missingLine('well_septic', 'Well and septic (or utility taps)', 'Contractor quote after the health-department evaluation.')],
      softCosts: [missingLine('permits', 'Driveway, septic and building-site permits', `${asIs?.authority ?? 'Jurisdiction'} fee schedule, not retained.`), missingLine('carrying', 'Carrying costs across the improvement and marketing period', 'Computed once an improved-lot value and a timeline exist.')],
      capitalAtRisk: null,
      timeToExit: null,
      keyApprovals: [...(asIs?.approvalSteps ?? []), ...(septic ? [] : ['Health-department septic site evaluation.'])],
      returnMetrics: null,
      missingInputs: ['Improved-lot resale comparables (prepared home sites in the same band).', 'Improvement quotes: clearing, driveway, well/septic or taps.', 'Permit fees and a build-out timeline.'],
      complexity: 'medium',
      buyerDemand: liquidity,
      risks: gateActions(['as_is']),
      nextDecisiveAction: septic ? 'Obtain contractor quotes for clearing, driveway and well/septic, then admit prepared-lot comparables.' : 'Order the health-department septic site evaluation; every improvement quote depends on it.',
    });
    void params;
  }

  // ── Minor subdivision ──
  {
    const params = strategyParams('subdivision_minor_split');
    const path = pathOf('minor_subdivision');
    const lots = developmentPath?.subjectScreen.theoreticalLotCount.value ?? null;
    const minLot = developmentPath?.subjectScreen.minimumLotAcres ?? null;
    const status: ScenarioStatus = !path ? 'unknown' : path.applicability === 'applies' ? 'viable' : path.applicability === 'may_apply' ? 'conditional' : path.applicability === 'not_applicable' ? 'not_supported' : 'unknown';
    const fee = path?.costAndTime?.estimatedCost ?? null;
    scenarios.push({
      id: 'minor_subdivision', label: SCENARIO_LABEL.minor_subdivision, strategyId: 'subdivision_minor_split', pathKind: 'minor_subdivision',
      subjectScope: lots != null ? `${lots} theoretical lot(s)${minLot != null ? ` at a ${minLot} ac minimum` : ''} out of ${acres ?? '?'} ac; arithmetic, not an approved yield.` : `Division of the ${acres ?? '?'} ac parcel into lots; the count is not yet computable.`,
      status, confidence: path?.weight ?? 'unresolved',
      statusWhy: path ? `${path.applicabilityWhy}` : 'No Development Path is retained; the local lot-split path cannot be read.',
      grossExit: null,
      purchasePriceCapacity: null,
      directCosts: [
        missingLine('survey_plat', 'Boundary survey and plat', 'Surveyor quote; the regulation names the plat and survey the review body accepts.'),
        ...(path?.requirements.some((row) => row.kind === 'road' || row.kind === 'access') ? [missingLine('road_access', 'Road or access improvements the regulation requires', path.requirements.filter((row) => row.kind === 'road' || row.kind === 'access').map((row) => row.requirement).join(' ').slice(0, 220))] : []),
        ...(path?.requirements.some((row) => row.kind === 'utilities') ? [missingLine('utilities', 'Utility, well or septic provisions per lot', path.requirements.filter((row) => row.kind === 'utilities').map((row) => row.requirement).join(' ').slice(0, 220))] : []),
      ],
      softCosts: [
        fee ? { key: 'review_fee', label: 'Review fee', amount: null, basis: fee, source: 'retained_source' } : missingLine('review_fee', 'Review and recording fees', 'Not stated in the retained regulation.'),
        missingLine('carrying', 'Carrying costs through review and lot marketing', 'Computed once a timeline and per-lot value exist.'),
      ],
      capitalAtRisk: null,
      timeToExit: path?.costAndTime?.estimatedTime ? { statement: path.costAndTime.estimatedTime, basis: path.costAndTime.basis } : null,
      keyApprovals: path?.approvalSteps.length ? path.approvalSteps : path ? [path.decisiveVerification.action] : [],
      returnMetrics: null,
      missingInputs: [
        'Per-lot resale value from qualified sales of lots at the resulting size.',
        ...(path?.missingInputs ?? []),
        ...(path?.costAndTime ? [] : ['Review, survey, plat and improvement costs, and the review timeline (no retained source or operator figure).']),
      ],
      complexity: 'medium',
      buyerDemand: band?.available ? `${liquidity} Lot-sized demand is inferred from the band, not from lot sales.` : liquidity,
      risks: gateActions(['minor_subdivision']),
      nextDecisiveAction: path?.decisiveVerification.action ?? 'Obtain the local subdivision regulation.',
    });
    void params;
  }

  // ── Major subdivision / entitlement ──
  {
    const path = pathOf('major_subdivision_entitlement');
    const status: ScenarioStatus = !path ? 'unknown' : path.applicability === 'applies' ? 'viable' : path.applicability === 'may_apply' ? 'conditional' : path.applicability === 'not_applicable' ? 'not_supported' : 'unknown';
    scenarios.push({
      id: 'major_subdivision_entitlement', label: SCENARIO_LABEL.major_subdivision_entitlement, strategyId: 'subdivision_minor_split', pathKind: 'major_subdivision_entitlement',
      subjectScope: `A platted subdivision or an entitlement of the ${acres ?? '?'} ac parcel beyond the local minor threshold.`,
      status, confidence: path?.weight ?? 'unresolved',
      statusWhy: path ? path.applicabilityWhy : 'No Development Path is retained; the local major path cannot be read.',
      grossExit: null,
      purchasePriceCapacity: null,
      directCosts: [missingLine('engineering', 'Civil engineering, roads, stormwater and utilities', path?.requirements.filter((row) => row.kind === 'road' || row.kind === 'environmental' || row.kind === 'utilities').map((row) => row.requirement).join(' ').slice(0, 220) || 'Not stated in the retained regulation.')],
      softCosts: [
        missingLine('entitlement', 'Entitlement, hearing, study and bonding costs', path?.requirements.filter((row) => row.kind === 'bonding_or_dedication' || row.kind === 'fee').map((row) => row.requirement).join(' ').slice(0, 220) || 'Not stated in the retained regulation.'),
        missingLine('carrying', 'Carrying costs across a multi-stage approval', 'Computed once a timeline exists.'),
      ],
      capitalAtRisk: null,
      timeToExit: path?.costAndTime?.estimatedTime ? { statement: path.costAndTime.estimatedTime, basis: path.costAndTime.basis } : null,
      keyApprovals: path?.approvalSteps.length ? path.approvalSteps : path ? [path.decisiveVerification.action] : [],
      returnMetrics: null,
      missingInputs: ['Finished-lot or entitled-land values.', ...(path?.missingInputs ?? []), 'Engineering, infrastructure, study and bonding costs and the approval timeline.'],
      complexity: 'high',
      buyerDemand: liquidity,
      risks: gateActions(['major_subdivision_entitlement']),
      nextDecisiveAction: path?.decisiveVerification.action ?? 'Obtain the local subdivision regulation.',
    });
  }

  // ── Land-home / manufactured-home package ──
  {
    const params = strategyParams('land_home_package');
    // The preliminary screen decides the posture; zoning only blocks on a
    // clear prohibition. Detailed package underwriting stays behind the
    // strategy boundary for a later build.
    const lh = landHomePostureFor(value.package?.landHome ?? null, manufactured?.standing ?? null);
    // A district that permits manufactured housing — by right or by special
    // exception — makes the land-home package a real, conditional path even
    // before the manufactured-home market screen has run. The screen refines
    // the posture (WORTH EXPLORING / MARGINAL / NOT VIABLE); its absence no
    // longer collapses a permitted path to "unknown". Only a clear prohibition,
    // or a completed screen with no qualifying sale, is not_supported.
    const districtPermitsManufactured = manufactured?.standing === 'by_right' || manufactured?.standing === 'conditional';
    const status: ScenarioStatus = lh.posture === 'NOT VIABLE'
      ? 'not_supported'
      : lh.posture === 'WORTH EXPLORING'
        ? 'conditional'
        : districtPermitsManufactured
          ? 'conditional'
          : 'unknown';
    scenarios.push({
      id: 'land_home_manufactured', label: SCENARIO_LABEL.land_home_manufactured, strategyId: 'land_home_package', pathKind: 'as_is',
      subjectScope: 'The parcel with a manufactured or modular home placed and sold as a finished package.',
      status, confidence: status === 'not_supported' ? 'confirmed' : status === 'conditional' ? 'likely' : 'unresolved',
      statusWhy: `${lh.posture ? `Preliminary Land Home Package posture: ${lh.posture}. ` : 'Preliminary Land Home Package posture: not yet screened. '}${lh.why} ${manufactured ? manufactured.statement : 'Whether a manufactured home is permitted is not established.'} Next verification: ${lh.nextVerification}`,
      landHomePosture: lh.posture,
      grossExit: null,
      purchasePriceCapacity: null,
      directCosts: [missingLine('home', 'Home purchase, transport, set-up and skirting', 'Dealer quote.'), missingLine('site', 'Site prep, well/septic or taps, driveway', 'Contractor quote after the septic evaluation.')],
      softCosts: [missingLine('permits', 'Placement permits and impact fees', 'Jurisdiction fee schedule, not retained.'), missingLine('carrying', 'Carrying and financing across set-up and sale', 'Computed once a package value and timeline exist.')],
      capitalAtRisk: null,
      timeToExit: null,
      keyApprovals: [...(manufactured?.standing === 'conditional' ? ['Conditional-use or special-exception approval for the home placement.'] : []), ...(septic ? [] : ['Health-department septic site evaluation.']), 'Placement and building permits.'],
      returnMetrics: null,
      missingInputs: [...(value.package?.landHome?.marketMet ? [] : ['Verified manufactured-home package sales above $200,000 within about five miles.']), 'Home and set-up quotes.', ...(manufactured?.standing === 'not_established' ? ['Whether the district permits manufactured housing.'] : [])],
      complexity: 'medium',
      buyerDemand: value.package?.landHome?.marketNote ?? 'Package demand rests on verified manufactured-home sales, which are not retained.',
      risks: gateActions(['as_is']),
      nextDecisiveAction: manufactured?.standing === 'not_established' || !manufactured ? 'Read the district\'s manufactured-home provision from the adopted code.' : 'Search for closed manufactured-home package sales in the market.',
    });
  }

  // ── Novation / double close ──
  {
    const params = strategyParams('wholesale_assignment');
    const exit = value.status === 'supported' ? { amount: value.fmv!.central, basis: `${value.basis ?? 'Accepted closed sales'}; ${value.acceptedCompCount} accepted sale(s)`, asOf: null } : null;
    const capacity = exit && params.offerPctLowOfEv != null ? { low: Math.round(exit.amount * params.offerPctLowOfEv / 100), high: Math.round(exit.amount * params.offerPctHighOfEv! / 100), lowPct: params.offerPctLowOfEv, highPct: params.offerPctHighOfEv!, basis: `${params.label} band, ${params.offerPctLowOfEv}–${params.offerPctHighOfEv}% of expected value (draft, unconfirmed)`, confirmed: params.confirmed } : null;
    scenarios.push({
      id: 'novation_double_close', label: SCENARIO_LABEL.novation_double_close, strategyId: 'wholesale_assignment', pathKind: 'as_is',
      subjectScope: 'The whole parcel, contracted and resold to an end buyer with little or no capital deployed.',
      status: exit ? 'conditional' : 'unknown', confidence: exit ? 'likely' : 'unresolved',
      statusWhy: exit ? 'A supported value sets the resale target; the end buyer, the contract terms and the assignment band are not confirmed.' : 'No supported value to set a resale target against.',
      grossExit: exit,
      purchasePriceCapacity: capacity,
      directCosts: [missingLine('double_close', 'Double-close or novation transaction costs', 'Title and attorney fees for the second closing; operator figure.')],
      softCosts: [missingLine('marketing', 'Buyer-finding and marketing', 'Operator figure.')],
      capitalAtRisk: purchase ? { amount: 0, basis: 'Earnest money only when the end buyer closes concurrently; the full price if the double close funds first.' } : null,
      timeToExit: timeFromMarket,
      keyApprovals: ['Assignability or novation language in the purchase contract.'],
      returnMetrics: null,
      missingInputs: ['A committed end buyer and their price.', 'Transaction costs for the second closing.', ...(exit ? [] : ['A supported fair market value.'])],
      complexity: 'low',
      buyerDemand: liquidity,
      risks: gateActions(['as_is']),
      nextDecisiveAction: exit ? 'Confirm the assignment band with the operator and identify an end buyer.' : 'Admit qualified closed sales through Comps & Valuation.',
    });
  }

  // ── Owner-finance exit ──
  {
    const exit = value.status === 'supported' ? { amount: value.fmv!.central, basis: `${value.basis ?? 'Accepted closed sales'}; ${value.acceptedCompCount} accepted sale(s)`, asOf: null } : null;
    scenarios.push({
      id: 'owner_finance', label: SCENARIO_LABEL.owner_finance, strategyId: 'owner_finance_exit', pathKind: 'as_is',
      subjectScope: 'The whole parcel, sold on terms with a note retained or sold.',
      status: exit && accessEstablished ? 'conditional' : 'unknown', confidence: exit ? 'likely' : 'unresolved',
      statusWhy: exit ? (accessEstablished ? 'Terms-based; a supported value prices the note, and a hold or note-sale plan is still needed.' : 'A note cannot be written on a parcel without recorded legal access.') : 'No supported value to price a note against.',
      grossExit: exit,
      purchasePriceCapacity: null,
      directCosts: [missingLine('closing', 'Closing and note-servicing set-up', 'Operator figure.')],
      softCosts: [missingLine('hold', 'Capital held in the note', 'Depends on down payment and term; operator plan.')],
      capitalAtRisk: purchase ? { amount: purchase.price, basis: 'The full purchase price stays deployed until the note pays or sells.' } : null,
      timeToExit: null,
      keyApprovals: ['Clear title and recorded access before any note is written.'],
      returnMetrics: null,
      missingInputs: ['Down payment, rate and term the market bears.', 'A note-buyer price or a hold plan.', ...(exit ? [] : ['A supported fair market value.'])],
      complexity: 'medium',
      buyerDemand: liquidity,
      risks: gateActions(['as_is']),
      nextDecisiveAction: accessEstablished ? 'Set terms with the operator and price the note against the supported value.' : 'Record legal access first.',
    });
  }

  // ── Price sensitivity ──
  const live = scenarios.filter((scenario) => scenario.status !== 'not_supported');
  const pointFor = (label: PriceSensitivityPoint['label'], price: number): PriceSensitivityPoint => {
    const plausible = live.filter((scenario) => scenario.purchasePriceCapacity && scenario.purchasePriceCapacity.high >= price).map((scenario) => scenario.id);
    const exceeded = live.filter((scenario) => scenario.purchasePriceCapacity && scenario.purchasePriceCapacity.high < price).map((scenario) => scenario.id);
    const undetermined = live.filter((scenario) => !scenario.purchasePriceCapacity).map((scenario) => scenario.id);
    return {
      label, price, plausible, undetermined, exceeded,
      statement: `At ${usd(price)}: ${plausible.length ? `${plausible.map((id) => SCENARIO_LABEL[id]).join(', ')} remain inside their purchase-price capacity` : 'no scenario with a computed capacity covers the price'}${exceeded.length ? `; ${exceeded.map((id) => SCENARIO_LABEL[id]).join(', ')} exceeded` : ''}${undetermined.length ? `; ${undetermined.length} scenario(s) have no capacity yet` : ''}.`,
    };
  };
  let priceSensitivity: PriceSensitivity;
  if (askingPrice == null && claimNumbers.length === 0) {
    priceSensitivity = {
      mode: 'no_price', source: null, points: [],
      statement: `No seller price is retained. Feasible paths: ${live.filter((scenario) => scenario.status !== 'unknown').map((scenario) => scenario.label).join(', ') || 'none yet established'}. ${live.filter((scenario) => scenario.status === 'unknown').length ? `${live.filter((scenario) => scenario.status === 'unknown').length} scenario(s) cannot be read until their inputs arrive.` : ''}`.trim(),
      missingInputs: [...new Set(live.flatMap((scenario) => scenario.missingInputs))].slice(0, 8),
    };
  } else if (claimNumbers.length > 1 && askingPrice == null) {
    const low = claimNumbers[0];
    const high = claimNumbers[claimNumbers.length - 1];
    priceSensitivity = {
      mode: 'seller_range', source: `Seller communication: ${priceClaim!.statement} (${priceClaim!.source})`,
      points: [pointFor('low', low), pointFor('base', Math.round((low + high) / 2)), pointFor('high', high)],
      statement: `The seller stated a range of ${usd(low)}–${usd(high)}; each point is tested against every scenario's purchase-price capacity.`,
      missingInputs: [...new Set(live.flatMap((scenario) => scenario.missingInputs))].slice(0, 8),
    };
  } else {
    const base = purchase!.price;
    priceSensitivity = {
      mode: 'asking_price', source: purchase!.basis,
      points: [pointFor('low', Math.round(base * 0.85)), pointFor('base', base), pointFor('high', Math.round(base * 1.15))],
      statement: `Base is the stated ${usd(base)}; low and high are a ±15% LandOS sensitivity band around it, not seller statements.`,
      missingInputs: [...new Set(live.flatMap((scenario) => scenario.missingInputs))].slice(0, 8),
    };
  }

  // ── The comparison: transparent, multi-criteria, never auto-selecting ──
  const ranked = [...scenarios].sort((a, b) =>
    SCENARIO_STATUS_RANK[a.status] - SCENARIO_STATUS_RANK[b.status]
    || COMPLEXITY_RANK[a.complexity] - COMPLEXITY_RANK[b.complexity]
    || a.keyApprovals.length - b.keyApprovals.length
    || Number(!a.timeToExit) - Number(!b.timeToExit)
    || a.missingInputs.length - b.missingInputs.length);
  const ranking = ranked.map((scenario, index) => ({
    id: scenario.id,
    rank: index + 1,
    why: `${scenario.status.replace(/_/g, ' ')}; ${scenario.complexity} complexity; ${scenario.keyApprovals.length} approval step(s); ${scenario.timeToExit ? 'time to exit sourced' : 'time to exit not sourced'}; ${scenario.returnMetrics ? `net ${usd(scenario.returnMetrics.netProfit)} on ${usd(scenario.returnMetrics.purchasePrice)}` : `return not computable (${scenario.missingInputs.length} missing input(s))`}; ${scenario.capitalAtRisk ? `capital at risk ${usd(scenario.capitalAtRisk.amount)}` : 'capital at risk not computable'}.`,
  }));

  return {
    developmentPathStatus: developmentPath ? 'current' : 'pending',
    scenarios,
    priceSensitivity,
    ranking,
    criteria: ['Expected return, only when every input is visible', 'Time to exit', 'Capital at risk', 'Approval risk', 'Execution complexity', 'Buyer demand and liquidity'],
    statement: `Ordered by evidence status, then execution complexity, approval exposure, sourced time and open inputs. ${developmentPath ? `Local rules applied from ${developmentPath.authority.zoning.name ?? 'the controlling authority (unresolved)'}.` : 'No local subdivision rule is applied yet: the Development Path is pending.'} LandOS does not pick the highest gross profit; the operator chooses with return, time, capital, approval risk and complexity side by side.`,
    notAutoSelected: true,
  };
}

// ── Next actions and recommendation ────────────────────────────────────────

function nextActionsFor(
  evidence: EvidenceRequirement[],
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  subject: DecisionSubject,
  value: ValueGuidance,
  mode: DecisionMode,
  developmentPath: ZoningDevelopmentIntelligence | null = null,
): { landos: NextAction; operator: NextAction } {
  const row = (key: EvidenceKey) => evidence.find((entry) => entry.key === key)!;

  // LandOS acts on the highest-ranked gap it can move itself.
  let landos: NextAction;
  if (row('value').status !== 'sufficient') {
    landos = {
      action: `Search for qualified closed vacant-land sales near ${subject.acres ?? 'the subject'} acres in ${subject.county ?? 'the subject county'}, ${subject.state ?? ''} and admit them through Comps & Valuation.`.replace(/, \./, '.'),
      why: value.noPriceRationale ?? 'No supported value exists.',
      capabilityId: 'comps-valuation',
      unlocks: 'A supported fair market value and the 40–60% flip band.',
    };
  } else if (row('zoning').status !== 'sufficient') {
    // The Development Path names the smallest decisive step, and when the
    // governing authority itself is in conflict, that conflict comes first.
    const asIs = developmentPath?.paths.find((path) => path.kind === 'as_is') ?? null;
    landos = {
      action: developmentPath?.authority.conflict?.decisiveVerification
        ?? asIs?.decisiveVerification.action
        ?? `Establish the parcel's zoning district from ${subject.county ?? 'the county'} County's adopted zoning map or a written determination.`,
      why: developmentPath?.authority.conflict ? developmentPath.authority.conflict.statement : row('zoning').statement,
      capabilityId: 'zoning-subdivision',
      unlocks: 'The exit product, the comparable set and every subdivision question.',
    };
  } else if (row('access').status !== 'sufficient') {
    landos = {
      action: 'Search the county recorder for a recorded easement, plat dedication or deeded access instrument for the subject.',
      why: row('access').statement,
      capabilityId: 'property-development-history',
      unlocks: 'Legal access, which every exit strategy gates on.',
    };
  } else if (market && market.pulsePlan.some((question) => question.status === 'planned')) {
    landos = {
      action: `Run the ${market.pulsePlan.filter((question) => question.status === 'planned').length} planned Market Pulse question(s) for ${subject.county ?? 'the subject county'}.`,
      why: 'Current local conditions are still a planned research question.',
      capabilityId: 'market-pulse',
      unlocks: 'Demand direction and active competition for the subject band.',
    };
  } else {
    landos = {
      action: 'Hold the current read; refresh when new seller, value, zoning, access, title or strategy evidence arrives.',
      why: 'Every LandOS-movable gap is closed.',
      capabilityId: null,
      unlocks: 'Nothing further without operator or seller input.',
    };
  }

  // The operator acts on what only a person can move.
  let operator: NextAction;
  const survey = subject.caveats.find((caveat) => /survey/i.test(caveat));
  if (mode === 'offer_strategy_posture' && value.offerGuidance) {
    operator = {
      action: value.askingVsGuidance && /above/.test(value.askingVsGuidance)
        ? `Open a renegotiation at or below ${usd(value.offerGuidance.high)} and hold the ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} band.`
        : `Present an offer inside ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} (${value.offerGuidance.lowPct}–${value.offerGuidance.highPct}% of ${usd(value.fmv!.central)}).`,
      why: 'Value, zoning, access and the seller position are all source-backed.',
      capabilityId: null,
      unlocks: 'A contract, or a clear no.',
    };
  } else if (seller.status === 'no_communications') {
    operator = {
      action: 'Make first contact with the seller using the discovery brief: learn why they would sell, what they want for it, when, and who decides.',
      why: seller.statement,
      capabilityId: null,
      unlocks: 'The seller dimensions no research can supply, and the seller\'s answers to the open property questions.',
    };
  } else if (seller.unanswered.includes('price') || seller.unanswered.includes('motivation')) {
    operator = {
      action: `Ask the seller directly about ${seller.unanswered.filter((dimension) => dimension === 'price' || dimension === 'motivation').map((dimension) => SELLER_CLAIM_DIMENSION_LABEL[dimension].toLowerCase()).join(' and ')}, and record the reply.`,
      why: seller.statement,
      capabilityId: null,
      unlocks: 'The seller-side evidence the offer posture requires.',
    };
  } else if (survey) {
    operator = {
      action: 'Supply the signed boundary survey to LandOS so the governing acreage rests on the document rather than on its description.',
      why: survey,
      capabilityId: null,
      unlocks: 'A settled acreage basis for every price-per-acre figure.',
    };
  } else if (row('title').status !== 'sufficient') {
    operator = {
      action: 'Order a title commitment or attorney examination for the subject parcel.',
      why: row('title').statement,
      capabilityId: null,
      unlocks: 'Who can convey, and what clears before closing.',
    };
  } else {
    operator = {
      action: 'Review the current posture and decide whether to proceed to terms.',
      why: 'Every operator-movable gap is closed.',
      capabilityId: null,
      unlocks: 'The next decision.',
    };
  }
  void property;
  return { landos, operator };
}

function recommendationFor(
  mode: DecisionMode,
  evidence: EvidenceRequirement[],
  value: ValueGuidance,
  seller: DecisionSellerStatus,
  nextActions: { landos: NextAction; operator: NextAction },
): DealDecisionSynthesis['recommendation'] {
  const declined = seller.claims.find((claim) => claim.dimension === 'constraint' && (claim.value === 'not selling' || /not (interested|selling)|no longer (want|interested)|won'?t sell/i.test(claim.statement)));
  if (declined) {
    return {
      kind: 'pass', label: RECOMMENDATION_LABEL.pass,
      statement: 'Pass for now: the seller has said they are not selling.',
      rationale: [`Seller statement: "${declined.statement}" (${declined.source}).`, 'Nothing in the property or market evidence overrides a stated refusal; revisit only on a new seller communication.'],
    };
  }
  if (mode === 'offer_strategy_posture' && value.offerGuidance) {
    const above = !!value.askingVsGuidance && /above/.test(value.askingVsGuidance);
    return above
      ? {
        kind: 'renegotiate', label: RECOMMENDATION_LABEL.renegotiate,
        statement: `Renegotiate: the seller's number sits above the ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} (40–60%) benchmark of Combined LandOS FMV ${usd(value.fmv!.central)}.`,
        rationale: [value.askingVsGuidance!, `Combined LandOS FMV ${usd(value.fmv!.central)}${value.basis ? ` (${value.basis})` : ''}.`, ...packageRationale(value)],
      }
      : {
        kind: 'make_offer', label: RECOMMENDATION_LABEL.make_offer,
        statement: `Make an offer inside ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} (40–60% of Combined LandOS FMV ${usd(value.fmv!.central)}).`,
        rationale: [
          `Combined LandOS FMV ${usd(value.fmv!.central)}${value.basis ? ` (${value.basis})` : ''}.`,
          `${value.offerGuidance.strategyLabel}: ${value.offerGuidance.lowPct}–${value.offerGuidance.highPct}% of Combined LandOS FMV.`,
          ...(value.askingVsGuidance ? [value.askingVsGuidance] : []),
          ...packageRationale(value),
        ],
      };
  }

  const missing = evidence.filter((row) => row.requiredForOffer && row.status !== 'sufficient');
  const landosMovable = missing.filter((row) => row.key === 'value' || row.key === 'zoning' || row.key === 'access');
  const personOnly = missing.filter((row) => row.key === 'seller' || row.key === 'subject');
  const rationale = [
    ...missing.map((row) => `${row.label}: ${row.statement} Unlock: ${row.unlock}`),
    // The current valuation package always informs the posture, even while
    // other evidence keeps the decision preliminary.
    ...(value.status === 'supported' && value.offerGuidance
      ? [`Current value guidance: Combined LandOS FMV ${usd(value.fmv!.central)}; standard benchmark ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} (40–60%).${value.askingVsGuidance ? ` ${value.askingVsGuidance}` : ''}`]
      : []),
    ...packageRationale(value),
  ];

  if (!landosMovable.length && personOnly.length) {
    return {
      kind: 'request_information', label: RECOMMENDATION_LABEL.request_information,
      statement: `Request specific information; do not establish an offer range yet. ${nextActions.operator.action}`,
      rationale,
    };
  }
  return {
    kind: 'continue_diligence', label: RECOMMENDATION_LABEL.continue_diligence,
    statement: 'Continue targeted diligence; do not establish an offer range yet.',
    rationale,
  };
}

/** The comp-evidence lines every recommendation carries once a package exists. */
function packageRationale(value: ValueGuidance): string[] {
  const pkg = value.package;
  if (!pkg || pkg.combinedFmv == null) return [];
  return [
    `Components: LandPortal FMV ${pkg.landPortalFmv != null ? usd(pkg.landPortalFmv) : 'unavailable'} (${pkg.landPortalCompCount ?? 0} LandPortal sale(s)); Non-LandPortal FMV ${pkg.nonLandPortalFmv != null ? usd(pkg.nonLandPortalFmv) : 'unavailable'} (${pkg.nonLandPortalCompCount ?? 0} sale(s)${pkg.nonLandPortalSources.length ? ` via ${pkg.nonLandPortalSources.join(', ')}` : ''}); confidence ${pkg.confidence ?? 'unstated'}.`,
    ...(pkg.collectiveComparison ? [`Subject versus comps: ${pkg.collectiveComparison}`] : []),
    ...(pkg.activeCompetitionSummary ? [`Resale competition: ${pkg.activeCompetitionSummary}`] : []),
  ];
}

// ── Material fingerprint ────────────────────────────────────────────────────

function materialDimensionsFor(
  subject: DecisionSubject,
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  value: ValueGuidance,
  strategies: ExitStrategyRead[],
  developmentPath: ZoningDevelopmentIntelligence | null,
  comparison: StrategyComparison,
): Record<string, string> {
  const dims: Record<string, string> = {};
  dims.subject = `${subject.subjectVersion ?? 'none'} · ${subject.acres ?? '?'} ac · ${subject.confidence}`;
  dims.value = value.status === 'supported'
    ? `supported ${usd(value.fmv!.central)} from ${value.acceptedCompCount} sale(s)`
    : `withheld (${value.acceptedCompCount} accepted sale(s))`;
  // The whole valuation package is material: a changed lane FMV, comp set,
  // confidence, comparison or competition set refreshes the decision.
  const pkg = value.package;
  dims.valuationPackage = pkg
    ? `lp=${pkg.landPortalFmv ?? 'n/a'}/${pkg.landPortalCompCount ?? 0} · nonlp=${pkg.nonLandPortalFmv ?? 'n/a'}/${pkg.nonLandPortalCompCount ?? 0} · combined=${pkg.combinedFmv ?? 'n/a'} (${pkg.combinedMethod ?? 'n/a'}, ${pkg.confidence ?? 'n/a'}) · 40=${pkg.offer40 ?? 'n/a'} · 60=${pkg.offer60 ?? 'n/a'}`
    : 'none';
  dims.collectiveComparison = pkg?.collectivePosture ?? 'none';
  dims.activeCompetition = pkg ? `${pkg.activeCompetitionCount ?? 0} active` : 'none';
  dims.landHome = pkg?.landHome ? `physical=${pkg.landHome.physicalMet ?? 'n/a'} · market=${pkg.landHome.marketMet} (${pkg.landHome.qualifyingSaleCount ?? 0}/${pkg.landHome.soldCompCount ?? 0}) · triggered=${pkg.landHome.triggered}` : 'none';
  // The posture's stated reason is operator-facing: a different qualifying
  // sale set reads differently, so the reason is material in its own right.
  dims.landHomeReason = pkg?.landHome?.marketBrief ?? 'none';
  dims.askingPrice = value.askingPrice != null ? usd(value.askingPrice) : 'none';
  for (const key of ['zoning', 'access', 'utilities', 'well_septic', 'taxes', 'flood', 'wetlands', 'soils', 'development_status'] as const) {
    const topic = topicOf(property, key);
    dims[key] = topic ? `${topic.status}${key === 'zoning' && topic.claims[0]?.value ? ` · ${topic.claims[0].value}` : ''}` : 'not read';
  }
  dims.title = guardOf(property, 'Title') ? 'not established' : 'established';
  dims.legalAccess = guardOf(property, 'Legal access') ? 'not established' : 'established';
  // Recorded easements and restrictions read from the instrument bind the
  // resale and any division, so a newly read (or changed) finding is material.
  dims.encumbrances = (property?.recordFacts ?? [])
    .filter((entry) => entry.topic === 'record.encumbrances')
    .map((entry) => entry.statement.slice(0, 160))
    .join(' | ') || 'none';
  dims.conflicts = String(property?.conflicts.filter((conflict) => conflict.resolution === 'unresolved' && conflict.material).length ?? 0);
  dims.market = market?.subjectBand.available
    ? `${market.subjectBand.bandUsedLabel ?? '?'} · ${market.subjectBand.medianPricePerAcre != null ? `${usd(market.subjectBand.medianPricePerAcre)}/ac` : 'no median'} · ${market.subjectBand.sampleCount ?? '?'} sales`
    : 'subject band unavailable';
  dims.seller = seller.status === 'no_communications'
    ? 'no communications'
    : `${seller.communications + seller.discoveryExtractions} record(s); ${seller.claims.length} claim(s)`;
  for (const dimension of ['motivation', 'price', 'timeline', 'decision_maker', 'constraint', 'commitment'] as SellerClaimDimension[]) {
    const latest = seller.claims.find((claim) => claim.dimension === dimension);
    dims[`seller.${dimension}`] = latest ? latest.statement : 'unknown';
  }
  dims.strategy = strategies.map((strategy) => `${strategy.id}=${strategy.status}`).join(' ');
  dims.developmentPath = developmentPath
    ? `${developmentPath.authority.zoning.name ?? 'authority unresolved'}${developmentPath.authority.conflict ? ' (conflict)' : ''} · ${developmentPath.zoning.established ? developmentPath.zoning.districtCode : 'district not established'} · ${developmentPath.paths.map((path) => `${path.kind}=${path.applicability}`).join(' ')}`
    : 'pending';
  dims.scenarios = comparison.scenarios.map((scenario) => `${scenario.id}=${scenario.status}`).join(' ');
  dims.priceSensitivity = comparison.priceSensitivity.mode;
  return dims;
}

// ── The synthesis ───────────────────────────────────────────────────────────

export interface DealDecisionSynthesisInput {
  dealCardId: number;
  dossier: AcquisitionDossier;
  subject: CanonicalSubjectState | null;
  property: PropertyEvidenceSynthesis | null;
  market: MarketResearchAndPulse | null;
  sellerDiscovery: SellerDiscoverySynthesis | null;
  /** The retained record behind the subject's identity, read by the
   *  lifecycle; null when the reader cannot reach one. */
  identityEvidence?: IdentityEvidenceInput | null;
  /** The current subject-equivalent Development Path (Stage 5); null when
   *  none is retained, in which case the comparison says so. */
  developmentPath?: ZoningDevelopmentIntelligence | null;
}

export function buildDealDecisionSynthesis(input: DealDecisionSynthesisInput): DealDecisionSynthesis {
  const { dossier, property, market } = input;
  const subject = subjectFor(input.subject, property, dossier, input.identityEvidence ?? null);
  const seller = sellerStatusFor(input.sellerDiscovery);
  const value = valueFor(property, dossier, seller);
  const evidence = evidenceFor(subject, property, market, dossier, seller, value);
  const required = evidence.filter((row) => row.requiredForOffer);
  const insufficient = required.filter((row) => row.status !== 'sufficient');
  const mode: DecisionMode = insufficient.length ? 'preliminary_acquisition_posture' : 'offer_strategy_posture';
  const modeWhy = mode === 'offer_strategy_posture'
    ? 'Subject, value, zoning, access and the seller position are each source-backed and sufficient.'
    : `Research is usable, but ${insufficient.map((row) => row.label.toLowerCase()).join(', ')} ${insufficient.length === 1 ? 'is' : 'are'} not yet sufficient for an offer posture.`;

  const risks = rankedRisks(property, market, seller, value, subject);
  const opportunities = rankedOpportunities(property, market, seller, dossier);
  const exitStrategies = exitStrategiesFor(property, market, dossier, value, seller);
  const developmentPath = input.developmentPath ?? null;
  const strategyComparison = strategyComparisonFor(developmentPath, property, market, dossier, value, seller, subject);
  const nextActions = nextActionsFor(evidence, property, market, seller, subject, value, mode, developmentPath);
  const recommendation = recommendationFor(mode, evidence, value, seller, nextActions);

  const limitations: string[] = [];
  if (!property) limitations.push('No Property Story is retained; the posture rests on the dossier alone.');
  if (!market) limitations.push('No Market Story is retained; no band reference informs the posture.');
  if (market?.pulsePlan.some((question) => question.status === 'planned')) {
    limitations.push(`${market.pulsePlan.filter((question) => question.status === 'planned').length} Market Pulse question(s) remain planned, so current local conditions are not reflected.`);
  }
  if (!exitStrategies.some((strategy) => strategy.economicBasisConfirmed && strategy.status !== 'unknown')) {
    limitations.push('No exit strategy with confirmed economic parameters is yet supported; every band shown is a basis, not an underwriting number.');
  }
  limitations.push('Seller claims come only from retained communications; nothing about the seller is inferred from the property.');
  if (!developmentPath) limitations.push('The Development Path is pending: no current subject-equivalent Stage 5 read is retained, so the strategy comparison rests on the Property Story alone and no local subdivision rule is applied.');
  limitations.push('The strategy comparison never auto-selects the highest gross profit; return metrics appear only when every input is visible, and cost or time figures come only from a retained source or the operator.');
  if (!market) limitations.push('The full current Market Story is pending: no current subject-equivalent Market Story is retained, so market liquidity, demand and the subject band are not decision inputs yet.');

  const materialDimensions = materialDimensionsFor(subject, property, market, seller, value, exitStrategies, developmentPath, strategyComparison);
  const materialFingerprint = sha256(JSON.stringify(materialDimensions));
  const inputFingerprint = sha256(JSON.stringify({
    property: property?.inputFingerprint ?? null,
    market: market?.inputFingerprint ?? null,
    seller: input.sellerDiscovery?.inputFingerprint ?? null,
    developmentPath: developmentPath?.inputFingerprint ?? null,
    subject: subject.subjectVersion,
    materialFingerprint,
  }));

  return {
    contractVersion: DEAL_DECISION_SYNTHESIS_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: null,
    inputFingerprint,
    materialFingerprint,
    materialDimensions,
    mode,
    modeWhy,
    subject,
    propertyStory: property
      ? {
        headline: property.story.headline,
        strengths: property.story.strengths,
        risks: property.story.risks,
        opportunities: property.story.opportunities,
        establishedTopics: property.diligence.filter((topic) => topic.status === 'established').length,
        totalTopics: property.diligence.length,
      }
      : null,
    marketStory: market
      ? {
        headline: market.story.headline,
        liquidityRead: market.story.liquidityRead,
        demandRead: market.story.demandRead,
        competitionRead: market.story.competitionRead,
        subjectBand: {
          label: market.subjectBand.bandUsedLabel,
          available: market.subjectBand.available,
          medianPricePerAcre: market.subjectBand.medianPricePerAcre,
          sampleCount: market.subjectBand.sampleCount,
          period: market.subjectBand.period,
        },
        mostLiquidBand: market.mostLiquidBand
          ? { label: market.mostLiquidBand.bandUsedLabel, medianPricePerAcre: market.mostLiquidBand.medianPricePerAcre }
          : null,
      }
      : null,
    seller,
    evidence,
    risks,
    opportunities,
    exitStrategies,
    strategyComparison,
    value,
    nextActions,
    recommendation,
    limitations: limitations.map(sentence),
  };
}
