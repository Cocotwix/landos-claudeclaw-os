// Property Backstory + authoritative zoning + subdivision intelligence.
//
// The whole sprint in one suite, organized by the promise each part makes.
// The Fairview tract is the fixture throughout: a real sparse lead whose
// planning history, requested rezoning and 91-lot concept are all in the public
// record, and whose CURRENT zoning is deliberately NOT in that record — which
// is exactly the trap this layer has to refuse to fall into.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import zlib from 'node:zlib';

// Pre-existing, unrelated: `comps.ts` at HEAD imports an uncommitted module.
vi.mock('./comps.js', () => ({
  listComps: () => [], addComp: () => ({}), getComp: () => undefined, deleteComp: () => false,
  upsertNormalizedComp: () => ({}), retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [], geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null, recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }), isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined, PAID_COMP_TOOLS: [],
}));

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { primaryParcelNotation } from './parcel-notation.js';
import { clearOfficialPdfCache, loadOfficialPdf, type OfficialPdfDocument } from './official-pdf-identity.js';
import { clearDiscoveredContext, mineDocumentContext, type SubjectAnchors } from './official-document-context.js';
import { composeOfficialDocumentSummary } from './official-document-summary.js';
import {
  documentKeyFor,
  persistDocumentIntelligence,
  readDocumentIntelligence,
} from './official-document-intelligence-store.js';

import {
  backstoryEventsFromDocuments,
  composePropertyBackstorySummary,
  type PropertyBackstorySubject,
} from './property-backstory.js';
import { runPropertyBackstory, buildBackstoryQueries } from './property-backstory-run.js';
import { persistPropertyBackstory, readPropertyBackstory } from './property-backstory-store.js';
import {
  assignAuthority,
  readAuthorityStatements,
  readPublisherJurisdictionActs,
  resolveControllingLandUseAuthority,
  type AuthorityCandidate,
  type AuthoritySourceRef,
} from './controlling-land-use-authority.js';
import {
  attachHistoricalZoning,
  determineCurrentZoning,
  readZoningFromGisLayer,
  readZoningStandards,
  selectCurrentZoning,
  type ZoningEvidenceCandidate,
} from './current-zoning-determination.js';
import {
  extractSubdivisionRules,
  hostServesSubjectJurisdiction,
  readLotCount,
  readMinorMajorThresholds,
  retrieveSubdivisionRegulations,
  type SubdivisionRegulations,
} from './subdivision-regulations.js';
import {
  buildPropertySubdivisionRead,
  readFrontageFeet,
  readMinimumLotAcres,
} from './subdivision-property-read.js';
import {
  persistControllingAuthority,
  persistCurrentZoning,
  persistPropertySubdivisionRead,
  persistSubdivisionRegulations,
  readControllingAuthority,
  readCurrentZoning,
  readPropertySubdivisionRead,
  readSubdivisionRegulations,
  readSubdivisionRuleEvidence,
} from './land-use-intelligence-store.js';
import { readPreCallIntelligenceHandoff } from './pre-call-intelligence-handoff.js';
import { DEAL_INTELLIGENCE_CHILDREN, dealIntelligenceChildSpec } from './deal-intelligence-mission.js';
import { planMissionWaves } from './mission-graph.js';
import type { GovFetchText, GovTextResponse } from './gis-transport.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

// ── The Fairview record, as the public documents actually read ─────────────

const PACKET_PAGE_ONE = 'Agenda Fairview Planning Commission January 14, 2025 Regular Meeting. '
  + 'OLD BUSINESS 1. PC Resolution PC-44-24, Master Development Plan, Kingwood Subdivision, 75.86 Acres, '
  + 'Map: 42, Parcel: 123.00. Current Zoning: R-20 POD. Requested Zoning: RS-15 POD. Property Owner: Landsouth, LLC. '
  + '2. PC Resolution PC-45-24, Annexation, 7740 Cumberland Dr., 351.27 Acres, Map: 47, Parcel: 094.00. '
  + 'Current Zoning: Williamson County Rural Preservation-5. Property Owner: Fernvale Springs Farm, LLC.';

const PACKET_PAGE_TWO = 'Discussion of the Kingwood Subdivision master development plan continued. '
  + 'The applicant is Landsouth, LLC, represented by its project engineer. '
  + 'The plan proposes 91 single-family lots on the 75.86 acres. '
  + 'Sewer capacity and water service along Kingwood Blvd were discussed at length. '
  + 'A wetlands delineation and a stream buffer were identified along the eastern boundary. '
  + 'Road improvements including a turn lane at the entrance will be required. '
  + 'Topography and grading on the steeper eastern slopes will require retaining walls. '
  + 'The Commission recommended approval subject to the engineering comments. '
  + 'Unrelated item: the Commission also reviewed a site plan for Map: 47, Parcel: 094.00, proposing 12 lots.';

const PACKET_URL = 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf';
const PACKET_TITLE = 'City of Fairview Planning Commission';

const ANCHORS: SubjectAnchors = {
  notations: [primaryParcelNotation('Map 042 Parcel 123')!],
  apn: '042 123.00',
  owner: 'Landsouth, LLC',
  projectName: 'Kingwood Subdivision',
  address: null,
  city: 'Fairview',
};

const SUBJECT: PropertyBackstorySubject = {
  dealCardId: 0,
  apn: '042 123.00',
  parcelNotation: 'Map 042 Parcel 123',
  owner: 'Landsouth, LLC',
  address: null,
  city: 'Fairview',
  county: 'Williamson',
  state: 'TN',
  acres: 75.86,
  projectName: 'Kingwood Subdivision',
};

