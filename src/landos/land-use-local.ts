// LandOS — LOCAL zoning and subdivision research.
//
// Finds the adopted local law that actually governs the parcel, and resolves
// WHO adopted it. Both halves matter: knowing that a zoning ordinance exists is
// useless if it belongs to a municipality the parcel is not in, and the single
// most common way to get this wrong nationwide is to assume the county zones.
//
// Search order, and the reason for it:
//
//   1. The LOCAL UNIT's code, when a real sub-county government contains the
//      parcel. A township or town that zones displaces the county entirely in
//      much of the country.
//   2. The COUNTY's code.
//   3. The county's own website, which is where a county that does NOT zone
//      typically says so — and an affirmative official statement of no zoning
//      is a verified conclusion, not a failed search.
//
// Nothing here names a jurisdiction, and the same code path runs for a county
// LandOS has researched a hundred times and one it has never seen.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { searchEngineUrl, unwrapSearchResults } from './netr-routing.js';
import { boundExcerpt, buildCitation, hostOf, isGovernmentHost } from './land-use-evidence.js';
import { stateName } from './state-legal-sources.js';
import { lookupECode360 } from './ecode360-lookup.js';
import { discoverGovernmentHosts, registryBasis } from './gov-domain-registry.js';
import {
  lookupMunicode,
  ordinanceLinksOn,
  readGovernmentOrdinance,
  type OrdinanceCodeSource,
  type OrdinanceDocument,
} from './land-use-ordinance.js';
import { extractZoningPresence, searchProvisions } from './land-use-extract.js';
import type { GovernmentUnitType, LegalSourceCitation } from './land-use-types.js';

export interface LocalResearchInput {
  county: string | null;
  state: string | null;
  /** The local unit resolved by the authority lane, when it is a government. */
  localUnitName: string | null;
  localUnitType: GovernmentUnitType;
  /** Official planning / zoning URLs the parcel lane already found. */
  knownPlanningUrls: ReadonlyArray<{ label: string; url: string }>;
  now: string;
}

/**
 * The learned official-site cache, injected rather than imported.
 *
 * Discovery costs real requests, and a government's own website does not change
 * between two properties in the same township. The store lives at the
 * composition root; this lane only asks.
 */
export interface OfficialSiteCache {
  get(state: string, jurisdiction: string, unitType: GovernmentUnitType): { url: string; label: string } | null;
  save(entry: {
    state: string;
    jurisdiction: string;
    unitType: GovernmentUnitType;
    url: string;
    label: string;
    verifiedVia: 'hostname_formula' | 'dotgov_registry';
    basis: string;
  }): void;
}

export interface LocalResearchDeps {
  fetchText?: GovFetchText;
  allowWebSearch?: boolean;
  /** Cap on ordinance requests for this lane. */
  maxRequests?: number;
  /** Absent means "do not cache": the lane never reaches for storage itself. */
  siteCache?: OfficialSiteCache | null;
}

export interface AuthorityFinding {
  body: string;
  unitType: GovernmentUnitType;
  citations: LegalSourceCitation[];
  noConventionalZoning: boolean;
}

export interface LocalResearchResult {
  codeSources: OrdinanceCodeSource[];
  documents: OrdinanceDocument[];
  zoningAuthority: AuthorityFinding | null;
  subdivisionAuthority: Omit<AuthorityFinding, 'noConventionalZoning'> | null;
  /** Official government sites LandOS verified for this jurisdiction. */
  officialSites: Array<{ label: string; url: string }>;
  notes: string[];
  unreadable: Array<{ url: string; reason: string }>;
  /** Set when a source demanded payment. The lane stops rather than paying. */
  paidAccessBlocked: Array<{ url: string; detail: string }>;
}

const PAYWALL_PATTERN = /\b(?:add\s+to\s+cart|purchase\s+(?:this\s+)?(?:document|copy)|\$\s?\d+(?:\.\d{2})?\s*(?:per|to\s+(?:view|download))|subscription\s+required|paid\s+subscribers?\s+only)\b/i;

