// LandOS — Discovery Call Intelligence Report (Acquisition Specialist v1).
//
// ONE operator-facing pre-discovery-call report assembled from the persisted
// Deal Card report + Executive Summary. Pure + deterministic (no network, no
// provider call, no secret). It ORGANIZES already-gathered intelligence into the
// six sections Tyler runs a lead against:
//
//   1. Smart Input Interpretation   — what LandOS believes was entered
//   2. Parcel Intelligence          — best available parcel facts (+ confidence)
//   3. Comps / Land Price           — $/acre band + example comps (weaker when area-only)
//   4. Market Pulse                 — growth + local market read
//   5. Initial Strategy Evaluation  — EXACTLY five approved strategies
//   6. Rough Offer Range            — market value + 40–60% acquisition band
//
// This is PRE-DISCOVERY-CALL intelligence, never final underwriting or a final
// offer. When the parcel is not verified, everything is Local Area Context and is
// labeled weaker. Nothing here is ever fabricated: numbers appear only when the
// underlying report carries the evidence.

import type { DealCardReportView } from './deal-card-report.js';
import type { ExecutiveSummary } from './deal-card-executive-summary.js';
import { computeOfferLanes, GLOBAL_MIN_NET_PROFIT_USD, type OfferLane } from './offer-engine.js';
import { buildComparableIntelligence, type ComparableIntelligence } from './comparable-intelligence.js';
import { buildMarketIntelligence, type MarketIntelligence } from './market-intelligence.js';

const money = (n: number | null | undefined): string => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

// Unified $/acre price band. Prefers SOLD comps (real transactions); when a
// market has no recent sold land, falls back to ACTIVE-listing asking prices as
// a clearly-weaker signal (land typically sells at or below asking) so a
// comp-sparse rural lead still gets usable price context + a rough offer.
export interface PriceBand { basis: 'sold' | 'asking'; low: number | null; mid: number | null; high: number | null; count: number; }

