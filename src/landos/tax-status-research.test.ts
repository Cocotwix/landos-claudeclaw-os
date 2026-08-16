import { describe, it, expect } from 'vitest';
import {
  TAX_STATUS_FIELDS,
  buildTaxStatusRead,
  deriveTaxStanding,
  taxAuthorityFor,
  taxStatusAttemptsFromSources,
} from './tax-status-research.js';

describe('the collecting office is named by jurisdiction', () => {
  it('names the office the state actually uses to collect property tax', () => {
    expect(taxAuthorityFor({ county: 'Williamson', state: 'TN' })?.officeName).toBe('County Trustee');
    expect(taxAuthorityFor({ county: 'Harris', state: 'TX' })?.officeName).toBe('County Tax Assessor-Collector');
    expect(taxAuthorityFor({ county: 'Fayette', state: 'GA' })?.officeName).toBe('County Tax Commissioner');
  });

  it('falls back to the generic collecting office rather than inventing one', () => {
    expect(taxAuthorityFor({ county: 'Beaufort', state: 'SC' })?.officeName).toBe('County Treasurer / Tax Collector');
  });

  it('names no office at all when the subject has no county and no state', () => {
    // An unplaced subject has no collecting office; naming one would fabricate
    // a source the operator could not actually open.
    expect(taxAuthorityFor({ county: null, state: null })).toBeNull();
  });

  it('does not repeat "County" in the operator label', () => {
    expect(taxAuthorityFor({ county: 'Williamson', state: 'TN' })?.label)
      .toBe('County Trustee (Williamson, TN) — property-tax payment status');
  });
});

describe('standing is decided by labeled fields, never inferred', () => {
  it('reads an explicit delinquency', () => {
    expect(deriveTaxStanding({ paymentStatus: 'DELINQUENT' })).toBe('delinquent');
    expect(deriveTaxStanding({ paymentStatus: 'Past due' })).toBe('delinquent');
  });

  it('reads a positive owed balance as delinquent', () => {
    expect(deriveTaxStanding({ delinquentAmount: '$1,240.18' })).toBe('delinquent');
  });

  it('reads an explicit paid/current status', () => {
    expect(deriveTaxStanding({ paymentStatus: 'PAID' })).toBe('current');
    expect(deriveTaxStanding({ paymentStatus: 'No delinquency' })).toBe('current');
  });

  it('reads a stated zero balance as current', () => {
    // The source published the number; that is an affirmative answer.
    expect(deriveTaxStanding({ delinquentAmount: '$0.00' })).toBe('current');
  });

  it('stays unresolved when nothing labeled says either way', () => {
    expect(deriveTaxStanding({})).toBe('unresolved');
    expect(deriveTaxStanding({ paymentStatus: '   ' })).toBe('unresolved');
    // A levy amount is not a payment status.
    expect(deriveTaxStanding({ paymentStatus: '$6,858.00' })).toBe('unresolved');
  });
});

