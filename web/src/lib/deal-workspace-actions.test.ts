// Deal Workspace Action Layer V1 — contract + executor unit tests.
// Pure/node-safe: no DOM, no network, no models. The executor is proven
// deterministic and fail-closed against fakes; live behavior is proven in
// the operator browser walkthrough.
import { describe, it, expect, vi } from 'vitest';
import {
  DEAL_WORKSPACE_ACTION_TYPES,
  parseDealWorkspaceAction,
  createDealWorkspaceExecutor,
  type DealWorkspaceContext,
} from './deal-workspace-actions';
import { DEAL_PAGES, type WorkspaceV2Page } from './workspace-v2-nav';

const SEVEN = ['overview', 'property', 'market', 'comps', 'strategy', 'seller', 'documents'];

describe('DealWorkspaceAction contract', () => {
  it('whitelists exactly the V1 action type', () => {
    expect([...DEAL_WORKSPACE_ACTION_TYPES]).toEqual(['navigate_deal_page']);
  });

  it('accepts all seven canonical page slugs', () => {
    expect(DEAL_PAGES.map((p) => p.slug)).toEqual(SEVEN);
    for (const page of SEVEN) {
      const r = parseDealWorkspaceAction({ type: 'navigate_deal_page', dealId: 89, page });
      expect(r.ok, `page ${page} should be valid`).toBe(true);
      if (r.ok) expect(r.action).toEqual({ type: 'navigate_deal_page', dealId: 89, page });
    }
  });

  it('fails closed on invalid pages', () => {
    for (const page of ['banana', '', 'Overview', 'comps-valuation', 42, null, undefined]) {
      const r = parseDealWorkspaceAction({ type: 'navigate_deal_page', dealId: 89, page });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/invalid page/);
    }
  });

  it('fails closed on invalid deal ids (current ID rules: positive integer)', () => {
    for (const dealId of [0, -1, 1.5, '89', NaN, null, undefined]) {
      const r = parseDealWorkspaceAction({ type: 'navigate_deal_page', dealId, page: 'comps' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/invalid dealId/);
    }
  });

  it('fails closed on unknown action types and malformed input', () => {
    for (const input of [
      { type: 'open_survey', dealId: 89, page: 'comps' },
      { type: 'zoom_gev', dealId: 89 },
      {}, null, undefined, 'navigate', 42, [],
    ]) {
      expect(parseDealWorkspaceAction(input).ok).toBe(false);
    }
  });
});

describe('deterministic executor', () => {
  function harness(ctx: DealWorkspaceContext | null = { dealId: 89, currentPage: 'overview' }) {
    let current = ctx;
    const navigateToPage = vi.fn((page: WorkspaceV2Page) => {
      if (current) current = { ...current, currentPage: page };
    });
    const execute = createDealWorkspaceExecutor({ getContext: () => current, navigateToPage });
    return { execute, navigateToPage, context: () => current };
  }

  it('executes a valid navigation via the canonical navigate path and preserves the deal', () => {
    const h = harness();
    const r = h.execute({ type: 'navigate_deal_page', dealId: 89, page: 'comps' });
    expect(r).toEqual({ ok: true, context: { dealId: 89, currentPage: 'comps' } });
    expect(h.navigateToPage).toHaveBeenCalledTimes(1);
    expect(h.navigateToPage).toHaveBeenCalledWith('comps');
  });

  it('rejects an invalid page without navigating anywhere (no silent Overview)', () => {
    const h = harness();
    const r = h.execute({ type: 'navigate_deal_page', dealId: 89, page: 'banana' });
    expect(r.ok).toBe(false);
    expect(h.navigateToPage).not.toHaveBeenCalled();
    expect(h.context()).toEqual({ dealId: 89, currentPage: 'overview' });
  });

  it('rejects a dealId that is not the open deal (no silent retarget)', () => {
    const h = harness();
    const r = h.execute({ type: 'navigate_deal_page', dealId: 7, page: 'comps' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not the open deal/);
    expect(h.navigateToPage).not.toHaveBeenCalled();
  });

  it('rejects when no workspace is open', () => {
    const h = harness(null);
    const r = h.execute({ type: 'navigate_deal_page', dealId: 89, page: 'comps' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no deal workspace is open/);
    expect(h.navigateToPage).not.toHaveBeenCalled();
  });

  it('never throws — even a throwing dependency fails closed', () => {
    const execute = createDealWorkspaceExecutor({
      getContext: () => ({ dealId: 89, currentPage: 'overview' }),
      navigateToPage: () => { throw new Error('boom'); },
    });
    const r = execute({ type: 'navigate_deal_page', dealId: 89, page: 'comps' });
    expect(r).toEqual({ ok: false, error: 'action execution failed: boom' });
  });
});
