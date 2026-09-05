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
import { MAX_SOLD_SEARCH_WINDOW_MONTHS, recentSoldEvidenceSufficient, type SoldSearchWindowMonths } from './comp-sale-recency.js';

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
  /** True when the card printed no status and a VERIFIED sold-only board's own
   *  filter established it as a closed record. The sale date is never inferred. */
  statusFromBoardFilter?: boolean;
  /** The verified sold board this status was inherited from. */
  soldBoardUrl?: string | null;
  /** The sold filter that made that board sold-only. */
  soldBoardFilter?: string | null;
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
  /** Land (default) or manufactured/mobile homes on their own lots. */
  propertyType?: 'land' | 'manufactured';
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
  /** The provider's own coordinate for the record, from the card's JSON-LD
   *  `geo` block. Never a geocode of the address text. */
  lat?: number | null;
  lng?: number | null;
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
export function redfinLandFilterUrl(cityPath: string, opts: { sold?: boolean; dateWindowMonths?: SoldSearchWindowMonths; lotMinAcres?: number | null; propertyType?: 'land' | 'manufactured' } = {}): string {
  const lotMin = opts.propertyType === 'manufactured' ? null : redfinLotMinFilter(opts.lotMinAcres);
  // Redfin's public filter key for manufactured / mobile homes is
  // `manufactured`. `mobile` is not a Redfin key: Redfin silently dropped the
  // whole filter and served the unfiltered for-sale board, which is how a
  // sold manufactured-home search read 36 active cards and kept none.
  const propertyType = opts.propertyType === 'manufactured' ? 'property-type=manufactured' : lotMin ? 'property-type=land+house' : 'property-type=land';
  const parts = [propertyType];
  if (lotMin) parts.push(lotMin);
  // Pass 1 is the trailing year. `sold-2yr` is only ever produced when a caller
  // deliberately expanded after insufficient recent evidence; there is no
  // longer-than-2yr option and no price segment at all.
  if (opts.sold) parts.push(`include=sold-${opts.dateWindowMonths === MAX_SOLD_SEARCH_WINDOW_MONTHS ? '2yr' : '1yr'}`);
  return `https://www.redfin.com${cityPath}/filter/${parts.join(',')}`;
}

/** Board pages read beyond the first (Redfin renders about 40 cards a page). */
export const REDFIN_MAX_BOARD_PAGES = 3;

/** "69 homes" as the board states it near its heading; null when unstated. */
/**
 * The canonical identity of a discovered land candidate.
 *
 * NEVER the address alone. Vacant land is routinely listed without a street
 * number, and adjacent lots in one subdivision share a road name or the literal
 * placeholder "TBD": two separate arms-length sales of two separate parcels
 * would collapse into one record and a real transaction would vanish from the
 * market. Identity is taken from the strongest evidence the card carries:
 *
 *   1. the provider's own record id (the numeric id in its URL),
 *   2. failing that, the full listing URL,
 *   3. failing that, the parcel point the card published,
 *   4. and only then a COMPOUND of address + acreage + price + sale date, so
 *      two lots on one road stay separate unless every one of those agrees.
 */
