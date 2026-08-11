// A browser workflow scope must be released on EVERY cleanup path.
//
// The scope set arms the final sweep — the only thing that closes pages opened
// after a run's own cleanup boundary (post-run transports, LandPortal jobs that
// never registered an owner). The sweep runs only when the set is empty, so a
// single leaked scope disables it for the rest of the process and lets pages
// accumulate run over run. That was the intermittent LandPortal tab.

import { describe, expect, it } from 'vitest';

import {
  _activeWorkflowScopeCount,
  closeSurplusSessionPages,
  createBrowserWorkflowScope,
} from './browser-session.js';

describe('browser workflow scope release', () => {
  it('releases the scope when no browser session was ever connected', async () => {
    const before = _activeWorkflowScopeCount();
    const scope = createBrowserWorkflowScope('test-no-browser');
    expect(_activeWorkflowScopeCount()).toBe(before + 1);

    const result = await closeSurplusSessionPages(scope);
    expect(result.note).toContain('No live browser session was connected');
    // The early return must not strand the token.
    expect(_activeWorkflowScopeCount()).toBe(before);
  });

  it('does not accumulate scopes across repeated runs', async () => {
    const before = _activeWorkflowScopeCount();
    for (let run = 0; run < 5; run += 1) {
      await closeSurplusSessionPages(createBrowserWorkflowScope(`test-run-${run}`));
    }
    expect(_activeWorkflowScopeCount()).toBe(before);
  });

  it('a scope-less call leaves the set untouched and preserves pages', async () => {
    const scope = createBrowserWorkflowScope('test-held');
    const held = _activeWorkflowScopeCount();
    await closeSurplusSessionPages(undefined);
    // Another run's token must never be released by an unscoped caller.
    expect(_activeWorkflowScopeCount()).toBe(held);
    await closeSurplusSessionPages(scope);
    expect(_activeWorkflowScopeCount()).toBe(held - 1);
  });

  it('releases the scope even when cleanup is called twice for the same run', async () => {
    const before = _activeWorkflowScopeCount();
    const scope = createBrowserWorkflowScope('test-double');
    await closeSurplusSessionPages(scope);
    await closeSurplusSessionPages(scope);
    expect(_activeWorkflowScopeCount()).toBe(before);
  });
});
