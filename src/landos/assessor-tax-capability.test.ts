import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASSESSOR_TAX_CAPABILITY,
  ASSESSOR_TAX_CAPABILITY_ID,
  assessorTaxSnapshotFacts,
  type AssessorTaxFacts,
} from './assessor-tax-capability.js';
import type { CapabilityResult } from './capability-contract.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import type { OfficialParcel, OfficialParcelLookupResult } from './public-property-intelligence-live.js';

beforeEach(() => { _initTestLandosDb(); });

const PARCEL: OfficialParcel = {
  provider: 'Williamson County Property Assessor',
  sourceUrl: 'https://williamsoncounty-tn.gov/property/042-123',
  address: '0 Kingwood Blvd, Fairview, TN 37062',
  county: 'Williamson',
  state: 'TN',
  apn: '042 123.00 000',
  owner: 'SMITH FAMILY TRUST',
  acres: 12.4,
  coordinates: { lat: 35.98, lng: -87.12 },
  geometry: { rings: [] as never },
  datasetDate: '2025-01-01',
  facts: {
    mailingAddress: 'PO BOX 41, FAIRVIEW TN 37062',
    landUse: 'Vacant residential land',
    legalDescription: 'LOT 4 KINGWOOD ESTATES',
    landValue: 61_000,
    appraisedValue: 61_000,
    taxableValue: 15_250,
    taxAmount: 412,
    taxYear: '2025',
    taxPaymentStatus: 'PAID IN FULL',
    saleDate: '2019-06-04',
    salePrice: 42_000,
    deedBookPage: '7231/455',
    yearBuilt: null,
    buildingSqft: null,
  },
};

const matched = (parcel: OfficialParcel = PARCEL): OfficialParcelLookupResult => ({
  parcel,
  status: 'matched',
  attempted: [{ source: parcel.provider, status: 'matched', note: 'Exact parcel record matched the requested APN.' }],
});

const noMatch: OfficialParcelLookupResult = {
  parcel: null,
  status: 'no_match',
  attempted: [{ source: 'TN Comptroller statewide parcel layer', status: 'no_match', note: 'The layer answered and held no record for this APN.' }],
};

