// LandOS live comp provider — Apify tri_angle two-stage Redfin flow.
//
// Stage 1  tri_angle/redfin-search   (viewport/coordinate search) -> comp URLs
// Stage 2  tri_angle/redfin-detail   (per-URL enrichment)         -> nested rows
//
// extractComp() reads the REAL tri_angle/redfin-detail nested payload (validated
// against src/landos/providers/__fixtures__/tri-angle-redfin-detail.sample.json).
// Every field path here was derived from that file, not guessed.
//
// HARD RULES (state-agnostic — no disclosure/non-disclosure state lists anywhere):
//   - SOLD price comes from historicalData.saleHistory[0].salePrice, cross-checked
//     against avmInfo.lastSoldPrice. The current LIST price (priceInfo.amount) and
//     the AVM (predictedValue) are NEVER read as the sold price.
//   - Dates in this payload are epoch MILLISECONDS — converted on read.
//   - lotSize is SQUARE FEET — acreage = lotSize / 43560.
//   - DROP/TAG rule: a row missing sold price, sold date, OR a source URL is NOT
//     silently dropped and NOT guessed. It is KEPT and loudly tagged
//     "verify in underwriting" (surfaced as needsVerification).
//   - The manufactured propertyType int is NOT present in the validated fixture,
//     so it is deliberately UNKNOWN here and gated to fail loud downstream.
//   - Critical fields are deterministically extracted; Gemma is NOT in this path.

import type {
  CompProvider,
  CompProviderId,
  CompProviderResult,
  CompProviderStatus,
  CompQuery,
  NeedsVerificationComp,
  RetrievedComp,
} from '../comp-retrieval.js';
import {
  planCompSearch,
  crowFliesMiles,
  TARGET_COMP_COUNT,
  RADIUS_CEILING_MILES,
  THIN_DATA_TAG,
  type CompSearchPlan,
} from '../comp-search-params.js';

/** Injectable Apify boundary (one actor call). Kept tiny so tests mock it with
 *  no apify-client package and no network. */
