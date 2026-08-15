// Durable official-document intelligence.
//
// The closeout requirement: findings and the detailed summary survive the
// process. A later LandOS session, a restart, or any downstream system reads
// them out of the database and never touches the original PDF again.

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
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { createPropertyIdentityVersion, readCurrentPropertyIdentity } from './property-summary-slice.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { primaryParcelNotation } from './parcel-notation.js';
import {
  clearOfficialPdfCache,
  loadOfficialPdf,
  type OfficialPdfDocument,
} from './official-pdf-identity.js';
import {
  clearDiscoveredContext,
  mineDocumentContext,
  type SubjectAnchors,
} from './official-document-context.js';
import { composeOfficialDocumentSummary, readDocumentDate, readDocumentType } from './official-document-summary.js';
import {
  documentKeyFor,
  persistDocumentIntelligence,
  readDocumentIntelligence,
  readDocumentSummaryHistory,
} from './official-document-intelligence-store.js';
import {
  applyLaneEvidence,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
} from './universal-property-resolution.js';

// ── The real Fairview packet, as pages ─────────────────────────────────────

const PAGE_ONE = 'Agenda Fairview Planning Commission January 14, 2025 Regular Meeting. '
  + 'OLD BUSINESS 1. PC Resolution PC-44-24, Master Development Plan, Kingwood Subdivision, 75.86 Acres, '
  + 'Map: 42, Parcel: 123.00. Current Zoning: R-20 POD. Requested Zoning: RS-15 POD. Property Owner: Landsouth, LLC. '
  + '2. PC Resolution PC-45-24, Annexation, 7740 Cumberland Dr., 351.27 Acres, Map: 47, Parcel: 094.00. '
  + 'Current Zoning: Williamson County Rural Preservation-5. Property Owner: Fernvale Springs Farm, LLC.';

const PAGE_TWO = 'Discussion of the Kingwood Subdivision master development plan continued. '
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

const ANCHORS: SubjectAnchors = {
  notations: [primaryParcelNotation('Map 042 Parcel 123')!],
  apn: '042 123.00',
  owner: 'Landsouth, LLC',
  projectName: 'Kingwood Subdivision',
  address: null,
  city: 'Fairview',
};

const SUBJECT = {
  apn: '042 123.00', owner: 'Landsouth, LLC', projectName: 'Kingwood Subdivision',
  acreage: 75.86, city: 'Fairview', county: 'Williamson', state: 'TN',
  parcelNotation: 'Map 042 Parcel 123',
};

/** A resolved Fairview lead with a current identity version, as after release. */
function seedResolvedSubject(): { dealCardId: number; cardId: number; identityVersionId: number } {
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
  return { dealCardId: deal.id, cardId: card.id, identityVersionId: identity.id };
}

async function mineAndPersist(dealCardId: number, pages = [PAGE_ONE, PAGE_TWO]): Promise<{ document: OfficialPdfDocument; calls: string[] }> {
  const { fetchImpl, calls } = pdfFetch(pages);
  const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
  const context = mineDocumentContext({ document, anchors: ANCHORS, dealCardId });
  const summary = composeOfficialDocumentSummary({
    context, subject: SUBJECT, documentKey: documentKeyFor(PACKET_URL),
    documentText: document.text, sourceTitle: PACKET_TITLE,
  });
  persistDocumentIntelligence({ dealCardId, context, summary, documentText: document.text, sourceTitle: PACKET_TITLE });
  return { document, calls };
}

const promoteOffline = (dealCardId: number, actor: string) =>
  reconcileSubjectIdentity(dealCardId, { actor, censusGeography: null });
const neverSettles = (): Promise<IdentityLaneResult> => new Promise(() => {});

beforeEach(() => {
  _initTestLandosDb();
  clearOfficialPdfCache();
  clearDiscoveredContext();
});

// ── 1-4. Durability and reload ─────────────────────────────────────────────

