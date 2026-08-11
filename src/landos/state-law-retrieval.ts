// LandOS — official STATE LAW discovery and retrieval.
//
// The nationwide analogue of the parcel/GIS provider foundation, and it exists
// for the same reason: the previous lane's only route into statute text was a
// general search engine, that engine refuses automated queries, and the failure
// was SILENT — every state came back "no provision found" when the truth was
// "LandOS could not look".
//
// Retrieval preference, enforced by the order of the resolvers:
//
//   official structured index / TOC  →  official object addressing
//     →  official sitemap  →  official downloadable document
//       →  official on-site search  →  background browser (bounded)
//
// A general web search is DISCOVERY ONLY and is never permitted to state what
// the law says. Nothing here contains a legal answer: the adapters locate
// authoritative text and hand it back with its URL, and the extractors decide
// what it means.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { extractPdfText } from './pdf-text.js';
import { hostOf, isGovernmentHost } from './land-use-evidence.js';
import { learnedStateLawSource, rememberStateLawSource } from './state-law-learning.js';
import {
  deriveStateLegalHostCandidates,
  stateLegalSourceFor,
  stateName,
  verifiesAsStateLegalSource,
  type LegalSourceTransport,
  type StateLawPlatform,
  type StateLawPlatformConfig,
} from './state-legal-sources.js';

/* ─────────────────────────── concept vocabulary ──────────────────────── */

/**
 * What LandOS is looking for, expressed as CONCEPTS rather than citations.
 *
 * This is the piece that makes the engine nationwide. It never carries a
 * statute number, so a state LandOS has never researched is handled exactly
 * like one it has: the adapter matches these words against whatever the state's
 * own index calls its chapters, articles and sections.
 */
export const LAW_CONCEPTS = [
  'land_division',
  'subdivision_platting',
  'zoning_enabling',
  'manufactured_housing',
  'onsite_sewage',
  'highway_access',
] as const;
export type LawConcept = (typeof LAW_CONCEPTS)[number];

/**
 * Concept terms, deliberately TIGHT.
 *
 * A first live run used looser terms and the cost was immediate and instructive:
 * `survey` pulled Michigan's surveyor licensing act and a Georgia historic-
 * resources survey page, and a bare `town` pulled New York's "Classification of
 * Towns" and a Georgia county health department. A loose term does not just add
 * noise here — it displaces the real provision out of the top-ranked slots and
 * the lane then reports the wrong chapter with a straight face.
 */
const CONCEPT_TERMS: Record<LawConcept, RegExp> = {
  land_division: /\bland\s+division\b|\bdivision\s+of\s+land\b|\bsubdivision\s+control\b|\bpartition\s+of\s+land\b/i,
  subdivision_platting: /\bsubdivi\w*|\bplat(?:s|ting|ted)?\b|\bland\s+development\b/i,
  zoning_enabling: /\bzoning\b|\bplanning,?\s+housing\b|\bmunicipal\s+planning\b|\bland[-\s]use\s+regulation\b|\bcomprehensive\s+plan\b/i,
  manufactured_housing: /\bmanufactured\s+hous\w*|\bmobile\s+home\b|\bmanufactured\s+home\b|\bmodular\s+home\b|\bfactory[-\s]built\b/i,
  onsite_sewage: /\bon-?site\s+sewage\b|\bseptic\b|\bsewage\s+disposal\b|\bonsite\s+wastewater\b/i,
  highway_access: /\bdriveway\s+permit\b|\baccess\s+permit\b|\bstate\s+trunkline\b|\bencroachment\s+permit\b/i,
};

/**
 * Bodies of law that CONTAIN local land-use authority.
 *
 * Used at the chapter level only, where the state's own label names the body of
 * law ("Town", "Village", "General Municipal") rather than the subject. The
 * subject concepts then select the article inside it — which is where "Zoning
 * and Planning" actually lives.
 */
const LOCAL_GOVERNMENT_BODY =
  /\b(?:town|township|village|city|municipal|municipalit(?:y|ies)|county|counties|parish|borough|local\s+government)\b/i;

/**
 * Paths that indicate a page stating GOVERNING RULES rather than a programme,
 * a contact list or a survey. Applied on top of the concept match for the
 * sitemap route, where the only label available is the URL itself.
 */
const GOVERNING_RULES_PATH =
  /statute|regulation|governing|guidance|rule|ordinance|code|standard|requirement|law|act\b|planning|zoning|subdivision|onsite|sewage/i;

/** Concepts that matter to a rural acreage subject, best first. */
export const DEFAULT_CONCEPTS: readonly LawConcept[] = [
  'land_division', 'subdivision_platting', 'zoning_enabling', 'manufactured_housing',
];

/**
 * Score a label against the requested concepts.
 *
 * Deliberately coarse: a chapter description is a handful of words, and a
 * scoring model that needs more than "does the state's own title for this
 * chapter mention the concept" would be fitting noise.
 */
export function scoreLabel(label: string, concepts: readonly LawConcept[]): { score: number; matched: LawConcept[] } {
  const matched: LawConcept[] = [];
  let score = 0;
  for (const concept of concepts) {
    if (CONCEPT_TERMS[concept].test(label)) {
      matched.push(concept);
      // Earlier concepts in the caller's list are the ones it cares about most.
      score += concepts.length - concepts.indexOf(concept);
    }
  }
  return { score, matched };
}

/* ───────────────────────────── result shapes ─────────────────────────── */

export interface StateLawDocument {
  /** Operator-clickable official URL. */
  url: string;
  /** The source's own label for this object. */
  label: string;
  /** Plain text of the provision. Never rewritten. */
  text: string;
  /** Formal citation as the source prints it, when one could be read. */
  citation: string | null;
  /** "Complete through …" / "Codified through …", when the source states it. */
  effectiveNote: string | null;
  concepts: LawConcept[];
  /** How it was obtained, so the operator sees the real route. */
  route: 'structured_index' | 'object_address' | 'sitemap' | 'document' | 'page_search' | 'background_browser';
}

export interface StateLawRetrieval {
  platform: StateLawPlatform;
  /** The official origin that answered, when one did. */
  origin: string | null;
  documents: StateLawDocument[];
  /** Every URL read, so "nothing found" is inspectable. */
  read: string[];
  notes: string[];
  /** Named reason when the state's own publication could not be read at all. */
  blocker: string | null;
  /**
   * True when the publication was never actually read because the TRANSPORT
   * refused — an edge challenge, a chain the client could not verify, a reset.
   *
   * "We could not look" and "we looked and there is nothing there" are
   * different facts and this lane used to report them identically: a Michigan
   * run whose every request failed the TLS handshake was reported as a source
   * that "exposed no machine-readable route to the governing statutes", which
   * reads to an operator as an absence of state law. A caller that sees this
   * flag knows the answer is still out there and must change discovery method.
   */
  transportBlocked: boolean;
}

export interface StateLawDeps {
  /** The shared transport. It already escalates to a background tab when blocked. */
  fetchText?: GovFetchText;
  /** Hard cap on requests for this state, so one slow site cannot stall a run. */
  maxRequests?: number;
  concepts?: readonly LawConcept[];
  /**
   * The kind of local government that contains the subject ("town",
   * "township", "city"...).
   *
   * Several states publish a SEPARATE body of law per kind of local unit, and
   * only one of them governs this parcel. Without the hint the lane picks
   * whichever local-government chapter sorts first, which on a live New York
   * run meant Alternative County Government instead of Town Law.
   */
  localUnitHint?: string | null;
  /**
   * The official publication the caller already located and VERIFIED.
   *
   * The framework lane does that work before this function is called, and it
   * used to be thrown away here in favour of a registry lookup — so a state the
   * lane had just discovered and read was still reported as having no known
   * publication. When this is supplied it is authoritative.
   */
  source?: LocatedStateLegalSource | null;
  /** False in tests, so a run writes nothing to shared state knowledge. */
  learn?: boolean;
  now?: () => string;
}

