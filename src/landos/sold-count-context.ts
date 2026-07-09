// Duke sold-count market context.
//
// This module is deliberately separate from parcel verification. It produces a
// report-ready sold-count context for a verified local area, plus a gated free
// browser automation adapter contract and free/public fallback slots. It never
// verifies a parcel, never invents counts, never uses paid APIs, and makes no
// live network call unless the caller explicitly runs the browser adapter.

import type { OfficialSourcesCard } from './official-sources.js';

export type SoldCountStatus =
  | 'browser_assisted_available'
  | 'manual_capture_ready'
  | 'free_browser_automation_available'
  | 'automation_blocked_needs_package_approval'
  | 'automation_blocked_by_site_protection'
  | 'data_gap';

export type SoldCountBrowserAutomationStatus =
  | 'free_browser_automation_available'
  | 'automation_blocked_needs_package_approval'
  | 'automation_blocked_by_site_protection';

export type SoldCountProvider = 'Redfin' | 'Zillow' | 'Realtor';

export interface SoldSearchLink {
  provider: SoldCountProvider;
  sourceName: string;
  url: string;
  searchArea: string;
  acreageBand: string;
  lookbackStart: string;
  lookbackEnd: string;
  lookbackLabel: string;
  note: string;
}

export interface SoldCountFallbackSlot {
  id: string;
  label: string;
  status: 'source_available' | 'data_gap' | 'manual_source_needed' | 'approval_needed_for_adapter' | 'blocked';
  sourceName?: string;
  sourceUrl?: string;
  note: string;
  approvalNeeded?: string;
}

export interface SoldCountCaptureDraft {
  redfinCount: string;
  zillowCount: string;
  notes: string;
  capturedAt: string;
}

export interface SoldCountContext {
  status: SoldCountStatus;
  label: 'Local Area Context, Not Parcel Verification';
  parcelVerified: boolean;
  city?: string;
  county?: string;
  state?: string;
  searchArea: string;
  acreage: number | null;
  acreageBand: string;
  acreageOverrideActive: boolean;
  lookbackStart: string;
  lookbackEnd: string;
  lookbackLabel: 'Rolling 12 months from run date';
  runtimeDate: string;
  browserAutomationStatus: SoldCountBrowserAutomationStatus;
  browserAutomationNote: string;
  freeBrowserAutomationAvailable: boolean;
  links: SoldSearchLink[];
  openDataFallbacks: SoldCountFallbackSlot[];
  captureDraft: SoldCountCaptureDraft;
  reportReadySummary: string;
  note: string;
}

export interface SoldCountBrowserCaptureResult {
  status:
    | 'captured'
    | 'manual_capture_required'
    | 'automation_blocked_by_site_protection'
    | 'automation_blocked_needs_package_approval';
  provider: SoldCountProvider;
  sourceUrl: string;
  searchArea: string;
  acreageBand: string;
  lookbackStart: string;
  lookbackEnd: string;
  lookbackLabel: 'Rolling 12 months from run date';
  capturedAt: string;
  count: number | null;
  note: string;
}

export interface SoldCountBrowserAdapterDeps {
  browserLauncher?: () => Promise<SoldCountBrowserHandle>;
  now?: Date | string;
}

export interface SoldCountBrowserHandle {
  newPage(): Promise<SoldCountBrowserPageHandle>;
  close(): Promise<void>;
}

