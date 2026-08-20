// Realtor.com public land comparable discovery.
//
// This is a direct marketplace adapter, not the disabled HomeHarvest residential
// aggregator. It runs in a disposable context of the one LandOS-owned browser,
// records an honest status for every attempt, and returns only facts exposed by
// the opened Realtor.com page. Search routes discover candidates; a sold row is
// admitted only when the property card itself states a sold event and date.

import { readSessionConfig } from './browser-session.js';
import { automationBrowserConfig, openDisposableContextHandle } from './automation-browser.js';
import { addressStateCode, type CompRegistryCandidate } from './comp-registry.js';
import { isListingPhotoUrl } from './comp-visual.js';
import { laneSearchVerified, type CompLaneRouteOutcome } from './comp-lane-accountability.js';

declare const document: any;
declare const window: any;

export interface RealtorLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: 'sold' | 'active' | 'unknown';
  soldDate: string | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  url: string | null;
  source: 'Realtor.com';
  thumbnailUrl: string | null;
  photoUrls: string[];
  propertyClass: 'vacant_land' | 'improved' | 'unknown';
  description: string | null;
  homeType: string | null;
  yearBuilt: number | null;
  homeSizeSqft: number | null;
  beds: number | null;
  baths: number | null;
  utilities: string[];
  accessClues: string[];
  features: string[];
}

export interface RawRealtorListing {
  address: string | null;
  price: number | null;
  acres: number | null;
  lotSqft?: number | null;
  status?: string | null;
  soldDate?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  url: string | null;
  thumbnailUrl?: string | null;
  photoUrls?: string[];
  description?: string | null;
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
  beds?: number | null;
  baths?: number | null;
  utilities?: string[];
  accessClues?: string[];
  features?: string[];
}

export interface RealtorFetchInput {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  apn?: string;
  subjectAcres?: number | null;
  mode?: 'sold' | 'active';
}

export interface RealtorSearchRoute {
  kind: 'address' | 'parcel' | 'zip' | 'locality' | 'county';
  label: string;
  url: string;
}

export interface RealtorCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: RealtorLandComp[];
  note: string;
  routeTried: string;
  routesAttempted: string[];
  /** What every route actually did — reached, blocked, cards read, verified. */
  routes: CompLaneRouteOutcome[];
  /** True only when a readable, market-verified Realtor.com page was reached. */
  searchVerified: boolean;
}

/**
 * Prove an opened Realtor.com page really is this subject's market.
 *
 * The state code alone is not proof: Realtor.com answers an unmatched search
 * slug with a national or nearest-guess board, and a two-letter code appears in
 * chrome on almost any page. A ZIP, city or county token has to appear in the
 * URL, the page text, or the addresses the page itself published.
 */
export function verifyRealtorMarket(
  input: RealtorFetchInput,
  pageText: string,
  listings: RawRealtorListing[],
): { valid: boolean; reason: string } {
  const state = (input.state ?? '').trim().toUpperCase();
  const addresses = listings.map((row) => row.address ?? '').filter(Boolean);
  if (state && addresses.length && !addresses.some((address) => addressStateCode(address) === state)) {
    return { valid: false, reason: `the published addresses are not in ${state}` };
  }
  const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const haystack = norm(`${pageText} ${addresses.join(' ')}`);
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const city = norm(input.city ?? '');
  const county = norm((input.county ?? '').replace(/\s+county$/i, ''));
  if (zip && haystack.includes(zip)) return { valid: true, reason: `the page names the subject ZIP ${zip}` };
  if (city && haystack.includes(city)) return { valid: true, reason: `the page names the subject city ${input.city}` };
  if (county && haystack.includes(county)) return { valid: true, reason: `the page names ${input.county}` };
  if (!zip && !city && !county && state && new RegExp(`\\b${state}\\b`).test(pageText)) {
    return { valid: true, reason: `no ZIP, city or county was available for this subject, so the ${state} board is the most specific market that could be verified` };
  }
  return { valid: false, reason: 'the page names neither the subject ZIP, city, nor county' };
}

