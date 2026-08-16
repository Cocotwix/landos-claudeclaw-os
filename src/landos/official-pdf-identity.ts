// LandOS — BOUNDED official-PDF parcel identity extraction.
//
// The live Fairview run found the parcel. It found it in a City of Fairview
// Planning Commission packet, which is a PDF, and the identity lane could not
// read it — the second of the two reasons that run could not resolve.
//
// This is NOT a PDF research agent. It answers exactly one question:
//
//     "Does this official document identify the exact property the operator's
//      raw input names?"
//
// Everything about it is bounded on purpose:
//   • Only an official / officially-linked GOVERNMENT source is eligible.
//   • The document must already look relevant from its URL, title, or snippet.
//   • The download is size-capped and the stream scan is count-capped.
//   • Extraction is ANCHORED on the operator's own parcel notation. Only a
//     short window around each anchor is read, so a 900 kB packet costs a
//     regex sweep, not a document analysis.
//   • A window whose map/parcel is a DIFFERENT parcel is discarded. The
//     acceptance case proves this matters: the same Fairview packet carries
//     "Map: 42, Parcel: 123.00" and "Map: 47, Parcel: 094.00" a few lines
//     apart, and the second one is somebody else's property.
//
// Text extraction uses `node:zlib` and nothing else. No new dependency, no OCR,
// no browser. A scanned document simply yields no text and the lane says so.

import zlib from 'node:zlib';

import {
  parcelNotationMatchesIdentifier,
  textMentionsParcelNotation,
  type ParcelNotation,
} from './parcel-notation.js';

export interface PdfIdentityLimits {
  /** Refuse to download beyond this. Planning packets are ~1 MB. */
  maxBytes?: number;
  /** Content streams to inflate before giving up. */
  maxStreams?: number;
  /** Characters of context read around each notation anchor. */
  windowChars?: number;
  /** Anchors examined. A document naming the parcel ten times is not ten facts. */
  maxAnchors?: number;
}

const DEFAULT_LIMITS: Required<PdfIdentityLimits> = {
  maxBytes: 12 * 1024 * 1024,
  maxStreams: 400,
  windowChars: 700,
  maxAnchors: 6,
};

// ── Text extraction ─────────────────────────────────────────────────────────

function inflate(buffer: Buffer): Buffer | null {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.gunzipSync]) {
    try { return fn(buffer); } catch { /* try the next encoding */ }
  }
  return null;
}

/** Text-showing operators out of one decoded content stream. */
function textFromContentStream(content: string): string {
  const out: string[] = [];
  let pending: string[] = [];
  const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTD\b|\bTd\b|\bT\*\b/g;
  const escapes: Record<string, string> = { n: '\n', r: '\n', t: ' ', b: '', f: '' };
  let match: RegExpExecArray | null;
  while ((match = token.exec(content)) !== null) {
    const raw = match[0];
    if (raw.startsWith('(')) {
      pending.push(raw.slice(1, -1)
        .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
        .replace(/\\(.)/g, (_, char: string) => escapes[char] ?? char));
    } else if (raw.startsWith('<')) {
      const hex = raw.slice(1, -1).replace(/\s+/g, '');
      let decoded = '';
      for (let index = 0; index + 1 < hex.length; index += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
      }
      pending.push(decoded);
    } else if (raw === 'Tj' || raw === 'TJ') {
      out.push(pending.join(''));
      pending = [];
    } else {
      if (pending.length) { out.push(pending.join('')); pending = []; }
      out.push('\n');
    }
  }
  if (pending.length) out.push(pending.join(''));
  return out.join(' ');
}

/**
 * One decoded document, fetched and parsed EXACTLY ONCE.
 *
 * Identity runs on the critical path and needs only the window around the
 * parcel notation. Enrichment runs after the subject is released and wants the
 * whole document. Both read this: the bytes are downloaded once, the text
 * layer is decoded once, and no later capability re-fetches a document LandOS
 * already has.
 */
