// Comparable TRANSACTION enrichment — closed-sale evidence for comps LandOS
// already retained.
//
// The comp universe is not the problem this file solves. Discovery already put
// the candidates on the Deal Card. What discovery could NOT establish is the
// transaction itself: marketplace SOLD result cards state "Sold" and a price,
// but LandWatch search cards expose no sale date at all and Redfin search cards
// expose only a rounded off-market month. An undated sale can never date-qualify
// (see comp-recency-window), so it sits in the retained universe carrying no
// valuation weight, and a search card's headline price is frequently the last
// ASKING price rather than the price the deal actually closed at.
//
// This lane therefore starts from the persisted candidate and its own retained
// source URL, revisits exactly that page, and reads the transaction the page
// publishes about itself:
//
//   LandWatch  — the listing payload carries a `listingEvents` timeline
//                (date / price / acres / eventTitle) plus the listing's own
//                record keyed by `siteListingId`, which states `isResidence`.
//   Redfin     — the detail page publishes a "Sale history for <address>"
//                table (date / event / price) plus "Property Type" and
//                "Lot Size".
//
// Three rules keep it honest and bounded:
//
//   1. NO DISCOVERY. Every visit is to a URL already persisted on the comp row.
//      Nothing here searches a marketplace, widens a market, or adds a comp.
//   2. IDENTITY GATE. Evidence is bound to the comp only when the page LandOS
//      landed on is that comp's own retained listing — the source URL's listing
//      identity must survive the round trip, and the captured address must match
//      the retained address. Invariant 4: facts from another property are never
//      evidence for this one.
//   3. THE EXISTING RULES STILL DECIDE. This lane writes facts — closed status,
//      sale date, closed price, acreage, improvement evidence, provenance. It
//      never sets classification, never sets valuation selection, and never
//      moves a record into or out of the strict FMV set. comps-valuation reads
//      the enriched row and applies the same acreage band, recency window and
//      credibility rules it always applied.

import { getLandosDb } from './db.js';
import { listComps, type CompRow } from './comps.js';
import { normalizeAddressMatchKey } from './address-normalize.js';
import { normalizeSaleDateIso, valuationAcreageBand, inAcreageBand } from './comp-recency-window.js';
import { routeAcreage, routedAcreageSimilarity } from './acreage-router.js';
import { compGeoTier, type CompGeoTierId } from './comp-geography.js';
import { openDisposableContextHandle } from './automation-browser.js';

export type TransactionEnrichmentProvider = 'LandWatch' | 'Redfin';

/** One dated event on the listing's own published timeline. */
export interface CompListingEvent {
  dateIso: string;
  /** Verbatim event label as the source published it. */
  event: string;
  price: number | null;
  acres: number | null;
}

/**
 * What a provider detail page states about its own transaction. Every field is
 * either read from the page or null; nothing here is inferred from another
 * record, and nothing is defaulted to a plausible value.
 */
export interface CompTransactionEvidence {
  provider: TransactionEnrichmentProvider;
  /** The URL actually loaded, as the page reported it. */
  sourceUrl: string;
  /** Address the page states for itself. */
  address: string | null;
  /** The page states the transaction closed (a Sold event, or a sold status). */
  closedSale: boolean;
  soldDateIso: string | null;
  soldPrice: number | null;
  acres: number | null;
  /** true = the page states a residence/structure, false = it states none, null = it does not say. */
  improved: boolean | null;
  /** Verbatim property-type / improvement wording the page used. */
  improvementStatement: string | null;
  /** Full dated timeline, newest first. Prior sales included when exposed. */
  events: CompListingEvent[];
  /** Listing identity carried by the page (LandWatch pid, Redfin home id). */
  listingIdentity: string | null;
  /** Human-readable statement of where each fact came from. */
  provenance: string;
  /** Set when the page loaded but did not publish usable transaction evidence. */
  limitation: string | null;
}

// ── Bounded candidate selection ─────────────────────────────────────────────

export interface TransactionEnrichmentCandidate {
  row: CompRow;
  provider: TransactionEnrichmentProvider;
  /** Geographic tier the reconciliation lane established for this row. */
  tierId: CompGeoTierId;
  /** Why this row was chosen, in the order the ranking applied. */
  reason: string;
}