const slug = (value: string): string => value.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function realtorSearchRoutes(input: RealtorFetchInput): RealtorSearchRoute[] {
  const state = (input.state ?? '').trim().toUpperCase();
  if (!state) return [];
  const soldSuffix = input.mode === 'sold' ? '/show-recently-sold' : '';
  const landSuffix = `/type-land${soldSuffix}`;
  const routes: RealtorSearchRoute[] = [];
  const address = (input.address ?? '').replace(/,.*$/, '').trim();
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const county = (input.county ?? '').replace(/\s+county$/i, '').trim();
  if (address && input.city?.trim()) {
    const place = [address, input.city.trim(), state, zip].filter(Boolean).join(' ');
    routes.push({ kind: 'address', label: place, url: `https://www.realtor.com/realestateandhomes-search/${slug(place)}${soldSuffix}` });
  }
  if (input.apn?.trim()) {
    const place = [input.apn.trim(), county && `${county} County`, state].filter(Boolean).join(' ');
    routes.push({ kind: 'parcel', label: `parcel ${input.apn.trim()}`, url: `https://www.realtor.com/realestateandhomes-search/${slug(place)}${soldSuffix}` });
  }
  if (zip) routes.push({ kind: 'zip', label: `${zip}, ${state}`, url: `https://www.realtor.com/realestateandhomes-search/${zip}${landSuffix}` });
  if (input.city?.trim()) {
    const place = `${input.city.trim()}_${state}`;
    routes.push({ kind: 'locality', label: `${input.city.trim()}, ${state}`, url: `https://www.realtor.com/realestateandhomes-search/${slug(place)}${landSuffix}` });
  }
  if (county) {
    const place = `${county}-County_${state}`;
    routes.push({ kind: 'county', label: `${county} County, ${state}`, url: `https://www.realtor.com/realestateandhomes-search/${slug(place)}${landSuffix}` });
  }
  return routes.filter((route, index, all) => all.findIndex((candidate) => candidate.url === route.url) === index);
}

function normalizedStatus(value: string | null | undefined): 'sold' | 'active' | 'unknown' {
  const text = (value ?? '').trim();
  if (/\bsold\b|recently sold|closed/i.test(text)) return 'sold';
  if (/for sale|active|new listing|coming soon/i.test(text)) return 'active';
  return 'unknown';
}

function isoDate(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const stamp = Date.parse(text);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null;
}

const uniqueUrls = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value.trim())).map((value) => value.trim()))].slice(0, 40);

/** Normalize page cards without upgrading a sold-board search into transaction
 * evidence. Sold mode requires the card's own sold wording; the sold date is
 * retained when present but never erases the candidate. BUSINESS RULES: no
 * price minimum or maximum and no acreage band — discovery retains every real
 * candidate and classification analyzes price and acreage afterwards. */
