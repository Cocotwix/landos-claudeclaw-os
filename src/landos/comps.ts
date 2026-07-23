// LandOS comps: manual comp storage, comp-source ordering, recency/staleness,
// and the paid-comp-tool guardrail.
//
// Comp source order (for future comp workflows):
//   1. LandPortal comp report — only when available, live-approved, and fresh.
//   2. Zillow sold land comps — preferred public fallback.
//   3. Redfin sold land comps — second public fallback.
//   4. Land.com / LandWatch / LandsOfAmerica — larger acreage / rural / niche,
//      or when Zillow/Redfin are thin.
// GIS/county is NEVER the first-pass comp engine (verification/legal only).
//
// Hard rules enforced here:
//   - Manual comps never verify parcel identity, never merge APNs, never
//     override source-confirmed parcel facts. Source label + confidence stay
//     visible.
//   - Paid LandPortal comp tools (lp_comp_report_create / lp_comp_report_get)
//     may ONLY run inside a live LandOS property workflow. This module exposes
//     the guardrail; it never calls those tools and never spends a credit.

import {
  getLandosDb,
  landosAudit,
  type CompPriceKind,
  type CompSourceLabel,
  type CompStatus,
  type LandosEntity,
  COMP_PRICE_KINDS,
  COMP_SOURCE_LABELS,
  COMP_STATUSES,
} from './db.js';
import { censusSuggestProvider, photonProvider, suggestAddresses, SuggestCache, type AddressSuggestion, type SuggestFetch } from './address-suggest.js';

// ── Paid comp-tool guardrail ───────────────────────────────────────────────

// The ONLY context in which a paid LandPortal comp report may run.
export type CompWorkflowMode =
  | 'live_property_workflow'
  | 'build'
  | 'test'
  | 'mock'
  | 'smoke'
  | 'seed'
  | 'debug'
  | 'unknown';

export const PAID_COMP_TOOLS = ['lp_comp_report_create', 'lp_comp_report_get'] as const;

export function isPaidCompAllowed(mode: CompWorkflowMode): boolean {
  return false;
}

/**
 * Guard a paid comp tool call. Throws unless the caller is a live LandOS
 * property workflow. Build/test/mock/smoke/seed/debug runs can never spend a
 * LandPortal comp credit. This bridge build never calls this with a live mode.
 */
export function assertPaidCompAllowed(mode: CompWorkflowMode, tool?: string): void {
  if (!isPaidCompAllowed(mode)) {
    throw new Error(
      `paid comp tool${tool ? ` "${tool}"` : ''} blocked: paid actions are prohibited in every workflow (mode was "${mode}")`,
    );
  }
}

// ── Comp source ordering ────────────────────────────────────────────────────

export interface CompSourceRecommendation {
  order: CompSourceLabel[];
  notes: string[];
}

const LARGE_ACRE_THRESHOLD = 50;

/**
 * Recommend the comp-source order for a parcel. LandPortal only leads when
 * available AND fresh; otherwise public marketplaces lead with Zillow before
 * Redfin. Parcels over ~50 acres (or niche/rural) also suggest land
 * marketplaces. Deterministic; pure.
 */
export function recommendCompSources(input: {
  acres?: number | null;
  lpAvailable?: boolean;
  lpStale?: boolean;
  niche?: boolean;
}): CompSourceRecommendation {
  const notes: string[] = [];
  const order: CompSourceLabel[] = [];
  const large = (typeof input.acres === 'number' && input.acres > LARGE_ACRE_THRESHOLD) || !!input.niche;

  if (input.lpAvailable && !input.lpStale) {
    order.push('LandPortal');
  } else if (input.lpAvailable && input.lpStale) {
    notes.push('LandPortal comps are stale; lead with public marketplace comps and keep LandPortal as reference only.');
  }

  // Public fallback: Zillow always before Redfin.
  order.push('Zillow', 'Redfin');

  if (large) {
    order.push('Land.com', 'LandWatch', 'LandsOfAmerica');
    notes.push('Parcel is large or niche/rural: supplement Zillow/Redfin with land marketplaces (Land.com, LandWatch, LandsOfAmerica).');
  } else {
    notes.push('Parcel is 50 acres or below: Zillow then Redfin are acceptable first-pass land comp sources.');
  }

  return { order, notes };
}

