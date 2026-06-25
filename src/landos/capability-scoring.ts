// LandOS capability provenance + scoring.
//
// Every capability value carries PROVENANCE: where it came from, how confident
// we are, when it was last updated, and the blended effective score. LandOS never
// invents capabilities — a score with no source is not allowed. Sources are
// blended by weight; operator overrides win outright; as real LandOS observed
// performance accumulates, weighting shifts toward it (and confidence flips from
// heuristic to measured). Operator SATISFACTION is tracked as a SEPARATE track
// from technical performance (a model can be technically strong yet get rewritten
// a lot). Pure + deterministic; no model calls.

import { CAPABILITY_DIMENSIONS, type CapabilityProfile, type CapabilityDimension } from './model-capabilities.js';

export type CapabilitySourceKind =
  | 'provider_metadata'
  | 'provider_docs'
  | 'public_benchmark'
  | 'landos_seeded'
  | 'landos_observed'
  | 'operator_override';

export interface CapabilitySample {
  kind: CapabilitySourceKind;
  value: number;          // 0..1
  lastUpdated: string;    // ISO date
  note?: string;
  /** For observed samples: how many runs back this value. */
  sampleSize?: number;
}

export interface SourcedCapability {
  effectiveScore: number;
  confidence: 'heuristic' | 'measured';
  lastUpdated: string;
  sources: CapabilitySample[];
}

export interface ScoringWeights {
  provider: number;   // provider_metadata + provider_docs
  benchmark: number;  // public_benchmark
  observed: number;   // landos_observed (seeded stands in until observed exists)
}

export const DEFAULT_WEIGHTS: ScoringWeights = { provider: 0.3, benchmark: 0.2, observed: 0.5 };
/** Observed sample count at/above which a capability is considered 'measured'. */
export const MEASURED_THRESHOLD = 20;
export const SEED_DATE = '2026-06-25';

/** As observed history grows, shift weight toward observed and away from provider
 *  metadata + public benchmarks (LandOS trusts its own evidence more over time). */
