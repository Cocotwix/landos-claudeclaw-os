import { describe, expect, it } from 'vitest';

import {
  acceptZip,
  isSameSubject,
  normalizeApn,
  shouldRematch,
  stripAbsorbedAcreage,
  subjectKey,
} from './canonical-subject-identity.js';

// These reproduce the exact intake corruptions that created three active Deal
// Cards for one Bradford County parcel. Each assertion fails against the
// pre-repair behaviour, where comparison ran on the raw intake string.
describe('canonical subject identity', () => {
  it('treats APN punctuation variants as one canonical property', () => {
    expect(normalizeApn('00083-A-03400')).toBe('00083A03400');
    expect(normalizeApn('00083 A 03400')).toBe('00083A03400');
    expect(normalizeApn('00083a03400')).toBe('00083A03400');

    const a = { state: 'FL', county: 'Bradford', apn: '00083-A-03400' };
    const b = { state: 'FL', county: 'Bradford County', apn: '00083A03400' };
    expect(isSameSubject(a, b)).toBe(true);
    expect(subjectKey(a).official).toBe(true);
  });

  it('refuses to absorb seller-stated acreage into the parcel identifier', () => {
    // The exact string that created the third card.
    const repaired = stripAbsorbedAcreage('00083-A-034001.5');
    expect(repaired.apn).toBe('00083-A-03400');
    expect(repaired.absorbedAcreage).toBe(1.5);

    expect(isSameSubject(
      { state: 'FL', county: 'Bradford', apn: '00083-A-034001.5' },
      { state: 'FL', county: 'Bradford', apn: '00083A03400' },
    )).toBe(true);
  });

  it('leaves a legitimate identifier that merely contains digits untouched', () => {
    expect(stripAbsorbedAcreage('00083-A-03400').apn).toBe('00083-A-03400');
    expect(stripAbsorbedAcreage('00083-A-03400').absorbedAcreage).toBeNull();
    expect(stripAbsorbedAcreage('12-34-567').absorbedAcreage).toBeNull();
  });

  it('refuses a ZIP that is really the street number', () => {
    // The feed supplied ZIP 19554 for 19554 NW 137th Ln.
    expect(acceptZip('19554', '19554 NW 137th Ln')).toBeNull();
    expect(acceptZip('32054', '19554 NW 137th Ln')).toBe('32054');
    expect(acceptZip('not-a-zip', '19554 NW 137th Ln')).toBeNull();
  });

  it('does not let a malformed state permanently fork the identity', () => {
    // "ID" was a parse artifact; once the APN is known the parcel is the same
    // subject regardless of what the feed claimed the state was.
    const malformed = { state: 'ID', county: 'Bradford', apn: '00083-A-03400' };
    const corrected = { state: 'FL', county: 'Bradford', apn: '00083-A-03400' };
    expect(isSameSubject(malformed, corrected)).toBe(false);
    // ...but the correction is detected, which forces the rematch that
    // reconciles it with the canonical card instead of leaving a second one.
    expect(shouldRematch(malformed, corrected)).toBe(true);
  });

  it('normalizes the APN before comparison whenever a usable APN exists', () => {
    const key = subjectKey({ state: 'FL', county: 'Bradford', apn: '00083-A-03400' });
    expect(key.basis).toBe('apn');
    expect(key.key).toContain('00083A03400');
    expect(key.key).not.toContain('-');
  });

  it('falls back to a provisional key before the APN is resolved, and rematches after', () => {
    const before = { address: '19554 NW 137th Ln', state: 'FL', zip: '32054' };
    const after = { ...before, apn: '00083-A-03400', county: 'Bradford' };
    expect(subjectKey(before).official).toBe(false);
    expect(subjectKey(before).basis).toBe('provisional_address');
    expect(subjectKey(after).official).toBe(true);
    expect(shouldRematch(before, after)).toBe(true);
  });

  it('keeps a partial conveyance distinct from its parent parcel', () => {
    const whole = { state: 'FL', county: 'Bradford', apn: '00083-A-03400' };
    const split = {
      ...whole,
      scope: { kind: 'partial' as const, label: 'north 5 acres' },
    };
    expect(isSameSubject(whole, split)).toBe(false);

    const assemblage = {
      ...whole,
      scope: { kind: 'assemblage' as const, label: 'hill + adjoining' },
    };
    expect(isSameSubject(whole, assemblage)).toBe(false);
    expect(isSameSubject(split, { ...split })).toBe(true);
  });

  it('never establishes identity from coordinates alone', () => {
    const point = subjectKey({ lat: 30.001566, lng: -82.272184 });
    expect(point.basis).toBe('provisional_point');
    expect(point.official).toBe(false);
  });

  it('produces no key at all when nothing usable was supplied', () => {
    expect(subjectKey({}).basis).toBe('none');
    expect(isSameSubject({}, {})).toBe(false);
  });
});
