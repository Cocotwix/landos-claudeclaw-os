import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { makeFixtureMarketProvider } from './market-browser-provider.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import {
  resolveMarketMatrix, currentPeriod, acreageBandForAcres, acreageBandsForAcres,
  buildMarketMatrixReportSection, resolveMarketMatrixSection,
} from './market-matrix-read.js';
import { propertyMarketContextFor } from './property-market-context.js';

async function ingestFixture() {
  const extraction = await makeFixtureMarketProvider().extract();
  ingestMarketSnapshots(extraction.snapshots);
}

const PROVENANCE = {
  provider: 'LandOS Market Research (test)',
  sourceRef: 'test',
  extractionTimestamp: '2026-07-01T00:00:00Z',
  agentRunId: 'test',
};

function seed(rows: unknown[]): void {
  const res = ingestMarketSnapshots(rows);
  expect(res.rejected).toBe(0);
  expect(res.unknown).toBe(0);
}

const countyRow = (fips: string, county: string, acreageBand: string, metrics: Record<string, number>, side = 'sold') => ({
  geography: { level: 'county' as const, state: 'GA', fips, county },
  acreageBand, side, period: '2026-Q2', confidence: 'high' as const, metrics, provenance: PROVENANCE,
});
const zipRow = (zip: string, acreageBand: string, metrics: Record<string, number>) => ({
  geography: { level: 'zip' as const, state: 'GA', zip },
  acreageBand, side: 'sold', period: '2026-Q2', confidence: 'medium' as const, metrics, provenance: PROVENANCE,
});

describe('resolveMarketMatrix (Property Card consumption)', () => {
  beforeEach(async () => { _initTestLandosDb(); await ingestFixture(); });

  it('resolves a county-level match with displayed facts and talking points', () => {
    const r = resolveMarketMatrix({ state: 'GA', county: '13089', acreageBand: '2-5', nowPeriod: '2026-Q2' });
    expect(r.matchLevel).toBe('county');
    expect(r.available).toBe(true);
    expect(r.facts.pricePerAcre).toBe(121500);
    expect(r.period).toBe('2026-Q2');
    expect(r.staleness.isStale).toBe(false);
    // Talking points reference only displayed (non-null) facts.
    expect(r.talkingPoints.length).toBeGreaterThan(0);
    expect(r.talkingPoints.length).toBeLessThanOrEqual(3);
    expect(r.talkingPoints.join(' ')).toContain('$121,500');
  });

  it('resolves a county by NAME + state (FIPS is identity, name is display)', () => {
    const r = resolveMarketMatrix({ state: 'SC', county: 'Anderson', acreageBand: '2-5', nowPeriod: '2026-Q2' });
    expect(r.matchLevel).toBe('county');
    expect(r.geography.fips).toBe('45007');
    expect(r.facts.pricePerAcre).toBe(34000);
  });

  it('reports staleness honestly for an older snapshot', () => {
    const r = resolveMarketMatrix({ state: 'GA', county: '13089', acreageBand: '2-5', nowPeriod: '2027-Q2' });
    expect(r.staleness.quartersOld).toBe(4);
    expect(r.staleness.isStale).toBe(true);
  });

  it('returns Unavailable for a county with no Market Matrix data (never fabricates)', () => {
    const r = resolveMarketMatrix({ state: 'GA', county: '13067', acreageBand: '2-5', nowPeriod: '2026-Q2' }); // Cobb: no data
    expect(r.matchLevel).toBe('unavailable');
    expect(r.available).toBe(false);
    expect(r.facts.pricePerAcre).toBeNull();
    expect(r.talkingPoints).toHaveLength(0);
  });

  it('falls back to a for-sale side when requested', () => {
    const r = resolveMarketMatrix({ state: 'GA', county: '13089', acreageBand: '2-5', side: 'for_sale', nowPeriod: '2026-Q2' });
    expect(r.matchLevel).toBe('county');
    expect(r.facts.pricePerAcre).toBe(134000);
  });

  it('currentPeriod computes a YYYY-Qn key', () => {
    expect(currentPeriod(new Date('2026-05-15T00:00:00Z'))).toBe('2026-Q2');
    expect(currentPeriod(new Date('2026-11-15T00:00:00Z'))).toBe('2026-Q4');
  });

  it('acreageBandForAcres maps acres → the band the subject is actually in', () => {
    expect(acreageBandForAcres(3)).toBe('2-5');
    expect(acreageBandForAcres(7)).toBe('5-10');
    expect(acreageBandForAcres(15)).toBe('10-20');
    expect(acreageBandForAcres(80)).toBe('50+');
    // Unknown acreage selects NO band. It used to select '2-5', which reads as
    // a positive claim about a subject whose size nobody knows.
    expect(acreageBandForAcres(null)).toBeNull();
    // The sub-2-acre bands are reachable. Collapsing everything under 5 acres
    // into '2-5' reported small subjects against the wrong comparables while
    // their own band sat unread in the collection.
    expect(acreageBandForAcres(1)).toBe('1-2');
    expect(acreageBandForAcres(0.4)).toBe('0-1');
  });

  it('buildMarketMatrixReportSection formats the operator section from ONE resolver (no dup logic)', () => {
    const section = resolveMarketMatrixSection({ state: 'GA', county: '13089', acres: 3, nowPeriod: '2026-Q2' });
    expect(section.available).toBe(true);
    expect(section.coverageLevel).toBe('county');
    expect(section.period).toBe('2026-Q2');
    // required operator fields present, each with a value or explicit Unknown
    const labels = section.fields.map((f) => f.label);
    expect(labels).toEqual(['Price per Acre', 'Days on Market', 'Sell-Through Rate', 'Absorption Rate', 'Months of Supply', 'Population', 'Population Density', 'Population Growth']);
    const ppa = section.fields.find((f) => f.label === 'Price per Acre');
    expect(ppa?.value).toBe('$121,500');
    expect(ppa?.unknown).toBe(false);
  });

  it('unavailable geography yields an honest, non-fabricated section', () => {
    const section = buildMarketMatrixReportSection(resolveMarketMatrix({ state: 'GA', county: '13333', acreageBand: '2-5' }));
    expect(section.available).toBe(false);
    expect(section.fields.every((f) => f.unknown)).toBe(true);
    expect(section.resolvedKey).toBeNull();
  });

  it('names the geography key that actually carried a resolution', () => {
    const r = resolveMarketMatrix({ state: 'GA', county: '13089', acreageBand: '2-5', nowPeriod: '2026-Q2' });
    expect(r.resolvedKey).toBe('county:13089');
    expect(r.resolvedKeyLabel).toBe('DeKalb County (2–5 acres)');
  });
});

