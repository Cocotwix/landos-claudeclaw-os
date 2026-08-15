// LandOS — Zillow PUBLIC land comps via a SEPARATE DISPOSABLE Chrome profile.
//
// This NEVER touches the operator's authenticated LandPortal browser session. It
// launches a throwaway Chrome (its own temp profile + its own debug port), opens
// PUBLIC Zillow "Lots/Land" pages without login, extracts visible land listings,
// normalizes them to the subject acreage band, and returns them with a clear
// source status. Best-effort: any failure/blocked/none is reported, never thrown,
// so a report run continues regardless.
//
// The launcher/connector are injectable (tests pass fakes → no browser launch).
// The URL builder + normalizer are PURE and unit-tested without a browser.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { readSessionConfig } from './browser-session.js';
import { automationBrowserConfig, openDisposableContextHandle } from './automation-browser.js';
import { parseZillowStructured, parseListingStatus, zillowListResults, type CompStatus } from './comp-extraction.js';
import { addressStateCode } from './comp-registry.js';
import { reconcileCompAddress } from './comp-location-reconciliation.js';

// The EXTRACT/IS_BLOCKED functions execute INSIDE the disposable Chrome (not Node),
// so DOM globals are declared as `any` purely to satisfy the Node typechecker.
declare const document: any;
declare const window: any;

export interface ZillowLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: CompStatus;
  url: string | null;
  source: 'Zillow';
  soldDate?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  lat?: number | null;
  lng?: number | null;
  thumbnailUrl?: string | null;
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
}

export interface ZillowCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: ZillowLandComp[];
  note: string;
  routeTried: string;
  /** Present for the dedicated manufactured-home lane, including zero-result
   * searches, so the UI can prove what was searched and why rows were excluded. */
  searchProof?: ManufacturedHomeSearchProof;
}

export interface ManufacturedHomeSearchProof {
  radiusMiles: number;
  timePeriodMonths: number;
  sourcesSearched: string[];
  routesAttempted: string[];
  candidatesReviewed: number;
  qualifyingResults: number;
  exclusionReasons: Array<{ reason: string; count: number }>;
}

export interface ZillowFetchInput {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  lat?: number;
  lng?: number;
  subjectAcres?: number | null;
  apn?: string;
  owner?: string;
  mode?: 'sold' | 'active';
  radiusMiles?: 5 | 10 | 15 | 20;
  dateWindowMonths?: 12 | 24;
  propertyType?: 'land' | 'manufactured';
}

export interface RawZillowListing {
  address: string | null;
  price: number | null;
  acres: number | null;
  url: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  soldDate?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
}
/** DOM read: card rows PLUS the raw __NEXT_DATA__ JSON for structured parsing. */
export interface RawZillowRead { listings: RawZillowListing[]; nextData: string | null }

// ── Pure helpers (unit-tested; no browser) ──────────────────────────────────

/** Public Zillow Lots/Land search URL for a locality (geographic, not ZIP). */
export function zillowLandUrl(city: string, state: string): string {
  const citySlug = city.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const st = state.trim().toLowerCase();
  return `https://www.zillow.com/${citySlug}-${st}/land/`;
}

export interface ZillowSearchRoute { kind: 'coordinates' | 'road' | 'locality' | 'parcel'; label: string; url: string }

/** Search the strongest subject geography first. Coordinates constrain Zillow's
 * map directly; ZIP, real city, and county are deterministic recovery routes. */
