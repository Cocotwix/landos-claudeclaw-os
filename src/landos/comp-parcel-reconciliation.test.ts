// A comparable's price and the acreage it was paid over are ONE PAIR.
//
// LandPortal states two of them. The `similars` feed states an MLS listing's
// price and area; the parcel's own record states its deed price and lot size.
// Taking the price from one and the acreage from the other publishes a
// dollars-per-acre neither surface ever stated.
//
// That is what happened to APN 044 068.01 on 5170 Hwy 60. The feed handed it
// the byte-identical $200,000 / 20.55 ac / $9,732.3600973236 that belong to the
// neighbouring parcel 043 042, while the parcel's own record states a $550,000
// warranty deed over 5.05 acres recorded 2025-06-16. Across capture generations
// LandOS stored $200,000 over 5.05 ac AND $550,000 over 20.55 ac — two rows for
// one parcel, each carrying the other pairing's rate — because the registry key
// was built out of price and acreage, so a re-read at different figures looked
// like a different property.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { upsertNormalizedComp } from './comps.js';

import { applyComparableDetail } from './landportal-browser.js';
import { deedPairsByParcel } from './hermes-landportal-import.js';
import { mergeComparableRows as mergeComparableRowsForTest } from './property-card.js';
import { compParcelRegistryKey, sameCompParcel } from './comp-registry-identity.js';
import { landPortalCompDeedFacts, landPortalRecordingDateIso } from './landportal-api.js';
import type { LandPortalComparableRecord } from './property-card.js';

const lpUrl = (fips: string, apn: string, propertyId: string): string =>
  `https://landportal.com/?property=${Buffer.from(`fips=${fips}&apn=${apn}&propertyid=${propertyId}`).toString('base64')}`;

/** APN 044 068.01 exactly as LandPortal's `similars` feed states it. */
const MLS_ROW: LandPortalComparableRecord = {
  rawText: '044 068.01 | $200,000 | 20.55 ac',
  sourceUrl: lpUrl('47065', '044+068.01', '122867869'),
  apn: '044 068.01',
  price: 200_000,
  acres: 20.55,
  pricePerAcre: 9732.3600973236,
  saleDate: '2025-04-29',
  status: 'sold',
  improvement: 'unknown',
  confidence: 'medium',
};

/** The same parcel's OWN LandPortal record, as read from `single-property`. */
const DEED_RECORD = {
  apn: '044 068.01',
  situsfullstreetaddress: '6371 BEARDEN LN',
  situscity: 'BIRCHWOOD',
  situsstate: 'TN',
  situszip5: '37308',
  lotsizeacres: '5.050',
  currentsalesprice: 550_000,
  currentsalerecordingdate: 20250616,
  currentsaledocumenttype: 'Warranty Deed',
  sumbuildingsqft: '2452',
  yearbuilt: '1995',
};

