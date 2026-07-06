// LandOS — Smart Intake (the front door).
//
// Smart Intake is not an address field, an APN field, or a search box. It is the
// intelligent intake coordinator: paste virtually anything about a property or
// deal and it (1) determines what property is referred to, (2) separates field
// LABELS from VALUES, (3) normalizes APNs into county formats, (4) scores its
// identity confidence with reasons, and (5) categorizes deal intelligence into
// structured buckets with an evidence status per item. It composes the existing
// classifier + parsers; it never re-implements parsing and never fabricates
// certainty.
//
// Pure + deterministic. No I/O, no network, no secrets. Downstream (the route)
// continues into the existing Property Resolution → Property Intelligence
// workflow when identity confidence clears the threshold.

import { classifySmartIntake, type ParsedIntakeFields, type IntakeRoute } from './intake-router.js';
import { extractApnCandidates, type NormalizedApn, normalizeApn } from './intake-normalize.js';
import type { ParcelIdentityClass } from './intake-types.js';

// ─────────────────────────────────────────────────────────────────────────
// Confidence engine
// ─────────────────────────────────────────────────────────────────────────

/** Identity confidence labels. "Verified" requires a named source confirmation
 *  and is therefore only ever reached POST-resolution, never at raw intake. */
export const CONFIDENCE_LABELS = ['Verified', 'Likely', 'Possible', 'Insufficient Evidence'] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export interface IdentityConfidence {
  label: ConfidenceLabel;
  /** 0–100. Honest pre-resolution estimate of how strongly the input pins a
   *  single parcel; never implies a source has confirmed it. */
  percent: number;
  /** Deterministic, human-readable drivers behind the score. */
  reasons: string[];
}

function label(percent: number): ConfidenceLabel {
  if (percent >= 70) return 'Likely';
  if (percent >= 45) return 'Possible';
  return 'Insufficient Evidence';
}

/**
 * Score how strongly the parsed fields identify a single parcel — BEFORE any
 * provider runs. Deliberately caps at "Likely": only a named-source lookup can
 * make it "Verified". Explains every point so the operator sees why.
 */
export function identityConfidence(fields: ParsedIntakeFields, identityClass: ParcelIdentityClass): IdentityConfidence {
  const has = (v?: string) => typeof v === 'string' && v.trim().length > 0;
  const reasons: string[] = [];
  let percent = 0;

  if (has(fields.lpUrl)) {
    percent = 85;
    reasons.push('Direct LandPortal property URL provided (strong direct identifier, not yet source-confirmed).');
  } else if (has(fields.propertyId) && has(fields.fips)) {
    percent = 85;
    reasons.push('Property ID + FIPS provided (strong direct identifier, not yet source-confirmed).');
  } else if (has(fields.apn) && has(fields.county) && has(fields.state)) {
    percent = 80;
    reasons.push(`APN present with county (${fields.county}) and state (${fields.state}).`);
  } else if (has(fields.apn) && (has(fields.county) || has(fields.state))) {
    percent = 62;
    reasons.push(`APN present with ${has(fields.county) ? `county (${fields.county})` : `state (${fields.state})`}, but not both — locality is partial.`);
  } else if (has(fields.address) && /^\s*\d/.test(fields.address!.trim()) && has(fields.state) && (has(fields.city) || has(fields.county))) {
    percent = 72;
    reasons.push('Full street address with city/county and state.');
  } else if (has(fields.owner) && (has(fields.county) || has(fields.state))) {
    percent = 50;
    reasons.push('Owner name with county/state — resolvable by owner search, but a name is weaker than a parcel identifier.');
  } else if (has(fields.city) && has(fields.state)) {
    percent = 25;
    reasons.push('City + state only — area context, not a specific parcel.');
  } else {
    reasons.push('No parcel identifier (APN, full address, owner+locality, or property ID) detected.');
  }

  // Bonuses / notes that do not change the tier but improve/annotate the score.
  if (has(fields.apn) && fields.apnVariants && fields.apnVariants.length > 1) {
    percent = Math.min(90, percent + 3);
    reasons.push(`APN normalized to ${fields.apnVariants.length} candidate formats for county lookup.`);
  }
  if (fields.apnAlternates && fields.apnAlternates.length) {
    reasons.push(`Alternate parcel number captured: ${fields.apnAlternates.join(', ')}.`);
  }
  if (has(fields.state)) reasons.push(`State recognized as ${fields.state}.`);
  reasons.push(`Identity class: ${identityClass}.`);

  return { label: label(percent), percent, reasons };
}

