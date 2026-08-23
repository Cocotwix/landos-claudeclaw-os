// The vacant-land utility interpretation, as tests.
//
// The defect these cover: the model treated a main crossing the subject as the
// strong outcome and a main stopping short of it as an extension problem. For
// undeveloped land that is backwards — a public provider builds in the
// right-of-way and the developer connects from there — so frontage, adjoining
// right-of-way and property edge are scored here as the favourable normal
// condition they are, without ever promoting a position into a connection.

import { describe, expect, it } from 'vitest';

import {
  absentCrossingMainIsDeficiency,
  crossingSiteOutranksSiteEdge,
  infrastructurePositionEstablishesCapacity,
  infrastructurePositionEstablishesConnection,
  isFavorableInfrastructurePosition,
  NEAR_SITE_FEET,
  readUtilitySitePosition,
  SITE_EDGE_FEET,
  straightLineProximityEstablishesPosition,
  utilityInfrastructureSignal,
  utilityInfrastructureSignalRank,
  type UtilitySitePositionInput,
} from './utility-site-position.js';

const read = (overrides: Partial<UtilitySitePositionInput> = {}) => readUtilitySitePosition({
  kind: 'water',
  relationship: 'ADJACENT',
  subjectDevelopment: 'vacant',
  ...overrides,
});

describe('vacant land — a main in the road right-of-way along the frontage', () => {
  // Spec test 1.
  it('reads a main along the frontage as a strong positive, not an extension problem', () => {
    const reading = read({ relationship: 'ON_SUBJECT_ROAD', setting: 'public_row', mainSizeInches: 8 });

    expect(reading.position).toBe('at_site_edge');
    expect(reading.signal).toBe('very_strong_positive');
    expect(isFavorableInfrastructurePosition(reading.position)).toBe(true);
    expect(reading.statement).toMatch(/normal and favourable condition/i);
    expect(reading.statement).toMatch(/not a deficiency/i);
  });

  it('never describes the absent crossing main as a shortfall', () => {
    const reading = read({ relationship: 'ON_SUBJECT_ROAD', setting: 'public_row' });
    expect(reading.statement).not.toMatch(/does not cross|no main crosses/i);
    expect(reading.connectionPath).not.toMatch(/extension likely required/i);
  });
});

describe('vacant land — a main just off the boundary in the adjoining right-of-way', () => {
  // Spec test 2.
  it('reads a main 10-20 ft off the boundary as at the property edge', () => {
    const reading = read({ distanceToBoundaryFeet: 13, setting: 'adjoining_development', mainSizeInches: 6 });

    expect(reading.position).toBe('at_site_edge');
    expect(reading.signal).toBe('very_strong_positive');
    expect(reading.label).toMatch(/~13 ft from the boundary/);
    expect(reading.statement).toMatch(/effectively reaches the property edge/i);
  });

  it('does not penalise it for sitting outside the parcel boundary', () => {
    const edge = read({ distanceToBoundaryFeet: 13 });
    const crossing = read({ relationship: 'AT_SUBJECT' });

    expect(utilityInfrastructureSignalRank(edge.signal))
      .toBeGreaterThanOrEqual(utilityInfrastructureSignalRank(crossing.signal));
  });

  it('treats an unmeasured adjacent line in public right-of-way as edge infrastructure', () => {
    expect(read({ setting: 'public_row' }).position).toBe('at_site_edge');
    expect(read({ setting: 'utility_easement' }).position).toBe('at_site_edge');
    // With no measurement and no right-of-way evidence, adjoining is the honest
    // read — favourable, and one step below the edge it was not shown to reach.
    expect(read({ setting: 'adjoining_development' }).position).toBe('adjoining_site');
    expect(read({}).position).toBe('adjoining_site');
  });

  it('reads a near-site line as a strong positive rather than a caution', () => {
    const reading = read({ distanceToBoundaryFeet: 41, setting: 'public_row', mainSizeInches: 8, kind: 'sewer' });

    expect(reading.position).toBe('adjoining_site');
    expect(reading.signal).toBe('strong_positive');
    expect(isFavorableInfrastructurePosition(reading.position)).toBe(true);
    expect(reading.statement).toMatch(/favourable near-site position/i);
    expect(reading.label).toMatch(/~41 ft from the boundary/);
  });
});

