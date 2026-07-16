import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  addressVariantsCompatible,
  evaluatePropertyInstructionConsistency,
} from './instruction-consistency.js';
import { getPropertyCard, setCardVerificationStatus, upsertPropertyCard } from './property-card.js';

beforeEach(() => _initTestLandosDb());

const APN = '062 059G A 03400 000 2026';

describe('material property instruction consistency', () => {
  it('challenges the exact bad Camp Davidson rejection and records only a contradiction', () => {
    const existing = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Camp Davidson Road, Vonore, TN 37885',
      priorInputAddress: '171 Davidson Road, Venore, TN 37885', apn: APN, county: 'Monroe', state: 'TN',
      lat: 35.537233052732, lng: -84.243472880293, verified: true,
      verificationSource: 'Tennessee Comptroller public parcel layer',
    }).card;

    const result = setCardVerificationStatus(existing.id, 'rejected_mismatch', 'automated-agent',
      'Treat 171 Davidson Road as intended and reject 171 Camp Davidson Road because Camp is an extra street token.', {
        instruction: 'Treat 171 Davidson Road as the intended property and reject 171 Camp Davidson Road.',
        incomingAddress: '171 Davidson Road, Vonore, TN 37885',
        externalNormalizedAddress: '171 CAMP DAVIDSON RD, VONORE, TN 37885',
      });

    expect(result.error).toMatch(/stronger accepted parcel evidence/i);
    expect(getPropertyCard(existing.id)?.verification_status).toBe('verified_property');
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_property_card').get()).toEqual({ n: 1 });
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_instruction_contradiction').get()).toEqual({ n: 1 });
    expect(getLandosDb().prepare("SELECT COUNT(*) AS n FROM landos_card_activity WHERE kind='instruction_contradiction'").get()).toEqual({ n: 1 });
  });

  it('keeps a weak accepted alias on the canonical card without replacing its address or APN', () => {
    const existing = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Camp Davidson Road, Vonore, TN 37885',
      priorInputAddress: '171 Davidson Road, Venore, TN 37885', apn: APN, county: 'Monroe', state: 'TN',
      verified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
    }).card;
    const incoming = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '171 Davidson Road, Venore, TN 37885' });
    expect(incoming.created).toBe(false);
    expect(incoming.card.id).toBe(existing.id);
    expect(incoming.card.active_input_address).toBe('171 Camp Davidson Road, Vonore, TN 37885');
    expect(incoming.card.apn).toBe(APN);
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_property_card').get()).toEqual({ n: 1 });
  });

  it('upgrades one unresolved alias when the official APN and near-identical coordinates arrive', () => {
    const unresolved = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Davidson Road, Venore, TN 37885',
      county: 'Monroe', state: 'TN', lat: 35.537233052732, lng: -84.243472880293,
    }).card;
    const normalized = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 CAMP DAVIDSON RD, VONORE, TN 37885',
      priorInputAddress: '171 Davidson Road, Venore, TN 37885', apn: APN, county: 'Monroe', state: 'TN',
      lat: 35.537233052732, lng: -84.243472880293, verified: true,
      verificationSource: 'Tennessee Comptroller public parcel layer',
    });
    expect(normalized.created).toBe(false);
    expect(normalized.card.id).toBe(unresolved.id);
    expect(normalized.card.verification_status).toBe('verified_property');
    expect(JSON.parse(normalized.card.prior_inputs)).toContain('171 Davidson Road, Venore, TN 37885');
  });

  it('treats Road/Rd, capitalization, Venore/Vonore, and one missing Camp token as harmless', () => {
    expect(addressVariantsCompatible('171 Camp Davidson Road', '171 CAMP DAVIDSON RD')).toBe(true);
    expect(addressVariantsCompatible('171 Davidson Road, Venore, TN 37885', '171 CAMP DAVIDSON RD, VONORE, TN 37885')).toBe(true);
  });

  it.each([
    ['different APN', { incomingApn: 'DIFFERENT' }],
    ['different street number', { incomingAddress: '172 Camp Davidson Road' }],
    ['different county', { incomingCounty: 'Loudon' }],
    ['different coordinates', { incomingCoordinates: { lat: 36.5, lng: -84.2 } }],
    ['different parcel geometry', { incomingParcelGeometryKey: 'other-geometry' }],
  ])('retains genuine %s protection', (_label, patch) => {
    const check = evaluatePropertyInstructionConsistency({
      action: 'reject', instruction: 'reject based on material parcel evidence', ...patch,
      existing: {
        cardId: 1, address: '171 Camp Davidson Road', apn: APN, county: 'Monroe', state: 'TN',
        coordinates: { lat: 35.537233052732, lng: -84.243472880293 }, parcelGeometryKey: 'accepted-geometry',
        verificationSource: 'Tennessee Comptroller public parcel layer',
      },
    });
    expect(check.hardConflicts.length).toBeGreaterThan(0);
    expect(check.allowed).toBe(true);
    expect(check.actionTaken).toBe('hard conflict retained');
  });

  it('allows the terminal mismatch workflow when a supplied APN genuinely conflicts', () => {
    const existing = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Camp Davidson Road, Vonore, TN 37885',
      apn: APN, county: 'Monroe', state: 'TN', verified: true,
      verificationSource: 'Tennessee Comptroller public parcel layer',
    }).card;
    const result = setCardVerificationStatus(existing.id, 'rejected_mismatch', 'parcel-review', 'Supplied APN resolves to a different parcel.', {
      instruction: 'Reject because the supplied APN conflicts with the accepted APN.', incomingApn: 'DIFFERENT-APN',
    });
    expect(result.error).toBeUndefined();
    expect(result.card?.verification_status).toBe('rejected_mismatch');
  });
});
