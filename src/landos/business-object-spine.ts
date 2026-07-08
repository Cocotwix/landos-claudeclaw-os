// LandOS — Business Object Spine v1 (projection-first).
//
// Core product correction: LandOS is built around canonical BUSINESS OBJECTS,
// not agents, reports, provider workflows, or Deal Card worksheets. The Deal
// Card is the operator workspace and rendering layer. The canonical objects own
// the intelligence.
//
// v1 is a PROJECTION layer, not new storage: it assembles the five canonical
// objects by reading the already-persisted tables (deal card + linked property
// cards + DD worksheet + card source evidence + seller-stated facts) and OWNS
// the business logic on top of them:
//   - decision-grade determination (honest: missing owner / APN / acreage /
//     parcel identity / source evidence => NOT decision-grade),
//   - parcel completeness scoring,
//   - missing critical info,
//   - VerificationTask generation (gaps become owned next actions),
//   - the Jarvis/Neo executive query ("what blocks this deal, and who owns the
//     next action?").
//
// It adds no tables and no migrations. It never fabricates parcel identity,
// never uses nearest-parcel / proximity logic for subject identity, never treats
// county links as parcel facts, and never buries unknowns. No network, no .env,
// no secrets, no paid provider calls.
//
// The pure core (computePropertyIntelligence / generateVerificationTasks /
// buildOpportunity...) is DB-free and unit-testable. assembleBusinessObjects()
// is the thin DB adapter that reads persisted truth and calls the core.

import { getLandosDb } from './db.js';
import { getDealCard, type DealCardDetail } from './deal-card.js';
import { getDealCardDd, type DealCardDdView } from './deal-card-dd.js';
import { loadSellerStatedFacts } from './seller-stated-facts.js';
import { classifySource, type SourceType } from './source-evidence.js';
import { readParcelIdentity, confirmParcel, type ParcelState, type ConfirmedParcel } from './parcel-identity.js';

// ─────────────────────────────────────────────────────────────────────────
// Shared labels
// ─────────────────────────────────────────────────────────────────────────

/** Fact confidence label. Mirrors FACT_LABELS (db.ts) plus an explicit
 *  'Not checked' for a field that has never been looked at (projection only;
 *  never persisted). */
export type SpineFactLabel =
  | 'Verified'
  | 'Seller stated'
  | 'Assumed'
  | 'Unknown'
  | 'Needs verification'
  | 'Conflicting'
  | 'Not checked';

/** Where a fact came from and how reliable it is (official/public/vendor/
 *  browser/manual per the sprint contract). */
export type EvidenceClassification = 'official' | 'public' | 'vendor' | 'browser' | 'manual';
export type Reliability = 'high' | 'medium' | 'low';

/** One known-or-missing fact slot on the property intelligence packet. */
export interface FactSlot {
  field: string;
  value: string | number | null;
  known: boolean;
  label: SpineFactLabel;
  /** True only when the value is source-verified (not merely present). */
  verified: boolean;
  /** Short references to the evidence supporting this fact (may be empty). */
  evidenceRefs: string[];
}

/** Accurate state of a critical fact for the "What's blocking this deal?" view.
 *  - confirmed:      source-verified OR backed by subject-scoped core evidence.
 *  - needs_evidence: the value is ON RECORD but lacks official confirmation
 *                    (LandOS HAS it — do NOT call it missing; call it unconfirmed).
 *  - absent:         genuinely not found anywhere. */
export type CriticalFactState = 'confirmed' | 'needs_evidence' | 'absent';

