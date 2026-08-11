import { beforeEach, describe, expect, it } from 'vitest';
import {
  candidateActionability,
  classifyDiscoveredSource,
  discoverOfficialSource,
  discoverViaArcgisOrgSearch,
  discoverViaOfficialSiteLinks,
  discoverViaRestrictedWebSearch,
  reconcileOfficialCandidates,
  verifyOfficiality,
  type OfficialSourceCandidate,
} from './official-source-discovery.js';
import {
  createBackgroundBrowserFetchText,
  looksLikeTransportRefusal,
  withBrowserFallback,
  type BackgroundPageLike,
} from './gov-browser-transport.js';
import { looksBlocked, readJsonBody, type GovFetchText } from './gis-transport.js';
import type { ArcgisFetch } from './arcgis-service-discovery.js';
import { _initTestLandosDb } from './db.js';

function textFetch(routes: Array<[string | RegExp, { body: string; status?: number; contentType?: string }]>, seen?: string[]): GovFetchText {
  return async (url) => {
    seen?.push(url);
    for (const [match, res] of routes) {
      const hit = typeof match === 'string' ? url.includes(match) : match.test(url);
      if (!hit) continue;
      const status = res.status ?? 200;
      const contentType = res.contentType ?? 'text/html';
      return { status, body: res.body, url, contentType, blocked: looksBlocked(status, res.body, contentType), via: 'server_fetch' };
    }
    return { status: 404, body: 'not found', url, contentType: 'text/plain', blocked: false, via: 'server_fetch' };
  };
}

const candidate = (over: Partial<OfficialSourceCandidate> = {}): OfficialSourceCandidate => ({
  url: 'https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer',
  label: 'County parcels',
  method: 'arcgis_org_search',
  sourceType: 'gis',
  officiality: { status: 'official', score: 1, evidence: ['.gov'] },
  ...over,
});

/* ─────────────────────────── officiality ─────────────────────────────── */

