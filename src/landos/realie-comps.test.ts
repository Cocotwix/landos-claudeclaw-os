import { describe, it, expect } from 'vitest';
import { fetchRealieComps } from './realie-comps.js';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const KEY = { REALIE_API_KEY: 'k' };

describe('Realie premium comparables', () => {
  it('splits sold (with sale price+date) vs valuation-only rows; computes PPA', async () => {
    const body = { comparables: [
      { parcelId: 'A', addressFull: '1 A St', acres: 8, transferPrice: 48000, purchaseSaleDate: '20250101', totalMarketValue: 50000, latitude: 31, longitude: -83 },
      { parcelId: 'B', addressFull: '2 B St', acres: 10, transferPrice: 0, totalMarketValue: 90000 }, // valuation-only
    ], metadata: { count: 2 } };
    const r = await fetchRealieComps(31.5, -83.7, { env: KEY, now: () => 't', fetchImpl: async () => ok(body) });
    expect(r.status).toBe('collected');
    expect(r.sold).toHaveLength(1);
    expect(r.sold[0].soldPrice).toBe(48000);
    expect(r.sold[0].pricePerAcre).toBe(6000);
    expect(r.sold[0].soldDateIso).toBe('2025-01-01');
    expect(r.valuation).toHaveLength(1);
    expect(r.valuation[0].marketValue).toBe(90000);
  });
  it('VACANT subject: excludes improved (house) sales so they do not inflate land PPA', async () => {
    const body = { comparables: [
      { parcelId: 'L1', addressFull: 'vacant 1', acres: 5, transferPrice: 50000, purchaseSaleDate: '20250101' }, // vacant land, $10k/ac
      { parcelId: 'L2', addressFull: 'vacant 2', acres: 4, transferPrice: 48000, purchaseSaleDate: '20250201' }, // vacant land, $12k/ac
      { parcelId: 'H1', addressFull: 'house 1', acres: 6, transferPrice: 900000, purchaseSaleDate: '20250301', yearBuilt: 2008 }, // IMPROVED — $150k/ac, must be excluded
    ], metadata: { count: 3 } };
    const r = await fetchRealieComps(33.7, -84.1, { env: KEY, now: () => 't', subjectAcres: 5, subjectImproved: false, nowMs: Date.parse('2025-06-01'), fetchImpl: async () => ok(body) });
    expect(r.status).toBe('collected');
    expect(r.sold.map((c) => c.parcelId).sort()).toEqual(['L1', 'L2']); // houses excluded
    expect(r.excluded.some((e) => e.comp.parcelId === 'H1' && /improved|vacant-land/i.test(e.reason))).toBe(true);
    expect(r.validationNote).toMatch(/VACANT/i);
    // the inflated $150k/ac house is not in the band
    expect(Math.max(...r.sold.map((c) => c.pricePerAcre ?? 0))).toBeLessThan(20000);
  });
  it('VACANT subject: trims extreme high PPA outliers even without yearBuilt (comp safety)', async () => {
    const d = '20250301';
    const body = { comparables: [
      { parcelId: 'V1', addressFull: 'v1', acres: 5, transferPrice: 50000, purchaseSaleDate: d },  // 10k/ac
      { parcelId: 'V2', addressFull: 'v2', acres: 5, transferPrice: 55000, purchaseSaleDate: d },  // 11k/ac
      { parcelId: 'V3', addressFull: 'v3', acres: 4, transferPrice: 48000, purchaseSaleDate: d },  // 12k/ac
      { parcelId: 'V4', addressFull: 'v4', acres: 6, transferPrice: 54000, purchaseSaleDate: d },  // 9k/ac
      { parcelId: 'OUT', addressFull: 'house no yearBuilt', acres: 5, transferPrice: 900000, purchaseSaleDate: d }, // 180k/ac, NO yearBuilt
    ], metadata: { count: 5 } };
    const r = await fetchRealieComps(33.7, -84.1, { env: KEY, now: () => 't', subjectAcres: 5, subjectImproved: false, nowMs: Date.parse('2025-06-01'), fetchImpl: async () => ok(body) });
    expect(r.sold.map((c) => c.parcelId)).not.toContain('OUT'); // outlier trimmed despite no yearBuilt
    expect(r.excluded.some((e) => e.comp.parcelId === 'OUT' && /outlier/i.test(e.reason))).toBe(true);
    expect(Math.max(...r.sold.map((c) => c.pricePerAcre ?? 0))).toBeLessThan(20000);
  });
  it('IMPROVED subject: retains improved comps', async () => {
    const body = { comparables: [
      { parcelId: 'H1', addressFull: 'house 1', acres: 5, transferPrice: 250000, purchaseSaleDate: '20250301', yearBuilt: 2008 },
    ], metadata: { count: 1 } };
    const r = await fetchRealieComps(33.7, -84.1, { env: KEY, now: () => 't', subjectAcres: 5, subjectImproved: true, nowMs: Date.parse('2025-06-01'), fetchImpl: async () => ok(body) });
    expect(r.sold).toHaveLength(1);
    expect(r.sold[0].parcelId).toBe('H1');
  });
  it('premium not authorized => not_authorized (no fabrication)', async () => {
    const r = await fetchRealieComps(31.5, -83.7, { env: KEY, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
    expect(r.status).toBe('not_authorized');
    expect(r.sold).toHaveLength(0);
  });
  it('no rows => no_comps', async () => {
    const r = await fetchRealieComps(31.5, -83.7, { env: KEY, fetchImpl: async () => ok({ comparables: [], metadata: { count: 0 } }) });
    expect(r.status).toBe('no_comps');
  });
  it('no coordinates => no_comps (comps need a point)', async () => {
    expect((await fetchRealieComps(null, null, { env: KEY })).status).toBe('no_comps');
  });

  it('filters out nominal sales, off-acreage lots, and stale sales (sane PPA band)', async () => {
    const nowMs = Date.parse('2026-06-01');
    const body = { comparables: [
      { parcelId: 'good', addressFull: 'g', acres: 8, transferPrice: 48000, purchaseSaleDate: '20250101' },   // keep (6000/ac)
      { parcelId: 'tinyUrban', addressFull: 't', acres: 0.05, transferPrice: 200000, purchaseSaleDate: '20250101' }, // drop: off-acreage (subject 8ac)
      { parcelId: 'nominal', addressFull: 'n', acres: 9, transferPrice: 1, purchaseSaleDate: '20250101' },     // drop: nominal sale
      { parcelId: 'stale', addressFull: 's', acres: 7, transferPrice: 40000, purchaseSaleDate: '20100101' },   // drop: too old
    ], metadata: { count: 4 } };
    const r = await fetchRealieComps(31.5, -83.7, { env: KEY, subjectAcres: 8, recencyMonths: 60, nowMs, fetchImpl: async () => ok(body) });
    expect(r.status).toBe('collected');
    expect(r.sold).toHaveLength(1);
    expect(r.sold[0].parcelId).toBe('good');
    expect(r.sold[0].pricePerAcre).toBe(6000);
  });
});
