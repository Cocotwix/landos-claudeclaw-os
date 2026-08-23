import { describe, expect, it } from 'vitest';

import {
  areaServiceEstablishesCorridorInfrastructure,
  connectionEstablishesCapacity,
  corridorInfrastructureEstablishesConnection,
  evidenceSupports,
  historicalPlanEstablishesCurrentAvailability,
  neighborhoodPatternEstablishesSubjectConnection,
  resolveUtilityAvailability,
  serviceTerritoryEstablishesInfrastructure,
  strongestEvidenceLevel,
  utilityLaneOutcome,
  type UtilityResolutionInput,
} from './utility-availability-resolution.js';

const source = (label: string) => ({ label, url: `https://example.gov/${label.replace(/\s+/g, '-')}` });

const WADC = {
  name: 'Water Authority of Dickson County',
  providerType: 'regional water authority',
  basisIsUtilityRecord: true,
  source: source('county GIS utility district layer'),
};

function resolve(overrides: Partial<UtilityResolutionInput> = {}) {
  return resolveUtilityAvailability({ kind: 'water', ...overrides });
}

describe('utility evidence levels', () => {
  it('supports a claim at its own level or below, never above', () => {
    expect(evidenceSupports('area_service', 'area_service')).toBe(true);
    expect(evidenceSupports('corridor_infrastructure', 'area_service')).toBe(true);
    expect(evidenceSupports('subject_availability', 'corridor_infrastructure')).toBe(true);

    expect(evidenceSupports('area_service', 'corridor_infrastructure')).toBe(false);
    expect(evidenceSupports('area_service', 'subject_availability')).toBe(false);
    expect(evidenceSupports('corridor_infrastructure', 'subject_availability')).toBe(false);
  });

  it('reports the strongest level held, and null when nothing was established', () => {
    expect(strongestEvidenceLevel(['area_service', 'corridor_infrastructure'])).toBe('corridor_infrastructure');
    expect(strongestEvidenceLevel([])).toBeNull();
  });
});

describe('the promotion prohibitions', () => {
  it('refuses every promotion, unconditionally', () => {
    expect(serviceTerritoryEstablishesInfrastructure()).toBe(false);
    expect(areaServiceEstablishesCorridorInfrastructure()).toBe(false);
    expect(corridorInfrastructureEstablishesConnection()).toBe(false);
    expect(connectionEstablishesCapacity()).toBe(false);
    expect(neighborhoodPatternEstablishesSubjectConnection()).toBe(false);
    expect(historicalPlanEstablishesCurrentAvailability()).toBe(false);
  });
});

describe('provider is not availability', () => {
  it('answers the provider question and leaves every other dimension open', () => {
    const read = resolve({ provider: WADC });

    expect(read.provider.state).toBe('identified');
    expect(read.provider.name).toBe('Water Authority of Dickson County');
    expect(read.territory.state).toBe('unresolved');
    expect(read.infrastructure.state).toBe('UNKNOWN');
    expect(read.connection.state).toBe('written_confirmation_required');
    expect(read.capacity.state).toBe('written_confirmation_required');
    // The Gold Run failure, asserted: a provider name is never a RETURNED lane.
    expect(read.laneOutcome).toBe('PARTIAL');
  });

  it('does not infer the municipality supplies the utility', () => {
    const read = resolve({
      provider: { ...WADC, name: 'City of Somewhere', basisIsUtilityRecord: false },
    });
    expect(read.provider.statement).toContain('not itself a utility record');
  });
});

describe('service territory is not line presence', () => {
  it('records inside without moving the infrastructure dimension', () => {
    const read = resolve({
      provider: WADC,
      territory: { state: 'inside', source: source('utility district boundary') },
    });
    expect(read.territory.state).toBe('inside');
    expect(read.territory.statement).toContain('does not establish that a main exists');
    expect(read.infrastructure.state).toBe('UNKNOWN');
    expect(read.extension.state).toBe('unresolved');
    expect(read.highestEvidenceLevel).toBe('area_service');
  });
});

