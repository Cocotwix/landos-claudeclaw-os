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
  legalAccessRoad: null,
  corridorRightsUnresolved: false,
  septicOutlookLabel: null,
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
    expect(text).toMatch(/road abutment must be established by parcel evidence/i);
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

describe('verified recorded access rule', () => {
  const accessState = () => screenedState({ legalAccessRoad: 'Onionville Road', corridorRightsUnresolved: true });

  it('displays recorded legal access as verified and keeps physical dimensions separate', () => {
    const result = reconcileMissingDiligence(accessState(), [...STALE_MESSAGES, ...ACCESS_DUPLICATES]);
    const access = result.items.find((item) => item.key === 'access');
    expect(access?.currentFinding).toMatch(/Recorded legal access: verified via Onionville Road/);
    expect(access?.shortStatus).toMatch(/Recorded legal access: verified/);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/driveway (?:approval|permit)/i);
    expect(text).not.toMatch(/public right[- ]of[- ]way contact/i);
    expect(text).not.toMatch(/physical \/? ?driveway access/i);
    expect(text).not.toMatch(/legal access unresolved/i);
  });

  it('keeps only genuine access follow-ups: survey, corridor rights, easements', () => {
    const access = reconcileMissingDiligence(accessState(), []).items.find((item) => item.key === 'access');
    expect(access?.stillUnresolved).toMatch(/surveyed frontage/i);
    expect(access?.stillUnresolved).toMatch(/corridor/i);
    expect(access?.stillUnresolved).toMatch(/easements/i);
    expect(access?.urgent).toBe(false);
  });

  it('every item carries compact row fields and the urgent set is small', () => {
    const result = reconcileMissingDiligence(accessState(), []);
    for (const item of result.items) {
      expect(item.shortStatus.length).toBeGreaterThan(0);
      expect(item.shortNext.length).toBeGreaterThan(0);
    }
    const urgent = result.items.filter((item) => item.urgent);
    expect(urgent.length).toBeGreaterThan(0);
    expect(urgent.length).toBeLessThanOrEqual(3);
  });

  it('surfaces a grounded septic outlook in the septic row when retained', () => {
    const result = reconcileMissingDiligence(
      screenedState({ legalAccessRoad: 'Onionville Road', septicOutlookLabel: 'Low preliminary likelihood (conventional system)' }),
      [],
    );
    const septic = result.items.find((item) => item.key === 'septic');
    expect(septic?.currentFinding).toMatch(/Low preliminary likelihood/);
    expect(septic?.currentFinding).toMatch(/no perc test exists yet/);
    expect(septic?.shortNext).toMatch(/Perc test/);
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

// ── Missing information derives from the ACCEPTED comp/valuation record ──────
//
// The named contradiction: a card showing accepted vacant-land sales while
// another section says no usable comp survived, or that another sale is still
// required. Both statements are historical conclusions the current accepted
// records disprove, so they are superseded here rather than rendered.

describe('missing information is derived from the accepted comp record', () => {
  const ACCEPTED = screenedState({ acceptedSoldComps: 5, acceptedActiveComps: 2, acceptedAskingReferences: 1 });

  it('supersedes "no usable comp survived" when accepted closed sales are retained', () => {
    const result = reconcileMissingDiligence(ACCEPTED, [
      'No usable comparable survived the selection filters.',
    ]);
    expect(JSON.stringify(result.items)).not.toMatch(/no usable comparable survived/i);
    expect(result.passthrough).toHaveLength(0);
    expect(result.supersededByAcceptedRecords).toHaveLength(1);
    expect(result.supersededByAcceptedRecords[0].supersededBy).toMatch(/5 accepted closed sale\(s\)/);
  });

  it('supersedes "another sale is still required" against the same accepted record', () => {
    const result = reconcileMissingDiligence(ACCEPTED, [
      'Another closed sale is still required before a value can be stated.',
    ]);
    expect(result.supersededByAcceptedRecords).toHaveLength(1);
    // Nothing vanishes silently: the statement is retained with its reason.
    expect(result.supersededByAcceptedRecords[0].statement).toMatch(/Another closed sale/);
  });

  it('the valuation item reflects the accepted sales instead of denying them', () => {
    const item = reconcileMissingDiligence(ACCEPTED, []).items.find((i) => i.key === 'valuation')!;
    expect(item.currentFinding).toMatch(/5 accepted closed in-band sale\(s\) are retained/);
    expect(item.currentFinding).not.toMatch(/no accepted closed in-band vacant-land sale/i);
    expect(item.shortStatus).toBe('5 closed sale(s), value not yet reconciled');
  });

  it('with NO accepted sales the honest asking-only wording is preserved', () => {
    const state = screenedState({ acceptedSoldComps: 0, acceptedActiveComps: 3, acceptedAskingReferences: 4 });
    const item = reconcileMissingDiligence(state, []).items.find((i) => i.key === 'valuation')!;
    expect(item.currentFinding).toMatch(/4 asking-market reference\(s\) and 3 active competitor\(s\)/);
    expect(item.currentFinding).toMatch(/no accepted closed in-band vacant-land sale yet/);
    expect(item.shortStatus).toBe('Not priceable yet');
  });

  it('does NOT supersede a comp statement the current record cannot disprove', () => {
    const state = screenedState({ acceptedSoldComps: 0, acceptedActiveComps: 0, acceptedAskingReferences: 0 });
    const result = reconcileMissingDiligence(state, ['No usable comparable survived the selection filters.']);
    expect(result.supersededByAcceptedRecords).toHaveLength(0);
    // Genuine uncertainty is never deleted on a guess.
    expect(JSON.stringify(result)).toMatch(/No usable comparable survived/);
  });

  it('degrades honestly when a caller has not wired the canonical counts yet', () => {
    const item = reconcileMissingDiligence(screenedState(), []).items.find((i) => i.key === 'valuation')!;
    expect(item.currentFinding).toBe('No comparable evidence is retained yet.');
    expect(item.shortStatus).toBe('Not priceable yet');
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