/**
 * Whether an official-looking host really belongs to this jurisdiction.
 *
 * A `.gov` host is not enough on its own — the state sweep in this sprint found
 * conventional hosts that resolved to an entirely different government. The
 * host or the page must name the jurisdiction.
 */
export function hostServesJurisdiction(url: string, jurisdiction: string | null, state: string | null): boolean {
  if (!isGovernmentHost(url)) return false;
  const host = hostOf(url);
  const token = (jurisdiction ?? '').toLowerCase().replace(/\b(county|parish|city|town|township|village|borough)\b/g, '').replace(/[^a-z]/g, '');
  if (!token) return false;
  const stateToken = (state ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const flat = host.replace(/[^a-z]/g, '');
  if (flat.includes(token)) return true;
  // A state-run portal that hosts county pages is acceptable only when the
  // state token is present AND the jurisdiction token appears in the path.
  return !!stateToken && flat.includes(stateToken) && url.toLowerCase().replace(/[^a-z]/g, '').includes(token);
}

/**
 * Hostnames a local government's own website is conventionally published under.
 *
 * A FORMULA, not a list: nothing here names a jurisdiction and adding one
 * requires no code. It exists because a search engine is not a dependency this
 * engine can rest on — the live sweep for this sprint found the search host
 * answering automated queries with an anti-bot page and zero results, which
 * would silently reduce every jurisdiction to "no official site found".
 *
 * Candidates are verified before anything they say is used, exactly like the
 * parcel engine's county GIS host formula.
 */
export function deriveOfficialSiteHosts(
  jurisdiction: string,
  state: string,
  unitType: GovernmentUnitType,
): string[] {
  const name = jurisdiction.toLowerCase()
    .replace(/\b(county|parish|city|town|township|village|borough)\b/g, '')
    .replace(/[^a-z]/g, '');
  const st = state.toLowerCase().replace(/[^a-z]/g, '');
  if (!name || !st) return [];

  const isCounty = unitType === 'county' || unitType === 'unincorporated_county' || unitType === 'parish';
  const unit = unitType === 'township' ? 'township'
    : unitType === 'town' ? 'town'
      : unitType === 'village' ? 'village'
        : unitType === 'borough' ? 'borough'
          : 'city';

  const hosts = isCounty
    ? [
        // `{name}county{state}.gov` is the general form. A hardcoded
        // `...countyga.gov` line used to sit here as well; it was Georgia
        // spelled out and it produced exactly the same host the general form
        // already produces for a Georgia parcel, so removing it costs nothing
        // and takes one state's name out of a nationwide formula.
        `www.${name}county${st}.gov`, `${name}county${st}.gov`,
        `www.${name}county.gov`, `${name}county.gov`,
        `www.${name}county.org`, `${name}county.org`,
        `www.co.${name}.${st}.us`, `co.${name}.${st}.us`,
        `www.${name}county.us`, `www.${name}county.com`,
      ]
    : [
        `www.${name}${unit}${st}.gov`, `${name}${unit}${st}.gov`,
        `www.${unit}of${name}.org`, `${unit}of${name}.org`,
        `www.${name}${unit}.org`, `${name}${unit}.org`,
        `www.${name}${st}.gov`, `${name}${st}.gov`,
        `www.${name}${unit}.com`,
        `www.${unit}of${name}.com`,
        `www.${name}.${st}.us`,
      ];
  return [...new Set(hosts)];
}

/**
 * Verified official sites for a jurisdiction, plus the pages on them that
 * answer land-use questions.
 *
 * Order, and why:
 *
 *   1. The LEARNED site, when this government has already been verified once.
 *      Discovery is not repeated for a jurisdiction LandOS already knows.
 *   2. The HOSTNAME FORMULA. Free, no dependency, and correct for a large share
 *      of the country.
 *   3. The OFFICIAL .GOV REGISTRY. The formula can only find a government that
 *      spells its own name out; a great many abbreviate. The registrar's own
 *      table names the registrant organization, so a match there is verified
 *      government ownership rather than a hostname that merely looks official.
 *   4. The search engine, last. It answers automated queries with a challenge
 *      here, which is reported rather than read as an empty result set.
 */
async function findOfficialSite(
  jurisdiction: string,
  state: string,
  unitType: GovernmentUnitType,
  deps: LocalResearchDeps,
): Promise<Array<{ label: string; url: string }>> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const found: Array<{ label: string; url: string }> = [];

  /* 1. Already learned. */
  const learned = deps.siteCache?.get(state, jurisdiction, unitType) ?? null;
  if (learned) {
    found.push(learned);
    found.push(...await pagesFromSiteIndex(learned.url, jurisdiction, deps));
    return found;
  }

  /* 2. The hostname formula. */
  for (const host of deriveOfficialSiteHosts(jurisdiction, state, unitType)) {
    if (found.length) break;
    try {
      const response = await fetchText(`https://${host}`, { timeoutMs: 12_000 });
      if (response.blocked || response.status >= 400) continue;
      if (!hostServesJurisdiction(response.url, jurisdiction, state)) continue;
      const text = htmlToText(response.body);
      // The page must NAME the jurisdiction. A host that merely resolves is not
      // evidence that it belongs to this government.
      const token = jurisdiction.toLowerCase().replace(/\b(county|parish)\b/g, '').trim();
      if (token && !text.toLowerCase().includes(token)) continue;
      // And it must be the one in THIS state. Jurisdiction names repeat across
      // states constantly: the formula for one township in Michigan resolved
      // live to an identically-named township in Ohio, whose page names the
      // township perfectly well. Reading its zoning as this parcel's would be a
      // cross-jurisdiction evidence leak of exactly the kind the parcel engine
      // already refuses.
      if (!pageServesState(text, state)) continue;
      found.push({ label: `${jurisdiction} official website`, url: response.url });
      deps.siteCache?.save({
        state, jurisdiction, unitType, url: response.url,
        label: `${jurisdiction} official website`,
        verifiedVia: 'hostname_formula',
        basis: `${hostOf(response.url)} resolved, is a government host, and its own page names ${jurisdiction} in ${state}.`,
      });
      // The site's own index is the reliable route to its land-use pages. A
      // government CMS publishes one even when its navigation is script-driven,
      // which is why homepage link extraction alone finds nothing on many sites.
      found.push(...await pagesFromSiteIndex(response.url, jurisdiction, deps));
    } catch {
      // A host that does not exist is the expected case for most candidates.
    }
  }

  /* 3. The official .gov registry. */
  if (!found.length) {
    found.push(...await officialSiteFromRegistry(jurisdiction, state, unitType, deps));
  }

  if (found.length || deps.allowWebSearch === false) return found;

  // Last resort. Kept because it reaches jurisdictions the formula cannot.
  const query = `${jurisdiction} ${stateName(state) ?? state} official website zoning ordinance`;
  try {
    const response = await fetchText(searchEngineUrl(query), { timeoutMs: 25_000 });
    if (response.blocked || response.status >= 400) return found;
    const links = unwrapSearchResults(
      extractLinks(response.body, response.url).map((link) => ({ text: link.label, href: link.url })),
    );
    const byHost = new Map<string, { label: string; url: string }>();
    for (const link of links) {
      if (!hostServesJurisdiction(link.href, jurisdiction, state)) continue;
      const host = hostOf(link.href);
      if (!byHost.has(host)) byHost.set(host, { label: link.text || `${jurisdiction} official site`, url: link.href });
    }
    return [...byHost.values()].slice(0, 3);
  } catch {
    return found;
  }
}

