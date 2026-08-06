// Transaction price: what LandOS may call a sale price.
//
// The rule under test is absolute — a verified closed price always wins — and
// the one exception is gated twice: the state's non-disclosure status must be
// VERIFIED in the regulatory registry, and the source must genuinely lack a
// closed price. A proxy is always labeled an estimate and always carries reduced
// confidence. LandOS never assumes a state is non-disclosure.

import { describe, expect, it } from 'vitest';

import {
  resolveCompTransactionPrice, verifyStateDisclosure, STATE_PRICE_DISCLOSURE_RULES,
  TRANSACTION_CONFIDENCE_LABEL,
} from './comp-transaction-price.js';

describe('state disclosure verification', () => {
  it('verifies a non-disclosure state against a cited authority', () => {
    const v = verifyStateDisclosure('TX');
    expect(v.status).toBe('nondisclosure');
    expect(v.authority).toBeTruthy();
    expect(v.note).toContain('verified non-disclosure state');
  });

  it('verifies New York — the acceptance property state — as a DISCLOSURE state', () => {
    const v = verifyStateDisclosure('NY');
    expect(v.status).toBe('disclosure');
    expect(v.authority).toMatch(/RP-5217/);
  });

  it('refuses to assume anything about an unlisted state', () => {
    const v = verifyStateDisclosure('ZZ');
    expect(v.status).toBe('unverified');
    expect(v.authority).toBeNull();
    expect(v.note).toContain('will not assume');
  });

  it('treats a missing state as unverified rather than defaulting', () => {
    expect(verifyStateDisclosure(null).status).toBe('unverified');
    expect(verifyStateDisclosure('').status).toBe('unverified');
  });

  it('cites an authority for every entry in the registry', () => {
    for (const rule of STATE_PRICE_DISCLOSURE_RULES) {
      expect(rule.authority.length).toBeGreaterThan(20);
      expect(rule.state).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('verified sold price always wins', () => {
  it('uses the closed price and never substitutes the final asking price', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: 49900,
      soldDateIso: '2025-11-18',
      lastAskingPriceAtPending: 59900,
      pendingDateIso: '2025-10-01',
      state: 'NY',
      acres: 9.85,
    });
    expect(r.basis).toBe('verified_sale');
    expect(r.price).toBe(49900);
    expect(r.pricePerAcre).toBe(5065.99);
    expect(r.priceLabel).toBe('Verified sold price');
    expect(r.confidence).toBe('verified');
    expect(r.usableForValuation).toBe(true);
    expect(r.lines.join(' ')).toContain('not substituted');
  });

  it('wins even in a verified non-disclosure state', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: 42300, soldDateIso: '2025-10-14',
      lastAskingPriceAtPending: 55000, state: 'TX', acres: 9,
    });
    expect(r.basis).toBe('verified_sale');
    expect(r.price).toBe(42300);
  });
});

describe('non-disclosure pending-price proxy', () => {
  it('is applied only in a verified non-disclosure state with no closed price', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null,
      lastAskingPriceAtPending: 58000, pendingDateIso: '2026-02-14',
      state: 'TX', acres: 10, sourceProvidesClosedPrice: false,
    });
    expect(r.basis).toBe('pending_proxy');
    expect(r.price).toBe(58000);
    expect(r.pricePerAcre).toBe(5800);
    expect(r.priceLabel).toBe('Estimated sale price proxy');
    expect(r.ppaLabel).toBe('Estimated price per acre based on pending price proxy');
    expect(r.confidence).toBe('estimated_proxy');
    expect(r.usableForValuation).toBe(true);
  });

  it('is never labeled a sold, verified, closed or confirmed price', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: 58000,
      pendingDateIso: '2026-02-14', state: 'WY', acres: 10,
    });
    const words = [r.priceLabel, r.ppaLabel, TRANSACTION_CONFIDENCE_LABEL[r.confidence]].join(' ').toLowerCase();
    expect(words).not.toMatch(/\bsold price\b/);
    expect(words).not.toMatch(/verified sale/);
    expect(words).not.toMatch(/closed price/);
    expect(words).not.toMatch(/confirmed price per acre/);
    expect(words).toContain('estimated');
  });

  it('carries lower confidence than a verified closed sale', () => {
    const proxy = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: 58000,
      pendingDateIso: '2026-02-14', state: 'MT', acres: 10,
    });
    const verified = resolveCompTransactionPrice({
      verifiedSoldPrice: 58000, soldDateIso: '2026-03-01', state: 'MT', acres: 10,
    });
    expect(proxy.confidence).toBe('estimated_proxy');
    expect(verified.confidence).toBe('verified');
    expect(proxy.lines.join(' ')).toContain('reduced');
  });

  it('is refused in a verified disclosure state such as New York', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: 58000,
      pendingDateIso: '2026-02-14', state: 'NY', acres: 10,
    });
    expect(r.basis).toBe('none');
    expect(r.usableForValuation).toBe(false);
    expect(r.lines.join(' ')).toContain('verified disclosure state');
  });

  it('is refused when the state disclosure rule is not verified', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: 58000,
      pendingDateIso: '2026-02-14', state: 'ZZ', acres: 10,
    });
    expect(r.basis).toBe('none');
    expect(r.lines.join(' ')).toContain('not verified');
  });

  it('is refused when the source DOES publish a closed price', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: 58000,
      state: 'TX', acres: 10, sourceProvidesClosedPrice: true,
    });
    expect(r.basis).toBe('none');
  });
});

describe('no reliable transaction price at all', () => {
  it('blocks the record from the cleaned sold-price valuation and says why', () => {
    const r = resolveCompTransactionPrice({
      verifiedSoldPrice: null, soldDateIso: null, lastAskingPriceAtPending: null,
      state: 'TX', acres: 10,
    });
    expect(r.basis).toBe('none');
    expect(r.price).toBeNull();
    expect(r.pricePerAcre).toBeNull();
    expect(r.usableForValuation).toBe(false);
    expect(r.lines.join(' ')).toContain('blocked from the cleaned sold-price valuation');
  });
});
