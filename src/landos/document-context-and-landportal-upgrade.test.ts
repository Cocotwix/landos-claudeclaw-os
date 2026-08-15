// Two refinements, as tests.
//
//  1. A document LandOS already downloaded is mined in full AFTER the subject
//     is released — identity stays on the fast path, and the rest of the packet
//     is not thrown away for a later sprint to fetch again.
//  2. LandPortal, still searching on the raw lead when the resolver produced a
//     far stronger subject, gets exactly ONE upgraded lookup package.
//
// The document text is the real Fairview passage the live run read, including
// the second agenda item for somebody else's parcel.

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

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { primaryParcelNotation } from './parcel-notation.js';
import {
  clearOfficialPdfCache,
  loadOfficialPdf,
  officialPdfCacheSize,
} from './official-pdf-identity.js';
import {
  clearDiscoveredContext,
  discoveredContextFor,
  mineDocumentContext,
  passageIsAboutAnotherParcel,
  subjectAnchorIn,
  type SubjectAnchors,
} from './official-document-context.js';
import { buildLandPortalSearchPackage } from './landportal-subject-upgrade.js';
import {
  applyLaneEvidence,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
} from './universal-property-resolution.js';

// ── The real document, as pages ────────────────────────────────────────────

const PAGE_ONE = 'MINUTES City of Fairview Planning Commission December 10, 2024, Regular Meeting. '
  + 'OLD BUSINESS 1. PC Resolution PC-44-24, Master Development Plan, Kingwood Subdivision, 75.86 Acres, '
  + 'Map: 42, Parcel: 123.00. Current Zoning: R-20 POD. Requested Zoning: RS-15 POD. Property Owner: Landsouth, LLC. '
  + '2. PC Resolution PC-45-24, Annexation, 7740 Cumberland Dr., 351.27 Acres, Map: 47, Parcel: 094.00. '
  + 'Current Zoning: Williamson County Rural Preservation-5. Property Owner: Fernvale Springs Farm, LLC.';

const PAGE_TWO = 'Discussion of the Kingwood Subdivision master development plan continued. '
  + 'The applicant is Landsouth, LLC, represented by its project engineer. '
  + 'The plan proposes 143 single-family lots on the 75.86 acres. '
  + 'Sewer capacity and water service along Kingwood Blvd were discussed at length. '
  + 'A wetlands delineation and a stream buffer were identified along the eastern boundary. '
  + 'Road improvements including a turn lane at the entrance will be required. '
  + 'The Commission recommended approval subject to the engineering comments. '
  + 'Unrelated item: the Commission also reviewed a site plan for Map: 47, Parcel: 094.00, proposing 12 lots.';

const PACKET_URL = 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf';

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

function seedResolvedLead(): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123', sellerNotes: 'Map 042 Parcel 123\nFairview, Tennessee' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN',
    summary: 'Map 042 Parcel 123\nFairview, Tennessee', agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

const promoteOffline = (dealCardId: number, actor: string) =>
  reconcileSubjectIdentity(dealCardId, { actor, censusGeography: null });
const neverSettles = (): Promise<IdentityLaneResult> => new Promise(() => {});

beforeEach(() => {
  _initTestLandosDb();
  clearOfficialPdfCache();
  clearDiscoveredContext();
});

// ── 2/3/4/9. The document is fetched once and mined in full ────────────────

