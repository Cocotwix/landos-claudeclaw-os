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
import type { DealOperatorAnalysis } from './deal-operator-analysis.js';

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
  /** Discovery may proceed when independent parcel-level evidence agrees even
   * when the official parcel service is unavailable. Never true for conflicts. */
  discoveryUsable?: boolean;
  discoveryBasis?: string | null;
  discoverySources?: string[];
  normalizedAddress: string | null;
  county: string | null;
  state_: string | null;
  apn: string | null;
  /** Every APN spelling seen, normalized for equivalence comparison. */
  apnVariants: string[];
  owner: string | null;
  ownerMailing: string | null;
  situs: string | null;
  /** Operator-accepted full display address (street, locality, state, ZIP)
   * when the retained lead input extends the confirmed situs street.
   * View-enriched at read time; never persisted onto the stored snapshot. */
  displayAddress?: string | null;
  /** Canonical postal locality for the subject, from the reconciled property
   * record rather than parsed off the intake string. The two disagree whenever
   * a feed supplied a wrong ZIP, and the reconciled value is the one that must
   * be shown. View-enriched at read time. */
  zip?: string | null;
  city?: string | null;
  /** Canonical LandPortal property identifier retained on the subject card.
   * View-enriched at read time. */
  lpPropertyId?: string | null;
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
  originalListingDate?: string | null;
  collectionDate?: string | null;
  daysOnMarket?: number | null;
  priceChanges?: Array<{ at: string | null; price: number | null; note: string }>;
  views?: number | null;
  saves?: number | null;
  engagement?: 'strong' | 'weak' | 'inconclusive';
  /** Retained marketplace imagery, when the source exposed stable http(s) URLs. */
  thumbnailUrl?: string | null;
  photoUrls?: string[];
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
  /** Audit proof for the dedicated manufactured-home search, including a
   * truthful zero-result explanation. */
  landHomeSearchProof?: {
    status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
    radiusMiles: number;
    timePeriodMonths: number;
    sourcesSearched: string[];
    routesAttempted: string[];
    candidatesReviewed: number;
    qualifyingResults: number;
    exclusionReasons: Array<{ reason: string; count: number }>;
  } | null;
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
  /** Total pages stated by the official document metadata. */
  pageCount?: number | null;
  /** Number of page files LandOS actually retained locally. */
  capturedPageCount?: number | null;
  /** Existing local page-viewer routes only; never synthesized for uncaptured pages. */
  pageViewUrls?: string[];
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

  /** CRM-style acquisition opinion. Optional so every historical snapshot stays readable. */
  operatorAnalysis?: DealOperatorAnalysis;

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
  /** Route-time retained LandPortal subject link and conditional 3D decision. */
  subjectParcelUrl?: string | null;
  threeDCapture?: { decision: 'eligible' | 'not_applicable' | 'unknown'; averageSlopePercent: number | null; areaAboveTenSlopePercent: number | null; reason: string } | null;
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

/** A core identifier must still be substantial before the sub-parcel rule applies. */
const MIN_SUB_PARCEL_CORE_CHARS = 5;

/**
 * APN segments with trailing EMPTY sub-parcel segments dropped.
 *
 * A Tennessee assessor prints the county-local identifier as map + parcel and
 * adds a sub-parcel segment only when the parcel actually has one. LandPortal
 * always renders the segment and fills it with zeros when there is none, so
 * Williamson County's "042 123.00" and LandPortal's "042-123.00-000" are ONE
 * parcel in two official renderings. A live rerun of Deal 89 read them as two
 * properties and threw the whole run away.
 *
 * Only an all-zero trailing segment is dropped, so this can never merge two real
 * parcels: "042 123.00 001" names an actual sub-parcel and still differs from
 * "042 123.00". A decimal point is INSIDE a segment ("123.00" is one parcel
 * number), so it is never treated as a segment separator.
 */
function apnCoreSegments(value: string | null | undefined): string[] {
  const segments = (value ?? '').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const core = [...segments];
  while (core.length > 1 && /^0+$/.test(core[core.length - 1]!.replace(/\./g, ''))) core.pop();
  return core;
}