/** Which retained rows this lane can revisit at all. */
export function transactionEnrichmentProvider(row: CompRow): TransactionEnrichmentProvider | null {
  const url = row.source_url || '';
  if (/landwatch\.com\/.*\/pid\/\d+/i.test(url)) return 'LandWatch';
  if (/redfin\.com\/.*\/home\/\d+/i.test(url)) return 'Redfin';
  return null;
}

/** A row this lane has nothing to add to: its sale date is already established. */
function alreadyDated(row: CompRow): boolean {
  return normalizeSaleDateIso(row.sale_or_list_date) != null;
}

/** The persisted geographic tier, or `unresolved` when the lane never ran. */
function rowGeoTier(row: CompRow): CompGeoTierId {
  const raw = (row.geo_tier || '').toLowerCase();
  return raw === 'local' || raw === 'expanded' || raw === 'broader' ? raw : 'unresolved';
}

/** A row whose own retained evidence already states a structure on the parcel. */
function statedImproved(row: CompRow): boolean {
  return (row.property_class || '').toLowerCase() === 'residential';
}

/**
 * Rank the retained SOLD candidates whose transaction evidence is missing, and
 * return the bounded strongest set.
 *
 * The ranking is deliberately the same one the valuation itself cares about, so
 * the lane spends its bounded budget where a real sale date could actually
 * change the answer:
 *
 *   1. inside the subject's valuation acreage band before outside it — a sale
 *      outside the band cannot influence the cleaned FMV however well dated;
 *   2. a candidate whose retained evidence does NOT already state a residence
 *      before one that does — a stated improved sale cannot enter the clean
 *      vacant-land set however well dated, so it is directional context only;
 *   3. GEOGRAPHY: local, then expanded, then broader, then unresolved. Among
 *      candidates equally able to price the subject, the closest market is
 *      always attempted first, and a broader-market row is reached only when
 *      the closer tiers do not fill the run. This outranks acreage: a broader
 *      sale that matches the subject's acreage more closely is still farther
 *      evidence, and dating it first would spend the budget teaching the
 *      valuation more about a market the subject is not in;
 *   4. `core` (clean vacant-land candidate) before `directional`;
 *   5. closest acreage to the subject, using the same routed similarity the
 *      valuation weights sales by.
 *
 * Keys 1 and 2 sit above geography deliberately. They are not preferences about
 * WHERE the evidence is, they are whether the candidate can price the subject
 * at all: an out-of-band acreage and a stated residence are both excluded from
 * the clean vacant-land set by rules that run before geography does, so a
 * nearer one of those is still a candidate a sale date cannot promote.
 *
 * Pure: no database, no browser, no clock.
 */
export function rankCompsForTransactionEnrichment(
  rows: CompRow[],
  subjectAcres: number | null,
  limit: number,
): TransactionEnrichmentCandidate[] {
  const band = valuationAcreageBand(subjectAcres);
  const route = routeAcreage(subjectAcres);

  const scored = rows
    .map((row) => ({ row, provider: transactionEnrichmentProvider(row) }))
    .filter((c): c is { row: CompRow; provider: TransactionEnrichmentProvider } => c.provider != null)
    .filter((c) => c.row.price_kind === 'sale' && typeof c.row.price === 'number' && (c.row.price as number) > 0)
    .filter((c) => !alreadyDated(c.row))
    .map((c) => {
      const inBand = inAcreageBand(c.row.acres, band);
      const core = (c.row.classification || '').toLowerCase() === 'core';
      const similarity = route ? routedAcreageSimilarity(c.row.acres, route) : 0;
      const tierId = rowGeoTier(c.row);
      return { ...c, inBand, core, similarity, tierId, improved: statedImproved(c.row) };
    })
    .sort((a, b) => {
      if (a.inBand !== b.inBand) return a.inBand ? -1 : 1;
      if (a.improved !== b.improved) return a.improved ? 1 : -1;
      const tierDelta = compGeoTier(a.tierId).rank - compGeoTier(b.tierId).rank;
      if (tierDelta !== 0) return tierDelta;
      if (a.core !== b.core) return a.core ? -1 : 1;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return a.row.id - b.row.id;
    });

  return scored.slice(0, Math.max(0, limit)).map((c) => ({
    row: c.row,
    provider: c.provider,
    tierId: c.tierId,
    reason: [
      compGeoTier(c.tierId).shortLabel,
      c.inBand ? `inside the ${band?.label ?? 'subject acreage band'}` : 'outside the subject acreage band',
      c.improved ? 'retained evidence states a residence, directional context only' : 'no residence stated on the retained evidence',
      c.core ? 'clean vacant-land candidate' : 'directional candidate',
      c.row.acres != null ? `${c.row.acres} ac` : 'acreage not established',
      'sale date not established',
    ].join(', '),
  }));
}

