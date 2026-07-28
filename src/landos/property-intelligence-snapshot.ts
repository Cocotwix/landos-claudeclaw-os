// The joined Property Intelligence snapshot — one decision-ready record.
//
// Every specialist writes into this shape and the synthesis stage joins them.
// The operator reads THIS on the Deal Card; nobody has to open a long generated
// report to find the recommendation, the blockers, or what is still missing.
//
// Hard rules encoded here:
//   • A missing specialist result is always visible. Completeness is never
//     claimed on top of a failed, blocked, or skipped contribution.
//   • Every fact carries an evidence grade. "Official record" is reserved for
//     parcel-specific official evidence that was actually retrieved.
//   • An unresolved parcel identity prevents parcel-specific conclusions:
//     no valuation number, no actionable strategy, no parcel-specific imagery.
//   • No coordinates, geometry, ownership, or official confirmation is invented.
//
// Pure + deterministic. No I/O.

import {
  PROPERTY_INTELLIGENCE_SPECIALISTS,
  contributedResult,
  specialistDefinition,
  type SpecialistId,
  type SpecialistStatus,
} from './property-intelligence-specialists.js';
import type { FailureCategory } from '../failure-classification.js';

/**
 * Snapshot format version. MONOTONIC — it may never go backwards.
 *
 * Snapshots already persisted on live Deal Cards carry version 2, while this
 * constant still read 1; a newly written snapshot would therefore have declared
 * an OLDER format than the one it replaced, and any reader keying on the version
 * would have treated the newest result as the stale one.
 *
 * Phase 5 also genuinely extends the shape: a snapshot now names the parent
 * mission it was assembled from (`missionId`) and what the run did with the
 * browser pages it opened (`browserCleanup`). Version 3 is both the honest
 * format number and strictly greater than anything already stored.
 */
export const PROPERTY_INTELLIGENCE_SNAPSHOT_VERSION = 3;

/** How strongly a stated item is supported. Never widened by an agent. */
export type EvidenceGrade =
  /** Parcel-specific official evidence was retrieved and retained. */
  | 'confirmed_fact'
  /** Supported by a real source but not parcel-specific official confirmation. */
  | 'likely_indication'
  /** Sources disagree, or the question is open. */
  | 'unresolved_question'
  /** The public record for this item does not exist or is not published. */
  | 'unavailable_public_record'
  /** Only a professional post-contract review can settle this. */
  | 'post_contract_verification';

export const EVIDENCE_GRADE_LABEL: Record<EvidenceGrade, string> = {
  confirmed_fact: 'Confirmed fact',
  likely_indication: 'Likely indication',
  unresolved_question: 'Unresolved question',
  unavailable_public_record: 'No public record available',
  post_contract_verification: 'Legal-grade verification after contract',
};

export type IdentityState = 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';

export interface SnapshotFact {
  key: string;
  label: string;
  value: string | null;
  grade: EvidenceGrade;
  /** Where the value came from, in operator language. */
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  note: string | null;
}

export interface SnapshotIdentity {
  state: IdentityState;
  normalizedAddress: string | null;
  county: string | null;
  state_: string | null;
  apn: string | null;
  /** Every APN spelling seen, normalized for equivalence comparison. */
  apnVariants: string[];
  owner: string | null;
  ownerMailing: string | null;
  situs: string | null;
  acres: number | null;
  acreageBasis: string | null;
  coordinates: { lat: number; lng: number } | null;
  hasParcelGeometry: boolean;
  sourceConfidence: 'high' | 'medium' | 'low' | 'none';
  /** Genuine conflicts that must stay visible and block conclusions. */
  conflicts: string[];
  explanation: string;
}

export interface SnapshotDueDiligenceItem {
  key: string;
  label: string;
  verdict: 'good' | 'caution' | 'risk' | 'unknown';
  headline: string;
  grade: EvidenceGrade;
  detail: string | null;
  sourceUrl: string | null;
  missing: string[];
}

export interface SnapshotComp {
  key: string;
  /** The comp's assessor parcel number, exactly as the source stated it. */
  apn?: string | null;
  address: string | null;
  lane: 'sold' | 'active';
  source: string;
  /** Every marketplace that corroborated this physical property/event. */
  providerAttributions?: string[];
  sourceUrl: string | null;
  status: string;
  dateIso: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  distanceMiles: number | null;
  /** Why this comp is useful to the subject. */
  whyUseful: string;
  similarities: string[];
  differences: string[];
}

