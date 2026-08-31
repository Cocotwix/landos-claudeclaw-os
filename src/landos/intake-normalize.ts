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
  // A separator proves this is a segmented parcel number rather than a house
  // number or a year. The third clause admits alphanumeric parcel formats whose
  // groups are separated by a LETTER group ("073009G B 03600"), which neither of
  // the first two clauses can see. It requires the WHOLE string to be parcel
  // shaped, so "12345 Main St" is still rejected.
  const hasSep = /[-./]/.test(canonical) || /\d\s+\d/.test(canonical) || APN_SHAPE_RE.test(canonical);
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
  /** EVERY distinct parcel (by canonical digit string) — the lead may reference
   *  more than one parcel. Format variants of a single APN are NOT separate
   *  entries here (those live in each NormalizedApn.variants). Length > 1 means a
   *  genuinely multi-parcel lead that must not collapse into one parcel. */
  parcels: string[];
  /** Union of every normalized variant across primary + alternates. */
  allVariants: string[];
  /** Full normalization record for each distinct APN found. */
  normalized: NormalizedApn[];
}

// Parcel-number shapes. Numeric groups, an OPTIONAL one/two-letter group code
// between them, and an optional trailing letter on a group — because plenty of
// jurisdictions issue alphanumeric parcel numbers (Tennessee's map/group/parcel
// "073009G B 03600" is one). A purely numeric scanner truncated those to their
// first group, which is a DIFFERENT, wrong parcel identifier, not a missing one.
//
// A letter-only segment must be followed by a numeric group, which is what keeps
// ordinary prose and street names ("4713 Sinking Creek Rd") from matching.
const APN_SEPARATOR = '(?:[ \\t]*[.\\/\\-][ \\t]*|[ \\t]+)';
const APN_NUMERIC_GROUP = '\\d{1,6}[A-Za-z]?';
// Middle segments may be numeric OR a short group code, but the token must END
// with a numeric group — that terminator is what stops prose ("Lot 54 B of the
// recorded plat") and street names from ever matching.
const APN_TOKEN_SOURCE = `\\d{2,6}[A-Za-z]?(?:${APN_SEPARATOR}(?:[A-Za-z]{1,2}|${APN_NUMERIC_GROUP})){0,5}${APN_SEPARATOR}${APN_NUMERIC_GROUP}`;
const APN_TOKEN_RE = new RegExp(`\\b${APN_TOKEN_SOURCE}\\b`, 'g');
const APN_SHAPE_RE = new RegExp(`^${APN_TOKEN_SOURCE}$`);
const APN_DECIMAL_RE = /\b\d{2,6}\.\d{1,4}\b/g;

// ── A measurement standing next to a parcel number is not part of it ─────────
// A lead that reads "APN 00083-A-03400 1.5 AC BRADFORD COUNTY, FL" puts an
// acreage figure immediately after the parcel number, and the APN token scanner
// treats a space as a segment separator — so it captured "00083-A-03400 1.5" as
// the parcel identifier. That corrupted identifier then became the Deal's
// canonical APN, and every later comparison was answering the wrong question:
// the subject survey naming 00083-A-03400 read as ANOTHER parcel, the subject
// stayed unresolved, and governing acreage never established. Deal 114 (Bradford
// County, FL) is the acceptance case; the defect is system-wide and affects every
// intake whose parcel number is followed by an acreage.
//
// The rule is deliberately narrow, so it can never truncate a real parcel
// number: the discarded token must be separated from the identifier by
// WHITESPACE (a "-" or "." joins segments INSIDE one parcel number, so
// "094-020.08" is untouched), it must be a plain quantity, and an acreage unit
// must follow it in the source text. Nothing else is removed.
const ACREAGE_UNIT_WORD_RE = /^[ \t]*(?:acs?|acres?)(?![a-z])/i;
// The SAME lead with its line breaks lost runs the unit into the next line:
// "...1.5 ACBRADFORD COUNTY, FL". A case transition from "AC" straight into
// another capitalised word is that signature, and it is deliberately
// case-SENSITIVE so ordinary lowercase prose can never trip it.
const ACREAGE_UNIT_GLUED_RE = /^[ \t]*AC(?=[A-Z])/;
const MEASUREMENT_TOKEN_RE = /^\d{1,4}(?:\.\d{1,4})?$/;
/** The identifier must remain a substantial parcel number after the trim. */
const MIN_REMAINING_APN_DIGITS = 5;

/** Does an acreage unit stand immediately after this span in the source text? */
function acreageUnitFollows(following: string): boolean {
  return ACREAGE_UNIT_WORD_RE.test(following) || ACREAGE_UNIT_GLUED_RE.test(following);
}

/**
 * Split an acreage that was run TOGETHER with the parcel number's last digits.
 *
 * Deal 114's lead lost its line breaks, so "00083-A-03400" and "1.5 AC" arrived
 * as "00083-A-034001.5 AC". The fraction is unambiguous; only the whole part's
 * length is in question, and an acreage whole part is never written with a
 * leading zero ("01.5 acres" is not a thing). The shortest leading-zero-free
 * suffix of the digit run is therefore the measurement, and what precedes it is
 * the parcel number. Returns null when no such split exists.
 */
function splitGluedAcreage(raw: string): string | null {
  const tail = raw.match(/(\d+)\.(\d{1,4})$/);
  if (!tail) return null;
  const digits = tail[1]!;
  for (let take = 1; take < digits.length; take += 1) {
    const whole = digits.slice(digits.length - take);
    if (whole.startsWith('0')) continue;
    const head = raw.slice(0, raw.length - (tail[0]!.length - (digits.length - take)));
    if (head.replace(/[^0-9]/g, '').length < MIN_REMAINING_APN_DIGITS) return null;
    // The parcel number must still end on its own digit run, never mid-separator.
    return /[0-9A-Za-z]$/.test(head) ? head : null;
  }
  return null;
}