/**
 * Locate a government's real site through the official .gov registry.
 *
 * The formula in `deriveOfficialSiteHosts` derives a host from the
 * jurisdiction's spelled-out name, so it cannot reach a government that
 * abbreviates: the live acceptance county publishes at `gtcountymi.gov` and no
 * permutation of "grand traverse" produces it. The registrar's table closes
 * exactly that gap and closes it nationwide, because the match is on the
 * REGISTRANT ORGANIZATION and the state — not on how the hostname reads.
 *
 * A registry row establishes ownership; the live page is still fetched, because
 * a source LandOS cannot read is not a source it can cite.
 */
async function officialSiteFromRegistry(
  jurisdiction: string,
  state: string,
  unitType: GovernmentUnitType,
  deps: LocalResearchDeps,
): Promise<Array<{ label: string; url: string }>> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const found: Array<{ label: string; url: string }> = [];
  let candidates: Awaited<ReturnType<typeof discoverGovernmentHosts>> = [];
  try {
    candidates = await discoverGovernmentHosts(jurisdiction, state, unitType, { fetchText: deps.fetchText });
  } catch {
    return found;
  }

  const attempted = new Set<string>();
  for (const candidate of candidates) {
    if (found.length) break;
    if (attempted.has(candidate.host)) continue;
    attempted.add(candidate.host);
    try {
      const response = await fetchText(`https://${candidate.host}`, { timeoutMs: 12_000 });
      if (response.blocked || response.status >= 400) continue;
      const text = htmlToText(response.body);
      // Ownership is already established by the registry row. The page is read
      // to confirm the site is live and still speaks for this government —
      // either by naming it or by the registrant organization matching it
      // exactly, which is the case a bare acronym host depends on.
      const token = jurisdiction.toLowerCase().replace(/\b(county|parish)\b/g, '').trim();
      const namesJurisdiction = !!token && text.toLowerCase().includes(token);
      const organizationNames = registryOrganizationMatches(candidate.row.organization, jurisdiction);
      if (!namesJurisdiction && !organizationNames) continue;
      const basis = registryBasis(candidate.row);
      found.push({ label: `${jurisdiction} official website`, url: response.url });
      deps.siteCache?.save({
        state, jurisdiction, unitType, url: response.url,
        label: `${jurisdiction} official website`,
        verifiedVia: 'dotgov_registry',
        basis,
      });
      found.push(...await pagesFromSiteIndex(response.url, jurisdiction, deps));
    } catch {
      // A registry row whose site is unreachable right now is not a match.
    }
  }
  return found;
}

