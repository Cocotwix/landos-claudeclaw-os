// LandOS — indexed-search discovery of INDIVIDUAL marketplace property records.
//
// One challenged transport is not a missing provider. When the managed local
// browser is served an anti-bot check by Zillow, or Realtor.com answers it with
// an HTTP 429 holding page, the provider's public records are still indexed on
// the open web. This seam runs the governed keyless search LandOS already has
// (`hermes-free-search.ts`) with the operator's plain-English questions, keeps
// only links to actual property records on the provider's own domain, and
// reads the facts the search index publishes about each record (price, sold
// date, beds/baths, living area, lot size, home type).
//
// It is a DISCOVERY transport, shared by the Zillow and Realtor.com lanes and
// never a second research system: the lane that calls it still owns
// classification, persistence, dedup and the decision about which records
// qualify. Search-result facts are retained with their own lineage
// (`indexed_search`) so a downstream reader can see they were not read off
// the provider page itself; when the provider page can be opened, the page
// facts supersede them. Nothing here solves, spoofs, conceals or retries a
// challenge, changes a fingerprint, or waits for a human.

import { createHermesFreeSearch, type IdentitySearchHit, type IdentitySearchProvider } from './hermes-free-search.js';

export type IndexedMarketplace = 'zillow' | 'realtor';

/** Property-record URL shapes per provider. Search boards, city pages and
 *  brokerage mirrors never pass; only the provider's own record for one
 *  property does. */
const RECORD_URL: Record<IndexedMarketplace, RegExp> = {
  zillow: /^https?:\/\/(?:www\.)?zillow\.com\/homedetails\/[^/?#]+\/\d+_zpid\/?/i,
  realtor: /^https?:\/\/(?:www\.)?realtor\.com\/realestateandhomes-detail\/[^/?#]+/i,
};

export function isMarketplaceRecordUrl(marketplace: IndexedMarketplace, url: string | null | undefined): boolean {
  return typeof url === 'string' && RECORD_URL[marketplace].test(url.trim());
}

/** Provider labels that mean a manufactured or mobile home on its own record. */
export const MANUFACTURED_LABEL = /\b(?:manufactured(?:\s+(?:home|housing))?|mobile(?:\s+home)?|mobile\s*\/\s*manufactured|double[\s-]?wide|single[\s-]?wide|triple[\s-]?wide)\b/i;

export interface IndexedRecordFacts {
  address: string | null;
  price: number | null;
  status: 'sold' | 'active' | 'unknown';
  soldDate: string | null;
  acres: number | null;
  beds: number | null;
  baths: number | null;
  homeSizeSqft: number | null;
  yearBuilt: number | null;
  homeType: 'manufactured' | 'land' | 'residential' | null;
}

export interface IndexedMarketplaceRecord extends IndexedRecordFacts {
  marketplace: IndexedMarketplace;
  url: string;
  title: string;
  snippet: string;
  /** The plain-English query that surfaced the record. */
  query: string;
  lineage: 'indexed_search';
  retrievedAt: string;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const stamp = Date.parse(value.replace(/(\d)(st|nd|rd|th)\b/g, '$1'));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null;
}

/** PURE. Read the facts a search index publishes about one record. Missing
 *  facts stay null; nothing is inferred from the query or the subject. */
export function parseIndexedRecordFacts(title: string, snippet: string): IndexedRecordFacts {
  const text = `${title} ${snippet}`.replace(/\s+/g, ' ');
  const addressMatch = title.match(/^\s*(\d{1,6}\s+[^|,]+?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5})/)
    ?? text.match(/(\d{1,6}\s+[NSEW]{0,2}\s*\d{0,5}(?:st|nd|rd|th)?\s*[A-Za-z0-9 .'-]{2,40}?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5})/);
  // "Sold on Aug 6, 2025", "sold for $290,000 on Aug 6, 2025", "Sold on
  // 04/15/2026", "August 6, 2025 - … sold": the index's own wording only.
  const soldDateMatch = text.match(new RegExp(`\\bsold\\b[^.]{0,60}?\\bon\\s+(${MONTH}\\.?\\s+\\d{1,2},?\\s+(?:19|20)\\d{2})`, 'i'))
    ?? text.match(new RegExp(`\\bsold\\s+(${MONTH}\\.?\\s+\\d{1,2},?\\s+(?:19|20)\\d{2})`, 'i'))
    ?? text.match(new RegExp(`\\b(${MONTH}\\.?\\s+\\d{1,2},?\\s+(?:19|20)\\d{2})\\s*[-–—:]\\s*.{0,80}?\\bsold\\b`, 'i'))
    ?? text.match(/\bsold\b[^.]{0,60}?\bon\s+(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))/i)
    ?? text.match(/\bsold\s+(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))/i);
  const priceMatch = text.match(/\bsold\b[^$]{0,60}\$\s?([\d,]{5,})/i) ?? text.match(/\$\s?([\d,]{5,})(?:\s*\.|\s|$)/);
  const acresMatch = text.match(/([\d.]+)\s*(?:-\s*)?acres?\b/i);
  const lotSqftMatch = !acresMatch ? text.match(/([\d,]{4,})\s*(?:sq\.?\s*ft\.?|sqft)\s*lot\b/i) : null;
  const sqftMatch = text.match(/([\d,]{3,})\s*(?:square\s+feet|sq\.?\s*ft\.?|sqft)(?!\s*lot)/i);
  const bedsMatch = text.match(/\b(\d{1,2})\s*(?:bed(?:room)?|bd|br)s?\b/i);
  const bathsMatch = text.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:bath(?:room)?|ba)s?\b/i);
  const yearMatch = text.match(/\bbuilt\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i);
  const sold = /\bsold\b|\bclosed\b|\brecently sold\b/i.test(text) && !/\bfor sale\b.*\bsold\b/i.test(text) || !!soldDateMatch;
  const active = !sold && /\bfor sale\b|\blisted\b|\bactive\b/i.test(text);
  const homeType: IndexedRecordFacts['homeType'] = MANUFACTURED_LABEL.test(text)
    ? 'manufactured'
    : /\b(?:lot\s*\/?\s*land|vacant land|land for sale|acres? of (?:land|vacant)|lot for sale)\b/i.test(text)
      ? 'land'
      : bedsMatch || bathsMatch ? 'residential' : null;
  const num = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const acres = num(acresMatch?.[1]) ?? (lotSqftMatch ? Math.round(((num(lotSqftMatch[1]) ?? 0) / 43_560) * 100) / 100 || null : null);
  return {
    address: addressMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? null,
    price: num(priceMatch?.[1]),
    status: sold ? 'sold' : active ? 'active' : 'unknown',
    soldDate: isoDate(soldDateMatch?.[1] ?? null),
    acres,
    beds: num(bedsMatch?.[1]),
    baths: num(bathsMatch?.[1]),
    homeSizeSqft: num(sqftMatch?.[1]),
    yearBuilt: num(yearMatch?.[1]),
    homeType,
  };
}

