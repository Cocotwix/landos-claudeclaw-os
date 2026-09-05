// The persisted terminal status of a marketplace lane.
//
// A provider REFUSAL and a provider ABSENCE are different operational facts.
// Zillow serving an anti-bot check, Realtor.com answering 429, or a board
// returning 403 all mean "this provider declined to answer"; an unavailable
// provider means "nothing answered". Collapsing both into `unavailable` is what
// left 26 retained lane attempts whose own payload said `"status": "blocked"`
// persisted as `unavailable`, so no lane in the system had ever recorded a
// refusal and the operator could not tell a challenged board from an absent one.

import { describe, expect, it } from 'vitest';

import { marketplaceProviderAdapter } from './property-intelligence-live.js';
import type { CanonicalPropertyInput, PropertyProviderStatus } from './property-intelligence-contract.js';

const property: CanonicalPropertyInput = {
  propertyCardId: 1,
  dealCardId: 1,
  normalizedAddress: '19554 nw 137th ln',
  address: '19554 NW 137th Ln',
  city: 'Lake Butler',
  county: 'Bradford',
  state: 'FL',
  zip: '32054',
  apn: '00083A03400',
  fips: null,
  landPortalPropertyId: null,
};

/** Run the adapter's own status mapping over a lane outcome. */
function persistedStatus(laneStatus: string): PropertyProviderStatus {
  const adapter = marketplaceProviderAdapter({
    laneId: 'zillow',
    providerId: 'zillow',
    execute: async () => ({ status: laneStatus, sold: [], active: [], note: null }) as never,
  });
  const execution = { status: laneStatus, sold: [], active: [], note: null } as never;
  const validation = adapter.validate(property, execution);
  return adapter.status(property, execution, validation, []);
}

describe('a marketplace refusal persists as blocked, never as unavailable', () => {
  it('records an anti-bot challenge as blocked', () => {
    // The exact shape Zillow returned on the Bradford County boards.
    expect(persistedStatus('blocked')).toBe('blocked');
  });

  it.each([
    ['captcha', 'captcha'],
    ['challenge served', 'challenge'],
    ['forbidden', 'forbidden'],
    ['http 403', '403'],
    ['http 429 rate limit', '429'],
    ['rate_limited', 'rate limit'],
  ])('records %s as blocked', (laneStatus) => {
    expect(persistedStatus(laneStatus)).toBe('blocked');
  });

  it('still records a genuine absence as unavailable', () => {
    expect(persistedStatus('unavailable')).toBe('unavailable');
    expect(persistedStatus('disabled')).toBe('unavailable');
  });

  it('records a lane that ran out of budget as timed_out', () => {
    expect(persistedStatus('timed_out')).toBe('timed_out');
    expect(persistedStatus('timeout')).toBe('timed_out');
  });

  it('keeps the existing meanings for the other outcomes', () => {
    expect(persistedStatus('not_applicable')).toBe('not_applicable');
    expect(persistedStatus('not applicable')).toBe('not_applicable');
    expect(persistedStatus('failed')).toBe('failed');
    expect(persistedStatus('error')).toBe('failed');
    // A successful marketplace retrieval is context about other properties,
    // never a verified fact about the subject parcel.
    expect(persistedStatus('retrieved')).toBe('context_only');
  });

  it('never reports a refusal as an absence', () => {
    for (const refusal of ['blocked', 'captcha', 'forbidden', 'http 429', 'rate limit']) {
      expect(persistedStatus(refusal)).not.toBe('unavailable');
    }
  });
});