describe('a source is official because of evidence, never because it looks plausible', () => {
  it('accepts a government domain outright', () => {
    expect(verifyOfficiality('https://gis.rowancountync.gov/arcgis/rest/services').status).toBe('official');
    expect(verifyOfficiality('https://gis.co.example.tn.us/parcels').status).toBe('official');
  });

  it('rejects commercial aggregators however relevant they look', () => {
    for (const url of ['https://www.countyoffice.org/tn-cocke-county-gis-maps/', 'https://www.zillow.com/homes/x', 'https://regrid.com/us/tn']) {
      expect(verifyOfficiality(url).status).toBe('rejected');
    }
  });

  it('will not call a vendor host official without corroboration from the government side', () => {
    // Anyone can publish a parcel layer or stand up a vendor-shaped URL. The
    // vendor host alone proves nothing about who operates it.
    const bare = verifyOfficiality('https://beacon.schneidercorp.com/Application.aspx?AppID=942');
    expect(bare.status).toBe('unverified');

    const linked = verifyOfficiality('https://beacon.schneidercorp.com/Application.aspx?AppID=942', { linkedFromOfficial: true });
    expect(linked.status).toBe('officially_linked');

    const directoried = verifyOfficiality('https://beacon.schneidercorp.com/Application.aspx?AppID=942', { directoryNamedJurisdiction: true });
    expect(directoried.status).toBe('officially_linked');
  });

  it('rejects a same-named county in a different state', () => {
    const verdict = verifyOfficiality('https://www.pickenscountyga.gov/gis', { county: 'Pickens', state: 'SC' });
    expect(verdict.status).toBe('rejected');
  });

  it('always states why it reached its verdict', () => {
    expect(verifyOfficiality('https://gis.example.gov/x').evidence.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────── discovery methods ─────────────────────────── */

describe('Esri index results are filtered to the jurisdiction and to government publishers', () => {
  const arcgis = (results: unknown[]): ArcgisFetch => async (url) => ({
    status: 200, contentType: 'application/json', body: JSON.stringify({ results }), url,
  });

  it('accepts a county-hosted service on a government domain', async () => {
    const found = await discoverViaArcgisOrgSearch(
      { county: 'Rowan', state: 'NC' },
      { arcgis: { fetch: arcgis([{ title: 'Rowan County Parcels', url: 'https://gis.rowancountync.gov/arcgis/rest/services/Public/Parcels/MapServer', owner: 'rowan_gis', access: 'public' }]) } },
    );
    expect(found).toHaveLength(1);
    expect(found[0].officiality.status).toBe('official');
  });

  it('marks an Esri-hosted layer from a private publisher as unverified', async () => {
    // Real hazard: the public index carries unofficial county parcel copies.
    const found = await discoverViaArcgisOrgSearch(
      { county: 'Cocke', state: 'TN' },
      { arcgis: { fetch: arcgis([{ title: 'Cocke county parcels', url: 'https://services5.arcgis.com/abc/arcgis/rest/services/Cocke_county_parcels/FeatureServer', owner: 'somebody_random', access: 'public' }]) } },
    );
    expect(found[0].officiality.status).toBe('unverified');
  });

  it('drops results that are not about the requested county', async () => {
    const found = await discoverViaArcgisOrgSearch(
      { county: 'Rowan', state: 'NC' },
      { arcgis: { fetch: arcgis([{ title: 'Statewide Parcels', url: 'https://services1.arcgis.com/x/arcgis/rest/services/State/FeatureServer', owner: 'state_gis' }]) } },
    );
    expect(found).toHaveLength(0);
  });
});

describe('links published by a government confer officiality', () => {
  const PAGE = `
    <a href="/departments/gis/parcel-search">Parcel Search</a>
    <a href="https://beacon.schneidercorp.com/Application.aspx?AppID=1">Property Records</a>
    <a href="https://www.countyoffice.org/x">County Office</a>
    <a href="/news/road-closures">Road closures</a>`;

  it('promotes a vendor link found on an official page', async () => {
    const found = await discoverViaOfficialSiteLinks('https://www.example-county.gov/', { county: 'Example', state: 'NC' }, {
      fetchText: textFetch([['example-county.gov', { body: PAGE }]]),
    });
    const vendor = found.find((c) => c.url.includes('schneidercorp'));
    expect(vendor?.officiality.status).toBe('officially_linked');
    expect(vendor?.linkedFrom).toContain('example-county.gov');
  });

  it('ignores links that are not about property systems, and brokers entirely', () => {
    return discoverViaOfficialSiteLinks('https://www.example-county.gov/', { county: 'Example', state: 'NC' }, {
      fetchText: textFetch([['example-county.gov', { body: PAGE }]]),
    }).then((found) => {
      expect(found.some((c) => c.url.includes('road-closures'))).toBe(false);
      expect(found.some((c) => c.url.includes('countyoffice.org'))).toBe(false);
    });
  });

  it('refuses to confer officiality from a page that is not itself official', async () => {
    // Otherwise any site could launder a vendor URL into looking official.
    const found = await discoverViaOfficialSiteLinks('https://random-blog.example.com/', { county: 'Example', state: 'NC' }, {
      fetchText: textFetch([['random-blog', { body: PAGE }]]),
    });
    expect(found).toHaveLength(0);
  });
});

describe('public search is a lead source, not an authority', () => {
  const RESULTS = `
    <a href="/l/?uddg=https%3A%2F%2Fgis.rowancountync.gov%2Fgismaps%2F">Rowan County GIS</a>
    <a href="/l/?uddg=https%3A%2F%2Fwww.countyoffice.org%2Fnc-rowan-county-gis-maps%2F">Rowan GIS Maps</a>
    <a href="/l/?uddg=https%3A%2F%2Fpublicrecordhub.com%2Fnc%2Frowan%2Fgis">Parcel maps</a>`;

  it('keeps only genuine government results', async () => {
    const found = await discoverViaRestrictedWebSearch({ county: 'Rowan', state: 'NC' }, ['gis'], {
      searchFetchText: textFetch([['duckduckgo', { body: RESULTS }]]),
    });
    expect(found).toHaveLength(1);
    expect(found[0].url).toContain('gis.rowancountync.gov');
    expect(found[0].officiality.status).toBe('official');
  });
});

/* ──────────────────────── candidate reconciliation ───────────────────── */

describe('one source is chosen only when one source is clearly right', () => {
  it('prefers a queryable service over a landing page on the same government', () => {
    // A county's www and gis subdomains are one authority, and a service
    // endpoint is directly usable where a page still has to be crawled.
    const page = candidate({ url: 'https://www.rowancountync.gov/1567/GIS' });
    const service = candidate({ url: 'https://gis.rowancountync.gov/arcgis/rest/services/Public/MapViewer/MapServer' });
    const { selected, failure } = reconcileOfficialCandidates([page, service]);
    expect(failure).toBeNull();
    expect(selected?.url).toContain('/rest/services/');
  });

  it('stops when two different governments are equally credible and equally usable', () => {
    const county = candidate({ url: 'https://gis.cockecountytn.gov/arcgis/rest/services/P/MapServer' });
    const state = candidate({ url: 'https://tnmap.tn.gov/arcgis/rest/services/P/MapServer' });
    const { selected, competing, failure } = reconcileOfficialCandidates([county, state]);
    expect(selected).toBeNull();
    expect(competing).not.toBeNull();
    expect(failure).toBe('MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION');
  });

  it('reports not-found when nothing cleared the officiality bar', () => {
    const unverified = candidate({ officiality: { status: 'unverified', score: 0.4, evidence: [] } });
    expect(reconcileOfficialCandidates([unverified]).failure).toBe('OFFICIAL_GIS_SOURCE_NOT_FOUND');
    expect(reconcileOfficialCandidates([]).failure).toBe('OFFICIAL_GIS_SOURCE_NOT_FOUND');
  });

  it('ranks a service above an app above a page', () => {
    expect(candidateActionability(candidate({ url: 'https://x.gov/arcgis/rest/services/A/MapServer' }))).toBe(2);
    expect(candidateActionability(candidate({ url: 'https://beacon.schneidercorp.com/Application.aspx?AppID=1' }))).toBe(1);
    expect(candidateActionability(candidate({ url: 'https://www.x.gov/departments/gis' }))).toBe(0);
  });

  it('reports an official source it cannot fingerprint as exactly that', () => {
    // Still a real finding: the operator can use the link even with no adapter.
    const { family, failure } = classifyDiscoveredSource(candidate({ url: 'https://www.example-county.gov/property-lookup' }));
    expect(family).toBe('custom_government_portal');
    expect(failure).toBe('OFFICIAL_SOURCE_FOUND_PLATFORM_UNKNOWN');
    expect(classifyDiscoveredSource(candidate()).failure).toBeNull();
  });
});

/* ────────────────────────── end-to-end discovery ─────────────────────── */

describe('discovery runs cheapest-first and stops as soon as it is sure', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('takes a vendor directory hit without paying for a web search', async () => {
    const seen: string[] = [];
    const result = await discoverOfficialSource(
      { county: 'Fayette', state: 'GA' },
      {
        providerDirectory: async () => ({ url: 'https://beacon.schneidercorp.com/Application.aspx?AppID=942&PageTypeID=2', label: 'Fayette County, GA property search' }),
        arcgis: { fetch: async (url) => ({ status: 200, contentType: 'application/json', body: '{"results":[]}', url }) },
        searchFetchText: textFetch([], seen),
        allowWebSearch: true,
      },
    );
    expect(result.selected?.method).toBe('provider_directory');
    expect(result.selected?.officiality.status).toBe('officially_linked');
    expect(result.methodsRun).not.toContain('restricted_web_search');
    expect(seen).toHaveLength(0);
  });

  it('states not-found rather than settling for an unverified candidate', async () => {
    const result = await discoverOfficialSource(
      { county: 'Nowhere', state: 'ZZ' },
      {
        providerDirectory: async () => null,
        arcgis: { fetch: async (url) => ({ status: 200, contentType: 'application/json', body: '{"results":[]}', url }) },
        allowWebSearch: false,
      },
    );
    expect(result.selected).toBeNull();
    expect(result.failure).toBe('OFFICIAL_GIS_SOURCE_NOT_FOUND');
  });

  it('never lets a jurisdiction with no source run unbounded', async () => {
    const slow: GovFetchText = async (url) => {
      await new Promise((r) => setTimeout(r, 30));
      return { status: 404, body: '', url, contentType: '', blocked: false, via: 'server_fetch' };
    };
    const started = Date.now();
    await discoverOfficialSource(
      { county: 'Nowhere', state: 'ZZ' },
      {
        fetchText: slow, searchFetchText: slow, providerDirectory: async () => null,
        arcgis: { fetch: async (url) => ({ status: 200, contentType: 'application/json', body: '{"results":[]}', url }) },
        hostnameCandidates: ['a.gov', 'b.gov', 'c.gov'],
        maxWallClockMs: 200,
      },
    );
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

/* ───────────────────── background browser transport ──────────────────── */

function fakePage(html: string, closed: { count: number }): BackgroundPageLike {
  return {
    evaluate: async <T,>() => ({ html, url: 'https://example.gov/final', title: 't' }) as T,
    waitForFunction: async () => undefined,
    close: async () => { closed.count += 1; },
    url: () => 'https://example.gov/final',
  };
}

describe('the browser transport reads without taking over the operator screen', () => {
  it('opens a background target, reads it, and always closes it', async () => {
    const closed = { count: 0 };
    const opened: string[] = [];
    const fetchText = createBackgroundBrowserFetchText({
      settleMs: 0,
      openBackgroundPage: async (url) => { opened.push(url); return fakePage('<html><body>real content</body></html>', closed); },
    });
    const res = await fetchText('https://example.gov/page');
    expect(opened).toEqual(['https://example.gov/page']);
    expect(res.via).toBe('background_browser');
    expect(res.body).toContain('real content');
    expect(closed.count).toBe(1);
  });

  it('closes the tab even when reading throws', async () => {
    const closed = { count: 0 };
    const fetchText = createBackgroundBrowserFetchText({
      settleMs: 0,
      openBackgroundPage: async () => ({
        evaluate: async () => { throw new Error('renderer gone'); },
        waitForFunction: async () => undefined,
        close: async () => { closed.count += 1; },
        url: () => 'https://example.gov',
      }) as BackgroundPageLike,
    });
    await expect(fetchText('https://example.gov')).rejects.toThrow();
    expect(closed.count).toBe(1);
  });

  it('still reports a block when the challenge never cleared', async () => {
    const closed = { count: 0 };
    const fetchText = createBackgroundBrowserFetchText({
      settleMs: 0,
      openBackgroundPage: async () => fakePage('<html><body>Just a moment...</body></html>', closed),
    });
    expect((await fetchText('https://example.gov')).blocked).toBe(true);
  });
});

describe('the browser is an escalation, never the default', () => {
  it('does not open a browser when the direct request succeeds', async () => {
    let browserCalls = 0;
    const direct = textFetch([['example.gov', { body: 'fine' }]]);
    const browser: GovFetchText = async (url) => { browserCalls += 1; return { status: 200, body: 'b', url, contentType: 'text/html', blocked: false, via: 'background_browser' }; };
    const res = await withBrowserFallback(direct, browser)('https://example.gov/x');
    expect(res.via).toBe('server_fetch');
    expect(browserCalls).toBe(0);
  });

  it('escalates when the edge refused the client', async () => {
    const direct = textFetch([['example.gov', { status: 403, body: '<html>Attention Required! | Cloudflare</html>' }]]);
    const browser: GovFetchText = async (url) => ({ status: 200, body: '<html>real</html>', url, contentType: 'text/html', blocked: false, via: 'background_browser' });
    const res = await withBrowserFallback(direct, browser)('https://example.gov/x');
    expect(res.via).toBe('background_browser');
    expect(res.body).toContain('real');
  });

  it('does not open a browser for a host that simply is not there', async () => {
    // Discovery probes speculative hostnames; a tab per DNS miss would cost
    // tens of seconds each and starve the parcel search.
    let browserCalls = 0;
    const direct: GovFetchText = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND gis.nope.gov'), { code: 'ENOTFOUND' }); };
    const browser: GovFetchText = async (url) => { browserCalls += 1; return { status: 200, body: '', url, contentType: '', blocked: false, via: 'background_browser' }; };
    const res = await withBrowserFallback(direct, browser)('https://gis.nope.gov');
    expect(browserCalls).toBe(0);
    expect(res.blocked).toBe(false);
  });

  it('classifies refusals apart from unreachable hosts', () => {
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    expect(looksLikeTransportRefusal(new Error('socket hang up'))).toBe(true);
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(false);
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
  });
});

describe('a JSON API answers the same whether it was read directly or through a browser', () => {
  it('reads a raw body and a browser-wrapped body identically', () => {
    const raw = '{"States":[{"Name":"Georgia","Apps":[{"ID":942,"DisplayName":"Fayette County, GA"}]}]}';
    const wrapped = `<html><head></head><body><pre style="word-wrap: break-word;">${raw.replace(/"/g, '&quot;')}</pre></body></html>`;
    expect(readJsonBody(raw)).toEqual(readJsonBody(wrapped));
    expect((readJsonBody(wrapped) as { States: unknown[] }).States).toHaveLength(1);
  });

  it('returns null when there is no JSON to read', () => {
    expect(readJsonBody('<html><body>not json</body></html>')).toBeNull();
    expect(readJsonBody('')).toBeNull();
  });
});

describe('a preloaded challenge widget is not a block', () => {
  it('treats a large page carrying a challenge script as real content', () => {
    // Government portals preload the widget on every page. Reading that as a
    // block would send every successful retrieval down the fallback path.
    const realPage = `<html><head><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head><body>${'x'.repeat(80_000)}</body></html>`;
    expect(looksBlocked(200, realPage, 'text/html')).toBe(false);
  });

  it('still catches an actual challenge page', () => {
    expect(looksBlocked(200, '<html><body>Just a moment...</body></html>', 'text/html')).toBe(true);
    expect(looksBlocked(403, '<html>Attention Required!</html>', 'text/html')).toBe(true);
  });
});
