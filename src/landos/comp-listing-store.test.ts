// Persisting a provider capture, and the gate that keeps a wrong image out.
//
// An image without the reconciliation that justified it is exactly the
// "looks like evidence" failure this lane exists to prevent. So the store is
// atomic: an unreconciled capture may record its own refusal, but it may never
// write the image, the events or the description it captured — and it must never
// overwrite a thumbnail the comparable already legitimately had.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { addComp, listComps } from './comps.js';
import { saveCompListingDetail, loadCompListingDetail, parseListingDetail } from './comp-listing-store.js';
import type { PersistedListingDetail } from './comp-listing-detail.js';

let compId: number;

beforeEach(() => {
  _initTestLandosDb();
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Comp listing store' });
  addComp({
    entity: 'TY_LAND_BIZ',
    dealCardId: deal.id,
    sourceLabel: 'Zillow',
    sourceUrl: 'https://www.zillow.com/homedetails/0-McGibbon-Rd-Martville-NY-13111/450537090_zpid/',
    addressDesc: '0 McGibbon Rd, Martville, NY 13111',
    price: 54000,
    priceKind: 'sale',
    acres: 8.2,
    saleOrListDate: '2025-07-24',
  });
  compId = listComps({ dealCardId: deal.id })[0].id;
});

const detail = (over: Partial<PersistedListingDetail> = {}): PersistedListingDetail => ({
  compId,
  provider: 'Zillow',
  sourceUrl: 'https://www.zillow.com/homedetails/0-McGibbon-Rd-Martville-NY-13111/450537090_zpid/',
  capturedAtIso: '2026-08-06T12:00:00.000Z',
  image: {
    url: 'https://photos.zillowstatic.com/fp/genuine_d.jpg',
    label: 'Zillow listing photo',
    provenance: 'listing_photo',
    tier: 'hero',
    context: 'hero',
    isOriginalListingImage: true,
    sourceProperty: '0 McGibbon Rd, Martville, NY 13111',
    reconciledOn: ['retained source page URL', 'address', 'acreage'],
  },
  events: [{ dateIso: '2025-03-01', kind: 'listed', price: 59900, label: 'Listed for sale', source: 'Zillow listing history' }],
  unusableRows: [],
  refusedImages: [],
  sourceDescription: 'Wooded parcel with road frontage.',
  status: 'Sold',
  limitation: null,
  reconciliation: {
    matched: true,
    matchedOn: ['retained source page URL', 'address', 'acreage'],
    mismatches: [],
    note: 'Page reconciled to the comparable on retained source page URL, address, acreage.',
  },
  ...over,
});

const thumbnailOf = (id: number) =>
  (getLandosDb().prepare('SELECT thumbnail_url FROM landos_comp WHERE id = ?').get(id) as { thumbnail_url: string }).thumbnail_url;

describe('a reconciled capture is persisted whole', () => {
  it('writes the detail and promotes the image onto the durable thumbnail column', () => {
    const r = saveCompListingDetail(detail());
    expect(r.persisted).toBe(true);
    expect(r.thumbnailUpdated).toBe(true);
    expect(thumbnailOf(compId)).toBe('https://photos.zillowstatic.com/fp/genuine_d.jpg');

    const back = loadCompListingDetail(compId);
    expect(back?.image?.label).toBe('Zillow listing photo');
    expect(back?.events).toHaveLength(1);
    expect(back?.sourceDescription).toContain('Wooded parcel');
    expect(back?.reconciliation.matched).toBe(true);
  });

  it('survives a re-read, so the image is durable across refresh and restart', () => {
    saveCompListingDetail(detail());
    // A fresh read from the same persisted row is exactly what a page reload does.
    expect(loadCompListingDetail(compId)?.image?.url).toBe('https://photos.zillowstatic.com/fp/genuine_d.jpg');
    expect(thumbnailOf(compId)).toContain('photos.zillowstatic.com');
  });

  it('records a reconciled capture with no genuine image without touching the thumbnail', () => {
    const r = saveCompListingDetail(detail({ image: null }));
    expect(r.persisted).toBe(true);
    expect(r.thumbnailUpdated).toBe(false);
    expect(thumbnailOf(compId)).toBe('');
    expect(r.reason).toContain('no genuine listing image was available');
  });
});

describe('an unreconciled capture never contributes evidence', () => {
  const refused = () => detail({
    reconciliation: {
      matched: false,
      matchedOn: ['retained source page URL'],
      mismatches: ['page address "0 Peat Bed Rd" does not agree with the comparable address'],
      note: 'Capture refused: page address does not agree with the comparable address.',
    },
  });

  it('drops the image, the events and the description, and says so', () => {
    const r = saveCompListingDetail(refused());
    expect(r.persisted).toBe(true);
    expect(r.thumbnailUpdated).toBe(false);
    expect(r.reason).toContain('capture recorded WITHOUT its image');

    const back = loadCompListingDetail(compId);
    expect(back?.image).toBeNull();
    expect(back?.events).toEqual([]);
    expect(back?.sourceDescription).toBeNull();
    // The refusal itself is retained so the gap is visible, not silent.
    expect(back?.reconciliation.matched).toBe(false);
    expect(back?.reconciliation.mismatches.join(' ')).toContain('does not agree');
  });

  it('never overwrites a thumbnail the comparable already legitimately had', () => {
    getLandosDb().prepare('UPDATE landos_comp SET thumbnail_url = ? WHERE id = ?')
      .run('https://images.thelandportal.com/images/kept', compId);
    saveCompListingDetail(refused());
    expect(thumbnailOf(compId)).toBe('https://images.thelandportal.com/images/kept');
  });
});

describe('reading a stored capture', () => {
  it('treats a never-visited or corrupt row as no capture rather than throwing', () => {
    expect(parseListingDetail('')).toBeNull();
    expect(parseListingDetail(null)).toBeNull();
    expect(parseListingDetail('{not json')).toBeNull();
  });

  it('reports a missing comparable row instead of writing anywhere else', () => {
    const r = saveCompListingDetail(detail({ compId: 999999 }));
    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('comparable row not found');
  });
});
