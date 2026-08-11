export type AcreageRegime = 'micro' | 'small' | 'mid' | 'large' | 'very_large';

export interface AcreagePool {
  min: number;
  max: number;
  label: string;
}

export interface AcreageRoute {
  subjectAcres: number;
  regime: AcreageRegime;
  regimeLabel: string;
  pool: AcreagePool;
  preferred: AcreagePool;
  tightAcreageMatching: boolean;
  rankingEmphasis: string[];
  rationale: string;
}

const rounded = (value: number): number => Math.round(value * 10_000) / 10_000;

function pool(subjectAcres: number, lowRatio: number, highRatio: number): AcreagePool {
  const min = rounded(subjectAcres * lowRatio);
  const max = rounded(subjectAcres * highRatio);
  return { min, max, label: `${min}–${max} acres` };
}

export function routeAcreage(subjectAcres: number | null | undefined): AcreageRoute | null {
  if (typeof subjectAcres !== 'number' || !Number.isFinite(subjectAcres) || subjectAcres <= 0) return null;

  if (subjectAcres < 2) {
    return {
      subjectAcres,
      regime: 'micro',
      regimeLabel: 'Micro parcel (under 2 acres)',
      pool: pool(subjectAcres, 0.6, 1.75),
      preferred: pool(subjectAcres, 0.8, 1.25),
      tightAcreageMatching: true,
      rankingEmphasis: ['acreage similarity', 'location', 'sale recency', 'vacant-land use'],
      rationale: 'Micro-parcel dollars per acre change sharply with small size differences, so participation stays close to the subject before location and recency rank the survivors.',
    };
  }
  if (subjectAcres < 10) {
    return {
      subjectAcres,
      regime: 'small',
      regimeLabel: 'Small acreage (2 to under 10 acres)',
      pool: pool(subjectAcres, 0.5, 2),
      preferred: pool(subjectAcres, 0.75, 1.35),
      tightAcreageMatching: true,
      rankingEmphasis: ['acreage similarity', 'location', 'sale recency', 'access and utilities'],
      rationale: 'Small-acreage buyers price meaningful differences between nearby size bands, so the pool stays comparatively tight and similarity remains a leading rank signal.',
    };
  }
  if (subjectAcres < 30) {
    return {
      subjectAcres,
      regime: 'mid',
      regimeLabel: 'Mid acreage (10 to under 30 acres)',
      pool: pool(subjectAcres, 0.5, 2),
      preferred: pool(subjectAcres, 0.7, 1.4),
      tightAcreageMatching: true,
      rankingEmphasis: ['acreage similarity', 'location', 'sale recency', 'access and development context'],
      rationale: 'Mid-acreage pricing still changes materially by tract size, so a controlled pool protects per-acre comparability while other evidence ranks close matches.',
    };
  }
  if (subjectAcres <= 100) {
    return {
      subjectAcres,
      regime: 'large',
      regimeLabel: 'Large acreage (30 through 100 acres)',
      pool: pool(subjectAcres, 0.35, 2.5),
      preferred: pool(subjectAcres, 0.65, 1.5),
      tightAcreageMatching: false,
      rankingEmphasis: ['location and market reach', 'sale recency', 'access and utilities', 'terrain and development context'],
      rationale: 'Large tracts trade in a sparse market where exact acreage stops discriminating well, so the pool deliberately spans 0.35×–2.5× and lets geography and property evidence rank it.',
    };
  }
  return {
    subjectAcres,
    regime: 'very_large',
    regimeLabel: 'Very large acreage (over 100 acres)',
    pool: pool(subjectAcres, 0.35, 2.5),
    preferred: pool(subjectAcres, 0.6, 1.6),
    tightAcreageMatching: false,
    rankingEmphasis: ['market reach and location', 'sale recency', 'access and utilities', 'terrain and development context'],
    rationale: 'Very large tracts produce few exact-size sales, so the broad 0.35×–2.5× pool preserves real market evidence and relies on location and tract characteristics for ranking.',
  };
}

export function inAcreagePool(
  acres: number | null | undefined,
  route: AcreageRoute | null,
): boolean {
  if (route == null) return true;
  return typeof acres === 'number'
    && Number.isFinite(acres)
    && acres >= route.pool.min
    && acres <= route.pool.max;
}

export function routedAcreageSimilarity(
  acres: number | null | undefined,
  route: AcreageRoute | null,
): number {
  if (route == null || !inAcreagePool(acres, route) || typeof acres !== 'number') return 0;
  if (acres === route.subjectAcres) return 1;
  const span = acres < route.subjectAcres
    ? route.subjectAcres - route.pool.min
    : route.pool.max - route.subjectAcres;
  if (!(span > 0)) return 1;
  const normalizedDifference = Math.abs(acres - route.subjectAcres) / span;
  return Math.max(0.1, Math.min(1, 1 - normalizedDifference * 0.9));
}

export type GeographicTierId = 'local_10' | 'near_20' | 'regional_35' | 'extended_50' | 'county_market' | 'distance_unresolved';

export interface GeographicTier {
  id: GeographicTierId;
  label: string;
  maxMiles: number | null;
  expanded: boolean;
  retained: boolean;
  weightMultiplier: number;
  rationale: string;
}