// ── Comp recency / staleness ────────────────────────────────────────────────

function monthsBetween(olderISO: string, newerISO: string): number | null {
  const older = Date.parse(olderISO);
  const newer = Date.parse(newerISO);
  if (Number.isNaN(older) || Number.isNaN(newer)) return null;
  return (newer - older) / (1000 * 60 * 60 * 24 * 30.4375);
}

export interface CompRecencyResult {
  stale: boolean;
  note: string;
  supplement: CompSourceLabel[];
}

/**
 * Flag LandPortal comps as stale when the newest comp is older than 12 months
 * from the run date, and require Zillow-then-Redfin last-12-month
 * supplementation. Pure.
 */
export function evaluateCompRecency(newestCompDateISO: string | null | undefined, runDateISO: string): CompRecencyResult {
  if (!newestCompDateISO) {
    return {
      stale: true,
      note: 'No comp date available: treat LandPortal comps as unconfirmed and supplement with Zillow first and Redfin second for last-12-month sold comps.',
      supplement: ['Zillow', 'Redfin'],
    };
  }
  const months = monthsBetween(newestCompDateISO, runDateISO);
  const stale = months === null ? true : months > 12;
  if (!stale) return { stale: false, note: '', supplement: [] };
  return {
    stale: true,
    note: 'LandPortal comps are stale: newest returned comp is outside the last 12 months from today’s run date. Supplement with Zillow first and Redfin second for last-12-month sold comps.',
    supplement: ['Zillow', 'Redfin'],
  };
}

// ── Manual / automated comp storage ─────────────────────────────────────────

export interface CompRow {
  id: number;
  entity: string;
  deal_card_id: number;
  card_id: number | null;
  source_label: string;
  source_url: string;
  address_desc: string;
  apn: string;
  county: string;
  state: string;
  price: number | null;
  price_kind: string;
  sale_or_list_date: string;
  acres: number | null;
  price_per_acre: number | null;
  notes: string;
  added_by: string;
  status: string;
  created_at: number;
  /** Enrichment coordinates for the embedded comp map (nullable; provider or cached geocode). */
  lat: number | null;
  lng: number | null;
  canonical_source: string;
  city: string;
  zip: string;
  distance_miles: number | null;
  listing_date: string;
  days_on_market: number | null;
  property_class: string;
  classification: string;
  thumbnail_url: string;
  retrieved_at: string;
  radius_miles: number | null;
  date_window_months: number | null;
  inclusion_reason: string;
  source_attributions_json: string;
  canonical_key: string;
  updated_at: number;
}

export interface AddCompInput {
  entity: LandosEntity;
  dealCardId: number;
  cardId?: number;
  sourceLabel?: CompSourceLabel;
  sourceUrl?: string;
  addressDesc?: string;
  apn?: string;
  county?: string;
  state?: string;
  price?: number;
  priceKind?: CompPriceKind;
  saleOrListDate?: string;
  acres?: number;
  pricePerAcre?: number;
  notes?: string;
  addedBy?: string;
  status?: CompStatus;
  /** Optional provider-supplied coordinates (map enrichment only). */
  lat?: number | null;
  lng?: number | null;
  canonicalSource?: string;
  city?: string;
  zip?: string;
  distanceMiles?: number | null;
  listingDate?: string;
  daysOnMarket?: number | null;
  propertyClass?: string;
  classification?: string;
  thumbnailUrl?: string;
  retrievedAt?: string;
  radiusMiles?: number | null;
  dateWindowMonths?: number | null;
  inclusionReason?: string;
  sourceAttributions?: Array<{ provider: string; url?: string | null }>;
  canonicalKey?: string;
}

export function getComp(id: number): CompRow | undefined {
  return getLandosDb().prepare('SELECT * FROM landos_comp WHERE id = ?').get(id) as CompRow | undefined;
}