/** True when two APN spellings denote the same parcel identifier. */
export function apnEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeApn(a);
  const right = normalizeApn(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftCore = normalizeApn(apnCoreSegments(a).join(' '));
  const rightCore = normalizeApn(apnCoreSegments(b).join(' '));
  if (leftCore && leftCore === rightCore && leftCore.length >= MIN_SUB_PARCEL_CORE_CHARS) return true;
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

// ── Canonical fact-once / agreement rule ─────────────────────────────────────
//
// The APN rules above answer "are these two spellings the same parcel?". The
// same question applies to every measured quantity a card shows: LandPortal
// says 60, operator intake says 60.0, listing research says 60.00. That is ONE
// observation written three ways, never a factual disagreement, and it must
// resolve to a single displayed value with the source-level observations kept
// underneath as provenance. Agreement between sources SIMPLIFIES the resolved
// output; it never multiplies rows.

/** Widest gap at which two stated measurements are still the same observation. */
export const NUMERIC_AGREEMENT_TOLERANCE = 0.005;

/** True when two stated measurements are the same value written differently. */
export function numericallyEquivalent(
  a: number | null | undefined,
  b: number | null | undefined,
  tolerance = NUMERIC_AGREEMENT_TOLERANCE,
): boolean {
  if (typeof a !== 'number' || !Number.isFinite(a)) return false;
  if (typeof b !== 'number' || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

/**
 * Reduce stated measurements to genuinely distinct values. Formatting
 * differences (60 / 60.0 / 60.00) collapse; a real second measurement survives.
 * The APN analogue is `distinctApnIdentities`; the first spelling wins so the
 * caller's source ordering decides which value is canonical.
 */
export function distinctNumericValues(
  values: Array<number | null | undefined>,
  tolerance = NUMERIC_AGREEMENT_TOLERANCE,
): number[] {
  const kept: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (kept.some((existing) => numericallyEquivalent(existing, value, tolerance))) continue;
    kept.push(value);
  }
  return kept;
}

/**
 * The one operator-facing spelling of a measurement. Trailing zeros are
 * formatting, not precision, so 60.00 renders "60" and 60.25 renders "60.25".
 */
export function formatCanonicalNumber(value: number | null | undefined, unit?: string | null, decimals = 2): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(decimals));
  const text = String(rounded);
  return unit ? `${text} ${unit}` : text;
}

/** One source-level observation, retained underneath the resolved value. */
export interface CanonicalObservation {
  value: number | null;
  source: string | null;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  note?: string | null;
}

export interface CanonicalNumericFact {
  /** The single value every surface shows. */
  value: number | null;
  /** The single string every surface prints, e.g. "60 AC". */
  display: string | null;
  agreement: 'unknown' | 'single_source' | 'agreed' | 'disputed';
  /** Sources that stated a value, in the order supplied. */
  sources: string[];
  /** Every source-level observation, kept for evidence and debugging. */
  observations: CanonicalObservation[];
  /** Genuinely different measurements (never formatting variants). */
  distinctValues: number[];
  /** Present only on a real disagreement. */
  conflictNote: string | null;
}

/**
 * Resolve many source-level observations of one measurement into the single
 * value the operator reads, keeping every observation as provenance. Sources
 * that merely agree never earn a second visible row.
 */
export function resolveCanonicalNumericFact(
  observations: CanonicalObservation[],
  options: { unit?: string | null; tolerance?: number; decimals?: number; label?: string } = {},
): CanonicalNumericFact {
  const tolerance = options.tolerance ?? NUMERIC_AGREEMENT_TOLERANCE;
  const stated = observations.filter((item) => typeof item.value === 'number' && Number.isFinite(item.value));
  const distinct = distinctNumericValues(stated.map((item) => item.value), tolerance);
  const value = distinct[0] ?? null;
  const sources = [...new Set(stated.map((item) => (item.source ?? '').trim()).filter(Boolean))];
  const label = options.label ?? 'This measurement';
  const agreement: CanonicalNumericFact['agreement'] = distinct.length === 0
    ? 'unknown'
    : distinct.length > 1
      ? 'disputed'
      : stated.length > 1 ? 'agreed' : 'single_source';
  return {
    value,
    display: formatCanonicalNumber(value, options.unit ?? null, options.decimals ?? 2),
    agreement,
    sources,
    observations: stated,
    distinctValues: distinct,
    conflictNote: agreement === 'disputed'
      ? `${label} is genuinely disputed: ${distinct.map((entry) => formatCanonicalNumber(entry, options.unit ?? null, options.decimals ?? 2)).join(' vs ')}. Showing ${formatCanonicalNumber(value, options.unit ?? null, options.decimals ?? 2)} from ${sources[0] ?? 'the strongest source'}; the other reading is retained as provenance.`
      : null,
  };
}

