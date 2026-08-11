// A transport that refuses is not a state without law.
//
// Michigan's legislature serves an INCOMPLETE certificate chain: it omits the
// issuing certificate, a browser fetches it from the leaf's own
// authority-information-access extension and reads the page, and Node's
// verifier cannot and fails the handshake with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
// Every layer above then reported the wrong thing. The error named neither a
// socket nor a DNS failure, so the escalation test returned false and the
// browser rung was never opened; the reader swallowed the throw and returned
// null; and the entry point published "reached but exposed no machine-readable
// route to the governing statutes" for a host it had never read a byte of.
//
// These tests pin the chain end to end: classify, escalate, report the real
// failure, and change discovery method rather than reporting no law.

import { describe, expect, it } from 'vitest';
import {
  looksLikeTransportRefusal,
  withBrowserFallback,
} from './gov-browser-transport.js';
import { retrieveStateLaw } from './state-law-retrieval.js';
import {
  resolveStateFramework,
  stateFrameworkBrowserTransport,
  stateFrameworkSourceTier,
  stateFrameworkTransport,
} from './land-use-state-framework.js';
import type { GovFetchText } from './gis-transport.js';

/** The error Node's fetch actually throws for an incomplete chain. */
function chainError(): Error {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = Object.assign(new Error('unable to verify the first certificate'), {
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  });
  return error;
}

function ok(body: string, url: string): Awaited<ReturnType<GovFetchText>> {
  return { status: 200, body, url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
}

/* ══════════════ 1. THE ERROR IS CLASSIFIED AS A CLIENT REFUSAL ══════════ */

describe('an incomplete certificate chain is a refusal of this client, not an absent host', () => {
  it('escalates a chain that cannot be verified', () => {
    expect(looksLikeTransportRefusal(chainError())).toBe(true);
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }))).toBe(true);
  });

  it('still refuses to open a tab for a host that is simply not there', () => {
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(false);
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
  });

  it('does not escalate a certificate a browser would reject too', () => {
    // Expired, self-signed and wrong-name certificates fail in Chrome as well,
    // so opening a tab for them buys a second refusal and a second delay.
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }))).toBe(false);
    expect(looksLikeTransportRefusal(Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }))).toBe(false);
  });
});

describe('the browser rung is actually reached when the chain fails', () => {
  it('reads the page through the browser after the direct request is refused', async () => {
    const direct: GovFetchText = async () => { throw chainError(); };
    const browser: GovFetchText = async (url) => ({
      status: 200, body: '<html>SUBDIVISION CONTROL ACT OF 1967</html>', url,
      contentType: 'text/html', blocked: false, via: 'background_browser',
    });
    const response = await withBrowserFallback(direct, browser)('https://www.legislature.mi.gov/Laws/ChapterIndex');
    expect(response.via).toBe('background_browser');
    expect(response.body).toContain('SUBDIVISION CONTROL ACT');
  });

  it('reports a block, not an empty page, when the browser cannot run either', async () => {
    const direct: GovFetchText = async () => { throw chainError(); };
    const browser: GovFetchText = async () => { throw new Error('Background browser session unavailable (unreachable).'); };
    const response = await withBrowserFallback(direct, browser)('https://www.legislature.mi.gov/Laws/ChapterIndex');
    expect(response.blocked).toBe(true);
    expect(response.body).toBe('');
  });
});

/* ══════════════ 2. RETRIEVAL SAYS WHICH FAILURE THIS WAS ════════════════ */

describe('state-law retrieval distinguishes an unreadable source from an empty one', () => {
  it('reports a transport blocker when every request was refused', async () => {
    const refusing: GovFetchText = async () => { throw chainError(); };
    const retrieval = await retrieveStateLaw('MI', { fetchText: refusing, learn: false, maxRequests: 6 });

    expect(retrieval.transportBlocked).toBe(true);
    expect(retrieval.documents).toHaveLength(0);
    expect(retrieval.blocker).toMatch(/transport blocker/i);
    // The old wording asserted the source had been READ. It had not.
    expect(retrieval.blocker).not.toMatch(/exposed no machine-readable route/i);
  });

  it('still reports an answered but unusable source as exactly that', async () => {
    const answering: GovFetchText = async (url) => ok('<html><body>Welcome</body></html>', url);
    const retrieval = await retrieveStateLaw('MI', { fetchText: answering, learn: false, maxRequests: 6 });

    expect(retrieval.transportBlocked).toBe(false);
    expect(retrieval.blocker).toMatch(/exposed no machine-readable route/i);
  });

  it(`treats an edge challenge as a refusal rather than as the source own words`, async () => {
    const challenged: GovFetchText = async (url) => ({
      status: 403, body: '<html>Attention Required! Checking your browser before accessing</html>', url,
      contentType: 'text/html', blocked: true, via: 'server_fetch',
    });
    const retrieval = await retrieveStateLaw('MI', { fetchText: challenged, learn: false, maxRequests: 6 });
    expect(retrieval.transportBlocked).toBe(true);
    expect(retrieval.blocker).toMatch(/transport blocker/i);
  });
});

/* ══════════════ 3. DISCOVERY METHOD CHANGES, RATHER THAN GIVING UP ══════ */

const LARA_PAGE = `<html><body><h1>Michigan Land Survey and Remonumentation</h1>
<p>The Land Division Act, 1967 PA 288, governs the division of land in Michigan and the
approval of plats. A division of land under the act is reviewed by the municipality in
which the land is located, and a parcel created in violation of the act may not be
recorded. The act sets the number of divisions a parent parcel supports before a plat is
required, and local government administers approval within that statutory baseline.
Additional requirements may be imposed by the municipality where the act authorizes it.</p>
</body></html>`;