/** One critical fact with its true state — the honest blocker representation. */
export interface CriticalFactStatus {
  /** Stable key: 'parcelIdentity' | 'owner' | 'apn' | 'acreage' | 'coreEvidence'. */
  key: string;
  /** Operator-facing label, e.g. "Owner". */
  label: string;
  state: CriticalFactState;
  /** The on-record value when known (never fabricated). */
  value?: string;
  /** Precise operator-facing explanation of the state. */
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. SourceEvidence
// ─────────────────────────────────────────────────────────────────────────

export interface SourceEvidenceRecord {
  sourceId: string;
  sourceType: SourceType;
  classification: EvidenceClassification;
  sourceName: string;
  sourceUrlOrRef: string;
  retrievedAt: string;
  factsSupported: string[];
  reliability: Reliability;
  usableForOfferLogic: boolean;
  /** The property card this evidence is attached to, when it can be confidently
   *  associated with a specific parcel. Deal-level evidence (e.g. a DD worksheet
   *  link) leaves this undefined and never satisfies a subject packet's gate. */
  cardId?: number;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. VerificationTask
// ─────────────────────────────────────────────────────────────────────────

export type TaskCriticality = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in_progress' | 'resolved';

export interface VerificationTask {
  taskId: string;
  dealId: number;
  linkedObjectId: string;
  criticality: TaskCriticality;
  question: string;
  reason: string;
  recommendedSource: string;
  ownerDepartment: string;
  status: TaskStatus;
  blocking: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. PropertyIntelligencePacket
// ─────────────────────────────────────────────────────────────────────────

export interface PropertyIntelligencePacket {
  dealId: number;
  subjectCardId: number | null;
  parcelIdentityStatus: string;
  parcelIdentityVerified: boolean;
  /** 0..100 completeness of the core parcel facts. */
  parcelCompletenessScore: number;
  owner: FactSlot;
  apn: FactSlot;
  county: FactSlot;
  state: FactSlot;
  location: FactSlot;
  acreage: FactSlot;
  coordinates: { lat: number; lng: number } | null;
  propertyType: FactSlot;
  access: FactSlot;
  zoning: FactSlot;
  taxAssessor: FactSlot;
  sourceEvidence: SourceEvidenceRecord[];
  missingCriticalInfo: string[];
  /** The accurate blocker view: every critical fact with its true state
   *  (confirmed / on-record-but-unconfirmed / absent). Drives the UI so a known
   *  fact never renders as missing. */
  criticalFacts: CriticalFactStatus[];
  verificationTasks: VerificationTask[];
  decisionGrade: boolean;
  decisionGradeReason: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. LeadIntakeRecord
// ─────────────────────────────────────────────────────────────────────────

export interface LeadIntakeRecord {
  leadId: number;
  dealId: number;
  entity: string;
  source: string;
  rawInput: string;
  provided: {
    address?: string;
    apn?: string;
    owner?: string;
    county?: string;
    state?: string;
    acreage?: number | null;
  };
  sellerStatedFacts: Array<{ kind: string; value: string }>;
  intakeConfidence: 'high' | 'medium' | 'low';
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Opportunity / Deal Record
// ─────────────────────────────────────────────────────────────────────────

export type DecisionConfidence = 'high' | 'medium' | 'low' | 'blocked';

export interface OpportunityRecord {
  dealId: number;
  entity: string;
  title: string;
  stage: string;
  status: string;
  leadIntakeId: number;
  propertyIntelligenceId: number;
  sellerProfilePresent: boolean;
  marketPacketPresent: boolean;
  strategyAssessmentPresent: boolean;
  offerRecordPresent: boolean;
  decisionConfidence: DecisionConfidence;
  decisionGrade: boolean;
  criticalBlockers: string[];
  nextBestAction: string;
  nextActionOwner: string;
  activityTimelineRefs: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// The assembled bundle + the Deal Card header projection
// ─────────────────────────────────────────────────────────────────────────

export interface DealCardHeader {
  stage: string;
  parcelCompleteness: number;
  decisionConfidence: DecisionConfidence;
  decisionGrade: boolean;
  decisionGradeReason: string;
  missingCriticalInfo: string[];
  /** Accurate per-fact blocker states (confirmed / needs_evidence / absent). */
  criticalFacts: CriticalFactStatus[];
  blockingVerificationTasks: VerificationTask[];
  nextBestAction: string;
  nextActionOwner: string;
}

export interface BusinessObjectBundle {
  dealId: number;
  leadIntake: LeadIntakeRecord;
  opportunity: OpportunityRecord;
  propertyIntelligence: PropertyIntelligencePacket;
  sourceEvidence: SourceEvidenceRecord[];
  verificationTasks: VerificationTask[];
  header: DealCardHeader;
  /** The capability token when the subject parcel is confirmed (authoritative:
   *  stored verdict, else the verified-property card fallback), else null. The
   *  packet is the authority on confirmation, so it is where downstream
   *  departments obtain their ConfirmedParcel. */
  confirmedParcel: ConfirmedParcel | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure core — decision-grade, completeness, verification tasks
// ─────────────────────────────────────────────────────────────────────────

const DD = 'due-diligence-research';
const STRATEGY = 'strategy';

/** The normalized, DB-free input the pure core reasons over. */
export interface PropertyIntelInput {
  dealId: number;
  subjectCardId: number | null;
  parcelIdentityStatus: string;
  parcelIdentityVerified: boolean;
  owner: FactSlot;
  apn: FactSlot;
  county: FactSlot;
  state: FactSlot;
  location: FactSlot;
  acreage: FactSlot;
  coordinates: { lat: number; lng: number } | null;
  propertyType: FactSlot;
  access: FactSlot;
  zoning: FactSlot;
  taxAssessor: FactSlot;
  sourceEvidence: SourceEvidenceRecord[];
  /** DD worksheet data gaps (already captured by the operator). */
  dataGaps: string[];
  now?: number;
}

/** True when at least one attached evidence record is offer-usable (real source
 *  link + verified parcel per the Source Evidence Standard). Deal-level utility;
 *  NOT the decision-grade gate — that requires subject-scoped core evidence. */
export function hasUsableSourceEvidence(evidence: SourceEvidenceRecord[]): boolean {
  return evidence.some((e) => e.usableForOfferLogic);
}

// A "core parcel fact" is owner, APN, acreage, or parcel identity itself.
// Evidence about zoning, flood, wetlands, utilities, access, or the market is
// NOT core parcel evidence and can never satisfy the decision-grade gate.
const CORE_PARCEL_FACT_RE =
  /\bowner\b|ownership|\bapn\b|parcel|\bacre|acreage|\bdeed\b|assessor|\bplat\b|legal\s+description|\btitle\b|\bfips\b|landportal|lp[_\s]?propert/i;
const OWNER_RE = /\bowner\b|ownership/i;
const APN_RE = /\bapn\b|parcel/i;
const ACRE_RE = /\bacre|acreage/i;

function evidenceText(e: SourceEvidenceRecord): string {
  return `${e.factsSupported.join(' ')} ${e.sourceName}`;
}

/** Whether an evidence record supports a CORE parcel fact (owner/APN/acreage/
 *  parcel identity) — not zoning/flood/market/etc. */
export function evidenceSupportsCoreParcelFact(e: SourceEvidenceRecord): boolean {
  return CORE_PARCEL_FACT_RE.test(evidenceText(e));
}

/**
 * The offer-usable evidence that may satisfy the SUBJECT packet's decision-grade
 * gate: it must be (a) offer-usable, (b) confidently associated with the subject
 * property card, and (c) about a core parcel fact. Evidence from another parcel,
 * deal-level evidence with no card association, or non-core evidence is excluded
 * (it stays visible as general deal evidence but never satisfies the gate).
 */
export function subjectCoreParcelEvidence(input: PropertyIntelInput): SourceEvidenceRecord[] {
  const subjectId = input.subjectCardId;
  if (subjectId == null) return [];
  return input.sourceEvidence.filter(
    (e) => e.usableForOfferLogic && e.cardId === subjectId && evidenceSupportsCoreParcelFact(e),
  );
}

/** A core fact is satisfied when it is source-verified on the record OR backed by
 *  subject-scoped core parcel evidence naming it. Present-but-unverified with no
 *  supporting evidence does NOT satisfy it. */
function coreFactSupported(slot: FactSlot, re: RegExp, subjectCore: SourceEvidenceRecord[]): boolean {
  if (!slot.known) return false;
  if (slot.verified) return true;
  return subjectCore.some((e) => re.test(evidenceText(e)));
}

/**
 * The five critical facts a land acquisition decision depends on. Missing any of
 * these means the packet is NOT decision-grade. Parcel identity must be VERIFIED
 * (source-backed), never assumed from coordinates/proximity/nearest parcel.
 * Owner/APN/acreage must be verified or backed by subject-scoped core parcel
 * evidence — present-but-unverified values do NOT pass. The evidence gate itself
 * requires subject-scoped evidence about core parcel facts.
 */
export function computeMissingCriticalInfo(input: PropertyIntelInput): string[] {
  const subjectCore = subjectCoreParcelEvidence(input);
  const missing: string[] = [];
  if (!input.parcelIdentityVerified) missing.push('Verified parcel identity');
  if (!coreFactSupported(input.owner, OWNER_RE, subjectCore)) missing.push('Owner');
  if (!coreFactSupported(input.apn, APN_RE, subjectCore)) missing.push('APN / parcel number');
  if (!coreFactSupported(input.acreage, ACRE_RE, subjectCore)) missing.push('Acreage');
  if (subjectCore.length === 0) missing.push('Source evidence for core parcel facts');
  return missing;
}

/**
 * The HONEST blocker view. For each critical fact returns its true state:
 * confirmed (verified / evidence-backed), needs_evidence (on record but not
 * officially confirmed — LandOS HAS it, so it is NOT "missing"), or absent (not
 * found anywhere). This is what the "What's blocking this deal?" section renders,
 * so a known owner/APN/acreage never reads as missing when LandOS already holds
 * it; it reads as needing official confirmation. `missingCriticalInfo` remains the
 * strict decision-grade gate; this is the accurate operator-facing narration.
 */
export function computeCriticalFacts(input: PropertyIntelInput): CriticalFactStatus[] {
  const subjectCore = subjectCoreParcelEvidence(input);
  const slotValue = (slot: FactSlot): string | undefined =>
    slot.known && slot.value != null && String(slot.value).trim() !== '' ? String(slot.value) : undefined;

  const factRow = (
    key: string, label: string, slot: FactSlot, re: RegExp,
  ): CriticalFactStatus => {
    const value = slotValue(slot);
    if (coreFactSupported(slot, re, subjectCore)) {
      return { key, label, state: 'confirmed', value, detail: `${label} confirmed from source evidence.` };
    }
    if (slot.known) {
      return {
        key, label, state: 'needs_evidence', value,
        detail: `${label} on record${value ? ` (${value})` : ''} but not yet officially confirmed. Needs official evidence (assessor / recorder / LandPortal parcel panel).`,
      };
    }
    return { key, label, state: 'absent', detail: `${label} not found. Locate it from official records.` };
  };

  const facts: CriticalFactStatus[] = [];
  facts.push(
    input.parcelIdentityVerified
      ? { key: 'parcelIdentity', label: 'Verified parcel identity', state: 'confirmed', detail: 'Parcel identity confirmed by a parcel-level source.' }
      : (input.apn.known || input.location.known
        ? { key: 'parcelIdentity', label: 'Verified parcel identity', state: 'needs_evidence', detail: 'A candidate parcel is on record but identity is not confirmed. Confirm the exact parcel on a parcel-level source before downstream intelligence runs.' }
        : { key: 'parcelIdentity', label: 'Verified parcel identity', state: 'absent', detail: 'No parcel identity yet. Provide an APN + county or a resolvable address.' }),
  );
  facts.push(factRow('owner', 'Owner', input.owner, OWNER_RE));
  facts.push(factRow('apn', 'APN / parcel number', input.apn, APN_RE));
  facts.push(factRow('acreage', 'Acreage', input.acreage, ACRE_RE));
  facts.push(
    subjectCore.length > 0
      ? { key: 'coreEvidence', label: 'Source evidence for core parcel facts', state: 'confirmed', detail: `${subjectCore.length} offer-usable source evidence record(s) attached to this parcel.` }
      : { key: 'coreEvidence', label: 'Source evidence for core parcel facts', state: 'absent', detail: 'No offer-usable core parcel evidence attached to this parcel yet.' },
  );
  return facts;
}

/**
 * Parcel completeness score (0..100). Weighted: verified identity and subject-
 * scoped core parcel evidence count double (they are the spine of a real
 * decision); owner, APN, acreage, county, state, and location each count once.
 */
export function computeParcelCompleteness(input: PropertyIntelInput): number {
  const identity = input.parcelIdentityVerified ? 2 : 0;
  const evidence = subjectCoreParcelEvidence(input).length > 0 ? 2 : 0;
  const singles = [
    input.owner.known,
    input.apn.known,
    input.acreage.known,
    input.county.known,
    input.state.known,
    input.location.known,
  ].filter(Boolean).length;
  const total = 10; // 2 + 2 + 6
  return Math.round(((identity + evidence + singles) / total) * 100);
}

/**
 * Decision-grade determination. A packet is decision-grade ONLY when parcel
 * identity is verified AND owner + APN + acreage are known AND at least one
 * offer-usable source evidence record exists. Otherwise it is explicitly NOT
 * decision-grade with a reason that names every missing critical fact.
 */
export function computeDecisionGrade(input: PropertyIntelInput): { decisionGrade: boolean; reason: string } {
  const missing = computeMissingCriticalInfo(input);
  if (missing.length === 0) {
    return {
      decisionGrade: true,
      reason: 'Decision-grade: parcel identity is verified and owner, APN, and acreage are known with offer-usable source evidence.',
    };
  }
  return {
    decisionGrade: false,
    reason: `Not decision-grade — missing critical facts: ${missing.join(', ')}. Do not score, value, or make offer guidance until these are established from official evidence.`,
  };
}

/** Deterministic per-gap task descriptor. */
interface CriticalGapSpec {
  key: string;
  criticality: TaskCriticality;
  question: string;
  reason: string;
  recommendedSource: string;
  ownerDepartment: string;
}

const CRITICAL_GAP_SPECS: Record<string, CriticalGapSpec> = {
  'Verified parcel identity': {
    key: 'parcel_identity',
    criticality: 'critical',
    question: 'Verify the subject parcel identity from an official record (APN + county/FIPS or LandPortal property id). Do NOT use coordinates, proximity, or nearest parcel.',
    reason: 'Nothing (owner, acreage, value, offer) is trustworthy until the exact subject parcel is confirmed.',
    recommendedSource: 'County assessor / GIS parcel record, recorded deed, or LandPortal resolve',
    ownerDepartment: DD,
  },
  Owner: {
    key: 'owner',
    criticality: 'critical',
    question: 'Confirm the record owner of the subject parcel.',
    reason: 'Signing authority and outreach depend on the true record owner, not the lead contact.',
    recommendedSource: 'County assessor / official ownership record',
    ownerDepartment: DD,
  },
  'APN / parcel number': {
    key: 'apn',
    criticality: 'critical',
    question: "Establish the parcel's APN / parcel number.",
    reason: 'The APN is the parcel identity key for every downstream record and comp.',
    recommendedSource: 'County assessor / GIS parcel viewer',
    ownerDepartment: DD,
  },
  Acreage: {
    key: 'acreage',
    criticality: 'critical',
    question: 'Confirm the parcel acreage from an official source.',
    reason: 'Acreage drives valuation, strategy fit, and price-per-acre; seller-stated acreage is not enough.',
    recommendedSource: 'County assessor / recorded plat or deed',
    ownerDepartment: DD,
  },
  'Source evidence for core parcel facts': {
    key: 'source_evidence',
    criticality: 'high',
    question: 'Attach offer-usable source evidence (official record link) for the core parcel facts.',
    reason: 'A fact with no source link is not verified and cannot be used for offer logic.',
    recommendedSource: 'County assessor / official record (link required)',
    ownerDepartment: DD,
  },
};

/**
 * Turn the missing critical facts and DD data gaps into owned VerificationTasks.
 * Critical-fact tasks are blocking; DD data gaps become medium, non-blocking DD
 * tasks. Task ids are deterministic so re-projection is idempotent.
 */
export function generateVerificationTasks(input: PropertyIntelInput): VerificationTask[] {
  const now = input.now ?? Date.now();
  const linkedObjectId = `property_intelligence:${input.dealId}`;
  const tasks: VerificationTask[] = [];

  for (const missing of computeMissingCriticalInfo(input)) {
    const spec = CRITICAL_GAP_SPECS[missing];
    if (!spec) continue;
    tasks.push({
      taskId: `vt-${input.dealId}-${spec.key}`,
      dealId: input.dealId,
      linkedObjectId,
      criticality: spec.criticality,
      question: spec.question,
      reason: spec.reason,
      recommendedSource: spec.recommendedSource,
      ownerDepartment: spec.ownerDepartment,
      status: 'open',
      blocking: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // DD-captured data gaps become owned, non-blocking follow-ups (deduped).
  const seen = new Set<string>();
  let i = 0;
  for (const gap of input.dataGaps) {
    const g = (gap ?? '').trim();
    if (!g) continue;
    const norm = g.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    tasks.push({
      taskId: `vt-${input.dealId}-gap${i++}`,
      dealId: input.dealId,
      linkedObjectId,
      criticality: 'medium',
      question: `Resolve data gap: ${g}`,
      reason: 'Operator-flagged gap in the DD worksheet.',
      recommendedSource: 'Due Diligence research',
      ownerDepartment: DD,
      status: 'open',
      blocking: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  return tasks;
}

/** Assemble the pure PropertyIntelligencePacket from the normalized input. */
export function computePropertyIntelligence(input: PropertyIntelInput): PropertyIntelligencePacket {
  const missingCriticalInfo = computeMissingCriticalInfo(input);
  const { decisionGrade, reason } = computeDecisionGrade(input);
  const verificationTasks = generateVerificationTasks(input);
  return {
    dealId: input.dealId,
    subjectCardId: input.subjectCardId,
    parcelIdentityStatus: input.parcelIdentityStatus,
    parcelIdentityVerified: input.parcelIdentityVerified,
    parcelCompletenessScore: computeParcelCompleteness(input),
    owner: input.owner,
    apn: input.apn,
    county: input.county,
    state: input.state,
    location: input.location,
    acreage: input.acreage,
    coordinates: input.coordinates,
    propertyType: input.propertyType,
    access: input.access,
    zoning: input.zoning,
    taxAssessor: input.taxAssessor,
    sourceEvidence: input.sourceEvidence,
    missingCriticalInfo,
    criticalFacts: computeCriticalFacts(input),
    verificationTasks,
    decisionGrade,
    decisionGradeReason: reason,
  };
}

/** Pick the single next-best action + its owning department from the packet. */
export function computeNextBestAction(
  packet: PropertyIntelligencePacket,
): { action: string; owner: string } {
  const blocking = packet.verificationTasks
    .filter((t) => t.blocking)
    .sort((a, b) => criticalityRank(b.criticality) - criticalityRank(a.criticality));
  if (blocking.length > 0) {
    return { action: blocking[0].question, owner: blocking[0].ownerDepartment };
  }
  if (packet.decisionGrade) {
    return {
      action: 'Advance to strategy assessment and underwriting / offer prep.',
      owner: STRATEGY,
    };
  }
  const anyTask = packet.verificationTasks[0];
  if (anyTask) return { action: anyTask.question, owner: anyTask.ownerDepartment };
  return { action: 'Continue due diligence.', owner: DD };
}

function criticalityRank(c: TaskCriticality): number {
  return c === 'critical' ? 3 : c === 'high' ? 2 : c === 'medium' ? 1 : 0;
}

/** Decision confidence for the opportunity, derived from the packet. */
export function computeDecisionConfidence(packet: PropertyIntelligencePacket): DecisionConfidence {
  if (!packet.parcelIdentityVerified) return 'blocked';
  if (packet.decisionGrade) return 'high';
  return 'medium';
}

// ─────────────────────────────────────────────────────────────────────────
// Slot + evidence helpers (used by the DB assembly, but pure)
// ─────────────────────────────────────────────────────────────────────────

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return String(v).trim() !== '';
}

/** Build a fact slot. When there is no value the slot is 'Not checked' and
 *  known=false; a present-but-unverified value defaults to 'Needs verification'
 *  unless an explicit label is supplied. */
export function makeSlot(
  field: string,
  value: string | number | null,
  opts: { verified?: boolean; label?: SpineFactLabel; evidenceRefs?: string[] } = {},
): FactSlot {
  const known = isPresent(value);
  const verified = !!opts.verified && known;
  let label: SpineFactLabel;
  if (opts.label) label = opts.label;
  else if (!known) label = 'Not checked';
  else if (verified) label = 'Verified';
  else label = 'Needs verification';
  return {
    field,
    value: known ? value : null,
    known,
    label,
    verified,
    evidenceRefs: opts.evidenceRefs ?? [],
  };
}

/** Map a classified source type into the official/public/vendor/browser/manual
 *  provenance bucket + a reliability level. */
export function evidenceProvenance(
  sourceType: SourceType,
  hasUrl: boolean,
): { classification: EvidenceClassification; reliability: Reliability } {
  if (!hasUrl) return { classification: 'manual', reliability: 'low' };
  switch (sourceType) {
    case 'official':
      return { classification: 'official', reliability: 'high' };
    case 'landportal':
      return { classification: 'vendor', reliability: 'high' };
    case 'marketplace':
      return { classification: 'public', reliability: 'low' };
    case 'local_context':
      return { classification: 'browser', reliability: 'low' };
    default:
      return { classification: 'manual', reliability: 'low' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DB assembly — the thin adapter over persisted truth
// ─────────────────────────────────────────────────────────────────────────

interface CardEvidenceRow {
  id: number;
  card_id: number;
  fact: string;
  source_type: string;
  source_url: string;
  date_accessed: string;
  note: string;
  usable_for_offer_logic: number;
}

const SOURCE_TYPES: readonly SourceType[] = ['official', 'landportal', 'marketplace', 'local_context', 'unknown'];
function asSourceType(v: string): SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(v) ? (v as SourceType) : 'unknown';
}

/** Read the source evidence attached to a set of property cards, projected into
 *  canonical SourceEvidenceRecords. */
function readCardEvidence(cardIds: number[]): SourceEvidenceRecord[] {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => '?').join(',');
  const rows = getLandosDb()
    .prepare(
      `SELECT id, card_id, fact, source_type, source_url, date_accessed, note, usable_for_offer_logic
       FROM landos_card_source_evidence WHERE card_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
    )
    .all(...cardIds) as CardEvidenceRow[];
  return rows.map((r) => {
    const st = asSourceType(r.source_type);
    const hasUrl = isPresent(r.source_url);
    const { classification, reliability } = evidenceProvenance(st, hasUrl);
    return {
      sourceId: `card${r.card_id}-ev${r.id}`,
      sourceType: st,
      classification,
      sourceName: r.fact || classification,
      sourceUrlOrRef: r.source_url || '',
      retrievedAt: r.date_accessed || '',
      factsSupported: r.fact ? [r.fact] : [],
      reliability,
      usableForOfferLogic: r.usable_for_offer_logic === 1,
      cardId: r.card_id,
      note: r.note || '',
    };
  });
}

/** DD worksheet source links projected into canonical SourceEvidenceRecords.
 *  Manual worksheet links are not offer-usable on their own. */
function ddEvidence(dd: DealCardDdView, dealId: number): SourceEvidenceRecord[] {
  return dd.sourceLinks.map((l, i) => {
    const st = classifySource({ url: l.url, label: l.label });
    const { classification, reliability } = evidenceProvenance(st, isPresent(l.url));
    return {
      sourceId: `dd${dealId}-link${i}`,
      sourceType: st,
      classification,
      sourceName: l.label || 'DD source link',
      sourceUrlOrRef: l.url,
      retrievedAt: '',
      factsSupported: [],
      reliability,
      usableForOfferLogic: false,
      note: 'DD worksheet source link (manual).',
    };
  });
}

type LinkedCard = Record<string, unknown> & {
  id: number;
  role?: string;
  verification_status?: string;
  owner?: string;
  apn?: string;
  acres?: number | null;
  county?: string;
  state?: string;
  city?: string;
  active_input_address?: string;
  lp_property_id?: string;
  fips?: string;
  verification_source?: string;
  lat?: number | null;
  lng?: number | null;
};

/** Pick the primary subject card: first role='subject', else first linked. */
function pickSubject(cards: LinkedCard[]): LinkedCard | undefined {
  return cards.find((c) => c.role === 'subject') ?? cards[0];
}

/**
 * The AUTHORITATIVE parcel-identity verdict for the spine. The stored
 * ParcelIdentity state (written once by Property Resolution) is the single source
 * of truth: `confirmed` => identity verified. When no verdict has been stored yet
 * (a Deal Card created outside the acquire pipeline, or one predating the
 * parcel_identity table), fall back to the subject card's own `verified_property`
 * flag — the strong signal the acquire route itself sets on confirmation. There is
 * NO second identity derivation: the old ddStrongIdentity "DD source_verified +
 * link" path is gone (it was the "any source link" trap this redesign removes).
 */
export function resolveParcelIdentityVerified(
  subject: LinkedCard | undefined,
  stored: { state: ParcelState } | null,
): boolean {
  if (stored) return stored.state === 'confirmed';
  return subject?.verification_status === 'verified_property';
}

/** Build the normalized PropertyIntelInput from persisted Deal Card data. The
 *  authoritative `parcelIdentityVerified` is supplied by the caller (stored
 *  verdict, else the legacy card-flag fallback); field-level `Verified` flags
 *  still require the subject card's own verified_property record. */
function buildIntelInput(
  dealId: number,
  subject: LinkedCard | undefined,
  dd: DealCardDdView,
  evidence: SourceEvidenceRecord[],
  parcelIdentityVerified: boolean,
  now?: number,
): PropertyIntelInput {
  const cardVerified = subject?.verification_status === 'verified_property';
  const vsrc = isPresent(subject?.verification_source);

  // Owner comes only from the (subject) property card. Verified only when the
  // card is a verified_property with a verification source.
  const owner = makeSlot('owner', subject?.owner ?? null, {
    verified: cardVerified && vsrc,
  });

  // APN, acreage, county, state prefer the DD worksheet (guardrailed labels)
  // and fall back to the subject card. APN/acreage are 'verified' only from a
  // verified subject parcel record or a DD field explicitly labeled Verified
  // (which itself requires a named source link) — never merely because a value
  // is present alongside a verified identity.
  const apnValue = isPresent(dd.apn) ? dd.apn : subject?.apn ?? null;
  const apn = makeSlot('apn', apnValue, {
    verified: isPresent(apnValue) && (cardVerified || dd.apnLabel === 'Verified'),
    label: isPresent(dd.apn) ? asSpineLabel(dd.apnLabel) : undefined,
  });

  const acreValue = dd.acreage !== null && dd.acreage !== undefined ? dd.acreage : subject?.acres ?? null;
  const acreage = makeSlot('acreage', acreValue, {
    verified: isPresent(acreValue) && (cardVerified || dd.acreageLabel === 'Verified'),
    label: dd.acreage !== null && dd.acreage !== undefined ? asSpineLabel(dd.acreageLabel) : undefined,
  });

  const countyValue = isPresent(dd.county) ? dd.county : subject?.county ?? null;
  const stateValue = isPresent(dd.state) ? dd.state : subject?.state ?? null;
  const county = makeSlot('county', countyValue, { verified: parcelIdentityVerified && isPresent(countyValue) });
  const state = makeSlot('state', stateValue, { verified: parcelIdentityVerified && isPresent(stateValue) });

  // Location / address is the as-received input on an unverified lead.
  const locValue = subject?.active_input_address
    ?? [subject?.city, countyValue, stateValue].filter(isPresent).join(', ')
    ?? null;
  const location = makeSlot('location', locValue || null, {
    verified: cardVerified && isPresent(locValue),
    label: !isPresent(locValue) ? 'Not checked' : cardVerified ? 'Verified' : 'Seller stated',
  });

  const coordinates =
    cardVerified && typeof subject?.lat === 'number' && typeof subject?.lng === 'number'
      ? { lat: subject.lat, lng: subject.lng }
      : null;

  const zoning = makeSlot('zoning', isPresent(dd.zoning) ? dd.zoning : null, {
    label: isPresent(dd.zoning) ? asSpineLabel(dd.zoningLabel) : undefined,
  });
  const access = makeSlot('access', isPresent(dd.accessStatus) ? dd.accessStatus : null, {
    label: isPresent(dd.accessStatus) ? asSpineLabel(dd.accessLabel) : undefined,
  });
  const propertyType = makeSlot('propertyType', null); // not tracked yet -> Not checked
  const taxAssessor = makeSlot('taxAssessor', null);

  return {
    dealId,
    subjectCardId: subject?.id ?? null,
    parcelIdentityStatus: parcelIdentityVerified
      ? 'source_verified'
      : dd.parcelIdentityStatus || 'local_area_context_not_verified',
    parcelIdentityVerified,
    owner,
    apn,
    county,
    state,
    location,
    acreage,
    coordinates,
    propertyType,
    access,
    zoning,
    taxAssessor,
    sourceEvidence: evidence,
    dataGaps: dd.dataGaps,
    now,
  };
}

/** Map a DD/card field label into a spine label (they share vocabulary; the DD
 *  'Local Area Context...' label folds to 'Needs verification'). */
function asSpineLabel(label: string): SpineFactLabel {
  switch (label) {
    case 'Verified':
    case 'Seller stated':
    case 'Assumed':
    case 'Unknown':
    case 'Needs verification':
    case 'Conflicting':
      return label as SpineFactLabel;
    default:
      return 'Needs verification';
  }
}

function intakeConfidence(provided: LeadIntakeRecord['provided']): 'high' | 'medium' | 'low' {
  const strong = [provided.apn, provided.owner].filter(isPresent).length;
  const some = [provided.address, provided.county, provided.state, provided.acreage].filter(isPresent).length;
  if (strong >= 1 && some >= 1) return 'high';
  if (some >= 2) return 'medium';
  return 'low';
}

/** Build the LeadIntakeRecord projection from the deal + subject card. */
function buildLeadIntake(deal: DealCardDetail, subject: LinkedCard | undefined, dealId: number): LeadIntakeRecord {
  const sellerFacts = subject
    ? loadSellerStatedFacts(subject.id).map((f) => ({ kind: f.kind, value: f.value }))
    : [];
  const provided: LeadIntakeRecord['provided'] = {
    address: subject?.active_input_address || undefined,
    apn: subject?.apn || undefined,
    owner: subject?.owner || undefined,
    county: subject?.county || undefined,
    state: subject?.state || undefined,
    acreage: subject?.acres ?? undefined,
  };
  return {
    leadId: dealId, // projection: the deal card is the lead container in v1
    dealId,
    entity: deal.entity,
    source: 'deal_card',
    rawInput: deal.seller_notes || deal.title || '',
    provided,
    sellerStatedFacts: sellerFacts,
    intakeConfidence: intakeConfidence(provided),
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
  };
}

/** Build the OpportunityRecord projection from the deal + packet. */
function buildOpportunity(deal: DealCardDetail, packet: PropertyIntelligencePacket): OpportunityRecord {
  const { action, owner } = computeNextBestAction(packet);
  const people = Array.isArray(deal.people) ? deal.people : [];
  const activityRefs: string[] = [];
  if (deal.latestWriteback) activityRefs.push(deal.latestWriteback);
  if (deal.latestReportStatus) activityRefs.push(`report:${deal.latestReportStatus}`);
  return {
    dealId: deal.id,
    entity: deal.entity,
    title: deal.title || '',
    stage: deal.status,
    status: deal.status,
    leadIntakeId: deal.id,
    propertyIntelligenceId: deal.id,
    sellerProfilePresent: people.length > 0 || isPresent(deal.seller_notes),
    marketPacketPresent: (deal.compCount ?? 0) > 0 || isPresent(deal.latestReportStatus),
    strategyAssessmentPresent: isPresent(deal.combined_strategy),
    offerRecordPresent: false, // no canonical offer object in v1 projection
    decisionConfidence: computeDecisionConfidence(packet),
    decisionGrade: packet.decisionGrade,
    criticalBlockers: packet.missingCriticalInfo,
    nextBestAction: action,
    nextActionOwner: owner,
    activityTimelineRefs: activityRefs,
  };
}

/** Build the Deal Card header projection from the assembled objects. */
export function buildDealCardHeader(opportunity: OpportunityRecord, packet: PropertyIntelligencePacket): DealCardHeader {
  return {
    stage: opportunity.stage,
    parcelCompleteness: packet.parcelCompletenessScore,
    decisionConfidence: opportunity.decisionConfidence,
    decisionGrade: packet.decisionGrade,
    decisionGradeReason: packet.decisionGradeReason,
    missingCriticalInfo: packet.missingCriticalInfo,
    criticalFacts: packet.criticalFacts,
    blockingVerificationTasks: packet.verificationTasks.filter((t) => t.blocking),
    nextBestAction: opportunity.nextBestAction,
    nextActionOwner: opportunity.nextActionOwner,
  };
}

/**
 * Assemble the full canonical business object bundle for a Deal Card by reading
 * the persisted truth. Returns undefined if the Deal Card does not exist. This
 * is the authoritative v1 business-intelligence layer; the Deal Card renders it.
 */
export function assembleBusinessObjects(dealCardId: number, now?: number): BusinessObjectBundle | undefined {
  const deal = getDealCard(dealCardId);
  if (!deal) return undefined;
  const dd = getDealCardDd(dealCardId);
  const cards = (Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as LinkedCard[];
  const subject = pickSubject(cards);

  const cardIds = cards.map((c) => c.id).filter((n): n is number => typeof n === 'number');
  const evidence = [...readCardEvidence(cardIds), ...ddEvidence(dd, dealCardId)];

  // The stored ParcelIdentity verdict is AUTHORITATIVE (single source of truth);
  // it falls back to the card's verified_property flag only when nothing has been
  // stored yet. No legacy identity derivation runs anymore.
  const storedIdentity = readParcelIdentity(dealCardId);
  const parcelIdentityVerified = resolveParcelIdentityVerified(subject, storedIdentity);
  const intelInput = buildIntelInput(dealCardId, subject, dd, evidence, parcelIdentityVerified, now);
  const propertyIntelligence = computePropertyIntelligence(intelInput);
  const leadIntake = buildLeadIntake(deal, subject, dealCardId);
  const opportunity = buildOpportunity(deal, propertyIntelligence);
  const header = buildDealCardHeader(opportunity, propertyIntelligence);
  const confirmedParcel = mintConfirmedParcel(dealCardId, subject, storedIdentity, parcelIdentityVerified);

  return {
    dealId: dealCardId,
    leadIntake,
    opportunity,
    propertyIntelligence,
    sourceEvidence: evidence,
    verificationTasks: propertyIntelligence.verificationTasks,
    header,
    confirmedParcel,
  };
}

/**
 * Mint the ConfirmedParcel capability token from the AUTHORITATIVE verdict. The
 * stored `confirmed` verdict yields the token directly; when there is no stored
 * verdict but the subject card is a verified_property (named-source verification,
 * rule 1), the packet mints a token from that — so pre-migration verified cards
 * still hand downstream departments a ConfirmedParcel. Returns null for a
 * Candidate/unresolved parcel. The brand stays module-private (constructed only
 * via confirmParcel), so no caller can forge a token.
 */
function mintConfirmedParcel(
  dealCardId: number,
  subject: LinkedCard | undefined,
  stored: ReturnType<typeof readParcelIdentity>,
  parcelIdentityVerified: boolean,
): ConfirmedParcel | null {
  const fromStored = confirmParcel(stored);
  if (fromStored) return fromStored;
  if (!parcelIdentityVerified) return null;
  // Card-verified fallback (no stored row yet): a verified_property card is a
  // named-source confirmation; represent it as a confirmed record.
  return confirmParcel({
    dealCardId,
    subjectCardId: subject?.id ?? null,
    state: 'confirmed',
    basis: `Verified property card (${subject?.verification_source ?? 'named source'}).`,
    confidence: 0.95,
    evidenceRefs: [],
    confirmedAt: null,
    confirmedBy: 'card',
    updatedAt: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Jarvis / Neo executive query
// ─────────────────────────────────────────────────────────────────────────

export interface DealBlockAnswer {
  dealId: number;
  decisionGrade: boolean;
  decisionConfidence: DecisionConfidence;
  answer: string;
  blockers: string[];
  nextBestAction: string;
  nextActionOwner: string;
  blockingTasks: VerificationTask[];
}

/**
 * Answer the Executive Command / Jarvis-Neo question: "What is blocking this
 * deal, and who owns the next action?" — sourced entirely from the canonical
 * Opportunity + PropertyIntelligencePacket + VerificationTasks, never a report
 * string. Returns undefined if the Deal Card does not exist.
 */
export function whatBlocksThisDeal(dealCardId: number): DealBlockAnswer | undefined {
  const bundle = assembleBusinessObjects(dealCardId);
  if (!bundle) return undefined;
  const { opportunity, propertyIntelligence } = bundle;
  const blockers = propertyIntelligence.missingCriticalInfo;
  const answer = opportunity.decisionGrade
    ? `Deal ${dealCardId} is decision-grade. Next action: ${opportunity.nextBestAction} (owner: ${opportunity.nextActionOwner}).`
    : `Deal ${dealCardId} is blocked by ${blockers.length} critical gap(s): ${blockers.join(', ')}. Next action: ${opportunity.nextBestAction} (owner: ${opportunity.nextActionOwner}).`;
  return {
    dealId: dealCardId,
    decisionGrade: opportunity.decisionGrade,
    decisionConfidence: opportunity.decisionConfidence,
    answer,
    blockers,
    nextBestAction: opportunity.nextBestAction,
    nextActionOwner: opportunity.nextActionOwner,
    blockingTasks: propertyIntelligence.verificationTasks.filter((t) => t.blocking),
  };
}
