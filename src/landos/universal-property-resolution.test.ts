// UNIVERSAL PROPERTY RESOLUTION — first sufficient evidence wins.
//
// The behaviour under test is the one line this sprint removed:
//
//     const [capture, live] = await Promise.all([captureWait, publicWait]);
//
// Every "does not wait" test below proves the same thing a different way: a lane
// that never settles at all must not delay a subject another lane has already
// established.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { primaryParcelNotation } from './parcel-notation.js';
import {
  applyLaneEvidence,
  buildIdentityDiscoveryQueries,
  buildIndexedWebIdentityLane,
  evaluateResolverIdentity,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
  type ResolverSubject,
} from './universal-property-resolution.js';
import type { GovFetchText } from './gis-transport.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

interface SeedInput {
  address: string;
  summary?: string;
  city?: string;
  county?: string;
  state?: string;
  apn?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
  verificationSource?: string;
}

function seed(input: SeedInput): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: input.address, sellerNotes: input.summary ?? input.address });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: input.address,
    summary: input.summary ?? input.address,
    ...(input.city ? { city: input.city } : {}),
    ...(input.county ? { county: input.county } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.apn ? { apn: input.apn } : {}),
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.acres == null ? {} : { acres: input.acres }),
    ...(input.verified ? { verified: true, verificationSource: input.verificationSource ?? 'Official county parcel record' } : {}),
    agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

/** Promotion through the real canonical path, with the network geocoder off. */
const promoteOffline = (dealCardId: number, actor: string) =>
  reconcileSubjectIdentity(dealCardId, { actor, censusGeography: null });

/** A lane that never settles. Nothing may ever wait on it. */
const neverSettles = (): Promise<IdentityLaneResult> => new Promise(() => {});

function laneEvidence(lane: IdentityLaneResult['lane'], patch: IdentityLaneResult['patch']): IdentityLaneResult {
  return { lane, status: 'evidence', note: `${lane} evidence`, patch };
}

const WILLIAMSON_PATCH = {
  apn: '042-123.00-000',
  county: 'Williamson',
  state: 'TN',
  city: 'Fairview',
  owner: 'LANDSOUTH LLC',
  acres: 75.9,
  verified: true,
  verificationSource: 'Indexed official parcel record — County Property Assessor',
};

beforeEach(() => { _initTestLandosDb(); });

// ── 3. Sparse identifier + location enters the resolver ─────────────────────

describe('sparse raw evidence reaches the resolver', () => {
  it('carries a parcel notation with no conventional APN into the subject', () => {
    const { dealCardId } = seed({
      address: 'Map 042 Parcel 123',
      summary: 'Map 042 Parcel 123\nFairview, Tennessee',
      city: 'Fairview',
      state: 'TN',
    });
    const subject = readResolverSubject(dealCardId)!;
    expect(subject.apn).toBeNull();
    expect(subject.notations.map((notation) => notation.raw)).toEqual(['Map 042 Parcel 123']);

    const queries = buildIdentityDiscoveryQueries(subject);
    expect(queries[0]).toContain('"Map 042" "Parcel 123"');
    expect(queries[0]).toContain('Fairview');
    expect(queries[0]).toContain('TN');
    // The lane searches the RAW evidence, not an exact street address.
    expect(queries.join(' ')).not.toContain('Unresolved');
  });
});

// ── 4. A confirmed retained identity returns immediately ────────────────────

describe('retained identity fast path', () => {
  it('returns at once and never waits on a running lane', async () => {
    const { dealCardId } = seed({
      address: '5170 HIGHWAY 60',
      county: 'Hamilton',
      state: 'TN',
      apn: '023 003.02',
      owner: 'CAMERON NATHANIEL JOSEPH',
      acres: 40.5,
      verified: true,
    });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: { official_parcel: neverSettles, landportal: neverSettles },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('retained_identity');
    expect(result.released).toBe(true);
    expect(result.releasedEarly).toBe(true);
    expect(result.identityState).toBe('confirmed');
    expect(result.pendingLanes.sort()).toEqual(['landportal', 'official_parcel']);
  });
});

