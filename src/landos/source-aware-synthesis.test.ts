import { describe, expect, it } from 'vitest';

import {
  claim,
  normalizeClaimValue,
  standingBreakdown,
  synthesizeClaims,
  type ClaimSeed,
  type SourcedClaim,
} from './source-aware-synthesis.js';

// Synthesis has exactly four jobs and each of them has an expensive failure
// mode: losing evidence, deleting a real second source as a "duplicate",
// ranking a stale provider echo above the county's own record, and hiding a
// disagreement the operator's decision actually rests on.

function seed(overrides: Partial<ClaimSeed> = {}): ClaimSeed {
  return {
    topic: 'record.acreage',
    label: 'Acreage',
    statement: 'The record carries 1.5 acres.',
    value: 1.5,
    standing: 'record_fact',
    weight: 'well_supported',
    sourceName: 'Provider parcel panel',
    tier: 'provider_record',
    geography: 'parcel 00083A03400',
    retrievedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const build = (seeds: ClaimSeed[]): SourcedClaim[] =>
  seeds.map((entry, index) => claim('t', index, entry)).filter((entry): entry is SourcedClaim => entry != null);

describe('claim admission', () => {
  it('drops a seed that says nothing rather than emitting a sourced blank', () => {
    expect(claim('t', 0, seed({ statement: '', value: null }))).toBeNull();
    expect(claim('t', 0, seed({ statement: '', value: '-' }))).toBeNull();
    expect(claim('t', 0, seed({ statement: '', value: 'unknown' }))).toBeNull();
  });

  it('keeps a narrative claim that carries no comparable value', () => {
    const only = claim('t', 0, seed({ statement: 'Access is unresolved.', value: null }));
    expect(only?.value).toBeNull();
    expect(only?.statement).toBe('Access is unresolved.');
  });
});

describe('value normalization', () => {
  it('treats formatting variants of one number as one answer', () => {
    expect(normalizeClaimValue('1.50')).toBe(normalizeClaimValue('1.5'));
    expect(normalizeClaimValue('$28,008')).toBe(normalizeClaimValue('28008'));
    expect(normalizeClaimValue('Zone X')).toBe(normalizeClaimValue('zone-x'));
  });
});

describe('deduplication', () => {
  it('collapses only the same value from the same source and locator', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ locator: 'panel row 3' }),
        seed({ locator: 'panel row 3' }),
      ]),
    });
    expect(synthesis.claims).toHaveLength(1);
    expect(synthesis.duplicatesCollapsed[0].collapsed).toHaveLength(1);
  });

  it('never collapses two different sources that happen to agree', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'Bradford County assessor', tier: 'official_primary' }),
        seed({ sourceName: 'Provider parcel panel' }),
      ]),
    });
    expect(synthesis.claims).toHaveLength(2);
    expect(synthesis.duplicatesCollapsed).toHaveLength(0);
    // Agreement across sources is recorded as strength, not thrown away.
    expect(synthesis.claims[0].corroboratedBy).toHaveLength(1);
  });

  it('preserves the same source stated at two different locators', () => {
    const synthesis = synthesizeClaims({
      claims: build([seed({ locator: 'page 1' }), seed({ locator: 'page 4' })]),
    });
    expect(synthesis.claims).toHaveLength(2);
  });
});

describe('ranking', () => {
  it('puts the official record above a provider echo of the same field', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'Provider parcel panel', tier: 'provider_record', value: 1.5 }),
        seed({ sourceName: 'Bradford County assessor', tier: 'official_primary', weight: 'confirmed', value: 1.846 }),
      ]),
    });
    expect(synthesis.claims[0].source.name).toBe('Bradford County assessor');
  });

  it('breaks an authority tie on freshness, then on geographic relevance', () => {
    const fresher = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'A', retrievedAt: '2026-01-01T00:00:00.000Z', value: 10 }),
        seed({ sourceName: 'B', retrievedAt: '2026-08-01T00:00:00.000Z', value: 11 }),
      ]),
    });
    expect(fresher.claims[0].source.name).toBe('B');

    const closer = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'County figure', geography: 'Bradford County', value: 20 }),
        seed({ sourceName: 'Parcel figure', geography: 'parcel 00083A03400', value: 21 }),
      ]),
    });
    expect(closer.claims[0].source.name).toBe('Parcel figure');
  });

  it('is byte-stable for the same evidence, so an unchanged reading rehashes identically', () => {
    const claims = build([
      seed({ sourceName: 'A', value: 1 }),
      seed({ sourceName: 'B', value: 2 }),
      seed({ topic: 'access.road', label: 'Road', statement: 'NW 137th Ln.', value: 'NW 137th Ln' }),
    ]);
    const first = JSON.stringify(synthesizeClaims({ claims }));
    const second = JSON.stringify(synthesizeClaims({ claims: [...claims].reverse() }));
    expect(first).toBe(second);
  });
});

describe('conflicts', () => {
  it('surfaces a material disagreement and names both sides', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'Provider parcel panel', value: 1.5 }),
        seed({ sourceName: 'County GIS', tier: 'provider_record', value: 1.846 }),
      ]),
      topicLabels: { 'record.acreage': 'Acreage' },
    });
    expect(synthesis.conflicts).toHaveLength(1);
    const conflict = synthesis.conflicts[0];
    expect(conflict.sides.map((side) => side.value)).toEqual(expect.arrayContaining(['1.846', '1.5']));
    // Equal authority never lets LandOS pick a winner.
    expect(conflict.resolution).toBe('unresolved');
  });

  it('resolves a disagreement only when a strictly higher authority carries it', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ sourceName: 'Provider parcel panel', tier: 'provider_record', value: 1.5 }),
        seed({ sourceName: 'Bradford County assessor', tier: 'official_primary', weight: 'confirmed', value: 1.846 }),
      ]),
    });
    expect(synthesis.conflicts[0].resolution).toBe('resolved');
    expect(synthesis.conflicts[0].reason).toContain('Official / primary record');
  });

  it('does not call a rounding difference a conflict', () => {
    const synthesis = synthesizeClaims({
      claims: build([seed({ sourceName: 'A', value: 1.5 }), seed({ sourceName: 'B', value: 1.51 })]),
    });
    expect(synthesis.conflicts[0].material).toBe(false);
    expect(synthesis.conflicts[0].resolution).toBe('resolved');
  });

  it('never manufactures a conflict between two narrative statements', () => {
    const synthesis = synthesizeClaims({
      claims: build([
        seed({ topic: 'access.read', statement: 'Frontage is mapped.', value: null }),
        seed({ topic: 'access.read', statement: 'No recorded easement is retained.', value: null, sourceName: 'Other' }),
      ]),
    });
    expect(synthesis.conflicts).toHaveLength(0);
    expect(synthesis.claims).toHaveLength(2);
  });
});

describe('standing separation', () => {
  it('counts each standing so a surface can keep observation apart from fact', () => {
    const counts = standingBreakdown(build([
      seed({ standing: 'official_legal_fact', sourceName: 'A' }),
      seed({ standing: 'visual_observation', sourceName: 'B', topic: 'visual.1' }),
      seed({ standing: 'analytical_hypothesis', sourceName: 'C', topic: 'hyp.1' }),
      seed({ standing: 'verification_need', sourceName: 'D', topic: 'need.1', value: null, statement: 'Title is unverified.' }),
    ]));
    expect(counts).toMatchObject({
      official_legal_fact: 1,
      visual_observation: 1,
      analytical_hypothesis: 1,
      verification_need: 1,
    });
  });
});
