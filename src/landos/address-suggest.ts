// LandOS — Smart Address Search (provider-agnostic autocomplete).
//
// Replaces the plain address textbox: as the operator types, suggest matches from
// FREE / OPEN providers first. No mandatory paid dependency, no Google Places.
// Providers are tried in order until one returns suggestions; results are
// normalized to ONE shape and cached. Fetch is injectable so tests never hit the
// network. Debounce + keyboard nav live in the UI; min-chars + caching live here.
//
// Default provider order (all free/keyless):
//   1. Photon (komoot)  — https://photon.komoot.io  (OpenStreetMap-based)
//   2. US Census geocoder onelineaddress (US-only, no key)
// Nominatim / Pelias / OpenAddresses can register as additional providers without
// changing this module's surface (provider-agnostic by contract).

export const MIN_SUGGEST_CHARS = 3;
const DEFAULT_LIMIT = 5;

/** One normalized suggestion. `raw` lets the operator submit free text even when
 *  nothing is selected (the resolver still runs on raw input). */
export interface AddressSuggestion {
  /** Display + submit string (normalized one-line address). */
  label: string;
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  coordinates?: { lat: number; lng: number };
  /** Named provider that produced it. */
  source: string;
  /** 0..1 provider confidence. */
  confidence: number;
}

export interface SuggestResult {
  query: string;
  suggestions: AddressSuggestion[];
  /** Provider that produced the suggestions (or 'none'). */
  source: string;
  /** True when served from the local cache. */
  cached: boolean;
  /** Honest note for the UI (e.g. min-chars not met, all providers unavailable). */
  note?: string;
}

export type SuggestFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface SuggestProvider {
  readonly id: string;
  readonly label: string;
  /** Returns [] on no match; throws/returns [] on error (caller falls through). */
  suggest(query: string, opts: { limit: number; fetchImpl: SuggestFetch }): Promise<AddressSuggestion[]>;
}

// ─────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : undefined;
}

/** Photon (komoot) — free, keyless, OSM-based forward geocoder with autocomplete. */
export function photonProvider(): SuggestProvider {
  return {
    id: 'photon',
    label: 'Photon (OpenStreetMap)',
    async suggest(query, { limit, fetchImpl }) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'LandOS/1.0 (property resolution)' } });
      if (!res.ok) return [];
      const body = (await res.json()) as any;
      const feats: any[] = Array.isArray(body?.features) ? body.features : [];
      const out: AddressSuggestion[] = [];
      for (const f of feats) {
        const p = f?.properties ?? {};
        // Only surface address-like results (a house number or a named street).
        const line1 = [p.housenumber, p.street ?? p.name].filter(Boolean).join(' ').trim() || undefined;
        const city = (p.city ?? p.town ?? p.village ?? p.locality) || undefined;
        const state = stateAbbrev(p.state) ?? undefined;
        const zip = p.postcode || undefined;
        const county = stripCounty(p.county) || undefined;
        const coords = Array.isArray(f?.geometry?.coordinates)
          ? { lng: num(f.geometry.coordinates[0]) as number, lat: num(f.geometry.coordinates[1]) as number }
          : undefined;
        const label = [line1, city, state, zip].filter(Boolean).join(', ');
        if (!label) continue;
        // Country filter: keep US results when a country code is present.
        if (p.countrycode && String(p.countrycode).toUpperCase() !== 'US') continue;
        out.push({
          label, line1, city, state, zip, county,
          coordinates: coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? coords : undefined,
          source: 'Photon', confidence: line1 && p.housenumber ? 0.8 : 0.6,
        });
      }
      return out;
    },
  };
}