export interface OfficialPdfDocument {
  url: string;
  fetchedAt: string;
  byteLength: number;
  /** Per content-stream text, in document order. Index + 1 is the approximate
   *  page: generated PDFs emit one content stream per page, and the number is
   *  always reported as approximate rather than claimed as exact. */
  pages: string[];
  text: string;
  /** False when the document carries no text layer at all (a scan). */
  textLayer: boolean;
  /** True when this call re-used an already-parsed document. */
  fromCache: boolean;
}

const DOCUMENT_CACHE = new Map<string, OfficialPdfDocument>();
const DOCUMENT_CACHE_LIMIT = 24;

/** Test seam and hygiene: forget every parsed document. */
export function clearOfficialPdfCache(): void {
  DOCUMENT_CACHE.clear();
}

/** How many documents are currently retained, for tests and diagnostics. */
export function officialPdfCacheSize(): number {
  return DOCUMENT_CACHE.size;
}

/**
 * Fetch and parse an official document, or hand back the one already parsed.
 *
 * The cache key is the URL. A document that could not be fetched is NOT cached,
 * so a transient failure does not become permanent.
 */
export async function loadOfficialPdf(
  url: string,
  options: { timeoutMs?: number; limits?: PdfIdentityLimits; fetchImpl?: typeof fetch; now?: () => string } = {},
): Promise<OfficialPdfDocument | null> {
  const cached = DOCUMENT_CACHE.get(url);
  if (cached) return { ...cached, fromCache: true };
  const bytes = await fetchPdfBounded(url, {
    timeoutMs: options.timeoutMs,
    ...(options.limits?.maxBytes ? { maxBytes: options.limits.maxBytes } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (!bytes) return null;
  const pages = extractPdfPages(bytes, options.limits ?? {});
  const document: OfficialPdfDocument = {
    url,
    fetchedAt: (options.now ?? (() => new Date().toISOString()))(),
    byteLength: bytes.length,
    pages,
    text: pages.join('\n'),
    textLayer: pages.some((page) => page.trim().length > 0),
    fromCache: false,
  };
  if (DOCUMENT_CACHE.size >= DOCUMENT_CACHE_LIMIT) {
    const oldest = DOCUMENT_CACHE.keys().next().value;
    if (oldest) DOCUMENT_CACHE.delete(oldest);
  }
  DOCUMENT_CACHE.set(url, document);
  return document;
}

/**
 * Per-content-stream text, in document order.
 *
 * Kept separate from `extractPdfText` so a finding can cite an approximate page
 * rather than a character offset into one long string.
 */
export function extractPdfPages(buffer: Buffer, limits: PdfIdentityLimits = {}): string[] {
  const { maxStreams } = { ...DEFAULT_LIMITS, ...limits };
  const latin = buffer.toString('latin1');
  const pages: string[] = [];
  // NOT the "stream" inside "endstream": matching that walked the scanner into
  // the gap between objects and silently collapsed a multi-page document to one.
  const marker = /(?<![A-Za-z])stream\r?\n?/g;
  let streams = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(latin)) !== null && streams < maxStreams) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    streams += 1;
    const raw = buffer.subarray(start, end);
    const decoded = inflate(raw);
    const body = decoded ? decoded.toString('latin1') : raw.toString('latin1');
    if (/\bT[Jj]\b/.test(body)) {
      pages.push(textFromContentStream(body).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
    }
    marker.lastIndex = end;
  }
  return pages;
}

/**
 * Plain text from a digitally generated PDF.
 *
 * Deliberately structural rather than a full parser: every `stream`/`endstream`
 * pair is inflated and the ones that contain text operators are read. That
 * survives object streams, compressed cross-reference tables and linearization
 * without implementing any of them. A scanned page contains an image and no
 * text operators, so it contributes nothing and is not guessed at.
 */
export function extractPdfText(buffer: Buffer, limits: PdfIdentityLimits = {}): string {
  const { maxStreams } = { ...DEFAULT_LIMITS, ...limits };
  const latin = buffer.toString('latin1');
  const chunks: string[] = [];
  // NOT the "stream" inside "endstream": matching that walked the scanner into
  // the gap between objects and silently collapsed a multi-page document to one.
  const marker = /(?<![A-Za-z])stream\r?\n?/g;
  let streams = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(latin)) !== null && streams < maxStreams) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    streams += 1;
    const raw = buffer.subarray(start, end);
    const decoded = inflate(raw);
    const body = decoded ? decoded.toString('latin1') : raw.toString('latin1');
    if (/\bT[Jj]\b/.test(body)) chunks.push(textFromContentStream(body));
    marker.lastIndex = end;
  }
  return chunks.join('\n').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export interface PdfIdentityCandidateInput {
  url: string;
  title?: string | null;
  snippet?: string | null;
  /** Officiality as the resolver's own classifier decided it. */
  officiality: 'official' | 'officially_linked' | 'unverified';
  notations: readonly ParcelNotation[];
  /** An accepted parcel identifier, when the card already carries one. */
  apn?: string | null;
  /** The locality this lead sits in, once jurisdiction has established one. */
  locality?: string | null;
  state?: string | null;
}

