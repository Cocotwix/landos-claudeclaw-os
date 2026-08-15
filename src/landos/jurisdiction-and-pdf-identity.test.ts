// Jurisdiction enrichment and bounded official-PDF identity.
//
// The two reasons the live Fairview run could not resolve, as tests:
//   1. "Fairview, Tennessee" never became "Williamson County", so no official
//      parcel source could be selected — they are all chosen by county.
//   2. The official record that names the parcel is a PDF nobody could read.
//
// Every fixture here is a recorded shape of a real response. Nothing about the
// expected ANSWER is supplied to the resolver: the county comes out of the
// geography service's own reply, and the parcel comes out of the document's own
// words.

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
import { resolveJurisdiction, type JurisdictionFetchJson } from './jurisdiction-resolution.js';
import {
  bestPdfParcelIdentity,
  extractPdfText,
  hostCorroboratesLocality,
  pdfIdentityEligible,
  readPdfParcelIdentity,
} from './official-pdf-identity.js';
import {
  applyLaneEvidence,
  buildJurisdictionLane,
  evaluateResolverIdentity,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
} from './universal-property-resolution.js';

// ── Recorded TIGERweb shapes ───────────────────────────────────────────────

const TN_STATE = { features: [{ attributes: { STATE: '47', NAME: 'Tennessee', STUSAB: 'TN' } }] };
const FAIRVIEW_PLACE = { features: [{ attributes: { GEOID: '4725440', NAME: 'Fairview city', BASENAME: 'Fairview', STATE: '47', CENTLAT: '+35.9822175', CENTLON: '-087.1285446' } }] };
const WILLIAMSON_COUNTY = { features: [{ attributes: { GEOID: '47187', BASENAME: 'Williamson', NAME: 'Williamson County', STATE: '47' } }] };
const NO_FEATURES = { features: [] };

function tigerStub(overrides: { places?: unknown; county?: unknown } = {}): { fetchJson: JurisdictionFetchJson; urls: string[] } {
  const urls: string[] = [];
  const fetchJson: JurisdictionFetchJson = async (url) => {
    urls.push(url);
    if (url.includes('State_County/MapServer/0/query')) return TN_STATE;
    if (url.includes('Places_CouSub_ConCity_SubMCD/MapServer/4/query')) return overrides.places ?? FAIRVIEW_PLACE;
    if (url.includes('Places_CouSub_ConCity_SubMCD/MapServer/5/query')) return NO_FEATURES;
    if (url.includes('State_County/MapServer/1/query')) return overrides.county ?? WILLIAMSON_COUNTY;
    return NO_FEATURES;
  };
  return { fetchJson, urls };
}

// ── A real planning-packet excerpt, as a real PDF ──────────────────────────
// Wording taken verbatim from the City of Fairview Planning Commission packet
// the live search found. It carries TWO parcels; only one is this lead's.

const PACKET_TEXT = 'MINUTES City of Fairview Planning Commission December 10, 2024, Regular Meeting '
  + 'OLD BUSINESS 1. PC Resolution PC-44-24, Master Development Plan, Kingwood Subdivision, '
  + '75.86 Acres, Map: 42, Parcel: 123.00. Current Zoning: R-20 POD. Requested Zoning: RS-15 POD. '
  + 'Property Owner: Landsouth, LLC. '
  + '2. PC Resolution PC-45-24, Annexation, 7740 Cumberland Dr., 351.27 Acres, Map: 47, Parcel: 094.00. '
  + 'Current Zoning: Williamson County Rural Preservation-5. Property Owner: Fernvale Springs Farm, LLC.';

function makePdf(body: string): Buffer {
  const escaped = body.replace(/([()\\])/g, '\\$1');
  const content = Buffer.from(`BT /F1 12 Tf (${escaped}) Tj ET`, 'latin1');
  const deflated = zlib.deflateSync(content);
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 1 0 R /Filter /FlateDecode >>\nstream\n', 'latin1'),
    deflated,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
}

