// The Phase 5 comp correction, covered at the exact point the evidence was lost.
//
// LandPortal states a comparable's transaction status in a DOM ATTRIBUTE
// (data-mlsstatus) and again on that comparable's OWN parcel page. The visible
// row text — "$153,500 Acres: 13.10 | APN: 115 02100" — states neither. Reading
// text alone therefore delivered every LandPortal comp downstream as
// status=unknown, which the comp source policy correctly refuses to price, and
// the parcel came out "not priceable" while six stated Sold comps sat on screen.
//
// These fixtures are the live Deal 32 (Roane County TN) capture.

import { describe, expect, it } from 'vitest';

import {
  applyComparableDetail,
  mergeComparableDetails,
  parseComparableCard,
} from './landportal-browser.js';
import { currentComparables, mergePropertyInspections, type LandPortalComparableRecord } from './property-card.js';

const PARCEL_URL = 'https://landportal.com/?property=subject';

const card = (over: Record<string, unknown> = {}): string => JSON.stringify({
  text: '$153,500 Acres: 13.10 | APN: 115 02100',
  sectionLabel: 'Comparables',
  mlsStatus: 'sold',
  propertyId: '124034606',
  fips: '47145',
  apn: '115    02100',
  mlsPropertyId: '103875526',
  index: '0',
  ...over,
});

describe('parseComparableCard — the status LandPortal states in an attribute', () => {
  it('recovers the Sold status the row text never carries', () => {
    const parsed = parseComparableCard(card(), PARCEL_URL)!;
    expect(parsed.status).toBe('sold');
    expect(parsed.saleListIndicator).toBe('sale');
    expect(parsed.statusSource).toBe('card_attribute');
  });

  it('keeps the card APN intact, collapsing only LandPortal own padding', () => {
    expect(parseComparableCard(card(), PARCEL_URL)!.apn).toBe('115 02100');
  });

  it('carries LandPortal identity so the second surface is reachable', () => {
    const parsed = parseComparableCard(card(), PARCEL_URL)!;
    expect(parsed.landPortalPropertyId).toBe('124034606');
    expect(parsed.fips).toBe('47145');
    expect(parsed.mlsPropertyId).toBe('103875526');
  });

  it('reads price and acreage off the row text', () => {
    const parsed = parseComparableCard(card(), PARCEL_URL)!;
    expect(parsed.price).toBe(153500);
    expect(parsed.acres).toBe(13.1);
  });

  it('leaves status unknown when the attribute is absent — never inferred', () => {
    const parsed = parseComparableCard(card({ mlsStatus: null }), PARCEL_URL)!;
    expect(parsed.status).toBe('unknown');
    expect(parsed.statusSource).toBeNull();
  });

  it('marks an active card as a listing, not a sale', () => {
    const parsed = parseComparableCard(card({ mlsStatus: 'active' }), PARCEL_URL)!;
    expect(parsed.status).toBe('active');
    expect(parsed.saleListIndicator).toBe('list');
  });

  it('returns null for unparseable card JSON rather than a hollow row', () => {
    expect(parseComparableCard('not json', PARCEL_URL)).toBeNull();
  });
});

// ── The second surface ──────────────────────────────────────────────────────

const base = (over: Partial<LandPortalComparableRecord> = {}): LandPortalComparableRecord => ({
  rawText: '$153,500 Acres: 13.10 | APN: 115 02100',
  sourceUrl: PARCEL_URL,
  surface: 'sidebar',
  apn: '115 02100',
  address: null,
  acres: 13.1,
  price: 153500,
  pricePerAcre: 11718,
  distanceMiles: null,
  status: 'sold',
  saleListIndicator: 'sale',
  improvement: 'unknown',
  confidence: 'medium',
  ...over,
});