/** Whether a registrant organization is this jurisdiction under another spelling. */
function registryOrganizationMatches(organization: string, jurisdiction: string): boolean {
  const flatten = (value: string): string => value
    .toLowerCase()
    .replace(/\bcharter\b/g, ' ')
    .replace(/\b(county|parish|borough|city|town|township|village|municipality|of|the)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  const org = flatten(organization);
  const wanted = flatten(jurisdiction);
  return !!org && !!wanted && org === wanted;
}

/**
 * Whether a page belongs to a jurisdiction in the requested state.
 *
 * Accepts either the state name or the postal code used as a place qualifier
 * ("Williamsburg, Michigan" or "Williamsburg, MI"), and rejects a page that
 * names a DIFFERENT state as its own place qualifier.
 */
export function pageServesState(pageText: string, state: string): boolean {
  const code = state.trim().toUpperCase();
  const name = stateName(code);
  if (!name) return true;
  const haystack = pageText.slice(0, 30_000);
  if (new RegExp(`\\b${name}\\b`, 'i').test(haystack)) return true;
  if (new RegExp(`,\\s*${code}\\b`).test(haystack)) return true;
  // Nothing identified the state either way. Do not accept: an unlabelled page
  // is not evidence that it serves this state.
  return false;
}

/** Site-index paths that government content systems publish. */
const SITE_INDEX_PATHS = ['/sitemap.aspx', '/sitemap.xml', '/sitemap', '/site-map', '/Sitemap'];

/** Link text or path that indicates a land-use page worth reading. */
const LAND_USE_PAGE = /zon(?:e|ing)|planning|subdivi|ordinanc|land[-_ ]?use|development|permit|building|code[-_ ]?of[-_ ]?ordinance/i;

/**
 * How strongly a site-index entry answers the land-division question.
 *
 * A government site index is long and the generic words in `LAND_USE_PAGE`
 * appear all over it. Reading matches in document order let a county's own
 * index hand back "Person-Centered Planning", "Strategic Planning" and
 * "Developmentally Disabled Guardianships" — all real matches on "planning" and
 * "development", none of them land use — while its ordinance and plat pages sat
 * further down and were never read. Rank first, then take the bounded set.
 */
const LAND_USE_PAGE_RANK: ReadonlyArray<{ rx: RegExp; score: number }> = [
  { rx: /subdivi|land[-_ ]?divi|\bplat\b|\bplats\b|lot[-_ ]?split/i, score: 4 },
  // `zoning`, not bare `zone`: a county's "No Scam Zone" consumer page is a
  // real match on the loose form and is not land use.
  { rx: /\bzoning\b|\bzoned\b|ordinanc|land[-_ ]?use|master[-_ ]?plan/i, score: 3 },
  { rx: /planning\s*(?:&|and|_|-)?\s*(?:zoning|department|commission|division|services)|development\s*(?:services|department|review)/i, score: 2 },
  { rx: LAND_USE_PAGE, score: 1 },
];

export function landUsePageScore(text: string): number {
  for (const rank of LAND_USE_PAGE_RANK) if (rank.rx.test(text)) return rank.score;
  return 0;
}

/**
 * Pull land-use pages off a jurisdiction's own site index.
 *
 * This is what turns "we found the county's website" into "we found the page
 * where the county states whether it zones". On the acceptance subject that
 * page is a single sitemap entry, and it carries the county's own affirmative
 * statement that it has no zoning — a verified legal conclusion that no amount
 * of ordinance reading would have produced, because the answer is the ABSENCE
 * of a zoning chapter and absence proves nothing on its own.
 */
async function pagesFromSiteIndex(
  siteUrl: string,
  jurisdiction: string,
  deps: LocalResearchDeps,
): Promise<Array<{ label: string; url: string }>> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const origin = (() => { try { return new URL(siteUrl).origin; } catch { return null; } })();
  if (!origin) return [];

  for (const path of SITE_INDEX_PATHS) {
    try {
      const response = await fetchText(`${origin}${path}`, { timeoutMs: 20_000 });
      if (response.blocked || response.status >= 400 || response.body.length < 2000) continue;
      const links = extractLinks(response.body, response.url)
        .filter((link) => hostOf(link.url) === hostOf(response.url))
        .map((link, index) => ({ link, index, score: landUsePageScore(`${link.url} ${link.label}`) }))
        .filter((candidate) => candidate.score > 0)
        // Most specific first; ties keep the index's own order so a site that
        // lists its ordinance chapters in sequence is still read in sequence.
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map((candidate) => candidate.link);
      if (!links.length) continue;
      const seen = new Set<string>();
      const picked: Array<{ label: string; url: string }> = [];
      for (const link of links) {
        if (seen.has(link.url) || picked.length >= 5) continue;
        seen.add(link.url);
        picked.push({ label: `${jurisdiction} — ${link.label || 'land use page'}`, url: link.url });
      }
      if (picked.length) return picked;
    } catch {
      // Try the next index shape.
    }
  }
  return [];
}

