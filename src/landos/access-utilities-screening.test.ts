// Access, frontage and site-service screening — the six separated facts.
//
// The suite exists to hold two lines that keep collapsing in practice:
//
//   1. ACCESS is not FRONTAGE. A parcel plainly fronting a recognized road has
//      discovery-stage access even while the retained frontage figures
//      disagree, and a parcel reached by a recorded easement can have access
//      with no direct public-road frontage at all.
//   2. A SCREEN is not a DETERMINATION. The well outlook is not a yield study
//      and the septic outlook never predicts a passing perc test. Where the
//      readily available evidence does not carry an answer, the answer is
//      unknown and nothing further is implied.

import { describe, expect, it } from 'vitest';

import {
  existingImprovementStatement,
  frontageFeet,
  readAccess,
  readFrontage,
  readPublicSewer,
  readPublicWater,
  readSepticOutlook,
  readWellOutlook,
  type RetainedSoilUnit,
  type RetainedUtilityScreen,
} from './access-utilities-screening.js';

const reading = (raw: string, source: string) => ({ raw, feet: frontageFeet(raw), source });

const screen = (over: Partial<RetainedUtilityScreen> = {}): RetainedUtilityScreen => ({
  publicWater: 'unknown',
  publicSewer: 'unknown',
  researchAttempted: ['County GIS utility layer inventory'],
  screenedAt: '2026-08-19T12:00:00.000Z',
  ...over,
});

const soil = (over: Partial<RetainedSoilUnit> & { name: string }): RetainedSoilUnit => ({
  symbol: null,
  parcelPercentage: null,
  approximateAcres: null,
  ratings: [],
  drainageClass: null,
  limitingFactors: [],
  ...over,
});

describe('CASE A — access established while frontage conflicts', () => {
  const input = {
    landlockedStatus: 'No',
    frontageReadings: [reading('22.94 ft', 'landportal'), reading('50.00 ft', 'hermes_landportal_import')],
    parcelRecordRead: true,
  };

  it('establishes discovery-stage access from road abutment alone', () => {
    const access = readAccess(input);
    expect(access.established).toBe(true);
    expect(access.state).toBe('established');
    // Recorded-instrument work is later diligence, never a precondition here.
    expect(access.statement).toMatch(/later diligence/i);
  });

  it('reports the frontage conflict at its real values and never averages them', () => {
    const frontage = readFrontage(input);
    expect(frontage.state).toBe('conflicting');
    expect(frontage.feet).toBeNull();
    expect(frontage.statement).toMatch(/22\.94 ft \(landportal\) vs 50\.00 ft \(hermes_landportal_import\)/);
    expect(frontage.statement).not.toMatch(/36|average/i);
  });

  it('establishes frontage when the retained readings agree', () => {
    const frontage = readFrontage({
      landlockedStatus: 'No',
      frontageReadings: [reading('50 ft', 'landportal'), reading('50.00 ft', 'hermes_landportal_import')],
    });
    expect(frontage.state).toBe('established');
    expect(frontage.feet).toBe(50);
  });
});

describe('access is answered independently of public-road frontage', () => {
  it('accepts a recorded easement with no direct frontage', () => {
    const access = readAccess({
      landlockedStatus: 'No',
      frontageReadings: [],
      recordedAccessRight: 'a recorded 50 ft ingress/egress easement',
    });
    expect(access.established).toBe(true);
    expect(readFrontage({ frontageReadings: [], parcelRecordRead: true }).state).toBe('unresolved');
  });

  it('refuses access when the parcel record affirmatively flags land-locked', () => {
    const access = readAccess({ landlockedStatus: 'Yes', frontageReadings: [reading('0 ft', 'landportal')] });
    expect(access.established).toBe(false);
    expect(access.landlocked).toBe(true);
  });
});

describe('public water and public sewer are screened separately', () => {
  it('reports an unscreened service as not screened, not as unavailable', () => {
    expect(readPublicWater(null).state).toBe('not_screened');
    expect(readPublicSewer(null).state).toBe('not_screened');
  });

  it('lets water be available while sewer is not', () => {
    const both = screen({ publicWater: 'mapped_available', publicSewer: 'unlikely' });
    expect(readPublicWater(both).state).toBe('available');
    expect(readPublicSewer(both).state).toBe('unresolved');
    // Absence of a mapped line is never stated as proof service is unavailable.
    expect(readPublicSewer(both).statement).toMatch(/not proof service is unavailable/i);
  });

  it('names the official sources the screen actually opened', () => {
    const read = readPublicWater(screen({ researchAttempted: ['Williamson County GIS service catalog'] }));
    expect(read.sourcesChecked).toEqual(['Williamson County GIS service catalog']);
  });
});