export function normalizeRealtorListings(
  raw: RawRealtorListing[],
  _subjectAcres: number | null,
  mode: 'sold' | 'active' = 'active',
): RealtorLandComp[] {
  const seen = new Set<string>();
  const out: RealtorLandComp[] = [];
  for (const row of raw) {
    const address = row.address?.replace(/\s+/g, ' ').trim() ?? '';
    const price = typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 ? row.price : null;
    if (!address || price == null) continue;
    let acres = typeof row.acres === 'number' && Number.isFinite(row.acres) && row.acres > 0 ? row.acres : null;
    if (acres == null && typeof row.lotSqft === 'number' && row.lotSqft > 0) acres = Math.round((row.lotSqft / 43_560) * 100) / 100;
    const status = normalizedStatus(row.status);
    const soldDate = status === 'sold' ? isoDate(row.soldDate ?? row.status) : null;
    if (mode === 'sold' && status !== 'sold') continue;
    if (mode === 'active' && status !== 'active') continue;
    const key = address.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const improved = !!(row.homeType || row.homeSizeSqft || row.beds || row.baths || /\b(?:bed|bath|house|home|cabin|residence)\b/i.test(row.description ?? ''));
    // Card containers can include brokerage logos and map furniture. Only a
    // recognized listing-photo CDN may become comp imagery.
    const photos = uniqueUrls([row.thumbnailUrl, ...(row.photoUrls ?? [])]).filter((url) => isListingPhotoUrl(url));
    out.push({
      address,
      price,
      acres,
      pricePerAcre: acres ? Math.round(price / acres) : null,
      status,
      soldDate,
      listingDate: isoDate(row.listingDate),
      daysOnMarket: typeof row.daysOnMarket === 'number' && row.daysOnMarket >= 0 ? Math.floor(row.daysOnMarket) : null,
      url: row.url ?? null,
      source: 'Realtor.com',
      thumbnailUrl: photos[0] ?? null,
      photoUrls: photos,
      propertyClass: improved ? 'improved' : acres != null ? 'vacant_land' : 'unknown',
      description: row.description?.trim() || null,
      homeType: row.homeType?.trim() || null,
      yearBuilt: typeof row.yearBuilt === 'number' && row.yearBuilt > 1700 ? Math.floor(row.yearBuilt) : null,
      homeSizeSqft: typeof row.homeSizeSqft === 'number' && row.homeSizeSqft > 0 ? Math.round(row.homeSizeSqft) : null,
      beds: typeof row.beds === 'number' && row.beds > 0 ? row.beds : null,
      baths: typeof row.baths === 'number' && row.baths > 0 ? row.baths : null,
      utilities: [...new Set((row.utilities ?? []).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))],
      accessClues: [...new Set((row.accessClues ?? []).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))],
      features: [...new Set((row.features ?? []).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))],
    });
  }
  return out.slice(0, 40);
}

/** Bridge direct Realtor.com results into the provider-neutral registry/policy
 * contract. Unknown-status rows remain unknown context and can never be
 * upgraded into sold evidence merely because they came from a sold search URL. */
export function realtorCompsToCandidates(comps: RealtorLandComp[]): CompRegistryCandidate[] {
  return comps.map((comp, index) => ({
    id: comp.url ?? `realtor:${index}`,
    provider: 'Realtor.com',
    lane: comp.status === 'sold' ? 'sold' : comp.status === 'active' ? 'active' : 'unknown',
    addressDesc: comp.address,
    state: addressStateCode(comp.address),
    price: comp.price,
    priceKind: comp.status === 'sold' ? 'sold' : comp.status === 'active' ? 'list' : 'unknown',
    saleOrListDate: comp.status === 'sold' ? comp.soldDate : comp.listingDate,
    listingDate: comp.listingDate,
    daysOnMarket: comp.daysOnMarket,
    acres: comp.acres,
    pricePerAcre: comp.pricePerAcre,
    sourceUrl: comp.url,
    thumbnailUrl: comp.thumbnailUrl,
    photoUrls: comp.photoUrls,
    compClass: comp.propertyClass === 'vacant_land' ? 'vacant_land' : comp.propertyClass === 'improved' ? 'residential' : null,
    statusSource: comp.status === 'unknown' ? null : 'Realtor.com property card stated the transaction/listing status.',
    homeType: comp.homeType,
    yearBuilt: comp.yearBuilt,
    homeSizeSqft: comp.homeSizeSqft,
  }));
}

