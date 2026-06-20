// LandOS live comp provider — Apify per-source actors (Redfin / Zillow).
//
// Implements the CompProvider drop-in slot from comp-retrieval.ts using an
// Apify actor per source. The Apify client is INJECTED as an ApifyRunner so the
// whole module is testable against mock dataset rows with NO external call. The
// default runner lazily constructs apify-client and is only ever built when the
// live preflight is ready and a token is present (see register-live-providers).
//
// HARD RULES (mirror comp-retrieval.ts):
//   - FAIL LOUD: a row missing a verifiable price, sale date, or source URL is
//     DROPPED, never invented and never guessed.
//   - The critical fields (price, sale date, sourceUrl) are DETERMINISTICALLY
//     extracted from the actor's structured JSON here — Gemma is NOT in this
//     path. Gemma may only normalize soft fields in a later leg.
//   - Every kept comp carries a clickable http(s) source URL.
//   - Redfin/Zillow are address-centric: APN-only/rural parcels yield no_comps
//     gracefully (handled by the orchestrator), never an error or invention.

import type {
  CompProvider,
  CompProviderId,
  CompProviderResult,
  CompProviderStatus,
  CompQuery,
  RetrievedComp,
} from '../comp-retrieval.js';

/** Injectable Apify boundary. The orchestrator passes timeoutMs/signal through;
 *  the runner returns the raw dataset items (any shape). Kept tiny so tests mock
 *  it without the apify-client package. */
export interface ApifyRunner {
  run(actorId: string, input: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown[]>;
}

export interface ApifyCompProviderDeps {
  actorId: string;
  runner: ApifyRunner;
  /** Override the actor input builder if a specific actor needs a different
   *  shape. The default is a generic location search. */
  buildInput?: (query: CompQuery) => unknown;
  /** Cap on rows requested from the actor. Named, not magic. */
  maxItems?: number;
}

const SOURCE_BASE_URL: Record<'redfin' | 'zillow', string> = {
  redfin: 'https://www.redfin.com',
  zillow: 'https://www.zillow.com',
};

const SOURCE_LABEL: Record<'redfin' | 'zillow', string> = {
  redfin: 'Redfin',
  zillow: 'Zillow',
};

// Candidate field names — Apify Redfin/Zillow actors vary in their output keys,
// so we deterministically try the common ones in priority order. No fuzzy/LLM
// matching: a key is read literally or it is absent.
const PRICE_KEYS = ['soldPrice', 'lastSoldPrice', 'salePrice', 'price', 'priceValue', 'unformattedPrice'];
const DATE_KEYS = ['soldDate', 'lastSoldDate', 'dateSold', 'soldOn', 'lastSold', 'closeDate'];
const URL_KEYS = ['url', 'detailUrl', 'hdpUrl', 'propertyUrl', 'listingUrl'];
const ACRE_KEYS = ['acres', 'lotAcres', 'lotSizeAcres', 'lotAreaAcres'];
const SQFT_KEYS = ['lotSizeSqft', 'lotSquareFeet', 'lotSizeSquareFeet', 'lotAreaSqft'];
const ADDRESS_KEYS = ['address', 'streetAddress', 'formattedAddress', 'addressRaw', 'fullAddress'];

const SQFT_PER_ACRE = 43_560;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pick(item: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null) return item[k];
  }
  return undefined;
}

/** Deterministic numeric parse: accepts a finite number or a digit-bearing
 *  string like "$50,000" / "1,234.56". Returns null on anything non-numeric. */
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

/** Deterministic date parse to ISO. Accepts epoch ms/seconds or a parseable
 *  date string. Returns null when unparseable — the row is then dropped. */
function coerceIsoDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/** Deterministic URL resolution. Absolute http(s) kept as-is; a root-relative
 *  path is prefixed with the source's base domain; anything else is rejected so
 *  a comp can never be shown without a clickable source. */
function coerceUrl(v: unknown, base: string): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return base + s;
  return null;
}

function coerceAcres(item: Record<string, unknown>): number | null {
  const direct = coerceNumber(pick(item, ACRE_KEYS));
  if (direct !== null && direct > 0) return direct;
  const sqft = coerceNumber(pick(item, SQFT_KEYS));
  if (sqft !== null && sqft > 0) return Math.round((sqft / SQFT_PER_ACRE) * 1000) / 1000;
  return null;
}

type Extracted = { ok: true; comp: RetrievedComp } | { ok: false; reason: string };

/**
 * Deterministically extract ONE comp from a raw actor row. Drops (never guesses)
 * any row missing a verifiable price, sale date, or clickable source URL. Pure.
 */