// ── Pure extraction: LandWatch ──────────────────────────────────────────────

/** Everything the browser hands back from one detail page. */
export interface DetailPageCapture {
  /** The URL the page reported for itself after any redirect. */
  url: string;
  title: string;
  /** document.body.innerText. */
  text: string;
  /** Concatenated <script> text, only needed by LandWatch. */
  scriptText: string;
}

/**
 * The address a provider puts in its <title>, with the provider's own trailing
 * chrome removed.
 *
 * Both providers append pipe-separated chrome after the address — Redfin adds
 * "| Redfin", LandWatch adds "| MLS: <id> | LandWatch". Keeping that chrome in
 * the address is what made a page's own address fail to reconcile against the
 * comparable it belonged to, so the address stops at the first pipe.
 */
export function addressFromPageTitle(title: string): string | null {
  const head = String(title ?? '').split('|')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return head.length > 0 ? head : null;
}

const money = (raw: string): number | null => {
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Extract the JSON object enclosing `index` by walking out to its balanced
 * braces. Returns null rather than guessing when the braces do not balance
 * inside the scan budget.
 */
function enclosingJsonObject(text: string, index: number, budget = 60_000): unknown | null {
  let start = -1;
  let depth = 0;
  for (let i = index; i >= Math.max(0, index - budget); i -= 1) {
    const ch = text[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < Math.min(text.length, start + budget); i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** LandWatch listing id from a /pid/<n> URL. */
export function landWatchListingId(url: string): string | null {
  return /\/pid\/(\d+)/.exec(url ?? '')?.[1] ?? null;
}

/** Redfin listing id from a /home/<n> URL. */
export function redfinListingId(url: string): string | null {
  return /\/home\/(\d+)/.exec(url ?? '')?.[1] ?? null;
}

/**
 * Read LandWatch's own transaction statement for the page it is on.
 *
 * The listing payload is streamed as escaped JSON inside <script> tags, so the
 * text is unescaped once and then read structurally — `listingEvents` for the
 * dated timeline and the record keyed by this page's own `siteListingId` for
 * `isResidence`. Nothing is read from the neighbouring "More by agent" or
 * "Recently Viewed" listings, which belong to other properties.
 */
export function extractLandWatchTransactionEvidence(capture: DetailPageCapture): CompTransactionEvidence {
  const pid = landWatchListingId(capture.url);
  const unescaped = capture.scriptText.replace(/\\+"/g, '"');
  const base: CompTransactionEvidence = {
    provider: 'LandWatch',
    sourceUrl: capture.url,
    address: addressFromPageTitle(capture.title),
    closedSale: false,
    soldDateIso: null,
    soldPrice: null,
    acres: null,
    improved: null,
    improvementStatement: null,
    events: [],
    listingIdentity: pid,
    provenance: '',
    limitation: null,
  };

  const eventsRaw = /"listingEvents":(\[[^\]]*\])/.exec(unescaped)?.[1] ?? null;
  let parsedEvents: Array<Record<string, unknown>> = [];
  if (eventsRaw) {
    try {
      const value = JSON.parse(eventsRaw);
      if (Array.isArray(value)) parsedEvents = value as Array<Record<string, unknown>>;
    } catch { parsedEvents = []; }
  }

  const events: CompListingEvent[] = parsedEvents
    .map((e) => {
      const dateIso = normalizeSaleDateIso(String(e.date ?? '').slice(0, 10));
      const price = typeof e.price === 'number' && e.price > 0 ? e.price : null;
      const acres = typeof e.acres === 'number' && e.acres > 0 ? e.acres : null;
      const event = String(e.eventTitle ?? '').trim();
      return dateIso && event ? { dateIso, event, price, acres } : null;
    })
    .filter((e): e is CompListingEvent => e != null)
    .sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));

  base.events = events;

  const soldEvent = events.find((e) => /^sold\b/i.test(e.event));
  if (soldEvent) {
    base.closedSale = true;
    base.soldDateIso = soldEvent.dateIso;
    base.soldPrice = soldEvent.price;
    base.acres = soldEvent.acres;
  } else if (/"availability":"recently_sold"/.test(unescaped)) {
    base.limitation = 'LandWatch states this listing recently sold but published no dated Sold event, so no sale date could be established.';
  } else {
    base.limitation = 'LandWatch published no Sold event and no sold availability for this listing.';
  }

  // The listing's own record, located by this page's listing id — never a
  // neighbouring card's record.
  if (pid) {
    const marker = `"siteListingId":${pid}`;
    const at = unescaped.indexOf(marker);
    const record = at >= 0 ? enclosingJsonObject(unescaped, at) as Record<string, unknown> | null : null;
    if (record && typeof record.isResidence === 'boolean') {
      base.improved = record.isResidence;
      base.improvementStatement = record.isResidence
        ? 'LandWatch states this listing is a residence (isResidence = true).'
        : 'LandWatch states this listing is not a residence (isResidence = false).';
    }
    if (base.acres == null && typeof record?.acres === 'number' && record.acres > 0) base.acres = record.acres;
  }

  base.provenance = [
    `LandWatch listing detail page${pid ? ` (listing ${pid})` : ''}, read from the listing's own published payload.`,
    soldEvent ? `Dated "${soldEvent.event}" event on the listing timeline.` : null,
    base.improvementStatement,
  ].filter(Boolean).join(' ');

  return base;
}

// ── Pure extraction: Redfin ─────────────────────────────────────────────────

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Jan 17, 2025" → "2025-01-17". Returns null on anything else. */
export function parseUsLongDate(raw: string): string | null {
  const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return normalizeSaleDateIso(`${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`);
}

/**
 * Read Redfin's own transaction statement for the page it is on.
 *
 * Redfin publishes a "Sale history for <address>" table whose rows are a date,
 * an event and a price. That table is this property's record; the "Recently
 * sold homes" comparison strip above it belongs to other properties and is
 * never read here — extraction starts at the sale-history heading.
 */
export function extractRedfinTransactionEvidence(capture: DetailPageCapture): CompTransactionEvidence {
  const text = capture.text.replace(/ /g, ' ');
  const homeId = redfinListingId(capture.url);
  const base: CompTransactionEvidence = {
    provider: 'Redfin',
    sourceUrl: capture.url,
    address: addressFromPageTitle(capture.title),
    closedSale: false,
    soldDateIso: null,
    soldPrice: null,
    acres: null,
    improved: null,
    improvementStatement: null,
    events: [],
    listingIdentity: homeId,
    provenance: '',
    limitation: null,
  };

  const propertyType = /\n(Vacant land|Land|Single Family Residential|Residential|Multi-Family|Townhouse|Condo|Mobile\/Manufactured Home|Ranch|Farm)\s*\nProperty Type\b/i.exec(text)?.[1] ?? null;
  if (propertyType) {
    base.improvementStatement = `Redfin states Property Type: ${propertyType}.`;
    base.improved = /^(vacant land|land)$/i.test(propertyType) ? false : true;
  }

  const lot = /\n([\d,]+(?:\.\d+)?)\s*acres?\s*\nLot Size\b/i.exec(text)?.[1] ?? null;
  if (lot) {
    const acres = Number(lot.replace(/,/g, ''));
    if (Number.isFinite(acres) && acres > 0) base.acres = acres;
  }

  // Only this property's own sale history. Everything before the heading —
  // including the "Recently sold homes" strip — belongs to other parcels.
  const historyStart = text.search(/Sale history for\b/i);
  if (historyStart >= 0) {
    const block = text.slice(historyStart, historyStart + 3000);
    const lines = block.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const dateIso = parseUsLongDate(lines[i]);
      if (!dateIso) continue;
      const event = lines[i + 1] ?? '';
      if (!/^(sold|listed|pending|contingent|price changed|listing removed|relisted|delisted|off market|sold \(public records\))/i.test(event)) continue;
      const priceRaw = lines[i + 2] ?? '';
      base.events.push({
        dateIso,
        event: event.trim(),
        price: /^\$[\d,]/.test(priceRaw) ? money(priceRaw) : null,
        acres: null,
      });
    }
  }
  base.events.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));

  const soldEvent = base.events.find((e) => /^sold\b/i.test(e.event));
  if (soldEvent) {
    base.closedSale = true;
    base.soldDateIso = soldEvent.dateIso;
    base.soldPrice = soldEvent.price;
  } else {
    const offMarket = /OFF MARKET\s+([A-Z]{3})\s+(\d{4})\s+FOR\s+(\$[\d.,]+[KM]?)/i.exec(text);
    base.limitation = historyStart < 0
      ? 'Redfin published no sale-history table for this property, so no sale date could be established.'
      : offMarket
        ? `Redfin states this property went off market in ${offMarket[1]} ${offMarket[2]}, but published no dated Sold row, so no exact sale date could be established.`
        : 'Redfin published a sale history with no Sold row, so no sale date could be established.';
  }

  base.provenance = [
    `Redfin property detail page${homeId ? ` (home ${homeId})` : ''}, read from this property's own "Sale history" record.`,
    soldEvent ? `Dated "${soldEvent.event}" row in that table.` : null,
    base.improvementStatement,
    lot ? `Lot Size stated as ${lot} acres.` : null,
  ].filter(Boolean).join(' ');

  return base;
}

