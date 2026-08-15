// LIVE Fairview acceptance — real keyless search, real government pages.
//
// This harness is OFF by default. It performs real outbound network requests,
// so it runs only when the operator asks for it:
//
//     LANDOS_LIVE_SEARCH=1 npx vitest run src/landos/universal-resolution-fairview.live.test.ts
//
// What it is allowed to use, and nothing else:
//   • the governed keyless search capability (pinned ddgs in the Hermes venv),
//   • the shared government text transport for opening pages,
//   • the existing official/statewide parcel lookup over plain HTTP.
//
// What it must never use: the dedicated Chrome/CDP session, any other browser,
// any paid API, any key. The LandPortal lane is therefore represented by a lane
// that stays running for its real 300-second window — which is exactly the
// condition under test: the resolver must release without it.
//
// Nothing about the expected answer is supplied. The input is two lines.

import { beforeAll, describe, expect, it, vi } from 'vitest';

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
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';
import { lookupOfficialParcel } from './public-property-intelligence-live.js';
import {
  buildIdentityDiscoveryQueries,
  buildIndexedWebIdentityLane,
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneRecord,
  type IdentityLaneResult,
} from './universal-property-resolution.js';
import { createHermesFreeSearch, hermesFreeSearchAvailability } from './hermes-free-search.js';
import { defaultGovFetchText } from './gis-transport.js';
import { clearOfficialPdfCache } from './official-pdf-identity.js';
import { clearDiscoveredContext } from './official-document-context.js';
import { readDocumentIntelligence } from './official-document-intelligence-store.js';

const LIVE = process.env.LANDOS_LIVE_SEARCH === '1';
const FAIRVIEW_SPARSE_INPUT = 'Map 042 Parcel 123\nFairview, Tennessee';

