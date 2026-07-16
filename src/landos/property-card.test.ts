import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  upsertPropertyCard,
  upsertCardFromDukeRun,
  getPropertyCard,
  listPropertyCards,
  setCardKanbanStatus,
  setCardVerificationStatus,
  attachCardSourceEvidence,
  attachCardActivity,
  addCardNextAction,
  attachNearbySearchReference,
  hasStrongParcelIdentity,
  createLeadJobs,
  listLeadJobs,
  updateLeadJob,
  splitLeadLines,
  normalizeAddressKey,
} from './property-card.js';
import { NEARBY_REFERENCE_LABEL } from './db.js';

beforeEach(() => {
  _initTestLandosDb();
});

describe('Property Card identity rules', () => {
  it('creates an unverified_lead card for an address-only lead', () => {
    const { card, created } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '83 Bub Wise Rd, Swansea SC',
      city: 'Swansea',
      state: 'SC',
      county: 'Lexington',
    });
    expect(created).toBe(true);
    expect(card.verification_status).toBe('unverified_lead');
    expect(card.kanban_status).toBe('needs_parcel_verification');
  });

  it('creates a verified_property card when APN + county verifies', () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '123 Rural Rd, Lexington SC',
      apn: '00123-45-678',
      county: 'Lexington',
      state: 'SC',
      verified: true,
      verificationSource: 'county assessor record (APN + county)',
    });
    expect(card.verification_status).toBe('verified_property');
    expect(card.kanban_status).toBe('researching');
  });

  it('refuses a verified card with a proximity/coordinate source', () => {
    expect(() =>
      upsertPropertyCard({
        entity: 'TY_LAND_BIZ',
        activeInputAddress: 'somewhere',
        verified: true,
        verificationSource: 'nearest parcel by map pin coordinates',
      }),
    ).toThrow(/proximity|coordinate/i);
  });

  it('does not merge distinct addresses; updates the same address', () => {
    const a = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '1 A St, Town SC' });
    const b = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '2 B St, Town SC' });
    expect(a.card.id).not.toBe(b.card.id);
    const again = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '1 A St, Town SC' });
    expect(again.created).toBe(false);
    expect(again.card.id).toBe(a.card.id);
  });

  it('corrected address preserves prior input and becomes active', () => {
    const first = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '83 Bub Wise Rd, Swansea SC' });
    const corrected = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '183 Bob Wise Rd, Swansea SC',
      cardId: first.card.id,
      priorInputAddress: '83 Bub Wise Rd, Swansea SC',
    });
    expect(corrected.card.id).toBe(first.card.id);
    expect(corrected.card.active_input_address).toBe('183 Bob Wise Rd, Swansea SC');
    const detail = getPropertyCard(first.card.id)!;
    expect(detail.priorInputs).toContain('83 Bub Wise Rd, Swansea SC');
  });

  it('never downgrades a verified card back to unverified', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '9 Real Rd, X SC',
      verified: true, verificationSource: 'lp_property_data (propertyid + fips)',
      lpPropertyId: 'LP1', fips: '45063',
    });
    const later = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '9 Real Rd, X SC',
      lpPropertyId: 'LP1', fips: '45063', verified: false,
    });
    expect(later.card.verification_status).toBe('verified_property');
  });

  it('normalizeAddressKey collapses case and punctuation', () => {
    expect(normalizeAddressKey('83 Bub Wise Rd., Swansea SC')).toBe('83 bub wise rd swansea sc');
  });
});