// ── Identity gate ───────────────────────────────────────────────────────────

export interface TransactionIdentityVerdict {
  matched: boolean;
  matchedOn: string[];
  reason: string;
}

/**
 * Bind the captured evidence to the comp, or refuse it.
 *
 * The listing identity in the retained URL must survive the round trip: a
 * redirect to a different pid or home id means LandOS is looking at a different
 * property, and evidence from another property is never evidence for this one.
 * When the comp carries a usable street address, the page must state the same
 * one.
 */
export function reconcileTransactionEvidence(evidence: CompTransactionEvidence, row: CompRow): TransactionIdentityVerdict {
  const idOf = evidence.provider === 'LandWatch' ? landWatchListingId : redfinListingId;
  const retainedId = idOf(row.source_url || '');
  const capturedId = evidence.listingIdentity;
  if (!retainedId || !capturedId) {
    return { matched: false, matchedOn: [], reason: 'The retained comparable URL carries no provider listing id, so the captured page cannot be bound to this record.' };
  }
  if (retainedId !== capturedId) {
    return {
      matched: false,
      matchedOn: [],
      reason: `The page LandOS landed on is ${evidence.provider} listing ${capturedId}, not this comparable's retained listing ${retainedId}. Evidence from another property is never applied.`,
    };
  }

  const matchedOn = [`${evidence.provider} listing id ${retainedId}`];
  // Compare the STREET line only. The rest of a postal address differs
  // harmlessly between a stored row and a page title ("TN, 37064" vs
  // "TN 37064"), and normalising the whole string first would fold those
  // differences into one token that can never match again.
  const streetOf = (address: string | null): string =>
    normalizeAddressMatchKey((address ?? '').split(',')[0] ?? '');
  const retainedStreet = streetOf(row.address_desc);
  const capturedStreet = streetOf(evidence.address);
  // A retained address that never carried a street (a bare-city or empty row)
  // cannot corroborate, and the listing id already binds the page.
  const retainedHasStreet = retainedStreet.replace(/[^a-z]/gi, '').length > 3;
  if (retainedHasStreet && capturedStreet) {
    if (retainedStreet !== capturedStreet) {
      return {
        matched: false,
        matchedOn,
        reason: `The retained comparable is "${row.address_desc}" but the page states "${evidence.address}". The addresses do not reconcile, so no transaction evidence was applied.`,
      };
    }
    matchedOn.push('street address');
  }

  return { matched: true, matchedOn, reason: `Bound to this comparable on ${matchedOn.join(' and ')}.` };
}

