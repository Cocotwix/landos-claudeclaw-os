import { describe, it, expect } from 'vitest';
import { operatorGapLabel, operatorizePersistedGap } from './deal-card-report.js';

// Implementation-facing wording must never reach the operator UI. Every gap maps
// to a business-language "Needs … confirmation/verification"; the raw field name
// is kept only as a small parenthetical for traceability.
describe('operatorGapLabel — operator language, never developer wording', () => {
  const cases: Array<[string, RegExp]> = [
    ['femaFloodZone', /Needs FEMA flood verification/],
    ['flood', /Needs FEMA flood verification/],
    ['wetlands', /Needs wetlands verification/],
    ['slope', /Needs slope \/ terrain verification/],
    ['roadFrontage', /Needs road frontage \/ access confirmation/],
    ['utilities', /Needs utility confirmation/],
    ['zoning', /Needs zoning confirmation/],
    ['acres', /Needs acreage confirmation/],
    ['owner', /Needs ownership confirmation/],
    ['county', /Needs county confirmation/],
    ['apn', /Needs parcel-number confirmation/],
    ['assessedValue', /Needs valuation confirmation/],
    ['somethingUnknown', /Needs confirmation/],
  ];
  for (const [field, re] of cases) {
    it(`${field} → operator language`, () => {
      const out = operatorGapLabel(field);
      expect(out).toMatch(re);
      // Never leak raw developer phrasing.
      expect(out).not.toMatch(/source field not returned|missing api field|provider field absent|verification gap/i);
      expect(out).not.toMatch(/\([a-z][A-Za-z]+\)/);
    });
  }
});

describe('operatorizePersistedGap', () => {
  it('replaces a legacy parenthetical storage key with business language', () => {
    expect(operatorizePersistedGap('Needs confirmation (mailingAddress).')).toBe('Owner mailing address has not been confirmed.');
    expect(operatorizePersistedGap('Needs FEMA flood verification (femaPct).')).toBe('Needs FEMA flood verification.');
    expect(operatorizePersistedGap('Needs road frontage / access confirmation (roadFrontageFt).')).toBe('Needs road frontage / access confirmation.');
  });
});
