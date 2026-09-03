import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY_WALL_CLOCK_RESERVE_MS,
  MIN_DISCOVERY_WALL_CLOCK_MS,
  discoveredArcgisSeeds,
  discoveryWallClockBudgetMs,
  expandSeedsWithContextProbe,
} from './official-parcel-gis-run.js';
import { EscalationLadder } from './gis-escalation.js';
import type { OfficialSourceDiscoveryResult } from './official-source-discovery.js';

// After every configured or statewide seed answers not_found, the discovered
// official county parcel service must join the same ArcGIS query ladder.
// Fixture only: a Hamilton County, TN shaped discovery result.
const official = (url: string, label: string, status: 'official' | 'unverified' = 'official') => ({
  url, label, method: 'arcgis_org_search' as const, sourceType: 'gis' as const,
  officiality: { status, score: status === 'official' ? 1 : 0.3, evidence: [] },
});

describe('discovered county parcel services join the ArcGIS ladder after a statewide not_found', () => {
  it('selects the discovered official MapServer/FeatureServer layers the ladder has not tried, official ones only, selected first', () => {
    const discovery: OfficialSourceDiscoveryResult = {
      selected: official('https://mapsdev.hamiltontn.gov/hcwa03/rest/services/Live_Parcels/MapServer/0', 'Live Parcels'),
      candidates: [
        official('https://services2.arcgis.com/x/arcgis/rest/services/Hamilton_County_Zoning/FeatureServer', 'Zoning (unverified)', 'unverified'),
        official('https://mapsdev.hamiltontn.gov/hcwa03/rest/services/Live_Parcels/MapServer/0', 'Live Parcels'),
        official('https://gis.hamiltontn.gov/', 'GIS home'),
        official('https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0', 'Statewide'),
      ],
      competing: null, failure: null, methodsRun: ['arcgis_org_search'], notes: [],
    };
    const tried = [{ url: 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0/' }];
    const seeds = discoveredArcgisSeeds(discovery, tried);
    expect(seeds.map((seed) => seed.url)).toEqual(['https://mapsdev.hamiltontn.gov/hcwa03/rest/services/Live_Parcels/MapServer/0']);
    expect(seeds[0].label).toMatch(/discovered official source/);
    expect(discoveredArcgisSeeds(null, tried)).toEqual([]);
  });
});

// Discovery must never spend the clock the parcel query clauses need. The
// Hamilton County run proved the failure: discovery burned 86.9 s of a 90 s
// budget and only one where-clause ran before the ladder stopped.
describe('discovery cannot consume the query budget', () => {
  it('leaves the reserve for the query cascade and skips discovery when nothing is left', () => {
    expect(discoveryWallClockBudgetMs(90_000, 0, 40_000)).toBe(50_000);
    expect(discoveryWallClockBudgetMs(90_000, 30_000, 40_000)).toBe(20_000);
    // Late enough that discovery would starve the clauses: no discovery pass.
    expect(discoveryWallClockBudgetMs(90_000, 60_000, 40_000)).toBeLessThan(MIN_DISCOVERY_WALL_CLOCK_MS);
    expect(discoveryWallClockBudgetMs(90_000, 200_000, 40_000)).toBe(0);
    expect(DEFAULT_QUERY_WALL_CLOCK_RESERVE_MS).toBeGreaterThan(0);
  });

  it('stops the reserved stage at the lowered ceiling without stopping the run', () => {
    let clock = 0;
    const ladder = new EscalationLadder({ budget: { maxWallClockMs: 90_000 }, now: () => clock });
    ladder.beginStage('platform_fingerprint');
    ladder.reserveWallClockMs(40_000);
    clock = 30_000;
    expect(ladder.exhausted()).toBe(false);
    expect(ladder.remainingWallClockMs()).toBe(20_000);
    clock = 55_000;
    // The reserved ceiling is spent, so discovery must stop here...
    expect(ladder.exhausted()).toBe(true);
    // ...but the run itself is not over: the reserve belongs to the clauses.
    ladder.releaseWallClockReserve();
    expect(ladder.exhausted()).toBe(false);
    expect(ladder.remainingWallClockMs()).toBe(35_000);
    expect(ladder.report().stopReason).toBe('completed');
  });

  it('stops context probing at the reserved ceiling and leaves the query clock usable', async () => {
    let clock = 0;
    let requests = 0;
    const ladder = new EscalationLadder({ budget: { maxWallClockMs: 90_000 }, now: () => clock });
    ladder.beginStage('platform_fingerprint');
    ladder.reserveWallClockMs(40_000);

    await expandSeedsWithContextProbe(
      [{ url: 'https://gis.example-county.gov/', label: 'county GIS', origin: 'operator_supplied', priority: 0 }],
      {
        ladder,
        arcgis: {
          canRequest: () => !ladder.stageExhausted(),
          onRequest: () => ladder.noteRequest(),
          fetch: async (url) => {
            requests += 1;
            clock = 55_000;
            return { status: 404, contentType: 'text/plain', body: 'not found', url };
          },
        },
      },
    );

    // The first slow probe crossed the optional-work ceiling. No later context
    // request was allowed to burn more of the query reserve.
    expect(requests).toBe(1);
    expect(ladder.exhausted()).toBe(true);
    expect(ladder.report().stopReason).toBe('completed');
    ladder.releaseWallClockReserve();
    expect(ladder.exhausted()).toBe(false);
  });
});
