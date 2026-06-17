// Tests for the LandOS model router / cost-control policy. Pure + deterministic.

import { describe, it, expect } from 'vitest';

import { selectModel, MODEL_ROUTER_POLICY } from './model-router.js';
import { MODEL_TIERS, MODEL_ALIASES } from './intake-types.js';

describe('model router policy', () => {
  it('prefers the lowest capable tier and is vendor-neutral', () => {
    expect(MODEL_ROUTER_POLICY.preferLowestCapableTier).toBe(true);
    expect(MODEL_ROUTER_POLICY.deterministicUsesCode).toBe(true);
    expect(MODEL_ROUTER_POLICY.safetyOverridesRouting).toBe(true);
    // Tiers are abstract, not vendor-locked model names.
    expect(MODEL_TIERS).toContain('cheap_fast');
    expect(MODEL_TIERS).toContain('strong_reasoning');
    expect(MODEL_TIERS).toContain('tool_web_capable');
  });

  it('supports future model aliases without hard-coding one provider', () => {
    expect(MODEL_ALIASES).toContain('web_research');
    expect(MODEL_ALIASES).toContain('forge_diagnostics');
    expect(MODEL_ALIASES).toContain('local_fallback');
    expect(selectModel({ taskType: 'routing' }).alias).toBe('cheap_fast');
  });
});

describe('tier selection', () => {
  it('simple routing/classification selects cheap_fast', () => {
    expect(selectModel({ taskType: 'classification' }).tier).toBe('cheap_fast');
    expect(selectModel({ taskType: 'routing' }).tier).toBe('cheap_fast');
    expect(selectModel({ taskType: 'status_formatting' }).tier).toBe('cheap_fast');
    expect(selectModel({ taskType: 'metadata_extraction' }).tier).toBe('cheap_fast');
  });

  it('deterministic tasks do not require an LLM tier', () => {
    expect(selectModel({ taskType: 'deterministic_parse' }).tier).toBe('deterministic_code');
    expect(selectModel({ taskType: 'deterministic_calc' }).tier).toBe('deterministic_code');
    expect(selectModel({ taskType: 'underwriting_math' }).tier).toBe('deterministic_code');
    expect(selectModel({ taskType: 'finance_calc' }).tier).toBe('deterministic_code');
  });

  it('Duke parcel verification prefers deterministic/exact-source, not expensive reasoning', () => {
    const d = selectModel({ taskType: 'parcel_verification' });
    expect(d.tier).toBe('deterministic_code');
    expect(d.tier).not.toBe('strong_reasoning');
  });

  it('Forge diagnostics can request strong_reasoning', () => {
    expect(selectModel({ taskType: 'forge_diagnostics' }).tier).toBe('strong_reasoning');
    expect(selectModel({ taskType: 'forge_build_planning' }).tier).toBe('strong_reasoning');
  });

  it('Market Research requests tool_web_capable when browsing is needed', () => {
    expect(selectModel({ taskType: 'market_research', requiresWeb: true }).tier).toBe('tool_web_capable');
  });

  it('Strategy requests stronger reasoning only when parcel facts are verified', () => {
    expect(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }).tier).toBe('strong_reasoning');
  });

  it('unverified parcel blocks expensive Strategy reasoning', () => {
    const d = selectModel({ taskType: 'strategy_reasoning', parcelVerified: false });
    expect(d.availability).toBe('blocked');
    expect(d.tier).not.toBe('strong_reasoning');
  });

  it('AI watcher monitors cheap and escalates only on real failure', () => {
    const d = selectModel({ taskType: 'ai_watcher_monitor', escalationAllowed: true });
    expect(d.tier).toBe('cheap_fast');
    expect(d.escalation.allowed).toBe(true);
    expect(d.escalation.toTier).toBe('standard_reasoning');
    expect(d.escalation.reason).toBeTruthy();
  });

  it('seller prep uses standard reasoning, escalates to strong for complex negotiation', () => {
    expect(selectModel({ taskType: 'seller_prep' }).tier).toBe('standard_reasoning');
    expect(selectModel({ taskType: 'negotiation_strategy', parcelVerified: true }).tier).toBe('strong_reasoning');
  });
});

describe('escalation, gating, fallback', () => {
  it('returns a reason whenever escalation is taken', () => {
    const d = selectModel({ taskType: 'war_room_discussion', escalationAllowed: true });
    expect(d.escalation.allowed).toBe(true);
    expect(d.escalation.reason && d.escalation.reason.length).toBeGreaterThan(0);
  });

  it('keeps paid API/tool use gated separately from model routing', () => {
    const web = selectModel({ taskType: 'market_research', requiresWeb: true });
    expect(web.paidApiGated).toBe(true);
    const cheap = selectModel({ taskType: 'classification' });
    expect(cheap.paidApiGated).toBe(false);
  });

  it('reports not_available when a needed tool is unavailable instead of faking success', () => {
    const d = selectModel({ taskType: 'market_research', requiresWeb: true, toolAvailable: false });
    expect(d.availability).toBe('not_available');
  });

  it('high-cost approval flows through to escalation gating', () => {
    const d = selectModel({ taskType: 'war_room_discussion', escalationAllowed: true });
    expect(d.escalation.requiresTylerApproval).toBe(true);
  });

  it('provides a fallback tier and a token budget for every decision', () => {
    const d = selectModel({ taskType: 'classification' });
    expect(d.fallback.fallbackTier).toBeTruthy();
    expect(d.tokenBudget.budgetClass).toBeTruthy();
    expect(d.usageEstimate.budgetClass).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }))
      .toEqual(selectModel({ taskType: 'strategy_reasoning', parcelVerified: true }));
  });
});