/**
 * Read a jurisdiction's own site for what it says about zoning.
 *
 * This is where an affirmative "we do not zone" statement lives, and it is the
 * difference between `NO_CONVENTIONAL_ZONING_VERIFIED` and
 * `ZONING_AUTHORITY_UNRESOLVED`. The lane also follows the page's own links,
 * because such a statement is frequently a linked letter rather than page text.
 */
async function readJurisdictionSiteForZoning(
  sites: ReadonlyArray<{ label: string; url: string }>,
  deps: LocalResearchDeps,
): Promise<{ documents: OrdinanceDocument[]; read: string[]; paid: Array<{ url: string; detail: string }> }> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const documents: OrdinanceDocument[] = [];
  const read: string[] = [];
  const paid: Array<{ url: string; detail: string }> = [];

  for (const site of sites.slice(0, 4)) {
    try {
      const response = await fetchText(site.url, { timeoutMs: 30_000 });
      read.push(site.url);
      if (response.blocked || response.status >= 400) continue;
      if (PAYWALL_PATTERN.test(response.body)) {
        paid.push({ url: site.url, detail: 'The source offers this record for payment. LandOS stopped rather than purchasing it.' });
        continue;
      }
      const text = htmlToText(response.body);
      if (text.trim().length >= 120) {
        documents.push({ title: site.label, section: null, text, url: site.url, topic: 'zoning' });
      }
      // Follow the page's own ordinance links one level. A "no zoning letter"
      // or an ordinance PDF is routinely one click from the page that names it.
      for (const link of ordinanceLinksOn(response.body, response.url).slice(0, 3)) {
        if (read.includes(link.url)) continue;
        const nested = await readGovernmentOrdinance(link.url, link.label, link.topic, { fetchText });
        read.push(...nested.read);
        documents.push(...nested.documents);
      }
    } catch {
      // An unreachable page is recorded by its absence from `read`.
    }
  }
  return { documents, read, paid };
}

