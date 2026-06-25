import { describe, it, expect } from 'vitest';
import { getCapabilityEntry } from './model-capabilities.js';
import {
  blendCapability,
  adjustWeights,
  sourcedProfileFor,
  effectiveProfile,
  InMemoryExtraSourceStore,
  InMemoryOperatorSatisfactionStore,
  DEFAULT_WEIGHTS,
  type CapabilitySample,
} from './capability-scoring.js';

const seed = (v: number): CapabilitySample => ({ kind: 'landos_seeded', value: v, lastUpdated: '2026-06-25' });

describe('capability provenance + blending', () => {
  it('seeded-only effective score equals the seed (preserves existing routing)', () => {
    const claude = getCapabilityEntry('claude')!.profile;
    const eff = effectiveProfile('claude', claude);
    expect(eff.reasoning).toBeCloseTo(claude.reasoning, 5);
    const sourced = sourcedProfileFor('claude', claude);
    expect(sourced.reasoning.sources[0].kind).toBe('landos_seeded');
    expect(sourced.reasoning.confidence).toBe('heuristic');
  });

  it('operator override wins outright', () => {
    const out = blendCapability([seed(0.5), { kind: 'operator_override', value: 0.95, lastUpdated: '2026-06-25' }]);
    expect(out.effectiveScore).toBe(0.95);
    expect(out.confidence).toBe('measured');
  });

  it('blends provider + benchmark + observed by weight', () => {
    const out = blendCapability([
      { kind: 'provider_metadata', value: 0.9, lastUpdated: '2026-06-25' },
      { kind: 'public_benchmark', value: 0.8, lastUpdated: '2026-06-25' },
      { kind: 'landos_observed', value: 0.6, lastUpdated: '2026-06-25', sampleSize: 1 },
    ]);
    // 0.9*.3 + 0.8*.2 + 0.6*.5 = 0.73 (sampleSize 1 -> weights ~unchanged)
    expect(out.effectiveScore).toBeCloseTo(0.73, 2);
    expect(out.confidence).toBe('heuristic');
  });

  it('flips to measured once enough observed history exists', () => {
    const out = blendCapability([seed(0.7), { kind: 'landos_observed', value: 0.65, lastUpdated: '2026-06-25', sampleSize: 25 }]);
    expect(out.confidence).toBe('measured');
  });

  it('shifts weight toward observed as history grows', () => {
    const base = adjustWeights(0);
    const grown = adjustWeights(200);
    expect(grown.observed).toBeGreaterThan(base.observed);
    expect(grown.provider).toBeLessThan(base.provider);
  });

  it('extra observed sources move the effective profile and are traceable', () => {
    const store = new InMemoryExtraSourceStore();
    store.add('gemma-4-e4b', 'summarization', { kind: 'landos_observed', value: 0.95, lastUpdated: '2026-06-25', sampleSize: 30 });
    const sourced = sourcedProfileFor('gemma-4-e4b', getCapabilityEntry('gemma-4-e4b')!.profile, store);
    expect(sourced.summarization.sources.some((s) => s.kind === 'landos_observed')).toBe(true);
    expect(sourced.summarization.confidence).toBe('measured');
  });
});

describe('operator satisfaction (separate track from technical performance)', () => {
  it('accumulates an acceptance rate independently', () => {
    const sat = new InMemoryOperatorSatisfactionStore();
    sat.record('gpt', true);
    sat.record('gpt', false);
    sat.record('gpt', true);
    const s = sat.get('gpt')!;
    expect(s.sampleSize).toBe(3);
    expect(s.score).toBeCloseTo(2 / 3, 5);
  });
});

describe('default weights are 30/20/50', () => {
  it('matches the spec', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ provider: 0.3, benchmark: 0.2, observed: 0.5 });
  });
});
