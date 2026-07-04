import { describe, it, expect } from 'vitest';
import {
  validateMarketSnapshot,
  executeMarketQuery,
  explainMarketResults,
  parseMarketQuery,
  defaultMarketQuery,
  snapshotKey,
  emptyMetrics,
  type MarketSnapshotPayload,
  type ResolvedCountySnapshot,
  type MarketQuery,
} from './market-matrix.js';

function validPayload(over: Partial<MarketSnapshotPayload> = {}): MarketSnapshotPayload {
  return {
    geography: { level: 'county', state: 'GA', fips: '13089', county: 'DeKalb' },
    acreageBand: '2-5', side: 'sold', period: '2026-Q2', confidence: 'high',
    metrics: { salesCount: 42, medianPricePerAcre: 121500, daysOnMarket: 78, sellThroughRate: 41 },
    provenance: { provider: 'browser_agent:landportal', sourceRef: 'ref', extractionTimestamp: '2026-07-01T14:32:00Z', agentRunId: 'run1' },
    ...over,
  };
}

describe('validateMarketSnapshot', () => {
  it('accepts a well-formed county payload and normalizes metrics', () => {
    const r = validateMarketSnapshot(validPayload());
    expect(r.valid).toBe(true);
    expect(r.normalized?.metrics.salesCount).toBe(42);
    expect(r.normalized?.metrics.population).toBeNull(); // unknown → null, never 0
    expect(r.normalized?.key).toBe(snapshotKey({ geography: { level: 'county', state: 'GA', fips: '13089' }, acreageBand: '2-5', side: 'sold', period: '2026-Q2' }));
  });

  it('rejects a county payload with no FIPS (broken geography)', () => {
    const r = validateMarketSnapshot(validPayload({ geography: { level: 'county', state: 'GA' } as any }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/5-digit FIPS/);
  });

  it('rejects a FIPS that does not belong to the stated state', () => {
    const r = validateMarketSnapshot(validPayload({ geography: { level: 'county', state: 'SC', fips: '13089', county: 'DeKalb' } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/does not belong to state SC/);
  });

  it('rejects impossible / out-of-hard-range metric values (never clamps)', () => {
    // STR > 100 is NOT impossible (LandPortal: sold ÷ listed) → accepted + FLAGGED.
    const r1 = validateMarketSnapshot(validPayload({ metrics: { sellThroughRate: 150 } }));
    expect(r1.valid).toBe(true);
    expect(r1.flags.join(' ')).toMatch(/exceeds the usual 0–100%/);
    // But a garbage STR (a parse error, e.g. a $ read as %) is outside the hard cap → rejected.
    const rGarbage = validateMarketSnapshot(validPayload({ metrics: { sellThroughRate: 45016 } }));
    expect(rGarbage.valid).toBe(false);
    expect(rGarbage.errors.join(' ')).toMatch(/impossible/);
    // Negative $/acre is impossible → rejected.
    const r2 = validateMarketSnapshot(validPayload({ metrics: { medianPricePerAcre: -5 } }));
    expect(r2.valid).toBe(false);
    const r3 = validateMarketSnapshot(validPayload({ metrics: { salesCount: Number.POSITIVE_INFINITY } }));
    expect(r3.valid).toBe(false);
  });

  it('flags accepted-but-unusual values (STR/AR > 100%) without losing them', () => {
    const r = validateMarketSnapshot(validPayload({ metrics: { sellThroughRate: 126.36, absorptionRate: 120 } }));
    expect(r.valid).toBe(true);
    expect(r.normalized?.metrics.sellThroughRate).toBe(126.36); // value preserved, not clamped
    expect(r.normalized?.flags.length).toBe(2);
    // a clean record carries no flags
    expect(validateMarketSnapshot(validPayload()).flags).toEqual([]);
  });

  it('rejects missing required fields and a bad period', () => {
    const r = validateMarketSnapshot(validPayload({ period: '2026Q2' as any, confidence: undefined as any, provenance: { provider: '', sourceRef: '', extractionTimestamp: 'nope', agentRunId: '' } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/period must be YYYY-Qn/);
    expect(r.errors.join(' ')).toMatch(/provenance.provider is required/);
    expect(r.errors.join(' ')).toMatch(/extractionTimestamp/);
  });
});

function snap(fips: string, name: string, state: string, m: Partial<ReturnType<typeof emptyMetrics>>): ResolvedCountySnapshot {
  return { fips, countyName: name, state, period: '2026-Q2', confidence: 'high', provider: 'x', lastUpdated: '', metrics: { ...emptyMetrics(), ...m } };
}

describe('executeMarketQuery', () => {
  const snaps: ResolvedCountySnapshot[] = [
    snap('13089', 'DeKalb', 'GA', { medianPricePerAcre: 121500, sellThroughRate: 41 }),
    snap('45007', 'Anderson', 'SC', { medianPricePerAcre: 34000, sellThroughRate: 48 }),
    snap('47149', 'Rutherford', 'TN', { medianPricePerAcre: 61000, sellThroughRate: 61 }),
    snap('13245', 'Richmond', 'GA', { sellThroughRate: 38 }), // missing PPA → excluded when sort/threshold needs it
  ];

  it('ranks ascending by the sort metric and excludes counties missing needed data', () => {
    const q: MarketQuery = { ...defaultMarketQuery(), sort: { metric: 'medianPricePerAcre', direction: 'asc' } };
    const res = executeMarketQuery(snaps, q);
    expect(res.results.map((r) => r.fips)).toEqual(['45007', '47149', '13089']);
    expect(res.results[0].rank).toBe(1);
    // Richmond excluded for missing PPA, NOT treated as zero / rank 1.
    expect(res.excluded.map((e) => e.fips)).toContain('13245');
    expect(res.excluded.find((e) => e.fips === '13245')?.reasons.join(' ')).toMatch(/Median \$\/acre/);
  });

  it('applies thresholds as filters (distinct from missing-data exclusion)', () => {
    const q: MarketQuery = { ...defaultMarketQuery(), thresholds: [{ metric: 'sellThroughRate', op: 'gte', value: 45 }], sort: { metric: 'sellThroughRate', direction: 'desc' } };
    const res = executeMarketQuery(snaps, q);
    // Richmond has sellThroughRate 38 but no PPA — needs sellThroughRate only now, so it's evaluated and filtered (fails >=45), not excluded.
    expect(res.results.map((r) => r.fips)).toEqual(['47149', '45007']);
    expect(res.excluded.map((e) => e.fips)).not.toContain('13245');
  });

  it('honors a limit and scope', () => {
    const q: MarketQuery = { ...defaultMarketQuery(), scope: { states: ['GA'] }, sort: { metric: 'medianPricePerAcre', direction: 'asc' }, limit: 1 };
    const res = executeMarketQuery(snaps, q);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].state).toBe('GA');
  });
});

describe('explainMarketResults matches the deterministic result exactly', () => {
  it('explains every ranked county with its exact rank and values', () => {
    const snaps: ResolvedCountySnapshot[] = [
      snap('45007', 'Anderson', 'SC', { medianPricePerAcre: 34000 }),
      snap('47149', 'Rutherford', 'TN', { medianPricePerAcre: 61000 }),
    ];
    const q: MarketQuery = { ...defaultMarketQuery(), sort: { metric: 'medianPricePerAcre', direction: 'asc' } };
    const res = executeMarketQuery(snaps, q);
    const exp = explainMarketResults(res);
    expect(exp.perCounty).toHaveLength(res.results.length);
    for (const r of res.results) {
      const e = exp.perCounty.find((p) => p.fips === r.fips)!;
      expect(e).toBeTruthy();
      expect(e.rank).toBe(r.rank);
      // The explanation references the exact sort value from the result row.
      expect(e.why).toContain(`$${Math.round(r.sortValue).toLocaleString()}`);
    }
  });
});

describe('parseMarketQuery (natural language → MarketQuery)', () => {
  it('parses top-N, acreage band, thresholds, sort intent, and state scope', () => {
    const { query, recognized } = parseMarketQuery('Top 20 counties in Tennessee for 2-5 acre flips with STR above 45% and DOM under 60');
    expect(query.limit).toBe(20);
    expect(query.acreageBand).toBe('2-5');
    expect(query.scope.states).toContain('TN');
    expect(query.thresholds.find((t) => t.metric === 'sellThroughRate')?.value).toBe(45);
    expect(query.thresholds.find((t) => t.metric === 'daysOnMarket')?.op).toBe('lt');
    expect(recognized.length).toBeGreaterThan(0);
  });

  it('maps "low price per acre" to an ascending PPA sort', () => {
    const { query } = parseMarketQuery('cheapest land, lowest price per acre in Georgia');
    expect(query.sort).toEqual({ metric: 'medianPricePerAcre', direction: 'asc' });
    expect(query.scope.states).toContain('GA');
  });

  it('maps population growth intent to a descending growth sort', () => {
    const { query } = parseMarketQuery('fastest growing counties by population growth');
    expect(query.sort).toEqual({ metric: 'populationGrowth', direction: 'desc' });
  });
});
