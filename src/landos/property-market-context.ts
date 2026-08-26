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
//
// Two things are true at once and this module keeps them apart:
//   - The per-scope records (county / ZIP / subject band / fastest band) are
//     EXACT. A miss stays a miss; nothing is substituted into them.
//   - The operator-facing `read` and `liquidity` projections run the subject's
//     full geography chain (ZIP → county → county all-acreage → ZIP all-acreage
//     → state, each across every band the subject's acreage belongs to) and
//     always NAME the key that carried the answer. So "no market record exists"
//     is only ever said when no key for THIS subject carried one — a single
//     failed lookup key is not evidence of missing research.
// Both projections come from one resolution, so the Property Intelligence market
// read and the Comps & Valuation liquidity context can never disagree.

import {
  ACREAGE_BANDS,
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
import { mrBridgeCountyFips, mrBridgeCountyName } from './market-research-store-bridge.js';
import {
  acreageBandForAcres,
  acreageBandsForAcres,
  resolveMarketMatrix,
  type MarketMatrixResolution,
  type MatchLevel,
} from './market-matrix-read.js';
import {
  getMrGeoSummary,
  listMrSnapshots,
  type MarketResearchFilters,
  type MrGeoMetricRow,
} from './market-research-snapshots.js';

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

/** One decision-useful market number, already formatted. */
export interface MarketReadFact { label: string; value: string }

/**
 * The concise operator market read for Property Intelligence: one headline, at
 * most four numbers, and the geography key that carried them. Not a research
 * dump — the detail stays in the per-scope records underneath.
 */
export interface MarketReadProjection {
  available: boolean;
  /** Single operator line. Empty when nothing was carried. */
  headline: string;
  /** Which geography key answered: `county:<fips>`, `zip:<zip>`, `state:<st>`. */
  resolvedKey: string | null;
  /** Operator label for that key, e.g. "<County> County (50–100 acres)". */
  resolvedVia: string | null;
  /** Whether the carrying key was the subject's own band, a wider band, or a
   *  wider geography — so the surface can show the caveat once, compactly. */
  matchLevel: MatchLevel;
  exactSubjectBand: boolean;
  acreageBandLabel: string | null;
  period: string | null;
  staleness: string | null;
  isStale: boolean;
  facts: MarketReadFact[];
  note: string;
}

/**
 * Liquidity and competition context for Comps & Valuation. Same resolution as
 * the Property Intelligence read, projected for underwriting: how fast the band
 * turns over, and what the subject would be competing against. Never a value
 * conclusion — the valuation stays with the comps.
 */
export interface MarketLiquidityProjection {
  available: boolean;
  resolvedKey: string | null;
  resolvedVia: string | null;
  acreageBandLabel: string | null;
  period: string | null;
  isStale: boolean;
  soldCount: number | null;
  activeCount: number | null;
  medianDaysOnMarket: number | null;
  sellThroughRate: number | null;
  absorptionRate: number | null;
  monthsOfSupply: number | null;
  medianPricePerAcre: number | null;
  /** Supply read derived from months-of-supply / sell-through, or null. */
  liquidityLabel: string | null;
  /** What is on the market now, from the for-sale side of the SAME geography.
   *  Null when the store carries no for-sale record for this subject. */
  competition: {
    activeListings: number | null;
    medianPricePerAcre: number | null;
    medianDaysOnMarket: number | null;
    resolvedVia: string | null;
    period: string | null;
  } | null;
  /** One compact underwriting line. */
  summary: string;
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
  /** Property Intelligence market read (concise). */
  read: MarketReadProjection;
  /** Comps & Valuation liquidity/competition context (concise). */
  liquidity: MarketLiquidityProjection;
  interpretation: string;
  /** The complete current Market Research product for the subject's county and
   * ZIP. This is deliberately separate from the concise operator projection
   * above: specialists reason over every retained band; surfaces can keep using
   * the compact county/ZIP/subject-band read. */
  research: CompleteMarketResearchProduct;
}

export interface CompleteMarketResearchRow {
  geography: 'county' | 'zip';
  geographyKey: string;
  geographyLabel: string;
  snapshotId: number;
  snapshotPeriod: string;
  snapshotCollectedAt: string;
  snapshotStatus: 'collecting' | 'retained';
  filterKey: string;
  filters: MarketResearchFilters;
  acreageBand: AcreageBand;
  side: 'sold';
  metrics: MarketMetrics;
  confidence: 'high';
  provider: string;
  sourceRef: string;
  observedAt: string;
  prior: MrGeoMetricRow['prior'];
}

export interface CompleteMarketResearchProduct {
  contractVersion: 'market-research-subject-file-v1';
  source: typeof PROPERTY_MARKET_CONTEXT_SOURCE;
  countyFips: string | null;
  countyName: string | null;
  zip: string | null;
  subjectAcres: number | null;
  subjectBands: AcreageBand[];
  rows: CompleteMarketResearchRow[];
  countyRows: CompleteMarketResearchRow[];
  zipRows: CompleteMarketResearchRow[];
  periods: string[];
  fastestCountyBands: Array<{ acreageBand: AcreageBand; daysOnMarket: number | null; sellThroughRate: number | null; salesCount: number | null }>;
  strongestCountyBands: Array<{ acreageBand: AcreageBand; sellThroughRate: number | null; absorptionRate: number | null; salesCount: number | null }>;
}

/**
 * Complete current Market Research packet for one subject geography.
 *
 * The quarterly store owns the producer contract. Each retained acreage-band
 * snapshot is read directly by its exact county and ZIP key; no subject-band
 * resolution or geography fallback narrows this packet before the market
 * specialist sees it. One newest retained snapshot per acreage band is carried,
 * with its full metric row and provenance.
 */
export function completeMarketResearchFor(input: {
  countyFips: string | null;
  countyName: string | null;
  zip: string | null;
  subjectAcres: number | null;
}): CompleteMarketResearchProduct {
  const snapshots = listMrSnapshots()
    .filter((snapshot) => snapshot.filters.status === 'sold' && snapshot.filters.propertyType === 'land')
    .sort((a, b) => b.quarter.localeCompare(a.quarter) || b.id - a.id);
  const collectedBands = ACREAGE_BANDS.filter((band) => band !== '50+');

  const rows: CompleteMarketResearchRow[] = [];
  const append = (geography: 'county' | 'zip', geographyKey: string | null, geographyLabel: string): void => {
    if (!geographyKey) return;
    for (const band of collectedBands) {
      let summary: ReturnType<typeof getMrGeoSummary> = null;
      let snapshot: ReturnType<typeof listMrSnapshots>[number] | null = null;
      // A newer collection may still be in progress and not have reached this
      // geography. Choose the newest snapshot that ACTUALLY contains the exact
      // county/ZIP row instead of treating the newest global snapshot as a miss.
      for (const candidate of snapshots) {
        if (candidate.filters.acreageBand !== band) continue;
        const candidateSummary = getMrGeoSummary(candidate.id, geographyKey);
        if (!candidateSummary) continue;
        snapshot = candidate;
        summary = candidateSummary;
        break;
      }
      if (!snapshot || !summary) continue;
      rows.push({
        geography,
        geographyKey,
        geographyLabel,
        snapshotId: snapshot.id,
        snapshotPeriod: snapshot.quarter,
        snapshotCollectedAt: snapshot.collectedAt,
        snapshotStatus: snapshot.status,
        filterKey: snapshot.filterKey,
        filters: snapshot.filters,
        acreageBand: snapshot.filters.acreageBand,
        side: 'sold',
        metrics: summary.row.metrics,
        confidence: 'high',
        provider: summary.row.provider || snapshot.provider,
        sourceRef: summary.row.sourceRef,
        observedAt: summary.row.observedAt,
        prior: summary.row.prior,
      });
    }
  };

  append('county', input.countyFips ? `county:${input.countyFips}` : null, input.countyName ?? input.countyFips ?? 'County');
  append('zip', input.zip ? `zip:${input.zip}` : null, input.zip ? `ZIP ${input.zip}` : 'ZIP');
  rows.sort((a, b) => a.geography.localeCompare(b.geography)
    || ACREAGE_BANDS.indexOf(a.acreageBand) - ACREAGE_BANDS.indexOf(b.acreageBand));

  const countyBandRows = rows.filter((row) => row.geography === 'county' && row.acreageBand !== 'all');
  const fastestCountyBands = countyBandRows
    .filter((row) => row.metrics.daysOnMarket != null || row.metrics.sellThroughRate != null)
    .sort((a, b) => (a.metrics.daysOnMarket ?? Number.POSITIVE_INFINITY) - (b.metrics.daysOnMarket ?? Number.POSITIVE_INFINITY)
      || (b.metrics.sellThroughRate ?? Number.NEGATIVE_INFINITY) - (a.metrics.sellThroughRate ?? Number.NEGATIVE_INFINITY))
    .slice(0, 4)
    .map((row) => ({
      acreageBand: row.acreageBand,
      daysOnMarket: row.metrics.daysOnMarket,
      sellThroughRate: row.metrics.sellThroughRate,
      salesCount: row.metrics.salesCount,
    }));
  const strongestCountyBands = countyBandRows
    .filter((row) => row.metrics.sellThroughRate != null || row.metrics.absorptionRate != null || row.metrics.salesCount != null)
    .sort((a, b) => (b.metrics.sellThroughRate ?? Number.NEGATIVE_INFINITY) - (a.metrics.sellThroughRate ?? Number.NEGATIVE_INFINITY)
      || (b.metrics.absorptionRate ?? Number.NEGATIVE_INFINITY) - (a.metrics.absorptionRate ?? Number.NEGATIVE_INFINITY)
      || (b.metrics.salesCount ?? Number.NEGATIVE_INFINITY) - (a.metrics.salesCount ?? Number.NEGATIVE_INFINITY))
    .slice(0, 4)
    .map((row) => ({
      acreageBand: row.acreageBand,
      sellThroughRate: row.metrics.sellThroughRate,
      absorptionRate: row.metrics.absorptionRate,
      salesCount: row.metrics.salesCount,
    }));

  return {
    contractVersion: 'market-research-subject-file-v1',
    source: PROPERTY_MARKET_CONTEXT_SOURCE,
    countyFips: input.countyFips,
    countyName: input.countyName,
    zip: input.zip,
    subjectAcres: input.subjectAcres,
    subjectBands: acreageBandsForAcres(input.subjectAcres),
    rows,
    countyRows: rows.filter((row) => row.geography === 'county'),
    zipRows: rows.filter((row) => row.geography === 'zip'),
    periods: [...new Set(rows.map((row) => row.snapshotPeriod))].sort().reverse(),
    fastestCountyBands,
    strongestCountyBands,
  };
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
    // The matrix county reference only carries ingested counties. The Market
    // Research geography table carries every U.S. county, so a name that misses
    // there still resolves. Locality scoping only — never parcel identity.
    const bridged = mrBridgeCountyFips(county, state);
    if (bridged) return { fips: bridged, countyName: mrBridgeCountyName(bridged) ?? county };
  }
  return { fips: null, countyName: county };
}

