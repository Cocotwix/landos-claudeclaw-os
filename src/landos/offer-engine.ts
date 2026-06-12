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