/** Acreage convenience: one "60 AC", however many sources stated it. */
export function resolveCanonicalAcreage(
  observations: CanonicalObservation[],
  tolerance = NUMERIC_AGREEMENT_TOLERANCE,
): CanonicalNumericFact {
  return resolveCanonicalNumericFact(observations, { unit: 'AC', tolerance, label: 'Acreage' });
}

// ── Valuation scope: land-basis reference vs whole-property recommendation ────

export type ValuationScope = 'land_only' | 'whole_property';

/**
 * What a valuation figure on this subject actually IS.
 *
 * A materially improved subject whose improvements have not been separately
 * valued has a LAND-ONLY basis. Opening / Target / Ceiling figures derived from
 * it are land-basis references, never completed whole-property offer
 * recommendations, and the whole-property value reads as pending until the
 * improvements are valued and reconciled.
 */
export interface ValuationScopeState {
  scope: ValuationScope;
  subjectImproved: boolean;
  improvementBasis: string | null;
  improvementsValued: boolean;
  figureKind: 'land_basis_reference' | 'whole_property_recommendation';
  /** The label an Opening/Target/Ceiling figure must carry. */
  figureLabel: string;
  landOnlyLabel: string;
  wholeProperty: { state: 'pending' | 'established' | 'not_applicable'; why: string };
  explanation: string;
}

