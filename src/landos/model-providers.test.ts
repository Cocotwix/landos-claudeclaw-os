import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  getModel,
  supportsOrientation,
  suggestModelForOrientation,
  resolveStickyOverride,
  resolveModel,
  newCostBoard,
  recordUsage,
  summarizeCostBoard,
  type ModelRegistryEntry,
  type ModelPreferenceRecord,
  type ModelResolutionContext,
} from './model-providers.js';
import { DEPARTMENT_REGISTRY } from './department-registry.js';

describe('model registry (facts only, neutral peers)', () => {
  it('describes every model with objective facts and no ranking field', () => {
    for (const m of MODEL_REGISTRY) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.provider).toBe('string');
      expect(['text', 'vision', 'multimodal']).toContain(m.modality);
      expect(['local', 'cloud']).toContain(m.runtime);
      expect(typeof m.context_window).toBe('number');
      expect(typeof m.cost_per_token).toBe('number');
      expect(['available', 'not_available']).toContain(m.availability);
      expect(typeof m.open_source).toBe('boolean');
      expect(typeof m.paid_api_required).toBe('boolean');
      // No tier / rank / quality field exists anywhere on the entry.
      const facts = m as unknown as Record<string, unknown>;
      expect(facts.tier).toBeUndefined();
      expect(facts.rank).toBeUndefined();
    }
  });

  it('local open-source models are $0/token and key-free by fact', () => {
    for (const m of MODEL_REGISTRY.filter((x) => x.runtime === 'local' && x.open_source)) {
      expect(m.cost_per_token).toBe(0);
      expect(m.paid_api_required).toBe(false);
    }
  });

  it('treats undefined supports_task_type as eligible for ALL orientations (deterministic)', () => {
    const m: ModelRegistryEntry = { id: 'x', provider: 'p', modality: 'text', context_window: 1000, runtime: 'local', cost_per_token: 0, availability: 'available', open_source: true, paid_api_required: false };
    expect(supportsOrientation(m, 'task_oriented')).toBe(true);
    expect(supportsOrientation(m, 'reasoning_oriented')).toBe(true);
    const limited: ModelRegistryEntry = { ...m, supports_task_type: ['reasoning_oriented'] };
    expect(supportsOrientation(limited, 'task_oriented')).toBe(false);
    expect(supportsOrientation(limited, 'reasoning_oriented')).toBe(true);
  });
});

describe('facts-based suggestion (overridable, honest)', () => {
  it('task-oriented suggests a local open-source model (cost/privacy rule, not a ranking)', () => {
    const s = suggestModelForOrientation('task_oriented');
    const m = getModel(s.modelId!)!;
    expect(m.runtime).toBe('local');
    expect(m.open_source).toBe(true);
    expect(s.reason).toMatch(/local open-source/);
  });

  it('reasoning-oriented chooses by objective facts only (context_window, cost), no quality label', () => {
    const s = suggestModelForOrientation('reasoning_oriented');
    const m = getModel(s.modelId!)!;
    // Largest context window in the default registry.
    expect(m.context_window).toBe(Math.max(...MODEL_REGISTRY.map((x) => x.context_window)));
    expect(s.reason).toMatch(/context_window=/);
    expect(s.reason).not.toMatch(/best|strong|premium|top|cheap/i);
  });

  it('fails honestly when no model satisfies the required facts (never invents one)', () => {
    const s = suggestModelForOrientation('reasoning_oriented', MODEL_REGISTRY, { needsContextWindow: 10_000_000 });
    expect(s.modelId).toBeNull();
    expect(s.availability).toBe('none');
  });

  it('reports an unavailable local runtime honestly and offers an available fallback', () => {
    const reg: ModelRegistryEntry[] = [
      { id: 'local-a', provider: 'p', modality: 'text', context_window: 8000, runtime: 'local', cost_per_token: 0, availability: 'not_available', open_source: true, paid_api_required: false },
      { id: 'cloud-b', provider: 'q', modality: 'text', context_window: 8000, runtime: 'cloud', cost_per_token: 0.001, availability: 'available', open_source: false, paid_api_required: true },
    ];
    const s = suggestModelForOrientation('task_oriented', reg);
    expect(s.modelId).toBe('local-a');
    expect(s.availability).toBe('not_available'); // honest: local not wired
    expect(s.fallbackModelId).toBe('cloud-b');
  });

  it('fails honestly with no fallback when nothing is available', () => {
    const reg: ModelRegistryEntry[] = [
      { id: 'local-a', provider: 'p', modality: 'text', context_window: 8000, runtime: 'local', cost_per_token: 0, availability: 'not_available', open_source: true, paid_api_required: false },
    ];
    const s = suggestModelForOrientation('task_oriented', reg);
    expect(s.modelId).toBe('local-a');
    expect(s.availability).toBe('not_available');
    expect(s.fallbackModelId).toBeNull();
  });
});

