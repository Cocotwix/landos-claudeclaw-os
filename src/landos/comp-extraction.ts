// LandOS — structured comp extraction primitives (PURE, browser-free).
//
// Shared, well-tested parsers that turn visible/readable listing data into
// structured comp rows for Zillow, Redfin, and LandPortal. These run in Node
// (never in the page), so the disposable-profile extractors read RAW text/JSON
// from the page and hand it here for reliable, testable structuring.
//
// Doctrine: never fabricate. A row is only emitted when a real price + a real
// address/acreage is present. Acreage/status parsing is generous about format but
// strict about evidence. No paid action, no credit, read-only source data only.

export type CompStatus = 'active' | 'sold' | 'pending' | 'unknown';
export type CompSource = 'Zillow' | 'Redfin' | 'LandPortal';

export interface ExtractedComp {
  address: string | null;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: CompStatus;
  date: string | null;
  url: string | null;
  source: CompSource;
}

const SQFT_PER_ACRE = 43560;

/**
 * Parse an acreage value from free listing text. Handles whole + fractional
 * acres, "ac"/"acre(s)"/"acre lot", and square-foot lots ("43,560 sqft lot" →
 * 1 acre). Requires an explicit unit near the number so a 5-digit ZIP or a price
 * is never mistaken for acreage. Returns null when no acreage is evident.
 */
export function parseAcreageText(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ');
  // Acres: "5", "5.12", "0.5" followed by acre(s)/ac (+ optional "lot").
  const ac = t.match(/(\d{1,3}(?:\.\d{1,3})?)\s*(?:ac\b|acres?\b)(?:\s*lot)?/i);
  if (ac) {
    const v = parseFloat(ac[1]);
    if (Number.isFinite(v) && v > 0 && v < 100000) return v;
  }
  // Square-foot lot: "9,583 sqft lot" / "9583 sq ft lot" → acres.
  const sq = t.match(/([\d,]{3,})\s*(?:sq\.?\s*ft\.?|sqft|square feet)\s*lot/i);
  if (sq) {
    const sqft = Number(sq[1].replace(/,/g, ''));
    if (Number.isFinite(sqft) && sqft > 0) return Math.round((sqft / SQFT_PER_ACRE) * 100) / 100;
  }
  return null;
}

/** Parse the first US dollar amount (>= $1,000) from text. Returns null if none. */
export function parsePriceText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(/\$\s?(\d{1,3}(?:,\d{3})+|\d{4,})/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Classify listing status from visible text/labels. Unknown when ambiguous. */
export function parseListingStatus(text: string | null | undefined): CompStatus {
  if (!text) return 'unknown';
  const t = String(text).toLowerCase();
  if (/\bsold\b|sold on|sale date|closed\b|recently sold/.test(t)) return 'sold';
  if (/pending|under contract|contingent|accepting backups/.test(t)) return 'pending';
  if (/for sale|active|new listing|coming soon|\bfor-sale\b/.test(t)) return 'active';
  return 'unknown';
}

/** Map a Zillow structured statusType/homeStatus to a CompStatus. */
export function zillowStatusType(raw: string | null | undefined): CompStatus {
  if (!raw) return 'unknown';
  const s = String(raw).toUpperCase();
  if (/SOLD/.test(s)) return 'sold';
  if (/PENDING|CONTINGENT|ACCEPTING/.test(s)) return 'pending';
  if (/FOR_SALE|ACTIVE|COMING_SOON|NEW/.test(s)) return 'active';
  return 'unknown';
}

function acreBand(subjectAcres: number | null | undefined): { lo: number; hi: number } {
  return subjectAcres != null && subjectAcres > 0
    ? { lo: Math.max(0.05, subjectAcres * 0.5), hi: subjectAcres * 2.5 }
    : { lo: 0.1, hi: 1.0 };
}

/** Sane-priced land band + dedupe + price-per-acre. Shared normalizer so every
 *  source produces identical, comparable rows. Never fabricates.
 *
 *  Scraped sources (Zillow/Redfin) default to a tight small-lot sanity band to
 *  drop garbage. Curated sources (LandPortal "similar sales") pass applyBand:false
 *  + a wide price range so real rural comps ($189k / 8ac) are NOT dropped. */
export function normalizeComps(
  rows: ExtractedComp[],
  subjectAcres: number | null,
  opts: { maxOut?: number; priceMin?: number; priceMax?: number; applyBand?: boolean } = {},
): ExtractedComp[] {
  const band = acreBand(subjectAcres);
  const priceMin = opts.priceMin ?? 3000;
  const priceMax = opts.priceMax ?? 150000;
  const applyBand = opts.applyBand ?? true;
  const seen = new Set<string>();
  const out: ExtractedComp[] = [];
  for (const r of rows) {
    if (!(typeof r.price === 'number') || !Number.isFinite(r.price) || r.price < priceMin || r.price > priceMax) continue;
    const acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (applyBand && acres != null && (acres < band.lo || acres > band.hi)) continue;
    const key = (r.address || `${r.source}:${r.price}:${acres ?? '?'}`).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      address: r.address ? r.address.replace(/\s+/g, ' ').trim() : null,
      price: r.price,
      acres,
      pricePerAcre: acres ? Math.round(r.price / acres) : null,
      status: r.status,
      date: r.date ?? null,
      url: r.url ?? null,
      source: r.source,
    });
  }
  return out.slice(0, opts.maxOut ?? 8);
}

