// LandOS offer engine foundation — OS Spine v1.
//
// Strategy/rule structures only. This is NOT seller-facing pricing
// automation: nothing here sends or prepares anything for a seller.
//
// CONFIRMED rules (Tyler):
//   - Global minimum net profit baseline: $10,000 (the old $50,000 default
//     is dead — do not use it).
//   - Subdivision minimum: $30,000 net per project unless Tyler changes it.
//   - Land-home package viability gate: verified local manufactured-home
//     sales in the $200,000–$300,000 range (or higher), otherwise the
//     strategy is flagged not feasible.
//   - Risk-scaled margin: required margin increases with hold time,
//     entitlement risk, access/utility/title/exit uncertainty, market
//     softness, and buyer-pool uncertainty.
//   - EV percentage bands already active in Duke's persona (CLAUDE.md
//     Section 9): flip 40–60% of EV, subdivide 55–65% of EV.
//
// Strategy percentages Tyler has NOT confirmed are named parameters seeded
// with UNCONFIRMED placeholders. Any scenario derived from an unconfirmed
// parameter is labeled DRAFT and must never be presented as a final offer.

export const GLOBAL_MIN_NET_PROFIT_USD = 10_000;
export const SUBDIVISION_MIN_NET_PROFIT_USD = 30_000;

/** Land-home package gate: the local market must show verified
 *  manufactured-home sales in this band (or higher) or the strategy is
 *  flagged not feasible. */
export const LAND_HOME_GATE = {
  minVerifiedSaleUsd: 200_000,
  maxVerifiedSaleUsd: 300_000,
} as const;

/** Risk factors that scale the required margin upward. The factor LIST is
 *  confirmed; the per-factor increment is a draft parameter. */
export const RISK_MARGIN_FACTORS = [
  'hold_time',
  'entitlement_risk',
  'access_uncertainty',
  'utility_uncertainty',
  'title_uncertainty',
  'exit_uncertainty',
  'market_softness',
  'buyer_pool_uncertainty',
] as const;

/** UNCONFIRMED draft: extra margin (percentage points of EV, subtracted from
 *  the offer band ceiling) added per active risk factor. */
export const DRAFT_RISK_MARGIN_PCT_PER_FACTOR = 2;

export type StrategyId =
  | 'quick_flip'
  | 'wholesale_assignment'
  | 'retail_flip'
  | 'improved_flip'
  | 'subdivision_minor_split'
  | 'land_home_package'
  | 'improvement_play'
  | 'neighbor_sale'
  | 'builder_sale'
  | 'investor_sale'
  | 'owner_finance_exit'
  | 'teardown_land_only'
  | 'pass';

export interface StrategyParams {
  id: StrategyId;
  label: string;
  /** Offer band as a percentage of Expected Value. Null when the strategy
   *  is formula-based rather than percentage-based, or not yet defined. */
  offerPctLowOfEv: number | null;
  offerPctHighOfEv: number | null;
  /** True only when Tyler has confirmed the percentages (directly or via
   *  Duke's active persona). Unconfirmed params force DRAFT labeling. */
  confirmed: boolean;
  minNetProfitUsd: number;
  notes: string;
}

