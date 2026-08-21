import { describe, expect, it } from 'vitest';

import {
  deriveOperatorDisplayLocation,
  formatRoadName,
  isParcelDescription,
  parseStreetLine,
  roadNamesEquivalent,
} from './operator-display-location.js';

const LOCALITY = { city: 'Fairview', state: 'TN', zip: '37062' };

describe('location concepts (pure)', () => {
  it('recognizes parcel/map notation as identity description, never a street line', () => {
    expect(isParcelDescription('Map 042 Parcel 123')).toBe(true);
    expect(isParcelDescription('042-123.00-000')).toBe(true);
    expect(isParcelDescription('APN 031-045.00-000')).toBe(true);
    expect(isParcelDescription('123 Kingwood Blvd')).toBe(false);
    expect(isParcelDescription('KINGWOOD BLVD')).toBe(false);
  });

  it('splits a street line into its number and road; parcel notation yields neither', () => {
    expect(parseStreetLine('123 Kingwood Blvd, Fairview, TN')).toEqual({ number: '123', road: 'Kingwood Blvd' });
    expect(parseStreetLine('KINGWOOD BLVD')).toEqual({ number: null, road: 'KINGWOOD BLVD' });
    expect(parseStreetLine('Map 042 Parcel 123')).toEqual({ number: null, road: null });
  });

  it('formats a road the LandOS-standard way and compares roads by equivalence', () => {
    expect(formatRoadName('KINGWOOD BLVD')).toBe('Kingwood Blvd');
    expect(formatRoadName('KINGWOOD BOULEVARD')).toBe('Kingwood Blvd');
    expect(roadNamesEquivalent('KINGWOOD BLVD', 'Kingwood Boulevard')).toBe(true);
    expect(roadNamesEquivalent('KINGWOOD BLVD', 'Kingswood Blvd')).toBe(false);
  });
});

describe('operator display hierarchy', () => {
  it('Tier 1: a real numbered official situs outranks everything and uses the real number', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: '123 KINGWOOD BLVD',
      ...LOCALITY,
    });
    expect(display.displayAddress).toBe('123 Kingwood Blvd, Fairview, TN 37062');
    expect(display.displayType).toBe('numbered_situs');
    expect(display.officialSitusNumber).toBe('123');
    expect(display.landosGeneratedZero).toBe(false);
  });

  it('Tier 2: road established with no numbered situs displays the LandOS 0 convention', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: 'KINGWOOD BLVD',
      ...LOCALITY,
    });
    expect(display.displayAddress).toBe('0 Kingwood Blvd, Fairview, TN 37062');
    expect(display.displayType).toBe('landos_road_only');
    expect(display.roadName).toBe('Kingwood Blvd');
    // The leading 0 is LandOS-generated display convention ONLY: it is never
    // an official situs number and carries no evidentiary value.
    expect(display.officialSitusNumber).toBeNull();
    expect(display.landosGeneratedZero).toBe(true);
  });

  it('the only synthetic street number ever produced is the leading 0', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: 'KINGWOOD BLVD',
      ...LOCALITY,
    });
    const number = /^(\S+)\s/.exec(display.displayAddress)?.[1];
    expect(number).toBe('0');
    expect(display.officialSitusNumber).toBeNull();
  });

  it('Tier 3: with neither a numbered situs nor a road, the parcel description remains the display', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: null,
      ...LOCALITY,
    });
    expect(display.displayAddress).toBe('Map 042 Parcel 123, Fairview, TN 37062');
    expect(display.displayType).toBe('parcel_description');
    expect(display.roadName).toBeNull();
    expect(display.landosGeneratedZero).toBe(false);
  });

  it('an uncertain road is never promoted: parcel notation cannot become a road-only display', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: 'MAP 042 PARCEL 123',
      ...LOCALITY,
    });
    expect(display.displayType).toBe('parcel_description');
    expect(display.displayAddress.startsWith('0 ')).toBe(false);
  });

  it('a numbered source street address remains a credible display when no official situs exists', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: '9490 Elk Lake Rd',
      officialSitus: null,
      city: 'Williamsburg',
      state: 'MI',
      zip: '49690',
    });
    expect(display.displayAddress).toBe('9490 Elk Lake Rd, Williamsburg, MI 49690');
    expect(display.displayType).toBe('numbered_situs');
  });

  it('independently established road evidence supports the 0 convention when the situs is absent', () => {
    const display = deriveOperatorDisplayLocation({
      sourceDescription: 'Map 042 Parcel 123',
      officialSitus: null,
      establishedRoad: 'KINGWOOD BOULEVARD',
      ...LOCALITY,
    });
    expect(display.displayAddress).toBe('0 Kingwood Blvd, Fairview, TN 37062');
    expect(display.displayType).toBe('landos_road_only');
  });

  it('is deterministic: the same retained inputs always reconstruct the same display', () => {
    const input = { sourceDescription: 'Map 042 Parcel 123', officialSitus: 'KINGWOOD BLVD', ...LOCALITY };
    expect(deriveOperatorDisplayLocation(input)).toEqual(deriveOperatorDisplayLocation(input));
  });

  it('derives strictly from the inputs handed to it, so one deal\'s road evidence cannot leak into another', () => {
    const dealA = deriveOperatorDisplayLocation({ sourceDescription: 'Map 042 Parcel 123', officialSitus: 'KINGWOOD BLVD', ...LOCALITY });
    const dealB = deriveOperatorDisplayLocation({ sourceDescription: 'Map 050 Parcel 7', officialSitus: null, city: 'Dickson', state: 'TN', zip: '37055' });
    expect(dealA.displayType).toBe('landos_road_only');
    expect(dealB.displayType).toBe('parcel_description');
    expect(dealB.displayAddress).toBe('Map 050 Parcel 7, Dickson, TN 37055');
    expect(dealB.roadName).toBeNull();
  });
});
