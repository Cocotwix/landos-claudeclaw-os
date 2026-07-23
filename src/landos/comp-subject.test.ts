import { describe, expect, it } from 'vitest';
import { buildCanonicalCompSubject, COMP_RADIUS_LADDER_MILES, COMP_SOLD_WINDOW_MONTHS, daysOnMarket, soldWindowForDate, verifySearchGeography } from './comp-subject.js';

describe('canonical comp subject', () => {
  const talley = buildCanonicalCompSubject({ active_input_address: 'TALLEY RD, Newport, TN 37843', city: 'Newport', county: 'Cocke', state: 'TN', zip: '37843', apn: '015 027 04512 000 2026', acres: 5.82, lat: 36.0298676, lng: -83.1112125 }, { address: '1023 Baysinger Rd' });
  it('prefers reconciled real property identity and accepts road-only vacant land', () => {
    expect(talley).toMatchObject({ address: 'TALLEY RD, Newport, TN 37843', city: 'Newport', county: 'Cocke', state: 'TN', zip: '37843', acres: 5.82, valid: true });
  });
  it('rejects Chattanooga and accepts a nearby cross-county/ZIP center', () => {
    expect(verifySearchGeography(talley, { city: 'Chattanooga', state: 'TN', zip: '37411', lat: 35.0456, lng: -85.3097 }).valid).toBe(false);
    expect(verifySearchGeography(talley, { city: 'White Pine', county: 'Jefferson', state: 'TN', zip: '37890', lat: 36.05, lng: -83.18 }).valid).toBe(true);
  });
  it('uses the staged radius ladder and one-year then two-year windows', () => {
    expect(COMP_RADIUS_LADDER_MILES).toEqual([5, 10, 15, 20]);
    expect(COMP_SOLD_WINDOW_MONTHS).toEqual([12, 24]);
    expect(soldWindowForDate('2026-07-22T12:00:00Z', 12)).toEqual({ from: '2025-07-22', to: '2026-07-22' });
  });
  it('computes days on market only from two valid ordered dates', () => {
    expect(daysOnMarket('2026-01-01', '2026-02-01')).toBe(31);
    expect(daysOnMarket(null, '2026-02-01')).toBeNull();
  });
});
