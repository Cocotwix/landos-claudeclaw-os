import { describe, it, expect } from 'vitest';
import {
  assertReadOnly, isForbiddenAction, ReadOnlyViolation, READONLY_FORBIDDEN_ACTIONS,
  buildNetrStateUrl, countySearchFallbackQuery, planNetrWorkflow, NETR_WORKFLOW_STEPS,
  defaultBrowserLanes, browserLaneStatus, makeLandPortalReadOnlyLane, makeLandIdReadOnlyLane,
  makeNetrLane,
} from './browser-retrieval.js';

describe('browser retrieval — read-only guards', () => {
  it('allows read-only actions and blocks every forbidden action', () => {
    expect(() => assertReadOnly('search')).not.toThrow();
    expect(() => assertReadOnly('view')).not.toThrow();
    for (const f of READONLY_FORBIDDEN_ACTIONS) {
      expect(() => assertReadOnly(f)).toThrow(ReadOnlyViolation);
      expect(isForbiddenAction(f)).toBe(true);
    }
  });

  it('forbidden list covers paid-report / purchase / credit / billing / write', () => {
    expect(isForbiddenAction('generate_paid_report')).toBe(true);
    expect(isForbiddenAction('consume_credits')).toBe(true);
    expect(isForbiddenAction('modify_billing')).toBe(true);
    expect(isForbiddenAction('any_write')).toBe(true);
    expect(isForbiddenAction('store_credentials')).toBe(true);
  });
});

describe('NETR workflow', () => {
  it('builds the state directory URL', () => {
    expect(buildNetrStateUrl('GA')).toBe('https://publicrecords.netronline.com/georgia');
    expect(buildNetrStateUrl('SC')).toContain('south-carolina');
    expect(buildNetrStateUrl(undefined)).toBe('https://publicrecords.netronline.com/');
  });

  it('plans the full county→assessor→gis→parcel map→recorder→tax workflow with fallbacks', () => {
    const plan = planNetrWorkflow({ county: 'White', state: 'GA' });
    expect(plan.steps.map((s) => s.step)).toEqual([...NETR_WORKFLOW_STEPS]);
    expect(plan.directoryUrl).toContain('georgia');
    expect(plan.executable).toBe(false); // parked until visual stack
    const gisStep = plan.steps.find((s) => s.step === 'locate_gis');
    expect(gisStep?.fallbackQuery).toMatch(/White County GA.*GIS/i);
  });

  it('builds a county-search fallback query for a failed NETR link', () => {
    expect(countySearchFallbackQuery({ county: 'White', state: 'GA', step: 'locate_recorder' })).toMatch(/White County GA.*recorder/i);
  });
});

describe('browser lanes — parked placeholders', () => {
  it('all default lanes are parked (no visual stack) and contribute nothing', async () => {
    const lanes = defaultBrowserLanes();
    expect(lanes.every((l) => l.configured() === false)).toBe(true);
    const netr = makeNetrLane();
    const finding = await netr.find({ county: 'White', state: 'GA' }, { timeoutMs: 1000 });
    expect(finding.status).toBe('parked');
    expect(finding.patch).toEqual({});
    expect(finding.sourceUrl).toContain('georgia');
  });

  it('LandPortal/Land ID read-only lanes stay parked without an authenticated session', async () => {
    const lp = makeLandPortalReadOnlyLane({ configured: true, authenticatedSession: false });
    expect(lp.configured()).toBe(false); // configured requires a session too
    const f = await lp.find({}, { timeoutMs: 1000 });
    expect(f.status).toBe('parked');
    expect(f.note).toMatch(/authenticated session|never stored/i);

    const li = makeLandIdReadOnlyLane({ configured: true, authenticatedSession: false });
    expect(li.configured()).toBe(false);
  });

  it('LandPortal/Land ID are read-only by contract', () => {
    expect(makeLandPortalReadOnlyLane().readOnly).toBe(true);
    expect(makeLandIdReadOnlyLane().readOnly).toBe(true);
  });

  it('status summary reports parked lanes honestly', () => {
    const status = browserLaneStatus();
    expect(status.find((s) => s.id === 'netr')?.status).toBe('parked');
    expect(status.find((s) => s.id === 'landportal_readonly')?.status).toBe('parked');
  });
});
