// LandOS — Redfin PUBLIC land comps via a SEPARATE DISPOSABLE Chrome profile.
//
// Mirrors zillow-land-comps.ts. NEVER touches the operator's authenticated
// LandPortal session AND never reuses the Zillow disposable profile/port. It
// launches its own throwaway Chrome (own temp profile, own debug port), resolves
// the subject city via Redfin's PUBLIC location-autocomplete (Redfin land URLs
// require a numeric city id), opens the PUBLIC Lots/Land filter page without
// login, extracts visible LAND listings (residential homes filtered out),
// normalizes to the subject acreage band, and returns a clear source status.
// Best-effort: any failure/blocked/none is reported, never thrown.
//
// Launcher/connector are injectable (tests pass fakes → no browser). The URL
// builders + parsers + normalizer are PURE and unit-tested without a browser.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { readSessionConfig } from './browser-session.js';
import { automationBrowserConfig, openDisposableContextHandle } from './automation-browser.js';
import { parseListingStatus, type CompStatus } from './comp-extraction.js';
import { laneSearchVerified, type CompLaneRouteOutcome } from './comp-lane-accountability.js';
import { MAX_SOLD_SEARCH_WINDOW_MONTHS, type SoldSearchWindowMonths } from './comp-sale-recency.js';

// The EXTRACT/IS_BLOCKED functions execute INSIDE the disposable Chrome (not Node),
// so DOM globals are declared as `any` purely to satisfy the Node typechecker.
declare const document: any;
declare const window: any;

export interface RedfinLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: CompStatus;
  url: string | null;
  source: 'Redfin';
  soldDate?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  lat?: number | null;
  lng?: number | null;
  thumbnailUrl?: string | null;
  /** Set when the card shows a positive bed/bath count — an improved sale kept
   * as directional market evidence, never silently dropped. */
  homeType?: string | null;
  homeSizeSqft?: number | null;
}

export interface RedfinCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: RedfinLandComp[];
  note: string;
  routeTried: string;
  /** The Redfin filter state used (property-type=land, sold vs active). */
  filtersUsed: string;
  /**
   * What every route actually did. Without this, a lane whose four routes all
   * failed to resolve a Redfin place is indistinguishable from a lane that read
   * the right land-search page and found it empty — and the second claim was
   * being made on the first lane's evidence.
   */
  routes: CompLaneRouteOutcome[];
  /** True only when a readable, market-verified Redfin land page was reached. */
  searchVerified: boolean;
  /** visible = cards the page exposed; extracted = cards with a readable
   * price+address; normalized = rows that entered the candidate set. */
  retrievalCounts: { visible: number; extracted: number; normalized: number };
}

export interface RedfinFetchInput {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  lat?: number;
  lng?: number;
  subjectAcres?: number | null;
  /** Which listing set to pull. 'sold' adds Redfin's sold filter. Default active. */
  mode?: 'sold' | 'active';
  apn?: string;
  owner?: string;
  radiusMiles?: 5 | 10 | 15 | 20;
  /** Sold period to request: 12 on the first pass, 24 only on a deliberate
   *  insufficiency expansion. There is never a price bound. */
  dateWindowMonths?: SoldSearchWindowMonths;
  /** Minimum lot size for the search itself (operator-style "20+ acres"). When
   * set, houses are searched alongside land so improved large-acreage sales
   * are discovered; classification decides their role later. */
  lotMinAcres?: number | null;
}

export interface RawRedfinListing {
  address: string | null;
  price: number | null;
  acres: number | null;
  sqftLot: number | null;
  residential: boolean;
  url: string | null;
  status?: string | null;
  thumbnailUrl?: string | null;
}

// ── Pure helpers (unit-tested; no browser) ──────────────────────────────────

export const REDFIN_HOME = 'https://www.redfin.com/';

/** Extract the first `/city/{id}/{ST}/{Name}` path from any text (used on the
 *  on-page search-suggestion hrefs — the stingray autocomplete API is CloudFront
 *  403-blocked, but the UI search dropdown exposes the correct city URL). */
export function parseRedfinCityPath(responseText: string): string | null {
  return parseRedfinPlacePaths(responseText).find((path) => path.startsWith('/city/')) ?? null;
}

export function parseRedfinPlacePaths(responseText: string): string[] {
  if (!responseText) return [];
  return [...new Set(responseText.match(/\/(?:city|county)\/\d+\/[A-Z]{2}\/[A-Za-z0-9._-]+|\/zipcode\/\d{5}/g) ?? [])];
}

