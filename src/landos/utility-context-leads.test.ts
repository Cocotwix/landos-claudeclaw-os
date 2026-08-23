import { describe, expect, it } from 'vitest';

import {
  assessUtilityContextLead,
  MIN_RESIDENTIAL_CLUSTER_LOTS,
  orderUtilityContextLeads,
  readHistoricalUtilityPlan,
  readNeighborhoodServicePattern,
  traceDevelopmentInfrastructure,
  type UtilityContextLead,
} from './utility-context-leads.js';

function lead(overrides: Partial<UtilityContextLead> & Pick<UtilityContextLead, 'kind' | 'label'>): UtilityContextLead {
  return {
    sharesSubjectRoad: false,
    adjoinsSubject: false,
    sharesImmediateStreetNetwork: false,
    ...overrides,
  };
}

const gis = { label: 'County utility GIS', url: 'https://gis.example.gov/utilities' };

describe('the subject corridor comes first', () => {
  it('is always admissible and is the only corridor-level lead kind', () => {
    const assessment = assessUtilityContextLead(lead({ kind: 'subject_road_corridor', label: 'Subject road' }));
    expect(assessment.admissible).toBe(true);
    expect(assessment.priority).toBe(1);
    expect(assessment.evidenceLevel).toBe('corridor_infrastructure');
  });

  it('outranks every contextual lead in the ordering', () => {
    const { admitted } = orderUtilityContextLeads([
      lead({ kind: 'same_road_commercial', label: 'Corner store', sharesSubjectRoad: true }),
      lead({ kind: 'subject_road_corridor', label: 'Subject road' }),
      lead({ kind: 'adjoining_residential_neighborhood', label: 'Oak Ridge', adjoinsSubject: true, developedLotCount: 30 }),
    ]);
    expect(admitted.map((entry) => entry.lead.kind)).toEqual([
      'subject_road_corridor',
      'adjoining_residential_neighborhood',
      'same_road_commercial',
    ]);
  });
});

describe('a residential cluster is a lead; one rural neighbor is not', () => {
  it('admits a physically connected cluster', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'adjoining_residential_neighborhood',
      label: 'Oak Ridge',
      adjoinsSubject: true,
      developedLotCount: 34,
    }));
    expect(assessment.admissible).toBe(true);
    expect(assessment.evidenceLevel).toBe('area_service');
    expect(assessment.reason).toContain('cannot establish service at the subject');
  });

  it('refuses a single isolated residence rather than opening a rabbit hole', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'adjoining_residential_neighborhood',
      label: 'the house across the road',
      adjoinsSubject: true,
      developedLotCount: 1,
    }));
    expect(assessment.admissible).toBe(false);
    expect(assessment.reason).toContain(`${MIN_RESIDENTIAL_CLUSTER_LOTS}-lot cluster threshold`);
  });

  it('refuses a large neighborhood that is not physically connected to the subject', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'adjoining_residential_neighborhood',
      label: 'Distant Acres',
      developedLotCount: 120,
      straightLineFeet: 900,
    }));
    expect(assessment.admissible).toBe(false);
    expect(assessment.reason).toContain('entirely different direction');
  });
});

describe('commercial proximity is not an infrastructure relationship', () => {
  it('refuses a commercial building on another corridor however close it is', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'same_road_commercial',
      label: 'the shopping center',
      straightLineFeet: 1000,
    }));
    expect(assessment.admissible).toBe(false);
    expect(assessment.reason).toContain('served from a different direction');
  });

  it('admits commercial use on the subject road, without assuming how it is served', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'same_road_commercial',
      label: 'the school',
      sharesSubjectRoad: true,
    }));
    expect(assessment.admissible).toBe(true);
    expect(assessment.reason).toContain('never by itself implies public water or public sewer');
  });
});

describe('adjacent development leads', () => {
  it('admits a development that shares the subject street network', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'connected_new_development',
      label: 'Kingwood Phase 2',
      sharesImmediateStreetNetwork: true,
    }));
    expect(assessment.admissible).toBe(true);
    expect(assessment.reason).toContain('where that infrastructure actually runs');
  });

  it('refuses one that does not touch the subject corridor', () => {
    const assessment = assessUtilityContextLead(lead({
      kind: 'connected_new_development',
      label: 'a subdivision two roads over',
      straightLineFeet: 1200,
    }));
    expect(assessment.admissible).toBe(false);
  });
});

