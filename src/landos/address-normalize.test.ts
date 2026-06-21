import { describe, it, expect } from 'vitest';
import { normalizeAddress, normalizeZip, correctionCandidates } from './address-normalize.js';

describe('normalizeAddress', () => {
  it('canonicalizes case, punctuation, suffix, and directional', () => {
    expect(normalizeAddress('472 west rd.')).toBe('472 WEST RD');
    expect(normalizeAddress('123 North Main Street')).toBe('123 N MAIN ST');
    expect(normalizeAddress('  10   south  oak  avenue ')).toBe('10 S OAK AVE');
  });
});

describe('normalizeZip', () => {
  it('extracts a clean 5-digit ZIP', () => {
    expect(normalizeZip('31781')).toBe('31781');
    expect(normalizeZip('GA 31781-1234')).toBe('31781');
    expect(normalizeZip('no zip')).toBe('');
  });
});

describe('correctionCandidates', () => {
  it('always returns the normalized form first and preserves the original', () => {
    const cands = correctionCandidates('QWISE St', { cap: 5 });
    expect(cands[0].corrected).toBe('QWISE ST');
    expect(cands.every((c) => c.original === 'QWISE St')).toBe(true);
  });

  it('keyboard-adjacent street typo produces a corrected lookup candidate (QWISE -> WISE)', () => {
    const cands = correctionCandidates('QWISE St', { cap: 6 });
    const hit = cands.find((c) => c.corrected === 'WISE ST');
    expect(hit).toBeTruthy();
    expect(hit!.reason).toMatch(/stray/i);
  });

  it('keyboard substitution street typo produces a corrected candidate (MAIM -> MAIN)', () => {
    // Generous cap: assert the candidate is GENERATED (the small cap is a separate
    // fan-out limit tested below).
    const cands = correctionCandidates('MAIM St', { cap: 100 });
    expect(cands.some((c) => c.corrected === 'MAIN ST')).toBe(true);
  });

  it('minor city typo produces a corrected candidate (Cottagevile -> Cottageville)', () => {
    const cands = correctionCandidates('Cottagevile', { cap: 100 });
    expect(cands.some((c) => c.corrected === 'COTTAGEVILLE')).toBe(true);
  });

  it('caps the number of candidates (counts against the call ceiling)', () => {
    expect(correctionCandidates('QWISE ST', { cap: 2 }).length).toBeLessThanOrEqual(2);
    expect(correctionCandidates('QWISE ST', { cap: 1 }).length).toBe(1);
  });

  it('correction never marks itself validated (only a named-source match can)', () => {
    const cands = correctionCandidates('QWISE St', { cap: 5 });
    expect(cands.every((c) => c.validatedBySource === undefined)).toBe(true);
  });
});
