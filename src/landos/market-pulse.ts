// Market Pulse v1 — safe, on-demand local-area context.
//
// Produces local-area context when city/state or county/state is known, EVEN IF
// the parcel is unverified — clearly labeled "Local Area Context, Not Parcel
// Verified". It NEVER fabricates market numbers. Where a real, safe, official,
// on-demand source exists, it emits a source reference (name + URL) the operator
// can use. Where no approved adapter is connected, it returns not_connected /
// data_gap with the exact source/approval needed.
//
// Hard rules:
//   - No scraping, no Zillow/Redfin/Realtor, no comp credit, no paid API.
//   - No coordinate/geocoder/proximity/map-pin resolution.
//   - No invented active/sold counts, $/acre, days-on-market, or buyer demand.
//   - Pure + deterministic (timestamp injectable) so it is fully testable and
//     makes no live network call itself.

import { MARKET_PULSE_SIGNALS, type MarketPulseSignal, buildLocalAreaContext } from './source-adapters.js';

export type MarketPulseSignalStatus = 'source_available' | 'not_connected' | 'data_gap';

export interface MarketPulseSignalResult {
  signal: MarketPulseSignal;
  status: MarketPulseSignalStatus;
  /** Official source name when a safe on-demand source exists. */
  sourceName?: string;
  /** Official source URL (real, clickable, on-demand). Never a scraped figure. */
  sourceUrl?: string;
  /** Human note. Never contains a fabricated number. */
  note: string;
  /** Exact source/approval needed when status is not_connected or data_gap. */
  approvalNeeded?: string;
}

export interface MarketPulseV1 {
  eligible: boolean;
  /** Resolved local area from the input. */
  localArea: { city?: string; county?: string; state?: string; descriptor: string };
  parcelVerified: boolean;
  /** The honesty label whenever the parcel is not verified. */
  label: 'Local Area Context, Not Parcel Verified' | 'Parcel Verified';
  signals: MarketPulseSignalResult[];
  /** ISO timestamp the context was generated (injectable for tests). */
  generatedAt: string;
  reason: string;
  /** Always present when unverified: no property-specific valuation/offer. */
  disclaimer: string;
}

// Market-metric signals that require an approved data adapter. Never invented.
const LISTING_METRIC_SIGNALS: MarketPulseSignal[] = [
  'active_sold_land_activity',
  'relevant_acreage_bands',
  'median_range_price_per_acre',
  'days_on_market',
  'buyer_demand_signal',
];

const LISTING_APPROVAL =
  'Approve a safe, official/public market-data source or adapter (no listing-site harvesting, ' +
  'no comp credit, no location-point lookup). Until then, figures are never invented.';

/**
 * Build Market Pulse v1 for a local area. Pure + deterministic. Emits official
 * on-demand source references where safe (population/growth via the U.S. Census
 * public portal), and not_connected / data_gap with the exact approval/source
 * needed everywhere a real safe adapter is not yet connected. No fabrication.
 */
export function buildMarketPulseV1(input: {
  city?: string;
  county?: string;
  state?: string;
  parcelVerified: boolean;
  /** Injectable for deterministic tests; defaults to now. */
  nowIso?: string;
}): MarketPulseV1 {
  const ctx = buildLocalAreaContext({ city: input.city, county: input.county, state: input.state });
  const eligible = ctx.hasCityState || ctx.hasCountyState;
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const label = input.parcelVerified ? 'Parcel Verified' : 'Local Area Context, Not Parcel Verified';
  const disclaimer = input.parcelVerified
    ? ''
    : 'Local area context only. It does not verify the parcel and carries no property-specific valuation, scoring, or offer guidance.';

  if (!eligible) {
    return {
      eligible: false,
      localArea: { city: input.city, county: input.county, state: input.state, descriptor: ctx.areaDescriptor },
      parcelVerified: input.parcelVerified,
      label,
      signals: [],
      generatedAt,
      reason: 'No city/county + state in the input: Market Pulse is not eligible. Provide city + state or county + state.',
      disclaimer,
    };
  }

  const area = ctx.areaDescriptor;
  const signals: MarketPulseSignalResult[] = [];

  for (const signal of MARKET_PULSE_SIGNALS) {
    if (signal === 'population_growth_direction') {
      // Official, public, on-demand source reference (no key, no scrape). The
      // operator/agent reads current figures from this official source; we never
      // invent a number here.
      signals.push({
        signal,
        status: 'source_available',
        sourceName: 'U.S. Census Bureau (data.census.gov)',
        sourceUrl: `https://data.census.gov/all?q=${encodeURIComponent(`${area} population`)}`,
        note: `Official on-demand population/growth source for ${area}. Retrieve current figures from this source; not fabricated here.`,
      });
    } else if (signal === 'planning_zoning_development_signals') {
      signals.push({
        signal,
        status: 'data_gap',
        note: `Official planning/zoning signals for ${area} require the jurisdiction's own source.`,
        approvalNeeded: `Provide/confirm the official ${area} planning department URL to attach as a source.`,
      });
    } else if (signal === 'comprehensive_plan_future_land_use') {
      signals.push({
        signal,
        status: 'data_gap',
        note: `Comprehensive / future-land-use direction for ${area} is jurisdiction-specific.`,
        approvalNeeded: `Provide the official ${area} comprehensive plan / future-land-use plan URL.`,
      });
    } else if (signal === 'permit_subdivision_infrastructure_activity') {
      signals.push({
        signal,
        status: 'data_gap',
        note: `Permit / subdivision / infrastructure activity for ${area} needs the official portal.`,
        approvalNeeded: `Provide the official ${area} permits / subdivision portal URL.`,
      });
    } else if (LISTING_METRIC_SIGNALS.includes(signal)) {
      signals.push({
        signal,
        status: 'not_connected',
        note: 'No approved market-data adapter is connected; this figure is never invented.',
        approvalNeeded: LISTING_APPROVAL,
      });
    }
  }

  return {
    eligible: true,
    localArea: { city: input.city, county: input.county, state: input.state, descriptor: area },
    parcelVerified: input.parcelVerified,
    label,
    signals,
    generatedAt,
    reason: `Local area (${area}) known: Market Pulse v1 provides labeled local-area context, separate from parcel verification.`,
    disclaimer,
  };
}
