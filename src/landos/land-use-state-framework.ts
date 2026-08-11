// LandOS — STATEWIDE land-division framework detection.
//
// This lane runs BEFORE any local subdivision conclusion, for every property,
// in every state. It answers one question: does this state establish a
// framework that the local unit administers, supplements or is limited by?
//
// The answer is frequently no, and "no" is a real answer here — it is what
// tells the operator that the local ordinance is the whole story. What is never
// acceptable is assuming either way, so the lane records the sources it
// searched alongside the outcome. "Not found" that names where LandOS looked is
// inspectable; "not found" on its own is a shrug.
//
// The lane is deliberately state-shaped rather than state-specific. It carries
// concept patterns (what a land-division act SAYS) and not statute numbers, so
// a state LandOS has never researched is handled exactly like one it has.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { createBackgroundBrowserFetchText, withBrowserFallback } from './gov-browser-transport.js';
import {
  extractStatuteCitation,
  locateStateLegalSource,
  retrieveStateLaw,
  siteDomain,
  type LocatedStateLegalSource,
  type StateLawDocument,
} from './state-law-retrieval.js';
import { learnedStateLawSource } from './state-law-learning.js';
import { searchEngineUrl, unwrapSearchResults } from './netr-routing.js';
import { boundExcerpt, buildCitation, classifySource, findProvisions, hostOf, isGovernmentHost } from './land-use-evidence.js';
import { stateName } from './state-legal-sources.js';
import {
  evidencedValue,
  unresolvedValue,
  type LegalSourceCitation,
  type SourceAuthorityTier,
  type StateFrameworkKind,
  type StateFrameworkProvision,
  type StateLandDivisionFramework,
} from './land-use-types.js';

/* ─────────────────────────── concept patterns ────────────────────────── */

/**
 * What each kind of statewide provision SAYS, not where it lives.
 *
 * `query` steers a bounded search at the state's own official host. `pattern`
 * confirms the retrieved text really is that provision, so a search result that
 * merely mentions the phrase never becomes a finding.
 */
interface FrameworkProbe {
  kind: StateFrameworkKind;
  query: string;
  pattern: RegExp;
  /** Why this provision would matter to a rural acreage subject. */
  materiality: string;
}

const FRAMEWORK_PROBES: FrameworkProbe[] = [
  {
    kind: 'land_division_act',
    query: 'land division act division of land parcels',
    pattern: /land\s+division\s+act|division\s+of\s+land[^.;]{0,200}(?:act|chapter|section)|a\s+division\s+of\s+land[^.;]{0,180}/i,
    materiality: 'A statewide land-division act sets the baseline number and manner of divisions a parent parcel supports before local rules apply.',
  },
  {
    kind: 'subdivision_statute',
    query: 'subdivision of land statute plat approval local government',
    pattern: /subdivision\s+(?:of\s+land|regulation|statute)[^.;]{0,220}|"?subdivision"?\s+means[^.;]{0,220}|(?:subdivision|land\s+development|planning)\s+act[^.;]{0,200}/i,
    materiality: 'A statewide subdivision statute defines what counts as a subdivision and what local government may require.',
  },
  {
    kind: 'minor_subdivision_framework',
    query: 'minor subdivision exempt division fewer lots statute',
    pattern: /minor\s+subdivision[^.;]{0,220}|exempt(?:ion)?\s+from\s+(?:the\s+)?(?:plat|subdivision)[^.;]{0,220}/i,
    materiality: 'A statewide minor or exempt path can create a by-right division route regardless of local procedure.',
  },
  {
    kind: 'platting_statute',
    query: 'plat act recording plats surveyor requirements statute',
    pattern: /plat\s+act|plat[^.;]{0,60}(?:shall\s+be\s+recorded|surveyor)[^.;]{0,180}/i,
    materiality: 'Plat statutes decide whether a division must be surveyed and recorded, and by whom.',
  },
  {
    kind: 'parent_tract_framework',
    query: 'parent parcel parent tract divisions permitted statute',
    pattern: /parent\s+(?:parcel|tract)[^.;]{0,220}/i,
    materiality: 'A parent-tract rule makes legal lot count depend on the division history of the original tract.',
  },
  {
    kind: 'manufactured_housing_preemption',
    query: 'manufactured home local zoning may not exclude statute',
    pattern: /(?:manufactured|mobile)\s+home[^.;]{0,260}(?:shall\s+not\s+(?:be\s+)?(?:exclude|prohibit)|may\s+not\s+(?:exclude|prohibit)|no\s+(?:county|municipality|local)[^.;]{0,80}(?:exclude|prohibit))|(?:exclude|prohibit)[^.;]{0,100}(?:manufactured|mobile)\s+homes?[^.;]{0,160}/i,
    materiality: 'A state limit on excluding manufactured homes changes what a local ordinance may lawfully do about them.',
  },
  {
    kind: 'zoning_enabling_act',
    query: 'zoning enabling act counties municipalities authority statute',
    // The second alternative matches how a state agency NAMES a governing
    // statute — "Zoning (O.C.G.A. 36-66-1, et seq.)" — which is the shape
    // used where the code itself is not machine-readable. It is generic:
    // a concept word immediately followed by a statutory reference.
    pattern: /zoning[^.;]{0,120}(?:is\s+authorized|may\s+adopt|are\s+empowered|enabling)[^.;]{0,200}|zoning[^.;]{0,30}\([^)]{0,60}et\s+seq[^.;]{0,200}/i,
    materiality: 'The enabling act establishes which units of government may zone at all, which is what decides who to research.',
  },
];

