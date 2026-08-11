// LandOS — automatic OFFICIAL parcel/GIS source discovery.
//
// Starting from nothing but the property identity LandOS already holds, find
// the government source of record for that jurisdiction. The operator should
// not normally have to paste a URL.
//
// Two rules shape everything here.
//
// FIRST: hostname guessing is not a discovery method, it is a cheap last
// candidate generator. A county whose GIS lives on an abbreviation or an
// unrelated domain is undiscoverable that way, and a formula that happens to
// resolve is not evidence that what answered is official. So the formula runs
// last and its output is verified like any other candidate.
//
// SECOND: nothing is accepted because it looks plausible. Every candidate is
// verified as official or officially linked, and when two credible and
// genuinely different sources appear, LandOS says so and stops rather than
// picking one. Guessing a government source of record is worse than admitting
// it could not be resolved.

import {
  classifyCountyLink,
  officialDomainScore,
  officialSearchQuery,
  searchEngineUrl,
  sourceContradictsRequestedState,
  unwrapSearchResults,
  type CountySourceType,
  type PageLink,
} from './netr-routing.js';
import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';
import { probeArcgisServicesRoot, type ArcgisDiscoveryDeps, arcgisJson } from './arcgis-service-discovery.js';
import { EscalationLadder } from './gis-escalation.js';
import { deploymentHost } from './gis-platform-knowledge.js';
import type { GisPlatformFamily } from './gis-platform-types.js';

/* ───────────────────────────── vocabulary ────────────────────────────── */

export const SOURCE_DISCOVERY_METHODS = [
  /** Vendor-published directory naming the jurisdiction outright. */
  'provider_directory',
  /** Esri organisation/item search for the jurisdiction's parcel service. */
  'arcgis_org_search',
  /** Links found ON a verified official government page. */
  'official_site_links',
  /** Bounded public search, steered toward official results. */
  'restricted_web_search',
  /** Conventional hostname formula. Cheap, last, and verified like the rest. */
  'hostname_formula',
] as const;
export type SourceDiscoveryMethod = (typeof SOURCE_DISCOVERY_METHODS)[number];

export const SOURCE_DISCOVERY_FAILURES = [
  'OFFICIAL_GIS_SOURCE_NOT_FOUND',
  'MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION',
  'OFFICIAL_SOURCE_FOUND_PLATFORM_UNKNOWN',
] as const;
export type SourceDiscoveryFailure = (typeof SOURCE_DISCOVERY_FAILURES)[number];

export const OFFICIALITY_STATUSES = [
  /** A government domain, or a government-operated service host. */
  'official',
  /** A vendor host reached FROM a verified official page, or named by the
   *  vendor's own directory as serving this jurisdiction. */
  'officially_linked',
  /** Plausible but not established. Never selected on its own. */
  'unverified',
  /** A broker or aggregator, or a different state's same-named county. */
  'rejected',
] as const;
export type OfficialityStatus = (typeof OFFICIALITY_STATUSES)[number];

export interface OfficialityVerdict {
  status: OfficialityStatus;
  /** 0..1. Only used to order candidates of equal status. */
  score: number;
  /** Why LandOS reached this verdict. Operator-readable. */
  evidence: string[];
}

export interface OfficialSourceCandidate {
  url: string;
  label: string;
  method: SourceDiscoveryMethod;
  sourceType: CountySourceType | 'unknown';
  officiality: OfficialityVerdict;
  /** Set when the candidate was reached from another page. */
  linkedFrom?: string;
}

export interface OfficialSourceDiscoveryResult {
  candidates: OfficialSourceCandidate[];
  selected: OfficialSourceCandidate | null;
  /** Runner-up that forced a reconciliation stop, when one did. */
  competing: OfficialSourceCandidate | null;
  failure: SourceDiscoveryFailure | null;
  methodsRun: SourceDiscoveryMethod[];
  notes: string[];
}

/* ────────────────────────── officiality checks ───────────────────────── */

/** Vendor hosts that serve government records. Official only when corroborated. */
const GOVERNMENT_VENDOR_HOSTS = /(^|\.)(schneidercorp\.com|qpublic\.net|tylerhost\.net|vgsi\.com|sdgnys\.com|mapgeo\.io|devnetwedge\.com|arcgis\.com)$/i;

