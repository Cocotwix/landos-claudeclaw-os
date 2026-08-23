// Promoting parcel identity from an official municipal GIS record.
//
// Invariant 2 admits "an official assessor or GIS record" as a basis for
// confirming parcel identity. These tests pin the two things that make such a
// promotion safe: it requires owner corroboration, and it changes STATUS ONLY.

import { describe, expect, it } from 'vitest';

import { findMunicipalGisSource, identityPromotionFromGisConfirmation } from './interactive-gis-capability.js';
import type { GisEvidence } from './interactive-gis-session.js';
import type { PropertyIdentityVersion } from './property-summary-slice.js';

const FAIRVIEW = findMunicipalGisSource('Fairview', 'TN')!;

/** Deal 89's accepted identity: canonical 51.11 acres after split reconciliation. */
const EXISTING: PropertyIdentityVersion = {
  id: 87,
  dealCardId: 89,
  propertyCardId: 79,
  version: 5,
  status: 'candidate',
  address: '0 Kingwood Blvd',
  city: 'Fairview',
  county: 'Williamson',
  state: 'TN',
  zip: '37062',
  apn: '042-123.00-000',
  owner: 'LANDSOUTH LLC',
  acreage: 51.11,
  geometry: null,
  basis: 'No official county parcel record has confirmed this identity.',
  confidence: 0.6,
  sourceRefs: [],
  changeReason: 'reconciliation',
  createdBy: 'test',
  isCurrent: true,
  createdAt: 1787350384,
};

function evidence(overrides: Partial<GisEvidence['subject']> = {}): GisEvidence {
  return {
    question: 'current_zoning',
    appUrl: FAIRVIEW.appUrl,
    appTitle: 'Fairview Character Districts - Public',
    sourceLabel: FAIRVIEW.sourceLabel,
    layerUrl: FAIRVIEW.parcelLayerUrl,
    layerName: 'Parcels',
    layerLastEditedAt: '2026-08-13T13:26:42.897Z',
    subject: {
      confirmed: true,
      basis: 'parcel_identifier_owner_corroborated',
      observedIdentifier: '042    12300 00001042',
      observedOwner: 'LANDSOUTH LLC',
      statement: 'The layer feature carries parcel identifier 042    12300 00001042, equivalent to the subject APN 042-123.00-000, and names owner LANDSOUTH LLC.',
      ...overrides,
    },
    derivation: 'layer_attribute',
    attribute: 'CD',
    value: 'CD-3L',
    legendLabel: 'CD-3L',
    screenshots: [],
    retrievedAtIso: '2026-08-23T03:38:01.605Z',
    notes: [],
  };
}

describe('identity promotion from an official GIS parcel record', () => {
  it('promotes a candidate to confirmed and cites the record that did it', () => {
    const promotion = identityPromotionFromGisConfirmation({
      existing: EXISTING, evidence: evidence(), source: FAIRVIEW,
    })!;
    expect(promotion.status).toBe('confirmed');
    expect(promotion.basis).toMatch(/City of Fairview official zoning map/);
    expect(promotion.basis).toMatch(/042    12300 00001042/);
    expect(promotion.changeReason).toMatch(/parcel key and owner of record/);
    expect(promotion.sourceRefs).toContain(FAIRVIEW.parcelLayerUrl);
    expect(promotion.createdBy).toBe('interactive-gis-session');
  });

  // The whole point of the guard: the city layer still carries the PRE-SPLIT
  // 75.91 acres and a stale owner. Neither may ride in on the promotion.
  it('changes status only and carries every canonical attribute forward', () => {
    const promotion = identityPromotionFromGisConfirmation({
      existing: EXISTING, evidence: evidence(), source: FAIRVIEW,
    })!;
    expect(promotion.acreage).toBe(51.11);
    expect(promotion.apn).toBe('042-123.00-000');
    expect(promotion.owner).toBe('LANDSOUTH LLC');
    expect(promotion.address).toBe('0 Kingwood Blvd');
    expect(promotion.city).toBe('Fairview');
    expect(promotion.county).toBe('Williamson');
    expect(promotion.state).toBe('TN');
    expect(promotion.zip).toBe('37062');
    expect(promotion.propertyCardId).toBe(79);
    expect(promotion.geometry).toBeNull();
    expect(promotion.basis).toMatch(/identity only/i);
  });

  it('requires owner corroboration, not merely a matching parcel key', () => {
    const keyOnly = identityPromotionFromGisConfirmation({
      existing: EXISTING,
      evidence: evidence({ basis: 'parcel_identifier', observedOwner: null }),
      source: FAIRVIEW,
    });
    expect(keyOnly).toBeNull();
  });

  it('refuses when the GIS session did not confirm the subject at all', () => {
    expect(identityPromotionFromGisConfirmation({
      existing: EXISTING,
      evidence: evidence({ confirmed: false, basis: 'unconfirmed' }),
      source: FAIRVIEW,
    })).toBeNull();
  });

  it('never revises an accepted identity, and never resurrects a rejected one', () => {
    for (const status of ['confirmed', 'disputed', 'rejected', 'unresolved', 'archived'] as const) {
      expect(identityPromotionFromGisConfirmation({
        existing: { ...EXISTING, status }, evidence: evidence(), source: FAIRVIEW,
      })).toBeNull();
    }
  });

  it('never asks for operator supersession authority', () => {
    const promotion = identityPromotionFromGisConfirmation({
      existing: EXISTING, evidence: evidence(), source: FAIRVIEW,
    })!;
    expect(promotion.allowAcceptedSupersession).toBe(false);
  });
});
