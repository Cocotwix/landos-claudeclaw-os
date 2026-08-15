// LandOS — running the Property Backstory lane.
//
// ORDER OF OPERATIONS, and the order is the point:
//
//   1. READ WHAT LANDOS ALREADY HAS.
//      `readDocumentIntelligence` returns every finding mined from every
//      official document the resolver downloaded, plus the detailed summaries
//      composed from them. This is a SELECT. It costs nothing, it is already
//      anchored to this parcel, and it answers most of the question.
//   2. Only then expand, and only past what storage already covers.
//      A document whose key is already in storage is NEVER re-fetched. That is
//      not an optimization; re-downloading a planning packet LandOS already
//      mined would spend the operator's time to learn what it already knows.
//   3. Whatever IS newly retrieved goes through the SAME miner, summariser and
//      durable store the resolver uses, so there is one document-intelligence
//      pipeline rather than a second one that drifts.
//
// The lane never rediscovers the parcel. It consumes the confirmed subject and
// nothing it produces may move canonical identity — findings are evidence ABOUT
// an identified property, which is the rule `official-document-context.ts` sets
// and this module inherits unchanged.

import { logger } from '../logger.js';
import { composeOfficialDocumentSummary } from './official-document-summary.js';
import { mineDocumentContext, retainDiscoveredContext, type SubjectAnchors } from './official-document-context.js';
import {
  documentKeyFor,
  persistDocumentIntelligence,
  readDocumentIntelligence,
  type DocumentIntelligenceReadModel,
} from './official-document-intelligence-store.js';
import { loadOfficialPdf, looksLikePdf, pdfIdentityEligible, type OfficialPdfDocument } from './official-pdf-identity.js';
import { verifyOfficiality } from './official-source-discovery.js';
import {
  backstoryEventsFromDocuments,
  composePropertyBackstorySummary,
  type PropertyBackstory,
  type PropertyBackstorySubject,
} from './property-backstory.js';
import { persistPropertyBackstory } from './property-backstory-store.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import type { ParcelNotation } from './parcel-notation.js';

export interface BackstoryRunSubject extends PropertyBackstorySubject {
  parcelNotations: readonly ParcelNotation[];
  /** Government sources the resolver already saw. Discovery starts here. */
  knownSourceUrls: readonly string[];
}

export interface BackstoryRunDeps {
  search?: IdentitySearchProvider;
  /** Read persisted intelligence. Injectable so a unit test needs no database. */
  readIntelligence?: (dealCardId: number) => DocumentIntelligenceReadModel;
  /** Fetch and parse an official PDF. Injectable, and cache-backed by default. */
  loadPdf?: (url: string, options?: { timeoutMs?: number }) => Promise<OfficialPdfDocument | null>;
  /** `false` skips durable persistence (unit tests with no database). */
  persist?: boolean;
  /**
   * Expand beyond storage even when storage already carried findings.
   * Default: expand only when storage carried fewer than `minStoredFindings`.
   */
  alwaysExpand?: boolean;
  minStoredFindings?: number;
  maxQueries?: number;
  maxDocuments?: number;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Search phrasings built from the CONFIRMED subject.
 *
 * Every one names something established about this parcel — the notation, the
 * APN, the owner entity, the project. A query that names only the town would
 * return the town's planning history, not this property's.
 */
export function buildBackstoryQueries(subject: BackstoryRunSubject, limit = 5): string[] {
  const place = [subject.city, subject.state].filter(Boolean).join(' ');
  const county = subject.county ? `${subject.county.replace(/\s+county$/i, '')} County ${subject.state ?? ''}`.trim() : '';
  const notation = subject.parcelNotations[0]?.raw ?? subject.parcelNotation ?? null;
  const queries = [
    subject.projectName && place ? `"${subject.projectName}" ${place} planning commission` : '',
    subject.owner && place ? `"${subject.owner}" ${place} planning commission rezoning subdivision` : '',
    subject.apn && county ? `"${subject.apn}" ${county} planning commission agenda` : '',
    notation && place ? `"${notation}" ${place} planning commission minutes` : '',
    subject.owner && county ? `"${subject.owner}" ${county} plat subdivision approval` : '',
    place && subject.projectName ? `"${subject.projectName}" subdivision ${place} rezoning approved denied` : '',
  ].filter(Boolean);
  return [...new Set(queries)].slice(0, Math.max(1, limit));
}

/**
 * Build the Property Backstory for a confirmed subject.
 *
 * Never throws: a lane that cannot expand still returns everything storage
 * carried, which is a real answer. Failures land in `limitations`.
 */
export async function runPropertyBackstory(
  subject: BackstoryRunSubject,
  deps: BackstoryRunDeps = {},
): Promise<PropertyBackstory> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const readIntelligence = deps.readIntelligence ?? readDocumentIntelligence;
  const loadPdf = deps.loadPdf ?? ((url, options) => loadOfficialPdf(url, options));
  const maxDocuments = Math.max(0, deps.maxDocuments ?? 3);
  const timeoutMs = Math.max(1_000, deps.timeoutMs ?? 25_000);
  const limitations: string[] = [];
  const sourcesConsulted: PropertyBackstory['sourcesConsulted'] = [];
  const documentsRetrieved: PropertyBackstory['documentsRetrieved'] = [];

