import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listComps, upsertNormalizedComp } from './comps.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { importHermesLandPortalFile, type HermesLandPortalSubject } from './hermes-landportal-import.js';
import { getPropertyCardRow, loadPropertyInspection, savePropertyInspection, upsertPropertyCard } from './property-card.js';
import type { PropertyProviderResult } from './property-intelligence-contract.js';
import { PropertyResearchStore, resetPropertyResearchStoreCache } from './property-research-store.js';

const SUBJECT_URL = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';

const payload = (): HermesLandPortalSubject => ({
  subject_url: SUBJECT_URL,
  subject_verification_status: 'verified_exact_subject',
  subject_verification_note: 'URL identity and DOM Parcel ID agree.',
  address: 'ONEIL RD, PORT BYRON, NY 13140',
  county: 'Cayuga County',
  municipality: 'MENTZ (TOV)',
  apn: '053889 75.00-1-24.11',
  owner: 'WILKINSON DANIEL',
  mailing_address: '1738 NEW YORK CENTRAL RD, PORT BYRON, NY 13140',
  deeded_acres: 75.71,
  mls_acres: null,
  calculated_acres: 66.24,
  road_frontage_ft: 606.18,
  landlocked_status: 'No',
  wetlands_pct: 28.91,
  fema_pct: 29.19,
  average_slope_pct: 4.08,
  pct_under_10pct_slope: 95.22,
  pct_under_10pct_slope_note: 'Derived from visible slope bands.',
  buildability_pct: 98.77,
  lp_estimate_total: 265375,
  lp_estimate_per_acre: 3505,
  captured_at: '2026-08-01T14:00:00.000Z',
  comps: [
    { price: 337500, acres: 100, apn: '053289 47.00-1-6', price_per_acre: 3375 },
    { price: 217000, acres: 62, apn: '056400 38.00-1-44.13', price_per_acre: 3500 },
    { price: 130000, acres: 34.8, apn: '056400 37.00-1-33', price_per_acre: 3735.63 },
  ],
});

let tempDirs: string[] = [];

