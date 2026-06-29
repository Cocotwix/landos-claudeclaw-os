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

  it('routes an APN + county to Property Resolution', () => {
    const r = classifySmartIntake('APN 042 123, White County, GA');
    expect(r.route).toBe('property_resolution');
    expect(r.identityClass).toBe('apn_county');
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
