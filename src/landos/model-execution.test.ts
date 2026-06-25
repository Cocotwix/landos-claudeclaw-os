import { describe, it, expect } from 'vitest';
import {
  ClaudeClient,
  OpenAICompatibleClient,
  GeminiClient,
  OllamaClient,
  ModelExecutionRegistry,
} from './model-execution.js';
import { routeByCapability } from './capability-router.js';

describe('execution clients are credential-gated (no keys -> unavailable, no calls)', () => {
  it('reports unavailable without injected credentials', () => {
    expect(new ClaudeClient().available()).toBe(false);
    expect(new OpenAICompatibleClient({ provider: 'openai' }).available()).toBe(false);
    expect(new OpenAICompatibleClient({ provider: 'openrouter' }).available()).toBe(false);
    expect(new GeminiClient().available()).toBe(false);
    expect(new OllamaClient().available()).toBe(false);
  });
  it('declares which model ids each client serves', () => {
    expect(new ClaudeClient().servesModel('claude')).toBe(true);
    expect(new OpenAICompatibleClient({ provider: 'openai' }).servesModel('gpt')).toBe(true);
    expect(new GeminiClient().servesModel('gemini')).toBe(true);
    expect(new OllamaClient().servesModel('gemma-4-e4b')).toBe(true);
    expect(new OllamaClient().servesModel('claude')).toBe(false);
  });
});

describe('ModelExecutionRegistry dispatch', () => {
  it('with no configured clients, nothing is available and complete throws', async () => {
    const reg = new ModelExecutionRegistry([
      new ClaudeClient(),
      new OpenAICompatibleClient({ provider: 'openai' }),
      new GeminiClient(),
      new OllamaClient(),
    ]);
    const avail = reg.availability();
    expect(avail('claude')).toBe(false);
    expect(avail('gpt')).toBe(false);
    expect(reg.clientFor('claude')).toBeUndefined();
    await expect(reg.complete('claude', { prompt: 'hi' })).rejects.toThrow(/no available execution client/);
  });

  it('an injected Claude runner makes claude available and completes (no live call)', async () => {
    const reg = new ModelExecutionRegistry([
      new ClaudeClient(async (modelId, req) => ({ text: 'OK:' + req.prompt, modelId })),
    ]);
    expect(reg.availability()('claude')).toBe(true);
    const r = await reg.complete('claude', { prompt: 'ping' });
    expect(r.text).toBe('OK:ping');
    expect(r.modelId).toBe('claude');
  });

  it('feeds availability into the router (only claude wired -> high-stakes -> claude)', () => {
    const reg = new ModelExecutionRegistry([
      new ClaudeClient(async (modelId) => ({ text: '', modelId })),
      new OpenAICompatibleClient({ provider: 'openai' }), // no key -> unavailable
      new OllamaClient(), // no host -> unavailable
    ]);
    const d = routeByCapability({ needs: { reasoning: 0.8 }, stakes: 'high' }, { available: reg.availability() });
    expect(d.chosenModelId).toBe('claude');
  });

  it('availableModelIds reflects only wired providers', () => {
    const reg = new ModelExecutionRegistry([new ClaudeClient(async (m) => ({ text: '', modelId: m }))]);
    expect(reg.availableModelIds(['claude', 'gpt', 'gemini', 'gemma-4-e4b'])).toEqual(['claude']);
  });
});
