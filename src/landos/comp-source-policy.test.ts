import { describe, expect, it } from 'vitest';
import {
  applyCompSourcePolicy,
  compSourceFamily,
  SUPPLEMENT_CAP_WITH_LANDPORTAL,
  SUPPLEMENT_CAP_WITHOUT_LANDPORTAL,
} from './comp-source-policy.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';

const SUBJECT: SubjectMarket = { state: 'TN', county: 'Roane', acres: 12 };

function comp(overrides: Partial<CompRegistryCandidate> & { provider: string }): CompRegistryCandidate {
  const { provider, ...rest } = overrides;
  return {
    provider,
    lane: overrides.lane ?? 'sold',
    addressDesc: overrides.addressDesc ?? '100 Old Ridge Rd, Kingston, TN 37763',
    state: overrides.state ?? 'TN',
    price: overrides.price ?? 60_000,
    priceKind: overrides.priceKind ?? 'sold',
    saleOrListDate: overrides.saleOrListDate ?? '2025-06-01',
    acres: overrides.acres ?? 10,
    sourceUrl: overrides.sourceUrl ?? 'https://example.gov/parcel/1',
    compClass: overrides.compClass ?? 'vacant_land',
    ...rest,
  } as CompRegistryCandidate;
}

describe('compSourceFamily', () => {
  it('maps provider labels onto policy families', () => {
    expect(compSourceFamily('LandPortal visible')).toBe('landportal');
    expect(compSourceFamily('landportal')).toBe('landportal');
    expect(compSourceFamily('Zillow')).toBe('zillow');
    expect(compSourceFamily('zillow_browser')).toBe('zillow');
    expect(compSourceFamily('Redfin (Apify)')).toBe('redfin');
    expect(compSourceFamily('apify')).toBe('redfin');
    expect(compSourceFamily('Realie')).toBe('realie');
    expect(compSourceFamily('homeharvest')).toBe('homeharvest');
    expect(compSourceFamily('Realtor.com (HomeHarvest)')).toBe('homeharvest');
    expect(compSourceFamily('County records')).toBe('county');
    expect(compSourceFamily('mystery feed')).toBe('other');
  });
});

describe('applyCompSourcePolicy — LandPortal primary branch', () => {
  const candidates = [
    comp({ provider: 'LandPortal visible', addressDesc: '1 A Rd, Kingston, TN 37763' }),
    comp({ provider: 'LandPortal visible', addressDesc: '2 B Rd, Kingston, TN 37763', acres: 11 }),
    ...Array.from({ length: 4 }, (_, i) => comp({ provider: 'Zillow', addressDesc: `${i + 10} Z Rd, Kingston, TN 37763`, acres: 10 + i })),
    ...Array.from({ length: 4 }, (_, i) => comp({ provider: 'Redfin', addressDesc: `${i + 20} R Rd, Kingston, TN 37763`, acres: 10 + i })),
  ];

  it('treats LandPortal rows as the primary basis', () => {
    const result = applyCompSourcePolicy(SUBJECT, candidates);
    expect(result.plan.landPortalUsable).toBe(true);
    expect(result.plan.landPortalUsableCount).toBe(2);
    expect(result.decisions.filter((d) => d.role === 'primary')).toHaveLength(2);
  });

  it('does not hide strong supplements behind the former two-per-source cap', () => {
    const result = applyCompSourcePolicy(SUBJECT, candidates);
    expect(result.plan.caps).toEqual({ zillow: SUPPLEMENT_CAP_WITH_LANDPORTAL, redfin: SUPPLEMENT_CAP_WITH_LANDPORTAL });
    const zillow = result.acceptedSold.filter((d) => d.family === 'zillow');
    const redfin = result.acceptedSold.filter((d) => d.family === 'redfin');
    expect(zillow).toHaveLength(4);
    expect(redfin).toHaveLength(4);
    const overflow = result.decisions.filter((d) => d.role === 'context_only' && (d.family === 'zillow' || d.family === 'redfin'));
    expect(overflow).toHaveLength(0);
  });
});

describe('applyCompSourcePolicy — no LandPortal branch', () => {
  const candidates = [
    ...Array.from({ length: 7 }, (_, i) => comp({ provider: 'Zillow', addressDesc: `${i} Z Rd, Kingston, TN 37763`, acres: 8 + i })),
    ...Array.from({ length: 7 }, (_, i) => comp({ provider: 'Redfin', addressDesc: `${i} R Rd, Kingston, TN 37763`, acres: 8 + i })),
  ];

  it('widens each marketplace to five when LandPortal is empty', () => {
    const result = applyCompSourcePolicy(SUBJECT, candidates);
    expect(result.plan.landPortalUsable).toBe(false);
    expect(result.plan.caps).toEqual({ zillow: SUPPLEMENT_CAP_WITHOUT_LANDPORTAL, redfin: SUPPLEMENT_CAP_WITHOUT_LANDPORTAL });
    expect(result.acceptedSold.filter((d) => d.family === 'zillow')).toHaveLength(5);
    expect(result.acceptedSold.filter((d) => d.family === 'redfin')).toHaveLength(5);
  });
});

