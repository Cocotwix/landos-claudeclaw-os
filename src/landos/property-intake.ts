// LandOS public-first property intake.
//
// This module only interprets what the operator supplied. It performs no
// geocoding and never silently repairs an uncertain locality. Authoritative
// sources may later normalize a candidate (for example, "venore" to a different
// municipality), while the raw input and the supplied candidate remain intact.

import { extractApnCandidates, extractZipCandidate } from './intake-normalize.js';

export type IntakeCandidateKind = 'street' | 'city' | 'county' | 'state' | 'zip' | 'apn' | 'owner';
export type IntakeCandidateCertainty = 'supplied' | 'uncertain';

export interface IntakeFieldCandidate {
  kind: IntakeCandidateKind;
  /** Value exactly as interpreted from the operator's text (spacing collapsed). */
  value: string;
  /** Canonical value only when normalization is deterministic (state/ZIP/APN). */
  normalized?: string;
  certainty: IntakeCandidateCertainty;
  reason: string;
}

export interface StructuredPropertyIntake {
  /** Exact operator text. Never trimmed or corrected. */
  rawInput: string;
  /** Whitespace/punctuation-cleaned text used only for parsing/search. */
  searchText: string;
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
  apn?: string;
  apnAlternates: string[];
  parcels: string[];
  owner?: string;
  candidates: IntakeFieldCandidate[];
  /** Text not consumed as property identity. Preserved for later categorization. */
  miscellaneousContext: string[];
  warnings: string[];
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const STATE_CODES = new Set(Object.values(STATE_NAME_TO_ABBR));
const STATE_NAMES = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length);
const STATE_ALT = STATE_NAMES.map(escapeRe).join('|');

const STREET_SUFFIX =
  'street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|' +
  'way|place|pl|highway|hwy|parkway|pkwy|circle|cir|loop|trail|trl|pike|' +
  'terrace|terr|ter|route|rt|cove|cv|crossing|xing|square|sq';
const ROUTE_STREET =
  '(?:(?:(?:old|new|north|south|east|west|n|s|e|w)\\s+)?' +
  '(?:(?:us|u\\.s\\.|state|county|ranch|farm)\\s+)?' +
  '(?:highway|hwy|route|rte|county\\s+road|ranch\\s+road|farm\\s+road|state\\s+road)' +
  '|(?:fm|cr|sr|rr|sh|us)[-\\s]|[a-z]{2}-)\\s*-?\\s*\\d+[A-Za-z]?';
const STREET_RE = new RegExp(
  `\\b(\\d+[A-Za-z]?\\s+(?:${ROUTE_STREET}|[A-Za-z0-9][A-Za-z0-9.'’\\-]*(?:\\s+[A-Za-z0-9][A-Za-z0-9.'’\\-]*)*?\\s+(?:${STREET_SUFFIX})))\\b`,
  'i',
);

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clean(value?: string): string | undefined {
  const v = (value ?? '').replace(/[;,]+$/g, '').replace(/\s+/g, ' ').trim();
  return v || undefined;
}

function findState(text: string): { raw: string; normalized: string; index: number } | undefined {
  const re = new RegExp(`\\b([A-Z]{2}|${STATE_ALT})\\b`, 'gi');
  let found: { raw: string; normalized: string; index: number } | undefined;
  for (const match of text.matchAll(re)) {
    const raw = match[1];
    // Lower-case two-letter prose ("in", "or", "me") is not a state code.
    if (/^[A-Za-z]{2}$/.test(raw) && raw !== raw.toUpperCase()) continue;
    const normalized = raw.length === 2
      ? raw.toUpperCase()
      : STATE_NAME_TO_ABBR[raw.toLowerCase()];
    if (normalized && STATE_CODES.has(normalized)) found = { raw, normalized, index: match.index ?? 0 };
  }
  return found;
}

