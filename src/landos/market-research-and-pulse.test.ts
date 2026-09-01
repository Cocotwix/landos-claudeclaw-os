import { describe, expect, it } from 'vitest';

import {
  admitPulseClaim,
  buildMarketPulsePlan,
  buildMarketResearchAndPulse,
  type MarketPulseClaim,
} from './market-research-and-pulse.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import type { AcreageBand } from './market-matrix.js';

// Stage 0's decisive defect was a LABEL, not a number: the county's
// fastest-selling band rendered under the heading "Subject band" because the
// panel labelled records by array index after filtering the unavailable one
// away. Every record here carries its role at construction, so that failure has
// nowhere to happen.

const emptyMetrics = () => ({
  salesCount: null, listingCount: null, medianPrice: null, medianPricePerAcre: null,
  daysOnMarket: null, sellThroughRate: null, absorptionRate: null, monthsOfSupply: null,
  population: null, populationDensity: null, populationGrowth: null, salesDensity: null,
});

function resolution(overrides: Partial<MarketMatrixResolution> = {}): MarketMatrixResolution {
  return {
    matchLevel: 'county',
    available: true,
    geography: { state: 'ZZ', county: 'Example', fips: '99001', zip: '00000' },
    resolvedKey: 'county:99001',
    resolvedKeyLabel: 'Example County (1–2 acres)',
    acreageBandRequested: '1-2',
    acreageBandUsed: '1-2',
    bandFallback: null,
    side: 'sold',
    period: '2026-Q3',
    confidence: 'high',
    source: 'LandPortal Market Research',
    provider: 'LandPortal',
    staleness: { label: 'Current quarter', quartersOld: 0, isStale: false },
    facts: { pricePerAcre: 28008, daysOnMarket: 37, sellThroughRate: 71.43, populationGrowth: null, liquidity: 'moderate' },
    metrics: { ...emptyMetrics(), salesCount: 20, medianPricePerAcre: 28008, daysOnMarket: 37.02, sellThroughRate: 71.43, monthsOfSupply: 17.03 },
    talkingPoints: [],
    note: 'Resolved via County match (Example County) from the Market Matrix (master market database).',
    ...overrides,
  };
}

function unavailable(note = 'No Market Matrix snapshot for this area.'): MarketMatrixResolution {
  return resolution({
    matchLevel: 'unavailable', available: false, resolvedKey: null, resolvedKeyLabel: null,
    acreageBandUsed: null, period: null, confidence: null, source: null, provider: null,
    metrics: null, staleness: { label: 'No snapshot', quartersOld: null, isStale: false }, note,
  });
}

function ladderRung(band: AcreageBand, sellThroughRate: number, salesCount = 20): MarketMatrixResolution {
  return resolution({
    acreageBandRequested: band,
    acreageBandUsed: band,
    resolvedKeyLabel: `Example County (${band} acres)`,
    metrics: { ...emptyMetrics(), salesCount, sellThroughRate, medianPricePerAcre: 14526, daysOnMarket: 93 },
  });
}

const geography = {
  county: 'Example', fips: '99001', state: 'ZZ', zip: '00000',
  acres: 1.5, subjectVersion: 'iv:137:v2',
};

const build = (overrides: Partial<Parameters<typeof buildMarketResearchAndPulse>[0]> = {}) =>
  buildMarketResearchAndPulse({
    dealCardId: 501,
    geography,
    subjectBand: resolution(),
    countyContext: resolution(),
    zipContext: null,
    bandLadder: [ladderRung('1-2', 71.43), ladderRung('10-20', 131.25), ladderRung('2-5', 83.33)],
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  });

