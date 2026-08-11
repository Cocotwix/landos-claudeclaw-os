// VERIFIED discovery of a county's real official source.
//
// The mandatory county subdivision fallback activated correctly on the MI
// acceptance subject and then had nothing to read, because source discovery
// stopped at the hostname formula. The formula derives a host from the
// jurisdiction's spelled-out name, and Grand Traverse County publishes at
// `gtcountymi.gov` — an abbreviation no permutation of "grand traverse" will
// ever produce.
//
// The gap is closed with the registrar's own table of the .gov namespace, where
// the match is on the REGISTRANT ORGANIZATION and the state rather than on how
// the hostname reads. These tests hold the sequence: source miss → discover →
// verify → use → cache, and hold the two things it must never do — accept a
// same-named government in another state, or hardcode a county.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  DOTGOV_REGISTRY_URL,
  governmentDomainsFor,
  parseGovDomainRegistry,
  resetGovDomainRegistryCache,
} from './gov-domain-registry.js';
import { researchCountySubdivisionFallback } from './land-use-run.js';
import { researchLocalLandUse, type OfficialSiteCache } from './land-use-local.js';
import type { GovFetchText, GovTextResponse } from './gis-transport.js';
import type { LocalResearchResult } from './land-use-local.js';
import { unresolvedValue } from './land-use-types.js';

const EMPTY_LOCAL: LocalResearchResult = {
  codeSources: [], documents: [], zoningAuthority: null, subdivisionAuthority: null,
  officialSites: [], notes: ['No adopted local law was located for this jurisdiction.'],
  unreadable: [], paidAccessBlocked: [],
};

/** The registrar's table, in its real shape and with real-shaped decoys. */
const REGISTRY_CSV = [
  'Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email',
  'gtcountymi.gov,County,Grand Traverse County,,Traverse City,MI,support@gtcountymi.gov',
  'gtb-nsn.gov,Tribal,Grand Traverse Band of Ottawa and Chippewa Indians,,Peshawbestown,MI,',
  'traversecitymi.gov,City,City of Traverse City,,Traverse City,MI,',
  'grandtraversecounty.gov,County,Grand Traverse County,,Somewhere,TX,',
  'michigan.gov,State,State of Michigan,,Lansing,MI,',
].join('\n');

const HOST = 'www.gtcountymi.gov';
const LAND_DIVISION_URL = `https://${HOST}/departments/planning/land-division`;

const HOME = '<html><body><h1>Grand Traverse County, Michigan</h1>'
  + '<p>Official website of Grand Traverse County, Michigan. Departments, Planning, Ordinances.</p>'
  + '</body></html>';

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

