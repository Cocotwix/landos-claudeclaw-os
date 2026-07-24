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
import { resolveChromePath, readSessionConfig } from './browser-session.js';
import { parseListingStatus, type CompStatus } from './comp-extraction.js';

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
}

export interface RedfinCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: RedfinLandComp[];
  note: string;
  routeTried: string;
  /** The Redfin filter state used (property-type=land, sold vs active). */
  filtersUsed: string;
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
  dateWindowMonths?: 12 | 24;
}

export interface RawRedfinListing { address: string | null; price: number | null; acres: number | null; sqftLot: number | null; residential: boolean; url: string | null; status?: string | null }

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

/** Public Redfin Lots/Land filter URL for a resolved city path. When sold=true,
 *  adds Redfin's public "include=sold" filter to pull recent SOLD land results. */
export function redfinLandFilterUrl(cityPath: string, opts: { sold?: boolean; dateWindowMonths?: 12 | 24 } = {}): string {
  const filter = opts.sold ? `property-type=land,include=sold-${opts.dateWindowMonths === 24 ? '2yr' : '1yr'}` : 'property-type=land';
  return `https://www.redfin.com${cityPath}/filter/${filter}`;
}

/** Normalize + filter raw listings to same-acreage-band, sane-priced LAND comps,
 *  dropping residential homes and deduping by address. Never fabricates. */
export function normalizeRedfinListings(raw: RawRedfinListing[], subjectAcres: number | null): RedfinLandComp[] {
  const band = subjectAcres != null && subjectAcres > 0
    ? { lo: Math.max(0.05, subjectAcres * 0.5), hi: subjectAcres * 2.5 }
    : { lo: 0.1, hi: 1.0 };
  const seen = new Set<string>();
  const out: RedfinLandComp[] = [];
  for (const r of raw) {
    if (r.residential) continue; // never compare vacant land against homes
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    if (price < 3000 || price > 150000) continue; // land-price sanity band
    let acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (acres == null && typeof r.sqftLot === 'number' && r.sqftLot > 0) acres = Math.round((r.sqftLot / 43560) * 100) / 100;
    if (acres != null && (acres < band.lo || acres > band.hi)) continue;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const status = r.status ? parseListingStatus(r.status) : 'unknown';
    out.push({ address: r.address.replace(/\s+/g, ' ').trim(), price, acres, pricePerAcre: acres ? Math.round(price / acres) : null, status, url: r.url ?? null, source: 'Redfin' });
  }
  return out.slice(0, 8);
}

// ── Disposable-profile browser capture (injectable) ─────────────────────────

