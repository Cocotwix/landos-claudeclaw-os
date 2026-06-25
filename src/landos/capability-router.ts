// LandOS capability-based model router.
//
// Routes a job to a model by the CAPABILITIES it requires + its risk, not by a
// fixed task label. Order of precedence:
//   1. Manual operator override ALWAYS wins (and is never silently substituted —
//      if unavailable, we report and let the operator decide).
//   2. High-stakes work defaults to Claude (closed reasoning) — preserved until
//      explicitly approved to change.
//   3. Low confidence / ambiguity / media nuance escalates to a stronger model.
//   4. Otherwise prefer local/open-source when "close enough" to the best
//      available closed model on the REQUIRED capabilities.
//   5. Fall back to the best available model if nothing meets the needs.
// Pure + deterministic. Makes no model call. Availability is injected.

import {
  MODEL_CAPABILITIES,
  getCapabilityEntry,
  meetsNeeds,
  type CapabilityProfile,
  type CapabilityDimension,
  type ModelCapabilityEntry,
} from './model-capabilities.js';

export type Stakes = 'low' | 'medium' | 'high';
export type Modality = 'text' | 'vision' | 'audio' | 'speech' | 'multimodal';

export interface JobRequirements {
  /** Required minimum capability levels (0..1). The router selects on these. */
  needs: Partial<CapabilityProfile>;
  /** Financial / legal / business risk. 'high' defaults to Claude. */
  stakes?: Stakes;
  ambiguity?: 'clear' | 'ambiguous';
  /** Pre-run confidence estimate (0..1), if known. Low confidence escalates. */
  estimatedConfidence?: number;
  modality?: Modality;
  requiresLongContext?: boolean;
  /** For media jobs: poor input or nuance sensitivity escalates to closed. */
  inputQuality?: 'good' | 'poor';
  nuanceSensitive?: boolean;
  /** Manual override — always wins (see precedence above). */
  operatorOverrideModelId?: string;
}

export interface RouteCandidate {
  modelId: string;
  meetsNeeds: boolean;
  available: boolean;
  score: number;
}

export interface RouteDecision {
  chosenModelId: string | null;
  source: 'override' | 'capability_match' | 'escalated' | 'fallback';
  available: boolean;
  escalated: boolean;
  escalationReason?: string;
  openSourcePreferred: boolean;
  closedSourceReason?: string;
  /** Set when an operator override was chosen but is unavailable (NOT substituted). */
  unavailableSelected?: string;
  requiredDimensions: CapabilityDimension[];
  candidatesConsidered: RouteCandidate[];
  notes: string[];
}

export interface RouteOptions {
  /** Availability predicate (from the execution layer / config). Default: only
   *  Claude is wired/available, reflecting the current install. */
  available?: (modelId: string) => boolean;
  /** "Close enough" delta: a local model within this of the best closed model on
   *  the required capabilities is preferred. */
  closeEnough?: number;
  /** Confidence below this escalates. */
  lowConfidence?: number;
}

const DEFAULT_AVAILABLE = (id: string) => id === 'claude';
const HIGH_STAKES_DEFAULT = 'claude';

function requiredDims(needs: Partial<CapabilityProfile>): CapabilityDimension[] {
  const dims = Object.keys(needs) as CapabilityDimension[];
  return dims.length ? dims : ['reasoning'];
}

function modalityOk(p: CapabilityProfile, modality?: Modality): boolean {
  switch (modality) {
    case 'vision': return p.vision > 0;
    case 'audio': return p.audio > 0;
    case 'speech': return p.speech > 0;
    case 'multimodal': return p.vision > 0 && p.audio > 0;
    default: return true; // 'text' or unspecified
  }
}

function scoreOn(p: CapabilityProfile, dims: CapabilityDimension[]): number {
  return dims.reduce((s, d) => s + p[d], 0) / dims.length;
}

