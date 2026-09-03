// LandOS — manufactured-home evidence enrichment for the Land Home Package screen.
//
// The screen needs each sold manufactured-home record to carry a location (for
// the five-mile boundary) and a closed date. Marketplace search cards often
// omit both. This module recovers them from the record itself, through seams
// LandOS already has: the Redfin record page publishes coordinates and the
// last closed sale; the bounded geocode cache locates a complete address that
// no provider located. Bounded, once per record, never a loop, and it never
// invents a point: a record that stays unlocated stays unlocated.

import { distanceMiles } from './zillow-land-comps.js';
import { fetchRedfinListingDetail, type RedfinListingDetail } from './redfin-land-comps.js';
import { geocodeAddressesToCache, readCachedGeocode } from './comps.js';

export interface ManufacturedHomeRow {
  source?: string;
  address: string | null;
  url?: string | null;
  price?: number | null;
  saleDate?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceMiles?: number | null;
  beds?: number | null;
  baths?: number | null;
  homeType?: string | null;
  apn?: string | null;
  /** Where each recovered fact came from, for lineage. */
  enrichment?: string[];
  /** Fields the record still lacks after enrichment; present only on rows
   *  retained as incomplete context, never on a located, dated sale. */
  incomplete?: string[];
  [key: string]: unknown;
}

export interface ManufacturedHomeEnrichmentDeps {
  readRedfinDetail?: (url: string) => Promise<Pick<RedfinListingDetail, 'status' | 'record'>>;
  geocode?: (addresses: string[]) => Promise<unknown>;
  readGeocode?: (address: string) => { lat: number; lng: number; provider?: string | null } | null;
  /** Record-page reads per run (default 12). */
  max?: number;
  /** The screen radius that decides which rows earn a record-page read. */
  radiusMiles?: number;
}

/** The subject's own street, the way an operator would type it into a search
 *  ("19554 NW 137th Ln" → "NW 137th Ln"). Empty when the address has none. */
export function subjectStreetLocalities(address: string | null | undefined): string[] {
  const street = (address ?? '').replace(/,.*$/, '').replace(/^\s*\d+[A-Za-z]?\s+/, '').replace(/\s+/g, ' ').trim();
  if (!street || /^\d+$/.test(street) || /^(?:parcel|map|lot)\b/i.test(street)) return [];
  return [street];
}

/**
 * Localities already retained for the subject, the way an operator would aim
 * a search: the subject street, the retained subdivision name, and the
 * streets of retained evidence records within the search radius. Read from
 * the research record the lanes already keep; nothing is looked up.
 */
export function retainedLocalitiesForSubject(
  record: { facts?: Record<string, { value?: unknown } | undefined>; evidence?: Array<{ kind?: string; value?: unknown }> } | null | undefined,
  subject: { address?: string | null; lat?: number | null; lng?: number | null },
  radiusMiles = 5,
): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const clean = (value ?? '').replace(/\s+/g, ' ').trim();
    if (clean && !out.some((existing) => existing.toLowerCase() === clean.toLowerCase())) out.push(clean);
  };
  for (const street of subjectStreetLocalities(subject.address)) push(street);
  const subdivision = record?.facts?.Subdivision?.value ?? record?.facts?.subdivision?.value;
  if (typeof subdivision === 'string') {
    // "RIVER OAK PLANTATION S/D" → "River Oak Plantation"
    const name = subdivision.replace(/\b(?:S\/D|SUBDIVISION|SUB|PH(?:ASE)?\s*\w+|UNIT\s*\w+)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (name) push(name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()));
  }
  const subjectPoint = subject.lat != null && subject.lng != null ? { lat: subject.lat, lng: subject.lng } : null;
  for (const item of record?.evidence ?? []) {
    if (item.kind !== 'comp') continue;
    const value = (item.value ?? {}) as { address?: unknown; lat?: unknown; lng?: unknown; distanceMiles?: unknown };
    const address = typeof value.address === 'string' ? value.address : '';
    if (!address) continue;
    const distance = typeof value.distanceMiles === 'number'
      ? value.distanceMiles
      : subjectPoint && typeof value.lat === 'number' && typeof value.lng === 'number'
        ? distanceMiles(subjectPoint, { lat: value.lat, lng: value.lng })
        : null;
    if (distance == null || distance > radiusMiles) continue;
    for (const street of subjectStreetLocalities(address)) push(street);
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

/** First usable coordinate pair from ordered candidates (the lane's initial
 *  read first, then fresher reads taken after other lanes settled). */
export function firstCoordinates(candidates: Array<{ lat?: number | null; lng?: number | null } | null | undefined>): { lat: number; lng: number } | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const { lat, lng } = candidate;
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) return { lat, lng };
  }
  return null;
}