export function zillowSearchRoutes(input: ZillowFetchInput): ZillowSearchRoute[] {
  const state = (input.state ?? '').trim().toLowerCase();
  const sold = input.mode === 'sold';
  const radius = input.radiusMiles ?? 5;
  const routes: ZillowSearchRoute[] = [];
  const manufactured = input.propertyType === 'manufactured';
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    const lat = input.lat as number;
    const lng = input.lng as number;
    const latDelta = radius / 69;
    const lngDelta = radius / Math.max(35, 69 * Math.cos(lat * Math.PI / 180));
    const searchQueryState = encodeURIComponent(JSON.stringify({
      mapBounds: { north: lat + latDelta, south: lat - latDelta, east: lng + lngDelta, west: lng - lngDelta },
      filterState: {
        land: { value: !manufactured },
        house: { value: false },
        condo: { value: false },
        townhouse: { value: false },
        apartment: { value: false },
        manufactured: { value: manufactured },
        ...(sold ? { isRecentlySold: { value: true }, doz: { value: input.dateWindowMonths === 24 ? '24m' : '12m' } } : {}),
      },
      isListVisible: true,
    }));
    routes.push({ kind: 'coordinates', label: `${lat.toFixed(5)}, ${lng.toFixed(5)} within ${radius} miles`, url: `https://www.zillow.com/homes/${sold ? 'recently_sold' : manufactured ? 'for_sale/manufactured_type' : 'for_sale/land_type'}/?searchQueryState=${searchQueryState}` });
  }
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const road = (input.address ?? '').replace(/,.*$/, '').trim();
  if (road && input.city?.trim() && state) {
    const place = [road, input.city.trim(), state.toUpperCase(), zip].filter(Boolean).join(' ');
    routes.push({ kind: 'road', label: place, url: `https://www.zillow.com/homes/${encodeURIComponent(place)}_rb/` });
  }
  const county = (input.county ?? '').replace(/\s+county$/i, '').trim();
  if (input.city?.trim() && state) {
    const place = [input.city.trim(), county ? `${county} County` : '', state.toUpperCase()].filter(Boolean).join(', ');
    routes.push({ kind: 'locality', label: place, url: zillowLandUrl(input.city, state) });
  }
  // County + state is itself a practical public-market route. Fresh intake can
  // retain both while city/ZIP/coordinates are still being enriched; treating
  // that usable geography as "disabled" silently skipped the supplemental lane.
  if (!input.city?.trim() && county && state) {
    routes.push({
      kind: 'locality',
      label: `${county} County, ${state.toUpperCase()}`,
      url: zillowLandUrl(`${county} County`, state),
    });
  }
  if (input.apn?.trim() && state) {
    const place = [input.apn.trim(), input.owner?.trim(), county ? `${county} County` : '', state.toUpperCase()].filter(Boolean).join(' ');
    routes.push({ kind: 'parcel', label: `parcel ${input.apn.trim()}`, url: `https://www.zillow.com/homes/${encodeURIComponent(place)}_rb/` });
  }
  return routes.filter((route, index, all) => all.findIndex((candidate) => candidate.url === route.url) === index);
}

/** Normalize + filter raw listings to same-acreage-band, sane-priced land comps,
 *  deduped by address. Never fabricates; drops rows without a price+address. */
export function normalizeZillowListings(
  raw: RawZillowListing[],
  subjectAcres: number | null,
  mode: 'sold' | 'active' = 'active',
  propertyType: 'land' | 'manufactured' = 'land',
): ZillowLandComp[] {
  const band = subjectAcres != null && subjectAcres > 0
    ? { lo: Math.max(0.05, subjectAcres * 0.5), hi: subjectAcres * 2.5 }
    : { lo: 0.1, hi: 1.0 };
  const seen = new Set<string>();
  const out: ZillowLandComp[] = [];
  for (const r of raw) {
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    if (price < 1000 || price > 5_000_000) continue; // broad land-price sanity band
    const acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (propertyType === 'land' && acres != null && (acres < band.lo || acres > band.hi)) continue;
    if (propertyType === 'manufactured' && price <= 200_000) continue;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = r.status ? parseListingStatus(r.status) : 'unknown';
    // The active board itself establishes "for sale"; the sold board does not
    // establish that every returned card closed. Zillow can leak active cards
    // into a recently-sold result, so sold mode accepts only a stated sold row.
    const status: CompStatus = parsed === 'unknown' && mode === 'active' ? 'active' : parsed;
    if (mode === 'sold' && status !== 'sold') continue;
    if (mode === 'active' && status === 'sold') continue;
    const rawAddress = r.address.replace(/\s+/g, ' ').trim();
    const address = reconcileCompAddress({ capturedAddress: rawAddress, sourceUrl: r.url ?? null })?.postalAddress ?? rawAddress;
    out.push({
      address,
      price,
      acres,
      pricePerAcre: acres ? Math.round(price / acres) : null,
      status,
      url: r.url ?? null,
      source: 'Zillow',
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      soldDate: r.soldDate ?? null,
      listingDate: r.listingDate ?? null,
      daysOnMarket: r.daysOnMarket ?? null,
      homeType: r.homeType ?? null,
      yearBuilt: r.yearBuilt ?? null,
      homeSizeSqft: r.homeSizeSqft ?? null,
    });
  }
  return out.slice(0, 8);
}

