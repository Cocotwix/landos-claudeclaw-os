// An acreage figure standing next to a parcel number must never become part of
// the parcel number. Live acceptance case: Deal 114 (19554 NW 137th Ln, Bradford
// County, FL) stored "00083-A-03400 1.5" as its canonical APN because the lead
// text read "APN 00083-A-03400 1.5 AC BRADFORD COUNTY, FL". Every downstream
// comparison then answered the wrong question: the subject survey naming
// 00083-A-03400 read as a DIFFERENT parcel, the subject never resolved, and
// governing acreage never established. System-wide, not one property.

import { describe, expect, it } from 'vitest';
import { extractApnCandidates } from './intake-normalize.js';
import { extractPropertyArgs } from './duke-preflight.js';
import { apnEquivalent, normalizeApn } from './property-intelligence-snapshot.js';

describe('an adjacent acreage never enters the parcel identifier', () => {
  it('captures the parcel number without the acreage that follows it', () => {
    const result = extractApnCandidates('APN 00083-A-03400 1.5 AC BRADFORD COUNTY, FL');
    expect(result.primary).toBe('00083-A-03400');
    expect(result.parcels).toEqual(['00083-A-03400']);
  });

  it('drops the acreage for every unit spelling', () => {
    for (const unit of ['AC', 'ACS', 'acre', 'acres', 'Acres']) {
      expect(extractApnCandidates(`Parcel ID: 00083-A-03400 1.5 ${unit} in Bradford County`).primary)
        .toBe('00083-A-03400');
    }
  });

  it('keeps a decimal that is genuinely inside the parcel number', () => {
    // "020.08" is joined to its identifier by a separator, not whitespace.
    expect(extractApnCandidates('Parcel ID: 094-020.08 acres 5 in Scott County').primary)
      .toBe('094-020.08');
    expect(extractApnCandidates('Parcel ID: 094-020.08 in Scott County').primary)
      .toBe('094-020.08');
  });

  // Deal 114's ACTUAL lead text: the paste lost its line breaks, so the owner
  // name ran into "APN", and the parcel number ran into "1.5 AC", which ran into
  // "BRADFORD COUNTY, FL".
  it('separates an acreage that was run together with the parcel number', () => {
    const result = extractApnCandidates(
      'Owner of record HILL EUGENE WAPN 00083-A-034001.5 ACBRADFORD COUNTY, FL',
    );
    expect(result.primary).toBe('00083-A-03400');
    expect(result.parcels).toEqual(['00083-A-03400']);
  });

  it('refuses the glued split when no acreage unit follows', () => {
    expect(extractApnCandidates('Parcel ID: 00083-A-034001.5 in Bradford County').primary)
      .toBe('00083-A-034001.5');
  });

  it('refuses the glued split when it would gut the parcel number', () => {
    expect(extractApnCandidates('APN 12341.5 acres').primary).toBe('12341.5');
  });

  it('leaves a parcel number alone when no acreage unit follows', () => {
    expect(extractApnCandidates('APN 015 027 04512 000 2026 in Cocke County').primary)
      .toBe('015 027 04512 000 2026');
  });
});

// `extractPropertyArgs` runs its own labeled-APN capture and OUTRANKS the shared
// scanner, so the same rule has to hold there or the corrupted identifier wins.
describe('the preflight parcel capture applies the same rule', () => {
  it('drops a spaced acreage', () => {
    expect(extractPropertyArgs('APN 00083-A-03400 1.5 AC BRADFORD COUNTY, FL')?.apn).toBe('00083-A-03400');
  });

  it('separates a run-together acreage under its label', () => {
    expect(extractPropertyArgs('APN 00083-A-034001.5 ACBRADFORD COUNTY, FL')?.apn).toBe('00083-A-03400');
  });

  // With the line breaks lost the label itself is destroyed ("...EUGENE WAPN"),
  // so no labeled capture applies and only the bare scanner sees the run — which
  // never held the "00083-A-" prefix to begin with. It used to hand back
  // "034001.5" as the parcel number. A wrong APN is worse than no APN: parcel
  // identity gates all downstream property intelligence.
  it('emits no parcel number rather than a corrupted one', () => {
    expect(extractPropertyArgs('Owner of record HILL EUGENE WAPN 00083-A-034001.5 ACBRADFORD COUNTY, FL')?.apn)
      .toBeUndefined();
  });

  it('leaves an ordinary labeled parcel number untouched', () => {
    expect(extractPropertyArgs('Parcel ID: 094-020.08, Scott County, Tennessee')?.apn).toBe('094-020.08');
  });
});

describe('the canonical parcel-equivalence contract answers the Bradford spellings', () => {
  const SPELLINGS = ['00083-A-03400', '00083-A-034-00', '000-83A-034-00'];

  it('treats every source formatting of one Bradford parcel as the same parcel', () => {
    for (const left of SPELLINGS) {
      for (const right of SPELLINGS) expect(apnEquivalent(left, right)).toBe(true);
    }
  });

  it('still separates a genuinely different Bradford parcel', () => {
    expect(apnEquivalent('00083-A-03400', '00083-A-03600')).toBe(false);
    expect(normalizeApn('00083-A-03400')).not.toBe(normalizeApn('00083-A-03600'));
  });

  it('does not treat the acreage-corrupted spelling as the subject parcel', () => {
    // The corrupted identifier is a DIFFERENT identifier, not a format variant.
    // This is why the capture above has to be right at intake.
    expect(apnEquivalent('00083-A-03400 1.5', '00083-A-03400')).toBe(false);
  });
});

// The live Deal 114 paste came out of a rendered page, so its word gaps are
// NO-BREAK SPACE (U+00A0), not spaces. A `[ \t]` class never matched them, the
// acreage unit was invisible, and the corrupted parcel number stood.
describe('a no-break space is still a space beside a parcel number', () => {
  const NB = '\u00a0';

  it('separates a run-together acreage across no-break spaces', () => {
    expect(extractApnCandidates(`Owner of record HILL EUGENE WAPN${NB}00083-A-034001.5${NB}ACBRADFORD COUNTY, FL`).primary)
      .toBe('00083-A-03400');
  });

  it('separates a spaced acreage across no-break spaces', () => {
    expect(extractApnCandidates(`APN${NB}00083-A-03400${NB}1.5${NB}AC BRADFORD COUNTY, FL`).primary)
      .toBe('00083-A-03400');
  });
});
