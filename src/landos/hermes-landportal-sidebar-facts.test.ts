// Hermes LandPortal sidebar-fact capture contract.
//
// The clearly labeled sidebar fields (Water Feature Type, Zoning Code, FEMA
// Flood Zone Description, Sale Info, Assessed Value) are captured whenever
// LandPortal displays them, preserved verbatim under their exact labels
// through the existing canonical property-fact path, and never overwrite an
// already-retained (stronger) value.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { importHermesLandPortalFile, type HermesLandPortalSubject } from './hermes-landportal-import.js';
import { buildParcelFactSheet } from './landportal-facts.js';
import { loadPropertyInspection, savePropertyInspection, upsertPropertyCard } from './property-card.js';
import { PropertyResearchStore, resetPropertyResearchStoreCache } from './property-research-store.js';

const SUBJECT_URL = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';

const SIDEBAR_VALUES = {
  water_feature_type: 'River',
  zoning_code: '01 - NOT Z',
  fema_flood_zone_description: 'Area of minimal flood hazard, usually depicted on FIRMs as above the 500-year flood level. BFEs are not determined.',
  last_sale_price: 16500,
  last_sale_date: '10-07-2005',
  book_number: 1234,
  page_number: 75,
  assessed_value: '$56,700.00',
} as const;

const payload = (): HermesLandPortalSubject => ({
  subject_url: SUBJECT_URL,
  subject_verification_status: 'verified_exact_subject',
  subject_verification_note: 'URL identity and DOM Parcel ID agree.',
  address: 'ONEIL RD, PORT BYRON, NY 13140',
  county: 'Cayuga County',
  apn: '053889 75.00-1-24.11',
  owner: 'WILKINSON DANIEL',
  deeded_acres: 75.71,
  captured_at: '2026-08-01T14:00:00.000Z',
  specialist_category: 'subject',
  completed_categories: ['subject'],
  comps: [],
  ...SIDEBAR_VALUES,
});

let tempDirs: string[] = [];

function fixture(value: HermesLandPortalSubject): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-sidebar-facts-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'subject.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function subjectCard() {
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

