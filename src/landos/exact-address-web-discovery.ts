import type { AccessEvidenceItem } from './access-evidence-ladder.js';

export const EXACT_ADDRESS_LANE_ID: string = 'exact_address_web';

function canonicalAddress(input: { address: string; city?: string | null; state?: string | null; zip?: string | null }): string {
  return [input.address.trim(), input.city?.trim(), [input.state?.trim(), input.zip?.trim()].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

export function buildExactAddressQueries(input: { address: string; city?: string | null; state?: string | null; zip?: string | null; apn?: string | null }): string[] {
  const address = canonicalAddress(input);
  const queries = [
    address,
    `${address} for sale listing`,
    `${address} listing history prior sale`,
    `${address} access easement driveway`,
  ];
  if (input.apn?.trim()) queries.push(`${address} parcel ${input.apn.trim()}`);
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

export type DiscoveryResultFamily = 'zillow' | 'redfin' | 'realtor' | 'landwatch' | 'land_listing' | 'auction' | 'brokerage' | 'mls_mirror' | 'official_property' | 'planning_permit' | 'cached' | 'other';

export function classifyDiscoveryResult(url: string): { host: string | null; family: DiscoveryResultFamily; propertySpecific: boolean } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { host: null, family: 'other', propertySpecific: false }; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();
  if (host === 'zillow.com' || host.endsWith('.zillow.com')) return { host, family: 'zillow', propertySpecific: /\/homedetails\//.test(path) };
  if (host === 'redfin.com' || host.endsWith('.redfin.com')) return { host, family: 'redfin', propertySpecific: /\/home\/\d+/.test(path) };
  if (host === 'realtor.com' || host.endsWith('.realtor.com')) return { host, family: 'realtor', propertySpecific: /\/realestateandhomes-detail\//.test(path) };
  // LandWatch and land.com address one listing either as /property/... or as a
  // region path ending in the listing's own /pid/<id>; a bare region page has
  // neither and stays non-specific.
  const landListingDetail = /\/property\//.test(path) || /\/listing\//.test(path) || /\/pid\/\d+/.test(path);
  if (host === 'landwatch.com' || host.endsWith('.landwatch.com')) return { host, family: 'land_listing', propertySpecific: landListingDetail };
  if (host === 'land.com' || host.endsWith('.land.com')) return { host, family: 'land_listing', propertySpecific: landListingDetail };
  if (host === 'auction.com' || host.endsWith('.auction.com')) {
    return {
      host,
      family: 'auction',
      propertySpecific: /\/(?:auction-)?details?\//.test(path) || /\/residential\//.test(path) || /\/assetdetail\//.test(path),
    };
  }
  if (/cache|cached|webcache/.test(host)) return { host, family: 'cached', propertySpecific: false };
  if (/mls|homesnap|movoto|trulia/.test(host)) return { host, family: 'mls_mirror', propertySpecific: /\d/.test(path) };
  if (/realty|realtor|properties|broker/.test(host)) return { host, family: 'brokerage', propertySpecific: /\d/.test(path) };
  const locator = `${host}${path}`;
  const hasRecordIdentity = /\d/.test(path) || parsed.search.length > 1;
  if (/assessor|equalization|parcel|property[-_]?search|county.*gis|gis.*county/.test(locator)) {
    return { host, family: 'official_property', propertySpecific: hasRecordIdentity };
  }
  if (/planning|permit|zoning/.test(locator)) {
    return { host, family: 'planning_permit', propertySpecific: hasRecordIdentity };
  }
  // A previously unknown but credible result can still be followed when its URL
  // itself identifies a property detail. The opened page must still pass the
  // exact street + ZIP identity gate before any evidence is retained.
  const genericPropertyDetail = /\/(?:property|listing|home|real-estate|auction|sale|parcel|permit)s?\//.test(path)
    && hasRecordIdentity;
  return { host, family: 'other', propertySpecific: genericPropertyDetail };
}

export interface ListingAccessStatement { text: string; tier: 'reported_legal'; sourceUrl: string; sourceLabel: string }

/**
 * The only listing states LandOS recognises. `unknown` is a real answer: a page
 * that never states its state is never read as active, and absence of a "sold"
 * or "off market" word is never read as evidence that a listing is live.
 */
export type ListingStatusCode = 'active' | 'pending' | 'contingent' | 'sold' | 'off_market' | 'unknown';

export type EngagementAvailability = 'available' | 'unavailable';

/**
 * One provider's published engagement, in that provider's own terms. Every
 * measure carries its own availability so an absent count is rendered as
 * unavailable and NEVER as zero. Nothing here is inferred or back-filled.
 */
export interface ListingEngagementSignal {
  provider: DiscoveryResultFamily;
  sourceLabel: string;
  sourceUrl: string;
  views: number | null;
  saves: number | null;
  viewsAvailability: EngagementAvailability;
  savesAvailability: EngagementAvailability;
  listingAgeDays: number | null;
  listingAgeAvailability: EngagementAvailability;
  photoCount: number | null;
  photoCountAvailability: EngagementAvailability;
  priceChangeCount: number | null;
  priceChangeAvailability: EngagementAvailability;
  /** Engagement is volatile, so even an unavailable observation is time-stamped. */
  retrievedAt: string | null;
}
export interface ExtractedListingEvidence {
  sourceUrl: string; sourceLabel: string; retrievedAt: string | null;
  legalAccessStatements: ListingAccessStatement[];
  drivewayStatements: string[];
  /** Driving-directions wording. Tier-2 apparent-physical support, never legal. */
  directionsStatements: string[];
  /** Street address as the page or its own URL states it, for record identity. */
  streetAddress: string | null;
  /** Parcel/APN as the page states it. Identity evidence, never parcel proof. */
  apn: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  remarks: string[];
  /** The page's own status wording, verbatim. */
  listingStatus: string | null;
  /** That wording normalized into the explicit vocabulary. */
  listingStatusCode: ListingStatusCode;
  currentPrice: number | null;
  priorAskingPrice: number | null;
  originalListPrice: number | null;
  /**
   * Whether the page printed the original list price or LandOS derived it from
   * the current price plus a published reduction. Optional so evidence stored
   * before the distinction existed still parses.
   */
  originalListPriceBasis?: 'published' | 'derived' | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  structures: string[];
  description: string | null;
  features: string[];
  brokerage: string | null;
  listingAgent: string | null;
  mls: string | null;
  listingHistory: Array<{ date: string | null; event: string; price: number | null; isReductionAmount?: boolean }>;
  photoUrls: string[];
  engagement: ListingEngagementSignal | null;
}

const MONEY_SUFFIX_MULTIPLIER: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
/**
 * One shape for every money read on a page: `$1,450,000`, `$1,450,000.00`,
 * `$145K`, `$1.45M`, `$1.2B`. Marketplaces abbreviate and spell out the same
 * kind of figure on the same page, so both are parsed everywhere money is read.
 */
const MONEY_SOURCE = '\\$\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[KkMmBb]?\\b';
const moneyPattern = (flags = ''): RegExp => new RegExp(MONEY_SOURCE, flags);
const moneyValue = (raw: string | null | undefined): number | null => {
  const match = (raw ?? '').trim().match(/^\$?\s?(\d[\d,]*(?:\.\d+)?)\s?([KkMmBb])?\b/);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  return value * (MONEY_SUFFIX_MULTIPLIER[suffix] ?? 1);
};
const numberValue = (raw: string): number | null => {
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};
const firstCapture = (body: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const value = body.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return null;
};
/**
 * Every capture that survives its own field test, in page order.
 *
 * A listing page prints its navigation, its footer and its legal boilerplate
 * through the same words the listing itself uses, so the FIRST match is
 * routinely chrome. Each candidate is cleaned and then has to look like the
 * field it claims to be; when none does, the field stays null. Nothing here
 * invents a value: it only refuses one.
 */
function cleanCapture(
  body: string,
  patterns: RegExp[],
  clean: (raw: string) => string,
  accept: (value: string) => boolean,
): string | null {
  for (const pattern of patterns) {
    const scan = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of body.matchAll(scan)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      const value = clean(raw);
      if (value && accept(value)) return value;
    }
  }
  return null;
}

// ── Page chrome and boilerplate ──────────────────────────────────────────────
// Wording that belongs to the site rather than to the listing. A footer is
// never a brokerage and a nav label is never an agent, so any candidate
// carrying this wording is rejected outright.

const PAGE_CHROME_TERM = new RegExp(
  '\\b(?:terms?\\s+of\\s+use|terms?\\s+(?:and|&)\\s+conditions|privacy|advertis\\w*|contact'
  + '|consumer\\s+protection|dre\\s*#|about\\s+us|builder|notice|sign\\s*[- ]?in|log\\s*[- ]?in'
  + '|cookies?|copyright|all\\s+rights\\s+reserved|fair\\s+housing|accessibility'
  + '|help\\s+cent(?:er|re)|careers|newsletter|subscribe|disclaimer|do\\s+not\\s+sell'
  + '|licens\\w*|all\\s+\\d+\\s+states|equal\\s+housing|\\bidx\\b|mls\\s+grid'
  + '|data\\s+(?:provided|source|deemed)|deemed\\s+reliable|not\\s+guaranteed)\\b',
  'i',
);

/**
 * Page affordances that are capitalised like a proper noun but name a control,
 * not a person or an office ("Appointments Open", "Request A Tour").
 */
const UI_AFFORDANCE_TERM = new RegExp(
  '\\b(?:appointments?|open\\s+house|schedule|showing|request|tour|virtual|directions'
  + '|favou?rites?|save|share|photos?|map|street\\s+view|estimate|calculator'
  + '|get\\s+pre[- ]?qualified|see\\s+all|show\\s+more|read\\s+more'
  + '|what\\s+is\\s+my|home\\s+worth|find\\s+an?\\s+agent|sell(?:ing)?\\s+your'
  + '|my\\s+home|buy\\s+a\\s+home|how\\s+much)\\b',
  'i',
);
/** An office or agent name is short; a footer paragraph is not. */
const OFFICE_NAME_MAX_CHARS = 80;
const OFFICE_NAME_MAX_WORDS = 8;
const NAME_ABBREVIATION = /\b(?:inc|llc|l\.l\.c|co|corp|ltd|assoc|assn|jr|sr|mr|mrs|ms|dr|st|ave|rd|no)\.$/i;

/** The name clause only: a captured office or agent name stops at its sentence. */
function firstNameClause(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim().replace(/^[\s:,\-–]+/, '');
  // A comma is how listings separate the agent from the office ("Kathy
  // Wittbrodt, Wittbrodt Waterside Properties"), so the name clause stops there
  // rather than running the two together.
  const parts = clean.split(/(?<=\.)\s+|\s*[|·•;,]\s*/);
  let value = parts[0] ?? '';
  for (let index = 1; index < parts.length && NAME_ABBREVIATION.test(value); index += 1) {
    value = `${value} ${parts[index]}`;
  }
  return value.replace(/[\s.,:;\-–]+$/, '').trim();
}

/**
 * Wording that identifies a real-estate office even when it is not capitalised
 * the way a proper noun is ("eXp Realty", "@properties ... Real Estate").
 */
const OFFICE_KEYWORD = /\b(?:realty|real\s+estate|realtors?|properties|property\s+group|brokerage|brokers?|group|associates|partners|homes|team|agency|llc|l\.l\.c|inc|corp|company|co)\b/i;

/**
 * Whether a candidate reads like a person and/or office name at all.
 *
 * Rejecting known footer wording is not enough on its own: every site invents
 * its own boilerplate, and a sentence like "licenses in all 50 states and D.C"
 * carries none of the terms above yet is plainly not a brokerage. So a
 * candidate must also LOOK like a name — most of its content words capitalised
 * the way a proper noun is, or an explicit office keyword. A lowercase prose
 * fragment fails both and stays unavailable.
 */
function looksLikeOfficeOrAgentName(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 2 || clean.length > OFFICE_NAME_MAX_CHARS) return false;
  if (PAGE_CHROME_TERM.test(clean)) return false;
  if (UI_AFFORDANCE_TERM.test(clean)) return false;
  if (!/[A-Za-z]{2}/.test(clean) || !/[A-Z]/.test(clean)) return false;
  if (clean.split(/\s+/).length > OFFICE_NAME_MAX_WORDS) return false;
  // Licence and phone strings run digits and symbols together; a name does not.
  // A leading "@" is part of real brand names ("@properties"), so only an "@"
  // inside the value reads as an address or handle.
  if (/#/.test(clean) || /.@/.test(clean) || (clean.match(/\d/g)?.length ?? 0) > 6) return false;
  if (OFFICE_KEYWORD.test(clean)) return true;
  // Proper nouns carry their capitals; prose fragments do not.
  const contentWords = clean.split(/\s+/).filter((word) => /^[A-Za-z][A-Za-z'’.\-]{2,}$/.test(word));
  if (!contentWords.length) return false;
  const capitalised = contentWords.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalised * 2 > contentWords.length;
}

/**
 * An MLS id is digits, optionally with a short alpha prefix or suffix. A bare
 * English word beside the label ("Data", "Source", "Number") is the page's own
 * furniture, never the listing's id.
 */
const MLS_ID_SHAPE = /^(?:[A-Za-z]{1,4}[-_]?)?\d{3,}(?:[-_]?[A-Za-z0-9]{1,4})?$/;
function looksLikeMlsId(value: string): boolean {
  const token = value.trim().replace(/\s+/g, '');
  if (!/\d{3,}/.test(token)) return false;
  return MLS_ID_SHAPE.test(token);
}

/**
 * The per-field test a published value has to pass to be shown at all.
 *
 * ONE table, used by the fresh extraction below AND by every path that merges
 * or projects a value retained earlier. A record stored before a test existed
 * carries its junk with a current `retrievedAt`, so a filter that only ran
 * while parsing a page would never remove it: a value that could not be
 * captured today is not shown today either. Every test only ever REFUSES a
 * value; none of them invents one.
 */
const RETAINED_FIELD_VALIDITY = {
  brokerage: looksLikeOfficeOrAgentName,
  listingAgent: looksLikeOfficeOrAgentName,
  mls: looksLikeMlsId,
} as const;

export type ValidatedListingField = keyof typeof RETAINED_FIELD_VALIDITY;

/** Whether this field may carry this value, wherever the value came from. */
export function isValidListingFieldValue(field: ValidatedListingField, value: string | null | undefined): boolean {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return RETAINED_FIELD_VALIDITY[field](text);
}

/**
 * The same record with every retained value that fails its own field test
 * dropped to null, so the field falls through to the next-best record instead
 * of printing site chrome or a provider-internal id as the subject's own fact.
 */
export function sanitizeRetainedListingRecord(page: ExtractedListingEvidence): ExtractedListingEvidence {
  let cleaned: ExtractedListingEvidence | null = null;
  for (const field of Object.keys(RETAINED_FIELD_VALIDITY) as ValidatedListingField[]) {
    const value = page[field];
    if (value == null || isValidListingFieldValue(field, value)) continue;
    cleaned = cleaned ?? { ...page };
    cleaned[field] = null;
  }
  return cleaned ?? page;
}

const PROPERTY_TYPE_SOURCE = 'vacant land|residential land|undeveloped land|farm|ranch'
  + '|single[- ]family(?: home)?|manufactured home|mobile home|house|townhouse|condo';
/** A dwelling type that cannot describe an acreage parcel. */
const ATTACHED_DWELLING_TYPE = /\b(?:condo|townhouse)\b/i;
const ATTACHED_DWELLING_ACRE_LIMIT = 2;

/**
 * The listing's own engagement region. Providers print views and saves beside
 * the listing age, so that wording is the anchor: a counter far from it belongs
 * to some other block of the page and is not this listing's.
 */
const LISTING_AGE_TERM = new RegExp(
  '\\b(?:\\d[\\d,]*\\s*\\+?\\s*days?\\s+on\\b|days?\\s+on\\s+(?:zillow|market|redfin|realtor|the\\s+market|site)\\b'
  + '|DOM\\b|listed\\s+\\d[\\d,]*\\s+days?\\s+ago\\b|on\\s+market\\s+(?:for|since)\\b|days?\\s+listed\\b|listing\\s+age\\b)',
  'i',
);
const ENGAGEMENT_ANCHOR_WINDOW = 600;

const engagementAnchors = (body: string): number[] =>
  Array.from(body.matchAll(new RegExp(LISTING_AGE_TERM.source, 'gi')), (match) => match.index ?? 0);

/**
 * The count published in the listing's own engagement region, or nothing.
 * The occurrence nearest the listing-age wording wins over any earlier one, and
 * a page that never states its listing age never yields a count at all.
 */
const countValue = (body: string, label: 'views' | 'saves', anchors: readonly number[]): number | null => {
  if (!anchors.length) return null;
  const patterns = [
    new RegExp(`\\b([\\d,]+)\\s+${label}\\b`, 'gi'),
    new RegExp(`\\b${label}\\s*[:\\-]?\\s*([\\d,]+)\\b`, 'gi'),
  ];
  let best: { value: number; distance: number } | null = null;
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const value = numberValue(match[1] ?? '');
      if (value == null) continue;
      const at = match.index ?? 0;
      const distance = Math.min(...anchors.map((anchor) => Math.abs(anchor - at)));
      if (distance > ENGAGEMENT_ANCHOR_WINDOW) continue;
      if (!best || distance < best.distance) best = { value, distance };
    }
  }
  return best?.value ?? null;
};
const sentences = (text: string): string[] => text
  .replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+|[\r\n]+/)
  .map((sentence) => sentence.trim()).filter(Boolean);

// ── Listing status vocabulary ────────────────────────────────────────────────
// Marketplaces express the same state a dozen ways. Every one of them is
// normalized onto exactly six codes, and anything unrecognised stays `unknown`.
// The order matters: "active under contract" is a contingency, not an active
// listing, so the more specific state is always tested first.

const STATUS_VOCABULARY: Array<{ code: Exclude<ListingStatusCode, 'unknown'>; patterns: RegExp[] }> = [
  {
    code: 'contingent',
    patterns: [/\bactive\s+under\s+contract\b/i, /\bcontingent\b/i, /\baccepting\s+back[-\s]?up\s+offers\b/i],
  },
  {
    code: 'pending',
    patterns: [/\bsale\s+pending\b/i, /\bpending\s+sale\b/i, /\bunder\s+contract\b/i, /\boffer\s+accepted\b/i, /\bpending\b/i],
  },
  {
    code: 'sold',
    patterns: [/\bsold\b/i, /\bsale\s+closed\b/i, /\bclosed\s+sale\b/i],
  },
  {
    code: 'off_market',
    patterns: [
      /\boff[\s-]?market\b/i, /\bno\s+longer\s+(?:available|listed|for\s+sale|on\s+the\s+market)\b/i,
      /\bde[\s-]?listed\b/i, /\bwithdrawn\b/i, /\bexpired\b/i, /\bcanc(?:el|ell)ed\b/i,
    ],
  },
  {
    code: 'active',
    patterns: [
      /\bactive\b/i, /\bfor\s+sale\b/i, /\bon\s+the\s+market\b/i, /\bnow\s+available\b/i,
      /\bavailable\s+now\b/i, /\bjust\s+listed\b/i, /\bnew(?:ly)\s+listed\b/i, /\bnew\s+listing\b/i,
      /\blisted\s+for\s+sale\b/i, /\bavailable\s+for\s+purchase\b/i,
    ],
  },
];

const STATUS_LABEL_PATTERN = /(?:listing|home|property|mls|sale)?\s*status\s*[:–-]\s*([A-Za-z][A-Za-z /-]{1,40})/i;

export const LISTING_STATUS_LABEL: Record<ListingStatusCode, string> = {
  active: 'Active',
  pending: 'Pending',
  contingent: 'Contingent',
  sold: 'Sold',
  off_market: 'Off market',
  unknown: 'Unknown',
};

/** Normalizes one status phrase. Unrecognised wording stays `unknown`. */
export function normalizeListingStatus(raw: string | null | undefined): ListingStatusCode {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'unknown';
  for (const entry of STATUS_VOCABULARY) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.code;
  }
  return 'unknown';
}

/**
 * Reads the page's own state. A labeled status is decisive. Without one the
 * EARLIEST status assertion in the page wins, because marketplaces print the
 * live state above the price history: a historical "Sold 06/02/2024" row lower
 * down can never outrank the current state printed at the top.
 */
export function deriveListingStatus(body: string | null | undefined): { code: ListingStatusCode; raw: string | null } {
  const text = body ?? '';
  if (!text.trim()) return { code: 'unknown', raw: null };
  const labeled = text.match(STATUS_LABEL_PATTERN)?.[1]?.trim() ?? null;
  const labeledCode = normalizeListingStatus(labeled);
  if (labeled && labeledCode !== 'unknown') return { code: labeledCode, raw: labeled };
  let best: { code: ListingStatusCode; raw: string; at: number } | null = null;
  for (const entry of STATUS_VOCABULARY) {
    for (const pattern of entry.patterns) {
      const match = text.match(pattern);
      if (!match || match.index == null) continue;
      if (!best || match.index < best.at) best = { code: entry.code, raw: match[0], at: match.index };
    }
  }
  return best ? { code: best.code, raw: best.raw } : { code: 'unknown', raw: null };
}

// ── Record identity primitives ───────────────────────────────────────────────

const STREET_SUFFIX = 'rd|road|st|street|ave|avenue|dr|drive|ln|lane|ct|court|blvd|boulevard'
  + '|way|trl|trail|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|pl|place|route|rte|pike|loop';
const STREET_ADDRESS_PATTERN = new RegExp(
  `\\b(\\d{1,6}[A-Za-z]?\\s+(?:[A-Za-z0-9'.-]+\\s+){0,4}(?:${STREET_SUFFIX})\\b)`,
  'i',
);
const APN_PATTERN = /\b(?:apn|a\.p\.n\.|parcel\s*(?:id|number|no\.?|#)?|tax\s*(?:id|parcel)\s*(?:number|no\.?|#)?|pin)\s*[:#-]?\s*([0-9][0-9A-Za-z][0-9A-Za-z./-]{4,28})\b/i;

const SUFFIX_CANON: Record<string, string> = {
  road: 'rd', street: 'st', avenue: 'ave', drive: 'dr', lane: 'ln', court: 'ct',
  boulevard: 'blvd', trail: 'trl', highway: 'hwy', parkway: 'pkwy', circle: 'cir',
  terrace: 'ter', place: 'pl', route: 'rte',
};
const DIRECTION_CANON: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/** Lowercase, punctuation-free, suffix- and direction-canonical street address. */
export function normalizeStreetAddress(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return null;
  const words = cleaned.split(' ').map((word) => SUFFIX_CANON[word] ?? DIRECTION_CANON[word] ?? word);
  return words.join(' ') || null;
}

/** APN reduced to its alphanumerics. Never establishes parcel identity by itself. */
export function normalizeApn(raw: string | null | undefined): string | null {
  const value = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return value.length >= 5 ? value : null;
}

/** The listing id reduced to its alphanumerics, for cross-feed comparison. */
export function normalizeMlsNumber(raw: string | null | undefined): string | null {
  const value = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return value.length >= 3 ? value : null;
}

/** A photo's stable file identity, so the same image behind two CDNs still matches. */
function photoKey(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return (path.split('/').pop() ?? path).toLowerCase();
}

function streetAddressFromUrl(url: string): string | null {
  let path: string;
  try { path = new URL(url).pathname; } catch { return null; }
  const slug = decodeURIComponent(path).replace(/[-_/]+/g, ' ');
  return slug.match(STREET_ADDRESS_PATTERN)?.[1]?.trim() ?? null;
}

const DIRECTIONS_TERM = /\bdirections?\b|\bturn\s+(?:left|right|north|south|east|west)\b|\bhead\s+(?:north|south|east|west)\b|\b(?:take|follow)\s+(?:[a-z]{1,2}-?\s?\d+|county\s+road)\b|\bmiles?\s+(?:north|south|east|west)\s+of\b/i;

// ── Access wording captured from a listing page ──────────────────────────────
// Many marketplace pages publish their whole detail panel or their entire
// navigation with no sentence punctuation, so "the sentence containing the
// term" is the entire page. Quoting that on the operator's access rung shows
// site furniture as evidence of a drive. Two rules fix it: keep only the clause
// around the matched wording, and refuse a clause that is really navigation.

/** Words either side of the matched term, so the quote stays a clause. */
const ACCESS_CLAUSE_WORDS = 14;

/** Controls a marketplace puts beside a listing, never property description. */
const ACCESS_NAV_TERM = new RegExp(
  '\\b(?:saved\\s+searches?|favou?rites?|co-?shopper|suggestions|add\\s+a\\s+note'
  + '|copy\\s+link|claim\\s+this\\s+home|valuation\\s+report|new\\s+construction'
  + '|building\\s+search|search\\s+new|share\\s+this|street\\s+view|schedule\\s+a'
  + '|request\\s+a|see\\s+all\\s+\\d|photo\\s+gallery|mortgage\\s+calculator)\\b',
  'i',
);

function accessClause(sentence: string, term: RegExp): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  const at = clean.search(term);
  if (at < 0) return clean;
  const before = clean.slice(0, at).split(' ');
  const after = clean.slice(at).split(' ');
  const head = before.slice(Math.max(0, before.length - ACCESS_CLAUSE_WORDS));
  const tail = after.slice(0, ACCESS_CLAUSE_WORDS);
  const clause = [...head, ...tail].join(' ').trim();
  return `${head.length < before.length ? '…' : ''}${clause}${tail.length < after.length ? '…' : ''}`;
}

/**
 * Whether a captured clause actually describes the ground rather than naming
 * the page's own controls ("Driving Directions", "Search", "Save"). A clause
 * carrying site chrome or affordance wording is refused outright: an access
 * rung may only quote wording that describes the property.
 */
function isDescriptiveAccessWording(clause: string): boolean {
  const clean = clause.replace(/^…|…$/g, '').trim();
  if (clean.length < 12) return false;
  if (PAGE_CHROME_TERM.test(clean)) return false;
  // Deliberately NOT the general affordance test: that one rejects the word
  // "directions", which is exactly the wording a real directions field uses.
  if (ACCESS_NAV_TERM.test(clean)) return false;
  return true;
}

// ── Published money on a listing page ────────────────────────────────────────
// A marketplace prints a dozen dollar amounts and exactly one of them is the
// asking price. Every amount is read once, together with the wording pressed up
// against it, so a tax or assessed value, a Zestimate or other automated
// valuation, a monthly payment or rent estimate, a per-unit rate, an HOA fee, a
// down payment or a closing cost can never be promoted into the price the
// operator reads. An amount nobody published stays null; nothing is inferred.

const DATE_SOURCE = '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?';
/** Wording that disqualifies an amount, when it sits within a phrase of it. */
const NEVER_ASKING_BEFORE = new RegExp(
  '\\b(?:tax(?:es|able)?|assessed|assessment|assessor|zestimate|estimate[sd]?|estimated|valuation'
  + '|avm|rent|rental|hoa|association|dues|down\\s*payment|closing\\s*costs?|payment|principal'
  + '|insurance|mortgage|refinanc\\w*|per\\s+(?:month|mo|sq\\.?\\s*ft|sqft|acre|unit))\\b[^.$\\r\\n]{0,20}$',
  'i',
);
/** The same disqualification when the page prints the qualifier after the amount. */
const NEVER_ASKING_AFTER = new RegExp(
  '^\\s*(?:\\/\\s*(?:mo|month|sq\\.?\\s*ft|sqft|ft²|acre|ac|unit|yr|year)\\b'
  + '|per\\s+(?:month|mo|sq\\.?\\s*ft|sqft|acre|unit)\\b'
  + '|(?:est(?:imated)?\\.?\\s+)?(?:rent|monthly|hoa)\\b)',
  'i',
);
/** A label that names this amount as the price being asked right now. */
const CURRENT_PRICE_LABEL = /(?:current\s+price|asking\s+price|list(?:ing)?\s+price|sale\s+price|price|(?:for\s+sale|active)\s+(?:at|for)|offered\s+at)\s*[:\-–]?\s*$/i;
/** The original, which is history rather than the current ask. */
const ORIGINAL_PRICE_LABEL = /\boriginal(?:ly)?\s+(?:list(?:ed|ing)?)?\s*(?:price)?\s*(?:at|for)?\s*[:\-–]?\s*$/i;
/** Where the beds/baths/sqft block starts; the headline price precedes it. */
const LISTING_FACTS_BLOCK = /\b\d[\d,]*(?:\.\d+)?\s*(?:beds?\b|bd\b|baths?\b|ba\b|sq\.?\s*ft\b|sqft\b|square\s+feet\b)/i;
/** Below this an amount is a fee, a rate or a deposit, never an asking price. */
const HEADLINE_PRICE_FLOOR = 1_000;

const LISTED_PATTERN = new RegExp(`\\bListed(?:\\s+on\\s+(${DATE_SOURCE}))?\\s+for\\s+(${MONEY_SOURCE})`, 'gi');
const SOLD_PATTERN = new RegExp(`\\bSold(?:\\s+on)?\\s+(${DATE_SOURCE})(?:\\s+for)?\\s+(${MONEY_SOURCE})`, 'gi');
/**
 * Every way a page publishes a reduction. The wording decides what the amount
 * IS: `reduced to $1,450,000` is the new price, while `Price cut: $145K`,
 * `Price reduced by $145K` and `↓ $145K` are the amount it came down by. A
 * colon or dash after the event word is punctuation, never a reason to miss it.
 */
const PRICE_CUT_PATTERN = new RegExp(
  `(?:\\bprice\\s+(?:cuts?|reduced|reduction|drops?|dropped)|[↓▼])(\\s*[:\\-–])?\\s*(?:(to|by|of)\\s+)?(${MONEY_SOURCE})`
  + `(?:\\s*(?:on\\s+)?\\(?(${DATE_SOURCE})\\)?)?`,
  'gi',
);

/** One published amount, with what the surrounding wording makes of it. */
interface PublishedMoney {
  value: number;
  index: number;
  /** A label immediately before it names it as the current ask. */
  labeled: boolean;
  /** Wording around it proves it is not an asking price at all. */
  excluded: boolean;
}

/**
 * Reads every amount on the page once. Context is bounded by the previous
 * amount, so one figure's qualifier can never bleed onto the next figure.
 */
function scanPublishedMoney(body: string, reductionIndexes: ReadonlySet<number>): PublishedMoney[] {
  const found: PublishedMoney[] = [];
  let previousEnd = 0;
  for (const match of body.matchAll(moneyPattern('g'))) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const before = body.slice(Math.max(previousEnd, index - 48), index);
    const after = body.slice(end, end + 28);
    previousEnd = end;
    const value = moneyValue(match[0]);
    if (value == null) continue;
    const excluded = reductionIndexes.has(index)
      || NEVER_ASKING_BEFORE.test(before)
      || NEVER_ASKING_AFTER.test(after);
    found.push({
      value,
      index,
      labeled: !excluded && CURRENT_PRICE_LABEL.test(before) && !ORIGINAL_PRICE_LABEL.test(before),
      excluded,
    });
  }
  return found;
}

/**
 * The headline ask on a page that publishes no price label. Marketplaces print
 * it bare, beside the status and above the beds/baths/sqft block, so the most
 * prominent surviving amount in that position is the asking price. Only called
 * for a page whose own status says it is on the market.
 */
function headlinePrice(body: string, candidates: PublishedMoney[], statusRaw: string | null): number | null {
  const eligible = candidates.filter((candidate) => !candidate.excluded && candidate.value >= HEADLINE_PRICE_FLOOR);
  if (!eligible.length) return null;
  const factsAt = body.search(LISTING_FACTS_BLOCK);
  const ahead = factsAt >= 0 ? eligible.filter((candidate) => candidate.index < factsAt) : [];
  const pool = ahead.length ? ahead : eligible;
  const statusAt = statusRaw ? body.indexOf(statusRaw) : -1;
  let best: PublishedMoney | null = null;
  for (const candidate of pool) {
    if (!best) { best = candidate; continue; }
    if (statusAt < 0) break;
    if (Math.abs(candidate.index - statusAt) < Math.abs(best.index - statusAt)) best = candidate;
  }
  return best?.value ?? null;
}

export function extractListingEvidence(input: { url: string; sourceLabel?: string | null; title?: string | null; text: string; retrievedAt?: string | null }): ExtractedListingEvidence {
  const body = input.text?.trim() ?? '';
  const parsed = classifyDiscoveryResult(input.url);
  const sourceLabel = input.sourceLabel?.trim() || (parsed.host ?? 'Web listing');
  const allSentences = body ? sentences(body) : [];
  const legal = allSentences.filter((sentence) => /\b(?:legal access|deeded access|easement|right[- ]of[- ]way)\b/i.test(sentence));
  const DRIVEWAY_WORDING = /\b(?:driveway|gravel drive|dirt drive|access drive|private drive)\b/i;
  const driveways = allSentences
    .filter((sentence) => DRIVEWAY_WORDING.test(sentence))
    .map((sentence) => accessClause(sentence, DRIVEWAY_WORDING))
    .filter(isDescriptiveAccessWording);
  const directions = allSentences
    .filter((sentence) => DIRECTIONS_TERM.test(sentence))
    .map((sentence) => accessClause(sentence, DIRECTIONS_TERM))
    .filter(isDescriptiveAccessWording);
  const sqft = body.match(/\b([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square feet)\b/i);
  const acresMatch = body.match(/\b([\d,]+(?:\.\d+)?)\s*(?:acres?|ac\.)\b/i);
  const acres = acresMatch ? numberValue(acresMatch[1]) : null;
  // The type the page states for THIS listing. A labeled type is decisive; a
  // bare match is taken only when it can describe the subject at all, so a
  // "condo" printed elsewhere on an acreage page never becomes the subject's
  // improvement type.
  const statedType = (value: string): boolean =>
    !(ATTACHED_DWELLING_TYPE.test(value) && acres != null && acres >= ATTACHED_DWELLING_ACRE_LIMIT);
  const propertyType = cleanCapture(
    body,
    [
      new RegExp(`\\b(?:property|home|listing|building)\\s*type\\s*[:\\-]?\\s*(${PROPERTY_TYPE_SOURCE})\\b`, 'i'),
      new RegExp(`\\b(${PROPERTY_TYPE_SOURCE})\\b`, 'i'),
    ],
    (raw) => raw.trim(),
    statedType,
  );
  const derivedStatus = deriveListingStatus(body);
  const status = derivedStatus.raw;
  const streetAddress = body.match(STREET_ADDRESS_PATTERN)?.[1]?.trim() ?? streetAddressFromUrl(input.url);
  const apn = body.match(APN_PATTERN)?.[1]?.trim() ?? null;
  const wellMention = /\bwell\b/i.test(body);
  const septicMention = /\bseptic\b/i.test(body);
  const well = !wellMention ? null : /\b(?:no|without|not connected to)\s+(?:a\s+)?well\b/i.test(body) ? false : true;
  const septic = !septicMention ? null : /\b(?:no|without|not connected to)\s+(?:a\s+)?septic\b/i.test(body) ? false : true;
  const utilityCandidates = ['electric', 'electricity', 'power', 'natural gas', 'propane', 'water', 'sewer', 'telephone', 'internet'];
  const utilities = utilityCandidates.filter((utility) => new RegExp(`\\b${utility.replace(' ', '\\s+')}\\b`, 'i').test(body));
  // A reduction row carries either the new price ("reduced to $1,450,000") or
  // the amount it came down ("Price cut: $145K"). Both are retained as the page
  // published them, and the difference is remembered so a cut amount is never
  // read back as the ask.
  const historyRows: Array<{ entry: ExtractedListingEvidence['listingHistory'][number]; reduction: boolean; priceIndex: number }> = [];
  const rowAt = (match: RegExpMatchArray, priceText: string | undefined): number =>
    priceText ? (match.index ?? 0) + match[0].lastIndexOf(priceText) : -1;
  for (const match of body.matchAll(LISTED_PATTERN)) {
    historyRows.push({
      entry: { date: match[1] ?? null, event: 'Listed', price: moneyValue(match[2]) },
      reduction: false,
      priceIndex: rowAt(match, match[2]),
    });
  }
  for (const match of body.matchAll(PRICE_CUT_PATTERN)) {
    const connector = (match[2] ?? '').toLowerCase();
    const reduction = connector !== 'to'
      && (connector === 'by' || connector === 'of' || Boolean(match[1]) || /^[↓▼]/.test(match[0]));
    historyRows.push({
      // The flag travels with the row so the operator surface can say a cut was
      // "by $145,000" rather than stating the reduction as the new asking price.
      entry: { date: match[4] ?? null, event: 'Price cut', price: moneyValue(match[3]), isReductionAmount: reduction },
      reduction,
      priceIndex: rowAt(match, match[3]),
    });
  }
  for (const match of body.matchAll(SOLD_PATTERN)) {
    historyRows.push({
      entry: { date: match[1] ?? null, event: 'Sold', price: moneyValue(match[2]) },
      reduction: false,
      priceIndex: rowAt(match, match[2]),
    });
  }
  const listingHistory: ExtractedListingEvidence['listingHistory'] = historyRows.map((row) => row.entry);
  const reductionIndexes = new Set(historyRows.filter((row) => row.reduction).map((row) => row.priceIndex));
  const publishedMoney = scanPublishedMoney(body, reductionIndexes);
  const priorAskingPrice = listingHistory.find((entry) => entry.event === 'Listed')?.price
    ?? moneyValue(body.match(new RegExp(`\\b(?:asking price|listed at|list price)\\s*[:\\-]?\\s*(${MONEY_SOURCE})`, 'i'))?.[1])
    ?? null;
  // A page that says it is on the market publishes its ask as a bare headline
  // amount as often as it labels one, so the labeled figure is preferred and
  // the headline is read when there is none. Off-market, sold and unknown pages
  // never take a headline: an assessed value is not an asking price.
  const onMarket = derivedStatus.code === 'active' || derivedStatus.code === 'pending' || derivedStatus.code === 'contingent';
  const currentPrice = publishedMoney.find((candidate) => candidate.labeled)?.value
    ?? (onMarket ? headlinePrice(body, publishedMoney, status) : null)
    ?? [...historyRows].reverse().find((row) => !row.reduction && row.entry.price != null)?.entry.price
    ?? priorAskingPrice;
  const publishedOriginal = moneyValue(firstCapture(body, [
    new RegExp(`\\b(?:original list price|originally listed (?:at|for))\\s*[:\\-]?\\s*(${MONEY_SOURCE})`, 'i'),
  ])) ?? listingHistory.find((entry) => entry.event === 'Listed')?.price ?? priorAskingPrice;
  // Nothing published the original, but the page published what it came down
  // by. That arithmetic is the original list price, and it is recorded as
  // derived so it is never read as a figure the page itself printed.
  const reductionAmount = historyRows.find((row) => row.reduction)?.entry.price ?? null;
  const derivedOriginal = publishedOriginal == null && currentPrice != null
    && reductionAmount != null && reductionAmount < currentPrice
    ? currentPrice + reductionAmount
    : null;
  const originalListPrice = publishedOriginal ?? derivedOriginal;
  const originalListPriceBasis: ExtractedListingEvidence['originalListPriceBasis'] = originalListPrice == null
    ? null
    : publishedOriginal != null ? 'published' : 'derived';
  const listingDate = firstCapture(body, [
    /\b(?:listed on|listing date|date listed)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i,
  ]) ?? listingHistory.find((entry) => entry.event === 'Listed')?.date ?? null;
  const domRaw = firstCapture(body, [/\b(\d[\d,]*)\s+(?:days? on (?:zillow|market)|DOM)\b/i, /\b(?:days? on market|DOM)\s*[:\-]?\s*(\d[\d,]*)\b/i]);
  const bedsRaw = firstCapture(body, [/\b([\d.]+)\s*(?:beds?|bd)\b/i, /\b(?:beds?|bedrooms?)\s*[:\-]?\s*([\d.]+)\b/i]);
  const bathsRaw = firstCapture(body, [/\b([\d.]+)\s*(?:baths?|ba)\b/i, /\b(?:baths?|bathrooms?)\s*[:\-]?\s*([\d.]+)\b/i]);
  const yearRaw = firstCapture(body, [/\b(?:year built|built in|built)\s*[:\-]?\s*((?:18|19|20)\d{2})\b/i]);
  // Same clause discipline as the access wording: on a page with no sentence
  // punctuation the "sentence" mentioning a structure is the entire document,
  // which is how the operator's Structures field became a copy of the site.
  const STRUCTURE_WORDING = /\b(?:house|home|barn|garage|shed|cabin|workshop|outbuilding|pole building|structure|improvement)\b/i;
  const structures = allSentences
    .filter((sentence) => STRUCTURE_WORDING.test(sentence))
    .map((sentence) => accessClause(sentence, STRUCTURE_WORDING))
    .filter(isDescriptiveAccessWording);
  const description = firstCapture(body, [
    /\b(?:listing description|property description|public remarks|remarks)\s*[:\-]\s*([^\r\n]{20,1500})/i,
  ]);
  const featureText = firstCapture(body, [/\b(?:property features|features|highlights)\s*[:\-]\s*([^\r\n]{3,1000})/i]);
  const features = featureText ? featureText.split(/[|;,\u2022]/).map((value) => value.trim()).filter(Boolean) : [];
  // The brokerage and agent labels also introduce footers ("Broker services,
  // Consumer protection notice…"), so a candidate is kept only when it reads
  // like an office or person name. Nothing clean means unavailable.
  const brokerage = cleanCapture(body, [
    /\b(?:listed by|listing provided by|brokerage|broker)\s*[:\-]?\s*([^|\r\n]{2,160})/i,
  ], firstNameClause, (value) => isValidListingFieldValue('brokerage', value));
  // A bare "agent" label is page furniture on most marketplaces ("Contact
  // agent", "Agent · Appointments Open"), so the capture is anchored to a
  // wording that actually introduces the person who listed the property.
  const listingAgent = cleanCapture(body, [
    /\b(?:listing agent|listing courtesy of|courtesy of|presented by)\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
  ], firstNameClause, (value) => isValidListingFieldValue('listingAgent', value));
  // One physical subject legitimately carries more than one MLS id, so every
  // record keeps its own. A token that is not shaped like an id is not one.
  const mls = cleanCapture(
    body,
    [/\b(?:MLS(?: ID| #| number)?|source)\s*[:#\-]?\s*([A-Za-z0-9-]{3,30})\b/i],
    (raw) => raw.trim(),
    (value) => isValidListingFieldValue('mls', value),
  );
  const photoUrls = [...new Set(Array.from(body.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi), (match) => match[0]))];
  const REMARK_WORDING = /\b(?:remark|property|parcel|acre|access|driveway|utility|well|septic)\b/i;
  const remarks = allSentences
    .filter((sentence) => REMARK_WORDING.test(sentence))
    .map((sentence) => accessClause(sentence, REMARK_WORDING))
    .filter(isDescriptiveAccessWording);
  const domValue = domRaw == null ? null : numberValue(domRaw);
  // Engagement is published per provider, in that provider's own terms. Zillow
  // always carries a time-stamped signal (its availability is itself the
  // finding); another provider is only recorded when it actually published
  // something. A measure nobody published is null + 'unavailable', never zero.
  const engagement = ((): ListingEngagementSignal | null => {
    const anchors = engagementAnchors(body);
    const views = countValue(body, 'views', anchors);
    const saves = countValue(body, 'saves', anchors);
    const priceEventCount = listingHistory.filter((entry) => entry.price != null).length;
    const availability = (value: number | null): EngagementAvailability => value == null ? 'unavailable' : 'available';
    const published = views != null || saves != null || domValue != null
      || photoUrls.length > 0 || priceEventCount > 0;
    if (parsed.family !== 'zillow' && !published) return null;
    return {
      provider: parsed.family,
      sourceLabel,
      sourceUrl: input.url,
      views,
      saves,
      viewsAvailability: availability(views),
      savesAvailability: availability(saves),
      listingAgeDays: domValue,
      listingAgeAvailability: availability(domValue),
      photoCount: photoUrls.length || null,
      photoCountAvailability: photoUrls.length ? 'available' : 'unavailable',
      priceChangeCount: priceEventCount || null,
      priceChangeAvailability: priceEventCount ? 'available' : 'unavailable',
      retrievedAt: input.retrievedAt?.trim() || null,
    };
  })();
  return {
    sourceUrl: input.url,
    sourceLabel,
    retrievedAt: input.retrievedAt?.trim() || null,
    legalAccessStatements: legal.map((text) => ({ text, tier: 'reported_legal', sourceUrl: input.url, sourceLabel })),
    drivewayStatements: driveways,
    directionsStatements: directions,
    streetAddress,
    apn,
    propertyType,
    buildingSqft: sqft ? numberValue(sqft[1]) : null,
    acres,
    utilities,
    well,
    septic,
    remarks,
    listingStatus: status,
    listingStatusCode: derivedStatus.code,
    currentPrice,
    priorAskingPrice,
    originalListPrice,
    originalListPriceBasis,
    listingDate,
    daysOnMarket: domValue,
    beds: bedsRaw == null ? null : numberValue(bedsRaw),
    baths: bathsRaw == null ? null : numberValue(bathsRaw),
    yearBuilt: yearRaw == null ? null : numberValue(yearRaw),
    structures,
    description,
    features,
    brokerage,
    listingAgent,
    mls,
    listingHistory,
    photoUrls,
    engagement,
  };
}

/**
 * Turns one retained listing record into ladder evidence.
 *
 * Reported legal wording stays on rung 3. Driveway wording, driving directions
 * and the listing's own photography are apparent-physical support on rung 2 and
 * can never promote above it: they are `sourceKind: 'listing'`, so the ladder
 * reads them as a source statement rather than a visual observation, and the
 * ladder's visual-artifact guard is left exactly as it is. The photography item
 * only exists when photo URLs were actually retained, so an absent gallery can
 * never become an observation.
 */
export function listingAccessEvidenceItems(evidence: ExtractedListingEvidence): AccessEvidenceItem[] {
  const items: AccessEvidenceItem[] = evidence.legalAccessStatements.map((statement) => ({
    tier: 'reported_legal',
    statement: statement.text,
    sourceLabel: statement.sourceLabel,
    sourceKind: 'listing',
    basis: 'source_stated',
    weight: 'likely',
    sourceUrl: statement.sourceUrl,
    observedAt: evidence.retrievedAt,
  }));
  const physical = (statement: string, sourceUrl: string): AccessEvidenceItem => ({
    tier: 'apparent_physical',
    statement,
    sourceLabel: evidence.sourceLabel,
    sourceKind: 'listing',
    basis: 'source_stated',
    weight: 'likely',
    sourceUrl,
    observedAt: evidence.retrievedAt,
  });
  // Clause-bounded and re-tested here as well: this is the path that puts
  // wording on the operator's apparent-physical rung, and a record retained
  // before these rules existed must not be able to show site navigation as
  // evidence of a drive.
  for (const driveway of evidence.drivewayStatements) {
    const clause = accessClause(driveway, DRIVEWAY_TERM);
    if (!isDescriptiveAccessWording(clause)) continue;
    items.push(physical(
      `${clause} (listing-reported drive or approach wording; it describes an apparent physical route, never a legal right).`,
      evidence.sourceUrl,
    ));
  }
  for (const direction of evidence.directionsStatements ?? []) {
    const clause = accessClause(direction, DIRECTIONS_TERM);
    if (!isDescriptiveAccessWording(clause)) continue;
    items.push(physical(
      `${clause} (listing-published directions to the property; apparent physical approach only, never a legal right).`,
      evidence.sourceUrl,
    ));
  }
  const photos = evidence.photoUrls ?? [];
  if (photos.length) {
    items.push({
      ...physical(
        `${evidence.sourceLabel} published ${photos.length} listing photograph${photos.length === 1 ? '' : 's'} of this property, retained with the listing. Photography supports apparent physical condition and approach only, never a legal access right.`,
        photos[0],
      ),
      artifactRef: photos[0],
    });
  }
  return items;
}

// ── Retained-record identity and merge ───────────────────────────────────────

/**
 * The identity of one provider RECORD, not one visit. Two reads of the same
 * marketplace page are the same record and merge; a second provider publishing
 * the same physical property is a separate record and is retained alongside it.
 */
export function listingRecordIdentityKey(page: ExtractedListingEvidence): string {
  let host: string | null = null;
  let path = '';
  try {
    const url = new URL(page.sourceUrl);
    host = url.hostname.toLowerCase().replace(/^www\./, '');
    path = url.pathname.toLowerCase().replace(/\/+$/, '');
  } catch {
    return `raw|${page.sourceUrl.trim().toLowerCase()}`;
  }
  // The detail path is the record. It survives a thinner revisit that failed to
  // republish the MLS number, so identity never drifts between two reads.
  if (path.length > 1) return `${host}|${path}`;
  const mls = normalizeMlsNumber(page.mls);
  return mls ? `${host}|mls:${mls}` : `${host}|${page.sourceUrl.trim().toLowerCase()}`;
}

const populatedFieldCount = (page: ExtractedListingEvidence): number => Object.values(page)
  .filter((value) => Array.isArray(value) ? value.length > 0 : value != null && value !== '')
  .length;

/** Fills the fresher record's gaps from the older read of the SAME record. */
function bestOfRecord(fresher: ExtractedListingEvidence, older: ExtractedListingEvidence): ExtractedListingEvidence {
  const merged = { ...fresher } as Record<string, unknown>;
  for (const [key, previous] of Object.entries(older)) {
    const current = merged[key];
    if (Array.isArray(current)) {
      if (current.length === 0 && Array.isArray(previous)) merged[key] = previous;
      continue;
    }
    if (current == null || current === '') merged[key] = previous;
  }
  // Status is a live fact: the fresher read wins unless it never stated one.
  if (fresher.listingStatusCode && fresher.listingStatusCode !== 'unknown') {
    merged.listingStatusCode = fresher.listingStatusCode;
    merged.listingStatus = fresher.listingStatus;
  }
  merged.retrievedAt = fresher.retrievedAt ?? older.retrievedAt;
  return merged as unknown as ExtractedListingEvidence;
}

export interface RetainedRecordMerge {
  pages: ExtractedListingEvidence[];
  newRecordCount: number;
  refreshedRecordCount: number;
  preservedRecordCount: number;
}

/**
 * Merges an incoming visit into the retained set BY RECORD IDENTITY. A revisit
 * that only returns the stale duplicate refreshes that one record and leaves
 * every previously retained record in place as secondary evidence, so good
 * current evidence is never overwritten by a thinner later read.
 */
export function mergeRetainedListingRecords(
  prior: ExtractedListingEvidence[] | null | undefined,
  incoming: ExtractedListingEvidence[] | null | undefined,
): RetainedRecordMerge {
  // Every value on BOTH sides is re-tested here, not only on the fresh side: a
  // retained record re-enters the operator's read through this merge, so a
  // stored value that could not be captured today is dropped to null before it
  // can be preserved, refreshed, or used to fill a gap in the fresher read.
  const retained = new Map<string, ExtractedListingEvidence>();
  for (const page of (prior ?? []).map(sanitizeRetainedListingRecord)) {
    retained.set(listingRecordIdentityKey(page), page);
  }
  let newRecordCount = 0;
  let refreshedRecordCount = 0;
  for (const page of (incoming ?? []).map(sanitizeRetainedListingRecord)) {
    const key = listingRecordIdentityKey(page);
    const existing = retained.get(key);
    if (!existing) { retained.set(key, page); newRecordCount += 1; continue; }
    refreshedRecordCount += 1;
    const existingAt = Date.parse(existing.retrievedAt ?? '');
    const incomingAt = Date.parse(page.retrievedAt ?? '');
    const incomingIsNewer = !Number.isFinite(existingAt)
      || (Number.isFinite(incomingAt) && incomingAt >= existingAt);
    retained.set(key, incomingIsNewer ? bestOfRecord(page, existing) : bestOfRecord(existing, page));
  }
  const pages = [...retained.values()].sort((a, b) => {
    const at = Date.parse(a.retrievedAt ?? '');
    const bt = Date.parse(b.retrievedAt ?? '');
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
    return populatedFieldCount(b) - populatedFieldCount(a);
  });
  return {
    pages,
    newRecordCount,
    refreshedRecordCount,
    preservedRecordCount: Math.max(0, pages.length - newRecordCount - refreshedRecordCount),
  };
}

// ── Operator projection ──────────────────────────────────────────────────────
// The lane already retrieves and extracts. This turns what it retained into the
// operator's read of it, without re-running anything and without promoting a
// listing claim into a verified government or legal fact.

export interface ListingEvidenceSourceView {
  evidenceLabel: 'Listing-reported';
  sourceLabel: string;
  family: DiscoveryResultFamily;
  sourceUrl: string;
  retrievedAt: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  /** Identity evidence this record carries. Never parcel proof on its own. */
  streetAddress: string | null;
  normalizedStreetAddress: string | null;
  apn: string | null;
  /** Latest retained listing event, when the page published a history. */
  listingStatus: string | null;
  listingStatusCode: ListingStatusCode;
  listingStatusLabel: string;
  listingStatusDate: string | null;
  price: number | null;
  originalListPrice: number | null;
  /** Published by the page, or derived from the current price plus a cut. */
  originalListPriceBasis?: 'published' | 'derived' | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  structures: string[];
  description: string | null;
  features: string[];
  brokerage: string | null;
  listingAgent: string | null;
  mls: string | null;
  listingHistory: Array<{ date: string | null; event: string; price: number | null; isReductionAmount?: boolean }>;
  photoUrls: string[];
  engagement: ListingEngagementSignal | null;
  /** Reported legal/easement wording, verbatim. Empty means none was published. */
  accessStatements: string[];
  drivewayStatements: string[];
  directionsStatements: string[];
  /** Says plainly what the page did or did not state about legal access. */
  accessLanguageNote: string;
  provenanceNote: string;
}

/** One retained record's place in the reconciliation, and why it holds it. */
export interface ReconciledRecordRef {
  sourceUrl: string;
  sourceLabel: string;
  family: DiscoveryResultFamily;
  listingStatusCode: ListingStatusCode;
  listingStatusLabel: string;
  retrievedAt: string | null;
  mls: string | null;
  reason: string;
}

/**
 * The operator-readable answer to "are these the same physical property?".
 * Nothing here is hidden: which records were treated as one subject, on what
 * identifiers, which one carried the current state, and why each loser lost.
 */
export interface SubjectReconciliationView {
  /** How many distinct physical subjects the retained records actually describe. */
  subjectCount: number;
  canonical: {
    recordCount: number;
    sourceUrls: string[];
    /** The identifiers that tied the cluster together, in plain words. */
    matchedOn: string[];
    normalizedStreetAddress: string | null;
    apn: string | null;
    /** Every MLS number the one physical subject is published under. */
    mlsNumbers: string[];
    identityNote: string;
  };
  currentRecord: ReconciledRecordRef | null;
  /** Losers inside the canonical subject. Retained, never discarded. */
  supersededRecords: ReconciledRecordRef[];
  /** Records that did not reconcile to the canonical subject at all. */
  otherRecords: ReconciledRecordRef[];
  statement: string;
}

/** Every card field selected across the subject's records rather than off one. */
export type ListingCardFieldKey =
  | 'currentPrice' | 'originalListPrice' | 'listingDate' | 'daysOnMarket' | 'priceChanges'
  | 'mls' | 'brokerage' | 'listingAgent' | 'description' | 'features' | 'acres'
  | 'drivewayStatements' | 'directionsStatements'
  | 'propertyType' | 'buildingSqft' | 'beds' | 'baths' | 'yearBuilt'
  | 'structures' | 'utilities' | 'well' | 'septic';

/**
 * Which retained record actually published one card field. The operator can see
 * that the brokerage came from one provider and the original list price from
 * another, and nothing here ever claims a value came from a record that did not
 * publish it.
 */
export interface ListingCardFieldSource {
  field: ListingCardFieldKey;
  sourceLabel: string;
  sourceUrl: string;
  retrievedAt: string | null;
  /** True when the card's own listing source published this value itself. */
  fromCardSource: boolean;
  /** How many retained records of the same subject published the same value. */
  supportingRecordCount: number;
  note: string;
}

export interface ExactAddressListingEvidenceView {
  status: 'retrieved' | 'none' | 'blocked' | 'error';
  note: string;
  queries: string[];
  retrievedAtIso: string | null;
  sources: ListingEvidenceSourceView[];
  /** Which retained records are one physical subject, and which one is current. */
  reconciliation: SubjectReconciliationView | null;
  /** What the retained listing evidence says the subject IS. */
  subjectRead: {
    improved: boolean;
    buildingSqft: number | null;
    acres: number | null;
    statement: string;
  } | null;
  /** Concise, reconciled operator card. Source detail remains available above. */
  listingCard: {
    /** True only when the reconciled subject's own evidence says active. */
    active: boolean;
    /** Active, pending or contingent: a public listing exists either way. */
    onMarket: boolean;
    statusCode: ListingStatusCode;
    statusLabel: string;
    status: string | null;
    statusNote: string;
    currentPrice: number | null;
    originalListPrice: number | null;
    /** Published by the page, or derived from the current price plus a cut. */
    originalListPriceBasis?: 'published' | 'derived' | null;
    listingDate: string | null;
    daysOnMarket: number | null;
    listingAgeDays: number | null;
    listingAgeBasis: 'reported' | 'derived_from_listing_date' | 'unavailable';
    /** `isReductionAmount` marks a row holding the discount, not the new ask. */
    priceChanges: Array<{ date: string | null; event: string; price: number | null; isReductionAmount?: boolean }>;
    priceHistory: Array<{ date: string | null; event: string; price: number | null; isReductionAmount?: boolean }>;
    acres: number | null;
    mls: string | null;
    /**
     * Whether the card's MLS id is published by more than one retained record.
     * A single-record id is kept, and labeled as reported by that one provider.
     */
    mlsCorroboration: 'corroborated' | 'single_record' | null;
    /** Every MLS id the reconciled subject is published under. */
    mlsNumbers: string[];
    brokerage: string | null;
    listingAgent: string | null;
    description: string | null;
    features: string[];
    drivewayStatements: string[];
    directionsStatements: string[];
    listingUrl: string;
    sourceLabel: string;
    /** Other records of the SAME subject, kept reachable from the card. */
    additionalSourceUrls: string[];
    primaryPhotoUrl: string | null;
    additionalPhotoUrls: string[];
    photoCount: number | null;
    improvementFacts: {
      propertyType: string | null;
      buildingSqft: number | null;
      beds: number | null;
      baths: number | null;
      yearBuilt: number | null;
      structures: string[];
      utilities: string[];
      well: boolean | null;
      septic: boolean | null;
    };
    /** Kept for the Zillow-shaped surfaces. Never the whole engagement story. */
    zillowEngagement: ListingEngagementSignal | null;
    /** Each provider's engagement in its own terms, with its own provenance. */
    engagementByProvider: ListingEngagementSignal[];
    engagementNote: string;
    /** Source labels whose stable facts filled gaps in the current record. */
    supplementedFrom: string[];
    /** Per field, the retained record that actually published the shown value. */
    fieldSources: Partial<Record<ListingCardFieldKey, ListingCardFieldSource>>;
    evidenceLabel: 'Listing-reported';
  } | null;
  disclaimer: string;
}

/**
 * A readable excerpt around the matched wording.
 *
 * Some listing pages publish their whole detail panel with no sentence
 * punctuation, so the extractor's "sentence" is the entire page. Quoting that
 * verbatim buries the operator. The excerpt is centred on the matched term and
 * marked with ellipses so it is never mistaken for the complete statement.
 */
export function listingWordingExcerpt(text: string, term: RegExp, maxChars = 320): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const at = clean.search(term);
  if (at < 0) return `${clean.slice(0, maxChars)}…`;
  const start = Math.max(0, at - Math.floor(maxChars / 2));
  const end = Math.min(clean.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

const ACCESS_TERM = /legal access|deeded access|easement|right[- ]of[- ]way/i;
const DRIVEWAY_TERM = /driveway|gravel drive|dirt drive|access drive|private drive/i;

const LISTING_DISCLAIMER =
  'Listing evidence is reported by the marketplace or brokerage that published it. '
  + 'It is retained at listing-reported confidence and never becomes a verified '
  + 'government, assessor, or recorded-instrument fact. Reported legal access is '
  + 'not a recorded easement.';

// ── Subject reconciliation ───────────────────────────────────────────────────
// Several marketplace records routinely describe ONE physical property: two MLS
// feeds, a syndicated mirror, a stale duplicate. These functions decide which
// records are the same subject, which one holds the current state, and why.

const ON_MARKET_STATUSES: ListingStatusCode[] = ['active', 'contingent', 'pending'];
const TERMINAL_STATUSES: ListingStatusCode[] = ['sold', 'off_market'];

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestEventMs(view: ListingEvidenceSourceView): number | null {
  const dates = [
    ...view.listingHistory.map((entry) => parseDateMs(entry.date)),
    parseDateMs(view.listingStatusDate),
    parseDateMs(view.listingDate),
  ].filter((value): value is number => value != null);
  return dates.length ? Math.max(...dates) : null;
}

/** Positive when `a` is the fresher read of the subject, by event then retrieval. */
function compareFreshness(a: ListingEvidenceSourceView, b: ListingEvidenceSourceView): number {
  const aEvent = latestEventMs(a);
  const bEvent = latestEventMs(b);
  if (aEvent != null && bEvent != null && aEvent !== bEvent) return aEvent - bEvent;
  const aGot = parseDateMs(a.retrievedAt);
  const bGot = parseDateMs(b.retrievedAt);
  if (aGot != null && bGot != null && aGot !== bGot) return aGot - bGot;
  if (aEvent != null && bEvent == null) return 1;
  if (bEvent != null && aEvent == null) return -1;
  return 0;
}

function completeness(view: ListingEvidenceSourceView): number {
  return Object.values(view)
    .filter((value) => Array.isArray(value) ? value.length > 0 : value != null && value !== '')
    .length;
}

const compactText = (value: string | null): string | null => {
  const cleaned = (value ?? '').split('.')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  return cleaned.length >= 3 ? cleaned : null;
};

interface IdentityComparison { strong: string[]; weak: string[]; contradiction: string | null }

/**
 * Practical evidence reconciliation between two records. No identifier is
 * required to be present. A disagreement on a STRONG identity signal (street
 * address or APN) means two different subjects; a different MLS number never
 * does, because two feeds routinely publish one property under two ids.
 */
function compareRecordIdentity(a: ListingEvidenceSourceView, b: ListingEvidenceSourceView): IdentityComparison {
  const strong: string[] = [];
  const weak: string[] = [];
  let contradiction: string | null = null;
  if (a.normalizedStreetAddress && b.normalizedStreetAddress) {
    if (a.normalizedStreetAddress === b.normalizedStreetAddress) strong.push('normalized street address');
    else contradiction = 'the records state different street addresses';
  }
  const aApn = normalizeApn(a.apn);
  const bApn = normalizeApn(b.apn);
  if (aApn && bApn) {
    if (aApn === bApn) strong.push('APN');
    else contradiction = contradiction ?? 'the records state different APNs';
  }
  const aMls = normalizeMlsNumber(a.mls);
  const bMls = normalizeMlsNumber(b.mls);
  if (aMls && bMls && aMls === bMls) strong.push('MLS number');
  const bPhotos = new Set(b.photoUrls.map(photoKey));
  if (a.photoUrls.some((url) => bPhotos.has(photoKey(url)))) strong.push('shared listing photograph');
  const agrees = (x: number | null, y: number | null, tolerance: number): boolean =>
    x != null && y != null && Math.abs(x - y) <= tolerance;
  if (agrees(a.acres, b.acres, Math.max(0.5, (a.acres ?? 0) * 0.02))) weak.push('acreage');
  if (agrees(a.beds, b.beds, 0)) weak.push('beds');
  if (agrees(a.baths, b.baths, 0)) weak.push('baths');
  if (agrees(a.buildingSqft, b.buildingSqft, Math.max(50, (a.buildingSqft ?? 0) * 0.02))) weak.push('building sqft');
  if (agrees(a.yearBuilt, b.yearBuilt, 0)) weak.push('year built');
  if (compactText(a.brokerage) && compactText(a.brokerage) === compactText(b.brokerage)) weak.push('brokerage');
  if (compactText(a.listingAgent) && compactText(a.listingAgent) === compactText(b.listingAgent)) weak.push('listing agent');
  const aListed = parseDateMs(a.listingDate);
  if (aListed != null && aListed === parseDateMs(b.listingDate)) weak.push('listing date');
  return { strong, weak, contradiction };
}

interface SubjectCluster { members: ListingEvidenceSourceView[]; matchedOn: Set<string> }

/** Agreement on any strong identifier, or on three weaker ones, with no contradiction. */
function clusterSubjectRecords(sources: ListingEvidenceSourceView[]): SubjectCluster[] {
  const clusters: SubjectCluster[] = [];
  for (const source of sources) {
    let placed = false;
    for (const cluster of clusters) {
      const comparisons = cluster.members.map((member) => compareRecordIdentity(source, member));
      if (comparisons.some((comparison) => comparison.contradiction)) continue;
      const matches = comparisons.filter((comparison) => comparison.strong.length >= 1 || comparison.weak.length >= 3);
      if (!matches.length) continue;
      cluster.members.push(source);
      for (const match of matches) {
        for (const signal of match.strong.length ? match.strong : match.weak) cluster.matchedOn.add(signal);
      }
      placed = true;
      break;
    }
    if (!placed) clusters.push({ members: [source], matchedOn: new Set<string>() });
  }
  return clusters;
}

/**
 * One provider, one engagement signal. `Zillow` and `zillow.com` are the same
 * counter read from the same host, and rendering both is the operator seeing
 * one measure twice. The read carrying the most published measures wins, and
 * position in the retained order is preserved.
 */
function dedupeEngagementByHost(signals: ListingEngagementSignal[]): ListingEngagementSignal[] {
  const measured = (signal: ListingEngagementSignal): number => [
    signal.viewsAvailability, signal.savesAvailability, signal.listingAgeAvailability,
    signal.photoCountAvailability, signal.priceChangeAvailability,
  ].filter((availability) => availability === 'available').length;
  const byHost = new Map<string, ListingEngagementSignal>();
  for (const signal of signals) {
    const host = classifyDiscoveryResult(signal.sourceUrl).host;
    const key = (host ?? signal.provider ?? signal.sourceLabel ?? '').toLowerCase();
    const held = byHost.get(key);
    if (!held || measured(signal) > measured(held)) byHost.set(key, signal);
  }
  return [...byHost.values()];
}

const propertyTypeKey = (value: string): string => value.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/**
 * The improvement type the retained records actually corroborate. The type most
 * records state wins, ties go to the record carrying the current state, and a
 * type the subject's own facts contradict is dropped: a parcel published in
 * acres is not a condo, however many times the page prints the word.
 */
function corroboratedPropertyType(
  members: ListingEvidenceSourceView[],
  current: ListingEvidenceSourceView | null,
  acres: number | null,
): string | null {
  const counts = new Map<string, { raw: string; count: number; fromCurrent: boolean }>();
  for (const member of members) {
    const raw = member.propertyType?.trim();
    if (!raw) continue;
    if (ATTACHED_DWELLING_TYPE.test(raw) && acres != null && acres >= ATTACHED_DWELLING_ACRE_LIMIT) continue;
    const key = propertyTypeKey(raw);
    const held = counts.get(key);
    if (held) {
      held.count += 1;
      held.fromCurrent = held.fromCurrent || member === current;
    } else {
      counts.set(key, { raw, count: 1, fromCurrent: member === current });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || Number(b.fromCurrent) - Number(a.fromCurrent))[0]?.raw ?? null;
}

function recordRef(view: ListingEvidenceSourceView, reason: string): ReconciledRecordRef {
  return {
    sourceUrl: view.sourceUrl,
    sourceLabel: view.sourceLabel,
    family: view.family,
    listingStatusCode: view.listingStatusCode,
    listingStatusLabel: view.listingStatusLabel,
    retrievedAt: view.retrievedAt,
    mls: view.mls,
    reason,
  };
}

export function projectExactAddressListingEvidence(result: {
  status: ExactAddressListingEvidenceView['status'];
  note?: string;
  queries?: string[];
  pages?: ExtractedListingEvidence[];
} | null | undefined): ExactAddressListingEvidenceView | null {
  if (!result) return null;
  // Retained evidence is re-tested on the way out as well as on the way in, so
  // a value stored before its field test existed is not projected today.
  const pages = (result.pages ?? []).map(sanitizeRetainedListingRecord);
  const sources: ListingEvidenceSourceView[] = pages.map((page) => {
    const classification = classifyDiscoveryResult(page.sourceUrl);
    const latest = [...(page.listingHistory ?? [])]
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .pop() ?? null;
    const accessStatements = page.legalAccessStatements
      .map((statement) => listingWordingExcerpt(statement.text, ACCESS_TERM));
    const listingStatus = page.listingStatus ?? latest?.event ?? null;
    // Evidence persisted before the vocabulary existed is normalized on read,
    // so an old row is reconciled on the same terms as a fresh one.
    const listingStatusCode = page.listingStatusCode ?? normalizeListingStatus(listingStatus);
    const engagement = page.engagement
      ? {
        ...page.engagement,
        provider: page.engagement.provider ?? classification.family,
        sourceLabel: page.engagement.sourceLabel ?? page.sourceLabel,
        sourceUrl: page.engagement.sourceUrl ?? page.sourceUrl,
        // An absent measure is unavailable, never zero, whatever the stored shape said.
        viewsAvailability: page.engagement.views == null ? 'unavailable' as const : 'available' as const,
        savesAvailability: page.engagement.saves == null ? 'unavailable' as const : 'available' as const,
        listingAgeDays: page.engagement.listingAgeDays ?? null,
        listingAgeAvailability: page.engagement.listingAgeDays == null ? 'unavailable' as const : 'available' as const,
        photoCount: page.engagement.photoCount ?? (page.photoUrls?.length || null),
        photoCountAvailability: (page.engagement.photoCount ?? page.photoUrls?.length ?? 0) > 0
          ? 'available' as const : 'unavailable' as const,
        priceChangeCount: page.engagement.priceChangeCount ?? null,
        priceChangeAvailability: (page.engagement.priceChangeCount ?? 0) > 0
          ? 'available' as const : 'unavailable' as const,
      }
      : classification.family === 'zillow'
        ? {
          provider: 'zillow' as const,
          sourceLabel: page.sourceLabel,
          sourceUrl: page.sourceUrl,
          views: null,
          saves: null,
          viewsAvailability: 'unavailable' as const,
          savesAvailability: 'unavailable' as const,
          listingAgeDays: null,
          listingAgeAvailability: 'unavailable' as const,
          photoCount: page.photoUrls?.length || null,
          photoCountAvailability: (page.photoUrls?.length ?? 0) > 0 ? 'available' as const : 'unavailable' as const,
          priceChangeCount: null,
          priceChangeAvailability: 'unavailable' as const,
          retrievedAt: page.retrievedAt,
        }
        : null;
    const streetAddress = page.streetAddress ?? streetAddressFromUrl(page.sourceUrl);
    return {
      evidenceLabel: 'Listing-reported' as const,
      sourceLabel: page.sourceLabel,
      family: classification.family,
      sourceUrl: page.sourceUrl,
      retrievedAt: page.retrievedAt,
      propertyType: page.propertyType,
      buildingSqft: page.buildingSqft,
      acres: page.acres,
      streetAddress,
      normalizedStreetAddress: normalizeStreetAddress(streetAddress),
      apn: page.apn ?? null,
      listingStatus,
      listingStatusCode,
      listingStatusLabel: LISTING_STATUS_LABEL[listingStatusCode],
      listingStatusDate: latest?.date ?? null,
      price: page.currentPrice ?? page.priorAskingPrice,
      originalListPrice: page.originalListPrice ?? page.priorAskingPrice,
      originalListPriceBasis: page.originalListPrice != null
        ? page.originalListPriceBasis ?? 'published'
        : page.priorAskingPrice != null ? 'published' : null,
      listingDate: page.listingDate ?? null,
      daysOnMarket: page.daysOnMarket ?? null,
      beds: page.beds ?? null,
      baths: page.baths ?? null,
      yearBuilt: page.yearBuilt ?? null,
      utilities: page.utilities,
      well: page.well,
      septic: page.septic,
      structures: page.structures ?? [],
      description: page.description ?? null,
      features: page.features ?? [],
      brokerage: page.brokerage ?? null,
      listingAgent: page.listingAgent ?? null,
      mls: page.mls ?? null,
      listingHistory: page.listingHistory ?? [],
      photoUrls: page.photoUrls ?? [],
      engagement,
      accessStatements,
      // Clause-bounded and re-tested on the read path, so a record retained
      // before these rules existed cannot put site navigation on an access rung
      // today. Same principle as the other retained-field validity tests.
      drivewayStatements: page.drivewayStatements
        .map((text) => accessClause(text, DRIVEWAY_TERM))
        .filter(isDescriptiveAccessWording),
      directionsStatements: (page.directionsStatements ?? [])
        .map((text) => accessClause(text, DIRECTIONS_TERM))
        .filter(isDescriptiveAccessWording),
      accessLanguageNote: accessStatements.length
        ? `This page states access or easement wording, retained verbatim as reported legal access. It is not a recorded instrument.`
        : 'This page published no legal-access or easement wording, so reported legal access stays unresolved from it.',
      provenanceNote: `Retrieved from ${page.sourceLabel}${page.retrievedAt ? ` on ${page.retrievedAt.slice(0, 10)}` : ''} by exact-address web discovery.`,
    };
  });

  const clusters = clusterSubjectRecords(sources);
  // One physical subject stays one canonical subject: the largest cluster, then
  // the one whose records are actually on the market, then the freshest.
  const canonical = [...clusters].sort((a, b) => {
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    const aOnMarket = a.members.some((m) => ON_MARKET_STATUSES.includes(m.listingStatusCode)) ? 1 : 0;
    const bOnMarket = b.members.some((m) => ON_MARKET_STATUSES.includes(m.listingStatusCode)) ? 1 : 0;
    if (aOnMarket !== bOnMarket) return bOnMarket - aOnMarket;
    return (parseDateMs(b.members[0].retrievedAt) ?? 0) - (parseDateMs(a.members[0].retrievedAt) ?? 0);
  })[0] ?? null;
  const canonicalMembers = canonical?.members ?? [];

  const statusRank = (view: ListingEvidenceSourceView): number => view.listingStatusCode === 'active' ? 4
    : view.listingStatusCode === 'contingent' ? 3
      : view.listingStatusCode === 'pending' ? 2
        : view.listingStatusCode === 'unknown' ? 1 : 0;
  const byCurrency = (a: ListingEvidenceSourceView, b: ListingEvidenceSourceView): number => {
    const fresher = compareFreshness(b, a);
    if (fresher !== 0) return fresher;
    return completeness(b) - completeness(a);
  };

  const onMarketMembers = canonicalMembers.filter((m) => ON_MARKET_STATUSES.includes(m.listingStatusCode));
  let current: ListingEvidenceSourceView | null = [...(onMarketMembers.length ? onMarketMembers : canonicalMembers)]
    .sort((a, b) => statusRank(b) - statusRank(a) || byCurrency(a, b))[0] ?? null;
  let currentReason = !current
    ? ''
    : onMarketMembers.length
      ? `This record's own evidence reports the subject ${current.listingStatusLabel.toLowerCase()}, and no fresher record for the same subject contradicts it.`
      : 'No retained record for this subject reports an on-market state, so the freshest retained record carries the subject state and the status is not upgraded.';
  if (current && onMarketMembers.length) {
    // A supported active record still loses to a STRONGER, FRESHER record that
    // says the listing left the market. A later SCRAPE alone never demotes it:
    // the terminal record must carry a dated listing event that post-dates the
    // active record's, otherwise a revisit that happened to return only the
    // stale duplicate would silently take the subject off the market.
    const activeEventMs = latestEventMs(current);
    const activeRetrievedMs = parseDateMs(current.retrievedAt);
    const fresherTerminal = canonicalMembers.filter((member) => {
      if (!TERMINAL_STATUSES.includes(member.listingStatusCode)) return false;
      const terminalEventMs = latestEventMs(member);
      if (terminalEventMs == null) return false;
      const terminalRetrievedMs = parseDateMs(member.retrievedAt);
      if (terminalRetrievedMs != null && activeRetrievedMs != null && terminalRetrievedMs < activeRetrievedMs) return false;
      return activeEventMs == null || terminalEventMs > activeEventMs;
    });
    if (fresherTerminal.length) {
      current = [...fresherTerminal].sort(byCurrency)[0];
      currentReason = `A later record for the same subject reports it ${current.listingStatusLabel.toLowerCase()}, which supersedes the older on-market record.`;
    }
  }

  const supersededRecords = canonicalMembers
    .filter((member) => member !== current)
    .map((member) => recordRef(member, TERMINAL_STATUSES.includes(member.listingStatusCode) && current && ON_MARKET_STATUSES.includes(current.listingStatusCode)
      ? `Superseded: this record reports a stale ${member.listingStatusLabel.toLowerCase()} state while a supported ${current.listingStatusLabel.toLowerCase()} record for the same physical subject is fresher.`
      : `Superseded: a duplicate record for the same physical subject carrying older or less complete evidence than ${current?.sourceLabel ?? 'the current record'}. Retained as secondary evidence.`));
  const otherRecords = sources
    .filter((source) => !canonicalMembers.includes(source))
    .map((source) => recordRef(source, 'Not reconciled to the canonical subject: its street address or APN disagrees, or nothing tied it to the subject cluster. Retained separately, never merged into the subject.'));

  // An MLS number issued by an MLS is digits. A marketplace's own internal id
  // ("T062626") passes the id shape test and stays retained on its record as
  // evidence, but presenting it in the operator's MLS NUMBER line would state
  // it as an MLS number, which it is not. Only real MLS numbers are listed
  // there; if the subject publishes none, the retained ids still stand behind
  // the reconciliation detail.
  const retainedMls = [...new Set(canonicalMembers.map((m) => m.mls).filter((v): v is string => !!v))];
  const issuedMls = retainedMls.filter((value) => /^\d+$/.test((normalizeMlsNumber(value) ?? '').trim()));
  const canonicalMls = issuedMls.length ? issuedMls : retainedMls;
  const matchedOn = [...(canonical?.matchedOn ?? [])];
  const reconciliation: SubjectReconciliationView | null = sources.length
    ? {
      subjectCount: clusters.length,
      canonical: {
        recordCount: canonicalMembers.length,
        sourceUrls: canonicalMembers.map((m) => m.sourceUrl),
        matchedOn,
        normalizedStreetAddress: canonicalMembers.map((m) => m.normalizedStreetAddress).find(Boolean) ?? null,
        apn: canonicalMembers.map((m) => m.apn).find(Boolean) ?? null,
        mlsNumbers: canonicalMls,
        identityNote: canonicalMembers.length > 1
          ? `${canonicalMembers.length} retained records were reconciled to ONE physical subject on ${matchedOn.length ? matchedOn.join(', ') : 'corroborating listing facts'}${canonicalMls.length > 1 ? `; the same property is published under MLS ${canonicalMls.join(' and ')}` : ''}.`
          : 'One retained record describes this subject, so no cross-record reconciliation was required.',
      },
      currentRecord: current ? recordRef(current, currentReason) : null,
      supersededRecords,
      otherRecords,
      statement: current
        ? `${canonicalMembers.length} retained record(s) describe one physical subject; ${current.sourceLabel} carries the current ${current.listingStatusLabel.toLowerCase()} state.`
          + (supersededRecords.length ? ` ${supersededRecords.length} duplicate record(s) are retained as superseded evidence.` : '')
          + (otherRecords.length ? ` ${otherRecords.length} retained record(s) did not reconcile to this subject.` : '')
        : 'No retained record could be reconciled into a canonical subject.',
    }
    : null;

  const factBase = canonicalMembers.length ? canonicalMembers : sources;
  const sqfts = factBase.map((s) => s.buildingSqft).filter((v): v is number => typeof v === 'number' && v > 0);
  const acreages = factBase.map((s) => s.acres).filter((v): v is number => typeof v === 'number' && v > 0);
  const buildingSqft = sqfts.length ? Math.max(...sqfts) : null;
  const acres = acreages.length ? Math.max(...acreages) : null;
  const improvedTypes = factBase
    .map((s) => s.propertyType)
    .filter((t): t is string => !!t && !/vacant|undeveloped|residential land/i.test(t))
    .filter((t) => !(ATTACHED_DWELLING_TYPE.test(t) && acres != null && acres >= ATTACHED_DWELLING_ACRE_LIMIT));
  const improved = sqfts.length > 0 || improvedTypes.length > 0;

  const subjectRead = sources.length
    ? {
      improved,
      buildingSqft,
      acres,
      statement: improved
        ? `Retained listing evidence describes an improved property${buildingSqft != null ? ` of approx. ${buildingSqft.toLocaleString('en-US')} sqft` : ''}${acres != null ? ` on ${acres} acres` : ''}${improvedTypes.length ? ` (${[...new Set(improvedTypes)].join(', ')})` : ''}. Listing-reported, not an assessor record.`
        : `Retained listing evidence describes${acres != null ? ` ${acres} acres` : ' the property'} without a published structure. Listing-reported, not an assessor record.`,
    }
    : null;

  // The card's identity stays the card source's: its URL, its label, and the
  // reconciled status it carries. Every OTHER field is selected across the whole
  // canonical subject, because the subject's own evidence routinely publishes
  // the clean brokerage on one record and the original list price on another.
  const supplements = current
    ? canonicalMembers.filter((member) => member !== current).sort(byCurrency)
    : [];
  const cardMembers = current ? [current, ...supplements] : [];
  const supplementedFrom = new Set<string>();
  const fieldSources: Partial<Record<ListingCardFieldKey, ListingCardFieldSource>> = {};
  const present = (value: unknown): boolean => Array.isArray(value)
    ? value.length > 0
    : value != null && value !== '';

  interface FieldPick<T> { value: T; from: ListingEvidenceSourceView; support: number }

  /**
   * The best value the subject actually publishes for one field.
   *
   * The card source's own value wins whenever it is present and valid, so a
   * differing asking price across records is resolved in favour of the record
   * carrying the current status rather than blended or overwritten. Otherwise
   * the value the most records support wins, then the freshest read of it. An
   * MLS id inverts that order: corroboration outranks the card source, and a
   * single-record id survives labeled as reported by that one provider.
   */
  const pickField = <T>(
    field: ListingCardFieldKey,
    read: (member: ListingEvidenceSourceView) => T,
    options: { key?: (value: T) => string; corroborationFirst?: boolean; rank?: (value: T) => number } = {},
  ): FieldPick<T> | null => {
    const identity = options.key ?? ((value: T) => JSON.stringify(value));
    const candidates = cardMembers.filter((member) => present(read(member)));
    if (!candidates.length) return null;
    const support = new Map<string, number>();
    for (const member of candidates) {
      const key = identity(read(member));
      support.set(key, (support.get(key) ?? 0) + 1);
    }
    const supportOf = (member: ListingEvidenceSourceView): number => support.get(identity(read(member))) ?? 1;
    const cardBonus = (member: ListingEvidenceSourceView): number => member === current ? 1 : 0;
    // A field may state that some published values are stronger than others
    // regardless of which record carries them; nothing here invents a value.
    const rankOf = (member: ListingEvidenceSourceView): number => options.rank
      ? options.rank(read(member))
      : 0;
    const ranked = [...candidates].sort((a, b) => rankOf(b) - rankOf(a)
      || (options.corroborationFirst
        ? supportOf(b) - supportOf(a) || cardBonus(b) - cardBonus(a)
        : cardBonus(b) - cardBonus(a) || supportOf(b) - supportOf(a))
      || compareFreshness(b, a)
      || completeness(b) - completeness(a));
    const chosen = ranked[0];
    if (chosen !== current) supplementedFrom.add(chosen.sourceLabel);
    const supportingRecordCount = supportOf(chosen);
    fieldSources[field] = {
      field,
      sourceLabel: chosen.sourceLabel,
      sourceUrl: chosen.sourceUrl,
      retrievedAt: chosen.retrievedAt,
      fromCardSource: chosen === current,
      supportingRecordCount,
      note: `Published by ${chosen.sourceLabel}`
        + (chosen === current ? ', the card\'s own listing source' : ', another retained record for the same subject')
        + (supportingRecordCount > 1
          ? `, and corroborated by ${supportingRecordCount} retained records.`
          : ' only, and reported by that one provider.'),
    };
    return { value: read(chosen), from: chosen, support: supportingRecordCount };
  };

  // The asking price is corroboration-first. Marketplaces that mirror an MLS
  // feed also publish rent and payment estimates on the same page, so a single
  // record can report $1,500 for a $1,450,000 property. When the subject's own
  // records disagree, the figure the most of them publish wins over whichever
  // record happens to be the card source. A price reported by exactly one
  // record still stands when it is the only one published — this only ever
  // chooses between values the subject actually published.
  // Objective measures are corroboration-first: where the subject's records
  // disagree on a figure, the one most of them publish is the better read of
  // the property than whichever record happens to be the card source.
  const measure = { key: (value: unknown) => String(value ?? ''), corroborationFirst: true };
  const pickedPrice = pickField('currentPrice', (member) => member.price, {
    key: (value) => String(value ?? ''),
    corroborationFirst: true,
  });
  const pickedOriginal = pickField('originalListPrice', (member) => member.originalListPrice);
  const pickedListingDate = pickField('listingDate', (member) => member.listingDate);
  const pickedDaysOnMarket = pickField('daysOnMarket', (member) => member.daysOnMarket);
  const isPriceEvent = (event: { event: string }): boolean => /price|cut|reduced/i.test(event.event);
  const pickedPriceChanges = pickField(
    'priceChanges',
    (member) => member.listingHistory.filter(isPriceEvent),
  );
  /**
   * Records retained before the reduction flag existed carry a cut row with no
   * indication of which kind of figure it holds. A reduction that sits below
   * the current ask is the amount it came down by, not a new asking price, so
   * the operator surface is never left saying a cut went "to" the discount.
   */
  const askNow = pickedPrice?.value ?? null;
  const resolvedPriceChanges = (pickedPriceChanges?.value ?? []).map((event) => (
    event.isReductionAmount === undefined && event.price != null && askNow != null && event.price < askNow
      ? { ...event, isReductionAmount: true }
      : event));
  // An MLS number published by an MLS is digits. A token like "T062626" is a
  // marketplace's own internal id: it passes the shape test, so it is kept as
  // evidence, but it never outranks a real MLS number the subject also
  // publishes. Corroboration still decides between two ids of equal kind.
  const pickedMls = pickField('mls', (member) => member.mls, {
    key: (value) => normalizeMlsNumber(value) ?? '',
    corroborationFirst: true,
    rank: (value) => (/^\d+$/.test((normalizeMlsNumber(value) ?? '').trim()) ? 1 : 0),
  });
  // Office and agent names are corroboration-first for the same reason as the
  // price: one record's run-on capture ("Kathy Wittbrodt Wittbrodt WATERSIDE")
  // loses to the clean name the subject's other records publish.
  const pickedBrokerage = pickField('brokerage', (member) => member.brokerage, {
    key: (value) => compactText(value) ?? (value ?? '').trim().toLowerCase(),
    corroborationFirst: true,
  });
  const pickedAgent = pickField('listingAgent', (member) => member.listingAgent, {
    key: (value) => compactText(value) ?? (value ?? '').trim().toLowerCase(),
    corroborationFirst: true,
  });
  const pickedDescription = pickField('description', (member) => member.description);
  const pickedFeatures = pickField('features', (member) => member.features);
  // Acreage is corroboration-first for the same reason as the price: a single
  // mirror that publishes a different lot size loses to the figure the
  // subject's other records agree on.
  const pickedAcres = pickField('acres', (member) => member.acres, measure);
  const pickedDriveways = pickField('drivewayStatements', (member) => member.drivewayStatements);
  const pickedDirections = pickField('directionsStatements', (member) => member.directionsStatements);
  const pickedSqft = pickField('buildingSqft', (member) => member.buildingSqft, measure);
  const pickedBeds = pickField('beds', (member) => member.beds, measure);
  const pickedBaths = pickField('baths', (member) => member.baths, measure);
  const pickedYearBuilt = pickField('yearBuilt', (member) => member.yearBuilt, measure);
  const pickedStructures = pickField('structures', (member) => member.structures);
  const pickedUtilities = pickField('utilities', (member) => member.utilities);
  const pickedWell = pickField('well', (member) => member.well);
  const pickedSeptic = pickField('septic', (member) => member.septic);
  // The corroborated improvement type keeps its own rule (a type the subject's
  // own acreage contradicts is dropped), and is then attributed to the record
  // that actually published it.
  const cardPropertyType = corroboratedPropertyType(
    canonicalMembers.length ? canonicalMembers : sources,
    current,
    pickedAcres?.value ?? acres,
  );
  if (cardPropertyType) {
    pickField('propertyType', (member) => member.propertyType?.trim() && propertyTypeKey(member.propertyType) === propertyTypeKey(cardPropertyType)
      ? member.propertyType
      : null);
  }

  const cardPhotos: string[] = [];
  const seenPhotos = new Set<string>();
  for (const member of current ? [current, ...supplements] : []) {
    for (const url of member.photoUrls) {
      const key = photoKey(url);
      if (seenPhotos.has(key)) continue;
      seenPhotos.add(key);
      cardPhotos.push(url);
    }
  }
  const listingAgeDays = pickedDaysOnMarket?.value
    ?? (() => {
      const listed = parseDateMs(pickedListingDate?.value ?? null);
      const seen = parseDateMs(pickedListingDate?.from.retrievedAt ?? current?.retrievedAt ?? null);
      if (listed == null || seen == null || seen < listed) return null;
      return Math.round((seen - listed) / 86_400_000);
    })();
  const engagementByProvider = dedupeEngagementByHost((current ? [current, ...supplements] : [])
    .map((member) => member.engagement)
    .filter((signal): signal is ListingEngagementSignal => !!signal));

  const listingCard = current
    ? {
      active: current.listingStatusCode === 'active',
      onMarket: ON_MARKET_STATUSES.includes(current.listingStatusCode),
      statusCode: current.listingStatusCode,
      statusLabel: current.listingStatusLabel,
      status: current.listingStatus,
      statusNote: current.listingStatusCode === 'unknown'
        ? 'No retained record for this subject states a listing status, so the status stays unknown. Unknown is never read as active.'
        : `${current.listingStatusLabel} is the reconciled subject's own reported state, carried by ${current.sourceLabel}${supersededRecords.length ? ` and preferred over ${supersededRecords.length} superseded record(s) for the same property` : ''}.`,
      currentPrice: pickedPrice?.value ?? null,
      originalListPrice: pickedOriginal?.value ?? null,
      originalListPriceBasis: pickedOriginal
        ? pickedOriginal.from.originalListPriceBasis ?? 'published'
        : null,
      listingDate: pickedListingDate?.value ?? null,
      daysOnMarket: pickedDaysOnMarket?.value ?? null,
      listingAgeDays,
      listingAgeBasis: pickedDaysOnMarket?.value != null
        ? 'reported' as const
        : listingAgeDays != null ? 'derived_from_listing_date' as const : 'unavailable' as const,
      priceChanges: resolvedPriceChanges,
      priceHistory: current.listingHistory.length
        ? current.listingHistory
        : pickedPriceChanges?.from.listingHistory ?? [],
      acres: pickedAcres?.value ?? null,
      mls: pickedMls?.value ?? null,
      mlsCorroboration: pickedMls ? (pickedMls.support > 1 ? 'corroborated' as const : 'single_record' as const) : null,
      mlsNumbers: canonicalMls,
      brokerage: pickedBrokerage?.value ?? null,
      listingAgent: pickedAgent?.value ?? null,
      description: pickedDescription?.value ?? null,
      features: pickedFeatures?.value ?? [],
      drivewayStatements: pickedDriveways?.value ?? [],
      directionsStatements: pickedDirections?.value ?? [],
      listingUrl: current.sourceUrl,
      sourceLabel: current.sourceLabel,
      additionalSourceUrls: supplements.map((member) => member.sourceUrl),
      primaryPhotoUrl: cardPhotos[0] ?? null,
      additionalPhotoUrls: cardPhotos.slice(1),
      photoCount: cardPhotos.length || null,
      improvementFacts: {
        propertyType: cardPropertyType,
        buildingSqft: pickedSqft?.value ?? null,
        beds: pickedBeds?.value ?? null,
        baths: pickedBaths?.value ?? null,
        yearBuilt: pickedYearBuilt?.value ?? null,
        structures: pickedStructures?.value ?? [],
        utilities: pickedUtilities?.value ?? [],
        well: pickedWell?.value ?? null,
        septic: pickedSeptic?.value ?? null,
      },
      zillowEngagement: engagementByProvider.find((signal) => signal.provider === 'zillow') ?? null,
      engagementByProvider,
      engagementNote: 'Engagement is reported per provider in that provider\'s own terms. Zillow views and saves are a time-varying interest signal, not proof of value or guaranteed buyer demand, and a measure the provider did not publish is unavailable, never zero.',
      supplementedFrom: [...supplementedFrom],
      fieldSources,
      evidenceLabel: 'Listing-reported' as const,
    }
    : null;

  return {
    status: result.status,
    note: result.note ?? '',
    queries: result.queries ?? [],
    retrievedAtIso: sources.map((s) => s.retrievedAt).filter(Boolean).sort().pop() ?? null,
    sources,
    reconciliation,
    subjectRead,
    listingCard,
    disclaimer: LISTING_DISCLAIMER,
  };
}
