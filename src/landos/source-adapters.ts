// LandOS On-Demand Land Data Source Adapter Registry + Market Pulse Contract.
//
// Sprint 6A. This is the GOVERNED source-adapter foundation that lets LandOS
// look up data for the CURRENT subject property or CURRENT local area only.
// It is NOT a nationwide scraper, NOT a bulk parcel warehouse, NOT a GIS
// download system. It is pure, deterministic, and dependency-free: it makes no
// live external calls, installs nothing, imports no third-party code, calls no
// LandPortal comp tool, uses no paid API, and reads no secret/token.
//
// Hard rules encoded here:
//   - On-demand only: query the current subject/deal/area, never bulk datasets.
//   - LandPortal exact first, but with a bounded exact-source fallback ladder.
//   - GIS is the LAST exact resort, bounded, and assessor/record pages are
//     preferred over interactive GIS maps. GIS that needs login/profile/account
//     creation, manual map hunting, layer toggling, coordinate or proximity
//     search, ambiguous/multiple parcels, an unsupported search, or that exceeds
//     the bounded attempt becomes a logged data gap. Coordinates never identify,
//     infer, or verify a parcel.
//   - Market Pulse is SEPARATE from parcel verification and is eligible on a
//     city/county + state local area even when parcel identity is unverified.
//   - Seller asking price is seller_stated negotiation context only; it never
//     anchors a calculated offer range.
//   - Third-party / open-source code is never installed, executed, imported,
//     vendored, or cloned this sprint. Useful projects are reported as
//     candidates only and require Tyler approval + a security review first.

import { maskFieldLabels } from './intake-normalize.js';

// ─────────────────────────────────────────────────────────────────────────
// Enums / labels
// ─────────────────────────────────────────────────────────────────────────

/** Truth/confidence labels a source finding can carry. Mirrors the deal-card
 *  persistence labels and adds the local-area label for area-only context. */
export const TRUTH_LABELS = [
  'verified',
  'needs_verification',
  'seller_stated',
  'market_context_only',
  'local_area_context_not_parcel_verified',
  'attempted_unverified',
  'not_available',
] as const;
export type TruthLabel = (typeof TRUTH_LABELS)[number];

/** Result of attempting to establish parcel identity. Never derived from
 *  coordinates/proximity. */