export const STRATEGIES: readonly StrategyParams[] = [
  {
    id: 'quick_flip', label: 'Quick Flip',
    offerPctLowOfEv: 40, offerPctHighOfEv: 60, confirmed: true,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'Confirmed via Duke persona Section 9 (FLIP 40-60% of EV).',
  },
  {
    id: 'wholesale_assignment', label: 'Wholesale / Assignment',
    offerPctLowOfEv: 30, offerPctHighOfEv: 50, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED placeholder band. Tyler to set.',
  },
  {
    id: 'retail_flip', label: 'Retail Flip',
    offerPctLowOfEv: 45, offerPctHighOfEv: 60, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED placeholder band. Tyler to set.',
  },
  {
    id: 'improved_flip', label: 'Improved Flip',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'Formula-based on improved-property resale comps (Duke persona). Percent band UNCONFIRMED.',
  },
  {
    id: 'subdivision_minor_split', label: 'Subdivision / Minor Split',
    offerPctLowOfEv: 55, offerPctHighOfEv: 65, confirmed: true,
    minNetProfitUsd: SUBDIVISION_MIN_NET_PROFIT_USD,
    notes: 'Confirmed via Duke persona Section 9 (SUBDIVIDE 55-65% of EV). $30k minimum net per project.',
  },
  {
    id: 'land_home_package', label: 'Land-Home Package',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'Market qualification strategy, not a fixed percentage. Gate: verified manufactured-home sales $200k-$300k+.',
  },
  {
    id: 'improvement_play', label: 'Improvement Play',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED. Tyler to define parameters.',
  },
  {
    id: 'neighbor_sale', label: 'Neighbor Sale',
    offerPctLowOfEv: 40, offerPctHighOfEv: 60, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED placeholder band. Tyler to set.',
  },
  {
    id: 'builder_sale', label: 'Builder Sale',
    offerPctLowOfEv: 40, offerPctHighOfEv: 60, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED placeholder band. Tyler to set.',
  },
  {
    id: 'investor_sale', label: 'Investor Sale',
    offerPctLowOfEv: 35, offerPctHighOfEv: 55, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED placeholder band. Tyler to set.',
  },
  {
    id: 'owner_finance_exit', label: 'Owner-Finance Exit',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'UNCONFIRMED. Terms-based, not a simple EV percentage.',
  },
  {
    id: 'teardown_land_only', label: 'Teardown / Land-Only Fallback',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: false,
    minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
    notes: 'Formula-based: land-only resale minus demo/cleanup/holding/closing minus required profit (Duke persona). Percent band UNCONFIRMED.',
  },
  {
    id: 'pass', label: 'Pass',
    offerPctLowOfEv: null, offerPctHighOfEv: null, confirmed: true,
    minNetProfitUsd: 0,
    notes: 'No offer. Always available.',
  },
];

export interface StrategyScenario {
  strategy: StrategyId;
  label: string;
  feasible: boolean;
  offerLowUsd: number | null;
  offerHighUsd: number | null;
  minNetProfitUsd: number;
  /** DRAFT when any unconfirmed parameter contributed. Never present a
   *  DRAFT scenario as a final offer. */
  outputLabel: 'CONFIRMED PARAMETERS' | 'DRAFT (UNCONFIRMED PARAMETERS)';
  reasons: string[];
}

export interface ScenarioInput {
  expectedValueUsd: number;
  acres?: number;
  /** Verified local manufactured-home sale prices (fact-labeled Verified). */
  verifiedManufacturedSalesUsd?: number[];
  /** Active risk factors from RISK_MARGIN_FACTORS. */
  riskFactors?: string[];
}

/**
 * Produce per-strategy scenarios for a deal. Foundation only: percentage
 * band math plus confirmed gates. Formula-based strategies return null
 * bands with the missing-input reason. Never seller-facing.
 */