// A single failed lookup key is NOT evidence that LandOS holds no research for
// the subject. These prove the resolver exhausts the subject's own geography —
// every band its acreage belongs to, then ZIP → county → county all-acreage →
// ZIP all-acreage → state — before it reports nothing, and that it always says
// which key answered.
describe('resolveMarketMatrix — a missed lookup key is not a missing record', () => {
  beforeEach(async () => { _initTestLandosDb(); await ingestFixture(); });

  it('acreageBandsForAcres returns only bands the acreage actually belongs to', () => {
    // 60 acres is a "50+" property AND a "50–100" property; it is never 20–50.
    expect(acreageBandsForAcres(60)).toEqual(['50+', '50-100']);
    expect(acreageBandsForAcres(120)).toEqual(['50+', '100+']);
    expect(acreageBandsForAcres(3)).toEqual(['2-5']);
    // 1.5 acres belongs to 1-2 and to nothing else; it is not a 2-5 property.
    expect(acreageBandsForAcres(1.5)).toEqual(['1-2']);
    expect(acreageBandsForAcres(null)).toEqual([]);
    expect(acreageBandsForAcres(60)).not.toContain('20-50');
    expect(acreageBandsForAcres(60)[0]).toBe(acreageBandForAcres(60));
  });

  it('finds a county record filed under an equivalent band the subject also belongs to', () => {
    seed([countyRow('13215', 'Muscogee', '50-100', { salesCount: 9, medianPricePerAcre: 4100, daysOnMarket: 180, sellThroughRate: 22 })]);

    // The primary key alone misses: the store labelled it 50–100, not 50+.
    const keyMiss = resolveMarketMatrix({ state: 'GA', county: '13215', acreageBand: '50+', nowPeriod: '2026-Q2' });
    expect(keyMiss.available).toBe(false);

    const r = resolveMarketMatrix({
      state: 'GA', county: '13215', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.available).toBe(true);
    expect(r.matchLevel).toBe('county');
    expect(r.acreageBandRequested).toBe('50+');
    expect(r.acreageBandUsed).toBe('50-100');
    expect(r.facts.pricePerAcre).toBe(4100);
    expect(r.resolvedKey).toBe('county:13215');
    expect(r.resolvedKeyLabel).toBe('Muscogee County (50–100 acres)');
  });

  it('falls back to the county all-acreage record when no band record exists', () => {
    seed([countyRow('13217', 'Newton', 'all', { salesCount: 106, medianPricePerAcre: 12503, daysOnMarket: 98, sellThroughRate: 130.9 })]);
    const r = resolveMarketMatrix({
      state: 'GA', county: '13217', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.matchLevel).toBe('county_all_acreage');
    expect(r.acreageBandUsed).toBe('all');
    expect(r.resolvedKey).toBe('county:13217');
    expect(r.resolvedKeyLabel).toBe('Newton County (all acreage)');
  });

  it("uses the subject's own ZIP record when the county carries nothing at all", () => {
    seed([zipRow('30096', 'all', { salesCount: 10, medianPricePerAcre: 5995, daysOnMarket: 55, sellThroughRate: 125 })]);
    const r = resolveMarketMatrix({
      state: 'GA', county: '13219', zip: '30096', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.matchLevel).toBe('zip_all_acreage');
    expect(r.available).toBe(true);
    expect(r.facts.pricePerAcre).toBe(5995);
    expect(r.resolvedKey).toBe('zip:30096');
  });

  it('prefers the subject band over a wider band in the same geography', () => {
    seed([
      countyRow('13221', 'Oglethorpe', 'all', { medianPricePerAcre: 9000, daysOnMarket: 120 }),
      countyRow('13221', 'Oglethorpe', '50-100', { medianPricePerAcre: 4100, daysOnMarket: 180 }),
    ]);
    const r = resolveMarketMatrix({
      state: 'GA', county: '13221', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.matchLevel).toBe('county');
    expect(r.acreageBandUsed).toBe('50-100');
    expect(r.facts.pricePerAcre).toBe(4100);
  });

  it('reports unavailable only after every resolved key for the subject was tried', () => {
    const r = resolveMarketMatrix({
      state: 'GA', county: '13223', zip: '39999', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.available).toBe(false);
    expect(r.resolvedKey).toBeNull();
    expect(r.note).toContain('under any of its resolved geography keys');
    expect(r.facts.pricePerAcre).toBeNull();
    expect(r.talkingPoints).toHaveLength(0);
  });

  it('resolveMarketMatrixSection resolves from acreage, so a band-label mismatch is not missing coverage', () => {
    seed([countyRow('13225', 'Peach', '50-100', { salesCount: 9, medianPricePerAcre: 4100, daysOnMarket: 180, sellThroughRate: 22 })]);
    const section = resolveMarketMatrixSection({ state: 'GA', county: '13225', acres: 60, nowPeriod: '2026-Q2' });
    expect(section.available).toBe(true);
    expect(section.coverageLevel).toBe('county');
    expect(section.acreageBandRequested).toBe('50+ acres');
    expect(section.acreageBandUsed).toBe('50–100 acres');
    expect(section.resolvedKey).toBe('county:13225');
    expect(section.note).toContain('Peach County (50–100 acres)');
    expect(section.fields.find((f) => f.label === 'Price per Acre')?.value).toBe('$4,100');
  });

  it('never reaches a band the subject acreage does not belong to', () => {
    seed([countyRow('13227', 'Pickens', '20-50', { medianPricePerAcre: 7000, daysOnMarket: 60 })]);
    const r = resolveMarketMatrix({
      state: 'GA', county: '13227', acreageBand: '50+',
      acreageBands: acreageBandsForAcres(60), nowPeriod: '2026-Q2',
    });
    expect(r.available).toBe(false);
    expect(r.facts.pricePerAcre).toBeNull();
  });
});

// The two operator projections both hang off ONE resolution of the subject's own
// geography: a concise Property Intelligence read, and Comps & Valuation
// liquidity/competition. Nothing here is property-specific — a different subject
// resolves a different market read from its own county/ZIP/acreage.
describe('propertyMarketContextFor — operator projections from the resolved geography', () => {
  beforeEach(async () => { _initTestLandosDb(); await ingestFixture(); });

  it('projects a concise read and liquidity context from the subject band record', () => {
    seed([
      countyRow('13231', 'Pike', '50-100', { salesCount: 9, listingCount: 14, medianPricePerAcre: 4100, daysOnMarket: 180, sellThroughRate: 22, monthsOfSupply: 11 }),
      countyRow('13231', 'Pike', '50-100', { listingCount: 14, medianPricePerAcre: 5200, daysOnMarket: 140 }, 'for_sale'),
    ]);
    const ctx = propertyMarketContextFor({ county: '13231', state: 'GA', zip: null, acres: 60 });

    // The subject band record itself resolves, because 60 acres IS the 50–100 band.
    expect(ctx.subjectBand.available).toBe(true);
    expect(ctx.subjectBand.acreageBand).toBe('50-100');
    expect(ctx.geography.subjectBand).toBe('50+');

    expect(ctx.read.available).toBe(true);
    expect(ctx.read.exactSubjectBand).toBe(true);
    expect(ctx.read.resolvedKey).toBe('county:13231');
    expect(ctx.read.resolvedVia).toBe('Pike County (50–100 acres)');
    expect(ctx.read.headline).toContain('$4,100/acre');
    expect(ctx.read.headline).toContain('180-day median DOM');
    // Concise: a short read, not a research dump.
    expect(ctx.read.facts.length).toBeLessThanOrEqual(4);

    expect(ctx.liquidity.available).toBe(true);
    expect(ctx.liquidity.resolvedKey).toBe('county:13231');
    expect(ctx.liquidity.medianDaysOnMarket).toBe(180);
    expect(ctx.liquidity.sellThroughRate).toBe(22);
    expect(ctx.liquidity.liquidityLabel).toBe('Soft supply');
    expect(ctx.liquidity.competition?.activeListings).toBe(14);
    expect(ctx.liquidity.competition?.medianPricePerAcre).toBe(5200);
  });

  it('carries the read on a wider key when the subject band misses, and says which key carried it', () => {
    seed([
      countyRow('13229', 'Pierce', 'all', { salesCount: 106, listingCount: 81, medianPricePerAcre: 12503, daysOnMarket: 98, sellThroughRate: 130.9, monthsOfSupply: 9.3 }),
    ]);
    const ctx = propertyMarketContextFor({ county: '13229', state: 'GA', zip: null, acres: 60 });

    // The exact band record is still honestly unavailable...
    expect(ctx.subjectBand.available).toBe(false);
    // ...but LandOS research for this subject exists, and every surface is told
    // which key carried it rather than reading "no market record exists".
    expect(ctx.read.available).toBe(true);
    expect(ctx.read.exactSubjectBand).toBe(false);
    expect(ctx.read.matchLevel).toBe('county_all_acreage');
    expect(ctx.read.resolvedVia).toBe('Pierce County (all acreage)');
    expect(ctx.read.headline).toContain('$12,503/acre');
    expect(ctx.subjectBand.note).toContain('Pierce County (all acreage)');
    expect(ctx.interpretation).toContain('Pierce County (all acreage)');
    expect(ctx.interpretation).toContain('unproven');

    // No for-sale record exists for this geography: unmeasured, never zero.
    expect(ctx.liquidity.competition).toBeNull();
    expect(ctx.liquidity.summary).toContain('not zero');
  });

  it('resolves a different market read for a different subject geography', () => {
    seed([
      countyRow('13231', 'Pike', 'all', { medianPricePerAcre: 4100, daysOnMarket: 180 }),
      countyRow('13233', 'Polk', 'all', { medianPricePerAcre: 9900, daysOnMarket: 45 }),
    ]);
    const a = propertyMarketContextFor({ county: '13231', state: 'GA', zip: null, acres: 60 });
    const b = propertyMarketContextFor({ county: '13233', state: 'GA', zip: null, acres: 60 });
    expect(a.read.resolvedKey).toBe('county:13231');
    expect(b.read.resolvedKey).toBe('county:13233');
    expect(a.read.headline).not.toBe(b.read.headline);
    expect(b.read.headline).toContain('$9,900/acre');
  });

  it('reports honestly when no key for the subject carries anything', () => {
    const ctx = propertyMarketContextFor({ county: '13235', state: 'GA', zip: '39998', acres: 60 });
    expect(ctx.read.available).toBe(false);
    expect(ctx.read.resolvedKey).toBeNull();
    expect(ctx.read.facts).toHaveLength(0);
    expect(ctx.read.note).toContain('under any of its resolved geography keys');
    expect(ctx.liquidity.available).toBe(false);
    expect(ctx.interpretation).toContain('unproven');
  });
});