describe('Strong identity enforcement', () => {
  it('hasStrongParcelIdentity requires a real parcel key', () => {
    expect(hasStrongParcelIdentity({ apn: '123', county: 'Lex' })).toBe(true);
    expect(hasStrongParcelIdentity({ apn: '123', fips: '45063' })).toBe(true);
    expect(hasStrongParcelIdentity({ lpPropertyId: 'LP1', fips: '45063' })).toBe(true);
    expect(hasStrongParcelIdentity({ apn: '123' })).toBe(false); // no county/state/fips
    expect(hasStrongParcelIdentity({ lpPropertyId: 'LP1' })).toBe(false); // no fips
    expect(hasStrongParcelIdentity({})).toBe(false);
  });

  it('address-only + verified:true + generic source does NOT verify (downgrades to address_matched)', () => {
    const { card, warnings } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '10 Weak Rd, Town SC',
      verified: true, verificationSource: 'I looked it up',
    });
    expect(card.verification_status).toBe('address_matched');
    expect(card.verification_source).toBe(''); // no bogus source persisted
    expect(warnings.join(' ')).toMatch(/strong parcel identity/i);
  });

  it('a source URL alone does NOT create verified_property', () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '11 Url Rd, Town SC',
      verified: true, verificationSource: 'https://www.zillow.com/homedetails/x',
    });
    expect(card.verification_status).not.toBe('verified_property');
  });

  it('Zillow/Redfin/CountyOffice alone do NOT verify', () => {
    for (const src of ['https://www.zillow.com/x', 'https://www.redfin.com/x', 'https://www.countyoffice.org/x']) {
      const { card } = upsertPropertyCard({
        entity: 'TY_LAND_BIZ', activeInputAddress: `lead ${src}`,
        verified: true, verificationSource: src,
      });
      expect(card.verification_status).not.toBe('verified_property');
    }
  });

  it('coordinate/proximity/map-pin/nearest-parcel sources are refused outright', () => {
    for (const src of ['lat/lon 34.1,-81.2', 'geocoder result', 'map pin drop', 'nearest parcel', 'road midpoint', 'ZIP centroid']) {
      expect(() => upsertPropertyCard({
        entity: 'TY_LAND_BIZ', activeInputAddress: 'x', verified: true, verificationSource: src,
      })).toThrow(/proximity|coordinate/i);
    }
  });

  it('APN + county and APN + FIPS create verified_property', () => {
    expect(upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '12 Apn Rd, Lex SC',
      apn: '00123', county: 'Lexington', verified: true, verificationSource: 'county assessor record (APN + county)',
    }).card.verification_status).toBe('verified_property');
    expect(upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '13 Apn Rd, Lex SC',
      apn: '00124', fips: '45063', verified: true, verificationSource: 'official assessor parcel record (APN + FIPS)',
    }).card.verification_status).toBe('verified_property');
  });

  it('LandPortal property id + FIPS creates verified_property', () => {
    expect(upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '14 Lp Rd, Lex SC',
      lpPropertyId: 'LP42', fips: '45063', verified: true, verificationSource: 'lp_resolve_property verified:true',
    }).card.verification_status).toBe('verified_property');
  });

  it('verified cards are found by strong identity key, not loose address-only matching', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '15 Strong Rd, Lex SC',
      apn: 'AAA', county: 'Lexington', verified: true, verificationSource: 'county assessor record',
    });
    // A later address-only run at a DIFFERENT address must not latch onto the
    // verified card; and a same-APN run finds it by strong key.
    const sameApn = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'totally different text',
      apn: 'AAA', county: 'Lexington', verified: true, verificationSource: 'county GIS parcel record',
    });
    expect(sameApn.card.id).toBe(v.card.id);
    expect(sameApn.created).toBe(false);
  });

  it('stores a LandPortal URL when provided and never invents one when absent', () => {
    const withUrl = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '60 LpUrl Rd, Lexington SC',
      apn: 'LPU1', county: 'Lexington', verified: true, verificationSource: 'county assessor record',
      lpUrl: 'https://landportal.example/property/123',
    });
    expect(withUrl.card.lp_url).toBe('https://landportal.example/property/123');

    const noUrl = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '61 NoUrl Rd, Lexington SC',
      lpPropertyId: 'LP777', fips: '45063', verified: true, verificationSource: 'lp_resolve_property verified:true',
    });
    expect(noUrl.card.lp_url).toBe(''); // never fabricated
    expect(noUrl.card.lp_property_id).toBe('LP777');
    expect(noUrl.card.fips).toBe('45063');
  });

  it('address-only creates address_matched (not verified) when a match is asserted', () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '16 Match Rd, Town SC', addressMatched: true,
    });
    expect(card.verification_status).toBe('address_matched');
  });

  it('weak/address-only input does NOT merge into a verified card by address_key', () => {
    const verified = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '50 Verified Rd, Lexington SC',
      apn: 'V50', county: 'Lexington', verified: true, verificationSource: 'county assessor record (APN + county)',
    }).card;
    expect(verified.verification_status).toBe('verified_property');

    // Same normalized address, but NO apn/property id/fips (weak follow-up).
    const weak = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '50 Verified Rd, Lexington SC',
      summary: 'address-only follow-up / timeout',
    });
    // It must create a SEPARATE unverified card, not touch the verified one.
    expect(weak.card.id).not.toBe(verified.id);
    expect(weak.card.verification_status).toBe('unverified_lead');

    // The verified card is unchanged.
    const stillVerified = getPropertyCard(verified.id)!;
    expect(stillVerified.verification_status).toBe('verified_property');
    expect(stillVerified.active_input_address).toBe('50 Verified Rd, Lexington SC');
    expect(stillVerified.apn).toBe('V50');
  });

  it('a verified card is only updated by its strong identity key on a later run', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '51 Strong Only Rd, Lexington SC',
      apn: 'S51', county: 'Lexington', verified: true, verificationSource: 'county assessor record',
    }).card;
    // A later run carrying the strong key updates the same verified card.
    const again = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '51 Strong Only Rd, Lexington SC',
      apn: 'S51', county: 'Lexington', verified: true, verificationSource: 'county GIS parcel record',
      summary: 'refreshed',
    });
    expect(again.created).toBe(false);
    expect(again.card.id).toBe(v.id);
    expect(again.card.verification_status).toBe('verified_property');
  });
});