/** Aggregators and brokers. Never the source of record. */
const BROKER_HOSTS = /netronline|countyoffice|zillow|realtor|redfin|trulia|spokeo|whitepages|propertyshark|landglide|regrid|loopnet|homes\.com|har\.com|land\.com|landwatch|xome/i;

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/**
 * Decide whether a URL is the government source of record, something a
 * government explicitly points at, or neither.
 *
 * A vendor host is deliberately NOT official on its own: anyone can stand up a
 * qPublic-looking URL or publish a parcel layer to ArcGIS Online, and the
 * research for this lane found exactly that — unofficial county parcel layers
 * owned by private accounts. Corroboration is required, and it must come from
 * the government side: a link on an official page, or the vendor's own
 * directory naming that jurisdiction.
 */
export function verifyOfficiality(
  url: string,
  context: { county?: string; state?: string; linkedFromOfficial?: boolean; directoryNamedJurisdiction?: boolean; label?: string } = {},
): OfficialityVerdict {
  const host = hostOf(url);
  const evidence: string[] = [];
  if (!host) return { status: 'rejected', score: 0, evidence: ['Not a resolvable URL.'] };

  if (BROKER_HOSTS.test(host)) {
    return { status: 'rejected', score: 0, evidence: [`${host} is a commercial aggregator, not the source of record.`] };
  }

  // A same-named county in a different state is a real and easy mistake.
  const link: PageLink = { text: context.label ?? '', href: url };
  if (sourceContradictsRequestedState(link, context.county, context.state)) {
    return { status: 'rejected', score: 0, evidence: [`${host} refers to a same-named county in a different state.`] };
  }

  // A government domain is the source of record on its own.
  if (/\.gov$/i.test(host)) {
    evidence.push(`${host} is a .gov domain.`);
    return { status: 'official', score: 1, evidence };
  }
  if (/\.[a-z]{2}\.us$/i.test(host) || /(^|\.)co\.[a-z-]+\.[a-z]{2}\.us$/i.test(host)) {
    evidence.push(`${host} is a state-scoped .us government domain.`);
    return { status: 'official', score: 0.95, evidence };
  }

  if (GOVERNMENT_VENDOR_HOSTS.test(host)) {
    if (context.directoryNamedJurisdiction) {
      evidence.push(`${host} is a government-records platform whose own directory lists this jurisdiction.`);
      return { status: 'officially_linked', score: 0.85, evidence };
    }
    if (context.linkedFromOfficial) {
      evidence.push(`${host} is a government-records platform linked from a verified official page.`);
      return { status: 'officially_linked', score: 0.8, evidence };
    }
    evidence.push(`${host} is a government-records platform, but nothing official corroborated it for this jurisdiction.`);
    return { status: 'unverified', score: 0.4, evidence };
  }

  if (context.linkedFromOfficial) {
    evidence.push(`Linked from a verified official government page.`);
    return { status: 'officially_linked', score: 0.7, evidence };
  }

  // Everything else: score it, but never call it official on a guess.
  const domainScore = officialDomainScore(url, context.county, context.state);
  if (domainScore <= 0) return { status: 'rejected', score: 0, evidence: [`${host} scored zero on official-domain preference.`] };
  evidence.push(`${host} scores ${domainScore.toFixed(2)} on official-domain preference but is not a government domain.`);
  return { status: 'unverified', score: Math.min(0.6, domainScore), evidence };
}

/** Statuses a candidate may be selected from. `unverified` never qualifies. */
const SELECTABLE: ReadonlySet<OfficialityStatus> = new Set<OfficialityStatus>(['official', 'officially_linked']);

/* ────────────────────────── discovery methods ────────────────────────── */

export interface SourceDiscoveryDeps {
  /** Text transport. Wrap with the browser fallback for blocked hosts. */
  fetchText?: GovFetchText;
  /**
   * Transport for the public-search lane specifically.
   *
   * Search engines now serve a scripted interstitial to a plain server request
   * — it answers 202 with no result anchors, which is not a "block" any header
   * check would catch, just an empty page. Reading search results therefore
   * needs a real browser even though the rest of discovery does not.
   */
  searchFetchText?: GovFetchText;
  /**
   * Transport for SPECULATIVE hosts (the hostname formula).
   *
   * Deliberately never the browser-escalating one: a guessed hostname that
   * fails its TLS handshake is almost always simply not a real server, and
   * opening a background tab to confirm that costs tens of seconds per guess —
   * time the parcel search then does not have.
   */
  speculativeFetchText?: GovFetchText;
  /** Wall-clock ceiling for discovery alone, so it cannot starve the lane. */
  maxWallClockMs?: number;
  arcgis?: ArcgisDiscoveryDeps;
  ladder?: EscalationLadder;
  /** Candidate hostnames from the conventional formula. */
  hostnameCandidates?: string[];
  /** Vendor directory lookup: returns a URL when it names this jurisdiction. */
  providerDirectory?: (county: string | undefined, state: string | undefined) => Promise<{ url: string; label: string } | null>;
  /** Disable the public-search lane (tests, or an offline run). */
  allowWebSearch?: boolean;
  maxCandidates?: number;
}

