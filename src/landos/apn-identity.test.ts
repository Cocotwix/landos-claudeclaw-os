import { describe, expect, it } from 'vitest';

import { apnCoreVariants, apnIdentifiersCorroborate } from './apn-identity.js';

describe('parcel identifier identity', () => {
  it('treats an Iredell County card suffix as the same parcel', () => {
    // 333 Cranfill Rd, Harmony NC. Intake supplied `4870-90-2087`; LandPortal
    // prints `4870-90-2087.000`. The old reduction read the parcel group 2087
    // as a tax YEAR and cut the core to `487090`, so one parcel produced two
    // cores and the resolver rejected the record it had already opened.
    expect(apnIdentifiersCorroborate('4870-90-2087', '4870-90-2087.000')).toBe(true);
    expect(apnCoreVariants('4870-90-2087')).toContain('4870902087');
  });

  it('still corroborates a Tennessee state-format APN against its county-local form', () => {
    expect(apnIdentifiersCorroborate('015 027 04512 000 2026', '027 045.12')).toBe(true);
    expect(apnIdentifiersCorroborate('042-123.00-000', '042 123.00')).toBe(true);
  });

  it('never corroborates a neighbouring or unrelated parcel', () => {
    expect(apnIdentifiersCorroborate('042-123.00-000', '042-124.00-000')).toBe(false);
    expect(apnIdentifiersCorroborate('4870-90-2087', '4870-90-2088')).toBe(false);
    expect(apnIdentifiersCorroborate('4068-00-37-4261', '4068-00-37-9999')).toBe(false);
    expect(apnIdentifiersCorroborate('123', '123')).toBe(false);
  });
});
