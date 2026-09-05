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

import { openRemoteBrowserSession, remoteBrowserConfigured } from './remote-browser.js';
import {
  discoverMarketplaceRecords,
  marketplaceDiscoveryQueries,
  parseIndexedRecordFacts,
  MANUFACTURED_LABEL,
  type IndexedMarketplaceRecord,
} from './marketplace-indexed-discovery.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { readSessionConfig } from './browser-session.js';
import { automationBrowserConfig, openDisposableContextHandle, openPersistentContextHandle } from './automation-browser.js';
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
  /** `page` when read off an opened Zillow page (board or property record);
   *  `indexed_search` when the local transport was challenged and the facts
   *  came from the open-web index entry that points at this Zillow record. */
  lineage?: 'page' | 'indexed_search';
  /** Listing remarks when the property record exposed them. */
  description?: string | null;
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
  /** Nearby street or subdivision names already retained for the subject; they
   *  aim the indexed-search fallback the way an operator would type it. */
  localities?: string[];
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
  /**
   * Anti-bot hand-off. When Zillow serves a "Press & Hold" check, the lane does
   * NOT complete it. It calls this hook once, which by default brings the
   * managed LandOS browser window on-screen, notifies the operator, and waits
   * for a human to clear the check on that same session. Resolves true when
   * the page is no longer blocked, and the route is then re-read once.
   */
  onChallenge?: (ctx: ZillowChallengeContext) => Promise<boolean>;
  /** How long the default hand-off waits for a human (default 3 minutes). */
  challengeWaitMs?: number;
  /**
   * A shared, already-open Zillow session. When supplied, the fetch reads on
   * it and never closes it, so the sold, active and manufactured boards run
   * on one browser identity and one operator verification carries across them.
   */
  session?: ZillowBrowserLike;
  /** The indexed-search transport used when the local route is challenged.
   *  Defaults to the governed keyless search; tests inject a fake. */
  indexedSearch?: IdentitySearchProvider;
  /** Test seam: skip the indexed fallback entirely. */
  disableIndexedFallback?: boolean;
  /** How many discovered Zillow property records the fallback opens on the
   *  session (default 6). Each is opened once; a challenged record keeps its
   *  indexed facts and is never retried. */
  maxIndexedRecordsToOpen?: number;
}

/** Per-session memory of a challenge: once Zillow has challenged this
 *  session, the remaining boards skip the board request (which would only be
 *  challenged again) and go straight to the indexed transport. */
const SESSION_CHALLENGE = new WeakMap<object, { cleared: boolean; failedAtMs: number | null }>();
/** The persistent profile is one identity across sessions too: remember a
 *  challenge briefly so a parallel lane does not re-request a challenged board. */
let lastUnclearedChallengeAtMs: number | null = null;
const UNCLEARED_CHALLENGE_MEMORY_MS = 10 * 60 * 1000;

/**
 * Open the ONE persistent Zillow session. When a remote browser provider is
 * configured (see remote-browser.ts) the session is the provider's persistent
 * context, reached over CDP; otherwise it is the managed LandOS profile. The
 * caller runs every Zillow board on it, then closes it.
 */
export async function openZillowSession(deps: { env?: NodeJS.ProcessEnv } = {}): Promise<ZillowBrowserLike | null> {
  try {
    if (remoteBrowserConfigured(deps.env ?? process.env)) {
      const handle = await openRemoteBrowserSession('zillow', { env: deps.env });
      return { newPage: () => handle.newPage() as unknown as Promise<ZillowPageLike>, close: () => handle.close() };
    }
    return await openPersistentContextHandle('zillow') as unknown as ZillowBrowserLike;
  } catch {
    return null;
  }
}

/**
 * The shared Zillow session for concurrent lanes: the first caller opens it,
 * later callers reuse it, the last release closes it. Work on the shared
 * session is SERIALIZED so the sold, active and manufactured boards run one
 * after another on one identity even when their lanes start together.
 */