// ── The field patch ─────────────────────────────────────────────────────────

export interface CompTransactionPatch {
  saleOrListDate?: string;
  price?: number;
  acres?: number;
  pricePerAcre?: number;
  /**
   * Corrected ONLY when the source decisively states whether the parcel that
   * sold carries a residence. This is a fact the existing improved-property
   * detection already reads; it is not a classification decision. Establishing
   * a sale date on a row whose stored class wrongly says vacant land is exactly
   * how an improved sale would slip into the clean vacant-land median, so the
   * source's own statement is written alongside the date it justified.
   */
  propertyClass?: 'vacant_land' | 'residential';
}

export interface CompTransactionUpdate {
  compId: number;
  patch: CompTransactionPatch;
  /** One operator-readable line per field this evidence changed. */
  changes: string[];
  /** Why nothing was written, when nothing was. */
  refusal: string | null;
}

/** Acreage is only rewritten when the source materially disagrees. */
const ACRE_TOLERANCE = 0.01;

/**
 * Turn verified evidence into the exact field changes to persist. Pure.
 *
 * Only transaction FACTS move: the closed date, the closed price, the acreage
 * the transaction covered, and the price per acre derived from those two. This
 * function never touches classification, property class, or valuation
 * selection — the existing valuation rules read the corrected facts and decide
 * for themselves.
 */
