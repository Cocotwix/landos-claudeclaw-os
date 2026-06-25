import { describe, it, expect, vi } from 'vitest';
import { COUNTY_METRIC_KEYS, type CountyScorecardEntry } from './market-research.js';
import { narrateCountyScorecard, deterministicCountyNarration } from './market-research-narration.js';
import type { RoutedTaskOutcome } from './model-router-service.js';

function entry(overrides: Partial<CountyScorecardEntry> = {}): CountyScorecardEntry {
  const metricSources = Object.fromEntries(
    COUNTY_METRIC_KEYS.map((k) => [k, { source: 'apify_landwatch', confidence: 'reported' as const }]),
  ) as CountyScorecardEntry['metricSources'];
  return {
    county: 'Worth', state: 'GA', fips: '13321',
    metrics: { avgPricePerAcreUsd: 4000, populationDensityPerSqMi: 90, daysOnMarket: 70, absorptionRatePct: 55, salesDensity3yr: 450, forSaleCount90d: 30, sellThroughRatePct: 52 },
    metricSources, score: 100, generatedAt: '2026-06-25T00:00:00.000Z', notes: [],
    ...overrides,
  };
}

const executed = (text: string, modelId: string): RoutedTaskOutcome =>
  ({ status: 'executed', decision: {} as any, result: { text, modelId }, executedModelId: modelId, liveRouting: true });

describe('deterministic county narration (always available, never fabricates)', () => {
  it('restates computed metrics + composite score', () => {
    const n = deterministicCountyNarration(entry());
    expect(n).toContain('Worth County, GA');
    expect(n).toContain('composite score: 100/100');
    expect(n).toContain('avg price/acre: 4000');
  });
  it('marks unavailable metrics honestly', () => {
    const e = entry({
      metrics: { ...entry().metrics, avgPricePerAcreUsd: null },
      metricSources: { ...entry().metricSources, avgPricePerAcreUsd: { source: '(none)', confidence: 'unavailable' } },
    });
    expect(deterministicCountyNarration(e)).toContain('avg price/acre: unavailable');
  });
});

describe('narrateCountyScorecard', () => {
  it('uses the deterministic template when live routing is disabled (no model call)', async () => {
    const execute = vi.fn();
    const n = await narrateCountyScorecard(entry(), { enabled: () => false, execute });
    expect(n.mode).toBe('deterministic');
    expect(execute).not.toHaveBeenCalled();
    expect(n.attachesToDealCard).toBe(false);
  });

  it('uses the routed model draft when enabled and execution succeeds', async () => {
    const execute = vi.fn(async () => executed('Worth County looks strong for land flips.', 'gemma-4-e4b'));
    const n = await narrateCountyScorecard(entry(), { enabled: () => true, execute });
    expect(n.mode).toBe('model');
    expect(n.modelId).toBe('gemma-4-e4b');
    expect(n.narration).toContain('Worth County looks strong');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('falls back to deterministic on a non-executed outcome (e.g. override unavailable)', async () => {
    const execute = vi.fn(async () => ({ status: 'override_unavailable', decision: {} as any, liveRouting: true } as RoutedTaskOutcome));
    const n = await narrateCountyScorecard(entry(), { enabled: () => true, execute });
    expect(n.mode).toBe('deterministic');
  });

  it('falls back to deterministic when the model returns empty text', async () => {
    const execute = vi.fn(async () => executed('   ', 'gemma-4-e4b'));
    const n = await narrateCountyScorecard(entry(), { enabled: () => true, execute });
    expect(n.mode).toBe('deterministic');
  });

  it('never attaches to a Deal Card (business intelligence)', async () => {
    const n = await narrateCountyScorecard(entry(), { enabled: () => false });
    expect(n.attachesToDealCard).toBe(false);
  });
});