describe('named record slots', () => {
  it('carries the subject band in its own slot with its sample, basis and dates', () => {
    const market = build();
    expect(market.subjectBand.role).toBe('subject_band');
    expect(market.subjectBand.bandUsed).toBe('1-2');
    expect(market.subjectBand.sampleCount).toBe(20);
    expect(market.subjectBand.medianPricePerAcre).toBe(28008);
    expect(market.subjectBand.daysOnMarket).toBe(37.02);
    expect(market.subjectBand.sellThroughRate).toBe(71.43);
    expect(market.subjectBand.monthsOfSupply).toBe(17.03);
    expect(market.subjectBand.period).toBe('2026-Q3');
    expect(market.subjectBand.pricePerAcreBasis).toContain('20 closed sales');
    expect(market.subjectBand.pricePerAcreBasis).toContain('not a valuation of this parcel');
  });

  it('labels the fastest-selling band as most liquid and never as the subject band', () => {
    const market = build();
    expect(market.mostLiquidBand?.role).toBe('most_liquid_band');
    expect(market.mostLiquidBand?.bandUsed).toBe('10-20');
    expect(market.subjectBand.bandUsed).toBe('1-2');
    expect(market.mostLiquidBand?.limitations.join(' ')).toContain('not the subject\'s band');
  });

  it('leaves the subject slot unavailable rather than promoting another band into it', () => {
    const market = build({ subjectBand: unavailable('No record carried the subject band.') });
    expect(market.subjectBand.available).toBe(false);
    expect(market.subjectBand.role).toBe('subject_band');
    expect(market.subjectBand.bandUsed).toBeNull();
    expect(market.mostLiquidBand?.bandUsed).toBe('10-20');
    expect(market.story.headline).toContain('no market record answered');
  });

  it('never offers the subject\'s own band as its most liquid contrast', () => {
    const market = build({ bandLadder: [ladderRung('1-2', 99)] });
    expect(market.mostLiquidBand).toBeNull();
  });
});

describe('honesty about which population answered', () => {
  it('carries a band fallback as a stated limitation', () => {
    const market = build({
      subjectBand: resolution({
        acreageBandRequested: '1-2',
        acreageBandUsed: '2-5',
        bandFallback: { from: '1-2', to: '2-5', why: 'No county record carried real activity for the 1–2 acre band.' },
      }),
    });
    expect(market.subjectBand.limitations.join(' ')).toContain('No county record carried real activity');
  });

  it('says plainly when a wider geography carried the record', () => {
    const market = build({
      subjectBand: resolution({ matchLevel: 'state', resolvedKeyLabel: 'ZZ statewide' }),
    });
    expect(market.subjectBand.limitations.join(' ')).toContain('wider population than the subject');
  });

  it('explains sell-through above 100% instead of reading it as demand', () => {
    const market = build({ subjectBand: ladderRung('1-2', 131.25) });
    expect(market.subjectBand.limitations.join(' ')).toContain('more parcels closed than were listed');
  });

  it('flags a thin sample', () => {
    const market = build({ subjectBand: ladderRung('1-2', 50, 3) });
    expect(market.subjectBand.limitations.join(' ')).toContain('sample is thin');
  });
});

describe('the Market Pulse plan', () => {
  it('plans every Stage 3 pulse topic with geography, primary sources and fallbacks', () => {
    const market = build();
    expect(market.pulsePlan.map((entry) => entry.key)).toEqual([
      'local_development', 'infrastructure', 'land_use_change', 'announced_projects',
      'demand_direction', 'active_competition', 'local_conditions',
    ]);
    for (const question of market.pulsePlan) {
      expect(question.geography).toContain('Example County');
      expect(question.sources.some((source) => source.kind === 'primary')).toBe(true);
      expect(question.boundedActions).toBeGreaterThan(0);
      expect(question.status).toBe('planned');
      // Nothing in the plan may need a purchase, an account or a credential.
      for (const source of question.sources) expect(source.authorized).toBe(true);
    }
  });

  it('asks each question the way an operator would type it', () => {
    const plan = buildMarketPulsePlan({ county: 'Example County', state: 'ZZ', zip: '00000', claims: [] });
    expect(plan[0].question).toBe('What new residential or land development is happening in Example County, ZZ right now?');
  });

  it('marks a topic answered once an admitted claim carries it', () => {
    const claim: MarketPulseClaim = {
      claimId: 'pulse:1', topicKey: 'announced_projects', topic: 'pulse.announced_projects',
      label: 'Announced projects', statement: 'A 400-job distribution centre was approved in June 2026.',
      value: null, standing: 'record_fact', weight: 'well_supported',
      source: { name: 'County commission minutes', url: null, tier: 'official_primary', retrievedAt: '2026-08-30T00:00:00.000Z', geography: 'Example County, ZZ', locator: 'June 2026 minutes' },
      asOf: '2026-06-01',
    };
    const market = build({ pulseClaims: [claim] });
    expect(market.pulseClaims).toHaveLength(1);
    expect(market.pulsePlan.find((entry) => entry.key === 'announced_projects')?.status).toBe('answered');
  });
});