export interface SnapshotRejectedComp {
  address: string | null;
  source: string;
  price: number | null;
  reason: string;
}

/** Rows held back from the working set, counted rather than listed one by one. */
export interface SnapshotCompEvidenceBucket {
  reason: string;
  count: number;
  sources: string[];
}

/** The ONE conclusion the comp evidence supports. Never two at once. */
export type SnapshotCompConclusion = 'sold_supported' | 'asking_indication' | 'not_priceable';

export interface SnapshotComps {
  policyExplanation: string;
  landPortalUsable: boolean;
  /** Rows LandPortal actually returned, usable or not. Distinguishes "was never
   *  reached / returned nothing" from "answered but nothing is priceable". */
  landPortalRowsSeen: number;
  caps: { zillow: number; redfin: number };
  sold: SnapshotComp[];
  active: SnapshotComp[];
  landHomeOnly: SnapshotComp[];
  rejected: SnapshotRejectedComp[];
  duplicatesMerged: number;
  summaryLine: string;

  // ── Phase 5 comp correction ───────────────────────────────────────────────
  /**
   * Priced rows whose publisher never stated whether they closed.
   *
   * A first-class lane, not a gap: LandPortal publishes priced acreage rows with
   * no sale-or-list wording, and they are frequently the closest acreage matches
   * available. They are shown prominently as an ASKING-market reference and are
   * never counted as sold evidence.
   */
  askingReferences?: SnapshotComp[];
  /** Held-back rows as counts + reasons, so the operator view is not flooded. */
  evidenceBuckets?: SnapshotCompEvidenceBucket[];
  /** Total rows collected before selection. */
  totalCollected?: number;
  /** Which of the three conclusions the evidence supports. */
  conclusion?: SnapshotCompConclusion;
}

export interface SnapshotValuation {
  priceable: boolean;
  /** Present only when priceable. Never a single false-precision number. */
  range: { low: number; high: number } | null;
  pricePerAcreRange: { low: number; high: number } | null;
  likelyRetail: { low: number; high: number } | null;
  dispositionRange: { low: number; high: number } | null;
  basis: string;
  adjustments: string[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  uncertainty: string[];
  /** Data gaps that materially affect value. */
  materialGaps: string[];
  /** Populated when not priceable: exactly what is missing and what to do. */
  notPriceableReason: string | null;
  nextActionToPrice: string | null;
  /**
   * The single number to work from inside the supported range. A range answers
   * "what is defensible"; the operator still has to act on one figure, and
   * leaving them to pick it silently is how two people work from two values.
   */
  workingValue?: number | null;
  /** One line naming the comps the conclusion actually rests on. */
  primaryBasis?: string | null;
}

export type StrategyApplicability = 'applicable' | 'conditional' | 'blocked' | 'not_applicable';

export interface SnapshotStrategy {
  strategy: string;
  applicability: StrategyApplicability;
  supportingFacts: string[];
  blockers: string[];
  effort: string;
  timeline: string;
  valueCreationPath: string;
  risk: string;
  nextVerificationStep: string;
}

export type OpportunityPosture = 'pursue' | 'hold' | 'renegotiate' | 'reject' | 'undetermined';

export interface SnapshotRecommendation {
  preferredStrategy: string | null;
  why: string;
  whatWouldChangeIt: string[];
  posture: OpportunityPosture;
  postureWhy: string;
  /**
   * Explicit operator answers added in snapshot v3. Optional so historical
   * snapshots remain readable without a migration or destructive rewrite.
   */
  shouldPursue?: 'yes' | 'with_conditions' | 'no' | 'undetermined';
  worth?: { low: number; high: number; workingValue: number } | null;
  targetBuyRange?: { low: number; high: number; basis: string } | null;
  bestExit?: string | null;
  dealKillers?: string[];
  nextConfirmations?: string[];
  juiceWorthSqueeze?: {
    answer: 'yes' | 'conditional' | 'no' | 'undetermined';
    why: string;
  };
}

export interface SnapshotEvidenceItem {
  id: string;
  kind: 'screenshot' | 'document' | 'map' | 'overlay' | 'source_link' | 'record';
  label: string;
  sourceType: string;
  sourceUrl: string | null;
  /** Local retrieval path exposed through an API route, never a raw disk path. */
  viewUrl: string | null;
  retrievedAt: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Which snapshot section this evidence supports. */
  supports: string;
  sha256: string | null;
  bytes: number | null;
}

export interface SnapshotSpecialistRecord {
  id: SpecialistId;
  label: string;
  role: 'required' | 'supporting';
  status: SpecialistStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** One line the operator reads. */
  summary: string;
  failureCategory: FailureCategory | null;
  failureMessage: string | null;
  retryable: boolean;
  evidenceCount: number;
}

export type SnapshotStatus =
  | 'running'
  | 'complete'
  | 'complete_with_gaps'
  | 'blocked_identity'
  | 'failed';

export interface PropertyIntelligenceSnapshot {
  snapshotVersion: number;
  dealCardId: number;
  runId: string;
  /** Monotonic per Deal Card. The newest is primary. */
  sequence: number;
  isPrimary: boolean;
  status: SnapshotStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;

