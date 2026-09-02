// LandOS — landos-seller-discovery.
//
// Seller Intelligence has one source of truth and it is not the property. A
// deed, an assessor roll, a tax bill and an aerial say nothing about why an
// owner would sell, what they want for it, when, or who decides. Every prior
// version of this layer that let property data "suggest" motivation produced a
// confident story about a person LandOS had never spoken to.
//
// So this capability is built around one boundary, held by construction:
//
//   BEFORE a conversation   it prepares a DISCOVERY BRIEF: the questions the
//                           retained property and market evidence cannot
//                           answer and the seller can. Each question names the
//                           gap that raised it. Nothing here is a claim.
//
//   AFTER a conversation    it extracts motivation, price, timeline, decision
//                           maker, constraints and commitments ONLY from the
//                           communications LandOS actually retains, and every
//                           claim carries the communication it came from, who
//                           spoke, the exact excerpt, how firmly it was said,
//                           and whether a later communication superseded it.
//
// What may carry a seller claim, and what may not:
//
//   conversation record     a call, transcript or in-person entry, either
//                           direction — read turn by turn when the speakers are
//                           labelled; the operator's turns never carry a claim
//   seller message          an inbound text, email or voicemail: the seller's
//                           own words, with quoted earlier messages stripped
//   operator's record       the operator's summary of what the seller SAID
//                           ("he said $45,000") — carried at a lower confidence
//   discovery notes         the operator's structured discovery extraction
//   seller-stated fact      an operator-recorded "the seller said" row, carried
//                           at a lower weight because it is not the verbatim
//                           communication
//   operator message        an OUTBOUND text or email: the operator's words,
//                           never the seller's — refused as a claim source
//   operator note           operator-authored; refused as a claim source
//   operator inference      "probably motivated by the taxes" — refused
//   seller profile fields   CRM notes the operator typed; shown, never claimed
//   public records          never read here at all
//
// Pure over its inputs: no model, no browser, no network, no clock in the
// persisted payload. The lifecycle around it decides when to run and persists
// through the shared derived-snapshot seam.

import { createHash } from 'node:crypto';

import { commAttribution } from './acquisition-intelligence-dossier.js';
import type { AcquisitionState, CommLogEntry, DiscoveryExtraction } from './acquisitions.js';
import type { MarketResearchAndPulse } from './market-research-and-pulse.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  clean,
  confidenceFor,
  findingsIn,
  SELLER_CLAIM_DIMENSIONS,
  utterancesOf,
  type ClaimConfidence,
  type ClaimModality,
  type ClaimPolarity,
  type Finding,
  type SellerClaimDimension,
  type SpeakerRole,
} from './seller-language.js';
import type { SellerStatedFact } from './seller-stated-facts.js';
import type { ClaimWeight } from './source-aware-synthesis.js';

export { SELLER_CLAIM_DIMENSIONS };
export type { SellerClaimDimension, ClaimConfidence, ClaimModality, ClaimPolarity, SpeakerRole };

export const SELLER_DISCOVERY_VERSION = '2.0.0';
export const SELLER_DISCOVERY_SNAPSHOT = 'seller_discovery_v1';
export const SELLER_DISCOVERY_SKILL = 'landos-seller-discovery';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const SELLER_CLAIM_DIMENSION_LABEL: Record<SellerClaimDimension, string> = {
  motivation: 'Motivation',
  price: 'Price expectation',
  timeline: 'Timeline',
  decision_maker: 'Decision maker',
  constraint: 'Constraint',
  commitment: 'Commitment',
  property_claim: 'Seller-reported property claim',
};

export type CommunicationRecordKind =
  | 'conversation_record'
  | 'seller_message'
  | 'discovery_notes'
  | 'seller_stated_fact'
  | 'operator_message'
  | 'operator_note';

export interface CommunicationRef {
  id: string | null;
  at: string | null;
  type: string;
  channel: string | null;
  direction: string | null;
  /** The dossier's deterministic speaker label, so the record never flattens. */
  attribution: string;
  kind: CommunicationRecordKind;
}

export interface SellerClaim {
  claimId: string;
  dimension: SellerClaimDimension;
  /** The seller's position as read, bounded. */
  statement: string;
  /** The exact sentence, or recorded field, the claim was read from. */
  excerpt: string;
  /** The parsed position when the excerpt carries one: an amount, a date
   *  phrase, a person, a keyword. */
  value: string | null;
  /** `recorded_field`: the operator filed it under this dimension. `text_match`:
   *  the sentence was found in the retained text. */
  method: 'recorded_field' | 'text_match';
  /** Who said it: the seller verbatim, another party in the conversation, or
   *  the operator's own record of the seller. */
  speaker: { role: Extract<SpeakerRole, 'seller' | 'seller_party' | 'operator_record'>; label: string };
  /** Asserted, negated ("I am not asking $28,000") or withdrawn ("forget the
   *  $45,000"). Only an assertion can be the seller's current position. */
  polarity: ClaimPolarity;
  /** Firm, conditional, uncertain, or (for commitments) merely proposed. */
  modality: ClaimModality;
  condition: string | null;
  confidence: ClaimConfidence;
  weight: ClaimWeight;
  standing: 'seller_reported';
  /** `current` unless a later communication superseded it. */
  status: 'current' | 'historical';
  supersededBy: string | null;
  supersessionReason: string | null;
  source: CommunicationRef;
}

export interface SellerClaimConflict {
  dimension: SellerClaimDimension;
  earlier: { claimId: string; value: string | null; at: string | null };
  later: { claimId: string; value: string | null; at: string | null };
}

