// LandOS Model Router — operational execution service.
//
// Makes the router LIVE, not advisory: resolve manual override -> route by
// capability against the provider registry -> execute on the selected provider ->
// deterministic fallback (automatic only) -> record telemetry. Safe mode is the
// default: with LANDOS_LIVE_ROUTING off, availability is Claude-only, so every
// routed task resolves to Claude exactly as today. High-stakes always stays on
// Claude via policy. Manual overrides win and are never silently substituted.
//
// No .env is read here beyond the app's normal config; no secret values are
// logged. The default Claude runner uses the same auth path as agent.ts. Tests
// inject a registry + runner, so no paid APIs/credentials are required.

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  OPENAI_API_KEY, OPENROUTER_API_KEY,
  LM_STUDIO_URL, VLLM_URL, GOOGLE_API_KEY,
} from '../config.js';
import { readEnvFile } from '../env.js';
import { getScrubbedSdkEnv } from '../security.js';
import { routeByCapability, type JobRequirements, type RouteDecision } from './capability-router.js';
import { ProviderRegistry, buildProviderRegistry } from './provider-registry.js';
import {
  ClaudeClient, OpenAICompatibleClient, GeminiClient, OllamaClient,
  type CompletionRequest, type CompletionResult,
} from './model-execution.js';
import { resolveOverride, type OverrideStore } from './model-override.js';
import { telemetryFromDecision, recordRouterDecision, InMemoryTelemetrySink, type TelemetrySink } from './router-telemetry.js';
import { resolveLiveRouting, resolveOllamaHost, resolveOllamaModelMap } from './router-runtime-config.js';

/** Effective live-routing flag: persisted operator setting wins, else the env
 *  flag (see router-runtime-config.ts). Single source of truth for the dashboard
 *  status, the live execution path, and the grunt path. */
export function liveRoutingEnabled(): boolean { return resolveLiveRouting().enabled; }

/** Config policy: high-stakes pins Claude (operator-set, not hardcoded in routing). */
export const HIGH_STAKES_POLICY = { highStakesModelId: 'claude' } as const;

type ClaudeRunner = (modelId: string, req: CompletionRequest) => Promise<CompletionResult>;

/** Real Claude one-shot runner (mirrors agent.ts auth; subscription/session). */
const defaultClaudeRunner: ClaudeRunner = async (modelId, req) => {
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  const sdkEnv = getScrubbedSdkEnv(secrets);
  let text = '';
  for await (const ev of query({
    prompt: req.system ? `${req.system}\n\n${req.prompt}` : req.prompt,
    options: { settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, maxTurns: 1, env: sdkEnv },
  })) {
    const e = ev as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
    if (e.type === 'assistant' && e.message?.content) for (const b of e.message.content) if (b.type === 'text') text += b.text ?? '';
  }
  return { text, modelId };
};

/** Build the live registry from config. Clients are constructed with config
 *  values (never logged); a provider with no credential is simply omitted. */
export function buildRegistryFromConfig(claudeRunner: ClaudeRunner = defaultClaudeRunner): ProviderRegistry {
  // Ollama host + model-tag map come from the runtime resolver (persisted setting
  // over env), so an operator can enable/point Ollama without a .env edit and the
  // execution path sends the REAL Ollama tag (e.g. 'gemma4:12b'), not the
  // internal id. An empty host means the provider is simply not installed.
  const ollamaHost = resolveOllamaHost().host;
  const ollamaModelMap = resolveOllamaModelMap();
  return buildProviderRegistry({
    anthropic: new ClaudeClient(claudeRunner),
    openai: OPENAI_API_KEY ? new OpenAICompatibleClient({ provider: 'openai', apiKey: OPENAI_API_KEY, serves: ['gpt'] }) : undefined,
    openrouter: OPENROUTER_API_KEY ? new OpenAICompatibleClient({ provider: 'openrouter', apiKey: OPENROUTER_API_KEY, serves: ['gpt'] }) : undefined,
    google: GOOGLE_API_KEY ? new GeminiClient({ apiKeyPresent: true }) : undefined,
    ollama: ollamaHost ? new OllamaClient({ host: ollamaHost, modelMap: ollamaModelMap }) : undefined,
    lmstudio: LM_STUDIO_URL ? new OpenAICompatibleClient({ provider: 'lmstudio', baseURL: LM_STUDIO_URL, local: true, serves: ['gemma-4-e4b', 'gemma-4-12b-q4'] }) : undefined,
    vllm: VLLM_URL ? new OpenAICompatibleClient({ provider: 'vllm', baseURL: VLLM_URL, local: true, serves: ['gemma-4-e4b', 'gemma-4-12b-q4'] }) : undefined,
  });
}

