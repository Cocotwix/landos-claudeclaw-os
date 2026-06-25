import { describe, it, expect } from 'vitest';
import { executeRoutedTask } from './model-router-service.js';
import { buildProviderRegistry } from './provider-registry.js';
import { InMemoryTelemetrySink } from './router-telemetry.js';
import type { ModelClient } from './model-execution.js';

function mock(available: boolean, serves: string[], opts: { throw?: boolean } = {}): ModelClient {
  return {
    provider: 'mock',
    servesModel: (id) => serves.includes(id),
    available: () => available,
    complete: async (modelId, req) => {
      if (opts.throw) throw new Error('provider boom');
      return { text: `[${modelId}]${req.prompt}`, modelId };
    },
  };
}

const GEMMA = ['gemma-4-e4b', 'gemma-4-12b-q4'];
const summaryTask = { prompt: 'summarize', needs: { summarization: 0.7 }, stakes: 'low' as const, estimatedConfidence: 0.9, taskType: 'summarization' };

describe('safe mode (live routing OFF) preserves Claude behavior', () => {
  it('runs grunt-work on Claude even when local is available', async () => {
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA), anthropic: mock(true, ['claude']) });
    const out = await executeRoutedTask(summaryTask, { registry, live: false });
    expect(out.status).toBe('executed');
    expect(out.executedModelId).toBe('claude');
    expect(out.result?.text).toContain('[claude]');
  });
});

describe('live routing ON', () => {
  it('runs low-risk grunt-work on local Gemma when available', async () => {
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA), anthropic: mock(true, ['claude']) });
    const out = await executeRoutedTask(summaryTask, { registry, live: true });
    expect(out.status).toBe('executed');
    expect(out.executedModelId).toBe('gemma-4-e4b');
    expect(out.executedProvider).toBe('ollama');
  });

  it('keeps high-stakes on Claude (policy)', async () => {
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA), openai: mock(true, ['gpt']), anthropic: mock(true, ['claude']) });
    const out = await executeRoutedTask({ prompt: 'underwrite', needs: { reasoning: 0.8 }, stakes: 'high', taskType: 'underwriting_math' }, { registry, live: true });
    expect(out.executedModelId).toBe('claude');
    expect(out.decision.escalated).toBe(true);
  });

  it('escalates to best available configured model when local is unavailable', async () => {
    const registry = buildProviderRegistry({ openai: mock(true, ['gpt']) }); // no ollama, no claude
    const out = await executeRoutedTask(summaryTask, { registry, live: true });
    expect(out.status).toBe('executed');
    expect(out.executedModelId).toBe('gpt');
  });
});

describe('manual override', () => {
  it('runs the overridden model when available', async () => {
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA), anthropic: mock(true, ['claude']) });
    const out = await executeRoutedTask({ ...summaryTask, oneTimeModelId: 'gemma-4-12b-q4' }, { registry, live: true });
    expect(out.executedModelId).toBe('gemma-4-12b-q4');
    expect(out.decision.source).toBe('override');
  });

  it('reports unavailable override and NEVER substitutes', async () => {
    const registry = buildProviderRegistry({ anthropic: mock(true, ['claude']) }); // ollama not configured
    const out = await executeRoutedTask({ ...summaryTask, oneTimeModelId: 'gemma-4-e4b', overrideReason: 'operator wants local' }, { registry, live: true });
    expect(out.status).toBe('override_unavailable');
    expect(out.result).toBeUndefined();
    expect(out.decision.unavailableSelected).toBe('gemma-4-e4b');
  });
});

describe('Ollama unavailable + deterministic fallback', () => {
  it('automatic routing falls back to Claude when the chosen provider errors', async () => {
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA, { throw: true }), anthropic: mock(true, ['claude']) });
    const out = await executeRoutedTask(summaryTask, { registry, live: true });
    expect(out.status).toBe('executed');
    expect(out.executedModelId).toBe('claude');
    expect(out.fellBack).toBe(true);
  });

  it('reports no model available when nothing is configured', async () => {
    const registry = buildProviderRegistry({}); // nothing
    const out = await executeRoutedTask(summaryTask, { registry, live: true });
    expect(out.status).toBe('no_model_available');
  });
});

describe('telemetry capture', () => {
  it('records the routing+execution decision', async () => {
    const sink = new InMemoryTelemetrySink();
    const registry = buildProviderRegistry({ ollama: mock(true, GEMMA), anthropic: mock(true, ['claude']) });
    await executeRoutedTask(summaryTask, { registry, live: true, telemetrySink: sink });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].modelUsed).toBe('gemma-4-e4b');
    expect(sink.records[0].provider).toBe('ollama');
    expect(sink.records[0].executionEnvironment).toBe('local-ollama');
  });
});