// ── 5/6/7. Whichever lane is sufficient FIRST wins ──────────────────────────

describe('first sufficient evidence wins', () => {
  it('lets a fast official parcel source win without waiting for LandPortal', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        official_parcel: async () => laneEvidence('official_parcel', WILLIAMSON_PATCH),
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('official_parcel');
    expect(result.released).toBe(true);
    expect(result.pendingLanes).toEqual(['landportal']);
    expect(getPropertyCardRow(cardId)!.apn).toBe('042-123.00-000');
  });

  it('lets a fast indexed-web government record win without waiting for LandPortal', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        official_parcel: neverSettles,
        indexed_web: async () => laneEvidence('indexed_web', WILLIAMSON_PATCH),
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('indexed_web');
    expect(result.released).toBe(true);
    expect(result.pendingLanes.sort()).toEqual(['landportal', 'official_parcel']);
    expect(getPropertyCardRow(cardId)!.county).toBe('Williamson');
  });

  it('lets LandPortal win when it is the lane that resolves first', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        official_parcel: neverSettles,
        indexed_web: neverSettles,
        landportal: async () => laneEvidence('landportal', WILLIAMSON_PATCH),
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('landportal');
    expect(result.released).toBe(true);
    expect(getPropertyCardRow(cardId)!.apn).toBe('042-123.00-000');
  });

  it('reports unresolved honestly when every lane answers and none is sufficient', async () => {
    const { dealCardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        official_parcel: async () => ({ lane: 'official_parcel', status: 'no_evidence', note: 'no official adapter matched' }),
        indexed_web: async () => ({ lane: 'indexed_web', status: 'no_evidence', note: 'no indexed record matched' }),
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBeNull();
    expect(result.released).toBe(false);
    expect(result.status).toBe('unresolved');
  });
});

// ── 8/9/10. A fast weak result never beats stronger conflicting evidence ────

describe('conflict protection', () => {
  it('refuses a lane that returns a different parcel identifier', async () => {
    const { dealCardId, cardId } = seed({
      address: 'TALLEY RD', county: 'Cocke', state: 'TN', apn: '015 027 04512 000 2026',
      verified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
    });
    const result = await resolveSubjectProperty(dealCardId, {
      retainedFastPath: false,
      lanes: { indexed_web: async () => laneEvidence('indexed_web', { apn: '015 027 09999 000 2026', county: 'Cocke', state: 'TN' }) },
      promote: promoteOffline,
    });
    expect(getPropertyCardRow(cardId)!.apn).toBe('015 027 04512 000 2026');
    expect(result.conflicts.join(' ')).toMatch(/Parcel identifier conflict/i);
    expect(result.lanes[0].applied).toBe(false);
  });

  it('refuses a lane that places the parcel in another county or state', async () => {
    const { dealCardId, cardId } = seed({ address: 'TALLEY RD', county: 'Cocke', state: 'TN' });
    const county = await resolveSubjectProperty(dealCardId, {
      retainedFastPath: false,
      lanes: { indexed_web: async () => laneEvidence('indexed_web', { apn: '015 027 04512', county: 'Sevier', state: 'TN' }) },
      promote: promoteOffline,
    });
    expect(county.conflicts.join(' ')).toMatch(/County conflict/i);
    expect(getPropertyCardRow(cardId)!.county).toBe('Cocke');
    expect(getPropertyCardRow(cardId)!.apn).toBe('');

    const state = await resolveSubjectProperty(dealCardId, {
      retainedFastPath: false,
      lanes: { indexed_web: async () => laneEvidence('indexed_web', { apn: '015 027 04512', county: 'Cocke', state: 'GA' }) },
      promote: promoteOffline,
    });
    expect(state.conflicts.join(' ')).toMatch(/State conflict/i);
    expect(getPropertyCardRow(cardId)!.state).toBe('TN');
  });

  it('keeps an APN conflict already on the card blocked rather than resolving it', () => {
    const { dealCardId } = seed({ address: 'TALLEY RD', county: 'Cocke', state: 'TN', apn: '015 027 04512 000 2026' });
    const subject = readResolverSubject(dealCardId)!;
    const refused = applyLaneEvidence(subject, { apn: '444 111 22222', county: 'Cocke', state: 'TN' }, 'indexed_web');
    expect(refused.applied).toBe(false);
    expect(refused.refusedFor.join(' ')).toContain('015 027 04512 000 2026');
    expect(refused.refusedFor.join(' ')).toContain('444 111 22222');
  });
});