export interface RoutedTaskRequest {
  prompt: string;
  system?: string;
  needs: JobRequirements['needs'];
  taskType?: string;
  stakes?: JobRequirements['stakes'];
  modality?: JobRequirements['modality'];
  estimatedConfidence?: number;
  nuanceSensitive?: boolean;
  inputQuality?: JobRequirements['inputQuality'];
  agentId?: string;
  oneTimeModelId?: string;
  overrideReason?: string;
}

export type RoutedTaskStatus = 'executed' | 'override_unavailable' | 'no_model_available' | 'error';

export interface RoutedTaskOutcome {
  status: RoutedTaskStatus;
  decision: RouteDecision;
  result?: CompletionResult;
  executedModelId?: string;
  executedProvider?: string;
  executedEnvironment?: string;
  fellBack?: boolean;
  liveRouting: boolean;
  message?: string;
}

export interface RoutedTaskDeps {
  registry?: ProviderRegistry;
  overrideStore?: OverrideStore;
  telemetrySink?: TelemetrySink;
  policy?: { highStakesModelId?: string };
  /** Override the live flag (tests). */
  live?: boolean;
}

const sharedSink = new InMemoryTelemetrySink();
export function routerTelemetrySink(): InMemoryTelemetrySink { return sharedSink; }

/**
 * Resolve + execute a task through the model router. Safe-mode-aware, override-
 * respecting, with deterministic automatic fallback and telemetry capture.
 */
export async function executeRoutedTask(req: RoutedTaskRequest, deps: RoutedTaskDeps = {}): Promise<RoutedTaskOutcome> {
  const live = deps.live ?? liveRoutingEnabled();
  const registry = deps.registry ?? buildRegistryFromConfig();
  const sink = deps.telemetrySink ?? sharedSink;
  const policy = deps.policy ?? HIGH_STAKES_POLICY;

  const override = deps.overrideStore
    ? resolveOverride({ agentId: req.agentId, taskType: req.taskType, oneTimeModelId: req.oneTimeModelId }, deps.overrideStore)
    : (req.oneTimeModelId ? { modelId: req.oneTimeModelId, scope: 'run' as const } : null);

  // Safe mode: availability is Claude-only unless live routing is enabled.
  const regAvail = registry.availability();
  const available = live ? regAvail : (id: string) => id === 'claude' && regAvail('claude');

  const jr: JobRequirements = {
    needs: req.needs, stakes: req.stakes, modality: req.modality,
    estimatedConfidence: req.estimatedConfidence, nuanceSensitive: req.nuanceSensitive,
    inputQuality: req.inputQuality, operatorOverrideModelId: override?.modelId,
  };
  const decision = routeByCapability(jr, { available, policy });

  const record = (extra: Parameters<typeof telemetryFromDecision>[1] = {}) =>
    recordRouterDecision(sink, telemetryFromDecision(decision, { taskType: req.taskType, stakes: req.stakes, overrideReason: req.overrideReason, ...extra }));

  // Manual override that is unavailable -> report, NEVER substitute.
  if (decision.source === 'override' && !decision.available) {
    await record();
    return { status: 'override_unavailable', decision, liveRouting: live,
      message: `Selected model "${decision.chosenModelId}" is unavailable. Not substituting — choose another model, enable its provider, or clear the override.` };
  }
  const chosen = decision.chosenModelId;
  if (!chosen || !available(chosen)) {
    await record();
    return { status: 'no_model_available', decision, liveRouting: live, message: 'No configured model is available for this task.' };
  }

  const prov = registry.providerFor(chosen);
  const start = Date.now();
  try {
    const result = await registry.complete(chosen, { prompt: req.prompt, system: req.system });
    await record({ provider: prov?.id, executionEnvironment: prov?.environmentId, runtime: prov?.execution, latencyMs: Date.now() - start });
    return { status: 'executed', decision, result, executedModelId: chosen, executedProvider: prov?.id, executedEnvironment: prov?.environmentId, liveRouting: live };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Deterministic fallback (AUTOMATIC routing only) -> Claude when available.
    if (decision.source !== 'override' && chosen !== 'claude' && available('claude')) {
      try {
        const result = await registry.complete('claude', { prompt: req.prompt, system: req.system });
        await record({ provider: 'anthropic', executionEnvironment: 'cloud', runtime: 'cloud', latencyMs: Date.now() - start });
        return { status: 'executed', decision, result, executedModelId: 'claude', executedProvider: 'anthropic', executedEnvironment: 'cloud', fellBack: true, liveRouting: live, message: `Primary model "${chosen}" failed; fell back to Claude.` };
      } catch (e2) {
        await record();
        return { status: 'error', decision, liveRouting: live, message: `Execution failed (${msg}); fallback failed (${e2 instanceof Error ? e2.message : String(e2)}).` };
      }
    }
    await record();
    return { status: 'error', decision, liveRouting: live, message: `Execution failed: ${msg}` };
  }
}
