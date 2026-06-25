// Reconciliation between the LandOS model-router (vendor-NEUTRAL) and the
// provider engine (vendor-SPECIFIC ProviderConfig). The model-router decides the
// KIND of work (a TaskRoute orientation) and never names a vendor or model. The
// provider engine owns the vendor binding. This bridge connects them for the
// 'claude' provider only: it turns a neutral route into a concrete CLAUDE_MODEL_*
// suggestion, and ONLY when the active provider is claude and no model is already
// set. For any non-claude provider, model selection stays with that provider —
// the router's neutrality is preserved.

import { CLAUDE_MODEL_OPUS, CLAUDE_MODEL_SONNET, CLAUDE_MODEL_HAIKU, DEFAULT_CLAUDE_MODEL } from '../config.js';
import type { ProviderConfig } from '../provider.js';
import { selectModel, type RouterTaskInput } from './model-router.js';
import type { TaskRoute, ModelRoutingDecision } from './intake-types.js';

/** Suggested Claude model tier for a neutral route. Provider-specific: this is
 *  the claude vendor's binding of the router's orientation, user-overridable. */
export function claudeModelForRoute(route: TaskRoute): string {
  switch (route) {
    case 'deterministic_code':
      // Deterministic work uses NO LLM; if a caller still wants a claude model
      // here, the cheapest tier is the right default.
      return CLAUDE_MODEL_HAIKU;
    case 'task_oriented':
    case 'local_open_source':
      return CLAUDE_MODEL_SONNET;
    case 'reasoning_oriented':
    case 'web_capable':
    case 'long_context':
    case 'approval_required':
      return CLAUDE_MODEL_OPUS;
    default:
      return DEFAULT_CLAUDE_MODEL;
  }
}

/**
 * Bind a router decision onto a ProviderConfig. For the claude provider with no
 * explicit model, fills the model from the route suggestion. Non-claude providers
 * (or an already-set model) are returned unchanged — the provider keeps ownership
 * of its own model selection. Pure; no model call.
 */
export function bindRouteToProvider(provider: ProviderConfig, decision: ModelRoutingDecision): ProviderConfig {
  if (provider.type !== 'claude') return provider;
  if (provider.model && provider.model.trim().length > 0) return provider;
  return { ...provider, model: claudeModelForRoute(decision.route) };
}

/** Convenience: run the router for a task and return the bound ProviderConfig. */
export function resolveProviderForTask(provider: ProviderConfig, input: RouterTaskInput): ProviderConfig {
  return bindRouteToProvider(provider, selectModel(input));
}
