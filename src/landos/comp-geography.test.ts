import { describe, expect, it } from 'vitest';

import {
  assessCompGeography,
  compSubmarketKey,
  parseCompLocality,
  selectGeographicValuationSet,
  EXPANDED_MARKET_MILES,
} from './comp-geography.js';

const SUBJECT = { city: 'Fairview', zip: '37062', county: 'Williamson', state: 'TN' };

describe('parseCompLocality', () => {
  it('reads the city, state and ZIP a provider address run already states', () => {
    expect(parseCompLocality('5929 North Lick Creek Road, Franklin, TN, 37064'))
      .toEqual({ city: 'Franklin', state: 'TN', zip: '37064' });
    expect(parseCompLocality('0 Giles Hill Rd, College Grove, TN, 37046'))
      .toEqual({ city: 'College Grove', state: 'TN', zip: '37046' });
  });

  it('reads a run whose state and ZIP share one segment', () => {
    expect(parseCompLocality('7621 Fernvale Rd, Fairview, TN 37062'))
      .toEqual({ city: 'Fairview', state: 'TN', zip: '37062' });
  });

  it('invents nothing when the run states no locality', () => {
    expect(parseCompLocality('Map 042 Parcel 123')).toEqual({ city: null, state: null, zip: null });
    expect(parseCompLocality(null)).toEqual({ city: null, state: null, zip: null });
    // A leading empty segment is not a street, so the run states no city.
    expect(parseCompLocality(', Franklin, TN, 37064').city).toBe('Franklin');
  });
});

describe('assessCompGeography', () => {
  it('keeps retained coordinates and the distance they produce', () => {
    const result = assessCompGeography({
      distanceMiles: 2.9,
      precision: 'exact',
      comp: { city: null, zip: '37062', county: 'Williamson', state: 'TN' },
      subject: SUBJECT,
    });
    expect(result.tierId).toBe('local');
    expect(result.distanceMiles).toBe(2.9);
    expect(result.cardLine).toContain('2.9 miles from subject');
    expect(result.cardLine).toContain('Local market');
  });

  it('calls a nearby different submarket expanded, not local', () => {
    const result = assessCompGeography({
      distanceMiles: 8.8,
      precision: 'exact',
      comp: { city: 'Franklin', zip: '37064', county: 'Williamson', state: 'TN' },
      subject: SUBJECT,
    });
    expect(result.tierId).toBe('expanded');
    expect(result.sameSubmarket).toBe(false);
    expect(result.sameCounty).toBe(true);
  });

  it('never lets county membership alone imply local comparability', () => {
    const result = assessCompGeography({
      distanceMiles: 26.4,
      precision: 'exact',
      comp: { city: 'College Grove', zip: '37046', county: 'Williamson', state: 'TN' },
      subject: SUBJECT,
    });
    expect(result.sameCounty).toBe(true);
    expect(result.tierId).toBe('broader');
    expect(result.reason).toContain('not local comparability');
  });

  it('refuses to call an area centroid local evidence however close it lands', () => {
    const exact = assessCompGeography({
      distanceMiles: 3.1, precision: 'exact',
      comp: { city: 'Fairview', zip: '37062', county: 'Williamson', state: 'TN' }, subject: SUBJECT,
    });
    const approximate = assessCompGeography({
      distanceMiles: 3.1, precision: 'approximate',
      comp: { city: 'Fairview', zip: '37062', county: 'Williamson', state: 'TN' }, subject: SUBJECT,
    });
    expect(exact.tierId).toBe('local');
    expect(approximate.tierId).toBe('expanded');
    expect(approximate.reason).toContain('centroid');
  });

  it('invents no distance when the location is unresolved', () => {
    const result = assessCompGeography({
      distanceMiles: null,
      precision: 'exact',
      comp: { city: 'Franklin', zip: '37064', county: 'Williamson', state: 'TN' },
      subject: SUBJECT,
    });
    expect(result.tierId).toBe('unresolved');
    expect(result.distanceMiles).toBeNull();
    expect(result.precision).toBe('unresolved');
    expect(result.tier.weightMultiplier).toBeLessThan(1);
  });

  it('keeps a same-submarket sale local out to the full local ring', () => {
    const result = assessCompGeography({
      distanceMiles: 9.2, precision: 'exact',
      comp: { city: 'Fairview', zip: '37062', county: 'Williamson', state: 'TN' }, subject: SUBJECT,
    });
    expect(result.tierId).toBe('local');
    expect(compSubmarketKey('Fairview', '37062')).toBe('zip:37062');
  });

  it('puts everything past the expanded market into broader context', () => {
    const result = assessCompGeography({
      distanceMiles: EXPANDED_MARKET_MILES + 0.1, precision: 'exact',
      comp: { city: 'Fairview', zip: '37062', county: 'Williamson', state: 'TN' }, subject: SUBJECT,
    });
    expect(result.tierId).toBe('broader');
  });
});

