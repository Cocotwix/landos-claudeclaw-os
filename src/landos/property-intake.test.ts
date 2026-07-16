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
});