export const VERIFICATION_STATUSES = [
  'parcel_verified',
  'local_area_context_not_parcel_verified',
  'unverified',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Adapter availability. Honest: most adapters are not_connected this sprint. */
export const SOURCE_AVAILABILITIES = ['available', 'not_connected', 'planned', 'not_available'] as const;
export type SourceAvailability = (typeof SOURCE_AVAILABILITIES)[number];

/** On-demand scopes ONLY. There is deliberately no bulk/warehouse scope. */
export const ON_DEMAND_SCOPES = [
  'current_subject_property',
  'current_deal_card',
  'current_local_area',
] as const;
export type SourceScope = (typeof ON_DEMAND_SCOPES)[number];

/** Scopes that are explicitly forbidden — used by the bulk guard + tests. */
export const FORBIDDEN_BULK_SCOPES = [
  'nationwide_dataset',
  'county_wide_parcel_layer',
  'bulk_gis_export',
  'parcel_warehouse',
] as const;

export const SOURCE_ADAPTER_IDS = [
  'landportal_exact',
  'county_assessor_exact',
  'county_property_record_exact',
  'county_gis_exact_bounded',
  'exact_public_web_search',
  'socrata_open_data',
  'census_growth',
  'planning_zoning_signal',
  'market_listings_solds',
] as const;
export type SourceAdapterId = (typeof SOURCE_ADAPTER_IDS)[number];

/** Exact-search input kinds an adapter accepts. None are coordinate-based. */
export const EXACT_SEARCH_INPUTS = [
  'full_address',
  'apn_county_state',
  'owner_county_state',
  'lp_url',
  'property_id_fips',
] as const;
export type ExactSearchInput = (typeof EXACT_SEARCH_INPUTS)[number];

/** Catalog of local-area Market Pulse signal kinds. Source-backed only; never
 *  invented, and never entertainment/news fluff. */
export const MARKET_PULSE_SIGNALS = [
  'active_sold_land_activity',
  'relevant_acreage_bands',
  'median_range_price_per_acre',
  'days_on_market',
  'buyer_demand_signal',
  'population_growth_direction',
  'planning_zoning_development_signals',
  'comprehensive_plan_future_land_use',
  'permit_subdivision_infrastructure_activity',
] as const;
export type MarketPulseSignal = (typeof MARKET_PULSE_SIGNALS)[number];

/** Exit strategies the future comp/market data must be able to feed. The source
 *  contract must not block these later evaluations. */
export const SUPPORTED_EXIT_STRATEGIES = [
  'quick_flip',
  'subdivide',
  'land_home_package',
  'improved_property_value_add',
  'teardown_land_only',
  'pass_no_offer',
] as const;

/** The security-review checklist any future third-party code must pass first. */
export const SECURITY_REVIEW_ITEMS = [
  'maintainer_reputation',
  'license',
  'activity',
  'dependency_tree',
  'install_scripts_postinstall_hooks',
  'network_file_access_behavior',
  'secrets_risk',
  'malware_supply_chain_risk',
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Contract interfaces
// ─────────────────────────────────────────────────────────────────────────

export interface AdapterCapability {
  canVerifyParcelIdentity: boolean;
  canProduceMarketPulse: boolean;
  exactSearchInputs: ExactSearchInput[];
  marketPulseSignals: MarketPulseSignal[];
  /** All false this sprint — paid APIs are never used. */
  usesPaidApi: boolean;
  /** Literal false — coordinates/proximity never identify a parcel. */
  usesCoordinatesForIdentity: false;
  /** Literal false — on-demand only, never a bulk dataset/warehouse. */
  bulkDataset: false;
  /** GIS/portals that need login/account are cut off, not pursued. */
  requiresLoginOrAccount: boolean;
}

/** Open-source / third-party security posture for an adapter. Our own adapter
 *  code is not third-party. Anything that would require installing/executing a
 *  third-party package is a candidate only until reviewed + approved. */
export interface ThirdPartyStatus {
  /** Our own LandOS adapter code: not third-party. */
  isThirdPartyCode: boolean;
  installed: boolean;
  executed: boolean;
  /** True when a useful third-party project is merely noted, not used. */
  candidateOnly: boolean;
  requiresSecurityReview: boolean;
}

export interface AdapterTimeoutPolicy {
  maxAttemptMs: number;
  maxAttempts: number;
  /** Stop on ambiguity rather than guessing a parcel. */
  stopOnAmbiguous: true;
  stopOnLoginRequired: true;
  stopOnLayerHunting: true;
}

export interface LandDataSourceAdapter {
  id: SourceAdapterId;
  label: string;
  kind: 'parcel_exact' | 'market_pulse';
  availability: SourceAvailability;
  scope: SourceScope[];
  capability: AdapterCapability;
  timeout: AdapterTimeoutPolicy;
  /** Lower rank = tried earlier in the parcel-verification fallback ladder.
   *  Market-pulse adapters do not participate in the ladder (rank 0). */
  fallbackRank: number;
  thirdParty: ThirdPartyStatus;
  notes: string;
}

export interface ParcelLookupRequest {
  scope: SourceScope;
  text?: string;
  address?: string;
  apn?: string;
  county?: string;
  state?: string;
  fips?: string;
  owner?: string;
  lpUrl?: string;
  propertyId?: string;
}

export interface SourceAttempt {
  adapterId: SourceAdapterId;
  /** Read-only plan: live calls are not made here, so verified is never set by
   *  this module. An attempt is planned, not_connected, skipped, or a data gap. */
  status: 'planned' | 'not_connected' | 'skipped' | 'data_gap';
  reason: string;
  truthLabel: TruthLabel;
}

export interface ParcelLookupResult {
  verificationStatus: VerificationStatus;
  parcelVerified: boolean;
  /** Ordered fallback attempts (the bounded ladder), read-only. */
  ladder: SourceAttempt[];
  truthLabel: TruthLabel;
  localAreaContextLabel?: string;
  dataGaps: string[];
}

export interface LocalAreaContext {
  hasCityState: boolean;
  hasCountyState: boolean;
  areaDescriptor: string;
  label: 'local_area_context_not_parcel_verified' | 'none';
}

export interface MarketPulseRequest {
  scope: SourceScope;
  city?: string;
  county?: string;
  state?: string;
}

export interface MarketPulseResult {
  /** Eligible on city/county + state even when the parcel is unverified. */
  eligible: boolean;
  status: SourceAvailability;
  separateFromParcelVerification: true;
  areaScope: string;
  signalsCatalog: MarketPulseSignal[];
  truthLabel: TruthLabel;
  reason: string;
  localAreaContextLabel?: string;
}

export interface SellerAskContext {
  sellerAskUsd?: number;
  /** Always seller_stated: it is negotiation context, not value evidence. */
  label: 'seller_stated';
  /** Hard rule: seller ask never anchors the calculated offer range. */
  usableForOfferRange: false;
  note: string;
}

export interface GisCutoffConditions {
  requiresLogin?: boolean;
  requiresProfile?: boolean;
  requiresAccountCreation?: boolean;
  manualMapHunting?: boolean;
  layerToggling?: boolean;
  coordinateOrProximitySearch?: boolean;
  ambiguousResults?: boolean;
  multipleParcels?: boolean;
  unsupportedSearch?: boolean;
  exceededTimeout?: boolean;
}

export interface GisCutoffResult {
  cutoff: boolean;
  outcome: 'data_gap' | 'continue';
  reason: string;
  triggered: string[];
}

export interface OpenSourceCandidate {
  name: string;
  purpose: string;
  installed: false;
  executed: false;
  candidateOnly: true;
  requiresSecurityReview: true;
}

export interface ThirdPartySecuritySummary {
  thirdPartyCodeInstalled: false;
  thirdPartyCodeExecuted: false;
  thirdPartyCodeImportedOrVendored: false;
  policy: string;
  candidates: OpenSourceCandidate[];
  requiresTylerApprovalAndSecurityReview: true;
  securityReviewItems: string[];
}

/** The full read-only source/Market Pulse plan surfaced by the intake planner
 *  and the dashboard. */
export interface SourceAdapterPlan {
  onDemandScope: { allowed: SourceScope[]; bulkDatasetsForbidden: true; rule: string };
  adapterReadiness: Array<{
    id: SourceAdapterId;
    label: string;
    kind: LandDataSourceAdapter['kind'];
    availability: SourceAvailability;
    canVerifyParcelIdentity: boolean;
    canProduceMarketPulse: boolean;
  }>;
  parcelFallbackLadder: Array<{ rank: number; adapterId: SourceAdapterId; availability: SourceAvailability; role: string }>;
  landportalFailureFallbackPlan: SourceAttempt[];
  gisCutoff: { rule: string; conditions: string[]; preferAssessorOverGis: true };
  marketPulse: MarketPulseResult;
  parcelVerification: ParcelLookupResult;
  sellerAsk: SellerAskContext;
  thirdPartySecurity: ThirdPartySecuritySummary;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────

const ON_DEMAND_ALL: SourceScope[] = ['current_subject_property', 'current_deal_card', 'current_local_area'];

function timeout(maxAttemptMs: number, maxAttempts = 1): AdapterTimeoutPolicy {
  return { maxAttemptMs, maxAttempts, stopOnAmbiguous: true, stopOnLoginRequired: true, stopOnLayerHunting: true };
}

function ownCode(candidateOnly = false): ThirdPartyStatus {
  return { isThirdPartyCode: false, installed: false, executed: false, candidateOnly, requiresSecurityReview: candidateOnly };
}

function parcelAdapter(
  id: SourceAdapterId,
  label: string,
  availability: SourceAvailability,
  fallbackRank: number,
  notes: string,
  opts: { requiresLoginOrAccount?: boolean; candidateOnly?: boolean } = {},
): LandDataSourceAdapter {
  return {
    id,
    label,
    kind: 'parcel_exact',
    availability,
    scope: ['current_subject_property', 'current_deal_card'],
    capability: {
      canVerifyParcelIdentity: true,
      canProduceMarketPulse: false,
      exactSearchInputs: ['full_address', 'apn_county_state', 'owner_county_state', 'lp_url', 'property_id_fips'],
      marketPulseSignals: [],
      usesPaidApi: false,
      usesCoordinatesForIdentity: false,
      bulkDataset: false,
      requiresLoginOrAccount: opts.requiresLoginOrAccount ?? false,
    },
    timeout: timeout(8000, 1),
    fallbackRank,
    thirdParty: ownCode(opts.candidateOnly),
    notes,
  };
}

function marketAdapter(
  id: SourceAdapterId,
  label: string,
  signals: MarketPulseSignal[],
  notes: string,
  candidateOnly = false,
): LandDataSourceAdapter {
  return {
    id,
    label,
    kind: 'market_pulse',
    availability: 'not_connected',
    scope: ['current_local_area'],
    capability: {
      canVerifyParcelIdentity: false,
      canProduceMarketPulse: true,
      exactSearchInputs: [],
      marketPulseSignals: signals,
      usesPaidApi: false,
      usesCoordinatesForIdentity: false,
      bulkDataset: false,
      requiresLoginOrAccount: false,
    },
    timeout: timeout(8000, 1),
    fallbackRank: 0,
    thirdParty: ownCode(candidateOnly),
    notes,
  };
}

export const SOURCE_ADAPTERS: readonly LandDataSourceAdapter[] = [
  // ── Parcel-exact fallback ladder (rank order) ───────────────────────────
  parcelAdapter(
    'landportal_exact',
    'LandPortal exact lookup',
    'available',
    1,
    'Preferred fast exact property-data source when available. Invocation stays in the existing Duke preflight path; this registry never calls it and never spends a comp credit.',
  ),
  parcelAdapter(
    'county_assessor_exact',
    'County assessor exact record search',
    'not_connected',
    2,
    'Official assessor property record search by exact address/APN/owner. Preferred over interactive GIS maps.',
  ),
  parcelAdapter(
    'county_property_record_exact',
    'Official county property record search page',
    'not_connected',
    3,
    'Official county property search page for an exact address/APN/owner match.',
  ),
  parcelAdapter(
    'county_gis_exact_bounded',
    'County GIS (bounded exact search only)',
    'not_connected',
    4,
    'Used ONLY if it supports one quick direct exact address/APN/owner search returning an obvious exact match. Stops immediately on login/profile/account, manual map hunting, layer toggling, coordinate or proximity search, ambiguity, multiple parcels, unsupported search, or timeout.',
    { requiresLoginOrAccount: false },
  ),
  parcelAdapter(
    'exact_public_web_search',
    'Exact public-source web search',
    'not_connected',
    5,
    'Exact web/public-source search for the specific address/APN/county. Stops if exact identity is still not verified.',
  ),
  // ── Market-pulse adapters (local area context only) ─────────────────────
  marketAdapter(
    'socrata_open_data',
    'Open-data portal (Socrata-style) local signals',
    ['planning_zoning_development_signals', 'permit_subdivision_infrastructure_activity'],
    'Official/public open-data portals for the current local area. A third-party client library would be a candidate only (report-only) pending Tyler approval + security review.',
    true,
  ),
  marketAdapter(
    'census_growth',
    'Census population/growth direction',
    ['population_growth_direction'],
    'Official public census growth direction for the local area. Any third-party SDK is a candidate only pending approval + security review.',
    true,
  ),
  marketAdapter(
    'planning_zoning_signal',
    'Planning / zoning / comprehensive-plan signals',
    ['planning_zoning_development_signals', 'comprehensive_plan_future_land_use'],
    'Official planning/zoning and comprehensive-plan/future-land-use direction for the local area.',
  ),
  marketAdapter(
    'market_listings_solds',
    'Local active/sold land market signals',
    ['active_sold_land_activity', 'relevant_acreage_bands', 'median_range_price_per_acre', 'days_on_market', 'buyer_demand_signal'],
    'Local-area active/sold land activity, acreage bands, median/range $ per acre, days on market, and buyer demand where an approved adapter exists. Source-backed only; never invented.',
  ),
];

export function getAdapter(id: SourceAdapterId): LandDataSourceAdapter | undefined {
  return SOURCE_ADAPTERS.find((a) => a.id === id);
}

// ─────────────────────────────────────────────────────────────────────────
// Scope guard (on-demand only)
// ─────────────────────────────────────────────────────────────────────────

export function isOnDemandScope(scope: string): scope is SourceScope {
  return (ON_DEMAND_SCOPES as readonly string[]).includes(scope);
}

/** True only if every adapter is on-demand scoped and declares no bulk dataset.
 *  Used by tests to prove this is not a warehouse/scraper. */
export function adaptersAreOnDemandOnly(): boolean {
  return SOURCE_ADAPTERS.every(
    (a) => a.capability.bulkDataset === false && a.scope.length > 0 && a.scope.every(isOnDemandScope),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Parcel verification fallback ladder
// ─────────────────────────────────────────────────────────────────────────

/** The ordered parcel-verification ladder: LandPortal exact, then official
 *  assessor/record search, then bounded GIS, then exact public web search. GIS
 *  is the last resort and never broadens into bulk scraping. */
export function buildFallbackLadder(): LandDataSourceAdapter[] {
  return SOURCE_ADAPTERS.filter((a) => a.kind === 'parcel_exact').sort((a, b) => a.fallbackRank - b.fallbackRank);
}

/**
 * Read-only LandPortal-failure fallback plan. If LandPortal exact lookup fails
 * for a full address / APN+county/state / owner+county/state, LandOS may try the
 * next exact source in the bounded ladder — assessor/record first, GIS only as a
 * bounded last resort. It never jumps straight to broad GIS scraping. No live
 * calls are made here.
 */
export function landportalFailureFallbackPlan(): SourceAttempt[] {
  return buildFallbackLadder()
    .filter((a) => a.id !== 'landportal_exact')
    .map((a) => ({
      adapterId: a.id,
      status: a.availability === 'available' ? ('planned' as const) : ('not_connected' as const),
      reason:
        a.id === 'county_gis_exact_bounded'
          ? 'Bounded exact GIS search only, after assessor/record search; cut off on login/ambiguity/hunting.'
          : `Exact-source fallback (${a.label}).`,
      truthLabel: 'needs_verification' as const,
    }));
}

/**
 * Plan the parcel-verification ladder for a request. READ-ONLY: no adapter is
 * invoked, so nothing is ever returned as verified here. The result records the
 * intended ordered attempts and the honest current status (parcelVerified stays
 * false unless caller-supplied verified context says otherwise upstream).
 */
export function planParcelLookup(req: ParcelLookupRequest, opts: { area?: LocalAreaContext } = {}): ParcelLookupResult {
  const ladder: SourceAttempt[] = buildFallbackLadder().map((a) => ({
    adapterId: a.id,
    status: a.availability === 'available' ? ('planned' as const) : ('not_connected' as const),
    reason:
      a.id === 'county_gis_exact_bounded'
        ? 'Bounded exact GIS search only; preferred order is assessor/record first.'
        : `Exact-source attempt (${a.label}).`,
    truthLabel: 'needs_verification' as const,
  }));

  const hasArea = !!(opts.area && (opts.area.hasCityState || opts.area.hasCountyState));
  const verificationStatus: VerificationStatus = hasArea ? 'local_area_context_not_parcel_verified' : 'unverified';
  const localAreaContextLabel = hasArea ? 'Local Area Context, Not Parcel Verified' : undefined;

  return {
    verificationStatus,
    parcelVerified: false,
    ladder,
    truthLabel: hasArea ? 'local_area_context_not_parcel_verified' : 'needs_verification',
    localAreaContextLabel,
    dataGaps: ['parcel_identity_not_yet_verified'],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GIS cutoff rule
// ─────────────────────────────────────────────────────────────────────────

const GIS_CUTOFF_RULE =
  'Stop immediately and log a data gap if GIS requires login, profile, or account creation; needs manual map hunting or ' +
  'layer toggling; only supports coordinate or proximity search; returns ambiguous results or multiple possible parcels; ' +
  'does not support an exact address/APN/owner search; or exceeds the bounded attempt. Assessor/property record pages are ' +
  'preferred over interactive GIS maps. Coordinates never identify, infer, or verify a parcel.';

/**
 * Evaluate GIS cutoff conditions. ANY triggering condition turns the GIS attempt
 * into a logged data_gap rather than continued searching. Pure + deterministic.
 */
export function evaluateGisCutoff(conditions: GisCutoffConditions): GisCutoffResult {
  const triggered: string[] = [];
  for (const [key, value] of Object.entries(conditions)) {
    if (value === true) triggered.push(key);
  }
  if (triggered.length > 0) {
    return {
      cutoff: true,
      outcome: 'data_gap',
      reason: GIS_CUTOFF_RULE,
      triggered,
    };
  }
  return { cutoff: false, outcome: 'continue', reason: 'GIS supports a quick direct exact search with an obvious exact match.', triggered: [] };
}

export function gisCutoffRule(): string {
  return GIS_CUTOFF_RULE;
}

export function gisCutoffConditionKeys(): string[] {
  return [
    'requiresLogin',
    'requiresProfile',
    'requiresAccountCreation',
    'manualMapHunting',
    'layerToggling',
    'coordinateOrProximitySearch',
    'ambiguousResults',
    'multipleParcels',
    'unsupportedSearch',
    'exceededTimeout',
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Local area + Market Pulse eligibility (separate from parcel verification)
// ─────────────────────────────────────────────────────────────────────────

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]);

// Spelled-out state names -> abbreviation so area signals accept "Winters, Texas".
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
const STATE_NAME_ALT = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length).join('|');
function resolveState(token?: string): string | undefined {
  if (!token) return undefined;
  const t = token.trim();
  if (/^[A-Za-z]{2}$/.test(t) && US_STATES.has(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAME_TO_ABBR[t.toLowerCase()];
}

/** Extract city/county/state area signals from free text. Never uses
 *  coordinates. Conservative: only what is explicitly present. Field-label
 *  phrases ("Parcel ID", "Owner ID", …) are masked first so a label suffix is
 *  never read as a state/city (e.g. "Parcel ID" must not yield city=Parcel,
 *  state=ID). The numeric value is untouched — only the label words are blanked. */
export function extractAreaSignals(text: string): { city?: string; county?: string; state?: string } {
  const t = maskFieldLabels((text ?? '').trim());
  // A bare 2-letter state CODE must be uppercase in the source ("TN", "GA") so
  // ordinary words ("in"/"or"/"me") in prose are never read as states; spelled-
  // out names stay case-insensitive.
  const isValidStateToken = (tok?: string): boolean => {
    if (!tok) return false;
    if (/^[A-Za-z]{2}$/.test(tok) && tok !== tok.toUpperCase()) return false;
    return !!resolveState(tok);
  };
  // State: 2-letter code OR spelled-out name; last valid wins (closest to "city, STATE").
  const stateRe = new RegExp(`\\b([A-Z]{2}|${STATE_NAME_ALT})\\b`, 'gi');
  let state: string | undefined;
  for (const m of t.matchAll(stateRe)) { if (isValidStateToken(m[1])) state = resolveState(m[1]); }
  // County name: Title-Case token(s) before "County", excluding "County Road/Rd/
  // Line/Route/Highway" (a street) so prose does not swallow a whole clause.
  const countyMatch = t.match(
    /\b([A-Z][a-zA-Z.'\-]+(?:[^\S\n]+[A-Z][a-zA-Z.'\-]+){0,2})[^\S\n]+County\b(?!\s+(?:road|rd|line|route|rte|highway|hwy)\b)/,
  );
  let county = countyMatch?.[1]?.replace(/\s+/g, ' ').trim();
  if (!county) {
    // Labeled "County: <Name>" (CRM/record exports); exclude road words + state names.
    const labeled = t.match(/\bcounty[:\s]+([A-Z][a-zA-Z.'\-]+)\b/i)?.[1];
    if (labeled && !/^(?:road|rd|line|route|rte|highway|hwy)$/i.test(labeled) && !resolveState(labeled)) {
      county = labeled.replace(/\s+/g, ' ').trim();
    }
  }
  // City directly before a state (code or name), e.g. "Cottageville, SC",
  // "Winters, Texas". Take the token(s) closest to the state; ignore a "... County".
  let city: string | undefined;
  const cityRe = new RegExp(`\\b([A-Z][a-zA-Z.'\\-]+(?:\\s+[A-Z][a-zA-Z.'\\-]+)?)\\s*,?\\s+([A-Z]{2}|${STATE_NAME_ALT})\\b`, 'gi');
  for (const m of t.matchAll(cityRe)) {
    if (!isValidStateToken(m[2])) continue;
    const candidate = m[1].replace(/\s+/g, ' ').trim();
    if (/\bCounty\b/i.test(candidate)) continue;
    if (STATE_NAME_TO_ABBR[candidate.toLowerCase()]) continue; // the "city" is itself a state name
    city = candidate; // last valid match wins (closest to the state)
  }
  // "County: Cherokee, GA" sets both county and city to Cherokee — the value is
  // the county, so drop the redundant city echo.
  if (city && county && city.toLowerCase() === county.toLowerCase()) city = undefined;
  return {
    ...(city ? { city } : {}),
    ...(county ? { county } : {}),
    ...(state ? { state } : {}),
  };
}

export function buildLocalAreaContext(area: { city?: string; county?: string; state?: string }): LocalAreaContext {
  const hasState = !!area.state;
  const hasCityState = !!(area.city && hasState);
  const hasCountyState = !!(area.county && hasState);
  const parts: string[] = [];
  if (area.city) parts.push(area.city);
  if (area.county) parts.push(`${area.county} County`);
  if (area.state) parts.push(area.state);
  const has = hasCityState || hasCountyState;
  return {
    hasCityState,
    hasCountyState,
    areaDescriptor: parts.join(', ') || 'unknown area',
    label: has ? 'local_area_context_not_parcel_verified' : 'none',
  };
}

/**
 * Market Pulse eligibility. Eligible when the input has at least city + state,
 * county + state, or city + county + state — EVEN IF parcel verification fails.
 * Market Pulse can never verify a parcel; it is local area context only.
 */
export function marketPulseEligibility(
  area: { city?: string; county?: string; state?: string },
  opts: { adapterAvailable?: boolean } = {},
): MarketPulseResult {
  const ctx = buildLocalAreaContext(area);
  const eligible = ctx.hasCityState || ctx.hasCountyState;
  const adapterAvailable = opts.adapterAvailable ?? MARKET_PULSE_ADAPTER_AVAILABLE;
  // Ineligible -> not_available; eligible with no adapter -> not_connected.
  const status: SourceAvailability = !eligible ? 'not_available' : adapterAvailable ? 'available' : 'not_connected';

  return {
    eligible,
    status,
    separateFromParcelVerification: true,
    areaScope: ctx.areaDescriptor,
    signalsCatalog: [...MARKET_PULSE_SIGNALS],
    truthLabel: eligible ? 'local_area_context_not_parcel_verified' : 'not_available',
    reason: eligible
      ? adapterAvailable
        ? 'Local area (city/county + state) known: Market Pulse eligible as local area context, separate from parcel verification.'
        : 'Local area (city/county + state) known: Market Pulse eligible, but no approved market adapter is connected yet (no data invented).'
      : 'No city/county + state in the input: Market Pulse not eligible (and never invented).',
    localAreaContextLabel: eligible ? 'Local Area Context, Not Parcel Verified' : undefined,
  };
}

/** No approved market-pulse adapter is connected this sprint. */
export const MARKET_PULSE_ADAPTER_AVAILABLE = false;

// ─────────────────────────────────────────────────────────────────────────
// Seller ask context (never anchors the offer range)
// ─────────────────────────────────────────────────────────────────────────

const SELLER_ASK_NOTE =
  'Seller asking price is seller_stated negotiation context only. The calculated offer range is built from source-backed ' +
  'value evidence, a viable exit strategy, estimated costs, risk, and profit rules — never anchored to the seller ask. ' +
  'LandOS may compare the ask to the calculated range, but must not set the range from the ask.';

export function buildSellerAskContext(sellerAskUsd?: number): SellerAskContext {
  return {
    ...(typeof sellerAskUsd === 'number' && Number.isFinite(sellerAskUsd) ? { sellerAskUsd } : {}),
    label: 'seller_stated',
    usableForOfferRange: false,
    note: SELLER_ASK_NOTE,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Open-source / third-party security posture
// ─────────────────────────────────────────────────────────────────────────

/** Useful open-source projects identified as CANDIDATES ONLY. Not installed,
 *  not executed, not imported. Each needs Tyler approval + a security review
 *  before any future use. Report-only. */
export const OPEN_SOURCE_CANDIDATES: readonly OpenSourceCandidate[] = [
  { name: 'Socrata open-data client (e.g. sodapy / soda-js)', purpose: 'Query official open-data portals for local signals', installed: false, executed: false, candidateOnly: true, requiresSecurityReview: true },
  { name: 'US Census API client', purpose: 'Population/growth direction for the local area', installed: false, executed: false, candidateOnly: true, requiresSecurityReview: true },
];

export function thirdPartySecuritySummary(): ThirdPartySecuritySummary {
  return {
    thirdPartyCodeInstalled: false,
    thirdPartyCodeExecuted: false,
    thirdPartyCodeImportedOrVendored: false,
    policy:
      'No third-party GitHub repo/package/tool is installed, executed, imported, vendored, or cloned this sprint. ' +
      'Useful projects are candidates only and require Tyler approval plus a security review before any use. ' +
      'Prefer Tyler-owned adapter code calling official/public endpoints over adding scraper dependencies.',
    candidates: [...OPEN_SOURCE_CANDIDATES],
    requiresTylerApprovalAndSecurityReview: true,
    securityReviewItems: [...SECURITY_REVIEW_ITEMS],
  };
}

/** A candidate is report-only this sprint: it can never be installed/executed
 *  from code. Even with a claimed approval flag, install/execute requires Tyler's
 *  manual, out-of-band approval + a security review, so this always returns
 *  false. The flag is part of the contract for a future gated path. */
export function canInstallOrExecuteCandidate(_candidate: OpenSourceCandidate, _tylerApproved: boolean): boolean {
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Compose the full read-only source plan
// ─────────────────────────────────────────────────────────────────────────

const ON_DEMAND_RULE =
  'Query sources only for the current subject property, current deal card, or current local area. Store only normalized ' +
  'findings, source traces, timestamps, truth labels, and failed/attempted-lookup notes. Never store bulk county-wide ' +
  'parcel layers or large GIS exports, and never build a parcel warehouse.';

/**
 * Build the complete read-only Source Adapter + Market Pulse plan for an intake.
 * Pure + deterministic. Makes no live calls; verifies nothing; invents nothing.
 */
export function buildSourceAdapterPlan(input: {
  text: string;
  hasParcelIdentity: boolean;
  parcelVerified: boolean;
  sellerAskUsd?: number;
}): SourceAdapterPlan {
  const area = extractAreaSignals(input.text);
  const localArea = buildLocalAreaContext(area);

  const parcelVerification: ParcelLookupResult = input.parcelVerified
    ? {
        verificationStatus: 'parcel_verified',
        parcelVerified: true,
        ladder: [],
        truthLabel: 'verified',
        dataGaps: [],
      }
    : planParcelLookup(
        { scope: 'current_subject_property', text: input.text },
        { area: localArea },
      );

  const marketPulse = marketPulseEligibility(area);

  return {
    onDemandScope: { allowed: [...ON_DEMAND_SCOPES], bulkDatasetsForbidden: true, rule: ON_DEMAND_RULE },
    adapterReadiness: SOURCE_ADAPTERS.map((a) => ({
      id: a.id,
      label: a.label,
      kind: a.kind,
      availability: a.availability,
      canVerifyParcelIdentity: a.capability.canVerifyParcelIdentity,
      canProduceMarketPulse: a.capability.canProduceMarketPulse,
    })),
    parcelFallbackLadder: buildFallbackLadder().map((a) => ({
      rank: a.fallbackRank,
      adapterId: a.id,
      availability: a.availability,
      role: a.id === 'county_gis_exact_bounded' ? 'bounded last resort (exact search only)' : a.label,
    })),
    landportalFailureFallbackPlan: landportalFailureFallbackPlan(),
    gisCutoff: { rule: GIS_CUTOFF_RULE, conditions: gisCutoffConditionKeys(), preferAssessorOverGis: true },
    marketPulse,
    parcelVerification,
    sellerAsk: buildSellerAskContext(input.sellerAskUsd),
    thirdPartySecurity: thirdPartySecuritySummary(),
    note:
      'Read-only source/Market Pulse plan. No live external call, no install, no third-party code, no paid/comp tool, ' +
      'no secret read. Parcel identity is never derived from coordinates or proximity.',
  };
}
