import { describe, it, expect } from 'vitest';
import {
  apnIdentifiersCorroborate,
  detectApnConflict,
  detectJurisdictionConflict,
} from './property-resolution-engine.js';

// Deal 30 (Cocke County, TN) canonical identity — the accepted, confirmed parcel.
const TN30_FULL = '015 027 04512 000 2026'; // full PARCELID: district+map+parcel+interest+year
const TN30_SHORT = '027 045.12';            // short map-and-parcel form
const TN30_GISLINK = '015027 04512';        // GISLINK: county+map+parcel, no interest/year

describe('apnIdentifiersCorroborate — Tennessee jurisdiction format variants', () => {
  it('short 027 045.12 and full 015 027 04512 000 2026 are the SAME parcel (no conflict)', () => {
    expect(apnIdentifiersCorroborate(TN30_SHORT, TN30_FULL)).toBe(true);
    expect(apnIdentifiersCorroborate(TN30_FULL, TN30_SHORT)).toBe(true);
  });

  it('the GISLINK collapsed form corroborates both the short and full forms', () => {
    expect(apnIdentifiersCorroborate(TN30_GISLINK, TN30_FULL)).toBe(true);
    expect(apnIdentifiersCorroborate(TN30_GISLINK, TN30_SHORT)).toBe(true);
  });

  it('equivalent punctuation and spacing variants corroborate', () => {
    for (const variant of ['027-045.12', '027 04512', '02704512', '  027   045 . 12 ', '027.045.12']) {
      expect(apnIdentifiersCorroborate(variant, TN30_FULL)).toBe(true);
    }
  });

  it('reordered APN groups are NOT the same parcel (conflict preserved)', () => {
    expect(apnIdentifiersCorroborate('04512 027 015 000 2026', TN30_FULL)).toBe(false);
    expect(apnIdentifiersCorroborate('045.12 027', TN30_SHORT)).toBe(false);
  });

  it('a different parcel suffix is NOT the same parcel (conflict preserved)', () => {
    expect(apnIdentifiersCorroborate('015 027 04513 000 2026', TN30_SHORT)).toBe(false); // parcel ...13 vs ...12
    expect(apnIdentifiersCorroborate('015 026 04512 000 2026', TN30_SHORT)).toBe(false); // map 026 vs 027
    expect(apnIdentifiersCorroborate('027 045.11', TN30_FULL)).toBe(false);              // neighboring parcel
  });

  it('Beaufort-style neighboring parcels (...0085 vs ...0084) stay a conflict', () => {
    expect(apnIdentifiersCorroborate('R300 018 000 0085', 'R300 018 000 0084')).toBe(false);
    expect(apnIdentifiersCorroborate('R300-018-000-0085-0000', 'R300-018-000-0084-0000')).toBe(false);
  });

  it('a weak partial (< 7 shared digits) never corroborates a longer identifier', () => {
    expect(apnIdentifiersCorroborate('4512', TN30_FULL)).toBe(false);
    expect(apnIdentifiersCorroborate('2026', TN30_FULL)).toBe(false);
  });

  it('identical parcels always corroborate', () => {
    expect(apnIdentifiersCorroborate(TN30_FULL, TN30_FULL)).toBe(true);
    expect(apnIdentifiersCorroborate('094-020.08', '094 02008 000')).toBe(true);
  });
});

describe('detectApnConflict — jurisdiction-aware equivalence', () => {
  it('does NOT flag a conflict when the resolved GISLINK is the short requested parcel in another format', () => {
    const conflict = detectApnConflict(
      { apn: TN30_SHORT },
      [{ apn: TN30_GISLINK, source: 'Tennessee Comptroller public parcel layer', context: 'JOINES TRAVIS — TALLEY RD' }],
    );
    expect(conflict).toBeNull();
  });

  it('does NOT flag a conflict when the requested full PARCELID resolves the GISLINK core', () => {
    const conflict = detectApnConflict(
      { apn: TN30_FULL },
      [{ apn: TN30_GISLINK, source: 'Tennessee Comptroller public parcel layer' }],
    );
    expect(conflict).toBeNull();
  });

  it('still flags a genuine wrong-parcel resolution (Beaufort ...0085 vs ...0084)', () => {
    const conflict = detectApnConflict(
      { apn: 'R300 018 000 0085 0000' },
      [{ apn: 'R300 018 000 0084 0000', source: 'Beaufort County public layer', context: 'BUSH LISA' }],
    );
    expect(conflict).not.toBeNull();
    expect(conflict?.resolvedApn).toContain('0084');
  });
});

describe('detectJurisdictionConflict — cross-county collision survives format variants', () => {
  it('flags the SAME parcel number resolved in a DIFFERENT county even across TN format variants', () => {
    const conflict = detectJurisdictionConflict(
      { apn: TN30_SHORT, county: 'Cocke', state: 'TN' },
      [{ apn: TN30_GISLINK, county: 'Washington', state: 'TN', source: 'unscoped statewide layer' }],
    );
    expect(conflict).not.toBeNull();
  });

  it('does not fire when the resolved parcel is in the requested county', () => {
    const conflict = detectJurisdictionConflict(
      { apn: TN30_SHORT, county: 'Cocke', state: 'TN' },
      [{ apn: TN30_GISLINK, county: 'Cocke', state: 'TN', source: 'Tennessee Comptroller public parcel layer' }],
    );
    expect(conflict).toBeNull();
  });
});
