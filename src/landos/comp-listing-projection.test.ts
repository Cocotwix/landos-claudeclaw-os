// The operator-facing listing projection.
//
// A closed sale and an active listing must not arrive at the UI through one
// generic shape. These tests pin the split: a closed comp leads with a verified
// sold price and cumulative DOM; an active competitor leads with the ask and how
// long the market has refused it, and its asking price is never usable as sold
// evidence. A missing provider capture degrades honestly instead of blanking.

import { describe, expect, it } from 'vitest';

import { buildCompListingProjection, TRANSACTION_KIND_LABEL } from './comp-listing-projection.js';
import type { PersistedListingDetail } from './comp-listing-detail.js';

const TODAY = '2026-08-06';

const base = {
  address: '0 State Route 34, Cato, NY 13033',
  apn: null,
  county: 'Cayuga',
  state: 'NY',
  acres: 9.85,
  subjectAcres: 11.46,
  distanceMiles: 12.4,
  lat: 43.1,
  lng: -76.5,
  sourceLabel: 'Zillow',
  sourceUrl: 'https://www.zillow.com/homedetails/0-State-Route-34-1-Cato-NY-13033/2058679808_zpid/',
  visualProvenanceDetail: 'Original listing photograph retained from the Zillow property page.',
  todayIso: TODAY,
};

const detail = (over: Partial<PersistedListingDetail> = {}): PersistedListingDetail => ({
  compId: 931,
  provider: 'Zillow',
  sourceUrl: base.sourceUrl,
  capturedAtIso: '2026-08-06T12:00:00.000Z',
  image: {
    url: 'https://photos.zillowstatic.com/fp/a_d.jpg',
    label: 'Zillow listing photo',
    provenance: 'listing_photo',
    tier: 'hero',
    context: 'hero',
    isOriginalListingImage: true,
    sourceProperty: base.address,
    reconciledOn: ['retained source page URL', 'address', 'acreage'],
  },
  events: [],
  unusableRows: [],
  refusedImages: [],
  sourceDescription: 'Wooded 9.85 acre parcel with utility lines at the road. Perc approved.',
  status: 'Sold',
  limitation: null,
  reconciliation: { matched: true, matchedOn: ['retained source page URL', 'address'], mismatches: [], note: 'ok' },
  ...over,
});

describe('closed comparable projection', () => {
  it('leads with the verified sold price, sold date and cumulative DOM', () => {
    const p = buildCompListingProjection({
      ...base,
      detail: detail({
        events: [
          { dateIso: '2025-05-02', kind: 'listed', price: 59900, label: 'Listed for sale', source: 'Zillow listing history' },
          { dateIso: '2025-11-18', kind: 'sold', price: 49900, label: 'Sold', source: 'Zillow listing history' },
        ],
      }),
      transactionKind: 'closed',
      retainedPrice: 49900,
      retainedPriceKind: 'sale',
      retainedDateIso: '2025-11-18',
      providerDaysOnMarket: null,
      retainedListingDateIso: null,
    });
    expect(p.kindLabel).toBe(TRANSACTION_KIND_LABEL.closed);
    expect(p.price.basis).toBe('verified_sale');
    expect(p.price.amount).toBe(49900);
    expect(p.price.amountLabel).toBe('Verified sold price');
    expect(p.price.usableForValuation).toBe(true);
    expect(p.soldDateIso).toBe('2025-11-18');
    expect(p.marketTime.originalListingDateIso).toBe('2025-05-02');
    expect(p.marketTime.originalListPrice).toBe(59900);
    expect(p.marketTime.cumulativeDays).toBe(200);
    expect(p.marketTime.cumulativeLabel).toBe('LandOS cumulative days on market');
  });

  it('carries the source description and a separate LandOS summary', () => {
    const p = buildCompListingProjection({
      ...base, detail: detail(), transactionKind: 'closed',
      retainedPrice: 49900, retainedPriceKind: 'sale', retainedDateIso: '2025-11-18',
      providerDaysOnMarket: null, retainedListingDateIso: null,
    });
    expect(p.description.source?.text).toContain('Perc approved');
    expect(p.description.source?.attribution).toBe('Zillow listing description');
    expect(p.description.landos.sourceClaims.map((c) => c.claim)).toContain('perc approved');
    expect(p.description.landos.sourceClaims[0].status).toBe('unverified_marketing_claim');
    // The LandOS narrative never asserts the claim as its own fact.
    expect(p.description.landos.text).not.toMatch(/^Perc approved/);
  });

  it('appends the retained sale to the timeline when the source history omits it', () => {
    const p = buildCompListingProjection({
      ...base,
      detail: detail({ events: [{ dateIso: '2025-05-02', kind: 'listed', price: 59900, label: 'Listed for sale', source: 'Zillow listing history' }] }),
      transactionKind: 'closed', retainedPrice: 49900, retainedPriceKind: 'sale',
      retainedDateIso: '2025-11-18', providerDaysOnMarket: null, retainedListingDateIso: null,
    });
    const sold = p.timeline.find((t) => t.kind === 'sold');
    expect(sold).toMatchObject({ dateIso: '2025-11-18', price: 49900 });
    expect(p.timeline.map((t) => t.dateIso)).toEqual(['2025-05-02', '2025-11-18']);
  });

  it('records the evidence block including image reconciliation', () => {
    const p = buildCompListingProjection({
      ...base, detail: detail(), transactionKind: 'closed',
      retainedPrice: 49900, retainedPriceKind: 'sale', retainedDateIso: '2025-11-18',
      providerDaysOnMarket: null, retainedListingDateIso: null,
    });
    expect(p.evidence.sourcePage).toBe(base.sourceUrl);
    expect(p.evidence.diagnostics.imageLabel).toBe('Zillow listing photo');
    expect(p.evidence.diagnostics.imageIsOriginalListingImage).toBe(true);
    expect(p.evidence.diagnostics.imageReconciledOn).toContain('address');
    expect(p.evidence.diagnostics.transactionPriceConfidence).toBe('Verified sale price');
  });
});