/**
 * Run the local lane.
 *
 * Both the local unit and the county are researched when a sub-county
 * government exists, because which one zones is the question — not an input.
 */
export async function researchLocalLandUse(
  input: LocalResearchInput,
  deps: LocalResearchDeps = {},
): Promise<LocalResearchResult> {
  const notes: string[] = [];
  const codeSources: OrdinanceCodeSource[] = [];
  const documents: OrdinanceDocument[] = [];
  const unreadable: LocalResearchResult['unreadable'] = [];
  const paidAccessBlocked: LocalResearchResult['paidAccessBlocked'] = [];
  const officialSites: Array<{ label: string; url: string }> = [];

  const state = (input.state ?? '').trim().toUpperCase();
  if (!state) {
    return { codeSources, documents, zoningAuthority: null, subdivisionAuthority: null, officialSites, notes: ['No state was established, so local law could not be located.'], unreadable, paidAccessBlocked };
  }

  const localUnitIsGovernment =
    !!input.localUnitName
    && input.localUnitType !== 'unincorporated_county'
    && input.localUnitType !== 'county'
    && input.localUnitType !== 'unknown';

  /* 1. The local unit's own code, when a sub-county government exists. */
  let localUnitDocuments: OrdinanceDocument[] = [];
  if (localUnitIsGovernment && input.localUnitName) {
    const unitKind = input.localUnitType === 'township' ? 'township' : 'municipality';
    const lookup = await lookupMunicode(input.localUnitName, state, unitKind, { fetchText: deps.fetchText, maxRequests: deps.maxRequests });
    notes.push(...lookup.notes);
    unreadable.push(...lookup.unreadable);
    if (lookup.source) codeSources.push(lookup.source);
    localUnitDocuments = lookup.documents;
    documents.push(...lookup.documents);

    // One codifier is not the market. When Municode does not publish this
    // jurisdiction, try the other dominant one — which is edge-protected, so
    // the SHARED transport carries it into a background Chrome target rather
    // than reading the refusal as an absent code.
    if (!lookup.documents.length) {
      const ecode = await lookupECode360(input.localUnitName, state, { fetchText: deps.fetchText });
      notes.push(...ecode.notes);
      if (ecode.source) codeSources.push(ecode.source);
      if (ecode.documents.length) {
        localUnitDocuments = [...localUnitDocuments, ...ecode.documents];
        documents.push(...ecode.documents);
      } else if (ecode.blocker) {
        // A refusal is recorded as unreadable; a genuine absence is only a note.
        if (ecode.transportRefused) unreadable.push({ url: ecode.read[0] ?? 'https://ecode360.com', reason: ecode.blocker });
      }
    }
  }

  /* 2. The county's code. */
  let countyDocuments: OrdinanceDocument[] = [];
  if (input.county) {
    const lookup = await lookupMunicode(input.county, state, 'county', { fetchText: deps.fetchText, maxRequests: deps.maxRequests });
    notes.push(...lookup.notes);
    unreadable.push(...lookup.unreadable);
    if (lookup.source) codeSources.push(lookup.source);
    countyDocuments = lookup.documents;
    documents.push(...lookup.documents);
  }

  /* 3. Official jurisdiction websites. Always, because a code that contains no
        zoning chapter does not by itself establish that nobody zones. */
  const siteTargets: Array<{ jurisdiction: string; unitType: GovernmentUnitType }> = [];
  if (localUnitIsGovernment && input.localUnitName) {
    siteTargets.push({ jurisdiction: input.localUnitName, unitType: input.localUnitType });
  }
  if (input.county) siteTargets.push({ jurisdiction: input.county, unitType: 'county' });

  // Site documents are read PER TARGET so each one keeps the jurisdiction it
  // came from. Pooling them loses the only thing that makes them usable: a
  // zoning administrator page proves the body that publishes it zones, and says
  // nothing whatever about the other body in the stack.
  const localUnitSiteDocuments: OrdinanceDocument[] = [];
  const countySiteDocuments: OrdinanceDocument[] = [];

  for (const target of siteTargets) {
    const found = await findOfficialSite(target.jurisdiction, state, target.unitType, deps);
    officialSites.push(...found);
    const read = await readJurisdictionSiteForZoning(found, deps);
    documents.push(...read.documents);
    paidAccessBlocked.push(...read.paid);
    if (target.unitType === 'county') countySiteDocuments.push(...read.documents);
    else localUnitSiteDocuments.push(...read.documents);
  }

  // Planning URLs the parcel lane already verified cost nothing to reuse. Their
  // jurisdiction is not established, so they inform the county view only —
  // never the local unit's, where a wrong attribution would invent an
  // authority finding.
  const knownUnread = input.knownPlanningUrls.filter((known) => !officialSites.some((site) => site.url === known.url));
  if (knownUnread.length) {
    officialSites.push(...knownUnread);
    const read = await readJurisdictionSiteForZoning(knownUnread, deps);
    documents.push(...read.documents);
    paidAccessBlocked.push(...read.paid);
    countySiteDocuments.push(...read.documents);
  }

  /* Resolve the zoning authority from what was actually read. */
  const zoningAuthority = resolveZoningAuthority({
    localUnitName: input.localUnitName,
    localUnitType: input.localUnitType,
    localUnitIsGovernment,
    countyName: input.county,
    localUnitDocuments: [...localUnitDocuments, ...localUnitSiteDocuments],
    countyDocuments: [...countyDocuments, ...countySiteDocuments],
    siteDocuments: [...localUnitSiteDocuments, ...countySiteDocuments],
    now: input.now,
  });

  const subdivisionAuthority = resolveSubdivisionAuthority({
    localUnitName: input.localUnitName,
    localUnitType: input.localUnitType,
    localUnitIsGovernment,
    countyName: input.county,
    localUnitDocuments,
    countyDocuments,
    now: input.now,
  });

  return { codeSources, documents, zoningAuthority, subdivisionAuthority, officialSites, notes, unreadable, paidAccessBlocked };
}

