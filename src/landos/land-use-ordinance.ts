// LandOS — reusable ORDINANCE retrieval.
//
// Local law is published by a small number of recurring codifiers plus a long
// tail of government-hosted HTML and PDF. This module is publisher-first for
// exactly the same reason the parcel engine is platform-first: learning one
// codifier reaches thousands of jurisdictions at once, and learning one county
// reaches one.
//
// Retrieval preference, enforced by the order of the resolvers:
//
//   codifier API  →  codifier HTML  →  official government HTML
//     →  official PDF (text layer)  →  named failure
//
// A scanned PDF with no text layer is a NAMED FAILURE. It is never guessed at,
// summarized from a filename, or filled in from what similar counties do.

import { defaultGovFetchText, htmlToText, readJsonBody, extractLinks, type GovFetchText } from './gis-transport.js';
import { extractPdfText } from './pdf-text.js';
import { hostOf } from './land-use-evidence.js';

/* ────────────────────────────── vocabulary ───────────────────────────── */

export const CODE_PUBLISHERS = [
  'municode',
  'ecode360',
  'american_legal',
  'code_publishing',
  'sterling_codifiers',
  'municipal_code_online',
  'encodeplus',
  'government_html',
  'government_pdf',
  'unknown',
] as const;
export type CodePublisher = (typeof CODE_PUBLISHERS)[number];

export function codePublisherLabel(publisher: CodePublisher): string {
  switch (publisher) {
    case 'municode': return 'Municode';
    case 'ecode360': return 'General Code eCode360';
    case 'american_legal': return 'American Legal Publishing';
    case 'code_publishing': return 'Code Publishing Company';
    case 'sterling_codifiers': return 'Sterling Codifiers';
    case 'municipal_code_online': return 'Municipal Code Online';
    case 'encodeplus': return 'EnCodePlus';
    case 'government_html': return 'Government website';
    case 'government_pdf': return 'Government PDF';
    case 'unknown': return 'Unknown publisher';
  }
}

/** What kind of regulation a retrieved chapter is. Drives which extractor runs. */
export const ORDINANCE_TOPICS = [
  'zoning',
  'subdivision',
  'manufactured_housing',
  'buildings_and_development',
  'health_and_sanitation',
  'environment',
  'roads_and_access',
  'general',
] as const;
export type OrdinanceTopic = (typeof ORDINANCE_TOPICS)[number];

/** One retrieved, readable chapter or section of adopted local law. */
export interface OrdinanceDocument {
  /** Heading exactly as the code prints it. */
  title: string;
  /** Section identifier the code prints, when the chunk has one. */
  section: string | null;
  /** Plain text of the provision. Never rewritten. */
  text: string;
  /** Operator-clickable deep link to this exact chunk. */
  url: string;
  topic: OrdinanceTopic;
}

/** A jurisdiction's code as a whole, once located. */
export interface OrdinanceCodeSource {
  publisher: CodePublisher;
  /** The adopting jurisdiction, as the code itself names it. */
  jurisdictionLabel: string;
  /** Operator-clickable landing page for the code. */
  url: string;
  /** "Codified through …" as the publisher states it. An effective date. */
  codifiedThrough: string | null;
  /** Publisher-specific handles the reader needs. Never operator-facing. */
  handle: Record<string, string | number>;
}

export interface OrdinanceLookupDeps {
  fetchText?: GovFetchText;
  now?: () => string;
  /** Hard cap on requests, so one codifier cannot consume a whole run. */
  maxRequests?: number;
}

export interface OrdinanceLookupResult {
  source: OrdinanceCodeSource | null;
  documents: OrdinanceDocument[];
  /** Every URL read, so "nothing found" is inspectable. */
  read: string[];
  notes: string[];
  /** Set when a document exists but cannot be read (scan with no text layer). */
  unreadable: Array<{ url: string; reason: string }>;
}

function emptyLookup(note: string): OrdinanceLookupResult {
  return { source: null, documents: [], read: [], notes: [note], unreadable: [] };
}

/* ─────────────────────────── topic classification ────────────────────── */

/**
 * Classify a chapter heading. Deliberately conservative: a heading that does
 * not clearly announce its subject is `general`, and a `general` chapter is
 * still read — it just does not claim to be the zoning chapter.
 */
