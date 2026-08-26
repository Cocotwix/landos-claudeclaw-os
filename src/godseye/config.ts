import fs from 'fs';
import path from 'path';
import { STORE_DIR } from '../config.js';

/**
 * God's Eye View — host configuration and Google 3D Tiles session safeguard.
 *
 * Everything stored here is NON-SECRET by design. The Google Maps key kept in
 * this file is the deliberately browser-visible Map-Tiles key (like a Mapbox
 * public token): it is served to the client, so it must be configured in
 * Google Cloud with API restriction (Map Tiles API) + referrer restriction
 * (localhost origins). Server-side LandOS credentials never live here and are
 * never read by this module.
 *
 * The session counter is a LOCAL SAFEGUARD, not Google's billing record. The
 * authoritative usage number lives in the Google Cloud console (Map Tiles API
 * metrics / billing reports); provider-side quotas remain the recommended
 * billing backstop.
 */

const GEV_DIR = path.join(STORE_DIR, 'godseye');
const CONFIG_PATH = path.join(GEV_DIR, 'config.json');
const USAGE_PATH = path.join(GEV_DIR, 'usage.json');

export const GEV_DEFAULT_MONTHLY_SESSION_LIMIT = 900; // below Google's 1,000 free allowance
export const GEV_MAX_CONFIGURABLE_LIMIT = 5000;

export interface GevConfig {
  /** Browser-visible Google Map Tiles key. Empty string = not configured. */
  googleMapsBrowserKey: string;
  /**
   * Cesium ion access token (free ion account tier). Browser-visible by the
   * same design as the Google browser key: it unlocks the ion-served map
   * stacks (Bing Aerial, Bing Aerial + Labels, Cesium World Terrain) that the
   * vendored upstream already implements but LandOS previously had no
   * plumbing for. Empty string = not configured; those stacks then keep their
   * honest SETUP chip state.
   */
  cesiumIonToken: string;
  /** Local monthly cap on root-tileset (billable) session creations. */
  monthlySessionLimit: number;
  /** Voice stays disabled; kept explicit so the UI can state it honestly. */
  voiceEnabled: false;
}

export interface GevUsage {
  /** Calendar month key (UTC), e.g. "2026-08". */
  month: string;
  /** Root tileset sessions counted locally this month. */
  sessions: number;
}

interface GevUsageFile {
  /** Per-month counters, never deleted — a clock that rolls backwards resumes
   *  the prior month's count instead of resetting the safeguard to zero. */
  months: Record<string, number>;
}

function ensureDir(): void {
  fs.mkdirSync(GEV_DIR, { recursive: true });
}

function readJson<T>(file: string): Partial<T> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<T>;
  } catch {
    return {};
  }
}

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getGevConfig(): GevConfig {
  const raw = readJson<GevConfig>(CONFIG_PATH);
  const key = typeof raw.googleMapsBrowserKey === 'string' ? raw.googleMapsBrowserKey : '';
  const ion = typeof raw.cesiumIonToken === 'string' ? raw.cesiumIonToken : '';
  const limitRaw = Number(raw.monthlySessionLimit);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= GEV_MAX_CONFIGURABLE_LIMIT
    ? limitRaw
    : GEV_DEFAULT_MONTHLY_SESSION_LIMIT;
  return { googleMapsBrowserKey: key, cesiumIonToken: ion, monthlySessionLimit: limit, voiceEnabled: false };
}

export function setGevConfig(update: { googleMapsBrowserKey?: unknown; cesiumIonToken?: unknown; monthlySessionLimit?: unknown }): GevConfig {
  const current = getGevConfig();
  const next: GevConfig = { ...current };
  if (typeof update.googleMapsBrowserKey === 'string') {
    const trimmed = update.googleMapsBrowserKey.trim();
    // Google API keys are URL-safe tokens; a permissive shape check keeps
    // garbage/injection out without pretending to validate against Google.
    if (trimmed === '' || /^[A-Za-z0-9_-]{10,128}$/.test(trimmed)) {
      next.googleMapsBrowserKey = trimmed;
    } else {
      throw new Error('That does not look like a Google Maps API key.');
    }
  }
  if (typeof update.cesiumIonToken === 'string') {
    const trimmed = update.cesiumIonToken.trim();
    // ion tokens are JWTs (base64url segments joined by dots); a permissive
    // shape check keeps garbage/injection out without pretending to validate
    // against Cesium ion.
    if (trimmed === '' || /^[A-Za-z0-9_.-]{20,4096}$/.test(trimmed)) {
      next.cesiumIonToken = trimmed;
    } else {
      throw new Error('That does not look like a Cesium ion access token.');
    }
  }
  if (update.monthlySessionLimit !== undefined) {
    const n = Number(update.monthlySessionLimit);
    if (!Number.isInteger(n) || n < 1 || n > GEV_MAX_CONFIGURABLE_LIMIT) {
      throw new Error(`Monthly session limit must be an integer between 1 and ${GEV_MAX_CONFIGURABLE_LIMIT}.`);
    }
    next.monthlySessionLimit = n;
  }
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

function readUsageMonths(): Record<string, number> {
  const raw = readJson<GevUsageFile & GevUsage>(USAGE_PATH);
  const months: Record<string, number> = {};
  if (raw.months && typeof raw.months === 'object') {
    for (const [k, v] of Object.entries(raw.months)) {
      if (/^\d{4}-\d{2}$/.test(k) && Number.isInteger(v) && (v as number) >= 0) months[k] = v as number;
    }
  }
  // Migrate the earlier single-month shape ({month, sessions}) losslessly.
  if (typeof raw.month === 'string' && /^\d{4}-\d{2}$/.test(raw.month)
    && Number.isInteger(raw.sessions) && (raw.sessions as number) >= 0
    && months[raw.month] === undefined) {
    months[raw.month] = raw.sessions as number;
  }
  return months;
}

export function getGevUsage(): GevUsage {
  const month = monthKey();
  return { month, sessions: readUsageMonths()[month] ?? 0 };
}

/**
 * Atomically gate + count one Google root-tileset session.
 *
 * Atomicity: read → check → write is one synchronous pass on the Node event
 * loop (no await between them), so concurrent HTTP requests serialize and two
 * simultaneous calls can never both observe the same pre-increment count.
 * The count is taken BEFORE the session is actually created, so a crash or a
 * failed creation can only over-count — the safe direction for a spend
 * safeguard. Per-month counters are kept forever, so clock changes resume an
 * existing month's count rather than resetting it.
 */
export function requestGevSession(): { allowed: boolean; sessions: number; limit: number } {
  const { monthlySessionLimit } = getGevConfig();
  const month = monthKey();
  const months = readUsageMonths();
  const current = months[month] ?? 0;
  if (current >= monthlySessionLimit) {
    return { allowed: false, sessions: current, limit: monthlySessionLimit };
  }
  months[month] = current + 1;
  ensureDir();
  fs.writeFileSync(USAGE_PATH, JSON.stringify({ months }, null, 2));
  return { allowed: true, sessions: months[month], limit: monthlySessionLimit };
}

/** Masked display form for UIs: never the full key. */
export function maskGevKey(key: string): string {
  if (!key) return '';
  return `••••••••${key.slice(-4)}`;
}
