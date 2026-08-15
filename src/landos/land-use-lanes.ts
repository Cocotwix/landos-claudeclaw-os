// LandOS — the reusable RETRIEVAL LANES every land-use question races.
//
// One implementation of "search the web and open what it found", one of "fetch
// a known government URL", one of "read what LandOS already stored", and one
// browser escalation seam — shared by the authority resolver, the current-zoning
// determination, the allowed-use and dimensional-standards research, and the
// subdivision retrieval.
//
// The alternative was four copies of the same discovery loop drifting apart,
// which is exactly what the first pass of this sprint produced: web search was
// wired into three subsystems and absent from the fourth, and each of the three
// ran it serially after its direct route rather than beside it.
//
// What a lane does NOT do: decide whether its evidence is good enough. Every
// lane returns candidates; the race's sufficiency gate judges them. A lane that
// filtered on its own would hide its refusals from the operator.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { loadOfficialPdf, looksLikePdf, type OfficialPdfDocument } from './official-pdf-identity.js';
import {
  governmentSourceTier,
  hostServesSubjectJurisdiction,
  rankSourceForAuthority,
  type EvidenceTier,
  type JurisdictionSubject,
} from './land-use-source-authority.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import type { LandUseEvidence, LandUseLane, LandUseMethod } from './land-use-source-race.js';