export const GEOGRAPHIC_TIERS: readonly GeographicTier[] = [
  { id: 'local_10', label: 'Local (0–10 miles)', maxMiles: 10, expanded: false, retained: true, weightMultiplier: 1, rationale: 'The comp is in the local market and carries full geographic weight.' },
  { id: 'near_20', label: 'Near-market (10–20 miles)', maxMiles: 20, expanded: true, retained: true, weightMultiplier: 0.9, rationale: 'The search expanded beyond the local tier while remaining in the near market.' },
  { id: 'regional_35', label: 'Regional (20–35 miles)', maxMiles: 35, expanded: true, retained: true, weightMultiplier: 0.78, rationale: 'Sparse local evidence required a visible regional expansion past 20 miles.' },
  { id: 'extended_50', label: 'Extended regional (35–50 miles)', maxMiles: 50, expanded: true, retained: true, weightMultiplier: 0.65, rationale: 'The comp is retained through an extended regional search and ranked down for market reach.' },
  { id: 'county_market', label: 'County/market evidence (over 50 miles)', maxMiles: null, expanded: true, retained: true, weightMultiplier: 0.55, rationale: 'The comp remains useful county or broader-market evidence, with distance reducing its rank rather than deleting it.' },
  { id: 'distance_unresolved', label: 'Location unresolved (distance unavailable)', maxMiles: null, expanded: true, retained: true, weightMultiplier: 0.45, rationale: 'The comp location could not be resolved, so no distance is invented; it remains visible at reduced geographic weight.' },
] as const;

export function resolveGeographicTier(distanceMiles: number | null | undefined): GeographicTier {
  if (typeof distanceMiles !== 'number' || !Number.isFinite(distanceMiles) || distanceMiles < 0) {
    return GEOGRAPHIC_TIERS.find((tier) => tier.id === 'distance_unresolved')!;
  }
  return GEOGRAPHIC_TIERS.find((tier) => tier.maxMiles != null && distanceMiles <= tier.maxMiles)
    ?? GEOGRAPHIC_TIERS.find((tier) => tier.id === 'county_market')!;
}

export function compDistanceMiles(
  subject: { lat?: number | null; lng?: number | null } | null | undefined,
  comp: { lat?: number | null; lng?: number | null } | null | undefined,
): number | null {
  const subjectLat = subject?.lat;
  const subjectLng = subject?.lng;
  const compLat = comp?.lat;
  const compLng = comp?.lng;
  if (![subjectLat, subjectLng, compLat, compLng].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (Math.abs(subjectLat as number) > 90 || Math.abs(compLat as number) > 90
    || Math.abs(subjectLng as number) > 180 || Math.abs(compLng as number) > 180) return null;
  const radiusMiles = 3958.7613;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians((compLat as number) - (subjectLat as number));
  const dLng = toRadians((compLng as number) - (subjectLng as number));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(subjectLat as number)) * Math.cos(toRadians(compLat as number)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radiusMiles * Math.asin(Math.sqrt(Math.min(1, h))) * 10) / 10;
}

export function describeGeographicExpansion(input: {
  route: AcreageRoute | null;
  tiersUsed: GeographicTierId[];
  usableCount: number;
}): string {
  const tiers = input.tiersUsed
    .map((id) => GEOGRAPHIC_TIERS.find((tier) => tier.id === id))
    .filter((tier): tier is GeographicTier => tier != null);
  const labels = tiers.length ? tiers.map((tier) => tier.label).join(', ') : 'no populated geographic tier';
  const expansion = tiers.some((tier) => tier.expanded)
    ? 'The search expanded beyond the local 10 miles on purpose; farther or unresolved evidence was retained and ranked down, never discarded on distance alone.'
    : 'The usable evidence stayed within the local 10 miles, so no outward expansion was needed.';
  const unresolved = tiers.some((tier) => tier.id === 'distance_unresolved')
    ? ' Location could not be resolved for that tier, so no distance is invented.'
    : '';
  const acreage = input.route
    ? `${input.route.regimeLabel} uses the ${input.route.pool.label} participation pool.`
    : 'Subject acreage was unavailable, so no acreage route was invented.';
  return `${input.usableCount} usable comp(s) span ${labels}. ${expansion}${unresolved} ${acreage}`;
}

export interface AcreageMarketContext {
  route: AcreageRoute;
  subjectAcres: number;
  usableCount: number;
  pricePerAcre: { low: number | null; mid: number | null; high: number | null } | null;
  tiersUsed: GeographicTierId[];
  expansionExplanation: string;
}

export function buildAcreageMarketContext(input: {
  route: AcreageRoute | null;
  comps: Array<{ acres: number | null; pricePerAcre: number | null; distanceMiles: number | null }>;
}): AcreageMarketContext | null {
  if (input.route == null) return null;
  const usable = input.comps.filter((comp) => inAcreagePool(comp.acres, input.route)
    && typeof comp.pricePerAcre === 'number' && Number.isFinite(comp.pricePerAcre) && comp.pricePerAcre > 0);
  const prices = usable.map((comp) => comp.pricePerAcre as number).sort((a, b) => a - b);
  const midIndex = Math.floor(prices.length / 2);
  const mid = prices.length === 0 ? null
    : prices.length % 2 ? prices[midIndex] : (prices[midIndex - 1] + prices[midIndex]) / 2;
  const tierIds = usable.map((comp) => resolveGeographicTier(comp.distanceMiles).id);
  const tiersUsed = GEOGRAPHIC_TIERS
    .map((tier) => tier.id)
    .filter((id) => tierIds.includes(id));
  const pricePerAcre = prices.length
    ? { low: prices[0], mid, high: prices[prices.length - 1] }
    : null;
  return {
    route: input.route,
    subjectAcres: input.route.subjectAcres,
    usableCount: usable.length,
    pricePerAcre,
    tiersUsed,
    expansionExplanation: describeGeographicExpansion({ route: input.route, tiersUsed, usableCount: usable.length }),
  };
}