function emptyRetrieval(platform: StateLawPlatform, blocker: string | null, note: string): StateLawRetrieval {
  return { platform, origin: null, documents: [], read: [], notes: [note], blocker, transportBlocked: false };
}

/* ────────────────────────── citation extraction ──────────────────────── */

/**
 * Citation SHAPES, expressed structurally so an unfamiliar state can be cited.
 *
 * This ladder used to open with four literal citation formats — O.C.G.A., MCL,
 * Michigan public acts and New York consolidated laws — which meant a state
 * nobody had written a pattern for could retrieve its own statute and then fail
 * to cite it, and an uncitable provision is one this engine refuses to state.
 * Each entry below describes a FORM instead: an initialised code abbreviation
 * with a hyphenated section, a short code abbreviation with a decimal section,
 * a named body of law with a section symbol, a public act by number and year, a
 * title-and-section pair. Between them they read the citation styles the states
 * actually print, and they name none of them.
 *
 * A source LandOS has studied can still supply its own house style through
 * `citationShapes`; those are tried first and the ladder remains the floor.
 */
const GENERIC_CITATION_SHAPES: RegExp[] = [
  // "O.C.G.A. 36-66-1", "R.S.A. 674:21", "N.M.S.A. 47-6-1"
  /\b(?:[A-Z]\.){2,}[A-Z]?\.?\s*§*\s*\d+[-:.]\d+(?:[-:.]\d+)*(?:\.\d+)?/,
  // "MCL 560.111", "RCW 58.17.010", "ORS 92.010"
  /\b[A-Z]{2,8}\s*§*\s*\d+[.\-]\d+(?:[.\-]\d+)*[a-z]?\b/,
  // "Town Law § 276", "Revised Code § 711.001", "General Statutes § 8-25"
  /\b(?:[A-Z][a-zA-Z]*\s+){1,3}(?:Law|Code|Statutes?|Act|Ann\.)\s*§+\s*\d+[\d.\-a-zA-Z]*/,
  // "Act 288 of 1967" — how many states cite a public act before codification.
  /\bAct\s+\d+\s+of\s+\d{4}\b/i,
  // "Title 30, Section 4-101", "Chapter 236, § 236.02"
  /\b(?:Title|Chapter)\s+\d+[\d.\-a-zA-Z]*,?\s*(?:§+|Section)\s*\d+[\d.\-a-zA-Z]*/i,
];

/** Windowed last resort: a bare section reference near the top of the text. */
const BARE_SECTION_SHAPES: RegExp[] = [
  /§+\s*\d+[\d.\-a-zA-Z]*/,
  /\bSection\s+\d+[\d.\-a-zA-Z]*/i,
];

function compileShapes(shapes: readonly string[] | undefined): RegExp[] {
  if (!shapes?.length) return [];
  const out: RegExp[] = [];
  for (const shape of shapes) {
    try { out.push(new RegExp(shape)); } catch { /* a bad learned shape is skipped, never thrown */ }
  }
  return out;
}

/**
 * Read a formal citation out of official text.
 *
 * A citation is evidence of WHERE a rule lives, so a missing one is left null
 * rather than synthesised from a URL. Learned source shapes and the structural
 * ladder are searched across the WHOLE document, and only the bare-section
 * fallbacks are windowed: a live Georgia page carried its O.C.G.A. citations
 * below the fold and a windowed search returned a stray "Section 106" from the
 * page furniture instead.
 */