describe('the deed pair and the MLS pair are never mixed', () => {
  it('adopts the parcel deed pair whole when the MLS acreage contradicts the parcel', () => {
    const merged = applyComparableDetail(MLS_ROW, { facts: landPortalCompDeedFacts(DEED_RECORD) });
    expect(merged.price).toBe(550_000);
    expect(merged.acres).toBe(5.05);
    expect(merged.saleDate).toBe('2025-06-16');
    expect(merged.pricingBasis).toBe('parcel_deed_record');
  });

  it('derives dollars per acre from the retained pair, never from the provider rate', () => {
    const merged = applyComparableDetail(MLS_ROW, { facts: landPortalCompDeedFacts(DEED_RECORD) });
    expect(merged.pricePerAcre).toBeCloseTo(550_000 / 5.05, 2);
    // The smeared $39,603.96 (=$200,000/5.05) and $26,764 (=$550,000/20.55)
    // rates both belonged to a pairing no single surface ever stated.
    expect(merged.pricePerAcre).not.toBeCloseTo(9732.36, 2);
    expect(merged.pricePerAcre).not.toBeCloseTo(26_764, 0);
  });

  it('never takes the price from one surface and the acreage from the other', () => {
    const merged = applyComparableDetail(MLS_ROW, { facts: landPortalCompDeedFacts(DEED_RECORD) });
    const fromDeed = merged.price === 550_000 && merged.acres === 5.05;
    const fromMls = merged.price === 200_000 && merged.acres === 20.55;
    expect(fromDeed || fromMls).toBe(true);
  });

  it('leaves an uncontradicted MLS pair exactly as it was', () => {
    // 043 042: the feed and the parcel agree on area, so the listing pair is
    // describing this parcel and nothing is substituted.
    const agreeing = { ...DEED_RECORD, apn: '043 042', lotsizeacres: '20.550', currentsalesprice: 210_000 };
    const merged = applyComparableDetail(
      { ...MLS_ROW, apn: '043 042' },
      { facts: landPortalCompDeedFacts(agreeing) },
    );
    expect(merged.price).toBe(200_000);
    expect(merged.acres).toBe(20.55);
    expect(merged.pricingBasis).not.toBe('parcel_deed_record');
  });

  it('changes nothing when the parcel record states only half a pair', () => {
    const priceOnly = { apn: '044 068.01', currentsalesprice: 550_000 };
    const merged = applyComparableDetail(MLS_ROW, { facts: landPortalCompDeedFacts(priceOnly) });
    expect(merged.price).toBe(200_000);
    expect(merged.acres).toBe(20.55);
  });

  it('reads a LandPortal YYYYMMDD recording date, and rejects a malformed one', () => {
    expect(landPortalRecordingDateIso(20250616)).toBe('2025-06-16');
    expect(landPortalRecordingDateIso('20251344')).toBe('');
    expect(landPortalRecordingDateIso(null)).toBe('');
  });
});

describe('a settled deed pair survives the Hermes import that follows it', () => {
  // The import rewrites the retained comparables from its own handback, which
  // reports the `similars` feed. Without a carry-forward it reinstates exactly
  // the listing pair the capture just replaced, and the live registry row went
  // straight back to $200,000 over 20.55 ac.
  const settled = applyComparableDetail(MLS_ROW, { facts: landPortalCompDeedFacts(DEED_RECORD) });

  it('indexes a settled comparable by its parcel identity', () => {
    const pairs = deedPairsByParcel([{ ...settled, county: 'Hamilton', state: 'TN' }], 'Hamilton');
    const key = compParcelRegistryKey({ apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: MLS_ROW.sourceUrl });
    expect(key).not.toBeNull();
    expect(pairs.get(key!)).toMatchObject({ price: 550_000, acres: 5.05, saleDate: '2025-06-16' });
  });

  it('never carries half a pair forward', () => {
    const halfPair = { ...settled, acres: null };
    expect(deedPairsByParcel([{ ...halfPair, county: 'Hamilton', state: 'TN' }], 'Hamilton').size).toBe(0);
  });

  it('ignores a comparable the capture never settled on a deed', () => {
    const unsettled = { ...settled, pricingBasis: null };
    expect(deedPairsByParcel([{ ...unsettled, county: 'Hamilton', state: 'TN' }], 'Hamilton').size).toBe(0);
  });

  it('keeps the settled tuple when a later unsettled row for the same parcel merges over it', () => {
    // The retained-inspection merge is last-writer-wins, and the import writes
    // after the capture. Without this the settled tuple lived exactly one lane.
    const laterFeedRow = { ...MLS_ROW, address: '6371 BEARDEN LN', pricingBasis: null };
    const kept = mergeComparableRowsForTest([
      { ...settled, address: '6371 BEARDEN LN' },
      laterFeedRow,
    ]).find((r) => String(r.apn).includes('044 068.01'));
    expect(kept).toMatchObject({ price: 550_000, acres: 5.05, pricingBasis: 'parcel_deed_record' });
  });

  it('still lets a newer settled row replace an older settled row', () => {
    const corrected = { ...settled, address: '6371 BEARDEN LN', price: 560_000 };
    const kept = mergeComparableRowsForTest([
      { ...settled, address: '6371 BEARDEN LN' },
      corrected,
    ]).find((r) => String(r.apn).includes('044 068.01'));
    expect(kept?.price).toBe(560_000);
  });
});

