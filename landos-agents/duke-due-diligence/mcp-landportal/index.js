#!/usr/bin/env node
// LandPortal MCP server for Duke Due Diligence Agent.
// Transport: newline-delimited JSON-RPC over stdio.
// LP_JWT_TOKEN is read from process.env or the project .env file.
// The token is never logged, returned, printed, or committed.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

import { paidCompDecision, compWorkflowMode } from './comp-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// mcp-landportal -> duke-due-diligence -> landos-agents -> claudeclaw-os
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function readEnvKey(key) {
  if (process.env[key]) return process.env[key];

  const envFile = path.join(PROJECT_ROOT, '.env');

  try {
    const content = fs.readFileSync(envFile, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const foundKey = trimmed.slice(0, eqIndex).trim();
      if (foundKey !== key) continue;

      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      return value || null;
    }
  } catch {
    return null;
  }

  return null;
}

const TOKEN = readEnvKey('LP_JWT_TOKEN');

if (!TOKEN) {
  process.stderr.write('[landportal-mcp] LP_JWT_TOKEN not found. Server cannot start.\n');
  process.exit(1);
}

const BASE_URL = 'https://landportal.com/wp-json/lp-rest-api/v1';

async function lpFetch(endpoint, options = {}, signal = null) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    ...(signal ? { signal } : {}),
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const responseText = await response.text();

  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = { raw_text: responseText };
  }

  if (!response.ok) {
    return {
      error: true,
      http_status: response.status,
      http_status_text: response.statusText,
      body,
    };
  }

  return body;
}

// ── lp_resolve_property helpers ───────────────────────────────────────────
// TODO: Add reliable local county/state or city/state to FIPS resolver from
// official public data (e.g. Census FIPS table). Do not use geocoding.

// USPS standard suffix abbreviations (Publication 28, Appendix C).
// Maps full-word street type inputs to the abbreviated form LP stores on disk.
// e.g. "Circle" -> "CIR" so the filter-data contains check finds "WILL JONES CIR".
const FULL_TO_ABBREV = {
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

// Split "731 Filter Plant Rd" into { number, streetBody }.
// streetBody is uppercased and trailing street-type suffix stripped so LP's
// "contains" comparison isn't blocked by how LP stores the suffix.
function parseStreetAddress(address) {
  const trimmed = (address ?? '').trim();
  const m = trimmed.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) return { number: '', streetBody: trimmed.toUpperCase() };

  const number = m[1];
  let street = m[2].trim().toUpperCase();

  // Normalize full-word suffix to its USPS abbreviation before the strip regex.
  // Prevents false negatives when the user types "Circle" but LP stores "CIR".
  const parts = street.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  if (parts.length > 1 && FULL_TO_ABBREV[lastWord]) {
    parts[parts.length - 1] = FULL_TO_ABBREV[lastWord];
    street = parts.join(' ');
  }

  street = street.replace(
    /\s+(RD|ST|AVE|BLVD|DR|LN|CT|WAY|PL|TER|TERR|HWY|PKWY|CIR|LOOP|TRAIL|TRL|PIKE|ROUTE|RT)\.?$/,
    ''
  ).trim();

  return { number, streetBody: street };
}

