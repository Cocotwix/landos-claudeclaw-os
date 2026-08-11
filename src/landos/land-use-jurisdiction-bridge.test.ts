// The Land Use → Zoning jurisdiction bridge: the accepted governing authority
// must reach the zoning diligence read model without being re-researched,
// re-graded, or invented. Deal 83 / 9490 Elk Lake Rd is the acceptance case.

import { describe, expect, it } from 'vitest';

import { jurisdictionClaimFromLandUse } from './land-use-jurisdiction-bridge.js';
import type {
  AuthorityStack,
  EvidencedValue,
  LandUseDetermination,
  ResolvedAuthority,
} from './land-use-types.js';

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=9490';

function evidenced(value: string | null, quality: EvidencedValue<string>['quality']): EvidencedValue<string> {
  return {
    value,
    quality,
    citations: value
      ? [{
        tier: 'state_agency',
        label: 'U.S. Census Bureau geography service',
        url: CENSUS_URL,
        publisher: 'U.S. Census Bureau',
        citation: null,
        excerpt: 'The address falls inside the minor civil division Whitewater township.',
        format: 'json_api',
        effectiveDate: null,
        retrievedAt: '2026-08-07T15:36:48.780Z',
      }]
      : [],
    unresolvedReason: value ? null : 'not resolved',
    conflict: null,
  } as EvidencedValue<string>;
}

function authority(
  name: string | null,
  unitType: ResolvedAuthority['unitType'],
  quality: EvidencedValue<string>['quality'] = 'verified_official',
): ResolvedAuthority {
  return { role: 'zoning', name: evidenced(name, quality), unitType, relationship: null, officialUrl: null };
}

function determinationWith(stack: Partial<AuthorityStack>): LandUseDetermination {
  return {
    determinedAt: '2026-08-07T15:36:48.780Z',
    authority: {
      state: authority('Michigan', 'state'),
      county: authority('Grand Traverse County', 'county'),
      localUnit: authority('Whitewater township', 'township'),
      incorporation: { value: 'unincorporated', quality: 'verified_official', citations: [], unresolvedReason: null, conflict: null },
      zoningAuthority: authority('Whitewater township', 'township'),
      subdivisionAuthority: authority('Whitewater township', 'township'),
      septicHealthAuthority: authority(null, 'unknown'),
      roadAccessAuthority: authority(null, 'unknown'),
      otherAuthorities: [],
      pattern: 'state_framework_local_administration',
      patternExplanation: 'Michigan sets a statewide land-division framework and Whitewater township administers local approval within it.',
      ...stack,
    },
    zoning: { presence: 'zoning_unverified', code: evidenced(null, 'unverified') },
  } as unknown as LandUseDetermination;
}

const bridge = (determination: LandUseDetermination, mailingCity: string | null = 'Williamsburg') =>
  jurisdictionClaimFromLandUse({ determination, mailingCity });

describe('jurisdictionClaimFromLandUse — deal 83 propagation', () => {
  it('restates the accepted zoning authority for the diligence read model', () => {
    const result = bridge(determinationWith({}));
    expect(result).not.toBeNull();
    expect(result!.authorityName).toBe('Whitewater township');
    expect(result!.authorityLevel).toBe('township');
    expect(result!.determination).toBe('confirmed');
  });

  it('carries the original citation as provenance rather than inventing one', () => {
    const result = bridge(determinationWith({}))!;
    expect(result.sourceUrl).toBe(CENSUS_URL);
    expect(result.sourceName).toBe('U.S. Census Bureau geography service');
    expect(result.retrievedAt).toBe('2026-08-07T15:36:48.780Z');
    expect(result.basis).toContain('Whitewater township');
  });

  it('a township administering zoning is township_jurisdiction, not unincorporated_county', () => {
    expect(bridge(determinationWith({}))!.incorporationStatus).toBe('township_jurisdiction');
  });

  it('never upgrades a weaker land-use value to confirmed', () => {
    const weaker = determinationWith({
      zoningAuthority: authority('Whitewater township', 'township', 'provisional_official'),
    });
    expect(bridge(weaker)!.determination).toBe('probable');
  });

  it('returns null when no authority was accepted — silence is not a finding', () => {
    const empty = determinationWith({
      zoningAuthority: authority(null, 'unknown'),
      localUnit: authority(null, 'unknown'),
    });
    expect(bridge(empty)).toBeNull();
  });

  it('falls back to the local unit only when the zoning role is unresolved', () => {
    const noZoningRole = determinationWith({ zoningAuthority: authority(null, 'unknown') });
    expect(bridge(noZoningRole)!.authorityName).toBe('Whitewater township');
  });

  it('flags a mailing city that differs from the governing authority', () => {
    expect(bridge(determinationWith({}), 'Williamsburg')!.mailingCityDiffersFromAuthority).toBe(true);
  });

  it('does not flag a mailing city that matches the authority', () => {
    expect(bridge(determinationWith({}), 'Whitewater')!.mailingCityDiffersFromAuthority).toBe(false);
  });

  it('names the county as a considered candidate without promoting it', () => {
    const result = bridge(determinationWith({}))!;
    expect(result.candidateAuthoritiesConsidered).toContain('Grand Traverse County');
    expect(result.authorityName).not.toBe('Grand Traverse County');
  });

  it('states the authority pattern so the operator sees why it governs', () => {
    expect(bridge(determinationWith({}))!.basis).toContain('statewide land-division framework');
  });
});
