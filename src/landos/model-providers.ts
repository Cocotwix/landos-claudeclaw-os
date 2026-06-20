// LandOS model registry + suggestion + sticky-override resolution + cost board.
//
// Models are NEUTRAL PEERS described by OBJECTIVE FACTS only — there is no
// ranking field anywhere, and no model is hardcoded as permanently preferred.
// This module:
//   1. Registers each model as facts (id, provider, modality, context_window,
//      runtime, cost_per_token, availability, open_source, paid_api_required,
//      supports_task_type).
//   2. SUGGESTS a model for a task orientation using facts only. The suggestion
//      is always overridable.
//   3. Resolves the effective model in the order:
//        sticky user override > task-orientation suggestion > configured default.
//   4. Tracks ACTUAL spend by whichever model truly ran (never the suggestion).
//
// Pure + deterministic: it registers models and computes cost/suggestions but
// makes NO live model call. Live call clients (local runtime for the
// open-source models, the Claude Agent SDK already in the repo, an OpenAI/
// OpenRouter key) are drop-ins gated on runtime/.env and are configured, not
// invoked, here. Adding a model = ONE new registry record (+ optional dispatch
// edit); it becomes immediately suggestible and selectable with no code rewrite.

import type { TaskOrientation } from './intake-types.js';

// ── Registry (facts only) ────────────────────────────────────────────────────

export type ModelModality = 'text' | 'vision' | 'multimodal';
export type ModelRuntime = 'local' | 'cloud';
export type ModelAvailability = 'available' | 'not_available';

export interface ModelRegistryEntry {
  id: string;
  provider: string;
  modality: ModelModality;
  /** Maximum context window in tokens (objective fact). */
  context_window: number;
  runtime: ModelRuntime;
  /** Literal cost fact in USD per token. 0 is allowed ONLY as the cost fact,
   *  never as a quality/value statement. */
  cost_per_token: number;
  availability: ModelAvailability;
  open_source: boolean;
  paid_api_required: boolean;
  /** Task orientations this model is eligible for. UNDEFINED means eligible for
   *  ALL orientations (deterministic default). */
  supports_task_type?: readonly TaskOrientation[];
}

// The registered models (the user's own local + cloud stack). Every slot is a
// neutral peer; availability reflects honest wiring state, not preference.
//   - local open-source weights run on the user's box; availability flips to
//     'available' once the local runtime is wired (drop-in), $0/token by fact.
//   - cloud models need a key/SDK; Claude's SDK is already present.
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    id: 'gemma-4-e4b',
    provider: 'google',
    modality: 'text',
    context_window: 8192,
    runtime: 'local',
    cost_per_token: 0,
    availability: 'not_available', // local runtime is a drop-in (not wired yet)
    open_source: true,
    paid_api_required: false,
  },
  {
    id: 'gemma-4-12b-q4',
    provider: 'google',
    modality: 'multimodal',
    context_window: 8192,
    runtime: 'local',
    cost_per_token: 0,
    availability: 'not_available',
    open_source: true,
    paid_api_required: false,
  },
  {
    id: 'gpt',
    provider: 'openai',
    modality: 'multimodal',
    context_window: 128000,
    runtime: 'cloud',
    cost_per_token: 0.00001,
    availability: 'not_available', // needs an OpenAI/OpenRouter key in .env (gated)
    open_source: false,
    paid_api_required: true,
  },
  {
    id: 'claude',
    provider: 'anthropic',
    modality: 'multimodal',
    context_window: 200000,
    runtime: 'cloud',
    cost_per_token: 0.000009,
    availability: 'available', // @anthropic-ai/claude-agent-sdk already present
    open_source: false,
    paid_api_required: true,
  },
];

export function getModel(id: string, registry: readonly ModelRegistryEntry[] = MODEL_REGISTRY): ModelRegistryEntry | undefined {
  return registry.find((m) => m.id === id);
}

/** A model is eligible for an orientation when it declares support for it, OR
 *  declares no support list at all (undefined = all orientations). */
export function supportsOrientation(m: ModelRegistryEntry, orientation: TaskOrientation): boolean {
  return m.supports_task_type === undefined || m.supports_task_type.includes(orientation);
}

// ── Suggestion (facts only, never a quality label) ───────────────────────────

export interface SuggestionContext {
  /** Minimum modality the task needs (vision/multimodal filter). */
  needsModality?: ModelModality;
  /** Minimum context window the task needs (tokens). */
  needsContextWindow?: number;
}