describe('sticky override resolution (specificity order)', () => {
  const ctx: ModelResolutionContext = { entity: 'LAND_ALLY', subAgent: 'duke', department: 'research_due_diligence', taskType: 'parcel_verification', orientation: 'task_oriented' };

  it('resolution order: sub_agent > department > task_type', () => {
    const prefs: ModelPreferenceRecord[] = [
      { scopeKind: 'task_type', scopeKey: 'parcel_verification', modelId: 'gpt' },
      { scopeKind: 'department', scopeKey: 'research_due_diligence', modelId: 'gemma-4-e4b' },
      { scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'claude' },
    ];
    expect(resolveStickyOverride(prefs, ctx)).toBe('claude'); // sub_agent wins
    expect(resolveStickyOverride(prefs.slice(0, 2), ctx)).toBe('gemma-4-e4b'); // department beats task_type
    expect(resolveStickyOverride(prefs.slice(0, 1), ctx)).toBe('gpt'); // task_type only
  });

  it('an exact task_type match within a scope beats the all-task-types override', () => {
    const prefs: ModelPreferenceRecord[] = [
      { scopeKind: 'department', scopeKey: 'research_due_diligence', taskType: '', modelId: 'gemma-4-e4b' },
      { scopeKind: 'department', scopeKey: 'research_due_diligence', taskType: 'parcel_verification', modelId: 'claude' },
    ];
    expect(resolveStickyOverride(prefs, ctx)).toBe('claude');
  });

  it('an entity-specific override beats a cross-entity one in the same tier', () => {
    const prefs: ModelPreferenceRecord[] = [
      { entity: '', scopeKind: 'task_type', scopeKey: 'parcel_verification', modelId: 'gpt' },
      { entity: 'LAND_ALLY', scopeKind: 'task_type', scopeKey: 'parcel_verification', modelId: 'claude' },
    ];
    expect(resolveStickyOverride(prefs, ctx)).toBe('claude');
  });

  it('returns null when no override matches (caller falls back to suggestion)', () => {
    expect(resolveStickyOverride([], ctx)).toBeNull();
  });
});

describe('resolveModel (override > suggestion > configured default)', () => {
  const ctx: ModelResolutionContext = { subAgent: 'duke', taskType: 'parcel_verification', orientation: 'reasoning_oriented' };

  it('uses the sticky override when set', () => {
    const r = resolveModel([{ scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'gpt' }], ctx);
    expect(r.source).toBe('override');
    expect(r.modelId).toBe('gpt');
  });

  it('falls back to the facts-based suggestion when no override is set', () => {
    const r = resolveModel([], ctx);
    expect(r.source).toBe('suggestion');
    expect(r.modelId).toBeTruthy();
  });

  it('uses the configured default only when there is no override and no suggestion', () => {
    const reg: ModelRegistryEntry[] = []; // no models => no suggestion
    const r = resolveModel([], ctx, { registry: reg, configuredDefaultId: 'anything' });
    // configuredDefaultId is not in the empty registry, so it cannot be used.
    expect(r.source).toBe('none');
    // With a registered default it is used.
    const reg2: ModelRegistryEntry[] = [{ id: 'd', provider: 'p', modality: 'text', context_window: 10, runtime: 'local', cost_per_token: 0, availability: 'available', open_source: true, paid_api_required: false, supports_task_type: ['task_oriented'] }];
    const r2 = resolveModel([], { ...ctx, orientation: 'reasoning_oriented' }, { registry: reg2, configuredDefaultId: 'd' });
    expect(r2.source).toBe('configured_default');
    expect(r2.modelId).toBe('d');
  });
});