export function adjustWeights(observedSampleSize: number, base: ScoringWeights = DEFAULT_WEIGHTS): ScoringWeights {
  if (observedSampleSize <= 0) return base;
  const shift = Math.min(0.4, (observedSampleSize / 200) * 0.4);
  const denom = base.provider + base.benchmark || 1;
  const fromProvider = shift * (base.provider / denom);
  const fromBenchmark = shift - fromProvider;
  return {
    provider: Math.max(0, base.provider - fromProvider),
    benchmark: Math.max(0, base.benchmark - fromBenchmark),
    observed: Math.min(1, base.observed + shift),
  };
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function maxIso(xs: string[]): string {
  return xs.reduce((a, b) => (b > a ? b : a), xs[0] ?? new Date(0).toISOString());
}

/** Blend the sources for one capability into an effective score with provenance. */
export function blendCapability(samples: CapabilitySample[], base: ScoringWeights = DEFAULT_WEIGHTS): SourcedCapability {
  if (samples.length === 0) {
    return { effectiveScore: 0, confidence: 'heuristic', lastUpdated: new Date(0).toISOString(), sources: [] };
  }
  const lastUpdated = maxIso(samples.map((s) => s.lastUpdated));

  // Operator override wins outright (manual control over the router's beliefs).
  const override = samples.find((s) => s.kind === 'operator_override');
  if (override) return { effectiveScore: override.value, confidence: 'measured', lastUpdated, sources: samples };

  const providerVal = avg(samples.filter((s) => s.kind === 'provider_metadata' || s.kind === 'provider_docs').map((s) => s.value));
  const benchVal = avg(samples.filter((s) => s.kind === 'public_benchmark').map((s) => s.value));
  const observed = samples.filter((s) => s.kind === 'landos_observed');
  const seeded = samples.filter((s) => s.kind === 'landos_seeded');
  const observedSize = observed.reduce((n, s) => n + (s.sampleSize ?? 1), 0);
  // Seeded assumptions stand in for the observed slot until real observed exists.
  const observedVal = observed.length ? avg(observed.map((s) => s.value)) : (seeded.length ? avg(seeded.map((s) => s.value)) : null);

  const w = adjustWeights(observedSize, base);
  const parts: Array<[number, number]> = [];
  if (providerVal != null) parts.push([providerVal, w.provider]);
  if (benchVal != null) parts.push([benchVal, w.benchmark]);
  if (observedVal != null) parts.push([observedVal, w.observed]);
  const totalW = parts.reduce((a, [, wt]) => a + wt, 0) || 1;
  const effectiveScore = parts.reduce((a, [v, wt]) => a + v * wt, 0) / totalW;
  const confidence: 'heuristic' | 'measured' = observedSize >= MEASURED_THRESHOLD ? 'measured' : 'heuristic';
  return { effectiveScore, confidence, lastUpdated, sources: samples };
}

/** Extra (beyond-seed) capability sources, e.g. observed/benchmark/override added
 *  at runtime by the AI Tech Researcher or the telemetry feedback loop. */
export interface ExtraSourceStore {
  get(modelId: string, dim: CapabilityDimension): CapabilitySample[];
}
export class InMemoryExtraSourceStore implements ExtraSourceStore {
  private m = new Map<string, CapabilitySample[]>();
  private k(modelId: string, dim: CapabilityDimension) { return `${modelId}::${dim}`; }
  get(modelId: string, dim: CapabilityDimension) { return this.m.get(this.k(modelId, dim)) ?? []; }
  add(modelId: string, dim: CapabilityDimension, s: CapabilitySample) {
    const arr = this.m.get(this.k(modelId, dim)) ?? [];
    arr.push(s);
    this.m.set(this.k(modelId, dim), arr);
  }
}

/** Build the full sourced profile for a model: seeded baseline + any extra
 *  sources, blended per dimension. The seed profile (model-capabilities.ts) is
 *  recorded as a 'landos_seeded' source so every value is traceable. */
export function sourcedProfileFor(
  modelId: string,
  seedProfile: CapabilityProfile,
  extra?: ExtraSourceStore,
): Record<CapabilityDimension, SourcedCapability> {
  const out = {} as Record<CapabilityDimension, SourcedCapability>;
  for (const d of CAPABILITY_DIMENSIONS) {
    const seedSample: CapabilitySample = { kind: 'landos_seeded', value: seedProfile[d], lastUpdated: SEED_DATE, note: 'initial seeded assumption' };
    out[d] = blendCapability([seedSample, ...(extra?.get(modelId, d) ?? [])]);
  }
  return out;
}

/** Flat effective profile (what the router consumes). Seeded-only -> equals the
 *  seed values, so existing routing behavior is preserved exactly. */
export function effectiveProfile(modelId: string, seedProfile: CapabilityProfile, extra?: ExtraSourceStore): CapabilityProfile {
  const sourced = sourcedProfileFor(modelId, seedProfile, extra);
  const out = {} as CapabilityProfile;
  for (const d of CAPABILITY_DIMENSIONS) out[d] = sourced[d].effectiveScore;
  return out;
}

// ── Operator satisfaction (tracked SEPARATELY from technical performance) ──────
export interface OperatorSatisfaction {
  /** 0..1 acceptance/satisfaction rate (e.g. fraction of outputs kept un-rewritten). */
  score: number;
  sampleSize: number;
  lastUpdated: string;
}
export interface OperatorSatisfactionStore {
  get(modelId: string): OperatorSatisfaction | null;
}
export class InMemoryOperatorSatisfactionStore implements OperatorSatisfactionStore {
  private m = new Map<string, OperatorSatisfaction>();
  get(modelId: string) { return this.m.get(modelId) ?? null; }
  /** Fold one acceptance outcome (true=kept, false=rewritten) into the running rate. */
  record(modelId: string, accepted: boolean, at: string = new Date().toISOString()) {
    const cur = this.m.get(modelId) ?? { score: 0, sampleSize: 0, lastUpdated: at };
    const n = cur.sampleSize + 1;
    const score = (cur.score * cur.sampleSize + (accepted ? 1 : 0)) / n;
    this.m.set(modelId, { score, sampleSize: n, lastUpdated: at });
  }
}
