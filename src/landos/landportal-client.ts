import fs from 'fs';
import path from 'path';

import { PROJECT_ROOT } from '../config.js';
import { readEnvFile } from '../env.js';

// ── Token reader ─────────────────────────────────────────────────────────────
// Reads a named token from the process environment or, as a fallback, the
// project .env file. Never logs or exposes the value.
function readTokenVar(key: string): string | null {
  if (process.env[key]) return process.env[key] as string;
  // Hermetic tests: when this flag is set (src/test-env-setup.ts), never read
  // the on-disk .env, so a developer's real token can neither satisfy nor leak
  // into a test. The flag is unset in production, so the runtime .env fallback
  // below is unchanged.
  if (process.env.LANDOS_DISABLE_DOTENV_FALLBACK) return null;
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) val = val.slice(1, -1);
      return val || null;
    }
  } catch { /* ignore */ }
  return null;
}

// v1 token (behavior unchanged): LP_JWT_TOKEN from environment or .env.
function readLpToken(): string | null {
  return readTokenVar('LP_JWT_TOKEN');
}

// v2 token: prefer LANDPORTAL_V2_TOKEN (the v2 host uses an opaque bearer token),
// falling back to LP_JWT_TOKEN for backward compatibility. Never logs or exposes
// the value.
function readLpV2Token(): string | null {
  return readTokenVar('LANDPORTAL_V2_TOKEN') ?? readLpToken();
}

/** Presence-only: true when a LandPortal token (v2 or v1) is configured. Never
 *  reads, logs, or returns the value. Respects the hermetic .env guard, so tests
 *  see it as unconfigured unless they set the env explicitly. Used by the parcel-
 *  identity capability router to decide LandPortal availability as a FALLBACK. */
