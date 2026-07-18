// LandOS — NETR routing layer (semantic, multi-state; NO county-specific scrapers).
//
// Given a NETR Online county page's links (or web-search results), classify them
// into official public-record source types by SEMANTIC patterns over link text +
// URL — the same logic for every county in every state. We never hand-build
// per-county selectors. Official .gov / county-owned / known GIS-portal domains
// are preferred. Each chosen source records HOW it was found (NETR vs search
// fallback) for provenance. Pure + deterministic.

export const COUNTY_SOURCE_TYPES = [
  'assessor', 'appraiser', 'tax', 'gis', 'recorder', 'planning', 'building',
] as const;
export type CountySourceType = (typeof COUNTY_SOURCE_TYPES)[number];

export type SourceOrigin = 'netr' | 'search_fallback';

export interface CountySourceLink {
  type: CountySourceType;
  url: string;
  label: string;
  origin: SourceOrigin;
  /** 0..1 — official-domain + label-match strength. */
  confidence: number;
}

export interface PageLink { text: string; href: string }

/**
 * Government-record source order is a business rule, not a one-off county
 * exception.  A county, city, or township office owns the most useful parcel
 * context, so LandOS must attempt it before a statewide index.  Statewide
 * systems remain a fallback: they can be useful for a wider index, but never
 * displace an available local-record path.
 */
export type GovernmentSourceScope = 'township' | 'municipal' | 'county' | 'regional' | 'statewide' | 'unknown';

export interface GovernmentSourceLocality {
  county?: string;
  city?: string;
  township?: string;
  state?: string;
}

function normalizedPlace(value?: string): string {
  return String(value ?? '').toLowerCase().replace(/\b(county|city|township|town|village)\b/g, '').replace(/[^a-z0-9]/g, '');
}

/** Classify the ownership scope of a public-record source from safe link text
 * and URL only.  A link found on the county's NETR page is treated as county
 * local unless it identifies itself as a statewide index. */
export function governmentSourceScope(source: Pick<CountySourceLink, 'url' | 'label' | 'origin'>, locality: GovernmentSourceLocality): GovernmentSourceScope {
  const host = hostOf(source.url);
  const blob = `${source.label} ${host} ${source.url}`.toLowerCase();
  const township = normalizedPlace(locality.township);
  const city = normalizedPlace(locality.city);
  const county = normalizedPlace(locality.county);
  const compact = blob.replace(/[^a-z0-9]/g, '');
  if (township && compact.includes(township)) return 'township';
  if (city && compact.includes(city)) return 'municipal';
  if (county && compact.includes(county)) return 'county';
  if (/\b(statewide|state\s+(land|lien|deed|record|records|index)|secretary\s+of\s+state)\b|gsccca|state\.\w+\.us/.test(blob)) return 'statewide';
  if (/\b(regional|multi[-\s]?county|district)\b/.test(blob)) return 'regional';
  return source.origin === 'netr' ? 'county' : 'unknown';
}

const SOURCE_SCOPE_PRIORITY: Record<GovernmentSourceScope, number> = {
  township: 0, municipal: 1, county: 2, regional: 3, statewide: 4, unknown: 5,
};

export function governmentSourceScopePriority(source: Pick<CountySourceLink, 'url' | 'label' | 'origin'>, locality: GovernmentSourceLocality): number {
  return SOURCE_SCOPE_PRIORITY[governmentSourceScope(source, locality)];
}

/** Stable local-first ordering for every county public-record workflow. */
export function orderCountySourcesLocalFirst<T extends CountySourceLink>(sources: readonly T[], locality: GovernmentSourceLocality): T[] {
  return sources.map((source, index) => ({ source, index })).sort((a, b) => {
    const scopeDiff = governmentSourceScopePriority(a.source, locality) - governmentSourceScopePriority(b.source, locality);
    if (scopeDiff !== 0) return scopeDiff;
    const confidenceDiff = b.source.confidence - a.source.confidence;
    return confidenceDiff !== 0 ? confidenceDiff : a.index - b.index;
  }).map(({ source }) => source);
}