describe('durable document intelligence', () => {
  it('persists granular findings and the detailed summary', async () => {
    const { dealCardId, identityVersionId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);

    const stored = readDocumentIntelligence(dealCardId);
    expect(stored.findings.length).toBeGreaterThan(8);
    expect(stored.summaries).toHaveLength(1);
    for (const finding of stored.findings) {
      expect(finding.dealCardId).toBe(dealCardId);
      expect(finding.propertyIdentityVersionId).toBe(identityVersionId);
    }
    // Written to the evidence model LandOS already has — no new table.
    const rows = getLandosDb()
      .prepare("SELECT COUNT(*) AS n FROM landos_property_evidence_item WHERE domain='official_document'")
      .get() as { n: number };
    expect(rows.n).toBe(stored.findings.length);
    const snapshots = getLandosDb()
      .prepare("SELECT snapshot_type, status FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?")
      .all(dealCardId) as Array<{ snapshot_type: string; status: string }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].snapshot_type).toBe(`official_document_summary_v1:${documentKeyFor(PACKET_URL)}`);
    expect(snapshots[0].status).toBe('current');
  });

  it('reloads through a fresh read with no in-process state and no second fetch', async () => {
    const { dealCardId } = seedResolvedSubject();
    const { calls } = await mineAndPersist(dealCardId);
    expect(calls).toHaveLength(1);

    // Everything in process is discarded — the parsed-document cache and the
    // in-memory context store. This is the restart.
    clearOfficialPdfCache();
    clearDiscoveredContext();

    const reloaded = readDocumentIntelligence(dealCardId);
    expect(reloaded.findings.length).toBeGreaterThan(8);
    expect(reloaded.summaries).toHaveLength(1);
    expect(reloaded.summaries[0].detailedSummary).toContain('Kingwood Subdivision');
    expect(reloaded.documents[0].sourceUrl).toBe(PACKET_URL);
    // Nothing fetched the PDF again to read any of that back.
    expect(calls).toHaveLength(1);
  });

  it('keeps full provenance through persistence', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const stored = readDocumentIntelligence(dealCardId);

    for (const finding of stored.findings) {
      expect(finding.sourceUrl).toBe(PACKET_URL);
      expect(finding.sourceTitle).toBe(PACKET_TITLE);
      expect(finding.page).toBeGreaterThanOrEqual(1);
      expect(finding.pageBasis).toBe('approximate_content_stream_order');
      expect(finding.sourceClassification).toBe('official_government_document');
      expect(finding.matchedBy).toBeTruthy();
      expect(finding.retrievedAt).toBeTruthy();
      expect(finding.minedAt).toBeTruthy();
      expect(finding.documentKey).toBe(documentKeyFor(PACKET_URL));
      expect(finding.contentHash).toHaveLength(32);
      expect(['high', 'medium', 'low']).toContain(finding.confidence);
      expect(finding.context.length).toBeGreaterThan(5);
    }
    // Material from page 2 survived, with its page.
    expect(stored.findings.some((finding) => finding.page === 2 && finding.category === 'lot_count_or_density')).toBe(true);
  });
});

// ── 5-7. Deduplication and versioning ──────────────────────────────────────

describe('deduplication and versioning', () => {
  it('processing the same unchanged document twice adds nothing', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const first = readDocumentIntelligence(dealCardId);

    clearOfficialPdfCache();
    await mineAndPersist(dealCardId);
    const second = readDocumentIntelligence(dealCardId);

    expect(second.findings).toHaveLength(first.findings.length);
    expect(second.summaries).toHaveLength(1);
    expect(second.summaries[0].summaryGeneratedAt).toBe(first.summaries[0].summaryGeneratedAt);
  });

  it('reports duplicates rather than silently re-inserting', async () => {
    const { dealCardId } = seedResolvedSubject();
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const context = mineDocumentContext({ document, anchors: ANCHORS, dealCardId });
    const summary = composeOfficialDocumentSummary({
      context, subject: SUBJECT, documentKey: documentKeyFor(PACKET_URL), documentText: document.text,
    });
    const first = persistDocumentIntelligence({ dealCardId, context, summary, documentText: document.text });
    const again = persistDocumentIntelligence({ dealCardId, context, summary, documentText: document.text });

    expect(first.duplicateFindings).toBe(0);
    expect(first.summaryReused).toBe(false);
    expect(again.duplicateFindings).toBe(context.findings.length);
    expect(again.summaryReused).toBe(true);
    expect(again.summarySnapshotId).toBe(first.summarySnapshotId);
  });

  it('a genuinely changed source becomes a new retrieval, superseding the summary', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const before = readDocumentIntelligence(dealCardId);

    // The city republishes the packet with the lot count revised.
    clearOfficialPdfCache();
    await mineAndPersist(dealCardId, [PAGE_ONE, PAGE_TWO.replace('91 single-family lots', '84 single-family lots')]);

    const after = readDocumentIntelligence(dealCardId);
    expect(after.findings.length).toBeGreaterThan(before.findings.length);
    // One CURRENT summary, the earlier one retained as history.
    expect(after.summaries).toHaveLength(1);
    expect(readDocumentSummaryHistory(dealCardId)).toHaveLength(1);
    expect(after.summaries[0].detailedSummary).toContain('84 single-family lots');
    // Both retrievals are still on the record; nothing was overwritten.
    const hashes = new Set(after.findings.map((finding) => finding.contentHash));
    expect(hashes.size).toBe(2);
  });

  it('refuses to persist when no identity version exists, and says why', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'x', sellerNotes: 'Map 042 Parcel 123' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN',
      summary: 'Map 042 Parcel 123', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);

    const { fetchImpl } = pdfFetch([PAGE_ONE]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const context = mineDocumentContext({ document, anchors: ANCHORS, dealCardId: deal.id });
    const summary = composeOfficialDocumentSummary({ context, subject: SUBJECT, documentKey: documentKeyFor(PACKET_URL), documentText: document.text });
    const outcome = persistDocumentIntelligence({ dealCardId: deal.id, context, summary, documentText: document.text });

    expect(outcome.persisted).toBe(false);
    expect(outcome.skippedReason).toContain('No current property identity version');
    expect(readDocumentIntelligence(deal.id).findings).toEqual([]);
  });
});