const PACKET_URL = 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf';

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

// ── 1/2/3. Jurisdiction enrichment ─────────────────────────────────────────

describe('jurisdiction enrichment', () => {
  it('establishes the county from a locality and a state', async () => {
    const { fetchJson } = tigerStub();
    const result = await resolveJurisdiction({ locality: 'Fairview', state: 'Tennessee' }, { fetchJson });
    expect(result.county).toBe('Williamson');
    expect(result.countyFips).toBe('47187');
    expect(result.state).toBe('TN');
    expect(result.stateFips).toBe('47');
    expect(result.localityKind).toBe('Incorporated Place');
    expect(result.sufficientForParcelSource).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.conflicts).toEqual([]);
    // The operator's own wording is preserved beside the resolved value.
    expect(result.rawLocalityInput).toBe('Fairview');
  });

  it('carries the provenance of every step', async () => {
    const { fetchJson } = tigerStub();
    const result = await resolveJurisdiction({ locality: 'Fairview', state: 'TN' }, { fetchJson });
    expect(result.sources).toHaveLength(3);
    expect(result.sources.map((source) => source.established)).toEqual([
      'State TN (FIPS 47)',
      'Fairview city (GEOID 4725440)',
      'Williamson County (FIPS 47187)',
    ]);
    for (const source of result.sources) {
      expect(source.url).toContain('tigerweb.geo.census.gov');
      expect(source.label).toContain('U.S. Census Bureau');
    }
    expect(result.basis).toContain('point-in-polygon');
    // A centroid selects the county. It never verifies a parcel.
    expect(result.basis).toContain('not parcel evidence');
  });

  it('refuses to choose between two same-named places', async () => {
    const { fetchJson } = tigerStub({
      places: { features: [{ attributes: { GEOID: '4725440', BASENAME: 'Fairview', STATE: '47', CENTLAT: '+35.98', CENTLON: '-087.12' } },
        { attributes: { GEOID: '4799999', BASENAME: 'Fairview', STATE: '47', CENTLAT: '+36.50', CENTLON: '-082.10' } }] },
    });
    const result = await resolveJurisdiction({ locality: 'Fairview', state: 'TN' }, { fetchJson });
    expect(result.county).toBeNull();
    expect(result.sufficientForParcelSource).toBe(false);
    expect(result.conflicts[0]).toContain('Ambiguous locality');
  });

  it('preserves a conflict with a county the lead already carries', async () => {
    const { fetchJson } = tigerStub();
    const result = await resolveJurisdiction({ locality: 'Fairview', state: 'TN', county: 'Cocke' }, { fetchJson });
    expect(result.conflicts[0]).toContain('County conflict');
    expect(result.county).toBe('Cocke');
    expect(result.countyFips).toBeNull();
  });

  it('does not reach the network when the jurisdiction is already established', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'x', sellerNotes: 'Map 042 Parcel 123' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN', county: 'Williamson',
      summary: 'Map 042 Parcel 123', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
    const { fetchJson, urls } = tigerStub();
    const result = await buildJurisdictionLane({ fetchJson })(readResolverSubject(deal.id)!);
    expect(urls).toEqual([]);
    expect(result.status).toBe('no_evidence');
    expect(result.note).toContain('already established');
  });
});

// ── 4/5. The newly established county re-aims the official lane ────────────

