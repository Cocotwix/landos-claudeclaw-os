// LandOS Model Router — runtime configuration resolver.
//
// ROOT-CAUSE FIX: live routing and the local Ollama host were previously read
// ONLY from .env / process-env at module load. Setting them in a shell and
// restarting did nothing unless they were persisted in .env, so the router
// silently stayed in safe mode. This resolver makes both operator-controllable
// at runtime through the EXISTING persisted dashboard_settings KV (same store
// model-override.ts uses) and layers them over the env values as fallback:
//
//   effective = persisted dashboard setting (if set)  ->  else env  ->  else default
//
// It is the SINGLE source of truth for "is live routing on" and "where is
// Ollama", so the dashboard status, the live execution path, and the grunt path
// can never disagree. No secret values are read or returned here.

import { OLLAMA_HOST, LANDOS_LIVE_ROUTING } from '../config.js';
import { getDashboardSetting as dbGet, setDashboardSetting as dbSet } from '../db.js';

/** Persisted dashboard_settings keys (KV; no schema change). */
export const ROUTER_RUNTIME_KEYS = {
  liveRouting: 'landos.router.live_routing',
  ollamaHost: 'landos.router.ollama_host',
  ollamaModelMap: 'landos.router.ollama_model_map',
} as const;

/** Internal model id -> Ollama tag. Internal ids are LandOS-stable; the Ollama
 *  TAG varies per machine, so this map is the translation the execution path
 *  needs. Defaults target the standard local Gemma tags; operator-overridable
 *  via the ollamaModelMap setting (JSON). */
export const DEFAULT_OLLAMA_MODEL_MAP: Readonly<Record<string, string>> = {
  'gemma-4-12b-q4': 'gemma4:12b',
  'gemma-4-e4b': 'gemma3:4b',
};

/** The standard local Ollama endpoint, offered as a one-click default. */
export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

export interface SettingsStore {
  getDashboardSetting(key: string): string | null;
  setDashboardSetting(key: string, value: string): void;
}

/** Default store = the real dashboard_settings KV, guarded so a not-yet-init DB
 *  (pure unit context) degrades to "no setting" instead of throwing. */
const realStore: SettingsStore = {
  getDashboardSetting: (k) => { try { return dbGet(k); } catch { return null; } },
  setDashboardSetting: (k, v) => { try { dbSet(k, v); } catch { /* no-op when DB unavailable */ } },
};

function store(s?: SettingsStore): SettingsStore { return s ?? realStore; }
function read(s: SettingsStore | undefined, key: string): string | null {
  try { return store(s).getDashboardSetting(key); } catch { return null; }
}

export type RuntimeSource = 'setting' | 'env' | 'default';

export interface LiveRoutingResolution { enabled: boolean; source: RuntimeSource }

/** Effective live-routing flag: persisted setting wins, else the env flag. */
export function resolveLiveRouting(s?: SettingsStore): LiveRoutingResolution {
  const v = (read(s, ROUTER_RUNTIME_KEYS.liveRouting) ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return { enabled: true, source: 'setting' };
  if (['0', 'false', 'no', 'off'].includes(v)) return { enabled: false, source: 'setting' };
  return { enabled: LANDOS_LIVE_ROUTING, source: 'env' };
}

export interface OllamaHostResolution { host: string; source: RuntimeSource }

/** Effective Ollama host: persisted setting wins, else env OLLAMA_HOST, else ''
 *  (empty = provider not installed; never auto-assumes a running Ollama). */
export function resolveOllamaHost(s?: SettingsStore): OllamaHostResolution {
  const v = (read(s, ROUTER_RUNTIME_KEYS.ollamaHost) ?? '').trim();
  if (v) return { host: v, source: 'setting' };
  if (OLLAMA_HOST) return { host: OLLAMA_HOST, source: 'env' };
  return { host: '', source: 'default' };
}

/** Effective internal-id -> Ollama-tag map: defaults merged with the persisted
 *  JSON override (override wins per key). Malformed JSON is ignored. */
export function resolveOllamaModelMap(s?: SettingsStore): Record<string, string> {
  const map: Record<string, string> = { ...DEFAULT_OLLAMA_MODEL_MAP };
  const raw = read(s, ROUTER_RUNTIME_KEYS.ollamaModelMap);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof val === 'string' && val.trim()) map[k] = val.trim();
        }
      }
    } catch { /* keep defaults on malformed JSON */ }
  }
  return map;
}

// ── Setters (operator controls; persist to dashboard_settings) ────────────────

export function setLiveRouting(enabled: boolean, s?: SettingsStore): void {
  store(s).setDashboardSetting(ROUTER_RUNTIME_KEYS.liveRouting, enabled ? '1' : '0');
}

export function setOllamaHost(host: string, s?: SettingsStore): void {
  store(s).setDashboardSetting(ROUTER_RUNTIME_KEYS.ollamaHost, (host ?? '').trim());
}

export function setOllamaModelMap(map: Record<string, string>, s?: SettingsStore): void {
  store(s).setDashboardSetting(ROUTER_RUNTIME_KEYS.ollamaModelMap, JSON.stringify(map));
}
