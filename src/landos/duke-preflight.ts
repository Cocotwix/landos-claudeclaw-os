import { logger } from '../logger.js';
import { resolveParcelIdentity, type LpResolveArgs, type LpResolveResult } from './parcel-capability.js';
import { maskFieldLabels } from './intake-normalize.js';

export type DukePreflightOutcome =
  | { type: 'skip' }
  | { type: 'verified'; parcelBlock: string; filteredMcpAllowlist: string[] }
  | { type: 'blocked'; message: string; reason: string };

const TIMEOUT_MESSAGE =
  'LandPortal lookup did not respond in time. Parcel not verified -- no scoring, valuation, or offer. Retry the address, or provide APN + county for direct lookup.';

const INCOMPLETE_IDENTITY_MESSAGE =
  'Parcel not verified -- no scoring, valuation, or offer. ' +
  'I could not read a parcel identity from this input. ' +
  'Send the state plus county (or FIPS), the APN, or owner + county/state for exact lookup. ' +
  'Coordinates and proximity are never used to identify a parcel.';

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]);

// Full state name -> 2-letter abbreviation, so intake accepts "Winters, Texas"
// (spelled-out state) exactly like "Winters, TX".
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
const STATE_NAME_ALT = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length).join('|');

/** Resolve a state token (2-letter code OR full name) to its abbreviation. */
export function resolveStateToken(token?: string): string | undefined {
  if (!token) return undefined;
  const t = token.trim();
  if (/^[A-Za-z]{2}$/.test(t) && US_STATES.has(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAME_TO_ABBR[t.toLowerCase()];
}

function extractState(text: string): string | undefined {
  // Prefer the LAST valid state token (closest to the trailing "city, STATE").
  // Accept both 2-letter codes and spelled-out names. Field-label phrases
  // ("Parcel ID", "Owner ID", "Tax ID") are masked first so a label's "ID"
  // suffix is never read as Idaho — the root-cause of the Scott County, TN miss.
  const masked = maskFieldLabels(text);
  const re = new RegExp(`\\b([A-Z]{2}|${STATE_NAME_ALT})\\b`, 'gi');
  let last: string | undefined;
  for (const m of masked.matchAll(re)) {
    const tok = m[1];
    // A bare 2-letter state CODE must be uppercase in the source ("TN", "GA");
    // this stops ordinary words like "in"/"or"/"me"/"oh" from being read as
    // Indiana/Oregon/Maine/Ohio in prose. Spelled-out names stay case-insensitive.
    if (/^[A-Za-z]{2}$/.test(tok) && tok !== tok.toUpperCase()) continue;
    const abbr = resolveStateToken(tok);
    if (abbr) last = abbr;
  }
  return last;
}

// Highway / route style street (e.g. "Highway 153", "Hwy 153", "State Highway
// 153", "TX-153", "Texas 153", "FM 153", "County Road 153") where the route
// designator + number replace a trailing street type.
const HIGHWAY_STREET =
  '(?:' +
    '(?:(?:old|new|north|south|east|west|n|s|e|w)\\s+)?' +
    '(?:(?:us|u\\.s\\.|state|county|ranch|farm)\\s+)?' +
    '(?:highway|hwy|route|rte|county\\s+road|ranch\\s+road|farm\\s+road|state\\s+road)' +
    '|(?:fm|cr|sr|rr|sh|us)[-\\s]' +
    '|[a-z]{2}-' +
    '|(?:' + STATE_NAME_ALT + ')\\s' +
  ')\\s*-?\\s*\\d+[A-Za-z]?';
const HIGHWAY_ADDRESS_RE = new RegExp(`\\b(\\d+[A-Za-z]?\\s+${HIGHWAY_STREET})`, 'i');

function extractLabeledFips(text: string): string | undefined {
  // Only extract FIPS when explicitly labeled to avoid confusing 5-digit zip codes
  const m = text.match(/\bfips[:\s]+(\d{5})\b/i);
  return m?.[1];
}

// Owner name after an explicit "Owner:" / "owner -" label. Stops at a comma,
// a double space, a newline, or the next labeled field (APN/county/state/FIPS).
function extractOwner(text: string): string | undefined {
  const m = text.match(/\bowner(?:\s+name)?[:\s-]+([A-Za-z][A-Za-z.'\- ]*?)(?=\s{2,}|,|\n|\bapn\b|\bcounty\b|\bstate\b|\bfips\b|$)/i);
  // Strip a leading linking verb the label regex can absorb ("Owner is Betty" ->
  // "Betty", "Owner was John" -> "John").
  const owner = m?.[1]?.replace(/^(?:is|was|name is|are)\s+/i, '').replace(/\s+/g, ' ').trim();
  return owner && owner.length >= 2 ? owner : undefined;
}

// County name preceding the word "County" (e.g. "Clay County" -> "Clay"). Kept
// so owner search can be county-gated even when no FIPS is supplied. Requires
// Title-Case name token(s) (1–3 words) so prose like "the property is on Gilstrap
// Road in White County" yields "White", not the whole clause, and excludes
// "County Road/Rd/Line/Route/Highway" (a street, not a county).
function extractCounty(text: string): string | undefined {
  // Form 1: "<Name> County" (e.g. "Scott County" -> "Scott"). Internal connectors
  // are HORIZONTAL whitespace only ([^\S\n]) so the name never grows across a line
  // break — "Lithonia GA\nDeKalb County" resolves to "DeKalb", not the whole run.
  // A candidate whose final token ends with a sentence period is a SENTENCE
  // BOUNDARY bleed, not a county name ("State: New York. County: Cayuga County."
  // must never read "New York." as the county). Interior abbreviation periods
  // ("St. Clair") are fine — only the token touching "County" is checked, and
  // the scan continues to the next match instead of giving up.
  for (const m of text.matchAll(
    /\b([A-Z][a-zA-Z.'\-]+(?:[^\S\n]+[A-Z][a-zA-Z.'\-]+){0,2})[^\S\n]+County\b(?!\s+(?:road|rd|line|route|rte|highway|hwy)\b)/g,
  )) {
    const named = m[1]?.replace(/\s+/g, ' ').trim();
    if (named && named.length >= 2 && !named.endsWith('.')) return named;
  }
  // Form 2: labeled "County: <Name>" (CRM/record exports). Exclude a road word
  // ("County Road ...") and a state name ("... County Georgia").
  const labeled = text.match(/\bcounty[:\s]+([A-Z][a-zA-Z.'\-]+)\b/i)?.[1];
  if (labeled && !/^(?:road|rd|line|route|rte|highway|hwy)$/i.test(labeled) && !resolveStateToken(labeled)) {
    return labeled.replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

// Words that disqualify a line from being a bare owner name.
const OWNER_NAME_STOPWORDS =
  /\b(county|state|apn|fips|address|parcel|propertyid|property|road|rd|street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|highway|hwy|acres?|llc|inc|trust|estate|stats?|report|due|diligence|what|how|why|where|when)\b/i;

/**
 * Recover a bare owner name from the FIRST non-empty line (e.g. "Cheryl Sann"
 * on its own line, the live dashboard format) when no "Owner:" label is present.
 * Deliberately strict: 2-3 alphabetic tokens, title-case OR all-caps, no digits,
 * no street/label/location/question words. It is only ever USED when another
 * identifier (APN or county/state) is also present, so a lone name never
 * resolves. Never identifies via coordinates/proximity.
 */
function extractBareOwnerName(text: string): string | undefined {
  const firstLine = text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? '';
  // 2-3 tokens of letters/apostrophe/hyphen/period only.
  if (!/^[A-Za-z][A-Za-z'’.\-]*(?:\s+[A-Za-z][A-Za-z'’.\-]*){1,2}$/.test(firstLine)) return undefined;
  if (OWNER_NAME_STOPWORDS.test(firstLine)) return undefined;
  const tokens = firstLine.split(/\s+/);
  const titleCase = tokens.every(t => /^[A-Z][a-z'’.\-]*$/.test(t));
  const allCaps = tokens.every(t => /^[A-Z'’.\-]{2,}$/.test(t));
  if (!titleCase && !allCaps) return undefined;
  return firstLine.replace(/\s+/g, ' ').trim();
}

/**
 * Validate + normalize a parcel-number-shaped string into a search key (e.g.
 * "051   012.05" -> "051 012.05"). Rejects plain street numbers, acreage, years,
 * and MM-DD-YYYY dates. Requires >= 5 digits AND a parcel separator (dash, dot,
 * slash, or two space-separated numeric groups) so it cannot eat a house number.
 */
function pickApnShape(raw: string | null | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(v)) return undefined; // MM-DD-YYYY
  if (/^(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(v)) return undefined; // US phone
  if (v.replace(/[^0-9]/g, '').length < 5) return undefined;
  const hasParcelSep = /[-./]/.test(v) || /\d\s+\d/.test(v);
  if (!hasParcelSep) return undefined;
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * Trim a labeled capture down to the leading run of PARCEL-shaped tokens.
 *
 * Letters have to be allowed in the token class so a district prefix or a
 * trailing group ("A-1") survives, but that alone would let a street name
 * ("Parcel: 12 Oak Street") ride along and be stored as a parcel number. A
 * token earns its place only by carrying a digit, or by being the one/two
 * letter group code that sits BETWEEN numeric groups ("073009G B 03600").
 * The first ordinary word ends the run, and a dangling group code is dropped
 * so the value never ends on a separator-less letter.
 */
function apnTokenRun(raw: string | null | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  const kept: string[] = [];
  for (const token of v.split(/\s+/)) {
    if (/\d/.test(token)) kept.push(token);
    else if (/^[A-Za-z]{1,2}$/.test(token)) kept.push(token);
    else break;
  }
  while (kept.length && !/\d/.test(kept[kept.length - 1])) kept.pop();
  if (!kept.length) return undefined;
  // Same trailing-separator rule the labeled "APN:" path already applies. A
  // sentence period is not part of the parcel number, and an official layer
  // matches a parcel EXACTLY, so carrying it through silently defeats the
  // lookup and leaves a resolvable parcel provisional with no visible reason.
  return kept.join(' ').replace(/[\s./\-]+$/, '') || undefined;
}

/**
 * Extract a parcel-number-shaped APN even when it is labeled "Address:"/"Parcel:"
 * or appears bare, and the dash-only patterns above did not catch it. The live
 * dashboard sends the APN under an "Address:" label (e.g. "Address: 051   012.05").
 * A parcel token may contain letters, digits, spaces and punctuation, since real
 * parcel numbers open with a district letter, carry a letter group code, or close
 * with an alphanumeric group. `apnTokenRun` is what keeps an ordinary street name
 * from being captured: it ends the run at the first word that is neither
 * digit-bearing nor a one/two-letter group code.
 */
function extractApnShaped(text: string): string | undefined {
  // Prefer an explicitly-labeled value. The token class admits letters, because
  // a real parcel number may open with a district letter ("R1234-567A") or close
  // with an alphanumeric group ("073 090 04200 A-1"); a digits-only class
  // silently returned a DIFFERENT, shorter parcel number, or none at all.
  // `apnTokenRun` is what still stops the capture at a street name, so
  // "Address: 731 Filter Plant Rd" keeps ending at "731" and is then rejected by
  // pickApnShape for having too few digits and no parcel separator.
  const labeled = apnTokenRun(
    text.match(/\b(?:address|parcel(?:\s*(?:id|no|number|#))?)[:\s]+((?=[0-9A-Za-z./\-]*[0-9])[0-9A-Za-z][0-9A-Za-z .\/\-]*)/i)?.[1],
  );
  // Accept mixed parcel separators (dash / dot / slash / space) so a bare
  // map-block-parcel APN like "094-020.08" is captured WHOLE, not truncated to
  // its decimal tail "020.08". Separators are [ \t] only (never \s) so the token
  // never merges across a newline with the next line's house number.
  const bare =
    text.match(/\b\d{2,6}(?:[ \t]*[.\/\-][ \t]*\d{1,6}|[ \t]+\d{1,6}){1,4}\b/)?.[0] ??
    text.match(/\b\d{2,6}\.\d{1,4}\b/)?.[0];
  for (const cand of [labeled, bare]) {
    const apn = pickApnShape(cand);
    if (apn) return apn;
  }
  return undefined;
}

// Street-type keywords used to detect likely property address inputs.
const STREET_TYPE_RE =
  /(?:^|[,;\n])\s*\d+[A-Za-z]?\s+[A-Za-z]\w*(?:\s+\w+)*?\s+(?:road|rd|street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|highway|hwy|parkway|pkwy|circle|cir|loop|trail|trl|pike|route|terrace|ter)\b/i;

// Street-type vocabulary for capturing a full street address (full word OR
// abbreviation). Used to extract the address span for an exact LP lookup.
const STREET_TYPE_WORDS =
  'street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|' +
  'way|place|pl|highway|hwy|parkway|pkwy|circle|cir|loop|trail|trl|pike|' +
  'terrace|terr|ter|route|rt|cove|cv|crossing|xing|square|sq';
const ADDRESS_RE = new RegExp(
  // House number (incl. "0" for vacant land), then a street name that may start
  // with a letter OR a digit (ordinals like "1st", "42nd"), then a street type.
  `\\b(\\d+[A-Za-z]?\\s+[A-Za-z0-9][\\w ]*?\\s+(?:${STREET_TYPE_WORDS}))\\b`,
  'i',
);
// City + state (2-letter code OR spelled-out name), with or without a comma
// before the state, e.g. ", Cottageville, SC", ", Arnold MD", ", Winters, Texas".
const CITY_STATE_RE = new RegExp(`,\\s*([A-Za-z][A-Za-z .'\\-]*?)\\s*,?\\s+([A-Za-z]{2}|${STATE_NAME_ALT})\\b`, 'i');

// A labeled value that continues into a STREET is an address the operator
// mislabeled, never a parcel number. The five-digit floor below stops
// "Parcel: 12 Oak Street" but not "Parcel: 12345 Main St", which still handed
// the house number back as the parcel id — and this labeled path outranks every
// other APN reader in fieldsFromArgs(), so the corrupt id won. A wrong APN is a
// DIFFERENT parcel and parcel identity gates all downstream property
// intelligence, so the value is refused here and the text falls through to the
// address path that can actually resolve it.
const LABELED_ADDRESS_VALUE_RE = new RegExp(
  `^(?:apn|parcel(?:[^\\S\\n]*(?:id|no\\.?|number|#))?)[:\\s]+(?:`
    + `\\d+[A-Za-z]?[^\\S\\n]+[A-Za-z][A-Za-z'\\-]*(?:[^\\S\\n]+[\\w'\\-]+)*?[^\\S\\n]+(?:${STREET_TYPE_WORDS})\\b`
    + `|\\d+[A-Za-z]?[^\\S\\n]+${HIGHWAY_STREET}`
  + `)`,
  'i',
);

/**
 * Returns true when the message looks like a specific property address input
 * even if it lacks enough identifiers for a direct LP call. Used to distinguish
 * "57 Church Road, Arnold MD" (needs county) from "county stats for X" (area query).
 */
export function looksLikePropertyInput(text: string): boolean {
  // House number + street name + street type (e.g. "57 Church Road", "731 Filter Plant Rd")
  if (STREET_TYPE_RE.test(text)) return true;
  // House number + highway/route designator (e.g. "2510 Highway 153", "410 FM 153")
  if (HIGHWAY_ADDRESS_RE.test(text)) return true;
  // Explicit property query language
  if (
    /\b(?:due diligence|run dd|check\s+(?:this\s+)?(?:property|parcel|lot|land)|this\s+(?:property|parcel|land|lot|address))\b/i.test(
      text,
    )
  ) return true;
  return false;
}

/**
 * Extract LP-resolvable property args from a raw message text.
 * Returns null when no reliable identifier is present.
 *
 * Deliberately conservative: only extracts identifiers that can be sent directly
 * to LP. Address-only inputs without county/FIPS return null; runDukePreflight
 * then checks looksLikePropertyInput and blocks rather than falling back to MCP.
 */
export function extractPropertyArgs(text: string): LpResolveArgs | null {
  // LP URL — most reliable, parse directly
  const lpUrlMatch = text.match(/https?:\/\/(?:www\.)?landportal\.com[^\s\]<>"]+/i);
  if (lpUrlMatch) return { lp_url: lpUrlMatch[0] };

  // Label-based owner first; fall back to a bare first-line name (live dashboard
  // format puts the owner on its own line with no "Owner:" label).
  const owner = extractOwner(text) ?? extractBareOwnerName(text);
  const county = extractCounty(text);

  // Explicit APN keyword: "APN: 12-345-678", "APN 12-345-678", or multi-segment
  // forms with internal whitespace/decimals like "APN 051   012.05".
  // ROOT-CAUSE FIX: the segment separator is HORIZONTAL whitespace only ([^\S\n]+),
  // not \s+. A space-containing APN on its own line ("APN: 16 038 07 001") followed
  // by an address line starting with a number ("2123 Panola Road") previously
  // merged into a corrupt APN ("16 038 07 001 2123") because \s matches newlines —
  // which then failed Realie lookup and produced a false "not verified" that
  // contradicted the parcel's genuinely-verified facts. Stop the APN at the line end.
  // The value MAY open with an alphanumeric district/map prefix (e.g. the Beaufort
  // SC form "APN R300 018 000 0085 0000", or "0R1 234 567"). The optional prefix
  // token must contain BOTH a letter and a digit (so a word like "is"/"report"
  // never matches) — this preserves the prefix instead of starting at the first
  // bare digit run and dropping it (a truncated APN corrupts identity and can
  // raise a FALSE conflict when a source returns the full prefixed APN).
  // A trailing separator is sentence punctuation, never part of the parcel
  // number. Left in place it reaches the property card and then defeats the
  // EXACT match an official county/state parcel layer requires, so a genuinely
  // resolvable parcel silently stays provisional with no visible reason.
  // `(?:[A-Za-z]{1,2}[^\S\n]+)?` admits a one/two-letter GROUP CODE between
  // numeric groups ("073009G B 03600"). Without it the match stopped at the
  // letter and handed back a truncated — that is, a different — parcel number.
  // Each parcel token may OPEN with a letter (e.g. "R1234-567A") and may CLOSE
  // with an alphanumeric group ("073 090 04200 A-1"), so the token class is
  // alphanumeric and only the "contains a digit" lookahead separates a parcel
  // token from an English word. Requiring a leading [0-9] truncated a
  // letter-led APN to nothing and dropped a trailing letter group — either one
  // hands back a DIFFERENT parcel number than the operator supplied.
  // "Parcel ID:" / "Parcel No:" / "Parcel #" are the SAME label as "APN:" — a
  // pasted lead using the county's own wording must not fall through to the
  // capped dash pattern below, which truncates long multi-group parcel IDs.
  const apnKwMatch = text.match(/\b(?:apn|parcel(?:[^\S\n]*(?:id|no\.?|number|#))?)[:\s]+((?:(?=\S*[A-Za-z])(?=\S*\d)[A-Za-z0-9]{2,6}[^\S\n]+)?(?=[0-9A-Za-z./\-]*[0-9])[0-9A-Za-z][0-9A-Za-z./\-]*(?:[^\S\n]+(?:[A-Za-z]{1,2}[^\S\n]+)?(?=[0-9A-Za-z./\-]*[0-9])[0-9A-Za-z][0-9A-Za-z./\-]*)*)/i);
  const apnKw = apnKwMatch && !LABELED_ADDRESS_VALUE_RE.test(text.slice(apnKwMatch.index ?? 0))
    ? apnKwMatch[1]?.replace(/[^\S\n]+/g, ' ').trim().replace(/[\s./\-]+$/, '')
    : undefined;
  // A parcel number carries at least five digits. Without this floor the token
  // class above stops at the first non-parcel word and hands back the leading
  // house number of a street address — "Parcel: 12 Oak Street" resolved to the
  // parcel "12", and this path OUTRANKS the correct extractApnCandidates()
  // scanner in fieldsFromArgs(), so the corrupt id won. A wrong APN is worse
  // than no APN: parcel identity gates all downstream property intelligence.
  // Length only — no separator requirement, so a long single-run county APN
  // still resolves here.
  const apnKwDigits = (apnKw ?? '').replace(/[^0-9]/g, '').length;
  if (apnKw && apnKwDigits >= 5) {
    const state = extractState(text);
    const fips = extractLabeledFips(text);
    // Attach owner + county so the resolver can fall back to owner + county/state search.
    return { apn: apnKw, ...(owner ? { owner } : {}), ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
  }

  // APN-like numeric pattern: two or more dash-separated numeric segments
  // e.g. 12-345-678, 05-1234-0067. Requires >= 7 digits total to avoid
  // matching phone fragments or "page 2-3".
  // Repeating groups ({2,9}) so a long county parcel ID (e.g. New York's
  // seven-group "053889-075-000-0001-024-011-0000") is captured WHOLE — the old
  // single optional fourth group truncated it to a different parcel number.
  const apnPat = text.match(/\b(\d{2,6}(?:-\d{1,6}){2,9})\b/);
  if (apnPat) {
    const apn = apnPat[1];
    // Reject patterns that look like dates (MM-DD-YYYY) or US phone numbers
    // (3-3-4) — a seller-text phone must never be read as a parcel number.
    if (!/^\d{1,2}-\d{1,2}-\d{4}$/.test(apn) && !/^\d{3}-\d{3}-\d{4}$/.test(apn)) {
      const state = extractState(text);
      const fips = extractLabeledFips(text);
      return { apn, ...(owner ? { owner } : {}), ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
    }
  }

  // Parcel-number-shaped APN that the dash-only patterns missed, including the
  // live dashboard form where the APN is under an "Address:" label (e.g.
  // "Address: 051   012.05"). Treated as an APN, never a street address.
  const apnShaped = extractApnShaped(text);
  if (apnShaped) {
    const state = extractState(text);
    const fips = extractLabeledFips(text);
    return { apn: apnShaped, ...(owner ? { owner } : {}), ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
  }

  // Owner + county/state (no APN/address): a valid exact-search input. County is
  // preserved even without FIPS so owner search is never silently statewide.
  if (owner) {
    const state = extractState(text);
    const fips = extractLabeledFips(text);
    if (state || fips || county) {
      return { owner, ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
    }
  }

  // Labeled property ID + labeled FIPS
  const propIdMatch = text.match(/\bproperty[\s_-]?id[:\s]+(\d+)/i) ??
                      text.match(/\bpropertyid[:\s]+(\d+)/i);
  const labeledFips = extractLabeledFips(text);
  if (propIdMatch && labeledFips) {
    return { propertyid: propIdMatch[1], fips: labeledFips };
  }

  // Full street address + city + state. LP's address filter needs a FIPS, but a
  // street address with city/state is a valid exact-lookup input: when FIPS is
  // absent we still return the parsed address so the resolver returns
  // ambiguous_fips and Duke resolves county via its allowed, non-coordinate
  // recovery ladder. Never block a full address with a "provide address" re-ask.
  // A highway/route-style address ("2510 Highway 153") OR a normal street address.
  // Highway FIRST so a trailing route number is captured (ADDRESS_RE would stop at
  // "State Highway" and drop "153").
  const addrMatch = text.match(HIGHWAY_ADDRESS_RE) ?? text.match(ADDRESS_RE);
  const cityStateMatch = text.match(CITY_STATE_RE);
  const state = extractState(text); // accepts "TX" or spelled-out "Texas"
  if (addrMatch && cityStateMatch && state) {
    // ZIP trailing the state, whether the state is a code or a spelled-out name.
    const zip = text.match(/\b(?:[A-Z]{2}|[A-Za-z]{4,})[, ]+(\d{5})(?:-\d{4})?\b/)?.[1];
    return {
      address: addrMatch[1].replace(/\s+/g, ' ').trim(),
      city: cityStateMatch[1].replace(/\s+/g, ' ').trim(),
      state,
      ...(zip ? { zip } : {}),
      ...(labeledFips ? { fips: labeledFips } : {}),
    };
  }

  return null;
}

function buildBlockedMessage(result: LpResolveResult): string {
  switch (result.status) {
    case 'lookup_timeout':
      return TIMEOUT_MESSAGE;
    case 'multiple_candidates':
      return (
        `Multiple parcels matched. Parcel not verified -- no scoring, valuation, or offer. ` +
        `Specify APN, FIPS, or property ID to identify the correct parcel. ${result.match_notes}`
      );
    case 'not_verified':
      return (
        `Parcel not verified -- no scoring, valuation, or offer. ` +
        `${result.match_notes} Retry the address, or provide APN + county for direct lookup.`
      );
    default:
      return (
        `LandPortal lookup: ${result.status}. Parcel not verified -- no scoring, valuation, or offer. ` +
        `Retry the address, or provide APN + county for direct lookup.`
      );
  }
}

function buildParcelBlock(result: LpResolveResult): string {
  const payload = {
    verified: result.verified,
    status: result.status,
    propertyid: result.propertyid,
    fips: result.fips,
    apn: result.apn,
    situs_address: result.situs_address,
    city: result.city,
    state: result.state,
    owner: result.owner,
    match_notes: result.match_notes,
    property_summary: result.property_summary,
  };
  return [
    '[DUKE PREFLIGHT -- parcel verified by LandOS gateway before runAgent]',
    'lp_resolve_property returned verified:true. DO NOT call lp_resolve_property or lp_property_data in this run.',
    'The LandPortal MCP server has been excluded from this run. Use the property_summary below directly.',
    '',
    JSON.stringify(payload, null, 2),
    '[END DUKE PREFLIGHT]',
  ].join('\n');
}

/**
 * Gate for Duke dashboard default property runs. Resolves the parcel identity
 * directly (bypassing Claude/MCP) with a hard LandOS-controlled timeout.
 *
 * Returns:
 *   skip    -- no property identifier found; caller proceeds normally with MCP
 *   verified -- parcel confirmed; caller injects parcelBlock and excludes LP MCP
 *   blocked -- lookup failed/timed out; caller returns controlled message without runAgent
 */
export async function runDukePreflight(
  text: string,
  mcpAllowlist: string[] | undefined,
  timeoutMs: number,
): Promise<DukePreflightOutcome> {
  const args = extractPropertyArgs(text);

  if (!args) {
    // Address-like input without county/FIPS/APN: block immediately so the
    // MCP path is never reached. Duke cannot score an unverified parcel.
    if (looksLikePropertyInput(text)) {
      logger.info(
        { event: 'duke_preflight_blocked', reason: 'missing_parcel_identity' },
        'duke_preflight_blocked',
      );
      return { type: 'blocked', message: INCOMPLETE_IDENTITY_MESSAGE, reason: 'missing_parcel_identity' };
    }
    logger.info({ event: 'duke_preflight_skip', reason: 'no_identifier' }, 'duke_preflight_skip');
    return { type: 'skip' };
  }

  logger.info(
    {
      event: 'duke_preflight_start',
      hasLpUrl: !!args.lp_url,
      hasApn: !!args.apn,
      hasFips: !!args.fips,
      hasPropertyId: !!args.propertyid,
    },
    'duke_preflight_start',
  );

  let result: LpResolveResult;
  try {
    // Capability call: the DD gate requests "verify parcel identity"; the router
    // selects the configured provider (intended primary Realie, legacy fallback
    // LandPortal) and reports provenance. No vendor is named here.
    const outcome = await resolveParcelIdentity(args, timeoutMs);
    result = outcome.result;
    logger.info(
      { event: 'duke_preflight_provider', provider: outcome.provenance.provider, fellBack: outcome.provenance.fellBack },
      'duke_preflight_provider',
    );
  } catch (err) {
    logger.warn(
      { event: 'duke_preflight_error', msg: (err as Error)?.message },
      'duke_preflight_error',
    );
    return {
      type: 'blocked',
      message: 'Parcel lookup error. Parcel not verified -- no scoring, valuation, or offer. Retry the address, or provide APN + county for direct lookup.',
      reason: 'preflight_error',
    };
  }

  logger.info(
    { event: 'duke_preflight_result', verified: result.verified, status: result.status },
    'duke_preflight_result',
  );

  if (result.status === 'lookup_timeout') {
    return { type: 'blocked', message: TIMEOUT_MESSAGE, reason: 'lp_timeout' };
  }

  // ambiguous_fips means we sent an address without FIPS. Duke can resolve
  // this via county web search in its normal MCP flow -- pass through.
  if (result.status === 'ambiguous_fips') {
    logger.info({ event: 'duke_preflight_skip', reason: 'ambiguous_fips' }, 'duke_preflight_skip');
    return { type: 'skip' };
  }

  if (!result.verified) {
    return { type: 'blocked', message: buildBlockedMessage(result), reason: result.status };
  }

  // Verified: exclude landportal from the MCP allowlist so Claude cannot call
  // LP again this run. If the incoming allowlist is undefined (meaning "load
  // all MCPs"), return [] -- the parcel data is injected inline and no MCP
  // calls are needed. Never let undefined propagate; that would load all MCPs.
  const filteredMcpAllowlist = mcpAllowlist
    ? mcpAllowlist.filter(s => s !== 'landportal')
    : [];
  const parcelBlock = buildParcelBlock(result);

  logger.info(
    { event: 'duke_preflight_verified', apn: result.apn, fips: result.fips },
    'duke_preflight_verified',
  );

  return { type: 'verified', parcelBlock, filteredMcpAllowlist };
}
