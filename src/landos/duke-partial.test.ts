// Unit tests for the standardized Duke Partial output contract. Pure: no DB,
// no network, no secrets.

import { describe, it, expect } from 'vitest';

import { buildDukePartialContract } from './duke-partial.js';

const base = {
  latestReportStatus: null as string | null,
  hasVerifiedProperty: false,
  hasUnverifiedProperty: false,
  risks: [] as string[],
  nextActions: [] as Array<Record<string, unknown>>,
  latestWriteback: null as string | null,
};

describe('buildDukePartialContract', () => {
  it('verified partial: not blocked, no discovery questions, no comp credit', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', risks: ['No LP valuation'] });
    expect(c.verificationStatus).toBe('verified');
    expect(c.reportStatus).toBe('partial');
    expect(c.blockedReason).toBeNull();
    expect(c.discoveryQuestions).toEqual([]);
    expect(c.noCompCreditUsed).toBe(true);
    expect(c.compCreditUsed).toBe(false);
    expect(c.openRisks).toEqual(['No LP valuation']);
  });

  it('unverified: blocked before valuation/offer with discovery questions', () => {
    const c = buildDukePartialContract({ ...base, hasUnverifiedProperty: true });
    expect(c.verificationStatus).toBe('unverified');
    expect(c.reportStatus).toBe('blocked');
    expect(c.blockedReason).toMatch(/not fully verified/i);
    expect(c.blockedReason).toMatch(/no scoring, valuation, comps, offer, or strategy/i);
    expect(c.discoveryQuestions.length).toBeGreaterThan(0);
    expect(c.nextBestAction).toBe(c.discoveryQuestions[0]);
    expect(c.noCompCreditUsed).toBe(true);
  });

  it('mixed verification blocks (some unverified)', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, hasUnverifiedProperty: true, latestReportStatus: 'partial' });
    expect(c.verificationStatus).toBe('mixed');
    expect(c.reportStatus).toBe('blocked');
    expect(c.blockedReason).toBeTruthy();
  });

  it('a delivered (Full) report marks comp credit used', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'delivered' });
    expect(c.reportStatus).toBe('delivered');
    expect(c.compCreditUsed).toBe(true);
    expect(c.noCompCreditUsed).toBe(false);
  });

  it('terminal failure statuses pass through even when verified', () => {
    expect(buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'failed' }).reportStatus).toBe('failed');
    expect(buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'not_generated' }).reportStatus).toBe('not_generated');
  });

  it('nextBestAction prefers a persisted open next action', () => {
    const c = buildDukePartialContract({ ...base, hasVerifiedProperty: true, latestReportStatus: 'partial', nextActions: [{ action: 'Pull county checklist' }] });
    expect(c.nextBestAction).toBe('Pull county checklist');
  });

  it('no run yet (no properties, no status) is none and blocked', () => {
    const c = buildDukePartialContract({ ...base });
    expect(c.verificationStatus).toBe('none');
    expect(c.reportStatus).toBe('blocked');
  });

  it('never emits coordinate/proximity/geocoder verification language', () => {
    const c = buildDukePartialContract({ ...base, hasUnverifiedProperty: true });
    const blob = JSON.stringify(c);
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|lat\/?lon|centroid/i.test(blob)).toBe(false);
  });
});
