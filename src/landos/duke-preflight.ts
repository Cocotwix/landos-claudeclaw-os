import { logger } from '../logger.js';
import { resolveParcelIdentity, type LpResolveArgs, type LpResolveResult } from './parcel-capability.js';

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

function extractState(text: string): string | undefined {
  const matches = text.match(/\b([A-Z]{2})\b/g) ?? [];
  const valid = matches.filter(s => US_STATES.has(s));
  return valid[valid.length - 1];
}

function extractLabeledFips(text: string): string | undefined {
  // Only extract FIPS when explicitly labeled to avoid confusing 5-digit zip codes
  const m = text.match(/\bfips[:\s]+(\d{5})\b/i);
  return m?.[1];
}

// Owner name after an explicit "Owner:" / "owner -" label. Stops at a comma,
// a double space, a newline, or the next labeled field (APN/county/state/FIPS).
function extractOwner(text: string): string | undefined {
  const m = text.match(/\bowner[:\s-]+([A-Za-z][A-Za-z.'\- ]*?)(?=\s{2,}|,|\n|\bapn\b|\bcounty\b|\bstate\b|\bfips\b|$)/i);
  const owner = m?.[1]?.replace(/\s+/g, ' ').trim();
  return owner && owner.length >= 2 ? owner : undefined;
}

// County name preceding the word "County" (e.g. "Clay County" -> "Clay"). Kept
// so owner search can be county-gated even when no FIPS is supplied.
function extractCounty(text: string): string | undefined {
  const m = text.match(/\b([A-Za-z][A-Za-z.'\- ]*?)\s+County\b/i);
  const county = m?.[1]?.replace(/\s+/g, ' ').trim();
  return county && county.length >= 2 ? county : undefined;
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
  if (v.replace(/[^0-9]/g, '').length < 5) return undefined;
  const hasParcelSep = /[-./]/.test(v) || /\d\s+\d/.test(v);
  if (!hasParcelSep) return undefined;
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * Extract a parcel-number-shaped APN even when it is labeled "Address:"/"Parcel:"
 * or appears bare, and the dash-only patterns above did not catch it. The live
 * dashboard sends the APN under an "Address:" label (e.g. "Address: 051   012.05").
 * Digits/separators only (no letters) so a street name is never captured.
 */
function extractApnShaped(text: string): string | undefined {
  // Prefer an explicitly-labeled value; the class is digits + separators only, so
  // a label followed by a street ("Address: 731 Filter Plant Rd") stops at the
  // street name and is then rejected by pickApnShape (too few digits / no sep).
  const labeled = text.match(/\b(?:address|parcel(?:\s*(?:id|no|number|#))?)[:\s]+([0-9][0-9 .\/\-]*)/i)?.[1];
  const bare =
    text.match(/\b\d{2,6}(?:[ \t]+\d{1,6}){1,4}(?:\.\d{1,4})?\b/)?.[0] ??
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
// City + 2-letter state, with or without a comma before the state, e.g.
// ", Cottageville, SC" or ", Arnold MD". The state is validated against US_STATES.
const CITY_STATE_RE = /,\s*([A-Za-z][A-Za-z .'\-]*?)\s*,?\s+([A-Z]{2})\b/;

/**
 * Returns true when the message looks like a specific property address input
 * even if it lacks enough identifiers for a direct LP call. Used to distinguish
 * "57 Church Road, Arnold MD" (needs county) from "county stats for X" (area query).
 */
export function looksLikePropertyInput(text: string): boolean {
  // House number + street name + street type (e.g. "57 Church Road", "731 Filter Plant Rd")
  if (STREET_TYPE_RE.test(text)) return true;
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
  const apnKw = text.match(/\bapn[:\s]+([0-9][0-9A-Za-z./\-]*(?:[^\S\n]+[0-9][0-9A-Za-z./\-]*)*)/i)?.[1]
    ?.replace(/[^\S\n]+/g, ' ').trim();
  if (apnKw) {
    const state = extractState(text);
    const fips = extractLabeledFips(text);
    // Attach owner + county so the resolver can fall back to owner + county/state search.
    return { apn: apnKw, ...(owner ? { owner } : {}), ...(county ? { county } : {}), ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
  }

  // APN-like numeric pattern: two or more dash-separated numeric segments
  // e.g. 12-345-678, 05-1234-0067. Requires >= 7 digits total to avoid
  // matching phone fragments or "page 2-3".
  const apnPat = text.match(/\b(\d{2,6}-\d{2,6}-\d{2,6}(?:-\d+)?)\b/);
  if (apnPat) {
    const apn = apnPat[1];
    // Reject patterns that look like dates (MM-DD-YYYY)
    if (!/^\d{1,2}-\d{1,2}-\d{4}$/.test(apn)) {
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
  const addrMatch = text.match(ADDRESS_RE);
  const cityStateMatch = text.match(CITY_STATE_RE);
  const state = extractState(text);
  if (
    addrMatch &&
    cityStateMatch &&
    state &&
    US_STATES.has(cityStateMatch[2].toUpperCase())
  ) {
    // Capture a 5-digit ZIP that trails the state (e.g. "SC 29435"). Used by the
    // v2 address search as an extra context filter; ignored by the v1 path.
    const zip = text.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/)?.[1];
    return {
      address: addrMatch[1].trim(),
      city: cityStateMatch[1].trim(),
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