describe('selectGeographicValuationSet', () => {
  const set = (tiers: Array<'local' | 'expanded' | 'broader' | 'unresolved'>) =>
    tiers.map((tierId, index) => ({ key: `c${index}`, tierId }));

  it('stays local when local evidence is sufficient', () => {
    const selection = selectGeographicValuationSet(set(['local', 'local', 'local', 'expanded', 'broader']));
    expect(selection.tiersIncluded).toEqual(['local']);
    expect(selection.admittedCount).toBe(3);
    expect(selection.expandedBeyondLocal).toBe(false);
    expect(selection.reliesOnBroaderGeography).toBe(false);
    expect(selection.compositionLabel).toBe('3 closed sales qualify: 3 local');
    expect(selection.disclosure).toContain('no geographic expansion was needed');
  });

  it('expands outward only when the closer tier cannot support the value', () => {
    const selection = selectGeographicValuationSet(set(['local', 'expanded', 'expanded', 'broader']));
    expect(selection.tiersIncluded).toEqual(['local', 'expanded']);
    expect(selection.reliesOnBroaderGeography).toBe(false);
    expect(selection.compositionLabel).toBe('3 closed sales qualify: 1 local · 2 expanded');
    expect(selection.disclosure).toContain('stopped at the nearby/expanded market');
  });

  it('admits broader geography when local and expanded together are insufficient, and discloses it', () => {
    const selection = selectGeographicValuationSet(set(['local', 'broader', 'broader', 'broader']));
    expect(selection.tiersIncluded).toEqual(['local', 'expanded', 'broader']);
    expect(selection.reliesOnBroaderGeography).toBe(true);
    expect(selection.compositionLabel).toBe('4 closed sales qualify: 1 local · 3 broader-market support');
    expect(selection.disclosure).toContain('relies materially on geography outside');
  });

  it('never gives location-unresolved records local treatment while resolved evidence exists', () => {
    const selection = selectGeographicValuationSet(set(['local', 'local', 'unresolved', 'unresolved']));
    expect(selection.tiersIncluded).not.toContain('unresolved');
    expect(selection.admitted.unresolved).toBe(0);
    expect(selection.heldOut).toHaveLength(2);
    expect(selection.heldOut[0].reason).toContain('retained as market context');
  });

  it('reaches location-unresolved evidence only as a last resort, and says so', () => {
    const selection = selectGeographicValuationSet(set(['unresolved', 'unresolved']));
    expect(selection.tiersIncluded).toContain('unresolved');
    expect(selection.reliesOnBroaderGeography).toBe(true);
    expect(selection.admittedCount).toBe(2);
  });

  it('retains every candidate: admitted plus held out is the whole universe', () => {
    const candidates = set(['local', 'local', 'local', 'expanded', 'broader', 'unresolved']);
    const selection = selectGeographicValuationSet(candidates);
    expect(selection.admittedKeys.length + selection.heldOut.length).toBe(candidates.length);
  });
});
