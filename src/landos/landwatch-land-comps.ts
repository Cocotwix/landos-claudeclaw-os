// LandOS — LandWatch LARGE-ACREAGE FALLBACK comps via a disposable context.
//
// Mirrors redfin-land-comps.ts. LandWatch is NOT a mandatory source: it runs
// only for 30+ acre subjects whose primary sold evidence (LandPortal, Redfin,
// Zillow when available) remains materially thin, to strengthen sparse
// large-parcel evidence. It never touches the operator's authenticated
// LandPortal session; it opens a disposable, cookie-isolated context of the
// ONE owned automation browser.
//
// URL shape (verified live 2026-08-20 on the real site):
//   https://www.landwatch.com/{state-name}-land-for-sale/{county}-county/{acre-segment}/sold
// Acreage segments are LandWatch's fixed parcel-size buckets; there is NEVER a
// price segment — no minimum, no maximum, no caps. Discovery collects
// candidates; classification decides Core / Directional / Excluded afterward.
//
// Sold-status honesty: a LandWatch card states "Sold" but exposes no sold
// date. A card that does NOT state sold is never treated as a closed FMV comp;
// it may remain market context only. Card descriptions are LISTING-REPORTED
// evidence, never verified fact.

import { readSessionConfig } from './browser-session.js';
import { automationBrowserConfig, openDisposableContextHandle } from './automation-browser.js';
import { laneSearchVerified, type CompLaneRouteOutcome } from './comp-lane-accountability.js';

// The EXTRACT/IS_BLOCKED functions execute INSIDE the disposable context (not
// Node), so DOM globals are declared as `any` for the Node typechecker.
declare const document: any;
declare const window: any;

/** LandWatch runs only for subjects at or above this acreage. Deliberately
 *  lower than the older exploratory thresholds (40 in comp-retrieval.ts, 50 in
 *  duke-report-lanes.ts): those gates were never wired to a live source; this
 *  one is, and 30 acres is where the primary marketplaces reliably thin out. */
export const LANDWATCH_FALLBACK_MIN_ACRES = 20;

export interface LandWatchLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: 'sold' | 'active';
  url: string | null;
  source: 'LandWatch';
  /** LandWatch sold cards expose no sold date; always null today, kept for
   *  shape parity so a future date read slots in without a contract change. */
  soldDate: string | null;
  /**
   * Whether this row's SALE RECENCY is established.
   *
   * LandWatch search cards state "Sold" and a price but publish no sale date
   * and expose no sold-period filter, so a card that closed in 2013 is
   * indistinguishable at collection time from one that closed last month. A
   * card-stated "Sold" is therefore UNDATED FALLBACK CONTEXT: retained,
   * persisted and visible, but never a current fair-market-value candidate on
   * the strength of the word "Sold" alone. Transaction enrichment may
   * establish the date later, and only for candidates the valuation set
   * actually needs.
   */
  recencyState: 'unestablished' | 'established';
  /** False whenever the sale date is unestablished — never current-FMV evidence. */
  recencyQualified: boolean;
  /** Set when the card shows positive bed/bath counts — an improved sale kept
   *  as directional market evidence, never silently dropped. */
  improvedHint: boolean;
  /** LISTING-REPORTED card description (never verified fact). */
  remark: string | null;
  county: string | null;
}

export interface LandWatchCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: LandWatchLandComp[];
  note: string;
  routeTried: string;
  routes: CompLaneRouteOutcome[];
  searchVerified: boolean;
  retrievalCounts: { visible: number; extracted: number; normalized: number };
}

export interface LandWatchFetchInput {
  county?: string;
  state?: string;
  subjectAcres?: number | null;
  mode?: 'sold' | 'active';
}

export interface RawLandWatchListing {
  address: string | null;
  price: number | null;
  acres: number | null;
  soldLabel: boolean;
  residential: boolean;
  url: string | null;
  remark: string | null;
}

// ── Pure URL builders (unit-tested; no browser) ─────────────────────────────

const STATE_NAMES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
  CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia',
  HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi',
  MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new-hampshire',
  NJ: 'new-jersey', NM: 'new-mexico', NY: 'new-york', NC: 'north-carolina',
  ND: 'north-dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  RI: 'rhode-island', SC: 'south-carolina', SD: 'south-dakota', TN: 'tennessee',
  TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington',
  WV: 'west-virginia', WI: 'wisconsin', WY: 'wyoming',
};

