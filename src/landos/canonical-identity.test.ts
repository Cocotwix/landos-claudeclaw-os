// Canonical identity propagation — one accepted identity, one precedence.
//
// The defect: confirming a parcel wrote the legacy verdict but did not always
// build the versioned Property Summary. The Deal Card then showed a confirmed
// parcel at confidence 1.00 in one panel while another panel said the parcel was
// not verified and the pipeline was locked. Deal 32 (Roane County, TN) is the
// acceptance case; eleven cards were affected.

import { describe, it, expect, beforeEach } from 'vitest';

import { resolveCanonicalIdentity, isCanonicalIdentityConfirmed, supersessionLabel, dealCardsAwaitingCanonicalReconciliation } from './canonical-identity.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { getDealCardReportSummary } from './deal-card-report.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';

/** Recreate the exact stored shape of Deal 32: a confirmed legacy verdict and a
 *  verified property card, with NO versioned Property Summary ever built. */
function seedDeal32(): number {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (32, 'TY_LAND_BIZ', 'Smart Intake screenshot acceptance', 'new')`).run();
  db.prepare(`
    INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key,
      apn, county, state, city, owner, acres, verification_source, lat, lng)
    VALUES (32, 'TY_LAND_BIZ', 'verified_property', 'OLD RIDGE RD', 'old ridge rd',
      '073090 04200', 'Roane', 'TN', 'KINGSTON', 'SACHAN DILEEP S', 12.28,
      'Tennessee Comptroller public parcel layer', 35.80044080703417, -84.46381750244866)
  `).run();
  db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (32, 32, 'subject')`).run();
  writeParcelIdentity(32, {
    subjectCardId: 32, state: 'confirmed', confidence: 1,
    basis: 'Parcel identity verified by Tennessee Comptroller public parcel layer.',
    evidenceRefs: ['Tennessee Comptroller public parcel layer'],
    confirmedBy: 'acquire',
  });
  return 32;
}