/**
 * Recover location, closed date and home facts for rows that lack them, then
 * restate each row's distance from the subject. Mutates the rows in place so
 * the caller's merged set stays one set.
 */
/** Ordering key for rows without a resolved location: the subject's street
 *  first, then its ZIP, then everything else (board order preserved). */
function unlocatedRank(row: { address: string | null }, subject: { street?: string | null; zip?: string | null }): number {
  const address = (row.address ?? '').toLowerCase();
  const street = (subject.street ?? '').toLowerCase().trim();
  const zip = (subject.zip ?? '').match(/\b\d{5}\b/)?.[0] ?? '';
  if (street && address.includes(street)) return 0;
  if (zip && address.includes(zip)) return 1;
  return 2;
}

export async function enrichManufacturedHomeRows(
  rows: ManufacturedHomeRow[],
  subject: { lat: number | null | undefined; lng: number | null | undefined; street?: string | null; zip?: string | null },
  deps: ManufacturedHomeEnrichmentDeps = {},
): Promise<{ attempted: number; located: number; dated: number }> {
  const readRedfinDetail = deps.readRedfinDetail ?? ((url: string) => fetchRedfinListingDetail(url));
  const geocode = deps.geocode ?? ((addresses: string[]) => geocodeAddressesToCache(addresses));
  const readGeocode = deps.readGeocode ?? readCachedGeocode;
  const radius = deps.radiusMiles ?? 5;
  const maxDetailReads = deps.max ?? 12;
  let attempted = 0;
  let located = 0;
  let dated = 0;
  const restate = (row: ManufacturedHomeRow) => {
    row.distanceMiles = row.lat != null && row.lng != null && subject.lat != null && subject.lng != null
      ? distanceMiles({ lat: subject.lat, lng: subject.lng }, { lat: row.lat, lng: row.lng })
      : row.distanceMiles ?? null;
  };
  // Phase 1: locate every unlocated row through the bounded geocode cache (a
  // fast, free address match) so the five-mile boundary can be applied to the
  // whole board before any provider page is opened.
  for (const row of rows) {
    const needsLocation = row.lat == null || row.lng == null;
    if (needsLocation && row.address) {
      try {
        await geocode([row.address]);
        const point = readGeocode(row.address);
        if (point) { row.lat = point.lat; row.lng = point.lng; (row.enrichment ??= []).push(`coordinates: geocode cache${point.provider ? ` (${point.provider})` : ''}`); located += 1; }
      } catch { /* unlocated stays unlocated */ }
    }
    restate(row);
  }
  // Phase 2: the record page, for rows the screen can actually use (inside the
  // radius, or still unlocated), that lack a closed date or a provider-exact
  // location. Nearest first, bounded, once per record.
  const wantsDetail = (row: ManufacturedHomeRow) =>
    !!row.url && /redfin\.com\//i.test(row.url) && (!row.saleDate || row.lat == null || row.lng == null)
    && (row.distanceMiles == null || row.distanceMiles <= radius);
  // Nearest located rows first; among rows the geocode could not place, the
  // subject's own street, then its ZIP, then the rest, so a same-street sale
  // the cache cannot locate is read before a row across the county.
  const priority = (row: ManufacturedHomeRow): number => row.distanceMiles != null ? row.distanceMiles : 1e6 + unlocatedRank(row, subject);
  const ordered = rows.filter(wantsDetail).sort((a, b) => priority(a) - priority(b));
  for (const row of ordered) {
    if (attempted >= maxDetailReads) break;
    attempted += 1;
    const lineage = row.enrichment ?? [];
    const needsDate = !row.saleDate;
    try {
      const detail = await readRedfinDetail(row.url as string);
      const facts = detail.status === 'retrieved' ? detail.record ?? null : null;
      if (facts) {
        if (facts.lat != null && facts.lng != null) {
          if (row.lat == null || row.lng == null) located += 1;
          row.lat = facts.lat; row.lng = facts.lng;
          lineage.push('coordinates: Redfin record page');
        }
        if (needsDate && facts.lastSoldDate) { row.saleDate = facts.lastSoldDate; lineage.push('sale date: Redfin record page'); dated += 1; }
        if (row.price == null && facts.lastSoldPrice != null) { row.price = facts.lastSoldPrice; lineage.push('sale price: Redfin record page'); }
        if (row.beds == null && facts.beds != null) row.beds = facts.beds;
        if (row.baths == null && facts.baths != null) row.baths = facts.baths;
        if (!row.homeType && facts.homeTypeLabel) row.homeType = facts.homeTypeLabel;
        if (!row.apn && facts.apn) row.apn = facts.apn;
        if ((row as { acres?: number | null }).acres == null && facts.lotAcres != null) { (row as { acres?: number | null }).acres = facts.lotAcres; lineage.push('acreage: Redfin record page'); }
      }
    } catch { /* the row keeps what the card stated */ }
    if (lineage.length) row.enrichment = lineage;
    restate(row);
  }
  for (const row of rows) restate(row);
  return { attempted, located, dated };
}

