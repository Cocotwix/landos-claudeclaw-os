// LandOS — SUBJECT UNDERSTANDING: what acquisition interest is this lead about?
//
// The front door used to be a parser. It read an address or an APN out of the
// operator's text and, when the text did not contain one in the shape it
// expected, it failed generically — the same answer for "I have a survey, three
// contiguous lots and I'm selling the middle one" as for an empty box.
//
// This module is the layer above that parser. Deterministic extraction still
// runs first and still owns normalization, identifier equivalence, provenance
// and arithmetic; what changes is that its output is now CANDIDATE EVIDENCE
// rather than a verdict, and a bounded reasoning turn decides what the mixed
// evidence actually establishes.
//
// THE AUTHORITY BOUNDARY, ENFORCED BY CONSTRUCTION.
//
//   • The model never creates a fact. `SubjectUnderstandingPlanner` returns
//     text; the only thing this file does with it is parse a plan naming ONE
//     next evidence check from a fixed allowlist. Facts enter only through
//     `SubjectEvidenceExecutor`, which runs existing LandOS capabilities.
//   • The model never decides identity. `deriveSubjectCandidates` and
//     `decideSubjectOutcome` are pure functions over evidence, and they hold
//     PERMANENT_MEMORY invariants 2-4: a parcel is established by an APN plus
//     jurisdiction, a provider id plus FIPS, or an official record; a geocode
//     never establishes one; and a fact about another parcel is never evidence
//     about the subject.
//   • The loop is finite. `SUBJECT_UNDERSTANDING_ACTION_LIMIT` bounds it, every
//     turn is recorded in the audit trail, malformed output stops it, and a
//     subject that moved underneath the run refuses the write.
//
// The output is always one of three useful answers — a supported subject, a
// ranked candidate set, or exactly one precise question. There is no fourth
// answer meaning "the parser did not recognize this".
//
// RESEARCH-GRADE IS NOT LEGAL VERIFICATION. `verification.researchGrade` says
// research may proceed. `verification.officiallyVerified` says an official
// assessor/county record confirms it. The second is strictly stronger and is
// never implied by the first; `outstanding` names what still needs official,
// title or legal verification.

import { apnIdentifiersCorroborate } from './apn-identity.js';
import type { ClaimParcelRelationship } from './deal-evidence-claims.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type SubjectUnderstandingOutcome = 'research_ready' | 'candidate_set' | 'needs_targeted_input';

/** Where a statement came from. Kept to the sources a land lead actually has. */
export type SubjectEvidenceKind =
  | 'seller_text'
  | 'form_field'
  | 'operator_narrative'
  | 'document'
  | 'landportal_link'
  | 'official_record'
  | 'provider_record'
  | 'geometry'
  | 'owner_clue';

export type SubjectEvidenceField =
  | 'apn'
  | 'address'
  | 'city'
  | 'county'
  | 'state'
  | 'zip'
  | 'fips'
  | 'acreage'
  | 'owner'
  | 'legal_description'
  | 'lp_property_id'
  | 'lp_url'
  | 'geometry'
  | 'lot'
  | 'improvement'
  | 'other';

/** Contract section 9 weights. Nothing below `confirmed` establishes identity
 *  officially; `confirmed` here means an official record said it. */
export type SubjectEvidenceWeight = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';

const WEIGHT_RANK: Record<SubjectEvidenceWeight, number> = {
  confirmed: 3,
  well_supported: 2,
  likely: 1,
  unresolved: 0,
};

export interface SubjectEvidenceSource {
  kind: SubjectEvidenceKind;
  label: string;
  url: string | null;
  /** Where inside the source, precisely enough to reopen it: a page label, an
   *  intake line, a panel name. */
  locator: string | null;
  retrievedAt: string | null;
  /** How strongly this source speaks about parcel identity. */
  officiality: 'official' | 'officially_linked' | 'unverified';
}

export interface SubjectEvidenceFact {
  factId: string;
  field: SubjectEvidenceField;
  label: string;
  /** LandOS's normalized reading of the statement. */
  value: string;
  /** Exactly what the source says, when the source states it in words.
   *  `null` means LandOS produced this value rather than reading it. */
  quoted: string | null;
  /** True when `value` is LandOS's inference rather than the source's words. */
  inferred: boolean;
  source: SubjectEvidenceSource;
  weight: SubjectEvidenceWeight;
  /** Which parcel this fact concerns. Only `subject` builds the subject. */
  parcelRelationship: ClaimParcelRelationship;
}

/** What is actually being offered, which is not always "a parcel". */
export type AcquisitionInterestForm =
  | 'whole_parcel'
  | 'recorded_lot'
  | 'assemblage'
  | 'proposed_split'
  | 'survey_defined_area'
  | 'undetermined';

export interface AcquisitionInterest {
  form: AcquisitionInterestForm;
  /** One operator-readable sentence naming the interest. */
  statement: string;
  /** Parcels and improvements deliberately outside the transaction. */
  excluded: Array<{ identifier: string; reason: string }>;
}

export interface SubjectFieldProvenance {
  factId: string;
  source: string;
  weight: SubjectEvidenceWeight;
  inferred: boolean;
  locator: string | null;
}

