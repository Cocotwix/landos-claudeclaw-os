// The governed non-CDP search transport, and what the indexed-web identity lane
// may and may not believe from it.
//
// The transport is the capability LandOS governance already selected: free,
// keyless `ddgs` inside the pinned Hermes Python runtime. These tests cover the
// wiring and the belief rules; the LIVE proof lives in
// `universal-resolution-fairview.live.test.ts`, which is opt-in because it makes
// real outbound requests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pre-existing, unrelated: `comps.ts` at HEAD imports an uncommitted module.
vi.mock('./comps.js', () => ({
  listComps: () => [], addComp: () => ({}), getComp: () => undefined, deleteComp: () => false,
  upsertNormalizedComp: () => ({}), retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [], geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null, recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }), isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined, PAID_COMP_TOOLS: [],
}));

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import {
  buildIndexedWebIdentityLane,
  mentionsSubjectParcel,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
} from './universal-property-resolution.js';
import {
  createHermesFreeSearch,
  hermesFreeSearchAvailability,
  resolveGovernedPython,
  type IdentitySearchHit,
  type IdentitySearchProvider,
} from './hermes-free-search.js';
import type { GovFetchText } from './gis-transport.js';

const ASSESSOR = 'https://propertyassessor.example-county.gov/parcel?pid=042-123.00-000';
const MUNICIPAL_PDF = 'https://www.example-city-tn.org/content/uploads/packet-planningcommission.pdf';
const AGGREGATOR = 'https://www.zillow.com/homedetails/42-123';

function assessorPage(rows: Record<string, string> = {}): string {
  const all: Record<string, string> = {
    'Parcel ID': '042-123.00-000',
    'Owner Name': 'LANDSOUTH LLC',
    County: 'Williamson',
    State: 'TN',
    City: 'Fairview',
    'Location Address': 'KINGWOOD BLVD',
    'Deeded Acres': '75.90',
    ...rows,
  };
  return `<html><body><table>${Object.entries(all).map(([k, v]) => `<th>${k}</th><td>${v}</td>`).join('')}</table></body></html>`;
}

function stubSearch(hits: IdentitySearchHit[]): { search: IdentitySearchProvider; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    search: async (query) => { queries.push(query); return hits; },
  };
}

function stubPages(pages: Record<string, string>): { fetchText: GovFetchText; opened: string[] } {
  const opened: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    opened.push(url);
    const body = Object.entries(pages).find(([key]) => url.startsWith(key))?.[1];
    return { status: body ? 200 : 404, body: body ?? '<html>nothing</html>', url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
  };
  return { fetchText, opened };
}

function seedSparseLead(): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123', sellerNotes: 'Map 042 Parcel 123\nFairview, Tennessee' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Map 042 Parcel 123',
    city: 'Fairview',
    state: 'TN',
    summary: 'Map 042 Parcel 123\nFairview, Tennessee',
    agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

const promoteOffline = (dealCardId: number, actor: string) =>
  reconcileSubjectIdentity(dealCardId, { actor, censusGeography: null });

const neverSettles = (): Promise<IdentityLaneResult> => new Promise(() => {});

beforeEach(() => { _initTestLandosDb(); });

// ── 1. The transport itself ─────────────────────────────────────────────────

describe('governed non-CDP search transport', () => {
  it('resolves the runtime the way the governed MCP launcher does', () => {
    expect(resolveGovernedPython({ LANDOS_SEARCH_PYTHON: 'relative/python.exe' })).toBeNull();
    expect(resolveGovernedPython({ LANDOS_MCP_PYTHON: 'C:\\nope\\python.exe' })).toBeNull();
    expect(resolveGovernedPython({})).toBeNull();
    // The pinned Hermes venv is the documented default location.
    const fromHermes = resolveGovernedPython({ LOCALAPPDATA: 'C:\\definitely\\missing' });
    expect(fromHermes).toBeNull();
  });

  it('degrades to no results rather than throwing when no runtime exists', async () => {
    const search = createHermesFreeSearch({ python: null });
    await expect(search('"Map 042" "Parcel 123"')).resolves.toEqual([]);
  });

  it('reports the installed capability honestly', async () => {
    const availability = await hermesFreeSearchAvailability({ env: { LOCALAPPDATA: 'C:\\definitely\\missing' } });
    expect(availability.available).toBe(false);
    expect(availability.python).toBeNull();
    expect(availability.reason).toContain('No governed Python runtime');
  });
});

// ── 2/3/4. Normalization, official preference, raw notation search ──────────

