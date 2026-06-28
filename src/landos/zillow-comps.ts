// LandOS — Zillow supplemental comps/listings (validated live).
//
// VALIDATED CONTRACT (live, authorized on our Apify token): the configurable
// Zillow ZIP-search actor (default maxcopell/zillow-zip-search, 94k+ runs) takes
// { zipCodes:[...], forSaleByAgent, forSaleByOwner, forRent, sold }. Returns rows
// with statusType (FOR_SALE | SOLD/RECENTLY_SOLD), unformattedPrice, address*,
// latLong, beds/baths, detailUrl, daysOnZillow, and hdpData.homeInfo (lotAreaValue
// /Unit, dateSold, homeType, taxAssessedValue). SUPPLEMENTAL only — Realie stays
// primary for sold comps. Active listings are NEVER labeled sold. Zillow is
// home-centric (homeType surfaced); rows are clearly provider-attributed.
//
// Actor id is configurable via LANDOS_ZILLOW_ACTOR (never hard-coded at call site).

export const ZILLOW_ACTOR_ENV = 'LANDOS_ZILLOW_ACTOR';
export const DEFAULT_ZILLOW_ACTOR = 'maxcopell/zillow-zip-search';

export type ZillowFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ZillowComp {
  provider: 'zillow';
  status: 'active' | 'sold';
  sourceUrl: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  homeType: string | null;
  saleOrListDateIso: string | null;
  daysOnMarket: number | null;
  capturedAt: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ZillowCompsResult {
  // Honest provider states. `not_configured` = no Apify token. `not_authorized` =
  // token present but the actor itself is not authorized for our account (HTTP
  // 402/403) — distinct from "no token" so readiness isn't misleading.
  status: 'collected' | 'no_results' | 'not_configured' | 'not_authorized' | 'error';
  active: ZillowComp[];
  sold: ZillowComp[];
  source: string;
  timestamp: string;
  note: string;
}

const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(String(v).replace(/[^0-9.]/g, '')) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
function acresFrom(val: unknown, unit: unknown): number | null {
  const v = num(val); if (v == null) return null;
  const u = String(unit ?? '').toLowerCase();
  if (u.includes('acre')) return Math.round(v * 100) / 100;
  if (u.includes('sqft') || u.includes('sq')) return Math.round((v / 43560) * 100) / 100;
  return null; // unknown unit -> don't guess
}
function isoDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 0) { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; }
  const s = typeof v === 'string' ? v.trim() : ''; const m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface ZillowDeps { env?: Record<string, string | undefined>; fetchImpl?: ZillowFetch; now?: () => string; timeoutMs?: number; priceMax?: number }

/** Fetch Zillow active + sold listings for a ZIP via the configured actor.
 *  Honest statuses; active and sold kept separate; never fabricated. */
export async function fetchZillowComps(zip: string | null | undefined, deps: ZillowDeps = {}): Promise<ZillowCompsResult> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const base: ZillowCompsResult = { status: 'error', active: [], sold: [], source: 'Zillow', timestamp: now, note: '' };
  const z = (zip ?? '').trim().match(/\d{5}/)?.[0];
  if (!z) return { ...base, status: 'no_results', note: 'No ZIP for Zillow ZIP search.' };
  const token = (env.APIFY_TOKEN ?? '').trim();
  if (!token) return { ...base, status: 'not_configured', note: 'Apify token not configured.' };
  const actor = (env[ZILLOW_ACTOR_ENV] ?? DEFAULT_ZILLOW_ACTOR).trim().replace('/', '~');
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor((deps.timeoutMs ?? 90000) / 1000)}`;
  const input = { zipCodes: [z], forSaleByAgent: true, forSaleByOwner: true, forRent: false, sold: true, priceMax: deps.priceMax ?? 2000000 };
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as ZillowFetch);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    // Token present but the ACTOR is not authorized for our account (paid/rental
    // actor not subscribed). NOT a missing-token condition — label it honestly.
    if (res.status === 402 || res.status === 403) return { ...base, status: 'not_authorized', note: `Zillow actor not authorized (HTTP ${res.status}) — token OK; the Apify actor needs to be authorized/subscribed for this account.` };
    if (!res.ok) return { ...base, status: 'error', note: `Zillow actor HTTP ${res.status}.` };
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return { ...base, status: 'no_results', note: `Zillow returned no listings for ZIP ${z}.` };
    const active: ZillowComp[] = []; const sold: ZillowComp[] = [];
    for (const r of rows) {
      const hi = (r.hdpData as { homeInfo?: Record<string, unknown> } | undefined)?.homeInfo ?? {};
      const st = String(r.statusType ?? hi.homeStatus ?? '').toUpperCase();
      const isSold = /SOLD/.test(st);
      const price = num(r.unformattedPrice) ?? num(hi.price) ?? num(r.price);
      const acres = acresFrom(hi.lotAreaValue, hi.lotAreaUnit);
      const comp: ZillowComp = {
        provider: 'zillow', status: isSold ? 'sold' : 'active',
        sourceUrl: typeof r.detailUrl === 'string' ? r.detailUrl : null,
        price, acres, pricePerAcre: price && acres ? Math.round(price / acres) : null,
        city: (r.addressCity as string) ?? (hi.city as string) ?? null,
        state: (r.addressState as string) ?? (hi.state as string) ?? null,
        zip: (r.addressZipcode as string) ?? (hi.zipcode as string) ?? z,
        homeType: (hi.homeType as string) ?? null,
        saleOrListDateIso: isSold ? isoDate(hi.dateSold) : null,
        daysOnMarket: num(hi.daysOnZillow),
        capturedAt: now, confidence: 'medium',
      };
      if (price == null) continue; // skip rows with no usable price
      (isSold ? sold : active).push(comp);
    }
    if (active.length === 0 && sold.length === 0) return { ...base, status: 'no_results', note: `Zillow returned ${rows.length} rows but none had a usable price for ZIP ${z}.` };
    return { ...base, status: 'collected', active, sold, note: `Zillow ZIP ${z}: ${active.length} active, ${sold.length} sold (supplemental; home-centric).` };
  } catch (e: unknown) {
    return { ...base, status: 'error', note: `Zillow error: ${(e as Error)?.message ?? String(e)}.` };
  }
}
