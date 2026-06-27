// Duke property-data normalization.
//
// Turns a LandPortal property_summary (returned by the safe, non-comp
// /property-data lookup) into a clean, source-labeled dashboard contract. Pure +
// deterministic. Never uses coordinates for identity (lat/lng are intentionally
// dropped). Never calls a comp tool. Missing fields are reported as data gaps —
// never invented.

import type { LpPropertySummary } from './landportal-client.js';

export interface DukePropertyIdentity {
  propertyId?: string;
  fips?: string;
  apn?: string;
  county?: string;
  state?: string;
  situsAddress?: string;
  owner?: string;
  mailingAddress?: string;
}

export interface DukeLandFacts {
  acres?: number;
  roadFrontageFt?: number;
  landLocked?: string;
  nearWater?: string;
  wetlandsPct?: number;
  femaPct?: number;
  buildabilityPct?: number;
  buildableAcres?: number;
  slopeAvgDeg?: number;
  buildingAreaSqft?: number;
  landUse?: string;
  /** Zoning code from a provider (e.g. Realie zoningCode). Distinct from landUse;
   *  threaded from the canonical resolve result, never fabricated. */
  zoning?: string;
}

export interface DukeValuation {
  assessedTotal?: number;
  assessedLand?: number;
  marketTotal?: number;
  marketLand?: number;
  tlpEstimate?: number;
  tlpPpa?: number;
  priceAcreCounty?: number;
}

export interface DukeSimilars {
  count?: number;
  ppaMin?: number;
  ppaMax?: number;
  ppaMedian?: number;
  mostRecentYear?: string;
}

/** One individual embedded similar-sale row (from non-comp property_data). */
export interface DukeSimilarSaleRow {
  saleYear?: string;
  salePrice?: number;
  acres?: number;
  pricePerAcre?: number;
  apn?: string;
  propertyId?: string;
  addressOrCounty?: string;
}

export interface DukePropertyData {
  sourceName: 'LandPortal';
  /** Set at lookup time. */
  generatedAt: string;
  identity: DukePropertyIdentity;
  landFacts: DukeLandFacts;
  valuation: DukeValuation;
  similars: DukeSimilars;
  /** Individual embedded similar-sale rows (no comp credit). Empty when only
   *  aggregate stats were returned. */
  similarSales: DukeSimilarSaleRow[];
  /** True only when individual rows are actually present in property_data. */
  similarRowsAvailable: boolean;
  /** Field keys returned empty by the source (missing, not fabricated). */
  dataGaps: string[];
  /** Truth label for every populated field: from a named source. */
  truthLabel: 'verified_fact';
  note: string;
}

function nstr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function nnum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalize a LandPortal property_summary into the Duke dashboard contract.
 * Every populated field carries the implicit 'verified_fact' label (named source
 * = LandPortal). Empty fields are listed in dataGaps. Coordinates are never
 * surfaced. Pure + deterministic (timestamp injectable for tests).
 */
export function normalizeFromLpSummary(
  summary: LpPropertySummary,
  opts: { fips?: string; nowIso?: string } = {},
): DukePropertyData {
  const gaps: string[] = [];
  const want = <T>(key: string, value: T | undefined): T | undefined => {
    if (value === undefined) gaps.push(key);
    return value;
  };

  const mailingParts = [nstr(summary.mailing_address), nstr(summary.mailing_city), nstr(summary.mailing_state)].filter(Boolean);

  const identity: DukePropertyIdentity = {
    propertyId: want('propertyId', nstr(summary.propertyid)),
    fips: want('fips', nstr(opts.fips)),
    apn: want('apn', nstr(summary.apn)),
    county: want('county', nstr(summary.county)),
    state: want('state', nstr(summary.state)),
    situsAddress: want('situsAddress', nstr(summary.situs_address)),
    owner: want('owner', nstr(summary.owner)),
    mailingAddress: mailingParts.length ? mailingParts.join(', ') : (gaps.push('mailingAddress'), undefined),
  };

  const landFacts: DukeLandFacts = {
    acres: want('acres', nnum(summary.lot_size_acres) ?? nnum(summary.calc_acres)),
    roadFrontageFt: want('roadFrontageFt', nnum(summary.road_frontage_ft)),
    landLocked: want('landLocked', nstr(summary.land_locked)),
    nearWater: want('nearWater', nstr(summary.near_water)),
    wetlandsPct: want('wetlandsPct', nnum(summary.wetlands_pct)),
    femaPct: want('femaPct', nnum(summary.fema_pct)),
    buildabilityPct: want('buildabilityPct', nnum(summary.buildability_pct)),
    buildableAcres: want('buildableAcres', nnum(summary.buildability_acres)),
    slopeAvgDeg: want('slopeAvgDeg', nnum(summary.slope_avg_deg)),
    buildingAreaSqft: want('buildingAreaSqft', nnum(summary.building_area_sqft)),
    landUse: want('landUse', nstr(summary.land_use)),
  };

  const valuation: DukeValuation = {
    assessedTotal: want('assessedTotal', nnum(summary.assessed_total)),
    assessedLand: want('assessedLand', nnum(summary.assessed_land)),
    marketTotal: want('marketTotal', nnum(summary.market_total)),
    marketLand: want('marketLand', nnum(summary.market_land)),
    tlpEstimate: want('tlpEstimate', nnum(summary.tlp_estimate)),
    tlpPpa: want('tlpPpa', nnum(summary.tlp_ppa)),
    priceAcreCounty: want('priceAcreCounty', nnum(summary.price_acre_county)),
  };

  // Similar sales embedded in property_data (no comp credit consumed).
  const similars: DukeSimilars = {
    count: nnum(summary.similars_count),
    ppaMin: nnum(summary.similars_ppa_min),
    ppaMax: nnum(summary.similars_ppa_max),
    ppaMedian: nnum(summary.similars_ppa_median),
    mostRecentYear: nstr(summary.similars_most_recent_year),
  };
  if (!(similars.count && similars.count > 0)) gaps.push('similars');

  // Individual embedded rows, if the non-comp response carried them.
  const similarSales: DukeSimilarSaleRow[] = Array.isArray(summary.similar_sales)
    ? summary.similar_sales.map((r) => ({
        saleYear: nstr(r.saleYear),
        salePrice: nnum(r.salePrice),
        acres: nnum(r.acres),
        pricePerAcre: nnum(r.pricePerAcre),
        apn: nstr(r.apn),
        propertyId: nstr(r.propertyId),
        addressOrCounty: nstr(r.addressOrCounty),
      }))
    : [];
  const similarRowsAvailable = similarSales.length > 0;

  return {
    sourceName: 'LandPortal',
    generatedAt: opts.nowIso ?? new Date().toISOString(),
    identity,
    landFacts,
    valuation,
    similars,
    similarSales,
    similarRowsAvailable,
    dataGaps: gaps,
    truthLabel: 'verified_fact',
    note: 'LandPortal non-comp property data. Similar sales are embedded in property_data and consume no comp credit. Coordinates are not used for identity.',
  };
}