export const PDF_LIKE = /\.pdf(?:[?#]|$)/i;

/** One retrieved source, normalized so every reader sees the same shape. */
export interface SourceDocument {
  url: string;
  title: string | null;
  text: string;
  kind: 'html' | 'pdf';
  tier: EvidenceTier;
  /** How this source relates to the controlling government. */
  relation: ReturnType<typeof rankSourceForAuthority>;
  retrievedAt: string;
  /** False when the bounded PDF cache answered without a download. */
  fetchedFresh: boolean;
  /** Links the page publishes, for one bounded follow step. */
  links: Array<{ label: string; url: string }>;
}

/** Turns a retrieved source into zero or more candidates. Domain-specific. */
export type EvidenceReader<T> = (document: SourceDocument) => Array<LandUseEvidence<T>>;

export interface LaneJurisdiction extends JurisdictionSubject {
  controllingAuthorityName?: string | null;
}

export interface RetrievalTransports {
  fetchText?: GovFetchText;
  loadPdf?: (url: string, options?: { timeoutMs?: number }) => Promise<OfficialPdfDocument | null>;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Fetch one source, HTML or PDF, and tier it from its own words.
 *
 * Tiering AFTER the fetch matters: a municipal `.org` site or a contracted code
 * publisher only proves itself by what the page says, and no pre-fetch guess
 * can know that.
 */
export async function fetchSourceDocument(
  url: string,
  jurisdiction: LaneJurisdiction,
  transports: RetrievalTransports = {},
): Promise<SourceDocument | null> {
  const fetchText = transports.fetchText ?? defaultGovFetchText;
  const loadPdf = transports.loadPdf ?? ((target, options) => loadOfficialPdf(target, options));
  const timeoutMs = Math.max(1_000, transports.timeoutMs ?? 20_000);
  const now = (transports.now ?? (() => new Date().toISOString()))();

  const finish = (input: { text: string; title: string | null; kind: 'html' | 'pdf'; retrievedAt: string; fetchedFresh: boolean; links: Array<{ label: string; url: string }> }): SourceDocument => ({
    url,
    title: input.title,
    text: input.text,
    kind: input.kind,
    tier: governmentSourceTier({ url, pageText: input.text, municipality: jurisdiction.municipality, county: jurisdiction.county, state: jurisdiction.state }),
    relation: rankSourceForAuthority(url, { ...jurisdiction, pageText: input.text }),
    retrievedAt: input.retrievedAt,
    fetchedFresh: input.fetchedFresh,
    links: input.links,
  });

  try {
    if (PDF_LIKE.test(url) || looksLikePdf(url, null)) {
      const pdf = await loadPdf(url, { timeoutMs });
      if (!pdf || !pdf.textLayer || !pdf.text.trim()) return null;
      return finish({
        text: pdf.text,
        title: url.split('/').pop() ?? url,
        kind: 'pdf',
        retrievedAt: pdf.fetchedAt,
        fetchedFresh: !pdf.fromCache,
        links: [],
      });
    }
    const page = await fetchText(url, { timeoutMs });
    if (page.blocked || !page.body) return null;
    return finish({
      text: htmlToText(page.body),
      title: /<title[^>]*>([\s\S]{1,180}?)<\/title>/i.exec(page.body)?.[1]?.trim() ?? null,
      kind: 'html',
      retrievedAt: now,
      fetchedFresh: true,
      links: extractLinks(page.body, page.url),
    });
  } catch {
    return null;
  }
}

// ── Retained evidence ───────────────────────────────────────────────────────

export interface RetainedSource {
  url: string | null;
  title: string | null;
  text: string;
  /** Retained official-document intelligence is already government-sourced. */
  tier?: EvidenceTier;
}

/**
 * The lane that reads what LandOS already holds.
 *
 * Synchronous work behind an async signature, so it settles in the same tick
 * the race starts. That is the whole point: the cheapest lane should almost
 * always be the one that releases, and the network lanes should be the ones
 * that corroborate it.
 */
export function retainedEvidenceLane<T>(input: {
  id?: string;
  label?: string;
  sources: readonly RetainedSource[];
  jurisdiction: LaneJurisdiction;
  read: EvidenceReader<T>;
  now?: () => string;
}): LandUseLane<T, LaneJurisdiction> {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    id: input.id ?? 'retained',
    method: 'retained_evidence',
    label: input.label ?? 'Retained LandOS evidence',
    instant: true,
    run: async () => {
      const out: Array<LandUseEvidence<T>> = [];
      for (const source of input.sources) {
        if (!source.text.trim()) continue;
        const url = source.url ?? '';
        const document: SourceDocument = {
          url,
          title: source.title,
          text: source.text,
          kind: PDF_LIKE.test(url) ? 'pdf' : 'html',
          tier: source.tier
            ?? governmentSourceTier({ url, pageText: source.text, municipality: input.jurisdiction.municipality, county: input.jurisdiction.county, state: input.jurisdiction.state }),
          relation: rankSourceForAuthority(url, { ...input.jurisdiction, pageText: source.text }),
          retrievedAt: now(),
          fetchedFresh: false,
          links: [],
        };
        out.push(...input.read(document));
      }
      return out;
    },
  };
}

// ── Indexed web search ──────────────────────────────────────────────────────

export interface WebDiscoveryOptions<T> {
  id?: string;
  label?: string;
  /** Built from the CONFIRMED subject by the calling subsystem. */
  queries: readonly string[];
  jurisdiction: LaneJurisdiction;
  search: IdentitySearchProvider;
  read: EvidenceReader<T>;
  transports?: RetrievalTransports;
  maxResultsPerQuery?: number;
  /** How many discovered sources to actually open. */
  maxSources?: number;
  /** Follow one level of links from an opened official index page. */
  followLinks?: RegExp | false;
  /**
   * Open these first. With a cap on how many sources are read, the ordering of
   * a search result page decides what LandOS ever sees — and a run that never
   * opened the town's own regulations because four listing sites came back
   * ahead of them has not searched, it has sampled.
   */
  preferUrls?: RegExp;
  /** URLs the caller already knows about. Opened before anything searched. */
  seedUrls?: readonly string[];
  onNote?: (note: string) => void;
}

/**
 * SEARCH IS DISCOVERY. This lane finds government sources and opens them; the
 * fact always comes out of the source, never out of the snippet.
 *
 * Queries run concurrently and the discovered sources are opened concurrently.
 * The earlier serial version paid four search round-trips before it opened a
 * single page, which is most of why web search read as "slow" and got demoted
 * to a fallback.
 */
export function indexedWebSearchLane<T>(options: WebDiscoveryOptions<T>): LandUseLane<T, LaneJurisdiction> {
  return {
    id: options.id ?? 'web_search',
    method: 'indexed_web_search',
    label: options.label ?? 'Indexed web discovery (governed keyless search)',
    reAimable: true,
    run: async (aim) => {
      const jurisdiction = { ...options.jurisdiction, ...aim };
      const maxSources = Math.max(1, options.maxSources ?? 4);
      const discovered: string[] = [...new Set(options.seedUrls ?? [])];

      const hits = await Promise.all(options.queries.map(async (query) => {
        try {
          return await options.search(query, {
            maxResults: options.maxResultsPerQuery ?? 8,
            timeoutMs: options.transports?.timeoutMs ?? 20_000,
          });
        } catch {
          options.onNote?.(`The keyless search transport did not answer for "${query}".`);
          return [];
        }
      }));
      for (const row of hits.flat()) {
        if (!discovered.includes(row.url)) discovered.push(row.url);
      }

      // The jurisdiction gate is applied BEFORE anything is downloaded, so an
      // official document about somebody else's parcel costs nothing.
      const eligible = discovered.filter((url) => hostServesSubjectJurisdiction(url, jurisdiction));
      const skipped = discovered.length - eligible.length;
      if (skipped > 0) {
        options.onNote?.(`${skipped} discovered result(s) were not opened: their host does not serve this parcel's jurisdiction.`);
      }

      const prefer = options.preferUrls;
      const ranked = prefer
        ? [...eligible].sort((a, b) => (prefer.test(b) ? 1 : 0) - (prefer.test(a) ? 1 : 0))
        : eligible;
      const opened = await Promise.all(ranked.slice(0, maxSources).map((url) =>
        fetchSourceDocument(url, jurisdiction, options.transports)));
      const documents = opened.filter((row): row is SourceDocument => row != null);

      // One bounded follow step: a government index page links to the adopted
      // documents, and following those links is deterministic where a search is
      // not.
      if (options.followLinks) {
        const follow: string[] = [];
        for (const document of documents) {
          for (const link of document.links) {
            if (!PDF_LIKE.test(link.url)) continue;
            if (!options.followLinks.test(`${link.label} ${link.url}`)) continue;
            if (!hostServesSubjectJurisdiction(link.url, jurisdiction)) continue;
            if (discovered.includes(link.url) || follow.includes(link.url)) continue;
            follow.push(link.url);
          }
        }
        if (follow.length) {
          const followed = await Promise.all(follow.slice(0, maxSources).map((url) =>
            fetchSourceDocument(url, jurisdiction, options.transports)));
          documents.push(...followed.filter((row): row is SourceDocument => row != null));
        }
      }

      return documents.flatMap((document) => options.read(document));
    },
  };
}

// ── Known direct government / GIS / API routes ──────────────────────────────

/**
 * Fetch a set of URLs LandOS already believes in — a known ordinance link, a
 * planning-department page, a candidate code-publisher URL — concurrently.
 *
 * Separate from the search lane because it must not wait on a search round
 * trip. When a direct route can answer in a few hundred milliseconds, that is
 * the answer, and the search lane becomes corroboration.
 */
export function directSourceLane<T>(input: {
  id?: string;
  label?: string;
  urls: readonly string[];
  jurisdiction: LaneJurisdiction;
  read: EvidenceReader<T>;
  transports?: RetrievalTransports;
  method?: LandUseMethod;
  maxSources?: number;
  onNote?: (note: string) => void;
}): LandUseLane<T, LaneJurisdiction> {
  return {
    id: input.id ?? 'direct_source',
    method: input.method ?? 'official_document',
    label: input.label ?? 'Known direct government source',
    reAimable: true,
    run: async (aim) => {
      const jurisdiction = { ...input.jurisdiction, ...aim };
      const candidates = [...new Set(input.urls)].filter((url) => /^https?:\/\//i.test(url));
      const urls = candidates
        .filter((url) => hostServesSubjectJurisdiction(url, jurisdiction))
        .slice(0, Math.max(1, input.maxSources ?? 6));
      const refused = [...new Set(candidates
        .filter((url) => !hostServesSubjectJurisdiction(url, jurisdiction))
        .map((url) => { try { return new URL(url).hostname; } catch { return url; } }))];
      if (refused.length) {
        input.onNote?.(
          `${refused.length} candidate host(s) were not opened because they do not serve this parcel's municipality, county or state: ${refused.slice(0, 6).join(', ')}${refused.length > 6 ? ', …' : ''}.`,
        );
      }
      if (!urls.length) return [];
      const opened = await Promise.all(urls.map((url) => fetchSourceDocument(url, jurisdiction, input.transports)));
      return opened
        .filter((row): row is SourceDocument => row != null)
        .flatMap((document) => input.read(document));
    },
  };
}

/**
 * A structured API lane — ArcGIS REST, a parcel service, a planning endpoint.
 *
 * Modelled as a plain thunk because the payload shape is the adapter's
 * business, not this module's. It exists so the race can see it as a
 * first-class method rather than as a step inside another lane.
 */
export function directApiLane<T>(input: {
  id?: string;
  label?: string;
  query: (aim: LaneJurisdiction) => Promise<Array<LandUseEvidence<T>>>;
}): LandUseLane<T, LaneJurisdiction> {
  return {
    id: input.id ?? 'direct_api',
    method: 'direct_gis_api',
    label: input.label ?? 'Direct GIS / API route',
    reAimable: true,
    run: (aim) => input.query(aim),
  };
}

// ── Browser escalation ──────────────────────────────────────────────────────

export type BrowserSourceReader = (input: {
  url: string;
  purpose: string;
  timeoutMs: number;
}) => Promise<{ url: string; title: string | null; text: string } | null>;

/**
 * The escalation seam.
 *
 * Declared as an `escalation` lane, so the race starts it only when the cheap
 * methods have settled without a sufficient answer. When no browser reader is
 * wired it returns nothing and says so — an unavailable escalation is a stated
 * limitation, never a silent gap, and never a reason to fail the question.
 */
export function browserEscalationLane<T>(input: {
  id?: string;
  label?: string;
  urls: readonly string[];
  purpose: string;
  jurisdiction: LaneJurisdiction;
  read: EvidenceReader<T>;
  browser?: BrowserSourceReader | null;
  timeoutMs?: number;
  onNote?: (note: string) => void;
  now?: () => string;
}): LandUseLane<T, LaneJurisdiction> {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    id: input.id ?? 'browser',
    method: 'browser_escalation',
    label: input.label ?? 'Browser escalation (interactive map / JS-rendered source)',
    escalation: true,
    run: async (aim) => {
      if (!input.browser) {
        input.onNote?.('Browser escalation was available as a lane but no browser reader is wired into this run, so it retrieved nothing.');
        return [];
      }
      const jurisdiction = { ...input.jurisdiction, ...aim };
      const urls = [...new Set(input.urls)].filter((url) => hostServesSubjectJurisdiction(url, jurisdiction)).slice(0, 3);
      const read = await Promise.all(urls.map(async (url) => {
        try {
          return await input.browser!({ url, purpose: input.purpose, timeoutMs: input.timeoutMs ?? 45_000 });
        } catch {
          return null;
        }
      }));
      return read
        .filter((row): row is { url: string; title: string | null; text: string } => row != null && !!row.text.trim())
        .flatMap((row) => input.read({
          url: row.url,
          title: row.title,
          text: row.text,
          kind: 'html',
          tier: governmentSourceTier({ url: row.url, pageText: row.text, municipality: jurisdiction.municipality, county: jurisdiction.county, state: jurisdiction.state }),
          relation: rankSourceForAuthority(row.url, { ...jurisdiction, pageText: row.text }),
          retrievedAt: now(),
          fetchedFresh: true,
          links: [],
        }));
    },
  };
}

// ── Query construction ──────────────────────────────────────────────────────

export interface SubjectQueryFacts {
  apn: string | null;
  /** The provider's canonical spelling, when it differs from the local APN. */
  canonicalApn?: string | null;
  parcelNotation: string | null;
  /** "Map 42" / "Parcel 123", when the notation carries them. */
  notationParts?: { map?: string | null; parcel?: string | null };
  owner: string | null;
  projectName: string | null;
  address: string | null;
  road?: string | null;
  municipality: string | null;
  county: string | null;
  state: string | null;
  /** The government's own domain, when LandOS has established it. */
  officialHosts?: readonly string[];
}

const quoted = (value: string | null | undefined): string | null => {
  const text = String(value ?? '').trim();
  return text ? `"${text}"` : null;
};

/**
 * Queries an operator would actually type, built from the CONFIRMED subject.
 *
 * Parcel-anchored forms come first: they are the ones that can return a
 * parcel-specific record rather than the jurisdiction's general zoning page.
 * Site-scoped forms come next, because the government's own domain answers
 * with the government's own documents. Nothing here is hardcoded to a
 * jurisdiction — every term comes from the resolved subject.
 */
export function buildLandUseQueries(input: {
  subject: SubjectQueryFacts;
  /** e.g. 'zoning', 'subdivision regulations', 'R-20 permitted uses'. */
  topic: string;
  /** Extra topic phrasings, each combined with the place. */
  variants?: readonly string[];
  limit?: number;
}): string[] {
  const { subject, topic } = input;
  const place = [subject.municipality, subject.state].filter(Boolean).join(' ');
  const county = subject.county ? `${subject.county.replace(/\s+county$/i, '')} County ${subject.state ?? ''}`.trim() : '';
  const map = subject.notationParts?.map ? `"Map ${subject.notationParts.map}"` : null;
  const parcel = subject.notationParts?.parcel ? `"Parcel ${subject.notationParts.parcel}"` : null;

  const parcelAnchored = [
    subject.apn && place ? `${quoted(subject.apn)} ${place} ${topic}` : '',
    subject.canonicalApn && subject.canonicalApn !== subject.apn && place ? `${quoted(subject.canonicalApn)} ${place} ${topic}` : '',
    map && parcel && place ? `${map} ${parcel} ${place} ${topic}` : '',
    subject.road && place ? `${quoted(subject.road)} ${place} ${topic}` : '',
    subject.owner && place ? `${quoted(subject.owner)} ${place} ${topic}` : '',
    subject.projectName ? `${quoted(subject.projectName)} ${topic}` : '',
  ].filter(Boolean);

  const siteScoped = (subject.officialHosts ?? []).slice(0, 2).flatMap((host) => [
    `${topic} site:${host}`,
    map && parcel ? `${map} ${parcel} site:${host}` : '',
    subject.projectName ? `${quoted(subject.projectName)} ${topic} site:${host}` : '',
  ].filter(Boolean));

  // The caller's own phrasings come before the generic ones: a subsystem that
  // asks for "zoning map PDF" wants that query to survive the cap.
  const jurisdictionWide = [
    place ? `${place} ${topic}` : '',
    ...(input.variants ?? []).map((variant) => (place ? `${place} ${variant}` : '')),
    place ? `${place} ${topic} PDF` : '',
    place ? `${place} GIS ${topic}` : '',
    county ? `${county} ${topic}` : '',
  ].filter(Boolean);

  return [...new Set([...parcelAnchored, ...siteScoped, ...jurisdictionWide])]
    .slice(0, Math.max(1, input.limit ?? 16));
}

/** Candidate direct URLs on a government's own domain. Cheap to try, verified like anything else. */
export function buildDirectCandidateUrls(input: {
  officialHosts: readonly string[];
  paths: readonly string[];
}): string[] {
  const out: string[] = [];
  for (const host of input.officialHosts.slice(0, 2)) {
    const base = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
    for (const path of input.paths) out.push(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  }
  return [...new Set(out)];
}
