import { describe, it, expect } from 'vitest';
import { reconcileAttemptWithAcceptedIdentity } from './intake-resolution-reconciliation.js';

const TN30_FULL = '015 027 04512 000 2026';
const TN30_SHORT = '027 045.12';
const TN30_GISLINK = '015027 04512';

describe('reconcileAttemptWithAcceptedIdentity', () => {
  it('a confirmed Deal Card is ALWAYS identity-established (never "not yet established")', () => {
    const r = reconcileAttemptWithAcceptedIdentity({
      acceptedState: 'confirmed', acceptedCanonicalApn: TN30_FULL,
      attemptApn: null, attemptHasConflict: false, attemptEstablished: false,
    });
    expect(r.acceptedConfirmed).toBe(true);
    expect(r.identityEstablishedByApprovedSource).toBe(true);
  });

  it('a corroborating attempt on a confirmed card is labeled corroboration (format variant recognized)', () => {
    const r = reconcileAttemptWithAcceptedIdentity({
      acceptedState: 'confirmed', acceptedCanonicalApn: TN30_FULL,
      attemptApn: TN30_GISLINK, attemptHasConflict: false, attemptEstablished: true,
    });
    expect(r.attemptReconciliation).toBe('corroborates');
    expect(r.reconciliationMessage).toMatch(/corroborates the confirmed parcel/i);
    expect(r.identityEstablishedByApprovedSource).toBe(true);
  });

  it('a contradictory attempt on a confirmed card requires operator review and does NOT revoke identity', () => {
    const r = reconcileAttemptWithAcceptedIdentity({
      acceptedState: 'confirmed', acceptedCanonicalApn: TN30_FULL,
      attemptApn: 'R300 018 000 0084', attemptHasConflict: true, attemptEstablished: false,
    });
    expect(r.attemptReconciliation).toBe('attempt_conflict');
    expect(r.reconciliationMessage).toMatch(/requires operator review/i);
    // Identity remains established despite the contradicting attempt.
    expect(r.identityEstablishedByApprovedSource).toBe(true);
  });

  it('an inconclusive attempt on a confirmed card lets the accepted identity stand', () => {
    const r = reconcileAttemptWithAcceptedIdentity({
      acceptedState: 'confirmed', acceptedCanonicalApn: TN30_FULL,
      attemptApn: null, attemptHasConflict: false, attemptEstablished: false,
    });
    expect(r.attemptReconciliation).toBe('accepted_stands');
    expect(r.identityEstablishedByApprovedSource).toBe(true);
  });

  it('an unconfirmed card falls back to the attempt result (no accepted identity to reconcile)', () => {
    const conflictAttempt = reconcileAttemptWithAcceptedIdentity({
      acceptedState: 'candidate', acceptedCanonicalApn: null,
      attemptApn: 'R300 018 000 0084', attemptHasConflict: true, attemptEstablished: false,
    });
    expect(conflictAttempt.acceptedConfirmed).toBe(false);
    expect(conflictAttempt.attemptReconciliation).toBe('no_accepted_identity');
    expect(conflictAttempt.identityEstablishedByApprovedSource).toBe(false);

    const establishedAttempt = reconcileAttemptWithAcceptedIdentity({
      acceptedState: null, acceptedCanonicalApn: null,
      attemptApn: TN30_SHORT, attemptHasConflict: false, attemptEstablished: true,
    });
    expect(establishedAttempt.identityEstablishedByApprovedSource).toBe(true);
    expect(establishedAttempt.attemptReconciliation).toBe('no_accepted_identity');
  });
});
