import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import {
  computeParcelState, parcelIdentityFromResolution, readParcelIdentity,
  writeParcelIdentity, persistParcelIdentityFromResolution, isParcelState,
  confirmParcel, confirmParcelForDeal,
  type ConfirmedParcel, type ParcelIdentityRecord,
} from './parcel-identity.js';
import type { PropertyResolution } from './property-resolution-engine.js';

beforeEach(() => { _initTestLandosDb(); });
const newDeal = () => createDealCard({ entity: 'TY_LAND_BIZ', title: 'pi', leadType: 'test' }).id;

/** Minimal resolution stub — only the fields parcel-identity reads. */
function resolution(over: Partial<PropertyResolution> = {}): PropertyResolution {
  const base = {
    status: 'matched',
    identityEstablished: false,
    identityBasis: 'test basis',
    confidence: 0.8,
    property: { sources: [], parcelVerified: false, evidence: [], missing: [] },
    browserEvidence: [],
  } as unknown as PropertyResolution;
  return { ...base, ...over } as PropertyResolution;
}

describe('computeParcelState (pure)', () => {
  it('confirmed when identity established', () => {
    expect(computeParcelState({ status: 'matched', identityEstablished: true })).toBe('confirmed');
    // confirmed wins even if status somehow disagrees
    expect(computeParcelState({ status: 'needs_clarification', identityEstablished: true })).toBe('confirmed');
  });
  it('candidate when matched but not established', () => {
    expect(computeParcelState({ status: 'matched', identityEstablished: false })).toBe('candidate');
  });
  it('unresolved when needs clarification', () => {
    expect(computeParcelState({ status: 'needs_clarification', identityEstablished: false })).toBe('unresolved');
  });
});

describe('parcelIdentityFromResolution (pure)', () => {
  it('carries basis + confidence and dedupes provenance refs', () => {
    const v = parcelIdentityFromResolution(resolution({
      identityEstablished: true,
      identityBasis: 'Parcel identity verified by Realie.',
      confidence: 0.95,
      property: { sources: ['Realie/LandPortal', 'US Census geocoder', 'Realie/LandPortal'], parcelVerified: true, evidence: [], missing: [] } as never,
      browserEvidence: [{ service: 'landportal', status: 'retrieved' }] as never,
    }));
    expect(v.state).toBe('confirmed');
    expect(v.basis).toBe('Parcel identity verified by Realie.');
    expect(v.confidence).toBe(0.95);
    expect(v.evidenceRefs).toEqual(['Realie/LandPortal', 'US Census geocoder', 'browser:landportal']);
  });
  it('parked browser evidence is not a provenance ref', () => {
    const v = parcelIdentityFromResolution(resolution({
      browserEvidence: [{ service: 'landportal', status: 'parked' }] as never,
    }));
    expect(v.evidenceRefs).toEqual([]);
  });
});

describe('parcel identity persistence', () => {
  it('write then read round-trips the verdict', () => {
    const id = newDeal();
    writeParcelIdentity(id, { subjectCardId: 7, state: 'candidate', basis: 'b', confidence: 0.7, evidenceRefs: ['x'] });
    const r = readParcelIdentity(id);
    expect(r?.state).toBe('candidate');
    expect(r?.subjectCardId).toBe(7);
    expect(r?.evidenceRefs).toEqual(['x']);
    expect(r?.confirmedAt).toBeNull();
  });

  it('returns null when never written', () => {
    expect(readParcelIdentity(newDeal())).toBeNull();
  });

  it('stamps confirmed_at on first confirm and preserves it', () => {
    const id = newDeal();
    writeParcelIdentity(id, { state: 'confirmed', basis: 'b', confidence: 0.95 });
    const first = readParcelIdentity(id);
    expect(first?.confirmedAt).toBeGreaterThan(0);
    // re-confirm keeps the original confirmation time
    writeParcelIdentity(id, { state: 'confirmed', basis: 'b2', confidence: 0.96 });
    expect(readParcelIdentity(id)?.confirmedAt).toBe(first?.confirmedAt);
  });

  it('upsert replaces state on the same deal (idempotent key)', () => {
    const id = newDeal();
    writeParcelIdentity(id, { state: 'unresolved', basis: 'a', confidence: 0.2 });
    writeParcelIdentity(id, { state: 'candidate', basis: 'b', confidence: 0.7 });
    expect(readParcelIdentity(id)?.state).toBe('candidate');
  });

  it('persistParcelIdentityFromResolution stores the derived verdict', () => {
    const id = newDeal();
    persistParcelIdentityFromResolution(id, resolution({
      status: 'matched', identityEstablished: false, confidence: 0.75,
      property: { sources: ['Photon'], parcelVerified: false, evidence: [], missing: [] } as never,
    }), { subjectCardId: 3 });
    const r = readParcelIdentity(id);
    expect(r?.state).toBe('candidate');
    expect(r?.confidence).toBe(0.75);
    expect(r?.evidenceRefs).toEqual(['Photon']);
    expect(r?.subjectCardId).toBe(3);
  });
});

