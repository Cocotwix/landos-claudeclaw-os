import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { upsertCardFromDukeRun } from './property-card.js';
import { addSellerStatedFact, loadSellerStatedFacts, summarizeSellerFacts, SELLER_FACT_KINDS } from './seller-stated-facts.js';

beforeEach(() => { _initTestLandosDb(); });

function newCard(): number {
  return upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' }).card.id;
}

describe('seller-stated facts (post-discovery, never Verified)', () => {
  it('covers the documented seller-fact kinds', () => {
    for (const k of ['access', 'liens', 'taxes_owed', 'price_expectation', 'timeline', 'structures_mobile_homes']) {
      expect(SELLER_FACT_KINDS).toContain(k);
    }
  });

  it('records and loads seller-stated facts (newest first)', () => {
    const id = newCard();
    addSellerStatedFact(id, { kind: 'access', value: 'dirt road off Hwy 1', recordedBy: 'tyler' });
    addSellerStatedFact(id, { kind: 'price_expectation', value: '$45k', recordedBy: 'tyler' });
    const facts = loadSellerStatedFacts(id);
    expect(facts).toHaveLength(2);
    expect(facts[0].kind).toBe('price_expectation'); // newest first
    expect(facts[0].value).toBe('$45k');
  });

  it('summary raises risk flags for risk-bearing seller statements and marks discovery captured', () => {
    const id = newCard();
    addSellerStatedFact(id, { kind: 'liens', value: 'maybe a tax lien' });
    addSellerStatedFact(id, { kind: 'timeline', value: 'ASAP' });
    const s = summarizeSellerFacts(loadSellerStatedFacts(id));
    expect(s.discoveryCaptured).toBe(true);
    expect(s.count).toBe(2);
    expect(s.riskFlags.some((f) => /lien/i.test(f) && /Seller-stated/i.test(f))).toBe(true);
  });

  it('empty deal -> no facts, discovery not captured', () => {
    const id = newCard();
    const s = summarizeSellerFacts(loadSellerStatedFacts(id));
    expect(s.discoveryCaptured).toBe(false);
    expect(s.count).toBe(0);
  });
});