function findCounty(text: string): string | undefined {
  const labeled = text.match(/\bcounty\s*[:=-]\s*([A-Za-z][A-Za-z .'’\-]{0,60}?)(?=\s*(?:[,;\n]|$))/i)?.[1];
  if (labeled && !/^(?:road|rd|route|highway)$/i.test(labeled.trim())) return clean(labeled);
  return clean(text.match(/\b([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2})\s+County\b/i)?.[1]);
}

function findOwner(text: string): string | undefined {
  return clean(text.match(/\bowner(?:\s+name)?\s*[:=-]\s*([A-Za-z][A-Za-z .'’\-]*?)(?=\s*(?:[,;\n]|\b(?:apn|parcel|county|state|address|acreage|acres)\b|$))/i)?.[1]);
}

function candidate(
  kind: IntakeCandidateKind,
  value: string | undefined,
  normalized: string | undefined,
  certainty: IntakeCandidateCertainty,
  reason: string,
): IntakeFieldCandidate | undefined {
  return value ? { kind, value, ...(normalized ? { normalized } : {}), certainty, reason } : undefined;
}

/**
 * Parse ordinary address/APN/owner property intake without consulting a
 * provider. A city/locality adjacent to a street is kept as an uncertain
 * candidate until a public source confirms it; it is never auto-corrected.
 */
export function parsePropertyIntake(rawInput: string | null | undefined): StructuredPropertyIntake {
  const raw = rawInput ?? '';
  const searchText = raw.replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const stateHit = findState(searchText);
  const zip = extractZipCandidate(searchText);
  const county = findCounty(searchText);
  const owner = findOwner(searchText);
  const apns = extractApnCandidates(searchText);
  const streetMatch = searchText.match(STREET_RE);
  const address = clean(streetMatch?.[1]);
  const candidates: IntakeFieldCandidate[] = [];
  const warnings: string[] = [];

  const streetCandidate = candidate('street', address, address, 'supplied', 'House number, street name, and street suffix were supplied.');
  if (streetCandidate) candidates.push(streetCandidate);

  let city: string | undefined;
  if (address && streetMatch && stateHit) {
    const addressEnd = (streetMatch.index ?? 0) + streetMatch[0].length;
    if (stateHit.index >= addressEnd) {
      const localitySpan = searchText.slice(addressEnd, stateHit.index);
      const between = (zip ? localitySpan.replace(new RegExp(`\\b${escapeRe(zip)}\\b`, 'g'), ' ') : localitySpan)
        .replace(/^\s*(?:in|at|near)\s+/i, '')
        .replace(/^[\s,;.-]+|[\s,;.-]+$/g, '');
      city = clean(between);
      // Never include the street suffix in the locality. ADDRESS_RE ends exactly
      // at "Road"/"Rd", so the live input yields candidate "venore", not
      // "Road venore".
      if (city && !/\bcounty\b/i.test(city)) {
        candidates.push({
          kind: 'city', value: city, certainty: 'uncertain',
          reason: 'Locality text was supplied between the street address and state; authoritative sources must confirm its spelling and jurisdiction.',
        });
        warnings.push(`Locality "${city}" is preserved as supplied and requires source confirmation.`);
      } else {
        city = undefined;
      }
    }
  }

  const countyCandidate = candidate('county', county, county, 'supplied', 'County was explicitly supplied.');
  if (countyCandidate) candidates.push(countyCandidate);
  const stateCandidate = candidate('state', stateHit?.raw, stateHit?.normalized, 'supplied', 'State name or abbreviation was supplied.');
  if (stateCandidate) candidates.push(stateCandidate);
  const zipCandidate = candidate('zip', zip, zip, 'supplied', 'ZIP code was supplied as a standalone postal token.');
  if (zipCandidate) candidates.push(zipCandidate);
  for (const apn of apns.normalized) {
    candidates.push({ kind: 'apn', value: apn.canonical, normalized: apn.digits, certainty: 'supplied', reason: 'Parcel-number-shaped identifier was supplied.' });
  }
  const ownerCandidate = candidate('owner', owner, owner, 'supplied', 'Owner was explicitly labeled.');
  if (ownerCandidate) candidates.push(ownerCandidate);

  const consumed = new Set([address, city, county, stateHit?.raw, zip, owner, ...apns.parcels].filter((v): v is string => !!v));
  const miscellaneousContext = raw
    .split(/\r?\n|;/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => ![...consumed].some((value) => line.toLowerCase() === value.toLowerCase()));

  return {
    rawInput: raw,
    searchText,
    address,
    city,
    county,
    state: stateHit?.normalized,
    zip,
    apn: apns.primary,
    apnAlternates: apns.alternates,
    parcels: apns.parcels,
    owner,
    candidates,
    miscellaneousContext,
    warnings,
  };
}