// ── 8-11. Separation: nothing here may move identity ───────────────────────

describe('separation from canonical identity', () => {
  it('persisting findings and a summary never touches the property card', async () => {
    const { dealCardId, cardId } = seedResolvedSubject();
    const before = getPropertyCardRow(cardId)!;
    await mineAndPersist(dealCardId);
    const after = getPropertyCardRow(cardId)!;

    expect(after.apn).toBe(before.apn);
    expect(after.county).toBe(before.county);
    expect(after.owner).toBe(before.owner);
    expect(after.acres).toBe(before.acres);
    expect(after.verification_status).toBe(before.verification_status);
    expect(readCurrentPropertyIdentity(dealCardId)!.apn).toBe('042 123.00');
  });

  it('a document that contradicts the accepted parcel cannot change it', async () => {
    const { dealCardId, cardId } = seedResolvedSubject();
    // A neighbouring parcel's facts arriving as evidence are refused by the
    // existing gate — the same gate, whatever the source document said.
    const refused = applyLaneEvidence(readResolverSubject(dealCardId)!, {
      apn: '047 094.00', owner: 'FERNVALE SPRINGS FARM LLC', county: 'Williamson', state: 'TN',
    }, 'official_document_context');
    expect(refused.applied).toBe(false);
    expect(refused.refusedFor.join(' ')).toMatch(/Parcel identifier conflict/i);

    await mineAndPersist(dealCardId);
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042 123.00');
    expect(card.owner).toBe('Landsouth, LLC');
    // And the summary itself carries no writable identity path.
    const summary = readDocumentIntelligence(dealCardId).summaries[0];
    expect(Object.keys(summary)).not.toContain('patch');
    expect(Object.keys(summary)).not.toContain('verified');
  });
});

// ── 12. Identity releases before enrichment and persistence ────────────────

describe('the critical path is unchanged', () => {
  it('releases the subject before findings or summary are written', async () => {
    // The real Fairview shape: an UNRESOLVED sparse lead, so the document lane
    // is what establishes the subject. (A lead that is already resolved takes
    // the retained fast path and never has a document to mine.)
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123', sellerNotes: 'Map 042 Parcel 123\nFairview, Tennessee' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN',
      summary: 'Map 042 Parcel 123\nFairview, Tennessee', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
    const dealCardId = deal.id;
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;

    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        indexed_web: async () => ({
          lane: 'indexed_web', status: 'evidence', note: 'Official document states Map 42 Parcel 123.00',
          source: { label: PACKET_TITLE, url: PACKET_URL, officiality: 'officially_linked' },
          fetchedDocuments: [document],
          anchorHints: { projectName: 'Kingwood Subdivision', address: null },
          patch: {
            apn: '042 123.00', county: 'Williamson', state: 'TN', owner: 'Landsouth, LLC', acres: 75.86,
            verified: true, verificationSource: 'Official Fairview government record',
          },
        }),
      },
      promote: promoteOffline,
    });

    // Released, with nothing persisted yet.
    expect(result.released).toBe(true);
    expect(readDocumentIntelligence(dealCardId).findings).toEqual([]);
    expect(readDocumentIntelligence(dealCardId).summaries).toEqual([]);

    await result.enrichment!;
    const stored = readDocumentIntelligence(dealCardId);
    expect(stored.findings.length).toBeGreaterThan(8);
    expect(stored.summaries).toHaveLength(1);
    expect(stored.summaries[0].sourceUrl).toBe(PACKET_URL);
    expect(stored.summaries[0].evidenceRefs.length).toBe(stored.findings.length);
  });
});

// ── 19-24. The summary itself ──────────────────────────────────────────────

