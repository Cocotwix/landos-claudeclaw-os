// LandOS — Smart Intake normalization primitives.
//
// Shared, pure, deterministic parsing helpers used by the Smart Intake front
// door and by the existing property parsers (duke-preflight, source-adapters).
// No I/O, no network, no secrets.
//
// ROOT CAUSE this module fixes: field LABELS were being read as VALUES. A pasted
// lead like "Parcel ID: 094-020.08" made the state parser read the "ID" in
// "Parcel ID" as Idaho and drop the real state (Tennessee), and the alternate
// APN in "(094 02008 000)" was silently discarded. Smart Intake must never
// confuse a label ("Parcel ID", "Owner ID", "Tax ID", "GIS ID", "Record ID")
// with an actual state/value, and must normalize every APN it sees into the
// common county formats before declaring a lookup failure.

// Label lead-words that, when immediately followed by an id/no/#/ref suffix,
// form a FIELD LABEL — never a value. Their suffix token ("ID" → Idaho, etc.)
// must never be read as a state code. This is the exact class the prompt calls
// out: Parcel ID, Owner ID, Tax ID, GIS ID, Record ID, Property ID …
const LABEL_LEAD_WORDS = [
  'parcel', 'owner', 'tax', 'gis', 'record', 'property', 'account', 'assessor',
  'zoning', 'deal', 'lead', 'map', 'book', 'page', 'order', 'invoice', 'file',
  'customer', 'member', 'user', 'pin', 'apn', 'lot', 'unit', 'route', 'grid',
  'district', 'subdivision', 'plat', 'geo', 'gps', 'ref', 'reference',
].join('|');

// Suffix tokens that mark the lead-word as a label. "id" is the dangerous one
// (collides with Idaho); the rest are masked for consistency/robustness.
const LABEL_SUFFIXES = 'id|no|no\\.|number|num|#|code|ref|ref\\.';

const LABEL_PHRASE_RE = new RegExp(
  `\\b(?:${LABEL_LEAD_WORDS})\\s*(?:${LABEL_SUFFIXES})\\b`,
  'gi',
);

/**
 * Blank out field-label phrases (e.g. "Parcel ID", "Owner ID", "Tax ID") so a
 * downstream STATE/CITY extractor never mistakes the label's suffix for a value.
 * Replaces each matched label with spaces of equal length, preserving every
 * other character offset (numbers, commas, real state names untouched). The
 * numeric VALUE after the label is left intact, so APN extraction still works
 * on the ORIGINAL text.
 */
export function maskFieldLabels(text: string): string {
  return (text ?? '').replace(LABEL_PHRASE_RE, (m) => ' '.repeat(m.length));
}

export interface NormalizedApn {
  /** The APN as typed, whitespace-collapsed. */
  canonical: string;
  /** Digits (and letters) only, separators stripped. */
  digits: string;
  /** Separator-split numeric/alnum segments. */
  segments: string[];
  /** Common county formats to try before declaring a lookup failure. */
  variants: string[];
}

const MMDDYYYY_RE = /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
// US phone shape (3-3-4, optional +1/area-paren). A pasted phone number from a
// seller text or call transcript must never be mistaken for an APN.
const PHONE_RE = /^(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/;

/**
 * Normalize an APN string into the common county formats. Given "094-020.08"
 * this yields the dash/dot/space/concatenated variants a county search box may
 * expect. Rejects plain street numbers, years, and MM-DD-YYYY dates: requires
 * >= 5 digits AND a parcel separator (so a lone house number is never an APN).
 */
export function normalizeApn(raw: string | null | undefined): NormalizedApn | null {
  const canonical = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!canonical) return null;
  if (MMDDYYYY_RE.test(canonical)) return null;
  if (PHONE_RE.test(canonical)) return null;
  const digits = canonical.replace(/[^0-9A-Za-z]/g, '');
  if (canonical.replace(/[^0-9]/g, '').length < 5) return null;
  const hasSep = /[-./]/.test(canonical) || /\d\s+\d/.test(canonical);
  if (!hasSep) return null;

  const segments = canonical.split(/[\s.\/\-]+/).filter(Boolean);
  const variants = new Set<string>();
  variants.add(canonical);
  variants.add(digits);
  if (segments.length >= 2) {
    variants.add(segments.join(''));   // 09402008
    variants.add(segments.join('-'));  // 094-020-08
    variants.add(segments.join(' '));  // 094 020 08
    variants.add(segments.join('.'));  // 094.020.08
  }
  return { canonical, digits, segments, variants: [...variants] };
}

export interface ApnCandidates {
  /** The strongest APN (labeled first, else the first shaped token). */
  primary?: string;
  /** Additional distinct APN representations found (e.g. a parenthetical alt). */
  alternates: string[];
  /** Union of every normalized variant across primary + alternates. */
  allVariants: string[];
  /** Full normalization record for each distinct APN found. */
  normalized: NormalizedApn[];
}

// Digits + parcel separators only (never letters/street names). Two shapes:
//  - multi-segment with a separator: "094-020.08", "094 02008 000", "16 038 07 001"
//  - a single decimal parcel: "051.05"
const APN_TOKEN_RE = /\b\d{2,6}(?:[ \t]*[.\/\-][ \t]*\d{1,6}|[ \t]+\d{1,6}){1,5}\b/g;
const APN_DECIMAL_RE = /\b\d{2,6}\.\d{1,4}\b/g;

/**
 * Find every APN-shaped token in the text and normalize it. The first LABELED
 * APN ("Parcel ID:", "APN:", "Parcel No:") is the primary; every other distinct
 * parcel representation (by digit string) becomes an alternate. All variants are
 * unioned so a resolver can try each county format before failing.
 */
export function extractApnCandidates(text: string): ApnCandidates {
  const t = text ?? '';

  // Collect every APN-shaped span with its position so fragments contained
  // inside a longer match (e.g. the "020.08" tail of "094-020.08") are dropped.
  type Span = { raw: string; start: number; end: number };
  const spans: Span[] = [];
  for (const m of t.matchAll(APN_TOKEN_RE)) spans.push({ raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (const m of t.matchAll(APN_DECIMAL_RE)) spans.push({ raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  // Longest-at-a-position first, then drop any span fully contained in a kept one.
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: Span[] = [];
  for (const s of spans) {
    if (kept.some((k) => s.start >= k.start && s.end <= k.end)) continue;
    kept.push(s);
  }

  const normalized: NormalizedApn[] = [];
  const seenDigits = new Set<string>();
  for (const s of kept) {
    const n = normalizeApn(s.raw);
    if (!n || seenDigits.has(n.digits)) continue;
    seenDigits.add(n.digits);
    normalized.push(n);
  }

  // Promote the LABELED APN ("Parcel ID:", "APN:") to primary — highest
  // confidence it is truly a parcel number rather than an incidental figure.
  const labeled = t.match(
    /\b(?:apn|parcel(?:\s*(?:id|no|no\.|number|#))?)[:\s]+([0-9][0-9 \t.\/\-]*)/i,
  )?.[1];
  const labeledDigits = labeled ? normalizeApn(labeled)?.digits : undefined;
  if (labeledDigits) {
    const i = normalized.findIndex((n) => n.digits === labeledDigits);
    if (i > 0) normalized.unshift(...normalized.splice(i, 1));
  }

  const primary = normalized[0]?.canonical;
  const alternates = normalized.slice(1).map((n) => n.canonical);
  const allVariants = [...new Set(normalized.flatMap((n) => n.variants))];
  return { primary, alternates, allVariants, normalized };
}
