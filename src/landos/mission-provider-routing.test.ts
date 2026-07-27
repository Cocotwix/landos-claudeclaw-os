// Item 17 — provider routing for native mission children.
//
// Every provider here is an INJECTED fake. No credential is read, no network call
// is made, and no paid API is touched.

import { describe, expect, it } from 'vitest';

import { buildProviderRegistry } from './provider-registry.js';
import type { CompletionRequest, CompletionResult, ModelClient } from './model-execution.js';
import {
  MISSION_PROVIDER_CATALOG,
  describeMissionProviderCatalog,
  deterministicAssignment,
  resolveMissionProviderAssignment,
  runRoutedMissionChild,
  type MissionProviderPolicy,
} from './mission-provider-routing.js';

class FakeClient implements ModelClient {
  readonly provider: string;
  constructor(
    provider: string,
    private serves: string[],
    private opts: { available?: boolean; text?: string; throws?: string } = {},
  ) {
    this.provider = provider;
  }
  servesModel(modelId: string): boolean { return this.serves.includes(modelId); }
  available(): boolean { return this.opts.available !== false; }
  async complete(modelId: string, _req: CompletionRequest): Promise<CompletionResult> {
    if (this.opts.throws) throw new Error(this.opts.throws);
    return { text: this.opts.text ?? 'fake output', modelId };
  }
}

const claudeOnly = () => buildProviderRegistry({ anthropic: new FakeClient('anthropic', ['claude']) });
const localOnly = () => buildProviderRegistry({ ollama: new FakeClient('ollama', ['gemma-4-e4b', 'gemma-4-12b-q4']) });
const nothing = () => buildProviderRegistry({});

const routedPolicy = (overrides: Partial<MissionProviderPolicy> = {}): MissionProviderPolicy => ({
  mode: 'model_routed',
  rationale: 'This lane summarizes free text.',
  needs: { classification: 0.7 },
  ...overrides,
});

describe('a deterministic lane names no provider and spends nothing', () => {
  it('resolves to the deterministic assignment for an undeclared policy', async () => {
    const assignment = await resolveMissionProviderAssignment(undefined, { live: false });
    expect(assignment.mode).toBe('deterministic');
    expect(assignment.providerId).toBeNull();
    expect(assignment.modelId).toBeNull();
    expect(assignment.available).toBe(true);
    expect(assignment.reason).toMatch(/no credit is spent/i);
  });

  it('resolves a declared deterministic lane without consulting any registry', async () => {
    const assignment = await resolveMissionProviderAssignment(
      { mode: 'deterministic', rationale: 'The accepted parcel identity is read from LandOS.' },
      { live: true },
    );
    expect(assignment.mode).toBe('deterministic');
    expect(assignment.source).toBe('deterministic');
    expect(assignment.reason).toMatch(/The accepted parcel identity is read from LandOS/);
    expect(deterministicAssignment('x').providerId).toBeNull();
  });
});

describe('safe mode is preserved', () => {
  it('keeps a routed lane on Claude when live routing is OFF, even with a local provider available', async () => {
    const registry = buildProviderRegistry({
      anthropic: new FakeClient('anthropic', ['claude']),
      ollama: new FakeClient('ollama', ['gemma-4-e4b', 'gemma-4-12b-q4']),
    });
    const assignment = await resolveMissionProviderAssignment(routedPolicy(), { registry, live: false });
    expect(assignment.modelId).toBe('claude');
    expect(assignment.providerId).toBe('anthropic');
    expect(assignment.available).toBe(true);
    expect(assignment.liveRouting).toBe(false);
    expect(assignment.reason).toMatch(/Live routing is off/);
  });

  it('routes to the configured local provider once live routing is ON', async () => {
    const assignment = await resolveMissionProviderAssignment(routedPolicy(), { registry: localOnly(), live: true });
    expect(assignment.providerId).toBe('ollama');
    expect(assignment.modelId).toMatch(/^gemma/);
    expect(assignment.environmentId).toBe('local-ollama');
    expect(assignment.available).toBe(true);
    expect(assignment.liveRouting).toBe(true);
  });
});

describe('an unroutable lane says so instead of inventing a provider', () => {
  it('reports unavailable when no provider serves anything', async () => {
    const assignment = await resolveMissionProviderAssignment(routedPolicy(), { registry: nothing(), live: true });
    expect(assignment.available).toBe(false);
    expect(assignment.source).toBe('unavailable');
    expect(assignment.providerId).toBeNull();
    expect(assignment.reason).toMatch(/Nothing is substituted|Nothing is invented/i);
  });

  it('never substitutes another model for an unavailable operator pin', async () => {
    const assignment = await resolveMissionProviderAssignment(
      routedPolicy({ operatorOverrideModelId: 'gemma-4-12b-q4' }),
      { registry: claudeOnly(), live: true },
    );
    expect(assignment.available).toBe(false);
    expect(assignment.modelId).toBe('gemma-4-12b-q4');
    expect(assignment.providerId).toBeNull();
    expect(assignment.reason).toMatch(/Nothing is substituted/i);
  });
});