describe('the detailed document summary', () => {
  it('reads the document type and date the document states', () => {
    expect(readDocumentType(PAGE_ONE)).toBe('Planning Commission Agenda');
    expect(readDocumentDate(PAGE_ONE)).toBe('January 14, 2025');
    expect(readDocumentType('an unlabelled letter about nothing')).toBeNull();
    expect(readDocumentDate('no date here')).toBeNull();
  });

  it('states material facts from across the document, not only the identity paragraph', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const summary = readDocumentIntelligence(dealCardId).summaries[0];
    const prose = summary.detailedSummary;

    expect(prose).toMatch(/planning commission agenda/i);
    expect(prose).toContain('January 14, 2025');
    expect(prose).toContain('Kingwood Subdivision');
    expect(prose).toContain('Landsouth, LLC');
    expect(prose).toContain('75.86');
    // Page-2 material the identity window never saw.
    expect(prose).toContain('91 single-family lots');
    expect(prose).toMatch(/sewer, water or utility service/i);
    expect(prose).toMatch(/wetlands, floodplain or streams/i);
    expect(prose).toMatch(/road improvements/i);
    expect(prose).toMatch(/topography or grading/i);
    expect(summary.pagesReferenced).toEqual([1, 2]);
  });

  it('keeps current zoning and requested zoning as separate facts', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const summary = readDocumentIntelligence(dealCardId).summaries[0];

    expect(summary.detailedSummary).toContain('The zoning in effect according to this document is R-20 POD');
    expect(summary.detailedSummary).toContain('A change to RS-15 POD');
    expect(summary.detailedSummary).toContain('REQUESTED');
    expect(summary.detailedSummary).toContain('not an approved zoning');
    const categories = summary.keyFindings.map((finding) => finding.category);
    expect(categories).toContain('current_zoning');
    expect(categories).toContain('requested_zoning');
  });

  it('keeps proposed distinct from approved, and does not conclude the outcome', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const summary = readDocumentIntelligence(dealCardId).summaries[0];
    expect(summary.detailedSummary).toContain('These are proposed figures');
    expect(summary.detailedSummary).toContain('does not decide from this document alone');
    expect(summary.limitations.join(' ')).toContain('final disposition is not concluded');
  });

  it('preserves conflicting values instead of silently normalizing them', async () => {
    const { dealCardId } = seedResolvedSubject();
    const conflicting = `${PAGE_ONE} A later staff note for Kingwood Subdivision Map: 42, Parcel: 123.00 records 74.90 Acres instead.`;
    await mineAndPersist(dealCardId, [conflicting, PAGE_TWO]);
    const summary = readDocumentIntelligence(dealCardId).summaries[0];

    expect(summary.detailedSummary).toContain('more than one acreage figure');
    expect(summary.detailedSummary).toContain('75.86');
    expect(summary.detailedSummary).toContain('74.90');
    expect(summary.detailedSummary).toContain('has not reconciled them');
    expect(summary.limitations.join(' ')).toContain('preserved unreconciled');
  });

  it('excludes the other parcel and says it did', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const stored = readDocumentIntelligence(dealCardId);
    const everything = `${stored.summaries[0].detailedSummary} ${stored.findings.map((finding) => finding.context).join(' ')}`;

    expect(everything).not.toContain('Fernvale');
    expect(everything).not.toContain('Cumberland');
    expect(everything).not.toContain('351.27');
    expect(stored.summaries[0].detailedSummary).toContain('concern other parcels and were deliberately excluded');
  });

  it('rests on the retained evidence rather than being an unsupported blob', async () => {
    const { dealCardId } = seedResolvedSubject();
    await mineAndPersist(dealCardId);
    const stored = readDocumentIntelligence(dealCardId);
    const summary = stored.summaries[0];

    expect(summary.evidenceRefs.length).toBe(stored.findings.length);
    expect(new Set(summary.evidenceRefs)).toEqual(new Set(stored.findings.map((finding) => finding.evidenceId)));
    expect(summary.keyFindings.length).toBe(stored.findings.length);
    expect(summary.sourceClassification).toBe('official_government_document');
    expect(summary.propertyIdentityVersionId).toBe(readCurrentPropertyIdentity(dealCardId)!.id);
  });

  it('preserves the limitation for an image-only document', () => {
    const scanned: OfficialPdfDocument = {
      url: 'https://www.fairview-tn.org/scan.pdf', fetchedAt: '2026-08-15T00:00:00.000Z',
      byteLength: 2048, pages: [], text: '', textLayer: false, fromCache: false,
    };
    const context = mineDocumentContext({ document: scanned, anchors: ANCHORS, dealCardId: 1 });
    const summary = composeOfficialDocumentSummary({
      context, subject: SUBJECT, documentKey: documentKeyFor(scanned.url), documentText: '',
    });
    expect(summary.confidence).toBe('low');
    expect(summary.limitations.join(' ')).toContain('no text layer');
    expect(summary.limitations.join(' ')).toContain('no optical recognition was attempted');
    expect(summary.keyFindings).toEqual([]);
  });
});
