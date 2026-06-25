// LandOS County Scorecard narration — the first live grunt-work caller.
//
// Turns the deterministic 7-metric County Scorecard into a short, human-readable
// DRAFT. This is BUSINESS intelligence (not a Deal Card output, not property-
// specific, not high-stakes). Behavior:
//   - live routing OFF  -> deterministic template (no model call); preserves the
//     current "no LLM narration" default.
//   - live routing ON   -> routed draft via gruntComplete (local Gemma preferred
//     for this low-risk summarization/research-digestion job).
//   - any non-executed result (unavailable / override-unavailable / error) ->
//     deterministic template fallback. Never fabricates beyond the computed
//     metrics; never breaks.

import { COUNTY_METRIC_KEYS, type CountyScorecardEntry } from './market-research.js';
import { gruntComplete, type GruntDeps } from './model-router-grunt.js';

const METRIC_LABELS: Record<keyof CountyScorecardEntry['metrics'], string> = {
  avgPricePerAcreUsd: 'avg price/acre',
  populationDensityPerSqMi: 'population density (/sq mi)',
  daysOnMarket: 'days on market',
  absorptionRatePct: 'absorption rate (%)',
  salesDensity3yr: 'sales density (3yr)',
  forSaleCount90d: 'for-sale count (90d)',
  sellThroughRatePct: 'sell-through rate (%)',
};

export type NarrationMode = 'model' | 'deterministic';

export interface CountyNarration {
  county: string;
  state: string;
  narration: string;
  mode: NarrationMode;
  modelId?: string;
  /** Business intelligence — never attaches to a Deal Card. */
  attachesToDealCard: false;
}

/** Deterministic, never-fabricating narration: restates the computed metrics +
 *  honest "unavailable" labels. Always available; used as the fallback. */
export function deterministicCountyNarration(entry: CountyScorecardEntry): string {
  const parts: string[] = [];
  for (const k of COUNTY_METRIC_KEYS) {
    const v = entry.metrics[k];
    const src = entry.metricSources[k];
    parts.push(v == null || src.confidence === 'unavailable' ? `${METRIC_LABELS[k]}: unavailable` : `${METRIC_LABELS[k]}: ${v}`);
  }
  const scoreLine = entry.score == null ? 'composite score: not enough data' : `composite score: ${entry.score}/100`;
  return `${entry.county} County, ${entry.state} — ${scoreLine}. ${parts.join('; ')}.`;
}

function buildPrompt(entry: CountyScorecardEntry): string {
  const facts = COUNTY_METRIC_KEYS.map((k) => {
    const v = entry.metrics[k];
    const src = entry.metricSources[k];
    return `- ${METRIC_LABELS[k]}: ${v == null || src.confidence === 'unavailable' ? 'unavailable' : v}`;
  }).join('\n');
  return [
    `Write 2-3 plain sentences summarizing this county for a land investor.`,
    `Use ONLY these computed metrics — do not invent numbers; if a metric is "unavailable", say so or omit it.`,
    `County: ${entry.county}, ${entry.state}. Composite score: ${entry.score == null ? 'n/a' : entry.score + '/100'}.`,
    facts,
  ].join('\n');
}

export interface NarrateCountyDeps extends GruntDeps {}

/**
 * Narrate a County Scorecard entry. Business intelligence; never attaches to a
 * Deal Card. Routed only when live routing is enabled; deterministic otherwise
 * and on any non-executed outcome.
 */
export async function narrateCountyScorecard(entry: CountyScorecardEntry, deps: NarrateCountyDeps = {}): Promise<CountyNarration> {
  const fallback: CountyNarration = {
    county: entry.county, state: entry.state,
    narration: deterministicCountyNarration(entry),
    mode: 'deterministic', attachesToDealCard: false,
  };

  const res = await gruntComplete(
    {
      prompt: buildPrompt(entry),
      taskType: 'market_research',
      needs: { summarization: 0.7, researchDigestion: 0.6 },
      stakes: 'low',
      estimatedConfidence: 0.9,
    },
    deps,
  );

  if (!res.ran) return fallback;
  if (res.outcome.status !== 'executed' || !res.outcome.result?.text?.trim()) return fallback;
  return {
    county: entry.county, state: entry.state,
    narration: res.outcome.result.text.trim(),
    mode: 'model',
    modelId: res.outcome.executedModelId,
    attachesToDealCard: false,
  };
}
