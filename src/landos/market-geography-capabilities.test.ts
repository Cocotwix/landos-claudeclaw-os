// Geography-scoped market capabilities — placements over the existing Market
// Matrix / Market Pulse engines behind the shared capability contract.
//
// The defect class guarded here: market questions being gated on a parcel (or
// quietly manufacturing a property subject), and standalone market runs
// fabricating numbers where retained data is absent.

import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  capabilityPrerequisites,
  invokeRuntimeCapability,
  listRuntimeCapabilities,
} from './capability-registry.js';
import {
  COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
  MARKET_PULSE_CAPABILITY_ID,
  ZIP_MARKET_RESEARCH_CAPABILITY_ID,
  parseGeographyInput,
} from './market-geography-capabilities.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import type { MarketPulseRead } from './market-pulse-read.js';

beforeEach(() => { _initTestLandosDb(); });

function matrixResolution(overrides: Partial<MarketMatrixResolution>): MarketMatrixResolution {
  return {
    matchLevel: 'unavailable', available: false,
    geography: {}, resolvedKey: null, resolvedKeyLabel: null,
    acreageBandRequested: 'all', acreageBandUsed: null, side: 'sold', period: null,
    confidence: null, source: null, provider: null,
    staleness: { label: 'unknown', quartersOld: null, isStale: false },
    facts: { pricePerAcre: null, daysOnMarket: null, sellThroughRate: null, populationGrowth: null, liquidity: null },
    metrics: null, talkingPoints: [], note: '',
    ...overrides,
  };
}

function pulseRead(): MarketPulseRead {
  return {
    eligible: true,
    area: { county: 'Iredell', state: 'NC', descriptor: 'Iredell County, NC' },
    parcelVerified: false,
    label: 'Local Area Context, Not Parcel Verified',
    growth: { status: 'measured', direction: 'growing', populationRecent: 100, populationPrior: 90, pctChange: 11, years: [2018, 2023], source: 'U.S. Census ACS', note: 'measured' },
    countyPricePerAcre: { status: 'measured', medianPpa: 12000, sampleSize: 5, source: 'Retained land comps (pipeline)', note: 'measured' },
    zipPricePerAcre: null,
    developmentSignals: { status: 'source_available', source: 'search', note: 'available' },
    plainEnglish: 'The area is growing.',
    disclaimer: 'area context',
    generatedAt: new Date().toISOString(),
  };
}

describe('operator manifest', () => {
  it('every registered capability declares an operator manifest with an input hint', () => {
    for (const metadata of listRuntimeCapabilities()) {
      expect(metadata.operator, metadata.id).toBeDefined();
      expect(metadata.operator!.inputHint.trim().length, metadata.id).toBeGreaterThan(0);
      expect(typeof metadata.operator!.manualInvocation, metadata.id).toBe('boolean');
      expect(typeof metadata.operator!.runsWithoutDeal, metadata.id).toBe('boolean');
      expect(typeof metadata.operator!.writesAuthoritativeEvidence, metadata.id).toBe('boolean');
    }
  });

  it('the market tools are manual and deal-free; deal-only capabilities are not manual', () => {
    const byId = new Map(listRuntimeCapabilities().map((m) => [m.id, m]));
    for (const id of [COUNTY_MARKET_RESEARCH_CAPABILITY_ID, ZIP_MARKET_RESEARCH_CAPABILITY_ID, MARKET_PULSE_CAPABILITY_ID]) {
      expect(byId.get(id)!.operator).toMatchObject({ manualInvocation: true, runsWithoutDeal: true });
    }
    expect(byId.get('utility-service-screen')!.operator!.manualInvocation).toBe(false);
    expect(byId.get('acquisition-intelligence')!.operator!.manualInvocation).toBe(false);
  });
});

describe('registry declarations', () => {
  it('registers the three market capabilities with geography prerequisites', () => {
    const ids = listRuntimeCapabilities().map((m) => m.id);
    expect(ids).toContain(COUNTY_MARKET_RESEARCH_CAPABILITY_ID);
    expect(ids).toContain(ZIP_MARKET_RESEARCH_CAPABILITY_ID);
    expect(ids).toContain(MARKET_PULSE_CAPABILITY_ID);
    expect(capabilityPrerequisites(COUNTY_MARKET_RESEARCH_CAPABILITY_ID)).toEqual(['county']);
    expect(capabilityPrerequisites(ZIP_MARKET_RESEARCH_CAPABILITY_ID)).toEqual(['zip']);
    expect(capabilityPrerequisites(MARKET_PULSE_CAPABILITY_ID)).toEqual(['county']);
  });
});

