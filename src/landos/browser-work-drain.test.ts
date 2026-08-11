// The browser cleanup boundary is the WORK, not the child rows.
//
// A mission joins when its children reach terminal states, but a child can
// settle while browser work it started is still running. Cleaning up on the
// join looked at the browser too early: the trailing operation then opened its
// page against a scope that had already been released, so no scoped cleanup
// could ever match it and the tab survived until a manual reap.
//
// Every driver call is therefore counted against its owning scope and released
// in a `finally`, and cleanup waits for that count to drain.

import { describe, expect, it } from 'vitest';

import {
  _activeWorkflowScopeCount,
  _holdScopedBrowserWork,
  _scopedBrowserWorkCount,
  awaitScopedBrowserWorkDrained,
  closeSurplusSessionPages,
  createBrowserWorkflowScope,
  makeLiveBrowserDriver,
  runInBrowserWorkflowScope,
} from './browser-session.js';

/** No live session in unit tests, so every driver call rejects — which is
 *  exactly the failure path ownership release has to survive. */
const callAndSwallow = async (run: () => Promise<unknown>): Promise<void> => {
  try { await run(); } catch { /* the rejection is the point */ }
};

describe('scoped browser work drains before cleanup', () => {
  it('drains immediately when no work was ever started', async () => {
    const scope = createBrowserWorkflowScope('drain-empty');
    const drain = await awaitScopedBrowserWorkDrained(scope, { timeoutMs: 1_000 });
    expect(drain.drained).toBe(true);
    expect(drain.outstanding).toBe(0);
    await closeSurplusSessionPages(scope);
  });

  it('releases ownership when a driver call FAILS', async () => {
    const scope = createBrowserWorkflowScope('drain-failure');
    const driver = runInBrowserWorkflowScope(scope, () => makeLiveBrowserDriver('failing-lane'));

    await callAndSwallow(() => driver.open('https://example.invalid', { timeoutMs: 10 }));

    // A rejected call must not leave the scope permanently owed work.
    expect(_scopedBrowserWorkCount(scope)).toBe(0);
    const drain = await awaitScopedBrowserWorkDrained(scope, { timeoutMs: 1_000 });
    expect(drain.drained).toBe(true);
    await closeSurplusSessionPages(scope);
  });

  it('releases ownership across several failed calls on the same driver', async () => {
    const scope = createBrowserWorkflowScope('drain-repeat');
    const driver = runInBrowserWorkflowScope(scope, () => makeLiveBrowserDriver('repeat-lane'));

    await Promise.all([
      callAndSwallow(() => driver.open('https://a.invalid', { timeoutMs: 10 })),
      callAndSwallow(() => driver.readFields({ timeoutMs: 10 })),
      callAndSwallow(() => driver.search('anything', { timeoutMs: 10 })),
    ]);

    expect(_scopedBrowserWorkCount(scope)).toBe(0);
    await closeSurplusSessionPages(scope);
  });

  it('waits while work is outstanding and returns the moment it settles', async () => {
    const scope = createBrowserWorkflowScope('drain-waits');
    const release = _holdScopedBrowserWork(scope);
    expect(_scopedBrowserWorkCount(scope)).toBe(1);

    setTimeout(release, 40);
    const drain = await awaitScopedBrowserWorkDrained(scope, { timeoutMs: 5_000, pollMs: 5 });

    expect(drain.drained).toBe(true);
    expect(drain.outstanding).toBe(0);
    await closeSurplusSessionPages(scope);
  });

  it('reports honestly when work could not drain inside the safety bound', async () => {
    const scope = createBrowserWorkflowScope('drain-timeout');
    const release = _holdScopedBrowserWork(scope);

    const drain = await awaitScopedBrowserWorkDrained(scope, { timeoutMs: 30, pollMs: 5 });
    expect(drain.drained).toBe(false);
    expect(drain.outstanding).toBe(1);

    // The run still finalizes; the held work releases normally afterwards.
    release();
    expect(_scopedBrowserWorkCount(scope)).toBe(0);
    await closeSurplusSessionPages(scope);
  });

  it('a synchronous passthrough member is not counted as browser work', () => {
    const scope = createBrowserWorkflowScope('drain-passthrough');
    const driver = runInBrowserWorkflowScope(scope, () => makeLiveBrowserDriver('sync-lane'));

    expect(typeof driver.configured()).toBe('boolean');
    expect(driver.id).toBe('sync-lane');
    expect(_scopedBrowserWorkCount(scope)).toBe(0);
  });

  it('cleanup still releases the workflow scope after a drain', async () => {
    const before = _activeWorkflowScopeCount();
    const scope = createBrowserWorkflowScope('drain-release');
    await awaitScopedBrowserWorkDrained(scope, { timeoutMs: 500 });
    await closeSurplusSessionPages(scope);
    expect(_activeWorkflowScopeCount()).toBe(before);
  });
});
