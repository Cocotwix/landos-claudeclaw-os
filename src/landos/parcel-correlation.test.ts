// Stage 2 closeout — a derived read is current only for a PROVEN parcel.
//
// The first attempt at this compared identity-version row ids. That was wrong:
// a version bumps for a candidate→confirmed promotion and for APN punctuation
// normalization, neither of which moves the subject, and on the live data every
// differing stamp was one of those. Gating on it would have hidden 35 correct
// reads.
//
// The predicate under test answers three ways, and only the first is current:
//   equivalent    — proven one parcel
//   different     — proven two parcels
//   uncorrelated  — LandOS cannot prove it either way
//
// `uncorrelated` withholding is the Stage 1 rule: an absent correlation is not
// current. Parcel-specific zoning, subdivision, backstory and record-risk
// conclusions are only current truth when the parcel is proven.

import { describe, expect, it, beforeEach } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { correlateIdentityVersions, readDerivedSnapshotForParcel, writeDerivedSnapshot } from './derived-intelligence-store.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';

const DEAL = 9401;

function seedDeal(fips = '45021'): void {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, 'TY_LAND_BIZ', 'Correlation fixture', 'new')`).run(DEAL);
  db.prepare(`
    INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key, county, state, fips)
    VALUES (?, 'TY_LAND_BIZ', 'unverified_lead', '9 Cedar Fork Rd', 'cedar fork rd', 'Cherokee', 'SC', ?)
  `).run(DEAL, fips);
  db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (?, ?, 'subject')`).run(DEAL, DEAL);
}

function version(input: {
  apn: string | null;
  county?: string | null;
  state?: string | null;
  status?: 'candidate' | 'confirmed';
}): number {
  return createPropertyIdentityVersion({
    allowAcceptedSupersession: true,
    dealCardId: DEAL,
    propertyCardId: DEAL,
    status: input.status ?? 'confirmed',
    address: '9 Cedar Fork Rd',
    city: null,
    county: input.county === undefined ? 'Cherokee' : input.county,
    state: input.state === undefined ? 'SC' : input.state,
    zip: null,
    apn: input.apn,
    owner: null,
    acreage: null,
    basis: `Parcel ${input.apn ?? 'unstated'}.`,
    confidence: 0.9,
    sourceRefs: [],
    changeReason: `subject ${input.apn ?? 'unstated'}`,
    createdBy: 'test',
  }).id;
}

