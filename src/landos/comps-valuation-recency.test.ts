// Comps & Valuation: the acreage band and sale-recency window govern every
// downstream number.
//
// Contract: the window selects the valuation set; the cleaned average, cleaned
// median, weighted indication, adopted FMV, 40/50/60 levels, technical maximum,
// and final negotiation range are all recalculated FROM that set. A sale outside
// the band or older than the selected window is visible with zero weight and can
// never move any of those figures.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { addComp } from './comps.js';
import { buildCompsValuationView, setCompValuationSelection } from './comps-valuation.js';

const NOW = Date.parse('2026-08-06T12:00:00Z');
const SUBJECT_POINT = { lat: 43.33, lng: -76.65 };

function seedSubject(): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '1487 Onionville Rd' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '1487 Onionville Rd',
    county: 'Cayuga',
    state: 'NY',
    apn: '055689 10.00-1-64.22',
    acres: 11.46,
    verified: true,
    verificationSource: 'test',
    agentId: 'test',
    ...SUBJECT_POINT,
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

let seq = 0;
function seedSale(
  ids: { dealCardId: number; cardId: number },
  opts: { date: string; acres: number; price: number; lat?: number; lng?: number; address?: string },
) {
  seq += 1;
  const tag = String(seq).padStart(4, '0');
  return addComp({
    entity: 'TY_LAND_BIZ',
    dealCardId: ids.dealCardId,
    cardId: ids.cardId,
    sourceLabel: 'Zillow',
    sourceUrl: `https://zillow.com/comp/${tag}`,
    addressDesc: opts.address ?? `Sale ${tag} Rd, Sterling, NY 13156`,
    apn: `9999000011${tag}`,
    county: 'Cayuga',
    state: 'NY',
    price: opts.price,
    priceKind: 'sale',
    saleOrListDate: opts.date,
    acres: opts.acres,
    notes: 'seeded closed vacant-land sale',
    addedBy: 'test',
    propertyClass: 'land',
    // ~2 miles north of the subject unless the caller places it elsewhere.
    lat: opts.lat ?? 43.36,
    lng: opts.lng ?? -76.65,
  } as Parameters<typeof addComp>[0]);
}

/** Five credible, in-band, in-window sales — enough to hold the 12-month window.
 *  Per-acre prices differ (4,800–5,250 /ac) so excluding one genuinely moves the
 *  arithmetic; a flat set would let a broken recalculation pass unnoticed. */
function seedRecentFive(ids: { dealCardId: number; cardId: number }) {
  seedSale(ids, { date: '2026-07-01', acres: 11, price: 53900 });    // 4,900 /ac
  seedSale(ids, { date: '2026-05-01', acres: 10, price: 52000 });    // 5,200 /ac
  seedSale(ids, { date: '2026-02-01', acres: 12, price: 57600 });    // 4,800 /ac
  seedSale(ids, { date: '2025-12-01', acres: 11.5, price: 60375 });  // 5,250 /ac
  seedSale(ids, { date: '2025-10-01', acres: 9, price: 43650 });     // 4,850 /ac
}

beforeEach(() => {
  _initTestLandosDb();
  seq = 0;
});

