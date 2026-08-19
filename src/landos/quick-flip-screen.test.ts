// The one small deterministic fixture proving the base quick-flip screen.
import { describe, expect, it } from 'vitest';

import {
  computeQuickFlipScreen,
  evaluateSellerPrice,
  novationConsiderationGate,
  QUICK_FLIP_RULES,
} from './quick-flip-screen.js';

const HEALTHY = { fmvBasis: 'Comps-based cleaned valuation', acceptedCompCount: 4, expectedResaleDays: 95 };

describe('base quick-flip screen', () => {
  it('caps the cash MAO at 60% of supported FMV when the minimum net is comfortable', () => {
    const screen = computeQuickFlipScreen({ supportedFmv: 145_000, ...HEALTHY });
    expect(screen.status).toBe('viable');
    const economics = screen.economics!;
    expect(economics.levels).toEqual({ pct40: 58_000, pct50: 72_500, pct60: 87_000 });
    expect(economics.cashMao).toBe(87_000);
    expect(economics.bindingConstraint).toBe('sixty_pct_of_fmv');
    expect(economics.projectedNetAtMao).toBeGreaterThanOrEqual(QUICK_FLIP_RULES.minNetUsd);
  });

  it('binds on the $10K minimum net below 60% for a lower-value property, and still calls it viable', () => {
    const screen = computeQuickFlipScreen({ supportedFmv: 32_000, ...HEALTHY });
    expect(screen.status).toBe('viable');
    const economics = screen.economics!;
    expect(economics.sixtyPctCeiling).toBe(19_000);
    // FMV − 9% selling costs − $10,000 = $19,120 → the net constraint is the
    // lower one after rounding, so the screen names the price it must be
    // bought at instead of calling the property a failure.
    expect(economics.cashMao).toBe(19_000);
    expect(economics.cashMao).toBeLessThanOrEqual(economics.sixtyPctCeiling);
    expect(economics.projectedNetAtMao).toBeGreaterThanOrEqual(QUICK_FLIP_RULES.minNetUsd);
    expect(screen.reason).toContain('at or below');
  });

  it('uses only purchase + commission + closing/selling costs — no improvement, contingency or holding buckets', () => {
    const economics = computeQuickFlipScreen({ supportedFmv: 100_000, ...HEALTHY }).economics!;
    expect(economics.commissionUsd).toBe(7_000);
    expect(economics.closingSellingUsd).toBe(2_000);
    expect(economics.totalSellingCostsUsd).toBe(9_000);
    expect(economics.projectedNetAtMao).toBe(100_000 - economics.cashMao - 9_000);
  });

  it('is honestly pending without a supported FMV, never red', () => {
    const screen = computeQuickFlipScreen({ supportedFmv: null, fmvBasis: null, acceptedCompCount: 0, expectedResaleDays: null });
    expect(screen.status).toBe('pending');
    expect(screen.economics).toBeNull();
    expect(screen.missing).toContain('A supported FMV');
  });

  it('is pending, with the economics still shown, when only resale velocity is missing', () => {
    const screen = computeQuickFlipScreen({ supportedFmv: 145_000, fmvBasis: null, acceptedCompCount: 4, expectedResaleDays: null });
    expect(screen.status).toBe('pending');
    expect(screen.economics?.cashMao).toBe(87_000);
  });

  it('goes not-economic when no purchase price preserves the minimum net, or the window clearly fails', () => {
    expect(computeQuickFlipScreen({ supportedFmv: 10_500, ...HEALTHY }).status).toBe('not_economic');
    expect(computeQuickFlipScreen({ supportedFmv: 145_000, ...HEALTHY, expectedResaleDays: 220 }).status).toBe('not_economic');
  });
});

describe('seller price against the screen', () => {
  const screen = computeQuickFlipScreen({ supportedFmv: 145_000, ...HEALTHY });

  it('passes the cash deal at or below the MAO and fails it above, with the gap named', () => {
    expect(evaluateSellerPrice(screen, 80_000).verdict).toBe('cash_deal_pass');
    const failed = evaluateSellerPrice(screen, 140_000);
    expect(failed.verdict).toBe('cash_deal_fails_at_seller_price');
    expect(failed.gapUsd).toBe(53_000);
  });

  it('stays an economic screen while the seller price is unknown', () => {
    expect(evaluateSellerPrice(screen, null).verdict).toBe('no_seller_price');
  });

  it('only opens novation consideration after Seller Intelligence, on a good property in a good market', () => {
    const base = { cashVerdict: 'cash_deal_fails_at_seller_price' as const, propertyScore: 82, marketScore: 76 };
    expect(novationConsiderationGate({ ...base, sellerIntelligenceEstablished: false }).mayConsider).toBe(false);
    expect(novationConsiderationGate({ ...base, sellerIntelligenceEstablished: true }).mayConsider).toBe(true);
    expect(novationConsiderationGate({ ...base, sellerIntelligenceEstablished: true, cashVerdict: 'cash_deal_pass' }).mayConsider).toBe(false);
    expect(novationConsiderationGate({ ...base, sellerIntelligenceEstablished: true, marketScore: 40 }).mayConsider).toBe(false);
  });
});
