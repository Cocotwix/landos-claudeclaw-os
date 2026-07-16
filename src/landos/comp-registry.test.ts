import { describe, expect, it } from 'vitest';
import { addressStateCode, buildCompRegistry, normalizeCompAddress, type CompRegistryCandidate } from './comp-registry.js';

const SUBJECT = { state: 'SC', county: 'Beaufort', zip: '29920', acres: 3.51 };

function cand(over: Partial<CompRegistryCandidate>): CompRegistryCandidate {
  return {
    provider: 'Zillow', lane: 'active', addressDesc: '1 Test Rd, Town, SC 29920',
    price: 50000, priceKind: 'list', saleOrListDate: '', acres: 1, pricePerAcre: 50000,
    ...over,
  };
}

describe('comp registry — validation', () => {
  it('rejects wrong-market candidates by address state', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ addressDesc: '3710 Rocky Tract 3 Ln, Little Rock, AR 72210', provider: 'Redfin' }),
      cand({ addressDesc: '18 Net Weavers Pl, Saint Helena Island, SC 29920' }),
    ]);
    expect(r.counts.rejected).toBe(1);
    expect(r.rejected[0].reason).toMatch(/wrong market/i);
    expect(r.rejected[0].reason).toContain('AR');
    expect(r.uniqueComps).toHaveLength(1);
  });

  it('keeps previously rejected persisted rows rejected', () => {
    const r = buildCompRegistry(SUBJECT, [cand({ persistedStatus: 'rejected' })]);
    expect(r.uniqueComps).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/previously rejected/i);
  });

  it('rejects rows with no price evidence and improved classes', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ price: null, pricePerAcre: null }),
      cand({ compClass: 'residential' }),
    ]);
    expect(r.uniqueComps).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason).join(' ')).toMatch(/no usable price/i);
    expect(r.rejected.map((x) => x.reason).join(' ')).toMatch(/vacant-land/i);
  });
});

describe('comp registry — dedup', () => {
  it('merges the same sale from multiple providers into one transaction', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ provider: 'Realie', lane: 'sold', priceKind: 'sold', addressDesc: '93 Seaside Rd, Saint Helena Island, SC 29920', price: 207500, acres: 10.3, saleOrListDate: '2026-02-10' }),
      cand({ provider: 'Zillow', lane: 'sold', priceKind: 'sold', addressDesc: '93 Seaside Road, St. Helena Island, SC 29920', price: 207500, acres: 10.3, saleOrListDate: '2026-02-10' }),
      cand({ provider: 'LandPortal visible', lane: 'landportal', priceKind: 'sold', addressDesc: '93 Seaside Rd, St Helena Island, SC', price: 207500, acres: 10.3, saleOrListDate: '2026-02-10' }),
    ]);
    expect(r.counts.uniqueProperties).toBe(1);
    expect(r.counts.validatedSold).toBe(1);
    expect(r.counts.duplicatesMerged).toBe(2);
    expect(r.uniqueComps[0].providers.sort()).toEqual(['LandPortal visible', 'Realie', 'Zillow']);
    expect(r.uniqueComps[0].sourceConfidence).toBe('high');
    expect(r.duplicateMerges).toHaveLength(1);
  });

  it('prefers APN matching over address matching', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ apn: 'R300 018 000 0090 0000', addressDesc: 'Lot A Someplace Rd, SC' }),
      cand({ apn: 'R300-018-000-0090-0000', addressDesc: 'A totally different label, SC', provider: 'Redfin' }),
    ]);
    expect(r.counts.uniqueProperties).toBe(1);
    expect(r.uniqueComps[0].matchedBy).toBe('apn');
  });

  it('keeps a prior sale and a current listing as separate transactions on one property', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ lane: 'sold', priceKind: 'sold', addressDesc: '5 Marsh Rd, Town, SC', price: 100000, saleOrListDate: '2024-05-01' }),
      cand({ lane: 'active', priceKind: 'list', addressDesc: '5 Marsh Road, Town, SC', price: 150000, saleOrListDate: '2026-06-01' }),
    ]);
    expect(r.counts.uniqueProperties).toBe(1);
    expect(r.uniqueComps[0].transactions).toHaveLength(2);
    expect(r.uniqueComps[0].primary.kind).toBe('sold');
    expect(r.counts.validatedSold).toBe(1);
    expect(r.counts.validatedActive).toBe(1);
  });

  it('does not merge different properties', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ addressDesc: '31 Mosse Rd, Saint Helena Island, SC 29920', price: 110000 }),
      cand({ addressDesc: '33 Mosse Rd, Saint Helena Island, SC 29920', price: 99000 }),
    ]);
    expect(r.counts.uniqueProperties).toBe(2);
  });
});

