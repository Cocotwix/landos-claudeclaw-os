// LandOS — the base quick-flip acquisition screen.
//
// The FIRST economic test every deal takes: buy for cash, list essentially
// as-is, sell through a normal listing. Nothing here is a strategy choice —
// it answers "does enough value exist to pursue the seller at all", before
// subdivision, land-home, novation or any other structure is even considered.
//
// Deliberately NOT the technical underwriting in `computeQuickFlipUnderwriting`
// (comps-valuation.ts): that model prices a margin-target offer with carrying
// costs and a risk reserve. The BASE screen is simpler on purpose —
//
//     supported FMV − purchase − realtor/listing commission − normal
//     closing/title/selling costs = projected net
//
// with exactly two constraints on the purchase price: it never exceeds 60% of
// supported FMV, and it must preserve at least the LandOS minimum net. No
// improvement budgets, no contingency buckets, no project costs — those belong
// to the strategy that actually requires them, never to the base screen.
//
// Everything in this module is a CALCULATION over supplied facts. It asserts
// no property fact and no model may alter its arithmetic.

import { GLOBAL_MIN_NET_PROFIT_USD } from './offer-engine.js';

export const QUICK_FLIP_RULES = {
  /** The absolute normal cash-buy ceiling. 40–60% of supported FMV is the
   *  normal acquisition target zone; lower is always acceptable. */
  maxPctOfFmv: 0.6,
  /** Minimum projected net a base quick flip must preserve. */
  minNetUsd: GLOBAL_MIN_NET_PROFIT_USD,
  /** Normal realtor/listing commission, as a share of the resale price. */
  sellingCommissionPct: 0.07,
  /** Normal closing/title/selling costs, as a share of the resale price. */
  closingSellingPct: 0.02,
  /** The operating resale window: target and the max normal window. */
  targetResaleDays: 120,
  maxResaleDays: 150,
} as const;

const round500 = (value: number): number => Math.round(value / 500) * 500;

export interface QuickFlipScreenInput {
  /** The supported FMV LandOS stands behind — the comps-based valuation. */
  supportedFmv: number | null;
  fmvBasis: string | null;
  acceptedCompCount: number | null;
  /** Best retained resale-velocity evidence for the subject's band (median
   *  days on market). Null when Market Research has not established it. */
  expectedResaleDays: number | null;
}

export interface QuickFlipEconomics {
  supportedFmv: number;
  fmvBasis: string | null;
  levels: { pct40: number; pct50: number; pct60: number };
  commissionUsd: number;
  closingSellingUsd: number;
  totalSellingCostsUsd: number;
  minNetUsd: number;
  /** Highest purchase price that still preserves the minimum net. Can be ≤ 0
   *  when the property's value cannot carry the costs plus the minimum. */
  netPreservingCeiling: number;
  sixtyPctCeiling: number;
  /** The actual allowable cash purchase ceiling: the LOWER constraint. */
  cashMao: number;
  bindingConstraint: 'sixty_pct_of_fmv' | 'minimum_net';
  projectedNetAtMao: number;
  maoPctOfFmv: number;
}

export type QuickFlipStatusCode = 'viable' | 'pending' | 'not_economic';

export interface QuickFlipResaleWindow {
  expectedDays: number | null;
  targetDays: number;
  maxDays: number;
  /** Null when velocity evidence is missing; never guessed. */
  withinWindow: boolean | null;
  read: string;
}

export interface QuickFlipScreenResult {
  status: QuickFlipStatusCode;
  statusLabel: string;
  reason: string;
  /** The decisive inputs still missing, when status is pending. */
  missing: string[];
  /** Present whenever a supported FMV exists — even under a pending or
   *  not-economic status, the price the flip WOULD require stays visible. */
  economics: QuickFlipEconomics | null;
  resaleWindow: QuickFlipResaleWindow;
}

const STATUS_LABEL: Record<QuickFlipStatusCode, string> = {
  viable: 'Quick-flip economics viable',
  pending: 'Quick-flip pending',
  not_economic: 'Base quick flip not economic',
};

export function quickFlipStatusLabel(status: QuickFlipStatusCode): string {
  return STATUS_LABEL[status];
}