describe('the selected window governs the valuation set', () => {
  it('uses only the 12-month set when five credible sales support it', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    // Older, in-band, perfectly credible sales at a very different price level.
    seedSale(ids, { date: '2024-06-01', acres: 11, price: 165000 });
    seedSale(ids, { date: '2023-06-01', acres: 11, price: 11000 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.valuationWindow.selectedMonths).toBe(12);
    expect(view.valuationWindow.credibleWithin12).toBe(5);
    expect(view.valuationWindow.valuationSetCount).toBe(5);
    expect(view.cleaned.cleanedCount).toBe(5);
    expect(view.cleaned.historicalContextCount).toBe(2);

    // The two old sales bracket the recent set on both sides. If either had any
    // weight the cleaned average would leave the recent per-acre band.
    expect(view.cleaned.cleanedAvgPpa!).toBeGreaterThan(4500);
    expect(view.cleaned.cleanedAvgPpa!).toBeLessThan(5500);
    const historical = view.comps.filter((c) => c.valuationRole === 'historical_context');
    expect(historical).toHaveLength(2);
    for (const c of historical) {
      expect(c.inValuationSet).toBe(false);
      expect(c.valuationWeight).toBeNull();
      expect(c.zeroWeightReason).toContain('zero valuation weight');
    }
  });

  it('expands to 24 months and keeps the recent sales weighted more heavily', () => {
    const ids = seedSubject();
    seedSale(ids, { date: '2026-06-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2026-01-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2025-03-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2024-11-01', acres: 11, price: 55000 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.valuationWindow.selectedMonths).toBe(24);
    expect(view.valuationWindow.addedFrom13To24).toBe(2);
    expect(view.valuationWindow.addedFrom25To30).toBe(0);
    expect(view.cleaned.cleanedCount).toBe(4);

    const weightOf = (addr: string) => view.comps.find((c) => c.address?.startsWith(addr))!.valuationWeight!;
    // Identical parcels at identical prices and distances: only recency differs,
    // so the 0-to-12-month sales must carry the greater weight.
    expect(weightOf('Sale 0001')).toBeGreaterThan(weightOf('Sale 0003'));
    expect(weightOf('Sale 0002')).toBeGreaterThan(weightOf('Sale 0004'));
  });

  it('admits months 25-30 only under the exceptional expansion, at reduced weight', () => {
    const ids = seedSubject();
    seedSale(ids, { date: '2026-06-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2025-03-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2024-04-01', acres: 11, price: 55000 }); // ~28 months

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.valuationWindow.selectedMonths).toBe(30);
    expect(view.valuationWindow.addedFrom25To30).toBe(1);
    expect(view.cleaned.supplementalHistoricalCount).toBe(1);

    const supplemental = view.comps.find((c) => c.valuationRole === 'supplemental_historical')!;
    const recent = view.comps.find((c) => c.address?.startsWith('Sale 0001'))!;
    expect(supplemental.inValuationSet).toBe(true);
    // Substantially reduced, not merely slightly lower.
    expect(supplemental.valuationWeight!).toBeLessThan(recent.valuationWeight! * 0.5);
  });

  it('withdraws the supplemental record as soon as a third 24-month sale exists', () => {
    const ids = seedSubject();
    seedSale(ids, { date: '2026-06-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2025-03-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2024-04-01', acres: 11, price: 55000 });
    expect(buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!.valuationWindow.selectedMonths).toBe(30);

    seedSale(ids, { date: '2025-01-01', acres: 11, price: 55000 });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.valuationWindow.selectedMonths).toBe(24);
    expect(view.cleaned.supplementalHistoricalCount).toBe(0);
    expect(view.comps.find((c) => c.address?.startsWith('Sale 0003'))!.valuationRole).toBe('historical_context');
  });
});

