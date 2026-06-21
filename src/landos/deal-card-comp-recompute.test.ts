import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { addComp, listComps } from './comps.js';
import {
  summarizeComps,
  recomputeOfferFromComps,
  deleteCompAndRecompute,
} from './deal-card-comp-recompute.js';

beforeEach(() => {
  _initTestLandosDb();
});

function deal() {
  return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Recompute deal' }).id;
}

function addSale(dealId: number, price: number, acres: number) {
  return addComp({
    entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'Redfin',
    sourceUrl: 'https://www.redfin.com/x', price, priceKind: 'sale',
    saleOrListDate: '2026-03-01', acres,
  });
}

describe('summarizeComps', () => {
  it('derives EV from median $/acre x subject acres using only sold comps', () => {
    const dealId = deal();
    addSale(dealId, 50_000, 5); // ppa 10,000
    addSale(dealId, 60_000, 5); // ppa 12,000
    addSale(dealId, 40_000, 5); // ppa 8,000
    const comps = listComps({ dealCardId: dealId });
    const s = summarizeComps(comps, 5);
    expect(s.soldCount).toBe(3);
    expect(s.medianPricePerAcreUsd).toBe(10_000);
    expect(s.impliedEvUsd).toBe(50_000); // 10,000 * 5
  });

  it('falls back to median sold price when acreage is unknown', () => {
    const dealId = deal();
    addSale(dealId, 50_000, 5);
    addSale(dealId, 70_000, 5);
    const comps = listComps({ dealCardId: dealId });
    const s = summarizeComps(comps, null);
    expect(s.impliedEvUsd).toBe(60_000); // median sold price
  });

  it('no usable sold comps -> EV null (never invented)', () => {
    const s = summarizeComps([], 5);
    expect(s.soldCount).toBe(0);
    expect(s.impliedEvUsd).toBeNull();
  });
});

describe('recomputeOfferFromComps', () => {
  it('computes offer lanes when EV is derivable', () => {
    const dealId = deal();
    addSale(dealId, 100_000, 5);
    addSale(dealId, 120_000, 5);
    const comps = listComps({ dealCardId: dealId });
    const r = recomputeOfferFromComps(comps, { subjectAcres: 5 });
    expect(r.offer.computed).toBe(true);
    expect(r.offer.lanes.length).toBeGreaterThan(0);
    expect(r.survivorCount).toBe(2);
  });

  it('fails loud (computed:false) when no EV can be derived', () => {
    const r = recomputeOfferFromComps([], { subjectAcres: 5 });
    expect(r.offer.computed).toBe(false);
    expect(r.offer.lanes).toEqual([]);
  });
});

describe('deleteCompAndRecompute', () => {
  it('removes one comp and recomputes off survivors (no backfill, no re-search)', () => {
    const dealId = deal();
    const a = addSale(dealId, 50_000, 5);
    addSale(dealId, 60_000, 5);
    addSale(dealId, 40_000, 5);

    const res = deleteCompAndRecompute(dealId, a.id, { subjectAcres: 5, reason: 'bad comp' });
    expect(res.deleted).toBe(true);
    expect(res.survivorCount).toBe(2);
    // Survivors are exactly the two not deleted; the deleted comp is gone.
    expect(listComps({ dealCardId: dealId }).some((c) => c.id === a.id)).toBe(false);
    // Recompute reflects survivors only (median ppa of 60k & 40k @5ac = 10k -> EV 50k).
    expect(res.summary.soldCount).toBe(2);
    expect(res.offer.computed).toBe(true);
  });

  it('deleting a non-existent comp reports deleted:false but still recomputes', () => {
    const dealId = deal();
    addSale(dealId, 50_000, 5);
    const res = deleteCompAndRecompute(dealId, 999_999, { subjectAcres: 5 });
    expect(res.deleted).toBe(false);
    expect(res.survivorCount).toBe(1);
  });
});
