// LandOS Napkin Underwriting — deterministic early opportunity screening.
//
// Two layers: the ACQUISITION NAPKIN ("what is it worth, what basis leaves
// spread, is this worth pursuing?") and STRATEGY NAPKINS ("what could we do
// with it, and does anything have enough economic room to investigate?").
//
// Hard rules this module enforces:
//  - It CONSUMES the canonical supported valuation (CvSummary). It never
//    recalculates FMV and never invents a second MAO engine — the existing
//    quick-flip technicalMaxOffer is the acquisition basis where present.
//  - All math is deterministic. No model call is ever made here.
//  - UNKNOWN never silently becomes zero. Missing required inputs make a
//    scenario's economics INCOMPLETE instead of producing a fake number.
//  - Every value carries its evidence kind so the UI can label ASSUMPTION,
//    MARKET-SUPPORTED INPUT, SUPPORTED FACT and UNKNOWN distinctly.
//  - The 40–60% band is a screening reference, never automatic offer
//    authority. Where inside (or outside) it a deal belongs is later
//    reasoning, not this module's output.

import type { CvSummary, CvQuickFlip, CvNegotiation } from '../components/AcquisitionWorkspaceV2CompsValuation';
import type { OverviewStrategyView } from '../components/AcquisitionWorkspaceV2Overview';

// ── Value provenance ────────────────────────────────────────────────────────

export type NapkinValueKind = 'supported_fact' | 'market_supported' | 'assumption' | 'unknown';

export const NAPKIN_KIND_LABEL: Record<NapkinValueKind, string> = {
  supported_fact: 'SUPPORTED FACT',
  market_supported: 'MARKET-SUPPORTED INPUT',
  assumption: 'ASSUMPTION',
  unknown: 'UNKNOWN',
};

/** A number with provenance. `value === null` always means UNKNOWN. */
export interface NapkinValue {
  value: number | null;
  kind: NapkinValueKind;
  /** Where the number came from, in operator language. */
  source: string;
}

/** Low / base / high range. Only `base` is required; a single supported
 *  number is a degenerate range and is not forced wider. */
export interface NapkinRange {
  low?: number | null;
  base: number;
  high?: number | null;
  kind: NapkinValueKind;
  source: string;
}

// ── Acquisition napkin ──────────────────────────────────────────────────────

export interface AcquisitionNapkin {
  /** Canonical supported FMV central value. */
  supportedFmv: number;
  fmvBasisLabel: string;
  fmvStatusLabel: string;
  /** True only when the canonical valuation status is 'supported'. */
  fmvSupported: boolean;
  /** The deterministic 40 / 50 / 60% screening band derived from that FMV.
   *  Prefers the canonical persisted acquisitionLevels; derives only when
   *  the summary carries an FMV without persisted levels. */
  band: { pct40: number; pct50: number; pct60: number };
  bandSource: 'persisted_acquisition_levels' | 'derived_from_supported_fmv';
  /** Seller ask, when known. null = unknown, never zero. */
  sellerAsk: number | null;
  /** Existing quick-flip technical MAO — the current acquisition basis.
   *  Reused, never recomputed here. null = not established. */
  currentBasis: number | null;
  currentBasisSource: string | null;
  /** FMV − seller ask, only when both are known. */
  askSpreadToFmv: number | null;
  /** Seller ask as % of FMV, only when both are known. */
  askPctOfFmv: number | null;
}

const round500 = (v: number): number => Math.round(v / 500) * 500;

