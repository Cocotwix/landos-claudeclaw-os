// LandOS — Statewide public-record assessment portals (county-agnostic fallback).
//
// A growing number of states run a single statewide property-assessment portal
// that serves most or all counties. When county-specific sources are thin
// (landing pages, contact pages, redirect shells) or NETR is stale, the county
// browser falls back to the state's official statewide index. This is NOT a
// replacement for local county records — it is a gap-fill lane that runs AFTER
// local sources and BEFORE giving up.
//
// Each entry records the state, portal URL, whether it is an ASP.NET/Blazor
// app (affects form filling), the search endpoint, and the list of covered
// counties (when known). Counties not listed here are assumed covered if the
// portal's county dropdown includes them.

export interface StatewidePortal {
  state: string;
  url: string;
  platform: 'aspnet' | 'generic';
  searchPath: string;
  coveredCounties?: string[];
  notes?: string;
}

/**
 * Known statewide property-assessment portals.
 *
 * Add entries here as new states are encountered. The county browser will
 * automatically try the portal when:
 *   1. All county-specific sources are exhausted without a parcel record, AND
 *   2. The state has an entry here, AND
 *   3. The county is either listed in coveredCounties or the portal's county
 *      dropdown includes it.
 */
export const STATEWIDE_ASSESSMENT_PORTALS: StatewidePortal[] = [
  {
    state: 'TN',
    url: 'https://assessment.cot.tn.gov',
    platform: 'aspnet',
    searchPath: '/TPAD/Search',
    notes: 'Tennessee Comptroller TPAD — serves 86 of 95 counties. Cocke (015) confirmed covered.',
  },
];

/** Look up a statewide portal for a state (normalized to upper-case). */
export function statewidePortalFor(state: string): StatewidePortal | undefined {
  return STATEWIDE_ASSESSMENT_PORTALS.find((p) => p.state.toUpperCase() === state.trim().toUpperCase());
}

/** Quick check: is the given URL a known statewide assessment portal? */
export function isStatewidePortal(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STATEWIDE_ASSESSMENT_PORTALS.some((p) => {
      try { return host === new URL(p.url).hostname.toLowerCase(); } catch { return false; }
    });
  } catch { return false; }
}