/**
 * The rows the Land Home Package screen can use, in the order it uses them:
 * located sales inside the radius nearest first (at most `maxWithinRadius`),
 * then at most `maxIncomplete` records that could not be located or dated,
 * each stamped with the fields it is missing so the screen reads them as
 * incomplete context rather than as qualifying evidence. Everything else on
 * the board is counted, never padded into the retained set.
 */
export function selectManufacturedHomeRows(
  rows: ManufacturedHomeRow[],
  options: { radiusMiles?: number; maxWithinRadius?: number; maxIncomplete?: number; subject?: { street?: string | null; zip?: string | null } } = {},
): { retained: ManufacturedHomeRow[]; withinRadius: number; beyondRadius: number; incomplete: number; notRetained: number } {
  const radius = options.radiusMiles ?? 5;
  const within = rows.filter((row) => row.distanceMiles != null && row.distanceMiles <= radius).sort((a, b) => (a.distanceMiles as number) - (b.distanceMiles as number));
  const beyond = rows.filter((row) => row.distanceMiles != null && row.distanceMiles > radius);
  const subject = options.subject ?? {};
  const unlocated = rows.filter((row) => row.distanceMiles == null).sort((a, b) => unlocatedRank(a, subject) - unlocatedRank(b, subject));
  const incomplete = unlocated.map((row) => {
    const missing = [row.lat == null || row.lng == null ? 'coordinates' : null, !row.saleDate ? 'saleDate' : null].filter((field): field is string => !!field);
    return { ...row, incomplete: missing };
  });
  const retained = [...within.slice(0, options.maxWithinRadius ?? 10), ...incomplete.slice(0, options.maxIncomplete ?? 5)];
  return { retained, withinRadius: within.length, beyondRadius: beyond.length, incomplete: unlocated.length, notRetained: rows.length - retained.length };
}
