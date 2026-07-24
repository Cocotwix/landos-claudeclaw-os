// LandOS — Deal Card Executive Summary (Phases 5/6/8).
//
// Synthesizes the already-retrieved verified facts + comp metrics + gov DD +
// strategy into ONE operator-ready pre-call brief — what an experienced
// acquisitions manager would write at the top of the file. Pure function over the
// persisted report; interprets and estimates from VERIFIED evidence, labels
// confidence + assumptions, and never blocks on incomplete DD (per 07_Product_
// Principles). No fabrication: ranges are only produced when verified sold comps
// exist; everything carries its basis.

import { operatorizePersistedGap, type DealCardReportView } from './deal-card-report.js';
import type { GrowthDriverSummary } from './browser-market-intelligence.js';

import type { PublicIntelligenceRun, PublicIntelligenceTaskRecord } from './public-property-intelligence.js';
import { landPortalValuationStats } from './landportal-valuation.js';
export type MarketDirection = 'strengthening' | 'softening' | 'stable' | 'unknown';

export interface MarketPulseSynthesis {
  realieSoldCount: number;
  zillowActiveCount: number;
  zillowSupplementalSoldCount: number;
  /** Total verifiable sold land comps that drove the band (all providers). */
  soldCount: number;
  /** Total active land listings (all providers — Zillow + HomeHarvest). */
  activeCount: number;
  pricePerAcre: { p25: number | null; median: number | null; p75: number | null; low: number | null; high: number | null };
  domMedian: number | null;
  /** Months of inventory = active supply ÷ monthly sold rate. < 6 = seller's
   *  market, 6–12 = balanced, > 12 = soft/oversupplied. Null when uncomputable. */
  monthsOfInventory: number | null;
  /** Sell-through proxy: sold ÷ (sold + active), as a percent. */
  sellThroughPct: number | null;
  /** Direction of the per-acre band over time (recent half vs older half). */
  direction: MarketDirection;
  /** Recent-vs-older median PPA change, percent (null when too few dated comps). */
  directionPct: number | null;
  supply: string;
  demand: string;
  liquidity: string;
  absorption: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  sparseExplanation: string | null;
  interpretation: string;
  whatThisMeans: string;
  /** The headline answer: is this land market getting stronger or weaker, and why? */
  verdict: string;
  /** Local growth drivers synthesized from Browser Intelligence (operator summary).
   *  Each driver carries up to two named example signals (real developments /
   *  rezonings / infrastructure) so Market Pulse names them, not just counts. */
  growthDrivers: { available: boolean; summary: string; whatThisMeans: string; drivers: Array<{ category: string; count: number; examples: string[]; whyItMatters: string }> };
}

export interface PreliminaryAcquisitionRange {
  available: boolean;
  acres: number | null;
  estConservativeValue: number | null;   // p25 PPA × acres
  estMarketRange: [number, number] | null; // [p25×acres, p75×acres]
  estMidValue: number | null;             // median PPA × acres
  acquisition40: number | null;
  acquisition60: number | null;
  recommendedRange: [number, number] | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  assumptions: string[];
  increaseValueIf: string[];
  decreaseValueIf: string[];
  note: string;
}

export interface StrategyRank {
  strategy: string;
  viability: 'high' | 'medium' | 'low' | 'not_viable';
  reason: string;
  risk: string;
  confidence: 'high' | 'medium' | 'low';
  mustVerify: string;
  score: number;
}

export interface DealEconomics {
  available: boolean;
  estValueLow: number | null;
  estValueMid: number | null;
  estValueHigh: number | null;
  acquisitionRange: [number, number] | null;
  roughSpread: [number, number] | null; // mid value minus acquisition band (gross, pre-cost)
  confidence: 'high' | 'medium' | 'low' | 'none';
  assumptions: string[];
  missingCostItems: string[];
  whyUnderwritingLater: string;
}

export interface ExecutiveSummary {
  headline: string;
  whatItIs: string;
  whyInteresting: string;
  marketPulse: MarketPulseSynthesis;
  preliminaryAcquisitionRange: PreliminaryAcquisitionRange;
  strategyRanking: StrategyRank[];
  strongestStrategy: { strategy: string; why: string };
  dealEconomics: DealEconomics;
  topRisks: string[];
  sellerQuestions: string[];
  verifyBeforeOffer: string[];
  nextSteps: string[];
  confidence: 'high' | 'medium' | 'low';
  /** Mirror of the shared unified readiness record (present when the caller
   *  supplies canonical gates) — the executive review shows the same readiness
   *  every tab shows. */
  readiness?: {
    summaryLine: string;
    offer: { state: string; why: string };
    value: { state: string; why: string };
    strategyActionability: { stateLabel: string; why: string };
  } | null;
}