/** Search-result markup in the shape the discovery route unwraps. */
function searchResults(urls: string[]): string {
  return `<html><body>${urls
    .map((url) => `<a href="${url}">${url.replace(/^https?:\/\//, '')}</a>`)
    .join('')}</body></html>`;
}

describe('a transport-blocked official source changes discovery method instead of reporting no law', () => {
  it('asks the actual legal question and answers from the best source it can read', async () => {
    const queries: string[] = [];
    const fetchText: GovFetchText = async (url) => {
      if (/legislature\.mi\.gov/i.test(url)) throw chainError();
      if (/duckduckgo/i.test(url)) {
        queries.push(decodeURIComponent(new URL(url).searchParams.get('q') ?? ''));
        return ok(searchResults([
          'https://law.justia.com/codes/michigan/chapter-560/',
          'https://www.michigan.gov/lara/bureau-list/bcc/sections/land-survey/subdivisions',
        ]), url);
      }
      if (/michigan\.gov/i.test(url)) return ok(LARA_PAGE, url);
      return { status: 404, body: '', url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
    };

    const framework = await resolveStateFramework('MI', { fetchText, now: () => '2026-08-09T00:00:00.000Z' });

    // The question is asked as a question. Restricting it to the host that just
    // refused could only have returned more pages on that host.
    expect(queries[0]).not.toMatch(/site:/);
    expect(queries[0]).toMatch(/Michigan/);

    expect(framework.status).toBe('present');
    const division = framework.provisions.find((provision) => provision.kind === 'land_division_act');
    expect(division).toBeTruthy();
    expect(division!.citation.url).toContain('michigan.gov');
    expect(division!.citation.excerpt).toMatch(/Land Division Act/i);

    // The blocked official source is named as blocked, so "we could not look"
    // is visible beside the answer that was found another way.
    expect(framework.sourcesSearched.some((entry) =>
      entry.outcome === 'unreachable' && /transport layer/i.test(entry.label))).toBe(true);
  });

  it('keeps discovery on the official host when the source answered and was merely empty', async () => {
    const queries: string[] = [];
    const fetchText: GovFetchText = async (url) => {
      if (/duckduckgo/i.test(url)) {
        queries.push(decodeURIComponent(new URL(url).searchParams.get('q') ?? ''));
        return ok(searchResults(['https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-Act-288-of-1967']), url);
      }
      return ok('<html><body>Welcome</body></html>', url);
    };

    await resolveStateFramework('MI', { fetchText, now: () => '2026-08-09T00:00:00.000Z' });
    expect(queries[0]).toMatch(/site:www\.legislature\.mi\.gov/);
  });
});

/* ══════════════ 4. WHAT ANSWERED IS LABELLED FOR WHAT IT IS ═════════════ */

describe('a fallback answer is tiered by its publisher, never by the fact that it answered', () => {
  const origin = 'https://www.legislature.mi.gov';

  it('calls the official publication the statute', () => {
    expect(stateFrameworkSourceTier(`${origin}/Laws/MCL?objectName=mcl-560-108`, 'Land Division Act', origin, 'object_address'))
      .toBe('state_statute');
  });

  it('keeps a sibling subdomain of the same publisher on the statute tier', () => {
    // Publishing the code at `archive.<host>` is ordinary and it is still the
    // same publication, but only when a CODE adapter walked to it.
    expect(stateFrameworkSourceTier('https://archive.legislature.mi.gov/mcl/560', 'Chapter 560', origin, 'object_address'))
      .toBe('state_statute');
  });

  it('does not promote another agency on the state domain just for living there', () => {
    // A state's registrable domain is shared by every agency it operates, so a
    // search hit elsewhere on it is agency material, never the statute.
    expect(stateFrameworkSourceTier('https://dor.mi.gov/land', 'Treasury', origin, 'page_search'))
      .toBe('state_agency');
  });

  it('calls another government publisher state agency material', () => {
    expect(stateFrameworkSourceTier('https://www.michigan.gov/lara/land-survey', 'Land Survey', origin, 'page_search'))
      .toBe('state_agency');
  });

  it('never lets an aggregator state the law', () => {
    expect(stateFrameworkSourceTier('https://law.justia.com/codes/michigan/chapter-560/', 'Chapter 560', origin, 'page_search'))
      .toBe('secondary_discovery_only');
  });
});

// The browser rung belongs to the lane, not to whoever calls it.
//
// One caller built `withBrowserFallback(...)` and passed it in; every other
// caller got the plain server fetch and so reported "no state law" for a host
// that simply refuses Node's TLS chain. The default now carries the escalation,
// and an injected transport still wins outright so tests stay offline.
describe('state framework default transport', () => {
  const injected: GovFetchText = async () => ({
    status: 200, body: '', url: '', contentType: 'text/html', blocked: false, via: 'server_fetch',
  });

  it('escalates to the dedicated browser when the caller supplies nothing', () => {
    const transport = stateFrameworkTransport({});
    expect(typeof transport).toBe('function');
    expect(transport).not.toBe(injected);
    // Same instance every time: no browser session is built per document read.
    expect(stateFrameworkTransport({})).toBe(transport);
  });

  it('lets an injected transport win, so nothing offline reaches for a browser', () => {
    expect(stateFrameworkTransport({ fetchText: injected })).toBe(injected);
    expect(stateFrameworkBrowserTransport({ fetchText: injected })).toBe(injected);
  });

  it('prefers an explicit browser transport for a source known to need one', () => {
    expect(stateFrameworkBrowserTransport({ browserFetchText: injected, fetchText: async () => { throw new Error('unused'); } }))
      .toBe(injected);
  });
});
