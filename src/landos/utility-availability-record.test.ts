import { describe, expect, it } from 'vitest';

import {
  authorizedUtilitySteps,
  planUtilityResearch,
  progressFromResolution,
  stepAuthorized,
  type UtilityResearchProgress,
} from './utility-research-plan.js';
import {
  projectUtilityAvailability,
  publicServiceReadFromResolution,
  UTILITY_AVAILABILITY_RECORD_VERSION,
  type RetainedUtilityAvailabilityRecord,
} from './utility-availability-record.js';
import { resolveUtilityAvailability } from './utility-availability-resolution.js';

const SUBJECT = {
  address: '0 Kingwood Blvd, Fairview, TN 37062',
  apn: '042-123.00-000',
  county: 'Williamson',
  state: 'TN',
  acres: 51.11,
  contemplatedUse: 'residential subdivision',
};

const gis = { label: 'County utility GIS', url: 'https://gis.example.gov/utilities' };

function record(overrides: Partial<RetainedUtilityAvailabilityRecord> = {}): RetainedUtilityAvailabilityRecord {
  return {
    version: UTILITY_AVAILABILITY_RECORD_VERSION,
    depth: 'DEEP_DEVELOPMENT',
    water: {},
    sewer: {},
    researchedAt: '2026-08-23T12:00:00.000Z',
    ...overrides,
  };
}

const PROVIDER = {
  name: 'Water Authority of Dickson County',
  providerType: 'regional water authority',
  basisIsUtilityRecord: true,
  source: gis,
};

describe('research depth bounds the chain', () => {
  it('withholds infrastructure archaeology from a STANDARD property', () => {
    const standard = authorizedUtilitySteps('STANDARD');
    expect(standard).toContain('subject_corridor_gis');
    expect(standard).not.toContain('adjacent_development_trace');
    expect(standard).not.toContain('historical_site_records');
    expect(standard).not.toContain('same_road_commercial');
    expect(stepAuthorized('STANDARD', 'adjacent_development_trace')).toBe(false);
  });

  it('authorizes the full adaptive chain for a DEEP_DEVELOPMENT property', () => {
    const deep = authorizedUtilitySteps('DEEP_DEVELOPMENT');
    for (const step of ['adjacent_development_trace', 'historical_site_records', 'same_road_commercial', 'adaptive_web_discovery'] as const) {
      expect(deep).toContain(step);
    }
  });

  it('names the steps a STANDARD screen deliberately skipped', () => {
    const plan = planUtilityResearch({
      kind: 'water',
      depth: 'STANDARD',
      progress: baseProgress({ providerIdentified: true, territoryEstablished: true, corridorRead: true }),
    });
    expect(plan.withheldSteps.map((entry) => entry.step)).toContain('adjacent_development_trace');
    expect(plan.withheldSteps[0].reason).toContain('STANDARD');
  });
});

function baseProgress(overrides: Partial<UtilityResearchProgress> = {}): UtilityResearchProgress {
  return {
    providerIdentified: false,
    territoryEstablished: false,
    corridorRead: false,
    corridorInfrastructureShown: false,
    providerEngineeringMapRead: false,
    neighborhoodPatternEstablished: false,
    adjacentDevelopmentTraced: false,
    sameRoadCommercialRead: false,
    historicalRecordsRead: false,
    adaptiveDiscoveryRun: false,
    providerDeterminationHeld: false,
    blocked: false,
    ...overrides,
  };
}