/* ───────────────────────── authority determination ───────────────────── */

interface AuthorityResolutionFacts {
  localUnitName: string | null;
  localUnitType: GovernmentUnitType;
  localUnitIsGovernment: boolean;
  countyName: string | null;
  localUnitDocuments: readonly OrdinanceDocument[];
  countyDocuments: readonly OrdinanceDocument[];
  siteDocuments: readonly OrdinanceDocument[];
  now: string;
}

function citationsFrom(documents: readonly OrdinanceDocument[], now: string, tier: LegalSourceCitation['tier'], limit = 2): LegalSourceCitation[] {
  return documents.slice(0, limit).map((document) => buildCitation({
    url: document.url,
    label: document.title,
    citation: document.section,
    excerpt: document.text.slice(0, 600),
    format: 'html',
    tierHint: tier,
    retrievedAt: now,
  }));
}

/**
 * Decide who zones, from evidence only.
 *
 * A body is the zoning authority when its OWN adopted law establishes zoning
 * districts. A body is established as NOT zoning when it affirmatively says so.
 * Everything else stays unresolved — including the very common case where a
 * code simply has no zoning chapter, which is suggestive and is not proof.
 */
export function resolveZoningAuthority(facts: AuthorityResolutionFacts): AuthorityFinding | null {
  const { now } = facts;

  // An affirmative statement of no zoning outranks everything: it is the
  // jurisdiction speaking directly to the question.
  const siteFinding = extractZoningPresence(facts.siteDocuments);
  if (siteFinding.statesNoZoning) {
    const hits = siteFinding.hits.filter((hit) => /no\s+zoning|not\s+zoned|unzoned/i.test(hit.match.excerpt));
    const citations = hits.slice(0, 2).map((hit) => buildCitation({
      url: hit.document.url,
      label: hit.document.title,
      citation: hit.match.section,
      excerpt: hit.match.excerpt,
      format: 'html',
      tierHint: 'planning_department',
      retrievedAt: now,
    }));
    const body = facts.countyName ?? facts.localUnitName ?? 'The local jurisdiction';
    return {
      body,
      unitType: facts.localUnitIsGovernment ? facts.localUnitType : 'unincorporated_county',
      citations,
      noConventionalZoning: true,
    };
  }

  const localZoning = extractZoningPresence(facts.localUnitDocuments);
  if (facts.localUnitIsGovernment && facts.localUnitName && localZoning.statesZoning) {
    return {
      body: facts.localUnitName,
      unitType: facts.localUnitType,
      citations: citationsFrom(facts.localUnitDocuments.filter((document) => document.topic === 'zoning'), now, 'zoning_ordinance'),
      noConventionalZoning: false,
    };
  }

  const countyZoning = extractZoningPresence(facts.countyDocuments);
  if (facts.countyName && countyZoning.statesZoning) {
    return {
      body: facts.countyName,
      unitType: 'county',
      citations: citationsFrom(facts.countyDocuments.filter((document) => document.topic === 'zoning'), now, 'zoning_ordinance'),
      noConventionalZoning: false,
    };
  }

  // A county code with no zoning chapter, and no statement either way. This is
  // exactly the case that must NOT be reported as "no zoning".
  const countyStatesNoZoning = extractZoningPresence(facts.countyDocuments).statesNoZoning;
  if (countyStatesNoZoning && facts.countyName) {
    return {
      body: facts.countyName,
      unitType: 'county',
      citations: citationsFrom(facts.countyDocuments, now, 'county_code'),
      noConventionalZoning: true,
    };
  }
  return null;
}