export function redfinCandidateIdentity(row: {
  address?: string | null; url?: string | null; acres?: number | null;
  price?: number | null; soldDate?: string | null; listingDate?: string | null;
  lat?: number | null; lng?: number | null; apn?: string | null;
}): string {
  const recordId = redfinListingIdFromUrl(row.url);
  if (recordId) return `redfin:${recordId}`;
  const apn = (row.apn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (apn) return `apn:${apn}`;
  const url = (row.url ?? '').trim().toLowerCase();
  if (url) return `url:${url}`;
  if (typeof row.lat === 'number' && typeof row.lng === 'number') {
    // ~1 m: two distinct parcels never share a published point this closely.
    return `pt:${row.lat.toFixed(5)},${row.lng.toFixed(5)}`;
  }
  const address = (row.address ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!address) return '';
  const date = (row.soldDate ?? row.listingDate ?? '').slice(0, 10);
  return `cmp:${address}|${row.acres ?? '?'}|${row.price ?? '?'}|${date || '?'}`;
}

/** The numeric record id Redfin puts in every listing URL (`/home/194963699`). */
export function redfinListingIdFromUrl(url: string | null | undefined): string | null {
  return /\/home\/(\d+)/i.exec(String(url ?? ''))?.[1] ?? null;
}

/**
 * Scroll a Redfin board until it stops producing new cards.
 *
 * Redfin renders its results lazily: a board stating 45 sold parcels paints
 * about fifteen cards and only mounts the rest as the viewport travels. A fixed
 * four-scroll pass therefore read the first fifteen and treated the board as
 * exhausted, so verified sales inside the subject's own acreage range were
 * never extracted at all — they were on the page, below the fold, and the lane
 * had already stopped looking.
 *
 * Bounded: it stops as soon as a pass adds no cards, and never exceeds
 * `maxPasses`, so a very long board cannot run away with the lane.
 */
async function scrollBoardUntilSettled(
  page: { evaluate: <T>(fn: unknown) => Promise<T> },
  extract: unknown,
  sleepMs: number,
  sleepFn: (ms: number) => Promise<void>,
  maxPasses = 14,
): Promise<RawRedfinListing[]> {
  // ACCUMULATE WHILE SCROLLING, never once at the end.
  //
  // Redfin's results list is VIRTUALISED: it mounts roughly fifteen cards
  // around the viewport and unmounts the rest. Reading the DOM once after
  // scrolling therefore returns only the cards that happen to be mounted at
  // that moment, which is why a board stating 45 sold parcels yielded exactly
  // fifteen however far the page was scrolled — and why verified sales inside
  // the subject's own acreage range never became candidates.
  const byIdentity = new Map<string, RawRedfinListing>();
  const absorb = async (): Promise<void> => {
    try {
      const rows = await page.evaluate<RawRedfinListing[]>(extract as never);
      for (const row of rows ?? []) {
        const key = redfinCandidateIdentity(row as never);
        if (key && !byIdentity.has(key)) byIdentity.set(key, row);
      }
    } catch { /* a failed read simply contributes nothing to this pass */ }
  };

  await absorb();
  let stable = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const before = byIdentity.size;
    try { await page.evaluate('window.scrollBy(0,1400)'); } catch { /* ignore */ }
    await sleepFn(sleepMs);
    await absorb();
    // Two consecutive passes adding nothing means the board has finished
    // mounting whatever it intends to render.
    stable = byIdentity.size > before ? 0 : stable + 1;
    if (stable >= 2) break;
  }
  return [...byIdentity.values()];
}