describe('the plan is adaptive, not a fixed sequence', () => {
  it('reads the subject corridor before any surrounding context', () => {
    const plan = planUtilityResearch({
      kind: 'water',
      depth: 'DEEP_DEVELOPMENT',
      progress: baseProgress({ providerIdentified: true, territoryEstablished: true }),
    });
    expect(plan.nextStep).toBe('subject_corridor_gis');
    expect(plan.rationale).toContain('first infrastructure question');
  });

  it('skips contextual research once the corridor is established', () => {
    const plan = planUtilityResearch({
      kind: 'water',
      depth: 'DEEP_DEVELOPMENT',
      progress: baseProgress({ corridorRead: true, corridorInfrastructureShown: true }),
    });
    expect(plan.nextStep).toBe('written_provider_confirmation');
    expect(plan.remainingSteps).toEqual(['written_provider_confirmation']);
  });

  it('escalates to the provider once every authorized route is spent', () => {
    const plan = planUtilityResearch({
      kind: 'sewer',
      depth: 'STANDARD',
      progress: baseProgress({
        providerIdentified: true,
        territoryEstablished: true,
        corridorRead: true,
        neighborhoodPatternEstablished: true,
      }),
    });
    expect(plan.nextStep).toBe('written_provider_confirmation');
    expect(plan.researchExhausted).toBe(true);
  });

  it('ends the plan when the provider has already answered', () => {
    const plan = planUtilityResearch({
      kind: 'water',
      depth: 'DEEP_DEVELOPMENT',
      progress: baseProgress({ providerDeterminationHeld: true }),
    });
    expect(plan.nextStep).toBeNull();
    expect(plan.researchExhausted).toBe(true);
  });

  it('sends a blocked lane to unblocking rather than to more searching', () => {
    const plan = planUtilityResearch({ kind: 'water', depth: 'STANDARD', progress: baseProgress({ blocked: true }) });
    expect(plan.nextStep).toBeNull();
    expect(plan.rationale).toContain('not more searching');
  });

  it('derives progress straight off a resolution', () => {
    const resolution = resolveUtilityAvailability({
      kind: 'water',
      provider: PROVIDER,
      corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', source: gis },
    });
    const progress = progressFromResolution(resolution);
    expect(progress.providerIdentified).toBe(true);
    expect(progress.corridorInfrastructureShown).toBe(true);
    expect(progress.providerDeterminationHeld).toBe(false);
  });
});

describe('projection derives the read from observations every time', () => {
  it('resolves water and sewer independently from one record', () => {
    const projection = projectUtilityAvailability(record({
      water: {
        provider: PROVIDER,
        territory: { state: 'inside', source: gis },
        corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', mainSizeInches: 8, source: gis },
      },
      sewer: {
        corridor: { relationship: 'NOT_SHOWN', layerName: 'Sanitary Sewer', source: gis },
      },
    }), SUBJECT);

    expect(projection.water.infrastructure.state).toBe('ON_SUBJECT_ROAD');
    expect(projection.water.laneOutcome).toBe('PARTIAL');
    expect(projection.sewer.infrastructure.state).toBe('NOT_SHOWN');
    expect(projection.sewer.connection.state).toBe('written_confirmation_required');
  });

  it('carries an admitted neighborhood pattern into both utilities as context only', () => {
    const projection = projectUtilityAvailability(record({
      water: { provider: PROVIDER },
      neighborhoodPattern: {
        lead: {
          kind: 'adjoining_residential_neighborhood',
          label: 'Oak Ridge',
          adjoinsSubject: true,
          sharesSubjectRoad: false,
          sharesImmediateStreetNetwork: true,
          developedLotCount: 30,
        },
        water: 'public_water',
        wastewater: 'individual_septic',
        basis: 'the county hydrant layer',
        source: gis,
      },
    }), SUBJECT);

    expect(projection.neighborhoodPattern?.established).toBe(true);
    expect(projection.water.areaContext).toHaveLength(1);
    expect(projection.sewer.areaContext).toHaveLength(1);
    // The pattern is area evidence; it must not move the corridor dimension.
    expect(projection.water.infrastructure.state).toBe('UNKNOWN');
    expect(projection.water.highestEvidenceLevel).toBe('area_service');
  });

  it('lets a traced route reaching the subject corridor stand in for a map read', () => {
    const projection = projectUtilityAvailability(record({
      developmentTraces: [{
        kind: 'water',
        trace: {
          projectName: 'Kingwood Phase 2',
          waterExtension: '8-inch main along the frontage road',
          runsAlongSubjectCorridor: true,
          source: { label: 'City planning file' },
        },
      }],
    }), SUBJECT);

    expect(projection.water.infrastructure.state).toBe('ON_SUBJECT_ROAD');
    expect(projection.water.infrastructure.basis).toBe('corridor_infrastructure');
    // Counted once, at corridor level — not also as area context.
    expect(projection.water.areaContext).toHaveLength(0);
  });

  it('never lets context override a direct subject reading', () => {
    const projection = projectUtilityAvailability(record({
      water: { corridor: { relationship: 'NOT_SHOWN', layerName: 'Water Mains', source: gis } },
      developmentTraces: [{
        kind: 'water',
        trace: { projectName: 'Kingwood Phase 2', runsAlongSubjectCorridor: true, source: { label: 'City planning file' } },
      }],
    }), SUBJECT);

    expect(projection.water.infrastructure.state).toBe('NOT_SHOWN');
  });

  it('keeps a historical pump-station proposal as context, never as availability', () => {
    const projection = projectUtilityAvailability(record({
      sewer: { provider: { ...PROVIDER, name: 'City of Fairview', providerType: 'municipal utility' } },
      historicalPlans: [{
        projectName: 'Kingwood',
        kind: 'sewer',
        proposedInfrastructure: ['two pump stations'],
        constructionEvidenced: false,
        source: { label: 'Recorded plat' },
      }],
    }), SUBJECT);

    expect(projection.historicalReadings[0].establishesCurrentAvailability).toBe(false);
    expect(projection.sewer.connection.state).toBe('written_confirmation_required');
    expect(projection.sewer.laneOutcome).toBe('PARTIAL');
  });
});