describe('applyCompSourcePolicy — excluded valuation sources', () => {
  it('never government-verifies or accepts a county transaction for a comparable parcel', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'County records', compClass: 'vacant_land' }),
    ]);
    expect(result.acceptedSold).toHaveLength(0);
    expect(result.decisions[0].family).toBe('county');
    expect(result.decisions[0].fmvEligible).toBe(false);
    expect(result.decisions[0].reason).toMatch(/subject property only/);
  });

  it('keeps Realie and HomeHarvest comps out of the FMV set', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'Realie' }),
      comp({ provider: 'homeharvest' }),
      comp({ provider: 'LandPortal visible' }),
    ]);
    const realie = result.decisions.find((d) => d.family === 'realie')!;
    const hh = result.decisions.find((d) => d.family === 'homeharvest')!;
    expect(realie.fmvEligible).toBe(false);
    expect(hh.fmvEligible).toBe(false);
    // Disabled, not merely FMV-ineligible. `context_only` still surfaces as
    // CURRENT market context, which is how residential-feed rows previously
    // reached the operator's active-competition lane for a vacant-land subject.
    expect(realie.role).toBe('legacy_evidence');
    expect(hh.role).toBe('legacy_evidence');
    expect(realie.reason).toMatch(/disabled for the current comparable workflow/);
    expect(result.acceptedSold.every((d) => d.family !== 'realie' && d.family !== 'homeharvest')).toBe(true);
    expect(result.registryCandidates.every((c) => !/realie|homeharvest/i.test(c.provider))).toBe(true);
  });

  it('keeps a disabled aggregator out of the ACTIVE competition lane too', () => {
    // The operator-visible defect: a Realie/HomeHarvest land row counted as
    // current competition and inflated the active count on the Deal Card.
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'realie', lane: 'active', priceKind: 'list', compClass: 'vacant_land' }),
      comp({ provider: 'homeharvest', lane: 'active', priceKind: 'list', compClass: 'vacant_land' }),
      comp({ provider: 'Zillow', lane: 'active', priceKind: 'list', compClass: 'vacant_land', addressDesc: '4 Real Rd, Kingston, TN 37763' }),
    ]);
    expect(result.acceptedActive).toHaveLength(1);
    expect(result.acceptedActive[0].family).toBe('zillow');
    expect(result.legacyEvidence).toHaveLength(2);
  });

  it('disables an aggregator row whatever its property type says', () => {
    // Live finding on Deal 32: 30 Realie rows carried no usable property type.
    // The load-bearing fact is the source, not the type — an unknown-type row
    // and an improved row from a disabled source are both history only.
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'realie', compClass: 'unknown', addressDesc: '700 Lakeview Dr, Loudon, TN 37774' }),
      comp({ provider: 'homeharvest', compClass: 'residential' }),
    ]);
    expect(result.legacyEvidence).toHaveLength(2);
    expect(result.landHomeOnly).toHaveLength(0);
    for (const row of result.decisions) {
      expect(row.fmvEligible).toBe(false);
      expect(row.reason).toMatch(/disabled for the current comparable workflow/);
      expect(row.reason).toMatch(/retained as stored historical evidence/);
    }
  });
});

describe('applyCompSourcePolicy — property type and lane separation', () => {
  it('holds improved and manufactured rows for Land-Home only', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'Zillow', compClass: 'residential', addressDesc: '9 House Rd, Kingston, TN 37763' }),
      comp({ provider: 'Zillow', compClass: 'manufactured', addressDesc: '11 Trailer Rd, Kingston, TN 37763' }),
    ]);
    expect(result.landHomeOnly).toHaveLength(2);
    expect(result.acceptedSold).toHaveLength(0);
    for (const row of result.landHomeOnly) {
      expect(row.fmvEligible).toBe(false);
      expect(row.reason).toMatch(/Land-Home Package strategy only/);
    }
  });

  it('rejects commercial property types outright', () => {
    const result = applyCompSourcePolicy(SUBJECT, [comp({ provider: 'Redfin', compClass: 'commercial' })]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/Commercial property type/);
  });

  it('separates active competition from the closed-sale basis', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'LandPortal visible' }),
      comp({ provider: 'Zillow', lane: 'active', priceKind: 'list', addressDesc: '5 Listing Rd, Kingston, TN 37763' }),
    ]);
    expect(result.acceptedSold).toHaveLength(1);
    expect(result.acceptedActive).toHaveLength(1);
    expect(result.acceptedActive[0].fmvEligible).toBe(false);
    expect(result.acceptedActive[0].reason).toMatch(/asking price is never a closed-sale value basis/);
    const registryActive = result.registryCandidates.filter((c) => c.lane === 'active');
    expect(registryActive).toHaveLength(1);
    expect(registryActive[0].priceKind).toBe('list');
  });

  it('rejects rows outside the subject market', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'Zillow', state: 'GA', addressDesc: '1 Far Rd, Dalton, GA 30720' }),
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/Outside the subject market/);
  });

  it('rejects rows with no usable price', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'LandPortal visible', price: null, pricePerAcre: null }),
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/No usable price evidence/);
  });
});