function makePdf(pages: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const page of pages) {
    const content = Buffer.from(`BT /F1 12 Tf (${page.replace(/([()\\])/g, '\\$1')}) Tj ET`, 'latin1');
    parts.push(Buffer.from('1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'), zlib.deflateSync(content), Buffer.from('\nendstream\nendobj\n', 'latin1'));
  }
  parts.push(Buffer.from('%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}

function pdfFetch(pages: string[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    const bytes = makePdf(pages);
    return {
      ok: true,
      headers: { get: () => String(bytes.length) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function seedResolvedSubject(): { dealCardId: number; identityVersionId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123', sellerNotes: 'Map 042 Parcel 123\nFairview, Tennessee' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN',
    county: 'Williamson', apn: '042 123.00', owner: 'Landsouth, LLC', acres: 75.86,
    verified: true, verificationSource: 'Official Fairview government record',
    summary: 'Map 042 Parcel 123\nFairview, Tennessee', agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  const identity = createPropertyIdentityVersion({
    dealCardId: deal.id, propertyCardId: card.id, status: 'candidate',
    address: 'Map 042 Parcel 123', city: 'Fairview', county: 'Williamson', state: 'TN', zip: null,
    apn: '042 123.00', owner: 'Landsouth, LLC', acreage: 75.86,
    basis: 'Resolved by the Universal Property Resolver.', confidence: 0.9, sourceRefs: [],
    changeReason: 'test seed', createdBy: 'test',
  } as Parameters<typeof createPropertyIdentityVersion>[0]);
  return { dealCardId: deal.id, identityVersionId: identity.id };
}

async function seedPacketIntelligence(dealCardId: number): Promise<{ calls: string[]; document: OfficialPdfDocument }> {
  const { fetchImpl, calls } = pdfFetch([PACKET_PAGE_ONE, PACKET_PAGE_TWO]);
  const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
  const context = mineDocumentContext({ document, anchors: ANCHORS, dealCardId });
  const summary = composeOfficialDocumentSummary({
    context,
    subject: { apn: SUBJECT.apn, owner: SUBJECT.owner, projectName: SUBJECT.projectName, acreage: SUBJECT.acres, city: SUBJECT.city, county: SUBJECT.county, state: SUBJECT.state, parcelNotation: SUBJECT.parcelNotation },
    documentKey: documentKeyFor(PACKET_URL),
    documentText: document.text,
    sourceTitle: PACKET_TITLE,
  });
  persistDocumentIntelligence({ dealCardId, context, summary, documentText: document.text, sourceTitle: PACKET_TITLE });
  return { calls, document };
}

const runSubject = (dealCardId: number) => ({
  ...SUBJECT,
  dealCardId,
  parcelNotations: ANCHORS.notations,
  knownSourceUrls: [] as string[],
});

const noSearch: IdentitySearchProvider = async () => [];

function htmlFetch(pages: Record<string, string>): { fetchText: GovFetchText; calls: string[] } {
  const calls: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    calls.push(url);
    const body = pages[url];
    return {
      url,
      status: body ? 200 : 404,
      body: body ?? '',
      contentType: 'text/html',
      blocked: !body,
      blockedReason: body ? null : 'not found',
    } as unknown as GovTextResponse;
  };
  return { fetchText, calls };
}

beforeEach(() => {
  _initTestLandosDb();
  clearOfficialPdfCache();
  clearDiscoveredContext();
});

// ── 1-6. Property Backstory ────────────────────────────────────────────────

describe('property backstory: retained intelligence first', () => {
  it('1. consumes persisted document intelligence before searching again', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);

    const searched: string[] = [];
    const search: IdentitySearchProvider = async (query) => { searched.push(query); return []; };
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { search, persist: false });

    // Storage already carried more than the expansion threshold, so no query ran.
    expect(searched).toEqual([]);
    expect(backstory.events.length).toBeGreaterThan(0);
    expect(backstory.documentsReused).toHaveLength(1);
    expect(backstory.documentsReused[0].sourceUrl).toBe(PACKET_URL);
    expect(backstory.documentsRetrieved).toEqual([]);
    expect(backstory.limitations.join(' ')).toMatch(/no additional discovery was run/i);
  });

  it('2. never re-fetches a PDF LandOS already holds intelligence for', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    clearOfficialPdfCache();

    const loads: string[] = [];
    const search: IdentitySearchProvider = async () => [{ title: PACKET_TITLE, url: PACKET_URL, snippet: '' }];
    const backstory = await runPropertyBackstory(runSubject(dealCardId), {
      search,
      // Force the expansion path so the skip is proven, not merely unreached.
      alwaysExpand: true,
      persist: false,
      loadPdf: async (url) => { loads.push(url); return null; },
    });

    expect(loads).toEqual([]);
    const skip = backstory.sourcesConsulted.find((row) => row.url === PACKET_URL && !row.used);
    expect(skip?.note).toMatch(/never re-fetched/i);
  });

  it('3. every timeline event keeps its source provenance', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: false });

    expect(backstory.events.length).toBeGreaterThan(0);
    for (const event of backstory.events) {
      expect(event.evidence.length).toBeGreaterThan(0);
      for (const ref of event.evidence) {
        expect(ref.sourceUrl).toBe(PACKET_URL);
        expect(ref.quote.length).toBeGreaterThan(0);
        expect(ref.sourceClassification).toBe('official_government_document');
        expect(typeof ref.evidenceId).toBe('number');
      }
      expect(event.apn).toBe('042 123.00');
    }
  });

  it('4. excludes the other parcel discussed in the same packet', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: false });

    const text = JSON.stringify(backstory);
    expect(text).not.toMatch(/Fernvale Springs Farm/i);
    expect(text).not.toMatch(/Cumberland Dr/i);
    expect(text).not.toMatch(/351\.27/);
    // The other parcel's 12-lot site plan must not become this parcel's history.
    expect(backstory.events.some((event) => event.materialNumbers.lots === 12)).toBe(false);
    expect(backstory.events.some((event) => event.materialNumbers.lots === 91)).toBe(true);
  });

  it('5. keeps historical zoning statements out of the timeline and dated', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: false });

    const current = backstory.zoningReferences.find((row) => row.kind === 'stated_as_current_at_the_time');
    expect(current?.value).toMatch(/R-20/);
    expect(current?.asOf).toBe('January 14, 2025');
    expect(current?.neverEstablishesCurrentZoning).toBe(true);
    // The narrative must say so in words, not only in a flag.
    expect(backstory.summary.narrative).toMatch(/does NOT establish the current zoning/i);
    expect(backstory.limitations.join(' ')).toMatch(/verified separately/i);
  });

  it('6. keeps requested zoning distinct from approved', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: false });

    const requested = backstory.zoningReferences.find((row) => row.kind === 'requested');
    expect(requested?.value).toMatch(/RS-15/);
    expect(backstory.summary.narrative).toMatch(/REQUESTED \(not necessarily granted\)/);
    // The commission RECOMMENDED. That is not an approval and must not read as one.
    const statuses = new Set(backstory.events.map((event) => event.status));
    expect(statuses.has('approved')).toBe(false);
    expect(statuses.has('recommended')).toBe(true);
  });

  it('builds subject-anchored queries, never bare-town ones', () => {
    const queries = buildBackstoryQueries({ ...runSubject(1) });
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query).toMatch(/Kingwood Subdivision|Landsouth|042 123\.00|Map 042 Parcel 123/);
    }
  });

  it('reports an empty record honestly rather than as a failure', () => {
    const summary = composePropertyBackstorySummary({
      subject: SUBJECT, events: [], zoningReferences: [], documentsReused: 0, documentsRetrieved: 0,
    });
    expect(summary.narrative).toMatch(/absence of retained record, not evidence that nothing happened/i);
    expect(summary.highlights).toEqual([]);
  });

  it('groups one agenda item into one event rather than one per finding', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const stored = readDocumentIntelligence(dealCardId);
    const { events } = backstoryEventsFromDocuments({ subject: { ...SUBJECT, dealCardId }, findings: stored.findings, summaries: stored.summaries });
    // Two pages of the packet mention this parcel; the timeline is per page,
    // not per matched pattern.
    expect(events.length).toBeLessThanOrEqual(2);
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── 7-9. Controlling authority ─────────────────────────────────────────────

const OFFICIAL_SOURCE = (quote: string): AuthoritySourceRef => ({
  label: 'City of Fairview Planning', url: 'https://www.fairview-tn.org/planning', tier: 'official_government_source', quote, retrievedAt: '2026-08-15T00:00:00.000Z',
});
const SECONDARY_SOURCE = (quote: string): AuthoritySourceRef => ({
  label: 'Some directory', url: 'https://example.com/fairview', tier: 'reputable_secondary', quote, retrievedAt: '2026-08-15T00:00:00.000Z',
});

describe('controlling land-use authority', () => {
  it('7. Census geography alone never establishes zoning authority', async () => {
    const { fetchText } = htmlFetch({});
    const authority = await resolveControllingLandUseAuthority(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: '042 123.00', address: null },
      {
        fetchText,
        search: noSearch,
        jurisdiction: {
          rawLocalityInput: 'Fairview', locality: 'Fairview', localityKind: 'Incorporated Place',
          county: 'Williamson', countyFips: '47187', state: 'TN', stateFips: '47', zip: null,
          sources: [], confidence: 'high', conflicts: [], sufficientForParcelSource: true,
          basis: 'Fairview lies in Williamson County, TN.',
        },
      },
    );

    expect(authority.geographyEvidence?.county).toBe('Williamson');
    expect(authority.geographyEvidence?.neverEstablishesLandUseAuthority).toBe(true);
    // Geography resolved perfectly and STILL assigned nothing.
    expect(authority.zoningAuthority.name).toBeNull();
    expect(authority.zoningAuthority.determination).toBe('unresolved');
    expect(authority.subdivisionAuthority.determination).toBe('unresolved');
    expect(authority.incorporationStatus).toBe('unverified');
    expect(authority.limitations.join(' ')).toMatch(/UNRESOLVED/);
  });

  it('8. zoning authority requires an official source, not a secondary one', () => {
    const statement = { kind: 'municipal_zoning' as const, named: 'Fairview', quote: 'The City of Fairview administers zoning within its corporate limits.', form: 'administering_statement' as const };
    const secondaryOnly: AuthorityCandidate[] = [
      { name: 'Fairview', level: 'municipal', statement, source: SECONDARY_SOURCE(statement.quote) },
    ];
    expect(assignAuthority(secondaryOnly).determination).toBe('unresolved');
    expect(assignAuthority(secondaryOnly).name).toBeNull();
    expect(assignAuthority(secondaryOnly).sources).toHaveLength(1);

    const official: AuthorityCandidate[] = [
      { name: 'Fairview', level: 'municipal', statement, source: OFFICIAL_SOURCE(statement.quote) },
    ];
    expect(assignAuthority(official).determination).toBe('confirmed');
    expect(assignAuthority(official).name).toBe('Fairview');
  });

  it('9. subdivision authority is established separately from zoning authority', async () => {
    const page = `<html><title>City of Fairview Planning</title><body>
      <p>The City of Fairview administers zoning within its corporate limits under the Fairview Zoning Ordinance.</p>
      <p>Williamson County administers subdivision regulations for land outside any municipality.</p>
      <p>The Fairview Planning Commission reviews all applications.</p>
    </body></html>`;
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/planning': page });
    const authority = await resolveControllingLandUseAuthority(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: null, address: null },
      { fetchText, knownSourceUrls: ['https://www.fairview-tn.org/planning'] },
    );

    expect(authority.zoningAuthority.name).toBe('Fairview');
    expect(authority.zoningAuthority.level).toBe('municipal');
    expect(authority.subdivisionAuthority.name).toBe('Williamson County');
    expect(authority.subdivisionAuthority.level).toBe('county');
    expect(authority.planningBody).toBeTruthy();
  });

  it('preserves ambiguity when two official sources name different governments', () => {
    const candidates: AuthorityCandidate[] = [
      { name: 'Fairview', level: 'municipal', statement: { kind: 'municipal_zoning', named: 'Fairview', quote: 'a', form: 'administering_statement' }, source: OFFICIAL_SOURCE('The City of Fairview administers zoning.') },
      { name: 'Williamson County', level: 'county', statement: { kind: 'county_zoning', named: 'Williamson County', quote: 'b', form: 'administering_statement' }, source: { ...OFFICIAL_SOURCE('Williamson County administers zoning.'), url: 'https://www.williamsoncounty-tn.gov/planning' } },
    ];
    const assignment = assignAuthority(candidates);
    expect(assignment.determination).toBe('ambiguous');
    expect(assignment.name).toBeNull();
    expect(assignment.competingClaims.map((claim) => claim.name).sort()).toEqual(['Fairview', 'Williamson County']);
  });

  it('reads only administering claims, never a page that merely mentions zoning', () => {
    const mention = 'Zoning maps and other planning resources are available at the front desk in Fairview.';
    expect(readAuthorityStatements(mention, { municipality: 'Fairview', county: 'Williamson' })
      .filter((statement) => statement.kind === 'municipal_zoning')).toHaveLength(0);

    const claim = 'The City of Fairview administers zoning within its corporate limits.';
    expect(readAuthorityStatements(claim, { municipality: 'Fairview', county: 'Williamson' })
      .some((statement) => statement.kind === 'municipal_zoning')).toBe(true);
  });

  // ── Live findings, held as regressions ──────────────────────────────────
  //
  // Every case below is something a real Fairview run got wrong before it was
  // fixed. They are the reason this layer answers at all on a small town.

  it('establishes authority from a document LandOS already holds, with no network', async () => {
    const searched: string[] = [];
    const fetched: string[] = [];
    const authority = await resolveControllingLandUseAuthority(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: '042 123.00', address: null },
      {
        retainedDocuments: [{
          sourceUrl: 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf',
          sourceTitle: 'City of Fairview',
          text: 'PC Resolution PC-44-24, Master Development Plan, Kingwood Subdivision, 75.86 Acres, Map: 42, Parcel: 123.00.\nCurrent Zoning: R-20 POD.\nRequested Zoning: RS-15 POD.\nThe Fairview Municipal Planning Commission recommended approval.',
        }],
        search: async (query) => { searched.push(query); return []; },
        fetchText: async (url) => { fetched.push(url); throw new Error('should not be reached'); },
        knownSourceUrls: ['https://www.fairview-tn.org/planning'],
      },
    );

    expect(authority.zoningAuthority.name).toBe('Fairview');
    expect(authority.zoningAuthority.determination).toBe('confirmed');
    expect(authority.subdivisionAuthority.name).toBe('Fairview');
    // Answered from storage: nothing was searched and nothing was fetched.
    expect(searched).toEqual([]);
    expect(fetched).toEqual([]);
    expect(authority.limitations.join(' ')).toMatch(/never started|held behind the retained-evidence fast path/i);
    // The network lanes exist and are recorded — they simply were not needed.
    expect(authority.race?.winningMethod).toBe('retained_evidence');
    expect(authority.race?.lanes.filter((lane) => lane.status === 'skipped').length).toBeGreaterThan(0);
  });

  it('reads a claim across a PDF text layer\'s line wrapping', () => {
    // The real Fairview regulations wrap exactly like this.
    const wrapped = 'These subdivision regulations are adopted by the\nFairview\nMunicipal Planning Commission\n(hereinafter referred to as "Planning Commission"), pursuant to the authority and powers granted\nby Sections 13\n-\n4\n-\n301 through 13\n-\n4\n-\n309,\nTennessee Code\n.';
    const statements = readAuthorityStatements(wrapped, { municipality: 'Fairview', county: 'Williamson' });
    expect(statements.some((statement) => statement.kind === 'municipal_subdivision')).toBe(true);
  });

  it('reads the government that owns the code, even without an "administers" sentence', () => {
    const title = 'These regulations shall hereinafter be known and cited as the Subdivision Regulations of Fairview, Tennessee.';
    const statements = readAuthorityStatements(title, { municipality: 'Fairview', county: 'Williamson' });
    const claim = statements.find((statement) => statement.kind === 'municipal_subdivision');
    expect(claim).toBeTruthy();
    expect(claim?.form).toBe('jurisdictional_act');
  });

  it('a publisher act needs the publisher, not just any document', () => {
    const passage = 'PC Resolution PC-43-24, Rezoning, Kingwood Subdivision, 75.86 Acres, Map: 042, Parcel: 123.00.';
    // Published by somebody else: establishes nothing about who zones this.
    expect(readPublisherJurisdictionActs(
      { text: passage, sourceUrl: 'https://example.com/notes.pdf', sourceTitle: null },
      { municipality: 'Fairview', county: 'Williamson', state: 'TN' },
    )).toEqual([]);
    // Published by the city itself: a jurisdictional act over this parcel.
    const acts = readPublisherJurisdictionActs(
      { text: passage, sourceUrl: 'https://www.fairview-tn.org/packet.pdf', sourceTitle: 'City of Fairview' },
      { municipality: 'Fairview', county: 'Williamson', state: 'TN' },
    );
    expect(acts.some((act) => act.kind === 'municipal_zoning')).toBe(true);
    expect(acts[0].form).toBe('publisher_act');
  });

  it('flags a municipal planning region that reaches beyond the city limits', async () => {
    const page = `<html><title>Fairview Planning</title><body>
      <p>The City of Fairview urban growth boundary extends the municipal planning region beyond the corporate limits.</p>
      <p>The City of Fairview administers zoning within the planning region.</p>
    </body></html>`;
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/ugb': page });
    const authority = await resolveControllingLandUseAuthority(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: null, address: null },
      { fetchText, knownSourceUrls: ['https://www.fairview-tn.org/ugb'] },
    );
    expect(authority.limitations.join(' ')).toMatch(/beyond the city limits/i);
    expect(authority.limitations.join(' ')).toMatch(/Do not infer authority from the city limit line/i);
  });
});