describe('applyComparableDetail — address, date and land facts from the comp own page', () => {
  it('supplies the street address and sale date the sidebar row lacks', () => {
    const merged = applyComparableDetail(base(), {
      sourceUrl: 'https://landportal.com/?property=comp1',
      facts: {
        'Parcel Address': '352 CEDAR GROVE RD', 'Parcel Address City': 'LOUDON',
        'Parcel Address State': 'TN', 'Parcel Address County': 'Roane County',
        'Last Sale Date': '03-20-2026', 'Listing Status': 'Sold',
        'Building SqFt': '1,120', 'Improvement Value': '350',
        'Land Market Value': '$90,200.00', 'Total Market Value': '$91,600.00',
        'Acres': '13.100', 'MLS Acres': '13.10',
        'Centroid Latitude': '35.74366377412125', 'Centroid Longitude': '-84.48348528701383',
      },
    });
    expect(merged.address).toBe('352 CEDAR GROVE RD');
    expect(merged.saleDate).toBe('2026-03-20');
    expect(merged.city).toBe('LOUDON');
    expect(merged.lat).toBeCloseTo(35.7436, 3);
    expect(merged.surface).toBe('both');
    expect(merged.detailUrl).toBe('https://landportal.com/?property=comp1');
  });

  it('treats a nominal structure on a 98%-land parcel as a land sale', () => {
    const merged = applyComparableDetail(base(), {
      facts: {
        'Building SqFt': '1,120', 'Improvement Value': '350',
        'Land Market Value': '$90,200.00', 'Total Market Value': '$91,600.00',
        'Acres': '13.100', 'Listing Status': 'Sold',
      },
    });
    expect(merged.improvement).toBe('vacant');
  });

  it('treats a material improvement value as improved', () => {
    // 210 LAWNVILLE RD: $32,400 of improvement, only 36% of value in land.
    const merged = applyComparableDetail(base({ acres: 12.28, price: 100000 }), {
      facts: {
        'Building SqFt': '1,440', 'Improvement Value': '32400',
        'Land Market Value': '$73,200.00', 'Total Market Value': '$202,800.00',
        'Acres': '2.600', 'Listing Status': 'Sold',
      },
    });
    expect(merged.improvement).toBe('improved');
  });

  it('flags an irreconcilable acreage rather than picking a figure', () => {
    // 175 LITTLE DOGWOOD RD: the row reads 17.75 ac; the parcel is 574 acres.
    const merged = applyComparableDetail(base({ acres: 17.75, price: 144500 }), {
      facts: { 'Acres': '574.310', 'MLS Acres': '657.00', 'Listing Status': 'Active' },
    });
    expect(merged.acreageConflict).toBe(true);
    expect(merged.parcelAcres).toBe(574.31);
  });

  it('lets the comp own page overrule a stale card attribute', () => {
    // The live set contains a card whose attribute says sold while its parcel
    // page shows an ACTIVE $5,950,000 listing. The page wins.
    const merged = applyComparableDetail(base({ status: 'sold', saleListIndicator: 'sale' }), {
      facts: { 'Listing Status': 'Active', 'Listing Price': '$5,950,000', 'Acres': '574.310' },
    });
    expect(merged.status).toBe('active');
    expect(merged.saleListIndicator).toBe('list');
    expect(merged.statusSource).toBe('detail_surface');
  });

  it('never downgrades a stated status because the detail page omitted it', () => {
    const merged = applyComparableDetail(base({ status: 'sold', statusSource: 'card_attribute' }), {
      facts: { 'Parcel Address': '810 CAVE CREEK RD' },
    });
    expect(merged.status).toBe('sold');
    expect(merged.statusSource).toBe('card_attribute');
  });
});