// ── 11. Late evidence reconciles, never downgrades or contaminates ──────────

describe('late lane evidence', () => {
  it('enriches the same property and never overwrites the accepted parcel', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    let releaseLate!: (value: IdentityLaneResult) => void;
    const late = new Promise<IdentityLaneResult>((resolve) => { releaseLate = resolve; });

    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        official_parcel: async () => laneEvidence('official_parcel', { ...WILLIAMSON_PATCH, owner: null, acres: null }),
        landportal: () => late,
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('official_parcel');
    expect(getPropertyCardRow(cardId)!.owner).toBe('');

    // The slower lane lands afterwards: corroborating facts are added...
    releaseLate(laneEvidence('landportal', { apn: '042 123.00 000', owner: 'LANDSOUTH LLC', acres: 75.9 }));
    await late;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const enriched = getPropertyCardRow(cardId)!;
    expect(enriched.owner).toBe('LANDSOUTH LLC');
    expect(enriched.acres).toBe(75.9);
    // ...and the accepted parcel identifier is untouched by the enrichment.
    expect(enriched.apn).toBe('042-123.00-000');
  });

  it('refuses late evidence that names a different property', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    let releaseLate!: (value: IdentityLaneResult) => void;
    const late = new Promise<IdentityLaneResult>((resolve) => { releaseLate = resolve; });
    await resolveSubjectProperty(dealCardId, {
      lanes: {
        official_parcel: async () => laneEvidence('official_parcel', WILLIAMSON_PATCH),
        landportal: () => late,
      },
      promote: promoteOffline,
    });
    releaseLate(laneEvidence('landportal', { apn: '099-777.00-000', county: 'Davidson', state: 'TN', owner: 'SOMEONE ELSE' }));
    await late;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042-123.00-000');
    expect(card.county).toBe('Williamson');
    expect(card.owner).toBe('LANDSOUTH LLC');
  });
});

// ── The indexed-web identity lane, on a stubbed text transport ──────────────

const ASSESSOR_URL = 'https://propertyassessor.example-county.gov/parcel?pid=042-123.00-000';

function assessorPage(overrides: Record<string, string> = {}): string {
  const rows: Record<string, string> = {
    'Parcel ID': '042-123.00-000',
    'Owner Name': 'LANDSOUTH LLC',
    County: 'Williamson',
    State: 'TN',
    City: 'Fairview',
    'Location Address': 'KINGWOOD BLVD',
    'Deeded Acres': '75.90',
    ...overrides,
  };
  return `<html><body><h1>Property Assessor — Parcel Record</h1><table>${
    Object.entries(rows).map(([label, value]) => `<th>${label}</th><td>${value}</td>`).join('')
  }</table></body></html>`;
}

function stubTransport(pages: Record<string, string>): { fetchText: GovFetchText; requested: string[] } {
  const requested: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    requested.push(url);
    const body = Object.entries(pages).find(([key]) => url.startsWith(key))?.[1];
    return {
      status: body ? 200 : 404,
      body: body ?? '<html><body>not found</body></html>',
      url,
      contentType: 'text/html',
      blocked: false,
      via: 'server_fetch',
    };
  };
  return { fetchText, requested };
}

function subjectFor(dealCardId: number): ResolverSubject {
  return readResolverSubject(dealCardId)!;
}