// ── Disposable-profile browser capture (injectable) ─────────────────────────

export interface ZillowFetchDeps {
  /**
   * Open a disposable, cookie-isolated session. The default is an incognito
   * context of the ONE owned automation browser.
   *
   * There is deliberately no `spawn`, `resolveChrome` or `port` dep any more:
   * this lane may not launch a browser. Every alternate Chrome launch path was
   * removed, not merely backgrounded.
   */
  connect?: (browserURL: string) => Promise<ZillowBrowserLike | null>;
  timeoutMs?: number;
  /** Settle after navigation before reading (default 6000ms; tests pass small). */
  settleMs?: number;
  /** Settle after each scroll (default 800ms; tests pass small). */
  scrollSettleMs?: number;
  /** Bypass the live-mode gate (tests). */
  force?: boolean;
  /** Deterministic clock for sale-window screening in tests. */
  nowMs?: number;
}

export interface ZillowPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
}
export interface ZillowBrowserLike { newPage(): Promise<ZillowPageLike>; close(): Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A disposable incognito context inside the owned automation browser. Returns
 *  null (never a fallback browser) when LandOS cannot prove it owns one. */
async function defaultConnect(_browserURL: string): Promise<ZillowBrowserLike | null> {
  try {
    // The handle is a real puppeteer context+page behind a narrower structural
    // type; the cast is the type boundary, not a behavioural one.
    return await openDisposableContextHandle('zillow') as unknown as ZillowBrowserLike;
  } catch {
    return null;
  }
}

// In-page (runs INSIDE disposable Chrome). Broad selectors + text parsing because
// Zillow's data-test attributes are obfuscated/variable.
const EXTRACT_ZILLOW = (): RawZillowRead => {
  const out: RawZillowListing[] = [];
  const seen = new Set<string>();
  const cards = Array.from((document as any).querySelectorAll('[class*="property-card" i],[class*="ListItem" i],[data-test="property-card"],[class*="HomeCard" i],article'));
  for (const c of cards as any[]) {
    const txt = ((c.textContent as string) || '').replace(/\s+/g, ' ').trim();
    const pm = txt.match(/\$(\d{1,3}(?:,\d{3})+)/);
    const price = pm ? Number(pm[1].replace(/,/g, '')) : null;
    // Whole OR fractional acres, then "X acre lot", then sqft lot.
    const am = txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*acres?\s*lot/i) || txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*acres?\b/i) || txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*ac\b/i);
    let acres = am ? parseFloat(am[1]) : null;
    if (acres == null) { const sm = txt.match(/([\d,]{3,})\s*sq\.?\s*ft\.?\s*lot/i); if (sm) { const sf = Number(sm[1].replace(/,/g, '')); if (sf > 0) acres = Math.round((sf / 43560) * 100) / 100; } }
    const addrM = txt.match(/(\d+\s+[\w .]+?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
    const address = addrM ? addrM[1].replace(/\s+/g, ' ').trim() : null;
    const link = ((c.querySelector('a[href*="/homedetails/"]') || {}) as any).href || null;
    const sm2 = txt.match(/\b(sold|pending|under contract|for sale|coming soon)\b/i);
    const status = sm2 ? sm2[1] : null;
    if (price && address && !seen.has(address)) { seen.add(address); out.push({ price, acres, address, url: link, status }); }
  }
  const nd = (document as any).querySelector('#__NEXT_DATA__');
  const nextData = nd && nd.textContent ? String(nd.textContent) : null;
  return { listings: out, nextData };
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption/i.test(((document as any).body?.innerText || '').slice(0, 4000));
const READ_PAGE_GEOGRAPHY = (): { url: string; text: string } => ({
  url: String((window as any).location?.href ?? ''),
  text: `${(document as any).title ?? ''} ${((document as any).body?.innerText ?? '').slice(0, 5000)}`,
});

function structuredManufacturedListings(rawJsonOrObj: string | unknown): RawZillowListing[] {
  let parsed: unknown = rawJsonOrObj;
  if (typeof rawJsonOrObj === 'string') {
    try { parsed = JSON.parse(rawJsonOrObj); } catch { return []; }
  }
  return zillowListResults(parsed).map((item) => {
    const info = item.hdpData?.homeInfo;
    const address = item.address
      ?? ([item.addressStreet, item.addressCity, item.addressState, item.addressZipcode].filter(Boolean).join(', ') || null);
    const price = typeof item.unformattedPrice === 'number'
      ? item.unformattedPrice
      : typeof item.price === 'number'
        ? item.price
        : typeof item.price === 'string'
          ? Number(item.price.replace(/[^0-9.]/g, '')) || null
          : null;
    let acres: number | null = null;
    if (typeof info?.lotAreaValue === 'number' && info.lotAreaValue > 0) {
      acres = /acre/i.test(info.lotAreaUnit ?? '')
        ? info.lotAreaValue
        : Math.round((info.lotAreaValue / 43_560) * 100) / 100;
    }
    const detailUrl = item.detailUrl
      ? (item.detailUrl.startsWith('http') ? item.detailUrl : `https://www.zillow.com${item.detailUrl}`)
      : null;
    const dateValue = item.dateSold ?? item.soldDate ?? info?.dateSold;
    const listingDateValue = item.listingDate ?? info?.listingDate;
    return {
      address,
      price,
      acres,
      url: detailUrl,
      status: item.statusType ?? item.homeStatus ?? null,
      lat: item.latLong?.latitude ?? item.latitude ?? info?.latitude ?? null,
      lng: item.latLong?.longitude ?? item.longitude ?? info?.longitude ?? null,
      soldDate: normalizeZillowDate(dateValue),
      listingDate: normalizeZillowDate(listingDateValue),
      daysOnMarket: item.daysOnZillow ?? item.timeOnZillow ?? info?.daysOnZillow ?? null,
      homeType: info?.homeType ?? 'Manufactured',
      yearBuilt: info?.yearBuilt ?? null,
      homeSizeSqft: info?.livingArea ?? null,
    };
  });
}

function normalizeZillowDate(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const numeric = typeof value === 'number' ? value : /^\d{10,13}$/.test(value) ? Number(value) : null;
  const stamp = numeric != null
    ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(stamp)) return null;
  return new Date(stamp).toISOString().slice(0, 10);
}

