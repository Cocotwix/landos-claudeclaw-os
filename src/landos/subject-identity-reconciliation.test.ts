// Subject identity reconciliation — intake is evidence, not truth.
//
// Acceptance case: deal 83 / 9490 Elk Lake Rd, Williamsburg MI. The feed
// supplied the Indiana ZIP 46960 for a Michigan property. That one wrong field
// left the property card with no city, county, state, ZIP, APN or acreage, and
// twelve consecutive operator reruns reproduced the identical nothing because
// nothing ever wrote a resolved identity back.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { getPropertyCardRow } from './property-card.js';
import { createPropertyIdentityVersion, readCurrentPropertyIdentity } from './property-summary-slice.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import type { CensusGeography } from './land-use-authority.js';

const PARCEL_URL =
  'https://landportal.com/?property=Zmlwcz0yNjA1NSZhcG49MTMtMTE2LTAxNS0wMSZwcm9wZXJ0eWlkPTE1ODA3MjU4NA%3D%3D';

const ELK_LAKE_CENSUS: CensusGeography = {
  matchedAddress: '9490 ELK LAKE RD, WILLIAMSBURG, MI, 49690',
  state: 'Michigan',
  county: 'Grand Traverse County',
  countySubdivision: 'Whitewater township',
  incorporatedPlace: null,
  latitude: 44.7554,
  longitude: -85.3421,
  sourceUrl: 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=test',
};

/** Deal 83 exactly as it was stored: an EMPTY card beside verified LandPortal
 *  parcel evidence that nothing had ever promoted into the card. */
function seedDeal83(parcelFacts?: Record<string, string>, parcelUrl: string | null = PARCEL_URL): void {
  const db = getLandosDb();
  db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status, seller_notes)
    VALUES (83, 'TY_LAND_BIZ', '9490 Elk Lake Rd', 'new', '9490 elk lake rd, Williamsburg 46960')`).run();
  db.prepare(`
    INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key,
      apn, county, state, city, zip, owner, acres, fips, lp_property_id, summary)
    VALUES (73, 'TY_LAND_BIZ', 'unverified_lead', '9490 Elk Lake Rd', '9490 elk lake rd',
      '', '', '', '', '', '', NULL, '', '', '9490 elk lake rd, Williamsburg 46960')
  `).run();
  db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (83, 73, 'subject')`).run();
  db.prepare(`INSERT INTO landos_card_activity (card_id, agent_id, kind, summary, ref, created_at)
    VALUES (73, 'landportal', 'property_inspection', 'LandPortal parcel panel', ?, 1786078128)`)
    .run(JSON.stringify({
      parcelUrl,
      parcelFacts: parcelFacts ?? {
        'Owner Name': 'WELLS MICHAEL C',
        'Parcel ID': '13-116-015-01',
        'Parcel Address': '9490 ELK LAKE RD',
        Acres: '60.000',
        'Calc Acres': '59.67',
        'Building SqFt': '1701',
        'Land Locked': 'Yes',
      },
      assets: [], overlays: [], visualObservations: [], comparables: [],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    }));
}