export interface DiscoverySubject {
  county?: string;
  state?: string;
  city?: string;
}

const ARCGIS_SEARCH_ROOT = 'https://www.arcgis.com/sharing/rest/search';

/**
 * Ask Esri's public index for the jurisdiction's parcel service.
 *
 * High value and low cost, but it needs care: the index is full of unofficial
 * copies published by private accounts. A hit only becomes a candidate when the
 * service it points at is on a government domain, or the owning organisation
 * itself looks governmental. Title matching alone is not enough.
 */
export async function discoverViaArcgisOrgSearch(
  subject: DiscoverySubject,
  deps: SourceDiscoveryDeps = {},
): Promise<OfficialSourceCandidate[]> {
  const county = (subject.county ?? '').replace(/\s*county\s*$/i, '').trim();
  if (!county || !subject.state) return [];

  const query = `${county} County ${subject.state} parcels`;
  const payload = await arcgisJson<{
    results?: Array<{ id?: string; title?: string; type?: string; url?: string; owner?: string; orgId?: string; access?: string }>;
  }>(ARCGIS_SEARCH_ROOT, { q: query, num: '20', sortField: 'numviews', sortOrder: 'desc' }, deps.arcgis ?? {});

  const out: OfficialSourceCandidate[] = [];
  for (const item of payload.results ?? []) {
    if (!item.url || !/\/rest\/services\//i.test(item.url)) continue;
    if (item.access && item.access !== 'public') continue;
    const title = String(item.title ?? '');
    // The item must actually be about this county, not a statewide or
    // neighbouring layer that merely ranked well.
    if (!new RegExp(county.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(title)) continue;

    const serviceHost = hostOf(item.url);
    const owner = String(item.owner ?? '');
    const ownerLooksGovernmental = new RegExp(`${county}|county|gis|assessor|gov`, 'i').test(owner);
    const officiality = verifyOfficiality(item.url, {
      county: subject.county,
      state: subject.state,
      label: title,
      // A layer hosted on the county's own server is official by domain. One
      // hosted on Esri's is only corroborated when the owner is governmental.
      directoryNamedJurisdiction: /arcgis\.com$/i.test(serviceHost) && ownerLooksGovernmental,
    });
    if (officiality.status === 'rejected') continue;
    if (/arcgis\.com$/i.test(serviceHost) && !ownerLooksGovernmental) {
      officiality.evidence.push(`Published by "${owner}", which does not identify a government publisher.`);
    }
    out.push({ url: item.url, label: title, method: 'arcgis_org_search', sourceType: 'gis', officiality });
  }
  return out;
}

/** Link text/URL tokens that mean "this goes to the parcel/property system". */
const PROPERTY_SYSTEM_TOKENS = /parcel|property\s*(search|record|lookup|information)|assessor|appraiser|tax\s*(map|record)|gis|land\s*record/i;

/**
 * Read a verified official government page and take the links it publishes to
 * its own property and GIS systems.
 *
 * This is the strongest method there is, because the government itself is
 * saying where its records live. A vendor URL found this way is corroborated
 * in exactly the way `verifyOfficiality` requires.
 */
export async function discoverViaOfficialSiteLinks(
  officialPageUrl: string,
  subject: DiscoverySubject,
  deps: SourceDiscoveryDeps = {},
): Promise<OfficialSourceCandidate[]> {
  const pageVerdict = verifyOfficiality(officialPageUrl, { county: subject.county, state: subject.state });
  // Only a page LandOS has established as official may confer officiality.
  if (pageVerdict.status !== 'official') return [];

  const fetchText = deps.fetchText ?? defaultGovFetchText;
  deps.ladder?.noteRequest();
  const page = await fetchText(officialPageUrl);
  if (page.blocked || !page.body) return [];

  const out: OfficialSourceCandidate[] = [];
  for (const link of extractLinks(page.body, page.url)) {
    const hay = `${link.label} ${link.url}`;
    if (!PROPERTY_SYSTEM_TOKENS.test(hay)) continue;
    const officiality = verifyOfficiality(link.url, {
      county: subject.county,
      state: subject.state,
      label: link.label,
      linkedFromOfficial: true,
    });
    if (officiality.status === 'rejected') continue;
    out.push({
      url: link.url,
      label: htmlToText(link.label).slice(0, 90),
      method: 'official_site_links',
      sourceType: classifyCountyLink({ text: link.label, href: link.url }) ?? 'unknown',
      officiality,
      linkedFrom: page.url,
    });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Bounded public search, steered toward official results.
 *
 * Used only when the government-side methods found nothing, and its output is
 * verified like everything else — a search result is a lead, never an answer.
 */
export async function discoverViaRestrictedWebSearch(
  subject: DiscoverySubject,
  types: readonly CountySourceType[],
  deps: SourceDiscoveryDeps = {},
): Promise<OfficialSourceCandidate[]> {
  const fetchText = deps.searchFetchText ?? deps.fetchText ?? defaultGovFetchText;
  const out: OfficialSourceCandidate[] = [];

  for (const type of types) {
    if (deps.ladder?.stageExhausted()) break;
    const query = officialSearchQuery(type, subject.county, subject.state);
    deps.ladder?.noteRequest();
    let page;
    try {
      page = await fetchText(searchEngineUrl(query));
    } catch {
      continue;
    }
    if (page.blocked || !page.body) continue;

    const results = unwrapSearchResults(
      extractLinks(page.body, page.url).map((l) => ({ text: l.label, href: l.url })),
    );
    for (const result of results.slice(0, 25)) {
      const officiality = verifyOfficiality(result.href, {
        county: subject.county,
        state: subject.state,
        label: result.text,
      });
      // A search result gets no corroboration from having been searched for,
      // so only a genuine government domain survives this lane.
      if (officiality.status !== 'official') continue;
      if (!PROPERTY_SYSTEM_TOKENS.test(`${result.text} ${result.href}`)) continue;
      out.push({
        url: result.href,
        label: (result.text || type).slice(0, 90),
        method: 'restricted_web_search',
        sourceType: classifyCountyLink(result) ?? type,
        officiality,
      });
      if (out.length >= 10) break;
    }
  }
  return out;
}

/** The conventional hostname formula, verified like any other candidate. */
export async function discoverViaHostnameFormula(
  hosts: readonly string[],
  subject: DiscoverySubject,
  deps: SourceDiscoveryDeps = {},
): Promise<OfficialSourceCandidate[]> {
  const out: OfficialSourceCandidate[] = [];
  for (const host of hosts.slice(0, 6)) {
    if (deps.ladder?.stageExhausted()) break;
    try {
      const probe = await probeArcgisServicesRoot(`https://${host}`, deps.arcgis, ['arcgis', 'server']);
      if (!probe) continue;
      const officiality = verifyOfficiality(probe.servicesRoot, { county: subject.county, state: subject.state });
      if (officiality.status === 'rejected') continue;
      out.push({
        url: probe.servicesRoot,
        label: `ArcGIS server answering at ${host}`,
        method: 'hostname_formula',
        sourceType: 'gis',
        officiality,
      });
      break;
    } catch {
      // A host that does not exist is the expected case for a guess.
    }
  }
  return out;
}

/* ───────────────────── reconciliation and selection ──────────────────── */

/** The registrable domain, so `www.` and `gis.` of one county are one source. */
function registrableDomain(url: string): string {
  const host = deploymentHost(url);
  const parts = host.split('.');
  // Handles the common government forms: example.gov, co.example.tn.us.
  return parts.length <= 2 ? host : parts.slice(-3).join('.').replace(/^[^.]+\.(?=[^.]+\.(gov|com|org|net)$)/, '');
}

/**
 * Two candidates are the same source when they belong to the same government
 * domain. A county publishing its GIS on `gis.` and its landing page on `www.`
 * is one authority, not two competing ones, and treating them as rivals would
 * stop the lane on an ambiguity that does not exist.
 */
function sameSource(a: OfficialSourceCandidate, b: OfficialSourceCandidate): boolean {
  return deploymentHost(a.url) === deploymentHost(b.url) || registrableDomain(a.url) === registrableDomain(b.url);
}

const STATUS_RANK: Record<OfficialityStatus, number> = { official: 0, officially_linked: 1, unverified: 2, rejected: 3 };

/**
 * How directly usable a candidate is. A queryable service beats a recognised
 * application, which beats a landing page.
 *
 * This is a real discriminator, not a taste preference: a service endpoint can
 * answer a parcel query immediately, while a landing page still has to be
 * crawled. Ranking on it resolves most apparent ambiguities honestly, so the
 * lane only stops when candidates really are equally actionable.
 */
export function candidateActionability(candidate: OfficialSourceCandidate): number {
  if (/\/rest\/services\//i.test(candidate.url)) return 2;
  const fingerprint = fingerprintPlatform({ url: candidate.url });
  return fingerprint.recommendedAdapter === 'generic_fallback' ? 0 : 1;
}

/**
 * Choose one source, or refuse to.
 *
 * Refusing matters: two credible, genuinely different government sources for
 * the same jurisdiction is a real situation (a county GIS and a separate
 * assessor system), and silently picking one would attach a parcel to the
 * wrong system of record. LandOS reports both and stops.
 */
export function reconcileOfficialCandidates(
  candidates: readonly OfficialSourceCandidate[],
): { selected: OfficialSourceCandidate | null; competing: OfficialSourceCandidate | null; failure: SourceDiscoveryFailure | null } {
  const usable = candidates
    .filter((c) => SELECTABLE.has(c.officiality.status))
    .sort((a, b) => (STATUS_RANK[a.officiality.status] - STATUS_RANK[b.officiality.status])
      || (candidateActionability(b) - candidateActionability(a))
      || (b.officiality.score - a.officiality.score));

  if (!usable.length) return { selected: null, competing: null, failure: 'OFFICIAL_GIS_SOURCE_NOT_FOUND' };

  const best = usable[0];
  const bestActionability = candidateActionability(best);
  // A rival must be a DIFFERENT government, of equal standing, and equally
  // actionable. Anything less is a preference LandOS can settle itself; this
  // is reserved for the case where two authorities genuinely both look right.
  const rival = usable.find((c) => !sameSource(c, best)
    && c.officiality.status === best.officiality.status
    && candidateActionability(c) === bestActionability
    && Math.abs(c.officiality.score - best.officiality.score) < 0.05
    && c.sourceType === best.sourceType);

  if (rival) return { selected: null, competing: rival, failure: 'MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION' };
  return { selected: best, competing: null, failure: null };
}

/* ──────────────────────────── the discovery ──────────────────────────── */

/** Source types worth searching for, strongest first. */
const SEARCH_TYPES: readonly CountySourceType[] = ['gis', 'assessor', 'appraiser'];

/**
 * Find the official parcel/GIS source for a jurisdiction from identity alone.
 *
 * Methods run cheapest-and-most-authoritative first and STOP as soon as an
 * official candidate is found, so a county LandOS can resolve from a vendor
 * directory never pays for a web search.
 */
export async function discoverOfficialSource(
  subject: DiscoverySubject,
  deps: SourceDiscoveryDeps = {},
): Promise<OfficialSourceDiscoveryResult> {
  const ladder = deps.ladder;
  const notes: string[] = [];
  const methodsRun: SourceDiscoveryMethod[] = [];
  const candidates: OfficialSourceCandidate[] = [];
  const maxCandidates = deps.maxCandidates ?? 24;
  // Discovery gets its own clock. Without it a slow jurisdiction can consume
  // the whole subject budget and leave nothing for the search that matters.
  const startedAt = Date.now();
  const maxWallClockMs = deps.maxWallClockMs ?? 35_000;
  const outOfTime = () => Date.now() - startedAt >= maxWallClockMs;

  const add = (found: OfficialSourceCandidate[], method: SourceDiscoveryMethod) => {
    methodsRun.push(method);
    for (const candidate of found) {
      if (candidates.length >= maxCandidates) break;
      if (candidates.some((existing) => existing.url === candidate.url)) continue;
      candidates.push(candidate);
    }
  };
  const haveOfficial = () => candidates.some((c) => SELECTABLE.has(c.officiality.status));

  // 1. A vendor directory that names the jurisdiction outright.
  if (deps.providerDirectory) {
    try {
      const hit = await deps.providerDirectory(subject.county, subject.state);
      if (hit) {
        add([{
          url: hit.url,
          label: hit.label,
          method: 'provider_directory',
          sourceType: 'assessor',
          officiality: verifyOfficiality(hit.url, { county: subject.county, state: subject.state, label: hit.label, directoryNamedJurisdiction: true }),
        }], 'provider_directory');
      } else {
        methodsRun.push('provider_directory');
        notes.push('No vendor directory lists this jurisdiction.');
      }
    } catch (error) {
      methodsRun.push('provider_directory');
      notes.push(`Vendor directory unavailable: ${(error as Error).message}`);
    }
  }

  // 2. Esri's public index. Cheap and often decisive for parcel geometry.
  if (!ladder?.stageExhausted() && !outOfTime()) {
    try {
      add(await discoverViaArcgisOrgSearch(subject, deps), 'arcgis_org_search');
    } catch (error) {
      methodsRun.push('arcgis_org_search');
      notes.push(`Esri index unavailable: ${(error as Error).message}`);
    }
  }

  // 3. Links published BY the government. The strongest corroboration there is,
  //    so it runs even when earlier methods produced something.
  for (const host of (deps.hostnameCandidates ?? []).slice(0, 3)) {
    if (ladder?.stageExhausted() || outOfTime()) break;
    const verdict = verifyOfficiality(`https://${host}`, { county: subject.county, state: subject.state });
    if (verdict.status !== 'official') continue;
    try {
      // Speculative host: direct transport only, never a browser tab.
      const found = await discoverViaOfficialSiteLinks(`https://${host}`, subject, {
        ...deps,
        fetchText: deps.speculativeFetchText ?? defaultGovFetchText,
      });
      if (found.length) { add(found, 'official_site_links'); break; }
    } catch {
      // An unreachable official host is not an error worth surfacing.
    }
  }

  // 4. Bounded public search, only when the government side gave nothing.
  if (!haveOfficial() && deps.allowWebSearch !== false && !ladder?.stageExhausted() && !outOfTime()) {
    try {
      add(await discoverViaRestrictedWebSearch(subject, SEARCH_TYPES, deps), 'restricted_web_search');
    } catch (error) {
      methodsRun.push('restricted_web_search');
      notes.push(`Public search unavailable: ${(error as Error).message}`);
    }
  }

  // 5. The hostname formula. Last, and never trusted on its own name.
  if (!haveOfficial() && deps.hostnameCandidates?.length && !ladder?.stageExhausted() && !outOfTime()) {
    try {
      add(await discoverViaHostnameFormula(deps.hostnameCandidates, subject, deps), 'hostname_formula');
    } catch {
      methodsRun.push('hostname_formula');
    }
  }

  if (outOfTime()) notes.push(`Discovery stopped at its ${Math.round(maxWallClockMs / 1000)}s ceiling so the parcel search keeps its budget.`);

  const { selected, competing, failure } = reconcileOfficialCandidates(candidates);
  if (failure === 'OFFICIAL_GIS_SOURCE_NOT_FOUND') {
    notes.push(candidates.length
      ? `${candidates.length} candidate(s) were found but none could be established as official.`
      : 'No candidate government source was found for this jurisdiction.');
  }
  if (failure === 'MULTIPLE_OFFICIAL_CANDIDATES_NEEDS_RECONCILIATION' && competing) {
    notes.push(`Two official sources of equal standing were found and could not be told apart: ${candidates[0]?.url} and ${competing.url}.`);
  }

  return { candidates, selected, competing, failure, methodsRun: [...new Set(methodsRun)], notes };
}

/**
 * Classify a discovered source. An official source LandOS cannot fingerprint is
 * still a real finding, and it is reported as such rather than as "not found" —
 * the operator can use the link even when no adapter applies.
 */
export function classifyDiscoveredSource(candidate: OfficialSourceCandidate): {
  family: GisPlatformFamily;
  failure: SourceDiscoveryFailure | null;
} {
  const fingerprint = fingerprintPlatform({ url: candidate.url });
  const unknown = fingerprint.family === 'unknown' || fingerprint.family === 'custom_government_portal';
  return {
    family: fingerprint.family,
    failure: unknown ? 'OFFICIAL_SOURCE_FOUND_PLATFORM_UNKNOWN' : null,
  };
}
