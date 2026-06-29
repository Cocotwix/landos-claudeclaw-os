// LandOS HomeHarvest comp lane — open-source nationwide land/farm retrieval.
//
// HomeHarvest (MIT, no API key) scrapes Realtor.com and exposes a dedicated
// `land`/`farm` property type with a radius search, sold (comps) and for_sale
// (actives) lanes, and a recency window. This is the strongest open-source
// replacement for the paid Apify Redfin lane (see the open-source provider
// evaluation in the DD decision log).
//
// This module is the Node boundary to the Python bridge (scripts/homeharvest_
// bridge.py). The Python call is behind an injectable runner so the mapping +
// classification are fully unit-testable with NO Python and NO network. Every
// retrieved row is run through the provider-agnostic comp-classification engine
// so a "LAND"-style listing that actually carries a manufactured home (it
// happens) can never contaminate the vacant-land band.
//
// HARD RULES: fail loud + honest status; never fabricate a price/date/URL; a row
// without a clickable source URL or usable price is dropped (never invented).

import { spawn } from 'node:child_process';
import { classifyComp, type CompClass } from '../comp-classification.js';

const SQFT_PER_ACRE = 43_560;

/** One normalized row from the HomeHarvest bridge (subset LandOS consumes). */
export interface HomeHarvestRow {
  property_url?: string | null;
  style?: string | null; // 'LAND' | 'FARM' | 'SINGLE_FAMILY' | ...
  status?: string | null;
  list_price?: number | null;
  sold_price?: number | null;
  last_sold_price?: number | null;
  list_date?: string | null;
  last_sold_date?: string | null;
  days_on_mls?: number | null;
  lot_sqft?: number | null;
  sqft?: number | null; // building area
  year_built?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  formatted_address?: string | null;
  full_street_line?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  county?: string | null;
  text?: string | null;
  listing_type?: 'sold' | 'for_sale' | string | null;
}

export interface HomeHarvestBridgeResponse {
  status: 'collected' | 'no_comps' | 'error';
  rows: HomeHarvestRow[];
  count: number;
  error: string | null;
}

export interface HomeHarvestRequest {
  location: string;
  listing_type: Array<'sold' | 'for_sale'>;
  property_type: string[];
  radius?: number;
  past_days?: number;
  limit?: number;
}