describe('reconcileSubjectIdentity — the 9490 Elk Lake Rd recovery', () => {
  beforeEach(() => _initTestLandosDb());

  it('resolves the canonical subject the empty card never carried', async () => {
    seedDeal83();
    const result = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });

    expect(result.status).toBe('candidate');
    expect(result.conflicts).toEqual([]);
    expect(result.persisted).toBe(true);

    const byField = Object.fromEntries(result.fields.map((field) => [field.field, field.to]));
    expect(byField.county).toBe('Grand Traverse');
    expect(byField.state).toBe('MI');
    expect(byField.zip).toBe('49690');
    expect(byField.city).toBe('Williamsburg');
    expect(byField.apn).toBe('13-116-015-01');
    expect(byField.fips).toBe('26055');
    expect(byField.lpPropertyId).toBe('158072584');
    expect(byField.owner).toBe('WELLS MICHAEL C');
    expect(byField.acreage).toBe('60');
  });

  it('supersedes the wrong intake ZIP and preserves the raw feed value', async () => {
    seedDeal83();
    const result = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });

    // The feed's ZIP is retained as raw intake, not quietly erased.
    expect(result.rawIntake.zip).toBe('46960');
    expect(result.rawIntake.address).toBe('9490 Elk Lake Rd');

    const zipChange = result.changes.find((change) => change.field === 'zip');
    expect(zipChange).toBeDefined();
    expect(zipChange?.from).toBe('46960');
    expect(zipChange?.to).toBe('49690');
    expect(zipChange?.superseded).toBe(true);
    expect(zipChange?.reason).toContain('46960');

    // The corrected ZIP is the only superseded field: nothing else had a value
    // to replace, so reconciliation filled rather than overwrote.
    expect(result.changes.map((change) => change.field)).toEqual(['zip']);

    const card = getPropertyCardRow(73);
    expect(card?.zip).toBe('49690');
    expect(JSON.parse(card?.prior_inputs ?? '[]').join(' ')).toContain('46960');
  });

  it('writes the identity onto the card every research lane reads from', async () => {
    seedDeal83();
    await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });

    const card = getPropertyCardRow(73);
    expect(card?.county).toBe('Grand Traverse');
    expect(card?.state).toBe('MI');
    expect(card?.apn).toBe('13-116-015-01');
    expect(card?.fips).toBe('26055');
    expect(card?.owner).toBe('WELLS MICHAEL C');
    expect(card?.acres).toBe(60);
    // Reconciliation is not official verification and must never claim it.
    expect(card?.verification_status).not.toBe('verified_property');
  });

  it('versions the identity with provenance and keeps the prior version as history', async () => {
    seedDeal83();
    const result = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS, actor: 'operator-rerun' });

    const current = readCurrentPropertyIdentity(83);
    expect(current?.status).toBe('candidate');
    expect(current?.county).toBe('Grand Traverse');
    expect(current?.apn).toBe('13-116-015-01');
    expect(current?.createdBy).toBe('operator-rerun');
    expect(current?.changeReason).toContain('46960');
    expect(current?.sourceRefs.some((ref) => ref.includes('landportal.com'))).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);

    const versions = getLandosDb()
      .prepare('SELECT version, is_current FROM landos_property_identity_version WHERE deal_card_id=83 ORDER BY version')
      .all() as Array<{ version: number; is_current: number }>;
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions.filter((row) => row.is_current === 1)).toHaveLength(1);
  });

  it('raises confidence only when two independent sources corroborate the jurisdiction', async () => {
    seedDeal83();
    const corroborated = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS, dryRun: true });
    const county = corroborated.fields.find((field) => field.field === 'county');
    expect(county?.agreedBy).toEqual(['census_geography', 'landportal_canonical_url']);
    expect(corroborated.confidence).toBe(0.9);

    // Without the provider's canonical key there is only the Census claim.
    _initTestLandosDb();
    seedDeal83(undefined, null);
    const single = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS, dryRun: true });
    expect(single.fields.find((field) => field.field === 'county')?.agreedBy).toEqual(['census_geography']);
    expect(single.confidence).toBeLessThan(0.9);
  });

  it('names a jurisdiction conflict instead of picking a winner', async () => {
    seedDeal83();
    const wrongState: CensusGeography = { ...ELK_LAKE_CENSUS, state: 'Indiana', county: 'Fulton County' };
    const result = await reconcileSubjectIdentity(83, { censusGeography: wrongState });

    expect(result.status).toBe('disputed');
    expect(result.conflicts[0]).toContain('Jurisdiction conflict');
    // Neither state is written when two authoritative sources disagree.
    expect(result.fields.find((field) => field.field === 'state')).toBeUndefined();
    expect(getPropertyCardRow(73)?.state).toBe('');
  });

  it('does not resolve a parcel when the provider contradicts itself', async () => {
    seedDeal83({ 'Owner Name': 'WELLS MICHAEL C', 'Parcel ID': '99-999-999-99', Acres: '60.000' });
    const result = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });

    expect(result.status).toBe('disputed');
    expect(result.conflicts.some((note) => note.includes('Parcel identifier conflict'))).toBe(true);
    expect(getPropertyCardRow(73)?.apn).toBe('');
  });

  it('reports honestly when there is no evidence to reconcile from', async () => {
    seedDeal83({}, null);
    const result = await reconcileSubjectIdentity(83, { censusGeography: null });

    expect(result.status).toBe('unresolved');
    expect(result.persisted).toBe(false);
    expect(result.basis).toContain('unresolved');
  });

  it('is idempotent — a second run changes nothing and adds no version', async () => {
    seedDeal83();
    await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });
    const afterFirst = getLandosDb()
      .prepare('SELECT COUNT(*) n FROM landos_property_identity_version WHERE deal_card_id=83').get() as { n: number };

    const second = await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });
    const afterSecond = getLandosDb()
      .prepare('SELECT COUNT(*) n FROM landos_property_identity_version WHERE deal_card_id=83').get() as { n: number };

    expect(second.changes).toEqual([]);
    expect(afterSecond.n).toBe(afterFirst.n);
    expect(getPropertyCardRow(73)?.zip).toBe('49690');
  });

  it('never fabricates a Deal Card or a subject that does not exist', async () => {
    const missing = await reconcileSubjectIdentity(999, { censusGeography: ELK_LAKE_CENSUS });
    expect(missing.skippedReason).toContain('does not exist');
    expect(missing.persisted).toBe(false);
  });
});

