// LandOS Source Evidence Standard — pure, deterministic, dependency-free.
//
// Every factual output that affects value, zoning, comps, subdivision, access,
// utilities, buildability, market demand, or offer strategy must carry source
// evidence. This module is the single place that decides:
//   - what kind of source a link/label is (official vs marketplace vs context),
//   - whether a fact may be used for offer logic,
//   - whether a comp or zoning/subdivision fact meets the required output shape.
//
// Hard rules enforced here:
//   - No source link  -> not verified, cannot be used for offer logic.
//   - Marketplace / non-official pages are never official county verification.
//   - A source link can never overcome parcel-identity uncertainty: if the
//     parcel is not verified, nothing is offer-usable.

export type SourceType = 'official' | 'landportal' | 'marketplace' | 'local_context' | 'unknown';

const OFFICIAL_PATTERNS: RegExp[] = [
  /\.gov\b/i,
  /\bassessor\b/i,
  /\bgis\b/i,
  /\bcounty\s+(records|clerk|recorder|auditor|treasurer|planning)\b/i,
  /\bregister\s+of\s+deeds\b/i,
  /\bplanning\s+(department|commission|dept)\b/i,
  /\bzoning\s+(ordinance|code|board)\b/i,
  /\bmunicode\b/i,
  /\bordinance\b/i,
  /\bus\.?gov\b/i,
];

const LANDPORTAL_PATTERNS: RegExp[] = [/\blandportal\b/i, /\blp_(resolve|property|search)/i];

const MARKETPLACE_PATTERNS: RegExp[] = [
  /\bzillow\b/i,
  /\bredfin\b/i,
  /\brealtor\.com\b/i,
  /\blandwatch\b/i,
  /\bland\.com\b/i,
  /\blandsofamerica\b/i,
  /\bloopnet\b/i,
  /\bcraigslist\b/i,
  /\bfacebook\s+marketplace\b/i,
  /\bcountyoffice\.org\b/i, // looks official, is not
  /\bhomes\.com\b/i,
];

const LOCAL_CONTEXT_PATTERNS: RegExp[] = [
  /\blocal\s+area\s+context\b/i,
  /\barea\s+stat/i,
  /\bmarket\s+context\b/i,
];