  identity: SnapshotIdentity;
  facts: SnapshotFact[];
  governmentRecords: SnapshotFact[];
  dueDiligence: SnapshotDueDiligenceItem[];
  comps: SnapshotComps;
  valuation: SnapshotValuation;
  strategies: SnapshotStrategy[];
  recommendation: SnapshotRecommendation;
  evidence: SnapshotEvidenceItem[];
  specialists: SnapshotSpecialistRecord[];

  /** Operator headline — the Overview read. */
  headline: {
    keyOpportunity: string;
    topRisks: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    confidenceWhy: string;
  };
  blockers: string[];
  missingInformation: string[];
  nextActions: string[];

  /** The parent mission this snapshot was assembled from. Null on a snapshot
   *  produced before the run became a native parent mission. */
  missionId?: string | null;
  /**
   * True ONLY on an in-flight progressive assembly built from the children that
   * have settled so far. A preliminary snapshot is never promoted to primary,
   * never claims completion (its status stays `running`), and is replaced by the
   * real joined snapshot the moment the parent mission joins. Absent (never
   * false-but-present) on every promoted snapshot.
   */
  preliminary?: boolean;
  /**
   * What the run did with the browser pages it opened.
   *
   * Recorded on the snapshot because "the workflow cleaned up after itself" is
   * an operator-visible outcome, not a log line — and an uncleaned run must be
   * visible rather than assumed clean. Absent on pre-Phase-5 snapshots.
   */
  browserCleanup?: { before: number; after: number; closed: number; note: string } | null;
}

/**
 * In-flight progressive content for ONE running Deal Intelligence run.
 *
 * Persisted on the RUN row (a separate column, never `snapshot_json`) so the
 * operator's poll can render the lanes that have settled while the mission is
 * still running. It is explicitly NOT the promoted read:
 *   • `snapshot.preliminary` is true and `snapshot.isPrimary` is false.
 *   • `snapshot.status` is `running` — completeness is never claimed while any
 *     lane is outstanding.
 *   • Promotion still happens only at join, in `completeRun`, which also clears
 *     this content so a finished run can never serve stale mid-flight data.
 */
export interface PropertyIntelligenceProgress {
  preliminary: true;
  runId: string;
  dealCardId: number;
  sequence: number;
  /** When this partial assembly was built. */
  updatedAt: string;
  /** Child keys that have reached a terminal state so far. */
  settled: string[];
  /** Child keys still queued or running. */
  outstanding: string[];
  /** The partial assembly, in the exact shape every Deal Card tab reads. */
  snapshot: PropertyIntelligenceSnapshot;
}

// ── Join ─────────────────────────────────────────────────────────────────────

export interface SnapshotJoinInput {
  dealCardId: number;
  runId: string;
  sequence: number;
  startedAt: string;
  completedAt: string | null;
  identity: SnapshotIdentity;
  facts: SnapshotFact[];
  governmentRecords: SnapshotFact[];
  dueDiligence: SnapshotDueDiligenceItem[];
  comps: SnapshotComps;
  valuation: SnapshotValuation;
  strategies: SnapshotStrategy[];
  recommendation: SnapshotRecommendation;
  evidence: SnapshotEvidenceItem[];
  specialists: SnapshotSpecialistRecord[];
  /** Extra blockers the runner already knows about (e.g. a mission-level error). */
  extraBlockers?: string[];
}

function durationBetween(startedAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/** APNs compare by identity, never by punctuation, spacing or leading zeros. */
export function normalizeApn(value: string | null | undefined): string {
  const cleaned = (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Leading zeros are display formatting on most county APNs, so an identifier
  // that is otherwise identical must not read as a conflict.
  return cleaned.replace(/^0+(?=.)/, '');
}

/**
 * Longest leading county/district prefix a jurisdiction may add to an otherwise
 * identical parcel identifier. Tennessee's statewide layer prefixes the county
 * NUMBER (e.g. Roane = 073) onto the county-local "map + parcel" identifier, so
 * the state form 073090 04200 and the county-local form 090 04200 are the SAME
 * parcel. Proven live against the Tennessee Comptroller layer, which returns
 * exactly one Roane parcel for both spellings:
 *   PARCELID "073 090    04200 000 2026" / GISLINK "073090    04200"
 *   CMAP 090 / PARCEL 042.00 / OWNER "SACHAN DILEEP S"
 */
const MAX_JURISDICTION_PREFIX_DIGITS = 4;
/** The shorter identifier must still be substantial before a prefix rule applies. */
const MIN_LOCAL_IDENTIFIER_DIGITS = 6;

/**
 * True when one spelling is the other plus a leading jurisdiction prefix.
 * Deliberately conservative: the shorter form must be a strict SUFFIX of the
 * longer, must itself be a substantial identifier, and the extra leading run
 * must be short enough to be a county/district code rather than a different
 * parcel. Returns the prefix so callers can record WHY the two agree.
 */
export function jurisdictionPrefixBetween(a: string | null | undefined, b: string | null | undefined): string | null {
  if (normalizeApn(a) === normalizeApn(b)) return null;
  // Compare on RAW digits (leading zeros preserved) so the reported prefix is
  // the county code the jurisdiction actually uses — "073", not "730".
  const raw = (value: string | null | undefined): string => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates: Array<[string, string]> = [];
  const rawLeft = raw(a);
  const rawRight = raw(b);
  if (rawLeft && rawRight) candidates.push(rawLeft.length <= rawRight.length ? [rawLeft, rawRight] : [rawRight, rawLeft]);
  const normLeft = normalizeApn(a);
  const normRight = normalizeApn(b);
  if (normLeft && normRight) candidates.push(normLeft.length <= normRight.length ? [normLeft, normRight] : [normRight, normLeft]);

  for (const [shorter, longer] of candidates) {
    if (shorter.length < MIN_LOCAL_IDENTIFIER_DIGITS) continue;
    if (!longer.endsWith(shorter)) continue;
    const prefix = longer.slice(0, longer.length - shorter.length);
    if (!prefix || prefix.length > MAX_JURISDICTION_PREFIX_DIGITS) continue;
    return prefix;
  }
  return null;
}

/**
 * The county-local search spelling the jurisdiction-prefix rule implies for a
 * state-form APN. Tennessee's statewide layer prefixes the 3-digit county
 * NUMBER onto the county-local "map + parcel" identifier that LandPortal
 * displays and indexes (proven live on Deal 32: 073090 04200 ↔ 090 04200), so
 * a subject search that only tries the confirmed state form finds nothing on
 * LandPortal — which is exactly what blocked Deal 57's parcel visuals and
 * comps. Deliberately conservative: only a 3-digit prefix on a first token of
 * six or more digits is stripped, and the result is emitted only when
 * `jurisdictionPrefixBetween` confirms the two spellings denote ONE parcel, so
 * a variant can never name a different parcel than the input.
 */
export function jurisdictionLocalApnVariants(apn: string | null | undefined): string[] {
  const original = (apn ?? '').trim();
  if (!original) return [];
  const tokens = original.split(/\s+/);
  const first = tokens[0] ?? '';
  if (!/^\d{6,}$/.test(first)) return [];
  const local = [first.slice(3), ...tokens.slice(1)].join(' ');
  return jurisdictionPrefixBetween(original, local) ? [local] : [];
}

/** True when two APN spellings denote the same parcel identifier. */
export function apnEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeApn(a);
  const right = normalizeApn(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return jurisdictionPrefixBetween(a, b) != null;
}

/**
 * Reduce a set of APN spellings to genuinely distinct identifiers. Formatting
 * differences collapse; a real second parcel identifier survives.
 */
export function distinctApnIdentities(values: Array<string | null | undefined>): string[] {
  const kept: string[] = [];
  for (const value of values) {
    const raw = (value ?? '').trim();
    if (!raw || !normalizeApn(raw)) continue;
    // A spelling that is equivalent to one already kept (identical, or the same
    // identifier under a county/district prefix) is a FORMAT variant, never a
    // second parcel. The longest spelling is retained because it carries the
    // most jurisdiction context.
    const match = kept.findIndex((existing) => apnEquivalent(existing, raw));
    if (match < 0) { kept.push(raw); continue; }
    if (normalizeApn(raw).length > normalizeApn(kept[match]).length) kept[match] = raw;
  }
  return kept;
}

function confidenceFrom(
  identity: SnapshotIdentity,
  specialists: SnapshotSpecialistRecord[],
  valuation: SnapshotValuation,
): { confidence: 'high' | 'medium' | 'low' | 'none'; why: string } {
  const required = specialists.filter((s) => s.role === 'required');
  const delivered = required.filter((s) => contributedResult(s.status));
  const ratio = required.length ? delivered.length / required.length : 0;

  if (identity.state === 'unresolved' || identity.state === 'conflicted') {
    return {
      confidence: 'none',
      why: `Parcel identity is ${identity.state}, so no parcel-specific conclusion carries confidence. ${identity.explanation}`,
    };
  }
  if (ratio >= 0.9 && valuation.priceable && identity.state === 'confirmed') {
    return { confidence: 'high', why: `Parcel identity is confirmed, ${delivered.length} of ${required.length} required specialists delivered, and a defensible value basis exists.` };
  }
  if (ratio >= 0.6) {
    return {
      confidence: 'medium',
      why: `${delivered.length} of ${required.length} required specialists delivered${valuation.priceable ? ' and a value basis exists' : ', but the property is not priceable yet'}.`,
    };
  }
  return {
    confidence: 'low',
    why: `Only ${delivered.length} of ${required.length} required specialists delivered, so the picture is materially incomplete.`,
  };
}

function statusFrom(
  identity: SnapshotIdentity,
  specialists: SnapshotSpecialistRecord[],
  completedAt: string | null,
): SnapshotStatus {
  if (!completedAt) return 'running';
  if (specialists.some((s) => s.status === 'queued' || s.status === 'running')) return 'running';
  if (identity.state === 'unresolved' || identity.state === 'conflicted') return 'blocked_identity';
  const required = specialists.filter((s) => s.role === 'required');
  if (required.length > 0 && required.every((s) => s.status === 'failed')) return 'failed';
  const gaps = required.filter((s) => !contributedResult(s.status));
  return gaps.length > 0 ? 'complete_with_gaps' : 'complete';
}

/**
 * Join every specialist contribution into one coherent snapshot.
 *
 * The join never upgrades a conclusion: it computes status, confidence,
 * blockers, missing information and next actions strictly from what the
 * specialists actually returned.
 */
export function joinPropertyIntelligence(input: SnapshotJoinInput): PropertyIntelligenceSnapshot {
  const specialists = input.specialists;
  const identity = input.identity;
  const status = statusFrom(identity, specialists, input.completedAt);
  const { confidence, why } = confidenceFrom(identity, specialists, input.valuation);

  const blockers: string[] = [...(input.extraBlockers ?? [])];
  if (identity.state === 'conflicted') {
    blockers.push(`Parcel identity is conflicted and must be resolved before any parcel-specific conclusion is used. ${identity.explanation}`);
  } else if (identity.state === 'unresolved') {
    blockers.push(`The subject parcel has not been identified against an official record. ${identity.explanation}`);
  }
  for (const conflict of identity.conflicts) blockers.push(conflict);
  if (!input.valuation.priceable && input.valuation.notPriceableReason) {
    blockers.push(input.valuation.notPriceableReason);
  }

  const missingInformation: string[] = [];
  for (const specialist of specialists) {
    if (contributedResult(specialist.status)) {
      if (specialist.status === 'partial') {
        missingInformation.push(`${specialist.label}: partial result — ${specialist.summary}`);
      }
      continue;
    }
    if (specialist.status === 'skipped') {
      missingInformation.push(`${specialist.label}: skipped — ${specialist.summary}`);
    } else if (specialist.status === 'blocked') {
      missingInformation.push(`${specialist.label}: blocked — ${specialist.summary}`);
    } else if (specialist.status === 'failed') {
      missingInformation.push(`${specialist.label}: failed (${specialist.failureCategory ?? 'unknown'}) — ${specialist.failureMessage ?? specialist.summary}`);
    } else {
      missingInformation.push(`${specialist.label}: did not report a result.`);
    }
  }
  for (const item of input.dueDiligence) {
    for (const gap of item.missing) missingInformation.push(`${item.label}: ${gap}`);
  }
  missingInformation.push(...input.valuation.materialGaps);

  const nextActions: string[] = [];
  if (identity.state !== 'confirmed') {
    nextActions.push('Resolve parcel identity against the official county/state parcel layer before relying on any parcel-specific conclusion.');
  }
  if (!input.valuation.priceable && input.valuation.nextActionToPrice) {
    nextActions.push(input.valuation.nextActionToPrice);
  }
  for (const specialist of specialists) {
    if (specialist.status === 'failed' && specialist.retryable) {
      nextActions.push(`Re-run Property Intelligence to retry ${specialist.label} (${specialist.failureCategory ?? 'unknown'} failure).`);
    } else if (specialist.status === 'failed' && !specialist.retryable) {
      nextActions.push(`${specialist.label} needs operator action before it can succeed: ${specialist.failureMessage ?? 'see the failure detail'}.`);
    }
  }
  const recommendationStep = input.strategies.find((s) => s.strategy === input.recommendation.preferredStrategy)?.nextVerificationStep;
  if (recommendationStep) nextActions.push(recommendationStep);

  const topRisks = input.dueDiligence
    .filter((item) => item.verdict === 'risk')
    .map((item) => `${item.label}: ${item.headline}`)
    .slice(0, 5);
  if (topRisks.length === 0) {
    const cautions = input.dueDiligence.filter((item) => item.verdict === 'caution').slice(0, 3);
    topRisks.push(...cautions.map((item) => `${item.label}: ${item.headline}`));
  }
  if (topRisks.length === 0 && blockers.length > 0) topRisks.push(blockers[0]);

  const keyOpportunity = identity.state === 'confirmed' && input.valuation.priceable && input.recommendation.preferredStrategy
    ? `${input.recommendation.preferredStrategy}: ${input.recommendation.why}`
    : identity.state === 'confirmed'
      ? 'The parcel is identified, but no priced opportunity can be stated until the value basis is established.'
      : 'No opportunity can be stated until the subject parcel is identified against an official record.';

  return {
    snapshotVersion: PROPERTY_INTELLIGENCE_SNAPSHOT_VERSION,
    dealCardId: input.dealCardId,
    runId: input.runId,
    sequence: input.sequence,
    isPrimary: true,
    status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: durationBetween(input.startedAt, input.completedAt),
    identity,
    facts: input.facts,
    governmentRecords: input.governmentRecords,
    dueDiligence: input.dueDiligence,
    comps: input.comps,
    valuation: input.valuation,
    strategies: input.strategies,
    recommendation: input.recommendation,
    evidence: input.evidence,
    specialists,
    headline: {
      keyOpportunity,
      topRisks,
      confidence,
      confidenceWhy: why,
    },
    blockers: dedupe(blockers),
    missingInformation: dedupe(missingInformation),
    nextActions: dedupe(nextActions),
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Build the queued specialist roster shown before any specialist has run. */
export function initialSpecialistRecords(): SnapshotSpecialistRecord[] {
  return PROPERTY_INTELLIGENCE_SPECIALISTS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    role: definition.role,
    status: 'queued' as SpecialistStatus,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: definition.purpose,
    failureCategory: null,
    failureMessage: null,
    retryable: false,
    evidenceCount: 0,
  }));
}

export function specialistLabel(id: SpecialistId): string {
  return specialistDefinition(id).label;
}