describe('official document enrichment', () => {
  it('fetches and parses the document exactly once, however many readers want it', async () => {
    const { fetchImpl, calls } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const first = await loadOfficialPdf(PACKET_URL, { fetchImpl });
    const second = await loadOfficialPdf(PACKET_URL, { fetchImpl });
    const third = await loadOfficialPdf(PACKET_URL, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(first!.fromCache).toBe(false);
    expect(second!.fromCache).toBe(true);
    expect(third!.fromCache).toBe(true);
    expect(officialPdfCacheSize()).toBe(1);
    expect(first!.pages).toHaveLength(2);
    expect(first!.textLayer).toBe(true);
  });

  it('retains subject-specific findings from the whole document, not just the identity window', async () => {
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const mined = mineDocumentContext({ document, anchors: ANCHORS, dealCardId: 1 });

    const byCategory = new Map(mined.findings.map((finding) => [finding.category, finding]));
    // Page 1: the passage that identified the parcel also states its zoning.
    expect(byCategory.get('current_zoning')?.value).toBe('R-20 POD');
    expect(byCategory.get('requested_zoning')?.value).toBe('RS-15 POD');
    expect(byCategory.get('project_name')?.value).toBe('Kingwood Subdivision');
    // Page 2: material the identity window never saw.
    expect(byCategory.get('lot_count_or_density')?.value).toContain('143');
    expect(byCategory.has('utilities_sewer_water')).toBe(true);
    expect(byCategory.has('wetlands_floodplain_stream')).toBe(true);
    expect(byCategory.has('road_improvement')).toBe(true);
    expect(byCategory.has('governing_body_action')).toBe(true);
    expect(byCategory.has('applicant_or_representative')).toBe(true);
    expect(byCategory.has('subdivision_or_development_proposal')).toBe(true);
    expect(mined.pagesScanned).toBe(2);
  });

  it('ignores other parcels and unrelated agenda items in the same document', async () => {
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const mined = mineDocumentContext({ document, anchors: ANCHORS, dealCardId: 1 });

    const everything = mined.findings.map((finding) => finding.context).join(' ');
    expect(everything).not.toContain('Fernvale');
    expect(everything).not.toContain('Cumberland');
    expect(everything).not.toContain('351.27');
    expect(everything).not.toContain('12 lots');
    expect(mined.skippedForOtherParcel).toBeGreaterThan(0);

    // The rule itself, directly.
    expect(passageIsAboutAnotherParcel('PC-45-24, Map: 47, Parcel: 094.00, Fernvale Springs Farm, LLC.', ANCHORS)).toBe(true);
    expect(passageIsAboutAnotherParcel('Kingwood Subdivision, Map: 42, Parcel: 123.00.', ANCHORS)).toBe(false);
    expect(subjectAnchorIn('The Kingwood Subdivision plan was reviewed.', ANCHORS)).toContain('Kingwood Subdivision');
    expect(subjectAnchorIn('An unrelated rezoning on Old Hickory Blvd.', ANCHORS)).toBeNull();
  });

  it('preserves provenance on every retained finding', async () => {
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const mined = mineDocumentContext({ document, anchors: ANCHORS, dealCardId: 1 });

    expect(mined.findings.length).toBeGreaterThan(4);
    for (const finding of mined.findings) {
      expect(finding.sourceUrl).toBe(PACKET_URL);
      expect(finding.page).toBeGreaterThanOrEqual(1);
      expect(finding.pageBasis).toBe('approximate_content_stream_order');
      expect(finding.sourceClassification).toBe('official_government_document');
      expect(finding.retrievedAt).toBe(document.fetchedAt);
      expect(finding.context.length).toBeGreaterThan(10);
      expect(finding.matchedBy).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(finding.confidence);
    }
    // Page attribution is real: page-2 material cites page 2.
    expect(mined.findings.find((finding) => finding.category === 'lot_count_or_density')?.page).toBe(2);
  });

  it('preserves the limitation honestly when a document is an image-only scan', async () => {
    const scanned = {
      url: 'https://www.fairview-tn.org/scan.pdf', fetchedAt: '2026-08-14T00:00:00.000Z',
      byteLength: 1024, pages: [], text: '', textLayer: false, fromCache: false,
    };
    const mined = mineDocumentContext({ document: scanned, anchors: ANCHORS });
    expect(mined.findings).toEqual([]);
    expect(mined.textLayer).toBe(false);
    expect(mined.note).toContain('image-only scan');
    expect(mined.note).toContain('no optical recognition was attempted');
  });
});

// ── 1/5/6. Identity releases first; context can never move identity ────────

describe('identity and discovered context stay separate', () => {
  it('releases the subject before enrichment has run, then keeps the context', async () => {
    const { dealCardId, cardId } = seedResolvedLead();
    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;

    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        indexed_web: async () => ({
          lane: 'indexed_web',
          status: 'evidence',
          note: 'Official document states Map 42 Parcel 123.00',
          source: { label: 'City of Fairview', url: PACKET_URL, officiality: 'officially_linked' },
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

    // Released, and nothing was mined yet.
    expect(result.released).toBe(true);
    expect(result.winner).toBe('indexed_web');
    expect(discoveredContextFor(dealCardId)).toEqual([]);

    // Enrichment finishes afterwards, on the document already in hand.
    const mined = await result.enrichment!;
    expect(mined).toHaveLength(1);
    expect(discoveredContextFor(dealCardId)[0].findings.length).toBeGreaterThan(4);
    expect(discoveredContextFor(dealCardId)[0].sourceUrl).toBe(PACKET_URL);

    // Identity is exactly what it was before enrichment ran.
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042 123.00');
    expect(card.county).toBe('Williamson');
    expect(card.owner).toBe('Landsouth, LLC');
  });

  it('cannot change canonical identity, whatever the document says', async () => {
    const { dealCardId, cardId } = seedResolvedLead();
    applyLaneEvidence(readResolverSubject(dealCardId)!, {
      apn: '042 123.00', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Official record',
    }, 'indexed_web');

    const { fetchImpl } = pdfFetch([PAGE_ONE, PAGE_TWO]);
    const document = (await loadOfficialPdf(PACKET_URL, { fetchImpl }))!;
    const mined = mineDocumentContext({ document, anchors: ANCHORS, dealCardId });

    // Discovered context is a finding ABOUT an identified property. There is no
    // path from it into the property record: it carries no patch, and the store
    // it lands in is separate from the card entirely.
    expect(Object.keys(mined.findings[0])).not.toContain('patch');
    const before = getPropertyCardRow(cardId)!;
    expect(before.apn).toBe('042 123.00');
    expect(before.acres).toBeNull();
    expect(discoveredContextFor(dealCardId)).toEqual([]);
  });
});

// ── 10-16. The bounded LandPortal subject upgrade ──────────────────────────

describe('LandPortal subject upgrade', () => {
  const intake = { state: 'TN', city: 'Fairview', address: 'Map 042 Parcel 123' };
  const resolved = {
    state: 'TN', county: 'Williamson', city: 'Fairview', apn: '042 123.00',
    owner: 'Landsouth, LLC', acres: 75.86, address: 'Map 042 Parcel 123', fips: '47187',
  };

  it('builds the enriched package in strength order', () => {
    const pkg = buildLandPortalSearchPackage(resolved, intake);
    expect(pkg.strongerThanIntake).toBe(true);
    expect(pkg.attempts.map((attempt) => attempt.strategy)).toEqual(['apn_and_jurisdiction', 'owner_and_jurisdiction']);
    expect(pkg.attempts[0].keys).toMatchObject({ apn: '042 123.00', county: 'Williamson', state: 'TN', fips: '47187' });
    expect(pkg.attempts[1].keys).toMatchObject({ owner: 'Landsouth, LLC', county: 'Williamson', state: 'TN' });
    expect(pkg.gainedOverIntake.join(' ')).toContain('Williamson');
    expect(pkg.gainedOverIntake.join(' ')).toContain('042 123.00');
    expect(pkg.gainedOverIntake.join(' ')).toContain('Landsouth');
    // Owner is a lookup key, never an authority claim.
    expect(pkg.attempts[1].rationale).toContain('never a seller-authority claim');
  });

  it('prefers LandPortal\'s own canonical record when one exists', () => {
    const pkg = buildLandPortalSearchPackage(
      { ...resolved, landPortalParcelUrl: 'https://landportal.com/?property=abc', landPortalPropertyId: '172954755' },
      intake,
    );
    expect(pkg.attempts[0].strategy).toBe('retained_parcel_url');
    expect(pkg.attempts[1].strategy).toBe('property_id_and_fips');
  });

  it('offers nothing when the resolver added nothing LandPortal did not have', () => {
    const pkg = buildLandPortalSearchPackage(resolved, resolved);
    expect(pkg.strongerThanIntake).toBe(false);
    expect(pkg.reason).toContain('nothing the LandPortal workflow did not already have');
  });

  it('offers the upgrade once, only while LandPortal is still unresolved', async () => {
    const { dealCardId } = seedResolvedLead();
    const offered: string[] = [];
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        indexed_web: async () => ({
          lane: 'indexed_web', status: 'evidence', note: 'document evidence',
          patch: {
            apn: '042 123.00', county: 'Williamson', state: 'TN', owner: 'Landsouth, LLC', acres: 75.86,
            verified: true, verificationSource: 'Official Fairview government record',
          },
        }),
      },
      onLandPortalUpgrade: ({ package: pkg }) => { offered.push(pkg.attempts[0].strategy); },
      promote: promoteOffline,
    });

    expect(result.released).toBe(true);
    expect(result.pendingLanes).toContain('landportal');
    expect(offered).toEqual(['apn_and_jurisdiction']);
    expect(result.landPortalUpgrade?.strongerThanIntake).toBe(true);
    expect(result.landPortalUpgrade?.county).toBe('Williamson');
    expect(result.landPortalUpgrade?.owner).toBe('Landsouth, LLC');
    expect(result.landPortalUpgrade?.acres).toBe(75.86);
    expect(result.notes.join(' ')).toContain('still working the raw lead');
  });

  it('does not offer an upgrade when LandPortal already finished', async () => {
    const { dealCardId } = seedResolvedLead();
    const offered: string[] = [];
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: async () => ({
          lane: 'landportal', status: 'evidence', note: 'LandPortal resolved the subject itself.',
          patch: {
            apn: '042 123.00', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'LandPortal authenticated parcel panel',
          },
        }),
      },
      onLandPortalUpgrade: ({ package: pkg }) => { offered.push(pkg.reason); },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('landportal');
    expect(offered).toEqual([]);
    expect(result.landPortalUpgrade).toBeUndefined();
  });

  it('cannot let a conflicting LandPortal candidate replace the resolved subject', async () => {
    const { dealCardId, cardId } = seedResolvedLead();
    applyLaneEvidence(readResolverSubject(dealCardId)!, {
      apn: '042 123.00', county: 'Williamson', state: 'TN', owner: 'Landsouth, LLC',
      verified: true, verificationSource: 'Official Fairview government record',
    }, 'indexed_web');

    // The upgraded LandPortal search lands on a neighbouring parcel.
    const refused = applyLaneEvidence(readResolverSubject(dealCardId)!, {
      apn: '047 094.00', county: 'Williamson', state: 'TN', owner: 'FERNVALE SPRINGS FARM LLC',
    }, 'landportal-subject-upgrade');

    expect(refused.applied).toBe(false);
    expect(refused.refusedFor.join(' ')).toMatch(/Parcel identifier conflict/i);
    const card = getPropertyCardRow(cardId)!;
    expect(card.apn).toBe('042 123.00');
    expect(card.owner).toBe('Landsouth, LLC');
  });

  it('leaves the confirmed subject and downstream release untouched when LandPortal never resolves', async () => {
    const { dealCardId } = seedResolvedLead();
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        landportal: neverSettles,
        official_parcel: async () => ({
          lane: 'official_parcel', status: 'evidence', note: 'matched',
          patch: { apn: '042 123.00', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Statewide official parcel layer' },
        }),
      },
      promote: promoteOffline,
    });
    expect(result.status).toBe('resolved');
    expect(result.identityState).toBe('confirmed');
    expect(result.releasedEarly).toBe(true);
    expect(result.pendingLanes).toEqual(['landportal']);
  });
});
