import { describe, it, expect } from 'vitest';
import { ProviderRegistry, buildProviderRegistry, type ProviderDescriptor } from './provider-registry.js';
import { EXECUTION_ENVIRONMENTS } from './execution-environment.js';
import type { ModelClient } from './model-execution.js';

function mockClient(available: boolean, serves: string[]): ModelClient {
  return {
    provider: 'mock',
    servesModel: (id) => serves.includes(id),
    available: () => available,
    complete: async (modelId, req) => ({ text: 'mock:' + req.prompt, modelId }),
  };
}

describe('execution environments', () => {
  it('catalogs local + cloud + aggregator + local-server + mcp environments', () => {
    const ids = EXECUTION_ENVIRONMENTS.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['local-ollama', 'cloud', 'openrouter', 'lmstudio', 'vllm', 'mcp']));
  });
});

describe('ProviderRegistry (no credentials injected)', () => {
  it('shows the EE -> provider tree with not-installed status and nothing available', () => {
    const reg = buildProviderRegistry();
    const tree = reg.describe();
    expect(tree.find((t) => t.environment.id === 'local-ollama')?.providers.some((p) => p.descriptor.id === 'ollama')).toBe(true);
    expect(reg.availability()('claude')).toBe(false);
    expect(reg.availableModelIds(['claude', 'gpt', 'gemini', 'gemma-4-e4b'])).toEqual([]);
  });
  it('complete throws when no provider is available', async () => {
    await expect(buildProviderRegistry().complete('claude', { prompt: 'hi' })).rejects.toThrow(/no available provider/);
  });
});

describe('ProviderRegistry (credentials injected)', () => {
  it('marks a provider configured and routes execution to it', async () => {
    const reg = buildProviderRegistry({ anthropic: mockClient(true, ['claude']) });
    expect(reg.availability()('claude')).toBe(true);
    const r = await reg.complete('claude', { prompt: 'ping' });
    expect(r.text).toBe('mock:ping');
    const status = reg.describe().flatMap((t) => t.providers).find((p) => p.descriptor.id === 'anthropic')!.status;
    expect(status.installed).toBe(true);
    expect(status.configured).toBe(true);
    expect(status.healthy).toBe(true);
  });

  it('an operator-disabled provider is never available even if configured', () => {
    const descriptors: ProviderDescriptor[] = [
      { id: 'ollama', environmentId: 'local-ollama', kind: 'local-http', label: 'Ollama', execution: 'local', servesModels: ['gemma-4-e4b'], client: mockClient(true, ['gemma-4-e4b']), enabled: false },
    ];
    const reg = new ProviderRegistry(descriptors);
    expect(reg.availability()('gemma-4-e4b')).toBe(false);
    expect(reg.status(descriptors[0]).enabled).toBe(false);
  });

  it('feeds availability into the router (provider-neutral)', async () => {
    const reg = buildProviderRegistry({ ollama: mockClient(true, ['gemma-4-e4b', 'gemma-4-12b-q4']) });
    const { routeByCapability } = await import('./capability-router.js');
    const d = routeByCapability({ needs: { summarization: 0.7 }, stakes: 'low', estimatedConfidence: 0.9 }, { available: reg.availability() });
    expect(d.chosenModelId).toBe('gemma-4-e4b'); // only local wired -> local preferred
    expect(d.openSourcePreferred).toBe(true);
  });
});