function askingPpaBand(report: DealCardReportView, comps?: ComparableIntelligence): PriceBand | null {
  if (comps?.estimatedPricePerAcre.mid != null) {
    const ppas = comps.selectedComparables
      .filter((c) => c.status === 'active' || c.status === 'listed' || c.status === 'pending')
      .map((c) => c.pricePerAcre)
      .filter((n): n is number => typeof n === 'number' && n > 0)
      .sort((a, b) => a - b);
    if (ppas.length > 0) {
      return {
        basis: 'asking',
        low: comps.estimatedPricePerAcre.low ?? ppas[0],
        mid: comps.estimatedPricePerAcre.mid,
        high: comps.estimatedPricePerAcre.high ?? ppas[ppas.length - 1],
        count: ppas.length,
      };
    }
  }
  const rows = [...(report.marketComps?.active ?? []), ...(report.marketComps?.supplementalSold ?? [])];
  const ppas = rows.map((c) => c.pricePerAcre).filter((n): n is number => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  if (ppas.length === 0) return null;
  const mid = ppas[Math.floor(ppas.length / 2)];
  return { basis: 'asking', low: ppas[0], mid, high: ppas[ppas.length - 1], count: ppas.length };
}

function priceBand(report: DealCardReportView, es: ExecutiveSummary, comps?: ComparableIntelligence): PriceBand | null {
  const m = es.marketPulse.pricePerAcre;
  if (m.median != null) return { basis: 'sold', low: m.p25 ?? m.low, mid: m.median, high: m.p75 ?? m.high, count: es.marketPulse.soldCount };
  return askingPpaBand(report, comps);
}

// ── Section 1: Smart Input Interpretation ────────────────────────────────────

export interface DiscoveryIntake {
  /** What Tyler actually typed / the lead's raw input string. */
  rawInput: string;
  address?: string; city?: string; county?: string; state?: string; zip?: string;
  apn?: string; owner?: string; acres?: number | null;
  /** Human reason for the chosen resolver path (resolver-planner). */
  resolverPathReason?: string;
}

export interface SmartInputInterpretation {
  rawInput: string;
  interpretedAs: string;
  resolvedFields: Array<{ label: string; value: string }>;
  resolutionPath: string;
  parcelStatus: string;
  parcelVerified: boolean;
  note: string;
}

function buildSmartInput(intake: DiscoveryIntake, report: DealCardReportView): SmartInputInterpretation {
  const fields: Array<{ label: string; value: string }> = [];
  const push = (label: string, v?: string | number | null) => {
    const val = v == null ? '' : String(v).trim();
    if (val) fields.push({ label, value: val });
  };
  push('Address', intake.address);
  push('City', intake.city);
  push('County', intake.county ? `${intake.county} County` : undefined);
  push('State', intake.state);
  push('ZIP', intake.zip);
  push('APN / Parcel ID', intake.apn);
  push('Owner', intake.owner);
  push('Acreage', typeof intake.acres === 'number' && intake.acres > 0 ? `${intake.acres} ac` : undefined);

  const place = [intake.city, intake.county ? `${intake.county} County` : '', intake.state, intake.zip].filter(Boolean).join(', ');
  let interpretedAs: string;
  if (intake.address && place) interpretedAs = `Street address "${intake.address}" in ${place}.`;
  else if (intake.apn && place) interpretedAs = `Parcel ${intake.apn} in ${place}.`;
  else if (intake.owner && place) interpretedAs = `Owner "${intake.owner}" in ${place}.`;
  else if (place) interpretedAs = `Location: ${place}.`;
  else interpretedAs = `Raw lead: "${intake.rawInput}".`;

  return {
    rawInput: intake.rawInput,
    interpretedAs,
    resolvedFields: fields,
    resolutionPath: intake.resolverPathReason || 'Resolved from the strongest available identifier.',
    parcelStatus: report.parcelVerificationStatus,
    parcelVerified: report.parcelVerified,
    note: report.parcelVerified
      ? 'Parcel identity confirmed by a named source — facts below are parcel-specific.'
      : 'Parcel identity NOT confirmed — everything below is Local Area Context (weaker). Confirm the exact parcel before any offer.',
  };
}

// ── Section 5: Initial Strategy Evaluation (exactly five) ─────────────────────

export type StrategyVerdict = 'viable' | 'maybe' | 'not viable';
export type StrategyPotential = 'High Potential' | 'Moderate Potential' | 'Low Potential' | 'Not Recommended';

export interface StrategyEvaluation {
  strategy: string;
  verdict: StrategyVerdict;
  /** Operator-facing decisiveness label (never "maybe"). Derived from verdict +
   *  the strength of the evidence behind the strategy. */
  potential: StrategyPotential;
  reason: string;
  pricingLogic: string;
  mainRisk: string;
  /** Concrete acquisition band in dollars (40–60% of estimated market value) for
   *  flip-style strategies, when an estimated market value exists. */
  acquisitionRange: { low: number; high: number } | null;
}

interface StrategySignals {
  acres: number | null;         // null = unknown (NOT zero/small)
  ppaMedian: number | null;
  hasBand: boolean;             // area or parcel comp band exists
  hasComps: boolean;            // ANY normalized comparable evidence exists (LP/Zillow/Redfin/manual)
  estMidValue: number | null;   // market value mid (needs acres)
  soldCount: number;
  activeCount: number;
  domMedian: number | null;
  flood: boolean;
  wetlands: boolean;
  steep: boolean;
  landlocked: boolean;
  envClean: boolean;
  improvementSignal: string | null;
  lanes: Map<string, OfferLane>;
  /** 40–60% acquisition band on the estimated market value, when it exists. */
  acquisitionRange: { low: number; high: number } | null;
}

const money0 = (n: number | null | undefined): string => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

function laneOffer(l: OfferLane | undefined): string | null {
  if (!l) return null;
  if (l.offerLowUsd == null || l.offerHighUsd == null) return null;
  return l.offerLowUsd === l.offerHighUsd ? money(l.offerLowUsd) : `${money(l.offerLowUsd)}–${money(l.offerHighUsd)}`;
}

function evalQuickFlip(s: StrategySignals): StrategyEvaluation {
  // Comparable evidence (LandPortal/Zillow/Redfin/manual) is enough to anchor a
  // flip — never demand "gather comps" when comps already exist. Sold comps make
  // it strongest; asking/listed evidence still supports a flip at lower confidence.
  const hasValue = s.acquisitionRange != null || s.estMidValue != null || s.ppaMedian != null;
  const verdict: StrategyVerdict = (!s.hasComps && !s.hasBand) ? 'not viable'
    : (s.soldCount >= 3 && s.activeCount >= 3) ? 'viable'
    : 'maybe';
  const acq = s.acquisitionRange;
  const pricingLogic = acq
    ? `Buy at 40–60% of the ~${money0(s.estMidValue)} estimated market value: ${money0(acq.low)}–${money0(acq.high)}. Resell or assign near market.`
    : s.ppaMedian
      ? `~40–60% of market value. At ${money(s.ppaMedian)}/acre that's ~${money(0.4 * s.ppaMedian)}–${money(0.6 * s.ppaMedian)}/acre — provide acreage for a total.`
      : 'Buy at 40–60% of estimated market value once a value estimate exists.';
  return {
    strategy: 'Quick Flip', verdict,
    potential: 'Moderate Potential', // refined in decorateStrategies
    reason: (s.hasComps || s.hasBand)
      ? `Comparable evidence supports an estimated ~${money0(s.estMidValue)} value${s.soldCount > 0 ? ` (${s.soldCount} sold, ${s.activeCount} active)` : ' (listed/asking comps — sold comps would raise confidence)'}. Room to acquire below value and resell/assign.`
      : 'No comparable evidence yet to anchor a quick flip.',
    pricingLogic,
    mainRisk: s.landlocked || s.flood ? 'Access or flood risk could stall resale speed and buyer pool.' : hasValue ? 'Pricing confidence is asking-based until sold comps confirm; confirm marketable acreage and title.' : 'Resale velocity depends on local buyer demand; confirm marketable acreage and title.',
    acquisitionRange: acq,
  };
}

function evalDoubleClose(s: StrategySignals): StrategyEvaluation {
  // Especially relevant when the market is slower, margin is thinner, or taking
  // the property down directly is less attractive (Tyler's rule).
  const verdict: StrategyVerdict = s.hasBand && s.activeCount > 0 ? 'viable' : 'maybe';
  const offer = laneOffer(s.lanes.get('double_close'));
  const pricingLogic = offer
    ? `Target ≈ market-low minus the ${money(GLOBAL_MIN_NET_PROFIT_USD)} minimum profit: ${offer}. Flip the contract, do not take title long-term.`
    : `Contract the deal, then novate or back-to-back close to a retail buyer; target market-low minus the ${money(GLOBAL_MIN_NET_PROFIT_USD)} minimum profit.`;
  return {
    strategy: 'Novation / Double Close', verdict,
    potential: 'Moderate Potential',
    reason: s.hasComps || s.activeCount > 0
      ? `Comparable evidence supports the spread — capture it without taking title long-term. Strongest when the market is slower, the margin is thinner, or taking it down directly is less attractive.`
      : 'Tight-margin secondary path when the market is slower or taking the property down directly is less attractive — needs an end buyer.',
    pricingLogic,
    mainRisk: 'Two closings / novation terms; brief title hold + double-closing costs; must line up an end buyer.',
    acquisitionRange: s.acquisitionRange,
  };
}

function evalSubdivide(s: StrategySignals): StrategyEvaluation {
  let verdict: StrategyVerdict;
  let reason: string;
  if (s.acres == null) {
    verdict = 'maybe';
    reason = 'Acreage unknown — if 5+ acres with road access and buildable soils, a split into multiple lots can lift aggregate value. Confirm acreage first.';
  } else if (s.acres >= 5 && s.envClean) {
    verdict = 'viable';
    reason = `~${s.acres} ac with clean access/soils may support a split into multiple sellable lots if zoning allows.`;
  } else if (s.acres >= 5) {
    verdict = 'maybe';
    reason = `~${s.acres} ac is large enough, but flood/wetlands/slope/access constraints need clearing before a split pencils.`;
  } else {
    verdict = 'not viable';
    reason = `~${s.acres} ac is likely too small to subdivide.`;
  }
  const offer = laneOffer(s.lanes.get('subdivide'));
  const pricingLogic = offer
    ? `Buy at ~55–65% of aggregate finished-lot value: ${offer}. Target $30k+ net per project.`
    : 'Buy at ~55–65% of aggregate finished-lot value once acreage + lot yield are known. Target $30k+ net per project.';
  return { strategy: 'Subdivide', verdict, potential: 'Moderate Potential', reason, pricingLogic, mainRisk: 'Zoning min-lot size, road/utility/infrastructure cost, survey, and entitlement time.', acquisitionRange: null };
}

function evalLandHome(s: StrategySignals): StrategyEvaluation {
  // A single manufactured/modular home needs a BUILDABLE lot, not acreage — small
  // infill lots (e.g. Lehigh Acres) are prime for this. Reject only on real
  // constraints (flood / landlocked), not on small size.
  const verdict: StrategyVerdict = (s.flood || s.landlocked) ? 'not viable' : 'maybe';
  return {
    strategy: 'Land-Home Package',
    verdict,
    potential: 'Moderate Potential',
    reason: (s.acres != null && s.acres < 1)
      ? `A ${s.acres}-ac infill lot can host a single manufactured/modular home (not a multi-home package); sell land + home together. Needs verified local manufactured-home sales to pencil.`
      : 'Place a manufactured/modular home and sell land + home together. Needs verified local manufactured-home sales at/above $200k to pencil (not confirmed pre-call).',
    pricingLogic: 'Formula-based (unit cost + tie-ins + permits + holding + profit), gated on verified local manufactured-home sales. No firm number until those inputs exist.',
    mainRisk: 'Buildability, perc/septic, utilities, and local manufactured-home resale demand all unconfirmed.',
    acquisitionRange: null,
  };
}

function evalImprovement(s: StrategySignals): StrategyEvaluation {
  let verdict: StrategyVerdict;
  if (s.flood || s.wetlands || s.steep || s.landlocked) verdict = 'not viable';
  else if (s.hasBand) verdict = 'maybe';
  else verdict = 'maybe';
  const offer = laneOffer(s.lanes.get('flip_standard'));
  const pricingLogic = offer
    ? `Buy at a flip band on CURRENT value (${offer}), add access/clearing/utilities/perc, resell at the improved value. Margin = value lift − improvement + holding cost.`
    : 'Buy low, add access/clearing/utilities/perc, resell at improved value. Margin = value lift − improvement + holding cost.';
  return {
    strategy: 'Improvement Then Flip', verdict,
    potential: 'Moderate Potential',
    reason: (s.flood || s.wetlands || s.steep || s.landlocked)
      ? 'Environmental/access constraints (flood, wetlands, slope, or landlocked) limit the achievable value lift.'
      : s.improvementSignal
        ? `${s.improvementSignal} Visual Signal, Not Verified Fact. It may support a cleanup/clearing/access improvement before resale, but the value lift still needs proof.`
        : 'Add access/clearing/utilities/perc to lift raw-land value, then resell improved. Site-work cost vs. lift must be proven.',
    pricingLogic,
    mainRisk: 'Site-work cost vs. value lift unproven; env/access constraints can erase the lift.',
    acquisitionRange: s.acquisitionRange,
  };
}

function firstImprovementSignal(report: DealCardReportView): string | null {
  const visuals = report.landportalInspection?.visualObservations ?? [];
  const candidate = visuals.find((v) => /trailer|mobile|abandon|structure|overgrow|clearing|driveway|trail|access/i.test(`${v.label} ${v.detail}`));
  if (candidate) return `${candidate.label}: ${candidate.detail}`;
  return null;
}

/** Map verdict + evidence strength → a decisive operator label (never "maybe"). */
function decidePotential(e: StrategyEvaluation, s: StrategySignals): StrategyPotential {
  if (e.verdict === 'not viable') return 'Not Recommended';
  const hasEvidence = s.hasComps || s.hasBand || s.estMidValue != null;
  if (e.verdict === 'viable') return hasEvidence ? 'High Potential' : 'Moderate Potential';
  // 'maybe' → resolve to Moderate or Low by evidence + constraints.
  const constrained = s.flood || s.wetlands || s.steep || s.landlocked;
  if (constrained) return 'Low Potential';
  return hasEvidence ? 'Moderate Potential' : 'Low Potential';
}

/** Evaluate EXACTLY the five approved initial strategies. No others are added. */
export function buildStrategyEvaluation(report: DealCardReportView, es: ExecutiveSummary, comps?: ComparableIntelligence): StrategyEvaluation[] {
  const acres = es.preliminaryAcquisitionRange.acres;
  const mp = es.marketPulse;
  const band = priceBand(report, es, comps);
  const ppaMedian = band?.mid ?? comps?.estimatedPricePerAcre?.mid ?? null;
  // Normalized comparable evidence from ANY source (LandPortal/Zillow/Redfin/manual).
  const hasComps = (comps?.selectedComparables?.length ?? 0) > 0 || comps?.estimatedMarketValue?.mid != null;
  // Market value mid: comp-based estimate → sold/asking band × acres → prelim range.
  const estMidValue = comps?.estimatedMarketValue?.mid
    ?? es.preliminaryAcquisitionRange.estMidValue
    ?? (ppaMedian != null && acres != null ? Math.round(ppaMedian * acres) : null);
  const acquisitionRange = estMidValue != null && estMidValue > 0
    ? { low: Math.round(0.4 * estMidValue), high: Math.round(0.6 * estMidValue) }
    : null;
  const hasBand = !!band || hasComps;
  const g = report.govDd;
  const flood = !!(g?.flood && g.flood.status === 'verified' && g.flood.zone && !/^x$/i.test(g.flood.zone));
  // "None" / "None mapped" NWI type means NO wetlands — not a constraint.
  const wetlands = !!(g?.wetlands && g.wetlands.status === 'verified' && g.wetlands.type && !/^none/i.test(g.wetlands.type.trim()));
  const steep = !!(g?.slope && g.slope.status === 'verified' && g.slope.slopeDeg != null && g.slope.slopeDeg > 12);
  const landlocked = (report.riskFlags ?? []).some((r) => /landlock|no legal access/i.test(r));

  // Offer lanes anchor the pricing logic. Computed only when a market value mid
  // exists (needs acreage + a comp band); otherwise pricing is expressed per-acre.
  const lanes = new Map<string, OfferLane>();
  if (typeof estMidValue === 'number' && estMidValue > 0) {
    const res = computeOfferLanes({
      expectedValueUsd: estMidValue,
      acres: acres ?? undefined,
      compCount: mp.soldCount,
      avgDaysOnMarket: mp.domMedian ?? undefined,
      wetlandsPct: wetlands ? 30 : 0,
      femaPct: flood ? 30 : 0,
      landlocked,
    });
    for (const l of res.lanes) lanes.set(l.id, l);
  }

  const signals: StrategySignals = {
    acres: acres ?? null, ppaMedian, hasBand, hasComps, estMidValue,
    soldCount: mp.soldCount, activeCount: mp.activeCount, domMedian: mp.domMedian,
    flood, wetlands, steep, landlocked, envClean: !flood && !wetlands && !steep && !landlocked, improvementSignal: firstImprovementSignal(report), lanes,
    acquisitionRange,
  };

  return [
    evalQuickFlip(signals),
    evalDoubleClose(signals),
    evalSubdivide(signals),
    evalLandHome(signals),
    evalImprovement(signals),
  ].map((e) => ({ ...e, potential: decidePotential(e, signals) }));
}

// ── Section 6: Rough Offer Range ─────────────────────────────────────────────

export interface RoughOfferRange {
  basis: 'parcel' | 'area' | 'insufficient';
  available: boolean;
  acres: number | null;
  pricePerAcre: { low: number | null; mid: number | null; high: number | null };
  marketValue: { low: number | null; mid: number | null; high: number | null } | null;
  /** 40–60% of the mid market value (Tyler's acquisition philosophy). */
  acquisition: { low: number | null; high: number | null } | null;
  /** Per-acre acquisition band when total acreage is unknown. */
  perAcreAcquisition: { low: number | null; high: number | null } | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  whatCouldChange: string[];
  note: string;
}

export function buildRoughOfferRange(report: DealCardReportView, es: ExecutiveSummary, comps?: ComparableIntelligence): RoughOfferRange {
  const r = es.preliminaryAcquisitionRange;
  const band = priceBand(report, es, comps);
  const ppa = { low: band?.low ?? null, mid: band?.mid ?? null, high: band?.high ?? null };
  const asking = band?.basis === 'asking';
  const basis: RoughOfferRange['basis'] = report.parcelVerified ? 'parcel' : (ppa.mid != null ? 'area' : 'insufficient');
  const whatCouldChange = [
    ...r.increaseValueIf.map((x) => `↑ ${x}`),
    ...r.decreaseValueIf.map((x) => `↓ ${x}`),
    'Confirm exact acreage and parcel identity (moves value the most pre-call).',
  ];

  // Full total-value range: needs acreage + a $/acre mid.
  if (r.available && r.estMidValue != null && r.recommendedRange) {
    return {
      basis, available: true, acres: r.acres,
      pricePerAcre: ppa,
      marketValue: { low: r.estConservativeValue, mid: r.estMidValue, high: r.estMarketRange ? r.estMarketRange[1] : null },
      acquisition: { low: r.recommendedRange[0], high: r.recommendedRange[1] },
      perAcreAcquisition: ppa.mid != null ? { low: Math.round(0.4 * ppa.mid), high: Math.round(0.6 * ppa.mid) } : null,
      confidence: r.confidence,
      whatCouldChange,
      note: r.note,
    };
  }

  // Per-acre only: a $/acre band exists but acreage is unknown (or no verified
  // sold-based total). Works off sold OR asking $/acre (asking labeled weaker).
  if (ppa.mid != null) {
    const priceWord = asking ? `asks around ${money(ppa.mid)}/acre (ACTIVE listings — asking, not sold; land usually sells at/below asking)` : `trades around ${money(ppa.mid)}/acre`;
    return {
      basis: 'area', available: true, acres: r.acres,
      pricePerAcre: ppa,
      marketValue: r.acres != null ? { low: ppa.low != null ? Math.round(ppa.low * r.acres) : null, mid: Math.round(ppa.mid * r.acres), high: ppa.high != null ? Math.round(ppa.high * r.acres) : null } : null,
      acquisition: r.acres != null ? { low: Math.round(0.4 * ppa.mid * r.acres), high: Math.round(0.6 * ppa.mid * r.acres) } : null,
      perAcreAcquisition: { low: Math.round(0.4 * ppa.mid), high: Math.round(0.6 * ppa.mid) },
      confidence: 'low',
      whatCouldChange,
      note: `${report.parcelVerified ? 'Verified parcel' : 'Area land'} ${priceWord}. Acquire at ~${money(0.4 * ppa.mid)}–${money(0.6 * ppa.mid)}/acre (40–60%)${r.acres == null ? ' — provide acreage to compute a total value and offer' : ''}.${report.parcelVerified ? ' Asking-market fallback only — confirm with sold comps before any final offer.' : ' Local area context — not parcel verified.'}`,
    };
  }

  return {
    basis: 'insufficient', available: false, acres: r.acres,
    pricePerAcre: ppa, marketValue: null, acquisition: null, perAcreAcquisition: null,
    confidence: 'none', whatCouldChange,
    note: 'Not enough verified sold comps to price a range yet. Widen the comp search (radius/recency) or confirm acreage.',
  };
}

// ── Full Discovery Call Intelligence Report ──────────────────────────────────

export interface DiscoveryCallReport {
  available: boolean;
  parcelVerified: boolean;
  contextLabel: string;
  headline: string;
  smartInput: SmartInputInterpretation;
  landportalInspection?: DealCardReportView['landportalInspection'];
  comparableIntelligence: ComparableIntelligence;
  marketIntelligence: MarketIntelligence;
  strategyEvaluation: StrategyEvaluation[];
  roughOfferRange: RoughOfferRange;
  confidence: 'high' | 'medium' | 'low';
  /** Honest caveat printed at the top of the report. */
  disclaimer: string;
}

/** Assemble the full Discovery Call Intelligence Report. Sections 2/3/4 (Parcel
 *  Intelligence, Comps/Land Price, Market Pulse) are rendered directly from the
 *  report + Executive Summary the caller already holds; this builder owns the
 *  three that need synthesis: Smart Input, the five strategies, and the range. */
export function buildDiscoveryCallReport(
  report: DealCardReportView,
  es: ExecutiveSummary,
  intake: DiscoveryIntake,
): DiscoveryCallReport {
  const smartInput = buildSmartInput(intake, report);
  const comparableIntelligence = buildComparableIntelligence(report);
  const marketIntelligence = buildMarketIntelligence(report, comparableIntelligence);
  const strategyEvaluation = buildStrategyEvaluation(report, es, comparableIntelligence);
  const roughOfferRange = buildRoughOfferRange(report, es, comparableIntelligence);
  const contextLabel = report.parcelVerified ? 'Parcel Verified' : 'Local Area Context, Not Parcel Verified';
  const viableCount = strategyEvaluation.filter((s) => s.verdict === 'viable').length;
  return {
    available: true,
    parcelVerified: report.parcelVerified,
    contextLabel,
    headline: report.parcelVerified
      ? (es.preliminaryAcquisitionRange.available
          ? `${es.headline}`
          : roughOfferRange.pricePerAcre.mid != null
            ? `Verified parcel — asking-market land evidence around ${money(roughOfferRange.pricePerAcre.mid)}/acre. Confirm with sold comps before any final offer.`
            : `${es.headline}`)
      : `Local area read${roughOfferRange.pricePerAcre.mid != null ? ` — land ~${money(roughOfferRange.pricePerAcre.mid)}/acre` : ''}. Verify the parcel before any offer.`,
    smartInput,
    landportalInspection: report.landportalInspection,
    comparableIntelligence,
    marketIntelligence,
    strategyEvaluation,
    roughOfferRange,
    confidence: report.parcelVerified ? es.confidence : 'low',
    disclaimer: 'Pre-discovery-call intelligence only. Not final underwriting, not legal due diligence, not a final offer. ' +
      (report.parcelVerified ? '' : 'Parcel identity is NOT verified — treat all figures as weaker local-area context.'),
  };
}
