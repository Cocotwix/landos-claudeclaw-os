// LandOS — Platform Intelligence Library (REMEMBER + IMPROVE).
//
// Each website Browser Intelligence uses becomes a LEARNED object: its
// classification, the search methods it offers, the navigation strategy that was
// validated to work, known limitations, and a success record. Browser
// Intelligence consults this before acting (so it doesn't re-derive everything)
// and updates it after each run — getting progressively smarter. Generic by
// platform key (host or platform name); NO per-county / vendor-specific code.

import { getLandosDb, landosAudit } from './db.js';
import type { PlatformClass, SearchMethod, NavigationStrategy, TaskBoundary } from './website-intelligence.js';

export interface PlatformIntel {
  platform: string;
  classification: PlatformClass | string;
  searchMethods: SearchMethod[];
  /** The navigation strategy that was validated to reach a record (when known). */
  validatedStrategy: NavigationStrategy | null;
  navPatterns: string;
  authRequired: boolean;
  knownLimitations: string[];
  /** Learned allowed / restricted / forbidden work surfaces for the platform. */
  taskBoundary: TaskBoundary;
  confidence: 'high' | 'medium' | 'low';
  timesUsed: number;
  timesSucceeded: number;
  lastValidatedAt: number | null;
}

interface Row {
  platform: string; classification: string; search_methods_json: string; validated_strategy_json: string | null;
  nav_patterns: string; auth_required: number; known_limitations_json: string; task_boundary_json: string | null; confidence: string;
  times_used: number; times_succeeded: number; last_validated_at: number | null;
}

/** Normalize a URL/host to a stable platform key (host, without www). */
export function platformKey(urlOrHost: string): string {
  let h = (urlOrHost ?? '').trim().toLowerCase();
  try { if (/^https?:/.test(h)) h = new URL(h).hostname; } catch { /* keep */ }
  return h.replace(/^www\./, '');
}

function parse<T>(s: string | null | undefined, fb: T): T { if (!s) return fb; try { return JSON.parse(s) as T; } catch { return fb; } }

function toIntel(r: Row): PlatformIntel {
  return {
    platform: r.platform, classification: r.classification,
    searchMethods: parse<SearchMethod[]>(r.search_methods_json, []),
    validatedStrategy: parse<NavigationStrategy | null>(r.validated_strategy_json, null),
    navPatterns: r.nav_patterns, authRequired: r.auth_required === 1,
    knownLimitations: parse<string[]>(r.known_limitations_json, []),
    taskBoundary: parse<TaskBoundary>(r.task_boundary_json, { allowed: [], restricted: [], forbidden: [] }),
    confidence: (['high', 'medium', 'low'] as const).includes(r.confidence as never) ? (r.confidence as PlatformIntel['confidence']) : 'low',
    timesUsed: r.times_used, timesSucceeded: r.times_succeeded, lastValidatedAt: r.last_validated_at,
  };
}

export function getPlatformIntel(urlOrHost: string): PlatformIntel | null {
  const key = platformKey(urlOrHost);
  const row = getLandosDb().prepare('SELECT * FROM landos_platform_intel WHERE platform = ?').get(key) as Row | undefined;
  return row ? toIntel(row) : null;
}

export interface PlatformIntelPatch {
  classification?: PlatformClass | string;
  searchMethods?: SearchMethod[];
  validatedStrategy?: NavigationStrategy | null;
  navPatterns?: string;
  authRequired?: boolean;
  knownLimitations?: string[];
  taskBoundary?: TaskBoundary;
  confidence?: 'high' | 'medium' | 'low';
  /** Increment the usage/success counters (the IMPROVE signal). */
  used?: boolean;
  succeeded?: boolean;
  validatedNow?: boolean;
}

/** Upsert a platform's learned object. Merges (only provided fields change) and
 *  bumps the used/succeeded counters. Reusable across every department. */
export function rememberPlatform(urlOrHost: string, patch: PlatformIntelPatch, actor = 'browser-intelligence'): PlatformIntel {
  const key = platformKey(urlOrHost);
  const prev = getPlatformIntel(key);
  const now = Math.floor(Date.now() / 1000);
  const next: PlatformIntel = {
    platform: key,
    classification: patch.classification ?? prev?.classification ?? 'unknown',
    searchMethods: patch.searchMethods ?? prev?.searchMethods ?? [],
    validatedStrategy: patch.validatedStrategy !== undefined ? patch.validatedStrategy : (prev?.validatedStrategy ?? null),
    navPatterns: patch.navPatterns ?? prev?.navPatterns ?? '',
    authRequired: patch.authRequired ?? prev?.authRequired ?? false,
    knownLimitations: patch.knownLimitations ?? prev?.knownLimitations ?? [],
    taskBoundary: patch.taskBoundary ?? prev?.taskBoundary ?? { allowed: [], restricted: [], forbidden: [] },
    confidence: patch.confidence ?? prev?.confidence ?? 'low',
    timesUsed: (prev?.timesUsed ?? 0) + (patch.used ? 1 : 0),
    timesSucceeded: (prev?.timesSucceeded ?? 0) + (patch.succeeded ? 1 : 0),
    lastValidatedAt: patch.validatedNow ? now : (prev?.lastValidatedAt ?? null),
  };
  getLandosDb().prepare(
    `INSERT INTO landos_platform_intel (platform, classification, search_methods_json, validated_strategy_json, nav_patterns, auth_required, known_limitations_json, task_boundary_json, confidence, times_used, times_succeeded, last_validated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET classification=excluded.classification, search_methods_json=excluded.search_methods_json,
       validated_strategy_json=excluded.validated_strategy_json, nav_patterns=excluded.nav_patterns, auth_required=excluded.auth_required,
       known_limitations_json=excluded.known_limitations_json, task_boundary_json=excluded.task_boundary_json, confidence=excluded.confidence, times_used=excluded.times_used,
       times_succeeded=excluded.times_succeeded, last_validated_at=excluded.last_validated_at, updated_at=excluded.updated_at`,
  ).run(next.platform, String(next.classification), JSON.stringify(next.searchMethods), next.validatedStrategy ? JSON.stringify(next.validatedStrategy) : null, next.navPatterns, next.authRequired ? 1 : 0, JSON.stringify(next.knownLimitations), JSON.stringify(next.taskBoundary), next.confidence, next.timesUsed, next.timesSucceeded, next.lastValidatedAt, now);
  landosAudit(actor, 'platform_learned', `${key} (${next.classification}, methods: ${next.searchMethods.join('/')}, used ${next.timesUsed}/${next.timesSucceeded})`, { refTable: 'landos_platform_intel' });
  return next;
}

export function listPlatformIntel(): PlatformIntel[] {
  const rows = getLandosDb().prepare('SELECT * FROM landos_platform_intel ORDER BY updated_at DESC').all() as Row[];
  return rows.map(toIntel);
}
