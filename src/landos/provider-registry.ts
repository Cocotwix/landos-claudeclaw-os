// LandOS Provider Registry — the single, provider-agnostic abstraction the router
// (and War Room) talk to. It discovers/tracks every configured provider under its
// execution environment, exposes status + served models + capability access, and
// dispatches execution. Adding a future provider = register one descriptor wrapping
// a ModelClient adapter; routing logic never changes.
//
// Credentials are injected at the adapter (ModelClient) boundary — this module
// never reads .env. Network health is NOT probed here (no calls in tests); a
// provider is "reachable/healthy" only as far as its injected client reports
// configured + enabled, unless an explicit probe() is run by the operator.

import { EXECUTION_ENVIRONMENTS, getExecutionEnvironment, type ExecutionEnvironment } from './execution-environment.js';
import type { ModelClient, CompletionRequest, CompletionResult } from './model-execution.js';

export interface ProviderStatus {
  installed: boolean;       // an execution client exists for this provider
  configured: boolean;      // credentials/host injected (client.available())
  reachable: boolean;       // best-effort; true when configured+enabled (no network probe here)
  healthy: boolean;
  enabled: boolean;         // operator can disable a provider without removing it
  authStatus: 'none' | 'configured' | 'unknown';
}

export interface ProviderDescriptor {
  id: string;
  environmentId: string;
  kind: 'oauth' | 'api' | 'openai-compat' | 'local-http' | 'mcp';
  label: string;
  execution: 'local' | 'cloud';
  /** Model ids this provider can serve (overlaps allowed across providers). */
  servesModels: string[];
  /** Execution adapter (injected). Absent = not installed. */
  client?: ModelClient;
  /** Operator toggle. Defaults to true. */
  enabled?: boolean;
}

export class ProviderRegistry {
  constructor(
    private providers: ProviderDescriptor[],
    private envs: readonly ExecutionEnvironment[] = EXECUTION_ENVIRONMENTS,
  ) {}

  environments(): readonly ExecutionEnvironment[] { return this.envs; }
  list(): ProviderDescriptor[] { return this.providers; }

  status(p: ProviderDescriptor): ProviderStatus {
    const installed = !!p.client;
    const enabled = p.enabled !== false;
    const configured = installed && !!p.client!.available();
    const usable = configured && enabled;
    return {
      installed,
      configured,
      reachable: usable, // no network probe in this layer
      healthy: usable,
      enabled,
      authStatus: configured ? 'configured' : installed ? 'none' : 'unknown',
    };
  }

  /** A model is available when some installed+configured+enabled provider serves it. */
  availability(): (modelId: string) => boolean {
    return (modelId: string) => this.providers.some((p) =>
      p.servesModels.includes(modelId) && p.enabled !== false && !!p.client?.available());
  }

  availableModelIds(allModelIds: string[]): string[] {
    const pred = this.availability();
    return allModelIds.filter(pred);
  }

  /** First usable provider that serves the model id. */
  providerFor(modelId: string): ProviderDescriptor | undefined {
    return this.providers.find((p) => p.servesModels.includes(modelId) && p.enabled !== false && !!p.client?.available());
  }

  async complete(modelId: string, req: CompletionRequest): Promise<CompletionResult> {
    const p = this.providerFor(modelId);
    if (!p || !p.client) throw new Error(`no available provider for model "${modelId}"`);
    return p.client.complete(modelId, req);
  }

  /** Structured EE -> provider -> model tree with status, for the dashboard. */
  describe(): Array<{ environment: ExecutionEnvironment; providers: Array<{ descriptor: Omit<ProviderDescriptor, 'client'>; status: ProviderStatus }> }> {
    return this.envs.map((env) => ({
      environment: env,
      providers: this.providers
        .filter((p) => p.environmentId === env.id)
        .map((p) => ({
          descriptor: { id: p.id, environmentId: p.environmentId, kind: p.kind, label: p.label, execution: p.execution, servesModels: p.servesModels, enabled: p.enabled !== false },
          status: this.status(p),
        })),
    }));
  }
}

/**
 * Build a registry from injected execution clients (credentials supplied by the
 * caller/config — never read here). Any client may be omitted; that provider is
 * then "not installed". Used by the dashboard route + (later) the live agent path.
 */
export function buildProviderRegistry(clients: {
  ollama?: ModelClient;
  anthropic?: ModelClient;
  openai?: ModelClient;
  google?: ModelClient;
  openrouter?: ModelClient;
} = {}): ProviderRegistry {
  const providers: ProviderDescriptor[] = [
    { id: 'ollama', environmentId: 'local-ollama', kind: 'local-http', label: 'Ollama (local Gemma + open models)', execution: 'local', servesModels: ['gemma-4-e4b', 'gemma-4-12b-q4'], client: clients.ollama },
    { id: 'anthropic', environmentId: 'cloud', kind: 'oauth', label: 'Anthropic (Claude)', execution: 'cloud', servesModels: ['claude'], client: clients.anthropic },
    { id: 'openai', environmentId: 'cloud', kind: 'api', label: 'OpenAI', execution: 'cloud', servesModels: ['gpt'], client: clients.openai },
    { id: 'google', environmentId: 'cloud', kind: 'api', label: 'Google (Gemini) — also the War Room voice provider', execution: 'cloud', servesModels: ['gemini'], client: clients.google },
    { id: 'openrouter', environmentId: 'openrouter', kind: 'openai-compat', label: 'OpenRouter', execution: 'cloud', servesModels: ['gpt'], client: clients.openrouter },
  ];
  return new ProviderRegistry(providers);
}

export { getExecutionEnvironment };