/** Redfin's supported minimum-lot-size steps in acres; the URL filter snaps
 *  DOWN to the largest supported step at or below the requested minimum so the
 *  search never hides a qualifying result behind an unsupported value. */
const REDFIN_LOT_MIN_STEPS_ACRES = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 40, 100];
export function redfinLotMinFilter(lotMinAcres: number | null | undefined): string | null {
  if (lotMinAcres == null || !Number.isFinite(lotMinAcres) || lotMinAcres <= 0) return null;
  const step = [...REDFIN_LOT_MIN_STEPS_ACRES].reverse().find((s) => s <= lotMinAcres);
  return step != null ? `min-lot-size=${step}-acre` : null;
}

/** Public Redfin Lots/Land filter URL for a resolved city path. When sold=true,
 *  adds Redfin's public "include=sold" filter to pull recent SOLD land results.
 *  A lot-size minimum reproduces the operator's "20+ acres" search and widens
 *  the property types to land+house so improved large-acreage sales are
 *  discovered too. There is never a maximum lot size and never a price filter. */
export function redfinLandFilterUrl(cityPath: string, opts: { sold?: boolean; dateWindowMonths?: SoldSearchWindowMonths; lotMinAcres?: number | null } = {}): string {
  const lotMin = redfinLotMinFilter(opts.lotMinAcres);
  const propertyType = lotMin ? 'property-type=land+house' : 'property-type=land';
  const parts = [propertyType];
  if (lotMin) parts.push(lotMin);
  // Pass 1 is the trailing year. `sold-2yr` is only ever produced when a caller
  // deliberately expanded after insufficient recent evidence; there is no
  // longer-than-2yr option and no price segment at all.
  if (opts.sold) parts.push(`include=sold-${opts.dateWindowMonths === MAX_SOLD_SEARCH_WINDOW_MONTHS ? '2yr' : '1yr'}`);
  return `https://www.redfin.com${cityPath}/filter/${parts.join(',')}`;
}

/** Normalize raw listings into deduped candidate rows. Never fabricates.
 *  BUSINESS RULES: no price minimum or maximum, no acreage band, and an
 *  improved (residential) card is RETAINED and tagged rather than dropped —
 *  discovery collects the market evidence; classification decides Core /
 *  Directional / Excluded afterwards. */
export function normalizeRedfinListings(
  raw: RawRedfinListing[],
  _subjectAcres: number | null,
  mode: 'sold' | 'active' = 'active',
): RedfinLandComp[] {
  const seen = new Set<string>();
  const out: RedfinLandComp[] = [];
  for (const r of raw) {
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    let acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (acres == null && typeof r.sqftLot === 'number' && r.sqftLot > 0) acres = Math.round((r.sqftLot / 43560) * 100) / 100;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = r.status ? parseListingStatus(r.status) : 'unknown';
    const status: CompStatus = parsed === 'unknown' && mode === 'active' ? 'active' : parsed;
    const explicitSoldDate = mode === 'sold' && r.status
      ? (() => {
          const match = r.status.match(/\bsold(?:\s+on)?\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i);
          if (!match) return null;
          const parsedDate = Date.parse(match[1]);
          return Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString().slice(0, 10) : null;
        })()
      : null;
    // A sold-filter URL is a search request, not transaction evidence. Redfin
    // sometimes returns a current home, active or unlabeled card on that page,
    // so a sold candidate must at least STATE it is sold; the explicit sold
    // date is retained when present but its absence no longer erases the
    // candidate (that requirement manufactured false zero-result conclusions).
    if (mode === 'sold' && status !== 'sold') continue;
    if (mode === 'active' && status === 'sold') continue;
    out.push({
      address: r.address.replace(/\s+/g, ' ').trim(),
      price,
      acres,
      pricePerAcre: acres ? Math.round(price / acres) : null,
      status,
      url: r.url ?? null,
      source: 'Redfin',
      soldDate: explicitSoldDate,
      thumbnailUrl: r.thumbnailUrl ?? null,
      homeType: r.residential ? 'Residential (beds/baths listed)' : null,
    });
  }
  return out.slice(0, 40);
}

// ── Disposable-profile browser capture (injectable) ─────────────────────────

export interface RedfinFetchDeps {
  /**
   * Open a disposable, cookie-isolated session. The default is an incognito
   * context of the ONE owned automation browser.
   *
   * There is deliberately no `spawn`, `resolveChrome` or `port` dep any more:
   * this lane may not launch a browser. Every alternate Chrome launch path was
   * removed, not merely backgrounded.
   */
  connect?: (browserURL: string) => Promise<RedfinBrowserLike | null>;
  timeoutMs?: number;
  settleMs?: number;
  /** Wait for location autocomplete suggestions (default 2500ms; tests shorten). */
  suggestionSettleMs?: number;
  scrollSettleMs?: number;
  force?: boolean;
}