export function classifyOrdinanceTopic(heading: string): OrdinanceTopic {
  const h = heading.toLowerCase();
  if (/manufactured hous|mobile home|manufactured home/.test(h)) return 'manufactured_housing';
  if (/subdivision|land division|land subdivision|platting|plats?\b/.test(h)) return 'subdivision';
  if (/zoning|land use|land development code|unified development/.test(h)) return 'zoning';
  if (/building|development|construction/.test(h)) return 'buildings_and_development';
  if (/health|sanitation|sewage|septic|wastewater/.test(h)) return 'health_and_sanitation';
  if (/environment|flood|stream|water/.test(h)) return 'environment';
  if (/road|street|highway|traffic|driveway/.test(h)) return 'roads_and_access';
  return 'general';
}

/** Chapters worth retrieving for this engine, best first. */
const TOPIC_PRIORITY: Record<OrdinanceTopic, number> = {
  zoning: 0,
  subdivision: 1,
  manufactured_housing: 2,
  buildings_and_development: 3,
  health_and_sanitation: 4,
  roads_and_access: 5,
  environment: 6,
  general: 9,
};

/* ─────────────────────────── publisher detection ─────────────────────── */

export function detectCodePublisher(url: string): CodePublisher {
  const host = hostOf(url);
  if (/municode\.com$/.test(host)) return 'municode';
  if (/ecode360\.com$/.test(host)) return 'ecode360';
  if (/amlegal\.com$/.test(host)) return 'american_legal';
  if (/codepublishing\.com$/.test(host)) return 'code_publishing';
  if (/sterlingcodifiers\.com$/.test(host)) return 'sterling_codifiers';
  if (/municipalcodeonline\.com$/.test(host)) return 'municipal_code_online';
  if (/encodeplus\.com$/.test(host)) return 'encodeplus';
  if (/\.pdf($|\?)/i.test(url)) return 'government_pdf';
  if (host) return 'government_html';
  return 'unknown';
}

/* ───────────────────────────── Municode lane ─────────────────────────── */

const MUNICODE_API = 'https://api.municode.com';
const MUNICODE_LIBRARY = 'https://library.municode.com';

interface MunicodeClient {
  ClientID: number;
  ClientName: string;
  City: string;
  State: { StateAbbreviation: string };
}

/**
 * Normalize a jurisdiction name for matching against a codifier's directory.
 * Municode names a county client "Washington County" and a city client
 * "Washington", so the SUFFIX is meaningful and must not be stripped before
 * comparison — dropping it is how a county's code gets confused with the code
 * of a same-named city inside it.
 */
export function normalizeJurisdictionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/**
 * Find the codifier client that publishes law for a jurisdiction.
 *
 * Both the unit name and its TYPE must agree. A request for a county's code
 * never matches a city client of the same name, which is a real and common
 * collision — and one that would silently substitute a municipality's zoning
 * for a county's absence of zoning.
 */
export function matchCodifierClient<T extends { name: string }>(
  clients: readonly T[],
  jurisdiction: string,
  unitKind: 'county' | 'municipality' | 'township' | 'any',
): T | null {
  const wanted = normalizeJurisdictionKey(jurisdiction);
  if (!wanted) return null;
  const bare = wanted.replace(/\b(county|parish|borough|city|town|township|village)\b/g, '').trim();

  const isCountyName = (name: string) => /\b(county|parish)\b/.test(name);
  const isTownshipName = (name: string) => /\btownship\b/.test(name);

  const scored = clients
    .map((client) => ({ client, key: normalizeJurisdictionKey(client.name) }))
    .filter((entry) => {
      if (unitKind === 'county') return isCountyName(entry.key);
      if (unitKind === 'township') return isTownshipName(entry.key);
      if (unitKind === 'municipality') return !isCountyName(entry.key) && !isTownshipName(entry.key);
      return true;
    });

  const exact = scored.find((entry) => entry.key === wanted);
  if (exact) return exact.client;

  const bareMatch = scored.find((entry) => entry.key.replace(/\b(county|parish|borough|city|town|township|village)\b/g, '').trim() === bare);
  return bareMatch?.client ?? null;
}

async function municodeJson(url: string, fetchText: GovFetchText, read: string[]): Promise<unknown> {
  const response = await fetchText(url, { timeoutMs: 30_000, headers: { accept: 'application/json' } });
  read.push(url);
  if (response.blocked || response.status >= 400) return null;
  // A 204 carries an empty body, which is a real answer: no such client.
  if (!response.body.trim()) return null;
  return readJsonBody(response.body);
}