function normalizedGeo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Refuse an unrelated Zillow market before extraction. Listing addresses are
 * strongest; otherwise the resolved page must retain the requested route and a
 * subject geography token. */
export function verifyZillowResolvedGeography(
  input: ZillowFetchInput,
  route: ZillowSearchRoute,
  page: { url?: string; text?: string } | null | undefined,
  listings: RawZillowListing[],
): { valid: boolean; reason: string } {
  const expectedState = (input.state ?? '').trim().toUpperCase();
  const addressed = listings.filter((row) => !!row.address);
  if (expectedState && addressed.some((row) => addressStateCode(row.address ?? '') === expectedState)) return { valid: true, reason: 'listing addresses match the subject state' };
  if (expectedState && addressed.length > 0) return { valid: false, reason: `listing addresses do not match ${expectedState}` };
  const haystack = normalizedGeo(`${page?.url ?? ''} ${page?.text ?? ''}`);
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const city = normalizedGeo(input.city ?? '');
  const county = normalizedGeo((input.county ?? '').replace(/\s+county$/i, ''));
  const state = normalizedGeo(expectedState);
  const routeRetained = route.kind === 'coordinates'
    ? /searchquerystate/i.test(page?.url ?? route.url)
    : haystack.includes(normalizedGeo(route.url));
  const placeMatched = (!!zip && haystack.includes(zip)) || (!!city && haystack.includes(city)) || (!!county && haystack.includes(county));
  if (routeRetained && placeMatched && (!state || haystack.includes(state))) return { valid: true, reason: 'resolved page matches subject geography' };
  return { valid: false, reason: `resolved page did not verify ${[input.city, input.county, input.zip, expectedState].filter(Boolean).join(' / ')}` };
}

