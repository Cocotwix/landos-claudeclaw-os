import { getLandosDb } from './db.js';
import { listCountyRef } from './market-matrix-store.js';
import { acreageBandForAcres } from './market-matrix-read.js';
import { ACREAGE_BAND_LABEL, type AcreageBand, type MarketMetrics } from './market-matrix.js';
import type { CompRegistry, UniqueComp } from './comp-registry.js';
import type { DealCardReportView } from './deal-card-report.js';
import type { BestCompsSelection } from './deal-card-reconciliation.js';
import type { OperatorPropertyRecord } from './operator-property-record.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';
import { landPortalValuationStats, type LandPortalComparableLike } from './landportal-valuation.js';
import { listPublicRecordOutcomes } from './lead-card-intake.js';

export interface OwnerMarketRow {
  area: string;
  level: 'county' | 'zip';
  metrics: MarketMetrics;
}

export interface OwnerMarketResearch {
  available: boolean;
  band: AcreageBand;
  bandLabel: string;
  period: string | null;
  source: string | null;
  county: OwnerMarketRow | null;
  zip: OwnerMarketRow | null;
  pulse: string[];
}

export interface OwnerGrade {
  name: 'Access' | 'Flood' | 'Wetlands' | 'Terrain & Usability' | 'Market Support';
  grade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F' | 'Pending';
  explanation: string;
  sourceNote: string | null;
}

export interface SoldCompMathRow {
  address: string;
  salePrice: number;
  acres: number;
  pricePerAcre: number;
  saleDate: string;
  source: string;
  sourceUrl: string | null;
  distanceMiles: number | null;
  why: string | null;
  statusLabel?: string | null;
}

export interface SoldCompValuation {
  available: boolean;
  comps: SoldCompMathRow[];
  averagePricePerAcre: number | null;
  subjectAcres: number | null;
  roughFairMarketValue: number | null;
  acquisitionBand: { low: number; high: number } | null;
  note: string;
}

export const OWNER_STRATEGY_NAMES = [
  'Quick Flip',
  'Novation or Double Close',
  'Subdivide or Minor Split',
  'Land-Home Package',
  'Improvement Then Flip',
] as const;

export interface OwnerStrategyEvaluation {
  strategy: typeof OWNER_STRATEGY_NAMES[number];
  suitability: 'Strong fit' | 'Conditional' | 'Weak fit' | 'Pending';
  why: string;
  mainRisk: string;
}

export interface DealCardOwnerAnalysis {
  market: OwnerMarketResearch;
  grades: OwnerGrade[];
  valuation: SoldCompValuation;
  strategies: OwnerStrategyEvaluation[];
  recommendation: string;
}

interface StoredMarketMetricRow {
  quarter: string;
  provider: string;
  source_ref: string;
  level: 'county' | 'zip';
  fips: string;
  zip: string;
  name: string;
  metrics_json: string;
}

export type MarketMetricLookup = (input: {
  level: 'county' | 'zip';
  state: string;
  fips: string;
  county: string;
  zip: string;
  band: AcreageBand;
}) => StoredMarketMetricRow | null;