  // ── 1. Everything LandOS already holds ───────────────────────────────────
  let stored: DocumentIntelligenceReadModel;
  try {
    stored = readIntelligence(subject.dealCardId);
  } catch (error) {
    stored = { dealCardId: subject.dealCardId, findings: [], summaries: [], documents: [] };
    limitations.push(`Retained document intelligence could not be read (${error instanceof Error ? error.message : String(error)}).`);
  }
  const storedKeys = new Set(stored.documents.map((document) => document.documentKey).filter(Boolean));
  const storedUrls = new Set(stored.documents.map((document) => document.sourceUrl).filter(Boolean));
  for (const document of stored.documents) {
    sourcesConsulted.push({
      url: document.sourceUrl,
      title: document.sourceTitle,
      used: true,
      note: `Answered from retained LandOS intelligence: ${document.findingCount} subject-specific finding(s) already stored. The source was not re-fetched.`,
    });
  }

  const minStored = deps.minStoredFindings ?? 4;
  const shouldExpand = deps.alwaysExpand === true || stored.findings.length < minStored;
  if (!shouldExpand) {
    limitations.push(
      `Retained intelligence already carried ${stored.findings.length} subject-specific finding(s) across ${stored.documents.length} document(s), so no additional discovery was run.`,
    );
  }

  // ── 2. Bounded expansion, past what storage covers ───────────────────────
  const anchors: SubjectAnchors = {
    notations: subject.parcelNotations,
    apn: subject.apn,
    owner: subject.owner,
    projectName: subject.projectName,
    address: subject.address,
    city: subject.city,
  };