export interface WorkingAcquisitionSubject {
  apn: string | null;
  /** Formatting-insensitive identity key. A punctuation variant is never a
   *  different parcel. */
  apnNormalized: string | null;
  /** Every spelling a source actually used, preserved verbatim. */
  apnDisplayVariants: string[];
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  fips: string | null;
  owner: string | null;
  lpPropertyId: string | null;
  lpUrl: string | null;
  legalDescription: string | null;
  acres: number | null;
  interest: AcquisitionInterest;
  /** Field -> the one fact that governs it. */
  provenance: Record<string, SubjectFieldProvenance>;
  verification: {
    /** Research may proceed on this subject. */
    researchGrade: boolean;
    /** An official assessor/county record confirms it. Strictly stronger. */
    officiallyVerified: boolean;
    /**
     * The ONE official parcel record carrying `officiallyVerified`, named.
     *
     * "An official record confirms it" is a claim about a specific document,
     * and a claim that cannot name its document is not one LandOS may print.
     * Null means no qualifying subject-specific official record is retained —
     * which never revokes research-grade confidence, it only stops the panel
     * from saying something stronger than the evidence.
     */
    officialRecord: OfficialRecordCitation | null;
    /** What still requires official, title or legal verification. */
    outstanding: string[];
  };
  confidence: number;
}

/** The specific official record behind an official-verification claim. */
export interface OfficialRecordCitation {
  /** The retained fact this citation is traced to. */
  factId: string;
  /** Source name, as the source calls itself. */
  source: string;
  /** What kind of source it is. */
  sourceType: SubjectEvidenceKind;
  /** Record or evidence identifier within that source. */
  recordIdentifier: string | null;
  /** Subject fields this record actually matched. */
  fieldsMatched: SubjectEvidenceField[];
  /** When the record was observed or retrieved, when the source said. */
  observedAt: string | null;
  /** Why this source qualifies as an official, subject-specific parcel record. */
  qualifies: string;
}

export interface SubjectCandidate {
  candidateId: string;
  rank: number;
  subject: WorkingAcquisitionSubject;
  supportingFactIds: string[];
  /** What would tell this candidate apart from the others. */
  distinguishedBy: string;
}

export interface SubjectConflict {
  field: SubjectEvidenceField;
  statements: Array<{ value: string; source: string; weight: SubjectEvidenceWeight; factId: string }>;
  /** True when the disagreement is about which parcel this is. */
  material: boolean;
  resolution: 'resolved_by_precedence' | 'unresolved';
  reason: string;
}

export interface TargetedQuestion {
  /** Exactly one question. */
  question: string;
  why: string;
  /** What LandOS does the moment it is answered. */
  unblocks: string;
  acceptableAnswers: string[];
}

export interface ExcludedParcel {
  identifier: string;
  relationship: ClaimParcelRelationship;
  reason: string;
  factIds: string[];
}

// ── The bounded loop ────────────────────────────────────────────────────────

/**
 * Capabilities the understanding loop may ask for.
 *
 * Deliberately narrow: subject resolution, the provider record, the document
 * path, official property records, and the utility screen that reads the same
 * official parcel lookup. Comps, valuation, market and intelligence synthesis
 * are NOT here — they answer questions that only exist after the subject does.
 */
export const SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES = [
  'property-resolution',
  'landportal-research',
  'landportal-property-characteristics',
  'assessor-tax',
  'property-development-history',
] as const;

export type SubjectUnderstandingCapability = (typeof SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES)[number];

/** Small on purpose. A front door that needs five evidence checks to say what
 *  property this is has not understood the lead; it is searching. */
export const SUBJECT_UNDERSTANDING_ACTION_LIMIT = 4;

export interface SubjectEvidenceCheck {
  capabilityId: string;
  reason: string;
  parameters?: Record<string, string>;
}

export interface SubjectUnderstandingPlan {
  /** The model's reading of the evidence so far, in one or two sentences. */
  reading: string;
  /** The ONE next bounded evidence check, or null to stop. */
  nextCheck: SubjectEvidenceCheck | null;
  proposedOutcome: SubjectUnderstandingOutcome | null;
  question: TargetedQuestion | null;
}

export interface SubjectUnderstandingPlannerInput {
  dealCardId: number;
  evidence: SubjectEvidenceFact[];
  candidates: SubjectCandidate[];
  conflicts: SubjectConflict[];
  excludedParcels: ExcludedParcel[];
  deterministicOutcome: SubjectUnderstandingOutcome;
  /** Checks already spent, so the model never proposes one that just ran. */
  checksAlreadyRun: SubjectEvidenceCheck[];
  actionsRemaining: number;
  allowedCapabilities: readonly string[];
}

/** Reasoning only: returns text. It cannot act on the world. */
export type SubjectUnderstandingPlanner = (input: SubjectUnderstandingPlannerInput) => Promise<string>;

/** LandOS acts: runs one allowed capability and returns typed evidence. */
export type SubjectEvidenceExecutor = (check: SubjectEvidenceCheck) => Promise<SubjectEvidenceFact[]>;

export type SubjectUnderstandingStopReason =
  | 'research_ready'
  | 'candidate_set_settled'
  | 'targeted_input_required'
  | 'action_limit_reached'
  | 'no_further_check_available'
  | 'planner_unavailable'
  | 'planner_output_invalid'
  | 'subject_changed_underneath';

