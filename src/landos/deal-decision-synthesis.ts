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

export const DEAL_DECISION_SYNTHESIS_VERSION = '1.4.1';
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
    status: value.status === 'supported' ? 'sufficient' : value.acceptedCompCount > 0 ? 'partial' : 'missing',
    statement: value.status === 'supported'
      ? `${value.acceptedCompCount} accepted closed sale(s) support ${usd(value.fmv!.central)}${value.basis ? ` (${value.basis})` : ''}.`
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
  const central = dossier.valuation.fairMarketValue;
  const askingFromSeller = seller.claims.find((claim) => claim.dimension === 'price');
  const askingPrice = dossier.seller.askingPrice ?? null;
  const askingPriceSource = askingPrice != null
    ? (askingFromSeller ? `Deal Card asking price; the seller also spoke to price (${askingFromSeller.source})` : 'Deal Card asking price on file; no retained communication confirms it')
    : askingFromSeller ? `Seller communication only: ${askingFromSeller.statement}` : null;

  if (fmvGuard || central == null || accepted < 1) {
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
    };
  }

  const flip = strategyParams('quick_flip');
  const low = Math.round(central * (flip.offerPctLowOfEv! / 100));
  const high = Math.round(central * (flip.offerPctHighOfEv! / 100));
  const askingVsGuidance = askingPrice == null
    ? null
    : askingPrice > high
      ? `The asking price ${usd(askingPrice)} is above the ${usd(high)} ceiling of the flip band: a renegotiation, not an acceptance.`
      : askingPrice < low
        ? `The asking price ${usd(askingPrice)} is below the ${usd(low)} floor of the flip band: confirm the seller's number before offering less.`
        : `The asking price ${usd(askingPrice)} sits inside the ${usd(low)}–${usd(high)} flip band.`;
  return {
    status: 'supported',
    fmv: { low: null, central, high: null },
    basis: dossier.valuation.basis,
    acceptedCompCount: accepted,
    offerGuidance: {
      strategy: 'quick_flip',
      strategyLabel: flip.label,
      lowPct: flip.offerPctLowOfEv!,
      highPct: flip.offerPctHighOfEv!,
      low,
      high,
      confirmed: flip.confirmed,
    },
    askingPrice,
    askingPriceSource,
    askingVsGuidance,
    noPriceRationale: null,
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

// ── Next actions and recommendation ────────────────────────────────────────

function nextActionsFor(
  evidence: EvidenceRequirement[],
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  subject: DecisionSubject,
  value: ValueGuidance,
  mode: DecisionMode,
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
    landos = {
      action: `Establish the parcel's zoning district from ${subject.county ?? 'the county'} County's adopted zoning map or a written determination.`,
      why: row('zoning').statement,
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
        statement: `Renegotiate: the seller's number sits above the ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)} band that ${value.acceptedCompCount} accepted sale(s) support.`,
        rationale: [value.askingVsGuidance!, `Expected value ${usd(value.fmv!.central)}${value.basis ? ` (${value.basis})` : ''}.`],
      }
      : {
        kind: 'make_offer', label: RECOMMENDATION_LABEL.make_offer,
        statement: `Make an offer inside ${usd(value.offerGuidance.low)}–${usd(value.offerGuidance.high)}.`,
        rationale: [
          `Expected value ${usd(value.fmv!.central)} from ${value.acceptedCompCount} accepted closed sale(s).`,
          `${value.offerGuidance.strategyLabel} band ${value.offerGuidance.lowPct}–${value.offerGuidance.highPct}% of expected value${value.offerGuidance.confirmed ? ' (confirmed parameters)' : ' (draft parameters)'}.`,
          ...(value.askingVsGuidance ? [value.askingVsGuidance] : []),
        ],
      };
  }

  const missing = evidence.filter((row) => row.requiredForOffer && row.status !== 'sufficient');
  const landosMovable = missing.filter((row) => row.key === 'value' || row.key === 'zoning' || row.key === 'access');
  const personOnly = missing.filter((row) => row.key === 'seller' || row.key === 'subject');
  const rationale = missing.map((row) => `${row.label}: ${row.statement} Unlock: ${row.unlock}`);

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

// ── Material fingerprint ────────────────────────────────────────────────────

function materialDimensionsFor(
  subject: DecisionSubject,
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  seller: DecisionSellerStatus,
  value: ValueGuidance,
  strategies: ExitStrategyRead[],
): Record<string, string> {
  const dims: Record<string, string> = {};
  dims.subject = `${subject.subjectVersion ?? 'none'} · ${subject.acres ?? '?'} ac · ${subject.confidence}`;
  dims.value = value.status === 'supported'
    ? `supported ${usd(value.fmv!.central)} from ${value.acceptedCompCount} sale(s)`
    : `withheld (${value.acceptedCompCount} accepted sale(s))`;
  dims.askingPrice = value.askingPrice != null ? usd(value.askingPrice) : 'none';
  for (const key of ['zoning', 'access', 'utilities', 'well_septic', 'taxes', 'flood', 'wetlands', 'soils', 'development_status'] as const) {
    const topic = topicOf(property, key);
    dims[key] = topic ? `${topic.status}${key === 'zoning' && topic.claims[0]?.value ? ` · ${topic.claims[0].value}` : ''}` : 'not read';
  }
  dims.title = guardOf(property, 'Title') ? 'not established' : 'established';
  dims.legalAccess = guardOf(property, 'Legal access') ? 'not established' : 'established';
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
  const nextActions = nextActionsFor(evidence, property, market, seller, subject, value, mode);
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
  if (!market) limitations.push('The full current Market Story is pending: no current subject-equivalent Market Story is retained, so market liquidity, demand and the subject band are not decision inputs yet.');

  const materialDimensions = materialDimensionsFor(subject, property, market, seller, value, exitStrategies);
  const materialFingerprint = sha256(JSON.stringify(materialDimensions));
  const inputFingerprint = sha256(JSON.stringify({
    property: property?.inputFingerprint ?? null,
    market: market?.inputFingerprint ?? null,
    seller: input.sellerDiscovery?.inputFingerprint ?? null,
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
    value,
    nextActions,
    recommendation,
    limitations: limitations.map(sentence),
  };
}