export interface ModelSuggestion {
  /** Suggested model id, or null when no registered model satisfies the facts. */
  modelId: string | null;
  /** Factual reason citing the objective facts used (no quality words). */
  reason: string;
  /** Availability of the suggested model; 'none' when no candidate exists. */
  availability: ModelAvailability | 'none';
  /** Best AVAILABLE alternative if the suggestion is not_available; else null. */
  fallbackModelId: string | null;
  /** Whether the suggested model needs a paid API (gating fact, separate). */
  paidApiRequired: boolean;
}

function modalityOk(m: ModelRegistryEntry, need?: ModelModality): boolean {
  if (!need || need === 'text') return true;
  if (need === 'vision') return m.modality === 'vision' || m.modality === 'multimodal';
  return m.modality === 'multimodal';
}

/** Deterministic ordering for TASK-ORIENTED work: local open-source first (a
 *  cost/privacy/local-runtime rule, NOT a quality claim), then lowest
 *  cost_per_token, then larger context_window, then id. */
function compareTaskOriented(a: ModelRegistryEntry, b: ModelRegistryEntry): number {
  const localOpen = (m: ModelRegistryEntry) => (m.runtime === 'local' && m.open_source ? 0 : 1);
  return (
    localOpen(a) - localOpen(b) ||
    a.cost_per_token - b.cost_per_token ||
    b.context_window - a.context_window ||
    a.id.localeCompare(b.id)
  );
}

/** Deterministic ordering for REASONING-ORIENTED work: chosen by objective
 *  facts only — larger context_window, then lower cost_per_token, then id.
 *  No quality label is ever consulted. */