/**
 * Locate and read a jurisdiction's code through Municode's own API.
 *
 * This is the highest-leverage lane in the module: one implementation reaches
 * every jurisdiction Municode publishes, the API returns structured chapter
 * text rather than an SPA shell, and it states the supplement the code is
 * codified through — which is the effective date a citation needs.
 */
export async function lookupMunicode(
  jurisdiction: string,
  state: string,
  unitKind: 'county' | 'municipality' | 'township' | 'any',
  deps: OrdinanceLookupDeps = {},
): Promise<OrdinanceLookupResult> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const read: string[] = [];
  const notes: string[] = [];
  const stateAbbr = (state ?? '').trim().toUpperCase();
  if (!stateAbbr || !jurisdiction?.trim()) return emptyLookup('No jurisdiction or state was supplied.');

  const clientsRaw = await municodeJson(`${MUNICODE_API}/Clients/stateAbbr?stateAbbr=${encodeURIComponent(stateAbbr)}`, fetchText, read);
  if (!Array.isArray(clientsRaw)) return emptyLookup(`Municode published no client directory for ${stateAbbr}.`);

  const clients = (clientsRaw as MunicodeClient[])
    .filter((client) => client && typeof client.ClientID === 'number' && typeof client.ClientName === 'string')
    .map((client) => ({ name: client.ClientName, id: client.ClientID, city: client.City }));

  const match = matchCodifierClient(clients, jurisdiction, unitKind);
  if (!match) {
    return {
      source: null, documents: [], read,
      notes: [`Municode publishes ${clients.length} ${stateAbbr} code(s); none is the adopted code of ${jurisdiction}.`],
      unreadable: [],
    };
  }

  const content = await municodeJson(`${MUNICODE_API}/ClientContent/${match.id}`, fetchText, read) as
    { codes?: Array<{ productId: number; productName: string }> } | null;
  const product = content?.codes?.[0];
  if (!product) return { source: null, documents: [], read, notes: [`Municode lists ${match.name} but publishes no code product for it.`], unreadable: [] };

  const job = await municodeJson(`${MUNICODE_API}/Jobs/latest/${product.productId}`, fetchText, read) as
    { Id?: number; BannerText?: string } | null;
  if (!job?.Id) return { source: null, documents: [], read, notes: [`Municode published no current supplement for ${match.name}.`], unreadable: [] };

  const clientSlug = match.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const libraryUrl = `${MUNICODE_LIBRARY}/${stateAbbr.toLowerCase()}/${clientSlug}/codes/code_of_ordinances`;

  const source: OrdinanceCodeSource = {
    publisher: 'municode',
    jurisdictionLabel: match.name,
    url: libraryUrl,
    codifiedThrough: codifiedThroughFrom(job.BannerText ?? null),
    handle: { clientId: match.id, productId: product.productId, jobId: job.Id, stateAbbr, clientSlug },
  };

  const toc = await municodeJson(`${MUNICODE_API}/CodesToc?jobId=${job.Id}&productId=${product.productId}`, fetchText, read) as
    { Children?: Array<{ Id: string; Heading: string }> } | null;
  const chapters = (toc?.Children ?? [])
    .map((child) => ({ id: child.Id, heading: child.Heading, topic: classifyOrdinanceTopic(child.Heading) }))
    .filter((chapter) => TOPIC_PRIORITY[chapter.topic] <= 6)
    .sort((a, b) => TOPIC_PRIORITY[a.topic] - TOPIC_PRIORITY[b.topic]);

  if (!chapters.length) {
    notes.push(`${match.name}'s code contains no zoning, subdivision, manufactured-housing, development, health or road chapter.`);
  }

  const documents: OrdinanceDocument[] = [];
  const budget = deps.maxRequests ?? 8;
  for (const chapter of chapters.slice(0, budget)) {
    const chunk = await municodeJson(
      `${MUNICODE_API}/CodesContent?jobId=${job.Id}&nodeId=${encodeURIComponent(chapter.id)}&productId=${product.productId}`,
      fetchText, read,
    ) as { Docs?: Array<{ Id: string; Title: string; Content: string }> } | null;
    for (const doc of chunk?.Docs ?? []) {
      const text = htmlToText(doc.Content ?? '');
      if (!text.trim()) continue;
      documents.push({
        title: doc.Title ?? chapter.heading,
        section: sectionFromTitle(doc.Title ?? ''),
        text,
        url: `${libraryUrl}?nodeId=${encodeURIComponent(doc.Id ?? chapter.id)}`,
        topic: chapter.topic,
      });
    }
  }

  notes.push(`Read ${documents.length} provision(s) from ${match.name}'s adopted code.`);
  return { source, documents, read, notes, unreadable: [] };
}

