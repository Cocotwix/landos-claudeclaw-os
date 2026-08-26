// Acquisition Workspace V2 deal-page navigation.
//
// The deal workspace is seven focused pages behind one persistent deal
// sidebar. Page switching is client-side: the workspace loads the property
// record once and reuses it across pages, so changing pages must never
// trigger a full document navigation or refetch. These helpers are pure so
// the URL/page contract stays testable in node.

export type WorkspaceV2Page =
  | 'overview' | 'property' | 'market' | 'comps'
  | 'strategy' | 'seller' | 'documents';

/** The seven deal pages, in sidebar order. */
export const DEAL_PAGES: Array<{ slug: WorkspaceV2Page; label: string; hint: string }> = [
  { slug: 'overview', label: 'Overview', hint: 'Deal command center' },
  { slug: 'property', label: 'Property', hint: 'Land, evidence & diligence' },
  { slug: 'market', label: 'Market', hint: 'Market Intelligence & research' },
  { slug: 'comps', label: 'Comps & Valuation', hint: 'Comparables & supported value' },
  { slug: 'strategy', label: 'Strategy & Underwriting', hint: 'Exits & acquisition economics' },
  { slug: 'seller', label: 'Seller & Activity', hint: 'Seller, comms & timeline' },
  { slug: 'documents', label: 'Documents', hint: 'Reports, evidence & files' },
];

const PAGE_SLUGS = new Set<string>(DEAL_PAGES.map((p) => p.slug));

// Old section/inner-view deep links keep working: each legacy slug maps to
// the deal page that now owns that content.
const LEGACY_SECTION_TO_PAGE: Record<string, WorkspaceV2Page> = {
  'overview': 'overview',
  'property-market': 'property',
  'property-intelligence': 'property',
  'comps-valuation': 'comps',
  'deal-activity': 'seller',
};

// ── Canonical workspace routing ────────────────────────────────────────
//
// Acquisition Workspace V2 is the operator workspace for every lead, deal
// and opportunity. Every normal entry point (pipeline, library, new lead,
// deep links) builds its destination here so record identity is preserved
// and the operator can always get back to the deal they were working.

export const WORKSPACE_V2_PATH = '/dept/acquisitions/v2';

type KVStore = Pick<Storage, 'getItem' | 'setItem'>;

const LAST_DEAL_KEY = 'landos.workspaceV2.lastDeal';
const sectionKey = (dealId: number) => `landos.workspaceV2.section.${dealId}`;

function sessionStore(): KVStore | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Record the deal (and its active page) the operator is using in V2 so
 * navigating elsewhere and returning restores the same record this session. */
export function rememberWorkspaceDeal(
  dealId: number,
  pageSlug: string,
  store: KVStore | null = sessionStore(),
): void {
  if (!store) return;
  try {
    store.setItem(LAST_DEAL_KEY, String(dealId));
    store.setItem(sectionKey(dealId), pageSlug);
  } catch { /* private mode — return-to-deal simply resets */ }
}

/** The deal most recently open in V2 during this browser session, if any. */
export function lastWorkspaceDealId(store: KVStore | null = sessionStore()): number | null {
  try {
    const n = Number(store?.getItem(LAST_DEAL_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

/** Canonical V2 href for one deal, restoring that deal's most recently used
 * page this session (Overview stays the bare canonical URL). */
export function dealWorkspaceHref(dealId: number, store: KVStore | null = sessionStore()): string {
  let slug: string | null = null;
  try { slug = store?.getItem(sectionKey(dealId)) ?? null; } catch { slug = null; }
  const base = `${WORKSPACE_V2_PATH}?deal=${dealId}`;
  // A stored legacy section slug from a prior session maps to its owning page.
  const page = slug ? (PAGE_SLUGS.has(slug) ? (slug as WorkspaceV2Page) : LEGACY_SECTION_TO_PAGE[slug]) : null;
  return page && page !== 'overview' ? `${base}&page=${page}` : base;
}

/** Derive the active deal page from a location search string. `page=` is the
 * canonical param; legacy `section=` deep links resolve to their owner. */
export function readPage(search: string): WorkspaceV2Page {
  const params = new URLSearchParams(search);
  const page = params.get('page');
  if (page && PAGE_SLUGS.has(page)) return page as WorkspaceV2Page;
  const legacy = params.get('section');
  if (legacy && LEGACY_SECTION_TO_PAGE[legacy]) return LEGACY_SECTION_TO_PAGE[legacy];
  return 'overview';
}

/**
 * Build the href for a deal page, preserving every other query param (deal,
 * token, …). Overview is the canonical bare URL: its `page` param is removed
 * rather than written. Any legacy `section` param is dropped: the deal page
 * model owns the URL from here on.
 */
export function pageHref(pathname: string, search: string, slug: string): string {
  const params = new URLSearchParams(search);
  params.delete('section');
  if (slug === 'overview' || !PAGE_SLUGS.has(slug)) params.delete('page');
  else params.set('page', slug);
  const qs = params.toString();
  return pathname + (qs ? `?${qs}` : '');
}
