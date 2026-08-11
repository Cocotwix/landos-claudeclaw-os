import { describe, expect, it } from 'vitest';
import { ACCOUNTABLE_COMP_LANES, buildCompLaneAccountability, compLanePlan } from './comp-lane-accountability.js';

describe('buildCompLaneAccountability', () => {
  it('always includes all four lanes', () => expect(buildCompLaneAccountability([]).lanes.map((x) => x.lane)).toEqual(ACCOUNTABLE_COMP_LANES));
  it('does not invent zero for an unrun lane', () => {
    const lane = buildCompLaneAccountability([]).lanes[0];
    expect(lane.status).toBe('not_run'); expect(lane.candidates).toBeNull(); expect(lane.operatorLine).not.toMatch(/\b0\b|zero results/i);
  });
  it('distinguishes an actual no-results run', () => expect(buildCompLaneAccountability([{ lane: 'zillow', attempted: true, candidates: 0 }]).lanes[1].status).toBe('ran_no_results'));
  it('reports filtered candidates with a reason', () => {
    const lane = buildCompLaneAccountability([{ lane: 'redfin', attempted: true, candidates: 3, retained: 0, filteredReasons: ['Improved homes were filtered.'] }]).lanes[2];
    expect(lane.status).toBe('ran_results_filtered'); expect(lane.detail).toMatch(/Improved homes/);
  });
  it('reports retained count', () => expect(buildCompLaneAccountability([{ lane: 'landportal', attempted: true, candidates: 5, retained: 4 }]).lanes[0].operatorLine).toMatch(/retained 4/));
  it('keeps failure counts null', () => expect(buildCompLaneAccountability([{ lane: 'zillow', attempted: true, failureReason: 'network error' }]).lanes[1]).toMatchObject({ status: 'failed', candidates: null, retained: null }));
  it('honors a concrete failure even when the caller could not mark the attempt complete', () => {
    expect(buildCompLaneAccountability([{ lane: 'zillow', attempted: false, failureReason: 'browser startup failed' }]).lanes[1])
      .toMatchObject({ status: 'failed', candidates: null, retained: null, detail: 'browser startup failed' });
  });
  it('distinguishes blocked and disabled', () => {
    const result = buildCompLaneAccountability([{ lane: 'redfin', attempted: true, blockedReason: 'challenge' }, { lane: 'realtor', attempted: false, disabledReason: 'policy' }]);
    expect(result.lanes[2].status).toBe('blocked'); expect(result.lanes[3].status).toBe('disabled_by_policy');
  });
  it('tracks unrun lanes and accountability', () => {
    const result = buildCompLaneAccountability([{ lane: 'landportal', attempted: true, candidates: 0 }]);
    expect(result.everyLaneAccountedFor).toBe(false); expect(result.unrunLanes).toEqual(['zillow', 'redfin', 'realtor']); expect(result.summaryLine.length).toBeGreaterThanOrEqual(40);
  });
  it('plans every source even after LandPortal succeeds', () => expect(compLanePlan({ landPortalUsableCount: 5 }).mustRun).toEqual(ACCOUNTABLE_COMP_LANES));
});