export interface RealtorPageLike {
  setViewport?(value: { width: number; height: number }): Promise<void>;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string): Promise<T>;
}
export interface RealtorBrowserLike { newPage(): Promise<RealtorPageLike>; close(): Promise<void> }
export interface RealtorFetchDeps {
  connect?: (browserUrl: string) => Promise<RealtorBrowserLike | null>;
  force?: boolean;
  timeoutMs?: number;
  settleMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function defaultConnect(_browserUrl: string): Promise<RealtorBrowserLike | null> {
  try { return await openDisposableContextHandle('realtor-comps') as unknown as RealtorBrowserLike; }
  catch { return null; }
}

const IS_BLOCKED = (): boolean => /captcha|verify you are|access denied|unusual traffic|pardon our interruption|robot/i
  .test(String((document as any).body?.innerText ?? '').slice(0, 5000));

// Broad page-card extraction. Each item remains raw until the normalizer proves
// its transaction status and acreage relationship.
const EXTRACT_REALTOR = (): RawRealtorListing[] => {
  const out: RawRealtorListing[] = [];
  const cards = Array.from((document as any).querySelectorAll('[data-testid*="property-card" i], [class*="property-card" i], li[class*="result" i]'));
  for (const card of cards as any[]) {
    const text = String(card.textContent ?? '').replace(/\s+/g, ' ').trim();
    const priceMatch = text.match(/\$\s*([\d,]+)/);
    const acreMatch = text.match(/([\d,.]+)\s*acres?\b/i);
    const sqftMatch = text.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft)\s*(?:lot)?/i);
    const addressNode = card.querySelector('[data-testid*="address" i], address, [class*="address" i]');
    const link = card.querySelector('a[href*="realestateandhomes-detail"], a[href]');
    const images = Array.from(card.querySelectorAll('img[src], img[data-src]')) as any[];
    const photoUrls = images.map((image) => String(image.currentSrc || image.src || image.getAttribute?.('data-src') || '')).filter(Boolean);
    const statusMatch = text.match(/(?:sold(?:\s+on)?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}|recently sold|for sale|active|coming soon)/i);
    const bedMatch = text.match(/\b([1-9]\d*)\s*(?:bed|bd)s?\b/i);
    const bathMatch = text.match(/\b([1-9]\d*(?:\.\d+)?)\s*(?:bath|ba)s?\b/i);
    const visible = (patterns: Array<[RegExp, string]>): string[] => patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
    out.push({
      address: String(addressNode?.textContent ?? '').trim() || null,
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null,
      acres: acreMatch ? Number(acreMatch[1].replace(/,/g, '')) : null,
      lotSqft: !acreMatch && sqftMatch ? Number(sqftMatch[1].replace(/,/g, '')) : null,
      status: statusMatch?.[0] ?? null,
      soldDate: statusMatch?.[0] ?? null,
      url: link?.href ?? null,
      thumbnailUrl: photoUrls[0] ?? null,
      photoUrls,
      description: text || null,
      homeType: bedMatch || bathMatch ? 'residential' : null,
      homeSizeSqft: null,
      beds: bedMatch ? Number(bedMatch[1]) : null,
      baths: bathMatch ? Number(bathMatch[1]) : null,
      utilities: visible([[/\bprivate well\b|\bwell water\b/i, 'Well'], [/\bseptic\b/i, 'Septic'], [/\b(?:electric|electricity)\b/i, 'Electricity']]),
      accessClues: visible([[/\bprivate road\b/i, 'Private road'], [/\bgravel (?:road|drive)\b/i, 'Gravel access'], [/\bpaved (?:road|drive)\b/i, 'Paved access'], [/\broad frontage\b/i, 'Road frontage']]),
      features: visible([[/\bwaterfront\b/i, 'Waterfront'], [/\bwooded\b/i, 'Wooded'], [/\bcleared\b/i, 'Cleared'], [/\bpond\b/i, 'Pond']]),
    });
  }
  return out;
};

const PAGE_GEOGRAPHY = (): string => `${String((window as any).location?.href ?? '')} ${String((document as any).title ?? '')} ${String((document as any).body?.innerText ?? '').slice(0, 5000)}`;

