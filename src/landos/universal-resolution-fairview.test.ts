// PERMANENT SPARSE-INPUT REGRESSION FIXTURE — Fairview, Tennessee.
//
// A real seller lead arrived as two lines and nothing else:
//
//     Map 042 Parcel 123
//     Fairview, Tennessee
//
// No street address. No normalized APN. No county. LandOS read no parcel
// identifier out of it at all, so the required `parcel_identity` lane could not
// establish a subject and every downstream research lane was skipped.
//
// Everything else known about this property — the owner entity, the road, the
// acreage, the county, the county's own parcel representation — is a DISCOVERY.
// None of it may appear in the input, and `FAIRVIEW_SPARSE_INPUT` is asserted
// below to contain none of it. A future change that only passes because a clue
// leaked into the input is a change that has not fixed anything.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// PRE-EXISTING BLOCKER, NOT PART OF THIS SPRINT.
//
// `src/landos/comps.ts` at this branch's HEAD imports
// `./comp-location-reconciliation.js`, which was never committed — it exists
// only as untracked work in the other worktree. Every test that transitively
// loads `comps.ts` therefore fails to resolve, including the existing
// `landportal-comp-lane` and `landportal-subject-handoff` suites, with or
// without this sprint's changes. The retained-comp work is explicitly out of
// scope here, so this factory keeps the identity path loadable without touching
// it. The identity lane reads no comparable rows.
vi.mock('./comps.js', () => ({
  listComps: () => [],
  addComp: () => ({}),
  getComp: () => undefined,
  deleteComp: () => false,
  upsertNormalizedComp: () => ({}),
  retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [],
  geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null,
  recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }),
  isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined,
  PAID_COMP_TOOLS: [],
}));

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';
import { collectParcelIdentity } from './property-intelligence-live.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { readResolverSubject } from './universal-property-resolution.js';
import type { GovFetchText } from './gis-transport.js';
import type { MissionContext } from './property-intelligence-collector-types.js';

/** THE INPUT. Two lines, exactly as the lead arrived. */
export const FAIRVIEW_SPARSE_INPUT = 'Map 042 Parcel 123\nFairview, Tennessee';

/** Facts that are DISCOVERIES and must never be inputs. */
const DISCOVERIES_NOT_INPUTS = [
  'Julie Berg',
  'Landsouth',
  'Kingwood',
  '75.9',
  'Williamson',
  '042-123.00-000',
  'transcript',
];

const ASSESSOR_URL = 'https://propertyassessor.williamsontn.gov/parcel?pid=042-123.00-000';
const SEARCH_HOST = 'https://html.duckduckgo.com/html/';

/** The indexed government parcel record, as such a page prints itself. */
const ASSESSOR_PAGE = `<html><head><title>Property Assessor — Parcel Record</title></head><body>
  <h1>Property Assessor</h1>
  <table>
    <tr><th>Parcel ID</th><td>042-123.00-000</td></tr>
    <tr><th>Owner Name</th><td>LANDSOUTH LLC</td></tr>
    <tr><th>Location Address</th><td>KINGWOOD BLVD</td></tr>
    <tr><th>City</th><td>FAIRVIEW</td></tr>
    <tr><th>County</th><td>Williamson</td></tr>
    <tr><th>State</th><td>TN</td></tr>
    <tr><th>Deeded Acres</th><td>75.90</td></tr>
  </table>
</body></html>`;

const SEARCH_RESULTS = `<html><body>
  <a href="https://www.zillow.com/homedetails/42-123">Map 042 Parcel 123 — Zillow</a>
  <a href="${ASSESSOR_URL}">Property Assessor — Parcel 042-123.00-000, Kingwood Blvd</a>
</body></html>`;