// ── Zillow structured (__NEXT_DATA__ / search results JSON) ──────────────────

interface ZListResult {
  price?: number | string;
  unformattedPrice?: number;
  address?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZipcode?: string;
  detailUrl?: string;
  statusType?: string;
  homeStatus?: string;
  hdpData?: { homeInfo?: { lotAreaValue?: number; lotAreaUnit?: string; livingArea?: number; homeType?: string } };
}

/** Safely dig the Zillow search-results list out of parsed __NEXT_DATA__ (or a
 *  raw cat1/searchResults object). Tolerant of Zillow's shifting shapes. */
export function zillowListResults(parsed: unknown): ZListResult[] {
  const anyp = parsed as Record<string, any> | null;
  if (!anyp || typeof anyp !== 'object') return [];
  const candidates = [
    anyp?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults,
    anyp?.props?.pageProps?.searchPageState?.cat2?.searchResults?.listResults,
    anyp?.cat1?.searchResults?.listResults,
    anyp?.searchResults?.listResults,
    anyp?.listResults,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c as ZListResult[];
  return [];
}

/**
 * Parse Zillow's embedded structured search results (the raw __NEXT_DATA__ JSON
 * string, or an already-parsed object) into normalized land comps. This is far
 * more reliable than DOM scraping. Falls back cleanly to [] on any parse error.
 */
export function parseZillowStructured(rawJsonOrObj: string | unknown, subjectAcres: number | null): ExtractedComp[] {
  let parsed: unknown = rawJsonOrObj;
  if (typeof rawJsonOrObj === 'string') {
    try { parsed = JSON.parse(rawJsonOrObj); } catch { return []; }
  }
  const list = zillowListResults(parsed);
  const rows: ExtractedComp[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const price = typeof it.unformattedPrice === 'number'
      ? it.unformattedPrice
      : typeof it.price === 'number'
        ? it.price
        : parsePriceText(typeof it.price === 'string' ? it.price : '');
    if (price == null) continue;
    const address = it.address
      ?? ([it.addressStreet, it.addressCity, it.addressState, it.addressZipcode].filter(Boolean).join(', ') || null);
    const info = it.hdpData?.homeInfo;
    let acres: number | null = null;
    if (info && typeof info.lotAreaValue === 'number' && info.lotAreaValue > 0) {
      const unit = (info.lotAreaUnit || '').toLowerCase();
      acres = /acre/.test(unit) ? info.lotAreaValue : Math.round((info.lotAreaValue / SQFT_PER_ACRE) * 100) / 100;
    }
    const url = it.detailUrl ? (it.detailUrl.startsWith('http') ? it.detailUrl : `https://www.zillow.com${it.detailUrl}`) : null;
    rows.push({ address, price, acres, pricePerAcre: null, status: zillowStatusType(it.statusType ?? it.homeStatus), date: null, url, source: 'Zillow' });
  }
  return normalizeComps(rows, subjectAcres);
}

// ── LandPortal visible comp rows (free "similar sales" — never the paid report) ─

/**
 * Parse the visible LandPortal "similar sales" rows the authenticated session
 * already reads for free (e.g. "$45,000 Acres: 5.12 · 123 Rd"). These are recent
 * SOLD comps shown on the parcel page — NOT the paid Comp Report. Never triggers
 * a paid action; it only structures already-visible text.
 */
export function parseLandPortalCompRows(rows: Array<string> | null | undefined, subjectAcres: number | null): ExtractedComp[] {
  if (!Array.isArray(rows)) return [];
  const out: ExtractedComp[] = [];
  for (const raw of rows) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const price = parsePriceText(text);
    if (price == null) continue;
    // "Acres: 5.12" is LandPortal's row format; fall back to generic acreage text.
    const am = text.match(/acres?\s*:?\s*(\d{1,3}(?:\.\d{1,3})?)/i);
    const acres = am ? parseFloat(am[1]) : parseAcreageText(text);
    const addrM = text.match(/(\d+\s+[\w .]+?,\s*[A-Za-z .]+,\s*[A-Z]{2}(?:\s*\d{5})?)/);
    const dateM = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})\b/i);
    out.push({
      address: addrM ? addrM[1] : null,
      price,
      acres: acres != null && Number.isFinite(acres) && acres > 0 ? acres : null,
      pricePerAcre: null,
      status: 'sold',
      date: dateM ? dateM[1] : null,
      url: null,
      source: 'LandPortal',
    });
  }
  // LandPortal already curated these as "similar sales" — keep them (no tight
  // small-lot band, wide price range) instead of re-filtering real rural comps.
  return normalizeComps(out, subjectAcres, { applyBand: false, priceMin: 1000, priceMax: 5_000_000, maxOut: 12 });
}
