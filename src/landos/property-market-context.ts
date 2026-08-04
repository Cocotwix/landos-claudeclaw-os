// LandOS — property-scoped market context from the LandOS Market Research store.
//
// SOP 10B (Market Research Source Rule): LandPortal is never the source for
// county, ZIP, or acreage-band market metrics. After the subject's county,
// state, ZIP, and acreage are established, the matching market records are
// read from the existing Market Research tables (landos_market_snapshot via
// the market-matrix services). This module is a read-time JOIN — it stores
// nothing and never duplicates the Market Research dataset. A missing exact
// county, ZIP, or band record is reported honestly as unavailable; no other
// geography or band is silently substituted.

import {
  ACREAGE_BAND_LABEL,
  comparePeriods,
  isCountyFips,
  type AcreageBand,
  type MarketMetrics,
} from './market-matrix.js';
import {
  getCountyDrilldown,
  listCountyRef,
  type CountyDrilldownSnapshot,
} from './market-matrix-store.js';
import { acreageBandForAcres, resolveMarketMatrix } from './market-matrix-read.js';

export const PROPERTY_MARKET_CONTEXT_SOURCE = 'LandOS Market Research';

/** The metric set the Property Intelligence market section displays. */
export interface MarketContextMetrics {
  soldCount: number | null;
  activeCount: number | null;
  medianDaysOnMarket: number | null;
  sellThroughRate: number | null;
  absorptionRate: number | null;
  monthsOfSupply: number | null;
  medianPrice: number | null;
  medianPricePerAcre: number | null;
  population: number | null;
  populationGrowth: number | null;
}

export interface MarketContextRecord {
  scope: 'county' | 'zip' | 'subject_band' | 'fastest_band';
  label: string;
  available: boolean;
  acreageBand: AcreageBand | null;
  acreageBandLabel: string | null;
  period: string | null;
  snapshotDate: string | null;
  provider: string | null;
  metrics: MarketContextMetrics | null;
  note: string;
}

export interface PropertyMarketContext {
  source: typeof PROPERTY_MARKET_CONTEXT_SOURCE;
  geography: {
    county: string | null;
    fips: string | null;
    state: string | null;
    zip: string | null;
    acres: number | null;
    subjectBand: AcreageBand | null;
  };
  county: MarketContextRecord;
  zip: MarketContextRecord;
  subjectBand: MarketContextRecord;
  fastestBand: MarketContextRecord;
  interpretation: string;
}

function toContextMetrics(m: MarketMetrics): MarketContextMetrics {
  return {
    soldCount: m.salesCount,
    activeCount: m.listingCount,
    medianDaysOnMarket: m.daysOnMarket,
    sellThroughRate: m.sellThroughRate,
    absorptionRate: m.absorptionRate,
    monthsOfSupply: m.monthsOfSupply,
    medianPrice: m.medianPrice,
    medianPricePerAcre: m.medianPricePerAcre,
    population: m.population,
    populationGrowth: m.populationGrowth,
  };
}

function unavailable(
  scope: MarketContextRecord['scope'],
  label: string,
  note: string,
  band: AcreageBand | null = null,
): MarketContextRecord {
  return {
    scope, label, available: false,
    acreageBand: band,
    acreageBandLabel: band ? ACREAGE_BAND_LABEL[band] : null,
    period: null, snapshotDate: null, provider: null, metrics: null, note,
  };
}

function fromDrilldownSnapshot(
  scope: MarketContextRecord['scope'],
  label: string,
  snapshot: CountyDrilldownSnapshot,
): MarketContextRecord {
  return {
    scope, label, available: true,
    acreageBand: snapshot.acreageBand,
    acreageBandLabel: ACREAGE_BAND_LABEL[snapshot.acreageBand],
    period: snapshot.period,
    snapshotDate: snapshot.extractionTs || null,
    provider: snapshot.provider || null,
    metrics: toContextMetrics(snapshot.metrics),
    note: `LandOS Market Research county record (${snapshot.period}).`,
  };
}

const countyNameKey = (value: string): string => value.replace(/\s+county$/i, '').trim().toLowerCase();

function resolveCountyFips(county: string | null, state: string | null): { fips: string | null; countyName: string | null } {
  if (county && isCountyFips(county)) {
    const ref = listCountyRef(state ?? undefined).find((c) => c.fips === county);
    return { fips: county, countyName: ref?.countyName ?? null };
  }
  if (county && state) {
    // The reference stores names both with and without the "County" suffix
    // (seed vs. ingestion); normalize both sides before comparing.
    const wanted = countyNameKey(county);
    const ref = listCountyRef(state).find((c) => countyNameKey(c.countyName) === wanted);
    if (ref) return { fips: ref.fips, countyName: ref.countyName };
  }
  return { fips: null, countyName: county };
}