export interface SubjectUnderstandingAuditStep {
  step: number;
  at: string;
  kind: 'deterministic_assembly' | 'planner_turn' | 'evidence_check' | 'stop';
  detail: string;
  accepted: boolean;
  capabilityId?: string;
  rejectionReason?: string;
  factsAdded?: number;
}

/**
 * What actually reasoned, on what, at what cost.
 *
 * Recorded on every run — including the runs where nothing reasoned, because
 * "zero reasoning turns" is exactly the condition that shipped unnoticed and
 * exactly the condition this must make visible.
 */
export interface SubjectReasoningProvenance {
  bound: boolean;
  engine: string | null;
  transport: string | null;
  profile: string | null;
  provider: string | null;
  model: string | null;
  toolsets: string | null;
  allowedCapabilities: string[];
  turns: number;
  durationMs: number;
  /** Token/cost accounting when the provider path reports any. Null when it
   *  does not; an invented number is worse than an honest absence. */
  usage: Record<string, number | string> | null;
}

export const UNBOUND_REASONING: SubjectReasoningProvenance = {
  bound: false,
  engine: null,
  transport: null,
  profile: null,
  provider: null,
  model: null,
  toolsets: null,
  allowedCapabilities: [],
  turns: 0,
  durationMs: 0,
  usage: null,
};

export interface SubjectUnderstandingAudit {
  actionLimit: number;
  actionsUsed: number;
  plannerInvocations: number;
  subjectVersionAtStart: string;
  stopReason: SubjectUnderstandingStopReason;
  /** Which model reviewed this decision, and how much of it it did. */
  reasoning: SubjectReasoningProvenance;
  /** Every check the model asked for, including the ones that were refused. */
  toolRequests: Array<{ capabilityId: string; reason: string; accepted: boolean; refusalReason: string | null; factsAdded: number }>;
  steps: SubjectUnderstandingAuditStep[];
}

export interface SubjectUnderstandingResult {
  dealCardId: number;
  outcome: SubjectUnderstandingOutcome;
  /** Present only for `research_ready`. */
  subject: WorkingAcquisitionSubject | null;
  candidates: SubjectCandidate[];
  conflicts: SubjectConflict[];
  /** At most one. Null when nothing is needed from the operator. */
  question: TargetedQuestion | null;
  /** Every raw statement, retained with its source. */
  evidence: SubjectEvidenceFact[];
  /** Parcels named by the evidence that are NOT the transaction subject. */
  excludedParcels: ExcludedParcel[];
  confidence: number;
  /** False when the subject moved underneath this run: the reading stands, but
   *  it may not be written as authoritative. */
  persistable: boolean;
  audit: SubjectUnderstandingAudit;
}

// ── Deterministic derivation ────────────────────────────────────────────────

const SUBJECT_SCOPE: ClaimParcelRelationship = 'subject';

/** Formatting-insensitive identity key. Matches the canonical subject state's
 *  own normalization so the two never disagree about what an APN is. */
export function normalizeSubjectApn(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length > 0 ? normalized : null;
}

function bestOf(facts: SubjectEvidenceFact[]): SubjectEvidenceFact | null {
  let best: SubjectEvidenceFact | null = null;
  for (const candidate of facts) {
    if (!best || WEIGHT_RANK[candidate.weight] > WEIGHT_RANK[best.weight]) best = candidate;
  }
  return best;
}

function provenanceOf(fact: SubjectEvidenceFact): SubjectFieldProvenance {
  return {
    factId: fact.factId,
    source: fact.source.label,
    weight: fact.weight,
    inferred: fact.inferred,
    locator: fact.source.locator,
  };
}

