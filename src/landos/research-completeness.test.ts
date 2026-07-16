import { describe, it, expect } from 'vitest';
import { computeResearchCompleteness, tierOf, researchCompletenessSummary, type LaneSignal } from './research-completeness.js';

const lane = (over: Partial<LaneSignal>): LaneSignal => ({
  key: 'k', label: 'L', attempted: true, dataRetrieved: true, businessResolved: true,
  externalConfirmationRequired: false, ...over,
});

describe('tierOf', () => {
  it('not_attempted when no provider ran', () => {
    expect(tierOf(lane({ attempted: false, dataRetrieved: false, businessResolved: false }))).toBe('not_attempted');
  });
  it('attempted when provider ran but returned nothing usable', () => {
    expect(tierOf(lane({ dataRetrieved: false, businessResolved: false }))).toBe('attempted');
  });
  it('partial when data retrieved but business question unresolved', () => {
    expect(tierOf(lane({ businessResolved: false }))).toBe('partial');
  });
  it('resolved when the business question is answered', () => {
    expect(tierOf(lane({}))).toBe('resolved');
  });
  it('confirmed only when external confirmation is complete', () => {
    expect(tierOf(lane({ externalConfirmationRequired: true, externalConfirmed: false }))).toBe('resolved');
    expect(tierOf(lane({ externalConfirmationRequired: true, externalConfirmed: true }))).toBe('confirmed');
  });
});

describe('computeResearchCompleteness — the acceptance-example lane mix', () => {
  // Reproduces the "7 of 8 evidenced" defect: county/wetlands/soils/slope/utilities
  // resolved; FEMA only county-layer screened (panel/BFE pending); access only
  // proximity (contact/legal access unresolved); zoning never ran.
  const rc = computeResearchCompleteness([
    lane({ key: 'county', label: 'Official county records' }),
    lane({ key: 'wetlands', label: 'Wetlands' }),
    lane({ key: 'soils', label: 'Soils & septic' }),
    lane({ key: 'slope', label: 'Slope & terrain' }),
    lane({ key: 'utilities', label: 'Utilities' }),
    lane({ key: 'flood', label: 'FEMA flood', businessResolved: false, externalConfirmationRequired: true, remaining: 'FIRM panel/BFE pending' }),
    lane({ key: 'access', label: 'Road proximity & access', businessResolved: false, externalConfirmationRequired: true, remaining: 'contact/legal access unresolved' }),
    lane({ key: 'zoning', label: 'Zoning & land use', attempted: false, dataRetrieved: false, businessResolved: false }),
  ]);

  it('does NOT count partial FEMA / partial access as resolved', () => {
    expect(rc.resolved).toBe(5); // county, wetlands, soils, slope, utilities
    expect(rc.unresolved).toEqual(expect.arrayContaining(['FEMA flood', 'Road proximity & access']));
  });
  it('reports zoning as not screened (missing), never as evidenced', () => {
    expect(rc.missing).toContain('Zoning & land use');
    expect(rc.screened).toBe(7); // 8 lanes minus zoning (not attempted)
  });
  it('is not complete while any lane is unresolved or unscreened', () => {
    expect(rc.complete).toBe(false);
  });
  it('withEvidence now tracks business-resolved (not merely retrieved)', () => {
    expect(rc.withEvidence).toBe(5);
  });
  it('summary never presents partial evidence as complete', () => {
    const s = researchCompletenessSummary(rc);
    expect(s).toMatch(/5\/8 lanes business-resolved/);
    expect(s).toMatch(/screened but unresolved/);
    expect(s).toMatch(/not yet screened/);
  });
});

describe('computeResearchCompleteness — genuinely complete card', () => {
  const rc = computeResearchCompleteness([
    lane({ key: 'a', label: 'A' }),
    lane({ key: 'b', label: 'B', externalConfirmationRequired: true, externalConfirmed: true }),
  ]);
  it('is complete only when every lane is at least resolved', () => {
    expect(rc.complete).toBe(true);
    expect(rc.confirmed).toBe(1);
    expect(rc.awaitingExternalConfirmation).toEqual([]);
  });
});