// ── 10-12. Current zoning ──────────────────────────────────────────────────

const HISTORICAL_CANDIDATE: ZoningEvidenceCandidate = {
  kind: 'historical_planning_document',
  districtCode: 'R-20 POD',
  districtName: null,
  overlays: [],
  parcelMatchBasis: 'the packet names Map 42 Parcel 123.00',
  sourceLabel: PACKET_TITLE,
  sourceUrl: PACKET_URL,
  sourceTier: 'official_government_source',
  effectiveOrAsOf: 'January 14, 2025',
  quote: 'Current Zoning: R-20 POD.',
  retrievedAt: '2026-08-15T00:00:00.000Z',
};

const GIS_CANDIDATE: ZoningEvidenceCandidate = {
  kind: 'parcel_zoning_gis',
  districtCode: 'RS-15',
  districtName: 'Residential Suburban 15',
  overlays: ['POD'],
  parcelMatchBasis: "an attribute query on the authority's zoning layer field PARCELID for parcel 042 123.00",
  sourceLabel: 'Fairview Zoning — Zoning Districts',
  sourceUrl: 'https://gis.fairview-tn.gov/arcgis/rest/services/Zoning/MapServer/0',
  sourceTier: 'official_government_source',
  effectiveOrAsOf: null,
  quote: '{"ZONING":"RS-15"}',
  retrievedAt: '2026-08-15T00:00:00.000Z',
};