describe('canonical confirmation supersedes stale unresolved presentation', () => {
  beforeEach(() => _initTestLandosDb());

  it('Deal 32: an accepted verdict with no versioned slice still reads as CONFIRMED', () => {
    seedDeal32();
    const canonical = resolveCanonicalIdentity(32);
    expect(canonical.confirmed).toBe(true);
    expect(canonical.status).toBe('confirmed');
    expect(canonical.source).toBe('legacy_verdict_projection');
    expect(canonical.versionPending).toBe(true);
  });

  it('Deal 32: the projection carries the accepted parcel facts, not placeholders', () => {
    seedDeal32();
    expect(resolveCanonicalIdentity(32)).toMatchObject({
      apn: '073090 04200', owner: 'SACHAN DILEEP S', county: 'Roane', state: 'TN',
      city: 'KINGSTON', address: 'OLD RIDGE RD', acreage: 12.28, confidence: 1,
    });
  });

  it('a confirmed Deal Card never displays its current identity as unverified', () => {
    seedDeal32();
    // No report has ever been run for this card — the old read model answered
    // "parcelVerified: false", which the Deal Card rendered as "Needs Verification".
    expect(getDealCardReportSummary(32).exists).toBe(false);
    expect(getDealCardReportSummary(32).parcelVerified).toBe(true);
  });

  it('a stale report snapshot cannot keep presenting a confirmed card as unverified', () => {
    seedDeal32();
    // A report run BEFORE the confirmation, persisted with parcel_verified = 0.
    getLandosDb().prepare(`
      INSERT INTO landos_deal_card_report (deal_card_id, report_status, parcel_verification_status, parcel_verified, report_json)
      VALUES (32, 'complete_with_gaps', 'Parcel not verified', 0, '{}')
    `).run();
    const summary = getDealCardReportSummary(32);
    expect(summary.exists).toBe(true);
    expect(summary.parcelVerified).toBe(true);
  });

  it('a confirmed card with NO report ever run is not headlined "Needs Verification"', async () => {
    seedDeal32();
    const { getDealCardReport } = await import('./deal-card-report.js');
    const { buildExecutiveSummary } = await import('./deal-card-executive-summary.js');
    const report = getDealCardReport(32);
    // Live finding: the Executive Summary headlined a confirmed parcel
    // "Needs Verification — resolve the parcel to begin" purely because no
    // report row existed for the card.
    expect(report.exists).toBe(false);
    expect(report.parcelVerified).toBe(true);
    const es = buildExecutiveSummary(report);
    expect(es.headline).not.toMatch(/Needs Verification/i);
    expect(es.whatItIs).not.toMatch(/not yet verified/i);
  });

  it('the built versioned slice takes precedence once it exists', () => {
    seedDeal32();
    createPropertyIdentityVersion({
      dealCardId: 32, propertyCardId: 32, status: 'confirmed',
      address: 'OLD RIDGE RD', city: 'KINGSTON', county: 'Roane', state: 'TN', zip: '37763',
      apn: '073090 04200', owner: 'SACHAN DILEEP S', acreage: 12.28,
      basis: 'Tennessee Comptroller public parcel layer.', confidence: 1,
      sourceRefs: ['Tennessee Comptroller public parcel layer'],
      changeReason: 'test', createdBy: 'test',
    });
    const canonical = resolveCanonicalIdentity(32);
    expect(canonical.source).toBe('identity_version');
    expect(canonical.versionPending).toBe(false);
    expect(canonical.confirmed).toBe(true);
  });

  it('a stale UNRESOLVED version never overrides an accepted confirmation', () => {
    seedDeal32();
    createPropertyIdentityVersion({
      dealCardId: 32, propertyCardId: 32, status: 'unresolved',
      basis: 'Earlier attempt could not resolve the parcel.', confidence: 0,
      sourceRefs: [], changeReason: 'stale attempt', createdBy: 'test',
    });
    const canonical = resolveCanonicalIdentity(32);
    expect(canonical.confirmed).toBe(true);
    expect(canonical.source).toBe('legacy_verdict_projection');
  });

  it('an unconfirmed card is still honestly unresolved — nothing is invented', () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (10, 'TY_LAND_BIZ', 'Unresolved control', 'new')`).run();
    writeParcelIdentity(10, { subjectCardId: null, state: 'unresolved', confidence: 0, basis: 'No parcel-level source resolved this address.' });
    const canonical = resolveCanonicalIdentity(10);
    expect(canonical.confirmed).toBe(false);
    expect(canonical.status).toBe('unresolved');
    expect(canonical.apn).toBeNull();
    expect(canonical.owner).toBeNull();
    expect(isCanonicalIdentityConfirmed(10)).toBe(false);
    expect(getDealCardReportSummary(10).parcelVerified).toBe(false);
  });

  it('historical unresolved attempts remain visible but are labeled superseded', () => {
    seedDeal32();
    const canonical = resolveCanonicalIdentity(32);
    const stale = supersessionLabel({ canonical, attemptStatus: 'unresolved' });
    expect(stale.superseded).toBe(true);
    expect(stale.label).toMatch(/Superseded/);
    expect(stale.label).toMatch(/retained for provenance/i);
    // The accepted attempt itself is not labeled superseded.
    expect(supersessionLabel({ canonical, attemptStatus: 'confirmed' }).superseded).toBe(false);
  });

  it('nothing is labeled superseded while identity is still unresolved', () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (11, 'TY_LAND_BIZ', 'Pending', 'new')`).run();
    const canonical = resolveCanonicalIdentity(11);
    expect(supersessionLabel({ canonical, attemptStatus: 'unresolved' }).superseded).toBe(false);
  });

  it('reports which cards still owe a versioned Property Summary', () => {
    seedDeal32();
    expect(dealCardsAwaitingCanonicalReconciliation()).toEqual([32]);
  });

  it('resolving a canonical identity performs no writes (a Deal Card GET stays read-only)', () => {
    seedDeal32();
    const db = getLandosDb();
    const before = {
      versions: (db.prepare('SELECT COUNT(*) AS c FROM landos_property_identity_version').get() as { c: number }).c,
      audit: (db.prepare('SELECT COUNT(*) AS c FROM landos_audit_log').get() as { c: number }).c,
    };
    resolveCanonicalIdentity(32);
    isCanonicalIdentityConfirmed(32);
    getDealCardReportSummary(32);
    const after = {
      versions: (db.prepare('SELECT COUNT(*) AS c FROM landos_property_identity_version').get() as { c: number }).c,
      audit: (db.prepare('SELECT COUNT(*) AS c FROM landos_audit_log').get() as { c: number }).c,
    };
    expect(after).toEqual(before);
  });
});

describe('reconciliation builds the versioned Property Summary at confirmation time', () => {
  beforeEach(() => _initTestLandosDb());

  it('builds the missing version and is idempotent afterwards', async () => {
    seedDeal32();
    const { reconcileCanonicalIdentity } = await import('./property-summary-legacy-adapter.js');
    const first = reconcileCanonicalIdentity({ dealCardId: 32, actor: 'test', changeReason: 'confirmation' });
    expect(first.reconciled).toBe(true);
    expect(resolveCanonicalIdentity(32).versionPending).toBe(false);

    const second = reconcileCanonicalIdentity({ dealCardId: 32, actor: 'test', changeReason: 'confirmation' });
    expect(second.reconciled).toBe(false);
    expect(second.reason).toMatch(/already agrees/i);
  });

  it('does nothing for a card whose identity has not been accepted', async () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (10, 'TY_LAND_BIZ', 'Unresolved', 'new')`).run();
    const { reconcileCanonicalIdentity } = await import('./property-summary-legacy-adapter.js');
    const result = reconcileCanonicalIdentity({ dealCardId: 10, actor: 'test', changeReason: 'startup' });
    expect(result.reconciled).toBe(false);
    expect(result.reason).toMatch(/No accepted canonical identity/i);
  });

  it('startup recovery reconciles every card that owes one', async () => {
    seedDeal32();
    const { reconcileAllPendingCanonicalIdentities } = await import('./property-summary-legacy-adapter.js');
    const swept = reconcileAllPendingCanonicalIdentities('test-recovery');
    expect(swept.inspected).toBe(1);
    expect(swept.reconciled).toBe(1);
    expect(dealCardsAwaitingCanonicalReconciliation()).toEqual([]);
  });
});