describe('pulse claim admission', () => {
  const base: MarketPulseClaim = {
    claimId: 'pulse:1', topicKey: 'local_development', topic: 'pulse.local_development',
    label: 'Local development', statement: 'Three subdivisions were platted this year.',
    value: null, standing: 'record_fact', weight: 'likely',
    source: { name: 'Planning department', url: null, tier: 'official_primary', retrievedAt: '2026-08-30T00:00:00.000Z', geography: 'Example County, ZZ', locator: null },
    asOf: '2026-08-01',
  };

  it('admits a claim carrying source, date, geography and standing', () => {
    expect(admitPulseClaim(base)).toHaveProperty('admitted');
  });

  it('refuses a claim missing its date or its geography rather than publishing a hole', () => {
    const noDate = { ...base, asOf: null, source: { ...base.source, retrievedAt: null } };
    const noGeo = { ...base, source: { ...base.source, geography: null } };
    expect(admitPulseClaim(noDate)).toMatchObject({ refused: { reason: expect.stringContaining('a date') } });
    expect(admitPulseClaim(noGeo)).toMatchObject({ refused: { reason: expect.stringContaining('geography') } });
  });

  it('refuses a claim with no usable fact-versus-inference status', () => {
    const noStanding = { ...base, standing: 'official_legal_fact' as const };
    expect(admitPulseClaim(noStanding)).toMatchObject({
      refused: { reason: expect.stringContaining('fact-versus-inference') },
    });
    const blank = { ...base, standing: '' as unknown as MarketPulseClaim['standing'] };
    expect(admitPulseClaim(blank)).toMatchObject({
      refused: { reason: expect.stringContaining('fact-versus-inference') },
    });
  });

  it('admits an inference as an inference', () => {
    expect(admitPulseClaim({ ...base, standing: 'analytical_hypothesis' })).toHaveProperty('admitted');
    expect(admitPulseClaim({ ...base, standing: 'verification_need' })).toHaveProperty('admitted');
  });

  it('reports refusals on the product instead of dropping them silently', () => {
    const market = build({ pulseClaims: [{ ...base, source: { ...base.source, geography: null } }] });
    expect(market.pulseClaims).toHaveLength(0);
    expect(market.pulseClaimsRefused).toHaveLength(1);
  });
});

describe('the Market Story', () => {
  it('leads with the subject\'s own band and states what it does not know', () => {
    const market = build();
    expect(market.story.headline).toContain('1–2 acres');
    expect(market.story.headline).toContain('20 recorded sale(s)');
    expect(market.story.liquidityRead).toContain('37 median days on market');
    expect(market.story.demandRead).toContain('Market Pulse question');
    expect(market.story.competitionRead).toContain('Market Pulse question');
    expect(market.story.limitations.join(' ')).toContain('7 of 7 Market Pulse questions are planned');
  });

  it('surfaces a ZIP-versus-county disagreement rather than averaging it', () => {
    const market = build({
      zipContext: resolution({
        matchLevel: 'zip', resolvedKey: 'zip:00000', resolvedKeyLabel: 'ZIP 00000',
        metrics: { ...emptyMetrics(), salesCount: 12, medianPricePerAcre: 55896, daysOnMarket: 37.02, sellThroughRate: 71.43 },
      }),
    });
    const priceConflict = market.conflicts.find((entry) => entry.topic === 'market.price_per_acre');
    expect(priceConflict).toBeTruthy();
    expect(priceConflict?.sides.map((side) => side.value)).toEqual(expect.arrayContaining(['55896', '28008']));
  });

  it('always states the collection\'s own scope limitation', () => {
    expect(build().limitations.join(' ')).toContain('vacant land only, sold side, trailing twelve months');
  });
});

describe('stability of the reading', () => {
  it('produces the same fingerprint for the same market evidence', () => {
    expect(build().inputFingerprint).toBe(build().inputFingerprint);
  });

  it('moves the fingerprint when the market record genuinely changes', () => {
    const moved = build({
      subjectBand: resolution({ metrics: { ...emptyMetrics(), salesCount: 21, medianPricePerAcre: 29000 } }),
    });
    expect(moved.inputFingerprint).not.toBe(build().inputFingerprint);
  });
});