const shared: { session: ZillowBrowserLike | null; refs: number; queue: Promise<unknown>; opener: Promise<ZillowBrowserLike | null> | null } = {
  session: null, refs: 0, queue: Promise.resolve(), opener: null,
};

/** Take a reference to the shared session, opening it if this is the first. */
async function acquireSharedZillowSession(
  deps: { open?: () => Promise<ZillowBrowserLike | null> } = {},
): Promise<ZillowBrowserLike | null> {
  shared.refs += 1;
  if (!shared.session) {
    shared.opener = shared.opener ?? (deps.open ?? openZillowSession)();
    shared.session = await shared.opener;
    shared.opener = null;
  }
  return shared.session;
}

/** Drop a reference; the last one closes the session. */
async function releaseSharedZillowSession(): Promise<void> {
  shared.refs -= 1;
  if (shared.refs === 0 && shared.session) {
    const closing = shared.session;
    shared.session = null;
    try { await closing.close(); } catch { /* best-effort */ }
  }
}

export async function withSharedZillowSession<T>(
  work: (session: ZillowBrowserLike | null) => Promise<T>,
  deps: { open?: () => Promise<ZillowBrowserLike | null> } = {},
): Promise<T> {
  const session = await acquireSharedZillowSession(deps);
  try {
    const run = shared.queue.then(() => work(session));
    shared.queue = run.catch(() => undefined);
    return await run;
  } finally {
    await releaseSharedZillowSession();
  }
}

/**
 * Hold the ONE persistent Zillow session open across several lanes.
 *
 * `withSharedZillowSession` reference-counts and closes on the last release, so
 * two lanes that merely happen not to overlap in time each get their OWN
 * session: the sold and active boards ran on one identity and the manufactured
 * board on a second, which is not the single continuous session acceptance
 * requires. A lease is an explicit reference held for the whole marketplace
 * phase, so every board inside it runs on one identity with its cookies and any
 * cleared verification retained between them.
 */
export function leaseSharedZillowSession(
  deps: { open?: () => Promise<ZillowBrowserLike | null> } = {},
): { release: () => Promise<void> } {
  // A lease takes a REFERENCE, never a turn in the work queue. Holding the
  // queue instead would have kept the session open by blocking every board
  // that was waiting to run on it.
  const held = acquireSharedZillowSession(deps).catch(() => null);
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await held;
      await releaseSharedZillowSession();
    },
  };
}

/** Test seam: forget the profile-level challenge memory. */
export function resetZillowChallengeMemory(): void {
  lastUnclearedChallengeAtMs = null;
}

export interface ZillowChallengeContext {
  page: ZillowPageLike;
  routeLabel: string;
  url: string;
  board: 'sold' | 'active';
  propertyType: 'land' | 'manufactured';
  waitMs: number;
}