describe('Verification status workflow guard', () => {
  it('only allows rejected_mismatch/archived with a reason; never direct verify', () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '17 Wf Rd, Town SC' });
    expect(setCardVerificationStatus(card.id, 'verified_property', 'tyler', 'because').error).toBeTruthy();
    expect(setCardVerificationStatus(card.id, 'rejected_mismatch', 'tyler', '').error).toMatch(/reason/i);
    const rejected = setCardVerificationStatus(card.id, 'rejected_mismatch', 'tyler', 'situs on different road');
    expect(rejected.card?.verification_status).toBe('rejected_mismatch');
  });

  it('reject/archive preserves identity evidence', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '18 Keep Rd, Lex SC',
      apn: 'KEEP1', county: 'Lexington', verified: true, verificationSource: 'county assessor record',
    });
    const archived = setCardVerificationStatus(v.card.id, 'archived', 'tyler', 'inactive');
    expect(archived.card?.verification_status).toBe('archived');
    expect(archived.card?.apn).toBe('KEEP1');
    expect(archived.card?.verification_source).toContain('assessor');
  });
});

describe('Nearby search reference', () => {
  function verifiedCard() {
    return upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'APN-only vacant parcel, Lexington SC',
      apn: 'VAC1', county: 'Lexington', fips: '45063', verified: true,
      verificationSource: 'official assessor parcel record (APN + FIPS)',
    }).card;
  }

  it('cannot be saved on an unverified_lead or address_matched card', () => {
    const lead = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '20 Lead Rd, Town SC' }).card;
    const res = attachNearbySearchReference({ cardId: lead.id, address: '22 Neighbor Rd' });
    expect(res.error).toMatch(/verified_property/i);
    expect(res.label).toBe(NEARBY_REFERENCE_LABEL);
  });

  it('attaches to a verified parcel, marked non-identity and non-offer-usable', () => {
    const card = verifiedCard();
    const res = attachNearbySearchReference({
      cardId: card.id, address: '24 Adjoining Rd', relationship: 'adjoining_addressed_property',
      sourceLink: 'https://gis.county.gov/x', note: 'butting parcel with a street address',
    });
    expect(res.error).toBeUndefined();
    expect(res.label).toBe(NEARBY_REFERENCE_LABEL);
    const detail = getPropertyCard(card.id)!;
    expect(detail.nearbyReferences.length).toBe(1);
    const ref: any = detail.nearbyReferences[0];
    expect(ref.usable_for_identity).toBe(0);
    expect(ref.usable_for_offer_logic).toBe(0);
    expect(ref.relationship).toBe('adjoining_addressed_property');
    expect(detail.nearbyReferenceLabel).toBe(NEARBY_REFERENCE_LABEL);
  });

  it('never becomes the active_input_address', () => {
    const card = verifiedCard();
    attachNearbySearchReference({ cardId: card.id, address: '99 Helper Rd' });
    const detail = getPropertyCard(card.id)!;
    expect(detail.active_input_address).not.toBe('99 Helper Rd');
    expect(detail.active_input_address).toContain('vacant parcel');
  });
});

describe('Property Card memory attachments', () => {
  it('attaches source evidence with offer-usability gating', () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '5 Mem Rd, Y SC' });
    const noLink = attachCardSourceEvidence({ cardId: card.id, fact: 'acreage', parcelVerified: false });
    expect(noLink.usableForOfferLogic).toBe(false);
    const official = attachCardSourceEvidence({
      cardId: card.id, fact: 'zoning', sourceUrl: 'https://planning.county.gov/ord', parcelVerified: true,
    });
    expect(official.usableForOfferLogic).toBe(true);
    const detail = getPropertyCard(card.id)!;
    expect(detail.sourceEvidence.length).toBe(2);
  });

  it('attaches activity and next actions visible on the card', () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '7 Act Rd, Z SC' });
    attachCardActivity({ cardId: card.id, agentId: 'duke-due-diligence', kind: 'note', summary: 'inspected' });
    addCardNextAction({ cardId: card.id, action: 'Call county assessor' });
    const detail = getPropertyCard(card.id)!;
    expect(detail.activity.length).toBe(1);
    expect(detail.nextActions.length).toBe(1);
  });

  it('lists property cards by kanban status', () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '8 Board Rd, Q SC' });
    setCardKanbanStatus(card.id, 'underwriting');
    expect(listPropertyCards({ entity: 'TY_LAND_BIZ', kanbanStatus: 'underwriting' }).length).toBe(1);
    expect(listPropertyCards({ entity: 'TY_LAND_BIZ', kanbanStatus: 'closed' }).length).toBe(0);
  });
});