export function routeByCapability(req: JobRequirements, opts: RouteOptions = {}): RouteDecision {
  const available = opts.available ?? DEFAULT_AVAILABLE;
  const lowConfidence = opts.lowConfidence ?? 0.6;
  const dims = requiredDims(req.needs);
  const notes: string[] = [];

  const candidates: RouteCandidate[] = MODEL_CAPABILITIES.map((m) => ({
    modelId: m.modelId,
    meetsNeeds: modalityOk(m.profile, req.modality) && meetsNeeds(m.profile, req.needs),
    available: available(m.modelId),
    score: scoreOn(m.profile, dims),
  }));
  const base = (id: string | null): RouteDecision => ({
    chosenModelId: id,
    source: 'fallback',
    available: id ? available(id) : false,
    escalated: false,
    openSourcePreferred: false,
    requiredDimensions: dims,
    candidatesConsidered: candidates,
    notes,
  });

  // 1. Manual override — always wins, never silently substituted.
  if (req.operatorOverrideModelId) {
    const id = req.operatorOverrideModelId;
    const known = !!getCapabilityEntry(id);
    const avail = available(id);
    if (!known) notes.push(`operator override "${id}" is not a known model id`);
    notes.push(avail
      ? 'operator override honored'
      : `operator-selected model "${id}" is unavailable — NOT substituting; operator decides how to proceed`);
    return {
      ...base(id),
      source: 'override',
      available: avail,
      openSourcePreferred: getCapabilityEntry(id)?.openSource ?? false,
      unavailableSelected: avail ? undefined : id,
    };
  }

  const eligible = candidates.filter((c) => c.meetsNeeds && c.available);
  const entryOf = (id: string) => getCapabilityEntry(id) as ModelCapabilityEntry;
  const bestAvailable = (pool: RouteCandidate[]): RouteCandidate | undefined =>
    [...pool].sort((a, b) => b.score - a.score)[0];

  // 2. High-stakes -> Claude default (hard rule: not replaced until approved).
  if (req.stakes === 'high') {
    if (available(HIGH_STAKES_DEFAULT)) {
      notes.push('high-stakes job -> closed reasoning default (Claude)');
      return { ...base(HIGH_STAKES_DEFAULT), source: 'escalated', available: true, escalated: true, escalationReason: 'high stakes (financial/legal/business risk)' };
    }
    const fb = bestAvailable(candidates.filter((c) => c.available));
    notes.push('high-stakes job but Claude unavailable — fell back to best available');
    return { ...base(fb?.modelId ?? null), escalated: true, escalationReason: 'high stakes; Claude unavailable' };
  }

  // 3. Confidence / ambiguity / media-nuance escalation. (Long-context is handled
  //    by needs.longContext via meetsNeeds, so it isn't a blanket escalator.)
  const lowConf = (req.estimatedConfidence != null && req.estimatedConfidence < lowConfidence) || req.ambiguity === 'ambiguous';
  const isMedia = req.modality && req.modality !== 'text';
  const mediaNuance = !!isMedia && (req.nuanceSensitive === true || req.inputQuality === 'poor');
  if (lowConf || mediaNuance) {
    const closedEligible = eligible.filter((c) => !entryOf(c.modelId).openSource);
    const pick = bestAvailable(closedEligible.length ? closedEligible : eligible);
    if (pick) {
      const reason = lowConf ? 'low confidence / ambiguous' : 'media nuance / poor input quality';
      notes.push(`escalated to stronger model (${reason})`);
      return { ...base(pick.modelId), source: 'escalated', available: true, escalated: true, escalationReason: reason, openSourcePreferred: entryOf(pick.modelId).openSource };
    }
  }

  // 4. Open-source/local preference: an available local that MEETS the required
  //    capabilities is "close enough for the required capability" -> prefer it
  //    (cheapest/fastest first). Low-stakes media grunt-work lands here on local.
  const closedAvail = eligible.filter((c) => !entryOf(c.modelId).openSource);
  const localAvail = eligible.filter((c) => entryOf(c.modelId).openSource);
  if (localAvail.length) {
    const localRanked = [...localAvail].sort((a, b) =>
      entryOf(b.modelId).profile.cost - entryOf(a.modelId).profile.cost ||
      entryOf(b.modelId).profile.speed - entryOf(a.modelId).profile.speed);
    notes.push('local/open-source meets the required capabilities -> preferred (cost/privacy/local)');
    return { ...base(localRanked[0].modelId), source: 'capability_match', available: true, openSourcePreferred: true };
  }

  // 5. No local meets the needs (materially weaker) -> best available closed.
  const bestClosed = bestAvailable(closedAvail);
  if (bestClosed) {
    notes.push('no local model meets the required capabilities (materially weaker) -> closed');
    return { ...base(bestClosed.modelId), source: 'capability_match', available: true, closedSourceReason: 'local materially weaker / unavailable on required capabilities' };
  }

  // 6. Nothing meets the needs -> fall back to the best available model.
  const fb = bestAvailable(candidates.filter((c) => c.available));
  notes.push('no available model meets the required capabilities — fell back to best available');
  return base(fb?.modelId ?? null);
}