describe('the acreage band gates the cleaned FMV', () => {
  it('keeps an out-of-band sale visible as a boundary record with zero weight', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    seedSale(ids, { date: '2026-07-15', acres: 38, price: 380000, address: 'Big Tract Rd' });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const big = view.comps.find((c) => c.address?.startsWith('Big Tract'))!;
    expect(big.category).toBe('accepted_closed_sale'); // still credible evidence
    expect(big.valuationRole).toBe('boundary');
    expect(big.inValuationSet).toBe(false);
    expect(big.valuationWeight).toBeNull();
    expect(big.zeroWeightReason).toContain('5.73–22.92 acres');
    expect(view.cleaned.cleanedCount).toBe(5);
    expect(view.valuationWindow.outOfAcreageBand).toBe(1);
  });

  it('weights a sale near the subject acreage above one at the band edge', () => {
    const ids = seedSubject();
    seedSale(ids, { date: '2026-07-01', acres: 11.46, price: 57300, address: 'Exact Rd' });
    seedSale(ids, { date: '2026-07-01', acres: 5.73, price: 28650, address: 'Edge Rd' });
    seedSale(ids, { date: '2026-07-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2026-06-01', acres: 11, price: 55000 });
    seedSale(ids, { date: '2026-05-01', acres: 11, price: 55000 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const exact = view.comps.find((c) => c.address?.startsWith('Exact Rd'))!;
    const edge = view.comps.find((c) => c.address?.startsWith('Edge Rd'))!;
    expect(exact.valuationWeight!).toBeGreaterThan(edge.valuationWeight!);
  });
});

describe('every downstream figure recalculates from the selected set', () => {
  it('derives FMV, the 40/50/60 levels, the technical maximum, and the range from the window', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    const wide = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;

    // Adding an old, in-band, extremely expensive sale must move NOTHING.
    seedSale(ids, { date: '2023-01-01', acres: 11, price: 550000 });
    const after = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;

    expect(after.cleaned.adoptedFmv).toBe(wide.cleaned.adoptedFmv);
    expect(after.cleaned.cleanedAvgPpa).toBe(wide.cleaned.cleanedAvgPpa);
    expect(after.cleaned.cleanedMedianPpa).toBe(wide.cleaned.cleanedMedianPpa);
    expect(after.cleaned.weightedPpa).toBe(wide.cleaned.weightedPpa);
    expect(after.summary.acquisitionLevels).toEqual(wide.summary.acquisitionLevels);
    expect(after.quickFlip!.technicalMaxOffer).toBe(wide.quickFlip!.technicalMaxOffer);
    expect(after.negotiation!.hardCeiling).toBe(wide.negotiation!.hardCeiling);
    expect(after.negotiation!.recommendedOpening).toBe(wide.negotiation!.recommendedOpening);
    expect(after.negotiation!.recommendedTarget).toBe(wide.negotiation!.recommendedTarget);
  });

  it('recalculates the whole chain when the operator excludes a sale in the window', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    const before = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const target = before.comps.find((c) => c.address?.startsWith('Sale 0003'))!;

    const result = setCompValuationSelection({
      dealCardId: ids.dealCardId, compId: target.compId!, action: 'exclude', reason: 'verified waterfront premium',
    });
    expect(result.ok).toBe(true);

    const after = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(after.cleaned.cleanedCount).toBe(4);
    expect(after.cleaned.excludedCount).toBe(1);
    expect(after.cleaned.adoptedFmv).not.toBe(before.cleaned.adoptedFmv);
    // Every downstream figure is DERIVED from the recalculated FMV, so the
    // ladder and the ceiling follow it rather than holding a stale value.
    const round500 = (n: number) => Math.round(n / 500) * 500;
    expect(after.summary.fmv!.central).toBe(after.cleaned.adoptedFmv);
    expect(after.summary.acquisitionLevels!.pct40).toBe(round500(after.cleaned.adoptedFmv! * 0.4));
    expect(after.summary.acquisitionLevels!.pct50).toBe(round500(after.cleaned.adoptedFmv! * 0.5));
    expect(after.quickFlip!.expectedSalePrice).toBe(after.cleaned.adoptedFmv);
    expect(after.quickFlip!.technicalMaxOffer).not.toBe(before.quickFlip!.technicalMaxOffer);

    // An excluded record is NOT also tallied as a boundary comp.
    const excluded = after.comps.find((c) => c.compId === target.compId)!;
    expect(excluded.operatorExcluded).toBe(true);
    expect(excluded.valuationRole).toBeNull();
    expect(after.cleaned.boundaryCount).toBe(0);

    // Restoring returns every figure to where it started.
    setCompValuationSelection({ dealCardId: ids.dealCardId, compId: target.compId!, action: 'restore' });
    const restored = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(restored.cleaned.adoptedFmv).toBe(before.cleaned.adoptedFmv);
    expect(restored.cleaned.cleanedCount).toBe(5);
    expect(restored.summary.acquisitionLevels).toEqual(before.summary.acquisitionLevels);
  });

  it('states one confidence for the adopted value across every surface', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.summary.confidence).toBe(view.cleaned.confidence);
    // The full-set spread stays visible rather than hidden behind the rating.
    expect(view.summary.confidenceFactors.join(' ')).toContain('sold price per acre spans');
  });

  it('reconciles the retained, mapped, and valuation counts without double-labeling', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    seedSale(ids, { date: '2023-01-01', acres: 11, price: 40000 });
    seedSale(ids, { date: '2026-07-15', acres: 38, price: 380000 });

    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    const roles = view.comps.filter((c) => c.category === 'accepted_closed_sale');
    // Each closed sale carries exactly one role, and the role tallies add up.
    expect(roles.every((c) => c.valuationRole != null)).toBe(true);
    const inSet = roles.filter((c) => c.inValuationSet).length;
    expect(inSet).toBe(view.cleaned.cleanedCount);
    expect(view.cleaned.directCount + view.cleaned.supportingCount + view.cleaned.supplementalHistoricalCount).toBe(inSet);
    expect(view.mapCounts.retained).toBe(view.counts.total);
    expect(view.mapCounts.mapped + view.mapCounts.unresolved).toBe(view.mapCounts.retained);
  });
});

describe('every comparable carries a visual with stated provenance', () => {
  it('gives a located record without a provider image a labeled map fallback', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    for (const c of view.comps) {
      expect(c.visual).toBeTruthy();
      expect(c.visual.provenance).toBe('map_fallback');
      expect(c.visual.label).toBe('Road map fallback');
      expect(c.visual.detail).toContain('not a photograph');
    }
    expect(view.visualCounts.mapFallback).toBe(5);
    expect(view.visualCounts.withoutVisual).toBe(0);
  });

  it('prefers a retained provider photograph over the fallback', () => {
    const ids = seedSubject();
    seedRecentFive(ids);
    seedSale(ids, { date: '2026-04-01', acres: 11, price: 55000, address: 'Photo Rd' });
    const view = buildCompsValuationView(ids.dealCardId, { nowMs: NOW })!;
    expect(view.visualCounts.total).toBe(view.counts.total);
    expect(view.visualCounts.listingPhoto + view.visualCounts.providerThumbnail
      + view.visualCounts.parcelAerial + view.visualCounts.satelliteFallback
      + view.visualCounts.mapFallback + view.visualCounts.locationUnresolved).toBe(view.counts.total);
  });
});
