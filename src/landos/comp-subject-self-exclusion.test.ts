// A property is never a comparable for its own valuation.
//
// On 5170 Hwy 60 the subject's own APN 023 003.02 sat in the valuation set
// carrying weight, so the subject was helping to set its own price. Identity
// decides this, never resemblance: LandPortal's canonical property id, or an
// APN that reconciles with the subject's INSIDE the same jurisdiction. The
// subject row on that card in fact carried ANOTHER parcel's URL, so a URL-only
// test would have missed it.

import { describe, expect, it } from 'vitest';

import { subjectParcelMatch, type SubjectParcelIdentity } from './comp-subject-identity.js';

const SUBJECT: SubjectParcelIdentity = {
  apn: '023 003.02',
  county: 'Hamilton',
  state: 'TN',
  landPortalPropertyId: '172954755',
};

const lpUrl = (fips: string, apn: string, propertyId: string): string =>
  `https://landportal.com/?property=${Buffer.from(`fips=${fips}&apn=${apn}&propertyid=${propertyId}`).toString('base64')}`;

describe('the subject parcel is excluded from its own comparable set', () => {
  it('matches the subject on APN inside the same jurisdiction', () => {
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: 'Hamilton', state: 'TN', sourceUrl: null },
      SUBJECT,
    )).toContain('APN 023 003.02');
  });

  it('matches on the canonical LandPortal property id even when the APN is absent', () => {
    expect(subjectParcelMatch(
      { apn: null, county: null, state: null, sourceUrl: lpUrl('47065', '023 003.02', '172954755') },
      SUBJECT,
    )).toContain('172954755');
  });

  it('still catches the subject when its row carries another parcel URL', () => {
    // The live card 77 case: subject APN, another parcel's canonical URL.
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: 'Hamilton', state: 'TN', sourceUrl: lpUrl('47065', '044 068.01', '999999') },
      SUBJECT,
    )).toContain('APN 023 003.02');
  });

  it('tolerates the county being written with or without the "County" suffix', () => {
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: 'Hamilton County', state: 'TN', sourceUrl: null },
      SUBJECT,
    )).toBeTruthy();
  });

  it('leaves every legitimate comparable alone', () => {
    for (const apn of ['020 092.01', '058I A 042.03', '053 003.03', '043 042', '044 068.01', '047 013', '027 014.09']) {
      expect(subjectParcelMatch({ apn, county: 'Hamilton County', state: 'TN', sourceUrl: null }, SUBJECT)).toBeNull();
    }
  });

  it('never excludes the same APN in another jurisdiction', () => {
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: 'Davidson', state: 'TN', sourceUrl: null },
      SUBJECT,
    )).toBeNull();
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: 'Hamilton', state: 'GA', sourceUrl: null },
      SUBJECT,
    )).toBeNull();
  });

  it('never decides on address text, and never on an unconfirmable identity', () => {
    // Same street as the subject, different parcel: not the subject.
    expect(subjectParcelMatch(
      { apn: '020 092.01', county: 'Hamilton', state: 'TN', sourceUrl: null },
      SUBJECT,
    )).toBeNull();
    // Subject APN but no jurisdiction stated anywhere: cannot be confirmed, so
    // the row is left exactly where it was rather than deleted on a guess.
    expect(subjectParcelMatch(
      { apn: '023 003.02', county: null, state: null, sourceUrl: null },
      SUBJECT,
    )).toBeNull();
  });

  it('does nothing when the subject itself has no established identity', () => {
    const unknown: SubjectParcelIdentity = { apn: null, county: null, state: null, landPortalPropertyId: null };
    expect(subjectParcelMatch({ apn: '023 003.02', county: 'Hamilton', state: 'TN', sourceUrl: null }, unknown)).toBeNull();
  });
});