/** "Codified through Ordinance …, adopted September 11, 2025. (Supp. No. 5)" */
export function codifiedThroughFrom(banner: string | null): string | null {
  if (!banner) return null;
  const match = banner.match(/Codified through[\s\S]{0,200}/i);
  if (!match) return null;
  return match[0].replace(/\s+/g, ' ').trim();
}

/** "Sec. 22-19. - Definitions." → "22-19" */
export function sectionFromTitle(title: string): string | null {
  const match = title.match(/(?:Sec(?:tion)?\.?|§)\s*([0-9]+[A-Za-z]?(?:[-.–][0-9]+[A-Za-z]?)*)/i)
    ?? title.match(/^(?:Chapter|Article|Part)\s+([0-9IVXLC]+)/i);
  return match?.[1] ?? null;
}

/* ─────────────────────── government HTML / PDF lane ──────────────────── */

/**
 * Read an ordinance published directly by a government site.
 *
 * A PDF is accepted only when it has a real text layer. A scan is reported as
 * unreadable with its URL so an operator can open it, which is the honest
 * outcome — the alternative is guessing at a rule from a filename.
 */
export async function readGovernmentOrdinance(
  url: string,
  label: string,
  topic: OrdinanceTopic,
  deps: OrdinanceLookupDeps = {},
): Promise<OrdinanceLookupResult> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const read: string[] = [url];

  if (/\.pdf($|\?)/i.test(url)) {
    const response = await fetchText(url, { timeoutMs: 45_000 });
    if (response.blocked || response.status >= 400) {
      return { source: null, documents: [], read, notes: [`${label} could not be retrieved (status ${response.status}).`], unreadable: [] };
    }
    // The transport hands back text; a PDF arrives as its raw bytes decoded as
    // latin1, which is exactly what the extractor expects.
    const text = extractPdfText(Buffer.from(response.body, 'latin1'));
    if (!text.trim() || text.trim().length < 200) {
      return {
        source: null, documents: [], read,
        notes: [`${label} is a PDF with no usable text layer.`],
        unreadable: [{ url, reason: 'The PDF carries no text layer, so LandOS cannot read the rule from it.' }],
      };
    }
    return {
      source: { publisher: 'government_pdf', jurisdictionLabel: label, url, codifiedThrough: null, handle: {} },
      documents: [{ title: label, section: null, text, url, topic }],
      read, notes: [`Read ${label} from an official PDF text layer.`], unreadable: [],
    };
  }

  const response = await fetchText(url, { timeoutMs: 40_000 });
  if (response.blocked) {
    return { source: null, documents: [], read, notes: [`${label} refused automated retrieval.`], unreadable: [{ url, reason: 'The site refused an automated client.' }] };
  }
  if (response.status >= 400) {
    return { source: null, documents: [], read, notes: [`${label} returned status ${response.status}.`], unreadable: [] };
  }
  const text = htmlToText(response.body);
  if (text.trim().length < 200) {
    return { source: null, documents: [], read, notes: [`${label} returned no readable text.`], unreadable: [] };
  }
  return {
    source: { publisher: detectCodePublisher(url), jurisdictionLabel: label, url, codifiedThrough: null, handle: {} },
    documents: [{ title: label, section: null, text, url, topic }],
    read, notes: [`Read ${label}.`], unreadable: [],
  };
}

/**
 * Follow an official page's own links to the documents it points at.
 *
 * Used when a government page ANNOUNCES a rule and links the document rather
 * than containing it — the "No Zoning regulations letter (PDF)" shape, which
 * is extremely common and is where the actual legal statement often lives.
 */
export function ordinanceLinksOn(html: string, baseUrl: string): Array<{ label: string; url: string; topic: OrdinanceTopic }> {
  return extractLinks(html, baseUrl)
    .filter((link) => /ordinance|code|zoning|subdivision|regulation|plat|manufactured|mobile home|letter|resolution/i.test(link.label))
    .map((link) => ({ ...link, topic: classifyOrdinanceTopic(link.label) }))
    .slice(0, 12);
}
