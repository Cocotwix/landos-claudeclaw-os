// LandOS — eCode360 (General Code) local-code lookup.
//
// The second dominant municipal codifier after Municode, and the dominant one
// across the Northeast — which is exactly where a New York town's controlling
// zoning and subdivision code lives.
//
// It refuses a direct server request outright: the edge answers a plain fetch
// with a challenge page. That is a TRANSPORT fact, not an absence of code, and
// the two must never be reported the same way. The lookup therefore runs on the
// SHARED transport, which already escalates a blocked request into a background
// Chrome target — no foregrounding, no visible window, no focus change.
//
// The lane is bounded on purpose. It makes a small number of attempts against
// the publisher's own routes and then reports precisely which route refused, so
// an operator reads "the publisher does not list this jurisdiction" or "the
// publisher refused automation" rather than a bare UNRESOLVED.

import { defaultGovFetchText, htmlToText, type GovFetchText } from './gis-transport.js';
import { classifyOrdinanceTopic, normalizeJurisdictionKey, type OrdinanceCodeSource, type OrdinanceDocument } from './land-use-ordinance.js';

const ECODE_HOST = 'https://ecode360.com';
const PUBLISHER_LIBRARY = 'https://www.generalcode.com/library/';

export interface ECodeLookupResult {
  source: OrdinanceCodeSource | null;
  documents: OrdinanceDocument[];
  read: string[];
  notes: string[];
  /** Exactly why the code could not be reached, when it could not. */
  blocker: string | null;
  /** True when a route was refused rather than simply empty. */
  transportRefused: boolean;
}

/** eCode360 addresses a jurisdiction's code by a short id such as `ST1234`. */
export function extractECodeIds(html: string): string[] {
  return [...new Set([
    ...[...html.matchAll(/ecode360\.com\/([A-Z]{2}\d{3,6})/g)].map((match) => match[1]),
    ...[...html.matchAll(/href="\/([A-Z]{2}\d{3,6})"/g)].map((match) => match[1]),
  ])];
}

/**
 * Pick the code id whose surrounding label names the jurisdiction.
 *
 * An id alone is meaningless, so a match must be anchored to the publisher's
 * own text for that jurisdiction. Returning "some New York code" would be worse
 * than returning nothing.
 */
export function matchECodeEntry(html: string, jurisdiction: string, state: string): { id: string; label: string } | null {
  const wanted = normalizeJurisdictionKey(jurisdiction).replace(/\b(town|township|village|city|borough)\b/g, '').trim();
  if (!wanted) return null;
  const entries = [...html.matchAll(/(?:ecode360\.com\/|href="\/)([A-Z]{2}\d{3,6})"?[^>]*>([\s\S]{0,120}?)</g)]
    .map((match) => ({ id: match[1], label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
  const stateName = state.toUpperCase();
  return entries.find((entry) => {
    const key = normalizeJurisdictionKey(entry.label);
    return key.includes(wanted) && (entry.label.toUpperCase().includes(stateName) || !/\b[A-Z]{2}\b/.test(entry.label));
  }) ?? null;
}

/**
 * Locate and read a jurisdiction's eCode360 code.
 *
 * `fetchText` MUST be the shared transport so a refused direct request escalates
 * to the background browser rather than being read as "no such code".
 */
export async function lookupECode360(
  jurisdiction: string,
  state: string,
  deps: { fetchText?: GovFetchText; maxRequests?: number } = {},
): Promise<ECodeLookupResult> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const read: string[] = [];
  const notes: string[] = [];
  let transportRefused = false;
  let budget = deps.maxRequests ?? 4;

  const get = async (url: string, timeoutMs = 40_000) => {
    if (budget <= 0) return null;
    budget -= 1;
    read.push(url);
    try {
      const response = await fetchText(url, { timeoutMs });
      if (response.blocked) { transportRefused = true; return null; }
      if (response.status >= 400) return null;
      return response;
    } catch {
      transportRefused = true;
      return null;
    }
  };

  // 1. The publisher's own library index names every jurisdiction it publishes.
  const library = await get(`${PUBLISHER_LIBRARY}?state=${encodeURIComponent(state)}`);
  let entry = library ? matchECodeEntry(library.body, jurisdiction, state) : null;

  // 2. The codifier's own state listing, which needs the browser transport.
  if (!entry) {
    const stateIndex = await get(`${ECODE_HOST}/${state.toUpperCase()}`);
    if (stateIndex && !/eCode360 Error/i.test(stateIndex.body)) {
      entry = matchECodeEntry(stateIndex.body, jurisdiction, state);
    }
  }

  if (!entry) {
    const blocker = transportRefused
      ? `eCode360 refused automated retrieval for ${jurisdiction}, ${state}. The code may exist; LandOS could not reach the publisher's index.`
      : `eCode360's publisher index does not list ${jurisdiction}, ${state}. This publisher does not appear to carry that jurisdiction's code.`;
    notes.push(blocker);
    return { source: null, documents: [], read, notes, blocker, transportRefused };
  }

  // 3. The code itself.
  const codeUrl = `${ECODE_HOST}/${entry.id}`;
  const code = await get(codeUrl);
  if (!code) {
    const blocker = `eCode360 lists ${jurisdiction} as ${entry.id} but the code itself could not be retrieved.`;
    notes.push(blocker);
    return { source: null, documents: [], read, notes, blocker, transportRefused };
  }

  const text = htmlToText(code.body);
  if (text.trim().length < 400) {
    const blocker = `eCode360 returned no readable text for ${jurisdiction} (${entry.id}).`;
    notes.push(blocker);
    return { source: null, documents: [], read, notes, blocker, transportRefused };
  }

  const source: OrdinanceCodeSource = {
    publisher: 'ecode360',
    jurisdictionLabel: entry.label || jurisdiction,
    url: codeUrl,
    codifiedThrough: null,
    handle: { codeId: entry.id },
  };
  notes.push(`Read ${jurisdiction}'s adopted code from eCode360 (${entry.id}).`);
  return {
    source,
    documents: [{
      title: entry.label || `${jurisdiction} Code`,
      section: null,
      text,
      url: codeUrl,
      topic: classifyOrdinanceTopic(entry.label || text.slice(0, 400)),
    }],
    read,
    notes,
    blocker: null,
    transportRefused,
  };
}