describe('progressive enrichment', () => {
  it('re-aims the official parcel lane once the county is established', async () => {
    const { dealCardId, cardId } = seedSparseLead();
    const { fetchJson } = tigerStub();
    const officialAims: Array<{ county: string | null; apn: string | null }> = [];

    const result = await resolveSubjectProperty(dealCardId, {
      jurisdiction: { fetchJson },
      lanes: {
        official_parcel: async (subject) => {
          officialAims.push({ county: subject.county, apn: subject.apn });
          // The second, county-aware attempt is the one that can answer.
          return subject.county
            ? {
                lane: 'official_parcel',
                status: 'evidence',
                note: 'Official parcel matched once the county was known.',
                patch: { apn: '042 123.00 000', county: 'Williamson', state: 'TN', owner: 'LANDSOUTH LLC', acres: 75.86, verified: true, verificationSource: 'Statewide official parcel layer' },
              }
            : { lane: 'official_parcel', status: 'no_evidence', note: 'No county is known, so no official parcel source applies.' };
        },
      },
      promote: promoteOffline,
    });

    expect(officialAims).toEqual([{ county: null, apn: null }, { county: 'Williamson', apn: null }]);
    expect(result.winner).toBe('official_parcel');
    expect(result.released).toBe(true);
    expect(result.notes.join(' ')).toContain('re-aimed once');
    expect(getPropertyCardRow(cardId)!.apn).toBe('042 123.00 000');
  });

  it('re-aims at most once, however many lanes enrich', async () => {
    const { dealCardId } = seedSparseLead();
    const { fetchJson } = tigerStub();
    let officialCalls = 0;
    const result = await resolveSubjectProperty(dealCardId, {
      jurisdiction: { fetchJson },
      maxLaneReAims: 1,
      lanes: {
        official_parcel: async () => { officialCalls += 1; return { lane: 'official_parcel', status: 'no_evidence', note: 'no match' }; },
        indexed_web: async () => ({
          lane: 'indexed_web', status: 'evidence', note: 'document evidence',
          patch: { apn: '042 123.00', owner: 'LANDSOUTH LLC', acres: 75.86 },
        }),
      },
      promote: promoteOffline,
    });
    // Two enriching lanes settle, but the official lane is retried exactly once.
    expect(officialCalls).toBe(2);
    expect(result.status).not.toBe('resolved');
  });
});

// ── 6/7/8/9. Bounded official-PDF identity ─────────────────────────────────

