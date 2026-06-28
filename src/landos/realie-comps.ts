// LandOS — Realie Premium Comparables (row-level sold/valuation comps).
//
// VERIFIED CONTRACT (live-confirmed, authorized on our key):
//   GET https://app.realie.ai/api/public/premium/comparables/
//   required: latitude, longitude ; optional: radius, timeFrame, maxResults,
//   sqftMin/Max, bedsMin/Max, bathsMin/Max, propertyType, priceMin/Max.
//   auth: Authorization: <raw key>. Response: { comparables: [ {parcelId,
//   addressFull, acres, transferPrice, assessorSalePrice, totalMarketValue,
//   purchaseSaleDate, transferDate, yearBuilt, useCode, latitude, longitude,...} ],
//   metadata: { count } }.
// PREMIUM endpoint -> each call is premium API usage. Coordinates are a SUPPORTING
// input (comp discovery), never subject identity. Never fabricated.

export type RealieFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const REALIE_COMPS_PATH = '/public/premium/comparables/';

export interface RealieComp {
  provider: 'realie';
  parcelId: string | null;
  address: string | null;
  acres: number | null;
  /** Sold price (transfer/assessor sale) when present; null for valuation-only rows. */
  soldPrice: number | null;
  soldDateIso: string | null;
  pricePerAcre: number | null;
  marketValue: number | null;
  yearBuilt: number | null;
  lat: number | null;
  lng: number | null;
}

export interface RealieCompsResult {
  status: 'collected' | 'no_comps' | 'not_authorized' | 'error';
  /** Comps with a real sold price + date. */
  sold: RealieComp[];
  /** Rows with only an assessor market value (no usable sale) — valuation context. */
  valuation: RealieComp[];
  count: number;
  source: string;
  timestamp: string;
  note: string;
}

const n = (v: unknown): number | null => { const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(x) && x !== 0 ? x : null; };
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
function isoFrom(yyyymmdd: unknown): string | null {
  const t = s(yyyymmdd); if (!t) return null;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})/) || t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface RealieCompsDeps { env?: Record<string, string | undefined>; fetchImpl?: RealieFetch; now?: () => string; radiusMiles?: number; maxResults?: number; baseUrl?: string; key?: string; subjectAcres?: number | null; recencyMonths?: number; nowMs?: number }

const NOMINAL_SALE_FLOOR = 1000; // below this = transfer/gift/correction, not a market sale

/** Keep only RELEVANT sold comps: a real market price, an acreage in the
 *  subject's band (when known), and within the recency window. Prevents tiny
 *  urban lots / nominal transfers from producing absurd price-per-acre bands. */
function relevantSold(comps: RealieComp[], opts: { subjectAcres?: number | null; recencyMonths: number; nowMs: number }): RealieComp[] {
  const lo = opts.subjectAcres ? opts.subjectAcres * 0.25 : null;
  const hi = opts.subjectAcres ? opts.subjectAcres * 4 : null;
  const cutoff = opts.nowMs - opts.recencyMonths * 30.44 * 24 * 3600 * 1000;
  return comps.filter((c) => {
    if (!c.soldPrice || c.soldPrice < NOMINAL_SALE_FLOOR) return false;
    if (!c.acres || c.acres <= 0) return false;
    if (lo != null && hi != null && (c.acres < lo || c.acres > hi)) return false;
    if (c.soldDateIso) { const t = Date.parse(c.soldDateIso); if (Number.isFinite(t) && t < cutoff) return false; }
    return true;
  });
}

/** Fetch Realie premium comparables by point. Honest statuses; never fabricated. */
export async function fetchRealieComps(lat: number | null | undefined, lng: number | null | undefined, deps: RealieCompsDeps = {}): Promise<RealieCompsResult> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const base: RealieCompsResult = { status: 'error', sold: [], valuation: [], count: 0, source: 'Realie premium comparables', timestamp: now, note: '' };
  if (typeof lat !== 'number' || typeof lng !== 'number') return { ...base, status: 'no_comps', note: 'No coordinates for comp discovery (Realie comps require lat/lng).' };
  const key = (deps.key ?? env.REALIE_API_KEY ?? '').trim();
  if (!key) return { ...base, status: 'error', note: 'Realie not configured (no REALIE_API_KEY).' };
  const baseUrl = (deps.baseUrl ?? env.REALIE_API_BASE ?? 'https://app.realie.ai/api').replace(/\/+$/, '');
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lng), radius: String(deps.radiusMiles ?? 5), maxResults: String(deps.maxResults ?? 25) });
  const url = `${baseUrl}${REALIE_COMPS_PATH}?${params.toString()}`;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as RealieFetch);
  try {
    const res = await fetchImpl(url, { headers: { authorization: key, accept: 'application/json' } });
    if (res.status === 401 || res.status === 402 || res.status === 403) return { ...base, status: 'not_authorized', note: `Realie comps not authorized for this key/tier (HTTP ${res.status}).` };
    if (!res.ok) return { ...base, status: 'error', note: `Realie comps HTTP ${res.status}.` };
    const body = (await res.json()) as { comparables?: Array<Record<string, unknown>>; metadata?: { count?: number } };
    const rows = body.comparables ?? [];
    const sold: RealieComp[] = []; const valuation: RealieComp[] = [];
    for (const r of rows) {
      const acres = n(r.acres) ?? n(r.lotSizeArea);
      const soldPrice = n(r.transferPrice) ?? n(r.assessorSalePrice) ?? n(r.pastPriceSale);
      const soldDateIso = isoFrom(r.purchaseSaleDate) ?? isoFrom(r.transferDate) ?? isoFrom(r.assessorSaleRecordingDate);
      const marketValue = n(r.totalMarketValue);
      const comp: RealieComp = {
        provider: 'realie', parcelId: s(r.parcelId), address: s(r.addressFull) ?? s(r.addressRaw),
        acres, soldPrice, soldDateIso,
        pricePerAcre: soldPrice && acres ? Math.round(soldPrice / acres) : null,
        marketValue, yearBuilt: n(r.yearBuilt), lat: n(r.latitude), lng: n(r.longitude),
      };
      if (soldPrice && soldDateIso) sold.push(comp); else if (marketValue) valuation.push(comp);
    }
    const count = body.metadata?.count ?? rows.length;
    // Filter sold comps to relevant acreage/recency/non-nominal so metrics are usable.
    const filtered = relevantSold(sold, { subjectAcres: deps.subjectAcres ?? null, recencyMonths: deps.recencyMonths ?? 60, nowMs: deps.nowMs ?? Date.now() });
    if (filtered.length === 0 && valuation.length === 0) return { ...base, status: 'no_comps', count, note: `Realie returned ${count} nearby parcels; ${sold.length} had sales but none matched the subject's acreage band / recency. Widen radius/timeframe.` };
    return { ...base, status: 'collected', sold: filtered, valuation, count, note: `Realie premium comparables: ${filtered.length} relevant sold (of ${sold.length} sales, ${count} nearby), ${valuation.length} valuation-only.` };
  } catch (e: unknown) {
    return { ...base, status: 'error', note: `Realie comps error: ${(e as Error)?.message ?? String(e)}.` };
  }
}
