// The mandatory county fallback.
//
// LandOS must make a real effort at the actual governing authority, and it must
// also never hand an operator only "unknown" with no usable subdivision
// information. When the body that approves land division cannot be established
// from official sources, the county's own current minor-subdivision rules are
// retrieved and labelled — never presented as controlling.

import { describe, expect, it } from 'vitest';
import { researchCountySubdivisionFallback } from './land-use-run.js';
import type { GovFetchText, GovTextResponse } from './gis-transport.js';
import type { LocalResearchResult } from './land-use-local.js';
import { unresolvedValue } from './land-use-types.js';

const EMPTY_LOCAL: LocalResearchResult = {
  codeSources: [], documents: [], zoningAuthority: null, subdivisionAuthority: null,
  officialSites: [], notes: ['No adopted local law was located for this jurisdiction.'],
  unreadable: [], paidAccessBlocked: [],
};

function response(body: string, url: string): GovTextResponse {
  return { status: 200, body, url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
}

const HOST = 'www.grandtraversecountymi.gov';
const LAND_DIVISION_URL = `https://${HOST}/departments/planning/land-division`;

const HOME = '<html><body><h1>Grand Traverse County, Michigan</h1>'
  + '<p>Official website of Grand Traverse County, Michigan. Departments, Planning, Ordinances.</p>'
  + '</body></html>';

// A government site index: long, and carrying the land-use entry the lane
// actually follows.
const SITEMAP = `<html><body><ul>${
  Array.from({ length: 60 }, (_, i) => `<li><a href="https://${HOST}/page-${i}">Grand Traverse County department page number ${i} for residents and services</a></li>`).join('')
}<li><a href="${LAND_DIVISION_URL}">Land Division and Minor Subdivision</a></li></ul></body></html>`;

const LAND_DIVISION = '<html><body><h1>Grand Traverse County, Michigan</h1>'
  + '<h2>Land Division</h2>'
  + '<p>Section 4.1. A land division creating not more than 4 lots may be approved administratively '
  + 'by the zoning administrator. Each resulting lot shall have a minimum lot area of 1 acre and a '
  + 'minimum road frontage of 150 feet. A survey prepared by a licensed surveyor shall be submitted '
  + 'with the application before approval.</p>'
  + '</body></html>';

/** A county site that publishes a real land-division page, and nothing else. */
const countyFetch: GovFetchText = async (url) => {
  if (url.startsWith(`https://${HOST}`)) {
    if (url.includes('/sitemap')) return response(SITEMAP, url);
    if (url === LAND_DIVISION_URL) return response(LAND_DIVISION, url);
    if (url === `https://${HOST}`) return response(HOME, url);
  }
  return { status: 404, body: '', url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
};

describe('county subdivision fallback', () => {
  it('returns nothing rather than inventing rules when there is no county to research', async () => {
    const result = await researchCountySubdivisionFallback({
      county: null, state: 'MI',
      localUnitName: 'Whitewater township', localUnitType: 'township',
      localResult: EMPTY_LOCAL,
      determinedAt: '2026-08-09T00:00:00.000Z',
      stateHighwayAccessImplication: unresolvedValue<string>('Not established.'),
    }, { fetchText: countyFetch, allowWebSearch: false, maxRequests: 4 });
    expect(result).toBeNull();
  });

  it('labels the county rules, keeps the blocker, and never claims the county governs', async () => {
    const result = await researchCountySubdivisionFallback({
      county: 'Grand Traverse County', state: 'MI',
      localUnitName: 'Whitewater township', localUnitType: 'township',
      localResult: EMPTY_LOCAL,
      determinedAt: '2026-08-09T00:00:00.000Z',
      stateHighwayAccessImplication: unresolvedValue<string>('Not established.'),
    }, { fetchText: countyFetch, allowWebSearch: false, maxRequests: 4 });

    expect(result).not.toBeNull();
    expect(result!.label).toBe('County fallback rules — controlling local jurisdiction not yet confirmed');
    expect(result!.blocker).toBe('Controlling local jurisdiction not yet confirmed');
    expect(result!.county).toBe('Grand Traverse County');
    // The county is NOT promoted into the governing-body slot. That field is
    // reserved for an authority that was actually confirmed.
    expect(result!.framework.governingBody).toBeNull();
    // The attempt trail records which authority was checked and why the
    // question stayed open.
    // The county page was actually read and parsed by the SAME extractors the
    // local lane uses, so the operator gets usable requirements rather than
    // only "unknown".
    expect(result!.framework.minimumLotArea.value).toBeTruthy();
    expect(result!.framework.paths.length).toBeGreaterThan(0);
    expect(result!.authorityAttempts.join(' ')).toContain('Whitewater township');
    expect(result!.authorityAttempts.join(' ')).toContain('Grand Traverse County fallback');
    expect(result!.summary).toContain('Grand Traverse County');
    // The doubled suffix an operator would otherwise read.
    expect(result!.summary).not.toContain('County County');
  });

  it('does not read the county twice when the local unit already is the county', async () => {
    let reads = 0;
    const counting: GovFetchText = async (url) => { reads += 1; return countyFetch(url); };
    const result = await researchCountySubdivisionFallback({
      county: 'Grand Traverse County', state: 'MI',
      localUnitName: 'Grand Traverse County', localUnitType: 'unincorporated_county',
      localResult: EMPTY_LOCAL,
      determinedAt: '2026-08-09T00:00:00.000Z',
      stateHighwayAccessImplication: unresolvedValue<string>('Not established.'),
    }, { fetchText: counting, allowWebSearch: false, maxRequests: 4 });

    expect(result).not.toBeNull();
    expect(reads).toBe(0);
    expect(result!.blocker).toBe('Controlling local jurisdiction not yet confirmed');
  });
});
