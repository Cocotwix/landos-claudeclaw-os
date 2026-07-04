import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { makeFixtureMarketProvider } from './market-browser-provider.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import { resolveMarketMatrix, currentPeriod, acreageBandForAcres, buildMarketMatrixReportSection, resolveMarketMatrixSection } from './market-matrix-read.js';

async function ingestFixture() {
  const extraction = await makeFixtureMarketProvider().extract();
  ingestMarketSnapshots(extraction.snapshots);
}

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

  it('acreageBandForAcres maps acres → band (default 2-5)', () => {
    expect(acreageBandForAcres(3)).toBe('2-5');
    expect(acreageBandForAcres(7)).toBe('5-10');
    expect(acreageBandForAcres(15)).toBe('10-20');
    expect(acreageBandForAcres(80)).toBe('50+');
    expect(acreageBandForAcres(null)).toBe('2-5');
    expect(acreageBandForAcres(1)).toBe('2-5'); // below 5 → closest supported band
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
  });
});