describe('active competitor projection', () => {
  it('leads with the asking price and never marks it usable for valuation', () => {
    const p = buildCompListingProjection({
      ...base,
      address: 'L1 County Route 7, Hannibal, NY 13074',
      acres: 10,
      detail: null,
      transactionKind: 'active',
      retainedPrice: 209000,
      retainedPriceKind: 'list',
      retainedDateIso: null,
      providerDaysOnMarket: 415,
      retainedListingDateIso: '2025-06-17',
    });
    expect(p.kindLabel).toBe(TRANSACTION_KIND_LABEL.active);
    expect(p.price.amount).toBe(209000);
    expect(p.price.amountLabel).toBe('Current asking price');
    expect(p.price.perAcre).toBe(20900);
    expect(p.price.perAcreLabel).toBe('Current asking price per acre');
    expect(p.price.usableForValuation).toBe(false);
    expect(p.price.confidenceLabel).toContain('never sold evidence');
    expect(p.marketTime.cumulativeLabel).toBe('LandOS cumulative active market days');
    expect(p.marketTime.originalListingDateIso).toBe('2025-06-17');
    expect(p.marketTime.cumulativeDays).toBe(415);
    expect(p.marketTime.freshness).toBe('long_running');
  });

  it('never lets an active listing reach the sold-price resolver', () => {
    const p = buildCompListingProjection({
      ...base, detail: null, transactionKind: 'active',
      retainedPrice: 79900, retainedPriceKind: 'list', retainedDateIso: null,
      providerDaysOnMarket: 20, retainedListingDateIso: '2026-07-17',
    });
    expect(p.price.basis).toBe('none');
    expect(p.price.amountLabel).not.toMatch(/sold/i);
    expect(p.soldDateIso).toBeNull();
  });
});

describe('a listed price is an ASKING price whatever the record\'s role', () => {
  it('never prints "transaction price unavailable" above a printed asking figure', () => {
    // The live defect this pins: an improved-property ACTIVE listing is context
    // rather than live competition, and the price block keyed off the role — so
    // the card read "TRANSACTION PRICE UNAVAILABLE" directly above $55,000.
    const p = buildCompListingProjection({
      ...base,
      address: '15196 State Route 104, Martville, NY 13111',
      acres: 7.1,
      detail: null,
      transactionKind: 'context',
      retainedPrice: 55000,
      retainedPriceKind: 'list',
      retainedDateIso: null,
      providerDaysOnMarket: null,
      retainedListingDateIso: null,
      propertyClass: 'improved',
      buildingSqft: 1680,
    });
    expect(p.price.amount).toBe(55000);
    expect(p.price.amountLabel).toBe('Current asking price');
    expect(p.price.perAcre).toBe(7746.48);
    expect(p.price.perAcreLabel).toBe('Current asking price per acre');
    expect(p.price.amountLabel).not.toMatch(/unavailable/i);
    // It still never counts as sold evidence.
    expect(p.price.usableForValuation).toBe(false);
    expect(p.description.landos.verified.join(' ')).toContain('currently asking $55,000');
  });

  it('keeps a context record with no price honest about having none', () => {
    const p = buildCompListingProjection({
      ...base, detail: null, transactionKind: 'context',
      retainedPrice: null, retainedPriceKind: 'unknown', retainedDateIso: null,
      providerDaysOnMarket: null, retainedListingDateIso: null,
    });
    expect(p.price.amount).toBeNull();
    expect(p.price.amountLabel).toBe('Transaction price unavailable');
    expect(p.price.usableForValuation).toBe(false);
  });
});

describe('no provider capture', () => {
  it('degrades honestly instead of blanking or inventing a listing date', () => {
    const p = buildCompListingProjection({
      ...base, detail: null, transactionKind: 'closed',
      retainedPrice: 54000, retainedPriceKind: 'sale', retainedDateIso: '2025-07-24',
      providerDaysOnMarket: null, retainedListingDateIso: null,
    });
    expect(p.price.amount).toBe(54000);
    expect(p.marketTime.originalListingDateIso).toBeNull();
    expect(p.marketTime.cumulativeDays).toBeNull();
    expect(p.marketTime.lines.join(' ')).toContain('has not been revisited');
    expect(p.description.source).toBeNull();
    expect(p.evidence.diagnostics.capturedAtIso).toBeNull();
    expect(p.timeline).toHaveLength(1);
    expect(p.timeline[0].kind).toBe('sold');
  });
});
