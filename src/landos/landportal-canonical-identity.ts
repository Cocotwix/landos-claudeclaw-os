// LandPortal canonical parcel identity — the jurisdiction the parcel URL
// ALREADY carries.
//
// An authenticated LandPortal parcel page is addressed by a single canonical
// token:
//
//   https://landportal.com/?property=<base64 of "fips=26055&apn=13-116-015-01&propertyid=158072584">
//
// That token is the provider's own primary key for the parcel. It carries the
// 5-digit county FIPS, which IS the county and state — but the visible parcel
// panel publishes only APN, owner, acreage and situs address. It never prints
// "Grand Traverse" or "Michigan" as a field.
//
// This mattered, and it is the defect this module exists to close. The
// discovery gate (`discovery-identity.ts`) admits a LandPortal address match
// only when the panel supplies a county AND a state. For an address-only lead
// the panel never does, so the gate rejected its own match for missing exactly
// the field the URL it was reading already contained. Every jurisdiction-bound
// lane — parcel geometry, FEMA, wetlands, soils, slope, comps, market — was
// then told "no exact parcel-level source agreed on its APN and jurisdiction",
// and a rerun changed nothing because the input never changed.
//
// The FIPS→state half is a closed federal mapping and is decided offline here.
// The county NAME is not guessed: it is read from the Census Bureau's own
// geography service and cached, or supplied by a caller that already resolved
// it. A county whose name cannot be read stays null rather than fabricated.

import { FIPS_TO_STATE } from './market-matrix.js';

/** The provider's canonical parcel key, decoded from its own URL. */
export interface LandPortalCanonicalIdentity {
  /** 5-digit county FIPS: 2-digit state + 3-digit county. */
  fips: string;
  apn: string;
  propertyId: string;
  /** USPS abbreviation derived from the state half of the FIPS code. */
  state: string | null;
  stateFips: string;
  countyFips: string;
}

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result && result !== '-' && result.toLowerCase() !== 'null' ? result : null;
}

/**
 * Decode a LandPortal canonical parcel token.
 *
 * Accepts the full parcel URL, a bare `?property=` value (percent-encoded or
 * not), or the already-decoded `fips=…&apn=…&propertyid=…` query string. All
 * three shapes occur across retained evidence written by different lanes.
 *
 * Returns null unless all three parts are present and the FIPS code is a
 * well-formed 5-digit county code. A partial token identifies nothing.
 */
export function decodeLandPortalCanonicalIdentity(value: unknown): LandPortalCanonicalIdentity | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const candidates: string[] = [];
  const pushCandidate = (candidate: string | null): void => {
    const trimmed = (candidate ?? '').trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  // A full URL (or anything carrying ?property=) hands over its token.
  const tokenMatch = /[?&]property=([^&#\s]+)/i.exec(raw);
  if (tokenMatch?.[1]) {
    const token = tokenMatch[1];
    pushCandidate(token);
    try { pushCandidate(decodeURIComponent(token)); } catch { /* a malformed escape is simply not a candidate */ }
  }
  pushCandidate(raw);
  try { pushCandidate(decodeURIComponent(raw)); } catch { /* as above */ }

  for (const candidate of [...candidates]) {
    // Base64 (standard or URL-safe). A token that is not base64 decodes to
    // noise, which then fails the fips/apn/propertyid check below — so a bad
    // decode is rejected on content, never assumed to be valid.
    if (candidate.includes('=') && /(?:^|[?&])(?:fips|apn|propertyid)=/i.test(candidate)) continue;
    // Only decode something that is ACTUALLY base64. A still-percent-encoded
    // token ("…NA%3D%3D") otherwise decodes to the right query string plus
    // trailing garbage, which silently corrupts the property id it yields.
    if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(candidate)) continue;
    try {
      const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      if (decoded && /[\x20-\x7e]/.test(decoded)) pushCandidate(decoded);
    } catch { /* not base64 */ }
  }

  for (const candidate of candidates) {
    if (!candidate.includes('=')) continue;
    const params = new URLSearchParams(candidate.replace(/^\?/, ''));
    const fips = text(params.get('fips'));
    const apn = text(params.get('apn'));
    const propertyId = text(params.get('propertyid')) ?? text(params.get('propertyId'));
    if (!fips || !apn || !propertyId) continue;
    // A county FIPS is 4 or 5 digits and nothing else. Four digits means a
    // leading zero was dropped by a source that treated the code as a number
    // (state 01–09), and restoring it is lossless. Anything with non-digits, or
    // of any other length, identifies no county — it is rejected rather than
    // padded, so "abc" can never become the very real county "00000".
    const raw = fips.trim();
    if (!/^\d{4,5}$/.test(raw)) continue;
    const digits = raw.padStart(5, '0');
    const stateFips = digits.slice(0, 2);
    return {
      fips: digits,
      apn,
      propertyId,
      state: FIPS_TO_STATE[stateFips] ?? null,
      stateFips,
      countyFips: digits.slice(2),
    };
  }
  return null;
}

/**
 * The USPS state abbreviation for a 5-digit county FIPS code.
 *
 * Deterministic and offline: the state half of a FIPS code is a fixed federal
 * assignment. An unrecognised code returns null rather than a guess.
 */
export function stateFromCountyFips(fips: unknown): string | null {
  const digits = String(fips ?? '').replace(/\D/g, '');
  if (digits.length !== 5) return null;
  return FIPS_TO_STATE[digits.slice(0, 2)] ?? null;
}

/**
 * Strip the "County"/"Parish"/"Borough" suffix the Census publishes, so a
 * county name matches how property cards store it ("Grand Traverse", not
 * "Grand Traverse County"). The governing unit is unchanged; only the label is.
 */
export function bareCountyName(value: unknown): string | null {
  const name = text(value);
  if (!name) return null;
  const stripped = name
    .replace(/\s+(county|parish|borough|census area|municipality|city and borough)\s*$/i, '')
    .trim();
  return stripped || name;
}

/** Two county names refer to the same county, ignoring suffix and punctuation. */
export function countyNamesAgree(a: unknown, b: unknown): boolean {
  const key = (value: unknown): string =>
    (bareCountyName(value) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const left = key(a);
  const right = key(b);
  return !!left && left === right;
}

/** Two state values refer to the same state, whether abbreviated or spelled. */
export function stateNamesAgree(a: unknown, b: unknown, resolveName: (value: string) => string | null = uspsFromStateName): boolean {
  const key = (value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
    return (resolveName(raw) ?? raw).toUpperCase().replace(/[^A-Z]/g, '');
  };
  const left = key(a);
  const right = key(b);
  return !!left && left === right;
}

const STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI',
  MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY',
};

/** USPS abbreviation for a spelled state name ("Michigan" → "MI"). */
export function uspsFromStateName(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const abbr = raw.toUpperCase();
    return Object.values(STATE_NAMES).includes(abbr) ? abbr : null;
  }
  return STATE_NAMES[raw.toUpperCase()] ?? null;
}