describe('mergeComparableDetails — APN is the canonical identity', () => {
  it('merges each detail onto its own row and never duplicates a comp', () => {
    const rows = [
      base({ apn: '115 02100' }),
      base({ apn: '071 03100', price: 84500, acres: 9.61, rawText: '$84,500 Acres: 9.61 | APN: 071 03100' }),
    ];
    const merged = mergeComparableDetails(rows, [
      { apn: '115    02100', sourceUrl: 'u1', facts: { 'Parcel Address': '352 CEDAR GROVE RD' } },
      { apn: '071 03100', sourceUrl: 'u2', facts: { 'Parcel Address': '810 CAVE CREEK RD' } },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].address).toBe('352 CEDAR GROVE RD');
    expect(merged[1].address).toBe('810 CAVE CREEK RD');
  });

  it('leaves a row untouched when its comp page could not be read', () => {
    const rows = [base({ apn: '115 02100' })];
    const merged = mergeComparableDetails(rows, [{ apn: '999 99999', facts: { 'Parcel Address': 'X' } }]);
    expect(merged[0].address).toBeNull();
    expect(merged[0].status).toBe('sold');
  });

  it('returns the rows unchanged when no detail surface was read at all', () => {
    const rows = [base()];
    expect(mergeComparableDetails(rows, [])).toEqual(rows);
  });
});

// ── Cumulative evidence ─────────────────────────────────────────────────────

describe('mergePropertyInspections — a corrected capture supersedes its stale copy', () => {
  const inspection = (comparables: LandPortalComparableRecord[]) => ({
    parcelUrl: PARCEL_URL, comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [],
    visualObservations: [], comparables, sources: [], evidence: [],
    discoveryQuestions: [], missingInformation: [],
  });

  it('replaces the status-unknown row rather than showing the comp twice', () => {
    // Property inspection is cumulative, so the pre-fix capture is still stored.
    // Keyed on URL/address/price the stale copy survived beside its corrected
    // replacement and the operator saw twelve comps where six exist.
    const stale = base({ address: null, status: 'unknown', saleListIndicator: 'unknown', sourceUrl: PARCEL_URL });
    const corrected = base({ address: '352 CEDAR GROVE RD', status: 'sold', sourceUrl: 'https://landportal.com/?property=comp1' });
    const merged = mergePropertyInspections([inspection([stale]), inspection([corrected])])!;
    expect(merged.comparables).toHaveLength(1);
    expect(merged.comparables[0].status).toBe('sold');
    expect(merged.comparables[0].address).toBe('352 CEDAR GROVE RD');
  });

  it('serves only the current capture generation as the working comp set', () => {
    // The live Deal 32 defect: LandPortal's comparable set had rotated, so the
    // fresh capture enriched four NEW comps while six superseded rows — no
    // status, no address, no date — stayed in front of the operator beside them.
    const stale = base({ apn: '115 02100', address: null, status: 'unknown', capturedAtIso: '2026-07-26T10:00:00.000Z' });
    const current = base({ apn: '108 04500', address: 'LAWHON FARM RD', status: 'sold', capturedAtIso: '2026-07-27T15:20:00.000Z' });
    const merged = mergePropertyInspections([inspection([stale]), inspection([current])])!;
    // Both are RETAINED as cumulative evidence …
    expect(merged.comparables).toHaveLength(2);
    // … but only the current generation is the working set.
    const now = currentComparables(merged);
    expect(now).toHaveLength(1);
    expect(now[0].apn).toBe('108 04500');
  });

  it('keeps every row when no capture was ever stamped', () => {
    const a = base({ apn: '115 02100', capturedAtIso: null });
    const b = base({ apn: '071 03100', capturedAtIso: null });
    expect(currentComparables(mergePropertyInspections([inspection([a, b])])!)).toHaveLength(2);
  });

  it('never collapses two genuinely different addresses that share an APN', () => {
    // An extractor that mis-assigns one APN to several rows must not silently
    // delete real comps — a contradicting address keeps them apart.
    const a = base({ apn: '073090 04100', address: '120 Ridge Rd', price: 62_000 });
    const b = base({ apn: '073090 04100', address: '300 Ridge Rd', price: 79_900 });
    const merged = mergePropertyInspections([inspection([a, b])])!;
    expect(merged.comparables).toHaveLength(2);
  });
});
