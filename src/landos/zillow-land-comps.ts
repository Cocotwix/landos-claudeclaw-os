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
import { laneSearchVerified, type CompLaneRouteOutcome } from './comp-lane-accountability.js';
import { RECENT_SALE_WINDOW_MONTHS, MAX_SOLD_SEARCH_WINDOW_MONTHS, type SoldSearchWindowMonths } from './comp-sale-recency.js';

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
  /** What every route actually did (visible cards vs. what survived), so a
   * false-zero retrieval is distinguishable from an empty market. */
  routes: CompLaneRouteOutcome[];
  searchVerified: boolean;
  /** visible = result cards/structured rows the page exposed; extracted = rows
   * with a readable price; normalized = rows that entered the candidate set. */
  retrievalCounts: { visible: number; extracted: number; normalized: number };
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
  /** Sold-period window. Defaults to the 12-month Pass 1 window: a sold search
   *  that silently reached two years back was how ancient sales entered the
   *  candidate workflow before anything deliberately expanded. 24 is Pass 2 and
   *  must be asked for. Never a price bound: there is no price filter here. */
  dateWindowMonths?: SoldSearchWindowMonths;
  propertyType?: 'land' | 'manufactured';
  /** Minimum lot size for the search itself (operator-style "20+ acres"). When
   * set, the search also includes improved (house) results so large-acreage
   * improved sales are discovered; classification decides their role later. */
  lotMinAcres?: number | null;
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

export interface ZillowSearchRoute { kind: 'zip' | 'coordinates' | 'road' | 'locality' | 'parcel'; label: string; url: string }

/** The filterState shared by the ZIP and coordinates routes. A lot-size minimum
 * reproduces the operator's own "20+ acres" search; when it is present the
 * search also includes houses, because a large-acreage improved sale is market
 * evidence that must be DISCOVERED first and classified later. There is never a
 * maximum lot size and never a price filter of any kind. */
function zillowFilterState(input: ZillowFetchInput): Record<string, unknown> {
  const sold = input.mode === 'sold';
  const manufactured = input.propertyType === 'manufactured';
  const lotMinAcres = manufactured ? null : input.lotMinAcres ?? null;
  const includeHouses = lotMinAcres != null;
  return {
    land: { value: !manufactured },
    house: { value: !manufactured && includeHouses },
    condo: { value: false },
    townhouse: { value: false },
    apartment: { value: false },
    manufactured: { value: manufactured },
    ...(lotMinAcres != null ? { lotSize: { min: Math.round(lotMinAcres * 43_560) } } : {}),
    ...(sold ? { isRecentlySold: { value: true }, doz: { value: input.dateWindowMonths === MAX_SOLD_SEARCH_WINDOW_MONTHS ? '24m' : '12m' } } : {}),
  };
}

/** Zillow's own resolved region state, dug out of the ZIP page's __NEXT_DATA__.
 * Carrying it into the filtered request pins the search to the subject's
 * market; without it Zillow silently swaps in its default market. */
export function zillowRegionQueryState(rawJsonOrObj: string | unknown): { mapBounds?: unknown; regionSelection?: unknown; usersSearchTerm?: string } | null {
  let parsed: unknown = rawJsonOrObj;
  if (typeof rawJsonOrObj === 'string') {
    try { parsed = JSON.parse(rawJsonOrObj); } catch { return null; }
  }
  const anyp = parsed as Record<string, any> | null;
  const qs = anyp?.props?.pageProps?.searchPageState?.queryState ?? anyp?.queryState ?? null;
  if (!qs || typeof qs !== 'object') return null;
  const out: { mapBounds?: unknown; regionSelection?: unknown; usersSearchTerm?: string } = {};
  if (qs.mapBounds && typeof qs.mapBounds === 'object') out.mapBounds = qs.mapBounds;
  if (Array.isArray(qs.regionSelection) && qs.regionSelection.length) out.regionSelection = qs.regionSelection;
  if (typeof qs.usersSearchTerm === 'string' && qs.usersSearchTerm.trim()) out.usersSearchTerm = qs.usersSearchTerm;
  return out.mapBounds || out.regionSelection ? out : null;
}