describe.skipIf(!LIVE)('LIVE Fairview acceptance', () => {
  beforeAll(() => { _initTestLandosDb(); });

  it('resolves — or honestly fails to resolve — the sparse lead through real public discovery', async () => {
    const availability = await hermesFreeSearchAvailability();
    // eslint-disable-next-line no-console
    console.log('[live] governed search capability:', JSON.stringify(availability));
    expect(availability.available).toBe(true);

    // ── The lead, exactly as it arrived ─────────────────────────────────────
    const parsed = parseConversationalLeadIntake(FAIRVIEW_SPARSE_INPUT);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: parsed.propertyLabel, sellerNotes: parsed.rawInput });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: parsed.propertyLabel,
      ...(parsed.city ? { city: parsed.city } : {}),
      ...(parsed.state ? { state: parsed.state } : {}),
      verified: false,
      summary: parsed.rawInput,
      agentId: 'live-acceptance',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);

    const subject = readResolverSubject(deal.id)!;
    // eslint-disable-next-line no-console
    console.log('[live] subject as stored:', JSON.stringify({
      address: subject.address, city: subject.city, county: subject.county, state: subject.state,
      apn: subject.apn, notations: subject.notations.map((n) => n.raw),
    }));
    // eslint-disable-next-line no-console
    console.log('[live] queries:', JSON.stringify(buildIdentityDiscoveryQueries(subject, 3), null, 1));

    // ── The lanes. All real except LandPortal, which needs the browser the
    //    parallel UI sprint owns; it therefore stands in as a lane that is
    //    still running for its real 300-second window.
    let landPortalFinished = false;
    const landPortalLane = (): Promise<IdentityLaneResult> => new Promise((resolve) => {
      setTimeout(() => {
        landPortalFinished = true;
        resolve({ lane: 'landportal', status: 'no_evidence', note: 'LandPortal capture window elapsed.' });
      }, 300_000).unref?.();
    });

    let officialFinishedMs: number | null = null;
    const startedMs = Date.now();
    // Re-runnable and subject-aware: a re-aim after the jurisdiction lane
    // establishes the county queries with that county.
    const officialLane = async (aimed: typeof subject): Promise<IdentityLaneResult> => {
      // eslint-disable-next-line no-console
      console.log('[live] official lane aimed at:', JSON.stringify({ county: aimed.county, state: aimed.state, apn: aimed.apn }));
      const lookup = await lookupOfficialParcel(
        { address: aimed.address ?? undefined, county: aimed.county ?? undefined, state: aimed.state ?? undefined, apn: aimed.apn ?? undefined },
        25_000,
      );
      officialFinishedMs = Date.now() - startedMs;
      // eslint-disable-next-line no-console
      console.log('[live] official lane:', JSON.stringify({ status: lookup.status, attempted: lookup.attempted, ms: officialFinishedMs }));
      return lookup.parcel
        ? {
            lane: 'official_parcel',
            status: 'evidence',
            note: `Official parcel matched by ${lookup.parcel.provider}.`,
            source: { label: lookup.parcel.provider, url: lookup.parcel.sourceUrl, officiality: 'official' },
            patch: {
              apn: lookup.parcel.apn, county: lookup.parcel.county, state: lookup.parcel.state,
              owner: lookup.parcel.owner, acres: lookup.parcel.acres, address: lookup.parcel.address,
              verified: true, verificationSource: lookup.parcel.provider,
            },
          }
        : { lane: 'official_parcel', status: 'no_evidence', note: `No official parcel matched (${lookup.status}).` };
    };

    const settled: IdentityLaneRecord[] = [];
    const result = await resolveSubjectProperty(deal.id, {
      actor: 'live-fairview-acceptance',
      deadlineMs: 180_000,
      lanes: { official_parcel: officialLane, landportal: landPortalLane },
      // Real federal geography. No county is supplied to it.
      jurisdiction: { timeoutMs: 15_000 },
      indexedWeb: {
        search: createHermesFreeSearch(),
        fetchText: defaultGovFetchText,
        maxQueries: 4,
        maxPages: 5,
        timeoutMs: 25_000,
      },
      onLaneSettled: (record) => {
        settled.push(record);
        // eslint-disable-next-line no-console
        console.log(`[live] lane settled: ${record.lane} status=${record.status} ms=${record.durationMs} note=${record.note.slice(0, 200)}`);
      },
    });

    const elapsedMs = Date.now() - startedMs;
    const finalCard = getPropertyCardRow(card.id)!;
    // eslint-disable-next-line no-console
    console.log('[live] RESULT:', JSON.stringify({
      status: result.status,
      winner: result.winner,
      released: result.released,
      releasedEarly: result.releasedEarly,
      identityState: result.identityState,
      discoveryUsable: result.discoveryUsable,
      elapsedMs,
      resolverElapsedMs: result.elapsedMs,
      pendingLanes: result.pendingLanes,
      landPortalFinished,
      conflicts: result.conflicts,
      notes: result.notes,
      lanes: result.lanes.map((lane) => ({ lane: lane.lane, status: lane.status, ms: lane.durationMs, applied: lane.applied, source: lane.source })),
      subject: result.subject,
      card: {
        apn: finalCard.apn, county: finalCard.county, state: finalCard.state, city: finalCard.city,
        owner: finalCard.owner, acres: finalCard.acres, address: finalCard.active_input_address,
        verification_status: finalCard.verification_status, verification_source: finalCard.verification_source,
      },
    }, null, 1));

    // ── The document already fetched, mined AFTER release ──────────────────
    const releasedAtMs = Date.now() - startedMs;
    const beforeEnrichment = readDocumentIntelligence(deal.id);
    const miningStartedMs = Date.now() - startedMs;
    const mined = await (result.enrichment ?? Promise.resolve([]));
    const enrichmentDoneMs = Date.now() - startedMs;

    // ── Durable, and reloadable without the PDF ────────────────────────────
    // Everything in process is discarded first: the parsed-document cache and
    // the in-memory context store. What comes back comes out of SQLite.
    clearOfficialPdfCache();
    clearDiscoveredContext();
    const reloaded = readDocumentIntelligence(deal.id);
    // eslint-disable-next-line no-console
    console.log('[live] TIMING:', JSON.stringify({
      releasedAtMs, miningStartedMs, enrichmentDoneMs,
      findingsBeforeEnrichment: beforeEnrichment.findings.length,
      summariesBeforeEnrichment: beforeEnrichment.summaries.length,
    }));
    // eslint-disable-next-line no-console
    console.log('[live] RELOADED FROM DB:', JSON.stringify({
      findings: reloaded.findings.length,
      summaries: reloaded.summaries.length,
      documents: reloaded.documents,
      categories: [...new Set(reloaded.findings.map((finding) => finding.category))].sort(),
      pages: [...new Set(reloaded.findings.map((finding) => finding.page))].sort((a, b) => (a ?? 0) - (b ?? 0)),
    }, null, 1));
    for (const summary of reloaded.summaries) {
      // eslint-disable-next-line no-console
      console.log('[live] DETAILED SUMMARY:', JSON.stringify({
        sourceUrl: summary.sourceUrl, sourceTitle: summary.sourceTitle,
        documentType: summary.documentType, documentDate: summary.documentDate,
        confidence: summary.confidence, pagesReferenced: summary.pagesReferenced,
        evidenceRefs: summary.evidenceRefs.length, limitations: summary.limitations,
        detailedSummary: summary.detailedSummary,
      }, null, 1));
    }
    // eslint-disable-next-line no-console
    console.log('[live] DISCOVERED CONTEXT:', JSON.stringify(mined.map((document) => ({
      sourceUrl: document.sourceUrl,
      textLayer: document.textLayer,
      pagesScanned: document.pagesScanned,
      skippedForOtherParcel: document.skippedForOtherParcel,
      findings: document.findings.map((finding) => ({
        category: finding.category, value: finding.value, page: finding.page,
        matchedBy: finding.matchedBy, confidence: finding.confidence,
        context: finding.context.slice(0, 160),
      })),
    })), null, 1));
    // eslint-disable-next-line no-console
    console.log('[live] LANDPORTAL UPGRADE:', JSON.stringify(result.landPortalUpgrade ?? null, null, 1));

    // The acceptance assertion is about BEHAVIOUR, never about a fact the run
    // was told: LandPortal must still be unfinished, and the raw input must
    // never have carried the answer.
    expect(landPortalFinished).toBe(false);
    expect(FAIRVIEW_SPARSE_INPUT).toBe('Map 042 Parcel 123\nFairview, Tennessee');
  }, 400_000);

  it('reports what the real search actually returns for the raw notation', async () => {
    const search = createHermesFreeSearch();
    const queries = [
      '"Map 042" "Parcel 123" Fairview Tennessee',
      '"Map 042" "Parcel 123" Fairview Tennessee parcel assessor property record',
      '"042-123" Fairview Tennessee parcel',
    ];
    for (const query of queries) {
      const hits = await search(query, { maxResults: 8, timeoutMs: 25_000 });
      // eslint-disable-next-line no-console
      console.log(`[live] "${query}" →`, JSON.stringify(hits.map((hit) => hit.url), null, 1));
      expect(Array.isArray(hits)).toBe(true);
    }
  }, 200_000);
});

describe.skipIf(LIVE)('live Fairview acceptance harness', () => {
  it('is skipped unless LANDOS_LIVE_SEARCH=1', () => {
    expect(LIVE).toBe(false);
  });
});