export interface ZillowPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  /** Optional window controls used only by the anti-bot hand-off. */
  bringToFront?(): Promise<void>;
  createCDPSession?(): Promise<{ send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> }>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
}
export interface ZillowBrowserLike { newPage(): Promise<ZillowPageLike>; close(): Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// There is deliberately NO default challenge hand-off any more: no operator
// notification, no window surfacing, no wait. A challenged local transport is
// recorded and the lane continues through the indexed transport below. The
// `onChallenge` hook remains only for an explicitly injected supervised caller.

/** In-page read of ONE Zillow property record (runs inside Chrome). Text
 *  only: the page's own headline facts, the sale/price-history lines, and the
 *  record's published coordinates. Nothing is inferred. */
const READ_ZILLOW_RECORD = (): { blocked: boolean; title: string; text: string; lat: number | null; lng: number | null; remarks: string | null } => {
  const d = document as any;
  const title = String(d.title ?? '');
  const body = String(d.body?.innerText ?? '');
  const html = String(d.documentElement?.outerHTML ?? '');
  const blocked = /press and hold|press & hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access to this page has been denied|access denied/i.test(`${title} ${body.slice(0, 4000)}`);
  const lat = html.match(/"latitude":\s*(-?\d{1,3}\.\d+)/)?.[1];
  const lng = html.match(/"longitude":\s*(-?\d{1,3}\.\d+)/)?.[1];
  const remarksEl = d.querySelector('[data-testid="description"], [class*="Description" i] p, [class*="description" i]');
  return {
    blocked, title, text: body.slice(0, 20000),
    lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null,
    remarks: remarksEl ? String(remarksEl.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200) || null : null,
  };
};

/** PURE. Facts a Zillow property-record page states in its own words. */
export function parseZillowRecordText(input: { title: string; text: string }): {
  address: string | null; price: number | null; status: CompStatus; soldDate: string | null; acres: number | null;
  beds: number | null; baths: number | null; homeSizeSqft: number | null; yearBuilt: number | null; homeType: string | null;
} {
  const text = input.text.replace(/\r/g, '');
  const address = input.title.match(/^\s*(.+?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5})/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const num = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const price = num(text.match(/\$\s?([\d,]{5,})/)?.[1]);
  // Sale history rows read "M/D/YYYY … Sold … $price"; the headline "Closed"
  // or "Sold" badge alone establishes the closed status.
  const soldRow = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*\n?\s*(?:Sold|Closed)\b/i) ?? text.match(/\b(?:Sold|Closed)(?:\s+on)?\s+(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i);
  const headline = text.slice(0, 1500);
  const status: CompStatus = /\b(?:Closed|Sold|Recently sold)\b/i.test(headline) || soldRow ? 'sold'
    : /\bFor sale\b|\bActive\b|\bPending\b|\bNew construction\b/i.test(headline) ? 'active' : 'unknown';
  const soldStamp = soldRow ? Date.parse(soldRow[1]) : NaN;
  const acresMatch = text.match(/([\d.,]+)\s*Acres?\s*Lot\b/i) ?? text.match(/Lot size[:\s]+([\d.,]+)\s*Acres?/i);
  const lotSqft = !acresMatch ? text.match(/([\d,]{4,})\s*sqft\s*lot\b/i) : null;
  const beds = num(text.match(/(\d{1,2})\s*\n?\s*beds?\b/i)?.[1]);
  const baths = num(text.match(/(\d{1,2}(?:\.\d)?)\s*\n?\s*baths?\b/i)?.[1]);
  const homeSizeSqft = num(text.match(/([\d,]{3,})\s*\n?\s*sqft\b(?!\s*lot)/i)?.[1]);
  const yearBuilt = num(text.match(/Built in\s+((?:18|19|20)\d{2})/i)?.[1]);
  const homeType = headline.match(MANUFACTURED_LABEL)?.[0] ?? (/\bLot\s*\/\s*Land\b|\bVacant land\b/i.test(headline) ? 'Lot / Land' : beds || baths ? 'residential' : null);
  return {
    address, price, status,
    soldDate: Number.isFinite(soldStamp) ? new Date(soldStamp).toISOString().slice(0, 10) : null,
    acres: num(acresMatch?.[1]) ?? (lotSqft ? Math.round(((num(lotSqft[1]) ?? 0) / 43_560) * 100) / 100 || null : null),
    beds, baths, homeSizeSqft, yearBuilt, homeType,
  };
}

/** Indexed record → lane row, using the index's facts. */
function indexedRecordToZillowComp(record: IndexedMarketplaceRecord): ZillowLandComp | null {
  if (!record.address || record.price == null) return null;
  return {
    address: record.address, price: record.price, acres: record.acres,
    pricePerAcre: record.acres ? Math.round(record.price / record.acres) : null,
    status: record.status, url: record.url, source: 'Zillow', soldDate: record.soldDate,
    homeType: record.homeType === 'manufactured' ? (record.snippet.match(MANUFACTURED_LABEL)?.[0] ?? 'Mobile / Manufactured') : record.homeType === 'land' ? 'Lot / Land' : record.homeType,
    yearBuilt: record.yearBuilt, homeSizeSqft: record.homeSizeSqft,
    lineage: 'indexed_search', description: `${record.title} — ${record.snippet}`.slice(0, 600),
  };
}

/**
 * The next approved transport once the local Zillow board is challenged:
 * discover Zillow's own property records through the governed indexed search,
 * then open each record ONCE on the same session. A record page that opens
 * supersedes the index facts (and adds coordinates and remarks); a record page
 * that is challenged keeps its indexed facts, marked as such. No retry, no wait.
 */
async function zillowIndexedFallback(
  input: ZillowFetchInput,
  page: ZillowPageLike | null,
  deps: ZillowFetchDeps,
  routeOutcomes: CompLaneRouteOutcome[],
  settleMs: number,
  timeoutMs: number,
): Promise<{ comps: ZillowLandComp[]; note: string; searchRan: boolean; recordsFound: number }> {
  const manufactured = input.propertyType === 'manufactured';
  const queries = marketplaceDiscoveryQueries({
    marketplace: 'zillow', board: input.mode === 'sold' ? 'sold' : 'active', propertyType: manufactured ? 'manufactured' : 'land',
    address: input.address, city: input.city, state: input.state, zip: input.zip, county: input.county, localities: input.localities,
  });
  if (!queries.length) return { comps: [], note: 'No plain-English locality was available for an indexed Zillow search.', searchRan: false, recordsFound: 0 };
  const discovered = await discoverMarketplaceRecords('zillow', queries, { search: deps.indexedSearch });
  const expectedState = (input.state ?? '').trim().toUpperCase();
  const wanted = discovered.records.filter((record) => {
    if (manufactured) return record.homeType === 'manufactured' || record.homeType == null;
    return record.homeType !== 'manufactured' && record.homeType !== 'residential';
  });
  const comps: ZillowLandComp[] = [];
  let opened = 0;
  let openedBlocked = 0;
  const maxOpen = deps.maxIndexedRecordsToOpen ?? 6;
  for (const record of wanted) {
    let comp = indexedRecordToZillowComp(record);
    if (page && opened < maxOpen) {
      opened += 1;
      try {
        await page.goto(record.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await sleep(settleMs);
        const read = await page.evaluate<ReturnType<typeof READ_ZILLOW_RECORD>>(READ_ZILLOW_RECORD as unknown as () => ReturnType<typeof READ_ZILLOW_RECORD>);
        if (read.blocked) {
          openedBlocked += 1;
        } else {
          const facts = parseZillowRecordText(read);
          const address = facts.address ?? record.address;
          const price = facts.price ?? record.price;
          if (address && price != null) {
            comp = {
              address, price, acres: facts.acres ?? record.acres,
              pricePerAcre: (facts.acres ?? record.acres) ? Math.round(price / ((facts.acres ?? record.acres) as number)) : null,
              status: facts.status !== 'unknown' ? facts.status : record.status,
              url: record.url, source: 'Zillow',
              soldDate: facts.soldDate ?? record.soldDate,
              lat: read.lat, lng: read.lng,
              homeType: facts.homeType ?? (record.homeType === 'manufactured' ? 'Mobile / Manufactured' : record.homeType),
              yearBuilt: facts.yearBuilt ?? record.yearBuilt, homeSizeSqft: facts.homeSizeSqft ?? record.homeSizeSqft,
              lineage: 'page', description: read.remarks ?? comp?.description ?? null,
            };
          }
        }
      } catch { /* the record keeps its indexed facts */ }
    }
    if (!comp) continue;
    if (expectedState && addressStateCode(comp.address) !== expectedState) continue;
    if (input.mode === 'sold' && comp.status !== 'sold') continue;
    if (input.mode === 'active' && comp.status === 'sold') continue;
    if (manufactured && !MANUFACTURED_LABEL.test(comp.homeType ?? '')) continue;
    if (!manufactured && MANUFACTURED_LABEL.test(comp.homeType ?? '')) continue;
    comps.push(comp);
  }
  routeOutcomes.push({
    label: 'indexed search', url: queries[0], reached: discovered.queriesRun > 0, blocked: false,
    cardsFound: discovered.records.length, marketVerified: comps.length > 0, qualifying: comps.length,
    outcome: discovered.queriesRun === 0
      ? 'The governed keyless search transport was unavailable, so no indexed Zillow record could be discovered.'
      : `Indexed search ran ${discovered.queriesRun} plain-English quer${discovered.queriesRun === 1 ? 'y' : 'ies'}, saw ${discovered.hitsSeen} result(s), found ${discovered.records.length} Zillow property record(s); ${opened} opened on the session (${openedBlocked} challenged, kept at index facts) and ${comps.length} ${input.mode === 'sold' ? 'sold' : 'active'} ${manufactured ? 'manufactured-home' : 'land'} record(s) kept.`,
  });
  const pageRead = comps.filter((comp) => comp.lineage === 'page').length;
  return {
    comps, searchRan: discovered.queriesRun > 0, recordsFound: discovered.records.length,
    note: comps.length
      ? `Zillow's board was challenged, so ${comps.length} record(s) were discovered through the indexed-search transport (${pageRead} read off the Zillow record page, ${comps.length - pageRead} at index facts); each links to the actual Zillow property record.`
      : discovered.queriesRun === 0
        ? 'Zillow\'s board was challenged and the indexed-search transport was unavailable.'
        : `Zillow's board was challenged; indexed search found ${discovered.records.length} Zillow record(s) but none stated a ${input.mode === 'sold' ? 'sold' : 'active'} ${manufactured ? 'manufactured-home' : 'land'} result with a price.`,
  };
}

/** The persistent Zillow session (remote provider when configured, else the
 *  managed LandOS profile). A per-route incognito context presented a brand-new
 *  identity to Zillow on every board and was challenged every time. Returns
 *  null (never a fallback browser) when no session can be opened. */
async function defaultConnect(_browserURL: string): Promise<ZillowBrowserLike | null> {
  return openZillowSession();
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
  const ownsSession = !deps.session;
  try {
    browser = deps.session ?? await connect(automationBrowserConfig().endpoint);
    if (!browser) return finish({ status: 'error', comps: [], note: 'The LandOS automation browser is not available for Zillow.', routeTried: url });
    const sessionState = SESSION_CHALLENGE.get(browser as object) ?? { cleared: false, failedAtMs: null };
    SESSION_CHALLENGE.set(browser as object, sessionState);
    // Profile-level memory applies to the real managed profile only; injected
    // test sessions carry their own per-session state.
    const profileRecentlyUncleared = !deps.force && lastUnclearedChallengeAtMs != null && Date.now() - lastUnclearedChallengeAtMs < UNCLEARED_CHALLENGE_MEMORY_MS;
    const settleMs = deps.settleMs ?? 6000;
    const scrollSettleMs = deps.scrollSettleMs ?? 800;
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }
    if (sessionState.failedAtMs != null || (profileRecentlyUncleared && !sessionState.cleared)) {
      // Zillow already challenged this session: re-requesting the board would
      // only be challenged again (a retry loop), so this board goes straight to
      // the next approved transport. No verification is requested or awaited.
      const skippedNote = `Zillow served an anti-bot check earlier on this session, so the ${input.mode === 'sold' ? 'sold' : 'active'} ${manufacturedSearch ? 'manufactured-home' : 'land'} board was not re-requested (no verification was requested or waited for).`;
      routeOutcomes.push({ label: routes[0]?.label ?? 'board', url, reached: false, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: skippedNote });
      if (deps.disableIndexedFallback) return finish({ status: 'blocked', comps: [], note: skippedNote, routeTried: url });
      const fallback = await zillowIndexedFallback(input, page, deps, routeOutcomes, settleMs, timeoutMs);
      proof.routesAttempted.push(`indexed search: ${fallback.recordsFound} Zillow record(s) discovered`);
      if (manufacturedSearch) { proof.candidatesReviewed += fallback.recordsFound; proof.qualifyingResults += fallback.comps.length; }
      return finish({ status: fallback.comps.length ? 'retrieved' : 'blocked', comps: fallback.comps, note: `${skippedNote} ${fallback.note}`, routeTried: url });
    }
    const failedGeographies: string[] = [];
    let challengeHandled = false;
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
      const readRoute = async () => {
        for (let i = 0; i < 8; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
        const isBlocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
        const pageRead = await page.evaluate<RawZillowRead>(EXTRACT_ZILLOW as unknown as () => RawZillowRead);
        return { blocked: isBlocked, read: pageRead, raw: pageRead?.listings ?? [] };
      };
      let { blocked, read, raw } = await readRoute();
      if (blocked && raw.length === 0 && !read?.nextData && !challengeHandled) {
        // One hand-off per SESSION: a human clears the check on this profile,
        // then the same route is re-read once and the remaining boards reuse
        // the cleared state. Never scripted, never repeated.
        challengeHandled = true;
        const state = SESSION_CHALLENGE.get(browser as object)!;
        // Normal workflow: no operator interaction, no notification, no wait.
        // A challenged page is recorded as blocked at once. The hand-off hook
        // exists only for an explicitly injected caller (tests, a future
        // supervised mode) and is never the default.
        const handoff = deps.onChallenge ?? (async () => false);
        const cleared = await handoff({
          page, routeLabel: route.label, url: activeUrl,
          board: input.mode === 'sold' ? 'sold' : 'active',
          propertyType: manufacturedSearch ? 'manufactured' : 'land',
          waitMs: deps.challengeWaitMs ?? 3 * 60 * 1000,
        }).catch(() => false);
        if (cleared) { state.cleared = true; lastUnclearedChallengeAtMs = null; } else { state.failedAtMs = Date.now(); lastUnclearedChallengeAtMs = Date.now(); }
        if (cleared) {
          routeOutcomes.push({ label: route.label, url: activeUrl, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: 'Zillow served an anti-bot check; the operator cleared it on this session and the route was re-read.' });
          await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          await sleep(settleMs);
          ({ blocked, read, raw } = await readRoute());
        }
      }
      if (blocked && raw.length === 0 && !read?.nextData) {
        // The local board transport was challenged. That is a transport
        // outcome, never "Zillow has no records": record it and continue at
        // once through the indexed transport. No retry, no wait, no operator.
        const blockedNote = `Zillow served an anti-bot check on the ${route.label} route (no public listings returned).`;
        routeOutcomes.push({ label: route.label, url: activeUrl, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: blockedNote });
        if (deps.disableIndexedFallback) return finish({ status: 'blocked', comps: [], note: blockedNote, routeTried: activeUrl });
        const fallback = await zillowIndexedFallback(input, page, deps, routeOutcomes, settleMs, timeoutMs);
        proof.routesAttempted.push(`indexed search: ${fallback.recordsFound} Zillow record(s) discovered`);
        if (manufacturedSearch) { proof.candidatesReviewed += fallback.recordsFound; proof.qualifyingResults += fallback.comps.length; }
        counts.normalized = Math.max(counts.normalized, fallback.comps.length);
        return finish({ status: fallback.comps.length ? 'retrieved' : 'blocked', comps: fallback.comps, note: `${blockedNote} ${fallback.note}`, routeTried: activeUrl });
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
    try { if (browser) if (ownsSession) await browser.close(); } catch { /* ignore */ }
  }
}