/** The operator-style filtered URL for a ZIP region Zillow itself resolved.
 * The region (path plus, when available, Zillow's own regionSelection and
 * mapBounds) carries the market, so the filterState (sold window, lot minimum,
 * property types — never a price filter) is honored instead of being replaced
 * by Zillow's default market. */
export function zillowZipFilteredUrl(
  regionPath: string,
  input: ZillowFetchInput,
  region?: { mapBounds?: unknown; regionSelection?: unknown; usersSearchTerm?: string } | null,
): string {
  const cleanPath = `/${regionPath.replace(/^\/+|\/+$/g, '')}`;
  const board = input.mode === 'sold' ? '/sold' : '';
  const searchQueryState = encodeURIComponent(JSON.stringify({
    ...(region?.mapBounds ? { mapBounds: region.mapBounds } : {}),
    ...(region?.regionSelection ? { regionSelection: region.regionSelection } : {}),
    ...(region?.usersSearchTerm ? { usersSearchTerm: region.usersSearchTerm } : {}),
    filterState: zillowFilterState(input),
    isListVisible: true,
  }));
  return `https://www.zillow.com${cleanPath}${board}/?searchQueryState=${searchQueryState}`;
}

/** Search the strongest subject geography first. The bare ZIP reproduces the
 * operator's own search; coordinates constrain Zillow's map directly; road,
 * city, and county are deterministic recovery routes. */
export function zillowSearchRoutes(input: ZillowFetchInput): ZillowSearchRoute[] {
  const state = (input.state ?? '').trim().toLowerCase();
  const sold = input.mode === 'sold';
  const radius = input.radiusMiles ?? 5;
  const routes: ZillowSearchRoute[] = [];
  const manufactured = input.propertyType === 'manufactured';
  const soldBoard = sold ? 'recently_sold' : manufactured ? 'for_sale/manufactured_type' : 'for_sale/land_type';
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  if (zip) {
    // Two-step route: Zillow must resolve the ZIP to its own region path first
    // (a searchQueryState without a region is silently replaced by Zillow's
    // default market). The fetch loop follows up with zillowZipFilteredUrl on
    // the resolved region path.
    routes.push({
      kind: 'zip',
      label: `ZIP ${zip}${input.lotMinAcres != null && !manufactured ? `, ${input.lotMinAcres}+ acres` : ''}${sold ? ', sold' : ''}`,
      url: `https://www.zillow.com/homes/${zip}_rb/`,
    });
  }
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    const lat = input.lat as number;
    const lng = input.lng as number;
    const latDelta = radius / 69;
    const lngDelta = radius / Math.max(35, 69 * Math.cos(lat * Math.PI / 180));
    const searchQueryState = encodeURIComponent(JSON.stringify({
      mapBounds: { north: lat + latDelta, south: lat - latDelta, east: lng + lngDelta, west: lng - lngDelta },
      filterState: zillowFilterState(input),
      isListVisible: true,
    }));
    routes.push({ kind: 'coordinates', label: `${lat.toFixed(5)}, ${lng.toFixed(5)} within ${radius} miles`, url: `https://www.zillow.com/homes/${soldBoard}/?searchQueryState=${searchQueryState}` });
  }
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

/** Normalize raw listings into deduped candidate rows. Never fabricates; drops
 *  rows without a price+address. BUSINESS RULE: no price minimum, maximum, or
 *  acreage band here — discovery retains every real candidate and downstream
 *  classification (Core / Directional / Excluded) analyzes price and acreage. */
