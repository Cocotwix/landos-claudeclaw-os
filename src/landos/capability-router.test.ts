import { describe, it, expect } from 'vitest';
import { routeByCapability } from './capability-router.js';
import { MODEL_CAPABILITIES, getCapabilityEntry, meetsNeeds } from './model-capabilities.js';
import { InMemoryOverrideStore, resolveOverride, setOverride, resetOverride } from './model-override.js';
import { telemetryFromDecision, InMemoryTelemetrySink, recordRouterDecision } from './router-telemetry.js';

const allAvail = () => true;
const onlyClaude = (id: string) => id === 'claude';
const exceptClaude = (id: string) => id !== 'claude';

describe('model capability profiles', () => {
  it('profiles the local + cloud stack', () => {
    const ids = MODEL_CAPABILITIES.map((m) => m.modelId);
    expect(ids).toEqual(expect.arrayContaining(['gemma-4-e4b', 'gemma-4-12b-q4', 'gpt', 'gemini', 'claude']));
    expect(getCapabilityEntry('gemma-4-e4b')?.openSource).toBe(true);
    expect(getCapabilityEntry('claude')?.openSource).toBe(false);
  });
  it('meetsNeeds gates on required capability levels', () => {
    expect(meetsNeeds(getCapabilityEntry('gemma-4-e4b')!.profile, { summarization: 0.7 })).toBe(true);
    expect(meetsNeeds(getCapabilityEntry('gemma-4-e4b')!.profile, { reasoning: 0.9 })).toBe(false);
  });
});

describe('manual override (always wins, never silently substituted)', () => {
  it('honors an available override', () => {
    const d = routeByCapability({ needs: { summarization: 0.5 }, operatorOverrideModelId: 'gpt' }, { available: allAvail });
    expect(d.source).toBe('override');
    expect(d.chosenModelId).toBe('gpt');
    expect(d.available).toBe(true);
  });
  it('reports an unavailable override and does NOT substitute another model', () => {
    const d = routeByCapability({ needs: { summarization: 0.5 }, operatorOverrideModelId: 'gpt' }, { available: onlyClaude });
    expect(d.source).toBe('override');
    expect(d.chosenModelId).toBe('gpt'); // not swapped to claude
    expect(d.available).toBe(false);
    expect(d.unavailableSelected).toBe('gpt');
    expect(d.notes.join(' ')).toMatch(/NOT substituting/i);
  });
});

describe('high-stakes -> Claude default', () => {
  it('routes high-stakes to Claude when available', () => {
    const d = routeByCapability({ needs: { reasoning: 0.8 }, stakes: 'high' }, { available: allAvail });
    expect(d.chosenModelId).toBe('claude');
    expect(d.escalated).toBe(true);
  });
  it('falls back (not to Claude) when Claude is unavailable', () => {
    const d = routeByCapability({ needs: { reasoning: 0.8 }, stakes: 'high' }, { available: exceptClaude });
    expect(d.chosenModelId).not.toBe('claude');
    expect(d.chosenModelId).toBe('gpt'); // best available meeting reasoning>=0.8
    expect(d.escalated).toBe(true);
  });
});

describe('open-source / local preference', () => {
  it('prefers local for low-stakes summarization grunt-work', () => {
    const d = routeByCapability({ needs: { summarization: 0.7 }, stakes: 'low', estimatedConfidence: 0.9 }, { available: allAvail });
    expect(d.chosenModelId).toMatch(/^gemma/);
    expect(d.openSourcePreferred).toBe(true);
    expect(d.source).toBe('capability_match');
  });
  it('uses closed when local is materially weaker (cannot meet the need)', () => {
    const d = routeByCapability({ needs: { reasoning: 0.9 }, stakes: 'low', estimatedConfidence: 0.9 }, { available: allAvail });
    expect(['gpt', 'claude']).toContain(d.chosenModelId);
    expect(d.openSourcePreferred).toBe(false);
    expect(d.closedSourceReason).toBeTruthy();
  });
});

describe('confidence + media escalation', () => {
  it('escalates low-confidence work to a closed model', () => {
    const d = routeByCapability({ needs: { summarization: 0.7 }, stakes: 'low', estimatedConfidence: 0.3 }, { available: allAvail });
    expect(d.escalated).toBe(true);
    expect(d.source).toBe('escalated');
    expect(getCapabilityEntry(d.chosenModelId!)?.openSource).toBe(false);
  });
  it('prefers local for low-stakes audio grunt-work', () => {
    const d = routeByCapability({ needs: { audio: 0.4 }, modality: 'audio', stakes: 'low', estimatedConfidence: 0.9 }, { available: allAvail });
    expect(d.chosenModelId).toBe('gemma-4-12b-q4');
    expect(d.openSourcePreferred).toBe(true);
  });
  it('escalates nuanced/poor-quality media to closed (e.g. Gemini)', () => {
    const d = routeByCapability({ needs: { audio: 0.4 }, modality: 'audio', stakes: 'low', nuanceSensitive: true }, { available: allAvail });
    expect(d.escalated).toBe(true);
    expect(d.chosenModelId).toBe('gemini'); // best closed on audio
  });
});

describe('fallback', () => {
  it('falls back to best available when nothing meets the needs', () => {
    const d = routeByCapability({ needs: { reasoning: 0.99 } }, { available: onlyClaude });
    expect(d.source).toBe('fallback');
    expect(d.chosenModelId).toBe('claude');
  });
});

describe('override precedence (run > task_type > agent > global)', () => {
  it('resolves the most-specific scope and resets correctly', () => {
    const store = new InMemoryOverrideStore();
    setOverride(store, 'global', undefined, 'claude');
    setOverride(store, 'agent', 'duke-due-diligence', 'gpt');
    setOverride(store, 'task_type', 'summarization', 'gemma-4-e4b');
    expect(resolveOverride({ agentId: 'duke-due-diligence', taskType: 'summarization' }, store)?.scope).toBe('task_type');
    expect(resolveOverride({ agentId: 'duke-due-diligence' }, store)?.modelId).toBe('gpt');
    expect(resolveOverride({}, store)?.modelId).toBe('claude');
    expect(resolveOverride({ oneTimeModelId: 'gemini', taskType: 'summarization' }, store)?.scope).toBe('run');
    resetOverride(store, 'task_type', 'summarization');
    expect(resolveOverride({ agentId: 'duke-due-diligence', taskType: 'summarization' }, store)?.modelId).toBe('gpt');
  });
});

describe('router telemetry (capture seam)', () => {
  it('builds a record from a decision and records it', async () => {
    const d = routeByCapability({ needs: { reasoning: 0.8 }, stakes: 'high' }, { available: allAvail });
    const sink = new InMemoryTelemetrySink();
    const rec = telemetryFromDecision(d, { taskType: 'underwriting_math', stakes: 'high' });
    await recordRouterDecision(sink, rec);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].modelUsed).toBe('claude');
    expect(sink.records[0].escalated).toBe(true);
    expect(sink.records[0].requiredCapabilities).toContain('reasoning');
  });
});