describe('a line drawn across an undeveloped parcel', () => {
  // Spec test 3.
  it('is not automatically better than frontage or property-edge infrastructure', () => {
    const crossing = read({ relationship: 'AT_SUBJECT' });
    const frontage = read({ relationship: 'ON_SUBJECT_ROAD', setting: 'public_row' });

    expect(utilityInfrastructureSignalRank(crossing.signal))
      .toBeLessThanOrEqual(utilityInfrastructureSignalRank(frontage.signal));
    expect(crossingSiteOutranksSiteEdge()).toBe(false);
    expect(crossing.statement).toMatch(/not a stronger acquisition fact/i);
  });

  // Spec test 7.
  it('warns that on vacant land it may be a private lateral from a former structure', () => {
    const vacant = read({ relationship: 'AT_SUBJECT', subjectDevelopment: 'vacant' });

    expect(vacant.caution).toMatch(/private service lateral|abandoned connection/i);
    expect(vacant.caution).toMatch(/not the baseline expectation for vacant land/i);
  });

  it('does not raise that warning for a parcel that carries improvements', () => {
    expect(read({ relationship: 'AT_SUBJECT', subjectDevelopment: 'improved' }).caution).toBeNull();
    expect(read({ relationship: 'AT_SUBJECT', subjectDevelopment: 'unknown' }).caution).toBeNull();
  });
});

describe('infrastructure on another road', () => {
  // Spec test 4.
  it('is context only and is never treated as service availability', () => {
    const reading = read({ relationship: 'NEARBY' });

    expect(reading.position).toBe('off_corridor');
    expect(reading.signal).toBe('context_only');
    expect(isFavorableInfrastructurePosition(reading.position)).toBe(false);
    expect(reading.statement).toMatch(/straight-line nearness is not a serving position/i);
    expect(straightLineProximityEstablishesPosition()).toBe(false);
  });

  it('reads nothing within reach as a material negative, without calling it a refusal', () => {
    const reading = read({ relationship: 'NOT_SHOWN' });

    expect(reading.position).toBe('no_practical_infrastructure');
    expect(reading.signal).toBe('material_negative');
    expect(reading.statement).toMatch(/material negative/i);
    expect(reading.statement).toMatch(/absence on a map is not proof/i);
  });

  it('keeps an unread layer as an open question rather than a negative finding', () => {
    const reading = read({ relationship: 'UNKNOWN' });

    expect(reading.position).toBe('unestablished');
    expect(reading.signal).toBe('unestablished');
    expect(reading.statement).toMatch(/not a negative finding/i);
  });
});

describe('a strong position settles the position and nothing else', () => {
  // Spec tests 5 and 6.
  it('never implies connection approval, capacity or fire flow', () => {
    for (const relationship of ['AT_SUBJECT', 'ON_SUBJECT_ROAD', 'ADJACENT'] as const) {
      const reading = read({ relationship, distanceToBoundaryFeet: 5 });
      expect(reading.signal).toBe('very_strong_positive');
      expect(infrastructurePositionEstablishesConnection(reading.position)).toBe(false);
      expect(infrastructurePositionEstablishesCapacity(reading.position)).toBe(false);
      expect(reading.stillOpen).toContain('connection approval by the serving provider');
      expect(reading.stillOpen).toContain('system capacity for the contemplated use');
      expect(reading.stillOpen).toContain('fire flow, where the use requires it');
      expect(reading.stillOpen).toContain('connection and extension cost');
    }
  });

  it('holds the extension, easement and cost questions open at every favourable position', () => {
    for (const feet of [5, 40, 400]) {
      const reading = read({ distanceToBoundaryFeet: feet });
      expect(isFavorableInfrastructurePosition(reading.position)).toBe(true);
      expect(reading.stillOpen).toContain('the tap, lateral or main-extension requirement');
      expect(reading.stillOpen).toContain('easement or right-of-way mechanics for the connection');
    }
  });

  it('states outright that an absent crossing main is not a deficiency', () => {
    expect(absentCrossingMainIsDeficiency('vacant')).toBe(false);
    expect(absentCrossingMainIsDeficiency('improved')).toBe(false);
    expect(absentCrossingMainIsDeficiency('unknown')).toBe(false);
  });
});

describe('the distance bands', () => {
  it('moves from property edge to near-site to corridor extension as distance grows', () => {
    expect(read({ distanceToBoundaryFeet: SITE_EDGE_FEET }).position).toBe('at_site_edge');
    expect(read({ distanceToBoundaryFeet: SITE_EDGE_FEET + 1 }).position).toBe('adjoining_site');
    expect(read({ distanceToBoundaryFeet: NEAR_SITE_FEET }).position).toBe('adjoining_site');
    expect(read({ distanceToBoundaryFeet: NEAR_SITE_FEET + 1 }).position).toBe('same_corridor');
  });

  it('keeps a corridor extension positive — a cost question, not a failure', () => {
    const reading = read({ relationship: 'ON_SUBJECT_ROAD', distanceToBoundaryFeet: 230 });

    expect(reading.position).toBe('same_corridor');
    expect(utilityInfrastructureSignal(reading.position)).toBe('positive');
    expect(reading.statement).toMatch(/not an availability failure/i);
  });

  it('ignores a nonsensical measurement instead of degrading the read', () => {
    expect(read({ distanceToBoundaryFeet: Number.NaN }).position).toBe('adjoining_site');
    expect(read({ distanceToBoundaryFeet: -5 }).position).toBe('adjoining_site');
  });
});