export function landWatchStateSlug(state: string | null | undefined): string | null {
  const upper = (state ?? '').trim().toUpperCase();
  return STATE_NAMES[upper] ?? null;
}

const slugify = (value: string): string =>
  value.toLowerCase().replace(/\s+county$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** LandWatch's fixed parcel-size buckets (live filter hrefs, 2026-08-20). */
export const LANDWATCH_ACREAGE_SEGMENTS: ReadonlyArray<{ slug: string; min: number; max: number }> = [
  { slug: 'acres-under-10', min: 0, max: 10 },
  { slug: 'acres-11-50', min: 11, max: 50 },
  { slug: 'acres-51-100', min: 51, max: 100 },
  { slug: 'acres-101-200', min: 101, max: 200 },
  { slug: 'acres-201-500', min: 201, max: 500 },
  { slug: 'acres-501-1000', min: 501, max: 1000 },
  { slug: 'acres-over-1000', min: 1001, max: Number.POSITIVE_INFINITY },
];

/** The subject's own bucket plus the one below it: a large-acreage subject's
 *  relevant sold evidence usually spans both. Never a price segment. */
export function landWatchAcreageSegments(subjectAcres: number | null | undefined): string[] {
  if (subjectAcres == null || !Number.isFinite(subjectAcres) || subjectAcres <= 0) return [];
  const index = LANDWATCH_ACREAGE_SEGMENTS.findIndex((segment) => subjectAcres >= segment.min && subjectAcres <= segment.max);
  if (index < 0) return [];
  const segments = [LANDWATCH_ACREAGE_SEGMENTS[index].slug];
  if (index > 0) segments.push(LANDWATCH_ACREAGE_SEGMENTS[index - 1].slug);
  return segments;
}

/** County sold-search URL. There is deliberately no way to express a price
 *  filter here: the builder takes geography, one acreage bucket, and mode. */
export function landWatchSearchUrl(
  state: string,
  county: string,
  opts: { acreageSegment?: string | null; sold?: boolean } = {},
): string | null {
  const stateSlug = landWatchStateSlug(state);
  const countySlug = slugify(county ?? '');
  if (!stateSlug || !countySlug) return null;
  const parts = [`${stateSlug}-land-for-sale`, `${countySlug}-county`];
  if (opts.acreageSegment) parts.push(opts.acreageSegment);
  if (opts.sold) parts.push('sold');
  return `https://www.landwatch.com/${parts.join('/')}`;
}

/** Normalize raw cards into deduped candidates. BUSINESS RULES: no price
 *  minimum or maximum, no acreage screen, improved cards RETAINED and tagged.
 *  In sold mode a card must STATE it is sold to enter the sold set; a non-sold
 *  card is retained as an ACTIVE market-context row, never a closed FMV comp. */
export function normalizeLandWatchListings(raw: RawLandWatchListing[], county: string | null): LandWatchLandComp[] {
  const seen = new Set<string>();
  const out: LandWatchLandComp[] = [];
  for (const r of raw) {
    if (!r.address || r.price == null || r.price <= 0) continue;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    out.push({
      address: r.address.replace(/\s+/g, ' ').trim(),
      price: r.price,
      acres,
      pricePerAcre: acres ? Math.round(r.price / acres) : null,
      status: r.soldLabel ? 'sold' : 'active',
      url: r.url,
      source: 'LandWatch',
      soldDate: null,
      // No LandWatch search card carries a sale date, so no row leaves this
      // normalizer recency-qualified. A future date read sets these together.
      recencyState: 'unestablished',
      recencyQualified: false,
      improvedHint: !!r.residential,
      remark: r.remark ? r.remark.replace(/\s+/g, ' ').trim().slice(0, 600) : null,
      county,
    });
  }
  return out.slice(0, 40);
}

// ── Disposable-context browser capture (injectable) ─────────────────────────

export interface LandWatchPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
}
export interface LandWatchBrowserLike { newPage(): Promise<LandWatchPageLike>; close(): Promise<void> }