/* ────────────────────────────── the lane ─────────────────────────────── */

export interface StateFrameworkDeps {
  fetchText?: GovFetchText;
  /** A browser-class transport for state code sites behind an edge challenge. */
  browserFetchText?: GovFetchText;
  now?: () => string;
  /** Cap on documents read, so one slow state site cannot stall the run. */
  maxDocuments?: number;
  /** Disabled in tests so nothing touches a search engine. */
  allowWebSearch?: boolean;
  /**
   * The kind of local government containing the subject. Several states publish
   * a separate body of law per kind of local unit and only one governs this
   * parcel, so the retrieval lane needs to know which one to open.
   */
  localUnitHint?: string | null;
}

/*
 * THE BROWSER RUNG IS THE LANE'S DEFAULT, NOT A CALLER'S CHORE.
 *
 * A state publication that refuses Node's TLS chain is unreadable to the plain
 * server fetch and perfectly readable to the dedicated LandOS Chrome. That is a
 * property of the host, not of who happened to call this lane, so only one
 * caller wiring the browser transport meant every other caller silently
 * reported "no state law" for the same host. The escalation now lives here.
 *
 * Built lazily and once: a caller that injects its own transport never
 * constructs a browser session, so tests and offline runs stay offline.
 */
let laneDefaultTransport: GovFetchText | null = null;
let laneDefaultBrowserTransport: GovFetchText | null = null;

/** The transport this lane uses when the caller did not supply one. */
export function stateFrameworkTransport(deps: StateFrameworkDeps): GovFetchText {
  if (deps.fetchText) return deps.fetchText;
  laneDefaultTransport ??= withBrowserFallback(defaultGovFetchText, stateFrameworkBrowserTransport({}));
  return laneDefaultTransport;
}

/** The browser-class transport, for a source already known to need one. */
export function stateFrameworkBrowserTransport(deps: StateFrameworkDeps): GovFetchText {
  if (deps.browserFetchText) return deps.browserFetchText;
  if (deps.fetchText) return deps.fetchText;
  laneDefaultBrowserTransport ??= createBackgroundBrowserFetchText();
  return laneDefaultBrowserTransport;
}

/**
 * Locating the state's own official publication lives with the retrieval lane,
 * because retrieval is what needs it and the two must never disagree about
 * which host is authoritative. Re-exported here so the framework lane's own
 * callers keep working.
 */
export { locateStateLegalSource };
export type { LocatedStateLegalSource };

interface RetrievedDocument {
  url: string;
  label: string;
  text: string;
}