// Semantic classifiers — match BOTH the visible link text and the URL. Ordered:
// more specific types first so "property appraiser" → appraiser (not assessor).
const TYPE_PATTERNS: Array<{ type: CountySourceType; rx: RegExp }> = [
  { type: 'appraiser', rx: /property\s+appraiser|appraisal\s+district/i },
  { type: 'recorder', rx: /recorder|register\s+of\s+deeds|clerk\s+of\s+(court|the\s+circuit)|county\s+clerk|recorded?\s+document|deed(s)?\b|land\s+records/i },
  { type: 'tax', rx: /tax\s+(collector|commissioner|assessor[- ]collector|office|bill|sale|payment)|treasurer|pay\s+(your\s+)?tax|delinquent\s+tax|property\s+tax/i },
  { type: 'gis', rx: /\bgis\b|parcel\s+(map|viewer)|interactive\s+map|map\s+(viewer|server)|geospatial|arcgis\.com/i },
  { type: 'planning', rx: /planning|zoning|land\s+use|development\s+services|comprehensive\s+plan/i },
  { type: 'building', rx: /building\s+(department|permit|inspection)|permits?\b/i },
  { type: 'assessor', rx: /assessor|assessment|appraisal|property\s+search|property\s+record|real\s+estate\s+record/i },
];

/** Known official / official-adjacent hosts that signal a real public-record site
 *  even without a .gov TLD. Counties widely run their assessor/tax/GIS/recorder on
 *  these standard government-records SaaS platforms — they ARE the official source. */
const OFFICIAL_HOST_HINTS = /\.gov\b|\.us\b|arcgis\.com|qpublic|schneidercorp|schneidergis|beacon|tylertech|tylerhost|governmax|devnet|gworks|opendata|publicaccess|govern|county|parcel|assessor|apprais|\btax\b|\bgis\b/i;
/** Hosts to avoid (aggregators / data brokers — not the official source). */
const NON_OFFICIAL_HOST = /netronline|zillow|realtor|redfin|trulia|spokeo|whitepages|propertyshark|landglide|regrid|loopnet|facebook|google\.com\/search/i;

function hostOf(href: string): string {
  try { return new URL(href).hostname.toLowerCase(); } catch { return ''; }
}

/** Classify a single link into a county source type (or null). Semantic only. */
export function classifyCountyLink(link: PageLink): CountySourceType | null {
  const hay = `${link.text} ${link.href}`;
  for (const { type, rx } of TYPE_PATTERNS) {
    if (rx.test(hay)) return type;
  }
  return null;
}

/** Official-domain preference score for a URL (0..1). .gov wins; data brokers
 *  are rejected. Used to pick the best link per type and the search fallback. */
export function officialDomainScore(href: string, county?: string, state?: string): number {
  const host = hostOf(href);
  if (!host) return 0;
  if (NON_OFFICIAL_HOST.test(host)) return 0;
  let s = 0;
  if (/\.gov$|\.gov\b/.test(host)) s += 0.6;
  if (/\.us$/.test(host)) s += 0.3;
  if (county && host.includes(county.toLowerCase().replace(/\s+/g, ''))) s += 0.25;
  if (state && new RegExp(`\\b${state.toLowerCase()}\\b`).test(host)) s += 0.1;
  if (OFFICIAL_HOST_HINTS.test(host)) s += 0.2;
  return Math.min(1, s);
}

/**
 * Extract the best official county source per type from a set of links (NETR page
 * or search results). For each type, keep the highest-scoring official link. Pure.
 */
