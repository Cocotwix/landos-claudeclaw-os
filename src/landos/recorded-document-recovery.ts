// LandOS — recorded document recovery states.
//
// WHY THIS EXISTS. Two different failures kept being reported as the same
// thing, and both of them mislead an operator in an expensive direction.
//
// FIRST: a book/page reference is a POINTER. Knowing the subject conveyed at
// Deed Book 9433, Page 325 tells you where the instrument lives; it does not
// tell you what the instrument says. An easement, a reservation, a right of
// first refusal and a clean fee conveyance all look identical from the
// pointer. Reporting "deed 9433/325" as a delivered deed is reporting the
// index entry as the document.
//
// SECOND: "not publicly available" was being concluded from a single failed
// endpoint. A collector that 404s has established nothing about the record's
// availability — only about that route. A document is restricted when a real
// wall was actually reached and observed: a login page, a payment screen, a
// viewer that refused the image. Absence is a claim, and it requires that the
// search was genuinely exhausted first.
//
// So retrieval carries an explicit state, and the two claims that matter —
// "we have the document" and "the document is not available" — can only be
// made from states that earned them.
//
// Pure. No I/O.

/**
 * How far recovery of one recorded instrument actually got.
 *
 * Ordered from strongest to weakest, but never collapsed into a boolean:
 * every one of these means something different to the next action.
 */
export type RecordedDocumentState =
  /** The image was opened and read. This is the only state that has the document. */
  | 'FOUND_AND_RETRIEVED'
  /** The record exists in the index and a real wall stopped the image. */
  | 'FOUND_BUT_IMAGE_RESTRICTED'
  /** Only an index reference is held. The instrument itself was never opened. */
  | 'POINTER_ONLY'
  /** The search genuinely ran to its budget and no such record exists. */
  | 'NO_APPLICABLE_RECORD_FOUND'
  /** Recovery has not been carried far enough to conclude anything. */
  | 'SEARCH_NOT_EXHAUSTED';

/**
 * The kinds of wall that can justify `FOUND_BUT_IMAGE_RESTRICTED`.
 *
 * Each of these is something a person or a browser actually SAW. A network
 * error is not on this list, because a network error is a failed route, not a
 * restriction.
 */
export type ObservedWall =
  | 'login_required'
  | 'payment_required'
  | 'image_restricted_by_policy'
  | 'subscription_required';

export const OBSERVED_WALL_LABEL: Readonly<Record<ObservedWall, string>> = {
  login_required: 'The official viewer required an account login to open the image.',
  payment_required: 'The official viewer required a payment to open the image.',
  image_restricted_by_policy: 'The official viewer refused the image under a stated access policy.',
  subscription_required: 'The official viewer required a paid subscription to open the image.',
};

export interface RecordedDocumentRecovery {
  /** The index reference, e.g. "9433/325". A pointer, never a document. */
  reference: string;
  state: RecordedDocumentState;
  /** Populated only for FOUND_BUT_IMAGE_RESTRICTED. */
  observedWall: ObservedWall | null;
  /** The exact wall text or page title actually seen, retained as proof. */
  wallEvidence: string | null;
  /** Where the instrument image was retrieved to, when it was. */
  documentPath: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  /** Routes already tried, so a later attempt does not repeat them. */
  routesAttempted: string[];
  statement: string;
  nextStep: string;
}

/**
 * The guard behind the first failure.
 *
 * A book/page pointer never counts as a retrieved document, no matter how
 * confidently it is known or how many sources repeat it.
 */
export function pointerEstablishesDocument(): false {
  return false;
}

/** Only one state actually has the instrument. */
export function documentReturned(state: RecordedDocumentState): boolean {
  return state === 'FOUND_AND_RETRIEVED';
}

/**
 * The guard behind the second failure.
 *
 * Restriction may be claimed only when a wall was observed. A failed route, a
 * timeout, or a collector that returned nothing does not establish that the
 * public cannot obtain the record.
 */
export function mayClaimRestricted(observedWall: ObservedWall | null): boolean {
  return observedWall !== null;
}