describe('parseGeographyInput', () => {
  it('parses a bare ZIP', () => {
    expect(parseGeographyInput('28115')).toEqual({ zip: '28115' });
    expect(parseGeographyInput(' 28115-1234 ')).toEqual({ zip: '28115' });
  });
  it('parses "County, ST" and drops the County suffix engines re-render', () => {
    expect(parseGeographyInput('Iredell County, NC')).toEqual({ county: 'Iredell', state: 'NC' });
    expect(parseGeographyInput('iredell county, nc')).toEqual({ county: 'iredell', state: 'NC' });
  });
  it('falls back to a bare county name', () => {
    expect(parseGeographyInput('Iredell')).toEqual({ county: 'Iredell' });
  });
});

describe('county market research', () => {
  it('refuses to run with only a ZIP — the declared prerequisite is a county', async () => {
    await expect(invokeRuntimeCapability({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', zip: '28115' },
    })).rejects.toThrow(/county/i);
  });

  it('never demands a parcel and returns engine-backed matrix data through the contract', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:county-market-research' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Iredell', state: 'NC' },
    }, {
      resolveMatrix: (input) => matrixResolution({
        matchLevel: 'county', available: true, side: input.side ?? 'sold',
        geography: { state: 'NC', county: 'Iredell County', fips: '37097' },
        resolvedKey: 'county:37097', resolvedKeyLabel: 'Iredell County (all acreage)',
        period: '2026Q2', source: 'Market Matrix', provider: 'landos',
      }),
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject?.kind).toBe('research_session');
    const facts = result.facts as { outcome: string; sold: { resolution: { available: boolean } } };
    expect(facts.outcome).toBe('market_data_returned');
    expect(facts.sold.resolution.available).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.missingInformation).toEqual([]);
  });

  it('reports an honest data gap instead of fabricating numbers', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Nowhere', state: 'ZZ' },
    }, { resolveMatrix: () => matrixResolution({}) });
    expect(result.status).toBe('SUCCEEDED');
    const facts = result.facts as { outcome: string };
    expect(facts.outcome).toBe('no_retained_market_data');
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(result.evidence).toEqual([]);
  });
});

describe('zip market research', () => {
  it('requires a ZIP and runs with a ZIP alone', async () => {
    await expect(invokeRuntimeCapability({
      capabilityId: ZIP_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Iredell', state: 'NC' },
    })).rejects.toThrow(/zip/i);

    const result = await invokeRuntimeCapability({
      capabilityId: ZIP_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', zip: '28115' },
    }, {
      resolveMatrix: (input) => matrixResolution({
        matchLevel: 'zip', available: true, side: input.side ?? 'sold',
        geography: { zip: '28115' }, resolvedKey: 'zip:28115', resolvedKeyLabel: 'ZIP 28115 (all acreage)',
        period: '2026Q2', source: 'Market Matrix', provider: 'landos',
      }),
    });
    expect(result.status).toBe('SUCCEEDED');
    const facts = result.facts as { outcome: string; geographyLabel: string };
    expect(facts.outcome).toBe('market_data_returned');
    expect(facts.geographyLabel).toBe('ZIP 28115');
  });
});

describe('market pulse', () => {
  it('returns the area-context pulse with retained county figures forwarded to the engine', async () => {
    let forwarded: unknown;
    const result = await invokeRuntimeCapability({
      capabilityId: MARKET_PULSE_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:market-pulse' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Iredell', state: 'NC' },
    }, {
      resolveMatrix: () => matrixResolution({
        matchLevel: 'county', available: true,
        resolvedKey: 'county:37097', resolvedKeyLabel: 'Iredell County (all acreage)', period: '2026Q2',
        source: 'Market Matrix', provider: 'landos',
        metrics: {
          salesCount: 40, listingCount: 10, medianPrice: 120000, medianPricePerAcre: 11500,
          daysOnMarket: 90, sellThroughRate: 60, absorptionRate: null, monthsOfSupply: null,
          population: 200000, populationDensity: null, populationGrowth: 4.2, salesDensity: null,
        },
      }),
      fetchAreaPulse: async (input) => { forwarded = input.retainedCounty; return pulseRead(); },
    });
    expect(result.status).toBe('SUCCEEDED');
    expect((forwarded as { medianPricePerAcre: number }).medianPricePerAcre).toBe(11500);
    const facts = result.facts as { outcome: string; summary: string; pulse: { label: string } };
    expect(facts.outcome).toBe('area_context_returned');
    expect(facts.summary).toBe('The area is growing.');
    // A standalone geography pulse is NEVER parcel-attributed.
    expect(facts.pulse.label).toBe('Local Area Context, Not Parcel Verified');
  });

  it('requires a county', async () => {
    await expect(invokeRuntimeCapability({
      capabilityId: MARKET_PULSE_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', zip: '28115' },
    })).rejects.toThrow(/county/i);
  });
});

