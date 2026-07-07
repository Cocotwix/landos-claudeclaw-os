// Phase 4 — the stored ParcelIdentity verdict is AUTHORITATIVE in the spine and
// the legacy identity derivation is gone. This file (formerly the Phase-2 dual-run
// divergence harness) now proves the spine reads the stored state as the single
// source of truth, that the legacy card-flag fallback covers pre-migration data,
// and that the former residual divergence class is closed.

import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, attachCardSourceEvidence } from './property-card.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { assembleBusinessObjects, resolveParcelIdentityVerified } from './business-object-spine.js';
import { writeParcelIdentity } from './parcel-identity.js';

beforeEach(() => { _initTestLandosDb(); });

// ── Unit: the authoritative verdict resolver ────────────────────────────────
describe('resolveParcelIdentityVerified (pure)', () => {
  const card = (status?: string) => ({ id: 1, verification_status: status } as never);

  it('stored verdict wins: confirmed => true', () => {
    expect(resolveParcelIdentityVerified(card('unverified_lead'), { state: 'confirmed' })).toBe(true);
  });
  it('stored candidate/unresolved => false (even if the card flag says verified)', () => {
    expect(resolveParcelIdentityVerified(card('verified_property'), { state: 'candidate' })).toBe(false);
    expect(resolveParcelIdentityVerified(card('verified_property'), { state: 'unresolved' })).toBe(false);
  });
  it('no stored verdict falls back to the card verified_property flag', () => {
    expect(resolveParcelIdentityVerified(card('verified_property'), null)).toBe(true);
    expect(resolveParcelIdentityVerified(card('unverified_lead'), null)).toBe(false);
    expect(resolveParcelIdentityVerified(undefined, null)).toBe(false);
  });
});

// ── Spine end-to-end: stored state drives the packet ────────────────────────
function dealWithCard(card: Parameters<typeof upsertPropertyCard>[0]) {
  const c = upsertPropertyCard(card).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'auth' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: c.id, role: 'subject' });
  return { dealId: deal.id, cardId: c.id };
}

describe('assembleBusinessObjects — stored ParcelIdentity is authoritative', () => {
  it('Scott County TN: stored confirmed => packet parcelIdentityVerified true', () => {
    const { dealId, cardId } = dealWithCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '388 Gilstrap Rd, Huntsville, TN',
      apn: '094 02008 000', county: 'Scott', state: 'TN', acres: 5.1, owner: 'Record Owner',
      verified: true, verificationSource: 'Realie.ai (non-credit)',
    });
    writeParcelIdentity(dealId, { subjectCardId: cardId, state: 'confirmed', basis: 'named source', confidence: 0.95 });
    expect(assembleBusinessObjects(dealId)!.propertyIntelligence.parcelIdentityVerified).toBe(true);
  });

  it('Winters TX geocoded-only: stored candidate => not verified, not decision-grade', () => {
    const { dealId, cardId } = dealWithCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '2510 State Highway 153, Winters, TX',
      county: 'Runnels', state: 'TX', verified: false,
    });
    writeParcelIdentity(dealId, { subjectCardId: cardId, state: 'candidate', basis: 'geocoded location', confidence: 0.75 });
    const pkt = assembleBusinessObjects(dealId)!.propertyIntelligence;
    expect(pkt.parcelIdentityVerified).toBe(false);
    expect(pkt.decisionGrade).toBe(false);
  });

  it('RESIDUAL CLASS CLOSED: stored confirmed but card NOT verified_property => now verified', () => {
    // Parcel confirmed by >=2 parcel-level lanes; acquire route never set the card
    // verified_property flag. The old legacy spine said unverified (divergence);
    // the authoritative stored verdict correctly reports it as verified.
    const { dealId, cardId } = dealWithCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '10 Pine Rd, Cleveland, GA',
      apn: 'R-77', county: 'White', state: 'GA', verified: false,
    });
    writeParcelIdentity(dealId, { subjectCardId: cardId, state: 'confirmed', basis: '2 independent parcel-level sources', confidence: 0.85 });
    expect(assembleBusinessObjects(dealId)!.propertyIntelligence.parcelIdentityVerified).toBe(true);
  });

  it('legacy fallback (no stored verdict): a verified card is still decision-grade', () => {
    const { dealId, cardId } = dealWithCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '2510 State Highway 153, Winters, TX',
      apn: 'R12345', county: 'Runnels', state: 'TX', acres: 12.5, owner: 'Jane Doe',
      verified: true, verificationSource: 'county assessor record (APN + county)',
    });
    attachCardSourceEvidence({
      cardId, fact: 'owner + APN', sourceUrl: 'https://assessor.runnels.tx.gov/parcel/R12345', parcelVerified: true,
    });
    // No writeParcelIdentity call — exercises the pre-migration fallback path.
    const pkt = assembleBusinessObjects(dealId)!.propertyIntelligence;
    expect(pkt.parcelIdentityVerified).toBe(true);
    expect(pkt.decisionGrade).toBe(true);
  });
});
