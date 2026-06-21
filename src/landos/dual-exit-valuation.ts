// LandOS dual-exit valuation (vacant land).
//
// A vacant parcel can exit two ways, valued from two DIFFERENT comp sets:
//   Exit A  Vacant land        -> raw-land sold comps (the primary pull).
//   Exit B  Land-home package   -> a SECOND pull of manufactured-home sales on
//           OWNED land (in-park / lot-rent excluded upstream by in-park-filter).
//
// Exit B is only a real exit when BOTH gates pass:
//   - Market gate: owned-land manufactured sales reach ~$200k (the land-home
//     viability band from the offer engine).
//   - Zoning gate (by-right proxy): an owned-land manufactured home actually SOLD
//     within ~2mi of the subject implies manufactured homes are placeable
//     by-right nearby. No nearby owned-land manufactured sale -> "verify zoning"
//     (never assumed; never fabricated).
//
// Pure + deterministic. Never seller-facing. Never invents a comp or a price.

import { crowFliesMiles, type LatLng } from './comp-search-params.js';
import { LAND_HOME_GATE } from './offer-engine.js';
import type { DetailComp } from './providers/apify-comp-provider.js';

/** Market gate: owned-land manufactured sales must reach this to support Exit B. */
export const MANUFACTURED_MARKET_GATE_USD = LAND_HOME_GATE.minVerifiedSaleUsd; // $200k
/** By-right proxy radius: an owned-land manufactured sale within this distance. */
export const BY_RIGHT_PROXY_RADIUS_MILES = 2;

export interface DualExitInput {
  /** Subject centroid for distance gating. Null -> zoning proxy cannot be checked. */
  subjectCentroid?: LatLng | null;
  /** Verifiable raw-land sold comps (Exit A). Count drives Exit A viability. */
  vacantLandCompCount: number;
  /** Owned-land manufactured comps (Exit B) AFTER the in-park filter removed
   *  lot-rent/HOA/ambiguous records. Each may carry a sold price + lat/long. */
  manufacturedOwnedLandComps: DetailComp[];
}

export interface ExitAssessment {
  exit: 'vacant_land' | 'land_home_package';
  viable: boolean;
  reasons: string[];
}

export interface DualExitResult {
  vacantLand: ExitAssessment;
  landHome: ExitAssessment & {
    marketGatePassed: boolean;
    zoningByRightProxy: boolean;
    /** Highest owned-land manufactured sold price observed (USD) or null. */
    topManufacturedSaleUsd: number | null;
    /** Nearest owned-land manufactured sale distance (miles) or null. */
    nearestManufacturedMiles: number | null;
  };
  /** The exit(s) the data actually supports, most-supported first. */
  recommendedExits: Array<'vacant_land' | 'land_home_package'>;
  notes: string[];
}

/**
 * Assess both exits from the two comp sets. Pure. Exit B (land-home) is viable
 * only when the market gate (~$200k owned-land manufactured sales) AND the
 * by-right zoning proxy (an owned-land manufactured sale within ~2mi) both hold.
 * Anything short is surfaced loudly ("verify zoning" / "market gate not met"),
 * never silently dropped.
 */
export function assessDualExit(input: DualExitInput): DualExitResult {
  const notes: string[] = [];

  // ── Exit A: vacant land ────────────────────────────────────────────────────
  const vacantViable = input.vacantLandCompCount > 0;
  const vacantLand: ExitAssessment = {
    exit: 'vacant_land',
    viable: vacantViable,
    reasons: [
      vacantViable
        ? `${input.vacantLandCompCount} verifiable raw-land comp(s): vacant-land exit supported.`
        : 'No verifiable raw-land comps: vacant-land exit unsupported (none invented).',
    ],
  };

  // ── Exit B: land-home package (manufactured on owned land) ─────────────────
  const owned = input.manufacturedOwnedLandComps;
  const pricedSales = owned
    .map((c) => c.soldPriceUsd)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const topManufacturedSaleUsd = pricedSales.length ? Math.max(...pricedSales) : null;
  const marketGatePassed = pricedSales.some((p) => p >= MANUFACTURED_MARKET_GATE_USD);

  // Zoning by-right proxy: nearest owned-land manufactured sale within radius.
  let nearestManufacturedMiles: number | null = null;
  if (input.subjectCentroid) {
    for (const c of owned) {
      if (c.latitude === null || c.longitude === null) continue;
      const d = crowFliesMiles(input.subjectCentroid, { lat: c.latitude, lng: c.longitude });
      if (nearestManufacturedMiles === null || d < nearestManufacturedMiles) nearestManufacturedMiles = d;
    }
  }
  const zoningByRightProxy =
    nearestManufacturedMiles !== null && nearestManufacturedMiles <= BY_RIGHT_PROXY_RADIUS_MILES;

  const landHomeReasons: string[] = [];
  if (owned.length === 0) {
    landHomeReasons.push('No owned-land manufactured comps survived the in-park filter: land-home exit unsupported (none invented).');
  }
  landHomeReasons.push(
    marketGatePassed
      ? `Market gate passed: an owned-land manufactured home sold at or above $${MANUFACTURED_MARKET_GATE_USD.toLocaleString()} (top $${(topManufacturedSaleUsd ?? 0).toLocaleString()}).`
      : `Market gate NOT met: no owned-land manufactured sale reaches $${MANUFACTURED_MARKET_GATE_USD.toLocaleString()}${topManufacturedSaleUsd !== null ? ` (top $${topManufacturedSaleUsd.toLocaleString()})` : ' (no priced sales)'}.`,
  );
  if (!input.subjectCentroid) {
    landHomeReasons.push('Subject centroid unavailable: by-right zoning proxy cannot be checked — verify zoning.');
  } else if (zoningByRightProxy) {
    landHomeReasons.push(`Zoning by-right proxy: an owned-land manufactured home sold ${nearestManufacturedMiles}mi away (<= ${BY_RIGHT_PROXY_RADIUS_MILES}mi) — placement likely by-right. Still confirm with the county.`);
  } else {
    landHomeReasons.push(`No owned-land manufactured sale within ${BY_RIGHT_PROXY_RADIUS_MILES}mi${nearestManufacturedMiles !== null ? ` (nearest ${nearestManufacturedMiles}mi)` : ''}: verify zoning (no by-right proxy).`);
  }

  const landHomeViable = marketGatePassed && zoningByRightProxy;
  const landHome = {
    exit: 'land_home_package' as const,
    viable: landHomeViable,
    reasons: landHomeReasons,
    marketGatePassed,
    zoningByRightProxy,
    topManufacturedSaleUsd,
    nearestManufacturedMiles,
  };

  const recommendedExits: Array<'vacant_land' | 'land_home_package'> = [];
  if (landHomeViable) recommendedExits.push('land_home_package');
  if (vacantViable) recommendedExits.push('vacant_land');
  if (recommendedExits.length === 0) notes.push('Neither exit is fully supported by the current comp sets. Pull more comps or verify manually.');

  return { vacantLand, landHome, recommendedExits, notes };
}
