import { describe, it, expect, afterEach } from 'vitest';
import {
  classifySmartIntake, classifyParcelIdentity, registerIntakeIntent, listIntakeIntents,
  type IntakeIntent,
} from './intake-router.js';

describe('universal smart intake router', () => {
  it('routes a full address to Property Resolution (operational)', () => {
    const r = classifySmartIntake('388 Gilstrap Rd, Cleveland, GA 30528');
    expect(r.route).toBe('property_resolution');
    expect(r.lifecycle).toBe('operational');
    expect(r.hasParcelIdentity).toBe(true);
    expect(r.parsedFields.state).toBe('GA');
  });

  it('acceptance: preserves the uncertain locality and recognizes the supplied state/ZIP', () => {
    const raw = '171 Davidson Road venore, Tennessee 37885';
    const r = classifySmartIntake(raw);
    expect(r.route).toBe('property_resolution');
    expect(r.identityClass).toBe('full_address');
    expect(r.parsedFields.rawInput).toBe(raw);
    expect(r.parsedFields.address).toBe('171 Davidson Road');
    expect(r.parsedFields.city).toBe('venore');
    expect(r.parsedFields.city).not.toMatch(/Road/i);
    expect(r.parsedFields.state).toBe('TN');
    expect(r.parsedFields.zip).toBe('37885');
    expect(r.parsedFields.localityUncertain).toBe(true);
    expect(r.hasParcelIdentity).toBe(true);
  });

  it('routes an APN + county to Property Resolution', () => {
    const r = classifySmartIntake('APN 042 123, White County, GA');
    expect(r.route).toBe('property_resolution');
    expect(r.identityClass).toBe('apn_county');
  });

  it('routes a HIGHWAY-style address with a spelled-out state to Property Resolution', () => {
    const r = classifySmartIntake('2510 Highway 153, Winters, Texas');
    expect(r.route).toBe('property_resolution');
    expect(r.identityClass).toBe('full_address');
    expect(r.parsedFields.address).toBe('2510 Highway 153');
    expect(r.parsedFields.city).toBe('Winters');
    expect(r.parsedFields.state).toBe('TX'); // "Texas" resolved to TX
  });

  it('parses common highway/route address forms (full route number preserved)', () => {
    for (const [text, addr] of [
      ['2510 Hwy 153, Winters, TX', '2510 Hwy 153'],
      ['2510 State Highway 153, Winters, Texas', '2510 State Highway 153'],
      ['2510 US Highway 153, Winters, Texas', '2510 US Highway 153'],
      ['2510 TX-153, Winters, Texas', '2510 TX-153'],
      ['2510 FM 153, Winters, Texas', '2510 FM 153'],
      ['2510 County Road 153, Winters, Texas', '2510 County Road 153'],
    ] as const) {
      const r = classifySmartIntake(text);
      expect(r.route, text).toBe('property_resolution');
      expect(r.parsedFields.address, text).toBe(addr);
      expect(r.parsedFields.state, text).toBe('TX');
    }
  });

  it('accepts a spelled-out state on a normal street address (regression)', () => {
    const r = classifySmartIntake('57 Church Road, Arnold, Maryland');
    expect(r.route).toBe('property_resolution');
    expect(r.parsedFields.state).toBe('MD');
  });

  it('preserves a trailing ZIP with a spelled-out state (selected-suggestion label)', () => {
    const r = classifySmartIntake('2510 State Highway 153, Winters, TX, 79467');
    expect(r.route).toBe('property_resolution');
    expect(r.parsedFields.zip).toBe('79467');
  });

  it('routes owner + city/state to Property Resolution', () => {
    const r = classifySmartIntake('Owner: Cheryl Sann, Cleveland, GA');
    expect(r.route).toBe('property_resolution');
    expect(['owner_county', 'property_ambiguous']).toContain(r.identityClass);
  });

  it('routes an area-only query to the registered Area Market intent', () => {
    const r = classifySmartIntake('market stats for White County, GA');
    expect(r.route).toBe('area_market');
    expect(r.lifecycle).toBe('registered');
  });

  it('falls back to general for unrouted free text', () => {
    const r = classifySmartIntake('what is the weather like');
    expect(r.route).toBe('general');
  });

  it('classifies parcel identity strength deterministically', () => {
    expect(classifyParcelIdentity({ apn: 'X', county: 'White', state: 'GA' }, false)).toBe('apn_county');
    expect(classifyParcelIdentity({ address: '388 Gilstrap Rd', city: 'Cleveland', state: 'GA' }, true)).toBe('full_address');
    expect(classifyParcelIdentity({ city: 'Cleveland', state: 'GA' }, false)).toBe('street_city_state_only');
    expect(classifyParcelIdentity({}, false)).toBe('none');
  });

  it('lets a future department register an intent without changing the component', () => {
    const dispo: IntakeIntent = {
      id: 'dispo_buyer_match', label: 'Buyer Matching', route: 'future_department',
      departmentId: 'dispositions', lifecycle: 'registered', priority: 90,
      match: (ctx) => /buyer list|dispo/i.test(ctx.rawText),
    };
    registerIntakeIntent(dispo);
    const r = classifySmartIntake('add to buyer list');
    expect(r.intent.id).toBe('dispo_buyer_match');
    expect(listIntakeIntents().some((i) => i.id === 'dispo_buyer_match')).toBe(true);
  });

  afterEach(() => {
    // Re-register a no-op low-priority version so the global registry doesn't leak
    // a high-priority test intent into other tests.
    registerIntakeIntent({
      id: 'dispo_buyer_match', label: 'Buyer Matching', route: 'future_department',
      departmentId: 'dispositions', lifecycle: 'registered', priority: -1, match: () => false,
    });
  });
});