function parseMetrics(raw: string): MarketMetrics | null {
  try {
    const parsed = JSON.parse(raw) as MarketMetrics;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function defaultMarketLookup(input: Parameters<MarketMetricLookup>[0]): StoredMarketMetricRow | null {
  const db = getLandosDb();
  const filterKey = `sold|land|12mo|${input.band}`;
  const geographyClause = input.level === 'county'
    ? input.fips ? 'g.fips = ?' : `LOWER(REPLACE(g.name, ' County', '')) = LOWER(?)`
    : 'g.zip = ?';
  const geographyValue = input.level === 'county' ? (input.fips || input.county) : input.zip;
  return db.prepare(`
    SELECT s.quarter, s.provider, m.source_ref, g.level, g.fips, g.zip, g.name, m.metrics_json
    FROM landos_mr_snapshot s
    JOIN landos_mr_metric m ON m.snapshot_id = s.id
    JOIN landos_mr_geography g ON g.id = m.geography_id
    WHERE s.filter_key = ? AND g.level = ? AND g.state = ? AND ${geographyClause}
    ORDER BY s.collected_at DESC, s.id DESC
    LIMIT 1
  `).get(filterKey, input.level, input.state, geographyValue) as StoredMarketMetricRow | undefined ?? null;
}

function resolveFips(state: string, county: string): string {
  if (/^\d{5}$/.test(county)) return county;
  const normalizeCounty = (value: string) => value.replace(/\s+county$/i, '').trim().toLowerCase();
  const normalized = normalizeCounty(county);
  return listCountyRef(state).find((row) => normalizeCounty(row.countyName) === normalized)?.fips ?? '';
}

const money = (value: number | null | undefined) => value == null ? 'unknown' : `$${Math.round(value).toLocaleString('en-US')}`;
const number = (value: number | null | undefined, digits = 0) => value == null ? 'unknown' : value.toLocaleString('en-US', { maximumFractionDigits: digits });

function marketPulse(county: OwnerMarketRow | null, zip: OwnerMarketRow | null): string[] {
  if (!county && !zip) return [];
  if (!county || !zip) {
    const row = county ?? zip!;
    return [
      `${row.area} supports pricing near ${money(row.metrics.medianPricePerAcre)}/acre, but the other local geography is unavailable and has not been substituted.`,
      `${number(row.metrics.salesCount)} closed land sales, ${number(row.metrics.daysOnMarket)} days on market, and ${number(row.metrics.monthsOfSupply, 2)} months of supply describe the available local activity.`,
    ];
  }
  const c = county.metrics;
  const z = zip.metrics;
  const ppaGap = c.medianPricePerAcre != null && z.medianPricePerAcre != null
    ? Math.abs(c.medianPricePerAcre - z.medianPricePerAcre)
    : null;
  const pricing = ppaGap != null && ppaGap <= Math.max(c.medianPricePerAcre!, z.medianPricePerAcre!) * 0.05
    ? `Pricing support is unusually consistent: ${money(c.medianPricePerAcre)}/acre countywide and ${money(z.medianPricePerAcre)}/acre in the ZIP, despite different median sale prices (${money(c.medianPrice)} vs. ${money(z.medianPrice)}).`
    : `Pricing reads ${money(c.medianPricePerAcre)}/acre countywide versus ${money(z.medianPricePerAcre)}/acre in the ZIP; use the difference as a local mix signal, not an automatic value adjustment.`;
  return [
    pricing,
    `Sales activity is broader in the county (${number(c.salesCount)} sales) than the ZIP (${number(z.salesCount)}), while ZIP absorption is ${number(z.absorptionRate, 2)}% versus ${number(c.absorptionRate, 2)}% countywide. The ZIP is the thinner sample even when its sell-through is stronger.`,
    `Resale speed needs patience: county DOM is ${number(c.daysOnMarket)} days with ${number(c.monthsOfSupply, 2)} months of supply; ZIP DOM is ${number(z.daysOnMarket)} days with ${number(z.monthsOfSupply, 2)} months of supply. Lower ZIP supply does not erase its much longer observed marketing time.`,
    `Demand is growing in both frames: ${number(c.population, 0)} county residents at ${number(c.populationGrowth, 2)}% growth and ${number(z.population, 0)} ZIP residents at ${number(z.populationGrowth, 2)}% growth. For this parcel, the county provides the stronger liquidity read while the ZIP corroborates price support but not a fast turn.`,
  ];
}

export function loadOwnerMarketResearch(input: {
  state?: string | null;
  county?: string | null;
  fips?: string | null;
  zip?: string | null;
  acres?: number | null;
}, lookup: MarketMetricLookup = defaultMarketLookup): OwnerMarketResearch {
  const state = (input.state ?? '').trim().toUpperCase();
  const countyName = (input.county ?? '').replace(/\s+county$/i, '').trim();
  const zip = (input.zip ?? '').trim();
  const fips = (input.fips ?? '').trim() || (state && countyName ? resolveFips(state, countyName) : '');
  const band = acreageBandForAcres(input.acres);
  const query = { state, fips, county: countyName, zip, band };
  const countyStored = state && (fips || countyName) ? lookup({ ...query, level: 'county' }) : null;
  const zipStored = state && zip ? lookup({ ...query, level: 'zip' }) : null;
  const toView = (stored: StoredMarketMetricRow | null, level: 'county' | 'zip'): OwnerMarketRow | null => {
    const metrics = stored ? parseMetrics(stored.metrics_json) : null;
    if (!stored || !metrics) return null;
    return { area: level === 'county' ? `${countyName || stored.name} County, ${state}` : `ZIP ${zip}`, level, metrics };
  };
  const county = toView(countyStored, 'county');
  const zipRow = toView(zipStored, 'zip');
  const newest = [countyStored, zipStored].filter((row): row is StoredMarketMetricRow => !!row)
    .sort((a, b) => b.quarter.localeCompare(a.quarter))[0] ?? null;
  return {
    available: !!county || !!zipRow,
    band,
    bandLabel: ACREAGE_BAND_LABEL[band],
    period: newest?.quarter ?? null,
    source: newest ? `${newest.provider} · Sold Land · trailing 12 months` : null,
    county,
    zip: zipRow,
    pulse: marketPulse(county, zipRow),
  };
}

function taskFinding(run: PublicIntelligenceRun | null | undefined, taskName: string): Record<string, unknown> | null {
  const task = run?.tasks?.find((entry) => entry.task === taskName);
  return task?.finding && typeof task.finding === 'object' ? task.finding as unknown as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percentFromText(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    const match = value?.match(/(\d+(?:\.\d+)?)\s*%/);
    if (match) return Number(match[1]);
    if (value && /\b(?:none|no wetlands?)\s+mapped\b|\bno mapped wetland/i.test(value)) return 0;
  }
  return null;
}

export function buildOwnerGrades(input: {
  report: Pick<DealCardReportView, 'landportalInspection' | 'reconciliation' | 'govDd'>;
  operatorRecord: OperatorPropertyRecord | null;
  publicRun?: PublicIntelligenceRun | null;
  market: OwnerMarketResearch;
}): OwnerGrade[] {
  const factSheet = input.report.landportalInspection?.factSheet;
  const floodFinding = taskFinding(input.publicRun, 'fema_flood');
  const wetlandsFinding = taskFinding(input.publicRun, 'wetlands');
  const slopeFinding = taskFinding(input.publicRun, 'slope_topography');
  const wetlandsCard = input.operatorRecord?.decisionCards.find((card) => card.key === 'wetlands');
  const publicWetPct = num(wetlandsFinding?.approximateParcelPercentage)
    ?? (wetlandsFinding?.intersects === false ? 0 : null);
  const reconciledWetPct = percentFromText(input.report.reconciliation?.wetlands?.primary);
  const wetPct = reconciledWetPct
    ?? percentFromText(
      wetlandsCard?.headline,
      wetlandsCard?.detail,
      input.report.govDd?.wetlands?.note,
    )
    ?? publicWetPct;
  const wetlandSource = reconciledWetPct != null
    ? input.report.reconciliation?.wetlands?.primarySource ?? 'LandPortal parcel'
    : publicWetPct != null ? 'USFWS NWI parcel overlay' : wetlandsCard?.basis ?? 'Reconciled parcel wetland evidence';
  const meanSlope = num(slopeFinding?.meanSlopePct);
  const highSlopeShare = Array.isArray(slopeFinding?.bands)
    ? num((slopeFinding!.bands as Array<Record<string, unknown>>).find((row) => row.band === 'above_25')?.parcelPercentage)
    : null;
  const frontage = factSheet?.access?.roadFrontageFt ?? null;
  const notLandlocked = /^no$/i.test(String(factSheet?.access?.landLocked ?? ''));
  const accessConflict = input.operatorRecord?.accessStatus.status && input.operatorRecord.accessStatus.status !== 'unknown';
  const access: OwnerGrade = frontage != null && notLandlocked
    ? {
        name: 'Access', grade: accessConflict ? 'B-' : 'B+',
        explanation: `${Math.round(frontage)} ft of parcel-record frontage and not landlocked; confirm the serving road, driveway, and recorded legal access before closing.`,
        sourceNote: 'LandPortal parcel facts; public road screening',
      }
    : { name: 'Access', grade: 'Pending', explanation: 'Usable physical and legal access are not established by the retained facts.', sourceNote: null };
  const zones = Array.isArray(floodFinding?.zones) ? floodFinding!.zones as Array<Record<string, unknown>> : [];
  const sfhaPct = zones.reduce((sum, zone) => zone.specialFloodHazardArea === true ? sum + (num(zone.parcelPercentage) ?? 0) : sum, 0);
  const floodZone = input.report.govDd?.flood?.zone ?? null;
  const flood: OwnerGrade = zones.length || floodZone
    ? sfhaPct <= 0 && /^x$/i.test(String(floodZone ?? zones[0]?.zone ?? ''))
      ? { name: 'Flood', grade: 'A', explanation: 'Zone X with no mapped Special Flood Hazard Area coverage supports normal flood risk.', sourceNote: 'FEMA parcel screen' }
      : { name: 'Flood', grade: sfhaPct >= 50 ? 'D' : sfhaPct > 10 ? 'C-' : 'B-', explanation: `${number(sfhaPct, 1)}% mapped high-risk flood coverage; confirm building and access impacts.`, sourceNote: 'FEMA parcel screen' }
    : { name: 'Flood', grade: 'Pending', explanation: 'Parcel-wide FEMA coverage is unavailable.', sourceNote: null };
  const wetlands: OwnerGrade = wetPct != null
    ? wetPct <= 1 ? { name: 'Wetlands', grade: 'A', explanation: 'No material mapped wetland coverage affects the parcel screen.', sourceNote: wetlandSource }
      : wetPct <= 5 ? { name: 'Wetlands', grade: 'A-', explanation: `Only about ${number(wetPct, 2)}% mapped wetland coverage; most acreage remains outside the mapped area.`, sourceNote: wetlandSource }
        : { name: 'Wetlands', grade: wetPct >= 30 ? 'D' : 'C', explanation: `About ${number(wetPct, 2)}% mapped wetland coverage may constrain site placement.`, sourceNote: wetlandSource }
    : { name: 'Wetlands', grade: 'Pending', explanation: 'Parcel-wide mapped wetland coverage is unavailable.', sourceNote: null };
  const buildablePct = typeof factSheet?.buildability?.pct === 'string' ? Number(factSheet.buildability.pct.replace('%', '')) : null;
  const buildableAcres = typeof factSheet?.buildability?.acres === 'string' ? Number(factSheet.buildability.acres.replace(/[^0-9.]/g, '')) : null;
  const terrain: OwnerGrade = meanSlope != null
    ? {
        name: 'Terrain & Usability',
        grade: meanSlope >= 30 || (highSlopeShare ?? 0) >= 50 ? 'D+' : meanSlope >= 20 ? 'C-' : meanSlope >= 12 ? 'B-' : 'A-',
        explanation: `Terrain screening averages ${number(meanSlope, 1)}% slope${highSlopeShare != null ? ` with ${number(highSlopeShare, 1)}% of samples above 25%` : ''}${buildablePct != null ? `; LandPortal indicates ${number(buildablePct, 2)}% (${number(buildableAcres, 2)} ac) readily buildable` : ''}. Moderate slopes may still be buildable, but site layout and grading need confirmation.`,
        sourceNote: 'USGS terrain screen; LandPortal buildability context',
      }
    : { name: 'Terrain & Usability', grade: 'Pending', explanation: 'Usable terrain and buildable area are not sufficiently established.', sourceNote: null };
  const c = input.market.county?.metrics;
  const z = input.market.zip?.metrics;
  const marketSupport: OwnerGrade = c && z
    ? {
        name: 'Market Support', grade: (c.salesCount ?? 0) >= 20 && (z.salesCount ?? 0) >= 5 ? 'B-' : 'C',
        explanation: `${number(c.salesCount)} county and ${number(z.salesCount)} ZIP sales support pricing near ${money(c.medianPricePerAcre)}/acre, but ${number(z.daysOnMarket)}-day ZIP DOM tempers liquidity.`,
        sourceNote: `${input.market.bandLabel}; Sold Land; trailing 12 months`,
      }
    : { name: 'Market Support', grade: 'Pending', explanation: 'Both county and ZIP acreage-band snapshots are required for a market grade.', sourceNote: null };
  return [access, flood, wetlands, terrain, marketSupport];
}

function relevantSold(comp: UniqueComp): SoldCompMathRow | null {
  if (!['direct_comparable', 'secondary_local_comparable'].includes(comp.comparability)) return null;
  const tx = comp.transactions.find((row) => row.kind === 'sold' && row.qualification.qualifiedForValuation);
  if (!tx || tx.price == null || tx.price <= 0 || tx.acres == null || tx.acres <= 0 || !tx.dateIso) return null;
  return {
    address: comp.address ?? 'Address not recorded',
    salePrice: tx.price,
    acres: tx.acres,
    pricePerAcre: Math.round(tx.price / tx.acres),
    saleDate: tx.dateIso,
    source: comp.providersDisplay.join(' + ') || 'Recorded sale',
    sourceUrl: tx.sourceUrls[0] ?? null,
    distanceMiles: comp.distanceMiles,
    why: comp.comparabilityWhy,
  };
}

export function buildSoldCompValuation(
  registry: CompRegistry,
  subjectAcres: number | null,
  bestComps?: BestCompsSelection | null,
): SoldCompValuation {
  const ranked = bestComps?.comps
    .filter((comp) => comp.lane === 'sold' && comp.price != null && comp.price > 0 && comp.acres != null && comp.acres > 0)
    .slice(0, 5)
    .map((comp): SoldCompMathRow => ({
      address: comp.addressDesc ?? 'Address not recorded',
      salePrice: comp.price!,
      acres: comp.acres!,
      pricePerAcre: Math.round(comp.price! / comp.acres!),
      saleDate: comp.saleDateIso ?? 'Date not recorded',
      source: comp.source,
      sourceUrl: comp.sourceUrl,
      distanceMiles: comp.distanceMiles,
      why: comp.why,
    })) ?? [];
  const comps = bestComps != null
    ? ranked
    : registry.validatedSold.map(relevantSold).filter((row): row is SoldCompMathRow => !!row).slice(0, 5);
  if (comps.length === 0 || subjectAcres == null || subjectAcres <= 0) {
    return {
      available: false,
      comps,
      averagePricePerAcre: null,
      subjectAcres,
      roughFairMarketValue: null,
      acquisitionBand: null,
      note: comps.length === 0
        ? 'Sold-comp valuation pending: no accepted closed vacant-land sale with usable price and acreage is available.'
        : 'Sold-comp valuation pending until the subject acreage is confirmed.',
    };
  }
  const averagePricePerAcre = Math.round(comps.reduce((sum, row) => sum + row.pricePerAcre, 0) / comps.length);
  const roughFairMarketValue = Math.round(averagePricePerAcre * subjectAcres);
  return {
    available: true,
    comps,
    averagePricePerAcre,
    subjectAcres,
    roughFairMarketValue,
    acquisitionBand: { low: Math.round(roughFairMarketValue * 0.4), high: Math.round(roughFairMarketValue * 0.6) },
    note: `FMV uses the average sold price per acre from the ${comps.length} closest available accepted sold comp${comps.length === 1 ? '' : 's'}, ranked by acreage similarity, location, recency, and source strength. Asking references and improved or manufactured-home sales are not used.`,
  };
}

export function buildLandPortalCompValuation(
  rows: LandPortalComparableLike[] | null | undefined,
  subjectAcres: number | null,
): SoldCompValuation {
  const stats = landPortalValuationStats(rows, subjectAcres);
  const comps: SoldCompMathRow[] = stats.comps.map((row) => ({
    address: row.address || (row.apn ? `APN ${row.apn}` : 'LandPortal comparable'),
    salePrice: row.price,
    acres: row.acres,
    pricePerAcre: row.pricePerAcre,
    saleDate: row.saleDate ?? '',
    source: 'LandPortal',
    sourceUrl: row.sourceUrl ?? null,
    distanceMiles: row.distanceMiles ?? null,
    why: 'Selected under the LandPortal FMV rule for acreage and local similarity.',
    statusLabel: /^sold$/i.test(row.status ?? '') ? 'Sold' : 'LandPortal comp',
  }));
  if (!comps.length || subjectAcres == null || subjectAcres <= 0 || stats.averagePricePerAcre == null) {
    return {
      available: false, comps, averagePricePerAcre: null, subjectAcres,
      roughFairMarketValue: null, acquisitionBand: null,
      note: !comps.length
        ? 'LandPortal-comp valuation pending: no LandPortal row with both price and acreage is available.'
        : 'LandPortal-comp valuation pending until the subject acreage is confirmed.',
    };
  }
  const roughFairMarketValue = Math.round(stats.averagePricePerAcre * subjectAcres);
  return {
    available: true, comps, averagePricePerAcre: stats.averagePricePerAcre, subjectAcres,
    roughFairMarketValue,
    acquisitionBand: { low: Math.round(roughFairMarketValue * 0.4), high: Math.round(roughFairMarketValue * 0.6) },
    note: `FMV uses the arithmetic average of exact price divided by acres across the ${comps.length} closest usable LandPortal comp${comps.length === 1 ? '' : 's'}. When fewer than five are available, LandOS uses every usable LandPortal row. Other provider comps remain visible for context but do not influence FMV or the 40-60% rough offer range.`,
  };
}

export function buildOwnerStrategies(input: {
  report: Pick<DealCardReportView, 'landportalInspection'>;
  operatorRecord: OperatorPropertyRecord | null;
  publicRun?: PublicIntelligenceRun | null;
  market: OwnerMarketResearch;
  valuation: SoldCompValuation;
  publicRecords?: Array<Record<string, unknown>>;
}): { strategies: OwnerStrategyEvaluation[]; recommendation: string } {
  const factSheet = input.report.landportalInspection?.factSheet;
  const acres = factSheet?.acres ?? input.operatorRecord?.identity.assessedAcres ?? null;
  const slope = taskFinding(input.publicRun, 'slope_topography');
  const meanSlope = num(slope?.meanSlopePct);
  const frontage = factSheet?.access?.roadFrontageFt ?? null;
  const septic = input.operatorRecord?.septicOutlook.outlook ?? 'unknown';
  const zoning = taskFinding(input.publicRun, 'zoning_landuse');
  const utilities = taskFinding(input.publicRun, 'utilities');
  const county = input.market.county?.metrics;
  const zip = input.market.zip?.metrics;
  const marketBasis = county && zip
    ? `${number(county.salesCount)} county and ${number(zip.salesCount)} ZIP sales at roughly ${money(county.medianPricePerAcre)}/acre`
    : 'the available local market snapshot';
  const valueBasis = input.valuation.available
    ? `The LandPortal comp set supports about ${money(input.valuation.roughFairMarketValue)} rough value.`
    : 'The LandPortal comp set is not yet sufficient for a subject value.';
  const resaleTiming = zip?.daysOnMarket != null
    ? `${number(zip.daysOnMarket)}-day ZIP marketing time`
    : 'unresolved ZIP marketing time';
  const terrainCharacter = meanSlope == null
    ? 'unresolved terrain'
    : meanSlope >= 15
      ? 'steep terrain'
      : meanSlope >= 5
        ? 'rolling terrain'
        : 'generally gentle terrain';
  const zoningRecord = input.publicRecords?.find((row) => row.category === 'planning_zoning_subdivision' && row.retrieval_status === 'retrieved_yes');
  const zoningFacts = zoningRecord?.facts && typeof zoningRecord.facts === 'object'
    ? zoningRecord.facts as Record<string, unknown>
    : {};
  const splitRules = typeof zoningFacts.subdivision_rules === 'string'
    ? zoningFacts.subdivision_rules
    : 'Planning approval, a recordable survey/plat, qualifying road frontage and access, septic approval, utilities, and exact zoning still need confirmation.';
  const practicalYield = typeof zoningFacts.practical_lot_yield === 'string'
    ? zoningFacts.practical_lot_yield
    : null;
  const manufacturedRule = typeof zoningFacts.manufactured_home_conclusion === 'string'
    ? zoningFacts.manufactured_home_conclusion
    : null;
  const strategies: OwnerStrategyEvaluation[] = [
    {
      strategy: 'Quick Flip',
      suitability: input.valuation.available ? 'Strong fit' : 'Pending',
      why: `${marketBasis} provides resale context. ${valueBasis} The ${resaleTiming} and ${terrainCharacter} favor a disciplined basis and light-touch resale rather than speculative work.`,
      mainRisk: 'Confirm title, legal/physical access, and the LandPortal comp inputs before funding the purchase.',
    },
    {
      strategy: 'Novation or Double Close',
      suitability: input.market.available ? 'Conditional' : 'Pending',
      why: 'This can avoid funding a narrow or uncertain spread while testing the same rural land buyer pool. It fits better than a cash close when resale timing or value confidence is weak.',
      mainRisk: 'An end buyer, assignable/novation-ready contract terms, title timing, and closing costs must be lined up before commitment.',
    },
    {
      strategy: 'Subdivide or Minor Split',
      suitability: zoningRecord && acres != null && acres >= 5 ? 'Conditional' : acres == null ? 'Pending' : 'Weak fit',
      why: `${acres != null ? `${number(acres, 2)} acres is large enough to investigate a minor split` : 'Acreage is not confirmed'}, but ${meanSlope != null ? `${number(meanSlope, 1)}% average slope` : 'terrain is not fully resolved'}, ${frontage != null ? `${number(frontage)} ft of parcel-record frontage` : 'unconfirmed frontage'}, and ${septic === 'poor' ? 'very-limited mapped septic soils' : 'unconfirmed septic capacity'} make buildable yield uncertain. ${practicalYield ?? 'A legal split is not the same as a buildable, economic split.'}`,
      mainRisk: zoningRecord ? splitRules : zoning ? 'Confirm the governing minimum lot size, road-frontage standard, survey/road requirements, and minor-versus-major subdivision process in the ordinance.' : 'Subdivision regulations have not been retrieved; confirm minimum lot size, frontage, access, septic, utilities, and minor-versus-major rules with county planning.',
    },
    {
      strategy: 'Land-Home Package',
      suitability: acres != null && acres >= 0.5 && septic !== 'poor' ? 'Conditional' : septic === 'poor' ? 'Weak fit' : 'Pending',
      why: `${acres != null && acres >= 0.5 ? 'The parcel clears the basic acreage screen for one home' : 'The basic site acreage is not established'}, but a workable pad, drain field, driveway, and utility tie-ins remain unconfirmed${septic === 'poor' ? '; mapped soils are very limited for septic absorption fields' : ''}. ${manufacturedRule ?? 'Manufactured-home permission and the exact parcel zoning still need confirmation.'}`,
      mainRisk: `${utilities ? 'Confirm actual service and tie-in cost' : 'Utilities are not mapped well enough to price tie-ins'}; retrieve manufactured-home rules and verify nearby manufactured-home sales at or above $200,000 within five miles before expanding to ten miles for rural scarcity.`,
    },
    {
      strategy: 'Improvement Then Flip',
      suitability: frontage != null ? 'Conditional' : 'Pending',
      why: `Driveway/access work, selective clearing, a verified build site, and perc/septic work are the improvements most likely to help. ${meanSlope != null && meanSlope >= 25 ? 'Steep terrain makes broad clearing or grading expensive, so improvements should stay targeted.' : 'The value lift must be tied to a buyer-relevant site improvement.'}`,
      mainRisk: 'Obtain bids and resale support first; grading, driveway, engineered septic, or utility costs can exceed the value lift.',
    },
  ];
  const recommendation = input.valuation.available
    ? 'Highest and best near-term use is a disciplined quick flip or novation/double close at the LandPortal-comp basis. A split, land-home package, or major site work does not yet show enough practical upside for the juice to be worth the squeeze.'
    : 'Highest and best use is not ready for a funded acquisition decision. Keep quick flip or novation as the lead paths after closed-sale value, access, and title are confirmed; the terrain, septic, and rule gaps make subdivision, land-home, and heavier improvements too speculative for the juice to be worth the squeeze today.';
  return { strategies, recommendation };
}

export function buildDealCardOwnerAnalysis(input: {
  report: DealCardReportView;
  registry: CompRegistry;
  operatorRecord: OperatorPropertyRecord | null;
  publicRun?: PublicIntelligenceRun | null;
  geography: { state?: string | null; county?: string | null; fips?: string | null; zip?: string | null; acres?: number | null };
  dealCardId?: number;
  marketLookup?: MarketMetricLookup;
}): DealCardOwnerAnalysis {
  const subjectAcres = input.geography.acres ?? input.report.landportalInspection?.factSheet?.acres ?? null;
  const market = loadOwnerMarketResearch({ ...input.geography, acres: subjectAcres }, input.marketLookup);
  const grades = buildOwnerGrades({ report: input.report, operatorRecord: input.operatorRecord, publicRun: input.publicRun, market });
  const valuation = buildLandPortalCompValuation(input.report.landportalInspection?.comparables, subjectAcres);
  const publicRecords = input.dealCardId == null ? [] : listPublicRecordOutcomes(input.dealCardId);
  const strategyResult = buildOwnerStrategies({ report: input.report, operatorRecord: input.operatorRecord, publicRun: input.publicRun, market, valuation, publicRecords });
  return { market, grades, valuation, ...strategyResult };
}