// Read a query value without URLSearchParams' `+` -> space conversion, so
// base64/base64url payloads and `+`-placeholder APNs survive intact.
function rawQueryParam(search, key) {
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

function decodeBase64Payload(value) {
  try {
    const norm = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 === 0 ? norm : norm + '='.repeat(4 - (norm.length % 4));
    const decoded = Buffer.from(pad, 'base64').toString('utf-8');
    return decoded.length ? decoded : null;
  } catch { return null; }
}

function parsePayloadField(payload, key) {
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

// Drop trailing placeholder APN segments (all-`+` or empty): "08-2518-++-++-" -> "08-2518".
function normalizeApn(raw) {
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

// Parse strong parcel identity from a LandPortal URL. Handles:
//   A. ?propertyid=...&fips=...
//   B. ?property=<base64|base64url> encoding fips/apn/ll_uuid (and propertyid)
//   C. path /<5-digit fips>/<numeric propertyid>
// Returns { propertyid, fips, apn, apnNormalized, llUuid } or null. Never coordinates.
function parseLpUrl(url) {
  try {
    const u = new URL(url);

    const qPropertyid = u.searchParams.get('propertyid');
    const qFips = u.searchParams.get('fips');
    if (qPropertyid && qFips) {
      return { propertyid: qPropertyid, fips: qFips, apn: null, apnNormalized: null, llUuid: null };
    }

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

    const parts = u.pathname.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if (/^\d{5}$/.test(parts[i]) && /^\d{6,}$/.test(parts[i + 1])) {
        return { propertyid: parts[i + 1], fips: parts[i], apn: null, apnNormalized: null, llUuid: null };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Name the identity already extracted from the LP URL instead of re-asking.
function buildLpUrlGapMessage(parsed) {
  const bits = [];
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

// Build normalized resolver result from a raw /property-data response.
// context: { source, submitted_address, fips }
function buildResolverResult(raw, context = {}) {
  const summary = buildPropertySummary(raw);

  if (!summary.success) {
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
    requests_left: summary.requests_left,
  };
}

// ── lp_property_data response shaper ──────────────────────────────────────
// Reduces a 100-128K raw LP response to ~1-2K by:
//   - Extracting only the fields Duke uses
//   - Converting every numeric field to string (eliminates type-concat errors)
//   - Collapsing the embedded `similars` JSON blob to a short statistical summary

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildPropertySummary(body) {
  const meta = body?.meta ?? {};
  const p = body?.data?.property;

  if (!p) {
    return {
      success: false,
      coverage_gap: true,
      requests_left: String(meta.requests_left ?? ''),
      message: 'No property data returned. Possible LP coverage gap for this location.',
    };
  }

  // Collapse similars (an embedded JSON string) to a statistical summary
  let simCount = 0;
  let simPpaMin = '';
  let simPpaMax = '';
  let simPpaMedian = '';
  let simRecentYear = '';
  let priceAcreCounty = '';

  if (p.similars) {
    try {
      const sims = JSON.parse(p.similars);
      if (Array.isArray(sims) && sims.length > 0) {
        simCount = sims.length;
        const ppas = sims
          .map(s => s.price_acres ?? s.mls_priceperacre)
          .filter(v => typeof v === 'number' && v > 0);
        if (ppas.length) {
          simPpaMin    = Math.min(...ppas).toFixed(0);
          simPpaMax    = Math.max(...ppas).toFixed(0);
          simPpaMedian = median(ppas).toFixed(0);
        }
        const years = sims.map(s => s.sold_year).filter(y => typeof y === 'number' && y > 0);
        if (years.length) simRecentYear = String(Math.max(...years));
        priceAcreCounty = String(sims[0]?.price_acre_county ?? '');
      }
    } catch { /* ignore parse errors in similars blob */ }
  }

  const str = v => (v == null ? '' : String(v));

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
      building_area_sqft:        str(p.buildingarea || p.sumbuildingsqft || 0),
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

const TOOLS = [
  {
    name: 'lp_resolve_property',
    description:
      'Resolve any supported property identifier to a verified parcel record. ' +
      'Handles address+city+state+fips, APN+state, owner+state, propertyid+fips, and LandPortal URL inputs. ' +
      'Never uses geocoding, coordinates, or nearest-parcel lookup. ' +
      'Always returns verified:true/false so Duke can confirm the correct parcel before proceeding. ' +
      'Address lookups require fips (5-digit county code). ' +
      'If fips is unknown, Duke must stop and ask Tyler for the county/FIPS. County-to-FIPS resolution is not yet implemented.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Street address without city/state (e.g. "731 Filter Plant Rd")',
        },
        city: {
          type: 'string',
          description: 'City name',
        },
        state: {
          type: 'string',
          description: 'Two-letter state code (e.g. "NC")',
        },
        fips: {
          type: 'string',
          description: 'FIPS county code (5 digits). Required for address lookup.',
        },
        apn: {
          type: 'string',
          description: 'APN / parcel number',
        },
        owner: {
          type: 'string',
          description: 'Owner name for owner search',
        },
        propertyid: {
          type: 'string',
          description: 'LandPortal property ID',
        },
        lp_url: {
          type: 'string',
          description: 'LandPortal property URL',
        },
      },
    },
  },
  {
    name: 'lp_search',
    description:
      'Search LandPortal by parcel number (parcelnumb) or owner name (owner). Returns matching properties with propertyid and fips.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['parcelnumb', 'owner'],
          description: 'Search type: parcelnumb or owner',
        },
        query: {
          type: 'string',
          description: 'APN or owner name',
        },
        fips: {
          type: 'string',
          description: 'Optional FIPS county code',
        },
        state: {
          type: 'string',
          description: 'Optional two-letter state abbreviation',
        },
      },
      required: ['type', 'query'],
    },
  },
  {
    name: 'lp_property_data',
    description:
      'Retrieve detailed parcel data from LandPortal using propertyid and fips. ' +
      'Requires propertyid + fips. No other lookup inputs are accepted. ' +
      'lat and lng are included in the returned data for reference only -- ' +
      'they must never be used as lookup inputs for parcel identification.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyid: {
          type: 'string',
          description: 'LandPortal property ID',
        },
        fips: {
          type: 'string',
          description: 'FIPS county code',
        },
      },
      required: ['propertyid', 'fips'],
    },
  },
  {
    name: 'lp_comp_report_create',
    description:
      "Create a LandPortal comp report. COSTS 1 COMP CREDIT. Duke must have Tyler's explicit approval before calling this tool.",
    inputSchema: {
      type: 'object',
      properties: {
        propertyid: {
          type: 'string',
          description: 'LandPortal property ID',
        },
        fips: {
          type: 'string',
          description: 'FIPS county code',
        },
      },
      required: ['propertyid', 'fips'],
    },
  },
  {
    name: 'lp_comp_report_get',
    description:
      'Retrieve a completed LandPortal comp report by propertyid and fips. No additional credit cost after creation.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyid: {
          type: 'string',
          description: 'LandPortal property ID',
        },
        fips: {
          type: 'string',
          description: 'FIPS county code',
        },
        report_id: {
          type: 'string',
          description: 'Optional report ID if returned by create',
        },
      },
      required: ['propertyid', 'fips'],
    },
  },
];

