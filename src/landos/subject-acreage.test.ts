// Stage 1 regression: the shared subject-acreage contract.
//
// Every case here reproduces a defect that shipped. The Deal 115 shape is the
// control case (Bradford County FL, three retained measurements, a NULL
// property_card.acres); the assertions are about the mechanism, not that deal.

import { describe, expect, it } from 'vitest';

import { buildAcreageBasis, governingAcreageOf, supersededAcreageOf } from './acreage-basis.js';
import { acreageBandForAcres, acreageBandsForAcres } from './market-matrix-read.js';
import { isCurrentForSubject } from './canonical-subject-state.js';

// The three measurements retained for the control-case parcel, plus the
// operator acceptance recorded from the signed boundary survey.
const SURVEY_ACCEPTANCE = {
  value: 1.5,
  source: 'Operator-accepted governing acreage — signed boundary survey 2026-08-17',
  observedAt: '2026-08-17',
};
const DEP_GIS = { value: 1.846, source: 'Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)', observedAt: '2023' };
const PROVIDER_CALC = { value: 1.84, source: 'LandPortal calculated acreage' };

describe('governing acreage', () => {
  it('an operator acceptance governs over an older official GIS record', () => {
    const basis = buildAcreageBasis({ operatorAccepted: SURVEY_ACCEPTANCE, gisGeometry: DEP_GIS });
    const governing = governingAcreageOf(basis);
    expect(governing.value).toBe(1.5);
    expect(governing.kind).toBe('operator_accepted');
    expect(governing.source).toContain('signed boundary survey');
  });

  it('retires the older official record as history rather than a conflict', () => {
    const basis = buildAcreageBasis({ operatorAccepted: SURVEY_ACCEPTANCE, gisGeometry: DEP_GIS });
    const superseded = supersededAcreageOf(basis);

    expect(superseded.map((e) => e.value)).toEqual([1.846]);
    expect(superseded[0].supersededReason).toMatch(/2023/);
    // The whole point: county update lag is not an unresolved discrepancy.
    expect(basis.tylerDecisionRequired).toBe(false);
    expect(basis.decision).toBeNull();
    expect(basis.issues).toHaveLength(0);
    // And a retired record drives nothing at all.
    expect(superseded[0].permittedUses).toEqual([]);
  });

  it('retires a provider record the acceptance explicitly named, despite no vintage', () => {
    // A provider fetched today can still be serving a pre-survey figure, so the
    // acceptance names it. Date comparison alone could never retire this row.
    const basis = buildAcreageBasis({
      operatorAccepted: SURVEY_ACCEPTANCE,
      provider: { ...PROVIDER_CALC, retiredBySettlingBasis: { reason: 'Pre-survey aggregator figure; the provider has not completed its update cycle.' } },
    });
    const superseded = supersededAcreageOf(basis);
    expect(superseded.map((e) => e.value)).toEqual([1.84]);
    expect(superseded[0].supersededReason).toMatch(/update cycle/);
  });

  it('never retires a record on an assumption when dates are missing', () => {
    // No vintage on either side and no explicit retirement: the record stays an
    // ordinary non-governing reference. Guessing here is how a CURRENT
    // measurement would get silently buried.
    const basis = buildAcreageBasis({
      operatorAccepted: { value: 1.5, source: 'Operator accepted', observedAt: '2026-08-17' },
      provider: PROVIDER_CALC,
    });
    expect(supersededAcreageOf(basis)).toHaveLength(0);
    expect(governingAcreageOf(basis).value).toBe(1.5);
  });

  it('still reports a genuine unsettled disagreement between current records', () => {
    const basis = buildAcreageBasis({
      assessed: { value: 40, source: 'County assessor roll' },
      gisGeometry: { value: 52, source: 'County GIS geometry' },
    });
    expect(basis.tylerDecisionRequired).toBe(true);
    expect(basis.decision).toBeTruthy();
  });

  it('reports no acreage when nothing has been retained', () => {
    expect(governingAcreageOf(buildAcreageBasis({})).value).toBeNull();
  });
});

describe('acreage band selection', () => {
  it('reaches the sub-2-acre bands that used to collapse into 2-5', () => {
    // The control-case defect: a 1.5-acre subject was reported against 2-5-acre
    // comparables while its real 1-2 record sat unread in the collection.
    expect(acreageBandForAcres(1.5)).toBe('1-2');
    expect(acreageBandForAcres(0.4)).toBe('0-1');
    expect(acreageBandForAcres(1)).toBe('1-2');
    expect(acreageBandForAcres(2)).toBe('2-5');
  });

  it('selects NO band for an unknown acreage', () => {
    expect(acreageBandForAcres(null)).toBeNull();
    expect(acreageBandForAcres(undefined)).toBeNull();
    expect(acreageBandForAcres(0)).toBeNull();
    expect(acreageBandsForAcres(null)).toEqual([]);
  });

  it('keeps the larger bands and containment ordering intact', () => {
    expect(acreageBandForAcres(3)).toBe('2-5');
    expect(acreageBandForAcres(7)).toBe('5-10');
    expect(acreageBandForAcres(15)).toBe('10-20');
    expect(acreageBandForAcres(80)).toBe('50+');
    expect(acreageBandsForAcres(60)).toEqual(['50+', '50-100']);
    expect(acreageBandsForAcres(60)).not.toContain('20-50');
  });

  it('never lets a 1.5-acre subject resolve to the 10-20 band', () => {
    expect(acreageBandsForAcres(1.5)).not.toContain('10-20');
    expect(acreageBandsForAcres(1.5)[0]).toBe('1-2');
  });
});

describe('subject-version correlation', () => {
  it('treats a result from an older subject version as not current', () => {
    expect(isCurrentForSubject('iv:137:v2', 'iv:137:v2')).toBe(true);
    expect(isCurrentForSubject('iv:136:v1', 'iv:137:v2')).toBe(false);
  });

  it('treats an uncorrelated result as not current', () => {
    // A result that cannot say which subject it answered about must not be
    // assumed to have answered about this one.
    expect(isCurrentForSubject(null, 'iv:137:v2')).toBe(false);
    expect(isCurrentForSubject(undefined, 'iv:137:v2')).toBe(false);
    expect(isCurrentForSubject('', 'iv:137:v2')).toBe(false);
  });
});
