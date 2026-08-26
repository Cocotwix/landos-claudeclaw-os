import { getLandosDb } from '../landos/db.js';
import { logger } from '../logger.js';

/**
 * Keyless geocoding for God's Eye View manual address/place search.
 *
 * Search hierarchy (operator requirement):
 *  1. Known LandOS subject property — canonical coordinates from the property
 *     card (vacant-land "0 ..." addresses rarely geocode publicly; the
 *     canonical subject must win and be labeled as the LandOS subject, never
 *     a manufactured street-address coordinate).
 *  2. Nominatim (OpenStreetMap) free forward geocoding — the same governed
 *     free provider the regional-brief stack already uses in reverse.
 *  3. Honest empty result — the client shows "Location not found", never a
 *     silent fall back to the default demo location.
 *
 * No Google involvement, no credentials, no paid providers.
 */

export interface GevGeocodeCandidate {
  source: 'landos' | 'nominatim';
  label: string;
  lat: number;
  lon: number;
  /** Nominatim bounding box as [south, north, west, east] when available. */
  boundingBox?: [number, number, number, number];
  category?: string | null;
  propertyCardId?: number;
}

interface PropertyCardRowLite {
  id: number;
  active_input_address: string | null;
  lat: number | null;
  lng: number | null;
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pure matcher: does this query name a known LandOS property? The street
 * segment (text before the first comma) must appear in the card address, and
 * any city/state segments the operator typed must not contradict it.
 * Exported for tests.
 */
export function matchLandosProperty(
  query: string,
  rows: readonly PropertyCardRowLite[],
): PropertyCardRowLite | null {
  const segments = query.split(',').map((segment) => normalize(segment)).filter(Boolean);
  if (!segments.length) return null;
  // Vacant-land convention: a leading lone "0 " is a placeholder house
  // number ("0 Kingwood Blvd"), and the assessor situs often carries the bare
  // street ("KINGWOOD BLVD") — match on the street itself.
  const street = segments[0].replace(/^0 /, '');
  if (street.length < 4) return null;
  // All known address forms of one card together decide city/state
  // consistency — a bare assessor situs ("KINGWOOD BLVD") matches the street
  // while the deal title ("… Fairview, TN") carries the locality.
  const byCard = new Map<number, PropertyCardRowLite[]>();
  for (const row of rows) {
    if (row.lat == null || row.lng == null || !row.active_input_address) continue;
    const list = byCard.get(row.id) ?? [];
    list.push(row);
    byCard.set(row.id, list);
  }
  for (const [, aliases] of byCard) {
    // The typed street segment must be an alias's street portion (its start),
    // not merely a substring — "Fairview, TN" is a place query and must fall
    // through to the public geocoder. A bare situs street may also be a
    // prefix of the typed segment (guarded against trivially short aliases).
    const streetHit = aliases.find((alias) => {
      const address = normalize(alias.active_input_address!).replace(/^0 /, '');
      return address.startsWith(street) || (address.length >= 6 && street.startsWith(address));
    });
    if (!streetHit) continue;
    // Every additional typed segment (city, state, zip) must be consistent
    // with SOME known address form of this card — "0 Kingwood Blvd,
    // Nashville" must not match the Fairview subject.
    const combined = aliases.map((alias) => normalize(alias.active_input_address!)).join(' | ');
    const rest = segments.slice(1).filter((segment) => segment.length >= 2);
    const consistent = rest.every((segment) => {
      if (combined.includes(segment)) return true;
      // A zip the operator typed may not appear in any stored alias — pure
      // numbers never veto; words (city, state) must all be known.
      const words = segment.split(' ').filter((word) => word.length >= 2 && !/^\d+$/.test(word));
      return words.every((word) => combined.includes(word));
    });
    if (consistent) return streetHit;
  }
  return null;
}

/**
 * One alias row per known address form of each coordinate-bearing card:
 * the card's active input address, its deal-card title, and the official
 * situs street from the latest property inspection ("Parcel Address" — the
 * assessor's street name, typically without a house number for vacant land).
 */
function readPropertyRows(): PropertyCardRowLite[] {
  const rows = getLandosDb().prepare(`
    SELECT pc.id, pc.lat, pc.lng, pc.active_input_address,
      (SELECT dc.title FROM landos_deal_card_property l JOIN landos_deal_card dc ON dc.id = l.deal_card_id
        WHERE l.card_id = pc.id ORDER BY l.created_at DESC LIMIT 1) AS deal_title,
      (SELECT json_extract(a.ref, '$.parcelFacts."Parcel Address"') FROM landos_card_activity a
        WHERE a.card_id = pc.id AND a.kind = 'property_inspection'
          AND json_extract(a.ref, '$.parcelFacts."Parcel Address"') IS NOT NULL
        ORDER BY a.id DESC LIMIT 1) AS situs
    FROM landos_property_card pc
    WHERE pc.lat IS NOT NULL AND pc.lng IS NOT NULL
  `).all() as Array<PropertyCardRowLite & { deal_title: string | null; situs: string | null }>;
  const aliases: PropertyCardRowLite[] = [];
  for (const row of rows) {
    for (const alias of [row.active_input_address, row.deal_title, row.situs]) {
      if (typeof alias === 'string' && alias.trim()) {
        aliases.push({ id: row.id, active_input_address: alias, lat: row.lat, lng: row.lng });
      }
    }
  }
  return aliases;
}

function landosCandidates(query: string, rowsProvider: () => PropertyCardRowLite[]): GevGeocodeCandidate[] {
  try {
    const rows = rowsProvider();
    const match = matchLandosProperty(query, rows);
    if (!match) return [];
    return [{
      source: 'landos',
      label: `${match.active_input_address} — LandOS subject`,
      lat: match.lat as number,
      lon: match.lng as number,
      category: 'landos_property',
      propertyCardId: match.id,
    }];
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) },
      '[gev-geocode] LandOS property lookup failed; falling through to the free geocoder');
    return [];
  }
}