export function landPortalConfigured(): boolean {
  return !!readLpV2Token();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LpResolveArgs {
  address?: string;
  city?: string;
  state?: string;
  fips?: string;
  apn?: string;
  propertyid?: string;
  lp_url?: string;
  zip?: string;
  /** Owner name for owner + county/state exact search (recovery path). */
  owner?: string;
  /** County name (without FIPS). Used to gate owner search when FIPS is absent
   *  so a known county is never silently broadened to a statewide match. */
  county?: string;
  /** Coordinates for candidate-only point discovery (v2). Never used as final
   *  verification: a point-derived parcel must be confirmed by APN/address. */
  point?: { latitude: number; longitude: number };
}

export interface LpPropertySummary {
  propertyid: string;
  apn: string;
  situs_address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  owner: string;
  land_use: string;
  lot_size_acres: string;
  calc_acres: string;
  lot_size_sqft: string;
  road_frontage_ft: string;
  land_locked: string;
  near_water: string;
  wetlands_pct: string;
  fema_pct: string;
  buildability_pct: string;
  buildability_acres: string;
  slope_avg_deg: string;
  elevation_avg_ft: string;
  building_area_sqft: string;
  assessed_total: string;
  assessed_land: string;
  market_total: string;
  market_land: string;
  tlp_estimate: string;
  tlp_ppa: string;
  price_acre_county: string;
  lat: string;
  lng: string;
  municipality: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  similars_count: string;
  similars_ppa_min: string;
  similars_ppa_max: string;
  similars_ppa_median: string;
  similars_most_recent_year: string;
  /** Individual similar-sale rows EMBEDDED in the non-comp property_data
   *  response (parsed from `property.similars`). No comp credit consumed. Empty
   *  when only aggregate stats were returned. */
  similar_sales: LpSimilarSale[];
}

/** One embedded similar-sale row from the non-comp property_data response. Only
 *  fields actually present are populated. Never coordinates. */
export interface LpSimilarSale {
  saleYear?: string;
  salePrice?: number;
  acres?: number;
  pricePerAcre?: number;
  apn?: string;
  propertyId?: string;
  addressOrCounty?: string;
}

/** One recorded exact-search attempt (deterministic trace). Never a coordinate
 *  or proximity query; only identity searches (parcelnumb/owner/address/id). */
export interface LpSearchAttempt {
  type: 'parcelnumb' | 'owner' | 'address' | 'propertyid_fips' | 'lp_url';
  query: string;
  state?: string | null;
  county?: string | null;
  fips?: string | null;
  /** Number of candidates the search returned, or null when the call errored. */
  resultCount: number | null;
}

export interface LpResolveResult {
  verified: boolean;
  status: 'verified' | 'not_verified' | 'multiple_candidates' | 'ambiguous_fips' | 'lookup_timeout' | 'error' | 'point_candidate';
  propertyid: string | null;
  fips: string | null;
  apn: string | null;
  situs_address: string | null;
  city?: string | null;
  state?: string | null;
  owner: string | null;
  match_notes: string;
  /** Provider provenance label (e.g. 'Realie.ai', 'Persisted verified Property
   *  Card'). Optional/additive; when absent the consumer defaults to the
   *  LandPortal label for backward compatibility. */
  source?: string;
  property_summary?: LpPropertySummary;
  candidates?: Array<Record<string, unknown>>;
  /** APN format variants generated for exact search (search keys only). */
  apnVariants?: string[];
  /** Ordered record of each exact-search attempt actually made. */
  searchAttempts?: LpSearchAttempt[];
}

/** Structured, secret-free Duke search trace. Exposes WHAT the deterministic
 *  engine parsed, the APN variants it generated, every search attempt it made,
 *  the selected candidate, why others were rejected, and the verification status.
 *  Never contains tokens, coordinates, proximity, or comp-credit spend. */
export interface DukeSearchTrace {
  parsedInput: {
    owner: string | null;
    apn: string | null;
    county: string | null;
    state: string | null;
    fips: string | null;
    address: string | null;
    lpUrl: boolean;
  };
  apnVariants: string[];
  searchAttempts: LpSearchAttempt[];
  selectedCandidate: { propertyid: string | null; fips: string | null; apn: string | null; situs_address: string | null; owner: string | null } | null;
  rejectionReasons: string[];
  verificationStatus: LpResolveResult['status'];
  /** The default report never spends a comp credit. Always 0 here. */
  compCreditsUsed: 0;
}

/**
 * Build the deterministic Duke search trace from the parsed args + the resolver
 * result. Pure: derives only from already-computed values. The selected
 * candidate is populated only when the parcel verified; otherwise the resolver's
 * match_notes is surfaced as the rejection reason (zero candidates, mismatch,
 * timeout, etc.). Exposes no secrets, coordinates, or proximity data.
 */
export function buildDukeSearchTrace(args: LpResolveArgs, result: LpResolveResult): DukeSearchTrace {
  return {
    parsedInput: {
      owner: args.owner ?? null,
      apn: args.apn ?? null,
      county: args.county ?? null,
      state: args.state ?? null,
      fips: args.fips ?? null,
      address: args.address ?? null,
      lpUrl: !!args.lp_url,
    },
    apnVariants: result.apnVariants ?? (args.apn ? apnSearchVariants(args.apn) : []),
    searchAttempts: result.searchAttempts ?? [],
    selectedCandidate: result.verified
      ? { propertyid: result.propertyid, fips: result.fips, apn: result.apn, situs_address: result.situs_address, owner: result.owner }
      : null,
    rejectionReasons: result.verified ? [] : [result.match_notes].filter(Boolean),
    verificationStatus: result.status,
    compCreditsUsed: 0,
  };
}

// ── LP HTTP layer ─────────────────────────────────────────────────────────────

const LP_BASE = 'https://landportal.com/wp-json/lp-rest-api/v1';

async function lpFetch(
  endpoint: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const token = readLpToken();
  if (!token) throw new Error('LP_JWT_TOKEN not configured');
  const res = await fetch(`${LP_BASE}${endpoint}`, {
    ...options,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  if (!res.ok) return { error: true, http_status: res.status, body };
  return body;
}

// ── Utilities (mirrors mcp-landportal/index.js) ───────────────────────────────

const FULL_TO_ABBREV: Record<string, string> = {
  ALLEY: 'ALY', AVENUE: 'AVE', BOULEVARD: 'BLVD', CIRCLE: 'CIR',
  CIRCLES: 'CIRS', COURT: 'CT', COURTS: 'CTS', COVE: 'CV',
  CROSSING: 'XING', DRIVE: 'DR', DRIVES: 'DRS', EXPRESSWAY: 'EXPY',
  FREEWAY: 'FWY', HIGHWAY: 'HWY', LANE: 'LN', LANES: 'LNS',
  LOOP: 'LOOP', PARKWAY: 'PKWY', PARKWAYS: 'PKWYS',
  PIKE: 'PIKE', PLACE: 'PL', PLACES: 'PLS', ROAD: 'RD',
  ROADS: 'RDS', ROUTE: 'RT', ROUTES: 'RTS', SQUARE: 'SQ',
  STREET: 'ST', STREETS: 'STS', TERRACE: 'TER', TRAIL: 'TRL',
  TRAILS: 'TRLS', WAY: 'WAY', WAYS: 'WAYS',
};

function parseStreetAddress(address: string): { number: string; streetBody: string } {
  const trimmed = (address ?? '').trim();
  const m = trimmed.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return { number: '', streetBody: trimmed.toUpperCase() };
  const number = m[1];
  let street = m[2].trim().toUpperCase();
  const parts = street.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  if (parts.length > 1 && FULL_TO_ABBREV[lastWord]) {
    parts[parts.length - 1] = FULL_TO_ABBREV[lastWord];
    street = parts.join(' ');
  }
  street = street.replace(
    /\s+(RD|ST|AVE|BLVD|DR|LN|CT|WAY|PL|TER|TERR|HWY|PKWY|CIR|LOOP|TRAIL|TRL|PIKE|ROUTE|RT)\.?$/,
    '',
  ).trim();
  return { number, streetBody: street };
}

/** Strong identity extracted from a LandPortal URL. Identity only -- never
 * coordinates, map pins, or proximity. */
export interface ParsedLpUrl {
  propertyid: string | null;
  fips: string | null;
  apn: string | null;           // raw, e.g. "08-2518-++-++-"
  apnNormalized: string | null; // search key, e.g. "08-2518"
  llUuid: string | null;
}

/**
 * Read a query-string value WITHOUT the `+` -> space conversion that
 * URLSearchParams applies. Base64 / base64url payloads must survive intact,
 * and the decoded APN can itself contain literal `+` placeholder segments.
 */
function rawQueryParam(search: string, key: string): string | null {
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of q.split('&')) {
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    if (k === key) {
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

/** Decode a base64 or base64url string to UTF-8, or null if it isn't valid. */
function decodeBase64Payload(value: string): string | null {
  try {
    const norm = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 === 0 ? norm : norm + '='.repeat(4 - (norm.length % 4));
    const decoded = Buffer.from(pad, 'base64').toString('utf-8');
    return decoded.length ? decoded : null;
  } catch { return null; }
}

/** Read a field from a urlencoded payload, preserving literal `+` characters. */
function parsePayloadField(payload: string, key: string): string | null {
  for (const pair of payload.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq) === key) {
      const v = pair.slice(eq + 1);
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

/**
 * Normalize an APN into a safe search key by dropping trailing placeholder
 * segments (all-`+` or empty). e.g. "08-2518-++-++-" -> "08-2518".
 * A normal APN like "12-345-678" is returned unchanged.
 */
export function normalizeApn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const segs = String(raw).split('-');
  while (segs.length > 1) {
    const last = segs[segs.length - 1];
    if (last === '' || /^\++$/.test(last)) segs.pop();
    else break;
  }
  const out = segs.join('-').trim();
  return out.length ? out : null;
}

/**
 * Parse strong parcel identity from a LandPortal URL. Handles three forms:
 *   A. ?propertyid=...&fips=...
 *   B. ?property=<base64|base64url> encoding fips/apn/ll_uuid (and propertyid)
 *   C. path /<5-digit fips>/<numeric propertyid>
 * Returns null when no usable identifier is present. Never derives coordinates.
 */
export function parseLandPortalUrl(url: string): ParsedLpUrl | null {
  try {
    const u = new URL(url);

    // Form A: explicit propertyid + fips query params
    const qPropertyid = u.searchParams.get('propertyid');
    const qFips = u.searchParams.get('fips');
    if (qPropertyid && qFips) {
      return { propertyid: qPropertyid, fips: qFips, apn: null, apnNormalized: null, llUuid: null };
    }

    // Form B: base64 ?property= payload
    const propertyParam = rawQueryParam(u.search, 'property');
    if (propertyParam) {
      const payload = decodeBase64Payload(propertyParam);
      if (payload && /(?:^|&)(?:fips|apn|ll_uuid|propertyid)=/.test(payload)) {
        const fips = parsePayloadField(payload, 'fips');
        const apn = parsePayloadField(payload, 'apn');
        const llUuid = parsePayloadField(payload, 'll_uuid');
        const propertyid = parsePayloadField(payload, 'propertyid');
        if (fips || apn || llUuid || propertyid) {
          return {
            propertyid: propertyid ?? null,
            fips: fips ?? null,
            apn: apn ?? null,
            apnNormalized: normalizeApn(apn),
            llUuid: llUuid ?? null,
          };
        }
      }
    }

    // Form C: path /<fips>/<propertyid>
    const parts = u.pathname.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if (/^\d{5}$/.test(parts[i]) && /^\d{6,}$/.test(parts[i + 1])) {
        return { propertyid: parts[i + 1], fips: parts[i], apn: null, apnNormalized: null, llUuid: null };
      }
    }

    return null;
  } catch { return null; }
}

/**
 * Map parsed LP-URL identity to the strongest direct-lookup args. Prefers exact
 * LandPortal property ID + FIPS, otherwise APN (normalized search key) + FIPS.
 * Identity only -- never produces coordinates, an address from proximity, or any
 * map-derived input. Returns null when nothing usable is present.
 */
export function lpUrlIdentityToArgs(parsed: ParsedLpUrl): LpResolveArgs | null {
  if (parsed.propertyid && parsed.fips) {
    return { propertyid: parsed.propertyid, fips: parsed.fips };
  }
  const apnKey = parsed.apnNormalized ?? parsed.apn;
  if (apnKey && parsed.fips) return { apn: apnKey, fips: parsed.fips };
  if (apnKey) return { apn: apnKey };
  return null;
}

/**
 * Build a precise unverified message that names the identity already extracted
 * from the LP URL, instead of re-asking Tyler for data he supplied. Used when
 * the URL parsed cleanly but the exact LP lookup could not confirm one parcel.
 */
export function buildLpUrlGapMessage(parsed: ParsedLpUrl): string {
  const bits: string[] = [];
  if (parsed.fips) bits.push(`FIPS ${parsed.fips}`);
  const apn = parsed.apnNormalized ?? parsed.apn;
  if (apn) bits.push(`APN ${apn}`);
  if (parsed.llUuid) bits.push(`LP UUID ${parsed.llUuid}`);
  if (parsed.propertyid) bits.push(`property ID ${parsed.propertyid}`);
  const ident = bits.length ? bits.join(', ') : 'the LandPortal identifiers';
  return (
    'Parcel not verified -- no scoring, valuation, or offer. ' +
    `Parsed the LandPortal URL identity (${ident}), but the exact LP lookup did not confirm a single parcel. ` +
    'This is a lookup/wrapper gap, not missing input. ' +
    'Verify via county assessor/GIS by APN + county, or confirm the exact LP property ID + FIPS.'
  );
}

/** Resolve a parcel by APN exact search (+ optional fips/state scoping). */
// ── Exact-search recovery variants (never coordinates/proximity) ──────────────

/**
 * Safe APN format variants for exact search. Generates the common formats LP /
 * county indexes may store WITHOUT changing the core digits. e.g. "051   012.05"
 * -> ["051   012.05","051 012.05","051-012.05","051/012.05","051012.05","05101205"].
 * The digits-only variant (e.g. "05101205") is a SEARCH variant only — a parcel
 * is still accepted only when the returned APN/county/FIPS identity matches.
 */
export function apnSearchVariants(raw: string | null | undefined): string[] {
  const base = (raw ?? '').trim();
  if (!base) return [];
  const collapsed = base.replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  out.add(base);                                 // exactly as given
  out.add(collapsed);                            // collapsed whitespace
  out.add(collapsed.replace(/\s+/g, '-'));       // dash-separated
  out.add(collapsed.replace(/\s+/g, '/'));       // slash-separated
  out.add(collapsed.replace(/\s+/g, ''));        // whitespace removed (keeps dot)
  const digitsOnly = base.replace(/[^0-9]/g, '');// decimal/punctuation-stripped digits
  if (digitsOnly.length >= 4) out.add(digitsOnly);
  return [...out].filter((v) => v.length >= 2);  // LP search minimum is 2 chars
}

/**
 * Safe owner-name search variants for exact search, constrained to the known
 * county/state by the caller. e.g. "Cheryl Sann" -> ["Cheryl Sann","Sann Cheryl",
 * "CHERYL SANN","SANN CHERYL","Sann","SANN"]. Never broadens beyond name forms.
 */
export function ownerSearchVariants(owner: string | null | undefined): string[] {
  const base = (owner ?? '').replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const out = new Set<string>();
  out.add(base);
  const toks = base.split(' ').filter(Boolean);
  if (toks.length >= 2) {
    const swapped = [...toks].reverse().join(' ');
    out.add(swapped);
    out.add(base.toUpperCase());
    out.add(swapped.toUpperCase());
    const last = toks[toks.length - 1];
    out.add(last);
    out.add(last.toUpperCase());
  } else {
    out.add(base.toUpperCase());
  }
  return [...out].filter((v) => v.length >= 2);
}

/** Resolve by APN, trying safe format variants before declaring a miss. Stops at
 *  the first variant that definitively verifies or returns multiple candidates. */
async function resolveByApnSearch(
  apn: string,
  opts: { fips?: string; state?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  const variants = apnSearchVariants(apn);
  const attempts: LpSearchAttempt[] = [];
  // Attach the full variant list + recorded attempts to every return path so the
  // deterministic trace shows exactly what was tried before any verdict.
  const withTrace = (r: LpResolveResult): LpResolveResult => ({ ...r, apnVariants: variants, searchAttempts: attempts });
  let lastDetail: LpResolveResult | null = null;
  const tried: string[] = [];
  for (const variant of variants) {
    tried.push(variant);
    const res = await resolveByApnSearchSingle(variant, apn, opts, signal, attempts);
    if (res.verified || res.status === 'multiple_candidates' || res.status === 'error') return withTrace(res);
    if (res.status === 'lookup_timeout') return withTrace(res);
    lastDetail = res;
  }
  // Zero-candidate output ALWAYS names the exact variants tried so a miss is
  // never indistinguishable from "never searched". The hyphenated form is in
  // this list, proving 051-012.05 was attempted before declaring zero.
  const triedNote = `Exact-format variants tried (${tried.length}): ${tried.join(', ')}.`;
  const base: LpResolveResult = lastDetail ?? {
    verified: false, status: 'not_verified', propertyid: null,
    fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
    match_notes: `No results found for APN "${apn}".`,
    candidates: [],
  };
  return withTrace({ ...base, match_notes: `${base.match_notes} ${triedNote}` });
}

async function resolveByApnSearchSingle(
  query: string,
  apn: string,
  opts: { fips?: string; state?: string },
  signal: AbortSignal,
  attempts?: LpSearchAttempt[],
): Promise<LpResolveResult> {
  const params = new URLSearchParams({ type: 'parcelnumb', query });
  if (opts.fips) params.set('fips', opts.fips);
  if (opts.state) params.set('state', opts.state);
  const searchResult = await lpFetch(`/search?${params}`, {}, signal) as Record<string, unknown>;
  if (searchResult.error) {
    attempts?.push({ type: 'parcelnumb', query, state: opts.state ?? null, fips: opts.fips ?? null, resultCount: null });
    return {
      verified: false, status: 'error', propertyid: null,
      fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
      match_notes: `APN search failed: ${(searchResult.body as Record<string, unknown>)?.message ?? searchResult.http_status}`,
      candidates: [],
    };
  }
  const items = extractSearchItems(searchResult);
  attempts?.push({ type: 'parcelnumb', query, state: opts.state ?? null, fips: opts.fips ?? null, resultCount: items.length });
  if (items.length === 0) {
    return {
      verified: false, status: 'not_verified', propertyid: null,
      fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
      match_notes: 'No results found for this APN.', candidates: [],
    };
  }
  if (items.length > 1) {
    return {
      verified: false, status: 'multiple_candidates', propertyid: null,
      fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
      match_notes: `${items.length} parcels matched this APN. Ask Tyler to select the correct one.`,
      candidates: items.slice(0, 5).map(formatCandidate),
    };
  }
  const match = items[0];
  if (!match.propertyid || !match.fips) {
    return {
      verified: false, status: 'not_verified', propertyid: null,
      fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
      match_notes: 'APN search returned result without propertyid or fips.', candidates: [],
    };
  }
  // County/FIPS identity gate: never accept a parcel from a different county.
  if (opts.fips && String(match.fips) !== opts.fips) {
    return {
      verified: false, status: 'not_verified', propertyid: null,
      fips: opts.fips, apn: null, situs_address: null, owner: null,
      match_notes: `APN matched a parcel in FIPS ${match.fips}, not the expected FIPS ${opts.fips}. Parcel not verified.`,
      candidates: [],
    };
  }
  const raw = await lpFetch(
    `/property-data?propertyid=${match.propertyid}&fips=${match.fips}`,
    {}, signal,
  );
  const res = buildResolverResult(raw, { source: 'apn_search', fips: match.fips as string });
  // Strict APN identity gate: buildResolverResult defaults verified=true, so a
  // broad variant (e.g. digits-only "05101205") could otherwise verify a same-FIPS
  // but different-APN parcel. Only accept when the returned parcel's APN matches
  // the submitted APN (normalized). A variant is search-only, never proof.
  if (res.verified && !apnMatches(apn, res.apn)) {
    return {
      ...res,
      verified: false,
      status: 'not_verified',
      match_notes: `APN search returned a parcel with APN "${res.apn}" (FIPS ${match.fips}) that does not match the submitted APN "${apn}". Parcel not verified.`,
    };
  }
  return res;
}

/** Normalize a county name for comparison: "Clay County" / "Clay" -> "CLAY". */
function countyNorm(c: string | null | undefined): string {
  return (c ?? '').toUpperCase().replace(/\bCOUNTY\b/g, '').replace(/[^A-Z0-9]/g, '').trim();
}

/** Resolve by owner name + county/state, trying safe name variants constrained
 *  to the known county/FIPS. Accepts only a single county-matching parcel. When
 *  only a county name (no FIPS) is known, owner+state search is treated as RECALL
 *  and candidates are county-gated; a known county is never broadened to statewide
 *  verification. State-only (no county/FIPS) cannot verify (wrapper gap). */
async function resolveByOwnerSearch(
  owner: string,
  opts: { fips?: string; state?: string; county?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  const reqCounty = countyNorm(opts.county);
  const canGate = !!opts.fips || !!reqCounty; // never verify statewide-only owner results
  const attempts: LpSearchAttempt[] = [];
  const withTrace = (r: LpResolveResult): LpResolveResult => ({ ...r, searchAttempts: [...(r.searchAttempts ?? []), ...attempts] });
  let lastDetail: LpResolveResult | null = null;
  for (const variant of ownerSearchVariants(owner)) {
    const params = new URLSearchParams({ type: 'owner', query: variant });
    if (opts.fips) params.set('fips', opts.fips);
    if (opts.state) params.set('state', opts.state);
    const searchResult = await lpFetch(`/search?${params}`, {}, signal) as Record<string, unknown>;
    if (searchResult.error) {
      attempts.push({ type: 'owner', query: variant, state: opts.state ?? null, county: opts.county ?? null, fips: opts.fips ?? null, resultCount: null });
      return withTrace({
        verified: false, status: 'error', propertyid: null,
        fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
        match_notes: `Owner search failed: ${(searchResult.body as Record<string, unknown>)?.message ?? searchResult.http_status}`,
        candidates: [],
      });
    }
    let items = extractSearchItems(searchResult);
    // County/FIPS gate: never accept owner matches from another county.
    if (opts.fips) items = items.filter((it) => String(it.fips ?? '') === opts.fips);
    else if (reqCounty) items = items.filter((it) => countyNorm(String(it.county ?? '')) === reqCounty);
    attempts.push({ type: 'owner', query: variant, state: opts.state ?? null, county: opts.county ?? null, fips: opts.fips ?? null, resultCount: items.length });
    if (items.length === 0) continue;
    if (!canGate) {
      // State-only owner search returned results but cannot be county-filtered;
      // do NOT verify a statewide match. Surface a wrapper gap (recall only).
      return withTrace({
        verified: false, status: 'not_verified', propertyid: null,
        fips: null, apn: null, situs_address: null, owner: null,
        match_notes: `Owner "${owner}" returned statewide results in ${opts.state ?? 'the state'}; a county or FIPS is required to verify (owner search cannot be county-filtered statewide). Parcel not verified -- recall only.`,
        candidates: items.slice(0, 5).map(formatCandidate),
      });
    }
    if (items.length > 1) {
      return withTrace({
        verified: false, status: 'multiple_candidates', propertyid: null,
        fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
        match_notes: `${items.length} parcels matched owner "${owner}" in this county. Provide APN or street address to confirm the correct parcel.`,
        candidates: items.slice(0, 5).map(formatCandidate),
      });
    }
    const m = items[0];
    if (!m.propertyid || !m.fips) { lastDetail = null; continue; }
    const raw = await lpFetch(`/property-data?propertyid=${m.propertyid}&fips=${m.fips}`, {}, signal);
    const res = buildResolverResult(raw, { source: 'owner_search', fips: m.fips as string });
    if (res.verified) return withTrace(res);
    lastDetail = res;
  }
  return withTrace(lastDetail ?? {
    verified: false, status: 'not_verified', propertyid: null,
    fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
    match_notes: `No parcel found for owner "${owner}"${opts.fips ? ` in FIPS ${opts.fips}` : opts.county ? ` in ${opts.county} County` : ''} after exact-search name variants. Parcel not verified.`,
    candidates: [],
  });
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildPropertySummary(body: unknown): {
  success: boolean;
  requests_left: string;
  property?: LpPropertySummary;
  message?: string;
} {
  const raw = body as Record<string, unknown>;
  const meta = (raw?.meta ?? {}) as Record<string, unknown>;
  const p = ((raw?.data as Record<string, unknown>)?.property) as Record<string, unknown> | undefined;

  if (!p) {
    return {
      success: false,
      requests_left: String(meta.requests_left ?? ''),
      message: 'No property data returned.',
    };
  }

  let simCount = 0;
  let simPpaMin = '';
  let simPpaMax = '';
  let simPpaMedian = '';
  let simRecentYear = '';
  let priceAcreCounty = '';
  let simSales: LpSimilarSale[] = [];

  if (p.similars) {
    try {
      const sims = JSON.parse(p.similars as string);
      if (Array.isArray(sims) && sims.length > 0) {
        simCount = sims.length;
        const ppas = sims
          .map((s: Record<string, unknown>) => s.price_acres ?? s.mls_priceperacre)
          .filter((v): v is number => typeof v === 'number' && v > 0);
        if (ppas.length) {
          simPpaMin = Math.min(...ppas).toFixed(0);
          simPpaMax = Math.max(...ppas).toFixed(0);
          simPpaMedian = median(ppas).toFixed(0);
        }
        const years = sims
          .map((s: Record<string, unknown>) => s.sold_year)
          .filter((y): y is number => typeof y === 'number' && y > 0);
        if (years.length) simRecentYear = String(Math.max(...years));
        priceAcreCounty = String(sims[0]?.price_acre_county ?? '');
        // Surface the INDIVIDUAL embedded rows (already in this non-comp
        // response). Defensive key mapping; only populated fields are kept;
        // coordinates are never included.
        simSales = (sims as Array<Record<string, unknown>>).map(mapEmbeddedSimilar).filter(hasAnySimilarField);
      }
    } catch { /* ignore similars parse errors */ }
  }

  const str = (v: unknown) => (v == null ? '' : String(v));

  return {
    success: true,
    requests_left: str(meta.requests_left),
    property: {
      propertyid:                str(p.propertyid),
      apn:                       str(p.apn),
      situs_address:             str(p.situsfullstreetaddress),
      city:                      str(p.situscity),
      state:                     str(p.situsstate),
      zip:                       str(p.situszip5),
      county:                    str(p.situscounty),
      owner:                     str(p.ownername1full),
      land_use:                  str(p.landusecodedescription),
      lot_size_acres:            str(p.lotsizeacres),
      calc_acres:                str(p.calc_acres),
      lot_size_sqft:             str(p.lotsizesqft),
      road_frontage_ft:          str(p.road_frontage),
      land_locked:               str(p.land_locked),
      near_water:                str(p.wf_is_near_water),
      wetlands_pct:              str(p.wetlands_cover_percentage),
      fema_pct:                  str(p.fema_cover_percentage),
      buildability_pct:          str(p.buildability_total_perc),
      buildability_acres:        str(p.buildability_area),
      slope_avg_deg:             str(p.slope_average),
      elevation_avg_ft:          str(p.elevation_average),
      building_area_sqft:        str((p.buildingarea || p.sumbuildingsqft || 0)),
      assessed_total:            str(p.assdtotalvalue),
      assessed_land:             str(p.assdlandvalue),
      market_total:              str(p.markettotalvalue),
      market_land:               str(p.marketvalueland),
      tlp_estimate:              str(p.tlp_estimate),
      tlp_ppa:                   str(p.tlp_ppa),
      price_acre_county:         priceAcreCounty,
      lat:                       str(p.situslatitude),
      lng:                       str(p.situslongitude),
      municipality:              str(p.municipality),
      mailing_address:           str(p.mailingfullstreetaddress),
      mailing_city:              str(p.mailingcity),
      mailing_state:             str(p.mailingstate),
      similars_count:            str(simCount),
      similars_ppa_min:          simPpaMin,
      similars_ppa_max:          simPpaMax,
      similars_ppa_median:       simPpaMedian,
      similars_most_recent_year: simRecentYear,
      similar_sales:             simSales,
    },
  };
}

const simNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const simStr = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

/** Map one raw embedded similar-sale row to LpSimilarSale, covering common
 *  LandPortal key variants. Never reads lat/lng. */
function mapEmbeddedSimilar(s: Record<string, unknown>): LpSimilarSale {
  return {
    saleYear: simStr(s.sold_year ?? s.year ?? s.sale_year),
    salePrice: simNum(s.sold_price ?? s.sale_price ?? s.price ?? s.mls_price ?? s.saleprice ?? s.amount),
    acres: simNum(s.acres ?? s.lot_size_acres ?? s.calc_acres ?? s.lotsizeacres),
    pricePerAcre: simNum(s.price_acres ?? s.mls_priceperacre ?? s.price_per_acre ?? s.priceperacre),
    apn: simStr(s.apn ?? s.parcelnumb),
    propertyId: simStr(s.propertyid ?? s.property_id ?? s.id),
    addressOrCounty: simStr(s.situsfullstreetaddress ?? s.address ?? s.situs ?? s.situscounty ?? s.county),
  };
}

function hasAnySimilarField(r: LpSimilarSale): boolean {
  return !!(r.saleYear || r.salePrice || r.acres || r.pricePerAcre || r.apn || r.propertyId || r.addressOrCounty);
}

function buildResolverResult(
  raw: unknown,
  context: { source?: string; fips?: string; submitted_address?: string } = {},
): LpResolveResult {
  const summary = buildPropertySummary(raw);

  if (!summary.success || !summary.property) {
    return {
      verified: false,
      status: 'not_verified',
      propertyid: null,
      fips: context.fips ?? null,
      apn: null,
      situs_address: null,
      owner: null,
      match_notes: summary.message ?? 'No property data returned.',
      candidates: [],
    };
  }

  const p = summary.property;
  let verified = true;
  let match_notes = `Parcel resolved via ${context.source ?? 'direct lookup'}.`;

  if (context.submitted_address) {
    const { number, streetBody } = parseStreetAddress(context.submitted_address);
    const returned = (p.situs_address ?? '').toUpperCase();
    if (!returned.includes(streetBody) || !returned.includes(number)) {
      verified = false;
      match_notes = `Address mismatch -- submitted "${context.submitted_address}", LP returned "${p.situs_address}". Different road or number. Parcel not verified.`;
    }
  }

  return {
    verified,
    status: verified ? 'verified' : 'not_verified',
    propertyid: p.propertyid,
    fips: context.fips ?? null,
    apn: p.apn,
    situs_address: p.situs_address,
    city: p.city,
    state: p.state,
    owner: p.owner,
    match_notes,
    candidates: [],
    property_summary: p,
  };
}

function extractSearchItems(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r?.data)) return r.data as Array<Record<string, unknown>>;
  if (Array.isArray(r?.results)) return r.results as Array<Record<string, unknown>>;
  const dataProps = (r?.data as Record<string, unknown>)?.properties;
  if (Array.isArray(dataProps)) return dataProps as Array<Record<string, unknown>>;
  return [];
}

function formatCandidate(p: Record<string, unknown>): Record<string, unknown> {
  return {
    propertyid: p.propertyid ?? p.id ?? null,
    fips: p.fips ?? null,
    apn: p.apn ?? p.parcelnumb ?? null,
    situs_address: p.situs_address ?? p.address ?? p.situsfullstreetaddress ?? null,
    owner: p.owner ?? p.ownername1full ?? null,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolve a property identifier directly against the LP HTTP API with a hard
 * LandOS-controlled timeout. Used by the Duke preflight gate before runAgent
 * is invoked. Never logs or exposes LP_JWT_TOKEN.
 */
export async function lpResolveForPreflight(
  args: LpResolveArgs,
  timeoutMs: number,
): Promise<LpResolveResult> {
  // Feature flag: route to the LandPortal API v2 adapter only when explicitly
  // opted in. Default stays on the current v1 path so behavior is unchanged.
  if (lpApiVersion() === 'v2') return lpResolveForPreflightV2(args, timeoutMs);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // Path 1: LP URL
    if (args.lp_url) {
      const parsed = parseLandPortalUrl(args.lp_url);
      if (!parsed) {
        return {
          verified: false, status: 'not_verified', propertyid: null, fips: null,
          apn: null, situs_address: null, owner: null,
          match_notes: 'Could not parse propertyid, APN, or FIPS from LP URL.',
          candidates: [],
        };
      }
      // Strongest path: exact LP property ID + FIPS -> direct property-data.
      if (parsed.propertyid && parsed.fips) {
        const raw = await lpFetch(
          `/property-data?propertyid=${parsed.propertyid}&fips=${parsed.fips}`,
          {}, ac.signal,
        );
        return buildResolverResult(raw, { source: 'lp_url', fips: parsed.fips });
      }
      // Next: APN (normalized search key) + FIPS exact search.
      const apnKey = parsed.apnNormalized ?? parsed.apn;
      if (apnKey) {
        const r = await resolveByApnSearch(apnKey, { fips: parsed.fips ?? undefined }, ac.signal);
        // On a clean miss, name the parsed identity instead of re-asking for it.
        // Preserve multiple_candidates (keeps candidate list for disambiguation).
        if (!r.verified && r.status === 'not_verified') {
          return { ...r, match_notes: buildLpUrlGapMessage(parsed) };
        }
        return r;
      }
      // URL parsed but no propertyid+fips and no APN: surface the lookup gap.
      return {
        verified: false, status: 'not_verified', propertyid: null,
        fips: parsed.fips ?? null, apn: null, situs_address: null, owner: null,
        match_notes: buildLpUrlGapMessage(parsed),
        candidates: [],
      };
    }

    // Path 2: propertyid + fips
    if (args.propertyid && args.fips) {
      const raw = await lpFetch(
        `/property-data?propertyid=${args.propertyid}&fips=${args.fips}`,
        {}, ac.signal,
      );
      return buildResolverResult(raw, { source: 'propertyid_fips', fips: args.fips });
    }

    // Path 3: APN search (format variants), with an owner + county/state fallback.
    if (args.apn) {
      const apnRes = await resolveByApnSearch(args.apn, { fips: args.fips, state: args.state }, ac.signal);
      if (apnRes.verified || apnRes.status === 'multiple_candidates' || apnRes.status === 'error' || apnRes.status === 'lookup_timeout') {
        return apnRes;
      }
      if (args.owner && (args.fips || args.county || args.state)) {
        const ownerRes = await resolveByOwnerSearch(args.owner, { fips: args.fips, state: args.state, county: args.county }, ac.signal);
        if (ownerRes.verified || ownerRes.status === 'multiple_candidates') return ownerRes;
        return { ...apnRes, match_notes: `${apnRes.match_notes} Owner search ("${args.owner}") also did not verify.` };
      }
      return apnRes;
    }

    // Path 3b: owner + county/state exact search (no APN provided).
    if (args.owner && (args.fips || args.county || args.state)) {
      return resolveByOwnerSearch(args.owner, { fips: args.fips, state: args.state, county: args.county }, ac.signal);
    }

    // Path 4: Address + city + state + fips
    if (args.address && args.city && args.state) {
      if (!args.fips) {
        return {
          verified: false, status: 'ambiguous_fips', propertyid: null, fips: null,
          apn: null, situs_address: null, owner: null,
          match_notes:
            `Address parsed ("${args.address}, ${args.city}, ${args.state}"), but exact LandPortal ` +
            'address lookup requires a county/FIPS. No parcel verified -- no scoring, valuation, or offer. ' +
            'Resolve county via official county assessor/GIS records.',
          candidates: [],
        };
      }
      const { number, streetBody } = parseStreetAddress(args.address);
      const filterResult = await lpFetch('/filter-data/filter', {
        method: 'POST',
        body: JSON.stringify({
          filters: {
            fips:          { operator: 'condition', comparison: 'is',       value: [args.fips] },
            situshousenbr: { operator: 'condition', comparison: 'is',       value: number },
            situsstreet:   { operator: 'condition', comparison: 'contains', value: streetBody },
            situscity:     { operator: 'condition', comparison: 'is',       value: args.city.toUpperCase() },
          },
        }),
      }, ac.signal) as Record<string, unknown>;

      if (filterResult.error || !filterResult.success) {
        return {
          verified: false, status: 'not_verified', propertyid: null,
          fips: args.fips, apn: null, situs_address: null, owner: null,
          match_notes: `Address filter search failed: ${(filterResult.body as Record<string, unknown>)?.message ?? filterResult.http_status ?? 'unknown error'}`,
          candidates: [],
        };
      }
      const properties = ((filterResult.data as Record<string, unknown>)?.properties as Array<Record<string, unknown>>) ?? [];
      const count = ((filterResult.data as Record<string, unknown>)?.count as number) ?? properties.length;
      if (count === 0 || properties.length === 0) {
        return {
          verified: false, status: 'not_verified', propertyid: null,
          fips: args.fips, apn: null, situs_address: null, owner: null,
          match_notes: `No parcel found in LP for "${args.address}, ${args.city}, ${args.state}" (FIPS ${args.fips}).`,
          candidates: [],
        };
      }
      if (properties.length > 1) {
        return {
          verified: false, status: 'multiple_candidates', propertyid: null,
          fips: args.fips, apn: null, situs_address: null, owner: null,
          match_notes: `${count} parcels matched this address.`,
          candidates: properties.slice(0, 5).map(formatCandidate),
        };
      }
      const match = properties[0];
      const raw = await lpFetch(
        `/property-data?propertyid=${match.propertyid}&fips=${match.fips}`,
        {}, ac.signal,
      );
      return buildResolverResult(raw, {
        source: 'address_filter',
        fips: match.fips as string,
        submitted_address: args.address,
      });
    }

    return {
      verified: false, status: 'not_verified', propertyid: null, fips: null,
      apn: null, situs_address: null, owner: null,
      match_notes: 'No usable identifier provided.',
      candidates: [],
    };

  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return {
        verified: false,
        status: 'lookup_timeout',
        propertyid: null,
        fips: args.fips ?? null,
        apn: null,
        situs_address: null,
        owner: null,
        match_notes: `LandPortal preflight fetch aborted after ${Math.round(timeoutMs / 1000)}s.`,
        candidates: [],
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── LandPortal API v2 adapter (flag: LANDPORTAL_API_VERSION=v2) ────────────────
//
// Strict parcel verification is preserved. v2 endpoints used:
//   GET /v2/properties              (owner/parcelnumb/address search; <=10 results)
//   GET /v2/properties/{propertyId} (detail by id; optional fips)
//   GET /v2/properties/point        (CANDIDATE-ONLY; never final verification)
// A point-derived parcel is only ever a candidate: it must be confirmed by an
// APN or address match against seller input before it can be marked verified.

const LP_V2_BASE = 'https://api.landportal.com';

export interface LpApiVersionDeps {
  /** Process environment to consult (an explicit value here takes precedence). */
  processEnv?: Record<string, string | undefined>;
  /** Injected approved local-config reader (tests pass a fake; default reads .env
   *  via the approved readEnvFile helper). */
  readEnv?: (keys: string[]) => Record<string, string>;
}

/**
 * Resolve the LandPortal API version flag from the approved config source.
 *
 * Precedence: an explicitly-set, non-empty `process.env.LANDPORTAL_API_VERSION`
 * wins (an explicit `v1` also wins); otherwise the approved local `.env` resolver
 * (readEnvFile) supplies it. Absent everywhere -> the existing safe `v1` default.
 *
 * This closes the gap where the flag lived in `.env` but never reached the
 * process (the app loads `.env` via readEnvFile, not into process.env). Returns
 * ONLY 'v1' | 'v2' — never a secret, never a logged value. Hermetic tests
 * (LANDOS_DISABLE_DOTENV_FALLBACK) skip the `.env` read entirely.
 */
export function lpApiVersion(deps: LpApiVersionDeps = {}): 'v1' | 'v2' {
  const processEnv = deps.processEnv ?? process.env;
  const exported = (processEnv.LANDPORTAL_API_VERSION ?? '').trim();
  if (exported) return exported.toLowerCase() === 'v2' ? 'v2' : 'v1';
  // Hermetic guard (same one the v2 token reader uses): never touch the on-disk
  // .env in tests, so a developer's real config can neither satisfy nor leak.
  if (processEnv.LANDOS_DISABLE_DOTENV_FALLBACK) return 'v1';
  let fromFile = '';
  try {
    fromFile = ((deps.readEnv ?? readEnvFile)(['LANDPORTAL_API_VERSION'])['LANDPORTAL_API_VERSION'] ?? '').trim();
  } catch {
    fromFile = '';
  }
  return fromFile.toLowerCase() === 'v2' ? 'v2' : 'v1';
}

interface LpV2FetchError {
  error: true;
  http_status: number;
  code: string | null;
  message: string;
  request_id: string | null;
}
function isV2Error(x: unknown): x is LpV2FetchError {
  return !!x && typeof x === 'object' && (x as Record<string, unknown>).error === true;
}

/** v2 HTTP layer. Bearer auth via readLpV2Token (LANDPORTAL_V2_TOKEN, else
 *  LP_JWT_TOKEN). Never logs or returns the token. Maps HttpError
 *  ({ error: { code, message, request_id } }) into a safe shape. */
async function lpV2Fetch(path: string, signal?: AbortSignal): Promise<unknown> {
  const token = readLpV2Token();
  if (!token) throw new Error('LandPortal v2 token not configured (set LANDPORTAL_V2_TOKEN or LP_JWT_TOKEN)');
  const res = await fetch(`${LP_V2_BASE}${path}`, {
    signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  if (!res.ok) {
    const errObj = (((body as Record<string, unknown>)?.error) ?? {}) as Record<string, unknown>;
    return {
      error: true,
      http_status: res.status,
      code: (errObj.code as string) ?? null,
      message: (errObj.message as string) ?? ((body as Record<string, unknown>)?.message as string) ?? res.statusText ?? 'LandPortal v2 error',
      request_id: (errObj.request_id as string) ?? null,
    } satisfies LpV2FetchError;
  }
  return body;
}

const v2str = (v: unknown) => (v == null ? '' : String(v));

/** Map a v2 HttpError to a safe, secret-free LpResolveResult. */
function v2ErrorToResult(err: LpV2FetchError): LpResolveResult {
  const rid = err.request_id ? ` (request_id ${err.request_id})` : '';
  let label: string;
  switch (err.http_status) {
    case 401: label = 'LandPortal v2 authorization failed (token invalid, expired, revoked, or deleted).'; break;
    case 403: label = 'LandPortal v2 access forbidden (plan/scope restriction).'; break;
    case 429: label = 'LandPortal v2 rate limit / quota exhausted.'; break;
    default:  label = `LandPortal v2 error (HTTP ${err.http_status}${err.code ? `, ${err.code}` : ''}).`;
  }
  return {
    verified: false, status: 'error', propertyid: null, fips: null,
    apn: null, situs_address: null, owner: null,
    match_notes: `${label} Parcel not verified -- no scoring, valuation, or offer.${rid}`,
    candidates: [],
  };
}

function v2NotVerified(fips: string | null, notes: string, candidates: Array<Record<string, unknown>> = []): LpResolveResult {
  return {
    verified: false, status: 'not_verified', propertyid: null, fips,
    apn: null, situs_address: null, owner: null, match_notes: notes, candidates,
  };
}

function v2FeatureProps(feature: unknown): Record<string, unknown> | null {
  const p = (feature as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;
  return p ?? null;
}
function v2DetailProps(body: unknown): Record<string, unknown> | null {
  const data = (body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  return (data?.properties as Record<string, unknown>) ?? null;
}
function v2SearchFeatures(body: unknown): Array<Record<string, unknown>> {
  const data = (body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const features = data?.features;
  return Array.isArray(features) ? (features as Array<Record<string, unknown>>) : [];
}
function formatV2Candidate(feature: Record<string, unknown>): Record<string, unknown> {
  const p = v2FeatureProps(feature) ?? feature;
  return {
    propertyid: p.property_id ?? null,
    fips: p.fips ?? null,
    apn: p.apn ?? null,
    situs_address: p.street_address ?? null,
    owner: p.owner_full_name ?? null,
  };
}

/** Build the rich LpPropertySummary from v2 property attributes (snake_case). */
function summaryFromV2(p: Record<string, unknown>): LpPropertySummary {
  const acres = v2str(p.lot_size_acres);
  return {
    propertyid: v2str(p.property_id), apn: v2str(p.apn),
    situs_address: v2str(p.street_address), city: v2str(p.city), state: v2str(p.state),
    zip: v2str(p.zip_code), county: v2str(p.county), owner: v2str(p.owner_full_name),
    land_use: v2str(p.land_use_description), lot_size_acres: acres, calc_acres: acres,
    lot_size_sqft: '', road_frontage_ft: '', land_locked: '', near_water: '',
    wetlands_pct: '', fema_pct: '', buildability_pct: '', buildability_acres: '',
    slope_avg_deg: '', elevation_avg_ft: '', building_area_sqft: '',
    assessed_total: v2str(p.assessed_total_value), assessed_land: '', market_total: '',
    market_land: '', tlp_estimate: '', tlp_ppa: '', price_acre_county: '',
    lat: v2str(p.latitude), lng: v2str(p.longitude), municipality: '',
    mailing_address: '', mailing_city: '', mailing_state: '',
    similars_count: '', similars_ppa_min: '', similars_ppa_max: '',
    similars_ppa_median: '', similars_most_recent_year: '', similar_sales: [],
  };
}

// ── Identity matching (shared, tolerant-but-strict) ───────────────────────────

/** Canonical APN comparison key: uppercased, separators/placeholders removed.
 *  Tolerates dashes vs spaces vs decimals, county punctuation, and "++"
 *  placeholder suffixes; rejects different/transposed/missing core digits. */
export function apnMatchKey(apn: string | null | undefined): string {
  return (apn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function apnMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = apnMatchKey(a);
  return ka.length > 0 && ka === apnMatchKey(b);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

function normalizeStreet(addr: string | null | undefined): { number: string; street: string } {
  const up = (addr ?? '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = up.match(/^(\d+[A-Z]?)\s+(.+)$/);
  const number = m ? m[1] : '';
  const rest = m ? m[2] : up;
  const parts = rest.split(' ').filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (FULL_TO_ABBREV[last]) parts[parts.length - 1] = FULL_TO_ABBREV[last];
  }
  return { number, street: parts.join(' ') };
}

/** Street body similarity: tolerates minor typos and seller noise tokens
 *  ("P BLACK ST" vs "BLACK ST") but not a genuinely different road. */
function streetSimilar(a: string, b: string): boolean {
  const sa = a.replace(/\s+/g, '');
  const sb = b.replace(/\s+/g, '');
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (sa.length >= 4 && sb.length >= 4 && (sa.includes(sb) || sb.includes(sa))) return true;
  const d = levenshtein(sa, sb);
  return d <= Math.max(1, Math.floor(Math.min(sa.length, sb.length) * 0.15));
}

/**
 * Strong situs-address match after safe normalization. A fuzzy street match
 * alone is NEVER enough: identity is confirmed only when house number agrees
 * (when both have one), the street is exact/safely-fuzzy, AND a strong
 * locality/context check passes (FIPS, or state + ZIP/city). Any directly
 * conflicting locality field (city, state, FIPS, or ZIP without a confirming
 * FIPS) hard-rejects.
 */
export function addressStrongMatch(
  seller: { address?: string; city?: string; state?: string; zip?: string; fips?: string },
  lp: { street_address?: string; city?: string; state?: string; zip_code?: string; fips?: string },
): { match: boolean; reason: string } {
  const s = normalizeStreet(seller.address);
  const l = normalizeStreet(lp.street_address);

  // House number must match EXACTLY when the seller supplied one. A candidate
  // with a different number — or with NO house number at all (i.e. the road
  // record, not the specific parcel) — is rejected. This prevents a supplied
  // "472 West Rd" from matching bare "West Rd" road parcels.
  if (s.number) {
    if (!l.number) {
      return { match: false, reason: `house number supplied (${s.number}) but candidate has none ("${l.street}") — road record, not the parcel` };
    }
    if (s.number !== l.number) {
      return { match: false, reason: `house number mismatch (${s.number} vs ${l.number})` };
    }
  }
  // Street must be exact or safely fuzzy; a different road is an immediate reject.
  if (!streetSimilar(s.street, l.street)) {
    return { match: false, reason: `different road ("${s.street}" vs "${l.street}")` };
  }
  const streetExact = s.street.length > 0 && s.street.replace(/\s+/g, '') === l.street.replace(/\s+/g, '');

  const up = (v?: string) => (v ?? '').toUpperCase().trim();
  const zip5 = (v?: string) => (v == null ? '' : String(v).slice(0, 5).trim());
  const sState = up(seller.state), lState = up(lp.state);
  const sCity = up(seller.city), lCity = up(lp.city);
  const sZip = zip5(seller.zip), lZip = zip5(lp.zip_code);
  const sFips = (seller.fips ?? '').trim(), lFips = (lp.fips ?? '').trim();

  // Hard conflict rejections (only when both sides actually carry the field).
  if (sState && lState && sState !== lState) return { match: false, reason: 'state mismatch' };
  if (sCity && lCity && sCity !== lCity) return { match: false, reason: 'city mismatch' };
  if (sFips && lFips && sFips !== lFips) return { match: false, reason: 'FIPS mismatch' };

  const fipsMatch = !!sFips && !!lFips && sFips === lFips;
  // ZIP conflict rejects unless a stronger FIPS match confirms the same county.
  if (sZip && lZip && sZip !== lZip && !fipsMatch) {
    return { match: false, reason: 'ZIP mismatch' };
  }

  const stateMatch = !!sState && !!lState && sState === lState;
  const zipMatch = !!sZip && !!lZip && sZip === lZip;
  const cityMatch = !!sCity && !!lCity && sCity === lCity;

  // A strong locality/context check is REQUIRED before any match. Fuzzy street
  // similarity by itself never verifies.
  if (fipsMatch) {
    return { match: true, reason: 'address match confirmed by FIPS context' };
  }
  if (stateMatch && (zipMatch || cityMatch)) {
    return { match: true, reason: `address match confirmed by state + ${zipMatch ? 'ZIP' : 'city'} context` };
  }
  // State + exact street + same house number, only when the seller supplied no
  // city or ZIP to check against.
  if (stateMatch && streetExact && s.number && l.number && s.number === l.number && !sCity && !sZip) {
    return { match: true, reason: 'exact street + house number + state (no city/ZIP supplied)' };
  }

  return {
    match: false,
    reason: 'insufficient locality/context to verify (need matching FIPS, or matching state plus ZIP or city)',
  };
}

// ── v2 resolution paths ───────────────────────────────────────────────────────

async function resolveV2ByPropertyId(
  propertyId: string,
  fips: string,
  expect: { apn?: string; address?: string; city?: string; state?: string; zip?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  const params = new URLSearchParams();
  if (fips) params.set('fips', fips);
  const q = params.toString();
  const body = await lpV2Fetch(`/v2/properties/${encodeURIComponent(propertyId)}${q ? `?${q}` : ''}`, signal);
  if (isV2Error(body)) return v2ErrorToResult(body);
  const props = v2DetailProps(body);
  if (!props) return v2NotVerified(fips || null, 'LandPortal v2 returned no property detail. Parcel not verified -- no scoring, valuation, or offer.');

  const retApn = v2str(props.apn);
  const retFips = v2str(props.fips) || fips;
  let verified = true;
  let notes = `Parcel resolved via LandPortal v2 property_id ${propertyId} (API v2).`;

  if (expect.apn) {
    if (!apnMatches(expect.apn, retApn)) {
      verified = false;
      notes = `APN mismatch -- seller "${expect.apn}" vs LandPortal "${retApn}". Parcel not verified.`;
    } else if (fips && retFips && fips !== retFips) {
      verified = false;
      notes = `FIPS mismatch -- ${fips} vs ${retFips}. Parcel not verified.`;
    }
  }
  if (verified && expect.address) {
    const am = addressStrongMatch(
      { address: expect.address, city: expect.city, state: expect.state, zip: expect.zip, fips },
      { street_address: v2str(props.street_address), city: v2str(props.city), state: v2str(props.state), zip_code: v2str(props.zip_code), fips: retFips },
    );
    if (!am.match) {
      verified = false;
      notes = `Address ${am.reason} -- seller "${expect.address}" vs LandPortal "${v2str(props.street_address)}". Parcel not verified.`;
    }
  }

  return {
    verified,
    status: verified ? 'verified' : 'not_verified',
    propertyid: v2str(props.property_id) || propertyId,
    fips: retFips || null,
    apn: retApn || null,
    situs_address: v2str(props.street_address) || null,
    city: v2str(props.city) || null,
    state: v2str(props.state) || null,
    owner: v2str(props.owner_full_name) || null,
    match_notes: notes,
    candidates: [],
    property_summary: summaryFromV2(props),
  };
}

function v2Multiple(features: Array<Record<string, unknown>>, fips: string | null, label: string): LpResolveResult {
  return {
    verified: false, status: 'multiple_candidates', propertyid: null, fips,
    apn: null, situs_address: null, owner: null,
    match_notes: `${features.length} LandPortal v2 parcels matched ${label}. Parcel not verified -- specify APN, FIPS, or property ID. No scoring, valuation, or offer.`,
    candidates: features.slice(0, 5).map(formatV2Candidate),
  };
}

async function resolveV2ByApn(
  apn: string,
  opts: { fips?: string; state?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  // Tyler's submitted FIPS is the identity gate. It is NEVER replaced by a
  // search candidate's FIPS — a matching APN in the wrong county must reject.
  const requestedFips = opts.fips;
  let lastDetail: LpResolveResult | null = null;
  const tried: string[] = [];
  for (const variant of apnSearchVariants(apn)) {
    tried.push(variant);
    const params = new URLSearchParams({ parcelnumb: variant });
    if (opts.fips) params.set('fips', opts.fips);
    else if (opts.state) params.set('state', opts.state);
    const body = await lpV2Fetch(`/v2/properties?${params}`, signal);
    if (isV2Error(body)) return v2ErrorToResult(body);
    let features = v2SearchFeatures(body);
    // County/FIPS gate on candidates: when a FIPS was requested, drop any
    // candidate whose FIPS is present and different (wrong county).
    if (requestedFips) {
      features = features.filter(f => {
        const cf = v2str(v2FeatureProps(f)?.fips);
        return cf === '' || cf === requestedFips;
      });
    }
    if (features.length === 0) continue;
    const apnMatched = features.filter(f => apnMatches(apn, v2str(v2FeatureProps(f)?.apn)));
    const pool = apnMatched.length ? apnMatched : features;
    if (pool.length > 1) return v2Multiple(pool, requestedFips ?? null, `APN ${apn}`);
    const props = v2FeatureProps(pool[0]);
    if (!props?.property_id) continue;
    // Gate the detail lookup/verification with the REQUESTED FIPS (fall back to
    // the candidate's only when no FIPS was requested). resolveV2ByPropertyId
    // then rejects if the detail's FIPS differs from this gate.
    const gateFips = requestedFips || v2str(props.fips) || '';
    const res = await resolveV2ByPropertyId(v2str(props.property_id), gateFips, { apn }, signal);
    if (res.verified) return res;
    lastDetail = res; // single candidate did not verify (e.g. FIPS/APN mismatch) — try next variant
  }
  return lastDetail ?? v2NotVerified(
    opts.fips ?? null,
    `No LandPortal v2 result for APN ${apn}${opts.fips ? ` (FIPS ${opts.fips})` : ''} after exact-format variants (${tried.length} tried). Exact lookup miss -- parcel not verified, no scoring, valuation, or offer.`,
  );
}

/** v2 owner + county/state exact search, trying safe name variants constrained
 *  to the known county/FIPS. Accepts only a single county-matching parcel. */
async function resolveV2ByOwner(
  owner: string,
  opts: { fips?: string; state?: string; county?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  const requestedFips = opts.fips;
  const reqCounty = countyNorm(opts.county);
  const canGate = !!requestedFips || !!reqCounty; // never verify statewide-only owner results
  let lastDetail: LpResolveResult | null = null;
  for (const variant of ownerSearchVariants(owner)) {
    const params = new URLSearchParams({ owner: variant });
    if (opts.fips) params.set('fips', opts.fips);
    else if (opts.state) params.set('state', opts.state);
    const body = await lpV2Fetch(`/v2/properties?${params}`, signal);
    if (isV2Error(body)) return v2ErrorToResult(body);
    let features = v2SearchFeatures(body);
    // County/FIPS gate: prefer FIPS; else use the returned county name (recall).
    if (requestedFips) features = features.filter(f => v2str(v2FeatureProps(f)?.fips) === requestedFips);
    else if (reqCounty) features = features.filter(f => countyNorm(v2str(v2FeatureProps(f)?.county)) === reqCounty);
    if (features.length === 0) continue;
    if (!canGate) {
      return v2NotVerified(
        null,
        `Owner "${owner}" returned statewide results in ${opts.state ?? 'the state'}; a county or FIPS is required to verify (owner search cannot be county-filtered statewide). Parcel not verified -- recall only.`,
        features.slice(0, 5).map(formatV2Candidate),
      );
    }
    if (features.length > 1) return v2Multiple(features, requestedFips ?? null, `owner "${owner}"`);
    const props = v2FeatureProps(features[0]);
    if (!props?.property_id) continue;
    // Gate detail with the REQUESTED FIPS when known; the candidate is already
    // county/FIPS-filtered above, so its FIPS is safe when no FIPS was requested.
    const gateFips = requestedFips || v2str(props.fips) || '';
    const res = await resolveV2ByPropertyId(v2str(props.property_id), gateFips, {}, signal);
    if (res.verified) return res;
    lastDetail = res;
  }
  return lastDetail ?? v2NotVerified(
    requestedFips ?? null,
    `No LandPortal v2 parcel for owner "${owner}"${requestedFips ? ` in FIPS ${requestedFips}` : opts.county ? ` in ${opts.county} County` : ''} after exact-search name variants. Parcel not verified.`,
  );
}

async function resolveV2ByAddress(args: LpResolveArgs, signal: AbortSignal): Promise<LpResolveResult> {
  const params = new URLSearchParams({ address: args.address! });
  if (args.city) params.set('city', args.city);
  if (args.fips) params.set('fips', args.fips);
  else if (args.state) params.set('state', args.state);
  if (args.zip) params.set('zip', args.zip);
  const body = await lpV2Fetch(`/v2/properties?${params}`, signal);
  if (isV2Error(body)) return v2ErrorToResult(body);
  const features = v2SearchFeatures(body);
  if (features.length === 0) {
    return v2NotVerified(args.fips ?? null, `No LandPortal v2 result for "${args.address}". Exact lookup miss -- parcel not verified, no scoring, valuation, or offer.`);
  }
  const seller = { address: args.address, city: args.city, state: args.state, zip: args.zip, fips: args.fips };
  const strong = features.filter(f => {
    const p = v2FeatureProps(f) ?? {};
    return addressStrongMatch(seller, {
      street_address: v2str(p.street_address), city: v2str(p.city),
      state: v2str(p.state), zip_code: v2str(p.zip_code), fips: v2str(p.fips),
    }).match;
  });
  if (strong.length === 0) {
    return v2NotVerified(
      args.fips ?? null,
      `LandPortal v2 returned ${features.length} result(s) but none strongly match "${args.address}". Unverified candidate/mismatch -- no scoring, valuation, or offer.`,
      features.slice(0, 5).map(formatV2Candidate),
    );
  }
  if (strong.length > 1) return v2Multiple(strong, args.fips ?? null, `address "${args.address}"`);
  const props = v2FeatureProps(strong[0]);
  if (!props?.property_id) {
    return v2NotVerified(args.fips ?? null, 'LandPortal v2 search result missing property_id. Parcel not verified.');
  }
  const fips = v2str(props.fips) || args.fips || '';
  return resolveV2ByPropertyId(v2str(props.property_id), fips, {
    address: args.address, city: args.city, state: args.state, zip: args.zip,
  }, signal);
}

/**
 * Point lookup: CANDIDATE-ONLY. Coordinates can surface a candidate parcel but
 * can NEVER finalize verification. The candidate is promoted to verified only
 * when its returned APN or situs address matches the seller's APN/address.
 */
async function resolveV2Point(args: LpResolveArgs, signal: AbortSignal): Promise<LpResolveResult> {
  const { latitude, longitude } = args.point!;
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  const body = await lpV2Fetch(`/v2/properties/point?${params}`, signal);
  if (isV2Error(body)) {
    if (body.http_status === 404) {
      return v2NotVerified(args.fips ?? null, 'No parcel found at the supplied point. Candidate from point lookup unavailable -- parcel not verified.');
    }
    return v2ErrorToResult(body);
  }
  const props = v2DetailProps(body);
  if (!props) return v2NotVerified(args.fips ?? null, 'Point lookup returned no property. Parcel not verified.');

  const candApn = v2str(props.apn);
  const candFips = v2str(props.fips);
  const candAddr = v2str(props.street_address);
  const baseCand = {
    propertyid: v2str(props.property_id) || null,
    fips: candFips || null,
    apn: candApn || null,
    situs_address: candAddr || null,
    city: v2str(props.city) || null,
    state: v2str(props.state) || null,
    owner: v2str(props.owner_full_name) || null,
  };

  // APN confirmation for a point-derived candidate REQUIRES confirming county
  // context: APNs are not globally unique, so APN alone (or APN without matching
  // FIPS) can never verify a coordinate-discovered parcel. Strict rule: seller
  // FIPS and candidate FIPS must both be present and equal.
  const apnHit = !!args.apn && apnMatches(args.apn, candApn);
  const fipsBothPresent = !!args.fips && !!candFips;
  const fipsContextOk = fipsBothPresent && args.fips === candFips;
  const fipsMismatch = fipsBothPresent && args.fips !== candFips;

  let confirmed = false;
  let how = '';
  if (apnHit && fipsContextOk) {
    confirmed = true;
    how = `APN ${candApn} within matching FIPS ${candFips}`;
  } else if (args.address) {
    // Address path is governed by addressStrongMatch, which itself requires
    // locality/FIPS context before it returns a match.
    const am = addressStrongMatch(
      { address: args.address, city: args.city, state: args.state, zip: args.zip, fips: args.fips },
      { street_address: candAddr, city: v2str(props.city), state: v2str(props.state), zip_code: v2str(props.zip_code), fips: candFips },
    );
    if (am.match) { confirmed = true; how = `address "${candAddr}"`; }
  }

  if (confirmed) {
    return {
      ...baseCand,
      verified: true,
      status: 'verified',
      match_notes: `Candidate from point lookup CONFIRMED by ${how} match against seller input. Parcel verified (API v2).`,
      candidates: [],
      property_summary: summaryFromV2(props),
    };
  }

  let why: string;
  if (apnHit && fipsMismatch) {
    why = `APN ${candApn} matches but FIPS differs (seller ${args.fips} vs candidate ${candFips}) -- different county/jurisdiction, not the same parcel`;
  } else if (apnHit) {
    why = `APN ${candApn} matches but lacks confirming county/FIPS context (APNs are not globally unique); a point candidate cannot verify on APN alone`;
  } else {
    why = 'point/coordinates are candidate discovery only and require APN + matching FIPS, or an address + locality match, against seller input';
  }
  return {
    ...baseCand,
    verified: false,
    status: 'point_candidate',
    match_notes: `Candidate from point lookup (APN ${candApn || 'n/a'}, ${candAddr || 'no address'}). NOT verified -- ${why}. No scoring, valuation, or offer.`,
    candidates: [baseCand],
    property_summary: summaryFromV2(props),
  };
}

/** v2 entry point mirroring the v1 verification ladder; reached only via flag. */
async function lpResolveForPreflightV2(args: LpResolveArgs, timeoutMs: number): Promise<LpResolveResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Path 0: explicit point candidate (candidate-only discovery).
    if (args.point) return await resolveV2Point(args, ac.signal);

    // Path 1: LP URL -> parsed identity, then propertyid+fips or APN+fips.
    if (args.lp_url) {
      const parsed = parseLandPortalUrl(args.lp_url);
      if (!parsed) {
        return v2NotVerified(null, 'Could not parse propertyid, APN, or FIPS from LP URL. Parcel not verified.');
      }
      if (parsed.propertyid && parsed.fips) {
        return await resolveV2ByPropertyId(parsed.propertyid, parsed.fips, { apn: parsed.apnNormalized ?? parsed.apn ?? undefined }, ac.signal);
      }
      const apnKey = parsed.apnNormalized ?? parsed.apn;
      if (apnKey) {
        const r = await resolveV2ByApn(apnKey, { fips: parsed.fips ?? undefined }, ac.signal);
        if (!r.verified && r.status === 'not_verified') return { ...r, match_notes: buildLpUrlGapMessage(parsed) };
        return r;
      }
      return v2NotVerified(parsed.fips ?? null, buildLpUrlGapMessage(parsed));
    }

    // Path 2: property ID + FIPS.
    if (args.propertyid && args.fips) {
      return await resolveV2ByPropertyId(args.propertyid, args.fips, {}, ac.signal);
    }

    // Path 3: APN (format variants), with an owner + county/state fallback.
    if (args.apn) {
      const apnRes = await resolveV2ByApn(args.apn, { fips: args.fips, state: args.state }, ac.signal);
      if (apnRes.verified || apnRes.status === 'multiple_candidates' || apnRes.status === 'error' || apnRes.status === 'lookup_timeout') {
        return apnRes;
      }
      if (args.owner && (args.fips || args.county || args.state)) {
        const ownerRes = await resolveV2ByOwner(args.owner, { fips: args.fips, state: args.state, county: args.county }, ac.signal);
        if (ownerRes.verified || ownerRes.status === 'multiple_candidates') return ownerRes;
        return { ...apnRes, match_notes: `${apnRes.match_notes} Owner search ("${args.owner}") also did not verify.` };
      }
      return apnRes;
    }

    // Path 3b: owner + county/state exact search (no APN provided).
    if (args.owner && (args.fips || args.county || args.state)) {
      return await resolveV2ByOwner(args.owner, { fips: args.fips, state: args.state, county: args.county }, ac.signal);
    }

    // Path 4: address search. v2 supports address without FIPS, so a full
    // address with city/state/ZIP resolves directly (closes the v1 gap).
    if (args.address && (args.state || args.fips || args.city || args.zip)) {
      return await resolveV2ByAddress(args, ac.signal);
    }

    return v2NotVerified(null, 'No usable identifier provided. Parcel not verified.');
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return {
        verified: false, status: 'lookup_timeout', propertyid: null, fips: args.fips ?? null,
        apn: null, situs_address: null, owner: null,
        match_notes: `LandPortal v2 lookup aborted after ${Math.round(timeoutMs / 1000)}s. Parcel not verified.`,
        candidates: [],
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
