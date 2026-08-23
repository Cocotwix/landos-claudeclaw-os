import { describe, expect, it } from 'vitest';

import {
  LANE_MATERIALITY,
  countsAsRequired,
  isReturned,
  laneMateriality,
  laneOutcome,
  recoveryBudget,
  recoveryEligible,
  tallyResearchLanes,
} from './research-lane-outcome.js';

/**
 * The real Deal 89 (Fairview, 0 Kingwood Blvd) primary run as persisted:
 * seven completed, four partial, one blocked. The surface reported this as
 * "12 of 12 lanes reported by this research run", which is the defect.
 */
const DEAL_89 = [
  { status: 'completed' as const },  // parcel_identity
  { status: 'blocked' as const },    // government_records — the deeds
  { status: 'partial' as const },    // zoning_land_use
  { status: 'completed' as const },  // environmental_terrain
  { status: 'partial' as const },    // access_utilities — water/sewer
  { status: 'completed' as const },  // comparables
  { status: 'completed' as const },  // market_intelligence
  { status: 'completed' as const },  // evidence_visuals
  { status: 'completed' as const },  // property_backstory
  { status: 'partial' as const },    // subdivision_feasibility
  { status: 'completed' as const },  // valuation
  { status: 'partial' as const },    // strategy
];

describe('research lane outcome vocabulary', () => {
  it('maps every settled specialist status onto exactly one outcome', () => {
    expect(laneOutcome({ status: 'completed' })).toBe('RETURNED');
    expect(laneOutcome({ status: 'partial' })).toBe('PARTIAL');
    expect(laneOutcome({ status: 'failed' })).toBe('UNRESOLVED');
    expect(laneOutcome({ status: 'blocked' })).toBe('BLOCKED');
    expect(laneOutcome({ status: 'skipped' })).toBe('NOT_REQUIRED');
  });

  it('gives an unsettled lane no outcome at all, so it lands in no count', () => {
    expect(laneOutcome({ status: 'queued' })).toBeNull();
    expect(laneOutcome({ status: 'running' })).toBeNull();
    const tally = tallyResearchLanes([{ status: 'queued' }, { status: 'running' }]);
    expect(tally.pending).toBe(2);
    expect(tally.requiredTotal).toBe(0);
    expect(tally.returned).toBe(0);
  });

  // Spec test 13.
  it('never counts UNRESOLVED as RETURNED', () => {
    expect(isReturned(laneOutcome({ status: 'failed' }))).toBe(false);
    const tally = tallyResearchLanes([{ status: 'failed' }, { status: 'failed' }]);
    expect(tally.returned).toBe(0);
    expect(tally.unresolved).toBe(2);
    expect(tally.headline).toBe('0 of 2 required lanes returned');
  });

  // Spec test 14.
  it('never counts BLOCKED as RETURNED', () => {
    expect(isReturned(laneOutcome({ status: 'blocked' }))).toBe(false);
    const tally = tallyResearchLanes([{ status: 'blocked' }, { status: 'completed' }]);
    expect(tally.returned).toBe(1);
    expect(tally.blocked).toBe(1);
    expect(tally.headline).toBe('1 of 2 required lanes returned');
  });

  // Spec test 15.
  it('keeps PARTIAL visibly partial rather than folding it into returned', () => {
    expect(isReturned(laneOutcome({ status: 'partial' }))).toBe(false);
    const tally = tallyResearchLanes([{ status: 'partial' }, { status: 'completed' }]);
    expect(tally.returned).toBe(1);
    expect(tally.partial).toBe(1);
    expect(tally.headline).toBe('1 of 2 required lanes returned');
    expect(tally.breakdown).toContain('Partial: 1');
  });

  // Spec test 16.
  it('requires a usable answer before a completed lane may read as RETURNED', () => {
    expect(laneOutcome({ status: 'completed', answered: false })).toBe('UNRESOLVED');
    expect(laneOutcome({ status: 'completed', failureCategory: 'source_unavailable' })).toBe('PARTIAL');
    expect(laneOutcome({ status: 'completed', answered: true })).toBe('RETURNED');
  });

  it('excludes NOT_REQUIRED lanes from the operator denominator', () => {
    expect(countsAsRequired(laneOutcome({ status: 'skipped' }))).toBe(false);
    const tally = tallyResearchLanes([{ status: 'skipped' }, { status: 'completed' }]);
    expect(tally.requiredTotal).toBe(1);
    expect(tally.headline).toBe('1 of 1 required lanes returned');
    expect(tally.notRequired).toBe(1);
  });

  it('reports the real Deal 89 run as 7 of 12 returned, not 12 of 12 reported', () => {
    const tally = tallyResearchLanes(DEAL_89);
    expect(tally.laneTotal).toBe(12);
    expect(tally.returned).toBe(7);
    expect(tally.partial).toBe(4);
    expect(tally.blocked).toBe(1);
    expect(tally.unresolved).toBe(0);
    expect(tally.headline).toBe('7 of 12 required lanes returned');
    expect(tally.breakdown).toBe('Returned: 7 · Partial: 4 · Blocked: 1');
    // The defect, stated as an assertion: the old surface counted every
    // settled lane, answered or not.
    expect(tally.returned).toBeLessThan(tally.laneTotal);
  });

  it('never lets the returned count exceed the required denominator', () => {
    const tally = tallyResearchLanes(DEAL_89);
    expect(tally.returned).toBeLessThanOrEqual(tally.requiredTotal);
    expect(tally.returned + tally.partial + tally.unresolved + tally.blocked)
      .toBe(tally.requiredTotal);
  });
});

describe('materiality and bounded recovery', () => {
  it('rates the deal-controlling questions high', () => {
    for (const lane of [
      'parcel_identity', 'government_records', 'zoning_land_use',
      'access_utilities', 'subdivision_feasibility',
    ]) {
      expect(LANE_MATERIALITY[lane]).toBe('high');
    }
  });

  it('rates presentation and market colour low', () => {
    expect(laneMateriality('market_intelligence')).toBe('low');
    expect(laneMateriality('evidence_visuals')).toBe('low');
  });

  it('defaults an unknown lane to medium rather than to deep research', () => {
    expect(laneMateriality('some_future_lane')).toBe('medium');
  });

  // Spec test 3: a low-materiality miss does not launch deep research.
  it('gives a low-materiality question no adaptive recovery budget', () => {
    expect(recoveryBudget('low')).toBe(0);
  });

  // Spec test 18: recovery is bounded and cannot recurse indefinitely.
  it('bounds every materiality level to a small finite budget', () => {
    expect(recoveryBudget('medium')).toBe(1);
    expect(recoveryBudget('high')).toBe(3);
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(Number.isFinite(recoveryBudget(level))).toBe(true);
      expect(recoveryBudget(level)).toBeLessThanOrEqual(3);
    }
  });

  it('offers recovery only for outcomes it could actually improve', () => {
    expect(recoveryEligible('UNRESOLVED')).toBe(true);
    expect(recoveryEligible('PARTIAL')).toBe(true);
    // A returned answer needs no recovery; a blocked lane needs access, not
    // more searching; a lane that does not apply needs nothing.
    expect(recoveryEligible('RETURNED')).toBe(false);
    expect(recoveryEligible('BLOCKED')).toBe(false);
    expect(recoveryEligible('NOT_REQUIRED')).toBe(false);
  });
});
