import { describe, expect, it } from 'vitest';
import { ACCOUNTABLE_COMP_LANES, buildCompLaneAccountability, compLanePlan, laneSearchVerified, type CompLaneRouteOutcome } from './comp-lane-accountability.js';

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

describe('search verification', () => {
  const route = (over: Partial<CompLaneRouteOutcome> = {}): CompLaneRouteOutcome => ({
    label: 'Williamsburg, MI', url: 'https://example.test/search', reached: true, blocked: false,
    cardsFound: 0, marketVerified: true, qualifying: 0, outcome: 'read', ...over,
  });

  it('counts a lane verified only when a route was reached, unblocked and market-verified', () => {
    expect(laneSearchVerified([route()])).toBe(true);
    expect(laneSearchVerified([route({ marketVerified: false })])).toBe(false);
    expect(laneSearchVerified([route({ blocked: true })])).toBe(false);
    expect(laneSearchVerified([route({ reached: false })])).toBe(false);
    expect(laneSearchVerified([])).toBe(false);
    expect(laneSearchVerified(null)).toBe(false);
  });

  it('refuses to call an unverified search "no results"', () => {
    const lane = buildCompLaneAccountability([{
      lane: 'redfin', attempted: true, candidates: 0, searchVerified: false,
      routes: [route({ marketVerified: false, outcome: 'wrong geography' })],
    }]).lanes.find((entry) => entry.lane === 'redfin')!;
    expect(lane.status).toBe('ran_no_verified_search');
    expect(lane.operatorLine).toMatch(/never reached a page verified as this subject's market/);
    expect(lane.detail).toMatch(/0 were verified as this subject's market/);
  });

  it('states a verified empty result as a verified result', () => {
    const lane = buildCompLaneAccountability([{
      lane: 'realtor', attempted: true, candidates: 0, searchVerified: true, routes: [route({ cardsFound: 12 })],
    }]).lanes.find((entry) => entry.lane === 'realtor')!;
    expect(lane.status).toBe('ran_no_results');
    expect(lane.operatorLine).toMatch(/searched a verified page in this subject's market/);
    expect(lane.detail).toMatch(/12 result card\(s\) were exposed/);
  });

  it('keeps the original wording for a lane that reported no route evidence at all', () => {
    const lane = buildCompLaneAccountability([{ lane: 'redfin', attempted: true, candidates: 0 }])
      .lanes.find((entry) => entry.lane === 'redfin')!;
    expect(lane.status).toBe('ran_no_results');
    expect(lane.operatorLine).toBe('Redfin comparable search ran and returned no results.');
  });

  it('lets a real block outrank the verification question', () => {
    const lane = buildCompLaneAccountability([{
      lane: 'redfin', attempted: true, candidates: 0, searchVerified: false, blockedReason: 'anti-bot wall',
    }]).lanes.find((entry) => entry.lane === 'redfin')!;
    expect(lane.status).toBe('blocked');
  });
});
