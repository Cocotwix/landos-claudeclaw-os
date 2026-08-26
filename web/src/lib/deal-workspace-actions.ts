// Deal Workspace Action Layer V1 — the deterministic control substrate a
// future Deal Brain / Max uses to drive the open deal workspace.
//
// Architecture: operator language → Max (later) → DealWorkspaceAction →
// this deterministic executor → the SAME canonical client-side navigation
// the sidebar uses (workspace-v2-nav pageHref + pushState). No LLM, no
// vision, no research, no model calls, no database writes: UI control only.
//
// Everything here is pure and fail-closed. Invalid input is rejected with a
// reason; nothing guesses, defaults, or silently redirects.

import { DEAL_PAGES, type WorkspaceV2Page } from './workspace-v2-nav';

// ── Action contract ─────────────────────────────────────────────────────

/** The whitelisted action types. V1 supports exactly one: page navigation
 * within the open deal. Future families (comp selection, documents, GEV,
 * seller edits) are separate actions added deliberately, never inferred. */
export const DEAL_WORKSPACE_ACTION_TYPES = ['navigate_deal_page'] as const;
export type DealWorkspaceActionType = (typeof DEAL_WORKSPACE_ACTION_TYPES)[number];

/** Move the open deal workspace to one of its seven pages. */
export interface NavigateDealPageAction {
  type: 'navigate_deal_page';
  dealId: number;
  page: WorkspaceV2Page;
}

export type DealWorkspaceAction = NavigateDealPageAction;

/** Deterministic current-view context for the open deal. V1 is deliberately
 * minimal; later versions may add selected comps, open document, etc. */
export interface DealWorkspaceContext {
  dealId: number;
  currentPage: WorkspaceV2Page;
}

export type DealWorkspaceActionResult =
  | { ok: true; context: DealWorkspaceContext }
  | { ok: false; error: string };

// The seven valid page slugs come from the one canonical sidebar definition.
const VALID_PAGES = new Set<string>(DEAL_PAGES.map((p) => p.slug));

// ── Fail-closed validation ──────────────────────────────────────────────

export type ParsedDealWorkspaceAction =
  | { ok: true; action: DealWorkspaceAction }
  | { ok: false; error: string };

/** Validate unknown input into a DealWorkspaceAction. Fail closed: anything
 * malformed is rejected with a reason and causes no navigation at all. */
export function parseDealWorkspaceAction(input: unknown): ParsedDealWorkspaceAction {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'action must be an object' };
  }
  const a = input as Record<string, unknown>;
  if (a.type !== 'navigate_deal_page') {
    return { ok: false, error: `unknown action type: ${String(a.type)}` };
  }
  const dealId = a.dealId;
  if (typeof dealId !== 'number' || !Number.isInteger(dealId) || dealId <= 0) {
    return { ok: false, error: `invalid dealId: ${String(dealId)} (must be a positive integer)` };
  }
  const page = a.page;
  if (typeof page !== 'string' || !VALID_PAGES.has(page)) {
    return { ok: false, error: `invalid page: ${String(page)} (valid: ${DEAL_PAGES.map((p) => p.slug).join(', ')})` };
  }
  return { ok: true, action: { type: 'navigate_deal_page', dealId, page: page as WorkspaceV2Page } };
}

// ── Deterministic executor ──────────────────────────────────────────────

export interface DealWorkspaceExecutorDeps {
  /** Current context, derived from the live URL/deal — never cached state. */
  getContext: () => DealWorkspaceContext | null;
  /** The workspace's canonical client-side page navigation (the same code
   * path the sidebar uses): pageHref + pushState + state sync. */
  navigateToPage: (page: WorkspaceV2Page) => void;
}

/** Build the executor for the open workspace. Validates, preserves the open
 * deal, navigates through the canonical route path, and never throws. */
export function createDealWorkspaceExecutor(
  deps: DealWorkspaceExecutorDeps,
): (input: unknown) => DealWorkspaceActionResult {
  return (input: unknown): DealWorkspaceActionResult => {
    try {
      const parsed = parseDealWorkspaceAction(input);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const before = deps.getContext();
      if (!before) return { ok: false, error: 'no deal workspace is open' };
      if (parsed.action.dealId !== before.dealId) {
        // Switching deals is a future OPEN_DEAL action; navigating a page of
        // a deal that is not open must not silently retarget the workspace.
        return { ok: false, error: `deal ${parsed.action.dealId} is not the open deal (open: ${before.dealId})` };
      }
      deps.navigateToPage(parsed.action.page);
      const after = deps.getContext();
      return { ok: true, context: after ?? { dealId: before.dealId, currentPage: parsed.action.page } };
    } catch (err) {
      return { ok: false, error: `action execution failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
}

// ── Agent control bridge ────────────────────────────────────────────────
//
// The smallest safe local surface for an authorized future Deal Brain /
// browser-control layer: read the current context, execute a whitelisted
// action. Explicitly LandOS-namespaced on window; exposes ONLY these two
// functions — no code execution, no DB access, no fetch, no secrets.

export interface DealWorkspaceBridge {
  getContext: () => DealWorkspaceContext | null;
  executeAction: (input: unknown) => DealWorkspaceActionResult;
}

type LandOSWindow = Window & { LandOS?: { dealWorkspace?: DealWorkspaceBridge } };

export function registerDealWorkspaceBridge(bridge: DealWorkspaceBridge): void {
  const w = window as LandOSWindow;
  w.LandOS = { ...(w.LandOS ?? {}), dealWorkspace: bridge };
}

export function unregisterDealWorkspaceBridge(bridge: DealWorkspaceBridge): void {
  const w = window as LandOSWindow;
  if (w.LandOS?.dealWorkspace === bridge) delete w.LandOS.dealWorkspace;
}
