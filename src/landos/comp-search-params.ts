// LandOS comp search-params layer — density-adaptive, identity-safe.
//
// Builds the search plan the two-stage Redfin flow uses: WHERE to search (a
// trusted centroid), HOW WIDE (radius stepping 2 -> 5 -> 10mi ceiling, stop at 5
// comps), and HOW comps are ranked (crow-flies distance). It NEVER invents a
// location.
//
// HARD RULES:
//   - Identity = APN + county against authoritative records. Coordinates are an
//     OUTPUT read from the matched record — NEVER an input for identity.
//   - Trusted centroid only:
//       Tier A  parcel pinned (e.g. LandPortal APN -> coords): TIGHT radius.
//       Tier B  area-level (ZIP / county / address centroid): labeled
//               "area-level, parcel not pinned — verify in underwriting".
//     No centroid at all -> no plan (the provider returns a graceful no_comps).
//   - Beyond the 10mi ceiling without enough comps -> "thin comp data" tag.

import type { CompQuery } from './comp-retrieval.js';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Density-adaptive radius ladder (miles). Stop stepping once enough comps land. */
export const RADIUS_STEPS_MILES = [2, 5, 10] as const;
export const RADIUS_CEILING_MILES = 10;
export const TARGET_COMP_COUNT = 5;
/** Tier A (parcel pinned) starts tight; Tier B (area-level) starts wider. */
export const TIER_A_START_RADIUS_MILES = 2;
export const TIER_B_START_RADIUS_MILES = 5;

export const AREA_LEVEL_TAG = 'area-level, parcel not pinned — verify in underwriting';
export const THIN_DATA_TAG = 'thin comp data (beyond 10mi) — verify in underwriting';

const EARTH_RADIUS_MILES = 3958.7613;
/** Approx miles per degree latitude; longitude scaled by cos(lat). */
const MILES_PER_DEG_LAT = 69.0;

/** A single search step: a radius and the viewport/URL to search at that radius. */
export interface CompSearchStep {
  radiusMiles: number;
  viewport: Viewport;
  searchUrl: string;
}

export interface Viewport {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CompSearchPlan {
  /** Trusted centroid, or null when none could be established (no fabrication). */
  centroid: LatLng | null;
  /** A = parcel pinned (tight), B = area-level (wider, caveated), null = none. */
  tier: 'A' | 'B' | null;
  /** Human label carried onto comps for surfacing. */
  tierLabel: string;
  /** True for Tier B — comps inherit the area-level caveat. */
  areaLevel: boolean;
  /** Identity key (APN + county). Coordinates are NOT part of identity. */
  identity: { apn: string | null; county: string | null; state: string | null };
  /** Radius ladder for stepping, ceiling-capped. First entry is the start radius. */
  steps: CompSearchStep[];
  /** Convenience: the start radius (steps[0].radiusMiles) or 0 when no centroid. */
  radiusMiles: number;
  /** Convenience: start-step viewport (or null). */
  viewport: Viewport | null;
  /** Convenience: start-step search URL (or '' when no centroid). */
  searchUrl: string;
  /** Set true by the caller/provider when all steps are exhausted under target. */
  thin: boolean;
  reason: string;
}

export interface PlanCompSearchOpts {
  /** Explicit trusted centroid override (e.g. resolved live from LandPortal APN). */
  centroid?: LatLng | null;
  /** Tier of the supplied/resolved centroid. */
  tier?: 'A' | 'B';
}

/** Great-circle distance in miles between two points (haversine). Pure. */
export function crowFliesMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_MILES * c * 100) / 100;
}