describe('other context needs a stated infrastructure reason', () => {
  it('refuses unexplained context and admits a stated relationship', () => {
    expect(assessUtilityContextLead(lead({ kind: 'other_context', label: 'a nearby farm' })).admissible).toBe(false);
    expect(assessUtilityContextLead(lead({
      kind: 'other_context',
      label: 'a recorded utility easement crossing the subject',
      infrastructureRelevanceReason: 'the easement carries the main past the subject frontage',
    })).admissible).toBe(true);
  });

  it('returns refused leads too, so a deliberate skip is visible', () => {
    const { admitted, refused } = orderUtilityContextLeads([
      lead({ kind: 'other_context', label: 'a nearby farm' }),
      lead({ kind: 'subject_road_corridor', label: 'Subject road' }),
    ]);
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].lead.label).toBe('a nearby farm');
  });
});

describe('neighborhood service pattern', () => {
  it('states the pattern and its limit in the same sentence', () => {
    const pattern = readNeighborhoodServicePattern({
      lead: lead({
        kind: 'adjoining_residential_neighborhood',
        label: 'Oak Ridge',
        adjoinsSubject: true,
        developedLotCount: 30,
      }),
      water: 'public_water',
      wastewater: 'individual_septic',
      basis: 'the county hydrant and water main layers',
      source: gis,
    });

    expect(pattern.established).toBe(true);
    expect(pattern.evidenceLevel).toBe('area_service');
    expect(pattern.statement).toContain('public water');
    expect(pattern.statement).toContain('individual septic');
    expect(pattern.statement).toContain('not a finding about the subject');
  });

  it('reads a well and septic pattern the same way', () => {
    const pattern = readNeighborhoodServicePattern({
      lead: lead({
        kind: 'adjoining_residential_neighborhood',
        label: 'Ridge Road',
        sharesSubjectRoad: true,
        developedLotCount: 12,
      }),
      water: 'private_wells',
      wastewater: 'individual_septic',
      basis: 'state well logs and environmental health permits',
      source: gis,
    });
    expect(pattern.water).toBe('private_wells');
    expect(pattern.statement).toContain('private wells');
  });

  it('refuses to read a pattern off an inadmissible lead', () => {
    const pattern = readNeighborhoodServicePattern({
      lead: lead({ kind: 'adjoining_residential_neighborhood', label: 'one house', adjoinsSubject: true, developedLotCount: 2 }),
      water: 'public_water',
      wastewater: 'individual_septic',
      basis: 'a single hydrant',
      source: gis,
    });
    expect(pattern.established).toBe(false);
    expect(pattern.water).toBe('unknown');
  });
});

describe('development infrastructure tracing', () => {
  const base = {
    projectName: 'Kingwood Phase 2',
    source: { label: 'City planning file', url: 'https://example.gov/plan' },
  };

  it('reaches corridor level only when the route was traced to the subject corridor', () => {
    const reaching = traceDevelopmentInfrastructure('water', {
      ...base,
      waterExtension: '8-inch main extended along the frontage road',
      runsAlongSubjectCorridor: true,
    });
    expect(reaching.evidenceLevel).toBe('corridor_infrastructure');
    expect(reaching.reachesSubjectCorridor).toBe(true);
    expect(reaching.statement).toContain('does not establish the subject');
  });

  it('stays area context when the traced route goes elsewhere', () => {
    const away = traceDevelopmentInfrastructure('water', { ...base, runsAlongSubjectCorridor: false });
    expect(away.evidenceLevel).toBe('area_service');
    expect(away.statement).toContain('does NOT run along');
  });

  it('refuses to conclude anything from an untraced route', () => {
    const untraced = traceDevelopmentInfrastructure('sewer', { ...base, runsAlongSubjectCorridor: null });
    expect(untraced.evidenceLevel).toBe('area_service');
    expect(untraced.reachesSubjectCorridor).toBe(false);
    expect(untraced.statement).toContain('was not traced');
  });

  it('surfaces the sewer-specific infrastructure it traced', () => {
    const finding = traceDevelopmentInfrastructure('sewer', {
      ...base,
      sewerRouting: 'gravity to a new lift station',
      liftStation: 'one lift station at the low point',
      forceMain: '4-inch force main north to the trunk',
      runsAlongSubjectCorridor: false,
    });
    expect(finding.details.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(['Sewer routing', 'Lift or pump station', 'Force main']),
    );
  });
});

describe('historical site plans', () => {
  it('interprets proposed infrastructure without making it current', () => {
    const reading = readHistoricalUtilityPlan({
      projectName: 'Kingwood',
      kind: 'sewer',
      proposedInfrastructure: ['two pump stations'],
      intendedToServe: 'the platted phases north of the creek',
      constructionEvidenced: false,
      planDate: '2007',
      source: { label: 'Recorded plat and planning file' },
    });

    expect(reading.establishesCurrentAvailability).toBe(false);
    expect(reading.evidenceLevel).toBe('area_service');
    expect(reading.statement).toContain('two pump stations');
    expect(reading.statement).toContain('not evidence that service exists today');
    expect(reading.useInConfirmation).toContain('Ask whether that is still the expected solution');
  });
});