export interface RedfinPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
  keyboard?: { type(text: string, opts?: { delay?: number }): Promise<void>; press(key: string): Promise<void> };
}
export interface RedfinBrowserLike { newPage(): Promise<RedfinPageLike>; close(): Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A disposable incognito context inside the owned automation browser. Returns
 *  null (never a fallback browser) when LandOS cannot prove it owns one. */
async function defaultConnect(_browserURL: string): Promise<RedfinBrowserLike | null> {
  try {
    // The handle is a real puppeteer context+page behind a narrower structural
    // type; the cast is the type boundary, not a behavioural one.
    return await openDisposableContextHandle('redfin') as unknown as RedfinBrowserLike;
  } catch {
    return null;
  }
}

// Focus Redfin's on-page search box + set the query (React-safe) so the UI
// autocomplete dropdown renders (the stingray autocomplete API is 403-blocked).
const FOCUS_AND_SET_SEARCH = (query: string): boolean => {
  const inp: any = (document as any).querySelector('input[data-rf-test-name="search-box-input"], #search-box-input, input[name="searchInputBox"], input[type="search"], input[placeholder*="Address" i], input[placeholder*="City" i]');
  if (!inp) return false;
  inp.focus();
  const proto = Object.getPrototypeOf(inp);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(inp, query); else inp.value = query;
  inp.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
  inp.dispatchEvent(new (window as any).KeyboardEvent('keyup', { bubbles: true }));
  return true;
};

// Collect suggestion anchor hrefs from the search dropdown ONLY.
//
// This used to read `a[href*="/city/"]` across the whole document. Redfin's home
// page renders static "popular cities" widgets (RegionSearchMapLinksSection,
// EigencitiesWidget) full of /city/ links, so every query for a Grand Traverse
// County subject resolved to /city/5665/MI/Detroit — the first Michigan link on
// the page — and the lane then read 40 Detroit cards, rejected them all on
// geography, and reported "no results". Scoping to the search widget means only
// what the autocomplete actually offered for the typed query can be resolved.
const READ_SUGGESTION_HREFS = (): string => {
  const box = (document as any).querySelector('.bp-SearchBox, .SearchBoxForm, [class*="SearchBox" i], [role="listbox"]');
  if (!box) return '';
  return Array.from(box.querySelectorAll('a[href*="/city/"], a[href*="/county/"], a[href*="/zipcode/"], [class*="item-row" i] a, [role="option"] a'))
    .map((a: any) => a.href || a.getAttribute?.('href') || '')
    .join(' ');
};

// In-page (runs INSIDE disposable Chrome). Broad selectors + text parsing.
const EXTRACT_REDFIN = (): RawRedfinListing[] => {
  const out: RawRedfinListing[] = [];
  const seen = new Set<string>();
  const cards = Array.from((document as any).querySelectorAll('.HomeCardContainer,[class*="HomeCard" i],.bp-Homecard,[class*="MapHomeCard" i],[data-rf-test-id*="mapHomeCard" i],div[class*="homecard" i]'));
  for (const c of cards as any[]) {
    const txt = ((c.textContent as string) || '').replace(/\s+/g, ' ').trim();
    const priceEl: any = c.querySelector('[class*="Price" i]');
    const priceText = (priceEl && priceEl.textContent) || txt;
    const pm = String(priceText).match(/\$(\d{1,3}(?:,\d{3})+)/) || txt.match(/\$(\d{1,3}(?:,\d{3})+)/);
    const price = pm ? Number(pm[1].replace(/,/g, '')) : null;
    // Whole OR fractional acres ("acre lot"/"acres"/"ac"), then sqft lot.
    const am = txt.match(/(\d{1,3}(?:\.\d{1,3})?)\s*acres?\s*lot/i) || txt.match(/(\d{1,3}(?:\.\d{1,3})?)\s*acres?\b/i) || txt.match(/(\d{1,3}(?:\.\d{1,3})?)\s*ac\b/i);
    const acres = am ? parseFloat(am[1]) : null;
    const sm = txt.match(/([\d,]{4,})\s*sq\.?\s*ft\.?\s*lot/i);
    const sqftLot = sm ? Number(sm[1].replace(/,/g, '')) : null;
    const stM = txt.match(/\b(sold(?:\s+on\s+[\w .,/]+)?|pending|under contract|contingent|for sale|coming soon)\b/i);
    const statusText = stM ? stM[1] : null;
    // Address: prefer a dedicated address element, else a street-address regex.
    const addrEl: any = c.querySelector('[class*="Address" i],address');
    const addrText = (addrEl && (addrEl.textContent || '').replace(/\s+/g, ' ').trim()) || '';
    const addrM = addrText.match(/(\d+\s+[\w .]+,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/) || txt.match(/(\d+\s+[\w .]+?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
    const address = addrM ? addrM[1].replace(/\s+/g, ' ').trim() : null;
    // Residential ONLY when a POSITIVE bed/bath count is present (Redfin land cards
    // still render "— beds / — baths" placeholders, which must NOT flag as a home).
    const residential = /\b[1-9]\d*\s*(?:beds?|bd)\b/i.test(txt) || /\b[1-9]\d*\s*(?:baths?|ba)\b/i.test(txt);
    const link = ((c.querySelector('a[href*="/home/"],a[href]') || {}) as any).href || null;
    const image: any = c.querySelector('img[src],img[data-src]');
    const thumbnailUrl = (image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || '').trim() || null;
    if (price && address && !seen.has(address)) {
      seen.add(address);
      out.push({ price, acres, sqftLot, address, residential, url: link, status: statusText, thumbnailUrl });
    }
  }
  return out;
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access denied|blocked/i.test(`${(document as any).title ?? ''} ${((document as any).body?.innerText || '').slice(0, 4000)}`);
const READ_PAGE_GEOGRAPHY = (): { url: string; text: string } => ({
  url: String((window as any).location?.href ?? ''),
  text: `${(document as any).title ?? ''} ${((document as any).body?.innerText ?? '').slice(0, 5000)}`,
});

export interface RedfinSearchQuery { kind: 'coordinates' | 'road' | 'locality' | 'zip' | 'county' | 'parcel'; label: string; query: string }

export function redfinSearchQueries(input: RedfinFetchInput): RedfinSearchQuery[] {
  const state = (input.state ?? '').trim().toUpperCase();
  const queries: RedfinSearchQuery[] = [];
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    queries.push({ kind: 'coordinates', label: `${(input.lat as number).toFixed(5)}, ${(input.lng as number).toFixed(5)} within ${input.radiusMiles ?? 5} miles`, query: `${input.lat}, ${input.lng}` });
  }
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const road = (input.address ?? '').replace(/,.*$/, '').trim();
  if (road && input.city?.trim() && state) {
    const place = [road, input.city.trim(), state, zip].filter(Boolean).join(', ');
    queries.push({ kind: 'road', label: place, query: place });
  }
  const county = (input.county ?? '').replace(/\s+county$/i, '').trim();
  if (input.city?.trim() && state) {
    const place = [input.city.trim(), county ? `${county} County` : '', state].filter(Boolean).join(', ');
    queries.push({ kind: 'locality', label: place, query: place });
  }
  // County + state remains usable discovery geography when a fresh lead has
  // not yet been enriched with city, ZIP or coordinates.
  if (!input.city?.trim() && county && state) {
    const place = `${county} County, ${state}`;
    queries.push({ kind: 'locality', label: place, query: place });
  }
  // The bare ZIP and the bare county name are the two queries Redfin's
  // autocomplete reliably answers with a real market page (/zipcode/49690,
  // /county/1375/MI/Grand-Traverse-County). A township-level subject city like
  // Williamsburg, MI returns only out-of-state neighbourhoods, so without these
  // the lane had no route to its own market at all.
  if (zip) queries.push({ kind: 'zip', label: `ZIP ${zip}`, query: zip });
  if (county && state) queries.push({ kind: 'county', label: `${county} County, ${state}`, query: `${county} County, ${state}` });
  if (input.apn?.trim() && state) {
    const place = [input.apn.trim(), input.owner?.trim(), county ? `${county} County` : '', state].filter(Boolean).join(', ');
    queries.push({ kind: 'parcel', label: `parcel ${input.apn.trim()}`, query: place });
  }
  return queries.filter((query, index, all) => all.findIndex((candidate) => candidate.query.toLowerCase() === query.query.toLowerCase()) === index);
}

function normGeo(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/**
 * Pick the one suggested place path that IS this subject's market.
 *
 * The state is never sufficient on its own. Scoring `/(?:city|county)/\d+/MI/`
 * at +6 meant any Michigan link cleared the bar, and Redfin's own home page
 * always offers one — which is how every route for a Williamsburg subject
 * resolved to Detroit. A path now has to name the subject's ZIP, county, or
 * city, and still be in the subject's state, or it is not a route at all.
 */
function selectRedfinResolvedPath(paths: string[], input: RedfinFetchInput, _query: RedfinSearchQuery): string | null {
  const state = (input.state ?? '').trim().toUpperCase();
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const city = normGeo(input.city ?? '');
  const county = normGeo((input.county ?? '').replace(/\s+county$/i, ''));
  const scored = paths.map((path) => {
    const normalized = normGeo(path);
    // A path that declares a state must declare the subject's state.
    const declared = /\/(?:city|county)\/\d+\/([A-Za-z]{2})\//.exec(path)?.[1]?.toUpperCase() ?? null;
    if (state && declared && declared !== state) return { path, score: 0 };
    if (zip && path.includes(`/zipcode/${zip}`)) return { path, score: 10 };
    if (county && /\/county\/\d+\//.test(path) && normalized.includes(county)) return { path, score: 8 };
    if (city && /\/city\/\d+\//.test(path) && normalized.includes(city)) return { path, score: 6 };
    return { path, score: 0 };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].path : null;
}

export function verifyRedfinResolvedGeography(
  input: RedfinFetchInput,
  query: RedfinSearchQuery,
  path: string,
  page: { url?: string; text?: string } | null | undefined,
  listings: RawRedfinListing[],
): { valid: boolean; reason: string } {
  const state = (input.state ?? '').trim().toUpperCase();
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  if (state && /\/(?:city|county)\//.test(path) && !path.includes(`/${state}/`)) return { valid: false, reason: `resolved path is outside ${state}` };
  const addresses = listings.map((row) => row.address ?? '').filter(Boolean);
  if (addresses.length && state && !addresses.some((address) => new RegExp(`\\b${state}\\b`, 'i').test(address))) return { valid: false, reason: `listing addresses do not match ${state}` };
  const haystack = normGeo(`${path} ${page?.url ?? ''} ${page?.text ?? ''} ${addresses.join(' ')}`);
  const city = normGeo(input.city ?? '');
  const county = normGeo((input.county ?? '').replace(/\s+county$/i, ''));
  const specificMatch = (!!zip && haystack.includes(zip)) || (!!city && haystack.includes(city)) || (!!county && haystack.includes(county));
  if (specificMatch) return { valid: true, reason: 'resolved page matches subject geography' };
  return { valid: false, reason: 'resolved page does not match subject ZIP, city, county, or coordinate state' };
}

/**
 * Fetch Redfin public land comps for a locality via a disposable Chrome profile.
 * Route: PUBLIC on-page search box → resolved /city/ URL → PUBLIC Lots/Land filter
 * page → extract (residential homes filtered out). Gated on live-browser mode
 * (unless deps.force). Always resolves (never throws).
 */
export async function fetchRedfinLandComps(rawInput: RedfinFetchInput, deps: RedfinFetchDeps = {}): Promise<RedfinCompsResult> {
  // A large-acreage subject gets an operator-style search: lot-size minimum
  // derived from the subject (quarter of its acreage, never a maximum) with
  // houses included so improved large-acreage sales are discovered.
  const largeAcreage = rawInput.subjectAcres != null && rawInput.subjectAcres >= 20;
  const input: RedfinFetchInput = {
    ...rawInput,
    lotMinAcres: rawInput.lotMinAcres !== undefined
      ? rawInput.lotMinAcres
      : largeAcreage ? Math.max(10, Math.round((rawInput.subjectAcres as number) / 4)) : null,
  };
  const state = (input.state ?? '').trim();
  const queries = redfinSearchQueries(input);
  const sold = input.mode === 'sold';
  const lotMin = redfinLotMinFilter(input.lotMinAcres);
  const filtersUsed = `${lotMin ? 'property-type=land+house' : 'property-type=land'}${lotMin ? `, ${lotMin}` : ''}${sold ? ', include=sold' : ' (active)'}`;
  const routes: CompLaneRouteOutcome[] = [];
  const counts = { visible: 0, extracted: 0, normalized: 0 };
  const done = (result: Omit<RedfinCompsResult, 'routes' | 'searchVerified' | 'retrievalCounts'>): RedfinCompsResult =>
    ({ ...result, routes: [...routes], searchVerified: laneSearchVerified(routes), retrievalCounts: { ...counts } });
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return done({ status: 'disabled', comps: [], note: 'Live browser mode off — Redfin not attempted.', routeTried: '', filtersUsed }); } catch { /* fall through */ }
  }
  if (!state || queries.length === 0) return done({ status: 'disabled', comps: [], note: 'No coordinates, ZIP, city, or county with state for a Redfin land search.', routeTried: '', filtersUsed });

  // Redfin runs in a DISPOSABLE INCOGNITO CONTEXT of the ONE owned automation
  // browser. Its former throwaway-profile Chrome had no remembered window
  // position, so it opened centre-screen in the foreground over the operator's
  // work for the duration of the lane.
  const connect = deps.connect ?? defaultConnect;
  const timeoutMs = deps.timeoutMs ?? 30000;
  const settleMs = deps.settleMs ?? 5000;
  const suggestionSettleMs = deps.suggestionSettleMs ?? 2500;
  const scrollSettleMs = deps.scrollSettleMs ?? 800;
  let routeTried = REDFIN_HOME;

  let browser: RedfinBrowserLike | null = null;
  try {
    browser = await connect(automationBrowserConfig().endpoint);
    if (!browser) return done({ status: 'error', comps: [], note: 'The LandOS automation browser is not available for Redfin.', routeTried, filtersUsed });

    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }

    const failedGeographies: string[] = [];
    for (const query of queries) {
      await page.goto(REDFIN_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(Math.min(settleMs, 4000));
      const homeBlocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      if (homeBlocked) {
        routes.push({ label: query.label, url: REDFIN_HOME, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: 'Redfin served an anti-bot page on its own home page, before any location could be resolved.' });
        return done({ status: 'blocked', comps: [], note: 'Redfin served a Request blocked / anti-bot page before location resolution.', routeTried: REDFIN_HOME, filtersUsed });
      }
      const focused = await page.evaluate<boolean>(FOCUS_AND_SET_SEARCH as unknown as () => boolean, query.query);
      if (focused && page.keyboard) { try { await page.keyboard.press('Space'); await page.keyboard.press('Backspace'); } catch { /* nudge the debounced dropdown */ } }
      await sleep(suggestionSettleMs);
      const hrefs = await page.evaluate<string>(READ_SUGGESTION_HREFS as unknown as () => string);
      const resolvedPath = selectRedfinResolvedPath(parseRedfinPlacePaths(hrefs), input, query);
      if (!resolvedPath) {
        failedGeographies.push(`${query.label}: no matching Redfin place path`);
        routes.push({
          label: query.label, url: REDFIN_HOME, reached: !!focused, blocked: false, cardsFound: 0, marketVerified: false, qualifying: 0,
          outcome: focused
            ? `Redfin's search box accepted "${query.query}" but its suggestion list offered no city, county, or ZIP path for it, so no land-search page was ever opened.`
            : `Redfin's search box could not be found on the page, so "${query.query}" was never submitted and no land-search page was opened.`,
        });
        continue;
      }
      const landUrl = redfinLandFilterUrl(resolvedPath, { sold, dateWindowMonths: input.dateWindowMonths, lotMinAcres: input.lotMinAcres });
      routeTried = landUrl;
      await page.goto(landUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      for (let i = 0; i < 4; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const rawList = await page.evaluate<RawRedfinListing[]>(EXTRACT_REDFIN as unknown as () => RawRedfinListing[]);
      const cardsFound = rawList?.length ?? 0;
      if (blocked && cardsFound === 0) {
        routes.push({ label: query.label, url: landUrl, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: `Redfin served an anti-bot page instead of the ${filtersUsed} results for ${query.label}.` });
        return done({ status: 'blocked', comps: [], note: `Redfin served a Request blocked / anti-bot page on the ${query.label} land-search route.`, routeTried: landUrl, filtersUsed });
      }
      const pageGeo = (await page.evaluate<{ url: string; text: string }>(READ_PAGE_GEOGRAPHY as unknown as () => { url: string; text: string }).catch(() => null)) ?? { url: landUrl, text: '' };
      const verifiedGeo = verifyRedfinResolvedGeography(input, query, resolvedPath, pageGeo, rawList ?? []);
      if (!verifiedGeo.valid) {
        failedGeographies.push(`${query.label}: ${verifiedGeo.reason}`);
        routes.push({ label: query.label, url: landUrl, reached: true, blocked, cardsFound, marketVerified: false, qualifying: 0, outcome: `Opened ${landUrl} and read ${cardsFound} card(s), but ${verifiedGeo.reason}, so nothing from it was used.` });
        continue;
      }
      const extracted = (rawList ?? []).filter((row) => !!row.address && typeof row.price === 'number' && row.price > 0).length;
      const comps = normalizeRedfinListings(rawList ?? [], input.subjectAcres ?? null, sold ? 'sold' : 'active');
      counts.visible = Math.max(counts.visible, cardsFound);
      counts.extracted = Math.max(counts.extracted, extracted);
      routes.push({
        label: query.label, url: landUrl, reached: true, blocked, cardsFound, marketVerified: true, qualifying: comps.length,
        outcome: comps.length
          ? `Opened ${landUrl}, verified it as this subject's market: ${cardsFound} visible card(s) → ${extracted} extracted → ${comps.length} ${sold ? 'sold' : 'active'} candidate(s) retained (no price or acreage filter).`
          : `Opened ${landUrl} and verified it as this subject's market; it exposed ${cardsFound} card(s) and none survived extraction/status screening as a ${sold ? 'sold' : 'active'} candidate.`,
      });
      if (!comps.length) continue;
      counts.normalized = Math.max(counts.normalized, comps.length);
      return done({
        status: 'retrieved', comps,
        note: `Redfin verified ${query.label}: ${cardsFound} visible card(s) → ${extracted} extracted → ${comps.length} ${sold ? 'sold' : 'active'} candidate(s)${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''}.`,
        routeTried: landUrl, filtersUsed,
      });
    }
    const verified = laneSearchVerified(routes);
    return done({
      status: 'none', comps: [],
      note: verified
        ? `Redfin opened a verified land-search page for this subject's market across ${queries.length} route(s) and it published no ${sold ? 'sold' : 'active'} candidate (no price or acreage filter was applied).`
        : `Redfin never reached a verified land-search page for this subject: all ${queries.length} coordinate/ZIP/city/county route(s) failed to resolve or landed on the wrong geography, so no conclusion about the market's inventory is supported.`,
      routeTried, filtersUsed,
    });
  } catch (e) {
    return done({ status: 'error', comps: [], note: `Redfin capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried, filtersUsed });
  } finally {
    // Disposes the incognito context and every page it handed out — on success,
    // error, timeout and early return alike. Never closes the owned browser.
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}

// ── Bounded per-listing detail read (comp enrichment) ───────────────────────

export interface RedfinListingDetail {
  status: 'retrieved' | 'blocked' | 'error' | 'disabled';
  url: string;
  /** LISTING-REPORTED marketing remarks (never verified fact). */
  remarks: string | null;
  yearBuilt: number | null;
  buildingSqft: number | null;
  lotAcres: number | null;
  propertyType: string | null;
  /** Utility / service statements exactly as the page words them. */
  utilityStatements: string[];
  /** Property-history rows (date + event + price text) — prior sales when the
   *  page exposes them. Readily-visible history only; never a deep mission. */
  priorEvents: Array<{ date: string | null; event: string; price: number | null }>;
  note: string;
}

// Runs INSIDE the disposable context: pull the remarks block, key facts and
// the property-history table off a single Redfin listing page.
const EXTRACT_REDFIN_DETAIL = (): {
  remarks: string | null; bodyText: string;
  historyRows: string[];
} => {
  const remarksEl: any = (document as any).querySelector(
    '#marketing-remarks-scroll, [data-rf-test-id="listingRemarks"], .remarks, [class*="marketingRemarks" i], [class*="ListingRemarks" i]');
  const remarks = remarksEl ? String(remarksEl.textContent || '').replace(/\s+/g, ' ').trim() : null;
  const historyRows = Array.from((document as any).querySelectorAll(
    '[class*="PropertyHistory" i] tr, [class*="property-history" i] tr, [class*="HistoryRow" i], [id*="property-history" i] tr'))
    .map((row: any) => String(row.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((text: string) => /\b(19|20)\d{2}\b/.test(text) && /sold|listed|price|pending|contingent|delisted/i.test(text))
    .slice(0, 12);
  return { remarks, bodyText: String((document as any).body?.innerText || '').slice(0, 20000), historyRows };
};

/** Pure projection of the raw page read (unit-tested without a browser).
 *  Everything is read from the page ABOVE the "Nearby homes / Similar homes"
 *  widgets: those cards carry other properties' beds and square footage, and
 *  reading them made vacant land look improved (live 2026-08-20 failure: two
 *  different vacant Fairview pages both "showed" a widget home's 2,100 SqFt). */
export function parseRedfinListingDetail(url: string, raw: { remarks: string | null; bodyText: string; historyRows: string[] }): Omit<RedfinListingDetail, 'status' | 'note'> {
  const fullBody = raw.bodyText ?? '';
  const widgetStart = fullBody.search(/Nearby homes|Similar homes|Homes similar to|Nearby recently sold|Nearby similar/i);
  const body = widgetStart > 0 ? fullBody.slice(0, widgetStart) : fullBody;
  const numAfter = (re: RegExp): number | null => {
    const match = body.match(re);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  };
  const yearBuilt = numAfter(/Year Built[:\s]+((?:19|20)\d{2})/i) ?? numAfter(/Built in\s+((?:19|20)\d{2})/i);
  // A structure is only evidence when the listing itself shows a positive
  // bed/bath count; a bare Sq Ft figure on a land page is page noise.
  const hasBedsOrBaths = /\b[1-9]\d*(?:\.\d+)?\s*(?:beds?|baths?|bd\b|ba\b)/i.test(body);
  const buildingSqft = hasBedsOrBaths ? numAfter(/([\d,]{3,})\s*Sq\s*Ft(?!\s*lot)/i) : null;
  const lotAcres = (() => {
    const match = body.match(/Lot Size[:\s]+([\d,.]+)\s*(Acres?|Sq\.?\s*Ft\.?)/i)
      ?? body.match(/([\d.]+)\s*acres?\s*lot/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;
    return /sq/i.test(match[2] ?? 'acres') ? Math.round((value / 43560) * 100) / 100 : value;
  })();
  const propertyType = body.match(/Property Type[:\s]+([A-Za-z /()-]{3,40})/i)?.[1]?.trim() ?? null;
  const utilityStatements = [...new Set((body.match(
    /[^.\n]{0,80}\b(public sewer|septic|sewer available|city water|public water|well water|water available|utilities available|electric(?:ity)? available|natural gas|no utilities)\b[^.\n]{0,60}/gi,
  ) ?? []).map((text) => text.replace(/\s+/g, ' ').trim()).slice(0, 8))];
  const priorEvents = raw.historyRows.map((row) => {
    const date = row.match(/\b([A-Za-z]{3,9}\s+\d{1,2},?\s+(?:19|20)\d{2})\b/)?.[1] ?? row.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? null;
    const price = row.match(/\$(\d{1,3}(?:,\d{3})+)/)?.[1] ?? null;
    const event = row.match(/\b(sold|listed|pending|contingent|delisted|price changed?)\b/i)?.[1] ?? 'event';
    return { date, event: event.charAt(0).toUpperCase() + event.slice(1).toLowerCase(), price: price ? Number(price.replace(/,/g, '')) : null };
  }).filter((row) => row.date || row.price);
  return { url, remarks: raw.remarks, yearBuilt, buildingSqft, lotAcres, propertyType, utilityStatements, priorEvents };
}

/**
 * Read one Redfin listing page for comp enrichment via a disposable context.
 * Bounded and best-effort: blocked/error is reported, never thrown, and one
 * unreachable page never fails a comp search.
 */
export async function fetchRedfinListingDetail(url: string, deps: RedfinFetchDeps = {}): Promise<RedfinListingDetail> {
  const empty = { remarks: null, yearBuilt: null, buildingSqft: null, lotAcres: null, propertyType: null, utilityStatements: [], priorEvents: [] };
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return { status: 'disabled', url, ...empty, note: 'Live browser mode off — Redfin detail not attempted.' }; } catch { /* fall through */ }
  }
  const connect = deps.connect ?? defaultConnect;
  const timeoutMs = deps.timeoutMs ?? 30000;
  const settleMs = deps.settleMs ?? 4000;
  let browser: RedfinBrowserLike | null = null;
  try {
    browser = await connect(automationBrowserConfig().endpoint);
    if (!browser) return { status: 'error', url, ...empty, note: 'The LandOS automation browser is not available for the Redfin detail read.' };
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await sleep(settleMs);
    const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
    const raw = await page.evaluate<{ remarks: string | null; bodyText: string; historyRows: string[] }>(EXTRACT_REDFIN_DETAIL as unknown as () => { remarks: string | null; bodyText: string; historyRows: string[] });
    if (blocked && !raw.remarks && !raw.historyRows.length) {
      return { status: 'blocked', url, ...empty, note: 'Redfin served an anti-bot page on the listing detail read.' };
    }
    const parsed = parseRedfinListingDetail(url, raw);
    return { status: 'retrieved', ...parsed, note: `Redfin listing detail read: ${parsed.remarks ? 'remarks captured' : 'no remarks block'}, ${parsed.priorEvents.length} history row(s).` };
  } catch (e) {
    return { status: 'error', url, ...empty, note: `Redfin detail read error: ${(e as Error)?.message ?? 'unknown'}.` };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}