export function evaluateStrategies(input: ScenarioInput): StrategyScenario[] {
  const ev = input.expectedValueUsd;
  const risk = (input.riskFactors ?? []).filter((f) =>
    (RISK_MARGIN_FACTORS as readonly string[]).includes(f),
  );

  return STRATEGIES.map((s) => {
    const reasons: string[] = [];
    let feasible = true;
    let low: number | null = null;
    let high: number | null = null;
    // Risk scaling uses a draft per-factor increment, so any applied risk
    // adjustment makes the scenario DRAFT even for confirmed bands.
    let usedUnconfirmed = !s.confirmed;

    if (s.id === 'pass') {
      return {
        strategy: s.id, label: s.label, feasible: true,
        offerLowUsd: null, offerHighUsd: null, minNetProfitUsd: 0,
        outputLabel: 'CONFIRMED PARAMETERS', reasons: ['Always available.'],
      };
    }

    if (s.id === 'land_home_package') {
      const sales = input.verifiedManufacturedSalesUsd ?? [];
      const qualifying = sales.filter((p) => p >= LAND_HOME_GATE.minVerifiedSaleUsd);
      if (qualifying.length === 0) {
        feasible = false;
        reasons.push(
          `Not feasible: no verified local manufactured-home sales at or above $${LAND_HOME_GATE.minVerifiedSaleUsd.toLocaleString()} (gate: $${LAND_HOME_GATE.minVerifiedSaleUsd.toLocaleString()}-$${LAND_HOME_GATE.maxVerifiedSaleUsd.toLocaleString()} range required).`,
        );
      } else {
        reasons.push(`Gate passed: ${qualifying.length} verified manufactured-home sale(s) at or above $${LAND_HOME_GATE.minVerifiedSaleUsd.toLocaleString()}.`);
        reasons.push('Max offer requires the full land-home formula inputs (unit cost, tie-ins, permits, holding, profit).');
      }
    }

    if (s.offerPctLowOfEv !== null && s.offerPctHighOfEv !== null && ev > 0) {
      let pctLow = s.offerPctLowOfEv;
      let pctHigh = s.offerPctHighOfEv;
      if (risk.length > 0) {
        const haircut = risk.length * DRAFT_RISK_MARGIN_PCT_PER_FACTOR;
        pctLow = Math.max(0, pctLow - haircut);
        pctHigh = Math.max(0, pctHigh - haircut);
        usedUnconfirmed = true;
        reasons.push(`Risk-scaled margin applied: -${haircut} pct pts for ${risk.length} active risk factor(s) [draft scaling].`);
      }
      low = Math.round((pctLow / 100) * ev);
      high = Math.round((pctHigh / 100) * ev);

      // Minimum net profit screen: if even the low offer cannot clear the
      // required minimum against EV, flag the strategy.
      if (ev - high < s.minNetProfitUsd) {
        reasons.push(
          `Warning: spread at the high offer ($${(ev - high).toLocaleString()}) is below the $${s.minNetProfitUsd.toLocaleString()} minimum net profit baseline before costs.`,
        );
      }
    } else if (s.offerPctLowOfEv === null) {
      reasons.push('No percentage band: formula-based or undefined. Inputs required before any number is produced.');
    }

    if (!s.confirmed) {
      reasons.push('Parameters UNCONFIRMED — surface to Tyler for approval. Output is DRAFT, never a final offer.');
    }

    return {
      strategy: s.id,
      label: s.label,
      feasible,
      offerLowUsd: feasible ? low : null,
      offerHighUsd: feasible ? high : null,
      minNetProfitUsd: s.minNetProfitUsd,
      outputLabel: usedUnconfirmed ? 'DRAFT (UNCONFIRMED PARAMETERS)' : 'CONFIRMED PARAMETERS',
      reasons,
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Six-lane pre-call offer computation (offer-engine = source of truth).
//
// Brings the code in line with the Duke skill files, which already document all
// six lanes. evaluateStrategies() above stays untouched for back-compat; this is
// purely additive. Every range here is a PRE-CALL PLACEHOLDER the operator
// adjusts live with the seller — never a final offer, never seller-facing.
//
// Confirmed bands (Duke persona + duke-fast-default.md / duke-full-report.md):
//   Flip standard ...... 40-60% of EV
//   Flip Cautious ...... 30-50% of EV     (verdict = PURSUE WITH CAUTION)
//   Flip Fast-Market ... 45-55% of EV     ONLY when 5+ comps AND avg DOM < 150
//   Subdivide .......... 55-65% of EV     (size/buildable/wetlands/FEMA/access gate)
//   Double Close ....... EV-low minus $10,000   (tight-margin; prevents a dead pass)
//   Land-Home Package .. gated on verified manufactured-home sales >= $200k
// ───────────────────────────────────────────────────────────────────────────

export const EV_LOW_FACTOR = 0.95;
export const EV_HIGH_FACTOR = 1.05;

export const FLIP_STANDARD_BAND = { low: 40, high: 60 } as const;
export const FLIP_CAUTIOUS_BAND = { low: 30, high: 50 } as const;
export const FLIP_FAST_MARKET_BAND = { low: 45, high: 55 } as const;
export const SUBDIVIDE_BAND = { low: 55, high: 65 } as const;

/** Flip Fast-Market gate: both conditions must hold, and DOM must be known. */
export const FAST_MARKET_MIN_COMPS = 5;
export const FAST_MARKET_MAX_AVG_DOM_DAYS = 150;

/** Under-1-acre discipline: a 0.5-0.99 acre parcel only qualifies for a flip
 *  lane when raw-land comp value is at least this; below it, score low. */
export const SUB_ONE_ACRE_MIN_COMP_VALUE_USD = 40_000;

/** Double Close subtracts this fixed minimum profit from EV-low. */
export const DOUBLE_CLOSE_MIN_PROFIT_USD = GLOBAL_MIN_NET_PROFIT_USD;

export const OFFER_LANE_PLACEHOLDER_LABEL =
  'PRE-CALL PLACEHOLDER — adjust live with seller; never a final offer';

export type OfferLaneId =
  | 'flip_standard'
  | 'flip_cautious'
  | 'flip_fast_market'
  | 'subdivide'
  | 'double_close'
  | 'land_home_package';

export interface OfferLane {
  id: OfferLaneId;
  label: string;
  /** True when the lane's gate conditions are satisfied for this parcel. */
  applicable: boolean;
  /** Human band text, e.g. "40-60% of EV" or "EV-low minus $10,000". */
  band: string;
  offerLowUsd: number | null;
  offerHighUsd: number | null;
  minNetProfitUsd: number;
  /** Spread at the HIGH offer (EV - offerHigh); null when no number computed. */
  spreadAtHighUsd: number | null;
  /** False when the spread cannot clear the lane's minimum net profit. */
  meetsMinNet: boolean;
  /** Loud flags: gate failures, tight margins, sub-1-acre discipline, etc. */
  flags: string[];
  reasons: string[];
}

export interface OfferLanesInput {
  /** Expected Value in USD. Must be a finite number > 0 or the result fails loud. */
  expectedValueUsd: number;
  acres?: number;
  /** Verdict from the rubric; Flip Cautious is the applicable flip on caution. */
  verdict?: 'PURSUE' | 'PURSUE WITH CAUTION' | 'PASS';
  /** Sold-comp count and average days-on-market for the Fast-Market gate. */
  compCount?: number;
  avgDaysOnMarket?: number;
  /** Raw-land comp value (USD) for the under-1-acre discipline. */
  compValueUsd?: number;
  /** Subdivide gate inputs. */
  buildablePct?: number;
  wetlandsPct?: number;
  femaPct?: number;
  landlocked?: boolean;
  /** Verified local manufactured-home sale prices for the land-home gate. */
  verifiedManufacturedSalesUsd?: number[];
}

export interface OfferLanesResult {
  /** False + empty lanes when EV is missing/invalid (fail loud, never invented). */
  computed: boolean;
  evUsd: number | null;
  evLowUsd: number | null;
  evHighUsd: number | null;
  lanes: OfferLane[];
  label: typeof OFFER_LANE_PLACEHOLDER_LABEL;
  notes: string[];
}

function bandRange(ev: number, low: number, high: number): { low: number; high: number } {
  return { low: Math.round((low / 100) * ev), high: Math.round((high / 100) * ev) };
}

/**
 * Compute the six pre-call offer lanes from an Expected Value plus comp/parcel
 * context. Pure + deterministic. FAILS LOUD: a missing or non-positive EV
 * returns computed:false with no invented numbers. Each lane carries its gate
 * state, a min-net-profit screen, and loud flags. Nothing here is a final offer.
 */
export function computeOfferLanes(input: OfferLanesInput): OfferLanesResult {
  const ev = input.expectedValueUsd;
  const notes: string[] = [];

  if (!Number.isFinite(ev) || ev <= 0) {
    return {
      computed: false,
      evUsd: null,
      evLowUsd: null,
      evHighUsd: null,
      lanes: [],
      label: OFFER_LANE_PLACEHOLDER_LABEL,
      notes: ['Expected Value unavailable or not positive: no offer ranges computed. Never invent EV or offers.'],
    };
  }

  const evLow = Math.round(ev * EV_LOW_FACTOR);
  const evHigh = Math.round(ev * EV_HIGH_FACTOR);

  const acres = input.acres;
  const subOneAcre = typeof acres === 'number' && acres >= 0.5 && acres < 1;
  const compValue = input.compValueUsd;
  // Under-1-acre discipline flag shared by the flip lanes.
  const subOneAcreFlags: string[] = [];
  if (subOneAcre) {
    if (typeof compValue === 'number' && compValue >= SUB_ONE_ACRE_MIN_COMP_VALUE_USD) {
      subOneAcreFlags.push(`Sub-1-acre (${acres} ac) qualifies: raw-land comp value $${compValue.toLocaleString()} >= $${SUB_ONE_ACRE_MIN_COMP_VALUE_USD.toLocaleString()}.`);
    } else {
      subOneAcreFlags.push(`Sub-1-acre (${acres} ac) below the $${SUB_ONE_ACRE_MIN_COMP_VALUE_USD.toLocaleString()} comp-value threshold (value: ${typeof compValue === 'number' ? '$' + compValue.toLocaleString() : 'unknown'}): score low.`);
    }
  } else if (typeof acres === 'number' && acres < 0.5) {
    subOneAcreFlags.push(`Parcel under 0.5 acre (${acres} ac): treat flip lanes as low-confidence infill.`);
  }

  const minNet = (low: number, high: number, floor: number) => {
    const spreadAtHigh = ev - high;
    return { spreadAtHighUsd: spreadAtHigh, meetsMinNet: spreadAtHigh >= floor };
  };

  const lanes: OfferLane[] = [];

  // ── Flip standard (40-60%) ────────────────────────────────────────────────
  {
    const r = bandRange(ev, FLIP_STANDARD_BAND.low, FLIP_STANDARD_BAND.high);
    const m = minNet(r.low, r.high, GLOBAL_MIN_NET_PROFIT_USD);
    const flags = [...subOneAcreFlags];
    if (!m.meetsMinNet) flags.push(`At the high offer the spread ($${m.spreadAtHighUsd.toLocaleString()}) is below the $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()} minimum net profit. Treat the top end as aggressive.`);
    lanes.push({
      id: 'flip_standard', label: 'Flip standard', applicable: true,
      band: `${FLIP_STANDARD_BAND.low}-${FLIP_STANDARD_BAND.high}% of EV`,
      offerLowUsd: r.low, offerHighUsd: r.high, minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
      spreadAtHighUsd: m.spreadAtHighUsd, meetsMinNet: m.meetsMinNet, flags,
      reasons: ['Default flip lane when no special condition pushes elsewhere.'],
    });
  }

  // ── Flip Cautious (30-50%) ────────────────────────────────────────────────
  {
    const r = bandRange(ev, FLIP_CAUTIOUS_BAND.low, FLIP_CAUTIOUS_BAND.high);
    const m = minNet(r.low, r.high, GLOBAL_MIN_NET_PROFIT_USD);
    const applicable = input.verdict === 'PURSUE WITH CAUTION';
    const flags = [...subOneAcreFlags];
    if (!m.meetsMinNet) flags.push(`At the high offer the spread ($${m.spreadAtHighUsd.toLocaleString()}) is below the $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()} minimum net profit.`);
    lanes.push({
      id: 'flip_cautious', label: 'Flip Cautious', applicable,
      band: `${FLIP_CAUTIOUS_BAND.low}-${FLIP_CAUTIOUS_BAND.high}% of EV`,
      offerLowUsd: r.low, offerHighUsd: r.high, minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
      spreadAtHighUsd: m.spreadAtHighUsd, meetsMinNet: m.meetsMinNet, flags,
      reasons: [applicable ? 'Verdict is PURSUE WITH CAUTION: this is the applicable flip lane.' : 'Applies only when verdict = PURSUE WITH CAUTION.'],
    });
  }

  // ── Flip Fast-Market (45-55%) — gated on 5+ comps AND avg DOM < 150 ────────
  {
    const r = bandRange(ev, FLIP_FAST_MARKET_BAND.low, FLIP_FAST_MARKET_BAND.high);
    const m = minNet(r.low, r.high, GLOBAL_MIN_NET_PROFIT_USD);
    const haveComps = typeof input.compCount === 'number' && input.compCount >= FAST_MARKET_MIN_COMPS;
    const haveDom = typeof input.avgDaysOnMarket === 'number';
    const fastDom = haveDom && (input.avgDaysOnMarket as number) < FAST_MARKET_MAX_AVG_DOM_DAYS;
    const applicable = haveComps && fastDom;
    const flags = [...subOneAcreFlags];
    if (!haveComps) flags.push(`Fast-Market needs ${FAST_MARKET_MIN_COMPS}+ comps (have ${input.compCount ?? 0}).`);
    if (!haveDom) flags.push('Average DOM unknown: do not assume fast-market status.');
    else if (!fastDom) flags.push(`Average DOM ${input.avgDaysOnMarket} >= ${FAST_MARKET_MAX_AVG_DOM_DAYS} days: not a fast market.`);
    if (applicable && !m.meetsMinNet) flags.push(`At the high offer the spread ($${m.spreadAtHighUsd.toLocaleString()}) is below the $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()} minimum net profit.`);
    lanes.push({
      id: 'flip_fast_market', label: 'Flip Fast-Market', applicable,
      band: `${FLIP_FAST_MARKET_BAND.low}-${FLIP_FAST_MARKET_BAND.high}% of EV`,
      offerLowUsd: r.low, offerHighUsd: r.high, minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
      spreadAtHighUsd: m.spreadAtHighUsd, meetsMinNet: m.meetsMinNet, flags,
      reasons: [applicable ? `Fast market: ${input.compCount} comps and avg DOM ${input.avgDaysOnMarket} < ${FAST_MARKET_MAX_AVG_DOM_DAYS} days.` : 'Gate not met; shown for reference, not applicable.'],
    });
  }

  // ── Subdivide (55-65%) — gated on size/buildable/wetlands/FEMA/access ──────
  {
    const r = bandRange(ev, SUBDIVIDE_BAND.low, SUBDIVIDE_BAND.high);
    const m = minNet(r.low, r.high, SUBDIVISION_MIN_NET_PROFIT_USD);
    const sizeOk = typeof acres === 'number' && acres >= 5;
    const buildOk = typeof input.buildablePct === 'number' && input.buildablePct >= 50;
    const wetOk = typeof input.wetlandsPct === 'number' && input.wetlandsPct < 30;
    const femaOk = typeof input.femaPct === 'number' && input.femaPct < 30;
    const accessOk = input.landlocked !== true;
    const verdictOk = input.verdict === undefined || input.verdict === 'PURSUE';
    const applicable = sizeOk && buildOk && wetOk && femaOk && accessOk && verdictOk;
    const flags: string[] = [];
    if (!sizeOk) flags.push('Subdivide needs >= 5 acres.');
    if (!buildOk) flags.push('Subdivide needs >= 50% buildable (or unknown — county-rule dependent).');
    if (!wetOk) flags.push('Subdivide needs wetlands < 30% (or unknown).');
    if (!femaOk) flags.push('Subdivide needs FEMA flood < 30% (or unknown).');
    if (!accessOk) flags.push('Subdivide needs road access (parcel is landlocked).');
    if (!applicable) flags.push('Possible — needs county verification. Not the primary strategy.');
    if (applicable && !m.meetsMinNet) flags.push(`At the high offer the spread ($${m.spreadAtHighUsd.toLocaleString()}) is below the $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString()} subdivision minimum net profit.`);
    lanes.push({
      id: 'subdivide', label: 'Subdivide', applicable,
      band: `${SUBDIVIDE_BAND.low}-${SUBDIVIDE_BAND.high}% of EV`,
      offerLowUsd: r.low, offerHighUsd: r.high, minNetProfitUsd: SUBDIVISION_MIN_NET_PROFIT_USD,
      spreadAtHighUsd: m.spreadAtHighUsd, meetsMinNet: m.meetsMinNet, flags,
      reasons: [applicable ? 'Subdivision gate satisfied; frontage still county-rule dependent.' : 'Subdivision gate not fully satisfied.'],
    });
  }

  // ── Double Close (EV-low minus $10,000) ───────────────────────────────────
  {
    const offer = evLow - DOUBLE_CLOSE_MIN_PROFIT_USD;
    const viable = offer > 0;
    const flags: string[] = ['Tight-margin secondary path (if seller resists). Profit is the fixed minimum by construction.'];
    if (!viable) flags.push(`EV-low ($${evLow.toLocaleString()}) does not clear the $${DOUBLE_CLOSE_MIN_PROFIT_USD.toLocaleString()} minimum: double close not viable.`);
    lanes.push({
      id: 'double_close', label: 'Double Close', applicable: viable,
      band: `EV-low ($${evLow.toLocaleString()}) minus $${DOUBLE_CLOSE_MIN_PROFIT_USD.toLocaleString()}`,
      offerLowUsd: viable ? offer : null, offerHighUsd: viable ? offer : null,
      minNetProfitUsd: DOUBLE_CLOSE_MIN_PROFIT_USD,
      spreadAtHighUsd: viable ? DOUBLE_CLOSE_MIN_PROFIT_USD : null,
      meetsMinNet: viable, flags,
      reasons: ['Double close = EV-low minus the $10,000 minimum net profit. A calculation within flip, not a separate exit.'],
    });
  }

  // ── Land-Home Package (gated on verified manufactured-home sales >= $200k) ─
  {
    const sales = input.verifiedManufacturedSalesUsd ?? [];
    const qualifying = sales.filter((p) => Number.isFinite(p) && p >= LAND_HOME_GATE.minVerifiedSaleUsd);
    const applicable = qualifying.length > 0;
    const flags: string[] = [];
    if (!applicable) flags.push(`Needs verification: no verified manufactured-home sales >= $${LAND_HOME_GATE.minVerifiedSaleUsd.toLocaleString()}.`);
    else flags.push(`${qualifying.length} verified manufactured-home sale(s) >= $${LAND_HOME_GATE.minVerifiedSaleUsd.toLocaleString()}. Numeric offer needs full land-home formula inputs (unit cost, tie-ins, permits, holding, profit).`);
    lanes.push({
      id: 'land_home_package', label: 'Land-Home Package', applicable,
      band: 'Formula-based (gated on manufactured-home sales >= $200k)',
      offerLowUsd: null, offerHighUsd: null, minNetProfitUsd: GLOBAL_MIN_NET_PROFIT_USD,
      spreadAtHighUsd: null, meetsMinNet: applicable, flags,
      reasons: ['Market-qualification strategy, not a fixed EV percentage. No number until inputs exist.'],
    });
  }

  if (input.compCount === undefined && input.avgDaysOnMarket === undefined) {
    notes.push('No comp count / DOM supplied: Fast-Market lane is shown as not-applicable, never assumed.');
  }
  notes.push('All ranges are pre-call placeholders derived from EV. A concrete offer is set live with the seller.');

  return {
    computed: true,
    evUsd: ev,
    evLowUsd: evLow,
    evHighUsd: evHigh,
    lanes,
    label: OFFER_LANE_PLACEHOLDER_LABEL,
    notes,
  };
}