export function buildAcquisitionNapkin(
  summary: Pick<CvSummary, 'fmv' | 'acquisitionLevels' | 'status' | 'statusLabel' | 'basisLabel'> | null | undefined,
  quickFlip: Pick<CvQuickFlip, 'technicalMaxOffer' | 'technicalMaxPctOfFmv'> | null | undefined,
  sellerAsk: number | null | undefined,
  negotiation?: Pick<CvNegotiation, 'hardCeiling' | 'ceilingBasis'> | null,
): AcquisitionNapkin | null {
  const fmv = summary?.fmv?.central;
  if (summary == null || fmv == null || !(fmv > 0)) return null;
  const persisted = summary.acquisitionLevels ?? null;
  const band = persisted ?? {
    pct40: round500(fmv * 0.4),
    pct50: round500(fmv * 0.5),
    pct60: round500(fmv * 0.6),
  };
  const ask = sellerAsk != null && sellerAsk > 0 ? sellerAsk : null;
  // Reuse the EXISTING acquisition ceiling doctrine: the reconciled
  // negotiation hard ceiling outranks the raw quick-flip technical number
  // (the negotiation record already clips a technical MAO that escaped the
  // band). Never a second MAO engine — a preference between existing ones.
  const technical = quickFlip?.technicalMaxOffer != null && quickFlip.technicalMaxOffer > 0
    ? quickFlip.technicalMaxOffer : null;
  const ceiling = negotiation?.hardCeiling != null && negotiation.hardCeiling > 0
    ? negotiation.hardCeiling : null;
  const mao = ceiling ?? technical;
  return {
    supportedFmv: fmv,
    fmvBasisLabel: summary.basisLabel,
    fmvStatusLabel: summary.statusLabel,
    fmvSupported: summary.status === 'supported',
    band,
    bandSource: persisted ? 'persisted_acquisition_levels' : 'derived_from_supported_fmv',
    sellerAsk: ask,
    currentBasis: mao,
    currentBasisSource: mao == null ? null
      : ceiling != null
        ? `Reconciled negotiation hard ceiling (${Math.round((ceiling / fmv) * 100)}% of FMV)${technical != null && technical !== ceiling ? ` — technical quick-flip MAO ${`$${Math.round(technical).toLocaleString('en-US')}`} reconciled to it` : ''}`
        : `Quick-flip technical MAO${quickFlip?.technicalMaxPctOfFmv != null ? ` (${Math.round(quickFlip.technicalMaxPctOfFmv)}% of FMV)` : ''}`,
    askSpreadToFmv: ask != null ? fmv - ask : null,
    askPctOfFmv: ask != null ? (ask / fmv) * 100 : null,
  };
}

// ── Strategy napkin contract ────────────────────────────────────────────────

export interface NapkinStrategyScenario {
  id: string;
  label: string;
  strategyType: string;
  conceptSummary: string;
  /** True when the concept depends on an uncertain physical configuration —
   *  rendered as NAPKIN SKETCH / HYPOTHESIS, never a factual yield. */
  napkinSketch: boolean;
  purchaseBasis: NapkinValue;
  roughProductCount: NapkinRange | null;
  roughExitValuePerProduct: NapkinRange | null;
  roughGrossRevenue: NapkinRange | null;
  roughMajorCosts: NapkinRange | null;
  roughHoldSellingAllowance: NapkinValue | null;
  /** Purchase basis + major costs + hold/sell allowance, when calculable. */
  roughTotalInvestment: NapkinRange | null;
  roughNetProfit: NapkinRange | null;
  /** Net profit / total investment (the invested-capital basis). */
  roughRoiPct: NapkinRange | null;
  roughHoldPeriod: string | null;
  confidence: 'higher' | 'moderate' | 'lower' | 'incomplete';
  /** 'complete' economics vs honestly 'incomplete' (an unresolved input
   *  prevents a meaningful profit calculation). */
  economics: 'complete' | 'incomplete';
  incompleteReason: string | null;
  keyAssumptions: string[];
  controllingUnknowns: string[];
  killConditions: string[];
  propertyFit: string | null;
  marketFit: string | null;
  sellerFit: string | null;
  provenance: string[];
}

// ── Deterministic napkin math ───────────────────────────────────────────────

export interface NapkinEconomicsInputs {
  purchaseBasis: NapkinValue;
  /** Either product count × exit value, or a direct gross revenue range. */
  productCount?: NapkinRange | null;
  exitValuePerProduct?: NapkinRange | null;
  grossRevenue?: NapkinRange | null;
  majorCosts?: NapkinRange | null;
  /** Explicitly-known hold/sell allowance. null = UNKNOWN (never zero). */
  holdSellingAllowance?: NapkinValue | null;
  /** True only when evidence supports that no major cost category applies
   *  (e.g. as-is resale with costs already inside the allowance). */
  noMajorCostsSupported?: boolean;
}

export interface NapkinEconomicsResult {
  roughGrossRevenue: NapkinRange | null;
  roughTotalInvestment: NapkinRange | null;
  roughNetProfit: NapkinRange | null;
  roughRoiPct: NapkinRange | null;
  economics: 'complete' | 'incomplete';
  incompleteReason: string | null;
}

const mulRange = (a: NapkinRange, b: NapkinRange): NapkinRange => ({
  low: a.low != null && b.low != null ? a.low * b.low : null,
  base: a.base * b.base,
  high: a.high != null && b.high != null ? a.high * b.high : null,
  kind: a.kind === 'assumption' || b.kind === 'assumption' ? 'assumption'
    : a.kind === 'market_supported' || b.kind === 'market_supported' ? 'market_supported'
    : a.kind,
  source: `${a.source} × ${b.source}`,
});

/** Deterministic coarse feasibility. Returns INCOMPLETE (with nulls) rather
 *  than inventing a number whenever a required input is UNKNOWN. */
