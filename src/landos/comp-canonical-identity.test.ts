// Canonical identity of a retained comparable.
//
// The defect this pins: identity was keyed on the ADDRESS, which is how a
// provider labels a record rather than what the record is. One Redfin listing
// reached from a search card and from its own detail page reads "9 SW 39th Dr"
// and "Lot 9 SW 39th Dr", so a single sale was stored twice. In the other
// direction, adjacent vacant lots genuinely share the placeholder "TBD SW 52nd
// Ter", so an address key would have merged two separate arms-length
// transactions into one and lost a real sale from the market.

import { describe, expect, it } from 'vitest';

import { normalizedCompKey, providerRecordKey } from './comps.js';

const key = (over: Record<string, unknown>) => normalizedCompKey({
  addressDesc: '9 SW 39th Dr, Lake Butler, FL 32054',
  sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/Lot-9-SW-39th-Dr-32054/home/200608766',
  sourceLabel: 'Redfin', apn: null, lat: null, lng: null,
  price: 124_900, saleOrListDate: '2026-07-02', ...over,
} as never);

describe('one provider record is one comparable, whatever it calls its address', () => {
  it('gives the same identity to one record under two address spellings', () => {
    expect(key({})).toBe('redfin:200608766');
    expect(key({ addressDesc: 'Lot 9 SW 39th Dr, Lake Butler, FL 32054' })).toBe('redfin:200608766');
  });

  it('keeps adjacent lots sharing a TBD address as separate transactions', () => {
    const lotA = key({
      addressDesc: 'TBD SW 52nd Ter, Lake Butler, FL 32054',
      sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/TBD-SW-52nd-Ter-32054/home/201372496',
    });
    const lotB = key({
      addressDesc: 'TBD SW 52nd Ter, Lake Butler, FL 32054',
      sourceUrl: 'https://www.redfin.com/FL/Lake-Butler/TBD-SW-52nd-Ter-32054/home/199111222',
    });
    expect(lotA).not.toBe(lotB);
    expect(lotA).toBe('redfin:201372496');
    expect(lotB).toBe('redfin:199111222');
  });

  it('reads the record id from each supported provider URL shape', () => {
    expect(providerRecordKey({ sourceUrl: 'https://www.redfin.com/FL/X/Y-32054/home/194963699' } as never)).toBe('redfin:194963699');
    expect(providerRecordKey({ sourceUrl: 'https://www.zillow.com/homedetails/X/250762998_zpid/' } as never)).toBe('zillow:250762998');
    expect(providerRecordKey({ sourceUrl: 'https://www.landwatch.com/florida/pid/123456' } as never)).toBe('landwatch:123456');
    expect(providerRecordKey({ sourceUrl: 'https://example.com/listing' } as never)).toBeNull();
    expect(providerRecordKey({ sourceUrl: null } as never)).toBeNull();
  });

  it('falls back to parcel id, then address, then a bare event', () => {
    expect(key({ sourceUrl: 'https://example.com/x', apn: '00083-A-03400' })).toBe('apn:0008303400');
    expect(key({ sourceUrl: 'https://example.com/x', apn: null })).toBe('addr:9 sw 39th dr lake butler fl 32054');
    expect(key({ sourceUrl: null, apn: null, addressDesc: '', lat: 30.0653, lng: -82.5086 }))
      .toBe('coord:30.0653,-82.5086');
    expect(key({ sourceUrl: null, apn: null, addressDesc: '', lat: null, lng: null }))
      .toBe('event:124900:2026-07-02');
  });
});