/**
 * Absence may be claimed only from an exhausted search.
 *
 * `SEARCH_NOT_EXHAUSTED` is the honest default and must never be presented as
 * "no such document exists".
 */
export function mayClaimAbsent(state: RecordedDocumentState): boolean {
  return state === 'NO_APPLICABLE_RECORD_FOUND';
}

function statementFor(reference: string, state: RecordedDocumentState, wall: ObservedWall | null): string {
  switch (state) {
    case 'FOUND_AND_RETRIEVED':
      return `Instrument ${reference} was retrieved and read from the official record.`;
    case 'FOUND_BUT_IMAGE_RESTRICTED':
      return `Instrument ${reference} exists in the official index, and the image was withheld. ${
        wall ? OBSERVED_WALL_LABEL[wall] : 'A wall was reached.'
      } The instrument's terms are therefore unread.`;
    case 'POINTER_ONLY':
      return `Only the index reference ${reference} is held. The instrument itself has not been opened, so its terms — easements, reservations, restrictions — are unread and unknown.`;
    case 'NO_APPLICABLE_RECORD_FOUND':
      return `The official index was searched to the recovery budget and no applicable record matching ${reference} was found.`;
    case 'SEARCH_NOT_EXHAUSTED':
    default:
      return `Recovery of ${reference} has not been carried far enough to conclude anything. This is not a finding that the record is unavailable.`;
  }
}

function nextStepFor(state: RecordedDocumentState): string {
  switch (state) {
    case 'FOUND_AND_RETRIEVED':
      return 'Extract the material terms from the retained image.';
    case 'FOUND_BUT_IMAGE_RESTRICTED':
      return 'Obtain the instrument through the authorized channel the viewer named (account, counter copy, or paid order).';
    case 'POINTER_ONLY':
      return 'Open the instrument at the county register of deeds or its authorized record viewer.';
    case 'NO_APPLICABLE_RECORD_FOUND':
      return 'Confirm the reference against the assessor or a superseding conveyance before treating the record as nonexistent.';
    case 'SEARCH_NOT_EXHAUSTED':
    default:
      return 'Continue recovery: search the county register of deeds and its authorized record viewer by book and page.';
  }
}

/**
 * Build a recovery record whose claims match its state.
 *
 * A caller that asks for `FOUND_BUT_IMAGE_RESTRICTED` without an observed wall
 * is downgraded to `SEARCH_NOT_EXHAUSTED` rather than allowed to publish a
 * restriction it never saw, and a caller that asks for `FOUND_AND_RETRIEVED`
 * without a document path is downgraded to `POINTER_ONLY`. The record cannot
 * be constructed into a state it did not earn.
 */
export function buildRecordedDocumentRecovery(input: {
  reference: string;
  state: RecordedDocumentState;
  observedWall?: ObservedWall | null;
  wallEvidence?: string | null;
  documentPath?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  routesAttempted?: readonly string[];
}): RecordedDocumentRecovery {
  const wall = input.observedWall ?? null;
  let state = input.state;

  // A claim is only as strong as the thing that backs it.
  if (state === 'FOUND_AND_RETRIEVED' && !input.documentPath) state = 'POINTER_ONLY';
  if (state === 'FOUND_BUT_IMAGE_RESTRICTED' && !mayClaimRestricted(wall)) state = 'SEARCH_NOT_EXHAUSTED';

  return {
    reference: input.reference,
    state,
    observedWall: state === 'FOUND_BUT_IMAGE_RESTRICTED' ? wall : null,
    wallEvidence: state === 'FOUND_BUT_IMAGE_RESTRICTED' ? (input.wallEvidence ?? null) : null,
    documentPath: state === 'FOUND_AND_RETRIEVED' ? (input.documentPath ?? null) : null,
    sourceLabel: input.sourceLabel ?? null,
    sourceUrl: input.sourceUrl ?? null,
    retrievedAt: input.retrievedAt ?? null,
    routesAttempted: [...(input.routesAttempted ?? [])],
    statement: statementFor(input.reference, state, wall),
    nextStep: nextStepFor(state),
  };
}