export function normalizeZillowListings(
  raw: RawZillowListing[],
  _subjectAcres: number | null,
  mode: 'sold' | 'active' = 'active',
  _propertyType: 'land' | 'manufactured' = 'land',
): ZillowLandComp[] {
  const seen = new Set<string>();
  const out: ZillowLandComp[] = [];
  for (const r of raw) {
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    const acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
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
  return out.slice(0, 40);
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
    // A positive bed/bath count marks the card as an improved sale so downstream
    // classification can keep it as directional evidence instead of losing it.
    const residential = /\b[1-9]\d*\s*(?:bds?|beds?)\b/i.test(txt) || /\b[1-9]\d*\s*(?:ba|baths?)\b/i.test(txt);
    const hm = txt.match(/([\d,]{3,})\s*sqft\b(?!\s*lot)/i);
    const homeSizeSqft = residential && hm ? Number(hm[1].replace(/,/g, '')) || null : null;
    if (price && address && !seen.has(address)) { seen.add(address); out.push({ price, acres, address, url: link, status, homeType: residential ? 'Residential (beds/baths listed)' : null, homeSizeSqft }); }
  }
  const nd = (document as any).querySelector('#__NEXT_DATA__');
  const nextData = nd && nd.textContent ? String(nd.textContent) : null;
  return { listings: out, nextData };
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access to this page has been denied|access denied/i.test(`${(document as any).title ?? ''} ${((document as any).body?.innerText || '').slice(0, 4000)}`);
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
  // The query string is the REQUEST, not the resolution: Zillow keeps the
  // requested searchQueryState in the URL even when it silently swaps in its
  // default market, so only the resolved path + page text may verify geography.
  const pageUrlNoQuery = (page?.url ?? '').split('?')[0];
  const haystack = normalizedGeo(`${pageUrlNoQuery} ${page?.text ?? ''}`);
  const zip = (input.zip ?? '').match(/\b\d{5}\b/)?.[0];
  const city = normalizedGeo(input.city ?? '');
  const county = normalizedGeo((input.county ?? '').replace(/\s+county$/i, ''));
  const state = normalizedGeo(expectedState);
  const routeRetained = route.kind === 'coordinates'
    ? /searchquerystate/i.test(page?.url ?? route.url)
    : route.kind === 'zip'
      ? !!zip && normalizedGeo(pageUrlNoQuery).includes(zip)
      : haystack.includes(normalizedGeo(route.url.split('?')[0]));
  const placeMatched = (!!zip && haystack.includes(zip)) || (!!city && haystack.includes(city)) || (!!county && haystack.includes(county));
  if (routeRetained && placeMatched && (!state || haystack.includes(state))) return { valid: true, reason: 'resolved page matches subject geography' };
  return { valid: false, reason: `resolved page did not verify ${[input.city, input.county, input.zip, expectedState].filter(Boolean).join(' / ')}` };
}

/**
 * Fetch Zillow public land comps for a locality via a disposable Chrome profile.
 * Gated on live-browser mode (unless deps.force). Always resolves (never throws);
 * status is one of retrieved/blocked/none/error/disabled.
 */