export function compTransactionUpdate(row: CompRow, evidence: CompTransactionEvidence): CompTransactionUpdate {
  const patch: CompTransactionPatch = {};
  const changes: string[] = [];

  if (!evidence.closedSale || !evidence.soldDateIso) {
    return { compId: row.id, patch, changes, refusal: evidence.limitation ?? 'The source published no dated closed sale for this record.' };
  }

  if (normalizeSaleDateIso(row.sale_or_list_date) !== evidence.soldDateIso) {
    patch.saleOrListDate = evidence.soldDateIso;
    changes.push(row.sale_or_list_date
      ? `Sale date corrected from "${row.sale_or_list_date}" to ${evidence.soldDateIso}.`
      : `Sale date established as ${evidence.soldDateIso}.`);
  }

  // A search card's headline figure is routinely the last asking price. The
  // dated Sold event is the price the deal closed at, so it wins outright.
  if (evidence.soldPrice != null && evidence.soldPrice !== row.price) {
    patch.price = evidence.soldPrice;
    changes.push(row.price != null
      ? `Sale price corrected from $${Math.round(row.price).toLocaleString('en-US')} to the closed price $${evidence.soldPrice.toLocaleString('en-US')}.`
      : `Closed sale price established as $${evidence.soldPrice.toLocaleString('en-US')}.`);
  }

  if (evidence.acres != null && (row.acres == null || Math.abs(evidence.acres - row.acres) > ACRE_TOLERANCE)) {
    patch.acres = evidence.acres;
    changes.push(row.acres != null
      ? `Acreage corrected from ${row.acres} to ${evidence.acres} acres as the source states them.`
      : `Acreage established as ${evidence.acres} acres.`);
  }

  if (evidence.improved != null) {
    const stated = evidence.improved ? 'residential' : 'vacant_land';
    if (row.property_class !== stated) {
      patch.propertyClass = stated;
      changes.push(`${evidence.improvementStatement ?? `${evidence.provider} states this parcel is ${evidence.improved ? 'improved' : 'unimproved'}.`} Property class corrected from "${row.property_class || 'not established'}" to ${stated}.`);
    }
  }

  const finalPrice = patch.price ?? row.price;
  const finalAcres = patch.acres ?? row.acres;
  if (typeof finalPrice === 'number' && finalPrice > 0 && typeof finalAcres === 'number' && finalAcres > 0) {
    const ppa = Math.round((finalPrice / finalAcres) * 100) / 100;
    if (row.price_per_acre == null || Math.abs(ppa - row.price_per_acre) > 0.01) {
      patch.pricePerAcre = ppa;
      changes.push(`Price per acre recomputed to $${Math.round(ppa).toLocaleString('en-US')}/ac from the closed price and stated acreage.`);
    }
  }

  return { compId: row.id, patch, changes, refusal: changes.length === 0 ? 'The source states the same transaction LandOS already held; nothing changed.' : null };
}