export function resolveValuationScope(input: {
  subjectImproved: boolean;
  improvementBasis?: string | null;
  improvementsValued?: boolean;
  landValuePriceable: boolean;
}): ValuationScopeState {
  const improvementsValued = input.improvementsValued === true;
  const landBasisOnly = input.subjectImproved && !improvementsValued;
  const improvementBasis = input.improvementBasis?.trim() || null;
  if (landBasisOnly) {
    return {
      scope: 'land_only',
      subjectImproved: true,
      improvementBasis,
      improvementsValued: false,
      figureKind: 'land_basis_reference',
      figureLabel: 'Land-basis reference — not a whole-property offer recommendation',
      landOnlyLabel: 'Land-only value (improvements excluded)',
      wholeProperty: {
        state: 'pending',
        why: `The subject is materially improved${improvementBasis ? ` (${improvementBasis})` : ''} and the improvements have not been separately valued or reconciled, so no whole-property value exists yet.`,
      },
      explanation: 'Every figure below is derived from the land only. It is a land-basis reference for negotiation context and must not be read as a completed whole-property value or offer recommendation. Whole-property value remains pending until the improvements are separately valued.',
    };
  }
  if (!input.subjectImproved) {
    return {
      scope: 'whole_property',
      subjectImproved: false,
      improvementBasis,
      improvementsValued: false,
      figureKind: input.landValuePriceable ? 'whole_property_recommendation' : 'land_basis_reference',
      figureLabel: input.landValuePriceable
        ? 'Whole-property value (vacant land: land value is the whole property)'
        : 'Land-basis reference — no supported value yet',
      landOnlyLabel: 'Land value',
      wholeProperty: {
        state: input.landValuePriceable ? 'established' : 'pending',
        why: input.landValuePriceable
          ? 'No material improvement is recorded on the subject, so the supported land value is the whole-property value.'
          : 'No material improvement is recorded, but the land value is not yet supported by accepted evidence.',
      },
      explanation: input.landValuePriceable
        ? 'The subject carries no material improvement, so the supported land value is the whole-property value.'
        : 'The subject carries no material improvement, but no supported land value exists yet, so no whole-property value can be stated.',
    };
  }
  return {
    scope: 'whole_property',
    subjectImproved: true,
    improvementBasis,
    improvementsValued: true,
    figureKind: 'whole_property_recommendation',
    figureLabel: 'Whole-property value (land plus separately valued improvements)',
    landOnlyLabel: 'Land-only component',
    wholeProperty: {
      state: 'established',
      why: `The improvements${improvementBasis ? ` (${improvementBasis})` : ''} were separately valued and reconciled with the land basis.`,
    },
    explanation: 'The improvements were separately valued and reconciled with the land basis, so these figures are whole-property figures.',
  };
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
    nextActions.push(identity.discoveryUsable
      ? 'Confirm the subject against the official parcel record before a binding offer or closing decision.'
      : 'Resolve parcel identity against the official county/state parcel layer before relying on any parcel-specific conclusion.');
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

  const identitySupportsDiscovery = identity.state === 'confirmed'
    || (identity.state === 'provisional' && identity.discoveryUsable === true);
  const keyOpportunity = identitySupportsDiscovery && input.valuation.priceable && input.recommendation.preferredStrategy
    ? `${input.recommendation.preferredStrategy}: ${input.recommendation.why}`
    : identitySupportsDiscovery
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

/**
 * Re-apply the current join policy to a persisted snapshot without changing its
 * evidence, specialist handbacks, run identity, or database history. This keeps
 * the canonical read coherent after a presentation-policy correction while the
 * stored mission record remains an immutable account of what ran.
 */
export function presentPropertyIntelligenceSnapshot(
  snapshot: PropertyIntelligenceSnapshot,
  overrides: {
    strategies?: SnapshotStrategy[];
    recommendation?: SnapshotRecommendation;
    extraBlockers?: string[];
  } = {},
): PropertyIntelligenceSnapshot {
  const presented = joinPropertyIntelligence({
    dealCardId: snapshot.dealCardId,
    runId: snapshot.runId,
    sequence: snapshot.sequence,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    identity: snapshot.identity,
    facts: snapshot.facts,
    governmentRecords: snapshot.governmentRecords,
    dueDiligence: snapshot.dueDiligence,
    comps: snapshot.comps,
    valuation: snapshot.valuation,
    strategies: overrides.strategies ?? snapshot.strategies,
    recommendation: overrides.recommendation ?? snapshot.recommendation,
    evidence: snapshot.evidence,
    specialists: snapshot.specialists,
    extraBlockers: overrides.extraBlockers ?? snapshot.blockers,
  });
  return {
    ...presented,
    isPrimary: snapshot.isPrimary,
    ...(snapshot.missionId !== undefined ? { missionId: snapshot.missionId } : {}),
    ...(snapshot.preliminary !== undefined ? { preliminary: snapshot.preliminary } : {}),
    ...(snapshot.browserCleanup !== undefined ? { browserCleanup: snapshot.browserCleanup } : {}),
    ...(snapshot.operatorAnalysis !== undefined ? { operatorAnalysis: snapshot.operatorAnalysis } : {}),
  };
}

/**
 * Re-derive specialist delivery from the CURRENT accepted research state.
 *
 * A stored specialist row can go stale: the evidence_visuals specialist may
 * still say "blocked — no screenshots retained" while accepted visual
 * evidence has since landed on the record. The presented count must be
 * recomputed from what is actually retained, never fabricated: a blocked row
 * is upgraded only when the retained evidence directly contradicts its
 * blocked claim. The stored run history is not modified.
 */
export function rederiveSpecialistDelivery(
  specialists: SnapshotSpecialistRecord[],
  evidence: SnapshotEvidenceItem[],
): SnapshotSpecialistRecord[] {
  return specialists.map((specialist) => {
    if (
      specialist.id === 'evidence_visuals'
      && specialist.status === 'blocked'
      && evidence.length > 0
    ) {
      return {
        ...specialist,
        status: 'completed' as const,
        summary: `${evidence.length} accepted evidence item(s) are retained for the verified subject (re-derived from the current evidence record).`,
        failureCategory: null,
        failureMessage: null,
      };
    }
    return specialist;
  });
}

export interface ResearchAreaStatus {
  id: string;
  label: string;
  delivered: boolean;
  status: string;
  /** Why the area is incomplete (only for undelivered areas). */
  reason: string | null;
  /** The next action required to complete it (only for undelivered areas). */
  nextAction: string | null;
}

/**
 * One diligence QUESTION, which is a different thing from a research lane. A
 * lane is a unit of work the machine ran; a question is something the operator
 * needed to know. Delivering every lane does not answer every question.
 */
export interface ResearchQuestionStatus {
  key: string;
  label: string;
  resolved: boolean;
  /** Why the question is still open (only for unresolved questions). */
  reason: string | null;
  /** The next action required to answer it (only for unresolved questions). */
  nextAction: string | null;
}

export interface ResearchStatusView {
  delivered: number;
  total: number;
  headline: string;
  areas: ResearchAreaStatus[];
  incomplete: ResearchAreaStatus[];
  /** Research LANES completed. Identical to `delivered`; named so no surface
   *  can mistake lane delivery for an answered question. */
  lanesDelivered: number;
  lanesTotal: number;
  lanesHeadline: string;
  /** Diligence QUESTIONS resolved — never implied by the lane count. */
  questionsResolved: number;
  questionsTotal: number;
  questionsHeadline: string;
  questions: ResearchQuestionStatus[];
  openQuestions: ResearchQuestionStatus[];
  /** The one sentence a surface may show. It can never read as "everything is
   *  answered" merely because every lane reported back. */
  summaryLine: string;
}

/** A diligence item is ANSWERED only when it reached a verdict, carries real
 *  supporting evidence, and has nothing outstanding against it. */
function diligenceQuestionResolved(item: SnapshotDueDiligenceItem): boolean {
  if (item.verdict === 'unknown') return false;
  if (item.missing.length > 0) return false;
  return item.grade === 'confirmed_fact'
    || item.grade === 'likely_indication'
    || item.grade === 'unavailable_public_record';
}

function diligenceQuestions(items: SnapshotDueDiligenceItem[]): ResearchQuestionStatus[] {
  const seen = new Set<string>();
  const questions: ResearchQuestionStatus[] = [];
  for (const item of items) {
    // Nothing is counted twice: one diligence key is one question.
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const resolved = diligenceQuestionResolved(item);
    const reason = resolved
      ? null
      : item.missing.length > 0
        ? `Outstanding: ${item.missing.join('; ')}.`
        : item.verdict === 'unknown'
          ? (item.headline || `${item.label} has not reached a determination.`)
          : item.grade === 'post_contract_verification'
            ? 'Only a professional post-contract review can settle this.'
            : (item.headline || `${item.label} is not resolved by the retained evidence.`);
    const nextAction = resolved
      ? null
      : item.missing.length > 0
        ? item.missing[0]
        : item.grade === 'post_contract_verification'
          ? `Order the post-contract review that settles ${item.label.toLowerCase()}.`
          : `Retrieve parcel-specific evidence that answers ${item.label.toLowerCase()}.`;
    questions.push({ key: item.key, label: item.label, resolved, reason, nextAction });
  }
  return questions;
}

/**
 * Name every required research area and which one is incomplete, so the
 * operator never has to guess what "7 of 8" is missing. Each required
 * specialist is one research area; nothing is counted twice and the count is
 * computed from the presented (re-derived) specialist state.
 *
 * The diligence items are the second, INDEPENDENT count: "8 of 8 research
 * areas delivered" says every lane reported back, and says nothing at all
 * about how many diligence questions those lanes actually answered. Both
 * counts are exposed distinctly so no surface can present one as the other.
 */
export function researchStatusFrom(
  specialists: SnapshotSpecialistRecord[],
  dueDiligence: SnapshotDueDiligenceItem[] = [],
): ResearchStatusView {
  const required = specialists.filter((specialist) => specialist.role === 'required');
  const areas: ResearchAreaStatus[] = required.map((specialist) => {
    const delivered = contributedResult(specialist.status);
    return {
      id: specialist.id,
      label: specialist.label,
      delivered,
      status: specialist.status,
      reason: delivered ? null : (specialist.failureMessage ?? specialist.summary ?? `${specialist.label} did not deliver a result.`),
      nextAction: delivered
        ? null
        : specialist.status === 'failed' && specialist.retryable
          ? `Re-run Property Intelligence to retry ${specialist.label}.`
          : `Complete ${specialist.label.toLowerCase()} and re-run the Property Intelligence join.`,
    };
  });
  const incomplete = areas.filter((area) => !area.delivered);
  const delivered = areas.length - incomplete.length;
  const questions = diligenceQuestions(dueDiligence);
  const openQuestions = questions.filter((question) => !question.resolved);
  const questionsResolved = questions.length - openQuestions.length;
  const lanesHeadline = `${delivered} of ${areas.length} research areas delivered`;
  const questionsHeadline = questions.length
    ? `${questionsResolved} of ${questions.length} diligence questions resolved`
    : 'No diligence questions have been recorded yet';
  return {
    delivered,
    total: areas.length,
    headline: lanesHeadline,
    areas,
    incomplete,
    lanesDelivered: delivered,
    lanesTotal: areas.length,
    lanesHeadline,
    questionsResolved,
    questionsTotal: questions.length,
    questionsHeadline,
    questions,
    openQuestions,
    summaryLine: `${lanesHeadline}; ${questionsHeadline}. A delivered lane is work completed, not a question answered.`,
  };
}

const FACT_GRADE_STRENGTH: Readonly<Record<EvidenceGrade, number>> = {
  unavailable_public_record: 0,
  unresolved_question: 1,
  post_contract_verification: 2,
  likely_indication: 3,
  confirmed_fact: 4,
};

function identityStrength(identity: SnapshotIdentity): number {
  if (identity.state === 'confirmed') return 4;
  if (identity.state === 'provisional' && identity.discoveryUsable) return 3;
  if (identity.state === 'provisional') return 2;
  if (identity.state === 'unresolved') return 1;
  return 0;
}

function compactAddress(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameSnapshotSubject(a: SnapshotIdentity, b: SnapshotIdentity): boolean {
  if (a.apn && b.apn) return apnEquivalent(a.apn, b.apn);

  // The retained read never established a parcel, and the incoming one has.
  //
  // Two subjects CONFLICT when both name a parcel and they name different ones.
  // When only the incoming side carries a parcel identifier there is no accepted
  // canonical property for it to contradict: this is the subject being
  // established for the first time, which is the single most valuable thing a
  // rerun can do and must never be discarded as a conflict.
  //
  // Falling through to the address compare below got this exactly backwards.
  // Deal 87 is the measured case: the retained address-only read said
  // "5170 Hwy 60", and the run that finally resolved the parcel returned the
  // assessor's own "5170 HIGHWAY 60" alongside APN 023 003.02 in Hamilton
  // County. The compare saw two different strings, called a strictly better
  // identity a different property, and threw the whole run away — so the
  // workspace kept showing the blocked snapshot while the property record
  // underneath it was fully resolved.
  //
  // This does not weaken parcel-identity safety. Whenever the retained side DOES
  // carry an APN the comparison above still governs, so an accepted parcel can
  // never be swapped for another one here.
  if (!a.apn && b.apn) return true;

  const addressA = compactAddress(a.normalizedAddress ?? a.situs);
  const addressB = compactAddress(b.normalizedAddress ?? b.situs);
  return !!addressA && !!addressB && addressA === addressB;
}

function strongerFact(incoming: SnapshotFact, retained: SnapshotFact): boolean {
  if (incoming.value == null || !incoming.value.trim()) return false;
  const incomingStrength = FACT_GRADE_STRENGTH[incoming.grade];
  const retainedStrength = FACT_GRADE_STRENGTH[retained.grade];
  if (incomingStrength !== retainedStrength) return incomingStrength > retainedStrength;
  return String(incoming.retrievedAt ?? '') >= String(retained.retrievedAt ?? '');
}

function mergeFacts(retained: SnapshotFact[], incoming: SnapshotFact[]): SnapshotFact[] {
  const merged = new Map(retained.map((fact) => [fact.key, fact]));
  for (const fact of incoming) {
    const held = merged.get(fact.key);
    if (!held || strongerFact(fact, held)) merged.set(fact.key, fact);
  }
  return [...merged.values()];
}

function mergeDueDiligence(
  retained: SnapshotDueDiligenceItem[],
  incoming: SnapshotDueDiligenceItem[],
): SnapshotDueDiligenceItem[] {
  const merged = new Map(retained.map((item) => [item.key, item]));
  for (const item of incoming) {
    const held = merged.get(item.key);
    const incomingStrength = FACT_GRADE_STRENGTH[item.grade];
    const heldStrength = held ? FACT_GRADE_STRENGTH[held.grade] : -1;
    // An UNKNOWN may refresh an UNKNOWN.
    //
    // The rule below protects a resolved finding from being erased by a later
    // lane that established nothing — that guard is intact. But it also froze a
    // still-unresolved tile forever: the zoning item stays `unknown` while the
    // DISTRICT is unread, so no rerun could ever replace it, even when the new
    // one carried strictly more information. That is what kept the Zoning tile
    // reading "No jurisdiction determination has been collected." after the
    // governing authority had been accepted and the specialist was already
    // emitting "Whitewater township administers zoning".
    //
    // When both sides are unknown nothing resolved is at risk, so the fresher
    // item wins and an unresolved section can still improve between runs.
    const bothUnresolved = item.verdict === 'unknown' && held?.verdict === 'unknown';
    if (!held || bothUnresolved || (item.verdict !== 'unknown' && incomingStrength >= heldStrength)) {
      merged.set(item.key, item);
    }
  }
  return [...merged.values()];
}

function mergeComps(retained: SnapshotComps, incoming: SnapshotComps): SnapshotComps {
  const mergeRows = (oldRows: SnapshotComp[], newRows: SnapshotComp[]): SnapshotComp[] => {
    const rows = new Map(oldRows.map((row) => [row.key, row]));
    for (const row of newRows) rows.set(row.key, row);
    return [...rows.values()];
  };
  const mergeRejected = (oldRows: SnapshotRejectedComp[], newRows: SnapshotRejectedComp[]): SnapshotRejectedComp[] => {
    const rows = new Map<string, SnapshotRejectedComp>();
    for (const row of [...oldRows, ...newRows]) {
      rows.set(`${row.source}|${row.address ?? ''}|${row.price ?? ''}|${row.reason}`, row);
    }
    return [...rows.values()];
  };
  const sold = mergeRows(retained.sold, incoming.sold);
  const active = mergeRows(retained.active, incoming.active);
  const askingReferences = mergeRows(retained.askingReferences ?? [], incoming.askingReferences ?? []);
  const duplicatesMerged = Math.max(retained.duplicatesMerged, incoming.duplicatesMerged);
  const totalCollected = Math.max(retained.totalCollected ?? 0, incoming.totalCollected ?? 0);
  // The counts are unioned across runs, so the sentence and the priceability
  // verdict must be re-derived from the MERGED rows. Inheriting either from the
  // incoming run alone is what let the operator read "4 asking" beside
  // "0 asking-market reference(s)" and a `not_priceable` verdict beside a
  // non-empty asking lane.
  const conclusion: SnapshotCompConclusion = sold.length > 0
    ? 'sold_supported'
    : (askingReferences.length > 0 || active.length > 0) ? 'asking_indication' : 'not_priceable';
  return {
    ...incoming,
    sold,
    active,
    landHomeOnly: mergeRows(retained.landHomeOnly, incoming.landHomeOnly),
    askingReferences,
    rejected: mergeRejected(retained.rejected, incoming.rejected),
    duplicatesMerged,
    totalCollected,
    landPortalRowsSeen: Math.max(retained.landPortalRowsSeen, incoming.landPortalRowsSeen),
    conclusion,
    summaryLine: compSummaryLine({
      sold: sold.length,
      active: active.length,
      asking: askingReferences.length,
      totalCollected,
      duplicatesMerged,
    }),
  };
}

/**
 * The one sentence describing a comparable working set. Shared by the run-time
 * builder and the snapshot merge so a merged snapshot can never narrate counts
 * that its own arrays contradict.
 */
export function compSummaryLine(counts: {
  sold: number; active: number; asking: number; totalCollected: number; duplicatesMerged: number;
}): string {
  return `${counts.sold} accepted sold comp(s), ${counts.active} active competitor(s) and ${counts.asking} asking-market reference(s) shown from ${counts.totalCollected} collected row(s); ${counts.duplicatesMerged} duplicate(s) merged. Remaining rows are retained as evidence with a stated reason.`;
}

function mergeSnapshotEvidence(
  retained: SnapshotEvidenceItem[],
  incoming: SnapshotEvidenceItem[],
): SnapshotEvidenceItem[] {
  const merged = new Map<string, SnapshotEvidenceItem>();
  for (const item of [...retained, ...incoming]) {
    const key = item.sha256 || `${item.id}|${item.sourceUrl ?? ''}|${item.viewUrl ?? ''}`;
    const held = merged.get(key);
    if (!held || item.confidence === 'high' || (held.confidence === 'low' && item.confidence === 'medium')) merged.set(key, item);
  }
  return [...merged.values()];
}

export interface SnapshotPromotionReconciliation {
  promotable: boolean;
  snapshot: PropertyIntelligenceSnapshot;
  reason: string | null;
}

/**
 * Reconcile a rerun against the retained primary read before promotion.
 *
 * The new run keeps its timestamps, mission and specialist outcomes, but valid
 * same-property facts/evidence survive gaps. A conflicting subject never
 * promotes. A weaker identity, blank fact, failed visual lane, or empty comp
 * handback cannot erase a stronger retained result.
 */
export function reconcilePropertyIntelligenceSnapshot(
  retained: PropertyIntelligenceSnapshot | null,
  incoming: PropertyIntelligenceSnapshot,
): SnapshotPromotionReconciliation {
  if (!retained) return { promotable: incoming.status !== 'running' && incoming.status !== 'failed', snapshot: incoming, reason: null };
  if (retained.dealCardId !== incoming.dealCardId) {
    return { promotable: false, snapshot: incoming, reason: 'Snapshot belongs to a different Deal Card.' };
  }
  if (!sameSnapshotSubject(retained.identity, incoming.identity)) {
    return { promotable: false, snapshot: incoming, reason: 'Incoming subject identity conflicts with the retained canonical property.' };
  }

  const keepRetainedIdentity = identityStrength(retained.identity) > identityStrength(incoming.identity);
  const identity = keepRetainedIdentity
    ? { ...incoming.identity, ...retained.identity, conflicts: [...new Set([...retained.identity.conflicts, ...incoming.identity.conflicts])] }
    : {
        ...retained.identity,
        ...incoming.identity,
        normalizedAddress: incoming.identity.normalizedAddress || retained.identity.normalizedAddress,
        county: incoming.identity.county || retained.identity.county,
        state_: incoming.identity.state_ || retained.identity.state_,
        apn: incoming.identity.apn || retained.identity.apn,
        owner: incoming.identity.owner || retained.identity.owner,
        ownerMailing: incoming.identity.ownerMailing || retained.identity.ownerMailing,
        situs: incoming.identity.situs || retained.identity.situs,
        acres: incoming.identity.acres ?? retained.identity.acres,
        acreageBasis: incoming.identity.acreageBasis || retained.identity.acreageBasis,
        coordinates: incoming.identity.coordinates ?? retained.identity.coordinates,
        conflicts: [...new Set([...retained.identity.conflicts, ...incoming.identity.conflicts])],
      };
  const facts = mergeFacts(retained.facts, incoming.facts);
  const governmentRecords = mergeFacts(retained.governmentRecords, incoming.governmentRecords);
  const dueDiligence = mergeDueDiligence(retained.dueDiligence, incoming.dueDiligence);
  const comps = mergeComps(retained.comps, incoming.comps);
  const valuation = incoming.valuation.priceable || !retained.valuation.priceable ? incoming.valuation : retained.valuation;
  const strategies = incoming.strategies.length ? incoming.strategies : retained.strategies;
  const recommendation = incoming.recommendation.preferredStrategy || !retained.recommendation.preferredStrategy
    ? incoming.recommendation
    : retained.recommendation;
  const evidence = mergeSnapshotEvidence(retained.evidence, incoming.evidence);
  const joined = joinPropertyIntelligence({
    dealCardId: incoming.dealCardId,
    runId: incoming.runId,
    sequence: incoming.sequence,
    startedAt: incoming.startedAt,
    completedAt: incoming.completedAt,
    identity,
    facts,
    governmentRecords,
    dueDiligence,
    comps,
    valuation,
    strategies,
    recommendation,
    evidence,
    specialists: incoming.specialists,
  });
  return {
    promotable: incoming.status !== 'running' && incoming.status !== 'failed',
    reason: null,
    snapshot: {
      ...joined,
      missionId: incoming.missionId,
      browserCleanup: incoming.browserCleanup,
      operatorAnalysis: incoming.operatorAnalysis,
      subjectParcelUrl: incoming.subjectParcelUrl ?? retained.subjectParcelUrl,
      threeDCapture: incoming.threeDCapture ?? retained.threeDCapture,
    },
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