/**
 * Find candidate statute pages for one probe.
 *
 * Normally the search engine is a DISCOVERY tool whose results are filtered to
 * the state's own official origin before anything is read: a statute summary on
 * a commercial site points at the law rather than stating it.
 *
 * That filter is the right default and the WRONG one in exactly one case. When
 * the official origin is itself unreadable, restricting discovery to that
 * origin asks the search engine for more pages on the host that just refused —
 * the fallback then cannot answer by construction, whatever it finds. So when
 * the caller reports the official source transport-blocked, the query becomes
 * the actual question rather than a host restriction, government hosts are
 * ranked first, and every result is TIERED by what published it. Nothing here
 * decides that a secondary source is authoritative; `stateFrameworkSourceTier`
 * records what it is and the evidence model does the rest.
 */
async function findStatutePages(
  probe: FrameworkProbe,
  origin: string,
  state: string,
  deps: StateFrameworkDeps,
  options: { restrictToOfficialHost: boolean },
): Promise<Array<{ url: string; label: string }>> {
  if (deps.allowWebSearch === false) return [];
  const fetchText = stateFrameworkTransport(deps);
  const host = hostOf(origin);
  if (!host) return [];
  const label = stateName(state) ?? state;
  const query = options.restrictToOfficialHost
    ? `site:${host} ${probe.query} ${label}`
    : `${probe.query} ${label}`;
  try {
    const response = await fetchText(searchEngineUrl(query), { timeoutMs: 25_000 });
    if (response.blocked || response.status >= 400) return [];
    const links = unwrapSearchResults(
      extractLinks(response.body, response.url).map((link) => ({ text: link.label, href: link.url })),
    );
    // A search host that answers an automated query with a challenge returns a
    // page containing no result links at all. That is a BLOCKED discovery
    // route, not an empty result set, and the two must not be reported the same
    // way — one means "the law may not exist", the other means "LandOS could
    // not look". The live sweep for this sprint hit exactly this.
    if (!links.length) throw new SearchRouteBlocked();
    if (options.restrictToOfficialHost) {
      return links
        .filter((link) => hostOf(link.href) === host)
        .slice(0, 3)
        .map((link) => ({ url: link.href, label: link.text || `${label} statute` }));
    }
    const seen = new Set<string>();
    return links
      // The dependency-free PDF reader returns nothing for most government
      // PDFs, and a UTF-8-mangled binary body must never become an excerpt an
      // operator reads as a quotation.
      .filter((link) => !/\.pdf($|\?)/i.test(link.href))
      .filter((link) => !seen.has(link.href) && seen.add(link.href))
      .map((link) => ({
        url: link.href,
        label: link.text || `${label} land-division framework`,
        // Strongest source first: the state's own publication, then any other
        // government publisher, then everything else.
        rank: hostOf(link.href) === host ? 2 : isGovernmentHost(link.href) ? 1 : 0,
      }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 4)
      .map(({ url, label: linkLabel }) => ({ url, label: linkLabel }));
  } catch (error) {
    if (error instanceof SearchRouteBlocked) throw error;
    return [];
  }
}

/**
 * What KIND of authority published a state-framework document.
 *
 * The lane used to tier by ROUTE alone — everything that was not an agency
 * sitemap hit was `state_statute` — which was safe only because every document
 * came off the state's own origin. Once the fallback is allowed to read a
 * source the state does not operate, the tier has to come from the publisher.
 * A page on the state's own publication is the statute; another government's
 * publication of state material is state agency material; anything else is
 * classified on its merits, which for an aggregator means discovery only.
 */
export function stateFrameworkSourceTier(
  url: string,
  label: string,
  officialOrigin: string,
  route: StateLawDocument['route'],
): SourceAuthorityTier {
  const sameHost = hostOf(url) === hostOf(officialOrigin);
  if (sameHost) return route === 'sitemap' ? 'state_agency' : 'state_statute';
  // A sibling subdomain reached through the CODE adapters is the same
  // publication — publishing a code at `archive.<host>` is ordinary. A search
  // hit is not: a state's registrable domain is shared by every one of its
  // agencies, so `dor.<st>.gov` is not the legislature just for living there.
  if (siteDomain(url) === siteDomain(officialOrigin) && route !== 'sitemap' && route !== 'page_search') {
    return 'state_statute';
  }
  if (isGovernmentHost(url)) return 'state_agency';
  return classifySource(url, label).tier;
}

/** Thrown when the discovery route itself refuses, rather than finding nothing. */
class SearchRouteBlocked extends Error {
  constructor() { super('The discovery search route refused an automated query.'); }
}

async function readDocument(url: string, label: string, deps: StateFrameworkDeps, useBrowser: boolean): Promise<RetrievedDocument | null> {
  const fetchText = useBrowser ? stateFrameworkBrowserTransport(deps) : stateFrameworkTransport(deps);
  try {
    const response = await fetchText(url, { timeoutMs: 35_000 });
    if (response.blocked || response.status >= 400) return null;
    const text = htmlToText(response.body);
    if (text.trim().length < 300) return null;
    return { url, label, text };
  } catch {
    return null;
  }
}

/**
 * Resolve the statewide framework for one subject.
 *
 * Returns `not_found` rather than `unverified` only when the state's own
 * official source WAS read and contained no matching provision. When the source
 * itself could not be reached the status stays `unverified`, because "we could
 * not look" and "we looked and there is nothing" are different facts and an
 * operator has to be able to tell them apart.
 */
export async function resolveStateFramework(
  state: string,
  deps: StateFrameworkDeps = {},
): Promise<StateLandDivisionFramework> {
  const now = deps.now ?? (() => new Date().toISOString());
  const searchedAt = now();
  const sourcesSearched: StateLandDivisionFramework['sourcesSearched'] = [];
  const provisions: StateFrameworkProvision[] = [];

  const located = await locateStateLegalSource(state, { fetchText: stateFrameworkTransport(deps), now: deps.now });
  if (!located) {
    return {
      state,
      status: 'unverified',
      provisions: [],
      localAuthorityRetained: unresolvedValue('The state\'s official legal publication was not located, so what it leaves to local government is unknown.'),
      sourcesSearched: [],
      searchedAt,
    };
  }

  /**
   * Retrieve authoritative state material through the OFFICIAL platform path.
   *
   * This replaced a general-search route entirely. The search host refuses
   * automated queries, and the old lane read that refusal as "no such statute"
   * for every state — a silent wrong answer, which is the one failure shape
   * this engine cannot tolerate.
   */
  const retrieval = await retrieveStateLaw(state, {
    fetchText: located.transportIsBrowser ? stateFrameworkBrowserTransport(deps) : stateFrameworkTransport(deps),
    maxRequests: deps.maxDocuments ?? 16,
    localUnitHint: deps.localUnitHint ?? null,
    // The publication this lane just located and verified. Passing it is what
    // lets a state that appears in no registry be read at all.
    source: located,
    now: deps.now,
  });

  for (const document of retrieval.documents) {
    sourcesSearched.push({ label: document.label, url: document.url, outcome: 'read' });
  }
  if (retrieval.blocker) {
    sourcesSearched.push({
      // The operator has to be able to tell "read and empty" from "never read".
      label: retrieval.transportBlocked
        ? `${located.body} — official retrieval refused at the transport layer`
        : `${located.body} — official retrieval`,
      url: located.origin,
      outcome: 'unreachable',
    });
  }

  /**
   * LAST RESORT. A general search engine points at pages; it never states the
   * law, and what it finds is tiered by publisher before anything is concluded.
   *
   * Two shapes, and which one runs is decided by WHY the official route failed.
   * A source that answered and published nothing usable is still the right
   * place to look, so discovery stays restricted to its origin. A source that
   * refused the transport is not: asking the search engine for more pages on
   * the host that just refused cannot produce a readable one. In that case the
   * query becomes the actual legal question, and the best reasonably obtainable
   * source answers it — preferring the state's own publication, then another
   * government's, and carrying anything weaker at its real tier.
   */
  if (!retrieval.documents.length && deps.allowWebSearch !== false) {
    const restrictToOfficialHost = !retrieval.transportBlocked;
    for (const probe of FRAMEWORK_PROBES.slice(0, 3)) {
      let candidates: Array<{ url: string; label: string }> = [];
      try {
        candidates = await findStatutePages(probe, located.origin, state, deps, { restrictToOfficialHost });
      } catch {
        sourcesSearched.push({ label: `${located.body} — general search discovery`, url: located.origin, outcome: 'unreachable' });
        break;
      }
      for (const candidate of candidates.slice(0, restrictToOfficialHost ? 2 : 4)) {
        const document = await readDocument(candidate.url, candidate.label, deps, located.transportIsBrowser);
        if (!document) {
          sourcesSearched.push({ label: candidate.label, url: candidate.url, outcome: 'unreachable' });
          continue;
        }
        sourcesSearched.push({ label: candidate.label, url: candidate.url, outcome: 'read' });
        retrieval.documents.push({
          url: candidate.url, label: candidate.label, text: document.text,
          citation: null, effectiveNote: null, concepts: [], route: 'page_search',
        });
      }
      if (retrieval.documents.length) break;
    }
  }

  const anythingRead = retrieval.documents.length > 0;

  /**
   * Citation shapes LandOS has learned this source prints, if any. Absent for
   * an unfamiliar state, which then cites through the generic structural
   * ladder rather than not citing at all.
   */
  const sourceCitationShapes = learnedStateLawSource(state)?.config.citationShapes;

  /**
   * Match each framework concept against what was actually retrieved.
   *
   * A provision is recorded only when the retrieved OFFICIAL text contains the
   * concept's own pattern. Retrieval alone never becomes a finding: reaching a
   * chapter called "SUBDIVISION CONTROL ACT" proves the chapter exists, and the
   * pattern match is what proves it says something material.
   */
  for (const probe of FRAMEWORK_PROBES) {
    if (provisions.length >= (deps.maxDocuments ?? 8)) break;
    for (const document of retrieval.documents) {
      const matches = findProvisions(document.text, probe.pattern, { maxMatches: 1, window: 500 });
      if (!matches.length) continue;
      // The citation must come from the QUOTED text, not from the document at
      // large. A live Georgia run attached the Planning Act's citation to an
      // excerpt about annexation disputes, because the document-level citation
      // was simply the first one on the page. A citation that does not point at
      // the words beside it is worse than no citation.
      const citation: LegalSourceCitation = buildCitation({
        url: document.url,
        label: document.label,
        citation: extractStatuteCitation(matches[0].excerpt, '', sourceCitationShapes)
          ?? matches[0].section ?? document.citation,
        excerpt: matches[0].excerpt,
        format: document.route === 'document' ? 'pdf_text' : 'html',
        publisher: siteDomain(document.url) === siteDomain(located.origin) ? located.body : hostOf(document.url),
        effectiveDate: document.effectiveNote,
        // An agency publication is authoritative STATE material, but it is not
        // the statute text, and a page the state does not publish at all is
        // neither. Tiering each by its real publisher is the whole point.
        tier: stateFrameworkSourceTier(document.url, document.label, located.origin, document.route),
        retrievedAt: searchedAt,
      });
      provisions.push({
        kind: probe.kind,
        summary: boundExcerpt(matches[0].excerpt) ?? probe.query,
        citation,
        materialToSubject: true,
        materiality: probe.materiality,
      });
      break;
    }
  }

  const status: StateLandDivisionFramework['status'] =
    provisions.length > 0 ? 'present'
      : anythingRead ? 'not_found'
        : 'unverified';

  const localRetained = provisions.length
    ? evidencedValue(
        'The state provisions LandOS located set a baseline; the local unit administers approval and may supplement it where the state authorizes.',
        provisions.map((provision) => provision.citation),
      )
    : unresolvedValue<string>('No statewide provision was established, so what the state leaves to local government was not determined.');

  return { state, status, provisions, localAuthorityRetained: localRetained, sourcesSearched, searchedAt };
}

/** True when a located framework includes a manufactured-housing limit on local power. */
export function frameworkHasPreemption(framework: StateLandDivisionFramework): boolean {
  return framework.provisions.some((provision) => provision.kind === 'manufactured_housing_preemption');
}

/** True when a located framework establishes a land-division or platting baseline. */
export function frameworkHasLandDivisionBaseline(framework: StateLandDivisionFramework): boolean {
  return framework.provisions.some((provision) =>
    provision.kind === 'land_division_act'
    || provision.kind === 'subdivision_statute'
    || provision.kind === 'platting_statute'
    || provision.kind === 'minor_subdivision_framework'
    || provision.kind === 'parent_tract_framework');
}