export function resolveSubdivisionAuthority(facts: Omit<AuthorityResolutionFacts, 'siteDocuments'>): Omit<AuthorityFinding, 'noConventionalZoning'> | null {
  const { now } = facts;
  const localSubdivision = facts.localUnitDocuments.filter((document) => document.topic === 'subdivision');
  if (facts.localUnitIsGovernment && facts.localUnitName && localSubdivision.length) {
    return { body: facts.localUnitName, unitType: facts.localUnitType, citations: citationsFrom(localSubdivision, now, 'subdivision_ordinance') };
  }
  const countySubdivision = facts.countyDocuments.filter((document) => document.topic === 'subdivision');
  if (facts.countyName && countySubdivision.length) {
    return { body: facts.countyName, unitType: 'county', citations: citationsFrom(countySubdivision, now, 'subdivision_ordinance') };
  }

  // A development chapter that regulates division without being titled
  // "subdivision" is common and is still the controlling procedure.
  const developmentDivision = [...facts.localUnitDocuments, ...facts.countyDocuments]
    .filter((document) => document.topic === 'buildings_and_development');
  const hits = searchProvisions(developmentDivision, /subdivi\w+|divi\w+\s+of\s+land|plat\b/gi, { maxTotal: 2 });
  if (hits.length) {
    const isLocal = facts.localUnitDocuments.includes(hits[0].document);
    const body = isLocal ? facts.localUnitName : facts.countyName;
    if (body) {
      return {
        body,
        unitType: isLocal ? facts.localUnitType : 'county',
        citations: hits.map((hit) => buildCitation({
          url: hit.document.url, label: hit.document.title, citation: hit.match.section,
          excerpt: hit.match.excerpt, format: 'html', tierHint: 'subdivision_ordinance', retrievedAt: now,
        })),
      };
    }
  }
  return null;
}

/** Operator-readable note naming what a jurisdiction publishes, for the panel. */
export function describeCodeCoverage(sources: readonly OrdinanceCodeSource[]): string {
  if (!sources.length) return 'No adopted code was located for this jurisdiction.';
  return sources
    .map((source) => `${source.jurisdictionLabel}${source.codifiedThrough ? ` (${source.codifiedThrough})` : ''}`)
    .join('; ');
}

/** Bounded excerpt of a document, for a citation built outside the extractors. */
export function documentExcerpt(document: OrdinanceDocument): string | null {
  return boundExcerpt(document.text);
}