/** Injectable bridge boundary (one Python call). Tests mock this with no spawn. */
export interface HomeHarvestRunner {
  run(req: HomeHarvestRequest, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<HomeHarvestBridgeResponse>;
}

export interface HomeHarvestComp {
  price: number;
  saleDateIso: string; // sold date (sold) or list date (active); '' when absent
  acres: number | null;
  pricePerAcre: number | null;
  sourceUrl: string;
  sourceLabel: 'homeharvest';
  addressDesc?: string;
  daysOnMarket: number | null;
  // classification signals + result (so the band engine can re-verify, and the UI
  // can show why a row is land vs excluded).
  yearBuilt: number | null;
  buildingAreaSqft: number | null;
  propertyTypeText: string | null;
  descriptionText: string | null;
  compClass: CompClass;
  classReason: string;
}

export interface HomeHarvestResult {
  status: 'collected' | 'no_comps' | 'no_area' | 'not_available' | 'error';
  /** Raw-land (vacant_land | farm) SOLD comps — eligible to drive the band. */
  sold: HomeHarvestComp[];
  /** Raw-land ACTIVE listings — asking-market context. */
  active: HomeHarvestComp[];
  /** Count of rows dropped because they classified as non-land (kept honest). */
  excludedNonLand: number;
  source: string;
  timestamp: string;
  note: string;
}

export interface HomeHarvestQuery {
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
}

export interface HomeHarvestDeps {
  runner?: HomeHarvestRunner;
  now?: () => string;
  nowMs?: number;
  radiusMiles?: number;
  pastDays?: number;
  limit?: number;
  recencyMonths?: number;
  /** Override the python executable / bridge path for the default runner. */
  env?: Record<string, string | undefined>;
}

const RAW_LAND: ReadonlySet<CompClass> = new Set(['vacant_land', 'farm']);

/** Build the HomeHarvest `location` string. A street address enables the radius
 *  search; otherwise "City, ST" or ZIP. Returns null when there's nothing usable. */
export function buildLocation(q: HomeHarvestQuery): { location: string; hasAddress: boolean } | null {
  if (q.address && q.address.trim()) {
    const parts = [q.address.trim(), [q.city, q.state].filter(Boolean).join(', '), q.zip].filter(Boolean);
    return { location: parts.join(', '), hasAddress: true };
  }
  if (q.city && q.state) return { location: `${q.city}, ${q.state}`, hasAddress: false };
  if (q.zip) return { location: String(q.zip), hasAddress: false };
  if (q.county && q.state) return { location: `${q.county}, ${q.state}`, hasAddress: false };
  return null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "2026-06-26 00:00:00" | "2026-06-26T..." -> "2026-06-26". '' when unparseable. */
function dateOnly(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function acresFromSqft(sqft: number | null): number | null {
  if (sqft === null || sqft <= 0) return null;
  return Math.round((sqft / SQFT_PER_ACRE) * 1000) / 1000;
}

/** Map one bridge row + classification into a HomeHarvestComp, or null when it
 *  lacks a usable price or a clickable source URL (dropped, never invented). */
function toComp(row: HomeHarvestRow, isActive: boolean): HomeHarvestComp | null {
  const sourceUrl = str(row.property_url);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
  const price = isActive ? num(row.list_price) : (num(row.sold_price) ?? num(row.last_sold_price));
  if (price === null || price <= 0) return null;
  const acres = acresFromSqft(num(row.lot_sqft));
  const yearBuilt = num(row.year_built);
  const buildingAreaSqft = num(row.sqft);
  const propertyTypeText = str(row.style);
  const descriptionText = str(row.text);
  const classification = classifyComp({
    sourceLabel: 'homeharvest',
    soldPrice: isActive ? null : price,
    acres,
    pricePerAcre: acres ? Math.round(price / acres) : null,
    yearBuilt,
    buildingAreaSqft,
    propertyTypeText,
    descriptionText,
  });
  return {
    price,
    saleDateIso: isActive ? dateOnly(row.list_date) : dateOnly(row.last_sold_date),
    acres,
    pricePerAcre: acres ? Math.round(price / acres) : null,
    sourceUrl,
    sourceLabel: 'homeharvest',
    addressDesc: str(row.formatted_address) ?? str(row.full_street_line) ?? undefined,
    daysOnMarket: num(row.days_on_mls),
    yearBuilt,
    buildingAreaSqft,
    propertyTypeText,
    descriptionText,
    compClass: classification.class,
    classReason: classification.reason,
  };
}

/**
 * Retrieve land/farm sold comps + active listings via HomeHarvest. Pure mapping +
 * classification around an injectable runner. Only raw-land rows are returned in
 * sold/active; non-land rows are counted (excludedNonLand) so nothing is hidden.
 * Honest statuses; never fabricated.
 */
export async function fetchHomeHarvestComps(query: HomeHarvestQuery, deps: HomeHarvestDeps = {}): Promise<HomeHarvestResult> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const base: HomeHarvestResult = { status: 'error', sold: [], active: [], excludedNonLand: 0, source: 'HomeHarvest (Realtor.com, open-source)', timestamp: now, note: '' };

  const loc = buildLocation(query);
  if (!loc) return { ...base, status: 'no_area', note: 'No address / city+state / ZIP to search HomeHarvest.' };

  const runner = deps.runner ?? makeDefaultHomeHarvestRunner(deps.env ?? process.env);
  const req: HomeHarvestRequest = {
    location: loc.location,
    listing_type: ['sold', 'for_sale'],
    property_type: ['land', 'farm'],
    // radius only applies to address locations; HomeHarvest ignores it otherwise.
    ...(loc.hasAddress ? { radius: deps.radiusMiles ?? 10 } : {}),
    past_days: deps.pastDays ?? 365,
    limit: deps.limit ?? 60,
  };

  let resp: HomeHarvestBridgeResponse;
  try {
    resp = await runner.run(req, { timeoutMs: 60_000 });
  } catch (e: unknown) {
    return { ...base, status: 'error', note: `HomeHarvest bridge error: ${(e as Error)?.message ?? String(e)}.` };
  }
  if (resp.status === 'error') {
    const msg = resp.error ?? 'unknown';
    const notAvail = /not importable|No module named|not found|ENOENT/i.test(msg);
    return { ...base, status: notAvail ? 'not_available' : 'error', note: notAvail ? `HomeHarvest not available: ${msg}` : `HomeHarvest error: ${msg}` };
  }

  const recencyMs = (deps.recencyMonths ?? 12) * 30.44 * 24 * 3600 * 1000;
  const nowMs = deps.nowMs ?? Date.now();
  const sold: HomeHarvestComp[] = [];
  const active: HomeHarvestComp[] = [];
  let excludedNonLand = 0;
  for (const row of resp.rows ?? []) {
    const isActive = row.listing_type === 'for_sale';
    const comp = toComp(row, isActive);
    if (!comp) continue;
    if (!RAW_LAND.has(comp.compClass)) { excludedNonLand++; continue; }
    if (isActive) {
      active.push(comp);
    } else {
      // Defensive recency guard (bridge already applies past_days for sold).
      if (comp.saleDateIso) {
        const t = Date.parse(comp.saleDateIso);
        if (Number.isFinite(t) && nowMs - t > recencyMs) continue;
      }
      sold.push(comp);
    }
  }

  const status: HomeHarvestResult['status'] = sold.length > 0 || active.length > 0 ? 'collected' : 'no_comps';
  const note = status === 'collected'
    ? `HomeHarvest: ${sold.length} raw-land sold comp(s), ${active.length} land active listing(s)${excludedNonLand ? `, ${excludedNonLand} non-land row(s) excluded` : ''}.`
    : `HomeHarvest ran but returned no raw-land rows for ${loc.location}${excludedNonLand ? ` (${excludedNonLand} non-land row(s) excluded)` : ''}.`;
  return { ...base, status, sold, active, excludedNonLand, note };
}

/**
 * Default runner: spawn the Python bridge, write the request JSON to stdin, parse
 * the JSON response from stdout. Only used in the live path; tests inject a
 * runner instead. Honors a timeout (kills the child) and never throws raw spawn
 * errors past a structured error response.
 */
export function makeDefaultHomeHarvestRunner(env: Record<string, string | undefined>): HomeHarvestRunner {
  const python = (env.LANDOS_PYTHON ?? 'python').trim();
  const script = (env.LANDOS_HOMEHARVEST_BRIDGE ?? 'scripts/homeharvest_bridge.py').trim();
  return {
    run(req, opts): Promise<HomeHarvestBridgeResponse> {
      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const child = spawn(python, [script], { env: { ...process.env }, windowsHide: true });
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          resolve({ status: 'error', rows: [], count: 0, error: `HomeHarvest bridge timed out after ${opts.timeoutMs}ms` });
        }, opts.timeoutMs);
        opts.signal?.addEventListener('abort', () => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); resolve({ status: 'error', rows: [], count: 0, error: 'aborted' }); } });
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ status: 'error', rows: [], count: 0, error: `spawn ${python}: ${err.message}` }); });
        child.on('close', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            resolve(JSON.parse(stdout) as HomeHarvestBridgeResponse);
          } catch {
            resolve({ status: 'error', rows: [], count: 0, error: `unparseable bridge output${stderr ? `: ${stderr.slice(0, 300)}` : ` (${stdout.slice(0, 200)})`}` });
          }
        });
        child.stdin.write(JSON.stringify(req));
        child.stdin.end();
      });
    },
  };
}
