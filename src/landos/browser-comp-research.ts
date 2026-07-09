// Read-only browser-based comp research for Zillow + Redfin.
//
// This is the acquisitions-assistant fallback: when configured actor/API comp
// providers (Realie, Apify Redfin/Zillow) fail or return nothing, LandOS drives a
// read-only browser session over Zillow and Redfin exactly like a human would —
// search vacant land in the subject area, prefer sold then active, prefer the
// subject acreage band, then honestly EXPAND acreage and geography when results
// are thin. It never fabricates comps, never logs in, never purchases, and never
// triggers the paid LandPortal comp report. When extraction is imperfect it still
// captures a screenshot + visible result count + URLs and reports the exact
// blocker (blocked_by_site / captcha_or_login / no_results / selector_changed /
// search_unsupported / not_implemented / not_configured / error).
//
// The search-strategy logic (bands, expansion ladder, URL builders, extraction,
// strength, summary) is pure and unit-tested offline; the live browser is an
// injected driver so the suite stays deterministic.

import type { BrowserDriver } from './browser-intelligence.js';
import { crowFliesMiles } from './comp-search-params.js';

// ── Acreage bands (subject-relative comp banding) ────────────────────────────
export interface AcreageBand { id: string; label: string; min: number; max: number }
export const ACREAGE_BANDS: readonly AcreageBand[] = [
  { id: 'under_0_5', label: 'under 0.5 ac', min: 0, max: 0.5 },
  { id: '0_5_to_1', label: '0.5 to 1 ac', min: 0.5, max: 1 },
  { id: '1_to_2', label: '1 to 2 ac', min: 1, max: 2 },
  { id: '2_to_5', label: '2 to 5 ac', min: 2, max: 5 },
  { id: '5_to_10', label: '5 to 10 ac', min: 5, max: 10 },
  { id: '10_to_20', label: '10 to 20 ac', min: 10, max: 20 },
  { id: '20_to_50', label: '20 to 50 ac', min: 20, max: 50 },
  { id: '50_plus', label: '50+ ac', min: 50, max: Infinity },
];
export function acreageBandOf(acres: number | null | undefined): AcreageBand | null {
  if (acres == null || !Number.isFinite(acres) || acres < 0) return null;
  return ACREAGE_BANDS.find((b) => acres >= b.min && acres < b.max) ?? ACREAGE_BANDS[ACREAGE_BANDS.length - 1];
}
const AC_TO_SQFT = 43560;

export interface CompResearchQuery {
  address?: string; lat?: number; lng?: number;
  city?: string; state?: string; zip?: string; county?: string;
  acres?: number | null;
}

export type CompSource = 'zillow' | 'redfin';
export type CompStatus = 'sold' | 'active' | 'pending' | 'manual' | 'unknown';
export type SourceOutcome =
  | 'collected' | 'partial' | 'no_results'
  | 'blocked_by_site' | 'captcha_or_login' | 'search_unsupported'
  | 'selector_changed' | 'not_implemented' | 'not_configured' | 'error';