describe('LandPortal sidebar fact capture', () => {
  it('captures every listed sidebar field under its exact label with the displayed value', () => {
    const target = subjectCard();
    const imported = importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });

    expect(imported.persistedCategories).toEqual(['subject']);
    const parcelFacts = loadPropertyInspection(target.card.id)?.parcelFacts ?? {};
    expect(parcelFacts['Water Feature Type']).toBe('River');
    expect(parcelFacts['Zoning Code']).toBe('01 - NOT Z');
    expect(parcelFacts['FEMA Flood Zone Description']).toBe(SIDEBAR_VALUES.fema_flood_zone_description);
    expect(parcelFacts['Last Sale Price']).toBe('16500');
    expect(parcelFacts['Last Sale Date']).toBe('10-07-2005');
    expect(parcelFacts['Book Number']).toBe('1234');
    expect(parcelFacts['Page Number']).toBe('75');
    expect(parcelFacts['Assessed Value']).toBe('$56,700.00');
  });

  it('persists the sidebar fields through the canonical property-fact path with LandPortal provenance', () => {
    const target = subjectCard();
    importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });

    const record = new PropertyResearchStore().loadForProperty(target.card.id);
    expect(Object.keys(record?.lanes ?? {})).toContain('hermes_landportal_subject');
    for (const [field, value] of Object.entries(SIDEBAR_VALUES)) {
      const fact = record?.facts[field];
      expect(fact, `canonical fact for ${field}`).toBeDefined();
      expect(fact?.value).toBe(value);
      expect(fact?.providerId).toBe('hermes_landportal_import');
      expect(fact?.sourceUrl).toBe(SUBJECT_URL);
      expect(fact?.subjectClassification).toBe('verified_subject');
    }
  });

  it('stores the zoning code verbatim without reinterpretation', () => {
    const target = subjectCard();
    importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });
    const parcelFacts = loadPropertyInspection(target.card.id)?.parcelFacts ?? {};
    expect(parcelFacts['Zoning Code']).toBe('01 - NOT Z');
    // The established fact-sheet normalizer surfaces it unchanged too.
    expect(buildParcelFactSheet(parcelFacts).snapshot.find((row) => row.key === 'zoning')?.value).toBe('01 - NOT Z');
  });

  it('normalizes money only through the established fact-sheet fields while preserving the displayed value', () => {
    const target = subjectCard();
    importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });
    const parcelFacts = loadPropertyInspection(target.card.id)?.parcelFacts ?? {};
    const sheet = buildParcelFactSheet(parcelFacts);
    // Established normalized fields.
    expect(sheet.valuation.lastSalePrice).toBe(16500);
    expect(sheet.valuation.lastSalePriceLabel).toBe('$16,500');
    expect(sheet.valuation.lastSaleDate).toBe('10-07-2005');
    expect(sheet.valuation.assessedValue).toBe('$56,700.00');
    // Displayed source values remain retained verbatim.
    expect(parcelFacts['Last Sale Price']).toBe('16500');
    expect(parcelFacts['Assessed Value']).toBe('$56,700.00');
  });

  it('treats a displayed water feature type as water-feature evidence', () => {
    const target = subjectCard();
    importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });
    const sheet = buildParcelFactSheet(loadPropertyInspection(target.card.id)?.parcelFacts ?? {});
    expect(sheet.water.present).toBe(true);
    expect(sheet.water.label).toBe('Yes, River');
  });

  it('never overwrites an already-retained value for the same label', () => {
    const target = subjectCard();
    savePropertyInspection(target.card.id, {
      parcelUrl: SUBJECT_URL,
      parcelUrlRecord: null,
      threeDCapture: null,
      comparablesUrl: null,
      comparablesCapturedAt: null,
      parcelFacts: { 'Zoning Code': 'R-1 Residential (official county record)' },
      assets: [], overlays: [], visualObservations: [], comparables: [], sources: [], evidence: [],
    });

    importHermesLandPortalFile(fixture(payload()), { propertyCardId: target.card.id });
    const parcelFacts = loadPropertyInspection(target.card.id)?.parcelFacts ?? {};
    expect(parcelFacts['Zoning Code']).toBe('R-1 Residential (official county record)');
    // Fields with no retained value are still added.
    expect(parcelFacts['Assessed Value']).toBe('$56,700.00');
  });

  it('omits sidebar fields LandPortal did not display instead of fabricating them', () => {
    const target = subjectCard();
    const partial = { ...payload() };
    delete (partial as Record<string, unknown>).water_feature_type;
    delete (partial as Record<string, unknown>).book_number;
    importHermesLandPortalFile(fixture(partial), { propertyCardId: target.card.id });
    const parcelFacts = loadPropertyInspection(target.card.id)?.parcelFacts ?? {};
    expect(parcelFacts['Water Feature Type']).toBeUndefined();
    expect(parcelFacts['Book Number']).toBeUndefined();
    expect(parcelFacts['Zoning Code']).toBe('01 - NOT Z');
  });
});

describe('V2 Property Intelligence sidebar projection (source contract)', () => {
  const ROUTES_SRC = fs.readFileSync(path.join(process.cwd(), 'src/landos/routes.ts'), 'utf8');
  const PI_UI_SRC = fs.readFileSync(
    path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
    'utf8',
  );

  it('projects every sidebar label into the PI read as lp_sidebar_* facts', () => {
    for (const key of [
      'lp_sidebar_water_feature_type', 'lp_sidebar_zoning_code', 'lp_sidebar_fema_flood_zone_description',
      'lp_sidebar_last_sale_price', 'lp_sidebar_last_sale_date', 'lp_sidebar_book_number',
      'lp_sidebar_page_number', 'lp_sidebar_assessed_value',
    ]) {
      expect(ROUTES_SRC).toContain(key);
    }
    expect(ROUTES_SRC).toMatch(/discovery.stage/i);
  });

  it('places the fields in the required V2 sections without a new store', () => {
    expect(PI_UI_SRC).toMatch(/Water feature/);
    expect(PI_UI_SRC).toMatch(/Zoning &amp; land use/);
    expect(PI_UI_SRC).toMatch(/Sale &amp; deed history/);
    expect(PI_UI_SRC).toMatch(/Value &amp; assessment/);
    expect(PI_UI_SRC).toMatch(/FEMA flood zone description/i);
    expect(PI_UI_SRC).toMatch(/discovery stage/i);
    // Reads facts from the existing snapshot projection, not a new endpoint.
    expect(PI_UI_SRC).not.toMatch(/sidebar-data|\/api\/landos\/sidebar/);
  });
});