/**
 * Fetch Zillow public land comps for a locality via a disposable Chrome profile.
 * Gated on live-browser mode (unless deps.force). Always resolves (never throws);
 * status is one of retrieved/blocked/none/error/disabled.
 */
export async function fetchZillowLandComps(input: ZillowFetchInput, deps: ZillowFetchDeps = {}): Promise<ZillowCompsResult> {
  const state = (input.state ?? '').trim();
  const routes = zillowSearchRoutes(input);
  const url = routes[0]?.url ?? '';
  const manufacturedSearch = input.propertyType === 'manufactured';
  const proof: ManufacturedHomeSearchProof = {
    radiusMiles: input.radiusMiles ?? 5,
    timePeriodMonths: input.dateWindowMonths ?? 24,
    sourcesSearched: ['Zillow'],
    routesAttempted: [],
    candidatesReviewed: 0,
    qualifyingResults: 0,
    exclusionReasons: [],
  };
  const finish = (result: ZillowCompsResult): ZillowCompsResult =>
    manufacturedSearch ? { ...result, searchProof: { ...proof, exclusionReasons: [...proof.exclusionReasons] } } : result;
  if (!deps.force && !deps.connect) {
    // Production gate: only browse when live-browser mode is enabled.
    try { if (!readSessionConfig().enabled) return finish({ status: 'disabled', comps: [], note: 'Live browser mode off — Zillow not attempted.', routeTried: url }); } catch { /* fall through */ }
  }
  if (!state || routes.length === 0) return finish({ status: 'disabled', comps: [], note: 'No coordinates, ZIP, city, or county with state for a Zillow land search.', routeTried: url });

  // Zillow runs in a DISPOSABLE INCOGNITO CONTEXT of the ONE owned automation
  // browser. It used to launch its own Chrome on a throwaway profile — and a
  // throwaway profile remembers no window position, so that Chrome opened
  // centre-screen in the foreground, over the operator's work, for the length of
  // the lane. The context gives the same cookie isolation with no second
  // process and no window that can appear.
  const connect = deps.connect ?? defaultConnect;
  const timeoutMs = deps.timeoutMs ?? 30000;

  let browser: ZillowBrowserLike | null = null;
  try {
    browser = await connect(automationBrowserConfig().endpoint);
    if (!browser) return finish({ status: 'error', comps: [], note: 'The LandOS automation browser is not available for Zillow.', routeTried: url });

    const settleMs = deps.settleMs ?? 6000;
    const scrollSettleMs = deps.scrollSettleMs ?? 800;
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }
    const failedGeographies: string[] = [];
    let lastRoute = url;
    for (const route of routes) {
      lastRoute = route.url;
      proof.routesAttempted.push(`${route.label}: ${route.url}`);
      await page.goto(route.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      for (let i = 0; i < 4; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const read = await page.evaluate<RawZillowRead>(EXTRACT_ZILLOW as unknown as () => RawZillowRead);
      const raw = read?.listings ?? [];
      if (blocked && raw.length === 0 && !read?.nextData) return finish({ status: 'blocked', comps: [], note: `Zillow served an anti-bot check on the ${route.label} route (no public listings returned).`, routeTried: route.url });
      const pageGeo = await page.evaluate<{ url: string; text: string }>(READ_PAGE_GEOGRAPHY as unknown as () => { url: string; text: string }).catch(() => ({ url: route.url, text: '' }));
      const verifiedGeo = verifyZillowResolvedGeography(input, route, pageGeo, raw);
      if (!verifiedGeo.valid) { failedGeographies.push(`${route.label}: ${verifiedGeo.reason}`); continue; }
      const manufactured = manufacturedSearch;
      const structuredRaw = manufactured && read?.nextData ? structuredManufacturedListings(read.nextData) : [];
      const structured = !manufactured && read?.nextData ? parseZillowStructured(read.nextData, input.subjectAcres ?? null) : [];
      const mode = input.mode ?? 'active';
      const normalized: ZillowLandComp[] = manufactured
        ? normalizeZillowListings(structuredRaw.length ? structuredRaw : raw, null, mode, 'manufactured')
        : structured.length
        ? structured.map((s) => {
            const rawAddress = s.address ?? '';
            const address = reconcileCompAddress({ capturedAddress: rawAddress, sourceUrl: s.url ?? null })?.postalAddress ?? rawAddress;
            return { address, price: s.price, acres: s.acres, pricePerAcre: s.pricePerAcre, status: s.status === 'unknown' && mode === 'active' ? ('active' as const) : s.status, url: s.url, source: 'Zillow' as const, lat: null, lng: null };
          })
          .filter((c) => c.address && (mode === 'sold' ? c.status === 'sold' : c.status !== 'sold'))
        : normalizeZillowListings(raw, input.subjectAcres ?? null, mode);
      const expectedState = state.toUpperCase();
      const subjectPoint = Number.isFinite(input.lat) && Number.isFinite(input.lng)
        ? { lat: input.lat as number, lng: input.lng as number }
        : null;
      const exclusionCounts = new Map<string, number>();
      const exclude = (reason: string): false => {
        exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1);
        return false;
      };
      if (manufactured) proof.candidatesReviewed += normalized.length;
      const cutoff = (deps.nowMs ?? Date.now()) - (input.dateWindowMonths ?? 24) * 30.4 * 86_400_000;
      const comps = normalized.filter((comp) => {
        if (addressStateCode(comp.address) !== expectedState) return manufactured ? exclude(`Outside subject state ${expectedState}`) : false;
        if (!manufactured) return true;
        if (comp.status !== 'sold') return exclude('Not a confirmed closed sale');
        if (comp.price <= 200_000) return exclude('Sale price is not above $200,000');
        if (!subjectPoint) return exclude('Subject coordinates unavailable');
        if (!Number.isFinite(comp.lat) || !Number.isFinite(comp.lng)) return exclude('Listing coordinates unavailable');
        if (distanceMiles(subjectPoint, { lat: comp.lat as number, lng: comp.lng as number }) > (input.radiusMiles ?? 5)) {
          return exclude(`Outside ${input.radiusMiles ?? 5}-mile radius`);
        }
        if (!comp.soldDate || !Number.isFinite(Date.parse(comp.soldDate))) return exclude('Verified sale date unavailable');
        if (Date.parse(comp.soldDate) < cutoff) return exclude(`Outside ${input.dateWindowMonths ?? 24}-month time period`);
        return true;
      });
      if (manufactured) {
        proof.qualifyingResults += comps.length;
        proof.exclusionReasons = [...exclusionCounts.entries()].map(([reason, count]) => ({ reason, count }));
      }
      const rejectedOutsideMarket = normalized.length - comps.length;
      if (!comps.length) continue;
      const via = structured.length || structuredRaw.length ? 'structured __NEXT_DATA__' : 'visible cards';
      return finish({
        status: 'retrieved', comps,
        note: manufactured
          ? `Zillow verified ${route.label} and returned ${comps.length} sold manufactured-home comp(s) above $200,000 with listing coordinates proven within 5 miles via ${via}.`
          : `Zillow verified ${route.label} and returned ${comps.length} in-band ${expectedState} comp(s) via ${via}${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''}${rejectedOutsideMarket ? `; rejected ${rejectedOutsideMarket} row(s) outside the verified state or without usable locality evidence` : ''}.`,
        routeTried: route.url,
      });
    }
    return finish({
      status: 'none',
      comps: [],
      note: manufacturedSearch
        ? `Zillow reviewed ${proof.candidatesReviewed} manufactured-home candidate(s) within ${proof.radiusMiles} miles over ${proof.timePeriodMonths} months and retained no qualifying closed sale above $200,000.`
        : `Zillow returned no verified in-band ${state.toUpperCase()} land comps across ${routes.length} subject-geography route(s)${failedGeographies.length ? `; ${failedGeographies.length} wrong-geography route(s) were automatically rejected` : ''}.`,
      routeTried: lastRoute,
    });
  } catch (e) {
    return finish({ status: 'error', comps: [], note: `Zillow capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried: url });
  } finally {
    // Disposes the incognito context and every page it handed out — on success,
    // error, timeout and early return alike. Never closes the owned browser.
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}