describe('Duke run -> property card writeback', () => {
  it('creates an unverified lead card and a verify next-action', () => {
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      agentId: 'duke-due-diligence',
      activeInputAddress: '83 Bub Wise Rd, Swansea SC',
      county: 'Lexington', state: 'SC',
      verified: false,
      summary: 'LandPortal zero candidates; not verified',
    });
    expect(card.verification_status).toBe('unverified_lead');
    const detail = getPropertyCard(card.id)!;
    expect(detail.activity.some((a: any) => a.kind === 'duke_unverified_run')).toBe(true);
    expect(detail.nextActions.some((n: any) => /verify parcel/i.test(n.action))).toBe(true);
  });

  it('creates a verified property card when identity verifies', () => {
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '123 Rural Rd, Lexington SC',
      lpPropertyId: 'LP9', fips: '45063',
      verified: true, verificationSource: 'lp_resolve_property address filter, verified:true',
      summary: 'Verified; Land Score 72/100',
    });
    expect(card.verification_status).toBe('verified_property');
  });
});

describe('Batch lead intake', () => {
  it('splits leads and creates one isolated job per lead', () => {
    expect(splitLeadLines('a\n\n# comment\nb\n c ')).toEqual(['a', 'b', 'c']);
    const { batchId, jobs } = createLeadJobs({
      entity: 'TY_LAND_BIZ',
      text: '83 Bub Wise Rd, Swansea SC\n221 Main St, Lexington SC\n14 Oak Dr, Gilbert SC',
    });
    expect(jobs.length).toBe(3);
    expect(jobs.every((j) => j.status === 'queued')).toBe(true);
    expect(jobs.every((j) => j.batch_id === batchId)).toBe(true);
    // Jobs carry only their own raw input — no shared parcel state.
    expect(new Set(jobs.map((j) => j.raw_input)).size).toBe(3);
    expect(listLeadJobs({ batchId }).length).toBe(3);
  });

  it('updates a job status without touching siblings', () => {
    const { jobs } = createLeadJobs({ entity: 'TY_LAND_BIZ', text: 'lead one\nlead two' });
    updateLeadJob(jobs[0].id, { status: 'parcel_not_verified', nextAction: 'need APN + county' });
    expect(listLeadJobs({ status: 'parcel_not_verified' }).length).toBe(1);
    expect(listLeadJobs({ status: 'queued' }).length).toBe(1);
  });
});

// Regression: intake-dedupe-overwrites-accepted-identity (QA finding W2-F2).
// An IMPLICIT strong-key match on an already-verified card must never rewrite
// its accepted identity records; only an explicit cardId target may.
describe('accepted-identity preservation on verified cards', () => {
  it('implicit re-intake with the same APN preserves owner, county, provenance, and address', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '200 Sid Edens Rd, Pickens SC',
      apn: '5105-00-44-0497', county: 'Pickens County', state: 'SC', owner: 'ELROD MELINDA KAY',
      verified: true, verificationSource: 'LandPortal Map Search parcel panel (browser read-only)',
    });
    const rerun = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '222 McDaniel Ave, Pickens SC',
      apn: '5105-00-44-0497', county: 'Pickens', state: 'SC', owner: 'ELROD MELINDA K',
      verified: true, verificationSource: 'South Carolina statewide parcel layer (SCDOT GIS mirror)',
    });
    expect(rerun.created).toBe(false);
    expect(rerun.card.id).toBe(v.card.id);
    expect(rerun.card.owner).toBe('ELROD MELINDA KAY');
    expect(rerun.card.county).toBe('Pickens County');
    expect(rerun.card.verification_source).toContain('LandPortal');
    expect(rerun.card.active_input_address).toBe('200 Sid Edens Rd, Pickens SC');
    expect(rerun.warnings.some((w) => /accepted identity records preserved/i.test(w))).toBe(true);
  });

  it('an explicit cardId target (operator-confirmed correction) still updates', () => {
    const v = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '200 Sid Edens Rd, Pickens SC',
      apn: '5105-00-44-0497', county: 'Pickens County', state: 'SC', owner: 'ELROD MELINDA KAY',
      verified: true, verificationSource: 'LandPortal Map Search parcel panel (browser read-only)',
    });
    const explicit = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '200 Sid Edens Rd, Pickens SC', cardId: v.card.id,
      apn: '5105-00-44-0497', county: 'Pickens County', state: 'SC', owner: 'ELROD MELINDA KAY TRUST',
      verified: true, verificationSource: 'county assessor record (APN + county)',
    });
    expect(explicit.card.id).toBe(v.card.id);
    expect(explicit.card.owner).toBe('ELROD MELINDA KAY TRUST');
  });
});