describe('a deed-settled registry row is not rewritten by a listing pair', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('holds the priced pair and its date, while everything else still merges', () => {
    const entity = 'TY_LAND_BIZ' as const;
    const dealCardId = createDealCard({ entity, title: 'Deed pair hold' }).id;
    const settledRow = upsertNormalizedComp({
      entity, dealCardId, sourceLabel: 'LandPortal', apn: '044 068.01', county: 'Hamilton', state: 'TN',
      addressDesc: '6371 BEARDEN LN', price: 550_000, acres: 5.05, pricePerAcre: 550_000 / 5.05,
      saleOrListDate: '2025-06-16', priceKind: 'sale', pricingBasis: 'parcel_deed_record',
      canonicalKey: 'landportal-parcel|property:122867869',
    });
    expect(settledRow.pricing_basis).toBe('parcel_deed_record');

    // The feed pair comes back on the next import, carrying a new thumbnail.
    const after = upsertNormalizedComp({
      entity, dealCardId, sourceLabel: 'LandPortal', apn: '044 068.01', county: 'Hamilton', state: 'TN',
      addressDesc: '6371 BEARDEN LN', price: 200_000, acres: 20.55, pricePerAcre: 9732.36,
      saleOrListDate: '2025-04-29', priceKind: 'sale', thumbnailUrl: 'https://images.thelandportal.com/x.jpg',
      canonicalKey: 'landportal-parcel|property:122867869',
    });
    expect(after.id).toBe(settledRow.id);
    expect(after.price).toBe(550_000);
    expect(after.acres).toBe(5.05);
    expect(after.sale_or_list_date).toBe('2025-06-16');
    expect(Math.round(after.price_per_acre!)).toBe(108_911);
    // Non-priced fields are untouched by the hold.
    expect(after.thumbnail_url).toBe('https://images.thelandportal.com/x.jpg');
  });
});

describe('the comp registry reconciles on parcel identity, not on figures', () => {
  it('gives one parcel one key however far its figures drift', () => {
    const asStored = { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: MLS_ROW.sourceUrl };
    const asReread = { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: MLS_ROW.sourceUrl };
    expect(compParcelRegistryKey(asStored)).toBe(compParcelRegistryKey(asReread));
    expect(compParcelRegistryKey(asStored)).toContain('122867869');
  });

  it('treats the two forked 044 068.01 rows as the same parcel', () => {
    // $200,000/5.05 ac and $550,000/20.55 ac — the live pair of rows.
    expect(sameCompParcel(
      { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: MLS_ROW.sourceUrl },
      { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: MLS_ROW.sourceUrl },
    )).toBe(true);
  });

  it('keeps neighbouring parcels apart even when their figures are identical', () => {
    // 043 042 carries the SAME $200,000 / 20.55 ac the feed smeared onto
    // 044 068.01. Value equality must never merge them.
    expect(sameCompParcel(
      { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: lpUrl('47065', '044+068.01', '122867869') },
      { apn: '043 042', county: 'Hamilton', state: 'TN', sourceUrl: lpUrl('47065', '043+042', '122867146') },
    )).toBe(false);
  });

  it('refuses to MINT a key for an APN with no stated jurisdiction', () => {
    // A key needs a namespace. Such a row keeps its legacy key rather than
    // being filed under an APN that is only unique inside a county.
    expect(compParcelRegistryKey({ apn: '044 068.01' })).toBeNull();
  });

  it('still reconciles an equivalent APN when one side states no jurisdiction', () => {
    // A stored row that never recorded a county must still reconcile, or the
    // rows most likely to fork are exactly the ones that never merge.
    expect(sameCompParcel(
      { apn: '044 068.01', county: 'Hamilton', state: 'TN' },
      { apn: '044 068.01' },
    )).toBe(true);
  });

  it('blocks the match when two stated jurisdictions disagree', () => {
    expect(sameCompParcel(
      { apn: '044 068.01', county: 'Hamilton', state: 'TN' },
      { apn: '044 068.01', county: 'Bradley', state: 'TN' },
    )).toBe(false);
  });

  it('matches nothing when neither an APN nor a property id is stated', () => {
    expect(sameCompParcel({ address: '6371 BEARDEN LN' } as never, { address: '6371 BEARDEN LN' } as never)).toBe(false);
  });

  it('never merges two parcels on a shared address', () => {
    expect(sameCompParcel(
      { apn: '044 068.01', county: 'Hamilton', state: 'TN', sourceUrl: null },
      { apn: '044 069.00', county: 'Hamilton', state: 'TN', sourceUrl: null },
    )).toBe(false);
  });
});
