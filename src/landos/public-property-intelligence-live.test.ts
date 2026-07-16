import { describe, expect, it } from 'vitest';
import { addressesMateriallyAgree } from './public-property-intelligence-live.js';

describe('official public parcel address reconciliation (unit)', () => {
  it('accepts suffix, capitalization, and one-token official normalization variants', () => {
    expect(addressesMateriallyAgree('171 Davidson Road', '171 DAVIDSON RD')).toBe(true);
    expect(addressesMateriallyAgree('171 Davidson Road', '171 CAMP DAVIDSON RD')).toBe(true);
    expect(addressesMateriallyAgree('171 Camp Davidson Road', '171 CAMP DAVIDSON RD')).toBe(true);
  });

  it('keeps genuine street-number and street-name conflicts blocked', () => {
    expect(addressesMateriallyAgree('171 Davidson Road', '172 CAMP DAVIDSON RD')).toBe(false);
    expect(addressesMateriallyAgree('171 Davidson Road', '171 LAKE SHORE RD')).toBe(false);
  });
});
