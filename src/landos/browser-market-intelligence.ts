// LandOS — Browser Market Intelligence (pre-call public-web evidence).
//
// A Market INTELLIGENCE layer (not "just a browser"): a bounded, model-agnostic
// research capability that collects PUBLIC market evidence to complement the
// structured provider lane (Apify). The browser/vision model is SELECTABLE and
// replaceable (open-source/open-weight default) — never hard-coded. Until a
// browser-control model is wired into the runtime, this returns an honest
// "Needs Research — no browser model configured" status with the evidence
// categories it would collect. It NEVER fabricates evidence, and browser
// evidence is NEVER treated as verified parcel identity.

export const BROWSER_MODEL_ENV = 'LANDOS_BROWSER_MODEL';

/** Selectable open-source/open-weight browser-capable models. Replaceable via
 *  config without any architectural change. Default is the best currently
 *  preferred open-weight option; 'none' means no browser backend is wired. */
export const BROWSER_MODELS = ['none', 'qwen3-vl', 'qwen2.5-vl', 'gemma3-vision', 'uitars'] as const;
export type BrowserModel = (typeof BROWSER_MODELS)[number];
export const DEFAULT_BROWSER_MODEL: BrowserModel = 'qwen3-vl';

/** What the browser research lane targets. Pure metadata (no fabricated values). */
export const MARKET_INTEL_CATEGORIES = [
  'County planning / zoning momentum',
  'Economic development announcements',
  'Infrastructure / road / utility expansion',
  'Major employers / industrial / commercial development',
  'Residential development / growth signals',
  'Public listing evidence (Zillow / Redfin / Realtor / LandWatch)',
  'Local news / tourism / catalysts',
  'Major negative market risks',
] as const;

export const MARKET_INTEL_SOURCE_TYPES = [
  'county_planning', 'economic_development', 'infrastructure', 'employer',
  'development', 'listing_site', 'local_news', 'government', 'other',
] as const;
export type MarketIntelSourceType = (typeof MARKET_INTEL_SOURCE_TYPES)[number];

/** One piece of public-web evidence. Always carries provenance + an explicit
 *  "what it does NOT prove" so it is never confused with verified parcel facts. */
export interface MarketEvidence {
  url: string;
  source: string;
  sourceType: MarketIntelSourceType;
  snippet: string;
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
  supports: string;
  doesNotProve: string;
}

export type BrowserIntelStatus = 'collected' | 'no_browser_model' | 'no_area' | 'error';

export interface BrowserMarketIntelligence {
  status: BrowserIntelStatus;
  model: BrowserModel;
  area: string;
  categories: readonly string[];
  evidence: MarketEvidence[];
  note: string;
}

// ── Growth-driver synthesis (operator summary, NOT a headline dump) ──────────
export interface GrowthDriverSummary {
  status: BrowserIntelStatus;
  area: string;
  evidenceCount: number;
  drivers: Array<{ category: string; count: number; examples: string[] }>;
  summary: string;
  whatThisMeans: string;
}
const GROWTH_PATTERNS: Array<{ category: string; rx: RegExp }> = [
  { category: 'Residential / subdivisions', rx: /subdivision|master.?planned|residential develop|new homes|housing develop|lots? (approved|platted)/i },
  { category: 'Commercial / retail', rx: /commercial|retail|shopping|mixed.?use|store opening|grocery/i },
  { category: 'Industrial / logistics', rx: /industrial|distribution center|warehouse|manufactur|logistics|data center/i },
  { category: 'Infrastructure / highway', rx: /highway|interchange|road (widen|expan)|infrastructure|bridge|transit|interstate|\bi-\d/i },
  { category: 'Utilities expansion', rx: /water line|sewer|utility expan|broadband|power line|electric expan/i },
  { category: 'Rezoning / annexation', rx: /rezon|annex|zoning change|comprehensive plan|land.?use plan/i },
  { category: 'Schools / hospitals', rx: /\bschool\b|hospital|university|college|medical center/i },
  { category: 'Major land / real-estate deals', rx: /acres? (sold|purchased|acquired)|land (sale|deal)|developer (bought|acquired)|\$\d+\s*(million|m)\b/i },
];

/** Classify already-collected public-web evidence into land-value growth drivers
 *  and produce an OPERATOR summary (never a raw headline dump). Honest when no
 *  browser model / no evidence is available. */
export function summarizeGrowthDrivers(intel: BrowserMarketIntelligence): GrowthDriverSummary {
  const base = { status: intel.status, area: intel.area, evidenceCount: intel.evidence?.length ?? 0 };
  if (intel.status !== 'collected' || !intel.evidence?.length) {
    return { ...base, drivers: [], summary: intel.status === 'no_browser_model' ? 'No browser research model configured — local growth drivers not auto-summarized this run.' : intel.status === 'no_area' ? 'No verified area to research local growth drivers.' : 'No public-web growth signals retrieved for the area.', whatThisMeans: 'Treat the market as steady-state and rely on the verified comp band; confirm local development directly with the seller / county.' };
  }
  const drivers: GrowthDriverSummary['drivers'] = [];
  for (const { category, rx } of GROWTH_PATTERNS) {
    const hits = intel.evidence.filter((e) => rx.test(`${e.snippet} ${e.supports}`));
    if (hits.length) drivers.push({ category, count: hits.length, examples: hits.slice(0, 2).map((h) => h.snippet.slice(0, 120)) });
  }
  drivers.sort((a, b) => b.count - a.count);
  const topNames = drivers.slice(0, 3).map((d) => `${d.category.toLowerCase()} (${d.count})`);
  const summary = drivers.length
    ? `${intel.evidence.length} public signals for ${intel.area}; growth themes: ${topNames.join(', ')}.`
    : `${intel.evidence.length} public items for ${intel.area} but no clear land-value growth driver among them.`;
  const strong = drivers.reduce((n, d) => n + d.count, 0);
  const whatThisMeans = drivers.length === 0
    ? 'No clear growth catalysts in public news — price off the verified comp band; ask the seller about local development.'
    : strong >= 4
      ? 'Multiple growth catalysts (development + infrastructure) point to a strengthening land market — supports stronger exit confidence and a firmer acquisition stance near the top of the 40–60% band.'
      : 'Some growth signals present — modestly supportive of demand; weight the verified comps and confirm specifics with the seller / county.';
  return { ...base, drivers, summary, whatThisMeans };
}