describe('a scheduled source that was never reached reports its blocker', () => {
  const sources = [
    {
      provider: 'County Records Browser', stage: 'county_records_browser', status: 'error',
      note: 'No official county source could be routed for Williamson, TN (NETR + search). Records marked Needs Verification. [browser cleanup: 1 page(s) closed]',
    },
    { provider: 'Official Tax Office', stage: 'official_tax_office', status: 'not_attempted', note: 'Official tax office destination.' },
    { provider: 'Official Recorder', stage: 'official_recorder', status: 'not_attempted', note: 'Official recorder destination.' },
  ];

  it('carries the lane blocker onto the tax office that never got a destination', () => {
    const attempts = taxStatusAttemptsFromSources(sources);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].source).toBe('Official Tax Office');
    expect(attempts[0].reached).toBe(false);
    expect(attempts[0].outcome).toContain('No official county source could be routed');
  });

  it('strips browser housekeeping out of the operator-facing blocker', () => {
    expect(taxStatusAttemptsFromSources(sources)[0].outcome).not.toMatch(/browser cleanup/i);
  });

  it('reports a lane starved of time as a blocker, not a bare "not reached"', () => {
    // A lane that never got a time slice is as real an obstacle as a routing
    // failure, and the operator needs to know which one it was.
    const attempts = taxStatusAttemptsFromSources([
      {
        provider: 'County Records Browser', stage: 'county_records_browser', status: 'partial',
        note: 'The shared inspection deadline was exhausted after LandPortal; the official county lane remains queued for the next run.',
      },
      { provider: 'Official Tax Office', stage: 'official_tax_office', status: 'not_attempted', note: 'Official tax office destination.' },
    ]);
    expect(attempts[0].outcome).toContain('deadline was exhausted');
  });

  it('separates "reached and published nothing" from "never reached"', () => {
    // These are different answers: one says call the office, the other says the
    // lookup still has to happen.
    const reached = buildTaxStatusRead({
      fields: {},
      attempts: [{ source: 'Official Tax Office', url: null, outcome: 'source reached', reached: true }],
      authority: taxAuthorityFor({ county: 'Williamson', state: 'TN' }),
    });
    expect(reached.statement).toMatch(/were reached and none published/i);
    expect(reached.statement).toMatch(/may not publish standing online/i);

    const notReached = buildTaxStatusRead({
      fields: {},
      attempts: [{ source: 'Official Tax Office', url: null, outcome: 'scheduled but not reached', reached: false }],
      authority: taxAuthorityFor({ county: 'Williamson', state: 'TN' }),
    });
    expect(notReached.statement).toMatch(/attempted/i);
    expect(notReached.statement).not.toMatch(/were reached and none published/i);
  });

  it('never reports the question as unscreened once a source was attempted', () => {
    const read = buildTaxStatusRead({
      fields: {},
      attempts: taxStatusAttemptsFromSources(sources),
      authority: taxAuthorityFor({ county: 'Williamson', state: 'TN' }),
    });
    expect(read.standing).toBe('unresolved');
    expect(read.statement).not.toMatch(/not screened/i);
    expect(read.statement).toContain('Official Tax Office');
    expect(read.statement).toContain('County Trustee');
    expect(read.authoritySearchUrl).toMatch(/^https:\/\//);
  });
});

describe('a resolved payment status reports every field the source published', () => {
  it('states a delinquency with its amount, years, penalties and tax-sale status', () => {
    const read = buildTaxStatusRead({
      fields: {
        'Property-tax payment status': 'DELINQUENT',
        'Delinquent tax amount owed': '$4,812.44',
        'Unpaid property-tax years': '2023, 2024',
        'Tax delinquency began': '2023',
        'Tax penalties and interest': '$612.09',
        'Tax-sale status': 'Scheduled for the 2026 tax sale',
      },
      attempts: [{ source: 'County Trustee', url: 'https://example.gov/tax', outcome: 'record retrieved', reached: true }],
      sourceLabel: 'County Trustee',
      sourceUrl: 'https://example.gov/tax',
      authority: taxAuthorityFor({ county: 'Williamson', state: 'TN' }),
    });
    expect(read.standing).toBe('delinquent');
    expect(read.statement).toContain('DELINQUENT');
    expect(read.statement).toContain('$4,812.44');
    expect(read.statement).toContain('2023, 2024');
    expect(read.statement).toContain('$612.09');
    expect(read.statement).toContain('2026 tax sale');
    expect(read.sourceUrl).toBe('https://example.gov/tax');
  });

  it('states a clean file as current', () => {
    const read = buildTaxStatusRead({
      fields: { 'Property-tax payment status': 'PAID', 'Delinquent tax amount owed': '$0.00' },
      attempts: [{ source: 'County Trustee', url: null, outcome: 'record retrieved', reached: true }],
      authority: taxAuthorityFor({ county: 'Williamson', state: 'TN' }),
    });
    expect(read.standing).toBe('current');
    expect(read.statement).toMatch(/CURRENT/);
  });

  it('prefers an already-derived standing over re-deriving it', () => {
    const read = buildTaxStatusRead({
      fields: { 'Property-tax standing': 'Delinquent' },
      attempts: [],
      authority: null,
    });
    expect(read.standing).toBe('delinquent');
  });

  it('exposes every field the payment-status source is read for', () => {
    expect(TAX_STATUS_FIELDS).toContain('Tax-sale status');
    expect(TAX_STATUS_FIELDS).toContain('Unpaid property-tax years');
    expect(TAX_STATUS_FIELDS).toContain('Tax penalties and interest');
  });
});
