// Missing-diligence reconciliation contract: stale collector messages never
// survive newer accepted research; genuine official/legal diligence stays
// honestly unresolved; duplicate warnings condense into one checklist item;
// discovery evidence is never converted into a legal conclusion.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  reconcileMissingDiligence,
  type DiscoveryDiligenceState,
} from './missing-diligence-reconciliation.js';

const screenedState = (overrides: Partial<DiscoveryDiligenceState> = {}): DiscoveryDiligenceState => ({
  identityVerified: true,
  frontageFt: 693,
  wetlandsScreenedPct: '1.28%',
  femaScreenedPct: '2.39',
  femaDescription: 'Area of minimal flood hazard, usually depicted on FIRMs as above the 500-year flood level. BFEs are not determined.',
  soilUnitCount: 3,
  slopePct: '9.86',
  buildabilityPct: '76.24',
  streetViewComplete: true,
  zoningCode: '01 - NOT Z',
  zoningOfficialConfirmed: false,
  utilitiesConfirmed: false,
  septicConfirmed: false,
  officialRecordsRetrieved: false,
  valuationPriceable: false,
  ...overrides,
});

const STALE_MESSAGES = [
  'Government records (subject property): blocked — No source collector ran for this lane. Official county records: The requested APN 055689 10.00-1-64.22 has not been confirmed by a parcel source. Property intelligence remains in Resolution. County records have not been retrieved.',
  'Environmental screening: partial result — Wetlands: The requested APN has not been confirmed by a parcel source. Property intelligence remains in Resolution. Wetlands screening has not been run. FEMA flood screening has not been run. Soils screening has not been run. Slope screening has not been run.',
  'Utilities and access: partial result — Road proximity screening has not run yet. Utilities: Not screened No source collector ran for this lane. Road access screening has not been run.',
  'Zoning: partial result — No source collector ran for this lane. Zoning screening has not been run.',
];

const ACCESS_DUPLICATES = [
  'Recorded legal access has not been established.',
  'Parcel–road boundary contact unresolved',
  'Public right-of-way contact unresolved',
  'Physical / driveway access unresolved',
  'Legal access unresolved (recorded instruments control)',
  'Mapped frontage unresolved (proximity method does not measure frontage)',
  'Road maintenance responsibility unresolved',
];

describe('stale collector messages are superseded by accepted research', () => {
  it('drops every not-run and remains-in-Resolution claim when the category research is accepted', () => {
    const result = reconcileMissingDiligence(screenedState(), STALE_MESSAGES);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/has not been run/);
    expect(text).not.toMatch(/remains in Resolution/);
    expect(text).not.toMatch(/has not been confirmed by a parcel source/);
    expect(text).not.toMatch(/No source collector ran/);
    expect(result.passthrough).toEqual([]);
  });

  it('describes completed discovery screenings as completed, never contradictory', () => {
    const result = reconcileMissingDiligence(screenedState(), STALE_MESSAGES);
    const byKey = new Map(result.items.map((item) => [item.key, item]));
    expect(byKey.get('wetlands')?.currentFinding).toMatch(/screening completed: mapped coverage 1\.28%/);
    expect(byKey.get('fema')?.currentFinding).toMatch(/screening completed: mapped coverage 2\.39/);
    expect(byKey.get('fema')?.currentFinding).toMatch(/minimal flood hazard/);
    expect(byKey.get('septic')?.currentFinding).toMatch(/3 accepted soil unit/);
    expect(byKey.get('county_records')?.currentFinding).toMatch(/verified through LandPortal/);
    expect(byKey.get('access')?.currentFinding).toMatch(/approximately 693 ft/);
    expect(byKey.get('access')?.currentFinding).toMatch(/no physical frontage barrier observed/);
  });

  it('keeps honest not-run wording when a screening genuinely has not run', () => {
    const result = reconcileMissingDiligence(
      screenedState({ wetlandsScreenedPct: null, soilUnitCount: 0 }),
      [],
    );
    const byKey = new Map(result.items.map((item) => [item.key, item]));
    expect(byKey.get('wetlands')?.currentFinding).toMatch(/has not been run yet/);
    expect(byKey.get('septic')?.currentFinding).toMatch(/has not been run yet/);
  });
});

describe('genuine official and legal diligence is preserved', () => {
  it('keeps the twelve-category unresolved surface without legal conclusions', () => {
    const result = reconcileMissingDiligence(screenedState(), [...STALE_MESSAGES, ...ACCESS_DUPLICATES]);
    const keys = result.items.map((item) => item.key);
    for (const key of ['access', 'zoning', 'survey', 'utilities', 'septic', 'wetlands', 'fema', 'county_records', 'valuation']) {
      expect(keys).toContain(key);
    }
    const text = JSON.stringify(result.items);
    // Every item still states what remains unresolved; nothing is concluded.
    for (const item of result.items) expect(item.stillUnresolved.length).toBeGreaterThan(10);
    expect(text).not.toMatch(/legal access is (?:confirmed|established)(?! by recorded)/i);
    expect(text).toMatch(/recorded instruments, not mapped proximity/);
  });

  it('drops resolved-category items when official confirmation exists', () => {
    const result = reconcileMissingDiligence(
      screenedState({ zoningOfficialConfirmed: true, utilitiesConfirmed: true, valuationPriceable: true }),
      [],
    );
    const keys = result.items.map((item) => item.key);
    expect(keys).not.toContain('zoning');
    expect(keys).not.toContain('utilities');
    expect(keys).not.toContain('valuation');
  });
});

describe('duplicate warnings condense', () => {
  it('collapses the seven access-family warnings into one checklist item', () => {
    const result = reconcileMissingDiligence(screenedState(), ACCESS_DUPLICATES);
    expect(result.items.filter((item) => item.key === 'access')).toHaveLength(1);
    expect(result.passthrough).toEqual([]);
    expect(result.evidenceGaps).toEqual([]);
  });

  it('passes through genuinely unknown messages and keeps short gaps as chips', () => {
    const result = reconcileMissingDiligence(screenedState(), [
      'Building information',
      'Wider-context aerial',
      'A neighboring quarry blasting schedule is unverified.',
    ]);
    expect(result.evidenceGaps).toEqual(['Building information', 'Wider-context aerial']);
    expect(result.passthrough).toEqual(['A neighboring quarry blasting schedule is unverified.']);
  });
});

describe('V2 projection wiring (source contract)', () => {
  const ROUTES_SRC = fs.readFileSync(path.join(process.cwd(), 'src/landos/routes.ts'), 'utf8');
  const PI_SRC = fs.readFileSync(
    path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
    'utf8',
  );

  it('reconciles at the projection layer from category state, not hardcoded property text', () => {
    expect(ROUTES_SRC).toMatch(/reconcileMissingDiligence\(state, raw\)/);
    expect(ROUTES_SRC).not.toMatch(/Onionville/);
    expect(fs.readFileSync(path.join(process.cwd(), 'src/landos/missing-diligence-reconciliation.ts'), 'utf8')).not.toMatch(/Onionville|89525293|055689/);
  });

  it('renders the reconciled checklist with finding, unresolved, why, and next source', () => {
    for (const marker of ['Current finding', 'Still unresolved', 'Why it matters', 'Next source']) {
      expect(PI_SRC).toContain(marker);
    }
    expect(PI_SRC).toMatch(/Reconciled against accepted research/);
  });
});