export async function fetchZillowLandComps(rawInput: ZillowFetchInput, deps: ZillowFetchDeps = {}): Promise<ZillowCompsResult> {
  // A large-acreage subject gets an operator-style search: lot-size minimum
  // derived from the subject (quarter of its acreage, never a maximum), houses
  // included so improved large-acreage sales are discovered, and a wider
  // coordinate radius approximating the subject's ZIP-scale market.
  const largeAcreage = rawInput.propertyType !== 'manufactured'
    && rawInput.subjectAcres != null && rawInput.subjectAcres >= 20;
  const input: ZillowFetchInput = {
    ...rawInput,
    lotMinAcres: rawInput.lotMinAcres !== undefined
      ? rawInput.lotMinAcres
      : largeAcreage ? Math.max(10, Math.round((rawInput.subjectAcres as number) / 4)) : null,
    radiusMiles: rawInput.radiusMiles ?? (largeAcreage ? 15 : 5),
  };
  const state = (input.state ?? '').trim();
  const routes = zillowSearchRoutes(input);
  const url = routes[0]?.url ?? '';
  const manufacturedSearch = input.propertyType === 'manufactured';
  const proof: ManufacturedHomeSearchProof = {
    radiusMiles: input.radiusMiles ?? 5,
    timePeriodMonths: input.dateWindowMonths ?? RECENT_SALE_WINDOW_MONTHS,
    sourcesSearched: ['Zillow'],
    routesAttempted: [],
    candidatesReviewed: 0,
    qualifyingResults: 0,
    exclusionReasons: [],
  };
  const routeOutcomes: CompLaneRouteOutcome[] = [];
  const counts = { visible: 0, extracted: 0, normalized: 0 };
  const finish = (result: Omit<ZillowCompsResult, 'routes' | 'searchVerified' | 'retrievalCounts'>): ZillowCompsResult => {
    const base: ZillowCompsResult = {
      ...result,
      routes: [...routeOutcomes],
      searchVerified: laneSearchVerified(routeOutcomes),
      retrievalCounts: { ...counts },
    };
    return manufacturedSearch ? { ...base, searchProof: { ...proof, exclusionReasons: [...proof.exclusionReasons] } } : base;
  };
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
      let activeUrl = route.url;
      await page.goto(route.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      if (route.kind === 'zip') {
        // Step 2 of the ZIP route: Zillow has now resolved the ZIP region in
        // its app state; re-request with that region PLUS the operator-style
        // filters, so the filters cannot be silently swapped for Zillow's
        // default market.
        const zipToken = (input.zip ?? '').match(/\b\d{5}\b/)?.[0] ?? '';
        const resolvedPath = await page.evaluate<string>('window.location.pathname').catch(() => '');
        const regionJson = await page.evaluate<string | null>('document.querySelector("#__NEXT_DATA__") ? document.querySelector("#__NEXT_DATA__").textContent : null').catch(() => null);
        const region = regionJson ? zillowRegionQueryState(regionJson) : null;
        if (zipToken && typeof resolvedPath === 'string' && resolvedPath.includes(zipToken)) {
          activeUrl = zillowZipFilteredUrl(resolvedPath, input, region);
          await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          await sleep(settleMs);
        }
      }
      lastRoute = activeUrl;
      proof.routesAttempted.push(`${route.label}: ${activeUrl}`);
      for (let i = 0; i < 8; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const read = await page.evaluate<RawZillowRead>(EXTRACT_ZILLOW as unknown as () => RawZillowRead);
      const raw = read?.listings ?? [];
      if (blocked && raw.length === 0 && !read?.nextData) {
        routeOutcomes.push({ label: route.label, url: activeUrl, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: `Zillow served an anti-bot check on the ${route.label} route (no public listings returned).` });
        return finish({ status: 'blocked', comps: [], note: `Zillow served an anti-bot check on the ${route.label} route (no public listings returned).`, routeTried: activeUrl });
      }
      const pageGeo = await page.evaluate<{ url: string; text: string }>(READ_PAGE_GEOGRAPHY as unknown as () => { url: string; text: string }).catch(() => ({ url: activeUrl, text: '' }));
      const verifiedGeo = verifyZillowResolvedGeography(input, route, pageGeo, raw);
      const manufactured = manufacturedSearch;
      const structuredRaw = manufactured && read?.nextData ? structuredManufacturedListings(read.nextData) : [];
      const structured = !manufactured && read?.nextData ? parseZillowStructured(read.nextData, input.subjectAcres ?? null) : [];
      const structuredListCount = read?.nextData ? (() => { try { return zillowListResults(JSON.parse(read.nextData as string)).length; } catch { return 0; } })() : 0;
      const visibleOnRoute = Math.max(raw.length, structuredListCount);
      if (!verifiedGeo.valid) {
        failedGeographies.push(`${route.label}: ${verifiedGeo.reason}`);
        routeOutcomes.push({ label: route.label, url: activeUrl, reached: true, blocked, cardsFound: visibleOnRoute, marketVerified: false, qualifying: 0, outcome: `Opened ${activeUrl} and saw ${visibleOnRoute} card(s), but ${verifiedGeo.reason}, so nothing from it was used.` });
        continue;
      }
      counts.visible = Math.max(counts.visible, visibleOnRoute);
      const mode = input.mode ?? 'active';
      const normalized: ZillowLandComp[] = manufactured
        ? normalizeZillowListings(structuredRaw.length ? structuredRaw : raw, null, mode, 'manufactured')
        : structured.length
        ? structured.map((s) => {
            const rawAddress = s.address ?? '';
            const address = reconcileCompAddress({ capturedAddress: rawAddress, sourceUrl: s.url ?? null })?.postalAddress ?? rawAddress;
            return {
              address, price: s.price, acres: s.acres, pricePerAcre: s.pricePerAcre,
              status: s.status === 'unknown' && mode === 'active' ? ('active' as const) : s.status,
              url: s.url, source: 'Zillow' as const,
              lat: s.lat ?? null, lng: s.lng ?? null, soldDate: s.date ?? null,
              homeType: s.homeType ?? null, yearBuilt: s.yearBuilt ?? null, homeSizeSqft: s.homeSizeSqft ?? null,
            };
          })
          .filter((c) => c.address && (mode === 'sold' ? c.status === 'sold' : c.status !== 'sold'))
        : normalizeZillowListings(raw, input.subjectAcres ?? null, mode);
      const extractedOnRoute = manufactured
        ? (structuredRaw.length ? structuredRaw.length : raw.length)
        : (structured.length ? structured.length : raw.length);
      counts.extracted = Math.max(counts.extracted, extractedOnRoute);
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
      const cutoff = (deps.nowMs ?? Date.now()) - (input.dateWindowMonths ?? RECENT_SALE_WINDOW_MONTHS) * 30.4 * 86_400_000;
      // BUSINESS RULE: price never excludes a candidate. The manufactured lane
      // still proves geography, sold status, coordinates and time period;
      // whether such sales clear any price level is an analysis question the
      // retained candidates can answer.
      const comps = normalized.filter((comp) => {
        if (addressStateCode(comp.address) !== expectedState) return exclude(`Outside subject state ${expectedState}`);
        if (!manufactured) return true;
        if (comp.status !== 'sold') return exclude('Not a confirmed closed sale');
        if (!subjectPoint) return exclude('Subject coordinates unavailable');
        if (!Number.isFinite(comp.lat) || !Number.isFinite(comp.lng)) return exclude('Listing coordinates unavailable');
        if (distanceMiles(subjectPoint, { lat: comp.lat as number, lng: comp.lng as number }) > (input.radiusMiles ?? 5)) {
          return exclude(`Outside ${input.radiusMiles ?? 5}-mile radius`);
        }
        if (!comp.soldDate || !Number.isFinite(Date.parse(comp.soldDate))) return exclude('Verified sale date unavailable');
        if (Date.parse(comp.soldDate) < cutoff) return exclude(`Outside ${input.dateWindowMonths ?? RECENT_SALE_WINDOW_MONTHS}-month time period`);
        return true;
      });
      if (manufactured) {
        proof.qualifyingResults += comps.length;
        proof.exclusionReasons = [...exclusionCounts.entries()].map(([reason, count]) => ({ reason, count }));
      }
      const rejectedOutsideMarket = normalized.length - comps.length;
      routeOutcomes.push({
        label: route.label, url: activeUrl, reached: true, blocked, cardsFound: visibleOnRoute, marketVerified: true, qualifying: comps.length,
        outcome: comps.length
          ? `Opened ${activeUrl}, verified it as this subject's market, saw ${visibleOnRoute} card(s), extracted ${extractedOnRoute}, and kept ${comps.length} ${mode} candidate(s).`
          : `Opened ${activeUrl} and verified it as this subject's market; it exposed ${visibleOnRoute} card(s) and none survived extraction/status screening as a ${mode} candidate.`,
      });
      if (!comps.length) continue;
      counts.normalized = Math.max(counts.normalized, comps.length);
      const via = structured.length || structuredRaw.length ? 'structured __NEXT_DATA__' : 'visible cards';
      return finish({
        status: 'retrieved', comps,
        note: manufactured
          ? `Zillow verified ${route.label} and returned ${comps.length} sold manufactured-home candidate(s) with listing coordinates proven within ${input.radiusMiles ?? 5} miles via ${via}. No price filter was applied.`
          : `Zillow verified ${route.label}: ${visibleOnRoute} visible card(s) → ${extractedOnRoute} extracted → ${comps.length} ${expectedState} candidate(s) via ${via}${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''}${rejectedOutsideMarket ? `; ${rejectedOutsideMarket} row(s) screened out (state/status), never on price or acreage` : ''}.`,
        routeTried: activeUrl,
      });
    }
    return finish({
      status: 'none',
      comps: [],
      note: manufacturedSearch
        ? `Zillow reviewed ${proof.candidatesReviewed} manufactured-home candidate(s) within ${proof.radiusMiles} miles over ${proof.timePeriodMonths} months and retained no qualifying closed sale.`
        : `Zillow returned no verified ${state.toUpperCase()} candidates across ${routes.length} subject-geography route(s)${failedGeographies.length ? `; ${failedGeographies.length} wrong-geography route(s) were automatically rejected` : ''}. Route diagnostics show visible-card counts per route.`,
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
