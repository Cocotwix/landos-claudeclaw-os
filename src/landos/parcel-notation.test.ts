// Raw jurisdiction-specific parcel notation is IDENTITY EVIDENCE.
//
// A real seller lead supplied "Map 042 Parcel 123, Fairview, Tennessee" and
// LandOS read no parcel identifier out of it at all: the APN normalizer needs a
// separator-joined numeric token, and the county's own words between the groups
// defeat it. The lead named its parcel precisely and reached research as an
// unidentified property.

import { describe, expect, it } from 'vitest';

import {
  extractParcelNotations,
  parcelNotationMatchesIdentifier,
  parcelNotationSearchPhrases,
  primaryParcelNotation,
} from './parcel-notation.js';
import { extractApnCandidates } from './intake-normalize.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';

describe('parcel notation extraction', () => {
  it('reads "Map 042 Parcel 123" that the APN normalizer cannot see', () => {
    // The gap this module closes, stated as a test.
    expect(extractApnCandidates('Map 042 Parcel 123').primary).toBeUndefined();

    const notation = primaryParcelNotation('Map 042 Parcel 123');
    expect(notation).not.toBeNull();
    expect(notation!.raw).toBe('Map 042 Parcel 123');
    expect(notation!.scheme).toBe('map_parcel');
    expect(notation!.groups).toEqual(['042', '123']);
    expect(notation!.identityBearing).toBe(true);
  });

  it('preserves the operator\'s exact text and never normalizes it', () => {
    for (const raw of ['Map 042 Parcel 123', 'Map 42 Parcel 123', 'Tax Map 042 Parcel 123']) {
      const notation = primaryParcelNotation(raw)!;
      expect(notation.raw).toBe(raw);
      // The values are carried exactly as typed — 042 never becomes 42.
      expect(raw).toContain(notation.parts[0].value);
    }
  });

  it('reads the jurisdiction formats a lead actually arrives in', () => {
    const cases: Array<[string, string, string[]]> = [
      ['Map 042 Parcel 123', 'map_parcel', ['042', '123']],
      ['Map 42 Parcel 123', 'map_parcel', ['42', '123']],
      ['Tax Map 042 Parcel 123', 'map_parcel', ['042', '123']],
      ['Tax Map 42 Lot 123', 'map_lot', ['42', '123']],
      ['Map/Lot 042/123', 'map_lot', ['042', '123']],
      ['Map 073 Group G Parcel 036', 'map_group_parcel', ['073', 'G', '036']],
      ['Lot 14 Block C', 'lot_block', ['14', 'C']],
      ['PIN 1234-56-7890', 'pin', ['1234', '56', '7890']],
      ['PID 004-11-22', 'pid', ['004', '11', '22']],
      ['APN 094-020.08', 'apn', ['094', '020', '08']],
      ['Parcel Number 015 027 04512', 'parcel_number', ['015', '027', '04512']],
      ['Account Number 8812-4471', 'account_number', ['8812', '4471']],
    ];
    for (const [raw, scheme, groups] of cases) {
      const notation = primaryParcelNotation(raw);
      expect(notation, raw).not.toBeNull();
      expect([raw, notation!.scheme]).toEqual([raw, scheme]);
      expect([raw, notation!.groups]).toEqual([raw, groups]);
    }
  });

  it('prefers the fuller control-map reading over the subset inside it', () => {
    const notations = extractParcelNotations('Map 073 Group G Parcel 036');
    expect(notations).toHaveLength(1);
    expect(notations[0].scheme).toBe('map_group_parcel');
  });

  it('does not invent a notation out of prose or a street address', () => {
    for (const raw of ['4713 Sinking Creek Rd, London Kentucky', 'about 75 acres on the map somewhere', 'call the seller back']) {
      expect(extractParcelNotations(raw), raw).toEqual([]);
    }
  });
});

describe('notation → candidate identifier matching', () => {
  it('matches the county\'s own fuller parcel representation', () => {
    const notation = primaryParcelNotation('Map 042 Parcel 123')!;
    expect(parcelNotationMatchesIdentifier(notation, '042-123.00-000')).toBe(true);
    expect(parcelNotationMatchesIdentifier(notation, '042 123.00 000')).toBe(true);
    // Leading zeros are formatting, never identity.
    expect(parcelNotationMatchesIdentifier(primaryParcelNotation('Map 42 Parcel 123')!, '042-123.00-000')).toBe(true);
    // A county/district prefix the lead omitted is allowed at the head.
    expect(parcelNotationMatchesIdentifier(notation, '187-042-123.00')).toBe(true);
  });

  it('refuses a neighbouring or unrelated parcel', () => {
    const notation = primaryParcelNotation('Map 042 Parcel 123')!;
    expect(parcelNotationMatchesIdentifier(notation, '042-124.00-000')).toBe(false);
    expect(parcelNotationMatchesIdentifier(notation, '042-1234-000')).toBe(false);
    expect(parcelNotationMatchesIdentifier(notation, '123-042.00-000')).toBe(false);
    expect(parcelNotationMatchesIdentifier(notation, '1042-9123')).toBe(false);
    expect(parcelNotationMatchesIdentifier(notation, '')).toBe(false);
  });
});

describe('notation search phrases', () => {
  it('builds the phrases an operator would actually type', () => {
    const phrases = parcelNotationSearchPhrases(primaryParcelNotation('Map 042 Parcel 123')!);
    expect(phrases[0]).toBe('"Map 042" "Parcel 123"');
    expect(phrases).toContain('"Map 42" "Parcel 123"');
    expect(phrases).toContain('"042-123"');
  });
});

describe('Smart Intake keeps the notation', () => {
  it('carries "Map 042 Parcel 123" through conversational intake without inventing an APN', () => {
    const parsed = parseConversationalLeadIntake('Map 042 Parcel 123\nFairview, Tennessee');
    expect(parsed.parcelNotations).toHaveLength(1);
    expect(parsed.parcelNotations[0].raw).toBe('Map 042 Parcel 123');
    // The notation is NOT promoted into the APN field: which identifier scheme
    // the county uses is established from evidence, never guessed at intake.
    expect(parsed.apn).toBeNull();
    // And the lead is stored by what the operator supplied, not a placeholder.
    expect(parsed.propertyLabel).toBe('Map 042 Parcel 123');
    expect(parsed.rawInput).toBe('Map 042 Parcel 123\nFairview, Tennessee');
  });
});