describe('parcel correlation is proven, not assumed', () => {
  beforeEach(() => { _initTestLandosDb(); seedDeal(); });

  it('an APN punctuation variant in the same jurisdiction is the SAME parcel', () => {
    const older = version({ apn: '00083-A-03400' });
    version({ apn: '00083A03400' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('equivalent');
  });

  it('candidate promoted to confirmed on the same parcel is the SAME parcel', () => {
    const candidate = version({ apn: '0451-00-021', status: 'candidate' });
    version({ apn: '0451-00-021', status: 'confirmed' });
    expect(correlateIdentityVersions(candidate, DEAL)).toBe('equivalent');
  });

  it('a genuinely different APN is a DIFFERENT parcel', () => {
    const older = version({ apn: '0451-00-021' });
    version({ apn: '0912-77-884' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('different');
  });

  it('the same APN in a conflicting state is a DIFFERENT parcel', () => {
    // Each version records its own state; the shared card's FIPS must not
    // override what the versions themselves say.
    const older = version({ apn: '0451-00-021', state: 'NC', county: 'Cherokee' });
    version({ apn: '0451-00-021', state: 'SC', county: 'Cherokee' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('different');
  });

  it('the same APN in a conflicting county is a DIFFERENT parcel', () => {
    // No FIPS on the card, so county+state carries the jurisdiction judgement.
    _initTestLandosDb(); seedDeal('');
    const older = version({ apn: '0451-00-021', county: 'Pickens' });
    version({ apn: '0451-00-021', county: 'Cherokee' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('different');
  });

  it('"Cherokee County" and "Cherokee" are one jurisdiction, not two', () => {
    _initTestLandosDb(); seedDeal('');
    const older = version({ apn: '0451-00-021', county: 'Cherokee County' });
    version({ apn: '0451-00-021', county: 'Cherokee' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('equivalent');
  });
});

describe('what LandOS cannot prove is uncorrelated, never current', () => {
  beforeEach(() => { _initTestLandosDb(); seedDeal(); });

  it('a missing correlation stamp is uncorrelated', () => {
    version({ apn: '0451-00-021' });
    expect(correlateIdentityVersions(null, DEAL)).toBe('uncorrelated');
  });

  it('a stamp whose identity row is gone is uncorrelated', () => {
    version({ apn: '0451-00-021' });
    expect(correlateIdentityVersions(999_999, DEAL)).toBe('uncorrelated');
  });

  it('a deal with no accepted identity at all is uncorrelated', () => {
    expect(correlateIdentityVersions(1, DEAL)).toBe('uncorrelated');
  });

  it('a missing APN on the stored side is uncorrelated, not current', () => {
    const older = version({ apn: null });
    version({ apn: '0451-00-021' });
    expect(correlateIdentityVersions(older, DEAL)).toBe('uncorrelated');
  });

  it('a missing APN on the accepted side is uncorrelated, not current', () => {
    const older = version({ apn: '0451-00-021' });
    version({ apn: null });
    expect(correlateIdentityVersions(older, DEAL)).toBe('uncorrelated');
  });

  it('corroborating APNs with unprovable jurisdiction are uncorrelated, not current', () => {
    // No FIPS, and neither version states a county: corroboration alone must
    // not carry it, because the same parcel number exists in many counties.
    _initTestLandosDb(); seedDeal('');
    // Distinct rows carrying corroborating spellings of one identifier, and no
    // jurisdiction on either side.
    const older = version({ apn: '0451-00-021', county: null, state: null });
    version({ apn: '045100021', county: null, state: null });
    expect(correlateIdentityVersions(older, DEAL)).toBe('uncorrelated');
  });

  it('identity-version row equality is never what proves equivalence', () => {
    // Same row id is trivially the same identity — the interesting case is that
    // a DIFFERENT row id on the same parcel is still equivalent, which the
    // punctuation and promotion tests above already pin.
    const only = version({ apn: '0451-00-021' });
    expect(correlateIdentityVersions(only, DEAL)).toBe('equivalent');
  });
});

describe('the snapshot reader carries the correlation and preserves the record', () => {
  beforeEach(() => { _initTestLandosDb(); seedDeal(); });

  it('a different-parcel read is withheld but the row is untouched', () => {
    version({ apn: '0451-00-021' });
    writeDerivedSnapshot({
      dealCardId: DEAL, snapshotType: 'current_zoning_v1',
      payload: { districtCode: 'R-1', marker: 'prior-parcel' },
      completeness: {}, changeReason: 'fixture', actor: 'test',
    });
    version({ apn: '0912-77-884' });

    const read = readDerivedSnapshotForParcel<{ marker: string }>(DEAL, 'current_zoning_v1')!;
    expect(read.correlation).toBe('different');
    // Preserved as history: still present, still status='current' in the table,
    // still carrying its original payload. Nothing was deleted or rewritten.
    expect(read.value).toMatchObject({ marker: 'prior-parcel' });
    const row = getLandosDb().prepare(
      `SELECT status, summary_json FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND snapshot_type='current_zoning_v1'`,
    ).get(DEAL) as { status: string; summary_json: string };
    expect(row.status).toBe('current');
    expect(JSON.parse(row.summary_json)).toMatchObject({ marker: 'prior-parcel' });
  });

  it('a same-parcel read stays equivalent across a promotion', () => {
    version({ apn: '00083-A-03400', status: 'candidate' });
    writeDerivedSnapshot({
      dealCardId: DEAL, snapshotType: 'current_zoning_v1',
      payload: { districtCode: 'AG', marker: 'same-parcel' },
      completeness: {}, changeReason: 'fixture', actor: 'test',
    });
    version({ apn: '00083A03400', status: 'confirmed' });

    const read = readDerivedSnapshotForParcel<{ marker: string }>(DEAL, 'current_zoning_v1')!;
    expect(read.correlation).toBe('equivalent');
    expect(read.value).toMatchObject({ marker: 'same-parcel' });
  });
});