/**
 * Add a comp to a Deal Card (and optionally a specific property card). A comp
 * never verifies the subject parcel and defaults to manual_unverified. Computes
 * price-per-acre when price and acres are known and ppa was not supplied.
 */
export function addComp(input: AddCompInput): CompRow {
  const db = getLandosDb();
  const sourceLabel: CompSourceLabel =
    input.sourceLabel && (COMP_SOURCE_LABELS as readonly string[]).includes(input.sourceLabel) ? input.sourceLabel : 'Other';
  const priceKind: CompPriceKind =
    input.priceKind && (COMP_PRICE_KINDS as readonly string[]).includes(input.priceKind) ? input.priceKind : 'unknown';
  const status: CompStatus =
    input.status && (COMP_STATUSES as readonly string[]).includes(input.status) ? input.status : 'manual_unverified';
  let ppa = input.pricePerAcre ?? null;
  if (ppa === null && typeof input.price === 'number' && typeof input.acres === 'number' && input.acres > 0) {
    ppa = Math.round((input.price / input.acres) * 100) / 100;
  }
  const id = db.prepare(
    `INSERT INTO landos_comp
       (entity, deal_card_id, card_id, source_label, source_url, address_desc, apn, county, state,
        price, price_kind, sale_or_list_date, acres, price_per_acre, notes, added_by, status, lat, lng,
        canonical_source, city, zip, distance_miles, listing_date, days_on_market, property_class,
        classification, thumbnail_url, retrieved_at, radius_miles, date_window_months,
        inclusion_reason, source_attributions_json, canonical_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))`,
  ).run(
    input.entity,
    input.dealCardId,
    input.cardId ?? null,
    sourceLabel,
    input.sourceUrl ?? '',
    input.addressDesc ?? '',
    input.apn ?? '',
    input.county ?? '',
    input.state ?? '',
    input.price ?? null,
    priceKind,
    input.saleOrListDate ?? '',
    input.acres ?? null,
    ppa,
    input.notes ?? '',
    input.addedBy ?? 'tyler/manual',
    status,
    typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : null,
    typeof input.lng === 'number' && Number.isFinite(input.lng) ? input.lng : null,
    input.canonicalSource ?? sourceLabel,
    input.city ?? '',
    input.zip ?? '',
    typeof input.distanceMiles === 'number' && Number.isFinite(input.distanceMiles) ? input.distanceMiles : null,
    input.listingDate ?? '',
    typeof input.daysOnMarket === 'number' && Number.isFinite(input.daysOnMarket) ? Math.max(0, Math.round(input.daysOnMarket)) : null,
    input.propertyClass ?? '',
    input.classification ?? '',
    input.thumbnailUrl ?? '',
    input.retrievedAt ?? new Date().toISOString(),
    typeof input.radiusMiles === 'number' && Number.isFinite(input.radiusMiles) ? input.radiusMiles : null,
    typeof input.dateWindowMonths === 'number' && Number.isFinite(input.dateWindowMonths) ? Math.round(input.dateWindowMonths) : null,
    input.inclusionReason ?? '',
    JSON.stringify(input.sourceAttributions ?? [{ provider: input.canonicalSource ?? sourceLabel, url: input.sourceUrl ?? null }]),
    input.canonicalKey ?? '',
  ).lastInsertRowid as number;
  landosAudit(input.addedBy ?? 'tyler/manual', 'comp_added', `deal ${input.dealCardId} comp ${id} (${sourceLabel}, ${status})`, {
    entity: input.entity, refTable: 'landos_comp', refId: id,
  });
  return getComp(id)!;
}

