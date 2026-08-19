// The Utility Service Screen capability — bounded by construction.
//
// The official pass is injected here so the suite never touches the network.
// What it proves is the contract around that pass: one invocation, four
// answers, the well and septic outlooks gated on their public service, and no
// caller-supplied assertion about any of them.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import { persistSoilsSepticScreening } from './soils-septic-outlook.js';
import {
  UTILITY_SERVICE_SCREEN_CAPABILITY,
  UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
  persistWellContextScreening,
  type UtilityScreenLaneResult,
} from './utility-service-screen-capability.js';
import type { CapabilityInvocationRequest } from './capability-contract.js';

function subject(): { dealCardId: number; propertyCardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Utility screen subject — Map 12 Parcel 4' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Map 12 Parcel 4, Example County, TN',
    county: 'Example',
    state: 'TN',
    apn: '012-004.00-000',
    fips: '47999',
    acres: 22,
    verified: true,
    verificationSource: 'Official Example County assessor record',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { dealCardId: deal.id, propertyCardId: card.id };
}

const lane = (over: Partial<UtilityScreenLaneResult['screen']> = {}): UtilityScreenLaneResult => ({
  screen: {
    publicWater: 'unknown',
    publicSewer: 'unknown',
    researchAttempted: ['Example County GIS utility service catalog'],
    screenedAt: '2026-08-19T12:00:00.000Z',
    ...over,
  },
  evidence: [],
  attempted: [],
});

async function run(
  dealCardId: number,
  propertyCardId: number,
  result: UtilityScreenLaneResult,
) {
  const request: CapabilityInvocationRequest = {
    capabilityId: UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
    caller: { type: 'deal_card', ref: `deal:${dealCardId}:test` },
    subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId, dealCardId },
    mode: 'refresh',
  };
  return invokeRuntimeCapability(request, { runUtilityScreen: async () => result });
}

beforeEach(() => {
  _initTestLandosDb();
});

describe('utility service screen — registration and guardrails', () => {
  it('is registered so the manifest never reports these items as unowned', () => {
    expect(listRuntimeCapabilities().map((capability) => capability.id))
      .toContain(UTILITY_SERVICE_SCREEN_CAPABILITY_ID);
  });

  it('refuses caller-supplied utility, well or septic assertions', () => {
    const base = {
      capabilityId: UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
      caller: { type: 'deal_card' as const, ref: 'deal:1:test' },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: 1, dealCardId: 1 },
    };
    expect(() => UTILITY_SERVICE_SCREEN_CAPABILITY.validate({ ...base, context: { publicWater: 'available' } }))
      .toThrow(/cannot contain caller-supplied/i);
    expect(() => UTILITY_SERVICE_SCREEN_CAPABILITY.validate({ ...base, context: { nested: { septicOutlook: 'favorable' } } }))
      .toThrow(/cannot contain caller-supplied/i);
    expect(() => UTILITY_SERVICE_SCREEN_CAPABILITY.validate({ ...base, parameters: { publicSewer: 'available' } }))
      .toThrow(/does not accept caller-supplied/i);
  });
});