export function redfinStatedHomeCount(pageText: string | null | undefined): number | null {
  // Redfin renders this glued to the heading ("...real estate45 homes"), so a
  // leading word boundary never matches. The count is a diagnostic for the
  // route note; pagination no longer depends on it being readable.
  const match = (pageText ?? '').slice(0, 20000).match(/(\d{1,4}(?:,\d{3})?)\s+homes?\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The nth page of a Redfin board: the filter URL followed by `/page-N`. */
export function redfinBoardPageUrl(boardUrl: string, pageNo: number): string {
  return `${boardUrl.replace(/\/page-\d+$/, '').replace(/\/$/, '')}/page-${pageNo}`;
}

/** Normalize raw listings into deduped candidate rows. Never fabricates.
 *  BUSINESS RULES: no price minimum or maximum, no acreage band, and an
 *  improved (residential) card is RETAINED and tagged rather than dropped —
 *  discovery collects the market evidence; classification decides Core /
 *  Directional / Excluded afterwards. */
export interface RedfinBoardLineage {
  /** True ONLY for a board whose geography was verified AND whose URL carries
   *  Redfin's own `include=sold-<window>` filter. A mixed or unverified board
   *  never confers sold status on a card that does not state it. */
  soldBoardVerified?: boolean;
  /** The exact board URL the inference came from, retained as lineage. */
  boardUrl?: string | null;
  /** The exact filter string that made it a sold-only board. */
  boardFilter?: string | null;
}

export function normalizeRedfinListings(
  raw: RawRedfinListing[],
  _subjectAcres: number | null,
  mode: 'sold' | 'active' = 'active',
  propertyType: 'land' | 'manufactured' = 'land',
  board: RedfinBoardLineage = {},
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
    // AN UNLABELLED CARD ON A SOLD-ONLY BOARD IS A SOLD RECORD.
    //
    // Redfin renders the "SOLD <date>" banner outside the leaf card element for
    // part of a board, so those cards reach here with no status text at all.
    // Requiring the card to state it is sold therefore discarded real closed
    // sales for a rendering detail: on one 45-home sold board it dropped 8 of
    // 33 extracted records, including a 2.50-acre sale inside the subject's own
    // acreage band. The board's own `include=sold-<window>` filter is what makes
    // these sold records, so an unlabelled card inherits it. A card that labels
    // itself as something else (for sale, pending, contingent, coming soon) is
    // still excluded, because that label contradicts the filter.
    // Inheritance is confined to a VERIFIED SOLD-ONLY board. On a mixed or
    // unverified board an unlabelled card says nothing about having closed, and
    // treating it as sold would invent a transaction.
    const statusFromBoardFilter = parsed === 'unknown' && mode === 'sold' && board.soldBoardVerified === true;
    const status: CompStatus = parsed !== 'unknown'
      ? parsed
      : mode === 'active' ? 'active' : statusFromBoardFilter ? 'sold' : 'unknown';
    const explicitSoldDate = mode === 'sold' && r.status
      ? (() => {
          const match = r.status.match(/\bsold(?:\s+on)?\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i);
          if (!match) return null;
          const parsedDate = Date.parse(match[1]);
          return Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString().slice(0, 10) : null;
        })()
      : null;
    // A sold-filter URL is a search request, not transaction evidence. It
    // establishes that the board returned the record, never when or whether it
    // closed: `soldDate` stays null unless the card printed one, so a
    // board-filter candidate still has to earn its date from the detail-page
    // transaction read before anything can admit it.
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
      // Lineage for an inherited status: the board and filter that established
      // it, so the inference is auditable rather than asserted.
      ...(statusFromBoardFilter
        ? { soldBoardUrl: board.boardUrl ?? null, soldBoardFilter: board.boardFilter ?? null }
        : {}),
      // (0, 0) is the null island, not a Florida parcel: a missing coordinate
      // that reads as a valid number is worse than no coordinate at all.
      ...(() => {
        const rawLat = typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : null;
        const rawLng = typeof r.lng === 'number' && Number.isFinite(r.lng) ? r.lng : null;
        const located = rawLat != null && rawLng != null && (rawLat !== 0 || rawLng !== 0);
        return { lat: located ? rawLat : null, lng: located ? rawLng : null };
      })(),
      statusFromBoardFilter,
      thumbnailUrl: r.thumbnailUrl ?? null,
      // A card on Redfin's manufactured board is a manufactured / mobile home
      // by the board's own filter, so it carries that label (the shared
      // classifier recognises it) rather than a generic "residential" one.
      homeType: propertyType === 'manufactured'
        ? 'Manufactured / mobile home (Redfin manufactured board)'
        : r.residential ? 'Residential (beds/baths listed)' : null,
    });
  }
  // A manufactured board is read in full: the five-mile screen, not board
  // order, decides which of its rows matter, and a 40-row cut dropped a
  // same-street sale that sat 41st. Land boards keep their accepted bound.
  return out.slice(0, propertyType === 'manufactured' ? REDFIN_MANUFACTURED_ROW_CAP : 40);
}

/** Rows kept from a manufactured board across its pages. */
export const REDFIN_MANUFACTURED_ROW_CAP = 150;

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
/**
 * A property address as a Redfin card prints it.
 *
 * VACANT LAND OFTEN HAS NO STREET NUMBER. This pattern used to require a
 * leading `\d+`, so cards reading "TBD SW 52nd Ter, Lake Butler, FL 32054" or
 * "SW 107th Ave, Lake Butler, FL 32054" were not recognised as cards at all —
 * the extractor discarded exactly the unnumbered land listings this lane
 * exists to find, and no amount of scrolling or paging could recover them.
 *
 * The discriminator is the `, City, ST ZIP` tail, which ordinary card copy does
 * not produce. The street part may be a number ("0 County Rd 241"), a lot
 * placeholder ("TBD SW 52nd Ter", "Lot 9 SW 39th Dr") or a bare street name
 * ("SW 107th Ave").
 */