export function extractStatuteCitation(
  text: string,
  label: string,
  sourceShapes?: readonly string[],
): string | null {
  const full = `${label} ${text}`;
  const haystack = `${label} ${text.slice(0, 4000)}`;
  for (const pattern of [...compileShapes(sourceShapes), ...GENERIC_CITATION_SHAPES]) {
    const match = full.match(pattern);
    if (match) return match[0].replace(/\s+/g, ' ').trim();
  }
  for (const pattern of BARE_SECTION_SHAPES) {
    const match = haystack.match(pattern);
    if (match) return match[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** "Complete Through PA 20 of 2026", "Codified through …", "(Supp. No. 5)". */
export function extractEffectiveNote(text: string): string | null {
  const match = text.match(/\b(?:Complete|Codified|Current|Amended|Effective)\s+[Tt]hrough[^.\n]{0,90}/)
    ?? text.match(/\(Supp\.\s*No\.\s*\d+\)/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}


/**
 * Remove site chrome from retrieved legal text.
 *
 * Government publications wrap statutes in navigation, account links and
 * session banners. Leaving it in is not cosmetic: the provision matcher takes
 * the FIRST match, and on a live Michigan run the act number appeared in the
 * page title before it appeared in the statute, so the recorded excerpt read
 * "Related Sites Help Sign Up Log In MCL - Act 288 of 1967" instead of the law.
 * An operator checking that citation would find navigation furniture.
 */
export function stripPageFurniture(text: string): string {
  const chrome = [
    /Skip to (?:main )?content/gi,
    /Sign\s*Up|Log\s*In|Sign\s*In|Create an Account/gi,
    /Related Sites|Quick Links|Helpful Links|Site Map|Accessibility|Privacy Policy/gi,
    /Share\s+Facebook\s+Email|Follow (?:the|us)[^.]{0,40}/gi,
    /(?:Senate|House) adjourned until[^.]{0,60}/gi,
    /Download Statute|Bills Affecting this Statute|View Statute Index/gi,
    /Previous Statute|Next Statute|Printer Friendly|Add To Favorites/gi,
    /Enter your keywords|Popular searches|Search this site/gi,
    // Legislature and government-CMS navigation, which is the same handful
    // of words on essentially every such site.
    /\b(?:Archives|Historical Documents|Committee Meeting Notifications|Legislative Directory|Publications|Bills|Resolutions|Calendars|Committees|Journals|Legislators|Breadcrumb|Main navigation|Subnavigation toggle[^|]{0,40})\b/gi,
    /\b(?:Manuals|Newsroom|Contact Us|About|Home|Menu|Close|Toggle)\b/gi,
    /you need to enable JavaScript[^.]{0,60}/gi,
  ];
  let out = text;
  for (const pattern of chrome) out = out.replace(pattern, " ");
  return out.replace(/\s+/g, " ").trim();
}
/* ───────────────────────────── shared reader ─────────────────────────── */

interface ReadResult { url: string; body: string; text: string; blocked: boolean; status: number }

/**
 * The request budget, plus whether the transport ever REFUSED.
 *
 * The flag is carried on the budget because the budget is already the one
 * object every adapter threads through every read. A refusal recorded three
 * adapters deep therefore reaches the entry point, which is the only place that
 * can tell the difference between an unreadable source and an empty one.
 */
export interface ReadBudget {
  left: number;
  /** Set when any read was refused by the transport rather than answered. */
  transportBlocked?: boolean;
}

async function read(url: string, fetchText: GovFetchText, budget: ReadBudget, readLog: string[], timeoutMs = 35_000): Promise<ReadResult | null> {
  if (budget.left <= 0) return null;
  budget.left -= 1;
  readLog.push(url);
  try {
    const response = await fetchText(url, { timeoutMs });
    // A challenge page, or a transport that reported it could not get through,
    // is NOT content. Parsing it produced a document whose text was the edge's
    // own wording, and the concept matcher then found nothing in it — which is
    // indistinguishable from a source that published nothing.
    if (response.blocked) {
      budget.transportBlocked = true;
      return null;
    }
    if (response.status >= 400 && !response.body) return null;
    // A PDF arrives as latin1-decoded bytes through the text transport.
    const text = /\.pdf($|\?)/i.test(url)
      ? extractPdfText(Buffer.from(response.body, 'latin1'))
      : htmlToText(response.body);
    return { url: response.url || url, body: response.body, text: stripPageFurniture(text), blocked: response.blocked, status: response.status };
  } catch {
    // A transport that THREW never delivered a page. Whether it was a chain the
    // client could not verify, a reset or a timeout, the honest reading is "not
    // read", never "read and empty".
    budget.transportBlocked = true;
    return null;
  }
}

/* ───────────────── adapter 1: object-addressed code ──────────────────── */

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * An index location may be a path on the origin or an absolute URL.
 *
 * Publishing the code on a sibling subdomain — `archive.<host>`, `mca.<host>` —
 * is ordinary, and pasting such a path onto the origin would request a page
 * that does not exist. The learned configuration therefore stores whichever
 * form is correct and every adapter resolves it through here.
 */
export function resolveSourceUrl(origin: string, pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${origin}${pathOrUrl}`;
}

/**
 * The regex source that lifts an object id out of a link on this source.
 *
 * Derived from the source's OWN object template rather than assumed. A code
 * addressed as `?objectName={id}` yields `objectName=([^"&]+)`; one addressed
 * as `/laws/{id}` yields the path shape. The adapter previously hardcoded the
 * first form, so a state that addressed its objects by path could not be read
 * even after its index had been found.
 */
export function objectIdShape(config: StateLawPlatformConfig): string | null {
  const template = config.objectPath;
  if (!template) return null;
  const queryParam = template.match(/[?&]([\w.-]+)=\{id\}/)?.[1];
  if (queryParam) return `${escapeRegex(queryParam)}=([^"&']+)`;
  const pathBase = template.match(/^(.*)\/\{id\}/)?.[1];
  if (pathBase !== undefined) return `${escapeRegex(pathBase)}/([^"'&?#/]+)`;
  return null;
}

/** Longest shared `prefix-` the source puts on its own object ids. */
export function deriveObjectIdPrefix(ids: readonly string[]): string | null {
  const prefixes = ids
    .map((id) => id.match(/^([a-z]{2,8}-)/i)?.[1])
    .filter((value): value is string => !!value);
  if (prefixes.length < 2) return null;
  const first = prefixes[0].toLowerCase();
  return prefixes.every((prefix) => prefix.toLowerCase() === first) ? first : null;
}

/**
 * Turn a printed section number into this source's object id.
 *
 * The template is source configuration. Michigan's `560.111` becomes
 * `mcl-560-111`; a source that addresses sections some other way says so in its
 * own template instead of being forced through Michigan's.
 */
export function sectionObjectId(config: StateLawPlatformConfig, section: string, prefix: string | null): string {
  const template = config.sectionIdTemplate ?? '{prefix}{sectionDashed}';
  return template
    .replace('{prefix}', config.objectIdPrefix ?? prefix ?? '')
    .replace('{sectionDashed}', section.replace(/\./g, '-'))
    .replace('{section}', section);
}

/**
 * Sources that publish an official index mapping an object id to a description,
 * and address every object by that id.
 *
 * Verified live on Michigan: `/Laws/ChapterIndex` returns a table of
 * `objectName=mcl-chapNNN` against the chapter's own title, one of which is
 * "SUBDIVISION CONTROL ACT OF 1967". The chapter page then links its acts, and
 * an act page renders full statutory text. No section number has to be known in
 * advance, which is exactly the gap this pass exists to close.
 *
 * Nothing about Michigan survives in this function. The id parameter, the id
 * prefix, the child-object shape, the section-id template and the citation
 * label all arrive on `config` — either learned for this source, or detected
 * from it, or derived here from what the index itself exposes.
 */
export async function runObjectAddressedCode(
  origin: string,
  config: StateLawPlatformConfig,
  concepts: readonly LawConcept[],
  fetchText: GovFetchText,
  budget: ReadBudget,
  readLog: string[],
): Promise<StateLawDocument[]> {
  if (!config.indexPath || !config.objectPath) return [];
  const idShape = objectIdShape(config);
  if (!idShape) return [];
  const documents: StateLawDocument[] = [];

  const index = await read(resolveSourceUrl(origin, config.indexPath), fetchText, budget, readLog);
  if (!index) return documents;

  // Index rows: an object link followed by the source's own description cell.
  const rowPattern = new RegExp(`${idShape}"[^>]*>([\\s\\S]*?)</a>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'gi');
  const clean = (value: string): string =>
    value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  let rows = [...index.body.matchAll(rowPattern)]
    .map((match) => ({ id: match[1], label: clean(match[2]), description: clean(match[3]) }))
    .filter((row) => row.id && row.description);

  // Not every index is a table. When it is a plain link list, the anchor text
  // IS the source's own description, which is all the concept match needs.
  if (!rows.length) {
    const linkPattern = new RegExp(`${idShape}"[^>]*>([\\s\\S]*?)</a>`, 'gi');
    rows = [...index.body.matchAll(linkPattern)]
      .map((match) => ({ id: match[1], label: clean(match[2]), description: clean(match[2]) }))
      .filter((row) => row.id && row.description.length > 3);
  }

  const derivedPrefix = config.objectIdPrefix ?? deriveObjectIdPrefix(rows.map((row) => row.id));

  const ranked = rows
    .map((row) => ({ row, ...scoreLabel(row.description, concepts) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const effectiveNote = extractEffectiveNote(index.text);
  // The child shape is a FILTER on the ids a container links, not a second way
  // of finding them. Keeping it out of the extraction regex means it works the
  // same whether the source addresses objects by query parameter or by path.
  let childFilter: RegExp | null = null;
  if (config.childObjectPattern) {
    try { childFilter = new RegExp(config.childObjectPattern, 'i'); } catch { childFilter = null; }
  }

  for (const entry of ranked) {
    const objectUrl = `${origin}${config.objectPath.replace('{id}', encodeURIComponent(entry.row.id))}`;
    const chapter = await read(objectUrl, fetchText, budget, readLog);
    if (!chapter) continue;

    // A container object lists the objects it contains. Read the best of them,
    // because the child carries the operative text and the container a list.
    const children = [...new Set([...chapter.body.matchAll(new RegExp(idShape, 'gi'))].map((match) => match[1]))]
      .filter((id) => id && id !== entry.row.id)
      .filter((id) => !childFilter || childFilter.test(id));
    let readAChild = false;
    for (const childId of children.slice(0, 2)) {
      const childUrl = `${origin}${config.objectPath.replace('{id}', encodeURIComponent(childId))}`;
      const child = await read(childUrl, fetchText, budget, readLog);
      if (!child || child.text.trim().length < 400) continue;
      readAChild = true;
      const bareId = derivedPrefix ? childId.replace(new RegExp(`^${escapeRegex(derivedPrefix)}`, 'i'), '') : childId;
      documents.push({
        url: childUrl,
        label: `${entry.row.description} — ${bareId.replace(/-/g, ' ')}`,
        text: child.text,
        citation: extractStatuteCitation(child.text, childId, config.citationShapes),
        effectiveNote: extractEffectiveNote(child.text) ?? effectiveNote,
        concepts: entry.matched,
        route: 'object_address',
      });

      // A container page often renders DIVISIONS and their section ranges, not
      // the operative text. Follow the most concept-relevant division into a
      // real section, because "PRELIMINARY PLATS (560.111...560.120)" tells an
      // operator a chapter exists and says nothing about what it requires.
      for (const division of rankDivisions(child.text, concepts).slice(0, 2)) {
        const sectionId = sectionObjectId(config, division.firstSection, derivedPrefix);
        const sectionUrl = `${origin}${config.objectPath.replace('{id}', encodeURIComponent(sectionId))}`;
        const section = await read(sectionUrl, fetchText, budget, readLog);
        if (!section || section.text.trim().length < 300) continue;
        documents.push({
          url: sectionUrl,
          label: `${entry.row.description} — ${division.name} § ${division.firstSection}`,
          text: section.text,
          // The source's own name for its sections when it is known, and an
          // honest bare section reference when it is not.
          citation: config.citationLabel
            ? `${config.citationLabel} ${division.firstSection}`
            : extractStatuteCitation(section.text, '', config.citationShapes) ?? `§ ${division.firstSection}`,
          effectiveNote: extractEffectiveNote(section.text) ?? effectiveNote,
          concepts: division.matched,
          route: 'object_address',
        });
      }
    }

    if (!readAChild && chapter.text.trim().length > 400) {
      documents.push({
        url: objectUrl,
        label: entry.row.description,
        text: chapter.text,
        citation: extractStatuteCitation(chapter.text, entry.row.label, config.citationShapes),
        effectiveNote,
        concepts: entry.matched,
        route: 'structured_index',
      });
    }
  }
  return documents;
}

/* ───────────────── adapter 2: article TOC code ───────────────────────── */

/**
 * Where a code's chapter links live, when the source has not said.
 *
 * Derived from the index path itself: a consolidated index at
 * `/legislation/laws/CONSOLIDATED` has its chapters as siblings under
 * `/legislation/laws/`. That is a structural fact about a TOC, not a fact about
 * New York, and it is what the adapter used to hardcode.
 */
export function deriveChapterLinkShape(indexPathOrUrl: string): RegExp {
  const path = indexPathOrUrl.startsWith('http')
    ? (() => { try { return new URL(indexPathOrUrl).pathname; } catch { return indexPathOrUrl; } })()
    : indexPathOrUrl;
  // The chapters are the index's SIBLINGS: one path segment below the
  // directory the index itself lives in. An earlier version demanded an
  // uppercase token, which is how one publisher happens to name its law
  // groups; a code whose titles are addressed `title_0070` was invisible.
  const base = path.replace(/\/[^/]*$/, '');
  return new RegExp(`${escapeRegex(base)}/([^/"'?#]+)`);
}

/**
 * Where a chapter's articles live, when the source has not said.
 *
 * The same sibling rule the chapters use, one level further down. The default
 * used to be `/(A\d+…)` — the way ONE publisher addresses its articles — which
 * meant a code whose chapters contain `chapter_0010` reached its chapter page
 * and then found nothing inside it.
 */
export function deriveArticleLinkShape(chapterUrl: string): RegExp {
  let path = chapterUrl;
  try { path = new URL(chapterUrl).pathname; } catch { /* already a path */ }
  path = path.replace(/\/$/, '');
  // A chapter addressed as a FILE (`…/title_0070/chapters_index.html`) contains
  // its articles in its own directory; a chapter addressed as a PATH SEGMENT
  // (`…/laws/TWN`) contains them below itself. Getting this backwards reads the
  // chapter's siblings as its articles.
  const base = /\/[^/]*\.[a-z0-9]{2,5}$/i.test(path) ? path.replace(/\/[^/]*$/, '') : path;
  return new RegExp(`${escapeRegex(base)}/([^/"'?#]+)`);
}

function shapeFrom(source: string | undefined, fallback: RegExp): RegExp {
  if (!source) return fallback;
  try { return new RegExp(source); } catch { return fallback; }
}

/**
 * Sources that publish law group → chapter → article → section, each a real page.
 *
 * Verified live on New York, through the background browser because the host
 * is edge-protected. The article TOC prints every section with its catchline,
 * so the concept match happens against the state's own words rather than
 * against a guessed section number.
 *
 * The link shapes and the citation style arrive on `config`. New York's
 * publisher prints "Town Law § 276" and addresses its articles as `A16`; a
 * different publisher of the same SHAPE says so in its own configuration
 * instead of being read through New York's.
 */
export async function runArticleTocCode(
  origin: string,
  config: StateLawPlatformConfig,
  concepts: readonly LawConcept[],
  fetchText: GovFetchText,
  budget: ReadBudget,
  readLog: string[],
  localUnitHint: string | null = null,
): Promise<StateLawDocument[]> {
  if (!config.indexPath) return [];
  const documents: StateLawDocument[] = [];
  const chapterShape = shapeFrom(config.chapterLinkPattern, deriveChapterLinkShape(config.indexPath));

  const index = await read(resolveSourceUrl(origin, config.indexPath), fetchText, budget, readLog, 45_000);
  if (!index) return documents;

  // The CHAPTER level names a body of law, not a subject. Selecting it with the
  // subject concepts sent a live run into "Classification of Towns"; the
  // subject concepts belong one level down, on the articles.
  const chapters = linkEntries(index.body, index.url, chapterShape).filter((entry) => entry.url !== index.url);
  const scoredChapters = chapters
    // A body of law qualifies if it names a KIND OF LOCAL UNIT — which is how
    // codes organised by government type are built — or if its own title names
    // the subject, which is how codes organised by subject are built. Requiring
    // only the first meant a code whose land-use law sits under a title called
    // "Land Resources and Use" had no reachable chapter at all.
    .filter((entry) => LOCAL_GOVERNMENT_BODY.test(entry.label) || scoreLabel(entry.label, concepts).score > 0)
    .map((entry) => ({
      entry,
      rank: chapterRank(entry.label, localUnitHint) + scoreLabel(entry.label, concepts).score * 10,
    }))
    .sort((a, b) => b.rank - a.rank);
  // The best match always, and a runner-up only when it is a real land-use body
  // of law. Taking the top two unconditionally opened Alternative County
  // Government for a town parcel: requests spent on a body that cannot govern it.
  const rankedChapters = scoredChapters
    .filter((entry, index) => index === 0 || entry.rank >= 40)
    .slice(0, 2)
    .map((entry) => entry.entry);

  for (const chapter of rankedChapters) {
    const chapterPage = await read(chapter.url, fetchText, budget, readLog, 45_000);
    if (!chapterPage) continue;

    // Articles inside the chapter. THIS is where the subject concepts belong:
    // the article list prints "ARTICLE 16 Zoning and Planning" in the state's
    // own words. An article that matches no concept is not read at all.
    const articleTitles = new Map(
      [...chapterPage.text.matchAll(/ARTICLE\s+([0-9]+[A-Z-]*)\s+([^\n]{3,90}?)(?=\s+ARTICLE\s+[0-9]|$)/g)]
        .map((match) => [`A${match[1]}`, match[2].trim()]),
    );
    // Derived from THIS chapter's own URL, because the articles are its
    // siblings wherever the publisher chose to put them.
    const articleShape = shapeFrom(config.articleLinkPattern, deriveArticleLinkShape(chapterPage.url));
    const articles = linkEntries(chapterPage.body, chapterPage.url, articleShape)
      .filter((entry) => entry.url !== chapterPage.url && entry.url !== index.url)
      .map((entry) => {
        const id = entry.url.match(articleShape)?.[1] ?? '';
        return { ...entry, id, label: articleTitles.get(id) || entry.label || id };
      });
    const rankedArticles = articles
      .map((entry) => ({ entry, ...scoreLabel(entry.label, concepts) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const article of rankedArticles) {
      const articlePage = await read(article.entry.url, fetchText, budget, readLog, 45_000);
      if (!articlePage) continue;

      // The article page prints "SECTION <n> <catchline>" for every section.
      const sections = [...articlePage.text.matchAll(/SECTION\s+([0-9][0-9A-Z-]*)\s+([^\n]{4,120}?)(?=\s+SECTION\s+[0-9]|$)/g)]
        .map((match) => ({ number: match[1], catchline: match[2].trim() }));
      const rankedSections = sections
        .map((section) => ({ section, ...scoreLabel(section.catchline, concepts) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      const effectiveNote = extractEffectiveNote(articlePage.text);

      // The article page itself already carries the section list; keep it as
      // the framework-level evidence even if no single section is readable.
      documents.push({
        url: articlePage.url,
        label: `${chapter.label} — ${article.entry.label}`,
        text: articlePage.text,
        citation: extractStatuteCitation(articlePage.text, chapter.label, config.citationShapes),
        effectiveNote,
        concepts: article.matched,
        route: 'structured_index',
      });

      for (const ranked of rankedSections) {
        // Strip the article segment the source itself printed, rather than a
        // remembered one: the section is a sibling of the article, whatever the
        // publisher calls its articles.
        const articleBase = article.entry.id
          ? article.entry.url.replace(new RegExp(`/${escapeRegex(article.entry.id)}$`), '')
          : article.entry.url;
        const sectionUrl = `${articleBase}/${ranked.section.number}`;
        const sectionPage = await read(sectionUrl, fetchText, budget, readLog, 45_000);
        if (!sectionPage || sectionPage.text.trim().length < 300) continue;
        const printedCitation = (config.citationTemplate ?? '{chapter} § {section}')
          .replace('{chapter}', chapter.label)
          .replace('{section}', ranked.section.number);
        documents.push({
          url: sectionUrl,
          label: `${printedCitation} — ${ranked.section.catchline}`,
          text: sectionPage.text,
          citation: extractStatuteCitation(sectionPage.text, printedCitation, config.citationShapes)
            ?? printedCitation,
          effectiveNote: extractEffectiveNote(sectionPage.text) ?? effectiveNote,
          concepts: ranked.matched,
          route: 'background_browser',
        });
      }
    }
  }
  return documents;
}

/**
 * How well a body of law matches the local unit that actually contains the
 * parcel. The hint dominates; a general municipal body is the sensible
 * secondary; anything else is a weak last choice.
 */
export function chapterRank(label: string, localUnitHint: string | null): number {
  const text = label.toLowerCase();
  const hint = (localUnitHint ?? '').toLowerCase().replace(/[^a-z]/g, '');
  // The boundary is built with an ESCAPED backslash on purpose: a bare `\b`
  // inside a template literal is the BACKSPACE character, not a regex word
  // boundary, so the pattern silently matches nothing. That bug flattened
  // every chapter to the same rank on a live run and sent the New York lane
  // into Alternative County Government instead of Town Law.
  if (hint && new RegExp(`\\b${hint}\\b`).test(text)) return 100;
  if (/\bgeneral\s+municipal\b/.test(text)) return 60;
  // Several states put every unit's land-use power in one "Local Government"
  // body of law rather than one body per kind of unit. It applies to the
  // subject whatever kind of unit contains it, so it outranks a named unit
  // that is not the one the hint asked for.
  if (/\blocal\s+government\b/.test(text)) return 50;
  if (/\btown\b/.test(text)) return 40;
  if (/\bvillage\b/.test(text)) return 35;
  if (/\bgeneral\s+city\b|\bcity\b/.test(text)) return 30;
  if (/\bcounty\b/.test(text)) return 20;
  return 10;
}

/**
 * Divisions an act page prints, with the first section of each range.
 *
 * Michigan renders "Division PRELIMINARY PLATS (560.111...560.120)"; the range
 * start is a real object id, so it is the cheapest route from "this act exists"
 * to "here is what it says".
 */
export function rankDivisions(
  actText: string,
  concepts: readonly LawConcept[],
): Array<{ name: string; firstSection: string; matched: LawConcept[]; score: number }> {
  return [...actText.matchAll(/Division\s+([A-Z][A-Z'\s,&-]{3,60}?)\s*\((\d+\.\d+[a-z]?)\s*\.{2,}/g)]
    .map((match) => {
      const name = match[1].replace(/\s+/g, ' ').trim();
      return { name, firstSection: match[2], ...scoreLabel(name, concepts) };
    })
    .filter((division) => division.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Links matching a path shape, paired with their anchor text. */
function linkEntries(html: string, baseUrl: string, shape: RegExp): Array<{ url: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; label: string }> = [];
  for (const link of extractLinks(html, baseUrl)) {
    if (!shape.test(link.url)) continue;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push({ url: link.url, label: link.label.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/* ───────────────── adapter 3: agency publication ─────────────────────── */

/**
 * States whose code is not machine-readable, but whose agencies publish the
 * governing statutes and cite them.
 *
 * This is a deliberate, bounded concession and it is labelled as one. Georgia's
 * General Assembly site is a client-rendered shell and the official O.C.G.A. is
 * behind a vendor SPA that refused a bounded background-browser attempt. Its
 * agencies, however, publish a "Governing Statutes, Regulations and Guidance"
 * page that names the controlling O.C.G.A. sections outright. That is
 * authoritative STATE material — a state agency stating which statutes govern —
 * and it is tiered as `state_agency`, never as the statute text itself.
 */
export async function runAgencyPublication(
  config: StateLawPlatformConfig,
  concepts: readonly LawConcept[],
  fetchText: GovFetchText,
  budget: ReadBudget,
  readLog: string[],
): Promise<StateLawDocument[]> {
  const documents: StateLawDocument[] = [];
  for (const host of config.agencyHosts ?? []) {
    if (budget.left <= 0) break;
    const sitemap = await read(`https://${host}/sitemap.xml`, fetchText, budget, readLog, 40_000);
    if (!sitemap) continue;

    const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    // A URL path is a WEAK label, so it must clear two bars, not one: it has to
    // match a subject concept AND look like a governing-rules page. Scoring on
    // the concept alone pulled a historic-resources survey and a county health
    // department contact page on the first live run.
    // A URL is a candidate signal, never an acceptance signal. Pages are
    // SELECTED on the path and KEPT only if the retrieved TEXT carries the
    // concept and a statutory citation. Ranking on the path alone returned a
    // historic-resources survey and a county health contact page on a live run.
    const ranked = locations
      .map((url) => ({ url, ...scoreLabel(url.replace(/[-/]/g, ' '), concepts) }))
      .filter((entry) => isGovernmentHost(entry.url) && GOVERNING_RULES_PATH.test(entry.url))
      // A page whose own path says it states the GOVERNING STATUTES outranks a
      // page that merely mentions a subject. That is the page a state agency
      // publishes to answer "which law controls this", and on a live Georgia
      // run subject-only scoring buried it beneath programme pages.
      .map((entry) => ({
        ...entry,
        weight: entry.score
          + (/governing|statute/i.test(entry.url) ? 12 : 0)
          + (/regulation|ordinance|\brule/i.test(entry.url) ? 4 : 0),
      }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);

    for (const entry of ranked) {
      if (budget.left <= 0) break;
      const page = await read(entry.url, fetchText, budget, readLog);
      if (!page || page.text.trim().length < 300) continue;
      const inText = scoreLabel(page.text, concepts);
      const citation = extractStatuteCitation(page.text, '', config.citationShapes);
      // The page must both discuss the concept AND cite a statute. Either
      // alone is a programme page, not a statement of governing law.
      if (!inText.score || !citation) continue;
      documents.push({
        url: entry.url,
        label: pageTitle(page.body) ?? `${host} publication`,
        text: page.text,
        citation,
        effectiveNote: extractEffectiveNote(page.text),
        concepts: inText.matched,
        route: 'sitemap',
      });
      if (documents.length >= 3) break;
    }
  }
  return documents;
}

function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]{0,140})<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

/* ───────────────── generic probes for unlisted states ────────────────── */

/**
 * A state with no verified platform still gets an official-first attempt:
 * its own sitemap, then a conventional code index path.
 *
 * This is what keeps the engine nationwide rather than three-states-wide. It
 * finds less than a verified adapter and it finds it honestly.
 */
export async function runGenericProbes(
  origin: string,
  concepts: readonly LawConcept[],
  fetchText: GovFetchText,
  budget: ReadBudget,
  readLog: string[],
  citationShapes?: readonly string[],
): Promise<StateLawDocument[]> {
  const documents: StateLawDocument[] = [];

  const sitemap = await read(`${origin}/sitemap.xml`, fetchText, budget, readLog, 30_000);
  if (sitemap && /<loc>/.test(sitemap.body)) {
    const ranked = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1])
      .map((url) => ({ url, ...scoreLabel(url.replace(/[-/]/g, ' '), concepts) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const entry of ranked) {
      const page = await read(entry.url, fetchText, budget, readLog);
      if (!page || page.text.trim().length < 500) continue;
      documents.push({
        url: entry.url, label: pageTitle(page.body) ?? 'State publication', text: page.text,
        citation: extractStatuteCitation(page.text, '', citationShapes), effectiveNote: extractEffectiveNote(page.text),
        concepts: entry.matched, route: 'sitemap',
      });
    }
  }
  if (documents.length) return documents;

  // Conventional index paths. Cheap, last, and verified like everything else.
  for (const path of ['/Laws/ChapterIndex', '/laws', '/statutes', '/code', '/legislation/laws']) {
    if (budget.left <= 0) break;
    const index = await read(`${origin}${path}`, fetchText, budget, readLog, 25_000);
    if (!index || index.status >= 400 || index.text.trim().length < 800) continue;
    const { score, matched } = scoreLabel(index.text.slice(0, 6_000), concepts);
    if (!score) continue;
    documents.push({
      url: index.url, label: 'State code index', text: index.text,
      citation: extractStatuteCitation(index.text, '', citationShapes), effectiveNote: extractEffectiveNote(index.text),
      concepts: matched, route: 'structured_index',
    });
    break;
  }
  return documents;
}

/* ───────────── discovery: WHERE this state publishes its law ──────────── */

export interface LocatedStateLegalSource {
  origin: string;
  body: string;
  transportIsBrowser: boolean;
  verified: boolean;
  /** How the origin was arrived at, so the operator sees the real route. */
  route: 'learned' | 'directory' | 'discovered';
}

export interface StateLegalSourceDeps {
  fetchText?: GovFetchText;
  /** Set false in tests so nothing is written to shared knowledge. */
  learn?: boolean;
  now?: () => string;
  /**
   * Hard wall-clock cap on discovering an unfamiliar state's publication.
   *
   * The state layer is not the answer — the LOCAL governing authority is. A
   * state whose hosts are slow or unreachable must cost the run a bounded
   * amount of time and then be marked unverified, never stall the local lane
   * behind it. Probing every hostname candidate at the per-host timeout could
   * otherwise run for minutes on a single unknown state.
   */
  discoveryBudgetMs?: number;
}

/**
 * Locate the state's own official legal publication.
 *
 * Three routes, best knowledge first: what LandOS has already LEARNED about
 * this state, then the verified source directory, then the hostname formula.
 * The third route is the one that matters architecturally — it is why a state
 * nobody has entered anywhere can still be read. Every formula candidate must
 * NAME the state and read as a legislative publication before it is accepted,
 * because a live sweep proved that plausible hosts resolve to a state capitol
 * commission, a video-conferencing portal, and in one case another state's
 * legislature entirely.
 *
 * A discovery that survives verification is REMEMBERED, so the next property in
 * that state pays nothing for it.
 */
export async function locateStateLegalSource(
  state: string,
  deps: StateLegalSourceDeps = {},
): Promise<LocatedStateLegalSource | null> {
  const learned = learnedStateLawSource(state);
  if (learned?.origin) {
    return {
      origin: learned.origin,
      body: learned.body ?? `${stateName(state) ?? state} legislative publication`,
      transportIsBrowser: learned.transport === 'requires_browser',
      verified: true,
      route: 'learned',
    };
  }

  const registered = stateLegalSourceFor(state);
  if (registered) {
    return {
      origin: registered.origin,
      body: registered.body,
      transportIsBrowser: registered.transport === 'requires_browser',
      verified: registered.reachedLive,
      route: 'directory',
    };
  }

  // A code that is not a state cannot be verified as one, and probing thirteen
  // hosts for it would be noise rather than diligence.
  if (!stateName(state)) return null;

  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const startedAt = Date.now();
  const budgetMs = deps.discoveryBudgetMs ?? 60_000;
  for (const host of deriveStateLegalHostCandidates(state)) {
    // Time-boxed on purpose. Out of budget means "state layer unverified",
    // which the framework lane already reports honestly, and the run moves on
    // to the local authority that actually governs the parcel.
    if (Date.now() - startedAt > budgetMs) break;
    try {
      // 18s, not 12s. A live sweep found a real state legislature answering in
      // roughly twenty seconds; at the shorter timeout its discovery aborted
      // and the state read as having no official publication at all. A slow
      // government host is common and must not be mistaken for an absent one.
      const response = await fetchText(`https://${host}`, { timeoutMs: 18_000 });
      if (response.blocked || response.status >= 400) continue;
      if (!isGovernmentHost(response.url)) continue;
      const text = htmlToText(response.body);
      if (!verifiesAsStateLegalSource(state, text)) continue;
      const located: LocatedStateLegalSource = {
        origin: new URL(response.url).origin,
        body: `${stateName(state) ?? state} legislative publication`,
        transportIsBrowser: false,
        verified: true,
        route: 'discovered',
      };
      if (deps.learn !== false) {
        rememberStateLawSource(state, {
          origin: located.origin,
          body: located.body,
          transport: 'server_fetch',
        }, deps.now);
      }
      return located;
    } catch {
      // A host that does not exist is the expected case for most candidates.
    }
  }
  return null;
}

/* ───────────── detection: WHAT SHAPE this publication is ─────────────── */

export interface DetectedStateLawPlatform {
  config: StateLawPlatformConfig;
  /** What in the source itself decided the shape. Operator-inspectable. */
  evidence: string;
}

/** Index pages a code publishes its own structure under. Shapes, not states. */
const INDEX_LINK_SHAPE = /\/(?:laws?|statutes?|codes?|legislation|chapterindex|titles?|mca|rcw|orc)(?:[/?#.]|$)/i;

/**
 * How a publisher LABELS the link to its own code.
 *
 * Path shape alone is not enough and a live run proved it: a state code was
 * found at a path containing no legal word at all, behind a link the publisher
 * labelled as its own statutes. The source's own words for its own code are the
 * more reliable signal.
 */
const CODE_INDEX_LABEL =
  /\b(?:statutes?|code|codes|revised\s+code|revised\s+statutes|general\s+statutes|compiled\s+laws?|annotated|table\s+of\s+contents)\b/i;

/**
 * The registrable domain, so a code published on a SIBLING subdomain of the
 * same government is reachable. `archive.example.gov` and `www.example.gov` are
 * the same publisher; `example.gov` and `other.gov` are not.
 */
export function siteDomain(urlOrHost: string): string {
  const host = (hostOf(urlOrHost) || urlOrHost).toLowerCase();
  const labels = host.split('.');
  // `.gov` is registrable at the second level; `state.xx.us` needs three.
  const depth = labels[labels.length - 1] === 'gov' ? 2 : 3;
  return labels.slice(-depth).join('.');
}

/**
 * Work out how a state's publication is shaped by READING it.
 *
 * This is the correction's centre. The lane used to pick an adapter because
 * `state === 'MI'`, which meant the two shapes it knew how to walk were
 * unreachable for the forty-seven states nobody had typed into a table. The
 * shape is a property of the SOURCE — object ids in its links, a chapter TOC
 * under its index, a sitemap — and every one of those is visible on the page.
 *
 * Bounded to a handful of requests: this runs once per state, ever.
 */
export async function detectStateLawPlatform(
  origin: string,
  fetchText: GovFetchText,
  budget: ReadBudget,
  readLog: string[],
): Promise<DetectedStateLawPlatform | null> {
  const root = await read(origin, fetchText, budget, readLog, 25_000);
  if (!root) return null;

  /**
   * Where this publisher says its own code lives.
   *
   * Two signals, either of which qualifies: a path that reads like a code
   * index, or an anchor whose TEXT is the publisher naming its code. Both are
   * accepted on the origin host and on any government sibling of the same
   * registrable domain, because publishing the code on its own subdomain is
   * ordinary and a same-host-only rule made those codes unreachable.
   *
   * A link the publisher labels as its code is ranked ahead of one that merely
   * has a legal-looking path.
   */
  const domain = siteDomain(origin);
  const candidateLinks = extractLinks(root.body, root.url)
    .filter((link) => isGovernmentHost(link.url) && siteDomain(link.url) === domain)
    .map((link) => {
      let path = '';
      try { const parsed = new URL(link.url); path = parsed.pathname + parsed.search; } catch { return null; }
      const byLabel = CODE_INDEX_LABEL.test(link.label);
      const byPath = INDEX_LINK_SHAPE.test(path);
      if (!byLabel && !byPath) return null;
      const sameHost = hostOf(link.url) === hostOf(origin);
      return {
        // A cross-host code index has to be carried as an absolute URL, or the
        // adapter would rebuild it against the wrong origin.
        indexPath: sameHost ? path : link.url,
        url: link.url,
        label: link.label,
        weight: (byLabel ? 4 : 0) + (byPath ? 2 : 0) + (sameHost ? 1 : 0),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  const seenIndex = new Set<string>();
  const candidates = candidateLinks
    .sort((a, b) => b.weight - a.weight)
    .filter((entry) => !seenIndex.has(entry.indexPath) && seenIndex.add(entry.indexPath))
    .slice(0, 6);
  const candidatePaths = candidates.map((entry) => entry.indexPath);

  // 1. OBJECT-ADDRESSED. The source addresses its objects by an id carried in a
  //    query parameter. Three or more such links is the source telling us how it
  //    is built; one could be a stray.
  const objectLinks = [...root.body.matchAll(/[?&]([\w.-]*(?:object|item|doc|name|id)[\w.-]*)=([A-Za-z]{2,8}-[\w.\-%]+)/gi)];
  const byParam = new Map<string, string[]>();
  for (const match of objectLinks) {
    const param = match[1];
    byParam.set(param, [...(byParam.get(param) ?? []), decodeURIComponent(match[2])]);
  }
  for (const [param, ids] of byParam) {
    if (ids.length < 3) continue;
    const sample = objectLinks.find((match) => match[1] === param);
    const objectBase = sample ? pathOf(root.body, `${param}=${sample[2]}`) : null;
    if (!objectBase) continue;
    const indexPath = candidatePaths.find((path) => /index/i.test(path)) ?? candidatePaths[0] ?? null;
    if (!indexPath) continue;
    return {
      config: {
        platform: 'object_addressed_code',
        indexPath,
        objectPath: `${objectBase}?${param}={id}`,
        objectIdPrefix: deriveObjectIdPrefix(ids) ?? undefined,
      },
      evidence: `${ids.length} links on the source address objects as ${param}=<id>; its own index is ${indexPath}.`,
    };
  }

  // 2. ARTICLE TOC. An index page whose own links are uppercase sibling tokens
  //    is a law-group table of contents, whatever the state calls the groups.
  for (const path of candidatePaths.slice(0, 3)) {
    if (budget.left <= 0) break;
    const page = await read(resolveSourceUrl(origin, path), fetchText, budget, readLog, 30_000);
    if (!page) continue;
    const shape = deriveChapterLinkShape(path.replace(/\?.*$/, ''));
    const groups = extractLinks(page.body, page.url).filter((link) => shape.test(link.url));
    if (groups.length >= 3) {
      return {
        config: { platform: 'article_toc_code', indexPath: path, objectPath: `${path.replace(/\/[^/]*$/, '')}/{id}` },
        evidence: `${groups.length} law groups are published as sibling pages under ${path}.`,
      };
    }
    // 3. The index itself may simply be the code, addressed by object id.
    const inlineObjects = [...page.body.matchAll(/[?&]([\w.-]*(?:object|item|doc|name|id)[\w.-]*)=([A-Za-z]{2,8}-[\w.\-%]+)/gi)];
    if (inlineObjects.length >= 3) {
      const param = inlineObjects[0][1];
      const objectBase = pathOf(page.body, `${param}=${inlineObjects[0][2]}`);
      if (objectBase) {
        return {
          config: {
            platform: 'object_addressed_code',
            indexPath: path,
            objectPath: `${objectBase}?${param}={id}`,
            objectIdPrefix: deriveObjectIdPrefix(inlineObjects.map((match) => decodeURIComponent(match[2]))) ?? undefined,
          },
          evidence: `${inlineObjects.length} objects are addressed as ${param}=<id> from the index at ${path}.`,
        };
      }
    }
  }

  // 4. SITEMAP-INDEXED. The weakest official shape and still an official one:
  //    the source publishes its own map and the statutes are on it.
  //
  //    It must actually CONTAIN statute locations. An earlier version accepted
  //    any response to `/sitemap.xml`, and a live state that answers that path
  //    with an empty document was classified as sitemap-indexed and then
  //    retrieved nothing — a detected shape that was never really there.
  const sitemap = await read(`${origin}/sitemap.xml`, fetchText, budget, readLog, 25_000);
  const locations = sitemap ? [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]) : [];
  const relevant = locations.filter((url) => scoreLabel(url.replace(/[-/]/g, ' '), DEFAULT_CONCEPTS).score > 0);
  if (relevant.length) {
    return {
      config: { platform: 'sitemap_indexed_code' },
      evidence: `The source's own sitemap lists ${locations.length} pages, ${relevant.length} of which name a land-use subject.`,
    };
  }

  return null;
}

/** The path portion of the href that carries a given query fragment. */
function pathOf(html: string, queryFragment: string): string | null {
  const escaped = escapeRegex(queryFragment);
  const match = html.match(new RegExp(`href=["']([^"']*?)\\?[^"']*${escaped}`, 'i'));
  if (!match) return null;
  const href = match[1];
  if (href.startsWith('http')) {
    try { return new URL(href).pathname; } catch { return null; }
  }
  return href.startsWith('/') ? href : `/${href}`;
}

/* ────────────────────────────── entry point ──────────────────────────── */

/**
 * Retrieve authoritative state-law material for one state.
 *
 * Returns documents plus the route each came from. It draws no conclusion: the
 * state-framework lane decides which provisions are material and cites them.
 *
 * The order below is the whole architecture:
 *
 *   located source (given, learned, in the directory, or DISCOVERED)
 *     → shape LEARNED for that source, else DETECTED from it
 *       → the adapter for that shape, else the generic official probes
 *         → remember what worked
 *
 * No step consults the state code to decide what to do. A state's identity
 * selects nothing but its own source; everything after that is a fact about the
 * publication that answered.
 */
export async function retrieveStateLaw(state: string, deps: StateLawDeps = {}): Promise<StateLawRetrieval> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const concepts = deps.concepts ?? DEFAULT_CONCEPTS;
  const budget: ReadBudget = { left: deps.maxRequests ?? 14 };
  const readLog: string[] = [];
  const notes: string[] = [];
  const label = stateName(state) ?? state;
  const learn = deps.learn !== false;

  /**
   * The located source WINS.
   *
   * It used to be discarded: the framework lane discovered and verified a
   * state's official publication, handed nothing to this function, and this
   * function then looked the state up in a registry and reported "no verified
   * official legal publication" for a host it had just read. A discovery that
   * cannot be used is not a discovery.
   */
  const learned = learnedStateLawSource(state);
  const directory = stateLegalSourceFor(state);
  const located = deps.source
    ?? (learned?.origin || directory
      ? null
      : await locateStateLegalSource(state, { fetchText, learn, now: deps.now }));

  const origin = deps.source?.origin ?? located?.origin ?? learned?.origin ?? directory?.origin ?? null;
  const body = deps.source?.body ?? located?.body ?? learned?.body ?? directory?.body ?? null;
  const transport: LegalSourceTransport =
    (deps.source ?? located)?.transportIsBrowser ? 'requires_browser'
      : learned?.transport ?? directory?.transport ?? 'server_fetch';

  if (!origin) {
    return emptyRetrieval('unknown', `LandOS has no verified official legal publication for ${label}.`,
      `No official ${label} legal publication could be located, in the source directory or by discovery.`);
  }

  /**
   * The shape comes from the SOURCE, not from the state.
   *
   * A learned shape is reused; an unknown one is detected by reading the
   * publication. Detection costs a few requests once per state and nothing
   * afterwards, which is what makes the nationwide lane affordable.
   */
  let config: StateLawPlatformConfig | null =
    learned && learned.platform !== 'unknown' ? learned.config : null;
  let detected = false;
  if (!config) {
    try {
      const detection = await detectStateLawPlatform(origin, fetchText, budget, readLog);
      if (detection) {
        config = detection.config;
        detected = true;
        notes.push(`Shape detected from the source itself: ${detection.evidence}`);
      } else {
        notes.push(`The ${label} publication exposed no recognisable code shape; falling back to the generic official probes.`);
      }
    } catch (error) {
      notes.push(`Shape detection on the ${label} publication failed: ${(error as Error)?.message ?? 'unknown error'}.`);
    }
  }

  const platform: StateLawPlatform = config?.platform ?? 'unknown';

  let documents: StateLawDocument[] = [];
  try {
    if (config?.platform === 'object_addressed_code') {
      documents = await runObjectAddressedCode(origin, config, concepts, fetchText, budget, readLog);
    } else if (config?.platform === 'article_toc_code') {
      documents = await runArticleTocCode(origin, config, concepts, fetchText, budget, readLog, deps.localUnitHint ?? null);
    } else if (config?.platform === 'agency_publication') {
      documents = await runAgencyPublication(config, concepts, fetchText, budget, readLog);
    } else {
      documents = await runGenericProbes(origin, concepts, fetchText, budget, readLog, config?.citationShapes);
    }
  } catch (error) {
    notes.push(`The ${label} retrieval lane failed: ${(error as Error)?.message ?? 'unknown error'}.`);
  }

  // A shape that returned nothing falls back to the generic official probes
  // before the state is reported unreadable.
  if (!documents.length && config && config.platform !== 'agency_publication' && config.platform !== 'sitemap_indexed_code') {
    notes.push(`The ${label} ${config.platform.replace(/_/g, ' ')} route returned nothing; trying the generic official probes.`);
    try {
      documents = await runGenericProbes(origin, concepts, fetchText, budget, readLog, config.citationShapes);
    } catch { /* the blocker below reports it */ }
  }

  /**
   * Remember the source either way, and the SHAPE only when it produced text.
   *
   * A run that failed still records that this origin was tried, so a source
   * that never works is visible as runs-without-successes. A detected shape
   * that produced nothing is deliberately NOT written: caching it would make
   * every future property in the state repeat a route already known to be
   * empty, and detection is cheap enough to redo.
   */
  if (learn) {
    rememberStateLawSource(state, {
      origin,
      body,
      transport,
      platform: documents.length && detected ? platform : undefined,
      config: documents.length && detected && config ? config : undefined,
      succeeded: documents.length > 0,
    }, deps.now);
  }

  /**
   * The blocker has to say WHICH failure this was.
   *
   * A source that answered and published nothing usable is a fact about the
   * state. A source that refused every request is a fact about the transport,
   * and the caller's correct response to it is to change discovery method, not
   * to report that the state has no framework.
   */
  const transportBlocked = budget.transportBlocked === true && !documents.length;
  const blocker = documents.length
    ? null
    : transportBlocked
      ? `${label}'s official legal publication at ${origin} could not be read: every request was refused at the transport layer (${readLog.length} URL(s) attempted). This is a transport blocker, not an absence of ${label} law.`
      : `${label}'s official legal publication was reached but exposed no machine-readable route to the governing statutes (${readLog.length} official URL(s) read).`;

  notes.push(documents.length
    ? `Retrieved ${documents.length} authoritative ${label} document(s) via ${[...new Set(documents.map((d) => d.route))].join(', ')}.`
    : transportBlocked
      ? `No ${label} document could be read: the source refused the transport, so nothing about the state's law was established here.`
      : `No authoritative ${label} document could be retrieved.`);

  return { platform, origin, documents, read: readLog, notes, blocker, transportBlocked };
}

/** Operator-readable label for a retrieval route. */
export function stateLawRouteLabel(route: StateLawDocument['route']): string {
  switch (route) {
    case 'structured_index': return 'Official index / TOC';
    case 'object_address': return 'Official object address';
    case 'sitemap': return 'Official sitemap';
    case 'document': return 'Official downloadable document';
    case 'page_search': return 'Official page search';
    case 'background_browser': return 'Background browser';
  }
}

export { hostOf };