export function computeNapkinEconomics(inputs: NapkinEconomicsInputs): NapkinEconomicsResult {
  const incomplete = (reason: string, revenue: NapkinRange | null = null): NapkinEconomicsResult => ({
    roughGrossRevenue: revenue,
    roughTotalInvestment: null,
    roughNetProfit: null,
    roughRoiPct: null,
    economics: 'incomplete',
    incompleteReason: reason,
  });

  // Revenue: direct, or count × exit value.
  let revenue: NapkinRange | null = inputs.grossRevenue ?? null;
  if (!revenue && inputs.productCount && inputs.exitValuePerProduct) {
    revenue = mulRange(inputs.productCount, inputs.exitValuePerProduct);
  }
  if (!revenue) {
    return incomplete(
      inputs.productCount || inputs.exitValuePerProduct
        ? 'Revenue incomplete: needs both a product count and an exit value per product.'
        : 'Revenue unknown: no supported resale value or product-count × exit-value pair.',
    );
  }

  if (inputs.purchaseBasis.value == null) {
    return incomplete('Purchase basis unknown.', revenue);
  }

  // Costs: UNKNOWN never becomes zero. Zero major costs must be explicitly
  // supported; an unknown allowance blocks the profit line.
  const majorCosts = inputs.majorCosts ?? null;
  if (!majorCosts && !inputs.noMajorCostsSupported) {
    return incomplete('Major costs unknown — not included, so profit is not calculable yet.', revenue);
  }
  const allowance = inputs.holdSellingAllowance ?? null;
  if (allowance == null || allowance.value == null) {
    return incomplete('Holding / selling allowance unknown — not included, so profit is not calculable yet.', revenue);
  }

  const basis = inputs.purchaseBasis.value;
  const costLow = majorCosts ? (majorCosts.low ?? majorCosts.base) : 0;
  const costBase = majorCosts ? majorCosts.base : 0;
  const costHigh = majorCosts ? (majorCosts.high ?? majorCosts.base) : 0;

  const investment: NapkinRange = {
    low: basis + costLow + allowance.value,
    base: basis + costBase + allowance.value,
    high: basis + costHigh + allowance.value,
    kind: 'assumption',
    source: 'Purchase basis + rough major costs + hold/sell allowance',
  };
  // Conservative pairing: low profit = low revenue − high investment.
  const profit: NapkinRange = {
    low: revenue.low != null ? revenue.low - (investment.high ?? investment.base) : null,
    base: revenue.base - investment.base,
    high: revenue.high != null ? revenue.high - (investment.low ?? investment.base) : null,
    kind: 'assumption',
    source: 'Rough gross revenue − rough total investment',
  };
  const roi: NapkinRange = {
    low: profit.low != null && investment.high ? (profit.low / investment.high) * 100 : null,
    base: (profit.base / investment.base) * 100,
    high: profit.high != null && investment.low ? (profit.high / investment.low) * 100 : null,
    kind: 'assumption',
    source: 'Rough net profit / rough total investment (invested capital)',
  };
  return {
    roughGrossRevenue: revenue,
    roughTotalInvestment: investment,
    roughNetProfit: profit,
    roughRoiPct: roi,
    economics: 'complete',
    incompleteReason: null,
  };
}

// ── Scenario builders ───────────────────────────────────────────────────────

/** Strategy-lane names that imply an uncertain physical transformation. */
const SKETCH_PATTERN = /subdiv|split|develop|lot|entitle|rezone|land[- ]home|assemblage/i;

export interface StrategyNapkinInputs {
  summary: Pick<CvSummary, 'fmv' | 'acquisitionLevels' | 'status' | 'statusLabel' | 'basisLabel'> | null | undefined;
  quickFlip: Pick<CvQuickFlip, 'technicalMaxOffer' | 'technicalMaxPctOfFmv' | 'totalNonAcquisitionCosts' | 'expectedMarketingDays'> | null | undefined;
  negotiation?: Pick<CvNegotiation, 'hardCeiling' | 'ceilingBasis'> | null;
  strategies: OverviewStrategyView[] | null | undefined;
}

/** Build napkin scenarios ONLY from what current deal evidence supports:
 *  an as-is resale napkin when a supported FMV exists, plus one scenario per
 *  strategy the strategy lane actually assessed as viable or conditional.
 *  No generic strategy menu is ever populated. */
