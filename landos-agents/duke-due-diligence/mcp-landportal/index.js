#!/usr/bin/env node
// LandPortal MCP server for Duke Due Diligence Agent.
// Transport: newline-delimited JSON-RPC over stdio.
// LP_JWT_TOKEN is read from process.env or the project .env file.
// The token is never logged, returned, printed, or committed.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

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

async function lpFetch(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
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
      'Retrieve detailed parcel data from LandPortal. Use propertyid and fips when available, or lat and lng as an alternative lookup.',
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
        lat: {
          type: 'number',
          description: 'Latitude for alternative lookup',
        },
        lng: {
          type: 'number',
          description: 'Longitude for alternative lookup',
        },
      },
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

async function callTool(name, args = {}) {
  if (name === 'lp_search') {
    const params = new URLSearchParams({
      type: args.type,
      query: args.query,
    });

    if (args.fips) params.set('fips', args.fips);
    if (args.state) params.set('state', args.state);

    return lpFetch(`/search?${params}`);
  }

  if (name === 'lp_property_data') {
    const params = new URLSearchParams();

    if (args.propertyid) params.set('propertyid', args.propertyid);
    if (args.fips) params.set('fips', args.fips);
    if (args.lat != null) params.set('lat', String(args.lat));
    if (args.lng != null) params.set('lng', String(args.lng));

    const raw = await lpFetch(`/property-data?${params}`);
    return buildPropertySummary(raw);
  }

  if (name === 'lp_comp_report_create') {
    return lpFetch('/reports', {
      method: 'POST',
      body: JSON.stringify({
        propertyid: args.propertyid,
        fips: args.fips,
      }),
    });
  }

  if (name === 'lp_comp_report_get') {
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

    try {
      const data = await callTool(name, args ?? {});
      sendToolResult(id, JSON.stringify(data, null, 2));
    } catch (err) {
      sendToolResult(id, `Tool error: ${err.message}`, true);
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