const money = (n: number | null | undefined): string => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
const medianOf = (ns: number[]): number | null => { if (!ns.length) return null; const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Land sold comps eligible for trend (raw-land or unclassified — never the
 *  positively non-land rows that classification already flagged). */
function landSoldOf(report: DealCardReportView): Array<{ ppa: number; t: number }> {
  const sold = report.marketComps?.sold ?? [];
  return sold
    .filter((c) => c.compClass == null || c.compClass === 'vacant_land' || c.compClass === 'farm' || c.compClass === 'unknown')
    .filter((c) => typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0 && c.saleDateIso && !Number.isNaN(Date.parse(c.saleDateIso)))
    .map((c) => ({ ppa: c.pricePerAcre as number, t: Date.parse(c.saleDateIso) }))
    .sort((a, b) => a.t - b.t);
}

/** Market direction from the per-acre band over time: split the dated land sales
 *  into older vs recent halves and compare median price-per-acre. Needs >= 6
 *  dated comps; otherwise 'unknown' (never guessed). */
function computeMarketDirection(report: DealCardReportView): { direction: MarketDirection; pct: number | null } {
  const dated = landSoldOf(report);
  if (dated.length < 6) return { direction: 'unknown', pct: null };
  const mid = Math.floor(dated.length / 2);
  const olderMed = medianOf(dated.slice(0, mid).map((d) => d.ppa));
  const recentMed = medianOf(dated.slice(mid).map((d) => d.ppa));
  if (olderMed == null || recentMed == null || olderMed <= 0) return { direction: 'unknown', pct: null };
  const pct = Math.round(((recentMed - olderMed) / olderMed) * 1000) / 10;
  const direction: MarketDirection = pct >= 8 ? 'strengthening' : pct <= -8 ? 'softening' : 'stable';
  return { direction, pct };
}
function checklistVal(report: DealCardReportView, key: string): string | null {
  const row = (report.ddFactChecklist ?? []).find((r) => r.key === key && r.status === 'verified');
  return row?.value ?? null;
}
function acresOf(report: DealCardReportView): number | null {
  const raw = checklistVal(report, 'acres'); // e.g. "5.02 ac"
  const n = raw ? Number(String(raw).replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function publicTask(run: PublicIntelligenceRun | null | undefined, task: string): PublicIntelligenceTaskRecord | undefined {
  return run?.tasks.find((item) => item.task === task);
}

function publicScreeningRisks(run: PublicIntelligenceRun | null | undefined): string[] {
  if (!run || run.captureMode === 'fixture') return [];
  const flood = publicTask(run, 'fema_flood')?.finding;
  const wetlands = publicTask(run, 'wetlands')?.finding;
  const soils = publicTask(run, 'soils_septic')?.finding;
  const roads = publicTask(run, 'road_frontage')?.finding;
  const risks: string[] = [];
  if (flood?.kind === 'fema_flood' && flood.zones.some((zone) => zone.specialFloodHazardArea)) risks.push(`FEMA screening maps Special Flood Hazard Area: ${flood.zones.filter((zone) => zone.specialFloodHazardArea).map((zone) => `${zone.zone} ${zone.parcelPercentage}%`).join(', ')}. Confirm panel status, base flood elevation, and local floodplain requirements.`);
  if (wetlands?.kind === 'wetlands' && wetlands.intersects) risks.push(wetlands.approximateTotalAcres == null || (wetlands.approximateTotalAcres <= 0 && (wetlands.approximateParcelPercentage ?? 0) <= 0) ? 'Mapped wetland feature intersects the parcel. Reliable affected acreage is not yet available.' : `Mapped wetland intersection: approximately ${wetlands.approximateTotalAcres} ac (${wetlands.approximateParcelPercentage}%).`);
  if (soils?.kind === 'soils_septic' && soils.mapUnits.some((unit) => unit.components.some((component) => component.septicLimitation === 'very_limited'))) risks.push('USDA screening includes a very limited septic absorption-field component; confirm onsite feasibility with the local authority.');
  if (roads?.kind === 'road_frontage' && (roads.approximateMappedFrontageFt == null || !roads.adjoiningRoads.some((road) => road.apparentRightOfWayContact === true))) risks.push('Legal road access and mapped frontage footage remain unconfirmed.');
  return risks;
}
function publicNextSteps(run: PublicIntelligenceRun): string[] {
  const wetlands = publicTask(run, 'wetlands')?.finding;
  const flood = publicTask(run, 'fema_flood')?.finding;
  const soils = publicTask(run, 'soils_septic')?.finding;
  const roads = publicTask(run, 'road_frontage')?.finding;
  const imagery = publicTask(run, 'imagery')?.finding;
  const actions: string[] = [];
  if (wetlands?.kind === 'wetlands' && wetlands.intersects) actions.push('Confirm actual wetland overlap acreage and any jurisdictional determination.');
  if (flood?.kind === 'fema_flood' && flood.zones.some((zone) => zone.specialFloodHazardArea)) actions.push('Obtain FEMA panel, base flood elevation, and map status for the parcel.');
  if (flood?.kind === 'fema_flood' && flood.zones.some((zone) => zone.specialFloodHazardArea)) actions.push('Confirm local floodplain elevation and development requirements before underwriting.');
  if (soils?.kind === 'soils_septic') actions.push('Review detailed soil units and identify the best apparent onsite septic investigation areas.');
  if (soils?.kind === 'soils_septic') actions.push('Confirm onsite septic feasibility with the proper local authority.');
  if (imagery?.kind === 'imagery' && !imagery.parcelOutlineShown) actions.push('Overlay and verify the official parcel boundary on current aerial imagery.');
  if (roads?.kind === 'road_frontage') actions.push('Confirm whether Seaside Road, Crown Heights, or both adjoin the parcel; then verify legal access and road status.');
  actions.push('Confirm zoning, minimum lot size, and permitted use.');
  actions.push('Confirm the current owner and mailing address through a current official record.');
  actions.push('Confirm public utilities and any service-extension constraints.');
  actions.push('Expand and validate sold comps, then compare flood, wetland, septic, access, and usable-acreage conditions.');
  actions.push('Determine whether an offer is blocked, requires manual review, or is ready after feasibility and comp validation.');
  return [...new Set(actions)].slice(0, 12);
}

function buildMarketPulse(report: DealCardReportView, growth?: GrowthDriverSummary): MarketPulseSynthesis {
  const mc = report.marketComps;
  const m = mc?.metrics ?? { soldMedianPpa: null, ppaMin: null, ppaMax: null, domMedian: null } as never;
  const realieSold = mc?.soldCount ?? 0;
  const suppSold = mc?.supplementalSold?.length ?? 0;
  const active = mc?.activeCount ?? mc?.active?.length ?? 0;
  const soldCount = realieSold; // band count across all providers (post-classification)
  const ppa = { p25: m.ppaMin ?? null, median: m.soldMedianPpa ?? null, p75: m.ppaMax ?? null, low: m.ppaMin ?? null, high: m.ppaMax ?? null };
  const confidence: MarketPulseSynthesis['confidence'] = soldCount >= 5 ? 'high' : soldCount >= 3 ? 'medium' : soldCount >= 1 ? 'low' : 'none';

  // ── Absorption / months of inventory + sell-through ─────────────────────────
  //    Supply/demand is AREA-level, so use the count of land-class sold comps in
  //    the area (not the subject-acreage-filtered band count, which understates
  //    the sold rate and inflates months-of-inventory). Pricing still uses the band.
  const WINDOW_MONTHS = 12;
  const areaLandSold = (mc?.sold ?? []).filter((c) => c.compClass == null || c.compClass === 'vacant_land' || c.compClass === 'farm' || c.compClass === 'unknown').length || soldCount;
  // Absorption / sell-through require real coverage on BOTH sides. One or two
  // sales (or zero actives) is incomplete coverage, not a market rate.
  const coverageOk = areaLandSold >= 3 && active > 0;
  const monthlySoldRate = areaLandSold / WINDOW_MONTHS;
  const monthsOfInventory = coverageOk && monthlySoldRate > 0 ? Math.round((active / monthlySoldRate) * 10) / 10 : null;
  const sellThroughPct = coverageOk ? Math.round((areaLandSold / (areaLandSold + active)) * 100) : null;

  // ── Direction (per-acre band over time) ─────────────────────────────────────
  const { direction, pct: directionPct } = computeMarketDirection(report);

  const supply = active >= 20 ? `Healthy active supply (${active} land listings nearby).` : active > 0 ? `Thin active supply (${active} land listings nearby).` : 'No active land listings retrieved nearby.';
  const demand = soldCount >= 5 ? `Steady recent sold activity (${soldCount} verified land sold comps in the band).` : soldCount > 0 ? `Limited recent sold activity (${soldCount} verified land sold comps).` : 'No verified recent land sold comps.';
  const liquidity = m.domMedian != null ? `Median ~${m.domMedian} days on market.` : 'Days-on-market not established for land here.';
  const absorption = monthsOfInventory != null
    ? `~${monthsOfInventory} months of inventory (${monthsOfInventory < 6 ? "tight — seller's market" : monthsOfInventory <= 12 ? 'balanced' : 'soft — oversupplied'})${sellThroughPct != null ? `, ${sellThroughPct}% sell-through` : ''}.`
    : 'Absorption not computable yet (need both sold and active land data).';

  // A market read requires a real band: one observation is a data point, never
  // "land is trading around X" and never a percentile band.
  const bandReady = ppa.median != null && soldCount >= 3 && ppa.p25 != null && ppa.p75 != null && ppa.p75 > ppa.p25;
  const interpretation = bandReady
    ? `Verified land sales span ${money(ppa.p25)}–${money(ppa.p75)}/acre (median ${money(ppa.median)}) across ${soldCount} sold comps, with ${active} active land listing(s) for asking-market context.`
    : soldCount > 0
      ? `Only ${soldCount} closed land sale(s) validated so far${ppa.median != null ? ` (most recent at ${money(ppa.median)}/acre — a single observation, not a market range)` : ''}. Expand and validate comparable sales before drawing a price conclusion.`
      : `No verified price-per-acre band yet (${soldCount} land sold comps). Use area context + widen the comp search before pricing.`;
  const whatThisMeans = bandReady
    ? `There is enough verified evidence to price a preliminary acquisition range (see below). ${mc?.sparseExplanation ?? ''}`.trim()
    : 'Not enough verified sold comps to price confidently — treat any value as area context only until more comps are gathered.';

  const growthDrivers = {
    available: !!growth && growth.status === 'collected' && growth.drivers.length > 0,
    summary: growth?.summary ?? 'Local growth drivers not summarized this run.',
    whatThisMeans: growth?.whatThisMeans ?? 'Rely on the verified comp band; confirm local development with the seller / county.',
    drivers: (growth?.drivers ?? []).map((d) => ({ category: d.category, count: d.count, examples: (d.examples ?? []).slice(0, 2), whyItMatters: d.whyItMatters ?? '' })),
  };

  // ── Verdict: stronger or weaker, and WHY (combine direction + absorption +
  //    liquidity + growth evidence into one operator answer). ───────────────────
  const verdict = buildMarketVerdict({ direction, directionPct, monthsOfInventory, domMedian: m.domMedian ?? null, growthAvailable: growthDrivers.available, soldCount });

  return { realieSoldCount: realieSold, zillowActiveCount: active, zillowSupplementalSoldCount: suppSold, soldCount, activeCount: active, pricePerAcre: ppa, domMedian: m.domMedian ?? null, monthsOfInventory, sellThroughPct, direction, directionPct, supply, demand, liquidity, absorption, confidence, sparseExplanation: mc?.sparseExplanation ?? null, interpretation, whatThisMeans, verdict, growthDrivers };
}

/** Synthesize the headline market verdict by weighing the strengthening vs
 *  softening signals. Honest about thin data; never overstates. */
function buildMarketVerdict(s: { direction: MarketDirection; directionPct: number | null; monthsOfInventory: number | null; domMedian: number | null; growthAvailable: boolean; soldCount: number }): string {
  if (s.soldCount < 2) return 'Not enough verified land sales to call market direction yet. Widen the comp search (radius/recency) before drawing a conclusion.';
  const strong: string[] = [];
  const weak: string[] = [];
  if (s.direction === 'strengthening') strong.push(`per-acre prices are rising (${s.directionPct! > 0 ? '+' : ''}${s.directionPct}% recent vs older sales)`);
  else if (s.direction === 'softening') weak.push(`per-acre prices are easing (${s.directionPct}% recent vs older sales)`);
  if (s.monthsOfInventory != null) {
    if (s.monthsOfInventory < 6) strong.push(`tight supply (~${s.monthsOfInventory} months of inventory)`);
    else if (s.monthsOfInventory > 12) weak.push(`heavy supply (~${s.monthsOfInventory} months of inventory)`);
  }
  if (s.domMedian != null) {
    if (s.domMedian <= 90) strong.push(`land sells quickly (~${s.domMedian} days on market)`);
    else if (s.domMedian >= 180) weak.push(`slow turnover (~${s.domMedian} days on market)`);
  }
  if (s.growthAvailable) strong.push('local growth/development catalysts are present');
  let headline: string;
  if (strong.length > weak.length && strong.length > 0) headline = 'This land market looks like it is STRENGTHENING';
  else if (weak.length > strong.length && weak.length > 0) headline = 'This land market looks like it is SOFTENING';
  else if (strong.length === 0 && weak.length === 0) headline = 'This land market reads as STABLE / mixed (no decisive signal)';
  else headline = 'This land market reads as MIXED';
  const because = [...strong.map((x) => `+ ${x}`), ...weak.map((x) => `− ${x}`)];
  return `${headline}. Why: ${because.length ? because.join('; ') : 'thin signals on both sides'}.`;
}

/** Gates the caller derives from the CANONICAL shared records (pricing gate +
 *  research completeness + the operator record's property-specific questions).
 *  When provided, no dollar figure may render while the gate is closed. */
export interface ExecutiveGates {
  pricingAllowed: boolean;
  pricingBlockers: string[];
  researchComplete: boolean;
  researchMissing: string[];
  sellerQuestions?: string[] | null;
  /** The shared unified readiness record — the executive review renders THIS,
   *  never its own readiness derivation. */
  unifiedReadiness?: {
    summaryLine: string;
    offer: { state: string; why: string };
    value: { state: string; why: string };
    strategyActionability: { stateLabel: string; why: string };
  } | null;
}

function buildAcquisitionRange(report: DealCardReportView, pulse: MarketPulseSynthesis, gates?: ExecutiveGates | null): PreliminaryAcquisitionRange {
  const acres = acresOf(report);
  const lp = landPortalValuationStats(report.landportalInspection?.comparables, acres);
  const assumptions = [
    'Pre-call planning estimate only — NOT an approved offer or final underwriting.',
    `FMV uses the average exact price / acres from ${lp.count} usable LandPortal comp${lp.count === 1 ? '' : 's'}; other provider comps remain visible but do not influence FMV.`,
    'Assumes a clean, marketable, vacant parcel; no title/access/buildability confirmed yet.',
    "Acquisition band reflects Tyler's 40-60% of fair-market-value rule.",
  ];
  if (gates && !gates.pricingAllowed) {
    return {
      available: false, acres, estConservativeValue: null, estMarketRange: null, estMidValue: null,
      acquisition40: null, acquisition60: null, recommendedRange: null, confidence: 'none', assumptions,
      increaseValueIf: [], decreaseValueIf: [],
      note: `Pricing blocked by the shared gate: ${gates.pricingBlockers.join(' ')} No acquisition target exists until the gate opens.`,
    };
  }
  if (acres == null || acres <= 0 || lp.averagePricePerAcre == null || lp.count === 0) {
    return {
      available: false, acres, estConservativeValue: null, estMarketRange: null, estMidValue: null,
      acquisition40: null, acquisition60: null, recommendedRange: null, confidence: 'none', assumptions,
      increaseValueIf: [], decreaseValueIf: [],
      note: acres ? 'No usable LandPortal comp with both price and acreage is available yet.' : 'Subject acreage is required before applying the LandPortal comp value.',
    };
  }
  const fmv = Math.round(lp.averagePricePerAcre * acres);
  const acquisition40 = Math.round(fmv * 0.4);
  const acquisition60 = Math.round(fmv * 0.6);
  const confidence: PreliminaryAcquisitionRange['confidence'] = report.parcelVerified
    ? lp.count >= 3 ? (pulse.confidence === 'none' ? 'medium' : pulse.confidence) : 'low'
    : 'low';
  const prefix = report.parcelVerified ? 'Preliminary acquisition target' : 'Local-area acquisition target (parcel NOT verified — weaker)';
  return {
    available: true, acres, estConservativeValue: fmv, estMarketRange: [fmv, fmv], estMidValue: fmv,
    acquisition40, acquisition60, recommendedRange: [acquisition40, acquisition60], confidence, assumptions,
    increaseValueIf: ['Confirmed road frontage + legal access', 'Confirmed buildable / low slope', 'Utilities at the road', 'Clean title + no liens', 'Higher-and-better use (subdivision / infill)'],
    decreaseValueIf: ['Wetlands / FEMA flood coverage', 'Landlocked or shared access', 'Steep slope / unbuildable', 'Back taxes / liens / probate', 'Deed/boundary issues'],
    note: `${prefix}: ${money(acquisition40)}-${money(acquisition60)} (40-60% of ${money(fmv)} FMV at ${money(lp.averagePricePerAcre)}/acre x ${acres} ac from ${lp.count} LandPortal comp${lp.count === 1 ? '' : 's'}). Other provider comps remain visible but do not influence FMV. Confirm title, access, and costs before any offer.`,
  };
}

function buildAcquisitionRangeLegacy(report: DealCardReportView, pulse: MarketPulseSynthesis, gates?: ExecutiveGates | null): PreliminaryAcquisitionRange {
  const acres = acresOf(report);
  const selectedSold = (report.bestComps?.comps ?? [])
    .filter((comp) => comp.lane === 'sold' && comp.price != null && comp.price > 0 && comp.acres != null && comp.acres > 0)
    .slice(0, 5);
  const selectedPpas = selectedSold.map((comp) => Math.round(comp.price! / comp.acres!));
  const averageSoldPpa = selectedPpas.length
    ? Math.round(selectedPpas.reduce((sum, value) => sum + value, 0) / selectedPpas.length)
    : report.valuation?.primary?.kind === 'comp_sold' ? report.valuation.primary.ppa : pulse.pricePerAcre.median;
  // The SHARED pricing gate outranks the local band math. A computable median is
  // never sufficient: a closed gate (valuation conflict, disputed acreage, thin
  // validated set) suppresses the range and says exactly why.
  if (gates && !gates.pricingAllowed) {
    return {
      available: false, acres,
      estConservativeValue: null, estMarketRange: null, estMidValue: null,
      acquisition40: null, acquisition60: null, recommendedRange: null,
      confidence: 'none',
      assumptions: ['Pre-call planning estimate only — NOT an approved offer or final underwriting.'],
      increaseValueIf: [], decreaseValueIf: [],
      note: `Pricing blocked by the shared gate: ${gates.pricingBlockers.join(' ')} No acquisition target exists until the gate opens.`,
    };
  }
  // Price FMV whenever at least one accepted sold comp + acreage exist. When the parcel is
  // NOT verified this is LOCAL AREA CONTEXT (weaker) — computed, but capped to low
  // confidence and clearly labeled, per the pre-discovery-call intelligence mandate.
  const available = !!(acres && averageSoldPpa);
  const assumptions = [
    'Pre-call planning estimate only — NOT an approved offer or final underwriting.',
    report.parcelVerified
      ? `Based on the average sold price per acre from the ${selectedSold.length || pulse.soldCount} closest available accepted sold comp${(selectedSold.length || pulse.soldCount) === 1 ? '' : 's'}, applied to verified acreage.`
      : 'LOCAL AREA CONTEXT (parcel not verified): accepted sold comps (price-per-acre) applied to the lead acreage — weaker than a parcel-specific estimate.',
    'Assumes a clean, marketable, vacant parcel; no title/access/buildability confirmed yet.',
    "Acquisition band reflects Tyler's ~40–60% of market-value philosophy.",
  ];
  if (!available) {
    return { available: false, acres, estConservativeValue: null, estMarketRange: null, estMidValue: null, acquisition40: null, acquisition60: null, recommendedRange: null, confidence: 'none', assumptions, increaseValueIf: [], decreaseValueIf: [], note: acres ? 'No accepted sold comp with usable price and acreage is available yet.' : averageSoldPpa ? 'Sold-comp $/acre is known but subject acreage is unknown.' : 'No accepted sold comps plus subject acreage are available yet.' };
  }
  const a = acres as number;
  const estMid = (averageSoldPpa as number) * a;
  const estLow = estMid;
  const estHigh = estMid;
  const acq40 = 0.40 * estMid;
  const acq60 = 0.60 * estMid;
  // Unverified area context is inherently weaker: cap confidence at 'low'.
  const rawConf = selectedSold.length >= 3 ? (pulse.confidence === 'none' ? 'medium' : pulse.confidence) : 'low';
  const confidence: PreliminaryAcquisitionRange['confidence'] = report.parcelVerified ? rawConf : 'low';
  const contextPrefix = report.parcelVerified ? 'Preliminary acquisition target' : 'Local-area acquisition target (parcel NOT verified — weaker)';
  return {
    available: true, acres: a,
    estConservativeValue: Math.round(estLow), estMarketRange: [Math.round(estLow), Math.round(estHigh)], estMidValue: Math.round(estMid),
    acquisition40: Math.round(acq40), acquisition60: Math.round(acq60), recommendedRange: [Math.round(acq40), Math.round(acq60)],
    confidence,
    assumptions,
    increaseValueIf: ['Confirmed road frontage + legal access', 'Confirmed buildable / low slope', 'Utilities at the road', 'Clean title + no liens', 'Higher-and-better use (subdivision / infill)'],
    decreaseValueIf: ['Wetlands / FEMA flood coverage', 'Landlocked or shared access', 'Steep slope / unbuildable', 'Back taxes / liens / probate', 'Deed/boundary issues'],
    note: `${contextPrefix}: ${money(acq40)}–${money(acq60)} (40–60% of ${money(estMid)} FMV at an average ${money(averageSoldPpa)}/acre × ${a} ac from ${selectedSold.length || pulse.soldCount} accepted sold comp${(selectedSold.length || pulse.soldCount) === 1 ? '' : 's'}). Confirm title, access, and costs before any offer.`,
  };
}

function topRisks(report: DealCardReportView, gates?: ExecutiveGates | null): string[] {
  const out = [...(report.riskFlags ?? [])];
  const g = report.govDd;
  if (g?.flood && g.flood.status === 'verified' && g.flood.zone && !/^x$/i.test(g.flood.zone)) out.push(`FEMA flood zone ${g.flood.zone} (verified) — confirm extent.`);
  if (g?.wetlands && g.wetlands.status === 'verified' && g.wetlands.type && !/^none/i.test(g.wetlands.type.trim())) out.push(`Wetlands present (NWI: ${g.wetlands.type}) — confirm coverage.`);
  if (g?.slope && g.slope.status === 'verified' && g.slope.slopeDeg != null && g.slope.slopeDeg > 10) out.push(`Elevated slope ~${g.slope.slopeDeg}° — confirm buildable area.`);
  if (out.length === 0) {
    // Incomplete screening is NEVER rendered as "no red flags surfaced".
    out.push(gates && !gates.researchComplete
      ? `Critical-risk review incomplete — ${gates.researchMissing.length ? `${gates.researchMissing.join(', ')} have` : 'core screening lanes have'} not produced accepted evidence yet. No all-clear exists.`
      : 'No critical red flag identified within completed screening — title, legal access, and buildability remain separate confirmations.');
  }
  return out.slice(0, 6);
}

// ── Property-specific strategy ranking (7 PRIMARY lanes; deterministic). ──────
// Primary land strategies: Cash Flip, Double Close / Novation, Subdivide, Land
// Home Package, Improvement / Value Add, Hold, Pass. (Neighbor / adjacent-owner
// sale was removed as a primary lane — it's a niche fallback, not a primary play.)
function buildStrategyRanking(report: DealCardReportView, pulse: MarketPulseSynthesis, range: PreliminaryAcquisitionRange): StrategyRank[] {
  const acres = range.acres ?? 0;
  const landUse = (checklistVal(report, 'landUse') ?? '').toLowerCase();
  const buildingArea = Number((checklistVal(report, 'buildingArea') ?? '').replace(/[^0-9.]/g, '')) || 0;
  const improved = buildingArea > 0 || /home|house|improv|dwelling|residence|mobile/.test(landUse);
  const g = report.govDd;
  const flood = !!(g?.flood && g.flood.status === 'verified' && g.flood.zone && !/^x$/i.test(g.flood.zone));
  const wetlands = !!(g?.wetlands && g.wetlands.status === 'verified' && g.wetlands.type && !/^none/i.test(g.wetlands.type.trim()));
  const steep = !!(g?.slope && g.slope.status === 'verified' && g.slope.slopeDeg != null && g.slope.slopeDeg > 12);
  const landlocked = (report.riskFlags ?? []).some((r) => /landlock|no legal access/i.test(r));
  const liquid = pulse.realieSoldCount >= 3 && pulse.zillowActiveCount >= 5;
  const hasBand = range.available;
  const conf = (n: number): StrategyRank['confidence'] => (n >= 2 ? 'high' : n >= 1 ? 'medium' : 'low');
  const envClean = !flood && !wetlands && !steep && !landlocked;

  const legalAccessUnresolved = landlocked || report.dataGaps.some((item) => /legal access|road frontage|frontage footage/i.test(item));
  const hardBlock = !hasBand || flood || wetlands || legalAccessUnresolved;
  if (hardBlock) {
    const reason = !hasBand ? 'Reliable valuation evidence is not available.' : flood ? 'Mapped flood exposure requires feasibility review.' : wetlands ? 'Mapped wetland exposure requires acreage confirmation.' : 'Legal access and mapped frontage remain unconfirmed.';
    const block = (strategy: string, mustVerify: string): StrategyRank => ({ strategy, viability: 'not_viable', reason: `Blocked: ${reason}`, risk: 'Do not treat a blocked lane as an acquisition recommendation.', confidence: 'low', mustVerify, score: 0 });
    return [
      block('Cash Flip', 'Validated sold comps, title, legal access, and marketable usable acreage.'),
      block('Novation or Double Close', 'Title path, end-buyer demand, legal access, and validated value.'),
      block('Subdivide or Minor Split', 'Zoning, lot yield, access, flood, wetlands, septic, and utilities.'),
      block('Land-Home Package', 'Floodplain, onsite septic, utilities, zoning, and elevation requirements.'),
      block('Improvement Then Flip', 'Cost-to-cure, permits, legal access, and supported resale value.'),
    ];
  }
  const lanes: StrategyRank[] = [
    { strategy: 'Cash Flip', viability: hasBand && liquid ? 'high' : hasBand ? 'medium' : 'low', reason: hasBand ? `Comp band exists (${pulse.realieSoldCount} sold) — buy at the 40–60% band and wholesale/assign quickly.` : 'No comp band yet to anchor a quick flip.', risk: landlocked || flood ? 'Access/flood could kill resale speed.' : 'Resale velocity depends on local demand.', confidence: conf((hasBand ? 1 : 0) + (liquid ? 1 : 0)), mustVerify: 'Access, title, true marketable acreage, assignment allowed.', score: (hasBand ? 4 : 1) + (liquid ? 3 : 0) },
    { strategy: 'Double Close / Novation', viability: hasBand && pulse.zillowActiveCount > 0 ? 'high' : hasBand ? 'medium' : 'low', reason: pulse.zillowActiveCount > 0 ? `${pulse.zillowActiveCount} active listings show a retail buyer pool — capture the spread via a back-to-back (double) close or novate the contract to relist retail, without assigning.` : 'Limited active-listing evidence; double close/novation needs a retail buyer pool.', risk: 'Two closings / novation terms; brief title hold + double-closing costs.', confidence: conf((hasBand ? 1 : 0) + (pulse.zillowActiveCount > 0 ? 1 : 0)), mustVerify: 'Title insurability for back-to-back close; novation/assignment terms; end-buyer demand.', score: (hasBand ? 3 : 1) + (pulse.zillowActiveCount > 0 ? 2 : 0) },
    { strategy: 'Subdivide', viability: acres >= 5 && envClean ? 'medium' : 'low', reason: acres >= 5 ? `~${acres} ac may support a split into multiple sellable lots if zoning + access allow.` : 'Acreage likely too small to subdivide.', risk: 'Zoning, min-lot, infrastructure cost.', confidence: acres >= 5 ? 'medium' : 'low', mustVerify: 'Zoning min lot size, road/utility feasibility, survey.', score: acres >= 5 ? (envClean ? 4 : 2) : 1 },
    { strategy: 'Land-Home Package', viability: acres >= 1 && envClean ? 'medium' : acres >= 1 ? 'low' : 'not_viable', reason: acres >= 1 ? `~${acres} ac can host a manufactured/site-built home if buildable — sell land + home together.` : 'Too small / not suited for a home package.', risk: 'Buildability, perc/septic, utilities unconfirmed.', confidence: conf((acres >= 1 ? 1 : 0) + (envClean ? 1 : 0)), mustVerify: 'Perc/septic, utilities, zoning, slope.', score: acres >= 1 ? (envClean ? 4 : 2) : 0 },
    { strategy: 'Improvement / Value Add', viability: improved ? 'medium' : (envClean && acres >= 1) ? 'low' : 'not_viable', reason: improved ? 'Existing improvement — renovate/reposition and resell as improved.' : (envClean && acres >= 1) ? 'Add value via access/clearing/utilities/perc to lift raw-land value before resale.' : 'Environmental/access constraints limit value-add.', risk: improved ? 'Condition/repair unknown.' : 'Site-work cost vs. value lift unproven.', confidence: improved ? 'medium' : 'low', mustVerify: 'Structure condition/permits, or site-work cost vs. value lift.', score: improved ? 3 : (envClean && acres >= 1 ? 2 : 0) },
    { strategy: 'Hold', viability: 'medium', reason: 'Always available; appreciation + optionality while DD completes or the market firms.', risk: 'Carrying cost, opportunity cost.', confidence: 'medium', mustVerify: 'Taxes, holding cost.', score: 2 },
    { strategy: 'Pass', viability: (!hasBand && (landlocked || flood || wetlands)) ? 'high' : 'low', reason: (!hasBand && (landlocked || flood || wetlands)) ? 'No comp band + serious environmental/access risk — likely pass.' : 'Only pass if DD reveals a deal-killer.', risk: 'Walking from a possible deal.', confidence: 'medium', mustVerify: 'Confirm the deal-killer before passing.', score: (!hasBand ? 1 : 0) + (landlocked ? 2 : 0) + (flood ? 1 : 0) + (wetlands ? 1 : 0) },
  ];
  const label: Record<string, string> = {
    'Double Close / Novation': 'Novation or Double Close',
    'Subdivide': 'Subdivide or Minor Split',
    'Improvement / Value Add': 'Improvement Then Flip',
  };
  return lanes
    .filter((lane) => lane.strategy !== 'Hold' && lane.strategy !== 'Pass')
    .map((lane) => ({
      ...lane,
      strategy: label[lane.strategy] ?? lane.strategy,
      reason: lane.strategy === 'Cash Flip'
        ? 'Potential resale lane only after value, title, access, and feasibility are validated.'
        : lane.reason,
    }))
    .sort((a, b) => b.score - a.score);
}

function normStrategy(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalPrimaryStrategy(report: DealCardReportView): string | null {
  const raw = (report.mostViableStrategy ?? '').trim();
  if (!raw) return null;
  const n = normStrategy(raw);
  if (/\bquick\b.*\bflip\b/.test(n)) return 'Cash Flip';
  if (/\bsubdivide\b/.test(n)) return 'Subdivide';
  if (/\bland\b.*\bhome\b/.test(n)) return 'Land-Home Package';
  if (/\bdouble\b.*\bclose\b|\bnovation\b/.test(n)) return 'Double Close / Novation';
  if (/\bimprovement\b|\bvalue\b.*\badd\b/.test(n)) return 'Improvement / Value Add';
  if (/\bhold\b/.test(n)) return 'Hold';
  if (/\bpass\b|\bno offer\b/.test(n)) return 'Pass';
  return null;
}

function reconcileStrategyRanking(report: DealCardReportView, ranking: StrategyRank[]): StrategyRank[] {
  const primary = canonicalPrimaryStrategy(report);
  if (!primary) return ranking;
  const idx = ranking.findIndex((r) => normStrategy(r.strategy) === normStrategy(primary));
  if (idx < 0) return ranking;
  const promoted = { ...ranking[idx], strategy: primary };
  return [promoted, ...ranking.filter((_, i) => i !== idx)];
}

function buildDealEconomics(range: PreliminaryAcquisitionRange, pulse: MarketPulseSynthesis): DealEconomics {
  const assumptions = ['Pre-call planning only — not final underwriting.', 'Value from verified Realie sold price-per-acre × verified acreage.', 'Spread is GROSS (before survey, clearing, holding, closing, resale costs).'];
  const missingCostItems = ['Survey', 'Access/clearing', 'Perc/septic', 'Holding (taxes/insurance)', 'Title/legal', 'Resale/marketing', 'Closing'];
  const whyUnderwritingLater = 'Final underwriting requires tighter radius-based sold comps + confirmed costs, access, and title — done post-discovery, not pre-call.';
  if (!range.available || range.estMidValue == null || !range.recommendedRange) {
    return { available: false, estValueLow: null, estValueMid: null, estValueHigh: null, acquisitionRange: null, roughSpread: null, confidence: 'none', assumptions, missingCostItems, whyUnderwritingLater };
  }
  const [lo, hi] = range.estMarketRange ?? [range.estMidValue, range.estMidValue];
  const [acqLo, acqHi] = range.recommendedRange;
  // Gross spread = mid value minus the acquisition band (pre-cost upside).
  const roughSpread: [number, number] = [Math.round(range.estMidValue - acqHi), Math.round(range.estMidValue - acqLo)];
  return { available: true, estValueLow: lo, estValueMid: range.estMidValue, estValueHigh: hi, acquisitionRange: range.recommendedRange, roughSpread, confidence: pulse.confidence === 'none' ? 'low' : pulse.confidence, assumptions, missingCostItems, whyUnderwritingLater };
}

function verifiedIdentitySource(report: DealCardReportView): string {
  const factSource = report.ddFactChecklist.find((row) => row.status === 'verified' && row.source)?.source?.trim();
  const statusSource = report.parcelVerificationStatus.match(/^Parcel verified \((.*)\)$/i)?.[1]
    ?.replace(/,\s*non-credit\s*$/i, '')
    .trim();
  const raw = factSource || statusSource || 'a named parcel source';
  const original = raw.match(/^Persisted verified Property Card\s*\(orig:\s*(.+)\)$/i)?.[1] ?? raw;
  return original
    .replace(/\s*\(reused[^)]*\)\s*$/i, '')
    .replace(/\s*\(non-credit\)\s*$/i, '')
    .trim();
}

/** Synthesize the operator-ready Executive Summary from the persisted report.
 *  When the caller supplies gates from the canonical shared records, pricing is
 *  suppressed while the gate is closed and seller questions come from the
 *  property-specific generator instead of the generic fallback. */
export function buildExecutiveSummary(report: DealCardReportView, growth?: GrowthDriverSummary, publicRun?: PublicIntelligenceRun | null, gates?: ExecutiveGates | null): ExecutiveSummary {
  const pulse = buildMarketPulse(report, growth);
  const range = buildAcquisitionRange(report, pulse, gates);
  const strategyRanking = reconcileStrategyRanking(report, buildStrategyRanking(report, pulse, range));
  const dealEconomics = buildDealEconomics(range, pulse);
  // A blocked card must not promote an approved strategy as "strongest" merely
  // because it happens to sort first. Keep the approved strategies in the
  // ranking, but make the executive conclusion explicitly safe.
  const topStrategy = strategyRanking[0]?.viability === 'not_viable'
    ? { strategy: 'No acquisition strategy is ready', viability: 'not_viable' as const, reason: 'All approved strategies are blocked pending feasibility and valuation evidence.', risk: 'Critical feasibility and valuation evidence is unresolved.', confidence: 'low' as const, mustVerify: 'Complete the prioritized due diligence actions.', score: 0 }
    : strategyRanking[0] ?? { strategy: 'No acquisition strategy is ready', viability: 'not_viable' as const, reason: 'No approved strategy could be scored.', risk: 'Critical feasibility and valuation evidence is unresolved.', confidence: 'low' as const, mustVerify: 'Complete the prioritized due diligence actions.', score: 0 };
  const acres = acresOf(report);
  const landUse = checklistVal(report, 'landUse');
  const zoning = checklistVal(report, 'zoning');
  const county = checklistVal(report, 'county') ?? (report.marketSummary.match(/Target area:\s*([^.,]+)/)?.[1] ?? null);
  const verified = report.parcelVerified;

  const screeningRisks = publicScreeningRisks(publicRun);
  let whatItIs = verified
    ? `${acres ? `${acres}-acre ` : ''}${landUse || 'parcel'}${county ? ` in ${county}` : ''}${zoning ? `, zoned ${zoning}` : ''}. Identity verified via ${verifiedIdentitySource(report)}. DD completeness: ${report.ddCompleteness?.label ?? 'in progress'}.`
    : 'Parcel identity not yet verified — area context only until a trusted provider resolves the input to a real parcel record.';

  const officialCountyEvidence = publicTask(publicRun, 'county_records')?.evidence.find((item) => item.sourceTier === 'official_county_state');
  if (verified && officialCountyEvidence) {
    whatItIs = `${acres ? `${acres}-acre ` : ''}${landUse || 'parcel'}${county ? ` in ${county}` : ''}. Official parcel match confirmed via ${officialCountyEvidence.sourceName}; supporting provider confirmation may remain on file. Offer-grade title verification and surveyed-boundary verification remain pending.`;
  }
  const gateClosed = !!gates && !gates.pricingAllowed;
  const whyInteresting = range.available
    ? `Verified parcel with a real comp band — there's enough to set a preliminary acquisition target (${money(range.acquisition40)}–${money(range.acquisition60)}) and prep a seller call now.`
    : verified
      ? (gateClosed ? `Verified parcel; pricing is blocked (${gates!.pricingBlockers[0] ?? 'evidence gate closed'}) while research continues.` : 'Verified parcel; gather a few sold comps to unlock pricing.')
      : 'Verify identity first to unlock the pipeline.';

  return {
    headline: verified
      ? `${acres ? `${acres} ac ` : ''}${landUse || 'land'}${county ? `, ${county}` : ''} — ${range.available ? `target ${money(range.acquisition40)}–${money(range.acquisition60)}` : gateClosed ? 'pricing blocked, research continuing' : 'verified, pricing pending comps'}`
      : 'Needs Verification — resolve the parcel to begin',
    whatItIs,
    whyInteresting,
    marketPulse: pulse,
    preliminaryAcquisitionRange: range,
    strategyRanking,
    strongestStrategy: { strategy: (verified || range.available) ? topStrategy.strategy : (report.mostViableStrategy || '(pending verified data)'), why: (verified || range.available) ? `${topStrategy.reason} (Risk: ${topStrategy.risk})${verified ? '' : ' [local area context — verify parcel before any offer]'}` : 'Blocked until identity is verified.' },
    dealEconomics,
    topRisks: [...new Set([...screeningRisks, ...topRisks(report, gates)])].slice(0, 8),
    // Property-specific questions from the shared generator when available;
    // the generic fallback remains only for callers without an operator record.
    sellerQuestions: gates?.sellerQuestions?.length ? gates.sellerQuestions.slice(0, 12) : [
      'Why are you looking to sell, and what timeline are you working with?',
      'Is the property paid off, or are there liens / back taxes?',
      'Is there legal road access and any utilities at the road?',
      'Has it been surveyed, perc-tested, or had any offers?',
      'Who else is part of the decision?',
    ],
    verifyBeforeOffer: [...new Set([...(report.countyVerificationChecklist ?? []), ...(report.dataGaps ?? []).filter((g) => !/not reviewed yet/i.test(g))].map(operatorizePersistedGap).filter((label) => label.trim()))].slice(0, 8),
    nextSteps: publicRun ? publicNextSteps(publicRun) : range.available
      ? ['Run the discovery call with the questions above.', 'Tighten sold comps (radius/recency) to firm the range.', 'Confirm access, title, and buildability before any offer.']
      : verified ? ['Gather sold comps to price the parcel.', 'Run the discovery call.'] : ['Re-enter the address/APN to verify identity.'],
    confidence: range.available ? (pulse.confidence === 'high' ? 'high' : 'medium') : verified ? 'medium' : 'low',
    readiness: gates?.unifiedReadiness ?? null,
  };
}