/** Square viewport around a centroid for a given radius (miles). Pure. */
export function viewportFor(centroid: LatLng, radiusMiles: number): Viewport {
  const dLat = radiusMiles / MILES_PER_DEG_LAT;
  const cos = Math.max(0.01, Math.cos((centroid.lat * Math.PI) / 180));
  const dLng = radiusMiles / (MILES_PER_DEG_LAT * cos);
  return {
    north: round6(centroid.lat + dLat),
    south: round6(centroid.lat - dLat),
    east: round6(centroid.lng + dLng),
    west: round6(centroid.lng - dLng),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Best-effort Redfin viewport search URL. The exact city-scoped path needs a
 *  region id we do not have offline; this generic viewport URL is what the
 *  search actor consumes. Documented as verify-live. */
export function searchUrlFor(vp: Viewport): string {
  const v = `${vp.north}:${vp.south}:${vp.east}:${vp.west}`;
  return `https://www.redfin.com/?viewport=${encodeURIComponent(v)},no-outline`;
}

/** The ceiling-capped radius ladder starting at startRadius. */
export function radiusLadder(startRadius: number): number[] {
  return RADIUS_STEPS_MILES.filter((r) => r >= startRadius && r <= RADIUS_CEILING_MILES);
}

/** Identity key for matching against authoritative records: APN + county (+state).
 *  Coordinates are deliberately NOT part of this key. */
export function identityKey(q: { apn?: string; county?: string; state?: string }): string {
  return [q.apn?.trim() || '', q.county?.trim() || '', q.state?.trim() || '']
    .map((s) => s.toLowerCase())
    .join('|');
}

/** True when a candidate matches the subject identity by APN + county (+state),
 *  never by coordinates. Requires a non-empty APN to assert identity. */
export function matchesIdentity(
  subject: { apn?: string; county?: string; state?: string },
  candidate: { apn?: string | null; county?: string | null; state?: string | null },
): boolean {
  const sa = subject.apn?.trim().toLowerCase();
  const ca = candidate.apn?.trim().toLowerCase();
  if (!sa || !ca) return false; // no APN -> cannot assert identity (never coord-based)
  if (sa !== ca) return false;
  const sc = subject.county?.trim().toLowerCase();
  const cc = candidate.county?.trim().toLowerCase();
  if (sc && cc && sc !== cc) return false;
  const ss = subject.state?.trim().toLowerCase();
  const cs = candidate.state?.trim().toLowerCase();
  if (ss && cs && ss !== cs) return false;
  return true;
}

/**
 * Plan a density-adaptive comp search from a TRUSTED centroid. A centroid may be
 * supplied via opts (Tier A from a LandPortal APN->coords lookup, or Tier B from
 * an area centroid) or read from query.centroid. With NO trusted centroid the
 * plan has centroid=null and the provider returns a graceful no_comps — a
 * location is never invented. Pure + deterministic.
 */
export function planCompSearch(query: CompQuery, opts: PlanCompSearchOpts = {}): CompSearchPlan {
  const identity = {
    apn: query.apn?.trim() || null,
    county: query.county?.trim() || null,
    state: query.state?.trim() || null,
  };

  const supplied = opts.centroid ?? query.centroid ?? null;
  const tier: 'A' | 'B' | null = supplied ? opts.tier ?? query.centroidTier ?? 'B' : null;

  if (!supplied || !Number.isFinite(supplied.lat) || !Number.isFinite(supplied.lng)) {
    return {
      centroid: null,
      tier: null,
      tierLabel: 'no trusted centroid (APN->coords or area centroid required)',
      areaLevel: false,
      identity,
      steps: [],
      radiusMiles: 0,
      viewport: null,
      searchUrl: '',
      thin: false,
      reason: 'no trusted centroid available (LandPortal APN->coords or ZIP/county centroid required); a location is never invented',
    };
  }

  const centroid: LatLng = { lat: supplied.lat, lng: supplied.lng };
  const areaLevel = tier === 'B';
  const start = tier === 'A' ? TIER_A_START_RADIUS_MILES : TIER_B_START_RADIUS_MILES;
  const ladder = radiusLadder(start);
  const steps: CompSearchStep[] = ladder.map((radiusMiles) => {
    const viewport = viewportFor(centroid, radiusMiles);
    return { radiusMiles, viewport, searchUrl: searchUrlFor(viewport) };
  });
  const tierLabel = tier === 'A'
    ? 'parcel pinned (APN->coords), tight radius'
    : AREA_LEVEL_TAG;

  return {
    centroid,
    tier,
    tierLabel,
    areaLevel,
    identity,
    steps,
    radiusMiles: steps[0]?.radiusMiles ?? start,
    viewport: steps[0]?.viewport ?? null,
    searchUrl: steps[0]?.searchUrl ?? '',
    thin: false,
    reason: tier === 'A'
      ? `Tier A: parcel pinned, stepping ${ladder.join('->')}mi (stop at ${TARGET_COMP_COUNT} comps)`
      : `Tier B: ${AREA_LEVEL_TAG}; stepping ${ladder.join('->')}mi (stop at ${TARGET_COMP_COUNT} comps)`,
  };
}