function transport(): { fetchText: GovFetchText; requested: string[] } {
  const requested: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    requested.push(url);
    const body = url.startsWith(SEARCH_HOST) ? SEARCH_RESULTS
      : url.startsWith(ASSESSOR_URL) ? ASSESSOR_PAGE
      : '<html><body>not found</body></html>';
    return { status: 200, body, url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
  };
  return { fetchText, requested };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create the Deal Card exactly as `POST /api/landos/leads/manual` does from the
 * sparse paste: parsed intake fields only, raw input preserved verbatim.
 */
function createLeadFromSparseInput(): { dealCardId: number; cardId: number } {
  const parsed = parseConversationalLeadIntake(FAIRVIEW_SPARSE_INPUT);
  const deal = createDealCard({
    entity: 'TY_LAND_BIZ',
    title: parsed.propertyLabel,
    sellerNotes: parsed.rawInput,
  });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: parsed.propertyLabel,
    ...(parsed.city ? { city: parsed.city } : {}),
    ...(parsed.county ? { county: parsed.county } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.apn ? { apn: parsed.apn } : {}),
    ...(parsed.acreage ? { acres: parsed.acreage } : {}),
    verified: false,
    summary: parsed.rawInput,
    agentId: 'acquisitions-agent',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

function context(dealCardId: number): MissionContext {
  return { dealCardId, runId: 'pi_fairview_sparse', identity: null, comparables: null };
}

beforeEach(() => { _initTestLandosDb(); });

describe('Fairview sparse-input regression fixture', () => {
  it('uses ONLY the parcel notation and the town — every other fact is a discovery', () => {
    expect(FAIRVIEW_SPARSE_INPUT).toBe('Map 042 Parcel 123\nFairview, Tennessee');
    for (const discovery of DISCOVERIES_NOT_INPUTS) {
      expect(FAIRVIEW_SPARSE_INPUT.toLowerCase()).not.toContain(discovery.toLowerCase());
    }
  });

  it('reaches the resolver as identity evidence, with no conventional APN', () => {
    const { dealCardId } = createLeadFromSparseInput();
    const subject = readResolverSubject(dealCardId)!;
    expect(subject.apn).toBeNull();
    expect(subject.county).toBeNull();
    expect(subject.notations[0].raw).toBe('Map 042 Parcel 123');
    expect(subject.rawIntake).toBe(FAIRVIEW_SPARSE_INPUT);
  });

  it('resolves the subject from an indexed government record and releases the graph', async () => {
    const { dealCardId, cardId } = createLeadFromSparseInput();
    const { fetchText, requested } = transport();
    let captureFinished = false;
    let publicFinished = false;

    const outcome = await collectParcelIdentity(context(dealCardId), {
      // Both slow lanes are real and running; neither is allowed to hold the
      // subject up once the indexed record has established it.
      landPortalCaptureWaitMs: 60_000,
      publicRefreshWaitMs: 60_000,
      captureLandPortalInspection: async () => {
        await sleep(250);
        captureFinished = true;
        return { ok: false, note: 'no LandPortal parcel matched this lead', comparableCount: 0 };
      },
      runPublicIntelligence: async () => {
        await sleep(250);
        publicFinished = true;
        return { ok: false, error: 'no tested official parcel adapter for an unknown county' };
      },
      indexedWebIdentity: { fetchText, maxQueries: 2, maxPages: 2, timeoutMs: 5_000 },
      // The real canonical promotion, with the federal geocoder left out of the
      // test rather than stubbed differently.
      promoteSubjectIdentity: (id, actor) => reconcileSubjectIdentity(id, { actor, censusGeography: null }),
    });

    // FIRST SUFFICIENT WINS: the identity lane answered while both other lanes
    // were still working. Under the old `Promise.all` join it could not have.
    expect(captureFinished).toBe(false);
    expect(publicFinished).toBe(false);

    // The search actually asked the operator's own question.
    expect(decodeURIComponent(requested[0])).toContain('"Map 042" "Parcel 123"');
    expect(decodeURIComponent(requested[0])).toContain('Fairview');

    // ONE shared canonical property now carries the discovered identity.
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042-123.00-000');
    expect(card.county).toBe('Williamson');
    expect(card.state).toBe('TN');
    expect(card.owner).toBe('LANDSOUTH LLC');
    expect(card.acres).toBe(75.9);
    expect(card.verification_status).toBe('verified_property');
    // The operator's own words are preserved; the lead is not renamed by research.
    expect(card.active_input_address).toBe('Map 042 Parcel 123');
    expect(card.summary).toBe(FAIRVIEW_SPARSE_INPUT);

    // The mission's required identity lane CONTRIBUTES, so the existing
    // downstream fanout runs on this subject unchanged.
    expect(outcome.status).toBe('completed');
    expect(outcome.data?.identity.apn).toBe('042-123.00-000');
    expect(outcome.data?.identity.county).toBe('Williamson');
    expect(outcome.data?.subjectMarket).toMatchObject({ county: 'Williamson', state: 'TN' });

    // One current versioned identity, through the existing canonical path.
    const versions = getLandosDb()
      .prepare('SELECT apn, county, state, is_current FROM landos_property_identity_version WHERE deal_card_id = ? AND is_current = 1')
      .all(dealCardId) as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ apn: '042-123.00-000', county: 'Williamson', state: 'TN' });

    // The slower lanes finish afterwards and reconcile into the same property.
    await sleep(400);
    expect(captureFinished).toBe(true);
    expect(publicFinished).toBe(true);
    expect(getPropertyCardRow(cardId)!.apn).toBe('042-123.00-000');
  });

  // LIVE REGRESSION. The one bounded re-aim fires with the resolved identity,
  // and it must NOT carry the operator's parcel notation in the address slot.
  // Measured live: forwarded as an address, "Map 042 Parcel 123" became a road
  // cross-check against the real situs on LandPortal's own record for this
  // parcel ("KINGWOOD BLVD"), which blocked the correct parcel, and it spent a
  // third search attempt that cannot match. The notation still reaches
  // LandPortal as the identifier it is, through the APN and owner keys.
  it('re-aims LandPortal once with the resolved identity and never as a street address', async () => {
    const { dealCardId } = createLeadFromSparseInput();
    const { fetchText } = transport();
    const searchKeys: Array<Record<string, unknown>> = [];

    await collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 60_000,
      publicRefreshWaitMs: 60_000,
      captureLandPortalInspection: async ({ searchKey }) => {
        searchKeys.push({ ...searchKey });
        await sleep(250);
        return { ok: false, note: 'no LandPortal parcel matched this lead', comparableCount: 0 };
      },
      runPublicIntelligence: async () => { await sleep(250); return { ok: false, error: 'no adapter' }; },
      indexedWebIdentity: { fetchText, maxQueries: 2, maxPages: 2, timeoutMs: 5_000 },
      promoteSubjectIdentity: (id, actor) => reconcileSubjectIdentity(id, { actor, censusGeography: null }),
    });
    // The upgrade is deliberately fire-and-forget; it runs once the first
    // capture settles.
    await sleep(600);

    // The weak first attempt started on the raw lead, as it always has.
    expect(searchKeys[0]).toMatchObject({ address: 'Map 042 Parcel 123', apn: null, county: null });
    // Exactly ONE re-aim, carrying what the resolver established.
    expect(searchKeys).toHaveLength(2);
    expect(searchKeys[1]).toMatchObject({
      apn: '042-123.00-000',
      county: 'Williamson',
      state: 'TN',
      owner: 'LANDSOUTH LLC',
    });
    // The parcel notation is not offered as a street address.
    expect(searchKeys[1].address).toBeNull();
  });

  it('does not resolve when the indexed record names a different parcel', async () => {
    const { dealCardId, cardId } = createLeadFromSparseInput();
    const fetchText: GovFetchText = async (url) => ({
      status: 200,
      body: url.startsWith(SEARCH_HOST) ? SEARCH_RESULTS : ASSESSOR_PAGE.replace('042-123.00-000', '042-999.00-000'),
      url,
      contentType: 'text/html',
      blocked: false,
      via: 'server_fetch',
    });
    const outcome = await collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 50,
      publicRefreshWaitMs: 50,
      runPublicIntelligence: async () => ({ ok: false, error: 'no adapter' }),
      indexedWebIdentity: { fetchText, maxQueries: 1, maxPages: 1, timeoutMs: 5_000 },
      promoteSubjectIdentity: (id, actor) => reconcileSubjectIdentity(id, { actor, censusGeography: null }),
    });
    // A neighbouring parcel is not this parcel. Nothing is written and the lane
    // says so rather than resolving the wrong property.
    expect(getPropertyCardRow(cardId)!.apn).toBe('');
    expect(outcome.status).not.toBe('completed');
  });
});
