import { describe, expect, it } from 'vitest';
import { validateRecordedLienReview } from './recorded-lien-review.js';

const official = {
  sourceLabel: 'Georgia official lien index',
  sourceUrl: 'https://search.gsccca.org/lien/namesearch.asp',
  searchedNameOrReference: 'ALEXIA INC',
  confirmedOfficialSource: true,
} as const;

describe('recorded lien review', () => {
  it('makes an empty index result explicitly non-clear-title evidence', () => {
    const result = validateRecordedLienReview({ ...official, status: 'no_matching_index_entry' });
    expect(result.note).toMatch(/no matching liens found in the official index search/i);
    expect(result.note).toMatch(/not a clear-title|no-lien conclusion/i);
  });

  it('requires a recorder reference and parcel match before calling a lien parcel confirmed', () => {
    expect(() => validateRecordedLienReview({ ...official, status: 'parcel_confirmed', recordingReference: 'Lien Book 42 Page 7' })).toThrow(/parcel\/legal-description match/i);
    const result = validateRecordedLienReview({ ...official, status: 'parcel_confirmed', recordingReference: 'Lien Book 42 Page 7', propertyMatch: 'Legal description names Lot 86 Kenwood Business 5B' });
    expect(result.note).toMatch(/Potential recorded lien/i);
  });

  it('fails closed without an official-source attestation', () => {
    expect(() => validateRecordedLienReview({ ...official, status: 'index_hit', recordingReference: 'Lien 1', confirmedOfficialSource: false })).toThrow(/Confirm/i);
  });
});
