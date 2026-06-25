// LandOS manual model override.
//
// The operator can always override the router (it can misjudge risk, misclassify,
// or simply pick a model the operator doesn't want). Override ALWAYS takes
// precedence over automatic routing and is NEVER silently substituted: if the
// chosen model is unavailable the router reports it and the operator decides
// (see capability-router.ts handling of operatorOverrideModelId).
//
// Scopes, most-specific wins: run (one-time) > task_type > agent > global.
// Persistent scopes are stored via a pluggable OverrideStore; the one-time scope
// is passed per call. resetOverride clears a scope back to automatic routing.

export type OverrideScope = 'global' | 'agent' | 'task_type';

export interface OverrideStore {
  get(scope: OverrideScope, key?: string): string | null;
  set(scope: OverrideScope, key: string | undefined, modelId: string): void;
  clear(scope: OverrideScope, key?: string): void;
}

function storageKey(scope: OverrideScope, key?: string): string {
  return scope === 'global' ? 'landos.model_override.global' : `landos.model_override.${scope}.${key ?? ''}`;
}

/** In-memory store (used by tests and as a default). */
export class InMemoryOverrideStore implements OverrideStore {
  private m = new Map<string, string>();
  get(scope: OverrideScope, key?: string) { return this.m.get(storageKey(scope, key)) ?? null; }
  set(scope: OverrideScope, key: string | undefined, modelId: string) { this.m.set(storageKey(scope, key), modelId); }
  clear(scope: OverrideScope, key?: string) { this.m.delete(storageKey(scope, key)); }
}

/** Persistent store backed by dashboard_settings (existing KV; no schema change).
 *  Lazily imports db helpers so this module stays import-safe in pure contexts. */
export class DashboardSettingsOverrideStore implements OverrideStore {
  constructor(private db: { getDashboardSetting(k: string): string | null; setDashboardSetting(k: string, v: string): void }) {}
  get(scope: OverrideScope, key?: string) { return this.db.getDashboardSetting(storageKey(scope, key)); }
  set(scope: OverrideScope, key: string | undefined, modelId: string) { this.db.setDashboardSetting(storageKey(scope, key), modelId); }
  clear(scope: OverrideScope, key?: string) { this.db.setDashboardSetting(storageKey(scope, key), ''); }
}

export interface OverrideContext {
  agentId?: string;
  taskType?: string;
  /** One-time override for this run only — highest precedence. */
  oneTimeModelId?: string;
}

export interface ResolvedOverride {
  modelId: string;
  scope: 'run' | OverrideScope;
  /** Operator-supplied reason, if recorded (for telemetry). */
  reason?: string;
}

/** Resolve the effective override (most-specific wins), or null for automatic. */
export function resolveOverride(ctx: OverrideContext, store: OverrideStore): ResolvedOverride | null {
  if (ctx.oneTimeModelId && ctx.oneTimeModelId.trim()) return { modelId: ctx.oneTimeModelId.trim(), scope: 'run' };
  if (ctx.taskType) {
    const v = store.get('task_type', ctx.taskType);
    if (v) return { modelId: v, scope: 'task_type' };
  }
  if (ctx.agentId) {
    const v = store.get('agent', ctx.agentId);
    if (v) return { modelId: v, scope: 'agent' };
  }
  const g = store.get('global');
  if (g) return { modelId: g, scope: 'global' };
  return null;
}

export function setOverride(store: OverrideStore, scope: OverrideScope, key: string | undefined, modelId: string): void {
  store.set(scope, key, modelId);
}

/** Reset a scope back to automatic routing. */
export function resetOverride(store: OverrideStore, scope: OverrideScope, key?: string): void {
  store.clear(scope, key);
}