/** The operator's plain-English questions for one board of one provider. */
export function marketplaceDiscoveryQueries(input: {
  marketplace: IndexedMarketplace;
  board: 'sold' | 'active';
  propertyType: 'land' | 'manufactured';
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  /** Nearby street or subdivision names already known for the subject. */
  localities?: string[];
}): string[] {
  // Plain English, the way an operator types it. Never the `site:` operator:
  // the governed keyless search answered that pattern with unrelated pages.
  const site = input.marketplace === 'zillow' ? 'zillow' : 'realtor.com';
  const place = [input.city, input.state, input.zip].filter(Boolean).join(' ');
  if (!place.trim()) return [];
  const kind = input.propertyType === 'manufactured'
    ? ['mobile home sold', 'manufactured home sold', 'double wide sold']
    : input.board === 'sold'
      ? ['sold vacant land', 'lot land sold', 'acres sold']
      : ['vacant land for sale', 'lot land for sale'];
  const status = input.board === 'sold' ? 'sold' : 'for sale';
  const queries = new Set<string>();
  for (const word of kind) queries.add(`${site} ${place} ${input.propertyType === 'manufactured' && input.board !== 'sold' ? word.replace(/ sold$/, ` ${status}`) : word}`);
  // The subject street, the retained subdivision and nearby retained streets
  // each get the primary question ("zillow NW 137th Ln Lake Butler FL 32054
  // mobile home sold", "zillow River Oak Plantation Lake Butler FL 32054 …").
  for (const locality of (input.localities ?? []).slice(0, 5)) queries.add(`${site} ${locality} ${place} ${kind[0]}`);
  if (input.address) queries.add(`${site} ${input.address.replace(/,.*$/, '')} ${place}`);
  return [...queries].slice(0, 10);
}

export interface DiscoverMarketplaceRecordsOptions {
  search?: IdentitySearchProvider;
  maxResultsPerQuery?: number;
  timeoutMs?: number;
  nowIso?: string;
}

/**
 * Run the plain-English queries through the governed search and keep only the
 * provider's own property records, once each. Empty when the search transport
 * is unavailable: the caller records that outcome; it never throws.
 */
export async function discoverMarketplaceRecords(
  marketplace: IndexedMarketplace,
  queries: string[],
  options: DiscoverMarketplaceRecordsOptions = {},
): Promise<{ records: IndexedMarketplaceRecord[]; queriesRun: number; hitsSeen: number }> {
  const search = options.search ?? createHermesFreeSearch();
  const seen = new Set<string>();
  const records: IndexedMarketplaceRecord[] = [];
  let hitsSeen = 0;
  let queriesRun = 0;
  for (const query of queries) {
    let hits: IdentitySearchHit[] = [];
    try {
      hits = await search(query, { maxResults: options.maxResultsPerQuery ?? 10, timeoutMs: options.timeoutMs ?? 25_000 });
      queriesRun += 1;
    } catch {
      continue;
    }
    hitsSeen += hits.length;
    for (const hit of hits) {
      if (!isMarketplaceRecordUrl(marketplace, hit.url)) continue;
      const key = hit.url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        marketplace,
        url: hit.url.replace(/[?#].*$/, ''),
        title: hit.title,
        snippet: hit.snippet,
        query,
        lineage: 'indexed_search',
        retrievedAt: options.nowIso ?? new Date().toISOString(),
        ...parseIndexedRecordFacts(hit.title, hit.snippet),
      });
    }
  }
  return { records, queriesRun, hitsSeen };
}
