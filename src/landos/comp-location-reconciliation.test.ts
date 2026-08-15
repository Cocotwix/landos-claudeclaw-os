import { describe, it, expect } from 'vitest';
import {
  reconcileCompAddress,
  reconcileRetainedCompLocation,
  buildRetainedLocationIndex,
  compAddressKey,
  validCompPoint,
} from './comp-location-reconciliation.js';

// The real capture shape behind the 9490 Elk Lake Rd defect: a Zillow listing
// card arrives as one text run with the address glued to marketing text.
const ZILLOW_CAPTURE = '200 sqftHouse for sale11892 Cabin Ln, Rapid City, MI 49676';
const ZILLOW_URL = 'https://www.zillow.com/homedetails/11892-Cabin-Ln-Rapid-City-MI-49676/106223486_zpid/';

describe('reconcileCompAddress', () => {
  it('recovers the postal address from captured listing chrome when the record’s own URL confirms it', () => {
    const result = reconcileCompAddress({ capturedAddress: ZILLOW_CAPTURE, sourceUrl: ZILLOW_URL })!;
    expect(result.postalAddress).toBe('11892 Cabin Ln, Rapid City, MI 49676');
    expect(result.basis).toBe('listing_chrome_corroborated');
    expect(result.capturedFrom).toBe(ZILLOW_CAPTURE);
    expect(result.corroboratedBy).toBe(ZILLOW_URL);
  });

  it('passes an already-clean captured address through untouched', () => {
    const result = reconcileCompAddress({ capturedAddress: '7657 Wadsworth Rd, Wolcott, NY 14590', sourceUrl: null })!;
    expect(result.postalAddress).toBe('7657 Wadsworth Rd, Wolcott, NY 14590');
    expect(result.basis).toBe('captured_address');
  });

  it('never truncates a real address that merely starts with a chrome-shaped word', () => {
    const lot = reconcileCompAddress({ capturedAddress: 'Lot 7 County Rd 5, Wolcott, NY 14590' })!;
    expect(lot.postalAddress).toBe('Lot 7 County Rd 5, Wolcott, NY 14590');
    expect(lot.basis).toBe('captured_address');
    const landing = reconcileCompAddress({ capturedAddress: 'Landing Way, Cato, NY 13033' })!;
    expect(landing.postalAddress).toBe('Landing Way, Cato, NY 13033');
  });

  it('refuses a chrome-stripped address that no captured source corroborates', () => {
    expect(reconcileCompAddress({ capturedAddress: ZILLOW_CAPTURE, sourceUrl: null })).toBeNull();
    // A URL for a DIFFERENT property is never corroboration (invariant 4).
    expect(reconcileCompAddress({
      capturedAddress: ZILLOW_CAPTURE,
      sourceUrl: 'https://www.zillow.com/homedetails/5312-Samels-Rd-Williamsburg-MI-49690/91699149_zpid/',
    })).toBeNull();
  });

  it('returns nothing for a record with no captured address', () => {
    expect(reconcileCompAddress({ capturedAddress: null, sourceUrl: ZILLOW_URL })).toBeNull();
    expect(reconcileCompAddress({ capturedAddress: '   ' })).toBeNull();
  });
});

