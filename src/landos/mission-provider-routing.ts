// Provider routing for native LandOS mission children.
//
// This is the BRIDGE, not a new routing layer. Everything about how a model is
// chosen already exists in the repository and is reused verbatim:
//   • capability-router.ts   decides WHICH model a job's capability needs imply
//   • provider-registry.ts   decides WHICH provider can actually serve it
//   • router-runtime-config  decides whether live routing is on (setting > env)
//   • model-router-service   owns safe mode, override handling, fallback, telemetry
//
// What was missing is that a mission child had no way to reach any of it. This
// module gives a child an explicit, persisted PROVIDER ASSIGNMENT and — for a
// lane that genuinely needs a model — an executor that runs through the existing
// routed-task path.
//
// Two honest execution modes:
//   • deterministic — the lane is LandOS code reading accepted data. NO provider
//     is engaged and NO credit is spent. The assignment says exactly that rather
//     than naming a provider the lane never uses.
//   • model_routed  — the lane's work is routed through the existing router.
//
// Safe mode is preserved: with live routing off, availability is Claude-only, so
// a routed lane resolves to Claude exactly as today.
//
// Heavy modules (the Claude SDK via model-router-service) are imported LAZILY so
// that a mission whose children are all deterministic never loads them.

import { checkProviderAvailability, type ProviderType } from '../provider.js';
import { routeByCapability, type Modality, type Stakes } from './capability-router.js';
import type { CapabilityProfile } from './model-capabilities.js';
import type { ProviderRegistry } from './provider-registry.js';
import { resolveLiveRouting } from './router-runtime-config.js';

export type MissionChildExecutionMode = 'deterministic' | 'model_routed';

/** Declared on a mission child spec. Pure data; carries no credential. */
export interface MissionProviderPolicy {
  mode: MissionChildExecutionMode;
  /** Why this lane executes this way. Shown to the operator verbatim. */
  rationale: string;
  /** model_routed only: capability needs handed to the existing capability router. */
  needs?: Partial<CapabilityProfile>;
  stakes?: Stakes;
  modality?: Modality;
  /** Operator override scope keys, when this lane participates in them. */
  taskType?: string;
  agentId?: string;
  /** An explicit operator pin for this lane. Never silently substituted. */
  operatorOverrideModelId?: string;
}

export interface MissionProviderAssignment {
  mode: MissionChildExecutionMode;
  providerId: string | null;
  providerLabel: string | null;
  modelId: string | null;
  environmentId: string | null;
  source: 'deterministic' | 'override' | 'capability_match' | 'escalated' | 'fallback' | 'unavailable';
  /** True when the assignment can actually run as stated. */
  available: boolean;
  /** Effective live-routing flag at resolution time (setting > env). */
  liveRouting: boolean;
  reason: string;
}

export interface MissionProviderDeps {
  registry?: ProviderRegistry;
  /** Override the effective live-routing flag (tests). */
  live?: boolean;
}

/** The assignment a deterministic lane carries. No provider, no spend. */
export function deterministicAssignment(rationale: string, liveRouting = false): MissionProviderAssignment {
  return {
    mode: 'deterministic',
    providerId: null,
    providerLabel: null,
    modelId: null,
    environmentId: null,
    source: 'deterministic',
    available: true,
    liveRouting,
    reason: `${rationale} This lane is deterministic LandOS code: no model provider is engaged, no credit is spent, and no provider outage can change its result.`,
  };
}

/**
 * Resolve the provider assignment for one mission child.
 *
 * Async because the routed path lazily loads the router service (which pulls the
 * Claude SDK). A deterministic lane resolves synchronously in effect — it never
 * touches the registry, so a mission of deterministic children loads nothing.
 */
export async function resolveMissionProviderAssignment(
  policy: MissionProviderPolicy | undefined,
  deps: MissionProviderDeps = {},
): Promise<MissionProviderAssignment> {
  const live = deps.live ?? resolveLiveRouting().enabled;

  if (!policy || policy.mode === 'deterministic') {
    return deterministicAssignment(
      policy?.rationale ?? 'No model-routed work is declared for this lane.',
      live,
    );
  }

  const { HIGH_STAKES_POLICY, buildRegistryFromConfig } = await import('./model-router-service.js');
  const registry = deps.registry ?? buildRegistryFromConfig();

  // Safe mode mirrors executeRoutedTask exactly: availability is Claude-only
  // until live routing is enabled, so enabling this bridge cannot silently move
  // work onto another provider.
  const registryAvailable = registry.availability();
  const available = live ? registryAvailable : (id: string) => id === 'claude' && registryAvailable('claude');

  const decision = routeByCapability(
    {
      needs: policy.needs ?? { reasoning: 0.5 },
      stakes: policy.stakes,
      modality: policy.modality,
      operatorOverrideModelId: policy.operatorOverrideModelId,
    },
    { available, policy: HIGH_STAKES_POLICY },
  );

  const chosen = decision.chosenModelId;
  if (!chosen || !decision.available) {
    return {
      mode: 'model_routed',
      providerId: null,
      providerLabel: null,
      modelId: chosen ?? null,
      environmentId: null,
      source: 'unavailable',
      available: false,
      liveRouting: live,
      reason: chosen
        ? `The router selected "${chosen}" but no enabled, configured provider serves it${live ? '' : ' (live routing is off, so only Claude is available)'}. Nothing is substituted for it.`
        : `No configured model satisfies this lane's declared capability needs. Nothing is invented.`,
    };
  }

  const provider = registry.providerFor(chosen);

  return {
    mode: 'model_routed',
    providerId: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
    modelId: chosen,
    environmentId: provider?.environmentId ?? null,
    source: decision.source,
    available: !!provider,
    liveRouting: live,
    reason:
      `Routed to "${chosen}" on provider "${provider?.id ?? 'none'}" by ${decision.source}` +
      `${decision.escalated ? ` (escalated: ${decision.escalationReason ?? 'unstated'})` : ''}. ` +
      `${live ? 'Live routing is on.' : 'Live routing is off, so the assignment stays on Claude.'} ${policy.rationale}`,
  };
}