function pct(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}
function money(value: number | null): string | null {
  return value === null ? null : `$${Math.round(value).toLocaleString('en-US')}`;
}
function domText(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)} days`;
}

/**
 * The concise Property Intelligence market read, built from ONE resolution so it
 * can never disagree with the liquidity context. Only real values appear; a
 * missing metric is simply absent, never zero. When the answer came from a wider
 * key than the subject's own band or geography, the note says so — the record is
 * found, and the caveat is stated once rather than reported as "no record".
 */
function buildMarketRead(res: MarketMatrixResolution): MarketReadProjection {
  if (!res.available || !res.metrics) {
    return {
      available: false, headline: '', resolvedKey: null, resolvedVia: null,
      matchLevel: res.matchLevel, exactSubjectBand: false, acreageBandLabel: null,
      period: null, staleness: null, isStale: false, facts: [],
      note: res.note,
    };
  }
  const m = res.metrics;
  const bandUsed = res.acreageBandUsed;
  const exactSubjectBand = bandUsed !== null && bandUsed !== 'all';
  const via = res.resolvedKeyLabel ?? 'the resolved geography';

  const facts: MarketReadFact[] = [];
  const phrases: string[] = [];
  const add = (label: string, value: string | null, phrase: string | null): void => {
    if (value === null || phrase === null || facts.length >= 4) return;
    facts.push({ label, value });
    phrases.push(phrase);
  };
  add('Median $/acre', money(m.medianPricePerAcre), m.medianPricePerAcre === null ? null : `${money(m.medianPricePerAcre)}/acre`);
  add('Median DOM', domText(m.daysOnMarket), m.daysOnMarket === null ? null : `${Math.round(m.daysOnMarket)}-day median DOM`);
  add('Sell-through', pct(m.sellThroughRate), m.sellThroughRate === null ? null : `${pct(m.sellThroughRate)} sell-through`);
  add('Sold (period)', m.salesCount === null ? null : `${Math.round(m.salesCount)}`, m.salesCount === null ? null : `${Math.round(m.salesCount)} recorded sales`);

  return {
    available: true,
    headline: phrases.length
      ? `${via}, ${res.period}: ${phrases.join(' · ')}.`
      : `${via} holds a ${res.period} record, but none of the headline market metrics were retained.`,
    resolvedKey: res.resolvedKey,
    resolvedVia: via,
    matchLevel: res.matchLevel,
    exactSubjectBand,
    acreageBandLabel: bandUsed ? ACREAGE_BAND_LABEL[bandUsed] : null,
    period: res.period,
    staleness: res.staleness.label,
    isStale: res.staleness.isStale,
    facts,
    note: exactSubjectBand
      ? `LandOS Market Research record for the subject's own acreage band, carried by ${via}.`
      : `No LandOS Market Research record exists for the subject's acreage band, so this read is carried by ${via}. Band-specific demand stays unproven.`,
  };
}