/** A browser backend that actually drives a model to collect evidence. Injected
 *  when a runtime backend is available; absent => honest Needs Research. */
export type BrowserBackend = (args: { area: string; model: BrowserModel; categories: readonly string[] }) => Promise<MarketEvidence[]>;

export interface BrowserIntelDeps {
  env?: Record<string, string | undefined>;
  backend?: BrowserBackend;
}

export function resolveBrowserModel(env: Record<string, string | undefined> = process.env): BrowserModel {
  const v = (env[BROWSER_MODEL_ENV] ?? '').trim().toLowerCase();
  return (BROWSER_MODELS as readonly string[]).includes(v) ? (v as BrowserModel) : DEFAULT_BROWSER_MODEL;
}

/** Minimal text fetch (injected in tests). */
export type TextFetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function classifySource(title: string): MarketIntelSourceType {
  const t = title.toLowerCase();
  if (/road|highway|bridge|interchange|gdot|dot|rail|transit/.test(t)) return 'infrastructure';
  if (/water|sewer|utility|power|grid|broadband|fiber/.test(t)) return 'infrastructure';
  if (/hospital|plant|factory|employer|jobs|hiring|headquarters|distribution center/.test(t)) return 'employer';
  if (/development|subdivision|homes|housing|apartments|commercial|retail|industrial park|warehouse/.test(t)) return 'development';
  if (/economic development|investment|grant|incentive|chamber/.test(t)) return 'economic_development';
  if (/planning|zoning|commission|county board|city council|meeting/.test(t)) return 'county_planning';
  return 'local_news';
}

/**
 * Real, free browser-research backend over Google News RSS (no key, no browser
 * binary). Collects ACTUAL public local development / infrastructure / economic
 * evidence for the area, each item carrying full provenance. This is the default
 * working backend; a vision/browser-control model (the selectable `model`) can
 * replace it for deeper site navigation later. Injectable fetch for tests.
 */
export function makeNewsResearchBackend(deps: { fetchImpl?: TextFetch; now?: () => string; maxItems?: number } = {}): BrowserBackend {
  return async ({ area, model }) => {
    const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as TextFetch);
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const max = deps.maxItems ?? 8;
    const query = `${area} (development OR infrastructure OR "economic development" OR planning OR employer OR housing)`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`news RSS HTTP ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max);
    const ev: MarketEvidence[] = [];
    for (const m of items) {
      const block = m[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '').trim();
      const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '').trim();
      const src = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google News').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      if (!title || !link) continue;
      ev.push({
        url: link, source: src, sourceType: classifySource(title), snippet: title,
        timestamp: pub || now, confidence: 'low',
        supports: 'Local market/development signal for the area (public news).',
        doesNotProve: 'Does NOT confirm any parcel-specific fact, value, or identity.',
      });
    }
    void model;
    return ev;
  };
}

/**
 * Collect public-web market intelligence for an area. If no browser backend is
 * wired (the current runtime), returns an honest "no_browser_model" status with
 * the categories it would research — never fabricated evidence.
 */
export async function collectBrowserMarketIntelligence(
  area: { city?: string | null; county?: string | null; state?: string | null },
  deps: BrowserIntelDeps = {},
): Promise<BrowserMarketIntelligence> {
  const model = resolveBrowserModel(deps.env);
  const areaStr = [area.city, area.county ? `${area.county} County` : null, area.state].filter(Boolean).join(', ');
  if (!areaStr) {
    return { status: 'no_area', model, area: '', categories: MARKET_INTEL_CATEGORIES, evidence: [], note: 'No area (city/county/state) to research.' };
  }
  if (!deps.backend) {
    return {
      status: 'no_browser_model', model, area: areaStr, categories: MARKET_INTEL_CATEGORIES, evidence: [],
      note: `Needs Research — no browser model backend wired (selected model: ${model}). Set ${BROWSER_MODEL_ENV} + provide a backend to activate. No evidence is fabricated.`,
    };
  }
  try {
    const evidence = await deps.backend({ area: areaStr, model, categories: MARKET_INTEL_CATEGORIES });
    return {
      status: 'collected', model, area: areaStr, categories: MARKET_INTEL_CATEGORIES, evidence,
      note: evidence.length ? `Collected ${evidence.length} public-web evidence item(s) via ${model}.` : `No meaningful public evidence found via ${model}.`,
    };
  } catch (e: unknown) {
    return { status: 'error', model, area: areaStr, categories: MARKET_INTEL_CATEGORIES, evidence: [], note: `Browser research error: ${(e as Error)?.message ?? String(e)}.` };
  }
}
