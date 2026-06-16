import fs from 'fs';
import path from 'path';

import { PROJECT_ROOT } from '../config.js';

// ── Token reader ─────────────────────────────────────────────────────────────
// Reads LP_JWT_TOKEN from environment or .env. Never logs or exposes the value.
function readLpToken(): string | null {
  if (process.env.LP_JWT_TOKEN) return process.env.LP_JWT_TOKEN;
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== 'LP_JWT_TOKEN') continue;
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LpResolveArgs {
  address?: string;
  city?: string;
  state?: string;
  fips?: string;
  apn?: string;
  propertyid?: string;
  lp_url?: string;
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
}

export interface LpResolveResult {
  verified: boolean;
  status: 'verified' | 'not_verified' | 'multiple_candidates' | 'ambiguous_fips' | 'lookup_timeout' | 'error';
  propertyid: string | null;
  fips: string | null;
  apn: string | null;
  situs_address: string | null;
  city?: string | null;
  state?: string | null;
  owner: string | null;
  match_notes: string;
  property_summary?: LpPropertySummary;
  candidates?: Array<Record<string, unknown>>;
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
async function resolveByApnSearch(
  apn: string,
  opts: { fips?: string; state?: string },
  signal: AbortSignal,
): Promise<LpResolveResult> {
  const params = new URLSearchParams({ type: 'parcelnumb', query: apn });
  if (opts.fips) params.set('fips', opts.fips);
  if (opts.state) params.set('state', opts.state);
  const searchResult = await lpFetch(`/search?${params}`, {}, signal) as Record<string, unknown>;
  if (searchResult.error) {
    return {
      verified: false, status: 'not_verified', propertyid: null,
      fips: opts.fips ?? null, apn: null, situs_address: null, owner: null,
      match_notes: `APN search failed: ${(searchResult.body as Record<string, unknown>)?.message ?? searchResult.http_status}`,
      candidates: [],
    };
  }
  const items = extractSearchItems(searchResult);
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
  const raw = await lpFetch(
    `/property-data?propertyid=${match.propertyid}&fips=${match.fips}`,
    {}, signal,
  );
  return buildResolverResult(raw, { source: 'apn_search', fips: match.fips as string });
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
    },
  };
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

    // Path 3: APN search
    if (args.apn) {
      return resolveByApnSearch(args.apn, { fips: args.fips, state: args.state }, ac.signal);
    }

    // Path 4: Address + city + state + fips
    if (args.address && args.city && args.state) {
      if (!args.fips) {
        return {
          verified: false, status: 'ambiguous_fips', propertyid: null, fips: null,
          apn: null, situs_address: null, owner: null,
          match_notes: `County or FIPS required for address lookup of "${args.address}, ${args.city}, ${args.state}".`,
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
