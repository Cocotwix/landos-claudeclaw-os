// Acquisition Workspace V2 section navigation.
//
// Section switching is client-side: the page loads the property record once
// and reuses it across sections, so changing sections must never trigger a
// full document navigation or refetch. These helpers are pure so the
// URL/section contract stays testable in node.

export type WorkspaceV2Section = 'Overview' | 'Property Intelligence' | 'Comps & Valuation';

// Sections that exist today; the rest stay visible "Soon" placeholders.
export const SECTION_SLUGS: Record<string, string> = {
  Overview: 'overview',
  'Property Intelligence': 'property-intelligence',
  'Comps & Valuation': 'comps-valuation',
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

/** Record the deal (and its active section) the operator is using in V2 so
 * navigating elsewhere and returning restores the same record this session. */
export function rememberWorkspaceDeal(
  dealId: number,
  sectionSlug: string,
  store: KVStore | null = sessionStore(),
): void {
  if (!store) return;
  try {
    store.setItem(LAST_DEAL_KEY, String(dealId));
    store.setItem(sectionKey(dealId), sectionSlug);
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
 * section this session (Overview stays the bare canonical URL). */
export function dealWorkspaceHref(dealId: number, store: KVStore | null = sessionStore()): string {
  let slug: string | null = null;
  try { slug = store?.getItem(sectionKey(dealId)) ?? null; } catch { slug = null; }
  const base = `${WORKSPACE_V2_PATH}?deal=${dealId}`;
  const valid = slug && slug !== 'overview' && Object.values(SECTION_SLUGS).includes(slug);
  return valid ? `${base}&section=${slug}` : base;
}

/** Derive the active section from a location search string. */
export function readSection(search: string): WorkspaceV2Section {
  const slug = new URLSearchParams(search).get('section');
  for (const [label, sectionSlug] of Object.entries(SECTION_SLUGS)) {
    if (slug === sectionSlug && label !== 'Overview') return label as WorkspaceV2Section;
  }
  return 'Overview';
}

/**
 * Build the href for a section, preserving every other query param (deal,
 * token, …). Overview is the canonical bare URL: its `section` param is
 * removed rather than written.
 */
export function sectionHref(pathname: string, search: string, slug: string): string {
  const params = new URLSearchParams(search);
  if (slug === 'overview') params.delete('section');
  else params.set('section', slug);
  const qs = params.toString();
  return pathname + (qs ? `?${qs}` : '');
}