describe('indexed-web lane on a structured search provider', () => {
  it('searches the raw notation and normalizes a government result into identity evidence', async () => {
    const { dealCardId } = seedSparseLead();
    const { search, queries } = stubSearch([
      { title: 'Map 042 Parcel 123 — County Property Assessor', url: ASSESSOR, snippet: 'Parcel 042-123.00-000 · LANDSOUTH LLC · 75.90 acres' },
    ]);
    const { fetchText } = stubPages({ [ASSESSOR]: assessorPage() });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);

    expect(queries[0]).toContain('"Map 042" "Parcel 123"');
    expect(result.status).toBe('evidence');
    expect(result.patch).toMatchObject({
      apn: '042-123.00-000', county: 'Williamson', state: 'TN', owner: 'LANDSOUTH LLC', acres: 75.9, verified: true,
    });
    expect(result.source).toMatchObject({ url: ASSESSOR, officiality: 'official' });
  });

  it('prefers the government record and never opens an aggregator', async () => {
    const { dealCardId } = seedSparseLead();
    const { search } = stubSearch([
      { title: 'Map 042 Parcel 123 — Zillow', url: AGGREGATOR, snippet: 'Map 042 Parcel 123 Fairview TN' },
      { title: 'County Property Assessor', url: ASSESSOR, snippet: 'Parcel 042-123.00-000' },
    ]);
    const { fetchText, opened } = stubPages({ [ASSESSOR]: assessorPage() });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);

    expect(opened.some((url) => url.includes('zillow'))).toBe(false);
    expect(opened).toContain(ASSESSOR);
    expect(result.status).toBe('evidence');
  });

  it('opens the result that names this parcel before an unrelated government page', async () => {
    const { dealCardId } = seedSparseLead();
    const unrelated = 'https://assessment.example.gov/TPAD/Parcel/Details?parcelId=053049++++07200';
    const { search } = stubSearch([
      { title: 'Some other parcel record', url: unrelated, snippet: 'Parcel 053-049' },
      { title: 'Assessor record', url: ASSESSOR, snippet: 'Map 042 Parcel 123 · 042-123.00-000' },
    ]);
    const { fetchText, opened } = stubPages({ [ASSESSOR]: assessorPage(), [unrelated]: assessorPage({ 'Parcel ID': '053-049.00-000' }) });
    await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);
    expect(opened[0]).toBe(ASSESSOR);
  });

  it('recognises the lead\'s parcel in a result\'s own text', () => {
    const { dealCardId } = seedSparseLead();
    const subject = readResolverSubject(dealCardId)!;
    expect(mentionsSubjectParcel(subject, 'Map 042, Parcel 123 rezoning request')).toBe(true);
    expect(mentionsSubjectParcel(subject, 'Parcel 042-123.00-000 owner card')).toBe(true);
    expect(mentionsSubjectParcel(subject, 'Map 053 Parcel 049 site plan')).toBe(false);
  });

  it('keeps the government sources it saw as provenance for the next sprint', async () => {
    const { dealCardId } = seedSparseLead();
    const { search } = stubSearch([
      { title: 'City Planning Commission packet', url: MUNICIPAL_PDF.replace('.org', '.gov'), snippet: 'Map 042 Parcel 123 rezoning' },
    ]);
    const { fetchText } = stubPages({});
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);
    expect(result.status).toBe('no_evidence');
    expect(result.observedSources?.map((source) => source.url)).toContain(MUNICIPAL_PDF.replace('.org', '.gov'));
  });
});

// ── 5/6/7/8. What a search result may never do ─────────────────────────────

describe('a search result cannot verify itself', () => {
  it('refuses a government page about a different parcel', async () => {
    const { dealCardId } = seedSparseLead();
    const { search } = stubSearch([{ title: 'Assessor', url: ASSESSOR, snippet: 'parcel record' }]);
    const { fetchText } = stubPages({ [ASSESSOR]: assessorPage({ 'Parcel ID': '042-999.00-000' }) });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);
    expect(result.status).toBe('no_evidence');
    expect(result.patch).toBeUndefined();
  });

  it('refuses a matching parcel number in the wrong state', async () => {
    const { dealCardId } = seedSparseLead();
    const { search } = stubSearch([{ title: 'Assessor', url: ASSESSOR, snippet: 'parcel record' }]);
    const { fetchText } = stubPages({ [ASSESSOR]: assessorPage({ State: 'GA', County: 'Fayette' }) });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);
    expect(result.status).toBe('no_evidence');
  });

  it('refuses a matching parcel number in a county the card already established', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123', sellerNotes: 'Map 042 Parcel 123\nCocke County, Tennessee' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', county: 'Cocke', state: 'TN',
      summary: 'Map 042 Parcel 123\nCocke County, Tennessee', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);

    const { search } = stubSearch([{ title: 'Assessor', url: ASSESSOR, snippet: 'parcel record' }]);
    const { fetchText } = stubPages({ [ASSESSOR]: assessorPage() });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(deal.id)!);
    expect(result.status).toBe('no_evidence');
    expect(getPropertyCardRow(card.id)!.county).toBe('Cocke');
  });

  it('does not claim verification from a non-government host', async () => {
    const { dealCardId } = seedSparseLead();
    const vendor = 'https://qpublic.schneidercorp.com/Application.aspx?parcel=042-123.00-000';
    const { search } = stubSearch([{ title: 'Property record card', url: vendor, snippet: 'Map 042 Parcel 123' }]);
    const { fetchText } = stubPages({ [vendor]: assessorPage() });
    const result = await buildIndexedWebIdentityLane({ search, fetchText })(readResolverSubject(dealCardId)!);
    // The vendor host is government-LINKED at best, so its facts contribute but
    // it may never mark the parcel verified on its own.
    if (result.status === 'evidence') {
      expect(result.patch?.verified).toBe(false);
      expect(result.patch?.verificationSource).toBeNull();
    } else {
      expect(result.status).toBe('no_evidence');
    }
  });
});

// ── 9. The live-shaped release behaviour ───────────────────────────────────

describe('a search-resolved subject releases the resolver', () => {
  it('releases on the indexed-web lane while LandPortal is still running', async () => {
    const { dealCardId, cardId } = seedSparseLead();
    const { search } = stubSearch([{ title: 'County Property Assessor', url: ASSESSOR, snippet: 'Parcel 042-123.00-000' }]);
    const { fetchText } = stubPages({ [ASSESSOR]: assessorPage() });

    const result = await resolveSubjectProperty(dealCardId, {
      lanes: { landportal: neverSettles, official_parcel: neverSettles },
      indexedWeb: { search, fetchText },
      promote: promoteOffline,
    });

    expect(result.winner).toBe('indexed_web');
    expect(result.released).toBe(true);
    expect(result.pendingLanes.sort()).toEqual(['landportal', 'official_parcel']);
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042-123.00-000');
    expect(card.county).toBe('Williamson');
    expect(card.verification_status).toBe('verified_property');
  });
});
