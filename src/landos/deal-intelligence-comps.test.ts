import { describe, expect, it } from 'vitest';

import {
  acreageBand,
  acreageSimilarity,
  candidateRowsFromPolicy,
  comparabilityScore,
  compSelectionWeight,
  compIdentity,
  dedupeCompRows,
  isEvidenceOnlySource,
  isWorkingSetSource,
  landPortalSaleStatus,
  selectWorkingComps,
  valuationFromWorkingSet,
  ACTIVE_WORKING_SET_LIMIT,
  WORKING_SET_LIMIT,
  type CompCandidateRow,
} from './deal-intelligence-comps.js';
import type { CompSourcePolicyResult } from './comp-source-policy.js';

const NOW = Date.parse('2026-07-27T00:00:00.000Z');
const SUBJECT = { acres: 12.28, locality: 'Kingston', county: 'Roane' };

function row(over: Partial<CompCandidateRow> = {}): CompCandidateRow {
  return {
    key: over.key ?? Math.random().toString(36).slice(2),
    address: null,
    source: 'Redfin',
    sourceUrl: null,
    price: 100_000,
    acres: 10,
    pricePerAcre: null,
    dateIso: '2025-05-15',
    distanceMiles: null,
    landClass: 'vacant_land',
    statusBasis: 'closed_sale',
    locality: 'Kingston',
    ...over,
  };
}

describe('working-set sources', () => {
  it('admits only the approved marketplaces', () => {
    for (const s of ['LandPortal visible', 'Zillow', 'Redfin', 'Realtor.com']) expect(isWorkingSetSource(s)).toBe(true);
    for (const s of ['homeharvest', 'realie']) expect(isWorkingSetSource(s)).toBe(false);
  });

  it('classifies the aggregators as evidence-only', () => {
    expect(isEvidenceOnlySource('homeharvest')).toBe(true);
    expect(isEvidenceOnlySource('realie')).toBe(true);
    expect(isEvidenceOnlySource('Redfin')).toBe(false);
  });
});

describe('comparability', () => {
  it('bands on the subject acreage', () => {
    expect(acreageBand(12.28)).toEqual({ lo: 6.14, hi: 24.56 });
    expect(acreageBand(null)).toBeNull();
  });

  it('scores acreage by ratio, so a fixed gap matters more on a small subject', () => {
    expect(acreageSimilarity(3, 5)).toBeLessThan(acreageSimilarity(300, 302));
  });

  it('prefers a similar-acreage row over a nearer but tiny lot', () => {
    // The exact failure the operator saw: sub-acre lake lots outranking real
    // acreage matches because they were closer.
    const tinyButClose = row({ acres: 0.5, distanceMiles: 0.2 });
    const similarButFar = row({ acres: 11.5, distanceMiles: 18 });
    expect(comparabilityScore(SUBJECT, similarButFar, NOW))
      .toBeGreaterThan(comparabilityScore(SUBJECT, tinyButClose, NOW));
  });

  it('ranks vacant land above an improved property', () => {
    expect(comparabilityScore(SUBJECT, row({ landClass: 'vacant_land' }), NOW))
      .toBeGreaterThan(comparabilityScore(SUBJECT, row({ landClass: 'improved' }), NOW));
  });

  it('prefers the more recent of two equal rows', () => {
    expect(comparabilityScore(SUBJECT, row({ dateIso: '2026-06-01' }), NOW))
      .toBeGreaterThan(comparabilityScore(SUBJECT, row({ dateIso: '2023-01-01' }), NOW));
  });

  it('uses access, terrain, utilities and development context when providers supply comparable signals', () => {
    const weakContext = row({
      accessSimilarity: 0,
      terrainSimilarity: 0,
      utilitiesSimilarity: 0,
      developmentContextSimilarity: 0,
    });
    const strongContext = row({
      accessSimilarity: 1,
      terrainSimilarity: 1,
      terrainSimilarityReliable: true,
      utilitiesSimilarity: 1,
      developmentContextSimilarity: 1,
    });
    expect(comparabilityScore(SUBJECT, strongContext, NOW))
      .toBeGreaterThan(comparabilityScore(SUBJECT, weakContext, NOW));
  });

  it('keeps unverified terrain neutral until parcel, units and geometry are checked', () => {
    const base = row({ terrainSimilarity: 0, terrainSimilarityReliable: false });
    const questionable = row({ terrainSimilarity: 1, terrainSimilarityReliable: false });
    const verified = row({ terrainSimilarity: 1, terrainSimilarityReliable: true });
    expect(comparabilityScore(SUBJECT, questionable, NOW)).toBe(comparabilityScore(SUBJECT, base, NOW));
    expect(compSelectionWeight(SUBJECT, verified, NOW)).toBeGreaterThan(compSelectionWeight(SUBJECT, questionable, NOW));
  });
});