describe('utility service screen — one bounded pass, four answers', () => {
  it('answers water and sewer separately from one official pass', async () => {
    const { dealCardId, propertyCardId } = subject();
    let calls = 0;
    const request: CapabilityInvocationRequest = {
      capabilityId: UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${dealCardId}:test` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId, dealCardId },
      mode: 'refresh',
    };
    const result = await invokeRuntimeCapability(request, {
      runUtilityScreen: async () => { calls += 1; return lane({ publicWater: 'mapped_available', publicSewer: 'unlikely' }); },
    });
    expect(calls).toBe(1);
    expect(result.status).toBe('SUCCEEDED');
    expect((result.facts.publicWater as { state: string }).state).toBe('available');
    expect((result.facts.publicSewer as { state: string }).state).toBe('unresolved');
  });

  it('skips the well outlook entirely when public water is established', async () => {
    const { dealCardId, propertyCardId } = subject();
    const result = await run(dealCardId, propertyCardId, lane({ publicWater: 'mapped_available' }));
    const well = result.facts.wellOutlook as { category: string; applicable: boolean };
    expect(well.applicable).toBe(false);
    expect(well.category).toBe('not_needed');
  });

  it('returns an honest unknown well outlook rather than searching on', async () => {
    const { dealCardId, propertyCardId } = subject();
    const result = await run(dealCardId, propertyCardId, lane());
    const well = result.facts.wellOutlook as { category: string; applicable: boolean };
    expect(well.applicable).toBe(true);
    expect(well.category).toBe('unknown');
    expect(result.missingInformation).toContain('Nearby domestic well records or local groundwater context for a well outlook');
  });

  it('uses retained nearby well context when it exists', async () => {
    const { dealCardId, propertyCardId } = subject();
    persistWellContextScreening(propertyCardId, {
      nearbyRecordCount: 9,
      typicalDepthRangeFt: [200, 300],
      groundwaterNote: null,
      source: 'State well completion records',
      sourceUrl: null,
    });
    const result = await run(dealCardId, propertyCardId, lane());
    expect((result.facts.wellOutlook as { category: string }).category).toBe('favorable');
  });

  it('screens septic across every retained soil unit when sewer is not established', async () => {
    const { dealCardId, propertyCardId } = subject();
    persistSoilsSepticScreening(propertyCardId, {
      source: 'USDA NRCS SSURGO',
      sourceUrl: null,
      surveyArea: 'Example County',
      retrievedAt: '2026-08-01T00:00:00.000Z',
      bestTestingAreasNote: null,
      units: [
        {
          name: 'Mountview silt loam', symbol: 'MvC2', slopeRange: '5–12%', drainageClass: 'Well drained',
          hydrologicGroup: 'B', waterTableDepthCm: null, bedrockDepthCm: null, floodingFrequency: null,
          pondingFrequency: null, septicRating: 'Not limited', limitationReasons: [], parcelSharePct: 70,
        },
        {
          name: 'Dickson silt loam', symbol: 'DcD', slopeRange: '5–12%', drainageClass: 'Moderately well drained',
          hydrologicGroup: 'C', waterTableDepthCm: 60, bedrockDepthCm: null, floodingFrequency: null,
          pondingFrequency: null, septicRating: 'Very limited', limitationReasons: ['Depth to saturated zone'], parcelSharePct: 30,
        },
      ],
    });
    const result = await run(dealCardId, propertyCardId, lane());
    const septic = result.facts.septicOutlook as {
      category: string; soilUnitCount: number; favorableSharePct: number | null; limitedSharePct: number | null; statement: string;
    };
    expect(septic.soilUnitCount).toBe(2);
    expect(septic.category).toBe('mixed');
    expect(septic.favorableSharePct).toBe(70);
    expect(septic.limitedSharePct).toBe(30);
    expect(septic.statement).toMatch(/Screening only/);
  });

  it('reports an unknown septic outlook rather than manufacturing soil findings', async () => {
    const { dealCardId, propertyCardId } = subject();
    const result = await run(dealCardId, propertyCardId, lane());
    const septic = result.facts.septicOutlook as { category: string; soilUnitCount: number };
    expect(septic.soilUnitCount).toBe(0);
    expect(septic.category).toBe('unknown');
  });

  it('never resolves a parcel of its own — raw input is refused, not guessed', async () => {
    const outcome = await UTILITY_SERVICE_SCREEN_CAPABILITY.execute(
      {
        capabilityId: UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:test' },
        subject: { kind: 'raw_input', entity: 'TY_LAND_BIZ', value: '12 Somewhere Rd' },
      } as unknown as CapabilityInvocationRequest,
      {},
      { invocationId: 'test', researchSessionId: null, startedAt: '2026-08-19T12:00:00.000Z' },
    );
    expect(outcome.status).toBe('NEEDS_INPUT');
    expect(outcome.missingInformation).toContain('One canonical parcel from Property Resolution');
  });
});