describe('the confirmation package', () => {
  it('is built whenever the answer needs the provider, and carries the known context', () => {
    const projection = projectUtilityAvailability(record({
      water: {
        provider: PROVIDER,
        territory: { state: 'inside', source: gis },
        corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', mainSizeInches: 8, source: gis },
        contact: { name: 'Water Authority of Dickson County', phone: '555-0100', department: 'engineering' },
      },
      neighborhoodPattern: {
        lead: {
          kind: 'adjoining_residential_neighborhood',
          label: 'Oak Ridge',
          adjoinsSubject: true,
          sharesSubjectRoad: false,
          sharesImmediateStreetNetwork: true,
          developedLotCount: 30,
        },
        water: 'public_water',
        wastewater: 'individual_septic',
        basis: 'the county hydrant layer',
        source: gis,
      },
    }), SUBJECT);

    const request = projection.waterConfirmation;
    expect(request).not.toBeNull();
    expect(request!.questions).toHaveLength(8);
    expect(request!.questions[6]).toContain('fire flow');
    expect(request!.contact?.phone).toBe('555-0100');
    expect(request!.knownEvidence.join(' ')).toContain('8-inch main');
    expect(request!.knownEvidence.join(' ')).toContain('public water');
    expect(request!.messageBody).toContain('APN 042-123.00-000');
    expect(request!.messageBody).toContain('51.11 acres');
  });

  it('asks the sewer questions a sewer engineer would answer', () => {
    const projection = projectUtilityAvailability(record({
      sewer: { corridor: { relationship: 'NOT_SHOWN', layerName: 'Sanitary Sewer', source: gis } },
    }), SUBJECT);
    const request = projection.sewerConfirmation;
    expect(request!.questions.join(' ')).toContain('gravity service');
    expect(request!.questions.join(' ')).toContain('force main');
    expect(request!.whyRequired).toContain('Further searching cannot produce');
  });

  it('is not built once the provider has determined availability', () => {
    const projection = projectUtilityAvailability(record({
      water: {
        provider: PROVIDER,
        determination: { connection: 'available', capacity: 'confirmed', source: { label: 'Will-serve letter' } },
      },
    }), SUBJECT);
    expect(projection.waterConfirmation).toBeNull();
    expect(projection.water.laneOutcome).toBe('RETURNED');
  });
});

describe('reconciliation with the coarse screening vocabulary', () => {
  it('reserves available for a serving-party determination', () => {
    const mapped = resolveUtilityAvailability({
      kind: 'water',
      corridor: { relationship: 'AT_SUBJECT', layerName: 'Water Mains', source: gis },
    });
    expect(publicServiceReadFromResolution(mapped).state).toBe('unresolved');

    const determined = resolveUtilityAvailability({
      kind: 'water',
      determination: { connection: 'available', source: { label: 'Will-serve letter' } },
    });
    expect(publicServiceReadFromResolution(determined).state).toBe('available');
  });

  it('names the sources the resolution actually opened', () => {
    const read = publicServiceReadFromResolution(resolveUtilityAvailability({
      kind: 'water',
      provider: PROVIDER,
      corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', source: gis },
    }));
    expect(read.sourcesChecked.join(' ')).toContain('County utility GIS');
  });
});