/**
 * Liquidity and competition context for Comps & Valuation, from the same
 * resolution as the market read. `forSale` is the for-sale side of the same
 * subject geography; it answers "what is the subject competing against", and is
 * null rather than zero when the store carries no for-sale record.
 */
function buildMarketLiquidity(res: MarketMatrixResolution, forSale: MarketMatrixResolution): MarketLiquidityProjection {
  if (!res.available || !res.metrics) {
    return {
      available: false, resolvedKey: null, resolvedVia: null, acreageBandLabel: null,
      period: null, isStale: false,
      soldCount: null, activeCount: null, medianDaysOnMarket: null, sellThroughRate: null,
      absorptionRate: null, monthsOfSupply: null, medianPricePerAcre: null,
      liquidityLabel: null, competition: null,
      summary: res.note,
    };
  }
  const m = res.metrics;
  const via = res.resolvedKeyLabel ?? 'the resolved geography';
  const competition = forSale.available && forSale.metrics
    ? {
      activeListings: forSale.metrics.listingCount,
      medianPricePerAcre: forSale.metrics.medianPricePerAcre,
      medianDaysOnMarket: forSale.metrics.daysOnMarket,
      resolvedVia: forSale.resolvedKeyLabel,
      period: forSale.period,
    }
    : null;

  const parts: string[] = [];
  if (m.salesCount !== null) parts.push(`${Math.round(m.salesCount)} sold`);
  if (m.listingCount !== null) parts.push(`${Math.round(m.listingCount)} listed`);
  if (m.daysOnMarket !== null) parts.push(`${Math.round(m.daysOnMarket)}-day median DOM`);
  if (res.facts.liquidity) parts.push(res.facts.liquidity.toLowerCase());
  const competitionLine = competition && competition.activeListings !== null
    ? ` Active competition: ${Math.round(competition.activeListings)} for-sale listings${competition.medianPricePerAcre !== null ? ` around ${money(competition.medianPricePerAcre)}/acre` : ''} (${competition.resolvedVia ?? 'same geography'}, ${competition.period}).`
    : ' No for-sale record is retained for this geography, so active competition is unmeasured — not zero.';

  return {
    available: true,
    resolvedKey: res.resolvedKey,
    resolvedVia: via,
    acreageBandLabel: res.acreageBandUsed ? ACREAGE_BAND_LABEL[res.acreageBandUsed] : null,
    period: res.period,
    isStale: res.staleness.isStale,
    soldCount: m.salesCount,
    activeCount: m.listingCount,
    medianDaysOnMarket: m.daysOnMarket,
    sellThroughRate: m.sellThroughRate,
    absorptionRate: m.absorptionRate,
    monthsOfSupply: m.monthsOfSupply,
    medianPricePerAcre: m.medianPricePerAcre,
    liquidityLabel: res.facts.liquidity,
    competition,
    summary: `${via}, ${res.period}${parts.length ? `: ${parts.join(', ')}` : ''}.${competitionLine}`,
  };
}