function computeEconomics(fmv: number, fmvBasis: string | null): QuickFlipEconomics {
  const commission = Math.round(fmv * QUICK_FLIP_RULES.sellingCommissionPct);
  const closing = Math.round(fmv * QUICK_FLIP_RULES.closingSellingPct);
  const totalCosts = commission + closing;
  const netPreservingCeiling = fmv - totalCosts - QUICK_FLIP_RULES.minNetUsd;
  const sixtyPctCeiling = round500(fmv * QUICK_FLIP_RULES.maxPctOfFmv);
  const binding = netPreservingCeiling < sixtyPctCeiling ? 'minimum_net' : 'sixty_pct_of_fmv';
  const cashMao = Math.max(0, round500(Math.min(sixtyPctCeiling, netPreservingCeiling)));
  return {
    supportedFmv: fmv,
    fmvBasis,
    levels: {
      pct40: round500(fmv * 0.4),
      pct50: round500(fmv * 0.5),
      pct60: sixtyPctCeiling,
    },
    commissionUsd: commission,
    closingSellingUsd: closing,
    totalSellingCostsUsd: totalCosts,
    minNetUsd: QUICK_FLIP_RULES.minNetUsd,
    netPreservingCeiling,
    sixtyPctCeiling,
    cashMao,
    bindingConstraint: binding,
    projectedNetAtMao: fmv - cashMao - totalCosts,
    maoPctOfFmv: fmv > 0 ? Math.round((cashMao / fmv) * 100) : 0,
  };
}

function resaleWindowFor(expectedDays: number | null): QuickFlipResaleWindow {
  const { targetResaleDays, maxResaleDays } = QUICK_FLIP_RULES;
  if (expectedDays == null) {
    return {
      expectedDays: null,
      targetDays: targetResaleDays,
      maxDays: maxResaleDays,
      withinWindow: null,
      read: 'No retained resale-velocity evidence for the subject band yet.',
    };
  }
  const within = expectedDays <= maxResaleDays;
  return {
    expectedDays,
    targetDays: targetResaleDays,
    maxDays: maxResaleDays,
    withinWindow: within,
    read: within
      ? expectedDays <= targetResaleDays
        ? `Retained market evidence supports resale inside the ${targetResaleDays}-day target.`
        : `Retained market evidence supports resale inside the ${maxResaleDays}-day maximum window, above the ${targetResaleDays}-day target.`
      : `Retained market evidence puts expected resale around ${expectedDays} days — outside the ${maxResaleDays}-day maximum window.`,
  };
}

/**
 * The base screen. A property is never marked red merely because the seller
 * has not named a price — RED is reserved for economics or velocity that make
 * the base flip unrealistic even at a plausible acquisition basis.
 */
export function computeQuickFlipScreen(input: QuickFlipScreenInput): QuickFlipScreenResult {
  const resaleWindow = resaleWindowFor(input.expectedResaleDays);
  const fmv = input.supportedFmv != null && Number.isFinite(input.supportedFmv) && input.supportedFmv > 0
    ? input.supportedFmv
    : null;

  if (fmv == null) {
    const missing = ['A supported FMV'];
    if (!input.acceptedCompCount) missing.push('Accepted closed-sale comp evidence');
    if (input.expectedResaleDays == null) missing.push('Resale-velocity evidence for the subject band');
    return {
      status: 'pending',
      statusLabel: STATUS_LABEL.pending,
      reason: 'No supported FMV has been established, so the flip cannot be priced yet.',
      missing,
      economics: null,
      resaleWindow,
    };
  }

  const economics = computeEconomics(fmv, input.fmvBasis);

  if (economics.cashMao <= 0) {
    return {
      status: 'not_economic',
      statusLabel: STATUS_LABEL.not_economic,
      reason: `Even a near-zero purchase price cannot preserve $${QUICK_FLIP_RULES.minNetUsd.toLocaleString('en-US')} net after normal selling costs at the supported FMV.`,
      missing: [],
      economics,
      resaleWindow,
    };
  }

  if (resaleWindow.withinWindow === false) {
    return {
      status: 'not_economic',
      statusLabel: STATUS_LABEL.not_economic,
      reason: resaleWindow.read,
      missing: [],
      economics,
      resaleWindow,
    };
  }

  if (resaleWindow.withinWindow == null) {
    return {
      status: 'pending',
      statusLabel: STATUS_LABEL.pending,
      reason: 'A supported FMV exists but resale velocity for the subject band is not established, so the flip window cannot be confirmed yet.',
      missing: ['Resale-velocity evidence for the subject band'],
      economics,
      resaleWindow,
    };
  }

  const bindingNote = economics.bindingConstraint === 'minimum_net'
    ? ` Quick-flip economics are viable only at or below approximately $${economics.cashMao.toLocaleString('en-US')} — below the 60% level, because the minimum net binds first.`
    : '';
  return {
    status: 'viable',
    statusLabel: STATUS_LABEL.viable,
    reason: `A cash purchase at or below $${economics.cashMao.toLocaleString('en-US')} preserves at least $${QUICK_FLIP_RULES.minNetUsd.toLocaleString('en-US')} projected net inside the operating resale window.${bindingNote}`,
    missing: [],
    economics,
    resaleWindow,
  };
}