describe('CASE B / C / E — the private well outlook', () => {
  it('CASE B — established public water needs no well research at all', () => {
    const water = readPublicWater(screen({ publicWater: 'mapped_available' }));
    const well = readWellOutlook(water, null);
    expect(well.category).toBe('not_needed');
    expect(well.statement).toMatch(/public water appears available/i);
  });

  it('CASE C — nearby well context readily available returns a simple outlook', () => {
    const water = readPublicWater(screen());
    const favorable = readWellOutlook(water, {
      nearbyRecordCount: 12, typicalDepthRangeFt: [200, 300], groundwaterNote: null,
      source: 'State well completion records', sourceUrl: null,
    });
    expect(favorable.category).toBe('favorable');
    expect(favorable.statement).toMatch(/roughly 200–300 ft/);

    const moderate = readWellOutlook(water, {
      nearbyRecordCount: 6, typicalDepthRangeFt: [300, 550], groundwaterNote: null,
      source: 'State well completion records', sourceUrl: null,
    });
    expect(moderate.category).toBe('moderate');

    const difficult = readWellOutlook(water, {
      nearbyRecordCount: 4, typicalDepthRangeFt: [600, 900], groundwaterNote: null,
      source: 'State well completion records', sourceUrl: null,
    });
    expect(difficult.category).toBe('difficult');
  });

  it('CASE E — no readily available well records returns unknown and implies no further search', () => {
    const well = readWellOutlook(readPublicWater(screen()), null);
    expect(well.category).toBe('unknown');
    expect(well.statement).toMatch(/screening gap, not evidence that a well is difficult/i);
  });
});

describe('CASE D / E — the preliminary septic outlook', () => {
  it('is not needed when public sewer is established', () => {
    const sewer = readPublicSewer(screen({ publicSewer: 'mapped_available' }));
    expect(readSepticOutlook(sewer, []).category).toBe('not_needed');
  });

  it('CASE D — multiple retained soil units all contribute to the screen', () => {
    const sewer = readPublicSewer(screen());
    const outlook = readSepticOutlook(sewer, [
      soil({ symbol: 'MvC2', name: 'Mountview silt loam', ratings: ['not_limited'], parcelPercentage: 60 }),
      soil({ symbol: 'DcD', name: 'Dickson silt loam', ratings: ['very_limited'], parcelPercentage: 40 }),
    ]);
    expect(outlook.category).toBe('mixed');
    expect(outlook.statement).toContain('MvC2');
    expect(outlook.statement).toContain('DcD');
    expect(outlook.favorableSharePct).toBe(60);
    expect(outlook.limitedSharePct).toBe(40);
  });

  it('screens favorable only when every rated unit screens favorably', () => {
    const sewer = readPublicSewer(screen());
    expect(readSepticOutlook(sewer, [
      soil({ name: 'A', ratings: ['not_limited'] }),
      soil({ name: 'B', ratings: ['not_limited'] }),
    ]).category).toBe('favorable');
    expect(readSepticOutlook(sewer, [
      soil({ name: 'A', ratings: ['very_limited'] }),
      soil({ name: 'B', ratings: ['very_limited'] }),
    ]).category).toBe('poor');
  });

  it('CASE E — no retained soil evidence returns unknown, never a manufactured finding', () => {
    const outlook = readSepticOutlook(readPublicSewer(screen()), []);
    expect(outlook.category).toBe('unknown');
    expect(outlook.statement).toMatch(/No subject soil information is retained/i);
  });

  it('says so plainly when parcel shares are not retained', () => {
    const outlook = readSepticOutlook(readPublicSewer(screen()), [
      soil({ symbol: 'MvC2', name: 'Mountview silt loam', ratings: ['somewhat_limited'] }),
    ]);
    expect(outlook.favorableSharePct).toBeNull();
    expect(outlook.statement).toMatch(/parcel shares are not retained/i);
  });

  it('never claims a perc test will pass, at any outlook', () => {
    const sewer = readPublicSewer(screen());
    for (const units of [
      [soil({ name: 'A', ratings: ['not_limited'] })],
      [soil({ name: 'A', ratings: ['somewhat_limited'] })],
      [soil({ name: 'A', ratings: ['very_limited'] })],
      [],
    ]) {
      const statement = readSepticOutlook(sewer, units).statement;
      expect(statement).toMatch(/Screening only/);
      expect(statement).not.toMatch(/will pass|passes a perc|guaranteed|approved for septic/i);
    }
  });
});

describe('CASE F — an existing well or septic stays labeled by its basis', () => {
  it('keeps a seller statement seller-reported until it is independently verified', () => {
    expect(existingImprovementStatement({
      kind: 'septic', present: true, detail: 'Installed around 2009 and in use.',
      basis: 'seller_reported', reportedAt: '2026-08-19T12:00:00.000Z',
    })).toBe('Existing septic: seller reported — not independently verified. Installed around 2009 and in use.');
  });

  it('distinguishes an official record from a seller statement', () => {
    expect(existingImprovementStatement({
      kind: 'well', present: true, detail: null, basis: 'official_record', reportedAt: null,
    })).toMatch(/established from an official record/);
  });
});
