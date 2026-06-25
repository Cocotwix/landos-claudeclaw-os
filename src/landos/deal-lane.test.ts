import { describe, it, expect } from 'vitest';
import { computeDealLane, LANE_PRIMARY, LANE_WITH_DEEPER_DD, type DealLaneSnapshot } from './deal-lane.js';

const snap = (o: Partial<DealLaneSnapshot> = {}): DealLaneSnapshot => ({ hasCard: true, ddReportReady: false, parcelVerified: false, ...o });

describe('Deal Card acquisition lane', () => {
  it('a fresh card sits at DD Report', () => {
    const v = computeDealLane(snap());
    expect(v.completedStages).toEqual(['lead']);
    expect(v.currentStage).toBe('dd_report');
    expect(v.nextAction?.requiredInputs[0]).toMatch(/Property Analysis/);
  });

  it('after DD Report, next is the Discovery Call', () => {
    const v = computeDealLane(snap({ ddReportReady: true, parcelVerified: true }));
    expect(v.currentStage).toBe('discovery_call');
    expect(v.readiness.ddReportReady).toBe(true);
    expect(v.readiness.underwritingReady).toBe(false); // no discovery summary yet
  });

  it('with discovery summary, underwriting becomes ready (primary lane)', () => {
    const v = computeDealLane(snap({ ddReportReady: true, parcelVerified: true, discoveryCallSummary: 'seller motivated' }));
    expect(v.stages.map((s) => s.stage)).toEqual(LANE_PRIMARY);
    expect(v.currentStage).toBe('underwriting');
    expect(v.readiness.underwritingReady).toBe(true);
  });

  it('the deeper-DD branch inserts a stage and gates underwriting until complete', () => {
    const v = computeDealLane(snap({ ddReportReady: true, parcelVerified: true, discoveryCallSummary: 'x', usingDeeperDd: true }));
    expect(v.stages.map((s) => s.stage)).toEqual(LANE_WITH_DEEPER_DD);
    expect(v.currentStage).toBe('deeper_dd');
    expect(v.readiness.underwritingReady).toBe(false);
    const done = computeDealLane(snap({ ddReportReady: true, parcelVerified: true, discoveryCallSummary: 'x', usingDeeperDd: true, deeperDdComplete: true }));
    expect(done.currentStage).toBe('underwriting');
    expect(done.readiness.underwritingReady).toBe(true);
  });

  it('approved underwriting advances to Offer; offer recorded completes the lane', () => {
    const v = computeDealLane(snap({ ddReportReady: true, parcelVerified: true, discoveryCallSummary: 'x', underwriting: { status: 'approved' } }));
    expect(v.currentStage).toBe('offer');
    expect(v.readiness.offerReady).toBe(true);
    const done = computeDealLane(snap({ ddReportReady: true, parcelVerified: true, discoveryCallSummary: 'x', underwriting: { status: 'approved' }, offerRecorded: true }));
    expect(done.nextAction).toBeNull();
    expect(done.completedStages).toEqual(LANE_PRIMARY);
  });
});