export function extractComp(item: unknown, sourceLabel: 'redfin' | 'zillow'): Extracted {
  if (!isObject(item)) return { ok: false, reason: 'row is not an object' };
  const base = SOURCE_BASE_URL[sourceLabel];

  const price = coerceNumber(pick(item, PRICE_KEYS));
  if (price === null || price <= 0) return { ok: false, reason: 'missing/invalid price' };

  const saleDateIso = coerceIsoDate(pick(item, DATE_KEYS));
  if (saleDateIso === null) return { ok: false, reason: 'missing/invalid sale date' };

  const sourceUrl = coerceUrl(pick(item, URL_KEYS), base);
  if (sourceUrl === null) return { ok: false, reason: 'missing/invalid source URL' };

  const acres = coerceAcres(item);
  const addressRaw = pick(item, ADDRESS_KEYS);
  const addressDesc = typeof addressRaw === 'string' && addressRaw.trim() ? addressRaw.trim() : undefined;

  return {
    ok: true,
    comp: {
      price,
      saleDateIso,
      acres,
      pricePerAcre: null, // comp-retrieval.withPpa() derives this deterministically
      sourceUrl,
      sourceLabel,
      ...(addressDesc ? { addressDesc } : {}),
    },
  };
}

function defaultBuildInput(query: CompQuery, maxItems: number): unknown {
  const parts = [query.address, query.county, query.state].filter((p): p is string => !!p && !!p.trim());
  return { search: parts.join(', '), maxItems };
}

/**
 * Build a live Apify-backed CompProvider for a single source (Redfin or Zillow).
 * The runner is injected, so this is fully testable against mock rows. Errors and
 * timeouts surface honestly; nothing is fabricated.
 */
export function makeApifyCompProvider(
  id: Extract<CompProviderId, 'redfin' | 'zillow'>,
  deps: ApifyCompProviderDeps,
): CompProvider {
  const label = SOURCE_LABEL[id];
  const maxItems = deps.maxItems ?? 50;

  return {
    id,
    label,
    supportsAddress: true,
    supportsApnOnly: false,
    async retrieve(query: CompQuery, opts): Promise<CompProviderResult> {
      const input = (deps.buildInput ?? ((q: CompQuery) => defaultBuildInput(q, maxItems)))(query);

      let items: unknown[];
      try {
        items = await deps.runner.run(deps.actorId, input, { timeoutMs: opts.timeoutMs, signal: opts.signal });
      } catch (err) {
        const name = (err as Error)?.name;
        const status: CompProviderStatus = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'error';
        return {
          providerId: id,
          status,
          comps: [],
          note: status === 'timeout'
            ? `Apify ${label} actor aborted/timed out — no comps (none invented)`
            : `Apify ${label} actor failed: ${(err as Error)?.message ?? 'unknown error'} — no comps (none invented)`,
        };
      }

      if (!Array.isArray(items)) {
        return { providerId: id, status: 'error', comps: [], note: `Apify ${label} returned a non-array dataset — no comps (none invented)` };
      }
      if (items.length === 0) {
        return { providerId: id, status: 'no_comps', comps: [], note: `Apify ${label} returned no rows for this query` };
      }

      const comps: RetrievedComp[] = [];
      let dropped = 0;
      for (const row of items) {
        const ex = extractComp(row, id);
        if (ex.ok) comps.push(ex.comp);
        else dropped++;
      }

      if (comps.length === 0) {
        return {
          providerId: id,
          status: 'connected',
          comps: [],
          note: `Apify ${label}: ${dropped} row(s) dropped for missing verifiable price/sale date/source URL; none invented`,
        };
      }
      return {
        providerId: id,
        status: 'connected',
        comps,
        note: `Apify ${label}: ${comps.length} comp(s) kept, ${dropped} dropped (missing price/date/URL)`,
      };
    },
  };
}

/**
 * Default ApifyRunner: lazily constructs apify-client and runs the actor, then
 * reads its default dataset. Only ever built when the live preflight is ready and
 * a token is present — never imported on the test path.
 */
export function makeDefaultApifyRunner(token: string): ApifyRunner {
  return {
    async run(actorId, input, opts): Promise<unknown[]> {
      const { ApifyClient } = await import('apify-client');
      const client = new ApifyClient({ token });
      const run = await client.actor(actorId).call(input, {
        timeout: Math.ceil(opts.timeoutMs / 1000),
      });
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      return items as unknown[];
    },
  };
}