// ── Persistence ─────────────────────────────────────────────────────────────

interface TransactionAttribution {
  provider: string;
  url: string;
  kind: 'transaction_evidence';
  capturedAtIso: string;
  closedSale: boolean;
  soldDateIso: string | null;
  soldPrice: number | null;
  acres: number | null;
  improved: boolean | null;
  improvementStatement: string | null;
  events: CompListingEvent[];
  provenance: string;
  identity: string;
}

/**
 * Persist the patch and the evidence behind it. The evidence record is appended
 * to the row's source attributions, replacing only a previous transaction
 * record from the same provider, so discovery attributions are preserved.
 */
export function applyCompTransactionEvidence(
  row: CompRow,
  evidence: CompTransactionEvidence,
  identity: TransactionIdentityVerdict,
  update: CompTransactionUpdate,
  capturedAtIso: string,
): void {
  const db = getLandosDb();

  let attributions: unknown[] = [];
  try {
    const parsed = JSON.parse(row.source_attributions_json || '[]');
    if (Array.isArray(parsed)) attributions = parsed;
  } catch { attributions = []; }
  const record: TransactionAttribution = {
    provider: evidence.provider,
    url: evidence.sourceUrl,
    kind: 'transaction_evidence',
    capturedAtIso,
    closedSale: evidence.closedSale,
    soldDateIso: evidence.soldDateIso,
    soldPrice: evidence.soldPrice,
    acres: evidence.acres,
    improved: evidence.improved,
    improvementStatement: evidence.improvementStatement,
    events: evidence.events,
    provenance: evidence.provenance,
    identity: identity.reason,
  };
  const kept = attributions.filter((a) => {
    const rec = a as Record<string, unknown> | null;
    return !(rec && rec.kind === 'transaction_evidence' && rec.provider === evidence.provider);
  });

  const sets: string[] = ['source_attributions_json = ?', 'updated_at = strftime(\'%s\',\'now\')'];
  const args: unknown[] = [JSON.stringify([...kept, record])];
  if (update.patch.saleOrListDate != null) { sets.push('sale_or_list_date = ?'); args.push(update.patch.saleOrListDate); }
  if (update.patch.price != null) { sets.push('price = ?', 'price_kind = ?'); args.push(update.patch.price, 'sale'); }
  if (update.patch.acres != null) { sets.push('acres = ?'); args.push(update.patch.acres); }
  if (update.patch.pricePerAcre != null) { sets.push('price_per_acre = ?'); args.push(update.patch.pricePerAcre); }
  if (update.patch.propertyClass != null) { sets.push('property_class = ?'); args.push(update.patch.propertyClass); }

  args.push(row.id);
  db.prepare(`UPDATE landos_comp SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

// ── The lane ────────────────────────────────────────────────────────────────

export interface CompTransactionEnrichmentResult {
  compId: number;
  provider: TransactionEnrichmentProvider;
  address: string;
  sourceUrl: string;
  /** Geographic tier this candidate was attempted from, closest market first. */
  tierId: CompGeoTierId;
  tierLabel: string;
  /** Evidence was identity-gated and written. */
  enriched: boolean;
  soldDateIso: string | null;
  soldPrice: number | null;
  acres: number | null;
  improved: boolean | null;
  changes: string[];
  priorEvents: CompListingEvent[];
  provenance: string;
  /** Why this candidate produced no change. */
  reason: string;
}

// Declared, not imported: these names resolve inside the browser context the
// reader below is evaluated in, never in this Node process.
declare const document: {
  title?: unknown;
  body?: { innerText?: unknown };
  querySelectorAll: (selector: string) => ArrayLike<{ textContent?: unknown }>;
};
declare const window: { location?: { href?: unknown }; scrollTo(x: number, y: number): void };

/** In-page reader. Reads only the page it is on; never follows a link. */
const READ_DETAIL_PAGE = (): { url: string; title: string; text: string; scriptText: string } => {
  let scriptText = '';
  for (const s of Array.from(document.querySelectorAll('script'))) scriptText += `${String(s.textContent ?? '')}\n`;
  return {
    url: String(window.location?.href ?? ''),
    title: String(document.title ?? ''),
    text: String(document.body?.innerText ?? ''),
    scriptText,
  };
};

export interface CompTransactionEnrichmentOptions {
  /** How many retained candidates this run may revisit. */
  limit?: number;
  subjectAcres?: number | null;
  /** Injected for tests; defaults to the owned automation browser. */
  capture?: (url: string, provider: TransactionEnrichmentProvider) => Promise<DetailPageCapture>;
  nowIso?: () => string;
}

async function defaultCapture(url: string, provider: TransactionEnrichmentProvider): Promise<DetailPageCapture> {
  const browser = await openDisposableContextHandle(provider.toLowerCase()) as unknown as {
    newPage(): Promise<{
      setViewport?(v: { width: number; height: number }): Promise<void>;
      goto(u: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
      evaluate<T>(fn: unknown, ...args: unknown[]): Promise<T>;
    }>;
    close(): Promise<void>;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport?.({ width: 1440, height: 1200 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await new Promise<void>((r) => setTimeout(r, 5000));
    // Redfin renders the sale-history table only once it is scrolled into view.
    await page.evaluate(() => { window.scrollTo(0, 12_000); });
    await new Promise<void>((r) => setTimeout(r, 4000));
    return await page.evaluate<DetailPageCapture>(READ_DETAIL_PAGE);
  } finally {
    try { await browser.close(); } catch { /* the disposable context is gone either way */ }
  }
}

/**
 * Enrich the bounded strongest retained SOLD candidates on a Deal Card with the
 * transaction evidence their own listing pages publish.
 *
 * This adds NO comparable and searches NO marketplace. It revisits URLs already
 * persisted on the Deal Card, one candidate at a time, and writes only
 * identity-gated transaction facts back onto those same records.
 */
export async function enrichCompTransactions(
  dealCardId: number,
  opts: CompTransactionEnrichmentOptions = {},
): Promise<CompTransactionEnrichmentResult[]> {
  const capture = opts.capture ?? defaultCapture;
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const candidates = rankCompsForTransactionEnrichment(
    listComps({ dealCardId }),
    opts.subjectAcres ?? null,
    opts.limit ?? 8,
  );

  const results: CompTransactionEnrichmentResult[] = [];
  for (const candidate of candidates) {
    const { row, provider, tierId } = candidate;
    const base = {
      compId: row.id,
      provider,
      address: row.address_desc,
      sourceUrl: row.source_url,
      tierId,
      tierLabel: compGeoTier(tierId).shortLabel,
      soldDateIso: null as string | null,
      soldPrice: null as number | null,
      acres: null as number | null,
      improved: null as boolean | null,
      changes: [] as string[],
      priorEvents: [] as CompListingEvent[],
      provenance: '',
    };
    let captured: DetailPageCapture;
    try {
      captured = await capture(row.source_url, provider);
    } catch (error) {
      results.push({ ...base, enriched: false, reason: `The retained ${provider} listing page could not be read: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    const evidence = provider === 'LandWatch'
      ? extractLandWatchTransactionEvidence(captured)
      : extractRedfinTransactionEvidence(captured);
    base.soldDateIso = evidence.soldDateIso;
    base.soldPrice = evidence.soldPrice;
    base.acres = evidence.acres;
    base.improved = evidence.improved;
    base.priorEvents = evidence.events;
    base.provenance = evidence.provenance;

    const identity = reconcileTransactionEvidence(evidence, row);
    if (!identity.matched) {
      results.push({ ...base, enriched: false, reason: identity.reason });
      continue;
    }

    const update = compTransactionUpdate(row, evidence);
    if (update.changes.length === 0) {
      results.push({ ...base, enriched: false, reason: update.refusal ?? 'No transaction evidence was available to apply.' });
      continue;
    }

    applyCompTransactionEvidence(row, evidence, identity, update, nowIso());
    results.push({ ...base, enriched: true, changes: update.changes, reason: identity.reason });
  }

  return results;
}