export function buildStrategyNapkins(inputs: StrategyNapkinInputs): NapkinStrategyScenario[] {
  const scenarios: NapkinStrategyScenario[] = [];
  const napkin = buildAcquisitionNapkin(inputs.summary, inputs.quickFlip, null, inputs.negotiation ?? null);

  // 1. As-is / intact resale — exists whenever the canonical valuation does.
  if (napkin) {
    const basisValue = napkin.currentBasis ?? napkin.band.pct50;
    const purchaseBasis: NapkinValue = napkin.currentBasis != null
      ? { value: basisValue, kind: 'market_supported', source: napkin.currentBasisSource ?? 'Quick-flip technical MAO' }
      : { value: basisValue, kind: 'assumption', source: 'Mid-band reference (50% of supported FMV) — screening assumption, not an offer' };
    const allowance: NapkinValue | null = inputs.quickFlip?.totalNonAcquisitionCosts != null
      ? { value: inputs.quickFlip.totalNonAcquisitionCosts, kind: 'market_supported', source: 'Existing quick-flip non-acquisition cost stack' }
      : null;
    const econ = computeNapkinEconomics({
      purchaseBasis,
      grossRevenue: {
        base: napkin.supportedFmv,
        low: null, high: null,
        kind: napkin.fmvSupported ? 'supported_fact' : 'market_supported',
        source: `Canonical supported FMV (${napkin.fmvBasisLabel})`,
      },
      holdSellingAllowance: allowance,
      noMajorCostsSupported: true, // as-is resale: no transformation costs; hold/sell handled by the allowance
    });
    scenarios.push({
      id: 'as-is-resale',
      label: 'As-is resale',
      strategyType: 'intact_resale',
      conceptSummary: 'Buy at a screened discount to supported FMV and resell the property intact.',
      napkinSketch: false,
      purchaseBasis,
      roughProductCount: null,
      roughExitValuePerProduct: null,
      roughMajorCosts: null,
      roughHoldSellingAllowance: allowance,
      roughHoldPeriod: inputs.quickFlip?.expectedMarketingDays != null
        ? `~${Math.round(inputs.quickFlip.expectedMarketingDays)} days marketing` : null,
      ...econ,
      confidence: econ.economics === 'complete' ? (napkin.fmvSupported ? 'moderate' : 'lower') : 'incomplete',
      keyAssumptions: [
        napkin.currentBasis != null
          ? 'Acquisition at the existing quick-flip technical MAO.'
          : 'Acquisition near the middle of the 40–60% screening band (assumption, not an offer).',
        'Resale at the canonical supported FMV.',
      ],
      controllingUnknowns: econ.economics === 'incomplete' && econ.incompleteReason ? [econ.incompleteReason] : [],
      killConditions: ['Seller will not transact inside a basis that preserves spread to supported FMV.'],
      propertyFit: null,
      marketFit: null,
      sellerFit: null,
      provenance: [`FMV: ${napkin.fmvBasisLabel} (${napkin.fmvStatusLabel}) — see Comps & Valuation`],
    });
  }

  // 2. One napkin per strategy the lane actually assessed as worth reading.
  for (const s of inputs.strategies ?? []) {
    if (!s?.strategy) continue;
    const applicability = (s.applicability ?? '').toLowerCase();
    if (applicability !== 'viable' && applicability !== 'conditional') continue;
    if (/as[- ]is|intact/i.test(s.strategy) && scenarios.some((x) => x.id === 'as-is-resale')) continue;
    const sketch = SKETCH_PATTERN.test(`${s.strategy} ${s.valueCreationPath ?? ''}`);
    const unknowns = [
      ...(s.nextVerificationStep ? [s.nextVerificationStep] : []),
      ...(sketch ? ['Current supported yield / configuration is unresolved — no current product count exists.'] : []),
    ];
    scenarios.push({
      id: `lane-${s.strategy.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: s.strategy,
      strategyType: sketch ? 'transformation_hypothesis' : 'lane_assessed',
      conceptSummary: s.valueCreationPath || `Strategy lane assessed "${s.strategy}" as ${applicability}.`,
      napkinSketch: sketch,
      purchaseBasis: { value: null, kind: 'unknown', source: 'Basis for this concept not yet screened' },
      roughProductCount: null,
      roughExitValuePerProduct: null,
      roughGrossRevenue: null,
      roughMajorCosts: null,
      roughHoldSellingAllowance: null,
      roughTotalInvestment: null,
      roughNetProfit: null,
      roughRoiPct: null,
      roughHoldPeriod: s.timeline ?? null,
      confidence: 'incomplete',
      economics: 'incomplete',
      incompleteReason: unknowns[0]
        ? `Concept appears worth further investigation, but economics remain incomplete until: ${unknowns[0]}`
        : 'Economics remain incomplete — no supported revenue or cost inputs exist yet for this concept.',
      keyAssumptions: [],
      controllingUnknowns: unknowns,
      killConditions: s.blockers ?? [],
      propertyFit: s.supportingFacts?.[0] ?? null,
      marketFit: null,
      sellerFit: null,
      provenance: [`Strategy lane assessment: ${applicability}${s.risk ? ` — risk: ${s.risk}` : ''}`],
    });
  }

  return scenarios;
}