export interface ApifyRunner {
  run(actorId: string, input: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown[]>;
}

const SOURCE_BASE_URL: Record<'redfin' | 'zillow', string> = {
  redfin: 'https://www.redfin.com',
  zillow: 'https://www.zillow.com',
};

const SQFT_PER_ACRE = 43_560;

/**
 * Redfin propertyType integer codes (validated against the fixture):
 *   8 = Land / Vacant      6 = single-family residential house      1 = (other residential)
 * The MANUFACTURED / mobile-home code is NOT present in the validated fixture,
 * so it is intentionally null. Manufactured logic must gate on this and FAIL
 * LOUD rather than mis-classify. See in-park-filter.ts.
 */
export const REDFIN_PROPERTY_TYPE = {
  LAND: 8,
  SINGLE_FAMILY: 6,
} as const;

// TODO: verify the manufactured/mobile-home propertyType int against a live
// manufactured detail row. Until verified it stays null and manufactured-type
// detection fails loud (never guesses a code).
export const REDFIN_MANUFACTURED_PROPERTY_TYPE: number | null = null;

/**
 * One comp extracted from a tri_angle/redfin-detail record. Carries the richer
 * underwriting fields (lat/long, CDOM, lotSize, propertyType, APN) plus loud
 * verifyTags. soldPriceUsd / soldDateIso are null when the payload genuinely
 * lacks them — kept + tagged, never invented.
 */
export interface DetailComp {
  sourceUrl: string;
  sourceLabel: CompProviderId;
  soldPriceUsd: number | null;
  soldDateIso: string | null;
  /** Current LIST price for context only — NEVER the sold price. */
  listPriceUsd: number | null;
  acres: number | null;
  lotSizeSqft: number | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  daysOnMarket: number | null;
  propertyTypeCode: number | null;
  addressDesc?: string;
  /** Description text (amenities/remarks) for the in-park normalizer. May be ''. */
  descriptionText: string;
  verifyTags: string[];
}

export type ExtractResult = { ok: true; comp: DetailComp } | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function get(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!isObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const digits = v.replace(/[^0-9.]/g, '');
    if (!digits || digits === '.') return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Epoch MILLISECONDS (this payload) or a parseable date string -> ISO. */
function coerceEpochMsOrDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // tri_angle/redfin-detail uses epoch ms; tolerate seconds defensively.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

function coerceUrl(v: unknown, base: string): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return base + s;
  return null;
}

function acresFromSqft(sqft: number | null): number | null {
  if (sqft === null || sqft <= 0) return null;
  return Math.round((sqft / SQFT_PER_ACRE) * 1000) / 1000;
}

/** Assemble a human address from the nested streetAddress + city/state/zip. */
function assembleAddress(record: Record<string, unknown>, asi: unknown): string | undefined {
  const full = get(record, 'mainHouseInfo', 'fullStreetAddress');
  if (typeof full === 'string' && full.trim()) return full.trim();
  const street = get(asi, 'streetAddress', 'assembledAddress');
  const city = get(asi, 'city');
  const state = get(asi, 'state');
  const zip = get(record, 'regionName');
  const parts = [street, city, state, zip].filter((p): p is string => typeof p === 'string' && !!p.trim());
  return parts.length ? parts.join(', ') : undefined;
}

/** Description text the in-park normalizer scans (amenities / remarks). Best-effort
 *  concatenation; never throws, returns '' when nothing usable. */
function descriptionTextOf(record: Record<string, unknown>): string {
  const bits: string[] = [];
  const remarks = get(record, 'mainHouseInfo', 'listingRemarks');
  if (typeof remarks === 'string') bits.push(remarks);
  const amenities = get(record, 'mainHouseInfo', 'selectedAmenities');
  if (Array.isArray(amenities)) {
    for (const a of amenities) {
      const t = isObject(a) ? a['displayText'] ?? a['name'] ?? a['header'] : a;
      if (typeof t === 'string') bits.push(t);
    }
  }
  return bits.join(' \n ').trim();
}

/**
 * Deterministically extract ONE comp from a tri_angle/redfin-detail record. Pure,
 * state-agnostic, zero fabrication. Reads ONLY the validated nested paths. A row
 * missing sold price/date/URL is KEPT and tagged "verify in underwriting" — never
 * dropped, never guessed. Returns ok:false only for a non-object / empty record.
 */
export function extractComp(record: unknown, sourceLabel: CompProviderId = 'redfin'): ExtractResult {
  if (!isObject(record)) return { ok: false, reason: 'row is not an object' };
  const base = SOURCE_BASE_URL[sourceLabel === 'zillow' ? 'zillow' : 'redfin'];
  const asi = record['addressSectionInfo'];

  const verifyTags: string[] = [];

  // ── Sold price: saleHistory[0].salePrice, cross-checked vs avmInfo.lastSoldPrice
  const saleHistory0 = get(record, 'historicalData', 'saleHistory', '0');
  const saleHistPrice = coerceNumber(get(saleHistory0, 'salePrice'));
  const lastSoldPrice = coerceNumber(get(record, 'avmInfo', 'lastSoldPrice'));
  let soldPriceUsd: number | null = saleHistPrice ?? lastSoldPrice;
  if (soldPriceUsd !== null && soldPriceUsd <= 0) soldPriceUsd = null;
  if (saleHistPrice !== null && lastSoldPrice !== null && saleHistPrice !== lastSoldPrice) {
    verifyTags.push(`sold price mismatch (saleHistory $${saleHistPrice.toLocaleString()} vs avm lastSold $${lastSoldPrice.toLocaleString()}) — verify in underwriting`);
  }

  // ── Sold date: saleHistory[0].saleDate (epoch ms), fallback avmInfo.lastSoldDate
  const soldDateIso =
    coerceEpochMsOrDate(get(saleHistory0, 'saleDate')) ??
    coerceEpochMsOrDate(get(record, 'avmInfo', 'lastSoldDate'));

  // ── List price (context only — NEVER the sold price) ───────────────────────
  const listPriceUsd = coerceNumber(get(asi, 'priceInfo', 'amount'));

  // ── Lot size (sq ft) + acreage ─────────────────────────────────────────────
  const lotSizeSqft = coerceNumber(get(asi, 'lotSize'));
  const acres = acresFromSqft(lotSizeSqft);

  // ── Identity + geo (coords are OUTPUT, never identity input) ────────────────
  const apnRaw = get(asi, 'apn');
  const apn = typeof apnRaw === 'string' && apnRaw.trim() ? apnRaw.trim() : null;
  const stateRaw = get(asi, 'state');
  const state = typeof stateRaw === 'string' && stateRaw.trim() ? stateRaw.trim() : null;
  const latitude = coerceNumber(get(asi, 'latLong', 'latitude'));
  const longitude = coerceNumber(get(asi, 'latLong', 'longitude'));
  const daysOnMarket = coerceNumber(get(asi, 'cumulativeDaysOnMarket'));
  const propertyTypeCode = coerceNumber(get(asi, 'propertyType'));

  // ── Source URL: addressSectionInfo.url (relative) or top-level scraperInput ─
  const sourceUrl =
    coerceUrl(get(asi, 'url'), base) ??
    coerceUrl(record['scraperInput'], base) ??
    coerceUrl(get(record, 'mainHouseInfo', 'url'), base) ??
    '';

  // ── State-agnostic drop/tag rule ───────────────────────────────────────────
  if (soldPriceUsd === null) verifyTags.push('sold price absent — verify in underwriting');
  if (soldDateIso === null) verifyTags.push('sold date absent — verify in underwriting');
  if (sourceUrl === '') verifyTags.push('source URL absent — verify in underwriting');

  return {
    ok: true,
    comp: {
      sourceUrl,
      sourceLabel,
      soldPriceUsd,
      soldDateIso,
      listPriceUsd,
      acres,
      lotSizeSqft,
      apn,
      county: null, // county is not reliably present in this payload — never guessed
      state,
      latitude,
      longitude,
      daysOnMarket,
      propertyTypeCode,
      addressDesc: assembleAddress(record, asi),
      descriptionText: descriptionTextOf(record),
      verifyTags,
    },
  };
}

/** A DetailComp is a fully-verifiable market comp only when sold price, sold
 *  date, AND a clickable source URL are all present. */
export function isFullComp(c: DetailComp): boolean {
  return c.soldPriceUsd !== null && c.soldDateIso !== null && c.sourceUrl !== '';
}

/** Map a full DetailComp to the existing RetrievedComp pipeline shape. */
export function toRetrievedComp(c: DetailComp, distanceMiles?: number | null): RetrievedComp {
  return {
    price: c.soldPriceUsd as number,
    saleDateIso: c.soldDateIso as string,
    acres: c.acres,
    pricePerAcre: null, // comp-retrieval.withPpa() derives this
    sourceUrl: c.sourceUrl,
    sourceLabel: c.sourceLabel,
    distanceMiles: distanceMiles ?? null,
    ...(c.addressDesc ? { addressDesc: c.addressDesc } : {}),
  };
}

/** Map an incomplete DetailComp to the kept-but-tagged needsVerification shape. */
export function toNeedsVerification(c: DetailComp, distanceMiles?: number | null): NeedsVerificationComp {
  return {
    sourceUrl: c.sourceUrl,
    sourceLabel: c.sourceLabel,
    soldPriceUsd: c.soldPriceUsd,
    soldDateIso: c.soldDateIso,
    listPriceUsd: c.listPriceUsd,
    acres: c.acres,
    lotSizeSqft: c.lotSizeSqft,
    apn: c.apn,
    county: c.county,
    state: c.state,
    latitude: c.latitude,
    longitude: c.longitude,
    daysOnMarket: c.daysOnMarket,
    propertyTypeCode: c.propertyTypeCode,
    ...(c.addressDesc ? { addressDesc: c.addressDesc } : {}),
    distanceMiles: distanceMiles ?? null,
    verifyTags: c.verifyTags,
  };
}

// ── Two-stage Redfin provider (Stage 1 search -> Stage 2 detail) ─────────────

/** Cost/audit hook fired once per real actor call. NO credentials ever pass
 *  through it — only the actual actor id, stage, and row count. */
export type ApifySpendHook = (ev: { actorId: string; stage: 'search' | 'detail'; rows: number }) => void;

export interface RedfinTwoStageDeps {
  searchActorId: string;
  detailActorId: string;
  runner: ApifyRunner;
  /** Plan the search (centroid tier + radius). Injected in tests. */
  planSearch?: (query: CompQuery) => CompSearchPlan;
  /** Build the Stage-1 search actor input from the plan. Injected/overridable. */
  buildSearchInput?: (plan: CompSearchPlan, query: CompQuery) => unknown;
  /** Build the Stage-2 detail actor input from the discovered URLs. */
  buildDetailInput?: (urls: string[]) => unknown;
  /** Fired per actor call for cost logging. Never receives credentials. */
  onSpend?: ApifySpendHook;
  /** Stop after this many full comps (density-adaptive ceiling). */
  maxComps?: number;
}

const DEFAULT_MAX_COMPS = 5;
/** Hard cap on detail enrichments per run (protects the time + spend budget). */
const DETAIL_FETCH_CAP = 25;

function defaultBuildSearchInput(plan: CompSearchPlan): unknown {
  // tri_angle/redfin-search takes a viewport URL. The plan produces it from the
  // trusted centroid + current radius. Shape is best-effort; verify live.
  return { startUrls: [{ url: plan.searchUrl }], viewport: plan.viewport, radiusMiles: plan.radiusMiles };
}

function defaultBuildDetailInput(urls: string[]): unknown {
  // tri_angle/redfin-detail enriches a list of listing URLs.
  return { startUrls: urls.map((u) => ({ url: u })) };
}

/** Pull candidate detail URLs out of Stage-1 search rows (each row carries a url). */
function searchRowsToUrls(rows: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    const u =
      coerceUrl(row['url'], SOURCE_BASE_URL.redfin) ??
      coerceUrl(row['detailUrl'], SOURCE_BASE_URL.redfin) ??
      coerceUrl(get(row, 'addressSectionInfo', 'url'), SOURCE_BASE_URL.redfin);
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/**
 * Build the live two-stage Redfin comp provider. retrieve():
 *   1. plan the search from a trusted centroid (no centroid -> graceful no_comps),
 *   2. run the SEARCH actor to discover comp URLs,
 *   3. run the DETAIL actor to enrich them,
 *   4. extractComp() each, splitting full comps from kept-but-tagged ones.
 * The runner is injected, so this is fully testable with NO network. Spend is
 * reported per actor call (actual actor id only). Nothing is ever fabricated.
 */
export function makeRedfinTwoStageProvider(deps: RedfinTwoStageDeps): CompProvider {
  const id: CompProviderId = 'redfin';
  const maxComps = deps.maxComps ?? DEFAULT_MAX_COMPS;
  const plan = deps.planSearch ?? ((q: CompQuery) => planCompSearch(q));
  const buildSearchInput = deps.buildSearchInput ?? defaultBuildSearchInput;
  const buildDetailInput = deps.buildDetailInput ?? defaultBuildDetailInput;

  return {
    id,
    label: 'Redfin',
    supportsAddress: true,
    supportsApnOnly: false,
    async retrieve(query: CompQuery, opts): Promise<CompProviderResult> {
      const searchPlan = plan(query);
      if (!searchPlan.centroid || searchPlan.steps.length === 0) {
        return {
          providerId: id,
          status: 'no_comps',
          comps: [],
          needsVerification: [],
          note: `Redfin two-stage: ${searchPlan.reason} — no trusted centroid to search from (none invented)`,
        };
      }

      const comps: RetrievedComp[] = [];
      const needsVerification: NeedsVerificationComp[] = [];
      const seenUrls = new Set<string>();
      let unparseable = 0;
      let totalDetailRows = 0;
      let lastRadius = searchPlan.steps[0].radiusMiles;
      let exhaustedShort = true;

      // ── Density-adaptive radius stepping: 2 -> 5 -> 10mi, stop at target ──
      for (const step of searchPlan.steps) {
        lastRadius = step.radiusMiles;

        // Stage 1: search -> URLs at this radius.
        let searchRows: unknown[];
        try {
          searchRows = await deps.runner.run(deps.searchActorId, buildSearchInput({ ...searchPlan, ...step }, query), {
            timeoutMs: opts.timeoutMs,
            signal: opts.signal,
          });
        } catch (err) {
          const status: CompProviderStatus = isTimeout(err) ? 'timeout' : 'error';
          return errorResult(id, status, `Stage-1 search actor ${deps.searchActorId} ${status} at ${step.radiusMiles}mi: ${msg(err)} — no comps (none invented)`);
        }
        if (!Array.isArray(searchRows)) return errorResult(id, 'error', `Stage-1 search returned a non-array dataset — no comps (none invented)`);
        deps.onSpend?.({ actorId: deps.searchActorId, stage: 'search', rows: searchRows.length });

        const urls = searchRowsToUrls(searchRows).filter((u) => !seenUrls.has(u)).slice(0, DETAIL_FETCH_CAP);
        if (urls.length === 0) continue; // step out to a wider radius
        for (const u of urls) seenUrls.add(u);

        // Stage 2: detail -> nested rows.
        let detailRows: unknown[];
        try {
          detailRows = await deps.runner.run(deps.detailActorId, buildDetailInput(urls), {
            timeoutMs: opts.timeoutMs,
            signal: opts.signal,
          });
        } catch (err) {
          const status: CompProviderStatus = isTimeout(err) ? 'timeout' : 'error';
          return errorResult(id, status, `Stage-2 detail actor ${deps.detailActorId} ${status}: ${msg(err)} — no comps (none invented)`);
        }
        if (!Array.isArray(detailRows)) return errorResult(id, 'error', `Stage-2 detail returned a non-array dataset — no comps (none invented)`);
        deps.onSpend?.({ actorId: deps.detailActorId, stage: 'detail', rows: detailRows.length });
        totalDetailRows += detailRows.length;

        for (const row of detailRows) {
          const ex = extractComp(row, id);
          if (!ex.ok) { unparseable++; continue; }
          const c = ex.comp;
          const dist =
            searchPlan.centroid && c.latitude !== null && c.longitude !== null
              ? crowFliesMiles(searchPlan.centroid, { lat: c.latitude, lng: c.longitude })
              : null;
          // Tier B comps inherit the area-level caveat (loud, never hidden).
          if (searchPlan.areaLevel) c.verifyTags.push(searchPlan.tierLabel);
          if (isFullComp(c)) {
            comps.push(toRetrievedComp(c, dist));
            // A full comp that still carries soft caveats is mirrored to the
            // needs-verification list so the flags are never lost.
            if (c.verifyTags.length > 0) needsVerification.push(toNeedsVerification(c, dist));
          } else {
            needsVerification.push(toNeedsVerification(c, dist));
          }
          if (comps.length >= maxComps) break;
        }

        if (comps.length >= maxComps) { exhaustedShort = false; break; }
      }

      // Never fetched a single detail row across all radii: graceful no_comps.
      if (totalDetailRows === 0) {
        return {
          providerId: id,
          status: 'no_comps',
          comps: [],
          needsVerification: [],
          note: `Redfin two-stage (${searchPlan.tierLabel}, to ${lastRadius}mi): Stage-1 search returned no comp URLs`,
        };
      }

      // Stepped to the 10mi ceiling and still short of target -> thin-data tag.
      const thin = exhaustedShort && comps.length < TARGET_COMP_COUNT && lastRadius >= RADIUS_CEILING_MILES;
      if (thin) {
        for (const nv of needsVerification) nv.verifyTags.push(THIN_DATA_TAG);
      }

      const status: CompProviderStatus = 'connected';
      const thinNote = thin ? `, ${THIN_DATA_TAG}` : '';
      const note =
        comps.length > 0
          ? `Redfin two-stage (${searchPlan.tierLabel}, to ${lastRadius}mi): ${comps.length} verifiable comp(s), ${needsVerification.length} tagged 'verify in underwriting'${unparseable ? `, ${unparseable} unparseable` : ''}${thinNote}`
          : `Redfin two-stage (${searchPlan.tierLabel}, to ${lastRadius}mi): 0 verifiable comps, ${needsVerification.length} tagged 'verify in underwriting'${unparseable ? `, ${unparseable} unparseable` : ''} (none invented)${thinNote}`;
      return { providerId: id, status, comps, needsVerification, note };
    },
  };
}

function isTimeout(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}
function msg(err: unknown): string {
  return (err as Error)?.message ?? 'unknown error';
}
function errorResult(id: CompProviderId, status: CompProviderStatus, note: string): CompProviderResult {
  return { providerId: id, status, comps: [], needsVerification: [], note };
}

/**
 * Default ApifyRunner: lazily constructs apify-client and runs one actor, then
 * reads its default dataset. Only ever built when the live preflight is ready and
 * a token is present — never imported on the test path.
 */
export function makeDefaultApifyRunner(token: string): ApifyRunner {
  return {
    async run(actorId, input, opts): Promise<unknown[]> {
      const { ApifyClient } = await import('apify-client');
      const client = new ApifyClient({ token });
      const run = await client.actor(actorId).call(input, { timeout: Math.ceil(opts.timeoutMs / 1000) });
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      return items as unknown[];
    },
  };
}
