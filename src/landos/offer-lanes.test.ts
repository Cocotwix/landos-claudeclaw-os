import { describe, it, expect } from 'vitest';
import {
  computeOfferLanes,
  FLIP_STANDARD_BAND,
  FLIP_CAUTIOUS_BAND,
  FLIP_FAST_MARKET_BAND,
  SUBDIVIDE_BAND,
  DOUBLE_CLOSE_MIN_PROFIT_USD,
  EV_LOW_FACTOR,
  SUBDIVISION_MIN_NET_PROFIT_USD,
} from './offer-engine.js';

const EV = 100_000;
const pct = (p: number) => Math.round((p / 100) * EV);

function lane(res: ReturnType<typeof computeOfferLanes>, id: string) {
  const l = res.lanes.find((x) => x.id === id);
  if (!l) throw new Error(`lane ${id} missing`);
  return l;
}

describe('computeOfferLanes — six lanes', () => {
  it('fails loud with no invented numbers when EV is missing/invalid', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const res = computeOfferLanes({ expectedValueUsd: bad });
      expect(res.computed).toBe(false);
      expect(res.lanes).toHaveLength(0);
      expect(res.evUsd).toBeNull();
      expect(res.notes.join(' ')).toMatch(/never invent/i);
    }
  });

  it('produces all six lanes labeled as pre-call placeholders', () => {
    const res = computeOfferLanes({ expectedValueUsd: EV });
    expect(res.computed).toBe(true);
    expect(res.lanes.map((l) => l.id).sort()).toEqual(
      ['double_close', 'flip_cautious', 'flip_fast_market', 'flip_standard', 'land_home_package', 'subdivide'].sort(),
    );
    expect(res.label).toMatch(/PRE-CALL PLACEHOLDER/);
  });

  it('flip standard uses 40-60% of EV', () => {
    const l = lane(computeOfferLanes({ expectedValueUsd: EV }), 'flip_standard');
    expect(l.offerLowUsd).toBe(pct(FLIP_STANDARD_BAND.low));
    expect(l.offerHighUsd).toBe(pct(FLIP_STANDARD_BAND.high));
    expect(l.applicable).toBe(true);
  });

  it('flip cautious is applicable only on PURSUE WITH CAUTION and uses 30-50%', () => {
    const cautious = lane(computeOfferLanes({ expectedValueUsd: EV, verdict: 'PURSUE WITH CAUTION' }), 'flip_cautious');
    expect(cautious.applicable).toBe(true);
    expect(cautious.offerLowUsd).toBe(pct(FLIP_CAUTIOUS_BAND.low));
    expect(cautious.offerHighUsd).toBe(pct(FLIP_CAUTIOUS_BAND.high));
    const notCautious = lane(computeOfferLanes({ expectedValueUsd: EV, verdict: 'PURSUE' }), 'flip_cautious');
    expect(notCautious.applicable).toBe(false);
  });

  it('flip fast-market requires 5+ comps AND avg DOM < 150', () => {
    const ok = lane(computeOfferLanes({ expectedValueUsd: EV, compCount: 6, avgDaysOnMarket: 90 }), 'flip_fast_market');
    expect(ok.applicable).toBe(true);
    expect(ok.offerLowUsd).toBe(pct(FLIP_FAST_MARKET_BAND.low));

    const fewComps = lane(computeOfferLanes({ expectedValueUsd: EV, compCount: 3, avgDaysOnMarket: 90 }), 'flip_fast_market');
    expect(fewComps.applicable).toBe(false);

    const slow = lane(computeOfferLanes({ expectedValueUsd: EV, compCount: 6, avgDaysOnMarket: 200 }), 'flip_fast_market');
    expect(slow.applicable).toBe(false);

    const noDom = lane(computeOfferLanes({ expectedValueUsd: EV, compCount: 6 }), 'flip_fast_market');
    expect(noDom.applicable).toBe(false);
    expect(noDom.flags.join(' ')).toMatch(/do not assume fast-market/i);
  });

  it('subdivide gate needs size/buildable/wetlands/FEMA/access and uses 55-65%, $30k min', () => {
    const ok = lane(
      computeOfferLanes({ expectedValueUsd: EV, acres: 10, buildablePct: 60, wetlandsPct: 5, femaPct: 5, landlocked: false, verdict: 'PURSUE' }),
      'subdivide',
    );
    expect(ok.applicable).toBe(true);
    expect(ok.offerLowUsd).toBe(pct(SUBDIVIDE_BAND.low));
    expect(ok.minNetProfitUsd).toBe(SUBDIVISION_MIN_NET_PROFIT_USD);

    const landlocked = lane(
      computeOfferLanes({ expectedValueUsd: EV, acres: 10, buildablePct: 60, wetlandsPct: 5, femaPct: 5, landlocked: true }),
      'subdivide',
    );
    expect(landlocked.applicable).toBe(false);
    expect(landlocked.flags.join(' ')).toMatch(/landlocked/i);
  });

  it('double close = EV-low minus $10,000 and is a single point offer', () => {
    const res = computeOfferLanes({ expectedValueUsd: EV });
    const dc = lane(res, 'double_close');
    const expected = Math.round(EV * EV_LOW_FACTOR) - DOUBLE_CLOSE_MIN_PROFIT_USD;
    expect(dc.offerLowUsd).toBe(expected);
    expect(dc.offerHighUsd).toBe(expected);
    expect(res.evLowUsd).toBe(Math.round(EV * EV_LOW_FACTOR));
  });

  it('double close is not viable when EV-low cannot clear the minimum', () => {
    const dc = lane(computeOfferLanes({ expectedValueUsd: 5_000 }), 'double_close');
    expect(dc.applicable).toBe(false);
    expect(dc.offerLowUsd).toBeNull();
  });

  it('land-home package gates on verified manufactured-home sales >= $200k', () => {
    const no = lane(computeOfferLanes({ expectedValueUsd: EV }), 'land_home_package');
    expect(no.applicable).toBe(false);
    const yes = lane(computeOfferLanes({ expectedValueUsd: EV, verifiedManufacturedSalesUsd: [210_000] }), 'land_home_package');
    expect(yes.applicable).toBe(true);
    expect(yes.offerLowUsd).toBeNull(); // formula-based, no number without inputs
  });

  it('sub-1-acre discipline: flags low when comp value below $40k', () => {
    const low = lane(computeOfferLanes({ expectedValueUsd: EV, acres: 0.7, compValueUsd: 20_000 }), 'flip_standard');
    expect(low.flags.join(' ')).toMatch(/score low/i);
    const ok = lane(computeOfferLanes({ expectedValueUsd: EV, acres: 0.7, compValueUsd: 45_000 }), 'flip_standard');
    expect(ok.flags.join(' ')).toMatch(/qualifies/i);
  });
});