describe('indexed-web identity lane', () => {
  it('searches the RAW notation and reads identity out of an indexed government record', async () => {
    const { dealCardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const { fetchText, requested } = stubTransport({
      'https://html.duckduckgo.com/html/': `<html><body><a href="${ASSESSOR_URL}">Williamson County Property Assessor — Parcel 042-123.00-000</a></body></html>`,
      [ASSESSOR_URL]: assessorPage(),
    });
    const lane = buildIndexedWebIdentityLane({ fetchText });
    const result = await lane(subjectFor(dealCardId));

    expect(decodeURIComponent(requested[0])).toContain('"Map 042" "Parcel 123"');
    expect(result.status).toBe('evidence');
    expect(result.patch).toMatchObject({
      apn: '042-123.00-000',
      county: 'Williamson',
      state: 'TN',
      owner: 'LANDSOUTH LLC',
      acres: 75.9,
      verified: true,
    });
    expect(result.source?.officiality).toBe('official');
  });

  it('refuses a government page about a different parcel', async () => {
    const { dealCardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const { fetchText } = stubTransport({
      'https://html.duckduckgo.com/html/': `<html><body><a href="${ASSESSOR_URL}">Assessor</a></body></html>`,
      [ASSESSOR_URL]: assessorPage({ 'Parcel ID': '042-999.00-000' }),
    });
    const result = await buildIndexedWebIdentityLane({ fetchText })(subjectFor(dealCardId));
    expect(result.status).toBe('no_evidence');
    expect(result.patch).toBeUndefined();
  });

  it('never lets an aggregator establish parcel identity', async () => {
    const { dealCardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const { fetchText, requested } = stubTransport({
      'https://html.duckduckgo.com/html/': '<html><body><a href="https://www.zillow.com/homedetails/42-123">Map 042 Parcel 123 — Zillow</a></body></html>',
    });
    const result = await buildIndexedWebIdentityLane({ fetchText })(subjectFor(dealCardId));
    expect(result.status).toBe('no_evidence');
    expect(requested.some((url) => url.includes('zillow'))).toBe(false);
  });
});

// ── The shared property is still ONE property ───────────────────────────────

describe('one shared canonical property', () => {
  it('promotes through the existing canonical path and leaves one versioned identity', async () => {
    const { dealCardId, cardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    await resolveSubjectProperty(dealCardId, {
      lanes: { official_parcel: async () => laneEvidence('official_parcel', WILLIAMSON_PATCH) },
      promote: promoteOffline,
    });
    const db = getLandosDb();
    const versions = db.prepare('SELECT status, apn, county, state, is_current FROM landos_property_identity_version WHERE deal_card_id = ?').all(dealCardId) as Array<Record<string, unknown>>;
    expect(versions.filter((row) => row.is_current === 1)).toHaveLength(1);
    expect(versions[0]).toMatchObject({ apn: '042-123.00-000', county: 'Williamson', state: 'TN' });
    // No second identity model: the card every research lane reads carries it.
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042-123.00-000');
    expect(evaluateResolverIdentity(readResolverSubject(dealCardId)!).sufficient).toBe(true);
  });

  it('hands the next sprint a resolved subject it does not have to re-derive', async () => {
    const { dealCardId } = seed({ address: 'Map 042 Parcel 123', summary: 'Map 042 Parcel 123\nFairview, Tennessee', city: 'Fairview', state: 'TN' });
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: { indexed_web: async () => ({ ...laneEvidence('indexed_web', WILLIAMSON_PATCH), source: { label: 'County Property Assessor', url: ASSESSOR_URL, officiality: 'official' as const } }) },
      promote: promoteOffline,
    });
    expect(result.subject).toMatchObject({
      dealCardId,
      apn: '042-123.00-000',
      owner: 'LANDSOUTH LLC',
      county: 'Williamson',
      state: 'TN',
      city: 'Fairview',
    });
    expect(result.subject.parcelNotations[0].raw).toBe('Map 042 Parcel 123');
    expect(result.subject.sourceEvidence[0]).toMatchObject({ lane: 'indexed_web', url: ASSESSOR_URL, officiality: 'official' });
  });
});

describe('notation matching is available to the resolver', () => {
  it('recognises the county representation of the lead\'s own notation', () => {
    expect(primaryParcelNotation('Map 042 Parcel 123')!.groups).toEqual(['042', '123']);
  });
});