describe('reconcileRetainedCompLocation', () => {
  const geocode = (map: Record<string, { lat: number; lng: number }>) => (address: string) => {
    const hit = map[compAddressKey(address)];
    return hit ? { lat: hit.lat, lng: hit.lng, source: 'US Census address geocode', resolvedAtIso: '2026-08-12T00:00:00.000Z' } : null;
  };

  it('places a record from the coordinates it already carries', () => {
    const result = reconcileRetainedCompLocation({
      capturedAddress: '7657 Wadsworth Rd, Wolcott, NY 14590',
      lat: 43.274933,
      lng: -76.80132,
      retainedCoordinateSource: 'Zillow map point',
    });
    expect(result.status).toBe('mapped');
    expect(result.basis).toBe('retained_coordinates');
    expect(result.evidence).toContain('Zillow map point');
    expect(result.unresolvedReason).toBeNull();
  });

  it('places a chrome-captured listing through the retained geocode of its reconciled address', () => {
    const result = reconcileRetainedCompLocation(
      { capturedAddress: ZILLOW_CAPTURE, sourceUrl: ZILLOW_URL, providerLabel: 'Zillow' },
      { byAddress: geocode({ '11892 cabin ln, rapid city, mi 49676': { lat: 44.8, lng: -85.3 } }) },
    );
    expect(result.status).toBe('mapped');
    expect(result.basis).toBe('reconciled_address_geocode');
    expect(result.lat).toBe(44.8);
    expect(result.postalAddress).toBe('11892 Cabin Ln, Rapid City, MI 49676');
    expect(result.evidence).toContain('11892 Cabin Ln');
    expect(result.evidence).toContain('US Census address geocode');
  });

  it('joins a comp identified only by APN to location evidence LandOS already retains', () => {
    const index = buildRetainedLocationIndex([
      { apn: '08-002-001-00', state: 'MI', lat: 44.9, lng: -85.4, source: 'LandPortal map point' },
    ]);
    const result = reconcileRetainedCompLocation(
      { apn: '08-002-001-00', state: 'MI', providerLabel: 'Hermes / LandPortal' },
      { byIdentity: index },
    );
    expect(result.status).toBe('mapped');
    expect(result.basis).toBe('retained_location_record');
    expect(result.evidence).toContain('APN 08-002-001-00');
    expect(result.evidence).toContain('LandPortal map point');
  });

  it('never carries another state’s parcel point onto a comp with the same APN digits', () => {
    const index = buildRetainedLocationIndex([
      { apn: '08-002-001-00', state: 'TX', lat: 30.2, lng: -97.7, source: 'Other roll map point' },
    ]);
    const result = reconcileRetainedCompLocation({ apn: '08-002-001-00', state: 'MI' }, { byIdentity: index });
    expect(result.status).toBe('unresolved');
    expect(result.lat).toBeNull();
  });

  // ── The negative cases. Insufficient evidence MUST stay unresolved. ────────

  it('leaves an APN-only comp unresolved and explains that a parcel number is not a location', () => {
    const result = reconcileRetainedCompLocation(
      { apn: '08-002-001-00', state: 'MI', providerLabel: 'Hermes / LandPortal' },
      { byIdentity: buildRetainedLocationIndex([]), byAddress: geocode({}) },
    );
    expect(result.status).toBe('unresolved');
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
    expect(result.unresolvedReason).toContain('08-002-001-00');
    expect(result.unresolvedReason).toMatch(/identity, not a location/i);
  });

  it('leaves an uncorroborated chrome capture unresolved rather than guessing a street out of it', () => {
    const result = reconcileRetainedCompLocation(
      { capturedAddress: ZILLOW_CAPTURE, sourceUrl: null },
      { byAddress: geocode({ '11892 cabin ln, rapid city, mi 49676': { lat: 44.8, lng: -85.3 } }) },
    );
    expect(result.status).toBe('unresolved');
    expect(result.lat).toBeNull();
    expect(result.postalAddress).toBeNull();
    expect(result.unresolvedReason).toContain('not a postal address');
  });

  it('leaves a reconciled address unresolved until a real location exists for it', () => {
    const result = reconcileRetainedCompLocation(
      { capturedAddress: ZILLOW_CAPTURE, sourceUrl: ZILLOW_URL },
      { byAddress: geocode({}) },
    );
    expect(result.status).toBe('unresolved');
    expect(result.lat).toBeNull();
    expect(result.postalAddress).toBe('11892 Cabin Ln, Rapid City, MI 49676');
    expect(result.unresolvedReason).toContain('11892 Cabin Ln');
  });

  it('says the location check already ran and missed, instead of asking for a re-run that cannot help', () => {
    const result = reconcileRetainedCompLocation(
      { capturedAddress: ZILLOW_CAPTURE, sourceUrl: ZILLOW_URL },
      { byAddress: geocode({}), addressAlreadyAttempted: () => true },
    );
    expect(result.status).toBe('unresolved');
    expect(result.unresolvedReason).toMatch(/already ran/i);
    expect(result.unresolvedReason).not.toMatch(/Run the location check/i);
  });

  it('leaves a record with no address, parcel number, or coordinate unresolved', () => {
    const result = reconcileRetainedCompLocation({}, {});
    expect(result.status).toBe('unresolved');
    expect(result.unresolvedReason).toMatch(/nothing legitimate to place it with/i);
  });

  it('refuses an out-of-range retained coordinate instead of plotting it', () => {
    expect(validCompPoint(0, 0)).toBe(false);
    expect(validCompPoint(91, -85)).toBe(false);
    const result = reconcileRetainedCompLocation({ apn: '08-002-001-00', lat: 0, lng: 0 });
    expect(result.status).toBe('unresolved');
  });
});

describe('buildRetainedLocationIndex', () => {
  it('joins by canonical key, APN, and both raw and reconciled address', () => {
    const index = buildRetainedLocationIndex([
      { key: 'apn:0800200100', apn: '08-002-001-00', state: 'MI', lat: 44.9, lng: -85.4, source: 'LandPortal map point' },
      { address: ZILLOW_CAPTURE, sourceUrl: ZILLOW_URL, lat: 44.8, lng: -85.3, source: 'Zillow map point' },
    ]);
    expect(index.size).toBe(2);
    expect(index.find({ key: 'apn:0800200100' })?.matchedBy).toBe('canonical_key');
    expect(index.find({ apn: '08 002 001 00', state: 'MI' })?.matchedBy).toBe('apn');
    expect(index.find({ address: ZILLOW_CAPTURE })?.matchedBy).toBe('address');
    expect(index.find({ address: '11892 Cabin Ln, Rapid City, MI 49676' })?.matchedBy).toBe('address');
    expect(index.find({ address: '1 Nowhere Rd, Elsewhere, MI 49690' })).toBeNull();
  });

  it('never indexes an invalid point', () => {
    const index = buildRetainedLocationIndex([
      { apn: '08-002-001-00', lat: null, lng: null, source: 'no point' },
      { apn: '03-104-001-00', lat: 0, lng: 0, source: 'null island' },
    ]);
    expect(index.size).toBe(0);
    expect(index.find({ apn: '08-002-001-00' })).toBeNull();
  });
});
