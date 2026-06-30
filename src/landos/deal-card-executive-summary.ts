// LandOS — Deal Card Executive Summary (Phases 5/6/8).
//
// Synthesizes the already-retrieved verified facts + comp metrics + gov DD +
// strategy into ONE operator-ready pre-call brief — what an experienced
// acquisitions manager would write at the top of the file. Pure function over the
// persisted report; interprets and estimates from VERIFIED evidence, labels
// confidence + assumptions, and never blocks on incomplete DD (per 07_Product_
// Principles). No fabrication: ranges are only produced when verified sold comps
// exist; everything carries its basis.

import type { DealCardReportView } from './deal-card-report.js';
import type { GrowthDriverSummary } from './browser-market-intelligence.js';

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
  growthDrivers: { available: boolean; summary: string; whatThisMeans: string; drivers: Array<{ category: string; count: number; examples: string[] }> };
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

function buildMarketPulse(report: DealCardReportView, growth?: GrowthDriverSummary): MarketPulseSynthesis {
  const mc = report.marketComps;
  const m = mc?.metrics ?? { soldMedianPpa: null, ppaMin: null, ppaMax: null, domMedian: null } as never;
  const realieSold = mc?.soldCount ?? 0;
  const active = mc?.active?.length ?? 0;
  const suppSold = mc?.supplementalSold?.length ?? 0;
  const soldCount = realieSold; // band count across all providers (post-classification)
  const ppa = { p25: m.ppaMin ?? null, median: m.soldMedianPpa ?? null, p75: m.ppaMax ?? null, low: m.ppaMin ?? null, high: m.ppaMax ?? null };
  const confidence: MarketPulseSynthesis['confidence'] = soldCount >= 5 ? 'high' : soldCount >= 3 ? 'medium' : soldCount >= 1 ? 'low' : 'none';

  // ── Absorption / months of inventory + sell-through ─────────────────────────
  //    Supply/demand is AREA-level, so use the count of land-class sold comps in
  //    the area (not the subject-acreage-filtered band count, which understates
  //    the sold rate and inflates months-of-inventory). Pricing still uses the band.
  const WINDOW_MONTHS = 12;
  const areaLandSold = (mc?.sold ?? []).filter((c) => c.compClass == null || c.compClass === 'vacant_land' || c.compClass === 'farm' || c.compClass === 'unknown').length || soldCount;
  const monthlySoldRate = areaLandSold / WINDOW_MONTHS;
  const monthsOfInventory = monthlySoldRate > 0 && active > 0 ? Math.round((active / monthlySoldRate) * 10) / 10 : null;
  const sellThroughPct = areaLandSold + active > 0 ? Math.round((areaLandSold / (areaLandSold + active)) * 100) : null;

  // ── Direction (per-acre band over time) ─────────────────────────────────────
  const { direction, pct: directionPct } = computeMarketDirection(report);

  const supply = active >= 20 ? `Healthy active supply (${active} land listings nearby).` : active > 0 ? `Thin active supply (${active} land listings nearby).` : 'No active land listings retrieved nearby.';
  const demand = soldCount >= 5 ? `Steady recent sold activity (${soldCount} verified land sold comps in the band).` : soldCount > 0 ? `Limited recent sold activity (${soldCount} verified land sold comps).` : 'No verified recent land sold comps.';
  const liquidity = m.domMedian != null ? `Median ~${m.domMedian} days on market.` : 'Days-on-market not established for land here.';
  const absorption = monthsOfInventory != null
    ? `~${monthsOfInventory} months of inventory (${monthsOfInventory < 6 ? "tight — seller's market" : monthsOfInventory <= 12 ? 'balanced' : 'soft — oversupplied'})${sellThroughPct != null ? `, ${sellThroughPct}% sell-through` : ''}.`
    : 'Absorption not computable yet (need both sold and active land data).';

  const interpretation = ppa.median != null
    ? `Verified land is trading around ${money(ppa.median)}/acre (p25–p75 ${money(ppa.p25)}–${money(ppa.p75)}/acre) from ${soldCount} sold comp(s), with ${active} active land listing(s) for asking-market context.`
    : `No verified price-per-acre band yet (${soldCount} land sold comps). Use area context + widen the comp search before pricing.`;
  const whatThisMeans = ppa.median != null
    ? `There is enough verified evidence to price a preliminary acquisition range (see below). ${mc?.sparseExplanation ?? ''}`.trim()
    : 'Not enough verified sold comps to price confidently — treat any value as area context only until more comps are gathered.';

  const growthDrivers = {
    available: !!growth && growth.status === 'collected' && growth.drivers.length > 0,
    summary: growth?.summary ?? 'Local growth drivers not summarized this run.',
    whatThisMeans: growth?.whatThisMeans ?? 'Rely on the verified comp band; confirm local development with the seller / county.',
    drivers: (growth?.drivers ?? []).map((d) => ({ category: d.category, count: d.count, examples: (d.examples ?? []).slice(0, 2) })),
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

function buildAcquisitionRange(report: DealCardReportView, pulse: MarketPulseSynthesis): PreliminaryAcquisitionRange {
  const acres = acresOf(report);
  const { p25, median, p75 } = pulse.pricePerAcre;
  const available = !!(report.parcelVerified && acres && median);
  const assumptions = [
    'Pre-call planning estimate only — NOT an approved offer or final underwriting.',
    'Based on verified Realie sold comps (price-per-acre) applied to verified acreage.',
    'Assumes a clean, marketable, vacant parcel; no title/access/buildability confirmed yet.',
    "Acquisition band reflects Tyler's ~40–60% of market-value philosophy.",
  ];
  if (!available) {
    return { available: false, acres, estConservativeValue: null, estMarketRange: null, estMidValue: null, acquisition40: null, acquisition60: null, recommendedRange: null, confidence: 'none', assumptions, increaseValueIf: [], decreaseValueIf: [], note: report.parcelVerified ? 'No verified sold comps + acreage yet — gather comps to price a range.' : 'Parcel not verified — range withheld until identity is confirmed.' };
  }
  const a = acres as number;
  const estMid = (median as number) * a;
  const estLow = (p25 ?? median!) * a;
  const estHigh = (p75 ?? median!) * a;
  const acq40 = 0.40 * estMid;
  const acq60 = 0.60 * estMid;
  return {
    available: true, acres: a,
    estConservativeValue: Math.round(estLow), estMarketRange: [Math.round(estLow), Math.round(estHigh)], estMidValue: Math.round(estMid),
    acquisition40: Math.round(acq40), acquisition60: Math.round(acq60), recommendedRange: [Math.round(acq40), Math.round(acq60)],
    confidence: pulse.confidence === 'none' ? 'low' : pulse.confidence,
    assumptions,
    increaseValueIf: ['Confirmed road frontage + legal access', 'Confirmed buildable / low slope', 'Utilities at the road', 'Clean title + no liens', 'Higher-and-better use (subdivision / infill)'],
    decreaseValueIf: ['Wetlands / FEMA flood coverage', 'Landlocked or shared access', 'Steep slope / unbuildable', 'Back taxes / liens / probate', 'Deed/boundary issues'],
    note: `Preliminary acquisition target: ${money(acq40)}–${money(acq60)} (≈40–60% of an estimated ${money(estMid)} market value at ${money(median)}/acre × ${a} ac). Confirm with tighter sold comps + costs before any offer.`,
  };
}

function topRisks(report: DealCardReportView): string[] {
  const out = [...(report.riskFlags ?? [])];
  const g = report.govDd;
  if (g?.flood && g.flood.status === 'verified' && g.flood.zone && !/^x$/i.test(g.flood.zone)) out.push(`FEMA flood zone ${g.flood.zone} (verified) — confirm extent.`);
  if (g?.wetlands && g.wetlands.status === 'verified' && g.wetlands.type) out.push(`Wetlands present (NWI: ${g.wetlands.type}) — confirm coverage.`);
  if (g?.slope && g.slope.status === 'verified' && g.slope.slopeDeg != null && g.slope.slopeDeg > 10) out.push(`Elevated slope ~${g.slope.slopeDeg}° — confirm buildable area.`);
  if (out.length === 0) out.push('No major red flags surfaced yet — access, title, and buildability still need confirmation.');
  return out.slice(0, 6);
}

// ── Property-specific strategy ranking (8 lanes; deterministic + explainable) ──
function buildStrategyRanking(report: DealCardReportView, pulse: MarketPulseSynthesis, range: PreliminaryAcquisitionRange): StrategyRank[] {
  const acres = range.acres ?? 0;
  const landUse = (checklistVal(report, 'landUse') ?? '').toLowerCase();
  const buildingArea = Number((checklistVal(report, 'buildingArea') ?? '').replace(/[^0-9.]/g, '')) || 0;
  const improved = buildingArea > 0 || /home|house|improv|dwelling|residence|mobile/.test(landUse);
  const g = report.govDd;
  const flood = !!(g?.flood && g.flood.status === 'verified' && g.flood.zone && !/^x$/i.test(g.flood.zone));
  const wetlands = !!(g?.wetlands && g.wetlands.status === 'verified' && g.wetlands.type);
  const steep = !!(g?.slope && g.slope.status === 'verified' && g.slope.slopeDeg != null && g.slope.slopeDeg > 12);
  const landlocked = (report.riskFlags ?? []).some((r) => /landlock|no legal access/i.test(r));
  const liquid = pulse.realieSoldCount >= 3 && pulse.zillowActiveCount >= 5;
  const hasBand = range.available;
  const conf = (n: number): StrategyRank['confidence'] => (n >= 2 ? 'high' : n >= 1 ? 'medium' : 'low');
  const envClean = !flood && !wetlands && !steep && !landlocked;

  const lanes: StrategyRank[] = [
    { strategy: 'Quick flip (wholesale/assignment)', viability: hasBand && liquid ? 'high' : hasBand ? 'medium' : 'low', reason: hasBand ? `Comp band exists (${pulse.realieSoldCount} sold) — buy at the 40–60% band and resell quickly.` : 'No comp band yet to anchor a quick flip.', risk: landlocked || flood ? 'Access/flood could kill resale speed.' : 'Resale velocity depends on local demand.', confidence: conf((hasBand ? 1 : 0) + (liquid ? 1 : 0)), mustVerify: 'Access, title, true marketable acreage.', score: (hasBand ? 4 : 1) + (liquid ? 3 : 0) },
    { strategy: 'Retail resale (to end land buyer)', viability: hasBand && pulse.zillowActiveCount > 0 ? 'high' : hasBand ? 'medium' : 'low', reason: pulse.zillowActiveCount > 0 ? `${pulse.zillowActiveCount} active listings show retail demand.` : 'Limited active-listing evidence of retail demand.', risk: 'Longer hold; carrying costs.', confidence: conf((hasBand ? 1 : 0) + (pulse.zillowActiveCount > 0 ? 1 : 0)), mustVerify: 'Buildability, utilities, access for retail appeal.', score: (hasBand ? 3 : 1) + (pulse.zillowActiveCount > 0 ? 2 : 0) },
    { strategy: 'Improved-property resale', viability: improved ? 'medium' : 'not_viable', reason: improved ? 'Improvement present — resell as improved.' : 'No improvement on record — vacant land.', risk: 'Condition/repair unknown.', confidence: improved ? 'medium' : 'high', mustVerify: 'Structure condition, permits.', score: improved ? 3 : 0 },
    { strategy: 'Land-home package', viability: acres >= 1 && envClean ? 'medium' : acres >= 1 ? 'low' : 'not_viable', reason: acres >= 1 ? `~${acres} ac can host a manufactured/site-built home if buildable.` : 'Too small / not suited for a home package.', risk: 'Buildability, perc/septic, utilities unconfirmed.', confidence: conf((acres >= 1 ? 1 : 0) + (envClean ? 1 : 0)), mustVerify: 'Perc/septic, utilities, zoning, slope.', score: acres >= 1 ? (envClean ? 4 : 2) : 0 },
    { strategy: 'Subdivision / split', viability: acres >= 5 && envClean ? 'medium' : 'low', reason: acres >= 5 ? `~${acres} ac may support a split if zoning + access allow.` : 'Acreage likely too small to subdivide.', risk: 'Zoning, min-lot, infrastructure cost.', confidence: acres >= 5 ? 'medium' : 'low', mustVerify: 'Zoning min lot size, road/utility feasibility.', score: acres >= 5 ? (envClean ? 4 : 2) : 1 },
    { strategy: 'Neighbor / adjacent-owner sale', viability: landlocked || acres < 1 ? 'medium' : 'low', reason: landlocked ? 'Landlocked/odd parcel — adjacent owner is the natural buyer.' : 'Adjacent-owner sale is a fallback exit.', risk: 'Single-buyer leverage; slower.', confidence: 'low', mustVerify: 'Adjacent ownership, access dependency.', score: (landlocked ? 3 : 0) + (acres < 1 ? 1 : 0) + 1 },
    { strategy: 'Hold', viability: 'medium', reason: 'Always available; appreciation + optionality while DD completes.', risk: 'Carrying cost, opportunity cost.', confidence: 'medium', mustVerify: 'Taxes, holding cost.', score: 2 },
    { strategy: 'Pass', viability: (!hasBand && (landlocked || flood || wetlands)) ? 'high' : 'low', reason: (!hasBand && (landlocked || flood || wetlands)) ? 'No comp band + serious environmental/access risk — likely pass.' : 'Only pass if DD reveals a deal-killer.', risk: 'Walking from a possible deal.', confidence: 'medium', mustVerify: 'Confirm the deal-killer before passing.', score: (!hasBand ? 1 : 0) + (landlocked ? 2 : 0) + (flood ? 1 : 0) + (wetlands ? 1 : 0) },
  ];
  return lanes.sort((a, b) => b.score - a.score);
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

/** Synthesize the operator-ready Executive Summary from the persisted report. */
export function buildExecutiveSummary(report: DealCardReportView, growth?: GrowthDriverSummary): ExecutiveSummary {
  const pulse = buildMarketPulse(report, growth);
  const range = buildAcquisitionRange(report, pulse);
  const strategyRanking = buildStrategyRanking(report, pulse, range);
  const dealEconomics = buildDealEconomics(range, pulse);
  const topStrategy = strategyRanking[0];
  const acres = acresOf(report);
  const landUse = checklistVal(report, 'landUse');
  const zoning = checklistVal(report, 'zoning');
  const county = checklistVal(report, 'county') ?? (report.marketSummary.match(/Target area:\s*([^.,]+)/)?.[1] ?? null);
  const verified = report.parcelVerified;

  const whatItIs = verified
    ? `${acres ? `${acres}-acre ` : ''}${landUse || 'parcel'}${county ? ` in ${county}` : ''}${zoning ? `, zoned ${zoning}` : ''}. Identity verified via Realie (parcel record). DD completeness: ${report.ddCompleteness?.label ?? 'in progress'}.`
    : 'Parcel identity not yet verified — area context only until a trusted provider resolves the input to a real parcel record.';

  const whyInteresting = range.available
    ? `Verified parcel with a real comp band — there's enough to set a preliminary acquisition target (${money(range.acquisition40)}–${money(range.acquisition60)}) and prep a seller call now.`
    : verified ? 'Verified parcel; gather a few sold comps to unlock pricing.' : 'Verify identity first to unlock the pipeline.';

  return {
    headline: verified
      ? `${acres ? `${acres} ac ` : ''}${landUse || 'land'}${county ? `, ${county}` : ''} — ${range.available ? `target ${money(range.acquisition40)}–${money(range.acquisition60)}` : 'verified, pricing pending comps'}`
      : 'Needs Verification — resolve the parcel to begin',
    whatItIs,
    whyInteresting,
    marketPulse: pulse,
    preliminaryAcquisitionRange: range,
    strategyRanking,
    strongestStrategy: { strategy: verified ? topStrategy.strategy : (report.mostViableStrategy || '(pending verified data)'), why: verified ? `${topStrategy.reason} (Risk: ${topStrategy.risk})` : 'Blocked until identity is verified.' },
    dealEconomics,
    topRisks: topRisks(report),
    sellerQuestions: [
      'Why are you looking to sell, and what timeline are you working with?',
      'Is the property paid off, or are there liens / back taxes?',
      'Is there legal road access and any utilities at the road?',
      'Has it been surveyed, perc-tested, or had any offers?',
      'Who else is part of the decision?',
    ],
    verifyBeforeOffer: [...new Set([...(report.countyVerificationChecklist ?? []), ...(report.dataGaps ?? []).filter((g) => !/not reviewed yet/i.test(g))])].slice(0, 8),
    nextSteps: range.available
      ? ['Run the discovery call with the questions above.', 'Tighten sold comps (radius/recency) to firm the range.', 'Confirm access, title, and buildability before any offer.']
      : verified ? ['Gather sold comps to price the parcel.', 'Run the discovery call.'] : ['Re-enter the address/APN to verify identity.'],
    confidence: range.available ? (pulse.confidence === 'high' ? 'high' : 'medium') : verified ? 'medium' : 'low',
  };
}