// ─────────────────────────────────────────────────────────────────────────
// Deal intelligence categorization
// ─────────────────────────────────────────────────────────────────────────

/** Where a piece of pasted information belongs on the deal. */
export const DEAL_CATEGORIES = [
  'Property Facts',
  'Seller Information',
  'Acquisition Notes',
  'Due Diligence',
  'Discovery Questions',
  'Risks',
  'Opportunities',
  'Follow-up Tasks',
  'Strategy Notes',
  'Contacts',
  'Documents',
  'Timeline',
  'Internal Notes',
] as const;
export type DealCategory = (typeof DEAL_CATEGORIES)[number];

/** Evidence status attached to every extracted item. Verified/Official are only
 *  asserted when the text itself names an official/verified source; raw pasted
 *  facts are Needs Verification, never silently promoted. */
export const EVIDENCE_STATUSES = [
  'Verified',
  'Official Source',
  'Seller Stated',
  'Browser Observed',
  'Estimated',
  'Needs Verification',
  'Unknown',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface DealIntelItem {
  category: DealCategory;
  text: string;
  evidenceStatus: EvidenceStatus;
}

// Ordered category matchers. First match wins, so more specific/urgent buckets
// (questions, risks, tasks, contacts) are checked before generic facts.
const CATEGORY_RULES: Array<{ category: DealCategory; test: (s: string) => boolean }> = [
  { category: 'Discovery Questions', test: (s) => s.trim().endsWith('?') },
  { category: 'Contacts', test: (s) => /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(s) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(s) },
  { category: 'Follow-up Tasks', test: (s) => /\b(call|email|follow[\s-]?up|send|schedule|need to|to-?do|verify|confirm|order|request|reach out|circle back)\b/i.test(s) },
  { category: 'Documents', test: (s) => /\b(deed|survey|plat|contract|title report|title commitment|attached|pdf|document|recorded instrument|closing statement)\b/i.test(s) },
  { category: 'Timeline', test: (s) => /\b(deadline|closing|close by|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|asap|urgent|end of (month|week|year)|within \d+ days|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i.test(s) },
  { category: 'Risks', test: (s) => /\b(risk|concern|problem|issue|dispute|landlocked|no legal access|back taxes|delinquent|lien|encroach|contamination|flood zone|wetland|title (?:issue|problem|cloud)|unclear|unpermitted)\b/i.test(s) },
  { category: 'Opportunities', test: (s) => /\b(opportunity|upside|below market|under market|subdivide|road frontage|growth|rezone|development potential|motivated seller|great deal|owner finance)\b/i.test(s) },
  { category: 'Due Diligence', test: (s) => /\b(title|easement|access|utilit|septic|well |water|zoning|flood|wetland|survey|soil|perc|percolation|setback|boundary|environmental)\b/i.test(s) },
  { category: 'Seller Information', test: (s) => /\b(seller|owner|asking|wants? to sell|motivat|probate|inherit|heirs?|divorce|relocat|estate sale|listed at|price is|they want|he wants|she wants|family)\b/i.test(s) },
  { category: 'Strategy Notes', test: (s) => /\b(strateg|exit|flip|hold|resell|comp|arv|offer range|target price|underwrit|margin|profit)\b/i.test(s) },
  { category: 'Property Facts', test: (s) => /\b(apn|parcel|acre|acreage|lot|address|county|state|gps|coordinate|road|street|legal description|frontage|dimensions|sq ?ft|square feet|zoned)\b/i.test(s) },
];

const SELLER_STATED_RE = /\b(seller|owner|they|he|she|asking|wants?|motivat|says?|told|claims?|per the (seller|owner))\b/i;
const OFFICIAL_SOURCE_RE = /\b(county|assessor|recorded|deed|tax record|register of deeds|gis|clerk|official record|per (the )?county)\b/i;
const ESTIMATED_RE = /\b(approx|approximately|about|around|~|est\.?|estimated|roughly|give or take)\b/i;
const IDENTITY_FACT_RE = /\b(apn|parcel|acre|acreage|address|zoning|owner|legal description|gps|coordinate)\b/i;

function evidenceStatus(s: string, category: DealCategory): EvidenceStatus {
  if (category === 'Discovery Questions') return 'Unknown';
  if (category === 'Follow-up Tasks') return 'Needs Verification';
  if (OFFICIAL_SOURCE_RE.test(s)) return 'Official Source';
  if (category === 'Seller Information' || SELLER_STATED_RE.test(s)) return 'Seller Stated';
  if (ESTIMATED_RE.test(s)) return 'Estimated';
  if (IDENTITY_FACT_RE.test(s) || category === 'Property Facts' || category === 'Due Diligence') return 'Needs Verification';
  return 'Unknown';
}

function segment(text: string): string[] {
  return (text ?? '')
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/**
 * Categorize free-form deal information into structured buckets, attaching an
 * evidence status to each item. Verified facts are never mixed with seller
 * claims: a seller statement is Seller Stated, an official-record mention is
 * Official Source, an unconfirmed identity fact is Needs Verification. Nothing
 * useful is discarded — unclassifiable lines land in Internal Notes / Unknown.
 */
export function categorizeDealIntelligence(text: string): DealIntelItem[] {
  const items: DealIntelItem[] = [];
  for (const s of segment(text)) {
    const rule = CATEGORY_RULES.find((r) => r.test(s));
    const category: DealCategory = rule?.category ?? 'Internal Notes';
    items.push({ category, text: s, evidenceStatus: evidenceStatus(s, category) });
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────
// Compose: the Smart Intake result
// ─────────────────────────────────────────────────────────────────────────

export interface SmartIntake {
  rawText: string;
  route: IntakeRoute;
  /** Structured property identity (labels never read as values). */
  fields: ParsedIntakeFields;
  identityClass: ParcelIdentityClass;
  hasParcelIdentity: boolean;
  /** Normalized APN candidates (primary + alternates + county-format variants). */
  apn: { primary?: string; alternates: string[]; variants: string[]; normalized: NormalizedApn[] };
  confidence: IdentityConfidence;
  /** Categorized deal intelligence with per-item evidence status. */
  dealIntelligence: DealIntelItem[];
  /** True when confidence clears the threshold to auto-continue into the
   *  existing Property Resolution → Property Intelligence workflow. */
  readyForPropertyIntelligence: boolean;
  /** Practical next step when not ready (smallest missing identifier), else the
   *  auto-continue note. */
  nextStep: string;
}

/** Confidence percent at/above which intake auto-continues into resolution. */
export const AUTO_CONTINUE_THRESHOLD = 60;

/**
 * Build the full Smart Intake result for a raw paste. Deterministic. The route
 * and parsed fields come from the existing classifier; this layer adds APN
 * normalization, the confidence engine, and deal-intelligence categorization,
 * and decides whether to hand straight off to Property Intelligence.
 */
export function buildSmartIntake(rawText: string): SmartIntake {
  const text = (rawText ?? '').trim();
  const cls = classifySmartIntake(text);
  const apnCands = extractApnCandidates(text);
  const confidence = identityConfidence(cls.parsedFields, cls.identityClass);
  const dealIntelligence = categorizeDealIntelligence(text);

  const ready = cls.hasParcelIdentity && confidence.percent >= AUTO_CONTINUE_THRESHOLD;
  const nextStep = ready
    ? 'Identity confidence sufficient — continuing into Property Resolution → Property Intelligence.'
    : cls.hasParcelIdentity
      ? 'Identity is plausible but weak — Property Resolution will run its retrieval lanes; add APN + county, owner + county/state, or a full address to strengthen it.'
      : 'No parcel identity yet. Add an APN + county, a full street address with city/state, an owner + county/state, or a LandPortal URL.';

  return {
    rawText: text,
    route: cls.route,
    fields: cls.parsedFields,
    identityClass: cls.identityClass,
    hasParcelIdentity: cls.hasParcelIdentity,
    apn: { primary: apnCands.primary, alternates: apnCands.alternates, variants: apnCands.allVariants, normalized: apnCands.normalized },
    confidence,
    dealIntelligence,
    readyForPropertyIntelligence: ready,
    nextStep,
  };
}

/** Re-export so callers can normalize a single APN without importing two modules. */
export { normalizeApn };
