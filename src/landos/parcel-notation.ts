// LandOS — jurisdiction-specific parcel NOTATION as raw identity evidence.
//
// A seller lead does not arrive as a normalized APN. It arrives as whatever the
// county, the deed, or the seller's own note calls the parcel:
//
//     Map 042 Parcel 123
//     Tax Map 42 Lot 123
//     Map/Lot 042/123
//     PIN 1234-56-7890
//     Lot 14 Block C
//
// The existing APN normalizer (`intake-normalize.ts`) is deliberately strict: it
// requires a separator-joined numeric token, so "Map 042 Parcel 123" produces NO
// APN at all — the words between the groups defeat the token scanner. That is
// correct for an APN and wrong for identity: the operator DID name a parcel.
//
// This module is the missing middle. It is PURE and it NORMALIZES NOTHING:
//
//   • the raw text is preserved exactly as typed;
//   • the ordered identity groups are extracted for candidate matching;
//   • search phrases are built from the notation as an operator would type it,
//     so the parcel can be looked up in geographic context BEFORE LandOS knows
//     which identifier scheme the jurisdiction actually uses.
//
// It never asserts that a notation IS an APN, and never writes one to a card.
// Deciding what the notation refers to is the resolver's job, from evidence.

export const PARCEL_NOTATION_SCHEMES = [
  'map_group_parcel',
  'map_parcel',
  'map_lot',
  'lot_block',
  'pin',
  'pid',
  'apn',
  'parcel_number',
  'account_number',
  'tax_id',
] as const;
export type ParcelNotationScheme = (typeof PARCEL_NOTATION_SCHEMES)[number];

export interface ParcelNotationPart {
  /** The jurisdiction's own word for this component, lower-cased ("map", "parcel"). */
  label: string;
  /** The value exactly as the operator typed it. */
  value: string;
}