export interface PdfIdentityEligibility {
  eligible: boolean;
  /** True when the host is the established locality's own government domain. */
  hostCorroboratesLocality: boolean;
  reason: string;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

export function looksLikePdf(url: string, title?: string | null): boolean {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); } })();
  return path.endsWith('.pdf') || /\.pdf\b/i.test(url) || /\bpdf\b/i.test(String(title ?? ''));
}

/** Civic words a jurisdiction may spell out in its own domain label. */
const CIVIC_LABEL_WORDS = /city|town(?:ship)?|village|borough|county|municipal|gov(?:ernment)?|of|the/g;

/** The registrable label, so a subdomain or a host's TLD is never the evidence. */
function registrableLabel(host: string): string {
  const parts = host.split('.').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
}

/**
 * Is this municipal/county domain the government of the locality LandOS has
 * independently established?
 *
 * "fairview-tn.org" for Fairview, TN. This is a CORROBORATION rule, not a
 * naming convention: the locality it is matched against was established by the
 * federal geography service, not read off this same document.
 */
export function hostCorroboratesLocality(url: string, locality: string | null | undefined, state: string | null | undefined): boolean {
  const host = hostOf(url);
  const place = String(locality ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!host || place.length < 4) return false;
  const compact = host.replace(/[^a-z0-9]/g, '');
  if (!compact.includes(place)) return false;
  // A government or state-scoped host is the jurisdiction on the TLD alone.
  if (/\.gov$|\.us$/.test(host)) return true;
  const code = String(state ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!code) return false;
  // Off a government TLD the label must READ as the jurisdiction and nothing
  // else: "fairview-tn" is Fairview, TN, but "fairview-tn-realty" is a business
  // that named itself after the town, and a keyless search returns both. So
  // strip the place, the state code and the civic words a city may spell out,
  // and require nothing to be left over.
  const remainder = registrableLabel(host)
    .replace(/[^a-z]/g, '')
    .replace(place, '')
    .replace(code, '')
    .replace(CIVIC_LABEL_WORDS, '');
  return remainder === '';
}