export interface LandWatchFetchDeps {
  connect?: (browserURL: string) => Promise<LandWatchBrowserLike | null>;
  timeoutMs?: number;
  settleMs?: number;
  scrollSettleMs?: number;
  force?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function defaultConnect(_browserURL: string): Promise<LandWatchBrowserLike | null> {
  try {
    return await openDisposableContextHandle('landwatch') as unknown as LandWatchBrowserLike;
  } catch {
    return null;
  }
}

const IS_BLOCKED = (): boolean =>
  /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access denied|request blocked|been blocked/i
    .test(`${(document as any).title ?? ''} ${((document as any).body?.innerText || '').slice(0, 4000)}`);

// Runs INSIDE the disposable context. Each result card wraps an /pid/ link and
// carries its own schema.org JSON-LD script (name = full address, description
// = listing remark); the visible text carries "Sold", price, acres, beds/baths.
const EXTRACT_LANDWATCH = (): RawLandWatchListing[] => {
  const out: RawLandWatchListing[] = [];
  const seen = new Set<string>();
  for (const a of Array.from((document as any).querySelectorAll('a[href*="/pid/"]')) as any[]) {
    const href = a.getAttribute('href') || '';
    if (!href || seen.has(href)) continue;
    let node: any = a.parentElement;
    let text = '';
    let ldName: string | null = null;
    let ldDescription: string | null = null;
    for (let i = 0; i < 8 && node; i++) {
      const clone = node.cloneNode(true);
      for (const s of Array.from(clone.querySelectorAll('script')) as any[]) s.remove();
      const t = ((clone.textContent as string) || '').replace(/\s+/g, ' ').trim();
      if (/\$[\d,]+/.test(t) && t.length > 30 && t.length < 900) {
        text = t;
        const ld: any = node.querySelector('script[type="application/ld+json"]');
        if (ld) {
          try {
            const parsed = JSON.parse(ld.textContent || '');
            ldName = typeof parsed?.name === 'string' ? parsed.name : null;
            ldDescription = typeof parsed?.description === 'string' ? parsed.description : null;
          } catch { /* card without parseable JSON-LD still extracts from text */ }
        }
        break;
      }
      node = node.parentElement;
    }
    if (!text) continue;
    seen.add(href);
    const pm = text.match(/\$(\d{1,3}(?:,\d{3})+|\d{1,6})/);
    const am = text.match(/(\d{1,4}(?:\.\d{1,3})?)\s*acres?\b/i);
    const address = ldName
      ?? text.match(/([0-9][\w#'. -]*, [\w'. -]+, [A-Z]{2},? \d{5})/)?.[1]
      ?? null;
    out.push({
      address,
      price: pm ? Number(pm[1].replace(/,/g, '')) : null,
      acres: am ? parseFloat(am[1]) : null,
      soldLabel: /^sold\b/i.test(text) || /\bsold\s*\$/i.test(text),
      residential: /\b[1-9]\d*\s*(?:beds?|bd)\b/i.test(text) || /\b[1-9]\d*\s*(?:baths?|ba)\b/i.test(text),
      url: href.startsWith('http') ? href : `https://www.landwatch.com${href}`,
      remark: ldDescription,
    });
  }
  return out;
};

const READ_PAGE_TEXT = (): { url: string; text: string } => ({
  url: String((window as any).location?.href ?? ''),
  text: `${(document as any).title ?? ''} ${((document as any).body?.innerText ?? '').slice(0, 5000)}`,
});

/**
 * Fetch LandWatch sold large-acreage comps for a county via a disposable
 * context. Best-effort: any failure/blocked/none is reported, never thrown.
 */
export async function fetchLandWatchLandComps(input: LandWatchFetchInput, deps: LandWatchFetchDeps = {}): Promise<LandWatchCompsResult> {
  const sold = (input.mode ?? 'sold') === 'sold';
  const county = (input.county ?? '').trim();
  const state = (input.state ?? '').trim();
  const routes: CompLaneRouteOutcome[] = [];
  const counts = { visible: 0, extracted: 0, normalized: 0 };
  const done = (result: Omit<LandWatchCompsResult, 'routes' | 'searchVerified' | 'retrievalCounts'>): LandWatchCompsResult =>
    ({ ...result, routes: [...routes], searchVerified: laneSearchVerified(routes), retrievalCounts: { ...counts } });
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return done({ status: 'disabled', comps: [], note: 'Live browser mode off — LandWatch not attempted.', routeTried: '' }); } catch { /* fall through */ }
  }
  const segments = landWatchAcreageSegments(input.subjectAcres);
  const routePlans = (segments.length ? segments : [null]).map((segment) => ({
    segment,
    url: landWatchSearchUrl(state, county, { acreageSegment: segment, sold }),
  })).filter((plan): plan is { segment: string | null; url: string } => !!plan.url);
  if (!routePlans.length) {
    return done({ status: 'disabled', comps: [], note: 'No county + state geography available for a LandWatch search.', routeTried: '' });
  }

  const connect = deps.connect ?? defaultConnect;
  const timeoutMs = deps.timeoutMs ?? 30000;
  const settleMs = deps.settleMs ?? 5000;
  const scrollSettleMs = deps.scrollSettleMs ?? 700;
  let routeTried = '';
  const all: RawLandWatchListing[] = [];
  let browser: LandWatchBrowserLike | null = null;
  try {
    browser = await connect(automationBrowserConfig().endpoint);
    if (!browser) return done({ status: 'error', comps: [], note: 'The LandOS automation browser is not available for LandWatch.', routeTried });
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }

    for (const plan of routePlans) {
      routeTried = plan.url;
      const label = `${county} County, ${state}${plan.segment ? ` (${plan.segment})` : ''}${sold ? ', sold' : ''}`;
      await page.goto(plan.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await sleep(settleMs);
      for (let i = 0; i < 3; i++) { try { await page.evaluate('window.scrollBy(0,1500)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
      const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
      const rawList = (await page.evaluate<RawLandWatchListing[]>(EXTRACT_LANDWATCH as unknown as () => RawLandWatchListing[]).catch(() => [])) ?? [];
      const cardsFound = rawList.length;
      if (blocked && cardsFound === 0) {
        routes.push({ label, url: plan.url, reached: true, blocked: true, cardsFound: 0, marketVerified: false, qualifying: 0, outcome: `LandWatch served an anti-bot page instead of the ${label} results.` });
        return done({ status: 'blocked', comps: [], note: `LandWatch served an anti-bot / blocked page on the ${label} route.`, routeTried: plan.url });
      }
      const pageInfo = (await page.evaluate<{ url: string; text: string }>(READ_PAGE_TEXT as unknown as () => { url: string; text: string }).catch(() => null)) ?? { url: plan.url, text: '' };
      const countyToken = county.toLowerCase().replace(/\s+county$/i, '');
      const marketVerified = countyToken.length > 0
        && pageInfo.text.toLowerCase().includes(countyToken)
        && (!state || new RegExp(`\\b${state}\\b`, 'i').test(pageInfo.text));
      const extracted = rawList.filter((row) => !!row.address && typeof row.price === 'number' && row.price > 0).length;
      counts.visible += cardsFound;
      counts.extracted += extracted;
      routes.push({
        label, url: plan.url, reached: true, blocked, cardsFound, marketVerified, qualifying: extracted,
        outcome: marketVerified
          ? `Opened ${plan.url}, verified it as ${county} County, ${state}: ${cardsFound} visible card(s) → ${extracted} extracted (no price filter of any kind).`
          : `Opened ${plan.url} and read ${cardsFound} card(s), but the page does not name ${county} County, ${state}, so nothing from it was used.`,
      });
      if (marketVerified) all.push(...rawList);
    }

    const comps = normalizeLandWatchListings(all, county || null);
    counts.normalized = comps.length;
    const verified = laneSearchVerified(routes);
    if (!verified) {
      return done({ status: 'none', comps: [], note: `LandWatch never reached a verified ${county} County, ${state} results page; no conclusion about the market's inventory is supported.`, routeTried });
    }
    const soldCount = comps.filter((row) => row.status === 'sold').length;
    if (!comps.length) {
      return done({ status: 'none', comps: [], note: `LandWatch verified ${county} County, ${state} and published no candidates on the searched parcel-size buckets (no price filter was applied).`, routeTried });
    }
    return done({
      status: 'retrieved', comps,
      note: `LandWatch verified ${county} County, ${state}: ${counts.visible} visible card(s) → ${counts.extracted} extracted → ${comps.length} candidate(s). ${soldCount} card-stated sold — sold status is LISTING-REPORTED, and every one is retained as UNDATED SOLD — FALLBACK CONTEXT, NOT YET RECENCY-QUALIFIED: LandWatch publishes no sale date and exposes no sold-period filter, so none of them is current fair-market-value evidence on the word "Sold" alone.`,
      routeTried,
    });
  } catch (e) {
    return done({ status: 'error', comps: [], note: `LandWatch capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried });
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}