/** Exported for tests. MUST stay identical to the literal inlined inside
 *  `EXTRACT_REDFIN`, which is serialised into the browser page and cannot
 *  reference anything from this module scope. */
export const REDFIN_CARD_ADDRESS_PATTERN = /([A-Za-z0-9][\w .#'-]*?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/;

/**
 * The same address with NO CITY: "Lot 7 SW 39th Dr, FL 32054", "71st Way, FL
 * 32054". Redfin prints this shape whenever it has not resolved the locality
 * (its own URL then reads `/FL/Unknown/...`), and it is common on exactly the
 * unplatted vacant land this lane exists to find — a $50,000 1.67-acre sale on
 * the same street as an already-selected comp was lost to it.
 *
 * A bare "Lake Butler, FL 32054" also fits `<something>, ST ZIP`, and admitting
 * that would invent a street address out of a city name, so this shape is only
 * accepted when the street part carries a house/lot number or a street-type
 * word. The city-bearing pattern above is always tried first.
 */
export const REDFIN_CARD_ADDRESS_NO_CITY_PATTERN = /((?=[\w .#'-]*?(?:\d|\b(?:Ave|St|Dr|Ln|Ter|Way|Rd|Ct|Path|Loop|Blvd|Pl|Trl|Cir|Hwy|Pkwy|Sr|Cr)\b))[A-Za-z0-9][\w .#'-]*?,\s*[A-Z]{2}\s*\d{5})/i;


/**
 * Reject an "address" whose street part is really card measurements.
 *
 * A city-only card prints "1,008 sq ftLake Butler, FL 32054", and the digit
 * guard above accepts "008 sq ft" as a street number. That manufactures a
 * street address out of a floor area, which every downstream identity,
 * distance and parcel check would then treat as a place. Measurement words
 * never appear in a street name, so their presence disqualifies the match.
 */
export function redfinAddressIsPlausible(address: string | null | undefined): boolean {
  const text = String(address ?? '').trim();
  if (!text) return false;
  // The WHOLE address is tested, not the part before the first comma: a floor
  // area carries its own thousands separator ("1,293 sq ftNW 9th Ave, ..."), so
  // splitting on a comma hides the very words this rejects. A city, state or
  // ZIP never contains them either, so testing the whole string is safe.
  return !/\b(?:sq|acres?|beds?|baths?|ba|bd)\b/i.test(text);
}
export const EXTRACT_REDFIN = (): RawRedfinListing[] => {
  const out: RawRedfinListing[] = [];
  const seen = new Set<string>();
  // Redfin nests card-like wrappers (the whole results column carries a
  // "HomecardsContainer" class) around the real cards. Reading a wrapper as a
  // card took the FIRST address inside it, then marked every real card for
  // that address as a duplicate: the board's first card was lost on every
  // read. Only LEAF matches (no matched descendant) are cards.
  const matched = Array.from((document as any).querySelectorAll('.HomeCardContainer,[class*="HomeCard" i],.bp-Homecard,[class*="MapHomeCard" i],[data-rf-test-id*="mapHomeCard" i],div[class*="homecard" i]')) as any[];
  const cardLike = matched.filter((el: any) => {
    const text = String(el.textContent ?? '');
    return /\$\d/.test(text) && (/([A-Za-z0-9][\w .#'-]*?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/.test(text)
      || /((?=[\w .#'-]*?(?:\d|\b(?:Ave|St|Dr|Ln|Ter|Way|Rd|Ct|Path|Loop|Blvd|Pl|Trl|Cir|Hwy|Pkwy|Sr|Cr)\b))[A-Za-z0-9][\w .#'-]*?,\s*[A-Z]{2}\s*\d{5})/i.test(text));
  });
  const cards = cardLike.filter((el: any) => !cardLike.some((other: any) => other !== el && el.contains(other)));
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
    const addrM = addrText.match(/([A-Za-z0-9][\w .#'-]*?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/) || txt.match(/([A-Za-z0-9][\w .#'-]*?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/)
      // Then the city-less shape Redfin prints for unresolved localities.
      || addrText.match(/((?=[\w .#'-]*?(?:\d|\b(?:Ave|St|Dr|Ln|Ter|Way|Rd|Ct|Path|Loop|Blvd|Pl|Trl|Cir|Hwy|Pkwy|Sr|Cr)\b))[A-Za-z0-9][\w .#'-]*?,\s*[A-Z]{2}\s*\d{5})/i)
      || txt.match(/((?=[\w .#'-]*?(?:\d|\b(?:Ave|St|Dr|Ln|Ter|Way|Rd|Ct|Path|Loop|Blvd|Pl|Trl|Cir|Hwy|Pkwy|Sr|Cr)\b))[A-Za-z0-9][\w .#'-]*?,\s*[A-Z]{2}\s*\d{5})/i);
    const rawAddress = addrM ? addrM[1].replace(/\s+/g, ' ').trim() : null;
    // Inlined copy of `redfinAddressIsPlausible` (this function is serialised
    // into the page and cannot reach module scope): a street part carrying
    // measurement words is card copy, not an address.
    const address = rawAddress && rawAddress.trim() && !/\b(?:sq|acres?|beds?|baths?|ba|bd)\b/i.test(rawAddress)
      ? rawAddress
      : null;
    // Residential ONLY when a POSITIVE bed/bath count is present (Redfin land cards
    // still render "— beds / — baths" placeholders, which must NOT flag as a home).
    const residential = /\b[1-9]\d*\s*(?:beds?|bd)\b/i.test(txt) || /\b[1-9]\d*\s*(?:baths?|ba)\b/i.test(txt);
    const link = ((c.querySelector('a[href*="/home/"],a[href]') || {}) as any).href || null;
    // THE CARD ALREADY CARRIES THE PARCEL POINT.
    //
    // Every Redfin card embeds a JSON-LD block with a `geo` object. Dropping it
    // here forced a second detail-page read per record to recover a location,
    // and records whose detail read produced no single point stayed unlocated
    // for good: they could not be distance-ranked and never reached the map.
    // Reading it costs nothing and it is the provider's own coordinate for the
    // record, not a geocode of its address text.
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const ld = c.querySelector('script[type="application/ld+json"]');
      const parsed = ld ? JSON.parse(String(ld.textContent ?? '')) : null;
      for (const entry of (Array.isArray(parsed) ? parsed : [parsed])) {
        const geo = entry && (entry as any).geo;
        const rawLat = Number(geo?.latitude);
        const rawLng = Number(geo?.longitude);
        if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && (rawLat !== 0 || rawLng !== 0)) {
          lat = rawLat; lng = rawLng; break;
        }
      }
    } catch { /* a card without usable JSON-LD simply has no point */ }
    const image: any = c.querySelector('img[src],img[data-src]');
    const thumbnailUrl = (image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || '').trim() || null;
    if (price && address && !seen.has(address)) {
      seen.add(address);
      out.push({ price, acres, sqftLot, address, residential, url: link, status: statusText, thumbnailUrl, lat, lng });
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
  // ACCUMULATE ACROSS ROUTES.
  //
  // Returning on the first route that produced ANY candidate meant a narrow
  // road or locality board could end the search while the county board — the
  // one that actually lists the market's sold land — was never opened. Real
  // qualifying sales sat on routes the lane had stopped short of. Candidates
  // are now gathered across routes and deduplicated by address, and the search
  // ends early only once the retained evidence is genuinely sufficient.
  const accumulated: RedfinLandComp[] = [];
  const seenAccumulated = new Set<string>();
  const collect = (rows: RedfinLandComp[]): number => {
    let added = 0;
    for (const row of rows) {
      const key = redfinCandidateIdentity(row);
      if (!key || seenAccumulated.has(key)) continue;
      seenAccumulated.add(key);
      accumulated.push(row);
      added += 1;
    }
    return added;
  };
  const routesUsed: string[] = [];
  /** True when a board still had fresh candidates when the page bound was hit. */
  let boardTruncated = false;
  /** The last route's page-by-page read, for the exhausted-routes note. */
  let paginationNote = '';
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
      const landUrl = redfinLandFilterUrl(resolvedPath, { sold, dateWindowMonths: input.dateWindowMonths, lotMinAcres: input.lotMinAcres, propertyType: input.propertyType });
      routeTried = landUrl;
      await page.goto(landUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      const scrolled = await scrollBoardUntilSettled(page as never, EXTRACT_REDFIN, scrollSettleMs, sleep);
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const rawList = scrolled;
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
      // Redfin renders one page of cards; a board that states more homes than
      // it rendered continues on /page-2, /page-3. Read the rest, bounded, so a
      // qualifying sale on the second page is not silently absent.
      let allRaw: RawRedfinListing[] = [...(rawList ?? [])];
      const statedTotal = redfinStatedHomeCount(pageGeo.text);
      let pagesRead = 1;
      // ALWAYS TRY THE NEXT BOARD PAGE.
      //
      // Pagination used to run only when the board's stated home count could be
      // parsed and exceeded what page 1 rendered. That count is read from a
      // truncated snapshot of the page, and Redfin renders it glued to the
      // preceding heading ("...real estate45 homes"), so it frequently could not
      // be read at all — and a board stating 45 sold parcels contributed only
      // the ~15 its first page happened to render. Verified sales inside the
      // subject's own acreage range sat on page 2 and never became candidates.
      //
      // The loop already stops the moment a page yields no fresh addresses, and
      // is bounded by REDFIN_MAX_BOARD_PAGES, so trying the next page is cheap
      // and cannot run away.
      {
        const seenAddress = new Set(allRaw.map((row) => (row.address ?? '').toLowerCase()));
        for (let pageNo = 2; pageNo <= REDFIN_MAX_BOARD_PAGES
          && (statedTotal == null || allRaw.length < statedTotal); pageNo++) {
          try {
            await page.goto(redfinBoardPageUrl(landUrl, pageNo), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
            await sleep(settleMs);
            const more = await scrollBoardUntilSettled(page as never, EXTRACT_REDFIN, scrollSettleMs, sleep);
            const fresh = (more ?? []).filter((row) => row.address && !seenAddress.has(row.address.toLowerCase()));
            if (!fresh.length) break;
            for (const row of fresh) seenAddress.add((row.address ?? '').toLowerCase());
            allRaw = [...allRaw, ...fresh];
            pagesRead += 1;
            // Fresh candidates were STILL arriving as the bound was reached, so
            // the board is deeper than this search read. That is a partial
            // result and must never be reported as a complete market read.
            if (pageNo === REDFIN_MAX_BOARD_PAGES) boardTruncated = true;
          } catch { break; }
        }
      }
      const extracted = allRaw.filter((row) => !!row.address && typeof row.price === 'number' && row.price > 0).length;
      // This board is sold-only only when its geography was verified above AND
      // its own URL carries Redfin's sold-window filter.
      const soldBoardVerified = sold && /include=sold-/i.test(landUrl);
      const comps = normalizeRedfinListings(
        allRaw, input.subjectAcres ?? null, sold ? 'sold' : 'active', input.propertyType ?? 'land',
        { soldBoardVerified, boardUrl: landUrl, boardFilter: filtersUsed },
      );
      const cardsFoundAllPages = allRaw.length;
      const pageNote = pagesRead > 1 ? ` across ${pagesRead} board page(s)${statedTotal != null ? ` of ${statedTotal} stated homes` : ''}` : '';
      // Kept for the exhausted-routes note below: a board read page by page is
      // still a paged read when the last route did not settle the answer.
      if (pageNote) paginationNote = pageNote;
      counts.visible = Math.max(counts.visible, cardsFoundAllPages);
      counts.extracted = Math.max(counts.extracted, extracted);
      routes.push({
        label: query.label, url: landUrl, reached: true, blocked, cardsFound: cardsFoundAllPages, marketVerified: true, qualifying: comps.length,
        outcome: comps.length
          ? `Opened ${landUrl}, verified it as this subject's market: ${cardsFoundAllPages} visible card(s)${pageNote} → ${extracted} extracted → ${comps.length} ${sold ? 'sold' : 'active'} candidate(s) retained (no price or acreage filter).`
          : `Opened ${landUrl} and verified it as this subject's market; it exposed ${cardsFoundAllPages} card(s)${pageNote} and none survived extraction/status screening as a ${sold ? 'sold' : 'active'} candidate.`,
      });
      if (!comps.length) continue;
      const added = collect(comps);
      routesUsed.push(`${query.label} (+${added})`);
      counts.normalized = Math.max(counts.normalized, accumulated.length);
      // Stop only when the accumulated set can actually price the subject.
      // Anything less and the next route may hold the sale that can.
      const qualifying = accumulated.filter((row) => row.status === 'sold' && row.price != null).length;
      const boardFiltered = accumulated.filter((row) => row.statusFromBoardFilter).length;
      // Say plainly how many candidates the board's filter carried rather than
      // the card's own banner, so the read is auditable.
      const inheritedNote = boardFiltered ? ` ${boardFiltered} card(s) printed no status banner and are sold by the board's own filter (no sale date inferred).` : '';
      if (!recentSoldEvidenceSufficient(sold ? qualifying : accumulated.length)) continue;
      return done({
        status: 'retrieved', comps: [...accumulated],
        note: `Redfin verified ${routesUsed.join('; ')}: ${accumulated.length} ${sold ? 'sold' : 'active'} candidate(s) retained across ${routesUsed.length} route(s)${pageNote}${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''} (no price or acreage filter).${inheritedNote}${boardTruncated ? ` PARTIAL: fresh candidates were still appearing when the ${REDFIN_MAX_BOARD_PAGES}-page bound was reached, so this board was not read to the end and the market read is incomplete.` : ''}`,
        routeTried: landUrl, filtersUsed,
      });
    }
    // Every route was tried. Anything gathered along the way is the answer.
    if (accumulated.length) {
      const boardFilteredAll = accumulated.filter((row) => row.statusFromBoardFilter).length;
      const inheritedNote = boardFilteredAll ? ` ${boardFilteredAll} card(s) printed no status banner and are sold by the board's own filter (no sale date inferred).` : '';
      return done({
        status: 'retrieved', comps: [...accumulated],
        note: `Redfin verified ${routesUsed.join('; ')}: ${accumulated.length} ${sold ? 'sold' : 'active'} candidate(s) retained across ${routesUsed.length} route(s)${paginationNote} after exhausting all ${queries.length} route(s)${failedGeographies.length ? ` after automatically correcting ${failedGeographies.length} wrong-geography route(s)` : ''} (no price or acreage filter).${inheritedNote}${boardTruncated ? ` PARTIAL: fresh candidates were still appearing when the ${REDFIN_MAX_BOARD_PAGES}-page bound was reached, so this board was not read to the end and the market read is incomplete.` : ''}`,
        routeTried, filtersUsed,
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
  /** The record's own published facts (Redfin's structured page data), used to
   *  recover what a search card omitted: coordinates, the last closed sale,
   *  beds/baths, the county parcel number. Null when the page did not state it. */
  record?: RedfinRecordFacts;
  note: string;
}

export interface RedfinRecordFacts {
  lat: number | null;
  lng: number | null;
  lastSoldPrice: number | null;
  lastSoldDate: string | null;
  beds: number | null;
  baths: number | null;
  apn: string | null;
  /** Home type as the page words it, e.g. "mobile/manufactured home". */
  homeTypeLabel: string | null;
  /** Lot size from the record's own `lotSize` (square feet), in acres. */
  lotAcres: number | null;
}

/** PURE. Redfin's page data carries the record's published facts in JSON
 *  (`"latitude":30.00…`, `\"lastSoldPrice\":290000,\"lastSoldDate\":<epoch ms>`,
 *  `\"apn\":\"00083A02900\"`, `"numberOfBedrooms":4`); the meta description
 *  words the home type ("mobile/manufactured home"). */
export function parseRedfinRecordFacts(html: string): RedfinRecordFacts {
  const num = (re: RegExp): number | null => {
    const value = html.match(re)?.[1];
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const epoch = num(/\\?"lastSoldDate\\?":\s*(\d{11,14})/);
  const lotSqft = num(/\\?"lotSize\\?":\s*(\d{3,9})/);
  return {
    lotAcres: lotSqft != null && lotSqft > 0 ? Math.round((lotSqft / 43_560) * 100) / 100 : null,
    lat: num(/"latitude":\s*(-?\d{1,3}\.\d+)/),
    lng: num(/"longitude":\s*(-?\d{1,3}\.\d+)/),
    lastSoldPrice: num(/\\?"lastSoldPrice\\?":\s*(\d{4,})/),
    lastSoldDate: epoch != null ? new Date(epoch).toISOString().slice(0, 10) : null,
    beds: num(/"numberOfBedrooms":\s*(\d{1,2})/),
    baths: num(/"numberOfBathroomsTotal":\s*(\d{1,2}(?:\.\d)?)/),
    apn: html.match(/\\?"apn\\?":\s*\\?"([A-Za-z0-9 .\-\/]{4,30})\\?"/)?.[1] ?? null,
    homeTypeLabel: html.match(/<meta[^>]+name="description"[^>]+content="[^"]*?\b(mobile\/manufactured home|manufactured home|mobile home|single family (?:residential|home)|vacant land|land)\b/i)?.[1]?.toLowerCase() ?? null,
  };
}

// Runs INSIDE the disposable context: pull the remarks block, key facts and
// the property-history table off a single Redfin listing page.
const EXTRACT_REDFIN_DETAIL = (): {
  remarks: string | null; bodyText: string;
  historyRows: string[];
  html?: string;
} => {
  const remarksEl: any = (document as any).querySelector(
    '#marketing-remarks-scroll, [data-rf-test-id="listingRemarks"], .remarks, [class*="marketingRemarks" i], [class*="ListingRemarks" i]');
  const remarks = remarksEl ? String(remarksEl.textContent || '').replace(/\s+/g, ' ').trim() : null;
  const historyRows = Array.from((document as any).querySelectorAll(
    '[class*="PropertyHistory" i] tr, [class*="property-history" i] tr, [class*="HistoryRow" i], [id*="property-history" i] tr'))
    .map((row: any) => String(row.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((text: string) => /\b(19|20)\d{2}\b/.test(text) && /sold|listed|price|pending|contingent|delisted/i.test(text))
    .slice(0, 12);
  // The page's own JSON facts live in the HTML, not the visible text. Only the
  // fragments the record-fact parser reads are kept, bounded.
  const html = String((document as any).documentElement?.outerHTML || '');
  const keep: string[] = [];
  for (const key of ['"latitude":', '"longitude":', 'lastSoldPrice', 'lastSoldDate', '\\"lotSize\\":', '"numberOfBedrooms":', '"numberOfBathroomsTotal":', '\\"apn\\":', 'name="description"']) {
    const at = html.indexOf(key);
    if (at >= 0) keep.push(html.slice(Math.max(0, at - 60), at + 400));
  }
  return { remarks, bodyText: String((document as any).body?.innerText || '').slice(0, 20000), historyRows, html: keep.join('\n') };
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
    const raw = await page.evaluate<{ remarks: string | null; bodyText: string; historyRows: string[]; html?: string }>(EXTRACT_REDFIN_DETAIL as unknown as () => { remarks: string | null; bodyText: string; historyRows: string[]; html?: string });
    if (blocked && !raw.remarks && !raw.historyRows.length) {
      return { status: 'blocked', url, ...empty, note: 'Redfin served an anti-bot page on the listing detail read.' };
    }
    const parsed = parseRedfinListingDetail(url, raw);
    const record = parseRedfinRecordFacts(raw.html ?? '');
    return { status: 'retrieved', ...parsed, record, note: `Redfin listing detail read: ${parsed.remarks ? 'remarks captured' : 'no remarks block'}, ${parsed.priorEvents.length} history row(s)${record.lat != null ? ', coordinates published' : ''}${record.lastSoldDate ? `, last sold ${record.lastSoldDate}` : ''}.` };
  } catch (e) {
    return { status: 'error', url, ...empty, note: `Redfin detail read error: ${(e as Error)?.message ?? 'unknown'}.` };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}