describe('comp registry — valuation gate', () => {
  it('is not valuation-ready with fewer than 3 validated sold comps', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ lane: 'sold', priceKind: 'sold', addressDesc: '93 Seaside Rd, Town, SC', price: 207500, acres: 10.3, saleOrListDate: '2026-02-01' }),
    ]);
    expect(r.valuationReady).toBe(false);
    expect(r.valuationBlockers[0]).toMatch(/only 1 validated unique sold comp/i);
  });

  it('is valuation-ready with 3 distinct sold comps carrying acreage', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ lane: 'sold', priceKind: 'sold', addressDesc: '1 A Rd, Town, SC', price: 100000, acres: 3, saleOrListDate: '2025-11-01' }),
      cand({ lane: 'sold', priceKind: 'sold', addressDesc: '2 B Rd, Town, SC', price: 120000, acres: 4, saleOrListDate: '2025-12-01' }),
      cand({ lane: 'sold', priceKind: 'sold', addressDesc: '3 C Rd, Town, SC', price: 90000, acres: 2.5, saleOrListDate: '2026-01-01' }),
    ]);
    expect(r.valuationReady).toBe(true);
    expect(r.valuationBlockers).toHaveLength(0);
  });

  it('active listings never make valuation ready', () => {
    const r = buildCompRegistry(SUBJECT, [
      cand({ addressDesc: '1 A Rd, Town, SC' }),
      cand({ addressDesc: '2 B Rd, Town, SC' }),
      cand({ addressDesc: '3 C Rd, Town, SC' }),
      cand({ addressDesc: '4 D Rd, Town, SC' }),
    ]);
    expect(r.counts.validatedActive).toBe(4);
    expect(r.valuationReady).toBe(false);
  });
});

describe('helpers', () => {
  it('extracts state codes from address tails', () => {
    expect(addressStateCode('1 X St, Little Rock, AR 72210')).toBe('AR');
    expect(addressStateCode('1 X St, Town, SC')).toBe('SC');
    expect(addressStateCode('no state here')).toBeNull();
  });

  it('normalizes provider address variants to one key', () => {
    expect(normalizeCompAddress('93 Seaside Rd, Saint Helena Island, SC 29920'))
      .toBe(normalizeCompAddress('93 Seaside Road, St. Helena Island, SC'));
  });
});

describe('thin-market cluster analysis + comparability', () => {
  const subject = { state: 'SC', county: 'Beaufort', locality: 'St. Helena Island', zip: '29920', acres: 3.51 };

  it('classifies comparability separately from source confidence', () => {
    const reg = buildCompRegistry(subject, [
      { provider: 'County', lane: 'sold', addressDesc: '93 Seaside Rd, Saint Helena Island, SC 29920', price: 207500, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 10.3 },
      { provider: 'Zillow', lane: 'active', addressDesc: '12 Island Ln, Saint Helena Island, SC 29920', price: 45000, priceKind: 'list', acres: 0.37 },
    ]);
    const sold = reg.validatedSold[0];
    expect(sold.comparability).toBe('large_acreage_context');
    expect(sold.comparabilityWhy).toMatch(/never blended|does not transfer/i);
    const active = reg.validatedActive[0];
    expect(active.comparability).toBe('small_lot_context');
    expect(active.acresDisplay).toBe(0.37);
  });

  it('one closed sale never becomes a supported cluster (no one-point medians)', () => {
    const reg = buildCompRegistry(subject, [
      { provider: 'County', lane: 'sold', addressDesc: '93 Seaside Rd, Saint Helena Island, SC 29920', price: 207500, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 10.3 },
    ]);
    expect(reg.clusterAnalysis.thinMarketSupported).toBe(false);
    expect(reg.clusterAnalysis.clusters[0].confidence).toBe('insufficient');
    expect(reg.valuationReady).toBe(false);
  });

  it('keeps a sub-acre cluster separate from a 10-acre sale instead of blending', () => {
    const reg = buildCompRegistry(subject, [
      { provider: 'County', lane: 'sold', addressDesc: '1 A St, Saint Helena Island, SC', price: 40000, priceKind: 'sold', saleOrListDate: '2026-01-01', acres: 0.4 },
      { provider: 'County', lane: 'sold', addressDesc: '2 B St, Saint Helena Island, SC', price: 52000, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 0.5 },
      { provider: 'County', lane: 'sold', addressDesc: '3 C St, Saint Helena Island, SC', price: 61000, priceKind: 'sold', saleOrListDate: '2026-03-01', acres: 0.6 },
      { provider: 'County', lane: 'sold', addressDesc: '93 Seaside Rd, Saint Helena Island, SC', price: 207500, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 10.3 },
    ]);
    const ca = reg.clusterAnalysis;
    expect(ca.clusters.length).toBe(2);
    const primary = ca.clusters.find((c) => c.id === ca.primaryClusterId)!;
    expect(primary.closedSales).toBe(3);
    expect(primary.acreageRange.max).toBeLessThan(1);
    // Weighted $/ac = total price / total acres, never blended with the 10.3 ac sale.
    expect(primary.weightedPricePerAcre).toBe(Math.round((40000 + 52000 + 61000) / (0.4 + 0.5 + 0.6)));
    expect(ca.thinMarketSupported).toBe(true);
    expect(ca.excludedSegments.join(' ')).toMatch(/large-acreage context/);
    // The subject (3.51 ac) sits outside the cluster — the limitation must say so.
    expect(primary.limitations.join(' ')).toMatch(/outside this cluster/i);
  });
});
