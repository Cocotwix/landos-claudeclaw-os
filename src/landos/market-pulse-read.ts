// LandOS — Market Pulse Read v1 (concise, usable, honest).
//
// Answers the questions a land buyer actually asks, in plain English:
//   - Is the area growing, stable, or declining? (population trend)
//   - What is land generally going for per acre in the county?
//   - What is it going for near the ZIP / market area (when there's enough data)?
//   - What development / growth signals matter?
//
// Real numbers only. Growth is measured from the U.S. Census ACS (two vintages)
// when the free CENSUS_API_KEY is configured; otherwise it degrades honestly to
// the official on-demand source (never a fabricated number). County / ZIP price-
// per-acre is computed from comps already retrieved by the pipeline (no new paid
// call). Concise: this is a pulse, not a multi-page report.
//
// The pure core (buildMarketPulseRead) is DB/network-free and fully testable;
// fetchMarketPulseRead is the thin live wrapper (Census two-vintage lookup).

import { buildLocalAreaContext } from './source-adapters.js';
import { fetchCensusDemographics, type CensusDeps } from './census-demographics.js';

export type GrowthDirection = 'growing' | 'stable' | 'declining' | 'unknown';

export interface GrowthRead {
  status: 'measured' | 'source_available' | 'not_configured' | 'no_geography';
  direction: GrowthDirection;
  populationRecent: number | null;
  populationPrior: number | null;
  pctChange: number | null;
  years: [number, number] | null;
  source: string | null;
  note: string;
}

export interface PricePerAcreRead {
  status: 'measured' | 'data_gap';
  medianPpa: number | null;
  sampleSize: number;
  source: string | null;
  note: string;
}

export interface MarketPulseRead {
  eligible: boolean;
  area: { city?: string; county?: string; state?: string; zip?: string; descriptor: string };
  parcelVerified: boolean;
  label: 'Local Area Context, Not Parcel Verified' | 'Parcel Verified';
  growth: GrowthRead;
  countyPricePerAcre: PricePerAcreRead;
  zipPricePerAcre: PricePerAcreRead | null;
  developmentSignals: { status: 'source_available'; source: string; note: string };
  /** The one-paragraph operator read. */
  plainEnglish: string;
  disclaimer: string;
  generatedAt: string;
}