export interface ParcelNotation {
  /** The matched text, verbatim. Never normalized, never rewritten. */
  raw: string;
  scheme: ParcelNotationScheme;
  parts: ParcelNotationPart[];
  /**
   * Ordered identity groups for candidate matching. A dotted value is split, so
   * "123.00" contributes two groups in the order the county prints them.
   */
  groups: string[];
  /**
   * True when the notation on its own names a parcel within a jurisdiction —
   * two or more ordered groups, or a single opaque agency identifier.
   */
  identityBearing: boolean;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

function groupsFrom(values: string[]): string[] {
  return values
    .flatMap((value) => String(value ?? '').split(/[^0-9A-Za-z]+/))
    .map((group) => group.trim())
    .filter(Boolean);
}

interface NotationPattern {
  scheme: ParcelNotationScheme;
  pattern: RegExp;
  build: (match: RegExpMatchArray) => ParcelNotationPart[] | null;
}

/** A component value: numeric with an optional dotted suffix and letter code. */
const G = '[0-9]{1,6}(?:\\.[0-9]{1,4})?[A-Za-z]?';
/** Optional "#", "No.", "Number", "ID" noise between a label and its value. */
const N = '(?:\\s*(?:#|no\\.?|number|num|id))?\\s*[:\\-]?\\s*';

const PATTERNS: NotationPattern[] = [
  // Tennessee-style control map / group / parcel, and its map+parcel subset.
  {
    scheme: 'map_group_parcel',
    pattern: new RegExp(`\\b(?:tax|control)?\\s*map${N}(${G})\\b[\\s,]*group${N}([0-9A-Za-z]{1,3})\\b[\\s,]*(?:parcel|lot)${N}(${G})\\b`, 'gi'),
    build: (m) => [
      { label: 'map', value: m[1] },
      { label: 'group', value: m[2] },
      { label: 'parcel', value: m[3] },
    ],
  },
  {
    scheme: 'map_parcel',
    pattern: new RegExp(`\\b(?:tax|control)?\\s*map${N}(${G})\\b[\\s,]*parcel${N}(${G})\\b`, 'gi'),
    build: (m) => [
      { label: 'map', value: m[1] },
      { label: 'parcel', value: m[2] },
    ],
  },
  {
    scheme: 'map_lot',
    pattern: new RegExp(`\\bmap\\s*[/\\\\]\\s*lot${N}(${G})\\s*[/\\\\\\-]\\s*(${G})\\b`, 'gi'),
    build: (m) => [
      { label: 'map', value: m[1] },
      { label: 'lot', value: m[2] },
    ],
  },
  {
    scheme: 'map_lot',
    pattern: new RegExp(`\\b(?:tax|control)?\\s*map${N}(${G})\\b[\\s,]*lot${N}(${G})\\b`, 'gi'),
    build: (m) => [
      { label: 'map', value: m[1] },
      { label: 'lot', value: m[2] },
    ],
  },
  {
    scheme: 'lot_block',
    pattern: new RegExp(`\\blot${N}([0-9A-Za-z]{1,6})\\b[\\s,]*block${N}([0-9A-Za-z]{1,6})\\b`, 'gi'),
    build: (m) => [
      { label: 'lot', value: m[1] },
      { label: 'block', value: m[2] },
    ],
  },
  // Single-key agency identifiers. The value keeps its own separators.
  {
    scheme: 'pin',
    pattern: /\bpin\s*(?:#|no\.?|number)?\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'pin', value: m[1] }],
  },
  {
    scheme: 'pid',
    pattern: /\bpid\s*(?:#|no\.?|number)?\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'pid', value: m[1] }],
  },
  {
    scheme: 'apn',
    pattern: /\bapn\s*(?:#|no\.?|number)?\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'apn', value: m[1] }],
  },
  {
    scheme: 'parcel_number',
    pattern: /\bparcel\s*(?:#|no\.?|number|id)\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'parcel', value: m[1] }],
  },
  {
    scheme: 'account_number',
    pattern: /\baccount\s*(?:#|no\.?|number|id)?\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'account', value: m[1] }],
  },
  {
    scheme: 'tax_id',
    pattern: /\btax\s*id\s*(?:#|no\.?|number)?\s*[:\-]?\s*([0-9A-Za-z][0-9A-Za-z.\-/ ]{3,30}?)(?=$|[,;\n]|\s{2,}|\s+[A-Za-z]{4,})/gi,
    build: (m) => [{ label: 'tax id', value: m[1] }],
  },
];

/** Two notations are the same claim when their ordered groups are identical. */
function notationKey(notation: ParcelNotation): string {
  return `${notation.groups.map((group) => group.replace(/^0+(?=\d)/, '').toLowerCase()).join('|')}`;
}

/**
 * Every parcel notation in the text, in order of appearance.
 *
 * Overlapping matches are resolved by pattern precedence: a map+group+parcel
 * reading wins over the map+parcel subset inside it, so a Tennessee control-map
 * lead is never silently reduced to a different parcel.
 */
export function extractParcelNotations(text: string | null | undefined): ParcelNotation[] {
  const source = String(text ?? '');
  if (!source.trim()) return [];
  const consumed: Array<{ start: number; end: number }> = [];
  const found: ParcelNotation[] = [];
  const seen = new Set<string>();

  for (const spec of PATTERNS) {
    spec.pattern.lastIndex = 0;
    for (const match of source.matchAll(spec.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (consumed.some((span) => start < span.end && end > span.start)) continue;
      const parts = spec.build(match)?.map((part) => ({ label: part.label, value: clean(part.value) }))
        .filter((part) => part.value.length > 0) ?? null;
      if (!parts || parts.length === 0) continue;
      const groups = groupsFrom(parts.map((part) => part.value));
      if (groups.length === 0) continue;
      const identityBearing = groups.length >= 2
        || (parts.length === 1 && groups[0].length >= 5);
      const notation: ParcelNotation = { raw: clean(match[0]), scheme: spec.scheme, parts, groups, identityBearing };
      const key = notationKey(notation);
      if (seen.has(key)) continue;
      seen.add(key);
      consumed.push({ start, end });
      found.push(notation);
    }
  }
  return found.sort((a, b) => source.indexOf(a.raw) - source.indexOf(b.raw));
}

/** The strongest identity-bearing notation in the text, or null. */
export function primaryParcelNotation(text: string | null | undefined): ParcelNotation | null {
  const all = extractParcelNotations(text);
  return all.find((notation) => notation.identityBearing) ?? all[0] ?? null;
}

function numericKey(group: string): string {
  const trimmed = group.trim().toLowerCase();
  const stripped = trimmed.replace(/^0+(?=.)/, '');
  return stripped.length ? stripped : '0';
}

/**
 * Does a candidate parcel identifier name the parcel this notation names?
 *
 * The candidate's ordered groups must CONTAIN the notation's ordered groups
 * consecutively, starting at the first or second group — the second allows a
 * county/district prefix the notation omits (Tennessee GISLINK "187 042 123.00"
 * for a lead that said "Map 042 Parcel 123"). Trailing groups the county adds
 * (interval, year, interest) are ignored.
 *
 * Comparison is per GROUP and leading-zero insensitive, never substring: "42"
 * matches "042" and never matches "1042" or "4200".
 */
export function parcelNotationMatchesIdentifier(
  notation: ParcelNotation,
  candidate: string | null | undefined,
): boolean {
  const target = groupsFrom([String(candidate ?? '')]);
  const wanted = notation.groups;
  if (wanted.length < 2 || target.length < wanted.length) return false;
  const matchesAt = (offset: number): boolean =>
    wanted.every((group, index) => numericKey(group) === numericKey(target[offset + index] ?? ''));
  for (const offset of [0, 1]) {
    if (offset + wanted.length > target.length) continue;
    if (matchesAt(offset)) return true;
  }
  return false;
}

/**
 * Does a free-text fragment — a search result title, snippet, or URL — mention
 * this notation?
 *
 * Ordered and bounded: every group must appear as a WHOLE number, in the order
 * the county prints them, within a short span of each other. Leading zeros are
 * formatting on both sides. This is a RANKING signal, never proof: it decides
 * which government page is worth opening, and the identity gate still has to
 * pass on the page's own parcel record.
 */
export function textMentionsParcelNotation(notation: ParcelNotation, text: string | null | undefined): boolean {
  const haystack = String(text ?? '');
  if (!haystack.trim() || notation.groups.length < 2) return false;
  const token = (group: string): string => {
    const bare = group.replace(/^0+(?=.)/, '');
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `0*${escaped}`;
  };
  // The gap between groups may carry the county's own words ("Map 042, Parcel
  // 123") but never another NUMBER — that would let a different parcel's digits
  // stand in for one of these.
  const pattern = new RegExp(
    notation.groups.map((group) => `\\b${token(group)}\\b`).join('[^0-9]{1,24}'),
    'i',
  );
  return pattern.test(haystack);
}

/** True when any notation in the set names the candidate identifier. */
export function anyParcelNotationMatches(
  notations: readonly ParcelNotation[],
  candidate: string | null | undefined,
): boolean {
  return notations.some((notation) => parcelNotationMatchesIdentifier(notation, candidate));
}

/**
 * Bounded search phrases for a notation, as an operator would type them.
 *
 * Quoted so a search engine treats "Map 042" as the phrase it is, plus the
 * unpadded spelling (counties print both) and the joined identifier forms a
 * records index is likely to carry. Nothing here is jurisdiction-specific.
 */
export function parcelNotationSearchPhrases(notation: ParcelNotation, limit = 4): string[] {
  const phrases: string[] = [];
  const labelled = (transform: (value: string) => string): string =>
    notation.parts.map((part) => `"${part.label.replace(/\b\w/g, (c) => c.toUpperCase())} ${transform(part.value)}"`).join(' ');
  const unpadded = (value: string): string => value.replace(/^0+(?=\d)/, '');

  phrases.push(labelled((value) => value));
  if (notation.parts.some((part) => /^0\d/.test(part.value))) phrases.push(labelled(unpadded));
  if (notation.groups.length >= 2) {
    phrases.push(`"${notation.groups.join('-')}"`);
    phrases.push(`"${notation.groups.join(' ')}"`);
  }
  return [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))].slice(0, Math.max(1, limit));
}
