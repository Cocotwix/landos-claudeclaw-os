// LandOS Placemat PDF — DEFERRED (its own leg).
//
// The placemat renders the assembled comp set + offer math to a one-page PDF.
// That needs a PDF dependency (pdfkit / puppeteer / jspdf), which this leg does
// NOT install ("no new installs"). So this is an INTENTIONAL stub: a typed
// interface that returns "not yet implemented" instead of a PDF. It never
// fabricates a file, never installs anything, and is wired nowhere live.

import type { OfferLanesResult } from './offer-engine.js';
import type { RetrievedComp, NeedsVerificationComp } from './comp-retrieval.js';

export interface PlacematInput {
  comps: RetrievedComp[];
  needsVerification?: NeedsVerificationComp[];
  offer?: OfferLanesResult;
  subjectLabel?: string;
}

export interface PlacematResult {
  implemented: false;
  /** No file is produced — the PDF leg is deferred. */
  filePath: null;
  reason: string;
}

/** Deferred placemat generator. Returns a not-implemented result; the PDF leg
 *  (with an approved PDF dependency) will replace this. Never produces a file. */
export function generatePlacematPdf(_input: PlacematInput): PlacematResult {
  return {
    implemented: false,
    filePath: null,
    reason: 'Placemat PDF is deferred to its own leg: needs an approved PDF dependency (no new installs this leg). Not yet implemented.',
  };
}