async function callTool(name, args = {}, signal = null) {
  if (name === 'lp_resolve_property') {
    // Path 1: LandPortal URL
    if (args.lp_url) {
      const parsed = parseLpUrl(args.lp_url);
      if (!parsed) {
        return {
          verified: false,
          status: 'not_verified',
          match_notes: 'Could not parse propertyid, APN, or FIPS from the provided LandPortal URL.',
          candidates: [],
        };
      }
      // Strongest: exact LP property ID + FIPS -> direct property-data.
      if (parsed.propertyid && parsed.fips) {
        const raw = await lpFetch(`/property-data?propertyid=${parsed.propertyid}&fips=${parsed.fips}`, {}, signal);
        return buildResolverResult(raw, { source: 'lp_url', fips: parsed.fips });
      }
      // Next: APN (normalized search key) + FIPS exact search via the parcelnumb path.
      const apnKey = parsed.apnNormalized ?? parsed.apn;
      if (apnKey) {
        const r = await callTool('lp_resolve_property', { apn: apnKey, ...(parsed.fips ? { fips: parsed.fips } : {}) }, signal);
        if (r && r.verified === false && r.status === 'not_verified') {
          return { ...r, match_notes: buildLpUrlGapMessage(parsed) };
        }
        return r;
      }
      return {
        verified: false,
        status: 'not_verified',
        match_notes: buildLpUrlGapMessage(parsed),
        candidates: [],
      };
    }

    // Path 2: Direct propertyid + fips
    if (args.propertyid && args.fips) {
      const raw = await lpFetch(`/property-data?propertyid=${args.propertyid}&fips=${args.fips}`, {}, signal);
      return buildResolverResult(raw, { source: 'propertyid_fips', fips: args.fips });
    }

    // Path 3: APN search
    if (args.apn) {
      const params = new URLSearchParams({ type: 'parcelnumb', query: args.apn });
      if (args.fips) params.set('fips', args.fips);
      if (args.state) params.set('state', args.state);
      const searchResult = await lpFetch(`/search?${params}`, {}, signal);

      if (searchResult.error) {
        return { verified: false, status: 'not_verified', match_notes: `APN search failed: ${searchResult.body?.message ?? searchResult.http_status}`, candidates: [] };
      }

      const items = extractSearchItems(searchResult);
      if (items.length === 0) {
        return { verified: false, status: 'not_verified', match_notes: 'No results found for this APN.', candidates: [] };
      }
      if (items.length > 1) {
        return {
          verified: false,
          status: 'multiple_candidates',
          match_notes: `${items.length} parcels matched this APN. Ask Tyler to select the correct one.`,
          candidates: items.slice(0, 5).map(formatCandidate),
        };
      }

      const match = items[0];
      if (!match.propertyid || !match.fips) {
        return { verified: false, status: 'not_verified', match_notes: 'APN search returned a result without propertyid or fips.', candidates: [] };
      }
      const raw = await lpFetch(`/property-data?propertyid=${match.propertyid}&fips=${match.fips}`, {}, signal);
      return buildResolverResult(raw, { source: 'apn_search', fips: match.fips });
    }

    // Path 4: Owner search
    if (args.owner) {
      const params = new URLSearchParams({ type: 'owner', query: args.owner });
      if (args.state) params.set('state', args.state);
      const searchResult = await lpFetch(`/search?${params}`, {}, signal);

      if (searchResult.error) {
        return { verified: false, status: 'not_verified', match_notes: `Owner search failed: ${searchResult.body?.message ?? searchResult.http_status}`, candidates: [] };
      }

      const items = extractSearchItems(searchResult);
      if (items.length === 0) {
        return { verified: false, status: 'not_verified', match_notes: 'No results found for this owner name.', candidates: [] };
      }
      if (items.length > 1) {
        return {
          verified: false,
          status: 'multiple_candidates',
          match_notes: `${items.length} parcels matched this owner. Ask Tyler to select the correct one.`,
          candidates: items.slice(0, 5).map(formatCandidate),
        };
      }

      const match = items[0];
      if (!match.propertyid || !match.fips) {
        return { verified: false, status: 'not_verified', match_notes: 'Owner search returned a result without propertyid or fips.', candidates: [] };
      }
      const raw = await lpFetch(`/property-data?propertyid=${match.propertyid}&fips=${match.fips}`, {}, signal);
      return buildResolverResult(raw, { source: 'owner_search', fips: match.fips });
    }

    // Path 5: Address + city + state
    if (args.address && args.city && args.state) {
      if (!args.fips) {
        return {
          verified: false,
          status: 'ambiguous_fips',
          match_notes: `County or FIPS required for address lookup. Cannot resolve "${args.address}, ${args.city}, ${args.state}" without county scoping. Ask Tyler for county name or 5-digit FIPS code.`,
          candidates: [],
        };
      }

      const { number, streetBody } = parseStreetAddress(args.address);

      const filterResult = await lpFetch('/filter-data/filter', {
        method: 'POST',
        body: JSON.stringify({
          filters: {
            fips:         { operator: 'condition', comparison: 'is',       value: [args.fips] },
            situshousenbr:{ operator: 'condition', comparison: 'is',       value: number },
            situsstreet:  { operator: 'condition', comparison: 'contains', value: streetBody },
            situscity:    { operator: 'condition', comparison: 'is',       value: args.city.toUpperCase() },
          },
        }),
      }, signal);

      if (filterResult.error || !filterResult.success) {
        return {
          verified: false,
          status: 'not_verified',
          match_notes: `Address filter search failed: ${filterResult.body?.message ?? filterResult.http_status ?? 'unknown error'}`,
          candidates: [],
        };
      }

      const properties = filterResult.data?.properties ?? [];
      const count = filterResult.data?.count ?? properties.length;

      if (count === 0 || properties.length === 0) {
        return {
          verified: false,
          status: 'not_verified',
          match_notes: `No parcel found in LP for "${args.address}, ${args.city}, ${args.state}" (FIPS ${args.fips}). Parcel may not exist in LP database or address format differs.`,
          candidates: [],
        };
      }

      if (properties.length > 1) {
        return {
          verified: false,
          status: 'multiple_candidates',
          match_notes: `${count} parcels matched this address. Ask Tyler to confirm the correct one.`,
          candidates: properties.slice(0, 5).map(formatCandidate),
        };
      }

      const match = properties[0];
      const raw = await lpFetch(`/property-data?propertyid=${match.propertyid}&fips=${match.fips}`, {}, signal);
      return buildResolverResult(raw, { source: 'address_filter', fips: match.fips, submitted_address: args.address });
    }

    return {
      verified: false,
      status: 'not_verified',
      match_notes: 'No usable identifier provided. Supply one of: address+city+state+fips, apn+state, owner+state, propertyid+fips, or lp_url.',
      candidates: [],
    };
  }

  if (name === 'lp_search') {
    const params = new URLSearchParams({
      type: args.type,
      query: args.query,
    });

    if (args.fips) params.set('fips', args.fips);
    if (args.state) params.set('state', args.state);

    return lpFetch(`/search?${params}`, {}, signal);
  }

  if (name === 'lp_property_data') {
    const params = new URLSearchParams();

    if (args.propertyid) params.set('propertyid', args.propertyid);
    if (args.fips) params.set('fips', args.fips);

    const raw = await lpFetch(`/property-data?${params}`, {}, signal);
    return buildPropertySummary(raw);
  }

  if (name === 'lp_comp_report_create') {
    // Paid comp credit: blocked unless running inside a live LandOS property
    // workflow. Default-deny. Checked BEFORE any network call so a build/test/
    // mock/seed/debug/unknown run can never spend a comp credit.
    const decision = paidCompDecision(name, compWorkflowMode());
    if (!decision.allowed) return decision.error;
    return lpFetch('/reports', {
      method: 'POST',
      body: JSON.stringify({
        propertyid: args.propertyid,
        fips: args.fips,
      }),
    });
  }

  if (name === 'lp_comp_report_get') {
    const decision = paidCompDecision(name, compWorkflowMode());
    if (!decision.allowed) return decision.error;
    const params = new URLSearchParams({
      propertyid: args.propertyid,
      fips: args.fips,
    });

    if (args.report_id) params.set('report_id', args.report_id);

    return lpFetch(`/reports?${params}`);
  }

  return {
    error: true,
    message: `Unknown tool: ${name}`,
  };
}

