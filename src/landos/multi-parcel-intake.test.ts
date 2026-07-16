import { describe, it, expect } from 'vitest';
import { extractApnCandidates } from './intake-normalize.js';
import { buildSmartIntake } from './smart-intake.js';

// The exact live-test input that silently discarded the second parcel.
const DEQUEEN = '002-07637-000 and 002-07579-000, Dequeen Arkansas';

describe('multi-parcel intake — the De Queen regression', () => {
  it('extractApnCandidates preserves BOTH distinct parcels (never folds the 2nd into the 1st)', () => {
    const c = extractApnCandidates(DEQUEEN);
    expect(c.parcels).toEqual(['002-07637-000', '002-07579-000']);
    expect(c.primary).toBe('002-07637-000');
    // The 2nd parcel is a DISTINCT parcel, not a format variant of the 1st.
    expect(c.parcels.length).toBe(2);
  });

  it('smart intake classifies as APN (not address), keeps both parcels, and invents no ZIP', () => {
    const r = buildSmartIntake(DEQUEEN);
    expect(r.identityClass).toBe('apn_county');
    expect(r.hasParcelIdentity).toBe(true);
    expect(r.fields.parcels).toEqual(['002-07637-000', '002-07579-000']);
    expect(r.fields.city).toBe('Dequeen');
    expect(r.fields.state).toBe('AR');
    expect(r.fields.zip).toBeUndefined(); // NEVER fabricate a ZIP from an APN
  });

  it('a single-parcel lead has no multi-parcel list', () => {
    const c = extractApnCandidates('APN 002-07637-000, Dequeen AR');
    expect(c.parcels).toEqual(['002-07637-000']);
    const r = buildSmartIntake('APN 002-07637-000, Dequeen AR');
    expect(r.fields.parcels).toBeUndefined(); // only set when > 1 distinct parcel
  });

  it('format variants of ONE apn are NOT counted as separate parcels', () => {
    // "002-07637-000" and "002 07637 000" are the SAME parcel in two formats.
    const c = extractApnCandidates('002-07637-000 (002 07637 000), Dequeen AR');
    expect(c.parcels).toEqual(['002-07637-000']);
    expect(c.parcels.length).toBe(1);
  });
});