function fixture(value: HermesLandPortalSubject): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-landportal-import-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'subject.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function subjectCard(input: { owner?: string; acres?: number } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'ONEIL RD' });
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'ONEIL RD',
    city: 'PORT BYRON',
    state: 'NY',
    zip: '13140',
    county: 'Cayuga',
    apn: '053889 75.00-1-24.11',
    fips: '36011',
    lpUrl: SUBJECT_URL,
    owner: input.owner,
    acres: input.acres,
    verified: true,
    verificationSource: 'Retained exact parcel evidence',
  }).card;
  expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' }).error).toBeUndefined();
  return { deal, card };
}

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyResearchStoreCache();
});

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('Hermes LandPortal import', () => {
  it('persists subject facts first, then comparables in a later independent snapshot', () => {
    const target = subjectCard();
    const file = fixture({ ...payload(), completed_categories: ['subject'], comps: [] });
    const first = importHermesLandPortalFile(file, {
      propertyCardId: target.card.id,
      now: () => '2026-08-02T14:00:01.000Z',
    });

    expect(first.persistedCategories).toEqual(['subject']);
    expect(first.categoryResults).toEqual([
      expect.objectContaining({ category: 'subject', imported: true, persistedAt: '2026-08-02T14:00:01.000Z', error: null }),
    ]);
    expect(getPropertyCardRow(target.card.id)).toMatchObject({
      owner: 'WILKINSON DANIEL', acres: 75.71, lp_property_id: '89505385', lp_url: SUBJECT_URL,
    });
    expect(loadPropertyInspection(target.card.id)?.parcelFacts).toMatchObject({ 'Owner Name': 'WILKINSON DANIEL', 'Parcel ID': '053889 75.00-1-24.11' });
    expect(listComps({ dealCardId: target.deal.id })).toHaveLength(0);
    expect(Object.keys(new PropertyResearchStore().loadForProperty(target.card.id)?.lanes ?? {})).toEqual(['hermes_landportal_subject']);

    fs.writeFileSync(file, JSON.stringify({ ...payload(), completed_categories: ['subject', 'comps'] }));
    const second = importHermesLandPortalFile(file, {
      propertyCardId: target.card.id,
      now: () => '2026-08-02T14:00:12.000Z',
    });

    expect(second.persistedCategories).toEqual(['subject', 'comps']);
    expect(second.categoryResults.find((result) => result.category === 'subject')).toMatchObject({ imported: false, error: null });
    expect(second.categoryResults.find((result) => result.category === 'comps')).toMatchObject({ imported: true, persistedAt: '2026-08-02T14:00:12.000Z', itemCount: 3, error: null });
    expect(listComps({ dealCardId: target.deal.id })).toHaveLength(3);
    expect(loadPropertyInspection(target.card.id)?.comparables).toHaveLength(3);
    expect(Object.keys(new PropertyResearchStore().loadForProperty(target.card.id)?.lanes ?? {})).toEqual([
      'hermes_landportal_subject', 'hermes_landportal_comps',
    ]);
  });

  it('admits verified property-scoped visual artifacts as their own category', () => {
    const target = subjectCard();
    const base = payload();
    const file = fixture({
      ...base,
      completed_categories: ['subject', 'comps', 'visuals'],
      visual_artifacts: [{
        key: 'parcel-context',
        label: 'Exact parcel context',
        kind: 'parcel_boundary',
        purpose: 'Verify the exact subject boundary and immediate context.',
        source_path: 'parcel-context.png',
        timestamp: '2026-08-02T14:00:20.000Z',
        requested_view: 'parcel_context',
        active_view: 'parcel_context',
        boundary_required: true,
        boundary_visible: true,
        tiles_loaded: true,
        camera_scale: 'parcel',
        clipped: false,
        obstructions: [],
      }],
    });
    fs.writeFileSync(path.join(path.dirname(file), 'parcel-context.png'), Buffer.alloc(9 * 1024, 1));

    const imported = importHermesLandPortalFile(file, { propertyCardId: target.card.id });

    expect(imported.persistedCategories).toEqual(['subject', 'comps', 'visuals']);
    expect(imported.importedVisualCount).toBe(1);
    expect(imported.rejectedVisualCount).toBe(0);
    expect(imported.categoryResults.find((result) => result.category === 'visuals')).toMatchObject({ imported: true, itemCount: 1, rejectedItemCount: 0, error: null });
    expect(loadPropertyInspection(target.card.id)?.assets).toEqual([
      expect.objectContaining({ key: 'parcel-context', label: 'Exact parcel context', validation: expect.objectContaining({ status: 'accepted', propertyCardId: target.card.id }) }),
    ]);
    expect(new PropertyResearchStore().loadForProperty(target.card.id)?.evidence.filter((item) => item.kind === 'visual')).toHaveLength(1);
    const repeated = importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(repeated.imported).toBe(false);
    expect(repeated.categoryResults.find((result) => result.category === 'visuals')).toMatchObject({ imported: false, error: null });
    expect(loadPropertyInspection(target.card.id)?.assets).toHaveLength(1);
  });

  it('imports the verified subject and all context comps through canonical stores, idempotently', () => {
    const target = subjectCard();
    const unrelatedDeal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Unrelated property' });
    const unrelated = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '12 OTHER RD', city: 'AUBURN', state: 'NY', county: 'Cayuga',
      apn: 'OTHER-APN-1', fips: '36011', verified: true, verificationSource: 'Official assessor', owner: 'OTHER OWNER', acres: 10,
    }).card;
    linkPropertyToDeal({ dealCardId: unrelatedDeal.id, cardId: unrelated.id, role: 'subject' });
    const unrelatedBefore = getPropertyCardRow(unrelated.id);
    const file = fixture(payload());

    const imported = importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(imported.imported).toBe(true);
    expect(imported.importedCompCount).toBe(3);
    expect(imported.createdCompCount).toBe(3);
    expect(imported.duplicateCompCount).toBe(0);
    expect(imported.rejectedFields).toEqual(['mls_acres']);

    const card = getPropertyCardRow(target.card.id)!;
    expect(card.active_input_address).toBe('ONEIL RD');
    expect(card.apn).toBe('053889 75.00-1-24.11');
    expect(card.lp_property_id).toBe('89505385');
    expect(card.owner).toBe('WILKINSON DANIEL');
    expect(card.acres).toBe(75.71);
    expect(card.lp_url).toBe(SUBJECT_URL);

    const inspection = loadPropertyInspection(target.card.id)!;
    expect(inspection.parcelUrlRecord).toMatchObject({
      url: SUBJECT_URL, verifiedSubject: true, apn: '053889 75.00-1-24.11', propertyId: '89505385',
    });
    expect(inspection.parcelFacts).toMatchObject({
      'Road Frontage': '606.18 ft',
      'Wetlands Coverage (%)': '28.91',
      'FEMA Coverage (%)': '29.19',
      'Slope Avg': '4.08%',
      'Buildability total (%)': '98.77%',
      'Estimate price': '$265,375',
      'Estimate PPA': '$3,505',
    });
    expect(inspection.comparables).toHaveLength(3);

    const canonical = new PropertyResearchStore().loadForProperty(target.card.id)!;
    expect(canonical.facts.owner.value).toBe('WILKINSON DANIEL');
    expect(canonical.facts.lp_estimate_total.value).toBe(265375);
    expect(canonical.facts.lp_estimate_per_acre.value).toBe(3505);
    expect(canonical.evidence.filter((item) => item.kind === 'comp')).toHaveLength(3);
    expect(canonical.evidence.filter((item) => item.kind === 'comp').every((item) => item.subjectClassification === 'context_only')).toBe(true);
    expect(canonical.evidence.filter((item) => item.kind !== 'comp').every((item) => item.subjectClassification === 'verified_subject')).toBe(true);
    expect(listComps({ dealCardId: target.deal.id })).toHaveLength(3);
    expect(getPropertyCardRow(unrelated.id)).toEqual(unrelatedBefore);

    const repeated = importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(repeated.imported).toBe(false);
    expect(repeated.createdCompCount).toBe(0);
    expect(repeated.duplicateCompCount).toBe(3);
    expect(listComps({ dealCardId: target.deal.id })).toHaveLength(3);
    expect(getPropertyCardRow(unrelated.id)).toEqual(unrelatedBefore);
  });

  it('rejects address, APN, or canonical property-id conflicts before writing', () => {
    const target = subjectCard();
    const before = getPropertyCardRow(target.card.id);
    const cases: Array<[Partial<HermesLandPortalSubject>, RegExp]> = [
      [{ address: '99 DIFFERENT RD, PORT BYRON, NY 13140' }, /address/i],
      [{ apn: 'DIFFERENT-APN' }, /APN/i],
      [{ landportal_property_id: '99999999' }, /property identifier/i],
    ];
    for (const [patch, message] of cases) {
      expect(() => importHermesLandPortalFile(fixture({ ...payload(), ...patch }), { propertyCardId: target.card.id })).toThrow(message);
    }
    expect(getPropertyCardRow(target.card.id)).toEqual(before);
    expect(new PropertyResearchStore().loadForProperty(target.card.id)).toBeNull();
    expect(loadPropertyInspection(target.card.id)).toBeNull();
    expect(listComps({ dealCardId: target.deal.id })).toHaveLength(0);
  });

  it('accepts the exact situs address when LandPortal supplies a ZIP absent from New Lead intake', () => {
    const target = subjectCard();
    upsertPropertyCard({
      cardId: target.card.id,
      entity: 'TY_LAND_BIZ',
      activeInputAddress: 'ONEIL RD',
      city: 'PORT BYRON',
      state: 'NY',
      zip: '',
      county: 'Cayuga',
      apn: '053889 75.00-1-24.11',
      fips: '36011',
      lpUrl: SUBJECT_URL,
      verified: true,
      verificationSource: 'Retained exact parcel evidence',
    });

    const imported = importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });

    expect(imported.imported).toBe(true);
    expect(imported.validationChecks.find((check) => check.check === 'property_address')?.passed).toBe(true);
  });

  it('preserves stronger retained subject facts and deduplicates an enriched comp using all available fields', () => {
    const target = subjectCard({ owner: 'OFFICIAL RETAINED OWNER', acres: 80 });
    const canonicalProperty = {
      propertyCardId: target.card.id, dealCardId: target.deal.id,
      normalizedAddress: 'oneil rd', address: 'ONEIL RD', city: 'PORT BYRON', county: 'Cayuga', state: 'NY', zip: '13140',
      apn: '053889 75.00-1-24.11', fips: '36011', landPortalPropertyId: '89505385',
    };
    const official: PropertyProviderResult = {
      contractVersion: 'property-provider-v1', runId: 'official-before-hermes', laneId: 'official_assessor', providerId: 'official_assessor', input: canonicalProperty,
      execution: { attempted: true, startedAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-07-01T00:00:01.000Z', durationMs: 1000, result: {} },
      validation: { valid: true, subjectClassification: 'verified_subject', checks: [], rejectedEvidenceIds: [] },
      evidence: [{
        id: 'official:owner', propertyCardId: target.card.id, dealCardId: target.deal.id, providerId: 'official_assessor',
        field: 'owner', value: 'OFFICIAL RETAINED OWNER', subjectClassification: 'verified_subject', strength: 'official_record',
        sourceUrl: 'https://county.example/parcel', retrievedAt: '2026-07-01T00:00:01.000Z', confidence: 'high', kind: 'fact', validation: { valid: true, reasons: [] },
      }],
      status: 'verified', persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null }, failureReason: null,
    };
    new PropertyResearchStore().persistProviderResult(official);
    savePropertyInspection(target.card.id, {
      parcelUrl: SUBJECT_URL,
      parcelUrlRecord: { url: SUBJECT_URL, source: 'Retained exact subject', capturedAt: '2026-07-01T00:00:01.000Z', propertyCardId: target.card.id, dealCardId: target.deal.id, verifiedSubject: true, apn: canonicalProperty.apn, fips: '36011', propertyId: '89505385' },
      comparablesUrl: null, parcelFacts: { 'Owner Name': 'OFFICIAL RETAINED OWNER', Acres: '80.000' }, assets: [], overlays: [], visualObservations: [], comparables: [],
    });
    upsertNormalizedComp({
      entity: 'TY_LAND_BIZ', dealCardId: target.deal.id, cardId: target.card.id, sourceLabel: 'LandPortal', canonicalSource: 'LandPortal',
      apn: '053289 47.00-1-6', addressDesc: '0 Southard Rd, CATO, NY, 13033', price: 337500, acres: 100,
      pricePerAcre: 3375, priceKind: 'sale', saleOrListDate: '2025-04-24', status: 'verified_sale', propertyClass: 'vacant_land',
    });

    const imported = importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });
    expect(imported.createdCompCount).toBe(2);
    expect(imported.duplicateCompCount).toBe(1);
    expect(getPropertyCardRow(target.card.id)).toMatchObject({ owner: 'OFFICIAL RETAINED OWNER', acres: 80 });
    expect(loadPropertyInspection(target.card.id)?.parcelFacts).toMatchObject({ 'Owner Name': 'OFFICIAL RETAINED OWNER', Acres: '80.000' });
    expect(new PropertyResearchStore().loadForProperty(target.card.id)?.facts.owner).toMatchObject({ value: 'OFFICIAL RETAINED OWNER', strength: 'official_record' });
    const rows = listComps({ dealCardId: target.deal.id });
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.apn === '053289 47.00-1-6')).toMatchObject({
      address_desc: '0 Southard Rd, CATO, NY, 13033', sale_or_list_date: '2025-04-24', status: 'verified_sale',
    });
  });
});
