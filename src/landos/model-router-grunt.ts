// LandOS grunt-work routing helper.
//
// A thin, flag-gated wrapper around executeRoutedTask() for LOW-RISK grunt-work
// callers (narration, summarization, classification, extraction drafts). It keeps
// callers honest about safe mode: when live routing is OFF, grunt-work is SKIPPED
// at this layer (the caller supplies its own deterministic fallback) so no new
// model call is introduced by default. When ON, the task is routed + executed.
//
// High-stakes work must NOT use this helper — it is for non-authoritative drafts
// only. No .env reads, no secrets, no paid calls in tests (executor injectable).

import {
  executeRoutedTask, liveRoutingEnabled,
  type RoutedTaskRequest, type RoutedTaskOutcome, type RoutedTaskDeps,
} from './model-router-service.js';

export interface GruntDeps extends RoutedTaskDeps {
  /** Injectable for tests. Defaults to the real service. */
  execute?: (req: RoutedTaskRequest, deps?: RoutedTaskDeps) => Promise<RoutedTaskOutcome>;
  /** Injectable flag check (tests). Defaults to the real config flag. */
  enabled?: () => boolean;
}

export type GruntOutcome =
  | { ran: true; outcome: RoutedTaskOutcome }
  | { ran: false; reason: 'live_routing_disabled' };

/**
 * Run a low-risk grunt task through the router IFF live routing is enabled.
 * Returns ran:false when disabled so the caller falls back deterministically.
 * Never throws on a routing decision; execution errors surface inside outcome.
 */
export async function gruntComplete(req: RoutedTaskRequest, deps: GruntDeps = {}): Promise<GruntOutcome> {
  const enabled = (deps.enabled ?? liveRoutingEnabled)();
  if (!enabled) return { ran: false, reason: 'live_routing_disabled' };
  const exec = deps.execute ?? executeRoutedTask;
  const { execute: _e, enabled: _en, ...routeDeps } = deps;
  const outcome = await exec(req, routeDeps);
  return { ran: true, outcome };
}