export interface DiscoveryQuestion {
  key: string;
  topic: string;
  question: string;
  /** Why the answer moves the decision. */
  why: string;
  /** The retained gap, guardrail or limitation that raised it. */
  basis: string;
  priority: 1 | 2 | 3;
  /** Claim ids that already answer it, when the seller has. Current claims only. */
  answeredBy: string[];
}

export interface SellerDiscoveryPlanning {
  /** A call, text or email is planned or has already happened. */
  planned: boolean;
  reason: string;
  signals: {
    stage: string | null;
    nextFollowUpDate: string | null;
    followUpRequested: boolean;
    contactRetained: boolean;
    communicationsRetained: number;
  };
}

export interface SellerDiscoveryRecord {
  communications: number;
  conversationRecords: number;
  sellerMessages: number;
  operatorMessages: number;
  operatorNotes: number;
  discoveryExtractions: number;
  sellerStatedFacts: number;
  firstContactAt: string | null;
  lastContactAt: string | null;
  nextFollowUpDate: string | null;
  stage: string | null;
  contact: { name: string | null; hasPhone: boolean; hasEmail: boolean };
}

export interface SellerDiscoverySynthesis {
  contractVersion: typeof SELLER_DISCOVERY_VERSION;
  dealCardId: number;
  /** Null in the persisted payload; the row's own timestamp is the answer. */
  generatedAt: string | null;
  inputFingerprint: string;
  status: 'no_communications' | 'communications_read';
  planning: SellerDiscoveryPlanning;
  record: SellerDiscoveryRecord;
  brief: {
    objective: string;
    questions: DiscoveryQuestion[];
    /** Things the operator must not state as fact on the call. */
    doNotAssume: string[];
  };
  /** Every claim, newest first, current and historical alike. */
  claims: SellerClaim[];
  /** The seller's current position per dimension: the newest current
   *  assertion, so a surface answers "what do we know" without walking the
   *  list. Negated and withdrawn claims never become a position. */
  extraction: Record<SellerClaimDimension, { latest: SellerClaim | null; count: number; current: number; historical: number }>;
  /** Where a later communication moved a position the seller had stated. */
  conflicts: SellerClaimConflict[];
  unanswered: SellerClaimDimension[];
  /** CRM profile fields the operator typed. Displayed as operator notes; never
   *  a seller claim, because no retained communication carries them. */
  operatorProfileNotes: Array<{ field: string; value: string }>;
  /** Retained records and sentences refused as claim sources, and why.
   *  Counted, not hidden. */
  refusals: Array<{ record: string; reason: string; excerpt?: string }>;
  limitations: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const bound = (text: string, max = 240): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function recordKindFor(entry: CommLogEntry): CommunicationRecordKind {
  const type = entry.type ?? (entry.channel === 'call' || entry.channel === 'in_person' ? 'call' : entry.channel === 'text' || entry.channel === 'email' ? entry.channel : 'note');
  if (type === 'note') return 'operator_note';
  if (type === 'transcript' || type === 'call' || entry.channel === 'call' || entry.channel === 'in_person') return 'conversation_record';
  if (entry.direction === 'inbound') return 'seller_message';
  return 'operator_message';
}

function refOf(entry: CommLogEntry, kind: CommunicationRecordKind): CommunicationRef {
  const type = entry.type ?? entry.channel ?? 'note';
  return {
    id: entry.id ?? null,
    at: entry.at ?? entry.createdAt ?? null,
    type,
    channel: entry.channel ?? null,
    direction: entry.direction ?? null,
    attribution: commAttribution(type, entry.direction ?? null, !!clean(entry.body)),
    kind,
  };
}

const weightFor = (confidence: ClaimConfidence): ClaimWeight => (confidence === 'high' ? 'well_supported' : 'likely');

// ── Claim extraction ────────────────────────────────────────────────────────

interface Draft {
  dimension: SellerClaimDimension;
  excerpt: string;
  value: string | null;
  method: SellerClaim['method'];
  speaker: SellerClaim['speaker'];
  polarity: ClaimPolarity;
  modality: ClaimModality;
  condition: string | null;
  confidence: ClaimConfidence;
  withdraws: string[];
  source: CommunicationRef;
  /** Order within the record, so equal timestamps keep their reading order. */
  order: number;
}

interface Collector {
  drafts: Draft[];
  refusals: SellerDiscoverySynthesis['refusals'];
  seen: Set<string>;
  add: (draft: Omit<Draft, 'order'>) => void;
}

function collector(): Collector {
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  return {
    drafts,
    refusals: [],
    seen,
    add(draft) {
      const excerpt = clean(draft.excerpt);
      if (!excerpt) return;
      const key = `${draft.dimension}|${excerpt.toLowerCase()}|${draft.source.id ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      drafts.push({ ...draft, excerpt, order: drafts.length });
    },
  };
}

function draftFromFinding(finding: Finding, excerpt: string, method: SellerClaim['method'], speaker: SellerClaim['speaker'], implicitSubject: boolean, source: CommunicationRef, afterTheFact = false): Omit<Draft, 'order'> {
  return {
    dimension: finding.dimension,
    excerpt,
    value: finding.value,
    method,
    speaker,
    polarity: finding.polarity,
    modality: finding.modality,
    condition: finding.condition,
    confidence: confidenceFor({ speaker: speaker.role, method, implicitSubject, modality: finding.modality, afterTheFact }),
    withdraws: finding.withdraws,
    source,
  };
}

/** A recorded field the operator filed under a dimension: the operator's
 *  explicit record of what the seller said. */
function addRecorded(into: Collector, dimension: SellerClaimDimension | null, text: string | null | undefined, source: CommunicationRef, afterTheFact = false): void {
  const excerpt = clean(text);
  if (!excerpt) return;
  const speaker: SellerClaim['speaker'] = { role: 'operator_record', label: afterTheFact ? "operator's after-discovery record of the seller" : "operator's recorded field" };
  const findings = findingsIn(excerpt, 'operator_record');
  const chosen = dimension
    ? findings.find((finding) => finding.dimension === dimension) ?? { dimension, value: null, polarity: 'asserted' as const, modality: 'firm' as const, condition: null, withdraws: [], operatorValues: [] }
    : findings.find((finding) => finding.dimension !== 'commitment') ?? findings[0] ?? { dimension: 'property_claim' as const, value: null, polarity: 'asserted' as const, modality: 'firm' as const, condition: null, withdraws: [], operatorValues: [] };
  into.add(draftFromFinding(chosen, excerpt, 'recorded_field', speaker, false, source, afterTheFact));
}

/** Claims from a retained communication that is allowed to carry them. */
function claimsFromCommunication(entry: CommLogEntry, ref: CommunicationRef, kind: CommunicationRecordKind, contactName: string | null, into: Collector): void {
  for (const item of entry.commitments ?? []) addRecorded(into, 'commitment', item, ref);
  for (const item of entry.objections ?? []) addRecorded(into, 'constraint', item, ref);
  for (const item of entry.keyFacts ?? []) addRecorded(into, null, item, ref);

  const when = ref.at?.slice(0, 10) ?? 'undated';
  for (const utterance of utterancesOf(entry, kind === 'seller_message', contactName)) {
    if (utterance.refusal || utterance.speaker === 'operator' || utterance.speaker === 'unattributed') {
      // Only sentences that would otherwise have carried a claim are worth
      // reporting; the operator's small talk is not a refusal.
      if (findingsIn(utterance.text, 'seller').length) {
        into.refusals.push({ record: `${ref.attribution.split(' (')[0]} ${when} · ${utterance.label}`, reason: utterance.refusal ?? "The operator's own words; a seller claim needs the seller's statement.", excerpt: bound(utterance.text, 160) });
      }
      continue;
    }
    const speaker: SellerClaim['speaker'] = { role: utterance.speaker, label: utterance.label };
    for (const finding of findingsIn(utterance.text, utterance.speaker)) {
      into.add(draftFromFinding(finding, utterance.text, 'text_match', speaker, utterance.implicitSubject, ref));
    }
  }
}

function claimsFromDiscovery(extraction: DiscoveryExtraction, index: number, into: Collector): void {
  const ref: CommunicationRef = {
    id: `discovery:${index}`,
    at: extraction.capturedAt ?? null,
    type: 'discovery',
    channel: 'call',
    direction: null,
    attribution: 'DISCOVERY NOTES (operator-structured extraction of a seller conversation)',
    kind: 'discovery_notes',
  };
  addRecorded(into, 'motivation', extraction.motivation, ref);
  addRecorded(into, 'timeline', extraction.timeline, ref);
  addRecorded(into, 'price', extraction.priceExpectation, ref);
  addRecorded(into, 'decision_maker', extraction.decisionMakers, ref);
  for (const item of extraction.objections ?? []) addRecorded(into, 'constraint', item, ref);
  for (const item of extraction.risks ?? []) addRecorded(into, 'constraint', item, ref);
  for (const item of extraction.followUpItems ?? []) addRecorded(into, 'commitment', item, ref);
  for (const item of extraction.sellerClaimedFacts ?? []) addRecorded(into, 'property_claim', item, ref);
}

const STATED_FACT_DIMENSION: Partial<Record<SellerStatedFact['kind'], SellerClaimDimension>> = {
  price_expectation: 'price',
  timeline: 'timeline',
  family_decision_makers: 'decision_maker',
  liens: 'constraint',
  taxes_owed: 'constraint',
  known_restrictions: 'constraint',
  easement: 'constraint',
};

function claimsFromStatedFacts(facts: readonly SellerStatedFact[], into: Collector): void {
  facts.forEach((fact, index) => {
    const ref: CommunicationRef = {
      id: `seller-stated-fact:${index}`,
      at: fact.recordedAt ? new Date(fact.recordedAt * 1000).toISOString() : null,
      type: 'seller_stated_fact',
      channel: null,
      direction: null,
      attribution: `SELLER-STATED FACT (${fact.kind.replace(/_/g, ' ')}; recorded by ${fact.recordedBy} after discovery, not a verbatim communication)`,
      kind: 'seller_stated_fact',
    };
    const value = fact.note ? `${fact.value} (${fact.note})` : fact.value;
    addRecorded(into, STATED_FACT_DIMENSION[fact.kind] ?? 'property_claim', value, ref, true);
  });
}

// ── Currentness ─────────────────────────────────────────────────────────────

/** Dimensions where the seller holds one position at a time. */
const SINGLE_VALUED = new Set<SellerClaimDimension>(['price', 'timeline']);

const valueKey = (value: string | null): string | null => {
  if (!value) return null;
  const amount = /\$[\d,]+/.exec(value)?.[0];
  return (amount ?? value).toLowerCase().replace(/\s+/g, ' ').trim();
};

/**
 * Turn the drafts into claims, oldest first, then let each later claim
 * supersede what it moved:
 *   • a later assertion in a single-valued dimension (price, timeline)
 *     supersedes an earlier assertion with a different value;
 *   • a withdrawal or negation supersedes the earlier assertion of that value;
 *   • "nobody else decides" supersedes earlier named decision makers, and a
 *     newly named decision maker supersedes an earlier "seller decides alone";
 *   • a withdrawn refusal to sell ("changed my mind") supersedes it.
 * Everything else stays current: motivations accumulate, and so do
 * commitments, constraints and seller-reported property claims.
 */
function finalizeClaims(drafts: Draft[]): { claims: SellerClaim[]; conflicts: SellerClaimConflict[] } {
  const ordered = [...drafts].sort((a, b) => (a.source.at ?? '').localeCompare(b.source.at ?? '') || a.order - b.order);
  const claims: SellerClaim[] = ordered.map((draft, index) => ({
    claimId: `sd:${index + 1}:${draft.dimension}`,
    dimension: draft.dimension,
    statement: bound(draft.excerpt),
    excerpt: bound(draft.excerpt, 400),
    value: draft.value,
    method: draft.method,
    speaker: draft.speaker,
    polarity: draft.polarity,
    modality: draft.modality,
    condition: draft.condition,
    confidence: draft.confidence,
    weight: weightFor(draft.confidence),
    standing: 'seller_reported',
    status: 'current',
    supersededBy: null,
    supersessionReason: null,
    source: draft.source,
  }));
  const conflicts: SellerClaimConflict[] = [];
  const supersede = (earlier: SellerClaim, later: SellerClaim, reason: string) => {
    if (earlier.status === 'historical') return;
    earlier.status = 'historical';
    earlier.supersededBy = later.claimId;
    earlier.supersessionReason = reason;
    if (earlier.polarity === 'asserted') {
      conflicts.push({
        dimension: earlier.dimension,
        earlier: { claimId: earlier.claimId, value: earlier.value, at: earlier.source.at },
        later: { claimId: later.claimId, value: later.value, at: later.source.at },
      });
    }
  };

  claims.forEach((later, index) => {
    const laterKey = valueKey(later.value);
    const withdrawn = new Set(ordered[index].withdraws.map((value) => valueKey(value)));
    if (later.polarity === 'withdrawn' && laterKey) withdrawn.add(laterKey);
    for (const earlier of claims.slice(0, index)) {
      if (earlier.dimension !== later.dimension || earlier.source.id === later.source.id && earlier.source.id != null && later.polarity === 'asserted' && earlier.polarity === 'asserted') continue;
      const earlierKey = valueKey(earlier.value);
      if (earlier.polarity === 'asserted' && earlierKey && withdrawn.has(earlierKey)) {
        supersede(earlier, later, later.polarity === 'withdrawn' ? 'The seller withdrew this in a later communication.' : 'The seller replaced this in a later communication.');
        continue;
      }
      if (later.polarity === 'negated' && earlier.polarity === 'asserted' && earlierKey && laterKey && earlierKey === laterKey) {
        supersede(earlier, later, 'The seller later denied this.');
        continue;
      }
      if (later.polarity === 'asserted' && earlier.polarity === 'asserted' && SINGLE_VALUED.has(later.dimension) && laterKey && earlierKey && laterKey !== earlierKey) {
        supersede(earlier, later, 'The seller stated a different position in a later communication.');
        continue;
      }
      if (later.dimension === 'decision_maker' && later.polarity === 'asserted' && earlier.polarity === 'asserted') {
        if (laterKey === 'seller decides alone' && earlierKey && earlierKey !== 'seller decides alone') supersede(earlier, later, 'The seller later said nobody else decides.');
        if (laterKey && laterKey !== 'seller decides alone' && earlierKey === 'seller decides alone') supersede(earlier, later, 'The seller later named another decision maker.');
      }
      if (later.dimension === 'decision_maker' && later.polarity === 'negated' && earlier.polarity === 'asserted' && earlierKey && laterKey && earlierKey.split(', ').some((person) => laterKey.includes(person))) {
        supersede(earlier, later, 'The seller later said this person need not sign.');
      }
    }
  });

  // A withdrawal of a refusal to sell ("talked it over", "changed my mind") is
  // only a claim when there was a refusal to withdraw. Without an earlier
  // "not selling" it is ordinary conversation, and listing it would tell the
  // operator the seller once refused when they never did.
  const kept = claims.filter((claim) =>
    !(claim.dimension === 'constraint' && claim.polarity === 'withdrawn' && !claims.some((earlier) => earlier.supersededBy === claim.claimId)));
  return { claims: kept.reverse(), conflicts };
}

// ── Discovery brief ─────────────────────────────────────────────────────────

interface QuestionSeed {
  key: string;
  topic: string;
  question: string;
  why: string;
  basis: string;
  priority: 1 | 2 | 3;
  /** Which claim dimension would answer it, when the seller can. */
  answeredByDimension: SellerClaimDimension | null;
  /** A retained property claim answers it when it mentions this. */
  answeredByPropertyClaim?: RegExp;
}

/**
 * The questions the retained evidence cannot answer and the seller can.
 *
 * Every question is raised by a named gap in the Property Story, a withheld
 * guardrail, a Market Story limitation, or an empty seller dimension. A
 * question with no gap behind it is not asked: the seller's time is the
 * scarcest evidence source LandOS has, and a call that re-asks what the record
 * already says wastes it.
 */
function questionSeeds(
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  askingPrice: number | null,
): QuestionSeed[] {
  const seeds: QuestionSeed[] = [];
  const topic = (key: string) => property?.diligence.find((entry) => entry.key === key) ?? null;
  const guard = (kind: string) => property?.guardrails.find((entry) => entry.claimKind === kind) ?? null;

  // Seller dimensions: always open until a communication answers them.
  seeds.push({
    key: 'motivation', topic: 'Motivation',
    question: 'What has you thinking about selling the land now?',
    why: 'Motivation sets negotiating room and pace; without it every offer is a guess at what the seller values.',
    basis: 'No retained seller communication states a motivation.',
    priority: 1, answeredByDimension: 'motivation',
  });
  seeds.push({
    key: 'price', topic: 'Price expectation',
    question: askingPrice != null
      ? `The number on file is $${Math.round(askingPrice).toLocaleString('en-US')}. How did you arrive at that, and is there flexibility on it?`
      : 'Do you have a number in mind for the land, and how did you arrive at it?',
    why: 'A seller price expectation is the one figure LandOS cannot derive; it decides offer, renegotiate or pass.',
    basis: askingPrice != null
      ? 'An asking price is on file but no retained communication explains or confirms it.'
      : 'No retained seller communication states a price expectation.',
    priority: 1, answeredByDimension: 'price',
  });
  seeds.push({
    key: 'timeline', topic: 'Timeline',
    question: 'Is there a date you need this done by, or are you flexible on timing?',
    why: 'Timeline decides whether speed or price is the lever, and which exit strategies are even available.',
    basis: 'No retained seller communication states a timeline.',
    priority: 1, answeredByDimension: 'timeline',
  });
  seeds.push({
    key: 'decision_maker', topic: 'Decision maker',
    question: 'Is anyone else on the title or involved in the decision to sell?',
    why: 'An offer to someone who cannot sign is not an offer; heirs, spouses and trustees change the path to a contract.',
    basis: 'No retained seller communication identifies who decides.',
    priority: 1, answeredByDimension: 'decision_maker',
  });

  // Property gaps the seller can speak to. Seller-reported answers are leads
  // for diligence, never verified facts, and the brief says so.
  const access = topic('access');
  if (access && access.status !== 'established') {
    seeds.push({
      key: 'access', topic: 'Legal access',
      question: 'How do you get onto the property today, and is there a recorded easement or deeded right of way for that route?',
      why: 'A parcel without recorded legal access prices as landlocked; the seller often knows whether a recorded instrument exists.',
      basis: access.gap ?? access.headline,
      priority: 1, answeredByDimension: 'property_claim', answeredByPropertyClaim: /access|easement|right of way|driveway|road/i,
    });
  }
  if (property?.subject.acreageBasis && /not yet supplied|held by the operator|survey/i.test(property.subject.acreageBasis)) {
    seeds.push({
      key: 'survey', topic: 'Survey and boundaries',
      question: 'Has the land been surveyed, and can you share the survey and any legal description for the piece being sold?',
      why: 'The governing acreage rests on a survey LandOS has not seen; the document itself settles size and boundary.',
      basis: property.subject.acreageBasis,
      priority: 1, answeredByDimension: 'property_claim', answeredByPropertyClaim: /survey|boundar|corner|pin|stake/i,
    });
  }
  if (property?.subject.interest.form === 'proposed_split') {
    seeds.push({
      key: 'split', topic: 'Proposed split',
      question: 'Exactly which part of the larger tract are you selling, and has the county ever been asked about splitting it?',
      why: 'A split that the county will not approve is not a deal; the seller knows what has been asked and answered.',
      basis: property.subject.interest.statement,
      priority: 1, answeredByDimension: 'property_claim', answeredByPropertyClaim: /split|divid|county|plat|portion|part of/i,
    });
  }
  const zoning = topic('zoning');
  if (zoning && zoning.status !== 'established') {
    seeds.push({
      key: 'zoning', topic: 'Zoning and intended use',
      question: 'Do you know how the land is zoned, and has anyone asked the county what can be built on it?',
      why: 'Zoning sets the exit product; a seller who has asked the county saves a research step and reveals what buyers were told.',
      basis: zoning.gap ?? zoning.headline,
      priority: 2, answeredByDimension: 'property_claim', answeredByPropertyClaim: /zon|permit|build|county said/i,
    });
  }
  const wellSeptic = topic('well_septic');
  if (wellSeptic && wellSeptic.status !== 'established') {
    seeds.push({
      key: 'well_septic', topic: 'Well and septic',
      question: 'Has a perc test or site evaluation ever been done, and is there a well or septic on or near the piece?',
      why: 'Septic feasibility decides whether the parcel is a home site at all, and a seller often holds the old test.',
      basis: wellSeptic.gap ?? wellSeptic.headline,
      priority: 2, answeredByDimension: 'property_claim', answeredByPropertyClaim: /perc|septic|well|site eval/i,
    });
  }
  const utilities = topic('utilities');
  if (utilities && utilities.status !== 'established') {
    seeds.push({
      key: 'utilities', topic: 'Utilities',
      question: 'Is power at the road, and has any utility ever quoted you for service to the property?',
      why: 'A provider quote in the seller\'s hands is the fastest route to the availability answer LandOS still lacks.',
      basis: utilities.gap ?? utilities.headline,
      priority: 2, answeredByDimension: 'property_claim', answeredByPropertyClaim: /power|electric|water|utilit|pole|meter/i,
    });
  }
  const taxes = topic('taxes');
  if (taxes && taxes.status !== 'established') {
    seeds.push({
      key: 'taxes', topic: 'Taxes and liens',
      question: 'Are the property taxes current, and is there any mortgage, lien or tax certificate against the land?',
      why: 'An encumbrance changes what the seller can net and therefore what they will accept.',
      basis: taxes.gap ?? taxes.headline,
      priority: 2, answeredByDimension: 'constraint',
    });
  }
  if (guard('Title')) {
    seeds.push({
      key: 'title', topic: 'Title',
      question: 'How did you come to own the land, and is it held in your name, a trust, or an estate?',
      why: 'LandOS holds no title evidence; how title is held decides who signs and what clears before closing.',
      basis: guard('Title')!.statement,
      priority: 2, answeredByDimension: 'decision_maker',
    });
  }
  const wetlands = topic('wetlands');
  if (wetlands?.claims.some((claim) => /\b([5-9]\d|100)(\.\d+)?%/.test(claim.value ?? ''))) {
    seeds.push({
      key: 'wet', topic: 'Wet ground',
      question: 'Does any of the land stay wet or flood after rain, and where is the high ground?',
      why: 'Mapped wetlands cover a large share of the parcel; the seller\'s ground truth guides where a buildable envelope could be.',
      basis: wetlands.headline,
      priority: 3, answeredByDimension: 'property_claim', answeredByPropertyClaim: /wet|flood|dry|high ground|drain/i,
    });
  }
  if (market && !market.subjectBand.available) {
    seeds.push({
      key: 'local_sales', topic: 'Local sales',
      question: 'Do you know of any land nearby that sold recently, and roughly what it went for?',
      why: 'The subject band carries no retained market record; a seller-named sale is a lead for a qualified comparable.',
      basis: market.subjectBand.note,
      priority: 3, answeredByDimension: 'property_claim', answeredByPropertyClaim: /sold|sale|neighbor|went for/i,
    });
  }
  return seeds;
}

function briefFor(
  property: PropertyEvidenceSynthesis | null,
  market: MarketResearchAndPulse | null,
  askingPrice: number | null,
  current: readonly SellerClaim[],
): SellerDiscoverySynthesis['brief'] {
  const questions: DiscoveryQuestion[] = questionSeeds(property, market, askingPrice).map((seed) => {
    const answeredBy = current
      .filter((claim) => claim.dimension === seed.answeredByDimension)
      .filter((claim) => claim.dimension !== 'property_claim' || !seed.answeredByPropertyClaim || seed.answeredByPropertyClaim.test(claim.statement))
      .map((claim) => claim.claimId);
    return {
      key: seed.key, topic: seed.topic, question: seed.question, why: seed.why, basis: seed.basis,
      priority: seed.priority, answeredBy,
    };
  });
  const open = questions.filter((question) => !question.answeredBy.length);
  const openSeller = open.filter((question) => ['motivation', 'price', 'timeline', 'decision_maker'].includes(question.key));
  const objective = !open.length
    ? 'Every prepared question has a retained seller answer; the next conversation confirms commitments and moves to terms.'
    : openSeller.length === 4
      ? 'First conversation: learn why they would sell, what they want, when, and who decides — then ask the property questions the record cannot answer.'
      : `Fill the ${open.length} open question(s) below; ${openSeller.length ? `${openSeller.map((question) => question.topic.toLowerCase()).join(', ')} still ${openSeller.length === 1 ? 'has' : 'have'} no seller answer.` : 'the seller dimensions are answered and the property questions remain.'}`;

  const doNotAssume: string[] = [];
  for (const guard of property?.guardrails ?? []) {
    if (guard.claimKind === 'Fair market value') doNotAssume.push('Do not quote a value or an offer range: no supported fair market value exists yet.');
    if (guard.claimKind === 'Legal access') doNotAssume.push('Do not describe the parcel as having legal access; only a recorded instrument establishes that.');
    if (guard.claimKind === 'Title') doNotAssume.push('Do not assume the seller can convey alone; title has not been examined.');
  }
  doNotAssume.push('Do not present anything the seller says as verified: seller-reported facts are leads for diligence.');
  doNotAssume.push('Do not infer motivation, price or timeline from ownership records, tax status or the property itself.');
  return { objective, questions, doNotAssume };
}

// ── The synthesis ───────────────────────────────────────────────────────────

export interface SellerDiscoveryInput {
  dealCardId: number;
  /** The Acquisitions CRM state: profile, communication log, discovery notes. */
  acquisition: Pick<AcquisitionState, 'stage' | 'profile' | 'commLog' | 'discovery'> | null;
  sellerStatedFacts?: readonly SellerStatedFact[];
  property: PropertyEvidenceSynthesis | null;
  market: MarketResearchAndPulse | null;
  /** The Deal Card's asking price, when one is on file. */
  askingPrice?: number | null;
  /** Contact people on the Deal Card, when the CRM profile is empty. */
  people?: ReadonlyArray<{ name?: string | null; phone?: string | null; email?: string | null }>;
}

const PLANNED_STAGES = new Set(['needs_discovery', 'needs_follow_up', 'discovery_complete', 'ready_for_offer_prep', 'offer_sent']);

/** The seller's current, asserted positions: what the decision may lean on. */
export const currentClaims = (claims: readonly SellerClaim[]): SellerClaim[] =>
  claims.filter((claim) => claim.status === 'current' && claim.polarity === 'asserted');

// ── The one seller read status ──────────────────────────────────────────────
//
//   pending              no qualifying current seller communication has been
//                        analysed into a current seller read
//   preliminary_current  one or more qualifying current communications are
//                        analysed, but the read is incomplete or rests on
//                        seller-reported, conditional or uncertain claims
//
// There is no `current`: this product carries no supported completeness
// threshold, so it never claims one. Deleted, withdrawn, superseded and
// historical claims stay in history and never make the read current.

export type SellerReadStatusKind = 'pending' | 'preliminary_current';

export interface SellerReadStatus {
  status: SellerReadStatusKind;
  label: string;
  basis: string;
  /** The retained communications whose current claims carry the read. */
  communicationIds: string[];
  lastCommunicationAt: string | null;
  currentClaims: number;
  historicalClaims: number;
  /** Why the read is never `Current`. */
  completeness: string;
  caveat: string;
}

export const SELLER_READ_LABEL: Record<SellerReadStatusKind, string> = {
  pending: 'Pending — no qualifying seller communication',
  preliminary_current: 'Preliminary — current',
};

export function sellerReadStatusFor(discovery: SellerDiscoverySynthesis | null): SellerReadStatus {
  const claims = discovery?.claims ?? [];
  const current = currentClaims(claims);
  const historical = claims.filter((claim) => claim.status === 'historical').length;
  const communicationIds = [...new Set(current.map((claim) => claim.source.id).filter((id): id is string => !!id))];
  const lastCommunicationAt = current.map((claim) => claim.source.at).filter((at): at is string => !!at).sort().pop() ?? null;
  const completeness = 'No supported completeness threshold exists for the seller read, so it is never reported as Current.';
  const caveat = 'Every position is seller-reported and not independently verified.';
  if (!discovery || discovery.status !== 'communications_read' || current.length === 0) {
    const retained = discovery?.record.communications ?? 0;
    return {
      status: 'pending',
      label: SELLER_READ_LABEL.pending,
      basis: !discovery || retained === 0
        ? 'No seller conversation, inbound message or discovery note is retained.'
        : discovery.status !== 'communications_read'
          ? `${retained} retained record(s) are operator messages or notes and cannot carry a seller claim.`
          : `${retained} retained communication(s) carry no current seller position${historical ? `; ${historical} earlier statement(s) remain in history` : ''}.`,
      communicationIds: [],
      lastCommunicationAt: null,
      currentClaims: 0,
      historicalClaims: historical,
      completeness,
      caveat,
    };
  }
  const dimensions = SELLER_CLAIM_DIMENSIONS.filter((dimension) => dimension !== 'property_claim' && current.some((claim) => claim.dimension === dimension));
  const qualified = current.filter((claim) => claim.modality !== 'firm' || claim.confidence !== 'high').length;
  return {
    status: 'preliminary_current',
    label: SELLER_READ_LABEL.preliminary_current,
    basis: `${communicationIds.length} qualifying communication(s) analysed; ${current.length} current position(s) across ${dimensions.map((dimension) => SELLER_CLAIM_DIMENSION_LABEL[dimension].toLowerCase()).join(', ') || 'no seller dimension'}${qualified ? `; ${qualified} conditional, uncertain, proposed or operator-recorded` : ''}${historical ? `; ${historical} earlier statement(s) superseded` : ''}.`,
    communicationIds,
    lastCommunicationAt,
    currentClaims: current.length,
    historicalClaims: historical,
    completeness,
    caveat,
  };
}

export function buildSellerDiscovery(input: SellerDiscoveryInput): SellerDiscoverySynthesis {
  const acquisition = input.acquisition;
  const profile = acquisition?.profile ?? {};
  const commLog = [...(acquisition?.commLog ?? [])]
    .filter((entry) => clean(entry.summary) || clean(entry.body) || clean(entry.notes) || entry.keyFacts?.length || entry.commitments?.length || entry.objections?.length)
    .sort((a, b) => (a.at ?? a.createdAt ?? '').localeCompare(b.at ?? b.createdAt ?? ''));
  const discovery = [...(acquisition?.discovery ?? [])]
    .sort((a, b) => (a.capturedAt ?? '').localeCompare(b.capturedAt ?? ''));
  const statedFacts = input.sellerStatedFacts ?? [];

  const contactName = clean(profile.name) ?? clean(input.people?.find((person) => clean(person.name))?.name) ?? null;

  const into = collector();
  const counts = { conversation: 0, sellerMessages: 0, operatorMessages: 0, operatorNotes: 0 };

  for (const entry of commLog) {
    const kind = recordKindFor(entry);
    const ref = refOf(entry, kind);
    const when = ref.at?.slice(0, 10) ?? 'undated';
    if (kind === 'operator_note') {
      counts.operatorNotes += 1;
      into.refusals.push({ record: `Operator note ${when}`, reason: 'Operator-authored; not seller speech, so it carries no seller claim.' });
      continue;
    }
    if (kind === 'operator_message') {
      counts.operatorMessages += 1;
      into.refusals.push({ record: `Outbound ${ref.type} ${when}`, reason: 'The operator\'s own words; a seller claim needs the seller\'s reply.' });
      continue;
    }
    if (kind === 'conversation_record') counts.conversation += 1;
    else counts.sellerMessages += 1;
    claimsFromCommunication(entry, ref, kind, contactName, into);
  }
  discovery.forEach((extraction, index) => claimsFromDiscovery(extraction, index, into));
  claimsFromStatedFacts(statedFacts, into);

  // Oldest first for supersession, then newest first for the reader, so
  // `latest` is the seller's current position rather than their opening one.
  const { claims, conflicts } = finalizeClaims(into.drafts);
  const current = currentClaims(claims);
  const extraction = Object.fromEntries(SELLER_CLAIM_DIMENSIONS.map((dimension) => {
    const own = claims.filter((claim) => claim.dimension === dimension);
    const ownCurrent = current.filter((claim) => claim.dimension === dimension);
    return [dimension, {
      latest: ownCurrent[0] ?? null,
      count: own.length,
      current: ownCurrent.length,
      historical: own.filter((claim) => claim.status === 'historical').length,
    }];
  })) as SellerDiscoverySynthesis['extraction'];
  const unanswered = SELLER_CLAIM_DIMENSIONS.filter((dimension) => dimension !== 'property_claim' && extraction[dimension].current === 0);

  const hasPhone = !!(clean(profile.phone) ?? input.people?.find((person) => clean(person.phone)));
  const hasEmail = !!(clean(profile.email) ?? input.people?.find((person) => clean(person.email)));
  const communications = counts.conversation + counts.sellerMessages + counts.operatorMessages + counts.operatorNotes;
  const contactDates = commLog.map((entry) => entry.at ?? entry.createdAt).filter((at): at is string => !!at).sort();
  const nextFollowUpDate = clean(profile.nextFollowUpDate)
    ?? commLog.map((entry) => entry.followUpDate).filter((date): date is string => !!date).sort().pop()
    ?? null;
  const followUpRequested = commLog.some((entry) => entry.followUpNeeded) || !!nextFollowUpDate;

  const stage = acquisition?.stage ?? null;
  const planned = communications > 0 || discovery.length > 0 || followUpRequested || hasPhone || hasEmail || (stage != null && PLANNED_STAGES.has(stage));
  const planning: SellerDiscoveryPlanning = {
    planned,
    reason: communications > 0 || discovery.length > 0
      ? `${communications + discovery.length} seller communication record(s) are retained; the brief tracks what they left open.`
      : followUpRequested
        ? `A follow-up is scheduled${nextFollowUpDate ? ` for ${nextFollowUpDate}` : ''}; the brief is prepared for it.`
        : hasPhone || hasEmail
          ? 'Seller contact details are retained, so a first conversation can be planned from this brief.'
          : stage != null && PLANNED_STAGES.has(stage)
            ? `The acquisition stage is ${stage.replace(/_/g, ' ')}; the brief is prepared for the next contact.`
            : 'No seller contact, communication or follow-up is retained yet. The brief is prepared ahead of first contact and costs nothing to hold.',
    signals: { stage, nextFollowUpDate, followUpRequested, contactRetained: hasPhone || hasEmail, communicationsRetained: communications },
  };

  const operatorProfileNotes: SellerDiscoverySynthesis['operatorProfileNotes'] = [];
  for (const field of ['motivation', 'timeline', 'askingPrice', 'priceFlexibility', 'decisionMakers', 'relationshipToProperty', 'personalityNotes', 'communicationStyle'] as const) {
    const value = clean(profile[field]);
    if (value) operatorProfileNotes.push({ field, value: bound(value) });
  }
  for (const field of ['objections', 'concerns', 'commitments', 'unknowns'] as const) {
    for (const value of profile[field] ?? []) {
      const text = clean(value);
      if (text) operatorProfileNotes.push({ field, value: bound(text) });
    }
  }

  const status: SellerDiscoverySynthesis['status'] = counts.conversation + counts.sellerMessages + discovery.length > 0
    ? 'communications_read'
    : 'no_communications';

  const limitations: string[] = [];
  if (status === 'no_communications') {
    limitations.push('No seller conversation, inbound message or discovery note is retained, so no seller claim exists. Nothing about the seller is inferred from the property or its records.');
  }
  if (operatorProfileNotes.length) {
    limitations.push(`${operatorProfileNotes.length} CRM profile note(s) are shown as operator notes; they are not tied to a retained communication and carry no claim weight.`);
  }
  if (statedFacts.length) {
    limitations.push(`${statedFacts.length} seller-stated fact row(s) are carried at the Likely weight: recorded after discovery by the operator, not verbatim communications.`);
  }
  if (claims.some((claim) => claim.method === 'text_match')) {
    limitations.push('Text-matched claims are sentences found in the retained record and classified by pattern; read the source communication before relying on one.');
  }
  if (claims.some((claim) => claim.speaker.role === 'operator_record')) {
    limitations.push("Claims read from the operator's own summary are the operator's record of seller speech, not the seller's words, and carry lower confidence.");
  }
  if (claims.some((claim) => claim.modality !== 'firm')) {
    limitations.push('Conditional, uncertain or merely proposed statements are carried as such; none is treated as a firm seller position.');
  }
  if (conflicts.length) {
    limitations.push(`${conflicts.length} seller position(s) moved across communications; the earlier statement is kept as history and the later one governs.`);
  }
  if (claims.some((claim) => claim.dimension === 'property_claim')) {
    limitations.push('Seller-reported property facts are leads for diligence and never change the Property Story; only a retained record establishes a property fact.');
  }
  limitations.push(...(input.property ? [] : ['No Property Story is retained, so the brief carries only the seller questions; property questions are added when research settles.']));

  const brief = briefFor(input.property, input.market, input.askingPrice ?? null, current);

  const fingerprint = sha256(JSON.stringify({
    claims: claims.map((claim) => [claim.dimension, claim.excerpt, claim.value, claim.polarity, claim.modality, claim.status, claim.speaker.role, claim.source.id, claim.source.at]),
    record: [communications, discovery.length, statedFacts.length, stage, nextFollowUpDate],
    property: input.property?.inputFingerprint ?? null,
    market: input.market?.inputFingerprint ?? null,
    askingPrice: input.askingPrice ?? null,
  }));

  return {
    contractVersion: SELLER_DISCOVERY_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: null,
    inputFingerprint: fingerprint,
    status,
    planning,
    record: {
      communications,
      conversationRecords: counts.conversation,
      sellerMessages: counts.sellerMessages,
      operatorMessages: counts.operatorMessages,
      operatorNotes: counts.operatorNotes,
      discoveryExtractions: discovery.length,
      sellerStatedFacts: statedFacts.length,
      firstContactAt: contactDates[0] ?? null,
      lastContactAt: contactDates[contactDates.length - 1] ?? null,
      nextFollowUpDate,
      stage,
      contact: { name: contactName, hasPhone, hasEmail },
    },
    brief,
    claims,
    extraction,
    conflicts,
    unanswered,
    operatorProfileNotes,
    refusals: into.refusals,
    limitations: limitations.map(sentence),
  };
}