/**
 * Run a model-routed mission child through the EXISTING routed-task path.
 *
 * Failure meaning is preserved rather than flattened:
 *   • an unavailable override or no available model is a precise BLOCKER — a
 *     LandOS configuration gap, not a crash and not an empty result;
 *   • a real execution error THROWS, so the runner classifies it as a failure
 *     through the same failure-classification path every other lane uses.
 */
export async function runRoutedMissionChild(input: {
  policy: MissionProviderPolicy;
  prompt: string;
  system?: string;
  deps?: MissionProviderDeps;
}): Promise<
  | { status: 'completed'; summary: string; result: Record<string, unknown> }
  | { status: 'blocked'; summary: string }
> {
  const { executeRoutedTask } = await import('./model-router-service.js');
  const outcome = await executeRoutedTask(
    {
      prompt: input.prompt,
      system: input.system,
      needs: input.policy.needs ?? { reasoning: 0.5 },
      stakes: input.policy.stakes,
      modality: input.policy.modality,
      taskType: input.policy.taskType,
      agentId: input.policy.agentId,
      oneTimeModelId: input.policy.operatorOverrideModelId,
    },
    { registry: input.deps?.registry, live: input.deps?.live },
  );

  if (outcome.status === 'executed') {
    return {
      status: 'completed',
      summary: `Executed on ${outcome.executedProvider ?? 'unknown provider'} / ${outcome.executedModelId ?? 'unknown model'}${outcome.fellBack ? ' (fell back)' : ''}.`,
      result: {
        text: outcome.result?.text ?? '',
        executedModelId: outcome.executedModelId ?? null,
        executedProvider: outcome.executedProvider ?? null,
        executedEnvironment: outcome.executedEnvironment ?? null,
        fellBack: outcome.fellBack === true,
        liveRouting: outcome.liveRouting,
      },
    };
  }

  if (outcome.status === 'override_unavailable' || outcome.status === 'no_model_available') {
    return {
      status: 'blocked',
      summary: `${outcome.message ?? 'No model was available for this lane.'} This is a LandOS provider configuration gap, not evidence about the underlying work.`,
    };
  }

  throw new Error(outcome.message ?? 'The routed lane failed without a stated reason.');
}

// ── Provider catalog: what this repository actually supports ─────────────────
//
// Two DIFFERENT provider surfaces exist in the repository, and conflating them
// is what makes provider capability hard to reason about:
//
//   completion    — a LandOS ModelClient exists (model-execution.ts), so a
//                   mission child can route a model call to it right now.
//   agent_session — the upstream provider engine (src/provider.ts) can drive a
//                   full agent session on it (SDK or ACP), but LandOS has no
//                   completion client, so a mission child cannot route to it.
//
// Reporting both honestly is the point. A provider listed as agent_session is
// NOT claimed as mission-routable.

export type MissionProviderSurface = 'completion' | 'agent_session' | 'both';

export interface MissionProviderCatalogEntry {
  id: string;
  label: string;
  surface: MissionProviderSurface;
  /** The upstream provider-engine type, when this provider is one. */
  upstreamProviderType?: ProviderType;
  /** The LandOS provider-registry id, when a completion client exists. */
  landosProviderId?: string;
  /** Never required for native LandOS operation. */
  optional: boolean;
  note: string;
}