/** A canonical subject the way Property Resolution leaves it on a Deal Card. */
function canonicalSubject(overrides: { apn?: string | null; verified?: boolean } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Kingwood Blvd' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '0 Kingwood Blvd, Fairview TN',
    apn: overrides.apn === undefined ? '042-123.00-000' : overrides.apn ?? undefined,
    county: 'Williamson',
    state: 'TN',
    verified: overrides.verified ?? true,
    verificationSource: 'Williamson County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

function facts(result: CapabilityResult): AssessorTaxFacts {
  return result.facts as AssessorTaxFacts;
}

describe('Assessor & Tax Capability', () => {
  it('is registered on the runtime capability registry', () => {
    const registered = listRuntimeCapabilities().map((capability) => capability.id);
    expect(registered).toContain(ASSESSOR_TAX_CAPABILITY_ID);
    expect(ASSESSOR_TAX_CAPABILITY.metadata.name).toBe('Assessor & Tax');
  });

  it('reads the assessor and tax record for the Deal Card canonical subject and keeps its provenance', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { lookupParcel: async () => matched() });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: card.id, dealCardId: deal.id, temporary: false });

    const view = facts(result);
    expect(view.recordStatus).toBe('official_record_retrieved');
    expect(view.jurisdiction).toBe('Williamson County, TN');
    expect(view.assessor.ownerOfRecord).toBe('SMITH FAMILY TRUST');
    expect(view.assessor.ownerMailingAddress).toBe('PO BOX 41, FAIRVIEW TN 37062');
    expect(view.assessor.totalAppraisedValue).toBe(61_000);
    expect(view.assessor.taxableValue).toBe(15_250);
    expect(view.tax.annualTaxAmount).toBe(412);
    expect(view.tax.taxYear).toBe('2025');
    expect(view.tax.standing).toBe('current');
    expect(view.transfer.lastSalePrice).toBe(42_000);
    expect(view.transfer.deedBookPage).toBe('7231/455');

    // Provenance travels with every retained record and reaches the evidence log.
    expect(view.records.every((record) => !!record.source)).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0].source).toContain('Williamson County');
    const persisted = getLandosDb().prepare(`
      SELECT capability_id, source_label FROM landos_capability_evidence WHERE capability_id = ?
    `).all(ASSESSOR_TAX_CAPABILITY_ID) as Array<{ capability_id: string; source_label: string }>;
    expect(persisted.length).toBeGreaterThan(0);
  });

  it('never fabricates a field the record did not publish', async () => {
    const { deal, card } = canonicalSubject();
    const bare: OfficialParcel = { ...PARCEL, owner: null, acres: null, facts: { taxYear: '2025' } };
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { lookupParcel: async () => matched(bare) });

    const view = facts(result);
    expect(view.assessor.ownerOfRecord).toBeNull();
    expect(view.assessor.totalAppraisedValue).toBeNull();
    expect(view.assessor.taxableValue).toBeNull();
    expect(view.tax.annualTaxAmount).toBeNull();
    expect(view.tax.standing).toBe('unresolved');
    expect(view.improvements.yearBuilt).toBeNull();
    expect(view.transfer.lastSaleDate).toBeNull();
    expect(view.missingInformation ?? result.missingInformation).toBeDefined();
    expect(result.missingInformation).toEqual(expect.arrayContaining([
      'Owner of record from the assessor or appraisal record',
    ]));
    // The collecting office is NAMED, never invented as an answer.
    expect(view.tax.collectingOffice).toBe('County Trustee');
    expect(view.tax.statement).toContain('not established');
  });

  it('reports the exact sources attempted when no official record answered', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { lookupParcel: async () => noMatch, lookupCountyAssessor: async () => null });

    const view = facts(result);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(view.recordStatus).toBe('not_retrieved');
    expect(view.records).toEqual([]);
    expect(view.sourceAttempts).toEqual([{
      source: 'TN Comptroller statewide parcel layer',
      status: 'no_match',
      note: 'The layer answered and held no record for this APN.',
    }]);
    expect(result.warnings.join(' ')).toContain('TN Comptroller statewide parcel layer');
  });

  it('invokes one governed recovery only after the deterministic ladder misses', async () => {
    const { deal, card } = canonicalSubject();
    let recoveryCalls = 0;
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      context: { runId: 'intel_assessor_recovery' },
    }, {
      lookupParcel: async () => noMatch,
      lookupCountyAssessor: async () => null,
      recoverPublicRecords: async (recoveryInput) => {
        recoveryCalls += 1;
        expect(recoveryInput.runId).toBe('intel_assessor_recovery');
        expect(recoveryInput.attempts).toHaveLength(1);
        return {
          status: 'RETURNED', outputFile: 'recovery.json', error: null,
          admission: { evidenceIds: [91], duplicates: 0, propertyIdentityVersionId: 1, skippedReason: null },
          evidence: [{ source: 'Williamson County Assessor', sourceUrl: 'https://example.gov/parcel/042123', sourceType: 'official_county_assessor', retrievedAt: '2026-08-30T12:00:00.000Z' }],
          handback: {
            schemaVersion: '1.0', runId: 'intel_assessor_recovery', dealCardId: deal.id, propertyCardId: card.id,
            status: 'RETURNED', deterministicFailureReason: 'no match', recoveryReason: 'Official county page matched the APN.', subjectMatch: 'exact',
            facts: [{ key: 'owner_of_record', label: 'Owner of record', value: 'RECOVERED OWNER LLC', sourceId: 'county', confidence: 'confirmed' }],
            sources: [{ id: 'county', name: 'Williamson County Assessor', url: 'https://example.gov/parcel/042123', sourceType: 'official_county_assessor', retrievedAt: '2026-08-30T12:00:00.000Z', official: true }],
            artifacts: [], unresolvedRequirements: [], exactFailureReason: null, attempts: [],
          },
        };
      },
    });
    expect(recoveryCalls).toBe(1);
    expect(result.status).toBe('SUCCEEDED');
    expect(facts(result).assessor.ownerOfRecord).toBe('RECOVERED OWNER LLC');
  });

  it('does not invoke governed recovery when deterministic retrieval succeeds', async () => {
    const { deal, card } = canonicalSubject();
    const recoverPublicRecords = vi.fn();
    await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh', context: { runId: 'intel_no_recovery' },
    }, { lookupParcel: async () => matched(), recoverPublicRecords });
    expect(recoverPublicRecords).not.toHaveBeenCalled();
  });

  it('falls through to the structured county assessor search when no parcel layer carries the county', async () => {
    const { deal, card } = canonicalSubject();
    const source = 'Williamson County Property Assessment Database (inigo.williamson-tn.org)';
    const record = (field: string, value: string, classification: 'official_record' | 'recorded_instrument' = 'official_record') => ({
      field, value, classification, source, sourceUrl: 'https://inigo.williamson-tn.org/property_search/', retrievedAt: '2026-08-21T00:00:00.000Z',
    });
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      lookupParcel: async () => noMatch,
      lookupCountyAssessor: async () => ({
        status: 'matched',
        source,
        sourceUrl: 'https://inigo.williamson-tn.org/property_search/',
        note: 'The canonical APN matched exactly one official assessment record (parcel ID "042    12300 000").',
        jurisdiction: 'Williamson County, TN',
        summary: 'Official Williamson County assessment record retrieved for parcel 042    12300 000.',
        officialParcelId: '042    12300 000',
        records: [
          record('APN', '042    12300 000'),
          record('Owner of record', 'SMITH FAMILY TRUST'),
          record('Situs address', 'KINGWOOD BLVD'),
          record('Assessed acreage', '51.1100'),
          record('Land use class', '110 Farm'),
          record('Appraised value (land)', '$1,254,400'),
          record('Improvement appraised value', '$0'),
          record('Total appraised value', '$1,254,400'),
          record('Improvements (assessor)', 'No buildings on record'),
          record('Last recorded sale date', '2024-03-08', 'recorded_instrument'),
          record('Deed book/page', '9433/325', 'recorded_instrument'),
        ],
      }),
    });

    const view = facts(result);
    expect(result.status).toBe('SUCCEEDED');
    expect(view.recordStatus).toBe('official_record_retrieved');
    expect(view.jurisdiction).toBe('Williamson County, TN');
    expect(view.assessor.ownerOfRecord).toBe('SMITH FAMILY TRUST');
    // The road-only situs is retained exactly as the record prints it — no
    // street number is invented on the official record.
    expect(view.assessor.situsAddress).toBe('KINGWOOD BLVD');
    expect(view.assessor.assessedAcres).toBe(51.11);
    expect(view.assessor.landAppraisedValue).toBe(1_254_400);
    expect(view.transfer.lastSaleDate).toBe('2024-03-08');
    expect(view.records.some((entry) => entry.field === 'Improvements (assessor)' && entry.value === 'No buildings on record')).toBe(true);
    // Both source attempts are on the record: the layer miss and the county match.
    expect(view.sourceAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'TN Comptroller statewide parcel layer', status: 'no_match' }),
      expect.objectContaining({ source, status: 'matched' }),
    ]));
    expect(result.evidence.some((item) => item.source === source)).toBe(true);
  });

  it('reports honestly when the county assessor search also holds no verified match', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      lookupParcel: async () => noMatch,
      lookupCountyAssessor: async () => ({
        status: 'no_match',
        source: 'Williamson County Property Assessment Database (inigo.williamson-tn.org)',
        sourceUrl: 'https://inigo.williamson-tn.org/property_search/',
        note: 'The county assessment database returned 2 candidate(s), and none matched the canonical parcel identifier segment for segment. No candidate was substituted.',
        jurisdiction: 'Williamson County, TN',
        summary: null,
        officialParcelId: null,
        records: [],
      }),
    });

    const view = facts(result);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(view.recordStatus).toBe('not_retrieved');
    expect(view.records).toEqual([]);
    expect(view.sourceAttempts.map((attempt) => attempt.source)).toContain('Williamson County Property Assessment Database (inigo.williamson-tn.org)');
  });

  it('consumes the canonical subject and refuses one that is not the Deal Card subject', async () => {
    const { deal } = canonicalSubject();
    const { card: other } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Another parcel entirely', state: 'TN' });
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: other.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { lookupParcel: async () => matched() });
    expect(result.status).toBe('FAILED');
    expect(result.warnings.join(' ')).toContain('is not the subject of Deal Card');
  });

  it('reruns for a Deal Card without changing the canonical property identity', async () => {
    const { deal, card } = canonicalSubject();
    const request = {
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card' as const, ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh' as const,
    };
    const before = getLandosDb().prepare('SELECT apn, county, state, verification_status FROM landos_property_card WHERE id = ?').get(card.id);
    const cards = Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n);
    await invokeRuntimeCapability(request, { lookupParcel: async () => matched() });
    await invokeRuntimeCapability(request, {
      lookupParcel: async () => matched({ ...PARCEL, apn: '999 999.00 000', owner: 'SOMEONE ELSE' }),
    });
    const after = getLandosDb().prepare('SELECT apn, county, state, verification_status FROM landos_property_card WHERE id = ?').get(card.id);
    expect(after).toEqual(before);
    expect(Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n)).toBe(cards);
  });

  it('delegates raw Tools input to Property Resolution and never resolves identity itself', async () => {
    const seen: string[] = [];
    const resolution: CapabilityResult = {
      invocationId: 'cap_resolution',
      capability: { id: PROPERTY_RESOLUTION_CAPABILITY_ID, name: 'Property Resolution', contractVersion: '1.0', description: '' },
      status: 'SUCCEEDED',
      subjectResolution: 'RESOLVED',
      canonicalSubject: { kind: 'research_session', id: 'research_abc', temporary: true },
      facts: {
        canonicalIdentity: {
          address: '0 Kingwood Blvd, Fairview, TN 37062',
          apn: '042 123.00 000',
          county: 'Williamson',
          state: 'TN',
          owner: 'SMITH FAMILY TRUST',
          acres: 12.4,
        },
      },
      evidence: [],
      warnings: [],
      missingInformation: [],
      timestamps: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      execution: { mode: 'reuse', durationMs: 1, reused: false },
    };
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:assessor-tax' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview, Tennessee' },
    }, {
      resolveSubject: async (request) => { seen.push(request.subject.kind); return resolution; },
      lookupParcel: async () => matched(),
    });

    expect(seen).toEqual(['raw_property']);
    // The capability returns EXACTLY the subject Property Resolution established.
    expect(result.canonicalSubject).toEqual(resolution.canonicalSubject);
    expect(facts(result).assessor.ownerOfRecord).toBe('SMITH FAMILY TRUST');
  });

  it('does not create a lead, Deal Card, or Property Card from a Tools invocation', async () => {
    const counts = () => ({
      deals: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n),
      cards: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n),
    });
    const before = counts();
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:assessor-tax' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: '0 Kingwood Blvd, Fairview TN' },
    }, {
      resolveSubject: async () => ({
        invocationId: 'cap_unresolved',
        capability: { id: PROPERTY_RESOLUTION_CAPABILITY_ID, name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'NEEDS_INPUT',
        subjectResolution: 'UNRESOLVED',
        canonicalSubject: null,
        facts: { canonicalIdentity: {} },
        evidence: [],
        warnings: [],
        missingInformation: ['A parcel identifier from an official parcel source'],
        timestamps: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        execution: { mode: 'reuse', durationMs: 1, reused: false },
      }),
      lookupParcel: async () => { throw new Error('the assessor lookup must not run without a canonical subject'); },
    });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.subjectResolution).toBe('UNRESOLVED');
    expect(result.missingInformation).toContain('A parcel identifier from an official parcel source');
    expect(counts()).toEqual(before);
  });

  it('refuses caller-supplied assessor or tax assertions', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      context: { taxStatus: 'PAID IN FULL' },
    }).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain('caller-supplied assessor, tax, or evidence assertions');
  });

  it('projects one snapshot fact list every surface reads', () => {
    const projected = assessorTaxSnapshotFacts({
      invocationId: 'cap_x',
      capability: ASSESSOR_TAX_CAPABILITY.metadata,
      status: 'SUCCEEDED',
      subjectResolution: 'RESOLVED',
      canonicalSubject: null,
      facts: {
        jurisdiction: 'Williamson County, TN',
        records: [
          { field: 'Owner of record', value: 'SMITH FAMILY TRUST', classification: 'official_record', source: 'Williamson County Property Assessor', sourceUrl: 'https://example.gov/p', retrievedAt: '2026-08-18T00:00:00.000Z' },
          { field: 'Deed book/page', value: '7231/455', classification: 'recorded_instrument', source: 'Register of Deeds', sourceUrl: null, retrievedAt: null },
        ],
      },
      evidence: [],
      warnings: [],
      missingInformation: [],
      timestamps: { startedAt: '2026-08-18T00:00:00.000Z', completedAt: '2026-08-18T00:00:01.000Z' },
      execution: { mode: 'reuse', durationMs: 1, reused: false },
    });
    expect(projected).toEqual([
      {
        key: 'assessor_tax_0_owner_of_record',
        label: 'Owner of record',
        value: 'SMITH FAMILY TRUST',
        grade: 'likely_indication',
        source: 'Williamson County Property Assessor',
        sourceUrl: 'https://example.gov/p',
        retrievedAt: '2026-08-18T00:00:00.000Z',
        note: null,
      },
      {
        key: 'assessor_tax_1_deed_book_page',
        label: 'Deed book/page',
        value: '7231/455',
        grade: 'confirmed_fact',
        source: 'Register of Deeds',
        sourceUrl: null,
        retrievedAt: '2026-08-18T00:00:01.000Z',
        note: null,
      },
    ]);
  });

  it('persists one reusable assessor invocation per canonical subject', async () => {
    const { deal, card } = canonicalSubject();
    const request = {
      capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
      caller: { type: 'new_lead' as const, ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: card.id, dealCardId: deal.id },
    };
    const first = await invokeRuntimeCapability(request, { lookupParcel: async () => matched() });
    const second = await invokeRuntimeCapability(request, {
      lookupParcel: async () => { throw new Error('reuse must not touch the official source again'); },
    });
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.execution.reused).toBe(true);
    const latest = new CapabilityInvocationStore().latestForProperty(card.id, deal.id, ASSESSOR_TAX_CAPABILITY_ID);
    expect(latest?.capability.id).toBe(ASSESSOR_TAX_CAPABILITY_ID);
    expect(new CapabilityInvocationStore().latestForProperty(card.id, deal.id)).toBeNull();
  });
});
