// LIVE Fairview acceptance for the POST-RESOLUTION intelligence layer.
//
// OFF by default. It performs real outbound requests, so it runs only when the
// operator asks for it:
//
//   LANDOS_LIVE_SEARCH=1 npx vitest run src/landos/fairview-post-resolution.live.test.ts
//
// The chain under test, end to end, from two lines of raw lead:
//
//   Map 042 Parcel 123 / Fairview, Tennessee
//     → Universal Property Resolution (unchanged, production path)
//     → Property Backstory        (retained document intelligence first)
//     → Controlling land-use authority
//     → CURRENT zoning            (or an honest "unresolved")
//     → Subdivision regulations   (with ordinance sections)
//     → Property-specific subdivision read
//     → Pre-Call Intelligence handoff and its seller questions
//
// Allowed: the governed keyless search, the shared government text transport,
// the bounded PDF reader, direct ArcGIS REST, and the federal Census geography.
// Never: Chrome/CDP, any paid API, any key, any LandPortal action.
//
// Nothing about the expected answer is supplied. Every discovered fact is
// printed so the operator can check the sourcing rather than take the assertions
// on trust.

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
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { lookupOfficialParcel } from './public-property-intelligence-live.js';
import {
  readResolverSubject,
  resolveSubjectProperty,
  type IdentityLaneResult,
} from './universal-property-resolution.js';
import { createHermesFreeSearch, hermesFreeSearchAvailability } from './hermes-free-search.js';
import { defaultGovFetchText } from './gis-transport.js';
import { clearOfficialPdfCache } from './official-pdf-identity.js';
import { clearDiscoveredContext } from './official-document-context.js';
import { readDocumentIntelligence } from './official-document-intelligence-store.js';
import { resolveJurisdiction } from './jurisdiction-resolution.js';

import { runPropertyBackstory } from './property-backstory-run.js';
import { readPropertyBackstory } from './property-backstory-store.js';
import { discoverZoningLayers } from './zoning-layer-discovery.js';
import { resolveControllingLandUseAuthority } from './controlling-land-use-authority.js';
import { attachHistoricalZoning, determineCurrentZoning } from './current-zoning-determination.js';
import { researchZoningStandards } from './zoning-standards-research.js';
import { describeRace } from './land-use-source-race.js';
import { retrieveSubdivisionRegulations } from './subdivision-regulations.js';
import { buildPropertySubdivisionRead } from './subdivision-property-read.js';
import {
  persistControllingAuthority,
  persistCurrentZoning,
  persistPropertySubdivisionRead,
  persistSubdivisionRegulations,
  persistZoningStandards,
  readControllingAuthority,
  readCurrentZoning,
  readPropertySubdivisionRead,
  readSubdivisionRegulations,
  readZoningStandards,
} from './land-use-intelligence-store.js';
import { readPreCallIntelligenceHandoff } from './pre-call-intelligence-handoff.js';

const LIVE = process.env.LANDOS_LIVE_SEARCH === '1';
const FAIRVIEW_SPARSE_INPUT = 'Map 042 Parcel 123\nFairview, Tennessee';

/* eslint-disable no-console */
const log = (label: string, payload: unknown): void => {
  console.log(`[live] ${label}: ${JSON.stringify(payload, null, 1)}`);
};

/** Retained official documents, reassembled per document from their passages. */
function retainedDocumentsFor(dealCardId: number): Array<{ text: string; sourceUrl: string | null; sourceTitle: string | null }> {
  const stored = readDocumentIntelligence(dealCardId);
  const byDocument = new Map<string, { text: string[]; sourceUrl: string | null; sourceTitle: string | null }>();
  for (const finding of stored.findings) {
    const key = finding.documentKey || finding.sourceUrl || 'unknown';
    const entry = byDocument.get(key) ?? { text: [], sourceUrl: finding.sourceUrl, sourceTitle: finding.sourceTitle };
    entry.text.push(finding.context);
    byDocument.set(key, entry);
  }
  for (const summary of stored.summaries) {
    const entry = byDocument.get(summary.documentKey);
    if (entry) entry.text.push(summary.detailedSummary);
  }
  return [...byDocument.values()].map((entry) => ({
    text: entry.text.join('\n'),
    sourceUrl: entry.sourceUrl,
    sourceTitle: entry.sourceTitle,
  }));
}