describe('area service is not corridor infrastructure', () => {
  it('keeps neighborhood context at area level and off the corridor', () => {
    const read = resolve({
      provider: WADC,
      areaContext: [{
        statement: 'The adjoining subdivision appears to be on public water with individual septic.',
        source: source('provider service map'),
      }],
    });
    expect(read.areaContext).toHaveLength(1);
    expect(read.infrastructure.state).toBe('UNKNOWN');
    expect(read.highestEvidenceLevel).toBe('area_service');
    expect(read.laneOutcome).toBe('PARTIAL');
  });
});

describe('corridor infrastructure is not connection', () => {
  it('records a main on the subject road and still demands confirmation', () => {
    const read = resolve({
      provider: WADC,
      corridor: {
        relationship: 'ON_SUBJECT_ROAD',
        layerName: 'Water Mains',
        mainSizeInches: 8,
        source: { ...source('county utility GIS'), screenshotPath: '/artifacts/water-main.png' },
      },
    });

    expect(read.infrastructure.state).toBe('ON_SUBJECT_ROAD');
    expect(read.infrastructure.basis).toBe('corridor_infrastructure');
    expect(read.infrastructure.mainSizeInches).toBe(8);
    expect(read.infrastructure.screenshotPath).toBe('/artifacts/water-main.png');
    expect(read.connection.state).toBe('written_confirmation_required');
    expect(read.connection.basis).toBeNull();
    expect(read.confirmationRequired).toBe(true);
    expect(read.laneOutcome).toBe('PARTIAL');
  });

  it('treats a line at the frontage as no extension indicated, and nothing more', () => {
    const read = resolve({
      corridor: { relationship: 'AT_SUBJECT', layerName: 'Water Mains', source: source('county utility GIS') },
    });
    expect(read.extension.state).toBe('not_indicated');
    expect(read.capacity.state).toBe('written_confirmation_required');
  });

  it('does not read a main BESIDE the parcel as a main ALONG it', () => {
    // A 6-inch main terminating 13 ft from the boundary inside the neighbouring
    // development is corridor-level evidence and still needs bringing to the
    // property. ADJACENT must not round to "no extension needed".
    const adjacent = resolve({
      corridor: { relationship: 'ADJACENT', layerName: 'Water Mains', source: source('provider utility GIS') },
    });
    expect(adjacent.infrastructure.basis).toBe('corridor_infrastructure');
    expect(adjacent.extension.state).toBe('likely_required');

    const onRoad = resolve({
      corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', source: source('provider utility GIS') },
    });
    expect(onRoad.extension.state).toBe('not_indicated');
  });

  it('calls an extension likely when the main is only nearby', () => {
    const read = resolve({
      corridor: { relationship: 'NEARBY', layerName: 'Water Mains', source: source('county utility GIS') },
    });
    expect(read.extension.state).toBe('likely_required');
    expect(read.infrastructure.basis).toBe('area_service');
  });

  it('does not read an absent line as a refusal of service', () => {
    const read = resolve({
      corridor: { relationship: 'NOT_SHOWN', layerName: 'Water Mains', source: source('county utility GIS') },
    });
    expect(read.infrastructure.statement).toContain('absence on a map is not proof of unavailability');
    expect(read.connection.state).not.toBe('not_available');
  });
});

describe('connection is not capacity', () => {
  it('leaves capacity unconfirmed when the provider confirmed only service', () => {
    const read = resolve({
      provider: WADC,
      corridor: { relationship: 'AT_SUBJECT', layerName: 'Water Mains', source: source('county utility GIS') },
      determination: { connection: 'available', source: source('provider availability letter') },
    });

    expect(read.connection.state).toBe('available');
    expect(read.connection.basis).toBe('subject_availability');
    expect(read.capacity.state).toBe('not_confirmed');
    expect(read.capacity.basis).toBeNull();
    expect(read.laneOutcome).toBe('RETURNED');
  });

  it('accepts a capacity determination only from the serving party', () => {
    const read = resolve({
      determination: {
        connection: 'conditionally_available',
        capacity: 'limited',
        extensionRequired: true,
        source: source('provider engineering response'),
      },
    });
    expect(read.capacity.state).toBe('limited');
    expect(read.extension.state).toBe('confirmed_required');
    expect(read.highestEvidenceLevel).toBe('subject_availability');
  });
});