export interface SoldCountBrowserPageHandle {
  goto(url: string, opts?: unknown): Promise<unknown>;
  evaluate(fn: () => unknown): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface BuildSoldCountContextInput {
  city?: string;
  county?: string;
  state?: string;
  parcelVerified: boolean;
  acres?: number | null;
  officialSources?: OfficialSourcesCard;
  now?: Date | string;
  browserAutomationAvailable?: boolean;
}

const LOOKBACK_LABEL = 'Rolling 12 months from run date' as const;

function toDate(input?: Date | string): Date {
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === 'string' && input.trim()) return new Date(input);
  return new Date();
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function rollingTwelveMonthWindow(now?: Date | string): { start: string; end: string; label: typeof LOOKBACK_LABEL; runtimeDate: string } {
  const endDate = toDate(now);
  const startDate = new Date(endDate.getTime());
  startDate.setFullYear(startDate.getFullYear() - 1);
  return {
    start: toIsoDate(startDate),
    end: toIsoDate(endDate),
    label: LOOKBACK_LABEL,
    runtimeDate: endDate.toISOString(),
  };
}

export function acreageBand(acres?: number | null): string {
  if (!Number.isFinite(acres ?? NaN) || !acres || (acres as number) <= 0) return 'unknown acreage band';
  const a = acres as number;
  if (a < 1) return '0-1 ac';
  if (a < 5) return '1-5 ac';
  if (a < 10) return '5-10 ac';
  if (a < 20) return '10-20 ac';
  if (a < 50) return '20-50 ac';
  return '50+ ac';
}

function areaDescriptor(city?: string, county?: string, state?: string): string {
  const parts: string[] = [];
  if (county) parts.push(`${county} County`);
  else if (city) parts.push(city);
  if (state) parts.push(state);
  return parts.join(', ') || 'unknown area';
}

function searchQuery(area: string, band: string, window: { start: string; end: string; label: typeof LOOKBACK_LABEL }): string {
  return `${area} sold land ${band} ${window.label.toLowerCase()} ${window.start} to ${window.end}`;
}

function redfinSearchUrl(query: string): string {
  return `https://www.redfin.com/search?q=${encodeURIComponent(query)}`;
}

function zillowSearchUrl(query: string): string {
  return `https://www.zillow.com/homes/${encodeURIComponent(query.replace(/\s+/g, '-'))}_rb/`;
}

function realtorSearchUrl(query: string): string {
  return `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(query)}`;
}

function browserAutomationStatusFromAvailability(available: boolean): SoldCountBrowserAutomationStatus {
  return available ? 'free_browser_automation_available' : 'automation_blocked_needs_package_approval';
}

function summarizeBrowserAutomation(status: SoldCountBrowserAutomationStatus): string {
  switch (status) {
    case 'free_browser_automation_available':
      return 'Existing local browser tooling can assist with visible sold-count capture. No paid API or RapidAPI is used.';
    case 'automation_blocked_needs_package_approval':
      return 'Free browser automation is a contract only until Tyler approves package/tooling changes. Manual capture remains ready.';
    case 'automation_blocked_by_site_protection':
      return 'Site protection blocked automated extraction. Manual capture remains ready.';
  }
}

function inferFallbacks(input: BuildSoldCountContextInput, descriptor: string, officialSources?: OfficialSourcesCard): SoldCountFallbackSlot[] {
  const byId = new Map((officialSources?.sources ?? []).map((s) => [s.id, s] as const));
  const row = (id: string, label: string, sourceId?: string, note?: string): SoldCountFallbackSlot => {
    const source = sourceId ? byId.get(sourceId) : undefined;
    return source?.status === 'source_available'
      ? {
          id,
          label,
          status: 'source_available',
          sourceName: source.sourceName,
          sourceUrl: source.sourceUrl,
          note: source.note,
        }
      : {
          id,
          label,
          status: 'data_gap',
          note: note ?? `No exact public source is configured yet for ${descriptor}.`,
          approvalNeeded: sourceId
            ? `Provide/confirm the official ${descriptor} ${label.toLowerCase()} URL.`
            : `Provide/confirm the official ${descriptor} URL for this source slot.`,
        };
  };

  const fallbacks: SoldCountFallbackSlot[] = [
    row('county_assessor', 'County assessor / property records', 'county_assessor', `County assessor/property records are the best official fallback for ${descriptor}.`),
    row('county_sales_records', 'County register of deeds / sales records', undefined, `County sales records require the official ${descriptor} register of deeds / sales records URL.`),
    row('county_gis', 'County GIS / parcel viewer', 'county_gis', `County GIS remains a source slot only when the exact-search URL is known for ${descriptor}.`),
    row('county_planning', 'Planning / zoning', 'county_planning', `Planning / zoning source for ${descriptor}.`),
    row('comprehensive_plan', 'Comprehensive plan / future land use', 'comprehensive_plan', `Comprehensive plan / future land use source for ${descriptor}.`),
    row('permits_subdivision', 'Permits / subdivision portal', 'permits_subdivision', `Permits / subdivision portal source for ${descriptor}.`),
  ];

  const census = officialSources?.sources.find((s) => s.id === 'census_demographics');
  if (census) {
    fallbacks.push({
      id: 'census_local_context',
      label: 'Census / local context',
      status: census.status === 'source_available' ? 'source_available' : 'data_gap',
      sourceName: census.sourceName,
      sourceUrl: census.sourceUrl,
      note: census.note,
      approvalNeeded: census.status === 'data_gap' ? census.approvalNeeded : undefined,
    });
  }

  return fallbacks;
}

function linkFor(provider: SoldCountProvider, query: string, area: string, band: string, window: { start: string; end: string; label: typeof LOOKBACK_LABEL }): SoldSearchLink {
  const url =
    provider === 'Redfin' ? redfinSearchUrl(query)
    : provider === 'Zillow' ? zillowSearchUrl(query)
    : realtorSearchUrl(query);
  return {
    provider,
    sourceName: `${provider} sold search`,
    url,
    searchArea: area,
    acreageBand: band,
    lookbackStart: window.start,
    lookbackEnd: window.end,
    lookbackLabel: window.label,
    note: `Search assumption: ${area}; acreage band ${band}; ${window.label.toLowerCase()} ${window.start} to ${window.end}.`,
  };
}

async function detectBrowserAutomationAvailability(): Promise<SoldCountBrowserAutomationStatus> {
  try {
    // The package is already present in the workspace runtime. We only detect
    // availability here; the adapter is invoked only when Tyler intentionally
    // runs it.
    await import('puppeteer');
    return 'free_browser_automation_available';
  } catch {
    return 'automation_blocked_needs_package_approval';
  }
}

export async function buildSoldCountContext(input: BuildSoldCountContextInput): Promise<SoldCountContext> {
  const window = rollingTwelveMonthWindow(input.now);
  const area = areaDescriptor(input.city, input.county, input.state);
  const band = acreageBand(input.acres ?? null);
  const acreageKnown = Number.isFinite(input.acres ?? NaN) && (input.acres ?? 0) > 0;
  const canBuildLinks = !!(input.state && (input.county || input.city));
  const browserAutomationStatus = browserAutomationStatusFromAvailability(
    typeof input.browserAutomationAvailable === 'boolean'
      ? input.browserAutomationAvailable
      : (await detectBrowserAutomationAvailability()) === 'free_browser_automation_available',
  );
  const status: SoldCountStatus = !canBuildLinks
    ? 'data_gap'
    : browserAutomationStatus === 'free_browser_automation_available'
      ? 'browser_assisted_available'
      : 'manual_capture_ready';
  const query = searchQuery(area, band, window);
  const links = canBuildLinks
    ? [
        linkFor('Redfin', query, area, band, window),
        linkFor('Zillow', query, area, band, window),
        linkFor('Realtor', query, area, band, window),
      ]
    : [];

  const officialSources = input.officialSources ?? undefined;
  const openDataFallbacks = inferFallbacks(input, area, officialSources);
  const searchArea = area;
  const captureDraft = {
    redfinCount: '',
    zillowCount: '',
    notes: '',
    capturedAt: window.runtimeDate,
  };

  const reportReadySummary = canBuildLinks
    ? `Local Area Context, Not Parcel Verification. Embedded similar sales available. Zillow/Redfin sold-count context is available through ${browserAutomationStatus === 'free_browser_automation_available' ? 'free browser-assisted capture' : 'manual capture'} using a rolling 12-month lookback from run date.${acreageKnown ? '' : ' Acreage unknown until parcel facts or a manual acreage override is provided.'} Automated free browser extraction requires approved local browser tooling and may fall back to manual capture if the site blocks automation. No paid subscription or paid API is used.`
    : 'Local Area Context, Not Parcel Verification. Sold Count Context is a local-market data gap until parcel identity is verified and county/state is known.';

  return {
    status,
    label: 'Local Area Context, Not Parcel Verification',
    parcelVerified: input.parcelVerified,
    city: input.city,
    county: input.county,
    state: input.state,
    searchArea,
    acreage: Number.isFinite(input.acres ?? NaN) ? (input.acres as number) : null,
    acreageBand: band,
    acreageOverrideActive: !acreageKnown,
    lookbackStart: window.start,
    lookbackEnd: window.end,
    lookbackLabel: window.label,
    runtimeDate: window.runtimeDate,
    browserAutomationStatus,
    browserAutomationNote: summarizeBrowserAutomation(browserAutomationStatus),
    freeBrowserAutomationAvailable: browserAutomationStatus === 'free_browser_automation_available',
    links,
    openDataFallbacks,
    captureDraft,
    reportReadySummary,
    note:
      'Sold counts are local market context only. They never verify parcel identity, never use paid APIs or RapidAPI, and are only stored as Local Area Context, Not Parcel Verification.',
  };
}

export async function freeBrowserSoldCountAdapter(
  input: {
    provider: SoldCountProvider;
    sourceUrl: string;
    searchArea: string;
    acreageBand: string;
    lookbackStart: string;
    lookbackEnd: string;
    lookbackLabel: 'Rolling 12 months from run date';
  },
  deps: SoldCountBrowserAdapterDeps = {},
): Promise<SoldCountBrowserCaptureResult> {
  const capturedAt = toIsoDate(toDate(deps.now));
  const launch = deps.browserLauncher ?? (async () => {
    try {
      const mod = await import('puppeteer');
      return await mod.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  });

  let browser: SoldCountBrowserHandle | null = null;
  try {
    browser = await launch();
  } catch {
    return {
      status: 'automation_blocked_needs_package_approval',
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      searchArea: input.searchArea,
      acreageBand: input.acreageBand,
      lookbackStart: input.lookbackStart,
      lookbackEnd: input.lookbackEnd,
      lookbackLabel: input.lookbackLabel,
      capturedAt,
      count: null,
      note: 'Free browser automation is not available yet; manual capture remains ready.',
    };
  }

  try {
    const browserHandle = browser;
    if (!browserHandle) throw new Error('browser unavailable');
    const page = await browserHandle.newPage();
    try {
      await page.goto(input.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const text = String(await page.evaluate(() => (globalThis as { document?: { body?: { innerText?: string } } }).document?.body?.innerText ?? ''));
      const blocked = /captcha|verify you are human|unusual traffic|access denied|robot/i.test(text);
      if (blocked) {
        return {
          status: 'automation_blocked_by_site_protection',
          provider: input.provider,
          sourceUrl: input.sourceUrl,
          searchArea: input.searchArea,
          acreageBand: input.acreageBand,
          lookbackStart: input.lookbackStart,
          lookbackEnd: input.lookbackEnd,
          lookbackLabel: input.lookbackLabel,
          capturedAt,
          count: null,
          note: 'Site protection blocked automated extraction. Manual capture remains ready.',
        };
      }
      const m = text
        .replace(/\s+/g, ' ')
        .match(/\b(?:sold|results?|matches|listings?)\D{0,20}(\d{1,3}(?:,\d{3})*|\d{1,3})\b/i)
        ?? text.replace(/\s+/g, ' ').match(/\b(\d{1,3}(?:,\d{3})*|\d{1,3})\s+(?:sold|results?|matches)\b/i);
      const count = m ? Number(String(m[1]).replace(/,/g, '')) : NaN;
      if (!Number.isFinite(count)) {
        return {
          status: 'manual_capture_required',
          provider: input.provider,
          sourceUrl: input.sourceUrl,
          searchArea: input.searchArea,
          acreageBand: input.acreageBand,
          lookbackStart: input.lookbackStart,
          lookbackEnd: input.lookbackEnd,
          lookbackLabel: input.lookbackLabel,
          capturedAt,
          count: null,
          note: 'Visible sold count was not readable from the page; manual capture remains ready.',
        };
      }
      return {
        status: 'captured',
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        searchArea: input.searchArea,
        acreageBand: input.acreageBand,
        lookbackStart: input.lookbackStart,
        lookbackEnd: input.lookbackEnd,
        lookbackLabel: input.lookbackLabel,
        capturedAt,
        count,
        note: 'Visible count captured from the page body.',
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}
