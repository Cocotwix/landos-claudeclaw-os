import { describe, expect, it } from 'vitest';

import {
  acreageBand,
  acreageSimilarity,
  candidateRowsFromPolicy,
  comparabilityScore,
  compIdentity,
  dedupeCompRows,
  isEvidenceOnlySource,
  isWorkingSetSource,
  selectWorkingComps,
  valuationFromWorkingSet,
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
    for (const s of ['LandPortal visible', 'Zillow', 'Redfin']) expect(isWorkingSetSource(s)).toBe(true);
    for (const s of ['homeharvest', 'realie', 'Realtor.com']) expect(isWorkingSetSource(s)).toBe(false);
  });

  it('classifies the aggregators as evidence-only', () => {
    expect(isEvidenceOnlySource('homeharvest')).toBe(true);
    expect(isEvidenceOnlySource('realie')).toBe(true);
    expect(isEvidenceOnlySource('Redfin')).toBe(false);
  });
});

describe('comparability', () => {
  it('bands on the subject acreage', () => {
    expect(acreageBand(12.28)).toEqual({ lo: 6.14, hi: 30.7 });
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
      utilitiesSimilarity: 1,
      developmentContextSimilarity: 1,
    });
    expect(comparabilityScore(SUBJECT, strongContext, NOW))
      .toBeGreaterThan(comparabilityScore(SUBJECT, weakContext, NOW));
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
      row({ source: 'Zillow', address: '10 A Rd', price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
      row({ source: 'Redfin', address: '20 B Rd', price: 88_000, acres: 9.5, dateIso: '2025-04-01' }),
    ]).rows).toHaveLength(1);
  });

  it('never merges two genuinely different properties', () => {
    const { rows } = dedupeCompRows([
      row({ address: '117 Hensley Rd', price: 100_000, acres: 10.3 }),
      row({ address: '481 Old Holderford Rd', price: 90_000, acres: 4.95 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('working set selection', () => {
  const build = (rows: CompCandidateRow[]) => selectWorkingComps({ subject: SUBJECT, rows, nowMs: NOW });

  it('caps sold and active at five and counts the rest as evidence', () => {
    // Distinct in-band LandPortal properties exercise the overall display cap,
    // independently of the Zillow/Redfin supplement caps covered below.
    const sold = Array.from({ length: 12 }, (_, i) =>
      row({ key: `s${i}`, source: 'LandPortal visible', address: `${i} Sold Rd`, price: 90_000 + i * 1_000, acres: 8 + i * 0.3, statusBasis: 'closed_sale' }));
    const active = Array.from({ length: 12 }, (_, i) =>
      row({ key: `a${i}`, source: 'LandPortal visible', address: `${i} Active Rd`, price: 110_000 + i * 1_000, acres: 8.2 + i * 0.3, statusBasis: 'active_listing' }));
    const set = build([...sold, ...active]);
    expect(set.sold).toHaveLength(WORKING_SET_LIMIT);
    expect(set.active).toHaveLength(WORKING_SET_LIMIT);
    expect(set.evidence.some((b) => /Beyond the 5 most comparable closed sales/.test(b.reason))).toBe(true);
    expect(set.evidence.some((b) => /Beyond the 5 most comparable active listings/.test(b.reason))).toBe(true);
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

  it('applies physical constraints to the same working valuation instead of attaching contradictory adjustment text', () => {
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
    expect(constrained.workingValue).toBeLessThan(clean.workingValue!);
    expect(constrained.adjustments.join(' ')).toMatch(/reduce the supported band/);
    expect(constrained.uncertainty.join(' ')).toMatch(/could move value or kill the deal/);
    expect(constrained.confidence).toBe('low');
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
    expect(rows.some((candidate) => /realie|homeharvest|realtor/i.test(candidate.source))).toBe(false);
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