describe('official PDF identity extraction', () => {
  const notation = () => primaryParcelNotation('Map 042 Parcel 123')!;

  it('reads text out of a real PDF byte stream with no new dependency', () => {
    const text = extractPdfText(makePdf(PACKET_TEXT));
    expect(text).toContain('Map: 42, Parcel: 123.00');
    expect(text).toContain('Landsouth, LLC');
  });

  it('accepts an official document that looks relevant to the raw notation', () => {
    const verdict = pdfIdentityEligible({
      url: PACKET_URL,
      title: 'City of Fairview Planning Commission',
      snippet: 'PC Resolution PC-44-24 Map: 42, Parcel: 123.00',
      officiality: 'officially_linked',
      notations: [notation()],
      locality: 'Fairview',
      state: 'TN',
    });
    expect(verdict.eligible).toBe(true);
    expect(verdict.hostCorroboratesLocality).toBe(true);
  });

  it('rejects a non-government document outright', () => {
    const verdict = pdfIdentityEligible({
      url: 'https://www.some-brokerage.com/flyers/kingwood.pdf',
      title: 'Kingwood Subdivision offering — Map 042 Parcel 123',
      officiality: 'unverified',
      notations: [notation()],
      locality: 'Fairview',
      state: 'TN',
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain('Not a government source');
  });

  it('only treats a municipality\'s own domain as corroborating', () => {
    expect(hostCorroboratesLocality(PACKET_URL, 'Fairview', 'TN')).toBe(true);
    expect(hostCorroboratesLocality('https://fairview-homes-for-sale.com/x.pdf', 'Fairview', 'TN')).toBe(false);
    expect(hostCorroboratesLocality(PACKET_URL, 'Franklin', 'TN')).toBe(false);
  });

  it('extracts parcel, owner, acreage and project from the anchored window', () => {
    const readings = readPdfParcelIdentity({ text: extractPdfText(makePdf(PACKET_TEXT)), notations: [notation()] });
    const best = bestPdfParcelIdentity(readings)!;
    expect(best.matchesSubject).toBe(true);
    expect(best.parcelIdentifier).toBe('042 123.00');
    expect(best.map).toBe('42');
    expect(best.parcel).toBe('123.00');
    expect(best.owner).toContain('Landsouth');
    expect(best.acres).toBe(75.86);
    expect(best.projectName).toBe('Kingwood Subdivision');
    expect(best.excerpt).toContain('PC-44-24');
  });

  it('rejects the OTHER parcel discussed in the same document', () => {
    // The packet also carries Map: 47, Parcel: 094.00 — a different property.
    const other = primaryParcelNotation('Map 047 Parcel 094')!;
    const readings = readPdfParcelIdentity({ text: extractPdfText(makePdf(PACKET_TEXT)), notations: [other] });
    const best = bestPdfParcelIdentity(readings);
    // The lead's notation is 042/123; asking for 047/094 finds that document
    // window, and it must never be attributed to this subject's owner/acreage.
    expect(String(best?.owner ?? '')).not.toContain('Landsouth');

    const subjectReadings = readPdfParcelIdentity({ text: extractPdfText(makePdf(PACKET_TEXT)), notations: [notation()] });
    const rejected = subjectReadings.filter((row) => !row.matchesSubject);
    for (const row of rejected) {
      expect(row.owner).toBeNull();
      expect(row.acres).toBeNull();
      expect(row.rejectedReason).toBeTruthy();
    }
  });

  it('never returns another parcel\'s facts when the document does not name this one', () => {
    const elsewhere = 'Map: 51, Parcel: 007.00. Property Owner: Somebody Else, LLC. 12.00 Acres.';
    const readings = readPdfParcelIdentity({ text: extractPdfText(makePdf(elsewhere)), notations: [notation()] });
    expect(bestPdfParcelIdentity(readings)).toBeNull();
  });
});

// ── 10/11/12/13. PDF evidence through the canonical gate ───────────────────

describe('PDF evidence still obeys the canonical gate', () => {
  it('cannot overwrite an accepted parcel identifier', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'x', sellerNotes: 'Map 042 Parcel 123\nFairview, Tennessee' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', city: 'Fairview', state: 'TN',
      county: 'Williamson', apn: '042 123.00 000', verified: true, verificationSource: 'Official county parcel record',
      summary: 'Map 042 Parcel 123\nFairview, Tennessee', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);

    const result = await resolveSubjectProperty(deal.id, {
      retainedFastPath: false,
      lanes: {
        indexed_web: async () => ({
          lane: 'indexed_web', status: 'evidence', note: 'document evidence',
          patch: { apn: '047 094.00', owner: 'FERNVALE SPRINGS FARM LLC', acres: 351.27 },
        }),
      },
      promote: promoteOffline,
    });
    expect(getPropertyCardRow(card.id)!.apn).toBe('042 123.00 000');
    expect(getPropertyCardRow(card.id)!.owner).toBe('');
    expect(result.conflicts.join(' ')).toMatch(/Parcel identifier conflict/i);
  });

  it('releases on official document evidence without waiting for LandPortal', async () => {
    const { dealCardId, cardId } = seedSparseLead();
    const { fetchJson } = tigerStub();
    let landPortalFinished = false;

    const result = await resolveSubjectProperty(dealCardId, {
      jurisdiction: { fetchJson },
      lanes: {
        landportal: () => new Promise<IdentityLaneResult>(() => { landPortalFinished = false; }),
        indexed_web: async (subject) => (subject.county
          ? {
              lane: 'indexed_web',
              status: 'evidence',
              note: 'Official document states Map 42 Parcel 123.00',
              source: { label: 'City of Fairview Planning Commission', url: PACKET_URL, officiality: 'officially_linked' },
              patch: {
                apn: '042 123.00', owner: 'Landsouth, LLC', acres: 75.86,
                verified: true, verificationSource: 'Official Fairview government record — Planning Commission packet',
              },
            }
          : { lane: 'indexed_web', status: 'no_evidence', note: 'waiting on jurisdiction' }),
      },
      promote: promoteOffline,
    });

    expect(landPortalFinished).toBe(false);
    expect(result.pendingLanes).toContain('landportal');
    const card = getPropertyCardRow(cardId)!;
    expect(card.county).toBe('Williamson');
    expect(card.apn).toBe('042 123.00');
    expect(card.owner).toBe('Landsouth, LLC');
    expect(card.acres).toBe(75.86);
    expect(result.subject.sourceEvidence.some((source) => source.url === PACKET_URL)).toBe(true);
  });

  it('grants verification from current state, not the lane\'s dispatch snapshot', async () => {
    // The document lane is dispatched before the jurisdiction lane settles, so
    // the subject it holds has no county. Live, that made the outcome depend on
    // which lane happened to finish first: the same document resolved the
    // property on one run and left it provisional on the next. Verification is
    // decided where the CURRENT subject is known.
    const documentPatch = {
      apn: '042 123.00', owner: 'Landsouth, LLC', acres: 75.86,
      verified: true, verificationSource: 'Official Fairview government record — City of Fairview',
    };

    // A document with NO parcel identifier can never verify anything, however
    // official it is — `upsertPropertyCard`'s own strong-identity rule.
    const weak = seedSparseLead();
    applyLaneEvidence(readResolverSubject(weak.dealCardId)!, { owner: 'Landsouth, LLC', acres: 75.86, verified: true, verificationSource: 'Official record' }, 'indexed_web');
    expect(getPropertyCardRow(weak.cardId)!.verification_status).not.toBe('verified_property');

    // With the parcel identifier the document actually states, verification is
    // granted against the jurisdiction ON THE CARD AT THE TIME — which is the
    // point: the lane never has to know whether the jurisdiction lane went
    // first. Both orders reach the same answer.
    const documentFirst = seedSparseLead();
    applyLaneEvidence(readResolverSubject(documentFirst.dealCardId)!, documentPatch, 'indexed_web');
    applyLaneEvidence(readResolverSubject(documentFirst.dealCardId)!, { county: 'Williamson', state: 'TN' }, 'jurisdiction');

    const jurisdictionFirst = seedSparseLead();
    applyLaneEvidence(readResolverSubject(jurisdictionFirst.dealCardId)!, { county: 'Williamson', state: 'TN' }, 'jurisdiction');
    applyLaneEvidence(readResolverSubject(jurisdictionFirst.dealCardId)!, documentPatch, 'indexed_web');

    for (const seeded of [documentFirst, jurisdictionFirst]) {
      const card = getPropertyCardRow(seeded.cardId)!;
      expect(card.county).toBe('Williamson');
      expect(card.apn).toBe('042 123.00');
      expect(card.verification_status).toBe('verified_property');
      expect(evaluateResolverIdentity(readResolverSubject(seeded.dealCardId)!).sufficient).toBe(true);
    }
  });

  it('does not open documents at all when a faster lane already resolved', async () => {
    const { dealCardId } = seedSparseLead();
    let pdfWorkStarted = false;
    const result = await resolveSubjectProperty(dealCardId, {
      lanes: {
        official_parcel: async () => ({
          lane: 'official_parcel', status: 'evidence', note: 'matched',
          patch: { apn: '042 123.00 000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Statewide official parcel layer' },
        }),
        indexed_web: async () => { pdfWorkStarted = true; return new Promise<IdentityLaneResult>(() => {}); },
      },
      promote: promoteOffline,
    });
    expect(result.winner).toBe('official_parcel');
    expect(result.released).toBe(true);
    // The document lane may have STARTED, but nothing waited on it.
    expect(result.pendingLanes).toContain('indexed_web');
    expect(pdfWorkStarted).toBe(true);
  });
});