describe('cost board records the ACTUAL model used (never the suggestion)', () => {
  it('local usage costs $0; cloud usage accrues real spend by the model that ran', () => {
    let board = newCostBoard();
    board = recordUsage(board, { modelId: 'gemma-4-e4b', department: 'comps', inputTokens: 10_000, outputTokens: 5_000 });
    expect(board.totalUsd).toBe(0);
    expect(board.byRuntime.local).toBe(0);

    board = recordUsage(board, { modelId: 'claude', department: 'strategy', inputTokens: 1_000, outputTokens: 1_000 });
    const claude = getModel('claude')!;
    const expected = 2_000 * claude.cost_per_token;
    expect(board.totalUsd).toBeCloseTo(expected, 9);
    expect(board.byRuntime.cloud).toBeCloseTo(expected, 9);

    const summary = summarizeCostBoard(board);
    expect(summary.byDepartment.find((d) => d.department === 'strategy')!.calls).toBe(1);
    expect(summary.byModel.find((m) => m.modelId === 'claude')!.usd).toBeCloseTo(expected, 9);
    expect(summary.byProvider.find((p) => p.provider === 'anthropic')!.calls).toBe(1);
  });

  it('throws on an unknown model id (never records fake spend)', () => {
    expect(() => recordUsage(newCostBoard(), { modelId: 'nope', department: 'x', inputTokens: 1, outputTokens: 1 })).toThrow(/unknown model/i);
  });

  it('aggregates repeat calls on the same model+department line', () => {
    let board = newCostBoard();
    board = recordUsage(board, { modelId: 'claude', department: 'duke', inputTokens: 1000, outputTokens: 0 });
    board = recordUsage(board, { modelId: 'claude', department: 'duke', inputTokens: 1000, outputTokens: 0 });
    expect(board.lines).toHaveLength(1);
    expect(board.lines[0].calls).toBe(2);
  });

  it('records the model that ACTUALLY ran (an override), never the suggestion', () => {
    const ctx: ModelResolutionContext = { subAgent: 'duke', taskType: 'strategy_reasoning', orientation: 'reasoning_oriented' };
    const suggestionId = suggestModelForOrientation('reasoning_oriented').modelId; // 'claude'
    const r = resolveModel([{ scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'gpt' }], ctx);
    expect(r.source).toBe('override');
    expect(r.modelId).toBe('gpt');
    expect(r.modelId).not.toBe(suggestionId);
    // The cost board (and landos_model_call via logModelCall, which inserts the
    // `model` string the caller passes) record the ACTUAL model id — here the
    // overridden 'gpt', not the suggestion.
    let board = newCostBoard();
    board = recordUsage(board, { modelId: r.modelId!, department: 'strategy', inputTokens: 100, outputTokens: 100 });
    expect(board.lines[0].modelId).toBe('gpt');
    expect(board.lines[0].modelId).not.toBe(suggestionId);
  });
});

describe('department configured default is neutral, overridable, and bottom of resolution', () => {
  const marketing = DEPARTMENT_REGISTRY.find((d) => d.id === 'marketing')!;
  const ctx: ModelResolutionContext = { department: 'marketing', taskType: 'formatting', orientation: 'task_oriented' };

  it('the per-department default is a plain configured id (local/open-source slot), not a ranking', () => {
    expect(marketing.modelPolicy.defaultRoute).toBe('task_oriented');
    const def = getModel(marketing.modelPolicy.defaultModelId!)!;
    expect(def.runtime).toBe('local');
    expect(def.open_source).toBe(true);
  });

  it('a facts-based suggestion outranks the configured default (default sits BELOW suggestion)', () => {
    const r = resolveModel([], ctx, { configuredDefaultId: marketing.modelPolicy.defaultModelId });
    expect(r.source).toBe('suggestion'); // NOT configured_default
  });

  it('the configured default is used ONLY when there is no override and no suggestion', () => {
    // Registry whose only model is ineligible for the orientation => no suggestion.
    const reg = [{ id: 'gemma-4-e4b', provider: 'google', modality: 'text' as const, context_window: 8192, runtime: 'local' as const, cost_per_token: 0, availability: 'available' as const, open_source: true, paid_api_required: false, supports_task_type: ['reasoning_oriented' as const] }];
    const r = resolveModel([], ctx, { registry: reg, configuredDefaultId: 'gemma-4-e4b' });
    expect(r.source).toBe('configured_default');
    expect(r.modelId).toBe('gemma-4-e4b');
  });

  it('a sticky override beats the configured default (plain-overridable, not a fixed rank)', () => {
    const r = resolveModel([{ scopeKind: 'department', scopeKey: 'marketing', modelId: 'claude' }], ctx, { configuredDefaultId: marketing.modelPolicy.defaultModelId });
    expect(r.source).toBe('override');
    expect(r.modelId).toBe('claude');
  });
});