export function extractCountySources(
  links: PageLink[],
  opts: { origin: SourceOrigin; county?: string; state?: string },
): CountySourceLink[] {
  const best = new Map<CountySourceType, CountySourceLink>();
  for (const link of links) {
    if (!link.href || !/^https?:/i.test(link.href)) continue;
    const type = classifyCountyLink(link);
    if (!type) continue;
    const domain = officialDomainScore(link.href, opts.county, opts.state);
    if (domain === 0) continue; // reject data brokers / non-official
    // label-match adds confidence; combine with domain score.
    const confidence = Math.min(1, 0.4 + domain * 0.6);
    const cand: CountySourceLink = { type, url: link.href, label: (link.text || type).slice(0, 80).trim(), origin: opts.origin, confidence };
    const prev = best.get(type);
    const locality = { county: opts.county, state: opts.state };
    const candidateScope = governmentSourceScopePriority(cand, locality);
    const previousScope = prev ? governmentSourceScopePriority(prev, locality) : Number.POSITIVE_INFINITY;
    if (!prev || candidateScope < previousScope || (candidateScope === previousScope && cand.confidence > prev.confidence)) best.set(type, cand);
  }
  return [...best.values()];
}

/** Build the intelligent web-search query for a missing official source type when
 *  NETR is stale/dead. Prefers official results via the query itself. */
export function officialSearchQuery(type: CountySourceType, county?: string, state?: string): string {
  const place = [county && `${county} County`, state].filter(Boolean).join(' ');
  const target = {
    assessor: 'assessor property record search official site',
    appraiser: 'property appraiser official site',
    tax: 'tax collector property tax official site',
    gis: 'GIS parcel viewer official site',
    recorder: 'recorder register of deeds official records',
    planning: 'planning and zoning official site',
    building: 'building permits department official site',
  }[type];
  return `${place} ${target}`.trim();
}

/** Static-results search endpoint (no API key, no JS needed) for the fallback.
 *  DuckDuckGo's HTML endpoint returns real result anchors a browser can read. */
export function searchEngineUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

/** Unwrap search-result links to their real destination (DuckDuckGo wraps results
 *  in /l/?uddg=<encoded-url>) and drop the search engine's own internal links. */
export function unwrapSearchResults(links: PageLink[]): PageLink[] {
  const out: PageLink[] = [];
  for (const l of links) {
    let href = l.href;
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) { try { href = decodeURIComponent(m[1]); } catch { /* keep */ } }
    if (!/^https?:/i.test(href)) continue;
    if (/duckduckgo\.com|bing\.com|google\.com\/search/i.test(href)) continue;
    out.push({ text: l.text, href });
  }
  return out;
}

/** From web-search results, pick the most official link for a type (search
 *  fallback). Rejects aggregators; prefers .gov / county-owned. */
export function pickOfficialResult(results: PageLink[], type: CountySourceType, county?: string, state?: string): CountySourceLink | null {
  let best: CountySourceLink | null = null;
  for (const r of results) {
    if (!r.href || !/^https?:/i.test(r.href)) continue;
    if (classifyCountyLink(r) !== type && !TYPE_PATTERNS.find((p) => p.type === type)?.rx.test(`${r.text} ${r.href}`)) continue;
    const domain = officialDomainScore(r.href, county, state);
    if (domain === 0) continue;
    const cand: CountySourceLink = { type, url: r.href, label: (r.text || type).slice(0, 80).trim(), origin: 'search_fallback', confidence: Math.min(1, 0.35 + domain * 0.6) };
    const locality = { county, state };
    const candidateScope = governmentSourceScopePriority(cand, locality);
    const previousScope = best ? governmentSourceScopePriority(best, locality) : Number.POSITIVE_INFINITY;
    if (!best || candidateScope < previousScope || (candidateScope === previousScope && cand.confidence > best.confidence)) best = cand;
  }
  return best;
}

/** True when a NETR result is too thin to trust (stale/dead) → trigger search. */
export function netrIsStale(sources: CountySourceLink[]): boolean {
  // Need at least the core records routing (assessor/appraiser OR tax OR recorder).
  const types = new Set(sources.map((s) => s.type));
  return !(types.has('assessor') || types.has('appraiser') || types.has('tax') || types.has('recorder'));
}