function pct(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

function buildInterpretation(context: PropertyMarketContext): string {
  const parts: string[] = [];
  const countyName = context.geography.county ?? 'the county';
  const band = context.subjectBand;
  if (band.available && band.metrics) {
    const str = pct(band.metrics.sellThroughRate);
    const dom = band.metrics.medianDaysOnMarket;
    parts.push(`${countyName} ${band.acreageBandLabel} land ${str ? `is turning over at a ${str} sell-through rate` : 'has retained band data'}${dom !== null ? ` with a ${Math.round(dom)}-day median DOM` : ''}.`);
  } else {
    parts.push(`No exact ${countyName} record exists for the subject acreage band; band demand is unproven, not assumed.`);
  }
  const fastest = context.fastestBand;
  if (fastest.available && fastest.metrics && fastest.acreageBandLabel) {
    parts.push(`The fastest-selling county segment is ${fastest.acreageBandLabel} at ${pct(fastest.metrics.sellThroughRate) ?? 'an unstated rate'}.`);
  }
  const zip = context.zip;
  if (zip.available && zip.metrics) {
    parts.push(`ZIP ${context.geography.zip} recorded ${zip.metrics.soldCount ?? 'an unknown number of'} sales across all acreage in the period.`);
  } else if (context.geography.zip) {
    parts.push(`No LandOS Market Research record exists for ZIP ${context.geography.zip}.`);
  }
  return parts.join(' ');
}

/**
 * Read-time join of the subject property's geography against the existing
 * LandOS Market Research store. Pure over the DB; nothing is persisted.
 */
export function propertyMarketContextFor(input: {
  county: string | null;
  state: string | null;
  zip: string | null;
  acres: number | null;
}): PropertyMarketContext {
  const state = input.state ? input.state.toUpperCase() : null;
  const { fips, countyName } = resolveCountyFips(input.county, state);
  const acres = typeof input.acres === 'number' && Number.isFinite(input.acres) && input.acres > 0 ? input.acres : null;
  const subjectBandKey = acres !== null ? acreageBandForAcres(acres) : null;
  const countyLabel = countyName ?? input.county ?? 'Unknown county';

  // County-scope records come from the county drilldown so the extraction
  // timestamp (snapshot date) is preserved alongside the source period.
  const drilldown = fips ? getCountyDrilldown(fips) : undefined;
  const soldSnapshots = (drilldown?.snapshots ?? []).filter((s) => s.side === 'sold');
  const latestPeriod = soldSnapshots.reduce<string | null>(
    (best, s) => (best === null || comparePeriods(s.period, best) > 0 ? s.period : best),
    null,
  );
  const latest = soldSnapshots.filter((s) => s.period === latestPeriod);
  const bandSnapshot = (band: AcreageBand): CountyDrilldownSnapshot | undefined =>
    latest.find((s) => s.acreageBand === band);

  const countyAll = bandSnapshot('all');
  const county: MarketContextRecord = countyAll
    ? fromDrilldownSnapshot('county', `${countyLabel} (all acreage)`, countyAll)
    : unavailable('county', `${countyLabel} (all acreage)`, fips
      ? `No LandOS Market Research county record exists for ${countyLabel}.`
      : 'The subject county could not be resolved against the Market Research county reference.');

  const subjectSnapshot = subjectBandKey ? bandSnapshot(subjectBandKey) : undefined;
  const subjectBand: MarketContextRecord = subjectSnapshot
    ? fromDrilldownSnapshot('subject_band', `${countyLabel} — subject band ${ACREAGE_BAND_LABEL[subjectBandKey as AcreageBand]}`, subjectSnapshot)
    : unavailable('subject_band',
      subjectBandKey ? `${countyLabel} — subject band ${ACREAGE_BAND_LABEL[subjectBandKey]}` : `${countyLabel} — subject band`,
      subjectBandKey
        ? `No exact ${countyLabel} record exists for the ${ACREAGE_BAND_LABEL[subjectBandKey]} band; no other band was substituted.`
        : 'Subject acreage is unknown, so no acreage band can be resolved.',
      subjectBandKey);

  const fastestSnapshot = latest
    .filter((s) => s.acreageBand !== 'all' && s.metrics.sellThroughRate !== null)
    .reduce<CountyDrilldownSnapshot | undefined>(
      (best, s) => (!best || (s.metrics.sellThroughRate as number) > (best.metrics.sellThroughRate as number) ? s : best),
      undefined,
    );
  const fastestBand: MarketContextRecord = fastestSnapshot
    ? fromDrilldownSnapshot('fastest_band', `${countyLabel} — fastest-selling band ${ACREAGE_BAND_LABEL[fastestSnapshot.acreageBand]}`, fastestSnapshot)
    : unavailable('fastest_band', `${countyLabel} — fastest-selling band`,
      `No ${countyLabel} band carries a sell-through rate, so a fastest-selling band cannot be named.`);

  // The ZIP record must be an exact ZIP match; the resolver receives no
  // county/state so its fallback chain cannot silently widen the geography.
  const zipResolution = input.zip
    ? resolveMarketMatrix({ zip: input.zip, acreageBand: 'all', side: 'sold' })
    : null;
  const zip: MarketContextRecord = zipResolution && zipResolution.available && zipResolution.matchLevel === 'zip' && zipResolution.metrics
    ? {
      scope: 'zip',
      label: `ZIP ${input.zip} (all acreage)`,
      available: true,
      acreageBand: 'all',
      acreageBandLabel: ACREAGE_BAND_LABEL.all,
      period: zipResolution.period,
      snapshotDate: null,
      provider: zipResolution.provider,
      metrics: toContextMetrics(zipResolution.metrics),
      note: `LandOS Market Research ZIP record (${zipResolution.period}).`,
    }
    : unavailable('zip', input.zip ? `ZIP ${input.zip} (all acreage)` : 'ZIP record', input.zip
      ? `No LandOS Market Research record exists for ZIP ${input.zip}; no other ZIP was substituted.`
      : 'The subject ZIP is unknown.');

  const context: PropertyMarketContext = {
    source: PROPERTY_MARKET_CONTEXT_SOURCE,
    geography: {
      county: countyName ?? input.county,
      fips,
      state,
      zip: input.zip,
      acres,
      subjectBand: subjectBandKey,
    },
    county,
    zip,
    subjectBand,
    fastestBand,
    interpretation: '',
  };
  context.interpretation = buildInterpretation(context);
  return context;
}