describe('water and sewer resolve independently', () => {
  it('answers one without touching the other', () => {
    const water = resolveUtilityAvailability({
      kind: 'water',
      provider: WADC,
      corridor: { relationship: 'ON_SUBJECT_ROAD', layerName: 'Water Mains', source: source('county utility GIS') },
    });
    const sewer = resolveUtilityAvailability({
      kind: 'sewer',
      corridor: { relationship: 'NOT_SHOWN', layerName: 'Sanitary Sewer', lineType: 'gravity', source: source('county utility GIS') },
    });

    expect(water.infrastructure.state).toBe('ON_SUBJECT_ROAD');
    expect(sewer.infrastructure.state).toBe('NOT_SHOWN');
    expect(sewer.infrastructure.lineType).toBe('gravity');
    expect(water.provider.state).toBe('identified');
    expect(sewer.provider.state).toBe('unresolved');
  });

  it('carries a sewer line type and lift station only for sewer', () => {
    const water = resolveUtilityAvailability({
      kind: 'water',
      corridor: { relationship: 'ADJACENT', layerName: 'Water Mains', source: source('gis') },
    });
    expect(water.infrastructure.lineType).toBeNull();
  });
});

describe('lane semantics', () => {
  it('never counts unresolved, partial or blocked as returned', () => {
    const base = {
      notApplicable: false,
      blocked: false,
      relationship: 'UNKNOWN' as const,
      providerIdentified: false,
      territoryKnown: false,
      hasAreaContext: false,
    };
    expect(utilityLaneOutcome({ ...base, connection: 'unresolved' })).toBe('UNRESOLVED');
    expect(utilityLaneOutcome({ ...base, connection: 'written_confirmation_required', providerIdentified: true })).toBe('PARTIAL');
    expect(utilityLaneOutcome({ ...base, connection: 'unresolved', blocked: true })).toBe('BLOCKED');
    expect(utilityLaneOutcome({ ...base, connection: 'unresolved', notApplicable: true })).toBe('NOT_REQUIRED');
    expect(utilityLaneOutcome({ ...base, connection: 'available' })).toBe('RETURNED');
    expect(utilityLaneOutcome({ ...base, connection: 'not_available' })).toBe('RETURNED');
  });

  it('reports a blocked lane rather than a false negative', () => {
    const read = resolve({ provider: WADC, blocked: { reason: 'the provider map requires a login' } });
    expect(read.laneOutcome).toBe('BLOCKED');
    expect(read.headline).toContain('research blocked');
  });

  it('never collapses a researched utility to a bare unresolved headline', () => {
    const read = resolve({
      provider: WADC,
      territory: { state: 'inside', source: source('district boundary') },
      corridor: { relationship: 'NOT_SHOWN', layerName: 'Water Mains', source: source('county utility GIS') },
    });
    expect(read.headline).toContain('Water Authority of Dickson County');
    expect(read.headline).toContain('connection and capacity require written confirmation');
  });

  it('is UNRESOLVED only when genuinely nothing was established', () => {
    expect(resolve().laneOutcome).toBe('UNRESOLVED');
    expect(resolve().connection.state).toBe('unresolved');
  });
});

describe('what a resolution never establishes', () => {
  it('attaches the entitlement limits to every resolution, including the strongest', () => {
    const read = resolve({
      determination: { connection: 'available', capacity: 'confirmed', source: source('letter') },
    });
    expect(read.doesNotEstablish).toContain('available capacity');
    expect(read.doesNotEstablish).toContain('connection approval');
  });
});
