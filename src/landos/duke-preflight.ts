import { logger } from '../logger.js';
import { lpResolveForPreflight, type LpResolveArgs, type LpResolveResult } from './landportal-client.js';

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
  `\\b(\\d+[A-Za-z]?\\s+[A-Za-z][\\w ]*?\\s+(?:${STREET_TYPE_WORDS}))\\b`,
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

  // Explicit APN keyword: "APN: 12-345-678" or "APN 12-345-678"
  const apnKw = text.match(/\bapn[:\s]+([0-9][0-9A-Za-z\-./]+)/i)?.[1]?.trim();
  if (apnKw) {
    const state = extractState(text);
    const fips = extractLabeledFips(text);
    return { apn: apnKw, ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
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
      return { apn, ...(state ? { state } : {}), ...(fips ? { fips } : {}) };
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
    return {
      address: addrMatch[1].trim(),
      city: cityStateMatch[1].trim(),
      state,
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
    result = await lpResolveForPreflight(args, timeoutMs);
  } catch (err) {
    logger.warn(
      { event: 'duke_preflight_error', msg: (err as Error)?.message },
      'duke_preflight_error',
    );
    return {
      type: 'blocked',
      message: 'LandPortal lookup error. Parcel not verified -- no scoring, valuation, or offer. Retry the address, or provide APN + county for direct lookup.',
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