describe('deduplication', () => {
  it('collapses the duplicate Zillow listing at 400 Waterside Cir #3880', () => {
    const a = row({ source: 'Zillow', address: '400 Waterside Cir #3880, Andersonville, TN 37705', statusBasis: 'active_listing', price: 95_000, acres: null });
    const b = row({ source: 'Zillow', address: '400 Waterside Cir #3880, Andersonville, TN 37705', statusBasis: 'active_listing', price: 95_000, acres: null });
    const { rows, removed } = dedupeCompRows([a, b]);
    expect(rows).toHaveLength(1);
    expect(removed).toBe(1);
  });

  it('recognises the SAME property across two marketplaces and keeps the confirmed sale', () => {
    // Live case: LandPortal published "$100,000 Acres: 10.30" with no status, and
    // Redfin published the same property as 117 Hensley Rd, sold.
    const landportal = row({ source: 'LandPortal visible', address: null, price: 100_000, acres: 10.3, statusBasis: 'unconfirmed', dateIso: null });
    const redfin = row({ source: 'Redfin', address: '117 Hensley Rd, Kingston, TN 37763', price: 100_000, acres: 10.3, statusBasis: 'closed_sale', dateIso: '2025-05-15' });
    const { rows, removed } = dedupeCompRows([landportal, redfin]);
    expect(removed).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].statusBasis).toBe('closed_sale');
    expect(rows[0].address).toBe('117 Hensley Rd, Kingston, TN 37763');
    expect(rows[0].providerAttributions?.sort()).toEqual(['LandPortal visible', 'Redfin']);
  });

  it('dedupes by APN, provider id, coordinates, and a matching dated sale event', () => {
    const base = row({ source: 'LandPortal visible', address: null, apn: '115 02100', providerId: 'lp-1', lat: 35.90, lng: -84.50 });
    expect(dedupeCompRows([base, row({ source: 'Redfin', apn: '115-02100', address: '1 Ridge Rd' })]).rows).toHaveLength(1);
    expect(dedupeCompRows([base, row({ source: 'LandPortal visible', providerId: 'lp-1', apn: null, address: '2 Ridge Rd' })]).rows).toHaveLength(1);
    expect(dedupeCompRows([base, row({ source: 'Zillow', apn: null, address: '3 Ridge Rd', lat: 35.9002, lng: -84.5002 })]).rows).toHaveLength(1);
    expect(dedupeCompRows([
      row({ source: 'LandPortal visible', address: null, price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
      row({ source: 'Redfin', address: '20 B Rd', price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
    ]).rows).toHaveLength(1);
  });

  it('does not merge two addressed properties merely because price, acreage and date match', () => {
    const { rows } = dedupeCompRows([
      row({ source: 'Zillow', address: '10 A Rd', price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
      row({ source: 'Redfin', address: '20 B Rd', price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('never lets a transaction signature override conflicting APNs', () => {
    const { rows } = dedupeCompRows([
      row({ source: 'LandPortal visible', apn: '11-11', address: null, price: 88_000, acres: 9.5, statusBasis: 'unconfirmed' }),
      row({ source: 'Realtor.com', apn: '22-22', address: null, price: 88_000, acres: 9.5, statusBasis: 'closed_sale' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('never merges two genuinely different properties', () => {
    const { rows } = dedupeCompRows([
      row({ address: '117 Hensley Rd', price: 100_000, acres: 10.3 }),
      row({ address: '481 Old Holderford Rd', price: 90_000, acres: 4.95 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('merges available listing photos across corroborating marketplace rows', () => {
    const { rows } = dedupeCompRows([
      row({
        source: 'Zillow',
        address: '117 Hensley Rd',
        thumbnailUrl: 'https://photos.test/zillow-thumb.jpg',
        photoUrls: ['https://photos.test/zillow-1.jpg', 'javascript:alert(1)'],
      }),
      row({
        source: 'Redfin',
        address: '117 Hensley Rd',
        thumbnailUrl: 'https://photos.test/redfin-thumb.jpg',
        photoUrls: ['https://photos.test/redfin-1.jpg'],
      }),
    ]);
    expect(rows[0].thumbnailUrl).toMatch(/^https:\/\/photos\.test\//);
    expect(rows[0].photoUrls).toEqual(expect.arrayContaining([
      'https://photos.test/zillow-1.jpg',
      'https://photos.test/redfin-1.jpg',
    ]));
    expect(rows[0].photoUrls?.join(' ')).not.toMatch(/javascript:/i);
  });

  it('reconciles four provider observations to one comp and leads with a listing photo', () => {
    const shared = { address: '117 Hensley Rd, Kingston, TN 37763', apn: '115-02100', price: 100_000, acres: 10.3 };
    const { rows, removed } = dedupeCompRows([
      row({ ...shared, source: 'LandPortal visible', thumbnailUrl: 'https://images.thelandportal.com/tile.jpg' }),
      row({ ...shared, source: 'Zillow', thumbnailUrl: 'https://photos.zillowstatic.com/fp/hero.jpg' }),
      row({ ...shared, source: 'Redfin', photoUrls: ['https://ssl.cdn-redfin.com/photo/road.jpg'] }),
      row({ ...shared, source: 'Realtor.com', photoUrls: ['https://ap.rdcpix.com/water.jpg'] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(removed).toBe(3);
    expect(rows[0].duplicatesMerged).toBe(3);
    expect(rows[0].providerAttributions?.sort()).toEqual(['LandPortal visible', 'Realtor.com', 'Redfin', 'Zillow']);
    expect(rows[0].thumbnailUrl).toBe('https://photos.zillowstatic.com/fp/hero.jpg');
    expect(rows[0].photoUrls).toHaveLength(4);
  });

  it('dedupes transitively when a later provider page bridges APN-only and address-only rows', () => {
    const { rows, removed } = dedupeCompRows([
      row({ source: 'LandPortal visible', apn: '13-116-015-01', address: null, price: 400_000, acres: 40 }),
      row({ source: 'Zillow', apn: null, address: '100 Comp Road, Williamsburg, MI 49690', price: 400_000, acres: 40 }),
      row({ source: 'Realtor.com', apn: '13-116-015-01', address: '100 Comp Road, Williamsburg, MI 49690', price: 400_000, acres: 40 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(removed).toBe(2);
    expect(rows[0]).toMatchObject({ apn: '13-116-015-01', address: '100 Comp Road, Williamsburg, MI 49690', duplicatesMerged: 2 });
    expect(rows[0].providerAttributions).toEqual(expect.arrayContaining(['LandPortal visible', 'Zillow', 'Realtor.com']));
  });

  it('retains only the card-scoped internal comp-image route', () => {
    const { rows } = dedupeCompRows([
      row({
        source: 'LandPortal visible',
        address: '4910 Dacusville Hwy',
        thumbnailUrl: '/api/landos/deal-cards/64/comp-image/5114-00-18-5192',
        photoUrls: ['/api/landos/deal-cards/64/comp-image/../../secret'],
      }),
    ]);
    expect(rows[0].thumbnailUrl).toBe('/api/landos/deal-cards/64/comp-image/5114-00-18-5192');
    expect(rows[0].photoUrls).toEqual(['/api/landos/deal-cards/64/comp-image/5114-00-18-5192']);
  });
});

describe('working set selection', () => {
  const build = (rows: CompCandidateRow[]) => selectWorkingComps({ subject: SUBJECT, rows, nowMs: NOW });

  it('caps sold at five and active at four and counts the rest as evidence', () => {
    // Distinct in-band LandPortal properties exercise the overall display cap,
    // independently of the Zillow/Redfin supplement caps covered below.
    const sold = Array.from({ length: 12 }, (_, i) =>
      row({ key: `s${i}`, source: 'LandPortal visible', address: `${i} Sold Rd`, price: 90_000 + i * 1_000, acres: 8 + i * 0.3, statusBasis: 'closed_sale' }));
    const active = Array.from({ length: 12 }, (_, i) =>
      row({ key: `a${i}`, source: 'LandPortal visible', address: `${i} Active Rd`, price: 110_000 + i * 1_000, acres: 8.2 + i * 0.3, statusBasis: 'active_listing' }));
    const set = build([...sold, ...active]);
    expect(set.sold).toHaveLength(WORKING_SET_LIMIT);
    expect(set.active).toHaveLength(ACTIVE_WORKING_SET_LIMIT);
    expect(set.evidence.some((b) => /Beyond the 5 most comparable closed sales/.test(b.reason))).toBe(true);
    expect(set.evidence.some((b) => /Beyond the 4 most comparable active listings/.test(b.reason))).toBe(true);
  });

  it('projects thumbnail and photo carousel URLs with listing engagement metadata', () => {
    const set = build([row({
      source: 'Zillow',
      address: '10 Visual Comp Rd',
      thumbnailUrl: 'https://photos.test/thumb.jpg',
      photoUrls: ['https://photos.test/one.jpg', 'https://photos.test/two.jpg'],
      listingDate: '2025-12-01',
      collectedAt: '2026-01-01',
      views: 250,
      saves: 12,
      priceChanges: [{ at: '2025-12-15', price: 95_000, note: 'Price cut' }],
    })]);
    expect(set.sold[0]).toMatchObject({
      thumbnailUrl: 'https://photos.test/thumb.jpg',
      photoUrls: [
        'https://photos.test/thumb.jpg',
        'https://photos.test/one.jpg',
        'https://photos.test/two.jpg',
      ],
      originalListingDate: '2025-12-01',
      collectionDate: '2026-01-01',
      views: 250,
      saves: 12,
      engagement: 'strong',
    });
    expect(set.sold[0].priceChanges).toHaveLength(1);
  });

  it('enforces per-marketplace supplement caps in sold and active lanes', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ key: `zs${i}`, source: 'Zillow', address: `${i} Zillow Sold Rd`, price: 80_000 + i * 1_000, acres: 10 + i * 0.1 })),
      ...Array.from({ length: 4 }, (_, i) => row({ key: `ra${i}`, source: 'Redfin', address: `${i} Redfin Active Rd`, price: 90_000 + i * 1_000, acres: 10 + i * 0.1, statusBasis: 'active_listing' })),
    ];
    const set = selectWorkingComps({
      subject: SUBJECT,
      rows,
      nowMs: NOW,
      sourceCaps: { zillow: 2, redfin: 2 },
    });
    expect(set.sold.filter((comp) => comp.source.includes('Zillow'))).toHaveLength(2);
    expect(set.active.filter((comp) => comp.source.includes('Redfin'))).toHaveLength(2);
    expect(set.evidence.some((bucket) => /supplement cap is 2/.test(bucket.reason))).toBe(true);
  });

  it('keeps HomeHarvest and Realie out of the working set entirely', () => {
    const set = build([
      row({ source: 'homeharvest', acres: 10, statusBasis: 'closed_sale' }),
      row({ source: 'realie', acres: 11, statusBasis: 'active_listing' }),
    ]);
    expect(set.sold).toHaveLength(0);
    expect(set.active).toHaveLength(0);
    const bucket = set.evidence.find((b) => /Aggregator row/.test(b.reason))!;
    expect(bucket.count).toBe(2);
    expect(bucket.sources.join(' ')).not.toMatch(/homeharvest|realie/i);
    expect(JSON.stringify(set)).not.toMatch(/HomeHarvest|Realie/i);
  });

  it('excludes sub-acre subdivision lots from active competition for a 12-acre subject', () => {
    const set = build(Array.from({ length: 20 }, (_, i) =>
      row({ key: `a${i}`, address: `${i} Melea Ln`, price: 35_000 + i * 500, acres: 0.4 + i * 0.02, statusBasis: 'active_listing' })));
    expect(set.active).toHaveLength(0);
    expect(set.evidence.some((b) => /outside the subject's comparable band/.test(b.reason))).toBe(true);
  });

  it('retains the subject listing as context instead of calling it an active competitor', () => {
    const subject = {
      ...SUBJECT,
      address: '3573 Moorefield Memorial Hwy',
      apn: '4183-00-45-1068',
    };
    const set = selectWorkingComps({
      subject,
      rows: [
        row({
          key: 'subject-by-address',
          address: '3573 Moorefield Memorial Hwy, Pickens, SC 29671',
          acres: 64,
          statusBasis: 'active_listing',
        }),
        row({
          key: 'subject-by-apn',
          address: 'Another marketplace label',
          apn: '4183 00 45 1068',
          acres: 64,
          statusBasis: 'closed_sale',
        }),
        ...Array.from({ length: 4 }, (_, index) => row({
          key: `competitor-${index}`,
          address: `${index + 1} Other Hwy, Pickens, SC 29671`,
          acres: 10 + index * 0.2,
          statusBasis: 'active_listing',
        })),
      ],
      nowMs: NOW,
    });

    expect(set.sold).toHaveLength(0);
    expect(set.active).toHaveLength(4);
    expect(set.active.some((comp) => /3573 Moorefield/i.test(comp.address ?? ''))).toBe(false);
    expect(set.evidence.some((bucket) => /subject property itself/i.test(bucket.reason) && bucket.count === 2)).toBe(true);
  });

  it('classifies a status-unconfirmed LandPortal row as an asking reference, never as sold', () => {
    const set = build([
      row({ source: 'LandPortal visible', address: null, price: 125_000, acres: 8.79, statusBasis: 'unconfirmed', dateIso: null }),
    ]);
    expect(set.sold).toHaveLength(0);
    expect(set.askingReferences).toHaveLength(1);
    expect(set.askingReferences[0].status).toMatch(/status unconfirmed/i);
    expect(set.askingReferences[0].whyUseful).toMatch(/NOT sold evidence/);
    expect(set.conclusion).toBe('asking_indication');
  });

  it('reports sold_supported only when a genuine in-band closed sale exists', () => {
    const set = build([row({ source: 'Redfin', address: '117 Hensley Rd', price: 100_000, acres: 10.3, statusBasis: 'closed_sale', dateIso: '2025-05-15' })]);
    expect(set.conclusion).toBe('sold_supported');
    expect(set.sold).toHaveLength(1);
    expect(set.sold[0].pricePerAcre).toBe(9709);
    expect(set.sold[0].weight).toBeGreaterThan(0);
    expect(set.sold[0].whyUseful).toMatch(/Selection weight \d+\/100/);
    expect(set.sold[0].materialDifferences).toEqual(set.sold[0].differences);
  });

  it('reports not_priceable when nothing usable survives', () => {
    const set = build([
      row({ source: 'homeharvest', acres: 0.4 }),
      row({ source: 'Redfin', acres: null, statusBasis: 'closed_sale' }),
    ]);
    expect(set.conclusion).toBe('not_priceable');
    expect(set.sold).toHaveLength(0);
    expect(set.askingReferences).toHaveLength(0);
  });

  it('never emits one rejection line per row', () => {
    const set = build(Array.from({ length: 89 }, (_, i) => row({ key: `r${i}`, source: 'homeharvest', address: `${i} X Rd`, price: 20_000 + i * 500 })));
    expect(set.evidence).toHaveLength(1);
    expect(set.evidence[0].count).toBe(89);
  });

  it('produces exactly one conclusion, never a value and a not-priceable at once', () => {
    const set = build([
      row({ source: 'Redfin', address: '117 Hensley Rd', price: 100_000, acres: 10.3, statusBasis: 'closed_sale' }),
      row({ source: 'LandPortal visible', address: null, price: 145_000, acres: 10.58, statusBasis: 'unconfirmed' }),
    ]);
    expect(['sold_supported', 'asking_indication', 'not_priceable']).toContain(set.conclusion);
    expect(set.conclusion).toBe('sold_supported');
  });

  it('prices the 60-acre Elk Lake subject from its real broad LandPortal sold pool', () => {
    const subject = {
      acres: 60,
      locality: 'Williamsburg',
      county: 'Grand Traverse',
      lat: 44.822439610896,
      lng: -85.404821349666,
    };
    const sold = [
      row({ key: 'lp-40-a', source: 'LandPortal', price: 400_000, acres: 40, pricePerAcre: 10_000, dateIso: '2025-03-21', distanceMiles: null }),
      row({ key: 'lp-85', source: 'LandPortal', price: 1_100_000, acres: 85.32, pricePerAcre: 12_892.64, dateIso: '2026-02-12', distanceMiles: null }),
      row({ key: 'lp-40-duplicate', source: 'LandPortal', price: 400_000, acres: 40, pricePerAcre: 10_000, dateIso: '2025-03-21', distanceMiles: null }),
      row({ key: 'lp-40-b', source: 'LandPortal', price: 375_000, acres: 40, pricePerAcre: 9_375, dateIso: '2025-02-04', distanceMiles: null }),
      row({ key: 'lp-39', source: 'LandPortal', price: 390_000, acres: 39.94, pricePerAcre: 9_764.65, dateIso: '2025-04-04', distanceMiles: null }),
    ];
    const set = selectWorkingComps({ subject, rows: sold, nowMs: NOW });
    expect(set.sold.map((comp) => comp.acres).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([39.94, 40, 40, 85.32]);
    expect(set.duplicatesRemoved).toBe(1);
    expect(set.acreageRouting).toMatchObject({ regime: 'large', pool: { min: 21, max: 150 } });
    expect(set.acreageMarketContext).toMatchObject({ usableCount: 4, tiersUsed: ['distance_unresolved'] });
    expect(set.geographicExpansion).toMatch(/Location unresolved.*no distance is invented/i);
    expect(set.sold.every((comp) => comp.differences.join(' ').match(/no straight-line miles were invented/i))).toBe(true);
  });

  it('computes and displays straight-line distance, including expansion past 20 miles', () => {
    const set = selectWorkingComps({
      subject: { acres: 60, locality: 'Williamsburg', county: 'Grand Traverse', lat: 44.8224, lng: -85.4048 },
      rows: [row({ source: 'LandPortal', acres: 40, lat: 45.2, lng: -85.4048, distanceMiles: null })],
      nowMs: NOW,
    });
    expect(set.sold[0].distanceMiles).toBeGreaterThan(20);
    expect(`${set.sold[0].whyUseful} ${set.sold[0].differences.join(' ')}`).toMatch(/\d+\.\d mi.*Regional/i);
    expect(set.geographicExpansion).toMatch(/expanded beyond the local 10 miles/i);
  });

  it('keeps house listings out of active vacant-land competition with structure reasons visible', () => {
    const set = build([
      row({ key: 'vacant', statusBasis: 'active_listing', landClass: 'vacant_land', address: '1 Vacant Rd' }),
      row({ key: 'unknown-house', statusBasis: 'active_listing', landClass: 'unknown', homeSizeSqft: 1568, address: '2 House Rd', price: 125_000, acres: 11 }),
      row({ key: 'improved-house', statusBasis: 'active_listing', landClass: 'improved', homeType: 'SINGLE_FAMILY', address: '3 Home Rd', price: 150_000, acres: 12 }),
    ]);
    expect(set.active.map((comp) => comp.address)).toEqual(['1 Vacant Rd']);
    expect(set.evidence.map((bucket) => bucket.reason).join(' ')).toMatch(/1,568 sqft.*structure|residential home type|improved property/i);
  });
});

describe('comp identity', () => {
  it('identifies an address-less LandPortal row by price and acreage', () => {
    expect(compIdentity(row({ address: null, price: 100_000, acres: 10.3 }))).toBe('event:closed_sale:100000:10.30:2025-05-15');
  });

  it('produces a low-confidence supported range instead of refusing a usable one-sale thin market', () => {
    const set = selectWorkingComps({
      subject: SUBJECT,
      rows: [row({ source: 'Redfin', address: '117 Hensley Rd', price: 100_000, acres: 10.3, statusBasis: 'closed_sale' })],
      nowMs: NOW,
    });
    const valuation = valuationFromWorkingSet(SUBJECT, set);
    expect(valuation.priceable).toBe(true);
    expect(valuation.confidence).toBe('low');
    expect(valuation.range!.low).toBeLessThan(valuation.range!.high);
    expect(valuation.workingValue).toBeGreaterThan(0);
    expect(valuation.notPriceableReason).toBeNull();
  });

  it('caps a discovery-stage valuation at low confidence without county-confirmation limitations', () => {
    const set = selectWorkingComps({
      subject: SUBJECT,
      rows: [
        row({ source: 'LandPortal visible', address: '1 Ridge Rd', price: 100_000, acres: 10 }),
        row({ source: 'LandPortal visible', address: '2 Ridge Rd', price: 110_000, acres: 11 }),
        row({ source: 'LandPortal visible', address: '3 Ridge Rd', price: 120_000, acres: 12 }),
        row({ source: 'LandPortal visible', address: '4 Ridge Rd', price: 130_000, acres: 13 }),
      ],
      nowMs: NOW,
    });
    const valuation = valuationFromWorkingSet(SUBJECT, set, {
      identityState: 'provisional',
      discoveryIdentityUsable: true,
      identityBasis: 'supplied APN/county/state agree with the retained LandPortal subject page',
    });
    expect(valuation.priceable).toBe(true);
    expect(valuation.confidence).toBe('low');
    expect(valuation.basis).toMatch(/Working discovery estimate from the retained parcel match/);
    expect(valuation.uncertainty.join(' ')).toMatch(/supplied APN.*LandPortal subject page/);
    expect(valuation.materialGaps.join(' ')).not.toMatch(/county|second match/i);
  });

  it('keeps qualitative constraints neutral and applies only explicit supported adjustments', () => {
    const set = selectWorkingComps({
      subject: SUBJECT,
      rows: [row({ address: '117 Hensley Rd' }), row({ address: '481 Old Holderford Rd', price: 120_000, acres: 11 })],
      nowMs: NOW,
    });
    const clean = valuationFromWorkingSet(SUBJECT, set);
    const constrained = valuationFromWorkingSet(SUBJECT, set, {
      constraints: ['Mapped wetland overlap'],
      hardRisks: ['Access: no mapped road contact'],
    });
    expect(constrained.workingValue).toBe(clean.workingValue);
    expect(constrained.adjustments.join(' ')).toMatch(/No automatic deduction/);
    expect(constrained.uncertainty.join(' ')).toMatch(/could move value or kill the deal/);
    expect(constrained.confidence).toBe('low');

    const supported = valuationFromWorkingSet(SUBJECT, set, {
      adjustments: [{
        label: 'Access difference',
        percent: -7.5,
        evidence: 'subject has a documented shared-access burden absent from both accepted sales',
        reliability: 'verified',
      }],
    });
    expect(supported.workingValue).toBeLessThan(clean.workingValue!);
    expect(supported.adjustments.join(' ')).toMatch(/-7\.5% supported/);
  });
});

describe('LandPortal sale-date provenance', () => {
  it('treats only a LandPortal-stated parseable sale date as a closed sale', () => {
    expect(landPortalSaleStatus({ source: 'LandPortal', dateIso: '2026-02-12', priceKind: 'unknown' }))
      .toEqual({ statusBasis: 'closed_sale', provenance: 'LandPortal stated the sale date 2026-02-12.' });
    expect(landPortalSaleStatus({ source: 'LandPortal', dateIso: null })).toMatchObject({ statusBasis: 'unconfirmed' });
    expect(landPortalSaleStatus({ source: 'Redfin', dateIso: '2026-02-12', priceKind: 'sale' }))
      .toMatchObject({ statusBasis: 'unconfirmed' });
  });
});

describe('policy verdicts travel with the row', () => {
  // The bridge from the source policy. The policy decides which rows may enter
  // the working set; these tests pin that a policy verdict cannot be undone by
  // selection just because the row's acreage happens to sit in band.
  type Decision = CompSourcePolicyResult['decisions'][number];
  const decision = (over: Omit<Partial<Decision>, 'candidate'> & { candidate?: Partial<Decision['candidate']> } = {}): Decision => ({
    family: 'zillow',
    lane: 'sold',
    role: 'supplement',
    fmvEligible: true,
    compClass: 'vacant_land',
    reason: 'accepted as supplement',
    ...over,
    candidate: {
      provider: 'Zillow',
      addressDesc: '1 Real Rd, Kingston, TN 37763',
      price: 100_000,
      acres: 10,
      priceKind: 'sold',
      saleOrListDate: '2025-05-15',
      ...(over.candidate ?? {}),
    } as Decision['candidate'],
  } as Decision);
  const policy = (decisions: Decision[]): CompSourcePolicyResult => ({ decisions } as CompSourcePolicyResult);
  const select = (decisions: Decision[]) =>
    selectWorkingComps({ subject: SUBJECT, rows: candidateRowsFromPolicy(policy(decisions)), nowMs: NOW });

  it('keeps a policy-rejected wrong-market row out of every lane', () => {
    const set = select([
      decision(),
      decision({
        role: 'rejected', fmvEligible: false,
        reason: 'Wrong market: the row sits in Georgia, not the subject state.',
        candidate: { addressDesc: '9 Far Away Rd, Macon, GA 31201', price: 98_000, acres: 11 },
      }),
    ]);
    expect(set.sold).toHaveLength(1);
    expect(set.active).toHaveLength(0);
    expect(set.askingReferences).toHaveLength(0);
    expect(set.evidence.some((b) => /Wrong market/.test(b.reason))).toBe(true);
  });

  it('does not carry disabled historical providers into a current snapshot candidate handback', () => {
    const rows = candidateRowsFromPolicy(policy([
      decision({
        family: 'realie', role: 'legacy_evidence', fmvEligible: false,
        reason: 'disabled historical provider',
        candidate: { provider: 'Realie.ai', addressDesc: '1 Legacy Rd' },
      }),
      decision(),
    ]));
    expect(rows).toHaveLength(1);
    expect(rows.some((candidate) => /realie|homeharvest/i.test(candidate.source))).toBe(false);
  });

  it('keeps an over-cap sold supplement out of the sold set, so the two-supplement cap holds', () => {
    const overCap = decision({
      role: 'context_only', fmvEligible: false,
      reason: 'Zillow supplement cap is 2 under the LandPortal-primary branch of the comp policy; this row ranked 3 on evidence strength and stays as context.',
      candidate: { addressDesc: '3 Third Rd, Kingston, TN 37763', price: 97_000, acres: 9.5 },
    });
    const set = select([
      decision({ candidate: { addressDesc: '1 First Rd, Kingston, TN 37763', price: 100_000, acres: 10 } }),
      decision({ candidate: { addressDesc: '2 Second Rd, Kingston, TN 37763', price: 99_000, acres: 10.5 } }),
      overCap,
    ]);
    expect(set.sold).toHaveLength(2);
    expect(set.evidence.some((b) => /supplement cap is 2/.test(b.reason))).toBe(true);
  });

  it('retains recent nearby manufactured sales in the land-home lane without a price gate', () => {
    const manufactured = (address: string, overrides: Partial<Decision['candidate']> = {}): Decision =>
      decision({
        role: 'land_home_only',
        fmvEligible: false,
        compClass: 'manufactured',
        reason: 'Manufactured-home strategy evidence only.',
        candidate: {
          provider: 'Zillow',
          addressDesc: address,
          price: 250_000,
          acres: 1.5,
          priceKind: 'sold',
          saleOrListDate: '2025-10-15',
          distanceMiles: 3.2,
          homeType: 'MANUFACTURED',
          yearBuilt: 2021,
          homeSizeSqft: 1568,
          ...overrides,
        },
      });
    const set = select([
      manufactured('1 Qualifying Home Rd'),
      manufactured('2 Too Far Rd', { distanceMiles: 5.1 }),
      // BUSINESS RULE: price never gates retention — a $200k sale stays.
      manufactured('3 Lower Price Rd', { price: 200_000 }),
      manufactured('4 Too Old Rd', { saleOrListDate: '2022-01-01' }),
    ]);

    expect(set.landHomeOnly).toHaveLength(2);
    expect(set.landHomeOnly.map((row) => row.address)).toEqual(['1 Qualifying Home Rd', '3 Lower Price Rd']);
    expect(set.landHomeOnly[0].whyUseful).toMatch(/within five miles/i);
    expect(set.landHomeOnly[0]).toMatchObject({ homeType: 'MANUFACTURED', yearBuilt: 2021, homeSizeSqft: 1568 });
    expect(set.sold).toHaveLength(0);
  });

  it('carries the sidebar APN through selection to the snapshot comp', () => {
    const set = select([
      decision({ family: 'landportal', role: 'primary', candidate: { provider: 'LandPortal visible', apn: '115 02100', addressDesc: '352 Cedar Grove Rd', price: 153_500, acres: 13.1 } }),
    ]);
    expect(set.sold).toHaveLength(1);
    expect(set.sold[0].apn).toBe('115 02100');
  });

  it('names the acreage conflict instead of claiming the provider had no acreage', () => {
    const set = select([
      decision({
        family: 'landportal', role: 'primary',
        candidate: { provider: 'LandPortal visible', addressDesc: '175 Little Dogwood Rd', price: 315_000, acres: null, acreageConflict: true },
      }),
    ]);
    expect(set.sold).toHaveLength(0);
    expect(set.evidence.some((b) => /acreage conflicts with the parcel record/i.test(b.reason))).toBe(true);
  });
});
