// Pass 3 unit (2) — provider engine adoption (config/selection/availability) +
// reconciliation with the vendor-neutral LandOS model-router. No agent execution
// is rewired; claude stays the executing provider. Pure, no model call.

import { describe, it, expect } from 'vitest';
import { DEFAULT_CLAUDE_MODEL, CLAUDE_MODEL_OPUS, CLAUDE_MODEL_SONNET, CLAUDE_MODEL_HAIKU } from '../config.js';
import { DEFAULT_PROVIDER, normalizeProviderConfig, checkProviderAvailability, type ProviderConfig } from '../provider.js';
import { claudeModelForRoute, bindRouteToProvider, resolveProviderForTask } from './provider-model-bridge.js';
import type { ModelRoutingDecision } from './intake-types.js';

const decision = (route: ModelRoutingDecision['route']) => ({ route } as ModelRoutingDecision);

describe('provider engine config', () => {
  it('default provider is claude bound to DEFAULT_CLAUDE_MODEL', () => {
    expect(DEFAULT_PROVIDER.type).toBe('claude');
    expect(DEFAULT_PROVIDER.model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('normalizeProviderConfig yields a valid claude provider from empty/legacy input', () => {
    expect(normalizeProviderConfig({}).type).toBe('claude');
    expect(normalizeProviderConfig(undefined, 'claude-sonnet-4-6').model).toBe('claude-sonnet-4-6');
  });

  it('checkProviderAvailability reports the claude provider as available (SDK installed)', () => {
    const a = checkProviderAvailability(DEFAULT_PROVIDER);
    expect(a).toHaveProperty('ok');
    expect(a.ok).toBe(true);
  });
});

describe('model-router ↔ provider reconciliation (vendor neutrality preserved)', () => {
  it('maps neutral routes to claude tiers (provider-specific suggestion)', () => {
    expect(claudeModelForRoute('deterministic_code')).toBe(CLAUDE_MODEL_HAIKU);
    expect(claudeModelForRoute('task_oriented')).toBe(CLAUDE_MODEL_SONNET);
    expect(claudeModelForRoute('reasoning_oriented')).toBe(CLAUDE_MODEL_OPUS);
    expect(claudeModelForRoute('long_context')).toBe(CLAUDE_MODEL_OPUS);
  });

  it('binds a route onto the claude provider only when no model is set', () => {
    expect(bindRouteToProvider({ type: 'claude' }, decision('reasoning_oriented')).model).toBe(CLAUDE_MODEL_OPUS);
    // explicit model preserved
    expect(bindRouteToProvider({ type: 'claude', model: 'pinned' }, decision('reasoning_oriented')).model).toBe('pinned');
  });

  it('never imposes a model on a non-claude provider (router stays vendor-neutral)', () => {
    const p: ProviderConfig = { type: 'openrouter' };
    expect(bindRouteToProvider(p, decision('reasoning_oriented')).model).toBeUndefined();
  });

  it('resolveProviderForTask runs the router and binds for claude', () => {
    const bound = resolveProviderForTask({ type: 'claude' }, { taskType: 'strategy_reasoning', parcelVerified: true });
    expect(typeof bound.model).toBe('string');
    expect(bound.model!.length).toBeGreaterThan(0);
  });
});
