// LandOS — reconcile a Smart Intake resolution ATTEMPT with the ACCEPTED
// canonical parcel identity of a Deal Card.
//
// The latest resolution attempt is history relative to a confirmed Deal Card, it
// never overrides the accepted parcel. A confirmed card must therefore never read
// "identity not yet established"; a contradicting attempt is an operator-review
// flag (not a revocation), and a corroborating attempt is shown as corroboration.

import { apnIdentifiersCorroborate } from './property-resolution-engine.js';

export type AttemptReconciliation =
  | 'no_accepted_identity'
  | 'corroborates'
  | 'attempt_conflict'
  | 'accepted_stands';

export interface ReconciliationInput {
  /** Persisted canonical parcel state for the Deal Card. */
  acceptedState?: string | null;
  /** Accepted canonical APN, when the card presents a confirmed parcel. */
  acceptedCanonicalApn?: string | null;
  /** APN this attempt resolved (whatever parcel it landed on), if any. */
  attemptApn?: string | null;
  /** True when this attempt produced a hard identifier/jurisdiction conflict. */
  attemptHasConflict: boolean;
  /** True when this attempt independently established parcel identity. */
  attemptEstablished: boolean;
}

export interface ReconciliationResult {
  acceptedConfirmed: boolean;
  /** True when identity is established for the CARD (accepted OR this attempt) —
   *  a confirmed card never reads "identity not yet established". */
  identityEstablishedByApprovedSource: boolean;
  attemptReconciliation: AttemptReconciliation;
  reconciliationMessage: string | null;
}

/**
 * PURE: decide how the latest attempt relates to the accepted canonical identity.
 * Never mutates or revokes the accepted identity — it only classifies the attempt.
 */
export function reconcileAttemptWithAcceptedIdentity(input: ReconciliationInput): ReconciliationResult {
  const acceptedConfirmed = input.acceptedState === 'confirmed';
  let attemptReconciliation: AttemptReconciliation = 'no_accepted_identity';
  if (acceptedConfirmed) {
    if (input.attemptHasConflict) {
      attemptReconciliation = 'attempt_conflict';
    } else if (input.acceptedCanonicalApn && input.attemptApn
      && apnIdentifiersCorroborate(input.acceptedCanonicalApn, input.attemptApn)) {
      attemptReconciliation = 'corroborates';
    } else if (input.attemptEstablished && !input.acceptedCanonicalApn) {
      attemptReconciliation = 'corroborates';
    } else {
      attemptReconciliation = 'accepted_stands';
    }
  }
  const reconciliationMessage = attemptReconciliation === 'attempt_conflict'
    ? 'Latest resolution attempt conflicts with the accepted canonical parcel and requires operator review. The accepted parcel identity remains confirmed; downstream intelligence continues.'
    : attemptReconciliation === 'corroborates'
      ? 'Latest resolution attempt corroborates the confirmed parcel.'
      : attemptReconciliation === 'accepted_stands'
        ? 'The accepted parcel identity remains confirmed; this attempt did not add an independent parcel match.'
        : null;
  return {
    acceptedConfirmed,
    identityEstablishedByApprovedSource: input.attemptEstablished || acceptedConfirmed,
    attemptReconciliation,
    reconciliationMessage,
  };
}