export async function fetchRealtorLandComps(input: RealtorFetchInput, deps: RealtorFetchDeps = {}): Promise<RealtorCompsResult> {
  const routes = realtorSearchRoutes(input);
  const first = routes[0]?.url ?? '';
  const outcomes: CompLaneRouteOutcome[] = [];
  const done = (result: Omit<RealtorCompsResult, 'routes' | 'searchVerified'>): RealtorCompsResult =>
    ({ ...result, routes: [...outcomes], searchVerified: laneSearchVerified(outcomes) });
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return done({ status: 'disabled', comps: [], note: 'Live browser mode off — Realtor.com not attempted.', routeTried: first, routesAttempted: [] }); }
    catch { /* continue to the owned browser */ }
  }
  if (!routes.length) return done({ status: 'disabled', comps: [], note: 'No subject state and searchable address, parcel, ZIP, city, or county for Realtor.com.', routeTried: first, routesAttempted: [] });
  const connect = deps.connect ?? defaultConnect;
  const attempted: string[] = [];
  let browser: RealtorBrowserLike | null = null;
  let last = first;
  try {
    browser = await connect(automationBrowserConfig().endpoint);
    if (!browser) return done({ status: 'error', comps: [], note: 'The LandOS automation browser is not available for Realtor.com.', routeTried: first, routesAttempted: attempted });
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best effort */ }
    for (const route of routes) {
      last = route.url;
      attempted.push(`${route.label}: ${route.url}`);
      await page.goto(route.url, { waitUntil: 'domcontentloaded', timeout: deps.timeoutMs ?? 30_000 });
      await sleep(deps.settleMs ?? 5_000);
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const raw = await page.evaluate<RawRealtorListing[]>(EXTRACT_REALTOR as unknown as () => RawRealtorListing[]);
      if (blocked && !raw.length) {
        outcomes.push({ label: route.label, url: route.url, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: `Realtor.com served a bot-verification or holding page instead of the ${route.label} results.` });
        return done({ status: 'blocked', comps: [], note: `Realtor.com blocked the ${route.label} route before property cards could be read.`, routeTried: route.url, routesAttempted: attempted });
      }
      const geography = await page.evaluate<string>(PAGE_GEOGRAPHY as unknown as () => string).catch(() => '');
      const state = (input.state ?? '').trim().toUpperCase();
      // A page has to be PROVEN to be this subject's market before anything on
      // it counts, and before its emptiness counts either. Realtor.com answers
      // an unmatched slug with a nearest-guess or national board, which the old
      // state-only check accepted as the subject's market.
      const market = verifyRealtorMarket(input, geography, raw);
      if (!market.valid) {
        outcomes.push({ label: route.label, url: route.url, reached: true, blocked, cardsFound: raw.length, marketVerified: false, qualifying: 0, outcome: `Opened ${route.url} and read ${raw.length} card(s), but ${market.reason}, so nothing from it was used.` });
        continue;
      }
      const comps = normalizeRealtorListings(raw, input.subjectAcres ?? null, input.mode ?? 'active')
        .filter((comp) => !state || addressStateCode(comp.address) === state);
      outcomes.push({
        label: route.label, url: route.url, reached: true, blocked, cardsFound: raw.length, marketVerified: true, qualifying: comps.length,
        outcome: comps.length
          ? `Opened ${route.url}, verified it as this subject's market because ${market.reason}, read ${raw.length} card(s) and kept ${comps.length} qualifying ${input.mode === 'sold' ? 'sold' : 'active'} land result(s).`
          : `Opened ${route.url} and verified it as this subject's market because ${market.reason}; it exposed ${raw.length} card(s) and none was a qualifying ${input.mode === 'sold' ? 'sold' : 'active'} land result.`,
      });
      if (comps.length) return done({ status: 'retrieved', comps, note: `Realtor.com returned ${comps.length} verified ${input.mode === 'sold' ? 'sold' : 'active'} land result(s) for ${route.label}.`, routeTried: route.url, routesAttempted: attempted });
    }
    const verified = laneSearchVerified(outcomes);
    return done({
      status: 'none', comps: [],
      note: verified
        ? `Realtor.com opened a page verified as this subject's market and it published no qualifying ${input.mode === 'sold' ? 'sold' : 'active'} land result across ${routes.length} route(s).`
        : `Realtor.com never reached a page verified as this subject's market: all ${routes.length} route(s) were blocked, empty, or landed on another geography, so no conclusion about the market's inventory is supported.`,
      routeTried: last, routesAttempted: attempted,
    });
  } catch (error) {
    return done({ status: 'error', comps: [], note: `Realtor.com capture error: ${(error as Error)?.message ?? 'unknown'}.`, routeTried: last, routesAttempted: attempted });
  } finally {
    try { await browser?.close(); } catch { /* dispose only this context */ }
  }
}
