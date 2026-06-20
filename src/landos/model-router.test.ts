// Tests for the LandOS model router. Pure + deterministic, neutral routes.

import { describe, it, expect } from 'vitest';

import { selectModel, MODEL_ROUTER_POLICY } from './model-router.js';
import { TASK_ROUTES, MODEL_ALIASES } from './intake-types.js';

describe('model router policy (neutral, facts-based)', () => {
  it('is vendor-neutral and overridable; routes carry no quality ranking', () => {
    expect(MODEL_ROUTER_POLICY.preferLocalOpenSourceForTaskOriented).toBe(true);
    expect(MODEL_ROUTER_POLICY.deterministicUsesCode).toBe(true);
    expect(MODEL_ROUTER_POLICY.safetyOverridesRouting).toBe(true);
    expect(MODEL_ROUTER_POLICY.suggestionsOverridable).toBe(true);
    // Routes are the KIND of work, not a quality ladder.
    expect(TASK_ROUTES).toContain('task_oriented');
    expect(TASK_ROUTES).toContain('reasoning_oriented');
    expect(TASK_ROUTES).toContain('web_capable');
    expect(TASK_ROUTES).not.toContain('cheap_fast');
    expect(TASK_ROUTES).not.toContain('strong_reasoning');
  });

  it('supports capability/role aliases without hard-coding one provider', () => {
    expect(MODEL_ALIASES).toContain('local_open_source');
    expect(MODEL_ALIASES).toContain('web_research');
    expect(MODEL_ALIASES).toContain('forge_diagnostics');
    expect(selectModel({ taskType: 'routing' }).alias).toBe('local_open_source');
  });
});

describe('route selection', () => {
  it('execution work selects the task-oriented route', () => {
    expect(selectModel({ taskType: 'classification' }).route).toBe('task_oriented');
    expect(selectModel({ taskType: 'routing' }).route).toBe('task_oriented');
    expect(selectModel({ taskType: 'status_formatting' }).route).toBe('task_oriented');
    expect(selectModel({ taskType: 'metadata_extraction' }).route).toBe('task_oriented');
    expect(selectModel({ taskType: 'summarization' }).route).toBe('task_oriented');
  });

  it('deterministic tasks do not require an LLM route', () => {
    expect(selectModel({ taskType: 'deterministic_parse' }).route).toBe('deterministic_code');
    expect(selectModel({ taskType: 'deterministic_calc' }).route).toBe('deterministic_code');
    expect(selectModel({ taskType: 'underwriting_math' }).route).toBe('deterministic_code');
    expect(selectModel({ taskType: 'finance_calc' }).route).toBe('deterministic_code');
  });

  it('Duke parcel verification prefers deterministic/exact-source, not reasoning', () => {
    const d = selectModel({ taskType: 'parcel_verification' });
    expect(d.route).toBe('deterministic_code');
    expect(d.route).not.toBe('reasoning_oriented');
  });

  it('Forge diagnostics route as reasoning-oriented', () => {
    expect(selectModel({ taskType: 'forge_diagnostics' }).route).toBe('reasoning_oriented');
    expect(selectModel({ taskType: 'forge_build_planning' }).route).toBe('reasoning_oriented');
    expect(selectModel({ taskType: 'forge_diagnostics' }).alias).toBe('forge_diagnostics');
  });

  it('Market Research routes as web-capable when browsing is needed', () => {
    expect(selectModel({ taskType: 'market_research', requiresWeb: true }).route).toBe('web_capable');
  });

  it('Strategy routes as reasoning-oriented only when parcel facts are verified', () => {
    expect(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }).route).toBe('reasoning_oriented');
  });

  it('unverified parcel blocks property-specific Strategy routing', () => {
    const d = selectModel({ taskType: 'strategy_reasoning', parcelVerified: false });
    expect(d.availability).toBe('blocked');
    expect(d.route).toBe('approval_required');
    expect(d.route).not.toBe('reasoning_oriented');
  });

  it('AI watcher routes task-oriented and escalates only on real failure', () => {
    const d = selectModel({ taskType: 'ai_watcher_monitor', escalationAllowed: true });
    expect(d.route).toBe('task_oriented');
    expect(d.escalation.allowed).toBe(true);
    expect(d.escalation.toRoute).toBe('reasoning_oriented');
    expect(d.escalation.reason).toBeTruthy();
  });

  it('seller prep routes task-oriented; negotiation routes reasoning-oriented', () => {
    expect(selectModel({ taskType: 'seller_prep' }).route).toBe('task_oriented');
    expect(selectModel({ taskType: 'negotiation_strategy', parcelVerified: true }).route).toBe('reasoning_oriented');
  });
});

describe('escalation, gating, fallback (safety preserved)', () => {
  it('escalation never no-ops: toRoute always differs from the base route', () => {
    const cases = [
      selectModel({ taskType: 'ai_watcher_monitor', escalationAllowed: true }),
      selectModel({ taskType: 'seller_prep', escalationAllowed: true }),
      selectModel({ taskType: 'war_room_discussion', escalationAllowed: true }),
      selectModel({ taskType: 'forge_diagnostics', escalationAllowed: true, riskLevel: 'high' }),
      selectModel({ taskType: 'market_research', requiresWeb: true, escalationAllowed: true, riskLevel: 'high' }),
    ];
    for (const d of cases) {
      if (d.escalation.allowed) {
        expect(d.escalation.toRoute).toBeTruthy();
        expect(d.escalation.toRoute).not.toBe(d.route);
        expect(d.escalation.reason && d.escalation.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('War Room escalation routes to the approval gate and requires Tyler approval', () => {
    const d = selectModel({ taskType: 'war_room_discussion', escalationAllowed: true });
    expect(d.escalation.allowed).toBe(true);
    expect(d.escalation.toRoute).toBe('approval_required');
    expect(d.escalation.requiresTylerApproval).toBe(true);
    expect(d.escalation.reason && d.escalation.reason.length).toBeGreaterThan(0);
  });

  it('keeps paid API/tool use gated separately from route selection', () => {
    const web = selectModel({ taskType: 'market_research', requiresWeb: true });
    expect(web.paidApiGated).toBe(true);
    const cheap = selectModel({ taskType: 'classification' });
    expect(cheap.paidApiGated).toBe(false);
  });

  it('reports not_available when a needed tool is unavailable instead of faking success', () => {
    const d = selectModel({ taskType: 'market_research', requiresWeb: true, toolAvailable: false });
    expect(d.availability).toBe('not_available');
  });

  it('provides a fallback route and a token budget for every decision', () => {
    const d = selectModel({ taskType: 'classification' });
    expect(d.fallback.fallbackRoute).toBeTruthy();
    expect(d.fallback.blockIfUnavailable).toBe(true);
    expect(d.tokenBudget.budgetClass).toBeTruthy();
    expect(d.usageEstimate.budgetClass).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }))
      .toEqual(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }));
  });
});