describe('applyCompSourcePolicy — valuation blockers', () => {
  it('blocks valuation when nothing is accepted', () => {
    const result = applyCompSourcePolicy(SUBJECT, [comp({ provider: 'Realie' })]);
    expect(result.valuationBlockers.length).toBeGreaterThan(0);
    expect(result.valuationBlockers[0]).toMatch(/no value basis exists yet/);
  });

  it('blocks valuation when accepted comps carry no acreage', () => {
    const result = applyCompSourcePolicy(SUBJECT, [comp({ provider: 'LandPortal visible', acres: null })]);
    expect(result.acceptedSold).toHaveLength(1);
    expect(result.valuationBlockers.join(' ')).toMatch(/price-per-acre basis cannot be computed/);
  });

  it('produces no blocker when an accepted priced land sale exists', () => {
    const result = applyCompSourcePolicy(SUBJECT, [comp({ provider: 'LandPortal visible' })]);
    expect(result.valuationBlockers).toEqual([]);
    expect(result.summaryLine).toMatch(/1 accepted sold comp/);
  });

  it('gives every decision an operator-readable reason', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'LandPortal visible' }),
      comp({ provider: 'Realie' }),
      comp({ provider: 'Zillow', compClass: 'residential' }),
      comp({ provider: 'Redfin', compClass: 'commercial' }),
    ]);
    expect(result.decisions).toHaveLength(4);
    for (const decision of result.decisions) {
      expect(decision.reason.trim().length).toBeGreaterThan(10);
    }
  });
});

// ── No stale "LandPortal returned nothing" after it answered ─────────────────
// Live finding on Deal 32: LandPortal was read successfully across BOTH surfaces
// and returned six rows, yet the Market tab still said "LandPortal empty /
// returned no usable vacant-land comparables". That is a false current-state
// claim about a source that did answer.

describe('LandPortal current-state language', () => {
  it('says LandPortal was READ when it returned rows that are simply not priceable', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'LandPortal visible', compClass: 'unknown', priceKind: null, lane: 'unknown' }),
      comp({ provider: 'LandPortal visible', compClass: 'unknown', priceKind: null, lane: 'unknown', addressDesc: '2 B Rd, Kingston, TN 37763' }),
    ]);
    expect(result.plan.landPortalUsable).toBe(false);
    expect(result.plan.landPortalRowsSeen).toBe(2);
    expect(result.plan.explanation).toMatch(/LandPortal was read and returned 2 comparable row\(s\)/);
    expect(result.plan.explanation).not.toMatch(/returned no comparable rows at all/);
  });

  it('only says LandPortal returned nothing when it genuinely returned nothing', () => {
    const result = applyCompSourcePolicy(SUBJECT, [comp({ provider: 'Zillow' })]);
    expect(result.plan.landPortalRowsSeen).toBe(0);
    expect(result.plan.explanation).toMatch(/LandPortal returned no comparable rows at all/);
  });

  it('does not tell the operator LandPortal produced nothing on an accepted supplement', () => {
    const result = applyCompSourcePolicy(SUBJECT, [
      comp({ provider: 'LandPortal visible', compClass: 'unknown', priceKind: null, lane: 'unknown' }),
      comp({ provider: 'Zillow', addressDesc: '5 Z Rd, Kingston, TN 37763' }),
    ]);
    const supplement = result.acceptedSold.find((d) => d.family === 'zillow')!;
    expect(supplement.reason).toMatch(/LandPortal returned 1 row\(s\) but none usable as a closed sale/);
    expect(supplement.reason).not.toMatch(/LandPortal produced no usable comps/);
  });
});

describe('comparable lane accountability', () => {
  it('does not claim a source returned zero merely because no lane attempt was supplied', () => {
    const result = applyCompSourcePolicy(SUBJECT, []);
    expect(result.laneAccountability.lanes.every((lane) => lane.status === 'not_run')).toBe(true);
    expect(result.laneAccountability.lanes.every((lane) => lane.candidates == null)).toBe(true);
  });

  it('uses explicit lane attempts for honest no-result, blocked, and policy-disabled outcomes', () => {
    const result = applyCompSourcePolicy(SUBJECT, [], [
      { lane: 'landportal', attempted: true, candidates: 0 },
      { lane: 'zillow', attempted: true, blockedReason: 'challenge page' },
      { lane: 'redfin', attempted: true, candidates: 0 },
      { lane: 'realtor', attempted: false, disabledReason: 'HomeHarvest policy exclusion' },
    ]);
    expect(result.laneAccountability.lanes.map((lane) => lane.status)).toEqual([
      'ran_no_results', 'blocked', 'ran_no_results', 'disabled_by_policy',
    ]);
    expect(result.laneAccountability.everyLaneAccountedFor).toBe(true);
  });
});