function numeric(value: string): number | null {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const EXCLUDED_REASON: Record<ClaimParcelRelationship, string> = {
  subject: 'The transaction subject.',
  related_parcel: 'A different parcel in the same ownership. Retained by the seller and outside the transaction.',
  parent_or_source_parcel: 'A different parcel: the parent or source tract this subject came out of.',
  historical_parcel: 'A different parcel: a historical configuration superseded by the current record.',
  mailing_or_contact: 'A mailing or contact address, not a parcel.',
  unresolved_relationship: 'A different parcel named by the evidence whose relationship to the subject is not established.',
};

/** Identity groups: APN spellings that corroborate are ONE parcel. */
function groupApnFacts(apnFacts: SubjectEvidenceFact[]): SubjectEvidenceFact[][] {
  const groups: SubjectEvidenceFact[][] = [];
  for (const fact of apnFacts) {
    const existing = groups.find((group) => group.some((member) => apnIdentifiersCorroborate(member.value, fact.value)));
    if (existing) existing.push(fact);
    else groups.push([fact]);
  }
  return groups;
}

function buildInterest(input: {
  subjectFacts: SubjectEvidenceFact[];
  excluded: ExcludedParcel[];
  legalDescription: string | null;
  hasSurveyAcreage: boolean;
}): AcquisitionInterest {
  const narrative = input.subjectFacts
    .filter((fact) => fact.source.kind === 'operator_narrative' || fact.source.kind === 'seller_text')
    .map((fact) => `${fact.value} ${fact.quoted ?? ''}`)
    .join(' ');
  const excluded = input.excluded.map((parcel) => ({ identifier: parcel.identifier, reason: parcel.reason }));

  // The verb, not the noun. Operators write "splitting off the left lot", not
  // "a split": anchoring on the bare word missed the most common phrasing there
  // is, and a lead being carved out of a larger holding then presented as the
  // whole parcel — with the seller's retained improvements attached to it.
  if (/\b(?:split\w*|subdivid\w*|carv\w*|sever\w*|portion of|part of|piece of|acres? out of|off of)\b/i.test(narrative)) {
    return {
      form: 'proposed_split',
      statement: `A proposed split out of the seller's larger holding${input.legalDescription ? `: ${input.legalDescription}` : ''}.`
        + ' Only the portion being conveyed is the subject; anything the seller retains stays outside it.',
      excluded,
    };
  }
  const lot = input.legalDescription?.match(/\bLot\s+[\w-]+/i)?.[0] ?? null;
  if (lot) {
    const retained = excluded.length > 0
      ? ` ${excluded.length} further parcel${excluded.length === 1 ? '' : 's'} in the same ownership ${excluded.length === 1 ? 'is' : 'are'} retained and outside the transaction.`
      : '';
    return {
      form: 'recorded_lot',
      statement: `Recorded lot: ${input.legalDescription}.${retained}`,
      excluded,
    };
  }
  if (input.hasSurveyAcreage && !input.legalDescription) {
    return { form: 'survey_defined_area', statement: 'A survey-defined area; no recorded lot is stated.', excluded };
  }
  return {
    form: 'whole_parcel',
    statement: `The whole parcel as identified.${excluded.length > 0 ? ` ${excluded.length} related parcel${excluded.length === 1 ? '' : 's'} named by the evidence ${excluded.length === 1 ? 'is' : 'are'} outside the transaction.` : ''}`,
    excluded,
  };
}

function buildSubject(input: {
  identityFacts: SubjectEvidenceFact[];
  sharedFacts: SubjectEvidenceFact[];
  excluded: ExcludedParcel[];
}): WorkingAcquisitionSubject {
  const all = [...input.identityFacts, ...input.sharedFacts];
  const byField = (field: SubjectEvidenceField) => all.filter((fact) => fact.field === field);
  const provenance: Record<string, SubjectFieldProvenance> = {};

  const take = (key: string, field: SubjectEvidenceField): SubjectEvidenceFact | null => {
    const fact = bestOf(byField(field));
    if (fact) provenance[key] = provenanceOf(fact);
    return fact;
  };

  const apnFacts = byField('apn');
  const apnFact = bestOf(apnFacts);
  if (apnFact) provenance.apn = provenanceOf(apnFact);
  const address = take('address', 'address');
  const city = take('city', 'city');
  const county = take('county', 'county');
  const state = take('state', 'state');
  const zip = take('zip', 'zip');
  const fips = take('fips', 'fips');
  const owner = take('owner', 'owner');
  const lpPropertyId = take('lpPropertyId', 'lp_property_id');
  const lpUrl = take('lpUrl', 'lp_url');
  const legal = take('legalDescription', 'legal_description');
  const acreageFact = bestOf(byField('acreage'));
  if (acreageFact) provenance.acres = provenanceOf(acreageFact);

  // An official-record claim is only as good as the record it can name. A
  // provider panel, a geocode, generic county context and an operator's own
  // acceptance all carry `officiality` below `official` by construction, so
  // none of them reaches this filter — and a fact that does reach it must still
  // be about THIS parcel (an identity field on subject scope).
  const officialFacts = all.filter(
    (fact) => fact.source.officiality === 'official'
      && (fact.field === 'apn' || fact.field === 'lp_property_id' || fact.field === 'legal_description'),
  );
  const officialFact = bestOf(officialFacts);
  const officiallyVerified = officialFact != null;
  const officialRecord: OfficialRecordCitation | null = officialFact
    ? {
        factId: officialFact.factId,
        source: officialFact.source.label,
        sourceType: officialFact.source.kind,
        recordIdentifier: officialFact.source.locator ?? officialFact.source.url ?? null,
        fieldsMatched: [...new Set(all
          .filter((fact) => fact.source.label === officialFact.source.label && fact.source.officiality === 'official')
          .map((fact) => fact.field))],
        observedAt: officialFact.source.retrievedAt ?? null,
        qualifies: `${officialFact.source.label} is an official parcel record that names this subject by `
          + `${officialFact.field === 'apn' ? 'parcel identifier' : officialFact.field === 'lp_property_id' ? 'record id' : 'legal description'} `
          + `${officialFact.value}.`,
      }
    : null;
  const apnNormalized = apnFact ? normalizeSubjectApn(apnFact.value) : null;
  const hasJurisdiction = !!((county && state) || fips);
  const researchGrade = (!!apnNormalized && hasJurisdiction)
    || (!!lpPropertyId && !!fips)
    || officiallyVerified;

  const outstanding: string[] = [];
  if (!officiallyVerified) outstanding.push('Official county assessor or GIS parcel record confirming this parcel.');
  outstanding.push('Title, deed chain and legal access remain unverified.');
  if (!acreageFact) outstanding.push('A governing acreage from a survey, deed or official record.');

  // Confidence is the weight actually carried, not an aspiration.
  const identityWeight = apnFact ?? lpPropertyId;
  const confidence = officiallyVerified ? 0.95
    : identityWeight && WEIGHT_RANK[identityWeight.weight] >= WEIGHT_RANK.well_supported ? 0.8
      : researchGrade ? 0.6 : 0.35;

  return {
    apn: apnFact?.value ?? null,
    apnNormalized,
    apnDisplayVariants: [...new Set(apnFacts.map((fact) => fact.quoted?.match(/[\w.-]*\d[\w.-]*/)?.[0] ?? fact.value))],
    address: address?.value ?? null,
    city: city?.value ?? null,
    county: county?.value ?? null,
    state: state?.value ?? null,
    zip: zip?.value ?? null,
    fips: fips?.value ?? null,
    owner: owner?.value ?? null,
    lpPropertyId: lpPropertyId?.value ?? null,
    lpUrl: lpUrl?.value ?? null,
    legalDescription: legal?.value ?? null,
    acres: acreageFact ? numeric(acreageFact.value) : null,
    interest: buildInterest({
      subjectFacts: all,
      excluded: input.excluded,
      legalDescription: legal?.value ?? null,
      hasSurveyAcreage: acreageFact?.source.kind === 'document',
    }),
    provenance,
    verification: { researchGrade, officiallyVerified, officialRecord, outstanding },
    confidence,
  };
}

export interface SubjectDerivation {
  candidates: SubjectCandidate[];
  conflicts: SubjectConflict[];
  excludedParcels: ExcludedParcel[];
}

/**
 * PURE. Everything the evidence establishes about which parcel this is.
 *
 * Only `subject`-scope facts build a candidate. A related, parent, historical
 * or unresolved-relationship parcel is preserved and labelled — invariant 4
 * means its acreage, improvements and owner are never the subject's.
 */
export function deriveSubjectCandidates(evidence: readonly SubjectEvidenceFact[]): SubjectDerivation {
  const subjectFacts = evidence.filter((fact) => fact.parcelRelationship === SUBJECT_SCOPE);
  const otherFacts = evidence.filter((fact) => fact.parcelRelationship !== SUBJECT_SCOPE);

  // ── Parcels the evidence names that are not the subject ──
  const excludedParcels: ExcludedParcel[] = [];
  let current: ExcludedParcel | null = null;
  for (const fact of otherFacts) {
    if (fact.field === 'apn') {
      current = {
        identifier: fact.value,
        relationship: fact.parcelRelationship,
        reason: EXCLUDED_REASON[fact.parcelRelationship],
        factIds: [fact.factId],
      };
      excludedParcels.push(current);
      continue;
    }
    if (current && current.relationship === fact.parcelRelationship) current.factIds.push(fact.factId);
    else {
      current = {
        identifier: fact.source.label,
        relationship: fact.parcelRelationship,
        reason: EXCLUDED_REASON[fact.parcelRelationship],
        factIds: [fact.factId],
      };
      excludedParcels.push(current);
    }
  }

  // ── Identity groups ──
  const apnGroups = groupApnFacts(subjectFacts.filter((fact) => fact.field === 'apn'));
  const lpGroups = new Map<string, SubjectEvidenceFact[]>();
  for (const fact of subjectFacts.filter((f) => f.field === 'lp_property_id')) {
    const key = fact.value.trim();
    lpGroups.set(key, [...(lpGroups.get(key) ?? []), fact]);
  }

  // Facts that describe the lead rather than pick a parcel: they belong to
  // every candidate, and on their own they establish nothing.
  const sharedFacts = subjectFacts.filter((fact) => fact.field !== 'apn' && fact.field !== 'lp_property_id');

  const identityGroups: SubjectEvidenceFact[][] = apnGroups.length > 0
    ? apnGroups.map((group) => [...group, ...[...lpGroups.values()].flat()])
    : [...lpGroups.values()];

  const candidates: SubjectCandidate[] = identityGroups.map((identityFacts, index) => {
    const subject = buildSubject({ identityFacts, sharedFacts, excluded: excludedParcels });
    return {
      candidateId: `candidate-${index + 1}`,
      rank: index + 1,
      subject,
      supportingFactIds: [...identityFacts, ...sharedFacts].map((fact) => fact.factId),
      distinguishedBy: subject.apn
        ? `Parcel identifier ${subject.apn}${subject.county ? ` in ${subject.county} County` : ''}, from ${identityFacts[0]?.source.label ?? 'the supplied evidence'}.`
        : `Provider record ${subject.lpPropertyId ?? 'id'}${subject.fips ? ` under FIPS ${subject.fips}` : ''}.`,
    };
  });
  // Strongest evidence first, so a candidate set is ranked rather than ordered
  // by the accident of which page was read first.
  candidates.sort((a, b) => b.subject.confidence - a.subject.confidence);
  candidates.forEach((candidate, index) => { candidate.rank = index + 1; });

  // ── Conflicts ──
  const conflicts: SubjectConflict[] = [];
  const identityFields: SubjectEvidenceField[] = ['apn', 'lp_property_id', 'county', 'state', 'fips'];
  const watchedFields: SubjectEvidenceField[] = [...identityFields, 'address', 'acreage', 'owner'];
  for (const field of watchedFields) {
    const facts = subjectFacts.filter((fact) => fact.field === field);
    if (facts.length < 2) continue;
    // A punctuation variant is not a disagreement.
    const distinct = field === 'apn'
      ? groupApnFacts(facts).map((group) => group[0])
      : [...new Map(facts.map((fact) => [fact.value.trim().toLowerCase(), fact])).values()];
    if (distinct.length < 2) continue;
    const ranks = distinct.map((fact) => WEIGHT_RANK[fact.weight]);
    const top = Math.max(...ranks);
    const tied = ranks.filter((rank) => rank === top).length > 1;
    conflicts.push({
      field,
      statements: distinct.map((fact) => ({
        value: fact.value,
        source: fact.source.label,
        weight: fact.weight,
        factId: fact.factId,
      })),
      material: identityFields.includes(field) && tied,
      resolution: tied ? 'unresolved' : 'resolved_by_precedence',
      reason: tied
        ? 'Sources of equal weight state different values; nothing in the evidence decides between them.'
        : `The strongest statement governs; the others are retained as reference.`,
    });
  }

  return { candidates, conflicts, excludedParcels };
}

function questionFor(input: {
  outcome: SubjectUnderstandingOutcome;
  candidates: SubjectCandidate[];
  evidence: readonly SubjectEvidenceFact[];
}): TargetedQuestion | null {
  if (input.outcome === 'research_ready') return null;
  if (input.outcome === 'candidate_set') {
    const identifiers = input.candidates.map((candidate) => candidate.subject.apn ?? candidate.subject.lpPropertyId ?? 'the other record').filter(Boolean);
    return {
      question: `Two records name different parcels — ${identifiers.join(' and ')}. Which one is the property being sold?`,
      why: 'Sources of equal weight disagree on the parcel identifier, and research attached to the wrong parcel is worse than no research.',
      unblocks: 'LandOS confirms that parcel and begins property, market and comparable research immediately.',
      acceptableAnswers: [...identifiers.map((id) => `The parcel identified as ${id}`), 'A county parcel-record or GIS link for the correct parcel'],
    };
  }
  const address = input.evidence.find((fact) => fact.field === 'address');
  const locality = input.evidence.find((fact) => fact.field === 'county' || fact.field === 'state');
  if (address) {
    return {
      question: `Do you have the parcel number (APN) for ${address.value}, or a link to its county parcel record?`,
      why: 'The address is retained, but an address that geocodes is not a parcel: LandOS will not attach research to a parcel it has not identified.',
      unblocks: 'LandOS confirms the parcel and starts property, market and comparable research on it.',
      acceptableAnswers: ['An APN or parcel ID', 'A county parcel-record, GIS or LandPortal link', 'The county plus the owner of record'],
    };
  }
  return {
    question: `Which property is this — an address, a parcel number, or the county${locality ? ` in ${locality.value}` : ''} plus the owner name?`,
    why: 'Nothing supplied so far identifies a specific parcel, and LandOS does not guess one.',
    unblocks: 'Any one of these lets LandOS identify the parcel and begin research.',
    acceptableAnswers: ['A street address', 'An APN or parcel ID', 'The county plus the owner of record', 'A county parcel-record or LandPortal link'],
  };
}

/** PURE. Which of the three answers the evidence supports right now. */
export function decideSubjectOutcome(derivation: SubjectDerivation): {
  outcome: SubjectUnderstandingOutcome;
  subject: WorkingAcquisitionSubject | null;
} {
  const { candidates } = derivation;
  if (candidates.length === 0) return { outcome: 'needs_targeted_input', subject: null };
  if (candidates.length > 1) return { outcome: 'candidate_set', subject: null };
  const only = candidates[0];
  const blockingConflict = derivation.conflicts.some((conflict) => conflict.material && conflict.resolution === 'unresolved');
  if (!only.subject.verification.researchGrade || blockingConflict) {
    return { outcome: 'needs_targeted_input', subject: null };
  }
  return { outcome: 'research_ready', subject: only.subject };
}

// ── Plan parsing ────────────────────────────────────────────────────────────

function jsonObjectIn(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

const OUTCOMES: SubjectUnderstandingOutcome[] = ['research_ready', 'candidate_set', 'needs_targeted_input'];

/**
 * Validate one planner turn against the output schema.
 *
 * An unauthorized capability is not a malformed plan — it is a well-formed plan
 * asking for something the loop will not do — so it comes back as a `refusal`
 * with `nextCheck` stripped, and the caller records the refusal rather than
 * treating the model as broken.
 */
export function parseSubjectUnderstandingPlan(
  text: string,
  allowed: readonly string[],
): { plan: SubjectUnderstandingPlan | null; error: string | null; refusal: string | null } {
  const raw = jsonObjectIn(text);
  if (!raw || typeof raw !== 'object') {
    return { plan: null, error: 'the plan was not a JSON object', refusal: null };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.reading !== 'string' || body.reading.trim() === '') {
    return { plan: null, error: 'reading must be a non-empty string', refusal: null };
  }
  const proposedOutcome = body.proposedOutcome;
  if (proposedOutcome != null && !OUTCOMES.includes(proposedOutcome as SubjectUnderstandingOutcome)) {
    return { plan: null, error: `proposedOutcome must be one of ${OUTCOMES.join(', ')}`, refusal: null };
  }

  let question: TargetedQuestion | null = null;
  if (body.question != null) {
    const q = body.question as Record<string, unknown>;
    if (typeof q.question !== 'string' || q.question.trim() === '') {
      return { plan: null, error: 'question.question must be a non-empty string', refusal: null };
    }
    // "Only one precise follow-up question" is a hard rule, not a style note: a
    // compound ask is how a targeted question quietly becomes a questionnaire.
    if ((q.question.match(/\?/g) ?? []).length > 1 || /\band\s+(?:also\b|what\b|which\b|how\b|when\b)/i.test(q.question)) {
      return { plan: null, error: 'exactly one question may be asked; this asks more than one question', refusal: null };
    }
    question = {
      question: q.question,
      why: typeof q.why === 'string' ? q.why : '',
      unblocks: typeof q.unblocks === 'string' ? q.unblocks : '',
      acceptableAnswers: Array.isArray(q.acceptableAnswers)
        ? q.acceptableAnswers.filter((value): value is string => typeof value === 'string')
        : [],
    };
  }

  let nextCheck: SubjectEvidenceCheck | null = null;
  let refusal: string | null = null;
  if (body.nextCheck != null) {
    const check = body.nextCheck as Record<string, unknown>;
    if (typeof check.capabilityId !== 'string' || typeof check.reason !== 'string') {
      return { plan: null, error: 'nextCheck requires capabilityId and reason strings', refusal: null };
    }
    if (!allowed.includes(check.capabilityId)) {
      refusal = `capability "${check.capabilityId}" is not authorized for subject understanding`;
    } else {
      nextCheck = {
        capabilityId: check.capabilityId,
        reason: check.reason,
        ...(check.parameters && typeof check.parameters === 'object'
          ? { parameters: Object.fromEntries(Object.entries(check.parameters as Record<string, unknown>).map(([key, value]) => [key, String(value)])) }
          : {}),
      };
    }
  }

  return {
    plan: {
      reading: body.reading,
      nextCheck,
      proposedOutcome: (proposedOutcome as SubjectUnderstandingOutcome | undefined) ?? null,
      question,
    },
    error: null,
    refusal,
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface UnderstandSubjectInput {
  dealCardId: number;
  evidence: SubjectEvidenceFact[];
  /** The canonical subject version this run started from. */
  subjectVersionAtStart: string;
  planner?: SubjectUnderstandingPlanner;
  /** Who the planner is. Recorded on the run; read AFTER the turns, so a live
   *  binding's own turn/usage counters travel with the audit. */
  plannerProvenance?: SubjectReasoningProvenance;
  executor?: SubjectEvidenceExecutor;
  actionLimit?: number;
  allowedCapabilities?: readonly string[];
  /** Re-read at the end. A changed version refuses the write. */
  currentSubjectVersion?: () => string;
  now?: () => Date;
}

export async function understandSubject(input: UnderstandSubjectInput): Promise<SubjectUnderstandingResult> {
  const actionLimit = input.actionLimit ?? SUBJECT_UNDERSTANDING_ACTION_LIMIT;
  const allowed = input.allowedCapabilities ?? SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES;
  const now = input.now ?? (() => new Date());
  const steps: SubjectUnderstandingAuditStep[] = [];
  const record = (step: Omit<SubjectUnderstandingAuditStep, 'step' | 'at'>) => {
    steps.push({ step: steps.length + 1, at: now().toISOString(), ...step });
  };

  const evidence: SubjectEvidenceFact[] = [...input.evidence];
  let derivation = deriveSubjectCandidates(evidence);
  let decision = decideSubjectOutcome(derivation);
  record({
    kind: 'deterministic_assembly',
    accepted: true,
    detail: `${evidence.length} retained statement(s) produced ${derivation.candidates.length} candidate(s); deterministic reading is ${decision.outcome}.`,
  });

  let stopReason: SubjectUnderstandingStopReason =
    decision.outcome === 'research_ready' ? 'research_ready'
      : decision.outcome === 'candidate_set' ? 'candidate_set_settled'
        : 'targeted_input_required';
  let actionsUsed = 0;
  let plannerInvocations = 0;
  let modelQuestion: TargetedQuestion | null = null;
  const checksAlreadyRun: SubjectEvidenceCheck[] = [];
  const toolRequests: SubjectUnderstandingAudit['toolRequests'] = [];

  // The LLM Deal Manager reviews EVERY subject decision, including the ones the
  // deterministic reading already settled. What changes with the reading is what
  // the review is allowed to cost:
  //
  //   settled evidence   — one review turn, and no evidence check is authorized.
  //                        A clear lead completes at zero tool calls.
  //   unsettled evidence — the bounded loop, up to `actionLimit` checks.
  //
  // Either way the model proposes; `decideSubjectOutcome` over the retained
  // evidence decides. The model can add evidence, never a conclusion.
  if (input.planner) {
    const reviewOnly = decision.outcome === 'research_ready';
    while (actionsUsed < actionLimit) {
      plannerInvocations += 1;
      let text: string;
      try {
        text = await input.planner({
          dealCardId: input.dealCardId,
          evidence,
          candidates: derivation.candidates,
          conflicts: derivation.conflicts,
          excludedParcels: derivation.excludedParcels,
          deterministicOutcome: decision.outcome,
          checksAlreadyRun,
          actionsRemaining: actionLimit - actionsUsed,
          allowedCapabilities: allowed,
        });
      } catch (error) {
        record({ kind: 'planner_turn', accepted: false, detail: 'the planner could not be reached', rejectionReason: error instanceof Error ? error.message : String(error) });
        stopReason = 'planner_unavailable';
        break;
      }

      const { plan, error, refusal } = parseSubjectUnderstandingPlan(text, allowed);
      if (error || !plan) {
        record({ kind: 'planner_turn', accepted: false, detail: 'planner output failed schema validation', rejectionReason: error ?? 'unparseable plan' });
        stopReason = 'planner_output_invalid';
        break;
      }
      if (refusal) {
        record({ kind: 'planner_turn', accepted: false, detail: plan.reading, rejectionReason: refusal });
        toolRequests.push({ capabilityId: 'unauthorized', reason: plan.reading, accepted: false, refusalReason: refusal, factsAdded: 0 });
      } else {
        record({ kind: 'planner_turn', accepted: true, detail: plan.reading });
      }
      if (plan.question) modelQuestion = plan.question;

      // A settled reading authorizes reasoning, not action. The request is
      // refused and recorded rather than silently dropped, so an operator can
      // see that the model wanted a check and why it did not get one.
      if (reviewOnly) {
        if (plan.nextCheck) {
          toolRequests.push({
            capabilityId: plan.nextCheck.capabilityId,
            reason: plan.nextCheck.reason,
            accepted: false,
            refusalReason: 'the retained evidence already establishes this subject; no evidence check is authorized on a settled reading',
            factsAdded: 0,
          });
          record({
            kind: 'evidence_check',
            accepted: false,
            capabilityId: plan.nextCheck.capabilityId,
            detail: plan.nextCheck.reason,
            rejectionReason: 'refused: the deterministic reading is already research_ready, so this review turn spends no action',
          });
        }
        stopReason = 'research_ready';
        break;
      }

      if (!plan.nextCheck) {
        stopReason = 'no_further_check_available';
        break;
      }

      const check = plan.nextCheck;
      checksAlreadyRun.push(check);
      let found: SubjectEvidenceFact[] = [];
      try {
        found = input.executor ? await input.executor(check) : [];
      } catch (executionError) {
        record({
          kind: 'evidence_check',
          accepted: false,
          capabilityId: check.capabilityId,
          detail: check.reason,
          rejectionReason: executionError instanceof Error ? executionError.message : String(executionError),
        });
        actionsUsed += 1;
        toolRequests.push({
          capabilityId: check.capabilityId,
          reason: check.reason,
          accepted: false,
          refusalReason: steps.at(-1)?.rejectionReason ?? 'the evidence check failed',
          factsAdded: 0,
        });
        continue;
      }
      actionsUsed += 1;
      record({ kind: 'evidence_check', accepted: true, capabilityId: check.capabilityId, detail: check.reason, factsAdded: found.length });
      toolRequests.push({ capabilityId: check.capabilityId, reason: check.reason, accepted: true, refusalReason: null, factsAdded: found.length });

      evidence.push(...found);
      derivation = deriveSubjectCandidates(evidence);
      decision = decideSubjectOutcome(derivation);
      if (decision.outcome === 'research_ready') {
        stopReason = 'research_ready';
        break;
      }
      stopReason = actionsUsed >= actionLimit
        ? 'action_limit_reached'
        : decision.outcome === 'candidate_set' ? 'candidate_set_settled' : 'targeted_input_required';
    }
    if (actionsUsed >= actionLimit && decision.outcome !== 'research_ready') stopReason = 'action_limit_reached';
  }

  // Stale-write protection. The reading still stands; it simply may not be
  // written as the authoritative subject when the subject moved underneath it.
  let persistable = true;
  if (input.currentSubjectVersion) {
    const current = input.currentSubjectVersion();
    if (current !== input.subjectVersionAtStart) {
      persistable = false;
      stopReason = 'subject_changed_underneath';
      record({
        kind: 'stop',
        accepted: false,
        detail: `the accepted subject changed during this run (${input.subjectVersionAtStart} -> ${current}); the reading is retained but not written`,
        rejectionReason: 'stale_subject_version',
      });
    }
  }

  const question = decision.outcome === 'research_ready'
    ? null
    : modelQuestion ?? questionFor({ outcome: decision.outcome, candidates: derivation.candidates, evidence });

  if (steps.at(-1)?.kind !== 'stop') {
    record({ kind: 'stop', accepted: true, detail: `stopped: ${stopReason}` });
  }

  return {
    dealCardId: input.dealCardId,
    outcome: decision.outcome,
    subject: decision.subject,
    candidates: derivation.candidates,
    conflicts: derivation.conflicts,
    question,
    evidence,
    excludedParcels: derivation.excludedParcels,
    confidence: decision.subject?.confidence ?? (derivation.candidates[0]?.subject.confidence ?? 0),
    persistable,
    audit: {
      actionLimit,
      actionsUsed,
      plannerInvocations,
      subjectVersionAtStart: input.subjectVersionAtStart,
      stopReason,
      reasoning: input.plannerProvenance
        ? { ...input.plannerProvenance, turns: input.plannerProvenance.turns || plannerInvocations }
        : { ...UNBOUND_REASONING, bound: !!input.planner, turns: plannerInvocations },
      toolRequests,
      steps,
    },
  };
}