  if (shouldExpand && maxDocuments > 0) {
    const candidates: Array<{ url: string; title: string | null }> = [];
    for (const url of subject.knownSourceUrls) {
      if (url && !candidates.some((row) => row.url === url)) candidates.push({ url, title: null });
    }
    if (deps.search) {
      for (const query of buildBackstoryQueries(subject, deps.maxQueries ?? 5)) {
        try {
          const hits = await deps.search(query, { maxResults: 8, timeoutMs });
          for (const hit of hits) if (!candidates.some((row) => row.url === hit.url)) candidates.push({ url: hit.url, title: hit.title });
        } catch {
          limitations.push(`The keyless search transport did not answer for "${query}".`);
        }
      }
    } else {
      limitations.push('No search transport was wired, so expansion used only the government sources the resolver already saw.');
    }

    let retrieved = 0;
    for (const candidate of candidates) {
      if (retrieved >= maxDocuments) break;
      const key = documentKeyFor(candidate.url);
      if (storedKeys.has(key) || storedUrls.has(candidate.url)) {
        sourcesConsulted.push({
          url: candidate.url,
          title: candidate.title,
          used: false,
          note: 'Already mined and stored by LandOS. Skipped: a document LandOS holds intelligence for is never re-fetched.',
        });
        continue;
      }
      const verdict = verifyOfficiality(candidate.url, { county: subject.county ?? undefined, state: subject.state ?? undefined, label: candidate.title ?? '' });
      // The SAME eligibility gate the identity path uses. It is not only about
      // officiality: a `.gov` PDF from a different county in the same state is
      // an official document about somebody else's parcel, and a live run
      // proved that a keyless search will happily return one. Downloading it
      // costs the operator time and, worse, writes a retained document row for
      // a property this Deal Card is not about.
      const eligibility = pdfIdentityEligible({
        url: candidate.url,
        title: candidate.title,
        snippet: null,
        officiality: verdict.status === 'official' || verdict.status === 'officially_linked' ? verdict.status : 'unverified',
        notations: subject.parcelNotations,
        apn: subject.apn,
        locality: subject.city,
        state: subject.state,
      });
      if (!eligibility.eligible) {
        sourcesConsulted.push({
          url: candidate.url,
          title: candidate.title,
          used: false,
          note: `Not opened: ${eligibility.reason} Backstory events must trace to the official record for THIS parcel.`,
        });
        continue;
      }
      if (!looksLikePdf(candidate.url, candidate.title)) {
        sourcesConsulted.push({
          url: candidate.url,
          title: candidate.title,
          used: false,
          note: 'Not opened: the backstory miner reads official documents, and this candidate is not one.',
        });
        continue;
      }

      let document: OfficialPdfDocument | null = null;
      try {
        document = await loadPdf(candidate.url, { timeoutMs });
      } catch {
        document = null;
      }
      if (!document) {
        sourcesConsulted.push({ url: candidate.url, title: candidate.title, used: false, note: 'The official document could not be retrieved.' });
        continue;
      }
      retrieved += 1;
      if (document.fromCache) {
        sourcesConsulted.push({ url: candidate.url, title: candidate.title, used: true, note: 'Read from the already-parsed document cache; no new download was made.' });
      }

      try {
        const mined = mineDocumentContext({ document, anchors, dealCardId: subject.dealCardId });
        retainDiscoveredContext(subject.dealCardId, mined);
        const summary = composeOfficialDocumentSummary({
          context: mined,
          subject: {
            apn: subject.apn,
            owner: subject.owner,
            projectName: subject.projectName,
            acreage: subject.acres,
            city: subject.city,
            county: subject.county,
            state: subject.state,
            parcelNotation: subject.parcelNotation,
          },
          documentKey: key,
          documentText: document.text,
          sourceTitle: candidate.title,
        });
        if (deps.persist !== false) {
          persistDocumentIntelligence({
            dealCardId: subject.dealCardId,
            context: mined,
            summary,
            documentText: document.text,
            sourceTitle: candidate.title,
          });
        }
        documentsRetrieved.push({
          sourceUrl: candidate.url,
          sourceTitle: candidate.title,
          reason: 'LandOS held no intelligence for this document, so it was retrieved, mined and stored.',
        });
        sourcesConsulted.push({
          url: candidate.url,
          title: candidate.title,
          used: mined.findings.length > 0,
          note: mined.findings.length
            ? `${mined.findings.length} subject-specific finding(s) retained.`
            : 'Read in full; it carried nothing about this parcel.',
        });
      } catch (error) {
        limitations.push(`An official document could not be mined (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
  }

  // ── 3. Build the timeline from storage, which now includes anything new ──
  let current: DocumentIntelligenceReadModel = stored;
  if (documentsRetrieved.length && deps.persist !== false) {
    try {
      current = readIntelligence(subject.dealCardId);
    } catch {
      limitations.push('Newly stored findings could not be re-read; the backstory reflects what was already retained.');
    }
  }

  const { events, zoningReferences } = backstoryEventsFromDocuments({
    subject,
    findings: current.findings,
    summaries: current.summaries,
  });

  const documentsReused = current.documents
    .filter((document) => !documentsRetrieved.some((row) => row.sourceUrl === document.sourceUrl))
    .map((document) => ({
      documentKey: document.documentKey,
      sourceUrl: document.sourceUrl,
      sourceTitle: document.sourceTitle,
      findingCount: document.findingCount,
    }));

  const summary = composePropertyBackstorySummary({
    subject,
    events,
    zoningReferences,
    documentsReused: documentsReused.length,
    documentsRetrieved: documentsRetrieved.length,
  });

  const backstory: PropertyBackstory = {
    dealCardId: subject.dealCardId,
    subject: {
      dealCardId: subject.dealCardId,
      apn: subject.apn,
      parcelNotation: subject.parcelNotation,
      owner: subject.owner,
      address: subject.address,
      city: subject.city,
      county: subject.county,
      state: subject.state,
      acres: subject.acres,
      projectName: subject.projectName,
    },
    events,
    zoningReferences,
    summary,
    documentsReused,
    documentsRetrieved,
    sourcesConsulted,
    limitations: [...new Set([...limitations, ...summary.limitations])],
    generatedAt: now,
  };

  if (deps.persist !== false) {
    const persisted = persistPropertyBackstory({ backstory });
    logger.info({
      dealCardId: subject.dealCardId,
      events: events.length,
      documentsReused: documentsReused.length,
      documentsRetrieved: documentsRetrieved.length,
      snapshotId: persisted.snapshotId,
      reused: persisted.reused,
      skippedReason: persisted.skippedReason,
    }, 'property_backstory_built');
  }

  return backstory;
}