export interface ResearchedComp {
  source: CompSource;
  location: string | null;
  status: CompStatus;
  price: number | null;
  dateIso: string | null;
  acres: number | null;
  pricePerAcre: number | null;
  distanceMiles: number | null;
  url: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

export interface SourceAttempt {
  source: CompSource;
  geoLevel: 'zip' | 'city' | 'county' | 'state';
  acreageScope: 'band' | 'all';
  url: string | null;
  outcome: SourceOutcome;
  visibleResultCount: number | null;
  screenshotPath: string | null;
  compCount: number;
  note: string;
  /** The comps parsed from this specific attempt (also merged into result.comps). */
  comps?: ResearchedComp[];
}

export interface CompResearchResult {
  attempts: SourceAttempt[];
  searchPath: string[];
  acreageBand: string | null;
  acreageExpanded: boolean;
  geographyExpanded: boolean;
  filtersUsed: string[];
  comps: ResearchedComp[];
  strength: 'strong' | 'thin' | 'unavailable';
  summary: string;
}

// ── Geography ladder (priority: full address → coords are for distance only;
//    locality URLs use zip → city/state → county/state → state) ───────────────
type GeoStep = { level: SourceAttempt['geoLevel']; slug: string; label: string };
export function geographyLadder(q: CompResearchQuery): GeoStep[] {
  const steps: GeoStep[] = [];
  const zip = (q.zip ?? '').match(/\d{5}/)?.[0];
  const state = (q.state ?? '').trim();
  const city = (q.city ?? '').trim();
  const county = (q.county ?? '').trim();
  if (zip) steps.push({ level: 'zip', slug: zip, label: `ZIP ${zip}` });
  if (city && state) steps.push({ level: 'city', slug: `${city}, ${state}`, label: `${city}, ${state}` });
  if (county && state) steps.push({ level: 'county', slug: `${county} County, ${state}`, label: `${county} County, ${state}` });
  if (state && steps.length === 0) steps.push({ level: 'state', slug: state, label: state });
  return steps;
}

// ── URL builders (real, plausible read-only search URLs) ─────────────────────
const slugCity = (s: string) => s.trim().replace(/\s+/g, '-');
/** Zillow vacant-land search. `sold` toggles the sold view. Acreage band lot-size
 *  bounds (sqft) are passed via searchQueryState so the site applies the filter. */
export function buildZillowLandUrl(step: GeoStep, opts: { sold: boolean; band: AcreageBand | null }): string {
  const region = step.level === 'zip' ? step.slug
    : step.level === 'city' ? `${slugCity((step.slug.split(',')[0] || '').trim())}-${(step.slug.split(',')[1] || '').trim().toLowerCase()}`
    : step.level === 'county' ? `${slugCity(step.slug.replace(/,\s*/g, '-'))}`
    : slugCity(step.slug);
  const filterState: Record<string, unknown> = {
    sort: { value: opts.sold ? 'globalrelevanceex' : 'days' },
    // Vacant land only: enable Lots/Land, disable house/condo/etc.
    land: { value: true }, house: { value: false }, condo: { value: false },
    townhouse: { value: false }, apartment: { value: false }, manufactured: { value: false },
    ...(opts.sold ? { rs: { value: true }, fsba: { value: false }, fsbo: { value: false }, nc: { value: false }, cmsn: { value: false }, auc: { value: false }, fore: { value: false } } : {}),
  };
  if (opts.band && Number.isFinite(opts.band.max)) {
    filterState.lotSize = { min: Math.round(opts.band.min * AC_TO_SQFT), max: Math.round(opts.band.max * AC_TO_SQFT) };
  } else if (opts.band) {
    filterState.lotSize = { min: Math.round(opts.band.min * AC_TO_SQFT) };
  }
  const sqs = encodeURIComponent(JSON.stringify({ filterState, isListVisible: true }));
  const base = opts.sold
    ? `https://www.zillow.com/${region}/sold/`
    : `https://www.zillow.com/${region}/land/`;
  return `${base}?searchQueryState=${sqs}`;
}
/** Redfin vacant-land search via filter path segments (property-type=land,
 *  include=sold-3yr, min/max-lot-size in sqft). */
export function buildRedfinLandUrl(step: GeoStep, opts: { sold: boolean; band: AcreageBand | null }): string {
  const base = step.level === 'zip'
    ? `https://www.redfin.com/zipcode/${step.slug}`
    : step.level === 'city'
      ? `https://www.redfin.com/city/${encodeURIComponent((step.slug.split(',')[1] || '').trim().toUpperCase())}/${encodeURIComponent(slugCity((step.slug.split(',')[0] || '').trim()))}`
      : step.level === 'county'
        ? `https://www.redfin.com/county/${encodeURIComponent(step.slug.replace(/\s+/g, '-'))}`
        : `https://www.redfin.com/state/${encodeURIComponent(step.slug.toUpperCase())}`;
  const filters: string[] = ['property-type=land'];
  if (opts.sold) filters.push('include=sold-3yr');
  if (opts.band) {
    filters.push(`min-lot-size=${Math.round(opts.band.min * AC_TO_SQFT)}-sqft`);
    if (Number.isFinite(opts.band.max)) filters.push(`max-lot-size=${Math.round(opts.band.max * AC_TO_SQFT)}-sqft`);
  }
  return `${base}/filter/${filters.join(',')}`;
}

// ── Best-effort extraction from a read-only page read ────────────────────────
const priceRe = /\$\s?([\d,]{4,})/;
const acreRe = /([\d,.]+)\s*(?:acres?|ac\b)/i;
const sqftLotRe = /([\d,]+)\s*sq\s?ft\s*lot/i;
const statusSoldRe = /\bsold\b/i;
const statusPendingRe = /\bpending\b|\bcontingent\b/i;
const blockRe = /(are you a human|press\s*&\s*hold|captcha|verify you are|unusual traffic|access to this page has been denied|please verify)/i;
const loginRe = /(sign in to see|log in to view|create an account to see)/i;

function num(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Parse visible comp rows from a page read. Best-effort: any line carrying a
 *  price is a candidate; acreage/status parsed when visible. Never fabricates. */
export function parseCompsFromRead(
  source: CompSource,
  read: { url?: string; fields?: Record<string, string>; snippets?: string[] },
  ctx: { status: CompStatus; subject?: { lat?: number; lng?: number } },
): { comps: ResearchedComp[]; visibleResultCount: number | null; blocked: SourceOutcome | null } {
  const lines = [...(read.snippets ?? []), ...Object.values(read.fields ?? {})].map((x) => String(x)).filter(Boolean);
  const joined = lines.join(' \n ');
  if (blockRe.test(joined)) return { comps: [], visibleResultCount: null, blocked: 'blocked_by_site' };
  if (loginRe.test(joined)) return { comps: [], visibleResultCount: null, blocked: 'captcha_or_login' };

  // Visible result count ("42 results", "12 homes", "8 of 8 Homes for sale").
  let visibleResultCount: number | null = null;
  for (const l of lines) {
    const m = l.match(/(\d[\d,]*)\s+(?:results?|homes?|listings?|properties)/i);
    if (m) { visibleResultCount = num(m[1]); break; }
  }

  const comps: ResearchedComp[] = [];
  for (const line of lines) {
    const pm = line.match(priceRe);
    if (!pm) continue;
    const price = num(pm[1]);
    if (price == null || price < 1000) continue; // ignore $/mo, tiny tokens
    const am = line.match(acreRe);
    let acres = am ? num(am[1]) : null;
    if (acres == null) { const sm = line.match(sqftLotRe); if (sm) { const sq = num(sm[1]); if (sq) acres = Math.round((sq / AC_TO_SQFT) * 100) / 100; } }
    const status: CompStatus = statusSoldRe.test(line) ? 'sold' : statusPendingRe.test(line) ? 'pending' : ctx.status;
    const ppa = price != null && acres && acres > 0 ? Math.round(price / acres) : null;
    comps.push({
      source,
      location: (line.match(/\b(\d+[^$,]{3,40}(?:Rd|St|Ave|Ln|Dr|Way|Hwy|Trail|Lot|Tract|Blvd|Ct|Pkwy)\b[^$]{0,30})/i)?.[1] ?? null)?.trim() ?? null,
      status,
      price,
      dateIso: null,
      acres: acres ?? null,
      pricePerAcre: ppa,
      distanceMiles: null,
      url: read.url ?? null,
      confidence: acres && price ? 'medium' : 'low',
      notes: acres ? '' : 'acreage not visible in list row',
    });
  }
  // If nothing parsed but no explicit block, it's either no_results or a changed
  // selector — the caller disambiguates using visibleResultCount / page emptiness.
  return { comps, visibleResultCount, blocked: null };
}

// ── The researcher ───────────────────────────────────────────────────────────
export interface CompResearchDeps {
  driver?: BrowserDriver;
  timeoutMs?: number;
  /** Minimum comps before we stop expanding (default 5). */
  targetCount?: number;
  /** Capture a screenshot on partial/blocked extraction (default true). */
  captureScreenshots?: boolean;
}

export async function researchBrowserComps(q: CompResearchQuery, deps: CompResearchDeps = {}): Promise<CompResearchResult> {
  const timeoutMs = deps.timeoutMs ?? 30000;
  const target = deps.targetCount ?? 5;
  const band = acreageBandOf(q.acres ?? null);
  const geo = geographyLadder(q);
  const filtersUsed = ['home type = vacant land / lots', 'sold first, then active', band ? `acreage band = ${band.label}` : 'no subject acreage → all lot sizes'];
  const searchPath: string[] = [];
  const attempts: SourceAttempt[] = [];
  const allComps: ResearchedComp[] = [];
  let acreageExpanded = false;
  let geographyExpanded = false;
  const subject = typeof q.lat === 'number' && typeof q.lng === 'number' ? { lat: q.lat, lng: q.lng } : undefined;

  const driver = deps.driver;
  const driverReady = !!driver && driver.configured();

  if (geo.length === 0) {
    return {
      attempts: [], searchPath: ['No usable location (address/coords/city/state/ZIP/county) to search.'],
      acreageBand: band?.label ?? null, acreageExpanded: false, geographyExpanded: false, filtersUsed,
      comps: [], strength: 'unavailable',
      summary: 'No comp search run — the subject has no address, ZIP, city/state, or county to search Zillow or Redfin.',
    };
  }

  // For each source: walk geography; at each geo try band then (if thin) all
  // acreage; prefer sold then active. Stop a source once target met.
  for (const source of ['zillow', 'redfin'] as CompSource[]) {
    let sourceComps = 0;
    outer:
    for (let gi = 0; gi < geo.length; gi++) {
      const step = geo[gi];
      if (gi > 0) geographyExpanded = true;
      const acreageScopes: Array<'band' | 'all'> = band ? ['band', 'all'] : ['all'];
      for (const scope of acreageScopes) {
        if (scope === 'all' && band) acreageExpanded = true;
        for (const sold of [true, false]) {
          const bandArg = scope === 'band' ? band : null;
          const url = source === 'zillow' ? buildZillowLandUrl(step, { sold, band: bandArg }) : buildRedfinLandUrl(step, { sold, band: bandArg });
          const label = `${source} · ${step.label} · ${scope === 'band' ? (band?.label ?? 'all') : 'all acreage'} · ${sold ? 'sold' : 'active'}`;
          searchPath.push(label);
          const attempt = await runOneSearch(source, step, scope, url, sold ? 'sold' : 'active', { driver, driverReady, timeoutMs, captureScreenshots: deps.captureScreenshots !== false, subject });
          attempts.push(attempt);
          for (const c of attempt.comps ?? []) {
            if (subject && c.distanceMiles == null && typeof (c as { lat?: number }).lat === 'number') {
              c.distanceMiles = Math.round(crowFliesMiles(subject, { lat: (c as { lat?: number }).lat as number, lng: (c as { lng?: number }).lng as number }) * 10) / 10;
            }
            allComps.push(c);
          }
          sourceComps += attempt.compCount;
        }
        if (sourceComps >= target) break outer; // enough in this band; stop expanding this source
      }
    }
  }

  const dedup = dedupeComps(allComps);
  const strength: CompResearchResult['strength'] = dedup.length >= target ? 'strong' : dedup.length > 0 ? 'thin' : 'unavailable';
  return {
    attempts, searchPath,
    acreageBand: band?.label ?? null, acreageExpanded, geographyExpanded, filtersUsed,
    comps: dedup, strength,
    summary: buildSummary({ attempts, comps: dedup, band, geo, acreageExpanded, geographyExpanded, driverReady }),
  };
}

// Store comp view keeps lat/lng loosely for distance; declared here to type the
// optional geo fields used above without widening ResearchedComp's public shape.
async function runOneSearch(
  source: CompSource, step: GeoStep, scope: 'band' | 'all', url: string, status: CompStatus,
  ctx: { driver?: BrowserDriver; driverReady: boolean; timeoutMs: number; captureScreenshots: boolean; subject?: { lat?: number; lng?: number } },
): Promise<SourceAttempt> {
  const base: SourceAttempt = { source, geoLevel: step.level, acreageScope: scope, url, outcome: 'not_configured', visibleResultCount: null, screenshotPath: null, compCount: 0, note: '' };
  if (!ctx.driverReady || !ctx.driver) {
    return { ...base, outcome: 'not_configured', note: 'No live browser session available (read-only browser research not wired/enabled in this run).', comps: [] } as SourceAttempt & { comps: ResearchedComp[] };
  }
  try {
    const read = await ctx.driver.open(url, { timeoutMs: ctx.timeoutMs });
    const parsed = parseCompsFromRead(source, read, { status, subject: ctx.subject });
    let screenshotPath: string | null = null;
    const partialOrBlocked = parsed.blocked != null || parsed.comps.length === 0;
    if (ctx.captureScreenshots && partialOrBlocked && ctx.driver.screenshot) {
      try { const shot = await ctx.driver.screenshot(`${source}-comps-${step.level}`, { timeoutMs: ctx.timeoutMs, fullPage: true }); screenshotPath = (shot as { path?: string; storedPath?: string }).path ?? (shot as { storedPath?: string }).storedPath ?? null; } catch { /* screenshot best-effort */ }
    }
    let outcome: SourceOutcome;
    if (parsed.blocked) outcome = parsed.blocked;
    else if (parsed.comps.length > 0) outcome = parsed.comps.every((c) => c.acres != null) ? 'collected' : 'partial';
    else if (parsed.visibleResultCount === 0) outcome = 'no_results';
    else if ((read.snippets ?? []).length === 0 && Object.keys(read.fields ?? {}).length === 0) outcome = 'selector_changed';
    else outcome = 'no_results';
    const note = outcome === 'collected' ? `${parsed.comps.length} comp(s) extracted.`
      : outcome === 'partial' ? `${parsed.comps.length} comp(s) extracted; some rows missing acreage (structured extraction partial).`
      : outcome === 'no_results' ? 'Search ran but no vacant-land results were visible on the page.'
      : outcome === 'blocked_by_site' ? 'Site blocked automation (bot wall / access denied).'
      : outcome === 'captcha_or_login' ? 'Site required captcha or login to view results.'
      : outcome === 'selector_changed' ? 'Page returned no readable rows/fields (layout/selector likely changed).'
      : 'Search attempted.';
    return { ...base, outcome, visibleResultCount: parsed.visibleResultCount, screenshotPath, compCount: parsed.comps.length, note, comps: parsed.comps } as SourceAttempt & { comps: ResearchedComp[] };
  } catch (e) {
    return { ...base, outcome: 'error', note: `Browser error: ${String((e as Error)?.message ?? e).slice(0, 140)}`, comps: [] } as SourceAttempt & { comps: ResearchedComp[] };
  }
}

function dedupeComps(comps: ResearchedComp[]): ResearchedComp[] {
  const seen = new Set<string>();
  const out: ResearchedComp[] = [];
  for (const c of comps) {
    const key = `${c.source}|${c.price ?? ''}|${c.acres ?? ''}|${c.location ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(c);
  }
  return out;
}

function buildSummary(x: { attempts: SourceAttempt[]; comps: ResearchedComp[]; band: AcreageBand | null; geo: GeoStep[]; acreageExpanded: boolean; geographyExpanded: boolean; driverReady: boolean }): string {
  const z = x.attempts.filter((a) => a.source === 'zillow');
  const r = x.attempts.filter((a) => a.source === 'redfin');
  const zc = x.comps.filter((c) => c.source === 'zillow').length;
  const rc = x.comps.filter((c) => c.source === 'redfin').length;
  if (x.comps.length > 0) {
    return `Found ${x.comps.length} browser-researched vacant-land comp(s) (Zillow ${zc}, Redfin ${rc})${x.acreageExpanded ? ', after expanding acreage' : ''}${x.geographyExpanded ? ', after expanding geography' : ''}. Browser-extracted and unverified — confirm before pricing.`;
  }
  const where = x.geo.map((g) => g.label).join(' → ') || 'the subject area';
  const bandTxt = x.band ? `vacant land in the ${x.band.label} band` : 'vacant land';
  const zOut = z[0]?.outcome ?? 'not_run';
  const rOut = r[0]?.outcome ?? 'not_run';
  if (!x.driverReady) {
    return `No comps found: browser research for ${bandTxt} across ${where} did not run because no live browser session was available (Zillow ${zOut}, Redfin ${rOut}). Configured API/actor providers and manual comps still apply.`;
  }
  return `No usable comps found after searching Zillow and Redfin for ${bandTxt} across ${where}, expanding acreage${x.geographyExpanded ? ' and geography' : ''} (Zillow: ${zOut}, Redfin: ${rOut}). Not fabricated.`;
}
