import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { listComps } from './comps.js';
import { buildCompRegistry } from './comp-registry.js';
import { reconcileCompGeography } from './comp-geography-reconciliation.js';
import { persistValidatedSoldComps, priceableNonLandPortalSoldCount } from './property-intelligence-live.js';

beforeEach(() => { _initTestLandosDb(); });

function subjectDeal(): { id: number; cardId: number } {
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: '100 QA Persistence Ln', city: 'Lake Butler', state: 'FL', zip: '32054',
    county: 'Bradford', apn: 'QA-PERSIST-1', acres: 1.5, lat: 30.02, lng: -82.34, verified: true, verificationSource: 'test', agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'QA persistence subject' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { id: deal.id, cardId: card.id };
}

const subjectMarket = { state: 'FL', county: 'Bradford', zip: '32054', acres: 1.5 };

function candidates() {
  return [
    { provider: 'Redfin', lane: 'sold', addressDesc: '9249 W Sr 100, Lake Butler, FL 32054', state: 'FL', price: 55_900, priceKind: 'sold', saleOrListDate: '2025-12-20', acres: 2.48, pricePerAcre: 22_540, sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/9249/home/1', lat: 30.05, lng: -82.30, compClass: 'vacant_land' },
    { provider: 'Redfin', lane: 'sold', addressDesc: '0 County Rd 241, Lake Butler, FL 32054', state: 'FL', price: 30_000, priceKind: 'sold', saleOrListDate: null, acres: 1.31, pricePerAcre: 22_900, sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/241/home/2', compClass: 'vacant_land' },
    // Improved: retained as evidence elsewhere, never persisted as a land sale.
    { provider: 'Redfin', lane: 'sold', addressDesc: '10 House Ln, Lake Butler, FL 32054', state: 'FL', price: 210_000, priceKind: 'sold', saleOrListDate: '2026-01-05', acres: 1.2, sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/house/home/3', compClass: 'residential' },
    // Unsourced: never persisted.
    { provider: 'Redfin', lane: 'sold', addressDesc: '11 Nowhere Rd, Lake Butler, FL 32054', state: 'FL', price: 40_000, priceKind: 'sold', saleOrListDate: '2026-01-05', acres: 1.0, sourceUrl: null, compClass: 'vacant_land' },
  ] as never[];
}

describe('shared Redfin evidence → canonical comp registry seam', () => {
  it('persists admissible sold vacant-land records once, keeps lineage, and skips improved or unsourced rows', () => {
    const deal = subjectDeal();
    const registry = buildCompRegistry(subjectMarket as never, candidates() as never);
    const admissible = registry.uniqueComps.filter((u) => u.primary.kind === 'sold' && !u.primary.qualification.missing.includes('source'));
    const first = persistValidatedSoldComps({ id: deal.id, entity: 'TY_LAND_BIZ' }, deal.cardId, admissible);
    expect(first.attempted).toBe(true);
    expect(first.written).toBe(2);
    const rows = listComps({ dealCardId: deal.id });
    expect(rows).toHaveLength(2);
    const dated = rows.find((row) => /9249/.test(row.address_desc ?? ''))!;
    expect(dated.source_label).toBe('Redfin');
    expect(dated.status).toBe('market_reference');
    expect(dated.sale_or_list_date).toBe('2025-12-20');
    expect(dated.source_url).toContain('redfin.com');
    expect(dated.lat).toBeCloseTo(30.05, 2);
    const undated = rows.find((row) => /241/.test(row.address_desc ?? ''))!;
    expect(undated.notes).toMatch(/Sale date not published/);

    // The identical provider result again writes nothing new.
    const second = persistValidatedSoldComps({ id: deal.id, entity: 'TY_LAND_BIZ' }, deal.cardId, admissible);
    expect(second.written).toBe(2);
    expect(listComps({ dealCardId: deal.id })).toHaveLength(2);
  });

  it('resolves location from retained provider coordinates as exact, and from the area as approximate', async () => {
    const deal = subjectDeal();
    const registry = buildCompRegistry(subjectMarket as never, candidates() as never);
    const admissible = registry.uniqueComps.filter((u) => u.primary.kind === 'sold' && !u.primary.qualification.missing.includes('source'));
    persistValidatedSoldComps({ id: deal.id, entity: 'TY_LAND_BIZ' }, deal.cardId, admissible);
    const stubFetch = (async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })) as unknown as typeof fetch;
    await reconcileCompGeography(deal.id, { fetchImpl: stubFetch, runAddressGeocode: false });
    const rows = listComps({ dealCardId: deal.id });
    const withCoords = rows.find((row) => /9249/.test(row.address_desc ?? ''))!;
    expect(withCoords.geo_precision).toBe('exact');
    expect(withCoords.distance_miles).not.toBeNull();
    const withoutCoords = rows.find((row) => /241/.test(row.address_desc ?? ''))!;
    expect(['approximate', 'unresolved']).toContain(withoutCoords.geo_precision);
    expect(withoutCoords.geo_precision).not.toBe('exact');
  });
});

describe('Realtor.com thinness counts only priceable, geographically relevant closed sales', () => {
  const subject = { zip: '32054', city: 'Lake Butler', state: 'FL', lat: 30.02, lng: -82.34 };
  it('counts a dated, sized, nearby closed vacant-land sale and rejects everything else', () => {
    const rows = [
      { address: '9249 W Sr 100, Lake Butler, FL 32054', status: 'sold', saleDate: '2025-12-20', acres: 2.48, lat: 30.05, lng: -82.30 },
      { address: '1 Far Rd, Jacksonville, FL 32099', status: 'sold', saleDate: '2025-12-20', acres: 2.0, lat: 30.33, lng: -81.65 }, // 40+ miles: not relevant
      { address: '2 Undated Rd, Lake Butler, FL 32054', status: 'sold', saleDate: null, acres: 2.0 },                          // undated
      { address: '3 Active Rd, Lake Butler, FL 32054', status: 'active', saleDate: '2026-01-01', acres: 2.0 },                // active
      { address: '4 House Rd, Lake Butler, FL 32054', status: 'sold', saleDate: '2026-01-01', acres: 1.0, homeSizeSqft: 1400 }, // improved
      { address: '5 Unlocatable', status: 'sold', saleDate: '2026-01-01', acres: 1.0 },                                        // no coordinates, no ZIP or city
      { address: '6 By Address, Lake Butler, FL 32054', status: 'sold', saleDate: '2026-01-01', acres: 1.0 },                  // relevant by published ZIP
    ];
    expect(priceableNonLandPortalSoldCount(rows, subject)).toBe(2);
    expect(priceableNonLandPortalSoldCount(null, subject)).toBe(0);
  });

  // The scheduling rule the count feeds: Realtor.com is asked ONLY when the
  // non-LandPortal pool is materially thin, i.e. Zillow + Redfin together
  // produced fewer than three priceable, geographically relevant closed sales.
  // LandPortal rows never count toward it, so a rich LandPortal set can never
  // make the supplemental pool look sufficient.
  const REALTOR_FALLBACK_THRESHOLD = 3;
  const priceable = (n: number) => Array.from({ length: n }, (_, i) => ({
    address: `${i + 1} Qualifying Rd, Lake Butler, FL 32054`,
    status: 'sold', saleDate: '2026-01-0' + ((i % 9) + 1), acres: 1 + i, lat: 30.02, lng: -82.34,
  }));

  it('schedules the fallback below the threshold and skips it at or above', () => {
    const zillowSold = priceable(1);
    const redfinSold = priceable(1);
    const thin = priceableNonLandPortalSoldCount(zillowSold, subject)
      + priceableNonLandPortalSoldCount(redfinSold, subject);
    expect(thin).toBe(2);
    expect(thin < REALTOR_FALLBACK_THRESHOLD).toBe(true);

    const sufficient = priceableNonLandPortalSoldCount(priceable(2), subject)
      + priceableNonLandPortalSoldCount(priceable(1), subject);
    expect(sufficient).toBe(3);
    expect(sufficient < REALTOR_FALLBACK_THRESHOLD).toBe(false);
  });

  it('does not let unpriceable or distant rows push the pool over the threshold', () => {
    const rows = [
      ...priceable(2),
      { address: '9 Undated Rd, Lake Butler, FL 32054', status: 'sold', saleDate: null, acres: 3 },
      { address: '9 Far Rd, Jacksonville, FL 32099', status: 'sold', saleDate: '2026-01-01', acres: 3, lat: 30.33, lng: -81.65 },
      { address: '9 House Rd, Lake Butler, FL 32054', status: 'sold', saleDate: '2026-01-01', acres: 3, homeSizeSqft: 1600 },
    ];
    const count = priceableNonLandPortalSoldCount(rows, subject);
    expect(count).toBe(2);
    expect(count < REALTOR_FALLBACK_THRESHOLD).toBe(true);
  });
});
