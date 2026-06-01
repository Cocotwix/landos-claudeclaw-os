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

    return lpFetch(`/property-data?${params}`);
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