function buildInterpretation(context: PropertyMarketContext): string {
  const parts: string[] = [];
  const countyName = context.geography.county ?? 'the county';
  const band = context.subjectBand;
  if (band.available && band.metrics) {
    const str = pct(band.metrics.sellThroughRate);
    const dom = band.metrics.medianDaysOnMarket;
    parts.push(`${countyName} ${band.acreageBandLabel} land ${str ? `is turning over at a ${str} sell-through rate` : 'has retained band data'}${dom !== null ? ` with a ${Math.round(dom)}-day median DOM` : ''}.`);
  } else if (context.read.available) {
    // The exact band missed, but research for this subject exists under a wider
    // key. Name it here so no surface can read "no record" beside a live market
    // read — band demand is still unproven, and that is what is said.
    parts.push(`No exact ${countyName} record exists for the subject acreage band, so the market read is carried by ${context.read.resolvedVia}; band demand is unproven, not assumed.`);
  } else {
    parts.push(`No exact ${countyName} record exists for the subject acreage band; band demand is unproven, not assumed.`);
  }
  const fastest = context.fastestBand;
  if (fastest.available && fastest.metrics && fastest.acreageBandLabel) {
    parts.push(`The fastest-selling county segment is ${fastest.acreageBandLabel} at ${pct(fastest.metrics.sellThroughRate) ?? 'an unstated rate'}.`);
  }
  const zip = context.zip;
  if (zip.available && zip.metrics) {
    parts.push(`ZIP ${context.geography.zip} recorded ${zip.metrics.soldCount ?? 'an unknown number of'} sales across ${(zip.acreageBandLabel ?? ACREAGE_BAND_LABEL.all).toLowerCase()} in the period.`);
  } else if (context.geography.zip) {
    parts.push(`No LandOS Market Research record exists for ZIP ${context.geography.zip} under any acreage band.`);
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
  // Every band label this acreage genuinely belongs to. A 60-acre subject is a
  // "50+" AND a "50–100" property, so a county filed under the other label is
  // still the subject's own band record — not a substitution, and not a miss.
  const subjectBandCandidates = acres !== null ? acreageBandsForAcres(acres) : [];
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

  const subjectSnapshot = (() => {
    for (const b of subjectBandCandidates) {
      const found = bandSnapshot(b);
      if (found) return found;
    }
    return undefined;
  })();
  const subjectBand: MarketContextRecord = subjectSnapshot
    ? fromDrilldownSnapshot('subject_band', `${countyLabel} — subject band ${ACREAGE_BAND_LABEL[subjectSnapshot.acreageBand]}`, subjectSnapshot)
    : unavailable('subject_band',
      subjectBandKey ? `${countyLabel} — subject band ${ACREAGE_BAND_LABEL[subjectBandKey]}` : `${countyLabel} — subject band`,
      subjectBandKey
        ? `No exact ${countyLabel} record exists for the ${subjectBandCandidates.map((b) => ACREAGE_BAND_LABEL[b]).join(' or ')} band; no unrelated band was substituted.`
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
  // county/state so its fallback chain cannot silently widen the GEOGRAPHY. It
  // does try the subject's own acreage bands after all-acreage, because a ZIP
  // record filed under a band label is still a record for this ZIP — the record
  // states which band carried it, so nothing is substituted silently.
  const zipResolution = input.zip
    ? resolveMarketMatrix({ zip: input.zip, acreageBand: 'all', acreageBands: subjectBandCandidates, side: 'sold' })
    : null;
  const zipBandUsed: AcreageBand = zipResolution?.acreageBandUsed ?? 'all';
  const zipLabel = (band: AcreageBand): string => `ZIP ${input.zip} (${ACREAGE_BAND_LABEL[band].toLowerCase()})`;
  const zip: MarketContextRecord = zipResolution && zipResolution.available && zipResolution.matchLevel === 'zip' && zipResolution.metrics
    ? {
      scope: 'zip',
      label: zipLabel(zipBandUsed),
      available: true,
      acreageBand: zipBandUsed,
      acreageBandLabel: ACREAGE_BAND_LABEL[zipBandUsed],
      period: zipResolution.period,
      snapshotDate: null,
      provider: zipResolution.provider,
      metrics: toContextMetrics(zipResolution.metrics),
      note: `LandOS Market Research ZIP record (${ACREAGE_BAND_LABEL[zipBandUsed]}, ${zipResolution.period}).`,
    }
    : unavailable('zip', input.zip ? zipLabel('all') : 'ZIP record', input.zip
      ? `No LandOS Market Research record exists for ZIP ${input.zip} under any acreage band; no other ZIP was substituted.`
      : 'The subject ZIP is unknown.');

  // The operator-facing read: the subject's FULL geography chain, sold side,
  // plus the for-sale side of the same chain for competition. One resolution
  // feeds both projections, so Property Intelligence and Comps & Valuation
  // cannot state different market facts.
  const readInput = {
    state: state ?? undefined,
    county: fips ?? input.county ?? undefined,
    zip: input.zip ?? undefined,
    // Unknown acreage asks for the all-acreage read explicitly, rather than
    // letting the default band imply a band this subject may not be in.
    acreageBand: subjectBandKey ?? ('all' as AcreageBand),
    acreageBands: subjectBandCandidates,
  };
  const soldResolution = resolveMarketMatrix({ ...readInput, side: 'sold' });
  const forSaleResolution = resolveMarketMatrix({ ...readInput, side: 'for_sale' });
  const read = buildMarketRead(soldResolution);
  const liquidity = buildMarketLiquidity(soldResolution, forSaleResolution);

  // The exact per-scope records stay exact — but a record that missed while the
  // subject's research exists elsewhere must say where, or the page contradicts
  // itself.
  if (!subjectBand.available && read.available && read.resolvedVia) {
    subjectBand.note = `${subjectBand.note} The market read for this subject is carried by ${read.resolvedVia} instead.`;
  }
  if (!county.available && read.available && read.resolvedVia && read.resolvedKey !== null && !read.resolvedKey.startsWith('county:')) {
    county.note = `${county.note} The market read for this subject is carried by ${read.resolvedVia} instead.`;
  }

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
    read,
    liquidity,
    interpretation: '',
    research: completeMarketResearchFor({
      countyFips: fips,
      countyName: countyName ?? input.county,
      zip: input.zip,
      subjectAcres: acres,
    }),
  };
  context.interpretation = buildInterpretation(context);
  return context;
}