// Extract the items array from an lp_search response regardless of shape.
function extractSearchItems(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.data?.properties)) return result.data.properties;
  return [];
}

function formatCandidate(p) {
  return {
    propertyid: p.propertyid ?? p.id ?? null,
    fips: p.fips ?? null,
    apn: p.apn ?? p.parcelnumb ?? null,
    situs_address: p.situs_address ?? p.address ?? p.situsfullstreetaddress ?? null,
    owner: p.owner ?? p.ownername1full ?? null,
  };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendOk(id, result) {
  send({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function sendErr(id, code, message) {
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
}

function sendToolResult(id, text, isError = false) {
  const result = {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };

  if (isError) result.isError = true;

  sendOk(id, result);
}

// Per-fetch AbortController timeout. Each individual lpFetch call aborts at
// this limit via AbortSignal passed through callTool → lpFetch → fetch().
// lp_resolve_property makes at most 2 serial fetches (max 70s total),
// leaving Duke enough time to respond before the dashboard's 120s timeout.
const TOOL_TIMEOUT_MS = {
  lp_resolve_property: 35_000,
  lp_property_data:    35_000,
  lp_search:           25_000,
};

async function handle(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return sendOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'landportal',
        version: '1.0.0',
      },
    });
  }

  if (method === 'ping') {
    return sendOk(id, {});
  }

  if (method === 'tools/list') {
    return sendOk(id, {
      tools: TOOLS,
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params ?? {};

    if (!name) {
      return sendErr(id, -32602, 'Missing tool name');
    }

    const timeoutMs = TOOL_TIMEOUT_MS[name];
    const ac = timeoutMs ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const data = await callTool(name, args ?? {}, ac?.signal ?? null);
      if (timer) clearTimeout(timer);
      sendToolResult(id, JSON.stringify(data, null, 2));
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err.name === 'AbortError') {
        const seconds = Math.round(timeoutMs / 1000);
        process.stderr.write(`[landportal-mcp] ${name} fetch aborted after ${seconds}s\n`);
        sendToolResult(id, JSON.stringify({
          verified: false,
          status: 'lookup_timeout',
          timed_out: true,
          timeout_seconds: seconds,
          match_notes: `LandPortal ${name} fetch aborted after ${seconds}s. Parcel not verified. Do not score, value, or offer. Report lookup timed out.`,
        }, null, 2), true);
      } else {
        sendToolResult(id, `Tool error: ${err.message}`, true);
      }
    }

    return;
  }

  if (id == null) {
    return;
  }

  sendErr(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();

  if (!trimmed) return;

  let req;

  try {
    req = JSON.parse(trimmed);
  } catch {
    sendErr(null, -32700, 'Parse error');
    return;
  }

  handle(req).catch((err) => {
    process.stderr.write(`[landportal-mcp] ${err.message}\n`);
  });
});

rl.on('close', () => process.exit(0));

process.stderr.write('[landportal-mcp] started\n');
