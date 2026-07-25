// LandOS — PARCEL-SPECIFIC RESEARCH DEPTH.
//
// Opening a county assessor, GIS, recorder, or tax department HOMEPAGE is not
// research. A collector had been able to report a source as "retrieved" after
// merely reaching a department landing page, which put general navigation links
// in front of the operator dressed as public-record facts about their parcel.
//
// This module is the single, pure judge of how deep a source attempt actually
// went. It never guesses upward: to claim a parcel-specific fact, the attempt has
// to show a parcel-specific claim, document, or record page — an identifier in a
// URL alone is not a fact, and a landing page is never one.
//
// The four honest outcomes, which the operator must be able to tell apart:
//
//   parcel_fact_retrieved     — a parcel-specific fact, record, or document came
//                               back from the source.
//   parcel_search_no_record   — the parcel WAS searched at the source and the
//                               source genuinely has no matching record.
//   source_unavailable        — the source was down, blocked, paywalled, or
//                               required credentials LandOS does not hold.
//   general_link_only         — a department page was reached but no parcel
//                               search was completed. This is a lead, not a fact.

export type ParcelResearchDepth =
  | 'parcel_fact_retrieved'
  | 'parcel_search_no_record'
  | 'source_unavailable'
  | 'general_link_only';

export interface ParcelResearchAttempt {
  /** The source that was visited. */
  sourceName: string;
  /** The deepest URL actually reached. */
  url?: string | null;
  /** True when a parcel search was actually executed at the source (an
   *  identifier was submitted and the source answered). */
  parcelSearchExecuted?: boolean;
  /** Parcel-specific facts extracted (claims, field values, record rows). */
  parcelFactCount?: number;
  /** Parcel-specific documents/pages retained (deed pages, record PDFs). */
  retainedDocumentCount?: number;
  /** The source refused, errored, timed out, demanded payment or credentials. */
  blocked?: boolean;
  blockedReason?: string | null;
  /** What the page identified itself as, when known. */
  pageKind?: 'record_detail' | 'results_list' | 'search_form' | 'landing_page' | 'error' | 'unknown';
}

export interface ParcelResearchVerdict {
  depth: ParcelResearchDepth;
  /** True only for `parcel_fact_retrieved`. The single boolean any caller should
   *  read before describing a source as researched. */
  parcelSpecific: boolean;
  /** Operator-facing sentence. Never overstates what was obtained. */
  statement: string;
}

/** URL paths that are department navigation, not a parcel record. */
const LANDING_PATH = /^\/?(|home|index(\.\w+)?|default(\.\w+)?|welcome|about|contact|departments?|services?|government|offices?)\/?$/i;

/** Does this URL look like a bare department homepage rather than a parcel page? */
export function isDepartmentLandingUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // A query string carrying an identifier means a search was at least attempted.
    if (parsed.search && /[?&](apn|parcel|pin|account|acct|id|q|search|address|owner)/i.test(parsed.search)) return false;
    return LANDING_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * PURE: judge how deep one source attempt actually went.
 *
 * Order matters. A blocked source is unavailable no matter what page it showed.
 * Facts or retained documents are the only route to `parcel_fact_retrieved`. An
 * executed parcel search that returned nothing is an honest negative result and
 * genuinely useful. Everything else — including a perfectly loaded assessor
 * homepage — is `general_link_only`.
 */
export function classifyParcelResearchAttempt(attempt: ParcelResearchAttempt): ParcelResearchVerdict {
  const facts = attempt.parcelFactCount ?? 0;
  const docs = attempt.retainedDocumentCount ?? 0;

  if (attempt.blocked) {
    return {
      depth: 'source_unavailable',
      parcelSpecific: false,
      statement: `${attempt.sourceName}: source unavailable or blocked${attempt.blockedReason ? ` — ${attempt.blockedReason}` : ''}. No parcel-specific record was obtained.`,
    };
  }
  if (attempt.pageKind === 'error') {
    return {
      depth: 'source_unavailable',
      parcelSpecific: false,
      statement: `${attempt.sourceName}: the source returned an error page. No parcel-specific record was obtained.`,
    };
  }
  if (facts > 0 || docs > 0) {
    return {
      depth: 'parcel_fact_retrieved',
      parcelSpecific: true,
      statement: `${attempt.sourceName}: retrieved ${facts} parcel-specific fact(s)${docs ? ` and ${docs} retained document(s)` : ''} for this parcel.`,
    };
  }
  if (attempt.parcelSearchExecuted) {
    return {
      depth: 'parcel_search_no_record',
      parcelSpecific: false,
      statement: `${attempt.sourceName}: the parcel was searched and this source has no matching record. This is a completed search, not a missing one.`,
    };
  }
  const landing = attempt.pageKind === 'landing_page' || isDepartmentLandingUrl(attempt.url);
  return {
    depth: 'general_link_only',
    parcelSpecific: false,
    statement: landing
      ? `${attempt.sourceName}: only the department page was reached; no parcel search was completed. This is a source lead, not a public-record fact about this parcel.`
      : `${attempt.sourceName}: no parcel search was completed at this source. This is a source lead, not a public-record fact about this parcel.`,
  };
}

/**
 * The status a collector may honestly report. A collector that reached only
 * department pages cannot be `succeeded`, however many links it found: a source
 * lead is not a retrieved record.
 */
export function collectorStatusForDepths(
  depths: ParcelResearchDepth[],
): { status: 'succeeded' | 'partial' | 'blocked' | 'failed'; reason: string } {
  if (depths.length === 0) return { status: 'failed', reason: 'No source was attempted.' };
  const retrieved = depths.filter((d) => d === 'parcel_fact_retrieved').length;
  const searched = depths.filter((d) => d === 'parcel_search_no_record').length;
  const unavailable = depths.filter((d) => d === 'source_unavailable').length;
  const linkOnly = depths.filter((d) => d === 'general_link_only').length;

  if (retrieved > 0 && linkOnly === 0 && unavailable === 0) {
    return { status: 'succeeded', reason: `${retrieved} source(s) returned parcel-specific records.` };
  }
  if (retrieved > 0) {
    return { status: 'partial', reason: `${retrieved} source(s) returned parcel-specific records; ${linkOnly + unavailable} did not complete a parcel search.` };
  }
  if (searched > 0) {
    return { status: 'partial', reason: `${searched} source(s) completed a parcel search with no matching record; no parcel-specific facts were retrieved.` };
  }
  if (unavailable > 0 && linkOnly === 0) {
    return { status: 'blocked', reason: `${unavailable} source(s) were unavailable or blocked.` };
  }
  return {
    status: 'partial',
    reason: `Only department pages were reached (${linkOnly} source lead(s)); no parcel search was completed, so nothing here is a public-record fact about this parcel.`,
  };
}