export interface RedfinFetchDeps {
  resolveChrome?: () => { path: string | null; checked: string[] };
  spawn?: (cmd: string, args: string[]) => { kill?: () => void };
  connect?: (browserURL: string) => Promise<RedfinBrowserLike | null>;
  /** Debug port for the DISPOSABLE Redfin Chrome — MUST differ from LandPortal (9222) and Zillow (9334). */
  port?: number;
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

const defaultSpawn = (cmd: string, args: string[]) => {
  const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { kill: () => { try { child.kill(); } catch { /* ignore */ } } };
};

async function defaultConnect(browserURL: string): Promise<RedfinBrowserLike | null> {
  try {
    const mod = (await import('puppeteer-core')) as unknown as { connect?: (o: { browserURL: string }) => Promise<RedfinBrowserLike>; default?: { connect: (o: { browserURL: string }) => Promise<RedfinBrowserLike> } };
    const connect = mod.connect ?? mod.default?.connect;
    if (!connect) return null;
    return await connect({ browserURL });
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

// Collect suggestion anchor hrefs from the search dropdown (the correct city URL
// is exposed here even though the autocomplete API is blocked).
const READ_SUGGESTION_HREFS = (): string => Array.from((document as any).querySelectorAll('a[href*="/city/"], [class*="item-row" i] a, [role="option"] a, [class*="Autocomplete" i] a')).map((a: any) => a.href || '').join(' ');

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
    const link = ((c.querySelector('a[href*="/FL/"],a[href*="/home/"],a[href]') || {}) as any).href || null;
    if (price && address && !seen.has(address)) { seen.add(address); out.push({ price, acres, sqftLot, address, residential, url: link, status: statusText }); }
  }
  return out;
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access denied|blocked/i.test(((document as any).body?.innerText || '').slice(0, 4000));
const READ_PAGE_GEOGRAPHY = (): { url: string; text: string } => ({
  url: String((window as any).location?.href ?? ''),
  text: `${(document as any).title ?? ''} ${((document as any).body?.innerText ?? '').slice(0, 5000)}`,
});

export interface RedfinSearchQuery { kind: 'coordinates' | 'road' | 'locality' | 'parcel'; label: string; query: string }

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
  if (input.apn?.trim() && state) {
    const place = [input.apn.trim(), input.owner?.trim(), county ? `${county} County` : '', state].filter(Boolean).join(', ');
    queries.push({ kind: 'parcel', label: `parcel ${input.apn.trim()}`, query: place });
  }
  return queries.filter((query, index, all) => all.findIndex((candidate) => candidate.query.toLowerCase() === query.query.toLowerCase()) === index);
}

function normGeo(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function selectRedfinResolvedPath(paths: string[], input: RedfinFetchInput, query: RedfinSearchQuery): string | null {
  const state = (input.state ?? '').trim().toUpperCase();
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const place = normGeo(query.kind === 'locality' ? input.city ?? input.county ?? '' : query.kind === 'road' ? input.city ?? '' : '');
  const scored = paths.map((path) => {
    const normalized = normGeo(path);
    let score = 0;
    if (zip && path.includes(`/zipcode/${zip}`)) score += 10;
    if (state && new RegExp(`/(?:city|county)/\\d+/${state}/`, 'i').test(path)) score += 6;
    if (place && normalized.includes(place.replace(/\s+county$/, ''))) score += 4;
    if (query.kind === 'coordinates' && state && path.includes(`/${state}/`)) score += 2;
    return { path, score };
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
export async function fetchRedfinLandComps(input: RedfinFetchInput, deps: RedfinFetchDeps = {}): Promise<RedfinCompsResult> {
  const state = (input.state ?? '').trim();
  const queries = redfinSearchQueries(input);
  const sold = input.mode === 'sold';
  const filtersUsed = sold ? 'property-type=land, include=sold' : 'property-type=land (active)';
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return { status: 'disabled', comps: [], note: 'Live browser mode off — Redfin not attempted.', routeTried: '', filtersUsed }; } catch { /* fall through */ }
  }
  if (!state || queries.length === 0) return { status: 'disabled', comps: [], note: 'No coordinates, ZIP, city, or county with state for a Redfin land search.', routeTried: '', filtersUsed };

  const chrome = (deps.resolveChrome ?? (() => resolveChromePath()))();
  if (!chrome.path) return { status: 'disabled', comps: [], note: 'Google Chrome not found for a disposable Redfin session.', routeTried: '', filtersUsed };

  const spawnImpl = deps.spawn ?? defaultSpawn;
  const connect = deps.connect ?? defaultConnect;
  const port = deps.port ?? 9335; // separate from LandPortal (9222) and Zillow (9334)
  const timeoutMs = deps.timeoutMs ?? 30000;
  const settleMs = deps.settleMs ?? 5000;
  const suggestionSettleMs = deps.suggestionSettleMs ?? 2500;
  const scrollSettleMs = deps.scrollSettleMs ?? 800;
  const profileDir = path.join(os.tmpdir(), `landos-redfin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  let routeTried = REDFIN_HOME;

  let child: { kill?: () => void } | null = null;
  let browser: RedfinBrowserLike | null = null;
  try {
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* ignore */ }
    child = spawnImpl(chrome.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', 'about:blank']);
    for (let i = 0; i < 12 && !browser; i++) { browser = await connect(`http://127.0.0.1:${port}`); if (!browser) await sleep(600); }
    if (!browser) return { status: 'error', comps: [], note: 'Disposable Chrome for Redfin did not start.', routeTried, filtersUsed };

    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }

    const failedGeographies: string[] = [];
    for (const query of queries) {
      await page.goto(REDFIN_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(Math.min(settleMs, 4000));
      const homeBlocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      if (homeBlocked) return { status: 'blocked', comps: [], note: 'Redfin served a Request blocked / anti-bot page before location resolution.', routeTried: REDFIN_HOME, filtersUsed };
      const focused = await page.evaluate<boolean>(FOCUS_AND_SET_SEARCH as unknown as () => boolean, query.query);
      if (focused && page.keyboard) { try { await page.keyboard.press('Space'); await page.keyboard.press('Backspace'); } catch { /* nudge the debounced dropdown */ } }
      await sleep(suggestionSettleMs);
      const hrefs = await page.evaluate<string>(READ_SUGGESTION_HREFS as unknown as () => string);
      const resolvedPath = selectRedfinResolvedPath(parseRedfinPlacePaths(hrefs), input, query);
      if (!resolvedPath) { failedGeographies.push(`${query.label}: no matching Redfin place path`); continue; }
      const landUrl = redfinLandFilterUrl(resolvedPath, { sold, dateWindowMonths: input.dateWindowMonths });
      routeTried = landUrl;
      await page.goto(landUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      for (let i = 0; i < 4; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const rawList = await page.evaluate<RawRedfinListing[]>(EXTRACT_REDFIN as unknown as () => RawRedfinListing[]);
      if (blocked && (!rawList || rawList.length === 0)) return { status: 'blocked', comps: [], note: `Redfin served a Request blocked / anti-bot page on the ${query.label} land-search route.`, routeTried: landUrl, filtersUsed };
      const pageGeo = (await page.evaluate<{ url: string; text: string }>(READ_PAGE_GEOGRAPHY as unknown as () => { url: string; text: string }).catch(() => null)) ?? { url: landUrl, text: '' };
      const verifiedGeo = verifyRedfinResolvedGeography(input, query, resolvedPath, pageGeo, rawList ?? []);
      if (!verifiedGeo.valid) { failedGeographies.push(`${query.label}: ${verifiedGeo.reason}`); continue; }
      const comps = normalizeRedfinListings(rawList ?? [], input.subjectAcres ?? null)
        .map((cmp) => ({ ...cmp, status: cmp.status === 'unknown' ? ((sold ? 'sold' : 'active') as CompStatus) : cmp.status }));
      if (!comps.length) continue;
      return {
        status: 'retrieved', comps,
        note: `Redfin verified ${query.label} and returned ${comps.length} in-band ${sold ? 'sold' : 'active'} land comp(s)${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''}.`,
        routeTried: landUrl, filtersUsed,
      };
    }
    return { status: 'none', comps: [], note: `Redfin returned no verified in-band land comps across ${queries.length} coordinate/ZIP/city/county route(s)${failedGeographies.length ? `; ${failedGeographies.length} wrong or unresolved route(s) were automatically rejected` : ''}.`, routeTried, filtersUsed };
  } catch (e) {
    return { status: 'error', comps: [], note: `Redfin capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried, filtersUsed };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { child?.kill?.(); } catch { /* ignore */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