const normalizedCompKey = (input: Pick<AddCompInput, 'apn' | 'addressDesc' | 'lat' | 'lng' | 'price' | 'saleOrListDate'>): string => {
  const apn = (input.apn ?? '').replace(/\D/g, '');
  if (apn.length >= 5) return `apn:${apn}`;
  const address = (input.addressDesc ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (address) return `addr:${address}`;
  if (typeof input.lat === 'number' && typeof input.lng === 'number') return `coord:${input.lat.toFixed(4)},${input.lng.toFixed(4)}`;
  return `event:${input.price ?? ''}:${(input.saleOrListDate ?? '').slice(0, 10)}`;
};

/** Upsert one normalized provider observation into the single landos_comp
 * registry. Rich prior evidence wins over a later sparse/failed retry, while
 * provider URLs are merged so cross-provider corroboration is never lost. */
export function upsertNormalizedComp(input: AddCompInput): CompRow {
  const db = getLandosDb();
  const key = input.canonicalKey?.trim() || normalizedCompKey(input);
  let existing = db.prepare('SELECT * FROM landos_comp WHERE deal_card_id = ? AND canonical_key = ? ORDER BY updated_at DESC, id DESC LIMIT 1')
    .get(input.dealCardId, key) as CompRow | undefined;
  if (!existing && input.addressDesc?.trim()) {
    existing = db.prepare(`SELECT * FROM landos_comp
      WHERE deal_card_id = ? AND lower(trim(address_desc)) = lower(trim(?))
      ORDER BY updated_at DESC, id DESC LIMIT 1`).get(input.dealCardId, input.addressDesc) as CompRow | undefined;
  }
  if (!existing) return addComp({ ...input, canonicalKey: key });
  let attributions: Array<{ provider: string; url?: string | null }> = [];
  try { attributions = JSON.parse(existing.source_attributions_json || '[]'); } catch { attributions = []; }
  for (const source of input.sourceAttributions ?? [{ provider: input.canonicalSource ?? input.sourceLabel ?? 'Other', url: input.sourceUrl ?? null }]) {
    if (!attributions.some((row) => row.provider.toLowerCase() === source.provider.toLowerCase() && (row.url ?? '') === (source.url ?? ''))) attributions.push(source);
  }
  const prefer = <T>(fresh: T | null | undefined, prior: T): T => fresh == null || fresh === '' ? prior : fresh;
  db.prepare(`UPDATE landos_comp SET
      source_url=?, address_desc=?, apn=?, county=?, state=?, price=?, price_kind=?, sale_or_list_date=?,
      acres=?, price_per_acre=?, notes=?, status=?, lat=?, lng=?, canonical_source=?, city=?, zip=?,
      distance_miles=?, listing_date=?, days_on_market=?, property_class=?, classification=?, thumbnail_url=?,
      retrieved_at=?, radius_miles=?, date_window_months=?, inclusion_reason=?, source_attributions_json=?, canonical_key=?, updated_at=strftime('%s','now')
    WHERE id=?`).run(
      prefer(input.sourceUrl, existing.source_url), prefer(input.addressDesc, existing.address_desc), prefer(input.apn, existing.apn),
      prefer(input.county, existing.county), prefer(input.state, existing.state), prefer(input.price, existing.price), prefer(input.priceKind, existing.price_kind),
      prefer(input.saleOrListDate, existing.sale_or_list_date), prefer(input.acres, existing.acres), prefer(input.pricePerAcre, existing.price_per_acre),
      prefer(input.notes, existing.notes), prefer(input.status, existing.status), prefer(input.lat, existing.lat), prefer(input.lng, existing.lng),
      prefer(input.canonicalSource, existing.canonical_source), prefer(input.city, existing.city), prefer(input.zip, existing.zip),
      prefer(input.distanceMiles, existing.distance_miles), prefer(input.listingDate, existing.listing_date), prefer(input.daysOnMarket, existing.days_on_market),
      prefer(input.propertyClass, existing.property_class), prefer(input.classification, existing.classification), prefer(input.thumbnailUrl, existing.thumbnail_url),
      prefer(input.retrievedAt, existing.retrieved_at), prefer(input.radiusMiles, existing.radius_miles), prefer(input.dateWindowMonths, existing.date_window_months),
      prefer(input.inclusionReason, existing.inclusion_reason), JSON.stringify(attributions), key, existing.id,
    );
  return getComp(existing.id)!;
}

/**
 * Delete a single comp by id. Used by the Deal Card delete-comp-and-rerun flow:
 * removal is explicit and audited; there is NO backfill and NO re-search. Returns
 * true when a row was removed. Logs the override to the audit trail.
 */
export function deleteComp(id: number, opts: { actor?: string; reason?: string } = {}): boolean {
  const db = getLandosDb();
  const existing = getComp(id);
  if (!existing) return false;
  const res = db.prepare('DELETE FROM landos_comp WHERE id = ?').run(id);
  const removed = (res.changes ?? 0) > 0;
  if (removed) {
    landosAudit(
      opts.actor ?? 'tyler/manual',
      'comp_deleted',
      `deal ${existing.deal_card_id} comp ${id} removed (${existing.source_label})${opts.reason ? `: ${opts.reason}` : ''}; offer recomputed off survivors (no backfill, no re-search)`,
      { entity: existing.entity as LandosEntity, refTable: 'landos_comp', refId: id },
    );
  }
  return removed;
}

export function listComps(opts: { dealCardId?: number; cardId?: number; limit?: number } = {}): CompRow[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 200, 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.dealCardId !== undefined) { where.push('deal_card_id = ?'); args.push(opts.dealCardId); }
  if (opts.cardId !== undefined) { where.push('card_id = ?'); args.push(opts.cardId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return db.prepare(`SELECT * FROM landos_comp ${clause}ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit) as CompRow[];
}

export type ListingFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const validUsPoint = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= 18 && lat <= 72 && lng >= -180 && lng <= -60;

/** Extract only an explicit property coordinate from a supported listing page.
 * Nearby cards and generic map centers are intentionally ignored. */
export function extractListingCoordinates(html: string, address: string, sourceUrl: string): { lat: number; lng: number; provider: string } | null {
  if (!html || !address || !sourceUrl) return null;
  let host = '';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
  const zip = address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  if (zip && !html.includes(zip)) return null;
  const point = (latRaw: string, lngRaw: string, provider: string) => {
    const lat = Number(latRaw); const lng = Number(lngRaw);
    return validUsPoint(lat, lng) ? { lat, lng, provider } : null;
  };
  if (host.endsWith('coldwellbanker.com')) {
    const match = html.match(/["']geo["']\s*:\s*\{[\s\S]{0,180}?["']latitude["']\s*:\s*["']?(-?\d+(?:\.\d+)?)["']?[\s\S]{0,100}?["']longitude["']\s*:\s*["']?(-?\d+(?:\.\d+)?)/i);
    return match ? point(match[1], match[2], 'Coldwell Banker listing') : null;
  }
  if (host.endsWith('trulia.com')) {
    const match = html.match(/["']locationLat["']\s*:\s*["'](-?\d+(?:\.\d+)?)["'][\s\S]{0,100}?["']locationLon["']\s*:\s*["'](-?\d+(?:\.\d+)?)["']/i);
    return match ? point(match[1], match[2], 'Trulia listing') : null;
  }
  if (host.endsWith('redfin.com')) {
    const found: Array<{ lat: number; lng: number }> = [];
    const pattern = /["']latitude["']\s*:\s*(-?\d+(?:\.\d+)?)[\s\S]{0,140}?["']longitude["']\s*:\s*(-?\d+(?:\.\d+)?)/gi;
    for (const match of html.matchAll(pattern)) {
      const lat = Number(match[1]); const lng = Number(match[2]);
      if (validUsPoint(lat, lng) && !found.some((item) => item.lat === lat && item.lng === lng)) found.push({ lat, lng });
    }
    return found.length === 1 ? { ...found[0], provider: 'Redfin listing' } : null;
  }
  return null;
}

function safeSuggestion(address: string, suggestion: AddressSuggestion | undefined): suggestion is AddressSuggestion & { coordinates: { lat: number; lng: number } } {
  if (!suggestion?.coordinates || !validUsPoint(suggestion.coordinates.lat, suggestion.coordinates.lng)) return false;
  const expectedState = address.match(/(?:,|\s)\s*([A-Z]{2})(?:\s|,)/)?.[1]?.toUpperCase();
  if (expectedState && suggestion.state?.toUpperCase() !== expectedState) return false;
  const expectedZip = address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  if (expectedZip && suggestion.zip && suggestion.zip !== expectedZip) return false;
  const firstLine = address.split(',')[0].toLowerCase();
  const stop = new Set(['lot', 'unit', 'par', 'parcel', 'road', 'rd', 'drive', 'dr', 'way', 'circle', 'cir', 'highway', 'hwy', 'route', 'acres', 'acre', 'tn']);
  const tokens = firstLine.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((token) => token.length >= 3 && !stop.has(token) && !/^\d+$/.test(token));
  const label = suggestion.label.toLowerCase();
  return tokens.length > 0 && tokens.some((token) => label.includes(token));
}

/**
 * Bounded, free coordinate enrichment for the owner-facing comp map. Provider
 * coordinates win; otherwise a verified-state US Census address match is cached
 * and written onto the persisted comp. Misses are cached too. This is map
 * enrichment only and never participates in subject parcel identity.
 */
export async function enrichCompCoordinates(
  dealCardId: number,
  deps: { fetchImpl?: SuggestFetch; listingFetchImpl?: ListingFetch; max?: number; addresses?: string[] } = {},
): Promise<{ attempted: number; enriched: number; cached: number; unresolved: number }> {
  const db = getLandosDb();
  const keyOf = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const allowed = deps.addresses ? new Set(deps.addresses.map(keyOf)) : null;
  const rows = listComps({ dealCardId, limit: 500 })
    .filter((row) => row.address_desc.trim() && (row.lat == null || row.lng == null) && (!allowed || allowed.has(keyOf(row.address_desc))))
    .slice(0, deps.max ?? 100);
  const cacheGet = db.prepare('SELECT lat, lng, provider FROM landos_geocode_cache WHERE address_key = ?');
  const cachePut = db.prepare(`INSERT INTO landos_geocode_cache (address_key, lat, lng, provider, created_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(address_key) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, provider=excluded.provider, created_at=excluded.created_at`);
  const compUpdate = db.prepare('UPDATE landos_comp SET lat = ?, lng = ? WHERE id = ?');
  let enriched = 0;
  let cached = 0;
  for (const row of rows) {
    const key = keyOf(row.address_desc);
    const hit = cacheGet.get(key) as { lat: number | null; lng: number | null; provider: string } | undefined;
    if (hit) {
      if (typeof hit.lat === 'number' && typeof hit.lng === 'number') { cached++; compUpdate.run(hit.lat, hit.lng, row.id); enriched++; continue; }
      if (hit.provider === 'listing_and_geocode_v2') { cached++; continue; }
    }
    let point: { lat: number; lng: number } | undefined;
    let provider = '';
    if (row.source_url && /(?:redfin|trulia|coldwellbanker)\.com/i.test(row.source_url)) {
      try {
        const listingFetch = deps.listingFetchImpl ?? (globalThis.fetch as unknown as ListingFetch);
        const response = await listingFetch(row.source_url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LandOS/1.0; comp map enrichment)' } });
        if (response.ok) {
          const extracted = extractListingCoordinates(await response.text(), row.address_desc, row.source_url);
          if (extracted) { point = { lat: extracted.lat, lng: extracted.lng }; provider = extracted.provider; }
        }
      } catch { /* fall through to verified free geocoders */ }
    }
    if (!point) {
      for (const suggestProvider of [censusSuggestProvider(), photonProvider()]) {
        const result = await suggestAddresses(row.address_desc, {
          providers: [suggestProvider], fetchImpl: deps.fetchImpl, cache: new SuggestCache(4), limit: 3,
        });
        const suggestion = result.suggestions.find((item) => safeSuggestion(row.address_desc, item));
        if (safeSuggestion(row.address_desc, suggestion)) { point = suggestion.coordinates; provider = suggestion.source; break; }
      }
    }
    cachePut.run(key, point?.lat ?? null, point?.lng ?? null, point ? provider : 'listing_and_geocode_v2');
    if (point) { compUpdate.run(point.lat, point.lng, row.id); enriched++; }
  }
  return { attempted: rows.length, enriched, cached, unresolved: rows.length - enriched };
}