/** US Census geocoder onelineaddress — free, keyless, US-only. County-rich. */
export function censusSuggestProvider(): SuggestProvider {
  return {
    id: 'census',
    label: 'US Census geocoder',
    async suggest(query, { limit, fetchImpl }) {
      const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
      const res = await fetchImpl(url);
      if (!res.ok) return [];
      const body = (await res.json()) as any;
      const matches: any[] = Array.isArray(body?.result?.addressMatches) ? body.result.addressMatches : [];
      return matches.slice(0, limit).map((m): AddressSuggestion => {
        const ac = m?.addressComponents ?? {};
        const counties = m?.geographies?.['Counties'] ?? m?.geographies?.['County'];
        const c = Array.isArray(counties) ? counties[0] : undefined;
        const line1 = [ac.fromAddress && ac.streetName ? `${ac.fromAddress} ${ac.streetName}` : undefined,
          ac.streetName && ac.suffixType ? '' : ''].filter(Boolean).join(' ').trim() || undefined;
        const coord = m?.coordinates ?? {};
        const lat = num(coord.y); const lng = num(coord.x);
        return {
          label: String(m?.matchedAddress ?? query),
          line1,
          city: ac.city || undefined,
          state: ac.state || undefined,
          zip: ac.zip || undefined,
          county: stripCounty(c?.BASENAME ?? c?.NAME) || undefined,
          coordinates: lat != null && lng != null ? { lat, lng } : undefined,
          source: 'US Census geocoder',
          confidence: 0.75,
        };
      }).filter((x) => !!x.label);
    },
  };
}

function stripCounty(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.replace(/\s+County$/i, '').trim() : '';
  return s || undefined;
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
function stateAbbrev(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_ABBR[t.toLowerCase()];
}

// ─────────────────────────────────────────────────────────────────────────
// Cache + orchestration
// ─────────────────────────────────────────────────────────────────────────

/** Small bounded LRU cache (query → result). Keeps autocomplete cheap and avoids
 *  hammering free providers as the operator types. */
export class SuggestCache {
  private map = new Map<string, SuggestResult>();
  constructor(private max = 200) {}
  private key(q: string): string { return q.trim().toLowerCase(); }
  get(q: string): SuggestResult | undefined {
    const k = this.key(q);
    const v = this.map.get(k);
    if (v) { this.map.delete(k); this.map.set(k, v); } // bump recency
    return v ? { ...v, cached: true } : undefined;
  }
  set(q: string, v: SuggestResult): void {
    const k = this.key(q);
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) { const oldest = this.map.keys().next().value; if (oldest === undefined) break; this.map.delete(oldest); }
  }
  get size(): number { return this.map.size; }
}

export interface SuggestDeps {
  providers?: SuggestProvider[];
  fetchImpl?: SuggestFetch;
  cache?: SuggestCache;
  limit?: number;
  minChars?: number;
}

// Module-level default cache so repeated keystrokes across requests reuse results.
const defaultCache = new SuggestCache();

/**
 * Suggest normalized address matches for a typed query. Free/open providers in
 * order; first provider to return results wins; results are cached. Below
 * min-chars (or when no provider is available) returns an honest empty result —
 * the operator can still submit the raw free text to the resolver. Pure given an
 * injected fetch; never throws out of the function.
 */
export async function suggestAddresses(query: string, deps: SuggestDeps = {}): Promise<SuggestResult> {
  const q = (query ?? '').trim();
  const minChars = deps.minChars ?? MIN_SUGGEST_CHARS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  if (q.length < minChars) {
    return { query: q, suggestions: [], source: 'none', cached: false, note: `Type at least ${minChars} characters for suggestions.` };
  }
  const cache = deps.cache ?? defaultCache;
  const hit = cache.get(q);
  if (hit) return hit;

  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as SuggestFetch);
  const providers = deps.providers ?? [photonProvider(), censusSuggestProvider()];

  for (const p of providers) {
    try {
      const suggestions = await p.suggest(q, { limit, fetchImpl });
      if (suggestions.length) {
        const result: SuggestResult = { query: q, suggestions: dedupe(suggestions).slice(0, limit), source: p.label, cached: false };
        cache.set(q, result);
        return result;
      }
    } catch {
      // provider failed — fall through to the next free provider
    }
  }
  const empty: SuggestResult = {
    query: q, suggestions: [], source: 'none', cached: false,
    note: 'No address suggestions from the free providers. You can submit the address as typed — resolution will still run.',
  };
  cache.set(q, empty);
  return empty;
}

function dedupe(list: AddressSuggestion[]): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const s of list) {
    const k = s.label.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
