// ─────────────────────────────────────────────────────────────────────────
// Shared owned-page lifecycle for browser research services.
//
// Every browser-based research job — LandPortal, county records, GIS,
// municipal/zoning, utilities, comparable providers, any public source —
// closes the pages it caused to exist once its facts are persisted. Cleanup
// runs whatever the outcome: success, partial completion, failure, timeout,
// cancellation, or malformed output. Pages that already existed belong to
// the operator and are preserved; ownership is decided by the driver's
// page registry, never by timing or URL guesswork.
// ─────────────────────────────────────────────────────────────────────────

import type { BrowserDriver } from './browser-intelligence.js';

export interface OwnedPageCleanup { closed: number; failed: number; preserved: number }

/** Result shape the wrapper can annotate with its cleanup record. */
interface CleanupAnnotatable { note: string; browserCleanup?: OwnedPageCleanup }

/**
 * Run a browser job inside one owned-page scope. The scope is closed in a
 * `finally` so cleanup also covers cancellation and early-return paths, and a
 * cleanup failure never masks the job's own error. On success the cleanup
 * record is written onto the result so every task report can state pages
 * closed vs. preserved.
 *
 * Staying logged in is never a reason to keep a page: auth lives in the
 * profile, not the tab, and an accumulating pile of research tabs is exactly
 * the operator-visible regression this exists to prevent.
 */
export async function withOwnedPages<T extends CleanupAnnotatable>(
  driver: BrowserDriver,
  run: () => Promise<T>,
): Promise<T> {
  if (!driver.beginOwnedPageScope || !driver.closeOwnedPageScope) return run();
  let token: string | null = null;
  try { token = await driver.beginOwnedPageScope(); } catch { token = null; }
  let result: T | null = null;
  try {
    result = await run();
    return result;
  } finally {
    if (token) {
      try {
        const cleanup = await driver.closeOwnedPageScope(token);
        if (result) {
          result.browserCleanup = cleanup;
          result.note = `${result.note} [browser cleanup: ${cleanup.closed} page(s) closed, ${cleanup.preserved} operator page(s) preserved${cleanup.failed ? `, ${cleanup.failed} failed to close` : ''}]`;
        }
      } catch (err) {
        // Cleanup failure is reported on success paths and swallowed on error
        // paths (the original error is the honest outcome to surface).
        if (result) {
          result.browserCleanup = { closed: 0, failed: -1, preserved: 0 };
          result.note = `${result.note} [browser cleanup FAILED: ${(err as Error)?.message ?? 'unknown'}]`;
        }
      }
    }
  }
}