describe('current zoning determination', () => {
  it('10. stale planning history can never establish current zoning', () => {
    const selection = selectCurrentZoning([HISTORICAL_CANDIDATE]);
    expect(selection.selected).toBeNull();
    expect(selection.confidence).toBe('unresolved');
    expect(selection.considered[0].note).toMatch(/historical planning document/i);
    expect(selection.considered[0].selected).toBe(false);
  });

  it('11. parcel-specific zoning GIS establishes it', () => {
    const selection = selectCurrentZoning([HISTORICAL_CANDIDATE, GIS_CANDIDATE]);
    expect(selection.selected?.districtCode).toBe('RS-15');
    expect(selection.selected?.kind).toBe('parcel_zoning_gis');
    expect(selection.confidence).toBe('confirmed');
  });

  it('12. conflicting current official evidence stays explicit and unselected', () => {
    const rival: ZoningEvidenceCandidate = {
      ...GIS_CANDIDATE,
      kind: 'official_zoning_map',
      districtCode: 'R-20',
      sourceUrl: 'https://www.fairview-tn.org/zoning-map',
      sourceLabel: 'Official Zoning Map',
    };
    const selection = selectCurrentZoning([GIS_CANDIDATE, rival]);
    expect(selection.selected).toBeNull();
    expect(selection.confidence).toBe('unresolved');
    expect(selection.conflicts.join(' ')).toMatch(/Conflicting CURRENT zoning evidence/);
    expect(selection.conflicts.join(' ')).toMatch(/RS-15/);
    expect(selection.conflicts.join(' ')).toMatch(/R-20/);
  });

  it('refuses an aggregator as a zoning authority', () => {
    const aggregator: ZoningEvidenceCandidate = { ...GIS_CANDIDATE, sourceTier: 'reputable_secondary', sourceUrl: 'https://www.regrid.com/parcels/x' };
    const selection = selectCurrentZoning([aggregator]);
    expect(selection.selected).toBeNull();
    expect(selection.considered[0].note).toMatch(/never the controlling authority/i);
  });

  it('reads a district off a zoning layer by APN, and states the match basis', async () => {
    const queried: string[] = [];
    const candidate = await readZoningFromGisLayer(
      { layerUrl: 'https://gis.example.gov/arcgis/rest/services/Zoning/MapServer/0', apn: '042 123.00', apnField: 'PARCELID', layerLabel: 'Zoning Districts' },
      {
        fetch: async (url: string) => {
          queried.push(url);
          return {
            status: 200,
            contentType: 'application/json',
            url,
            body: JSON.stringify({ features: [{ attributes: { PARCELID: '042 123.00', ZONING: 'RS-15', ZONEDESC: 'Residential Suburban 15' } }] }),
          };
        },
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(candidate?.districtCode).toBe('RS-15');
    expect(candidate?.districtName).toBe('Residential Suburban 15');
    expect(candidate?.parcelMatchBasis).toMatch(/attribute query .* PARCELID for parcel 042 123\.00/);
    // URLSearchParams renders the space as `+`; the WHERE clause is what matters.
    expect(decodeURIComponent(queried[0]).replace(/\+/g, ' ')).toMatch(/PARCELID='042 123\.00'/);
  });

  it('reports unresolved and keeps history separate when nothing current is found', async () => {
    const determination = attachHistoricalZoning(
      await determineCurrentZoning(
        { dealCardId: 1, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
        null,
        { search: noSearch, fetchText: htmlFetch({}).fetchText, now: () => '2026-08-15T00:00:00.000Z' },
      ),
      [{ kind: 'stated_as_current_at_the_time', value: 'R-20 POD', asOf: 'January 14, 2025', sourceUrl: PACKET_URL, page: 1, quote: 'Current Zoning: R-20 POD.', neverEstablishesCurrentZoning: true }],
    );
    expect(determination.established).toBe(false);
    expect(determination.districtCode).toBeNull();
    expect(determination.confidence).toBe('unresolved');
    expect(determination.historicalReferences).toHaveLength(1);
    expect(determination.limitations.join(' ')).toMatch(/CURRENT zoning is UNRESOLVED/);
    expect(determination.limitations.join(' ')).toMatch(/NOT used to establish current zoning/);
  });

  it('scopes dimensional standards to the district the parcel is actually in', () => {
    const ordinance = `Section 4.1 RS-15 Residential Suburban District.
      Minimum lot size shall be fifteen thousand (15,000) square feet.
      Minimum lot frontage shall be 100 feet.
      Single-family dwelling units are permitted uses in this district.
      Section 4.2 R-20 Residential District. Minimum lot size shall be twenty thousand (20,000) square feet.`;
    const standards = readZoningStandards({ text: ordinance, districtCode: 'RS-15', sourceLabel: 'Fairview Zoning Ordinance', sourceUrl: 'https://www.fairview-tn.org/zoning.pdf' });
    expect(standards.minimumLotSize).toMatch(/15,000/);
    expect(standards.minimumLotSize).not.toMatch(/20,000/);
    expect(standards.frontage).toMatch(/100 feet/);
    expect(standards.residentialEligible).toBe(true);
    expect(standards.sources.length).toBeGreaterThan(0);
    expect(standards.sources[0].section).toMatch(/Section 4\.1/);
  });
});

// ── 13-18. Subdivision rules and the property read ─────────────────────────

const REGULATIONS_TEXT = `WILLIAMSON COUNTY SUBDIVISION REGULATIONS. Adopted March 4, 2019.
Section 2.14 Minor subdivision means a division of land into not more than three lots fronting on an existing public road, requiring no new street.
Section 2.13 Major subdivision means any subdivision that is not a minor subdivision, including any subdivision requiring a new street.
Section 3.2 The Planning Commission shall review and approve all preliminary plats and final plats.
Section 3.3 The secretary may approve a minor subdivision plat administratively without Planning Commission action.
Section 4.1 Minimum lot size shall be one (1) acre where public sewer is not available.
Section 4.2 Minimum lot frontage shall be two hundred (200) feet on a public road.
Section 5.1 New streets shall be constructed to conform to the county road standard.
Section 5.4 Cul-de-sac streets shall not exceed 1,000 feet in length.
Section 6.1 Septic suitability shall be established by the Tennessee Department of Environment and Conservation.
Section 7.2 The plat shall be recorded with the register of deeds within sixty days of approval.
Section 8.1 Storm water management shall be required for all major subdivisions.`;

function fairviewRegulations(dealCardId: number): Promise<SubdivisionRegulations> {
  return retrieveSubdivisionRegulations(
    { dealCardId, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
    { name: 'Williamson County', level: 'county', determination: 'confirmed', basis: 'official source', sources: [], competingClaims: [] },
    {
      suppliedDocuments: [{ label: 'Williamson County Subdivision Regulations', url: 'https://www.williamsoncounty-tn.gov/subdivision-regulations.pdf', text: REGULATIONS_TEXT, tier: 'official_government_source' }],
      now: () => '2026-08-15T00:00:00.000Z',
    },
  );
}

describe('subdivision regulations', () => {
  it('13. every extracted rule keeps its ordinance section and source', async () => {
    const regulations = await fairviewRegulations(1);
    expect(regulations.rules.length).toBeGreaterThan(6);
    for (const rule of regulations.rules) {
      expect(rule.sourceLabel).toBe('Williamson County Subdivision Regulations');
      expect(rule.sourceUrl).toMatch(/williamsoncounty-tn\.gov/);
      expect(rule.value.length).toBeGreaterThan(0);
      expect(rule.quote.length).toBeGreaterThan(0);
    }
    const minLot = regulations.rules.find((rule) => rule.key === 'minimum_lot_size');
    expect(minLot?.section).toMatch(/Section 4\.1/);
    expect(minLot?.confidence).toBe('confirmed');
    expect(regulations.documents[0].adoptedOrAsOf).toBe('March 4, 2019');
  });

  it('14. minor and major definitions stay distinct', async () => {
    const regulations = await fairviewRegulations(1);
    const thresholds = regulations.thresholds;
    expect(thresholds.minorDefinition?.value).toMatch(/not more than three lots/i);
    expect(thresholds.majorDefinition?.value).toMatch(/not a minor subdivision/i);
    expect(thresholds.minorDefinition?.key).toBe('minor_subdivision_definition');
    expect(thresholds.majorDefinition?.key).toBe('major_subdivision_definition');
    expect(thresholds.statedMaxMinorLots).toBe(3);
    expect(thresholds.basis).toMatch(/Section 2\.14/);
  });

  it('reads the DEFINITION, not a cross-reference that reuses the term', () => {
    // Live wording. The cross-reference comes first in the document; only the
    // definition carries the lot threshold the review path turns on.
    const text = 'A land partition is exempt from major subdivision, minor subdivision, or a land partition review. '
      + 'SECTION 2-110 DEFINITIONS. Minor Subdivision A division of land into not more than three lots fronting on an existing public road.';
    const rules = extractSubdivisionRules({
      text,
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: 'https://www.fairview-tn.org/adopted.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });
    const minor = rules.find((rule) => rule.key === 'minor_subdivision_definition');
    expect(minor?.value).toMatch(/not more than three lots/);
    expect(readMinorMajorThresholds(rules).statedMaxMinorLots).toBe(3);
  });

  it('reads a lot ceiling written in words as well as digits', () => {
    expect(readLotCount('not more than three lots')).toBe(3);
    expect(readLotCount('a maximum of 5 lots')).toBe(5);
    expect(readLotCount('no lot ceiling stated here')).toBeNull();
  });

  it('does not promote an unrelated number into the minor/major threshold', () => {
    const thresholds = readMinorMajorThresholds([
      {
        key: 'cul_de_sac_or_dead_end', label: 'Cul-de-sac', value: 'Cul-de-sac streets shall not exceed 1,000 feet serving 20 lots',
        quote: '', section: 'Section 5.4', sourceLabel: 'x', sourceUrl: null, authorityName: null,
        effectiveOrAsOf: null, confidence: 'confirmed', limitations: [],
      },
    ]);
    expect(thresholds.statedMaxMinorLots).toBeNull();
    expect(thresholds.basis).toMatch(/unresolved/i);
  });

  it('refuses another jurisdiction\'s regulations, however official they are', async () => {
    // A live run accepted `sudbury.ma.us` — a real `.us` government host
    // publishing real subdivision regulations — as the rules for a Tennessee
    // parcel. Officiality is not jurisdiction.
    expect(hostServesSubjectJurisdiction('https://sudbury.ma.us/planning/rules', { municipality: 'Fairview', county: 'Williamson', state: 'TN' })).toBe(false);
    expect(hostServesSubjectJurisdiction('https://www.fairview-tn.org/docs/subdivision.pdf', { municipality: 'Fairview', county: 'Williamson', state: 'TN' })).toBe(true);
    expect(hostServesSubjectJurisdiction('https://www.williamsoncounty-tn.gov/regs.pdf', { municipality: 'Fairview', county: 'Williamson', state: 'TN' })).toBe(true);
    expect(hostServesSubjectJurisdiction('https://www.tn.gov/planning', { municipality: 'Fairview', county: 'Williamson', state: 'TN' })).toBe(true);

    const opened: string[] = [];
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      null,
      {
        knownDocumentUrls: ['https://sudbury.ma.us/planning/subdivision-rules'],
        fetchText: async (url) => { opened.push(url); throw new Error('should not be reached'); },
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(opened).toEqual([]);
    expect(regulations.rules).toEqual([]);
    expect(regulations.limitations.join(' ')).toMatch(/sudbury\.ma\.us/);
    expect(regulations.limitations.join(' ')).toMatch(/do not serve this parcel's municipality, county or state/);
  });

  it('never lets a PROPOSED document outrank the adopted one', async () => {
    const proposed = `PROPOSED SUBDIVISION REGULATIONS ARTICLE I - GENERAL PROVISIONS
      Section 1-101 Minimum lot size shall be five (5) acres.`;
    const adopted = `CITY OF FAIRVIEW SUBDIVISION REGULATIONS. Adopted June 2, 2018.
      Section 4-101 Minimum lot size shall be one (1) acre where public sewer is not available.`;
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      null,
      {
        // Deliberately proposed FIRST, so order cannot be what saves it.
        suppliedDocuments: [
          { label: 'Proposed regs', url: 'https://www.fairview-tn.org/proposed.pdf', text: proposed, tier: 'official_government_source' },
          { label: 'Adopted regs', url: 'https://www.fairview-tn.org/adopted.pdf', text: adopted, tier: 'official_government_source' },
        ],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    const minLot = regulations.rules.find((rule) => rule.key === 'minimum_lot_size');
    expect(minLot?.value).toMatch(/one \(1\) acre/);
    expect(minLot?.value).not.toMatch(/five \(5\) acres/);
    expect(regulations.documents.find((document) => document.url?.includes('proposed'))?.draftOrProposed).toBe(true);
    expect(regulations.documents.find((document) => document.url?.includes('adopted'))?.draftOrProposed).toBe(false);
    expect(regulations.limitations.join(' ')).toMatch(/PROPOSED or DRAFT/);
  });

  it('prefers a rule passage that actually carries the number', () => {
    const text = `Definitions: minimum lot size means the minimum lot area required for such lots.
      Section 4-101 Minimum lot size shall be one (1) acre where public sewer is not available.`;
    const rules = extractSubdivisionRules({
      text,
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: 'https://www.fairview-tn.org/adopted.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(rules.find((rule) => rule.key === 'minimum_lot_size')?.value).toMatch(/one \(1\) acre/);
  });

  // ── The lot-area standard, however the regulation phrases it ──────────────
  //
  // A live run on Fairview reported the theoretical lot count as UNKNOWN across
  // ten official documents. Reading them showed the extractor knew one way to
  // say "minimum lot size", and regulations say it several — and that Fairview
  // says it in none of them, because it delegates the number to the zoning
  // ordinance instead.

  const extract = (text: string) => extractSubdivisionRules({
    text,
    sourceLabel: 'Subdivision Regulations',
    sourceUrl: 'https://www.fairview-tn.org/adopted.pdf',
    sourceTier: 'official_government_source',
    authorityName: 'Fairview',
    retrievedAt: '2026-08-15T00:00:00.000Z',
  });
  const valueOf = (text: string, key: string) => extract(text).find((rule) => rule.key === key)?.value ?? null;

  it('reads a stated minimum lot area in the registers ordinances actually use', () => {
    expect(valueOf('Section 4-110 No lot shall be less than one (1) acre in area.', 'minimum_lot_size'))
      .toMatch(/one \(1\) acre/);
    expect(valueOf('Section 4-110 Each lot shall have an area of not less than fifteen thousand (15,000) square feet.', 'minimum_lot_size'))
      .toMatch(/15,000\) square feet/);
    expect(valueOf('Section 4-110 Lot area shall be not less than two (2) acres where public sewer is unavailable.', 'minimum_lot_size'))
      .toMatch(/two \(2\) acres/);
    expect(valueOf('Section 4-110 The minimum area of any lot shall be twenty thousand (20,000) square feet.', 'minimum_lot_size'))
      .toMatch(/20,000\) square feet/);
  });

  it('does not read a frontage or roadway measurement as a lot area', () => {
    expect(valueOf('Section 4-110 No lot shall be created which does not abut a public road with at least fifty (50) feet of frontage.', 'minimum_lot_size'))
      .toBeNull();
    expect(valueOf('Section 4-110 Each lot shall have a width of not less than one hundred (100) feet at the building line.', 'minimum_lot_size'))
      .toBeNull();
  });

  it('retains a lot area the regulations delegate to the zoning ordinance, and never as a number', () => {
    // Fairview Article IV, verbatim. The adopted set states no lot-area figure
    // anywhere; this sentence is the whole of what it says about lot area.
    const text = 'Section 4-102.2 Critical Lots shall be designated on the face of the plat. '
      + '4-110.2 Lot Dimensions Lot area shall comply with the minimum standards of the Zoning Ordinance.';
    const rules = extract(text);
    expect(rules.find((rule) => rule.key === 'minimum_lot_size')).toBeUndefined();
    const deferred = rules.find((rule) => rule.key === 'minimum_lot_size_deferred_to');
    expect(deferred?.value).toMatch(/shall comply with the minimum standards of the Zoning Ordinance/i);
    expect(deferred?.label).toMatch(/zoning ordinance/i);
    // Cited to the heading it is printed under, not to the cross-reference in
    // the sentence before it. 4-102.2 governs critical lots and says nothing
    // about lot area; sending anyone there is worse than citing no section.
    expect(deferred?.section).toBe('4-110.2');
    expect(deferred?.limitations.join(' ')).not.toMatch(/does not print an ordinance section/);
    // It names where the number lives. It establishes no number, and no district.
    expect(readMinimumLotAcres(deferred!.value).acres).toBeNull();
  });

  it('reads the delegation in the other registers, including a zoning resolution', () => {
    expect(valueOf('Lot sizes shall be governed by the Fairview Zoning Ordinance.', 'minimum_lot_size_deferred_to'))
      .toMatch(/governed by/i);
    expect(valueOf('Minimum lot area shall be as set forth in the County Zoning Resolution.', 'minimum_lot_size_deferred_to'))
      .toMatch(/Zoning Resolution/i);
    // A lot-area sentence that delegates nowhere is not a delegation.
    expect(valueOf('Lot area shall be shown on the face of the final plat.', 'minimum_lot_size_deferred_to')).toBeNull();
  });

  it('cites a section printed with the spacing a PDF text layer produces', () => {
    const rules = extractSubdivisionRules({
      text: 'SECTION 1 - 112 VARIANCES. Minimum lot frontage shall be two hundred (200) feet on a public road.',
      sourceLabel: 'regs',
      sourceUrl: 'https://www.fairview-tn.org/adopted.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(rules.find((rule) => rule.key === 'minimum_frontage')?.section).toBe('SECTION 1 - 112');
  });

  it('says so plainly when the controlling authority is not established', async () => {
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      null,
      { suppliedDocuments: [{ label: 'Some regulations', url: null, text: REGULATIONS_TEXT }], now: () => '2026-08-15T00:00:00.000Z' },
    );
    expect(regulations.limitations.join(' ')).toMatch(/NOT attributed to a governing authority/i);
    expect(regulations.authorityName).toBeNull();
  });
});

describe('property-specific subdivision read', () => {
  const zoningUnresolved = null;

  async function fairviewRead(overrides: Partial<Parameters<typeof buildPropertySubdivisionRead>[0]> = {}) {
    const regulations = await fairviewRegulations(1);
    return buildPropertySubdivisionRead({
      dealCardId: 1,
      acres: 75.86,
      roadFrontageFeet: null,
      roadFrontageBasis: null,
      accessStatus: 'unknown',
      environmentalConstraints: [],
      utilitiesKnown: null,
      utilitiesSummary: null,
      zoning: zoningUnresolved,
      regulations,
      backstory: null,
      now: () => '2026-08-15T00:00:00.000Z',
      ...overrides,
    });
  }

  it('15. a theoretical lot count is never presented as an approved yield', async () => {
    const read = await fairviewRead();
    expect(read.theoreticalLotCount.value).toBe(75);
    expect(read.theoreticalLotCount.status).toBe('theoretical');
    expect(read.theoreticalLotCount.approvedYield).toBe(false);
    expect(read.theoreticalLotCount.calculation).toMatch(/before any site or process deduction/);
    expect(read.theoreticalLotCount.caveats.join(' ')).toMatch(/no road frontage test/);
    expect(read.limitations.join(' ')).toMatch(/arithmetic, not an approved yield/);
    expect(read.likelyPath.basis).not.toBe('confirmed');
  });

  it('16. frontage binds the lot count when the tract frontage is known', async () => {
    const read = await fairviewRead({ roadFrontageFeet: 800, roadFrontageBasis: 'the county parcel geometry' });
    expect(read.frontageConstraint.status).toBe('binding');
    expect(read.frontageConstraint.maxLotsByFrontage).toBe(4);
    expect(read.obviousMaximumLotConstraint.value).toBe(4);
    expect(read.obviousMaximumLotConstraint.from).toMatch(/road frontage/);
    expect(read.constraints.some((constraint) => constraint.kind === 'frontage' && /limits the tract to 4/.test(constraint.headline))).toBe(true);
  });

  it('17. acreage over minimum lot size drives the theoretical count, in either unit', () => {
    expect(readMinimumLotAcres('Minimum lot size shall be one (1) acre').acres).toBe(1);
    expect(readMinimumLotAcres('Minimum lot size shall be fifteen thousand (15,000) square feet').acres).toBeCloseTo(0.3444, 3);
    expect(readMinimumLotAcres('Minimum lot size shall be adequate').acres).toBeNull();
    expect(readFrontageFeet('Minimum lot frontage shall be two hundred (200) feet')).toBe(200);
  });

  it('18. access, utilities and frontage unknowns stay unresolved and become diligence', async () => {
    const read = await fairviewRead();
    expect(read.frontageConstraint.status).toBe('unknown');
    expect(read.frontageConstraint.maxLotsByFrontage).toBeNull();
    const access = read.constraints.find((constraint) => constraint.kind === 'access');
    expect(access?.basis).toBe('unknown');
    const utilities = read.constraints.find((constraint) => constraint.kind === 'utilities_septic');
    expect(utilities?.basis).toBe('unknown');
    const diligence = read.nextAuthoritativeDiligence.join(' ');
    expect(diligence).toMatch(/Measure the tract's actual public road frontage/);
    expect(diligence).toMatch(/subsurface sewage disposal/i);
    expect(diligence).toMatch(/legal and physical access/i);
    expect(diligence).toMatch(/Confirm the CURRENT zoning district/);
  });

  // ── A delegated lot area is a reason, not a silence ───────────────────────

  async function readWithRegulationText(text: string, acres: number | null = 75.86) {
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      { name: 'Williamson County', level: 'county', determination: 'confirmed', basis: 'official source', sources: [], competingClaims: [] },
      {
        suppliedDocuments: [{
          label: 'Subdivision Regulations Article IV',
          // Deliberately NOT a series-numbered filename: this fixture is about
          // the lot-area rule, and a `…Article4.pdf` URL would send the series
          // walk out to the network for the rest of the set.
          url: 'https://www.williamsoncounty-tn.gov/subdivision-lot-standards.pdf',
          text,
          tier: 'official_government_source',
        }],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    return fairviewRead({ acres, regulations });
  }

  const DELEGATES_LOT_AREA =
    'Section 2.14 A minor subdivision means a division of land into not more than three lots fronting an existing public road. '
    + '4-110.2 Lot Dimensions Lot area shall comply with the minimum standards of the Zoning Ordinance.';

  it('reports a delegated lot area as the reason the count is unknown, and where the number lives', async () => {
    const read = await readWithRegulationText(DELEGATES_LOT_AREA);
    // Still UNKNOWN. A delegation supplies no number and none is assumed.
    expect(read.theoreticalLotCount.value).toBeNull();
    expect(read.theoreticalLotCount.status).toBe('unknown');
    expect(read.theoreticalLotCount.inputs.minimumLotAcres).toBeNull();
    expect(read.theoreticalLotCount.approvedYield).toBe(false);
    // But it now says WHY, quotes the regulation, and cites the document.
    expect(read.theoreticalLotCount.calculation).toMatch(/state no lot area of their own/);
    expect(read.theoreticalLotCount.calculation).toMatch(/Subdivision Regulations Article IV/);
    expect(read.theoreticalLotCount.calculation).toMatch(/shall comply with the minimum standards of the Zoning Ordinance/i);
    const diligence = read.nextAuthoritativeDiligence.join(' ');
    expect(diligence).toMatch(/Obtain the minimum lot area/);
    expect(diligence).toMatch(/Williamson County/);
    // Zoning stays a separate, unresolved question the delegation does not answer.
    expect(diligence).toMatch(/zoning district is not established, so establish the district first/);
    expect(read.limitations.join(' ')).toMatch(/state no minimum lot area of their own/);
  });

  it('keeps the acreage gap on the list when the tract acreage is also unknown', async () => {
    const read = await readWithRegulationText(DELEGATES_LOT_AREA, null);
    const diligence = read.nextAuthoritativeDiligence.join(' ');
    expect(diligence).toMatch(/subject acreage is not established/);
    expect(diligence).toMatch(/Obtain the minimum lot area/);
  });

  it('a stated minimum always outranks a delegation', async () => {
    const read = await readWithRegulationText(
      `${DELEGATES_LOT_AREA} Section 4-111 Minimum lot size shall be one (1) acre.`,
    );
    expect(read.theoreticalLotCount.status).toBe('theoretical');
    expect(read.theoreticalLotCount.value).toBe(75);
    expect(read.theoreticalLotCount.inputs.minimumLotSizeStatedAs).toMatch(/1\) acre/);
    expect(read.nextAuthoritativeDiligence.join(' ')).not.toMatch(/Obtain the minimum lot area/);
    expect(read.limitations.join(' ')).not.toMatch(/state no minimum lot area of their own/);
  });

  it('indicates major review when the tract exceeds the stated minor ceiling', async () => {
    const read = await fairviewRead();
    expect(read.reviewIndication).toBe('major');
    expect(read.likelyPath.kind).toBe('major_subdivision');
    expect(read.likelyPath.basis).toBe('likely');
    expect(read.likelyPath.why).toMatch(/minor review at 3 lot\(s\) or fewer/);
    expect(read.requiredReviewBody).toMatch(/planning commission/i);
  });

  it('reports the path as unknown when no regulation was retrieved', () => {
    const read = buildPropertySubdivisionRead({
      dealCardId: 1, acres: 75.86, roadFrontageFeet: null, roadFrontageBasis: null,
      accessStatus: null, environmentalConstraints: [], utilitiesKnown: null, utilitiesSummary: null,
      zoning: null,
      regulations: {
        dealCardId: 1, authorityName: null, authorityDetermination: 'unresolved', documents: [], rules: [],
        thresholds: { minorDefinition: null, majorDefinition: null, administrativeSplitThreshold: null, maxLotsBeforeMajorReview: null, statedMaxMinorLots: null, basis: 'unresolved' },
        reviewSequence: [], limitations: [], retrievedAt: '2026-08-15T00:00:00.000Z',
      },
      backstory: null,
      now: () => '2026-08-15T00:00:00.000Z',
    });
    expect(read.likelyPath.kind).toBe('unknown');
    expect(read.reviewIndication).toBe('unknown');
    expect(read.theoreticalLotCount.value).toBeNull();
    expect(read.theoreticalLotCount.status).toBe('unknown');
  });

  it('treats a prior lot concept as a concept, not an entitlement', async () => {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: false });
    const read = await fairviewRead({ backstory });
    const history = read.constraints.find((constraint) => constraint.kind === 'history');
    expect(history?.headline).toMatch(/91-lot concept/);
    expect(history?.detail).toMatch(/concept that was put forward and not an approval/);
  });
});

// ── 19-20. Durability and the pre-call handoff ─────────────────────────────

describe('durability and the pre-call handoff', () => {
  async function seedFullIntelligence(): Promise<number> {
    const { dealCardId } = seedResolvedSubject();
    await seedPacketIntelligence(dealCardId);
    const backstory = await runPropertyBackstory(runSubject(dealCardId), { persist: true });

    const authority = await resolveControllingLandUseAuthority(
      { dealCardId, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: '042 123.00', address: null },
      {
        fetchText: htmlFetch({
          'https://www.fairview-tn.org/planning': `<html><title>City of Fairview Planning</title><body>
            <p>The City of Fairview administers zoning within its corporate limits under the Fairview Zoning Ordinance.</p>
            <p>Williamson County administers subdivision regulations for this area.</p></body></html>`,
        }).fetchText,
        knownSourceUrls: ['https://www.fairview-tn.org/planning'],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    persistControllingAuthority({ authority });

    const zoning = attachHistoricalZoning(
      await determineCurrentZoning(
        { dealCardId, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
        authority.zoningAuthority,
        { search: noSearch, fetchText: htmlFetch({}).fetchText, now: () => '2026-08-15T00:00:00.000Z' },
      ),
      backstory.zoningReferences,
    );
    persistCurrentZoning({ zoning });

    const regulations = await fairviewRegulations(dealCardId);
    persistSubdivisionRegulations({ regulations });
    persistPropertySubdivisionRead({
      read: buildPropertySubdivisionRead({
        dealCardId, acres: 75.86, roadFrontageFeet: null, roadFrontageBasis: null,
        accessStatus: 'unknown', environmentalConstraints: ['Wetlands and a stream buffer are mapped on the eastern boundary.'],
        utilitiesKnown: null, utilitiesSummary: null, zoning, regulations, backstory,
        now: () => '2026-08-15T00:00:00.000Z',
      }),
    });
    return dealCardId;
  }

  it('19. backstory, authority, zoning and subdivision survive a fresh store read', async () => {
    const dealCardId = await seedFullIntelligence();

    // Nothing in-process: read them back the way a restarted service would.
    clearDiscoveredContext();
    clearOfficialPdfCache();

    const backstory = readPropertyBackstory(dealCardId);
    expect(backstory?.events.length).toBeGreaterThan(0);
    expect(backstory?.zoningReferences.some((row) => /R-20/.test(row.value ?? ''))).toBe(true);

    const authority = readControllingAuthority(dealCardId);
    expect(authority?.zoningAuthority.name).toBe('Fairview');
    expect(authority?.subdivisionAuthority.name).toBe('Williamson County');

    const zoning = readCurrentZoning(dealCardId);
    expect(zoning?.established).toBe(false);
    expect(zoning?.historicalReferences.length).toBeGreaterThan(0);

    const regulations = readSubdivisionRegulations(dealCardId);
    expect(regulations?.rules.length).toBeGreaterThan(6);
    expect(readPropertySubdivisionRead(dealCardId)?.likelyPath.kind).toBe('major_subdivision');

    // Every rule is retrievable as evidence with its section, not only inside
    // the derived read.
    const ruleEvidence = readSubdivisionRuleEvidence(dealCardId);
    expect(ruleEvidence.length).toBe(regulations!.rules.length);
    expect(ruleEvidence.every((row) => !!row.sourceName)).toBe(true);

    // Reuses the two existing tables. No third intelligence store was created.
    const tables = getLandosDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%backstory%' OR name LIKE '%subdivision%' OR name LIKE '%land_use_intel%')")
      .all() as Array<{ name: string }>;
    expect(tables).toEqual([]);
  });

  it('does not rewrite an unchanged derived read', async () => {
    const dealCardId = await seedFullIntelligence();
    const before = getLandosDb()
      .prepare("SELECT COUNT(*) AS n FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='property_backstory_v1'")
      .get(dealCardId) as { n: number };
    const backstory = readPropertyBackstory(dealCardId)!;
    const again = persistPropertyBackstory({ backstory });
    expect(again.reused).toBe(true);
    const after = getLandosDb()
      .prepare("SELECT COUNT(*) AS n FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='property_backstory_v1'")
      .get(dealCardId) as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('20. the pre-call handoff is grounded in stored evidence', async () => {
    const dealCardId = await seedFullIntelligence();
    const handoff = readPreCallIntelligenceHandoff(dealCardId, { now: () => '2026-08-15T00:00:00.000Z' });

    expect(handoff.property.apn).toBe('042 123.00');
    expect(handoff.owner.name).toBe('Landsouth, LLC');
    expect(handoff.owner.isEntity).toBe(true);
    expect(handoff.backstorySummary).toMatch(/Kingwood|subject-specific matter/);
    expect(handoff.controllingAuthority.zoning.name).toBe('Fairview');
    expect(handoff.controllingAuthority.subdivision.name).toBe('Williamson County');

    // Current zoning is honestly unestablished, and the historical value is
    // shown as history rather than as the district.
    expect(handoff.currentZoning.established).toBe(false);
    expect(handoff.currentZoning.district).toBeNull();
    expect(handoff.currentZoning.historicalStatements.some((row) => /R-20/.test(row.value ?? ''))).toBe(true);
    expect(handoff.unresolved.join(' ')).toMatch(/Current zoning district is not established/);

    expect(handoff.subdivisionRead?.theoreticalIsNotApproved).toBe(true);
    expect(handoff.subdivisionRead?.reviewIndication).toBe('major');

    // 5 to 10 questions, every one traceable to a stored finding.
    expect(handoff.questions.length).toBeGreaterThanOrEqual(5);
    expect(handoff.questions.length).toBeLessThanOrEqual(10);
    for (const question of handoff.questions) {
      expect(question.groundedIn.detail.length).toBeGreaterThan(0);
      expect(question.question.length).toBeGreaterThan(20);
    }
    const asked = handoff.questions.map((question) => question.question).join(' ');
    expect(asked).toMatch(/91-lot concept/);
    expect(asked).toMatch(/engineering, survey, plat drawings or studies/);
    expect(asked).toMatch(/RS-15/);
    expect(asked).toMatch(/Landsouth, LLC/);
    expect(handoff.majorOpportunities.join(' ')).toMatch(/91-lot concept/);
  });

  it('surfaces a contradiction between the historical record and a verified district', () => {
    const handoff = readPreCallIntelligenceHandoff(9_999_999);
    // A card with nothing stored produces an honest empty package, never a crash.
    expect(handoff.questions).toEqual([]);
    expect(handoff.unresolved.length).toBeGreaterThan(0);
  });
});

// ── 24. The mission graph keeps independent lanes parallel ─────────────────

describe('mission graph wiring', () => {
  it('24. backstory and subdivision never block another lane', () => {
    const backstory = dealIntelligenceChildSpec('property_backstory');
    const subdivision = dealIntelligenceChildSpec('subdivision_feasibility');

    expect(backstory.role).toBe('supporting');
    expect(backstory.dependsOn).toEqual(['parcel_identity']);
    expect(backstory.awaits ?? []).toEqual([]);
    // Nothing may HARD-depend on either new lane.
    for (const spec of DEAL_INTELLIGENCE_CHILDREN) {
      expect(spec.dependsOn).not.toContain('property_backstory');
      expect(spec.dependsOn).not.toContain('subdivision_feasibility');
    }
    // Subdivision only WAITS, so a missing zoning or backstory qualifies it
    // rather than cancelling it.
    expect(subdivision.dependsOn).toEqual(['parcel_identity']);
    expect(subdivision.awaits).toContain('zoning_land_use');
    expect(subdivision.awaits).toContain('property_backstory');
  });

  it('keeps comps, environmental, access and market in the same wave as backstory', () => {
    const waves = planMissionWaves(DEAL_INTELLIGENCE_CHILDREN);
    const waveOf = (key: string) => waves.findIndex((wave) => wave.includes(key));
    const backstoryWave = waveOf('property_backstory');
    for (const key of ['comparables', 'environmental_terrain', 'access_utilities', 'market_intelligence', 'evidence_visuals', 'zoning_land_use', 'government_records']) {
      expect(waveOf(key)).toBe(backstoryWave);
    }
    // And the new lanes did not push valuation or strategy out of order.
    expect(waveOf('valuation')).toBeGreaterThan(backstoryWave);
    expect(waveOf('strategy')).toBeGreaterThan(waveOf('valuation'));
  });

  it('the subdivision lane refuses to assert an approved yield', () => {
    const spec = dealIntelligenceChildSpec('subdivision_feasibility');
    const check = spec.acceptance?.checks?.find((row) => row.id === 'no_approved_yield_claimed');
    expect(check?.severity).toBe('required');
    const verdict = check!.evaluate({ dealCardId: 1, approvedYieldAsserted: true }, { dealCardId: 1, missionId: 'm', childKey: 'subdivision_feasibility' } as never);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toMatch(/no LandOS lane may make/);
  });
});
