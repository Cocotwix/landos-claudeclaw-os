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