/** Only a relevant official government document is worth downloading. */
export function pdfIdentityEligible(input: PdfIdentityCandidateInput): PdfIdentityEligibility {
  const corroborates = hostCorroboratesLocality(input.url, input.locality, input.state);
  if (!looksLikePdf(input.url, input.title)) {
    return { eligible: false, hostCorroboratesLocality: corroborates, reason: 'Not a PDF.' };
  }
  // `unverified` is the resolver's county/state-scoped verdict, and it has no
  // notion of a municipality: a city that publishes on its own non-.gov domain
  // scores as "not a government source" and its planning packets are never
  // opened. A host already corroborated as this locality's own government
  // domain IS the local government source of record, so it clears the gate on
  // that evidence — the same basis `readPublisherJurisdictionActs` already
  // uses to name the publisher. Nothing else about `unverified` is relaxed.
  if (input.officiality === 'unverified' && !corroborates) {
    return { eligible: false, hostCorroboratesLocality: corroborates, reason: `Not a government source (${hostOf(input.url)}); a document from anywhere else can never establish parcel identity.` };
  }
  const haystack = `${input.title ?? ''} ${input.snippet ?? ''} ${input.url}`;
  const mentionsNotation = input.notations.some((notation) => textMentionsParcelNotation(notation, haystack));
  const mentionsApn = !!input.apn && haystack.replace(/[^0-9A-Za-z]/g, '').includes(input.apn.replace(/[^0-9A-Za-z]/g, ''));
  const mentionsLocality = !!input.locality && new RegExp(`\\b${input.locality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
  if (!mentionsNotation && !mentionsApn && !mentionsLocality && !corroborates) {
    return { eligible: false, hostCorroboratesLocality: corroborates, reason: 'The result gives no indication it concerns this parcel or its locality.' };
  }
  return {
    eligible: true,
    hostCorroboratesLocality: corroborates,
    reason: mentionsNotation ? 'The result names this lead\'s parcel notation.'
      : mentionsApn ? 'The result names the accepted parcel identifier.'
        : corroborates ? 'An official document published by this lead\'s own municipality.'
          : 'An official document naming this lead\'s locality.',
  };
}

// ── Bounded, notation-anchored identity extraction ──────────────────────────

export interface PdfParcelIdentityEvidence {
  /** The parcel identifier as this document's own jurisdiction prints it. */
  parcelIdentifier: string | null;
  map: string | null;
  parcel: string | null;
  owner: string | null;
  acres: number | null;
  /** Road / location wording, when the window states one. */
  location: string | null;
  /** Subdivision or project name — useful for matching, not for valuation. */
  projectName: string | null;
  /** The exact text this was read from, so an operator can check it. */
  excerpt: string;
  /** True when this window's map/parcel matches the lead's own notation. */
  matchesSubject: boolean;
  rejectedReason: string | null;
}

const MAP_PARCEL = /\bmap\s*[:#]?\s*([0-9]{1,4}[A-Za-z]?)\b[\s,]*(?:group\s*[:#]?\s*([0-9A-Za-z]{1,3})\b[\s,]*)?(?:parcel|lot)\s*[:#]?\s*([0-9]{1,5}(?:\.[0-9]{1,3})?[A-Za-z]?)\b/i;
const OWNER = /\b(?:property\s+owner|owner\s+of\s+record|owner)\s*[:\-]?\s*([A-Z0-9][^\n.;]{2,60}?)(?=\s*(?:\.|;|\n|$|Current\s+Zoning|Requested))/i;
const ACRES = /\b([0-9]{1,5}(?:\.[0-9]{1,3})?)\s*(?:\+\/-\s*)?acres?\b/i;
const LOCATION = /\b(?:located\s+(?:at|on)|address|property\s+location|situated\s+on)\s*[:\-]?\s*([^\n.;]{4,70})/i;
// A named place, not a document type: "Master Development Plan" and "R-20 POD"
// are the kind of thing a planning packet says about EVERY item on its agenda.
const PROJECT = /\b([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3}\s+(?:Subdivision|Estates|Farms|Plat|Addition|Acres))\b/;

/** Zero-pad this document's map/parcel to the width the lead itself used. */
function alignedIdentifier(map: string, parcel: string, notation: ParcelNotation): string {
  const width = notation.parts.find((part) => /map/i.test(part.label))?.value.length ?? map.length;
  const padded = map.padStart(Math.max(width, map.length), '0');
  return `${padded} ${parcel}`;
}

/**
 * Read parcel identity out of an official document, anchored on the lead's own
 * notation.
 *
 * Windows are examined independently and a window for a different parcel is
 * REJECTED WITH A REASON rather than dropped silently — a planning packet
 * routinely discusses several properties, and quietly taking the nearest one is
 * exactly how the wrong parcel gets researched.
 */
export function readPdfParcelIdentity(input: {
  text: string;
  notations: readonly ParcelNotation[];
  apn?: string | null;
  limits?: PdfIdentityLimits;
}): PdfParcelIdentityEvidence[] {
  const { windowChars, maxAnchors } = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const flat = input.text.replace(/\s+/g, ' ');
  const found: PdfParcelIdentityEvidence[] = [];

  for (const notation of input.notations) {
    if (found.length >= maxAnchors) break;
    // The anchor is the notation as the DOCUMENT would print it: the ordered
    // groups, allowing the county's own words between them.
    const groups = notation.groups.map((group) => `0*${group.replace(/^0+(?=.)/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const anchor = new RegExp(groups.map((group) => `\\b${group}\\b`).join('[^0-9]{1,24}'), 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = anchor.exec(flat)) !== null && found.length < maxAnchors) {
      const start = Math.max(0, hit.index - Math.floor(windowChars / 2));
      const excerpt = flat.slice(start, hit.index + hit[0].length + Math.floor(windowChars / 2)).trim();
      const mapParcel = MAP_PARCEL.exec(excerpt);
      const map = mapParcel?.[1] ?? null;
      const parcel = mapParcel?.[3] ?? null;
      const parcelIdentifier = map && parcel ? alignedIdentifier(map, parcel, notation) : null;
      // THE GATE. The window's own map/parcel must name the lead's parcel.
      const matches = !!parcelIdentifier && parcelNotationMatchesIdentifier(notation, parcelIdentifier);
      const ownerMatch = OWNER.exec(excerpt);
      const acresMatch = ACRES.exec(excerpt);
      found.push({
        parcelIdentifier,
        map,
        parcel,
        owner: matches ? (ownerMatch?.[1]?.replace(/[,\s]+$/, '').trim() ?? null) : null,
        acres: matches && acresMatch ? Number(acresMatch[1]) : null,
        location: matches ? (LOCATION.exec(excerpt)?.[1]?.trim() ?? null) : null,
        projectName: matches ? (PROJECT.exec(excerpt)?.[1]?.trim() ?? null) : null,
        excerpt: excerpt.slice(0, 600),
        matchesSubject: matches,
        rejectedReason: matches
          ? null
          : parcelIdentifier
            ? `The document states Map ${map} Parcel ${parcel} here, which is not this lead's parcel. Nothing was taken from it.`
            : 'No map/parcel statement was found around this mention, so nothing identifies the parcel here.',
      });
      if (anchor.lastIndex === hit.index) anchor.lastIndex += 1;
    }
  }
  return found;
}

/** The single best identity reading from a document, or null. */
export function bestPdfParcelIdentity(evidence: readonly PdfParcelIdentityEvidence[]): PdfParcelIdentityEvidence | null {
  const usable = evidence.filter((row) => row.matchesSubject);
  if (!usable.length) return null;
  const score = (row: PdfParcelIdentityEvidence): number =>
    (row.owner ? 2 : 0) + (row.acres ? 2 : 0) + (row.location ? 1 : 0) + (row.projectName ? 1 : 0);
  return [...usable].sort((a, b) => score(b) - score(a))[0];
}

/** Download a document under a hard size cap. Returns null rather than throwing. */
export async function fetchPdfBounded(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<Buffer | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.maxBytes;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs ?? 25_000));
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'application/pdf,*/*',
      },
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > maxBytes ? null : bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