// Regression: same-label-different-basis (QA F1) — a statewide snapshot
// answering a county question must never be attributed as a county fact, and
// must never reach Market Pulse as "the retained county record".
describe('wider-basis honesty (Loving County regression)', () => {
  const statewide = () => matrixResolution({
    matchLevel: 'state', available: true,
    geography: { state: 'TX', county: 'Loving County' },
    resolvedKey: 'state:TX', resolvedKeyLabel: 'TX statewide (all acreage)',
    period: '2026-Q3', source: 'Market Matrix', provider: 'landos',
    metrics: {
      salesCount: 29074, listingCount: 100, medianPrice: 300000, medianPricePerAcre: 82688,
      daysOnMarket: 120, sellThroughRate: 50, absorptionRate: null, monthsOfSupply: null,
      population: 30188424, populationDensity: null, populationGrowth: 5.1, salesDensity: null,
    },
  });

  it('market pulse withholds a statewide snapshot from the retained-county slot', async () => {
    let forwarded: unknown = 'unset';
    const result = await invokeRuntimeCapability({
      capabilityId: MARKET_PULSE_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Loving', state: 'TX' },
      mode: 'refresh',
    }, {
      resolveMatrix: statewide,
      fetchAreaPulse: async (input) => { forwarded = input.retainedCounty; return pulseRead(); },
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(forwarded).toBeNull();
  });

  it('county market research states the county gap plainly when only a wider basis exists', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', county: 'Loving', state: 'TX' },
      mode: 'refresh',
    }, { resolveMatrix: statewide });
    const facts = result.facts as { outcome: string; summary: string };
    expect(facts.outcome).toBe('wider_basis_returned');
    expect(facts.summary).toMatch(/NO county-level market data/);
    expect(facts.summary).toMatch(/never a county fact/);
    expect(result.missingInformation.join(' ')).toMatch(/No county-level snapshot is retained/);
  });

  it('zip market research states the ZIP gap when only county/state coverage exists', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: ZIP_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ', zip: '79754' },
      mode: 'refresh',
    }, {
      resolveMatrix: () => matrixResolution({
        matchLevel: 'county', available: true,
        resolvedKey: 'county:48301', resolvedKeyLabel: 'Loving County (all acreage)',
        period: '2026-Q3', source: 'Market Matrix', provider: 'landos',
      }),
    });
    const facts = result.facts as { outcome: string; summary: string };
    expect(facts.outcome).toBe('wider_basis_returned');
    expect(result.missingInformation.join(' ')).toMatch(/No ZIP-level snapshot/);
  });
});

// Regression: canonical-state-partial-propagation (QA F4) — a repaired
// capability must never replay a retained pre-repair run. Reuse is scoped to
// the contract version that recorded the run.
describe('version-scoped reuse (F4 regression)', () => {
  it('reuses a retained run under the same contract version, never under another', async () => {
    const request = {
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' as const },
      subject: { kind: 'geography' as const, entity: 'TY_LAND_BIZ' as const, county: 'Iredell', state: 'NC' },
    };
    const runtime = {
      resolveMatrix: () => matrixResolution({
        matchLevel: 'county', available: true,
        resolvedKey: 'county:37097', resolvedKeyLabel: 'Iredell County (all acreage)',
        period: '2026Q2', source: 'Market Matrix', provider: 'landos',
      }),
    };
    const first = await invokeRuntimeCapability(request, runtime);
    expect(first.execution.reused).toBe(false);
    const second = await invokeRuntimeCapability(request, runtime);
    expect(second.execution.reused).toBe(true);
    // The same retained row is invisible to any OTHER contract version.
    const { CapabilityInvocationStore } = await import('./capability-store.js');
    const { capabilityIdempotencyKey } = await import('./capability-contract.js');
    const key = capabilityIdempotencyKey({ ...request, mode: 'reuse' });
    const store = new CapabilityInvocationStore();
    expect(store.findReusable(COUNTY_MARKET_RESEARCH_CAPABILITY_ID, key, '1.1.0')).not.toBeNull();
    expect(store.findReusable(COUNTY_MARKET_RESEARCH_CAPABILITY_ID, key, '1.0.0')).toBeNull();
  });
});

describe('geography subject envelope', () => {
  it('an empty geography subject is refused with a plain message', async () => {
    await expect(invokeRuntimeCapability({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'geography', entity: 'TY_LAND_BIZ' },
    })).rejects.toThrow(/county, ZIP, or county FIPS/);
  });
});