// ── A failed lane must not un-resolve what another lane resolved ────────────
//
// Deal 83 lost its reconciled APN seconds after gaining it: a sibling collector
// that could not confirm the parcel ended by recording a blocked Property
// Summary, and because that write landed last it became the current identity.
// Silence is not evidence.

describe('identity demotion', () => {
  beforeEach(() => _initTestLandosDb());

  it('keeps the resolved identity when a later collector reports unresolved', async () => {
    seedDeal83();
    await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });
    expect(readCurrentPropertyIdentity(83)?.apn).toBe('13-116-015-01');

    createPropertyIdentityVersion({
      dealCardId: 83,
      propertyCardId: 73,
      status: 'unresolved',
      address: '9490 Elk Lake Rd',
      county: 'Grand Traverse',
      state: 'MI',
      basis: 'No official parcel record matched this intake.',
      confidence: 0,
      changeReason: 'Recorded a blocked Property Summary because parcel identity remains unresolved.',
      createdBy: 'public-property-intelligence',
    });

    const current = readCurrentPropertyIdentity(83);
    expect(current?.status).toBe('candidate');
    expect(current?.apn).toBe('13-116-015-01');
  });

  it('still allows an unresolved record when nothing was resolved yet', () => {
    seedDeal83();
    createPropertyIdentityVersion({
      dealCardId: 83,
      propertyCardId: 73,
      status: 'unresolved',
      address: '9490 Elk Lake Rd',
      basis: 'Parcel identity has not been confirmed.',
      confidence: 0,
      changeReason: 'Recorded a blocked Property Summary.',
      createdBy: 'public-property-intelligence',
    });
    expect(readCurrentPropertyIdentity(83)?.status).toBe('unresolved');
  });

  it('still allows a collector that carries its own parcel identifier to revise', async () => {
    seedDeal83();
    await reconcileSubjectIdentity(83, { censusGeography: ELK_LAKE_CENSUS });
    createPropertyIdentityVersion({
      dealCardId: 83,
      propertyCardId: 73,
      status: 'unresolved',
      address: '9490 Elk Lake Rd',
      apn: '13-116-015-01',
      basis: 'The county source rejected this parcel identifier.',
      confidence: 0,
      changeReason: 'County record disputes the retained APN.',
      createdBy: 'county-records',
    });
    expect(readCurrentPropertyIdentity(83)?.status).toBe('unresolved');
  });
});