function hasLink(url: string | undefined): boolean {
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * Classify a source from a URL and/or label. Deterministic. Official wins over
 * marketplace (a .gov assessor page is official even if it mentions "homes"),
 * marketplace wins over local-context, and an unknown link without signals is
 * "unknown" rather than guessed.
 */
export function classifySource(input: { url?: string; label?: string }): SourceType {
  const blob = `${input.url ?? ''} ${input.label ?? ''}`.trim();
  if (!blob) return 'unknown';
  if (LANDPORTAL_PATTERNS.some((p) => p.test(blob))) return 'landportal';
  // CountyOffice and similar marketplace-style aggregators must not pass as
  // official: check explicit marketplace impostors before official patterns.
  if (/\bcountyoffice\.org\b/i.test(blob)) return 'marketplace';
  if (OFFICIAL_PATTERNS.some((p) => p.test(blob))) return 'official';
  if (MARKETPLACE_PATTERNS.some((p) => p.test(blob))) return 'marketplace';
  if (LOCAL_CONTEXT_PATTERNS.some((p) => p.test(blob))) return 'local_context';
  return 'unknown';
}

export interface FactEvidenceInput {
  fact: string;
  value?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  /** Whether the subject parcel's identity is definitively verified. */
  parcelVerified?: boolean;
}

export interface FactEvidenceResult {
  fact: string;
  hasSourceLink: boolean;
  sourceType: SourceType;
  usableForOfferLogic: boolean;
  /** Display label for the fact's confidence/verification state. */
  label: string;
  reasons: string[];
}

/**
 * Evaluate a single fact against the Source Evidence Standard. A fact is
 * offer-usable only when it has a real source link, the parcel is verified, and
 * the source is not merely local context or unknown. A source link can never
 * substitute for parcel-identity verification.
 */
export function evaluateFact(input: FactEvidenceInput): FactEvidenceResult {
  // Only an actual sourceUrl counts as a source link. sourceLabel is purely
  // descriptive: an official-LOOKING label ("County assessor record") with no
  // URL can never make a fact verified or offer-usable.
  const hasSourceLink = hasLink(input.sourceUrl);
  const sourceType = classifySource({ url: input.sourceUrl, label: input.sourceLabel });
  const reasons: string[] = [];

  if (!hasSourceLink) reasons.push('No source link (sourceUrl): not verified, cannot be used for offer logic. A source label alone does not count.');
  if (!input.parcelVerified) reasons.push('Parcel identity not verified: not offer-usable regardless of source.');
  if (sourceType === 'local_context') reasons.push('Local area context only: not parcel-specific verification.');
  if (sourceType === 'unknown' && hasSourceLink) reasons.push('Source type could not be classified as official, LandPortal, or marketplace.');

  const usableForOfferLogic =
    hasSourceLink &&
    !!input.parcelVerified &&
    sourceType !== 'local_context' &&
    sourceType !== 'unknown';

  let label: string;
  if (!hasSourceLink) label = 'unverified / local area context only';
  else if (!input.parcelVerified) label = 'source attached, parcel not verified';
  else if (sourceType === 'official' || sourceType === 'landportal') label = 'verified (source attached)';
  else if (sourceType === 'marketplace') label = 'marketplace source, not official verification';
  else label = 'local area context only';

  return { fact: input.fact, hasSourceLink, sourceType, usableForOfferLogic, label, reasons };
}

// ── Comp output shape ─────────────────────────────────────────────────────

export interface CompInput {
  addressOrLabel?: string;
  price?: number | string;
  saleOrListDate?: string;
  acres?: number | string;
  propertyType?: string;
  sourceUrl?: string;
  whyComparable?: string;
  adjustments?: string;
  parcelVerified?: boolean;
}

export interface CompEvaluation {
  valid: boolean;
  missing: string[];
  sourceType: SourceType;
  usableForOfferLogic: boolean;
}

/** Validate a comp against the required comp output shape and decide offer
 *  usability. Required: address/label, price, source link, why comparable. */
export function evaluateComp(comp: CompInput): CompEvaluation {
  const missing: string[] = [];
  if (!comp.addressOrLabel || !String(comp.addressOrLabel).trim()) missing.push('addressOrLabel');
  if (comp.price === undefined || comp.price === '' || comp.price === null) missing.push('price');
  if (!hasLink(comp.sourceUrl)) missing.push('sourceUrl');
  if (!comp.whyComparable || !comp.whyComparable.trim()) missing.push('whyComparable');
  const sourceType = classifySource({ url: comp.sourceUrl });
  // A comp informs offer logic only with a source link AND a verified subject
  // parcel. Marketplace comps are allowed for comping but still require the
  // verified subject parcel; local-context/unknown links are not offer-usable.
  const usableForOfferLogic =
    missing.length === 0 &&
    !!comp.parcelVerified &&
    sourceType !== 'local_context' &&
    sourceType !== 'unknown';
  return { valid: missing.length === 0, missing, sourceType, usableForOfferLogic };
}

// ── Zoning / subdivision output shape ──────────────────────────────────────

export interface ZoningInput {
  preliminaryAnswer?: string;
  sourceUrl?: string;
  ordinanceRef?: string;
  whatIsVerified?: string;
  whatNeedsCountyConfirmation?: string;
  parcelVerified?: boolean;
}

export interface ZoningEvaluation {
  valid: boolean;
  missing: string[];
  sourceType: SourceType;
  /** Zoning/subdivision facts need an OFFICIAL source to be offer-usable. */
  usableForOfferLogic: boolean;
}

/** Validate a zoning/subdivision fact against the required output shape.
 *  Offer-usable only with an official source and a verified subject parcel. */
export function evaluateZoning(z: ZoningInput): ZoningEvaluation {
  const missing: string[] = [];
  if (!z.preliminaryAnswer || !z.preliminaryAnswer.trim()) missing.push('preliminaryAnswer');
  if (!hasLink(z.sourceUrl)) missing.push('sourceUrl');
  if (!z.whatIsVerified || !z.whatIsVerified.trim()) missing.push('whatIsVerified');
  if (!z.whatNeedsCountyConfirmation || !z.whatNeedsCountyConfirmation.trim()) {
    missing.push('whatNeedsCountyConfirmation');
  }
  const sourceType = classifySource({ url: z.sourceUrl, label: z.ordinanceRef });
  const usableForOfferLogic =
    missing.length === 0 && !!z.parcelVerified && (sourceType === 'official' || sourceType === 'landportal');
  return { valid: missing.length === 0, missing, sourceType, usableForOfferLogic };
}
