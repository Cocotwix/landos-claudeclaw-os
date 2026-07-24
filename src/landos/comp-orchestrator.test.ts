import { describe, it, expect } from 'vitest';
import {
  runCompProvidersParallel,
  labeledPricePerAcre,
  distanceMilesFromSubject,
  classifyNonSelected,
} from './comp-orchestrator.js';
import { buildCompRegistry } from './comp-registry.js';

describe('runCompProvidersParallel', () => {
  it('runs providers concurrently — a slow provider does not delay a fast one from starting', async () => {
    const order: string[] = [];
    const runs = await runCompProvidersParallel([
      { provider: 'Zillow', run: async () => { await new Promise((r) => setTimeout(r, 40)); order.push('zillow'); return ['z1']; } },
      { provider: 'Redfin', run: async () => { order.push('redfin'); return ['r1', 'r2']; } },
    ]);
    expect(order[0]).toBe('redfin'); // fast one finished first though listed second
    expect(runs.map((r) => r.provider)).toEqual(['Zillow', 'Redfin']); // stable order in the audit
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
  });

  it('a throwing provider becomes a failed run and never ends the mission', async () => {
    const runs = await runCompProvidersParallel([
      { provider: 'Zillow', run: async () => { throw new Error('blocked by bot check'); } },
      { provider: 'Redfin', run: async () => [1, 2, 3] },
    ]);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].note).toMatch(/blocked by bot check/);
    expect(runs[0].note).toMatch(/other providers were not affected/i);
    expect(runs[1].status).toBe('succeeded');
    expect(runs[1].result).toEqual([1, 2, 3]);
  });

  it('a hung provider times out at its budget without holding the mission', async () => {
    const runs = await runCompProvidersParallel([
      { provider: 'County recorded sales', run: () => new Promise(() => { /* hangs */ }) },
      { provider: 'LandPortal visible', run: async () => ['row'] },
    ], { perProviderTimeoutMs: 40 });
    expect(runs[0].status).toBe('timeout');
    expect(runs[0].note).toMatch(/budget/i);
    expect(runs[1].status).toBe('succeeded');
  });
});

describe('labeledPricePerAcre — the single PPA rule', () => {
  it('labels sold, asking, and pending PPA correctly', () => {
    expect(labeledPricePerAcre('sold', 100_000, 20)?.label).toBe('Sold PPA');
    expect(labeledPricePerAcre('list', 100_000, 20)?.label).toBe('Asking PPA');
    expect(labeledPricePerAcre('pending', 100_000, 20)?.label).toBe('Pending Asking PPA');
  });
  it('preserves raw precision and rounds only the display', () => {
    const ppa = labeledPricePerAcre('sold', 100_000, 3);
    expect(ppa?.value).toBeCloseTo(33333.333, 2);
    expect(ppa?.display).toBe('$33,300/ac');
  });
  it('NEVER fabricates a PPA when price or acreage is missing/zero/invalid', () => {
    expect(labeledPricePerAcre('sold', null, 20)).toBeNull();
    expect(labeledPricePerAcre('sold', 100_000, null)).toBeNull();
    expect(labeledPricePerAcre('sold', 100_000, 0)).toBeNull();
    expect(labeledPricePerAcre('sold', 0, 20)).toBeNull();
    expect(labeledPricePerAcre('sold', -5, 20)).toBeNull();
    expect(labeledPricePerAcre('sold', 100_000, Number.NaN)).toBeNull();
  });
});

describe('distanceMilesFromSubject', () => {
  it('computes straight-line miles when both ends have coordinates', () => {
    const d = distanceMilesFromSubject({ lat: 34.9, lng: -82.7 }, { lat: 34.9, lng: -82.68 });
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2.5);
  });
  it('returns null (never fabricates) when either end lacks coordinates', () => {
    expect(distanceMilesFromSubject({ lat: 34.9, lng: -82.7 }, {})).toBeNull();
    expect(distanceMilesFromSubject(null, { lat: 34.9, lng: -82.7 })).toBeNull();
  });
});

describe('classifyNonSelected — nothing silently discarded', () => {
  const subject = { state: 'SC', county: 'Pickens', acres: 10 };
  const cand = (over: Record<string, unknown>) => ({
    provider: 'Zillow', lane: 'sold' as const, addressDesc: '1 Test Rd, Pickens, SC', state: 'SC',
    price: 50_000, priceKind: 'sold', saleOrListDate: '2026-01-15', acres: 9,
    sourceUrl: 'https://example.com/verified-sale', ...over,
  });

  it('classifies non-selected solds, actives, duplicates, and rejected with reasons', () => {
    const registry = buildCompRegistry(subject, [
      cand({ addressDesc: '1 Ridge Rd, Pickens, SC', acres: 9.5 }),                       // direct sold
      cand({ addressDesc: '2 Ridge Rd, Pickens, SC', acres: 0.4 }),                       // small-lot context
      cand({ addressDesc: '3 Ridge Rd, Pickens, SC', lane: 'active', priceKind: 'list' }),// active context
      cand({ addressDesc: '1 Ridge Rd, Pickens, SC', provider: 'Redfin', acres: 9.5 }),   // duplicate of #1
      cand({ addressDesc: '9 Far Ln, Austin, TX', state: 'TX' }),                         // wrong market → rejected
    ]);
    const out = classifyNonSelected(registry, new Set()); // nothing selected
    const classes = out.map((o) => o.classification);
    expect(classes).toContain('secondary_sold');
    expect(classes).toContain('small_lot_context');
    expect(classes).toContain('active_context');
    expect(classes).toContain('duplicate');
    expect(classes).toContain('rejected');
    expect(out.every((o) => o.reason.length > 5)).toBe(true);
  });

  it('selected keys are excluded from the non-selected list', () => {
    const registry = buildCompRegistry(subject, [cand({})]);
    const all = classifyNonSelected(registry, new Set());
    const selectedKey = registry.validatedSold[0]?.key;
    expect(selectedKey).toBeTruthy();
    const none = classifyNonSelected(registry, new Set([selectedKey!]));
    expect(all.some((o) => o.key === selectedKey)).toBe(true);
    expect(none.some((o) => o.key === selectedKey)).toBe(false);
  });
});