// ── Seller price against the screen ────────────────────────────────────────

export type CashDealVerdictCode =
  | 'cash_deal_pass'
  | 'cash_deal_fails_at_seller_price'
  | 'no_seller_price'
  | 'not_priceable';

export interface CashDealVerdict {
  verdict: CashDealVerdictCode;
  sellerPriceUsd: number | null;
  cashMao: number | null;
  /** How far the seller sits above the MAO when the cash deal fails. */
  gapUsd: number | null;
  note: string;
}

export function evaluateSellerPrice(
  screen: QuickFlipScreenResult,
  sellerPriceUsd: number | null,
): CashDealVerdict {
  const mao = screen.economics?.cashMao ?? null;
  if (sellerPriceUsd == null || !Number.isFinite(sellerPriceUsd) || sellerPriceUsd <= 0) {
    return {
      verdict: 'no_seller_price',
      sellerPriceUsd: null,
      cashMao: mao,
      gapUsd: null,
      note: 'No usable seller price is known yet — this remains an economic property/market screen.',
    };
  }
  if (mao == null || mao <= 0) {
    return {
      verdict: 'not_priceable',
      sellerPriceUsd,
      cashMao: mao,
      gapUsd: null,
      note: 'A seller price is known but no supported cash MAO exists to test it against.',
    };
  }
  if (sellerPriceUsd <= mao) {
    return {
      verdict: 'cash_deal_pass',
      sellerPriceUsd,
      cashMao: mao,
      gapUsd: null,
      note: `Seller price $${sellerPriceUsd.toLocaleString('en-US')} is at or below the cash MAO of $${mao.toLocaleString('en-US')} — the cash deal passes the base screen.`,
    };
  }
  return {
    verdict: 'cash_deal_fails_at_seller_price',
    sellerPriceUsd,
    cashMao: mao,
    gapUsd: sellerPriceUsd - mao,
    note: `Seller price $${sellerPriceUsd.toLocaleString('en-US')} exceeds the cash MAO of $${mao.toLocaleString('en-US')} by $${(sellerPriceUsd - mao).toLocaleString('en-US')} — the cash deal does not work at the seller's price.`,
  };
}

// ── Novation / double close is earned, never a pre-call default ────────────

export interface NovationGateInput {
  cashVerdict: CashDealVerdictCode;
  /** True only when Seller Intelligence exists — real seller communication,
   *  never ownership records. */
  sellerIntelligenceEstablished: boolean;
  propertyScore: number | null;
  marketScore: number | null;
}

export interface NovationGateResult {
  mayConsider: boolean;
  reason: string;
}

/** Novation/double close may only be EVALUATED after seller communication
 *  establishes that a good property in a good market cannot be bought at the
 *  cash MAO. This gate opens consideration; it never recommends. */
export function novationConsiderationGate(input: NovationGateInput): NovationGateResult {
  if (!input.sellerIntelligenceEstablished) {
    return { mayConsider: false, reason: 'Seller Intelligence is not established — novation/double close is never an initial pre-call strategy.' };
  }
  if (input.cashVerdict !== 'cash_deal_fails_at_seller_price') {
    return { mayConsider: false, reason: 'The cash basis has not been shown to fail at a known seller price, so no alternative structure is needed.' };
  }
  const good = (score: number | null) => score != null && score >= 65;
  if (!good(input.propertyScore) || !good(input.marketScore)) {
    return { mayConsider: false, reason: 'Novation is only considered for a good property in a good market; the current scores do not support it.' };
  }
  return {
    mayConsider: true,
    reason: 'Good property, good market, seller price above the cash MAO — a novation/double close may be evaluated against the remaining retail spread.',
  };
}