/**
 * Drop a trailing acreage figure the span scanner swallowed into an APN.
 * `following` is the source text immediately after the captured span, which is
 * what proves the trailing token is a measurement rather than a parcel segment.
 */
export function dropTrailingMeasurement(raw: string, following: string): string {
  if (!acreageUnitFollows(following)) return raw;
  const split = raw.match(/^(.*\S)[ \t]+(\S+)$/);
  if (split) {
    const [, head, tail] = split as unknown as [string, string, string];
    if (MEASUREMENT_TOKEN_RE.test(tail) && head.replace(/[^0-9]/g, '').length >= MIN_REMAINING_APN_DIGITS) return head;
    return raw;
  }
  return splitGluedAcreage(raw) ?? raw;
}

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
  // `cover` is how much SOURCE TEXT the match consumed; `raw` may be shorter
  // when a swallowed acreage was trimmed off. Containment is judged on cover, so
  // trimming an acreage off a parcel number can never expose that acreage as a
  // second parcel.
  type Span = { raw: string; start: number; end: number; cover: number };
  const spans: Span[] = [];
  for (const m of t.matchAll(APN_TOKEN_RE)) {
    const start = m.index ?? 0;
    const cover = start + m[0].length;
    const raw = dropTrailingMeasurement(m[0], t.slice(cover));
    spans.push({ raw, start, end: start + raw.length, cover });
  }
  for (const m of t.matchAll(APN_DECIMAL_RE)) {
    const start = m.index ?? 0;
    spans.push({ raw: m[0], start, end: start + m[0].length, cover: start + m[0].length });
  }
  // Longest-at-a-position first, then drop any span fully contained in a kept one.
  spans.sort((a, b) => a.start - b.start || (b.cover - b.start) - (a.cover - a.start));
  const kept: Span[] = [];
  for (const s of spans) {
    if (kept.some((k) => s.start >= k.start && s.cover <= k.cover)) continue;
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
  // The value MAY carry a leading alphanumeric district/map prefix (e.g. the
  // Beaufort SC format "R300 018 000 0085 0000", or "0R1 234 567"): the bare
  // \b\d{2,6} span scanner starts at the first digit run and drops that prefix,
  // which corrupts the parcel identity and can raise a FALSE conflict when a
  // parcel-level source returns the full prefixed APN. Capture the optional
  // prefix here so the labeled APN is preserved whole.
  // Trailing separators are sentence punctuation, never part of a parcel number.
  // "Parcel: 015 027 04512 000 2026." must capture the APN, not "…2026." — the
  // trailing period survives into the property card and then defeats the EXACT
  // match an official county/state parcel layer requires, so a genuinely
  // resolvable parcel silently stays provisional.
  const labeledMatch = t.match(
    new RegExp(`\\b(?:apn|parcel(?:\\s*(?:id|no|no\\.|number|#))?)[:\\s]+((?:[A-Za-z]{1,4}\\d{0,6}[ \\t.\\/\\-]+)?${APN_TOKEN_SOURCE})`, 'i'),
  );
  const labeledRaw = labeledMatch?.[1]?.trim().replace(/[\s.\/\-]+$/, '');
  const labeled = labeledRaw
    ? dropTrailingMeasurement(labeledRaw, t.slice((labeledMatch!.index ?? 0) + labeledMatch![0].length))
    : labeledRaw;
  const labeledNorm = labeled ? normalizeApn(labeled) : null;
  if (labeledNorm) {
    // Drop the prefix-stripped fragment the span scanner produced (its digits are
    // a trailing subset of the full labeled APN), then make the full labeled APN
    // the primary — it is the explicitly-labeled parcel number.
    const frag = normalized.findIndex((n) => n.digits !== labeledNorm.digits && labeledNorm.digits.endsWith(n.digits));
    if (frag >= 0) normalized.splice(frag, 1);
    const exact = normalized.findIndex((n) => n.digits === labeledNorm.digits);
    if (exact > 0) normalized.unshift(...normalized.splice(exact, 1));
    else if (exact < 0) normalized.unshift(labeledNorm);
  }

  const primary = normalized[0]?.canonical;
  const alternates = normalized.slice(1).map((n) => n.canonical);
  const parcels = normalized.map((n) => n.canonical);
  const allVariants = [...new Set(normalized.flatMap((n) => n.variants))];
  return { primary, alternates, parcels, allVariants, normalized };
}

// ── ZIP extraction (APN-safe) ────────────────────────────────────────────────
// A ZIP candidate is a standalone 5-digit token. APN SEGMENTS ARE NOT ZIP CODES:
// "002-07637-000" must never yield "07637". The token is rejected when a digit,
// hyphen, or dot touches either side (i.e. it is part of a longer parcel-number
// run), and APN-shaped runs are blanked before matching as a second guard.
export function extractZipCandidate(text: string | null | undefined): string | undefined {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  const cleaned = t.replace(/\b(?!(?:\d{5}-\d{4})$)\d{2,6}(?:[-. ]\d{1,6}){1,2}\b/g, ' ');
  const matches = [...cleaned.matchAll(/(?<![\d-])(\d{5})(?:-\d{4})?(?![\d-]|\.\d)/g)];
  if (!matches.length) return undefined;
  const last = matches[matches.length - 1];
  return last[1];
}