describe.skipIf(!LIVE)('LIVE Fairview post-resolution intelligence', () => {
  beforeAll(() => { _initTestLandosDb(); });

  it('resolves the sparse lead, then builds backstory, authority, zoning and subdivision from it', async () => {
    const availability = await hermesFreeSearchAvailability();
    log('governed search capability', availability);
    expect(availability.available).toBe(true);
    const search = createHermesFreeSearch();

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
      agentId: 'live-post-resolution',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);

    // ── STAGE 1: Universal Property Resolution, production path ────────────
    const startedMs = Date.now();
    let landPortalFinished = false;
    const landPortalLane = (): Promise<IdentityLaneResult> => new Promise((resolve) => {
      setTimeout(() => {
        landPortalFinished = true;
        resolve({ lane: 'landportal', status: 'no_evidence', note: 'LandPortal capture window elapsed.' });
      }, 300_000).unref?.();
    });
    const officialLane = async (aimed: ReturnType<typeof readResolverSubject>): Promise<IdentityLaneResult> => {
      const lookup = await lookupOfficialParcel(
        { address: aimed?.address ?? undefined, county: aimed?.county ?? undefined, state: aimed?.state ?? undefined, apn: aimed?.apn ?? undefined },
        25_000,
      );
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

    const resolution = await resolveSubjectProperty(deal.id, {
      actor: 'live-fairview-post-resolution',
      deadlineMs: 180_000,
      lanes: { official_parcel: officialLane, landportal: landPortalLane },
      jurisdiction: { timeoutMs: 15_000 },
      indexedWeb: { search, fetchText: defaultGovFetchText, maxQueries: 4, maxPages: 5, timeoutMs: 25_000 },
    });
    const releasedAtMs = Date.now() - startedMs;
    const finalCard = getPropertyCardRow(card.id)!;
    log('STAGE 1 — RESOLUTION', {
      status: resolution.status,
      winner: resolution.winner,
      released: resolution.released,
      releasedEarly: resolution.releasedEarly,
      landPortalStillRunning: !landPortalFinished,
      releasedAtMs,
      subject: resolution.subject,
      card: {
        apn: finalCard.apn, county: finalCard.county, state: finalCard.state, city: finalCard.city,
        owner: finalCard.owner, acres: finalCard.acres,
        verification_status: finalCard.verification_status, verification_source: finalCard.verification_source,
      },
      conflicts: resolution.conflicts,
    });

    // The resolver mines the documents it already fetched. Awaited here only so
    // the backstory stage can be measured against a settled store.
    await (resolution.enrichment ?? Promise.resolve([]));
    const stored = readDocumentIntelligence(deal.id);
    log('STAGE 1 — RETAINED DOCUMENT INTELLIGENCE', {
      findings: stored.findings.length,
      summaries: stored.summaries.length,
      documents: stored.documents,
    });

    // Evidence must be attachable: create the identity version the durable
    // stores hang derived intelligence from, exactly as the mission path does.
    const subject = readResolverSubject(deal.id)!;
    createPropertyIdentityVersion({
      dealCardId: deal.id, propertyCardId: card.id, status: 'candidate',
      address: subject.address, city: subject.city, county: subject.county, state: subject.state, zip: subject.zip,
      apn: subject.apn, owner: subject.owner, acreage: subject.acres,
      basis: 'Resolved by the Universal Property Resolver in the live acceptance run.',
      confidence: 0.9, sourceRefs: [], changeReason: 'live acceptance', createdBy: 'live-post-resolution',
    } as Parameters<typeof createPropertyIdentityVersion>[0]);

    const projectName = stored.findings.find((finding) => finding.category === 'project_name' && finding.value)?.value ?? null;
    const officialHosts = [...new Set(stored.documents
      .map((document) => { try { return new URL(document.sourceUrl).hostname; } catch { return ''; } })
      .filter(Boolean))];
    const roadFinding = stored.findings.find((finding) => /\bblvd\b|\broad\b|\bdrive\b|\blane\b|\bhwy\b/i.test(finding.context));
    const road = roadFinding ? (/([A-Z][A-Za-z]+\s+(?:Blvd|Boulevard|Road|Rd|Drive|Dr|Lane|Ln|Hwy|Highway))/.exec(roadFinding.context)?.[1] ?? null) : null;
    const queryFacts = {
      apn: subject.apn,
      canonicalApn: null as string | null,
      parcelNotation: subject.notations[0]?.raw ?? null,
      notationParts: {
        map: subject.notations[0]?.parts.find((part) => part.label === 'map')?.value ?? null,
        parcel: subject.notations[0]?.parts.find((part) => part.label === 'parcel')?.value ?? null,
      },
      owner: subject.owner,
      projectName,
      address: subject.address,
      road,
      municipality: subject.city,
      county: subject.county,
      state: subject.state,
      officialHosts,
    };
    const knownSourceUrls = [
      ...new Set([
        ...stored.documents.map((document) => document.sourceUrl),
        ...resolution.subject.sourceEvidence.map((row) => row.url ?? ''),
      ].filter(Boolean)),
    ];

    // ── STAGE 2: Property Backstory ────────────────────────────────────────
    const backstoryStartedMs = Date.now();
    const backstory = await runPropertyBackstory(
      {
        dealCardId: deal.id,
        apn: subject.apn,
        parcelNotation: subject.notations[0]?.raw ?? null,
        parcelNotations: subject.notations,
        owner: subject.owner,
        address: subject.address,
        city: subject.city,
        county: subject.county,
        state: subject.state,
        acres: subject.acres,
        projectName,
        knownSourceUrls,
      },
      { search, alwaysExpand: true, maxQueries: 5, maxDocuments: 3, timeoutMs: 25_000 },
    );
    const backstoryMs = Date.now() - backstoryStartedMs;
    log('STAGE 2 — PROPERTY BACKSTORY', {
      elapsedMs: backstoryMs,
      eventCount: backstory.events.length,
      documentsReused: backstory.documentsReused,
      documentsRetrieved: backstory.documentsRetrieved,
      narrative: backstory.summary.narrative,
      highlights: backstory.summary.highlights,
      openQuestions: backstory.summary.openQuestions,
      zoningReferences: backstory.zoningReferences,
      limitations: backstory.limitations,
      events: backstory.events.map((event) => ({
        date: event.eventDate, type: event.eventType, status: event.status,
        body: event.governingBody, project: event.subjectOrProject,
        numbers: event.materialNumbers, confidence: event.confidence,
        summary: event.summary, sourceUrl: event.sourceUrl,
        pages: event.evidence.map((ref) => ref.page),
      })),
      sourcesConsulted: backstory.sourcesConsulted,
    });

    // ── STAGE 3: Controlling authority, geography, and the zoning layer ────
    const authorityStartedMs = Date.now();
    const [geography, authorityRaw, layers] = await Promise.all([
      resolveJurisdiction({ locality: subject.city, county: subject.county, state: subject.state }, { timeoutMs: 15_000 }).catch(() => null),
      resolveControllingLandUseAuthority(
        {
          dealCardId: deal.id, municipality: subject.city, county: subject.county,
          state: subject.state, apn: subject.apn, address: subject.address,
        },
        {
          // What LandOS already holds, read first and for free.
          retainedDocuments: retainedDocumentsFor(deal.id),
          search,
          fetchText: defaultGovFetchText,
          knownSourceUrls,
          maxQueries: 4,
          maxPages: 6,
          timeoutMs: 20_000,
        },
      ),
      discoverZoningLayers({ county: subject.county, state: subject.state, city: subject.city }, {})
        .catch((error: unknown) => ({ queries: [], notes: [`discovery failed: ${(error as Error).message}`] })),
    ]);
    const authority = geography
      ? {
          ...authorityRaw,
          geographyEvidence: {
            locality: geography.locality, localityKind: geography.localityKind,
            county: geography.county, countyFips: geography.countyFips,
            state: geography.state, stateFips: geography.stateFips,
            sourceLabel: 'U.S. Census Bureau TIGERweb geographic services',
            neverEstablishesLandUseAuthority: true as const,
          },
        }
      : authorityRaw;
    const authorityMs = Date.now() - authorityStartedMs;
    persistControllingAuthority({ authority });
    log('STAGE 3 — AUTHORITY SOURCE RACE', describeRace({ ...authority.race!, evidence: [], notes: [], conflicts: [], enrichment: Promise.resolve(null as never), winner: null } as never));
    log('STAGE 3 — CONTROLLING AUTHORITY', {
      elapsedMs: authorityMs,
      race: authority.race,
      zoningAuthority: authority.zoningAuthority,
      subdivisionAuthority: authority.subdivisionAuthority,
      planningBody: authority.planningBody,
      incorporationStatus: authority.incorporationStatus,
      incorporationBasis: authority.incorporationBasis,
      geographyEvidence: authority.geographyEvidence,
      conflicts: authority.conflicts,
      limitations: authority.limitations,
      sources: authority.sources.map((source) => ({ label: source.label, url: source.url, tier: source.tier, quote: source.quote.slice(0, 240) })),
    });
    log('STAGE 3 — ZONING LAYER DISCOVERY', layers);

    // ── STAGE 4: CURRENT zoning ────────────────────────────────────────────
    const zoningStartedMs = Date.now();
    const zoning = attachHistoricalZoning(
      await determineCurrentZoning(
        {
          dealCardId: deal.id, apn: subject.apn, address: subject.address,
          municipality: subject.city, county: subject.county, state: subject.state, point: null,
          queryFacts,
        },
        authority.zoningAuthority,
        {
          gisQueries: layers.queries.map((query) => ({ ...query, apn: subject.apn })),
          search,
          fetchText: defaultGovFetchText,
          knownSourceUrls,
          retainedSources: retainedDocumentsFor(deal.id).map((row) => ({ url: row.sourceUrl, title: row.sourceTitle, text: row.text })),
          maxPages: 5,
          timeoutMs: 20_000,
        },
      ),
      backstory.zoningReferences,
    );
    const zoningMs = Date.now() - zoningStartedMs;
    persistCurrentZoning({ zoning });
    log('STAGE 4 — ZONING SOURCE RACE', zoning.race);
    log('STAGE 4 — CURRENT ZONING', {
      elapsedMs: zoningMs,
      established: zoning.established,
      districtCode: zoning.districtCode,
      districtName: zoning.districtName,
      overlays: zoning.overlays,
      authorityName: zoning.authorityName,
      evidenceKind: zoning.evidenceKind,
      sourceLabel: zoning.sourceLabel,
      sourceUrl: zoning.sourceUrl,
      parcelMatchBasis: zoning.parcelMatchBasis,
      confidence: zoning.confidence,
      conflicts: zoning.conflicts,
      standards: zoning.standards,
      historicalReferences: zoning.historicalReferences,
      requestedZoning: zoning.requestedZoning,
      limitations: zoning.limitations,
      consideredEvidence: zoning.consideredEvidence.map((row) => ({
        kind: row.candidate.kind, district: row.candidate.districtCode,
        url: row.candidate.sourceUrl, selected: row.selected, note: row.note,
      })),
    });

    // ── STAGE 4b: Allowed uses and dimensional standards ───────────────────
    const standardsStartedMs = Date.now();
    const zoningStandards = await researchZoningStandards(
      {
        dealCardId: deal.id,
        municipality: subject.city,
        county: subject.county,
        state: subject.state,
        officialHosts,
        queryFacts,
      },
      zoning,
      authority.zoningAuthority,
      {
        search,
        fetchText: defaultGovFetchText,
        retainedSources: retainedDocumentsFor(deal.id).map((row) => ({ url: row.sourceUrl, title: row.sourceTitle, text: row.text })),
        knownSourceUrls,
        // The historical district, for context only, when the current one is
        // unresolved. `contextOnly` keeps it out of every conclusion.
        contextDistrict: zoning.established
          ? null
          : zoning.historicalReferences.find((row) => row.value)?.value ?? null,
        maxSources: 4,
        timeoutMs: 25_000,
      },
    );
    const standardsMs = Date.now() - standardsStartedMs;
    persistZoningStandards({ standards: zoningStandards });
    log('STAGE 4b — ALLOWED USES AND DIMENSIONAL STANDARDS', {
      elapsedMs: standardsMs,
      race: zoningStandards.race,
      established: zoningStandards.established,
      contextOnly: zoningStandards.contextOnly,
      districtCode: zoningStandards.districtCode,
      standards: zoningStandards.standards,
      allowedUses: zoningStandards.allowedUses,
      overlays: zoningStandards.overlays,
      documents: zoningStandards.documents,
      supersededHistory: zoningStandards.supersededHistory,
      conflicts: zoningStandards.conflicts,
      limitations: zoningStandards.limitations,
    });

    // ── STAGE 5: Subdivision regulations ───────────────────────────────────
    const subdivisionStartedMs = Date.now();
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: deal.id, municipality: subject.city, county: subject.county, state: subject.state },
      authority.subdivisionAuthority,
      {
        // The government's own domain, established by the documents the
        // resolver already retrieved from it.
        preferredHosts: officialHosts,
        queryFacts,
        knownDocumentUrls: knownSourceUrls,
        search,
        fetchText: defaultGovFetchText,
        maxQueries: 6,
        maxDocuments: 4,
        timeoutMs: 30_000,
      },
    );
    const subdivisionMs = Date.now() - subdivisionStartedMs;
    persistSubdivisionRegulations({ regulations });
    log('STAGE 5 — SUBDIVISION SOURCE RACE', regulations.race);
    log('STAGE 5 — SUBDIVISION REGULATIONS', {
      elapsedMs: subdivisionMs,
      authorityName: regulations.authorityName,
      authorityDetermination: regulations.authorityDetermination,
      documents: regulations.documents,
      thresholds: {
        statedMaxMinorLots: regulations.thresholds.statedMaxMinorLots,
        basis: regulations.thresholds.basis,
        minor: regulations.thresholds.minorDefinition?.value ?? null,
        minorSection: regulations.thresholds.minorDefinition?.section ?? null,
        major: regulations.thresholds.majorDefinition?.value ?? null,
        majorSection: regulations.thresholds.majorDefinition?.section ?? null,
      },
      reviewSequence: regulations.reviewSequence,
      rules: regulations.rules.map((rule) => ({
        key: rule.key, section: rule.section, value: rule.value.slice(0, 240),
        confidence: rule.confidence, sourceUrl: rule.sourceUrl,
      })),
      limitations: regulations.limitations,
    });

    // ── STAGE 6: The property-specific read ────────────────────────────────
    const propertyRead = buildPropertySubdivisionRead({
      dealCardId: deal.id,
      acres: subject.acres,
      roadFrontageFeet: null,
      roadFrontageBasis: null,
      accessStatus: 'unknown',
      environmentalConstraints: [],
      utilitiesKnown: null,
      utilitiesSummary: null,
      zoning,
      regulations,
      backstory,
    });
    persistPropertySubdivisionRead({ read: propertyRead });
    log('STAGE 6 — PROPERTY SUBDIVISION READ', propertyRead);

    // ── STAGE 7: Durability, then the pre-call handoff from storage alone ──
    clearOfficialPdfCache();
    clearDiscoveredContext();
    const reloaded = {
      backstoryEvents: readPropertyBackstory(deal.id)?.events.length ?? 0,
      authority: readControllingAuthority(deal.id)?.zoningAuthority.determination ?? null,
      zoningEstablished: readCurrentZoning(deal.id)?.established ?? null,
      ruleCount: readSubdivisionRegulations(deal.id)?.rules.length ?? 0,
      standardsEstablished: readZoningStandards(deal.id)?.established ?? false,
      permittedUseCount: readZoningStandards(deal.id)?.allowedUses.filter((use) => use.status === 'permitted').length ?? 0,
      likelyPath: readPropertySubdivisionRead(deal.id)?.likelyPath.kind ?? null,
    };
    log('STAGE 7 — RELOADED FROM SQLITE', reloaded);

    const handoff = readPreCallIntelligenceHandoff(deal.id);
    log('STAGE 7 — PRE-CALL INTELLIGENCE HANDOFF', handoff);

    log('TIMING BY QUESTION', {
      resolutionMs: releasedAtMs,
      backstoryMs,
      authorityMs,
      authorityRace: {
        releasedAtMs: authority.race?.releasedAtMs ?? null,
        winner: authority.race?.winningMethod ?? null,
        stillRunningAtRelease: authority.race?.pendingAtRelease ?? [],
      },
      zoningMs,
      zoningRace: {
        releasedAtMs: zoning.race?.releasedAtMs ?? null,
        winner: zoning.race?.winningMethod ?? null,
        stillRunningAtRelease: zoning.race?.pendingAtRelease ?? [],
      },
      standardsMs,
      standardsRace: {
        releasedAtMs: zoningStandards.race?.releasedAtMs ?? null,
        winner: zoningStandards.race?.winningMethod ?? null,
        stillRunningAtRelease: zoningStandards.race?.pendingAtRelease ?? [],
      },
      subdivisionMs,
      subdivisionRace: {
        releasedAtMs: regulations.race?.releasedAtMs ?? null,
        winner: regulations.race?.winningMethod ?? null,
        stillRunningAtRelease: regulations.race?.pendingAtRelease ?? [],
      },
      totalMs: Date.now() - startedMs,
    });

    // ── Acceptance assertions: BEHAVIOUR, never a fact the run was told ────
    // The input never carried the answer.
    expect(FAIRVIEW_SPARSE_INPUT).toBe('Map 042 Parcel 123\nFairview, Tennessee');
    // The resolver released before LandPortal's window closed.
    expect(landPortalFinished).toBe(false);
    // Everything downstream survives a process boundary.
    expect(reloaded.backstoryEvents).toBe(backstory.events.length);
    // Historical zoning is never presented as the current district.
    if (!zoning.established) {
      expect(zoning.districtCode).toBeNull();
      expect(handoff.currentZoning.district).toBeNull();
    }
    for (const reference of zoning.historicalReferences) {
      expect(reference.neverEstablishesCurrentZoning).toBe(true);
    }
    // A theoretical lot count is never an approved yield.
    expect(propertyRead.theoreticalLotCount.approvedYield).toBe(false);
    // Every seller question traces to something stored.
    for (const question of handoff.questions) {
      expect(question.groundedIn.detail.length).toBeGreaterThan(0);
    }
    // Web search is a declared lane on every land-use question, not a fallback.
    for (const record of [authority.race, zoning.race, zoningStandards.race, regulations.race]) {
      if (!record) continue;
      expect(record.lanes.map((row) => row.method)).toContain('indexed_web_search');
    }
    // Allowed-use research never runs without an established district.
    if (!zoning.established) {
      expect(zoningStandards.established).toBe(false);
      // Context research may find the historical district's real rules; it may
      // never present them as established for this parcel.
      if (zoningStandards.allowedUses.length || zoningStandards.standards.minimumLotSize) {
        expect(zoningStandards.contextOnly).toBe(true);
        expect(zoningStandards.limitations.join(' ')).toMatch(/CONTEXT ONLY/);
      }
    }
  }, 600_000);
});