function response(body: string, url: string): GovTextResponse {
  return { status: 200, body, url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
}

function missing(url: string): GovTextResponse {
  return { status: 404, body: '', url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
}

/**
 * Every hostname the formula derives is dead, exactly as it is live. Only the
 * registry, and then the county's real host, answer.
 */
const requested: string[] = [];
const countyFetch: GovFetchText = async (url) => {
  requested.push(url);
  if (url === DOTGOV_REGISTRY_URL) return response(REGISTRY_CSV, url);
  if (url.startsWith(`https://${HOST}`)) {
    if (url.includes('/sitemap')) return response(SITEMAP, url);
    if (url === LAND_DIVISION_URL) return response(LAND_DIVISION, url);
    if (url === `https://${HOST}` || url === `https://${HOST}/`) return response(HOME, url);
  }
  return missing(url);
};

function recordingCache(): OfficialSiteCache & { saved: Array<{ url: string; verifiedVia: string; jurisdiction: string }>; seed(url: string): void } {
  const store = new Map<string, { url: string; label: string }>();
  const saved: Array<{ url: string; verifiedVia: string; jurisdiction: string }> = [];
  return {
    saved,
    seed(url: string) { store.set('MI|grand traverse county|county', { url, label: 'seeded' }); },
    get(state, jurisdiction, unitType) {
      return store.get(`${state}|${jurisdiction.toLowerCase()}|${unitType}`) ?? null;
    },
    save(entry) {
      saved.push({ url: entry.url, verifiedVia: entry.verifiedVia, jurisdiction: entry.jurisdiction });
      store.set(`${entry.state}|${entry.jurisdiction.toLowerCase()}|${entry.unitType}`, { url: entry.url, label: entry.label });
    },
  };
}

beforeEach(() => {
  resetGovDomainRegistryCache();
  requested.length = 0;
});

describe('the official .gov registry as the verification of government ownership', () => {
  it('reads the table by header name, not by column position', () => {
    const rows = parseGovDomainRegistry(REGISTRY_CSV);
    const county = rows.find((row) => row.domain === 'gtcountymi.gov')!;
    expect(county.organization).toBe('Grand Traverse County');
    expect(county.state).toBe('MI');
    expect(county.domainType).toBe('County');
  });

  it('matches on the registrant organization, so an abbreviated host is still found', () => {
    const matches = governmentDomainsFor(parseGovDomainRegistry(REGISTRY_CSV), 'Grand Traverse County', 'MI', 'county');
    expect(matches[0].domain).toBe('gtcountymi.gov');
    // The identically-named county in another state is never a candidate — the
    // same cross-jurisdiction refusal the parcel engine already makes.
    expect(matches.some((row) => row.state !== 'MI')).toBe(false);
    // Neither is the tribal government, nor the city inside the county, nor the
    // state. None of them is this county.
    expect(matches.some((row) => row.domain === 'gtb-nsn.gov')).toBe(false);
    expect(matches.some((row) => row.domain === 'traversecitymi.gov')).toBe(false);
    expect(matches.some((row) => row.domain === 'michigan.gov')).toBe(false);
  });
});

describe('county source discovery when the hostname formula misses', () => {
  it('discovers, verifies, reads and caches the county\'s real official site', async () => {
    const cache = recordingCache();
    const result = await researchLocalLandUse(
      {
        county: 'Grand Traverse County', state: 'MI',
        localUnitName: 'Grand Traverse County', localUnitType: 'county',
        knownPlanningUrls: [], now: '2026-08-09T00:00:00.000Z',
      },
      { fetchText: countyFetch, allowWebSearch: false, maxRequests: 4, siteCache: cache },
    );

    // The formula was tried first and every candidate it derived is dead.
    expect(requested.some((url) => url.includes('grandtraversecountymi.gov'))).toBe(true);
    // The registry was then consulted, and the county's real host was reached.
    expect(requested).toContain(DOTGOV_REGISTRY_URL);
    expect(result.officialSites.some((site) => site.url.includes('gtcountymi.gov'))).toBe(true);
    // Its own site index produced the land-division page, which was read.
    expect(result.documents.some((document) => document.url === LAND_DIVISION_URL)).toBe(true);
    // And the verified source was learned.
    expect(cache.saved[0].verifiedVia).toBe('dotgov_registry');
    expect(cache.saved[0].url).toContain('gtcountymi.gov');
  });

  it('uses the learned source directly for the next property, without rediscovering', async () => {
    const cache = recordingCache();
    cache.seed(`https://${HOST}`);
    const result = await researchLocalLandUse(
      {
        county: 'Grand Traverse County', state: 'MI',
        localUnitName: 'Grand Traverse County', localUnitType: 'county',
        knownPlanningUrls: [], now: '2026-08-09T00:00:00.000Z',
      },
      { fetchText: countyFetch, allowWebSearch: false, maxRequests: 4, siteCache: cache },
    );

    expect(result.officialSites.some((site) => site.url.includes('gtcountymi.gov'))).toBe(true);
    // No formula sweep and no registry download the second time.
    expect(requested.some((url) => url.includes('grandtraversecountymi.gov'))).toBe(false);
    expect(requested).not.toContain(DOTGOV_REGISTRY_URL);
    expect(result.documents.some((document) => document.url === LAND_DIVISION_URL)).toBe(true);
  });
});

describe('the county fallback reaches the county through discovery', () => {
  it('retrieves the county\'s published land-division requirements and keeps the blocker', async () => {
    const result = await researchCountySubdivisionFallback(
      {
        county: 'Grand Traverse County', state: 'MI',
        localUnitName: 'Whitewater township', localUnitType: 'township',
        localResult: EMPTY_LOCAL,
        determinedAt: '2026-08-09T00:00:00.000Z',
        stateHighwayAccessImplication: unresolvedValue<string>('Not established.'),
      },
      { fetchText: countyFetch, allowWebSearch: false, maxRequests: 4, siteCache: recordingCache() },
    );

    expect(result).not.toBeNull();
    // The material the operator actually needs, from the county's own page.
    expect(result!.framework.minimumLotArea.value).toBeTruthy();
    expect(result!.framework.paths.length).toBeGreaterThan(0);
    expect(result!.sources.some((source) => source.url?.includes('gtcountymi.gov'))).toBe(true);
    // Labelled, never controlling. County jurisdiction was not established.
    expect(result!.label).toBe('County fallback rules — controlling local jurisdiction not yet confirmed');
    expect(result!.blocker).toBe('Controlling local jurisdiction not yet confirmed');
    expect(result!.framework.governingBody).toBeNull();
  });

  it('says plainly that a verified county publishes no land-division rule, and still cites what it read', async () => {
    // The live MI county is this case: its official source is reachable and it
    // publishes a construction code and a farmland ordinance, but no county
    // minor-subdivision requirement — because in Michigan the local unit
    // administers land division. Reporting that as "the county's rules are
    // shown here" would be a claim the page cannot support.
    const ordinancesOnly: GovFetchText = async (url) => {
      requested.push(url);
      if (url === DOTGOV_REGISTRY_URL) return response(REGISTRY_CSV, url);
      if (url === `https://${HOST}` || url === `https://${HOST}/`) return response(HOME, url);
      if (url.includes('/sitemap')) {
        return response(`<html><body><ul>${
          Array.from({ length: 60 }, (_, i) => `<li><a href="https://${HOST}/page-${i}">Grand Traverse County department page number ${i} for residents and services</a></li>`).join('')
        }<li><a href="https://${HOST}/251/County-Ordinances">County Ordinances</a></li></ul></body></html>`, url);
      }
      if (url === `https://${HOST}/251/County-Ordinances`) {
        return response('<html><body><h1>Grand Traverse County, Michigan</h1><h2>County Ordinances</h2>'
          + '<p>The County has adopted a Construction Code Enforcing Agency Ordinance and a Farmland '
          + 'and Open Space Development Rights Ordinance. Copies are available from the County Clerk.</p>'
          + '</body></html>', url);
      }
      return missing(url);
    };

    const result = await researchCountySubdivisionFallback(
      {
        county: 'Grand Traverse County', state: 'MI',
        localUnitName: 'Whitewater township', localUnitType: 'township',
        localResult: EMPTY_LOCAL,
        determinedAt: '2026-08-09T00:00:00.000Z',
        stateHighwayAccessImplication: unresolvedValue<string>('Not established.'),
      },
      { fetchText: ordinancesOnly, allowWebSearch: false, maxRequests: 4, siteCache: recordingCache() },
    );

    expect(result).not.toBeNull();
    expect(result!.summary).toContain('publishes no county minor-subdivision');
    expect(result!.summary).not.toContain('rules are shown here');
    // What WAS read is still citable, so the operator is not left with a
    // fallback that has nothing behind it.
    expect(result!.sources.some((source) => source.url?.includes('gtcountymi.gov'))).toBe(true);
    expect(result!.blocker).toBe('Controlling local jurisdiction not yet confirmed');
  });
});
