import { describe, expect, it } from 'vitest';
import { parsePropertyIntake } from './property-intake.js';

describe('public-first property intake', () => {
  it('preserves and structures the live acceptance address without swallowing the street suffix', () => {
    const raw = '171 Davidson Road venore, Tennessee 37885';
    const intake = parsePropertyIntake(raw);

    expect(intake.rawInput).toBe(raw);
    expect(intake.address).toBe('171 Davidson Road');
    expect(intake.city).toBe('venore');
    expect(intake.city).not.toMatch(/Road/i);
    expect(intake.state).toBe('TN');
    expect(intake.zip).toBe('37885');
    expect(intake.warnings.join(' ')).toMatch(/preserved.*source confirmation/i);
    expect(intake.candidates.find((item) => item.kind === 'city')?.certainty).toBe('uncertain');
  });

  it('supports duplicate spacing, conversational labels, and voice-style punctuation', () => {
    const raw = '  The address is 171   Davidson Rd,  venore Tennessee 37885. Please check it.  ';
    const intake = parsePropertyIntake(raw);

    expect(intake.rawInput).toBe(raw);
    expect(intake.address).toBe('171 Davidson Rd');
    expect(intake.city).toBe('venore');
    expect(intake.state).toBe('TN');
    expect(intake.zip).toBe('37885');
  });

  it('recognizes ZIP/state even when no city can be safely parsed', () => {
    const intake = parsePropertyIntake('APN: 094-020.08; Scott County; Tennessee; ZIP 37885');
    expect(intake.apn).toBe('094-020.08');
    expect(intake.county).toBe('Scott');
    expect(intake.state).toBe('TN');
    expect(intake.zip).toBe('37885');
  });

  it('does not misread an APN segment as a ZIP', () => {
    const intake = parsePropertyIntake('APN 002-07637-000, Monroe County, TN');
    expect(intake.zip).toBeUndefined();
    expect(intake.apn).toBe('002-07637-000');
  });

  it('parses labeled fields with parcel ID before parcel address without corrupting the address', () => {
    const raw = `Owner Name
JOINES TRAVIS

Parcel ID
027 04512

Parcel Address
1023 Baysinger Rd, Newport Tennessee

Cocke County

Acres
5.820`;
    const intake = parsePropertyIntake(raw);

    expect(intake.rawInput).toBe(raw);
    expect(intake.address).toBe('1023 Baysinger Rd');
    expect(intake.city).toBe('Newport');
    expect(intake.state).toBe('TN');
    expect(intake.county).toBe('Cocke');
    expect(intake.apn).toBe('027 04512');
    expect(intake.owner).toBe('JOINES TRAVIS');
    expect(intake.zip).toBeUndefined();
    expect(intake.warnings.join(' ')).not.toMatch(/corrupted/i);
  });

  it('does not swallow field labels and the parcel ID into a street address', () => {
    const intake = parsePropertyIntake('Parcel ID 027 04512 Parcel Address 1023 Baysinger Rd, Newport Tennessee');
    expect(intake.address).toBe('1023 Baysinger Rd');
    expect(intake.apn).toBe('027 04512');
    expect(intake.city).toBe('Newport');
    expect(intake.state).toBe('TN');
  });

  it('does not promote a two-segment APN segment to a ZIP code', () => {
    const intake = parsePropertyIntake('027 04512, Cocke County, TN');
    expect(intake.zip).toBeUndefined();
    expect(intake.apn).toBe('027 04512');
  });

  it('accepts legitimate long rural and directional addresses without rejecting them', () => {
    const cases = [
      '12000 SW Old Farm Rd SW, Rural Route 3, Knoxville TN 37932',
      '8752 North Fork Road NE, Comstock WI 54826',
      '2907 County Road 3050, Bloomfield NM 87413',
    ];
    for (const raw of cases) {
      const intake = parsePropertyIntake(raw);
      expect(intake.address, `Expected address for: ${raw}`).toBeDefined();
      expect(intake.address!.length).toBeGreaterThan(0);
    }
  });
});