function compareReasoningOriented(a: ModelRegistryEntry, b: ModelRegistryEntry): number {
  return (
    b.context_window - a.context_window ||
    a.cost_per_token - b.cost_per_token ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Suggest a model for a task orientation using FACTS ONLY. Task-oriented work
 * prefers the local/open-source slot; reasoning-oriented work is chosen by
 * objective capability + cost facts (a closed-source model MAY be suggested, but
 * only because of its facts, never a quality label). The suggestion is always
 * overridable. Fails honestly: if no registered model satisfies the required
 * facts, modelId is null; if the suggested model's runtime/key is unavailable,
 * availability says so and a best available fallback is offered.
 */
export function suggestModelForOrientation(
  orientation: TaskOrientation,
  registry: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
  ctx: SuggestionContext = {},
): ModelSuggestion {
  const candidates = registry.filter(
    (m) =>
      supportsOrientation(m, orientation) &&
      modalityOk(m, ctx.needsModality) &&
      m.context_window >= (ctx.needsContextWindow ?? 0),
  );

  if (candidates.length === 0) {
    return {
      modelId: null,
      reason:
        `No registered model satisfies the required facts ` +
        `(orientation=${orientation}` +
        (ctx.needsModality ? `, modality>=${ctx.needsModality}` : '') +
        (ctx.needsContextWindow ? `, context_window>=${ctx.needsContextWindow}` : '') +
        `). Not invented — connect/register a model.`,
      availability: 'none',
      fallbackModelId: null,
      paidApiRequired: false,
    };
  }

  const ordered = [...candidates].sort(
    orientation === 'task_oriented' ? compareTaskOriented : compareReasoningOriented,
  );
  const suggested = ordered[0];

  // Best AVAILABLE alternative that is not the suggested model (resilience).
  const fallback = ordered.find((m) => m.id !== suggested.id && m.availability === 'available') ?? null;

  const reason =
    orientation === 'task_oriented'
      ? `task_oriented: prefer local open-source slot ` +
        `(runtime=${suggested.runtime}, open_source=${suggested.open_source}, cost_per_token=${suggested.cost_per_token}); ` +
        `suggested ${suggested.id}`
      : `reasoning_oriented: selected by objective facts ` +
        `(context_window=${suggested.context_window}, cost_per_token=${suggested.cost_per_token}, modality=${suggested.modality}); ` +
        `suggested ${suggested.id}`;

  return {
    modelId: suggested.id,
    reason,
    availability: suggested.availability,
    fallbackModelId: fallback ? fallback.id : null,
    paidApiRequired: suggested.paid_api_required,
  };
}

// ── Sticky override resolution ───────────────────────────────────────────────

export type ModelPreferenceScopeKind = 'task_type' | 'department' | 'sub_agent';

/** One sticky user override. entity '' (or undefined) = applies across entities. */
export interface ModelPreferenceRecord {
  entity?: string;
  scopeKind: ModelPreferenceScopeKind;
  scopeKey: string;
  /** '' or undefined = applies to ALL task types within a dept/sub_agent scope. */
  taskType?: string;
  modelId: string;
}

export interface ModelResolutionContext {
  entity?: string;
  subAgent?: string;
  department?: string;
  /** The granular task type / route task this work belongs to. */
  taskType: string;
  orientation: TaskOrientation;
}

function entityMatch(prefEntity: string | undefined, ctxEntity: string | undefined): boolean {
  const p = prefEntity ?? '';
  return p === '' || p === (ctxEntity ?? '');
}

/**
 * Resolve the sticky user override for a context, MOST SPECIFIC first:
 *   sub_agent+task_type > sub_agent(all) > department+task_type > department(all)
 *   > task_type. Within a tier, an entity-specific override beats a cross-entity
 *   ('') one. Returns the pinned model id, or null when none is set (caller then
 *   falls through to the suggestion, then the configured default).
 */
export function resolveStickyOverride(
  prefs: readonly ModelPreferenceRecord[],
  ctx: ModelResolutionContext,
): string | null {
  const applicable = prefs.filter((p) => entityMatch(p.entity, ctx.entity));
  // Higher score = more specific. Entity-specific (+1) breaks ties within a tier.
  const score = (p: ModelPreferenceRecord): number => {
    const pTask = p.taskType ?? '';
    const entityBonus = (p.entity ?? '') !== '' ? 1 : 0;
    if (p.scopeKind === 'sub_agent' && ctx.subAgent && p.scopeKey === ctx.subAgent) {
      if (pTask === ctx.taskType) return 100 + entityBonus;
      if (pTask === '') return 80 + entityBonus;
    }
    if (p.scopeKind === 'department' && ctx.department && p.scopeKey === ctx.department) {
      if (pTask === ctx.taskType) return 60 + entityBonus;
      if (pTask === '') return 40 + entityBonus;
    }
    if (p.scopeKind === 'task_type' && p.scopeKey === ctx.taskType) {
      return 20 + entityBonus;
    }
    return 0;
  };
  let best: ModelPreferenceRecord | null = null;
  let bestScore = 0;
  for (const p of applicable) {
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best ? best.modelId : null;
}

export type ModelResolutionSource = 'override' | 'suggestion' | 'configured_default' | 'none';

export interface ModelResolution {
  modelId: string | null;
  source: ModelResolutionSource;
  reason: string;
  availability: ModelAvailability | 'none';
  fallbackModelId: string | null;
  paidApiRequired: boolean;
}

/**
 * Resolve the effective model for a context in the approved order:
 *   sticky user override > task-orientation suggestion > configured default.
 * Honest about availability and paid-API gating; never invents a model.
 */
export function resolveModel(
  prefs: readonly ModelPreferenceRecord[],
  ctx: ModelResolutionContext,
  opts: {
    registry?: readonly ModelRegistryEntry[];
    configuredDefaultId?: string;
    suggestion?: SuggestionContext;
  } = {},
): ModelResolution {
  const registry = opts.registry ?? MODEL_REGISTRY;

  // 1. Sticky override (always wins when set to a registered model).
  const overrideId = resolveStickyOverride(prefs, ctx);
  if (overrideId) {
    const m = getModel(overrideId, registry);
    if (m) {
      const fallback =
        m.availability === 'available'
          ? null
          : registry.find((x) => x.id !== m.id && supportsOrientation(x, ctx.orientation) && x.availability === 'available')?.id ?? null;
      return {
        modelId: m.id,
        source: 'override',
        reason: `Sticky user override for ${ctx.subAgent ?? ctx.department ?? ctx.taskType}: ${m.id}`,
        availability: m.availability,
        fallbackModelId: fallback,
        paidApiRequired: m.paid_api_required,
      };
    }
  }

  // 2. Task-orientation suggestion (facts only).
  const suggestion = suggestModelForOrientation(ctx.orientation, registry, opts.suggestion);
  if (suggestion.modelId) {
    return {
      modelId: suggestion.modelId,
      source: 'suggestion',
      reason: suggestion.reason,
      availability: suggestion.availability,
      fallbackModelId: suggestion.fallbackModelId,
      paidApiRequired: suggestion.paidApiRequired,
    };
  }

  // 3. Configured default (plain default, not a ranking).
  if (opts.configuredDefaultId) {
    const m = getModel(opts.configuredDefaultId, registry);
    if (m) {
      return {
        modelId: m.id,
        source: 'configured_default',
        reason: `Configured default: ${m.id}`,
        availability: m.availability,
        fallbackModelId: null,
        paidApiRequired: m.paid_api_required,
      };
    }
  }

  // Nothing satisfies the facts: fail honestly.
  return {
    modelId: null,
    source: 'none',
    reason: 'No override, no facts-eligible suggestion, and no configured default. Not invented.',
    availability: 'none',
    fallbackModelId: null,
    paidApiRequired: false,
  };
}

// ── Cost board (records the ACTUAL model that ran) ───────────────────────────

export interface ModelUsageEvent {
  /** The model that ACTUALLY ran (resolved/overridden), never the suggestion. */
  modelId: string;
  /** Department / sub-agent that spent it (e.g. 'duke', 'strategy', 'comps'). */
  department: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostLine {
  modelId: string;
  provider: string;
  runtime: ModelRuntime;
  department: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface CostBoard {
  lines: CostLine[];
  totalUsd: number;
  byRuntime: Record<ModelRuntime, number>;
}

export function newCostBoard(): CostBoard {
  return { lines: [], totalUsd: 0, byRuntime: { local: 0, cloud: 0 } };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Record a usage event onto the cost board (mutates + returns it). Cost is the
 * ACTUAL model's cost_per_token times the real token count — local models are $0
 * by fact. Aggregates per model+department line and per runtime. Throws on an
 * unknown model id so spend can never be recorded for a model that does not
 * exist; never estimates spend that did not happen.
 */
export function recordUsage(board: CostBoard, event: ModelUsageEvent, registry: readonly ModelRegistryEntry[] = MODEL_REGISTRY): CostBoard {
  const m = getModel(event.modelId, registry);
  if (!m) throw new Error(`Cannot record usage for unknown model "${event.modelId}"`);
  const usd = round6((event.inputTokens + event.outputTokens) * m.cost_per_token);
  let line = board.lines.find((l) => l.modelId === m.id && l.department === event.department);
  if (!line) {
    line = { modelId: m.id, provider: m.provider, runtime: m.runtime, department: event.department, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    board.lines.push(line);
  }
  line.calls += 1;
  line.inputTokens += event.inputTokens;
  line.outputTokens += event.outputTokens;
  line.usd = round6(line.usd + usd);
  board.totalUsd = round6(board.totalUsd + usd);
  board.byRuntime[m.runtime] = round6(board.byRuntime[m.runtime] + usd);
  return board;
}

/** Snapshot for the dashboard Cost Control Board. Numbers only, no labels. */
export function summarizeCostBoard(board: CostBoard): {
  totalUsd: number;
  byRuntime: Record<ModelRuntime, number>;
  byDepartment: Array<{ department: string; usd: number; calls: number }>;
  byProvider: Array<{ provider: string; usd: number; calls: number }>;
  byModel: Array<{ modelId: string; usd: number; calls: number }>;
} {
  const dept = new Map<string, { usd: number; calls: number }>();
  const prov = new Map<string, { usd: number; calls: number }>();
  const model = new Map<string, { usd: number; calls: number }>();
  for (const l of board.lines) {
    const d = dept.get(l.department) ?? { usd: 0, calls: 0 };
    d.usd = round6(d.usd + l.usd); d.calls += l.calls; dept.set(l.department, d);
    const p = prov.get(l.provider) ?? { usd: 0, calls: 0 };
    p.usd = round6(p.usd + l.usd); p.calls += l.calls; prov.set(l.provider, p);
    const mm = model.get(l.modelId) ?? { usd: 0, calls: 0 };
    mm.usd = round6(mm.usd + l.usd); mm.calls += l.calls; model.set(l.modelId, mm);
  }
  return {
    totalUsd: board.totalUsd,
    byRuntime: board.byRuntime,
    byDepartment: [...dept.entries()].map(([department, v]) => ({ department, ...v })),
    byProvider: [...prov.entries()].map(([provider, v]) => ({ provider, ...v })),
    byModel: [...model.entries()].map(([modelId, v]) => ({ modelId, ...v })),
  };
}
