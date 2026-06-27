import { describe, it, expect } from 'vitest';
import { validateLocality } from './locality-validation.js';
import { makeRealieParcelAdapter } from './data-registry.js';

describe('validateLocality (identity-confidence guard)', () => {
  it('flags a ZIP conflict as a hard mismatch (Augusta searched, Macon returned)', () => {
    const r = validateLocality(
      { city: 'Augusta', state: 'GA', zip: '30901' },
      { city: 'MACON-BIBB COUNTY', state: 'GA', zip: '31201' },
    );
    expect(r.ok).toBe(false);
    expect(r.confidence).toBe('none');
    expect(r.conflicts.some((c) => /zip/.test(c))).toBe(true);
  });

  it('flags a county conflict as a hard mismatch', () => {
    const r = validateLocality({ county: 'Sequatchie', state: 'TN' }, { county: 'Shelby', state: 'TN' });
    expect(r.ok).toBe(false);
  });

  it('passes a consistent locality at high confidence', () => {
    const r = validateLocality(
      { city: 'Byron', county: 'Peach', state: 'GA', zip: '31008' },
      { city: 'BYRON', county: 'Peach', state: 'GA', zip: '31008' },
    );
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('tolerates substring locality forms (Macon vs Macon-Bibb) when zip agrees', () => {
    const r = validateLocality({ county: 'Macon', state: 'GA', zip: '31201' }, { county: 'Macon-Bibb', state: 'GA', zip: '31201' });
    expect(r.ok).toBe(true);
  });

  it('sparse input (state only) does not hard-fail but is low confidence', () => {
    const r = validateLocality({ state: 'GA' }, { city: 'ANYWHERE', state: 'GA', zip: '30000' });
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe('low');
  });
});

describe('Realie adapter — root-cause fix (county derivation + locality downgrade)', () => {
  const key = { REALIE_API_KEY: 'x' };
  const okBody = (p: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ property: p }) });

  it('derives county when absent and sends city+county to Realie', async () => {
    let calledUrl = '';
    const adapter = makeRealieParcelAdapter({
      env: key,
      deriveCounty: async () => ({ county: 'Richmond', state: 'GA', zip: '30901', fips: '13245' }),
      fetchImpl: async (url) => { calledUrl = url; return okBody({ parcelId: 'A1', addressFull: '1915 1ST AVE', city: 'Augusta', county: 'Richmond', state: 'GA', zipCode: '30901', ownerName: 'X' }); },
      now: () => 't',
    });
    const n = await adapter.lookup({ address: '1915 1st Avenue', city: 'Augusta', state: 'GA', zip: '30901' }, { timeoutMs: 1000 });
    expect(decodeURIComponent(calledUrl)).toContain('county=Richmond');
    expect(decodeURIComponent(calledUrl)).toContain('city=Augusta');
    expect(n.verified).toBe(true);
    expect(n.confidence).toBe('high');
  });

  it('downgrades to locality_mismatch when Realie returns a different locality', async () => {
    const adapter = makeRealieParcelAdapter({
      env: key,
      deriveCounty: async () => null, // derivation unavailable -> statewide match risk
      fetchImpl: async () => okBody({ parcelId: 'B2', addressFull: '1915 1ST AVE, MACON-BIBB COUNTY, GA 31201', city: 'MACON-BIBB COUNTY', county: 'Macon-Bibb', state: 'GA', zipCode: '31201', ownerName: 'MACON-BIBB COUNTY' }),
      now: () => 't',
    });
    const n = await adapter.lookup({ address: '1915 1st Avenue', city: 'Augusta', state: 'GA', zip: '30901' }, { timeoutMs: 1000 });
    expect(n.verified).toBe(false);
    expect(n.status).toBe('locality_mismatch');
    expect(n.note).toMatch(/different locality/i);
  });

  it('keeps a correct match Verified', async () => {
    const adapter = makeRealieParcelAdapter({
      env: key,
      deriveCounty: async () => ({ county: 'Peach', state: 'GA', zip: '31008', fips: '13225' }),
      fetchImpl: async () => okBody({ parcelId: 'C3', addressFull: '324 CAVALRY CT', city: 'BYRON', county: 'Peach', state: 'GA', zipCode: '31008', ownerName: 'NNH INVESTMENT LLC' }),
      now: () => 't',
    });
    const n = await adapter.lookup({ address: '324 Cavalry Ct', city: 'Byron', state: 'GA', zip: '31008' }, { timeoutMs: 1000 });
    expect(n.verified).toBe(true);
    expect(n.owner).toBe('NNH INVESTMENT LLC');
  });
});