describe('isParcelState', () => {
  it('validates the enum', () => {
    expect(isParcelState('confirmed')).toBe(true);
    expect(isParcelState('bogus')).toBe(false);
  });
});

// A department is any function that requires a ConfirmedParcel. It CANNOT be
// called with an unconfirmed parcel because ConfirmedParcel is unconstructable
// outside the module — the compiler is the gate.
function exampleDepartment(parcel: ConfirmedParcel): string {
  return `run on deal ${parcel.dealCardId}`;
}

describe('ConfirmedParcel capability gate', () => {
  it('confirmParcel returns null below confirmed', () => {
    expect(confirmParcel(null)).toBeNull();
    expect(confirmParcel({ state: 'unresolved' } as never)).toBeNull();
    expect(confirmParcel({ state: 'candidate' } as never)).toBeNull();
  });

  it('confirmParcel yields a token only when confirmed, and a department accepts it', () => {
    const id = newDeal();
    writeParcelIdentity(id, { subjectCardId: 4, state: 'confirmed', basis: 'named source', confidence: 0.95, evidenceRefs: ['Realie/LandPortal'] });
    const token = confirmParcelForDeal(id);
    expect(token).not.toBeNull();
    expect(token!.dealCardId).toBe(id);
    expect(token!.subjectCardId).toBe(4);
    expect(token!.basis).toBe('named source');
    // A department runs only because it was handed a real ConfirmedParcel.
    expect(exampleDepartment(token!)).toContain(`deal ${id}`);
  });

  it('a candidate deal cannot produce a token for a department', () => {
    const id = newDeal();
    writeParcelIdentity(id, { state: 'candidate', basis: 'geocoded', confidence: 0.7 });
    expect(confirmParcelForDeal(id)).toBeNull();
  });

  it('COMPILE GATE: a department rejects a raw record (only a ConfirmedParcel type-checks)', () => {
    const raw = { dealCardId: 1, subjectCardId: null, state: 'confirmed', basis: 'b', confidence: 1, evidenceRefs: [], confirmedAt: 1, confirmedBy: 'x', updatedAt: 1 };
    // @ts-expect-error a plain ParcelIdentityRecord is NOT a ConfirmedParcel; the
    // brand makes this a compile error — proving departments can't be called
    // without passing the gate.
    exampleDepartment(raw as ParcelIdentityRecord);
    expect(true).toBe(true);
  });
});

// Regression: intake-dedupe-overwrites-accepted-identity (QA finding W2-F2).
// A CONFIRMED stored verdict is accepted operator information: later automated
// runs must never replace its basis, provenance, or confidence. Only an
// explicit operator confirmation may supersede it.
describe('accepted-identity preservation', () => {
  it('a later automated run never replaces a confirmed verdict', () => {
    const dealId = newDeal();
    writeParcelIdentity(dealId, {
      subjectCardId: null, state: 'confirmed',
      basis: 'Parcel confirmed by LandPortal Map Search parcel panel (browser read-only).',
      confidence: 0.9, evidenceRefs: ['browser:landportal'],
    }, 'acquire');
    const kept = persistParcelIdentityFromResolution(dealId, resolution({
      identityEstablished: true,
      identityBasis: 'Parcel identity verified by South Carolina statewide parcel layer (SCDOT GIS mirror).',
      confidence: 1,
    }));
    expect(kept.basis).toContain('LandPortal Map Search');
    expect(kept.confidence).toBe(0.9);
    const stored = readParcelIdentity(dealId)!;
    expect(stored.basis).toContain('LandPortal Map Search');
    expect(stored.confidence).toBe(0.9);
  });

  it('an explicit operator confirmation may supersede, and progress upgrades still persist', () => {
    const dealId = newDeal();
    // unresolved -> confirmed is progress, always allowed
    persistParcelIdentityFromResolution(dealId, resolution({ status: 'needs_clarification', identityEstablished: false }));
    expect(readParcelIdentity(dealId)!.state).toBe('unresolved');
    persistParcelIdentityFromResolution(dealId, resolution({ identityEstablished: true, identityBasis: 'First confirmation.', confidence: 0.9 }));
    expect(readParcelIdentity(dealId)!.basis).toBe('First confirmation.');
    // confirmed -> confirmed replacement requires confirmedBy
    persistParcelIdentityFromResolution(dealId, resolution({ identityEstablished: true, identityBasis: 'Tyler-corrected confirmation.', confidence: 1 }), { confirmedBy: 'tyler' });
    expect(readParcelIdentity(dealId)!.basis).toBe('Tyler-corrected confirmation.');
  });
});