export const MISSION_PROVIDER_CATALOG: readonly MissionProviderCatalogEntry[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    surface: 'both',
    upstreamProviderType: 'claude',
    landosProviderId: 'anthropic',
    optional: false,
    note: 'The default and the safe-mode target. Agent sessions run on the bundled claude-agent-sdk; mission completions run through the anthropic ModelClient.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    surface: 'completion',
    landosProviderId: 'openai',
    optional: true,
    note: 'Mission-routable when OPENAI_API_KEY is configured. Serves the "gpt" model id.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    surface: 'both',
    upstreamProviderType: 'openrouter',
    landosProviderId: 'openrouter',
    optional: true,
    note: 'Mission-routable when OPENROUTER_API_KEY is configured; also selectable as an upstream agent provider.',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    surface: 'both',
    upstreamProviderType: 'gemini',
    landosProviderId: 'google',
    optional: true,
    note: 'Mission-routable through the existing gemini.ts path when a Google API key is configured. The upstream engine additionally supports the Gemini CLI as an ACP agent session.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local open models)',
    surface: 'completion',
    landosProviderId: 'ollama',
    optional: true,
    note: 'Mission-routable when an Ollama host is set (dashboard setting or OLLAMA_HOST). Local, $0 per token by fact.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local, OpenAI-compatible)',
    surface: 'completion',
    landosProviderId: 'lmstudio',
    optional: true,
    note: 'Mission-routable when LM_STUDIO_URL is set.',
  },
  {
    id: 'vllm',
    label: 'vLLM (local/self-hosted, OpenAI-compatible)',
    surface: 'completion',
    landosProviderId: 'vllm',
    optional: true,
    note: 'Mission-routable when VLLM_URL is set.',
  },
  {
    id: 'hermes',
    label: 'Hermes (optional, OpenAI-compatible endpoint)',
    surface: 'completion',
    landosProviderId: 'hermes',
    optional: true,
    note: 'OPTIONAL. Mission-routable only when a Hermes endpoint is configured (dashboard setting or HERMES_URL). Native LandOS missions run fully without it, and nothing depends on it being present.',
  },
  {
    id: 'codex',
    label: 'Codex CLI (agent session)',
    surface: 'agent_session',
    upstreamProviderType: 'codex',
    optional: true,
    note: 'Supported by the upstream provider engine as an ACP agent session and gated on the codex CLI being on PATH. LandOS has NO completion client for it, so a mission child cannot route a model call here. Not claimed as mission-routable.',
  },
  {
    id: 'opencode',
    label: 'OpenCode CLI (agent session)',
    surface: 'agent_session',
    upstreamProviderType: 'opencode',
    optional: true,
    note: 'Supported by the upstream provider engine as an ACP agent session, gated on the opencode CLI. No LandOS completion client, so it is not mission-routable.',
  },
];

export interface MissionProviderCatalogStatus extends MissionProviderCatalogEntry {
  /** True when this provider can serve a mission child's model call right now. */
  missionRoutable: boolean;
  /** True when the upstream provider engine reports its CLI/SDK usable. */
  agentSessionAvailable: boolean | null;
  detail: string;
}

/**
 * Reconcile the catalog against live state.
 *
 * `missionRoutable` comes from the LandOS registry (a real completion client that
 * reports itself configured and enabled). `agentSessionAvailable` comes from the
 * upstream engine's own availability check. Neither is inferred from the other,
 * because a CLI on PATH says nothing about whether a mission can route to it.
 */
export function describeMissionProviderCatalog(deps: { registry?: ProviderRegistry } = {}): MissionProviderCatalogStatus[] {
  const registry = deps.registry;
  const descriptors = registry?.list() ?? [];

  return MISSION_PROVIDER_CATALOG.map((entry) => {
    const descriptor = entry.landosProviderId
      ? descriptors.find((candidate) => candidate.id === entry.landosProviderId)
      : undefined;
    const status = descriptor && registry ? registry.status(descriptor) : undefined;
    const missionRoutable = !!status?.healthy;

    let agentSessionAvailable: boolean | null = null;
    if (entry.upstreamProviderType) {
      agentSessionAvailable = checkProviderAvailability({ type: entry.upstreamProviderType }).ok;
    }

    const parts: string[] = [];
    if (entry.surface === 'agent_session') {
      parts.push('Not mission-routable by design: no LandOS completion client exists for it.');
    } else if (!registry) {
      parts.push('No provider registry was supplied, so mission-routability was not evaluated and is not claimed.');
    } else if (!descriptor) {
      parts.push('No registry descriptor exists for this provider, so it is not installed.');
    } else if (missionRoutable) {
      parts.push('Installed, configured and enabled: a mission child can route a model call here.');
    } else if (!status?.installed) {
      parts.push('Not installed: no execution client was constructed, which means its endpoint or key is unset.');
    } else if (!status.enabled) {
      parts.push('Installed but disabled by the operator.');
    } else {
      parts.push('Installed but not configured: no endpoint or credential was injected.');
    }
    if (agentSessionAvailable === true) parts.push('The upstream provider engine reports its CLI/SDK usable for agent sessions.');
    if (agentSessionAvailable === false) parts.push('The upstream provider engine reports its CLI/SDK missing, so agent sessions on it would fail.');
    if (entry.optional) parts.push('Optional: native LandOS operation does not require it.');

    return { ...entry, missionRoutable, agentSessionAvailable, detail: parts.join(' ') };
  });
}