async function nominatimCandidates(query: string, fetchImpl: typeof fetch): Promise<GevGeocodeCandidate[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  const response = await fetchImpl(url, {
    headers: {
      // Nominatim usage policy requires an identifying User-Agent.
      'User-Agent': 'LandOS/1.1 (local operator application; single-user)',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : [])
    .map((row): GevGeocodeCandidate | null => {
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const box = Array.isArray(row.boundingbox) ? row.boundingbox.map(Number) : null;
      return {
        source: 'nominatim',
        label: typeof row.display_name === 'string' ? row.display_name : `${lat}, ${lon}`,
        lat,
        lon,
        ...(box && box.length === 4 && box.every(Number.isFinite)
          ? { boundingBox: [box[0], box[1], box[2], box[3]] as [number, number, number, number] }
          : {}),
        category: typeof row.type === 'string' ? row.type : null,
      };
    })
    .filter((candidate): candidate is GevGeocodeCandidate => !!candidate);
}

/** Full hierarchy: LandOS subject first, then the free public geocoder. */
export async function gevGeocode(
  query: string,
  deps: { fetchImpl?: typeof fetch; propertyRows?: () => Array<{ id: number; active_input_address: string | null; lat: number | null; lng: number | null }> } = {},
): Promise<{ candidates: GevGeocodeCandidate[] }> {
  const trimmed = query.trim();
  if (!trimmed) return { candidates: [] };
  const landos = landosCandidates(trimmed, deps.propertyRows ?? readPropertyRows);
  let external: GevGeocodeCandidate[] = [];
  try {
    external = await nominatimCandidates(trimmed, deps.fetchImpl ?? fetch);
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) },
      '[gev-geocode] Nominatim lookup failed');
  }
  return { candidates: [...landos, ...external] };
}