/** A comp the pulse can derive price-per-acre from (already retrieved upstream). */
export interface PulseComp {
  pricePerAcre?: number | null;
  price?: number | null;
  acres?: number | null;
  zip?: string | null;
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Price-per-acre for a comp: use pricePerAcre, else derive from price/acres. */
function ppaOf(c: PulseComp): number | null {
  if (typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0) return c.pricePerAcre;
  if (typeof c.price === 'number' && c.price > 0 && typeof c.acres === 'number' && c.acres > 0) {
    return Math.round(c.price / c.acres);
  }
  return null;
}

function pricePerAcre(comps: PulseComp[], scope: string): PricePerAcreRead {
  const ppas = comps.map(ppaOf).filter((n): n is number => n != null && n > 0);
  if (ppas.length === 0) {
    return { status: 'data_gap', medianPpa: null, sampleSize: 0, source: null, note: `No comps with usable price-per-acre for ${scope} yet.` };
  }
  return {
    status: 'measured', medianPpa: median(ppas), sampleSize: ppas.length,
    source: 'Retained land comps (pipeline)',
    note: `${scope}: median $${median(ppas)!.toLocaleString()}/acre from ${ppas.length} comp(s).`,
  };
}

function directionOf(pct: number): GrowthDirection {
  if (pct >= 3) return 'growing';
  if (pct <= -3) return 'declining';
  return 'stable';
}

/** Growth read from two ACS population snapshots (or an honest fallback). */
export interface CensusSnapshot { year: number; population: number | null; status: string }

export function buildGrowthRead(input: {
  recent?: CensusSnapshot | null;
  prior?: CensusSnapshot | null;
  area: string;
  sourceUrl: string;
  hasGeography: boolean;
}): GrowthRead {
  const { recent, prior, area, sourceUrl, hasGeography } = input;
  if (!hasGeography) {
    return { status: 'no_geography', direction: 'unknown', populationRecent: null, populationPrior: null, pctChange: null, years: null, source: null, note: `No county geography for ${area} — growth not measurable yet.` };
  }
  if (recent?.status === 'not_configured') {
    return {
      status: 'not_configured', direction: 'unknown', populationRecent: null, populationPrior: null, pctChange: null, years: null,
      source: sourceUrl,
      note: `Growth trend not measured (free CENSUS_API_KEY not set). Official population source linked; add the free key to auto-measure growing/stable/declining.`,
    };
  }
  const rp = recent?.population ?? null;
  const pp = prior?.population ?? null;
  if (rp == null || pp == null || pp <= 0 || !recent || !prior) {
    return {
      status: 'source_available', direction: 'unknown', populationRecent: rp, populationPrior: pp, pctChange: null,
      years: recent && prior ? [prior.year, recent.year] : null, source: sourceUrl,
      note: `Population figures incomplete for ${area}; retrieve current figures from the official source.`,
    };
  }
  const pct = Math.round(((rp - pp) / pp) * 1000) / 10;
  return {
    status: 'measured', direction: directionOf(pct), populationRecent: rp, populationPrior: pp, pctChange: pct,
    years: [prior.year, recent.year], source: sourceUrl,
    note: `${area} population ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% (${pp.toLocaleString()} → ${rp.toLocaleString()}, ${prior.year}→${recent.year}).`,
  };
}

/**
 * Assemble the Market Pulse read from resolved area + growth + comps. Pure and
 * deterministic (timestamp injectable). Never fabricates a number.
 */
export function buildMarketPulseRead(input: {
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
  parcelVerified: boolean;
  growth: GrowthRead;
  comps?: PulseComp[];
  nowIso?: string;
}): MarketPulseRead {
  const ctx = buildLocalAreaContext({ city: input.city, county: input.county, state: input.state });
  const eligible = ctx.hasCityState || ctx.hasCountyState;
  const area = ctx.areaDescriptor;
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const label = input.parcelVerified ? 'Parcel Verified' : 'Local Area Context, Not Parcel Verified';
  const comps = input.comps ?? [];

  const countyPpa = pricePerAcre(comps, county0(input.county) ?? 'County');
  const zipComps = input.zip ? comps.filter((c) => (c.zip ?? '').trim() === input.zip!.trim()) : [];
  const zipPpa = input.zip && zipComps.length >= 3 ? pricePerAcre(zipComps, `ZIP ${input.zip}`) : null;

  const developmentSignals = {
    status: 'source_available' as const,
    source: `https://www.google.com/search?q=${encodeURIComponent(`${area} new development OR subdivision OR employer OR infrastructure`)}`,
    note: `Scan ${area} for new development, subdivisions, major employers, and infrastructure. Confirm named signals before relying on them.`,
  };

  const plainEnglish = buildPlainEnglish({ area, growth: input.growth, countyPpa, zipPpa, zip: input.zip, eligible });
  const disclaimer = input.parcelVerified
    ? ''
    : 'Local area context only. It does not verify the parcel and carries no property-specific valuation or offer guidance.';

  return {
    eligible,
    area: { city: input.city, county: input.county, state: input.state, zip: input.zip, descriptor: area },
    parcelVerified: input.parcelVerified,
    label,
    growth: input.growth,
    countyPricePerAcre: countyPpa,
    zipPricePerAcre: zipPpa,
    developmentSignals,
    plainEnglish,
    disclaimer,
    generatedAt,
  };
}

function county0(county?: string): string | undefined {
  const c = (county ?? '').trim();
  return c ? (/county$/i.test(c) ? c : `${c} County`) : undefined;
}

function buildPlainEnglish(input: { area: string; growth: GrowthRead; countyPpa: PricePerAcreRead; zipPpa: PricePerAcreRead | null; zip?: string; eligible: boolean }): string {
  if (!input.eligible) return 'Not enough location to read the market. Provide city + state or county + state.';
  const parts: string[] = [];
  // Growth sentence.
  if (input.growth.status === 'measured' && input.growth.pctChange != null) {
    parts.push(`${input.area} is ${input.growth.direction} (population ${input.growth.pctChange >= 0 ? '+' : ''}${input.growth.pctChange}% over ${input.growth.years ? input.growth.years[1] - input.growth.years[0] : 5} years).`);
  } else if (input.growth.status === 'not_configured') {
    parts.push(`Growth trend for ${input.area} is not yet measured (add the free Census key to auto-measure); official population source is linked.`);
  } else {
    parts.push(`Growth trend for ${input.area} is unknown — retrieve population from the linked official source.`);
  }
  // Price-per-acre sentence.
  if (input.countyPpa.status === 'measured' && input.countyPpa.medianPpa != null) {
    parts.push(`Land is generally going for about $${input.countyPpa.medianPpa.toLocaleString()}/acre in the county (median of ${input.countyPpa.sampleSize} comp${input.countyPpa.sampleSize === 1 ? '' : 's'}).`);
    if (input.zipPpa?.medianPpa != null) parts.push(`Near ZIP ${input.zip}: ~$${input.zipPpa.medianPpa.toLocaleString()}/acre (${input.zipPpa.sampleSize} comps).`);
  } else {
    parts.push('County price-per-acre is not established yet — gather land comps to anchor it.');
  }
  return parts.join(' ');
}

// ── Live wrapper ───────────────────────────────────────────────────────────

const RECENT_YEAR = 2023;
const PRIOR_YEAR = 2018;

/** Live Market Pulse: measures growth from two ACS vintages when the free Census
 *  key is configured, and derives county/ZIP price-per-acre from provided comps.
 *  Degrades honestly (never fabricates) when the key is absent. */
export async function fetchMarketPulseRead(input: {
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
  fips?: string;
  parcelVerified: boolean;
  comps?: PulseComp[];
  nowIso?: string;
}, deps: { census?: CensusDeps } = {}): Promise<MarketPulseRead> {
  const ctx = buildLocalAreaContext({ city: input.city, county: input.county, state: input.state });
  const area = ctx.areaDescriptor;
  const sourceUrl = `https://data.census.gov/all?q=${encodeURIComponent(`${area} population`)}`;
  const fips = (input.fips ?? '').trim();
  const hasGeography = /^\d{5}$/.test(fips);

  let growth: GrowthRead;
  if (!hasGeography) {
    growth = buildGrowthRead({ area, sourceUrl, hasGeography: false });
  } else {
    const recentD = await fetchCensusDemographics(fips, { ...deps.census, year: String(RECENT_YEAR) });
    if (recentD.status === 'not_configured') {
      growth = buildGrowthRead({ recent: { year: RECENT_YEAR, population: null, status: 'not_configured' }, area, sourceUrl, hasGeography: true });
    } else if (recentD.status !== 'verified') {
      growth = buildGrowthRead({ recent: { year: RECENT_YEAR, population: recentD.population, status: recentD.status }, area, sourceUrl, hasGeography: true });
    } else {
      const priorD = await fetchCensusDemographics(fips, { ...deps.census, year: String(PRIOR_YEAR) });
      growth = buildGrowthRead({
        recent: { year: RECENT_YEAR, population: recentD.population, status: 'verified' },
        prior: { year: PRIOR_YEAR, population: priorD.population, status: priorD.status },
        area, sourceUrl, hasGeography: true,
      });
    }
  }

  return buildMarketPulseRead({
    city: input.city, county: input.county, state: input.state, zip: input.zip,
    parcelVerified: input.parcelVerified, growth, comps: input.comps, nowIso: input.nowIso,
  });
}