describe('executing a routed lane preserves failure meaning', () => {
  it('returns a completed handback naming the provider that actually ran', async () => {
    const result = await runRoutedMissionChild({
      policy: routedPolicy(),
      prompt: 'summarize',
      deps: { registry: localOnly(), live: true },
    });
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('expected completed');
    expect(result.result.executedProvider).toBe('ollama');
    expect(result.result.text).toBe('fake output');
  });

  it('BLOCKS (never fails) when no model is available — a configuration gap', async () => {
    const result = await runRoutedMissionChild({
      policy: routedPolicy(),
      prompt: 'summarize',
      deps: { registry: nothing(), live: true },
    });
    expect(result.status).toBe('blocked');
    expect(result.summary).toMatch(/provider configuration gap/i);
  });

  it('THROWS on a real execution error so the runner classifies it as a failure', async () => {
    const registry = buildProviderRegistry({
      ollama: new FakeClient('ollama', ['gemma-4-e4b', 'gemma-4-12b-q4'], { throws: 'ollama HTTP 500' }),
    });
    await expect(
      runRoutedMissionChild({ policy: routedPolicy(), prompt: 'summarize', deps: { registry, live: true } }),
    ).rejects.toThrow(/ollama HTTP 500|Execution failed/);
  });
});

describe('provider catalog reconciles the upstream engine with the LandOS registry', () => {
  it('lists every provider the repository supports', () => {
    const ids = MISSION_PROVIDER_CATALOG.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([
      'claude', 'openai', 'openrouter', 'google', 'ollama', 'lmstudio', 'vllm', 'hermes', 'codex', 'opencode',
    ]));
  });

  it('reports an agent-session provider as NOT mission-routable rather than claiming it', () => {
    const catalog = describeMissionProviderCatalog({ registry: claudeOnly() });
    const codex = catalog.find((entry) => entry.id === 'codex')!;
    expect(codex.surface).toBe('agent_session');
    expect(codex.missionRoutable).toBe(false);
    expect(codex.detail).toMatch(/Not mission-routable by design/i);
  });

  it('marks a configured completion provider mission-routable and an unconfigured one not', () => {
    const catalog = describeMissionProviderCatalog({ registry: claudeOnly() });
    expect(catalog.find((entry) => entry.id === 'claude')!.missionRoutable).toBe(true);
    expect(catalog.find((entry) => entry.id === 'ollama')!.missionRoutable).toBe(false);
    expect(catalog.find((entry) => entry.id === 'ollama')!.detail).toMatch(/Not installed/i);
  });

  it('claims nothing about routability when no registry is supplied', () => {
    const openai = describeMissionProviderCatalog().find((entry) => entry.id === 'openai')!;
    expect(openai.missionRoutable).toBe(false);
    expect(openai.detail).toMatch(/not evaluated and is not claimed/i);
  });
});

describe('Hermes is optional and native operation does not need it', () => {
  it('is absent by default: not installed, not routable, and marked optional', () => {
    const hermes = describeMissionProviderCatalog({ registry: claudeOnly() }).find((entry) => entry.id === 'hermes')!;
    expect(hermes.optional).toBe(true);
    expect(hermes.missionRoutable).toBe(false);
    expect(hermes.detail).toMatch(/Optional: native LandOS operation does not require it/i);
  });

  it('routes a native mission lane with Hermes ABSENT', async () => {
    const registry = buildProviderRegistry({ anthropic: new FakeClient('anthropic', ['claude']) });
    expect(registry.list().find((entry) => entry.id === 'hermes')!.client).toBeUndefined();
    const assignment = await resolveMissionProviderAssignment(routedPolicy(), { registry, live: true });
    expect(assignment.available).toBe(true);
    expect(assignment.providerId).toBe('anthropic');
  });

  it('becomes usable only when an endpoint is injected, and changes nothing else', async () => {
    const registry = buildProviderRegistry({
      hermes: new FakeClient('hermes', ['gemma-4-e4b', 'gemma-4-12b-q4'], { text: 'hermes output' }),
    });
    const assignment = await resolveMissionProviderAssignment(routedPolicy(), { registry, live: true });
    expect(assignment.providerId).toBe('hermes');
    expect(assignment.environmentId).toBe('hermes');

    const catalog = describeMissionProviderCatalog({ registry });
    expect(catalog.find((entry) => entry.id === 'hermes')!.missionRoutable).toBe(true);
    // Every other provider is still reported on its own merits.
    expect(catalog.find((entry) => entry.id === 'claude')!.missionRoutable).toBe(false);
  });
});
