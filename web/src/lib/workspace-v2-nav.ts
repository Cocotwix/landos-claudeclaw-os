// Acquisition Workspace V2 section navigation.
//
// Section switching is client-side: the page loads the property record once
// and reuses it across sections, so changing sections must never trigger a
// full document navigation or refetch. These helpers are pure so the
// URL/section contract stays testable in node.

export type WorkspaceV2Section = 'Overview' | 'Property Intelligence';

// Sections that exist today; the rest stay visible "Soon" placeholders.
export const SECTION_SLUGS: Record<string, string> = {
  Overview: 'overview',
  'Property Intelligence': 'property-intelligence',
};

/** Derive the active section from a location search string. */
export function readSection(search: string): WorkspaceV2Section {
  return new URLSearchParams(search).get('section') === 'property-intelligence'
    ? 'Property Intelligence'
    : 'Overview';
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
