import { describe, expect, it } from 'vitest';

import { analyseDealIntelligence } from './deal-intelligence-analysis.js';
import { EMPTY_COMPS, UNPRICED_VALUATION, type AssemblyGap, type DealIntelligenceInputPackage } from './deal-intelligence-assembly.js';
import type { SnapshotIdentity, SnapshotSpecialistRecord } from './property-intelligence-snapshot.js';

const CONFIRMED: SnapshotIdentity = {
  state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
  apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
  situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
  hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed.',
};

function specialist(id: string, status: SnapshotSpecialistRecord['status'], role: 'required' | 'supporting' = 'required'): SnapshotSpecialistRecord {
  return {
    id: id as SnapshotSpecialistRecord['id'], label: id, role, status,
    startedAt: null, completedAt: null, durationMs: null, summary: `${id} ${status}`,
    failureCategory: null, failureMessage: null, retryable: false, evidenceCount: 0,
  };
}

function gap(key: string, role: 'required' | 'supporting', status = 'blocked'): AssemblyGap {
  return { key, label: key, role, status, acceptanceState: 'blocked', agentName: 'Property Research Agent', group: 'g', reason: `${key} could not run.` };
}

function pkg(overrides: Partial<DealIntelligenceInputPackage> = {}): DealIntelligenceInputPackage {
  return {
    dealCardId: 32,
    missionId: 'di_1',
    identity: CONFIRMED,
    facts: [],
    governmentRecords: [],
    dueDiligence: [],
    comps: EMPTY_COMPS,
    valuation: UNPRICED_VALUATION,
    strategies: [],
    recommendation: { preferredStrategy: null, why: 'none', whatWouldChangeIt: [], posture: 'undetermined', postureWhy: 'none' },
    evidence: [],
    specialists: [specialist('parcel_identity', 'completed')],
    gaps: [],
    requiredGaps: [],
    missionOutcome: 'Joined 10 of 10 child mission(s).',
    missionStatus: 'joined',
    packageBlockers: [],
    counts: { childrenTotal: 10, contributed: 10, accepted: 8, incomplete: 2 },
    ...overrides,
  };
}

const analyse = (input: DealIntelligenceInputPackage) =>
  analyseDealIntelligence({
    package: input,
    runId: 'di_1',
    sequence: 1,
    startedAt: '2026-07-27T00:00:00.000Z',
    completedAt: '2026-07-27T00:10:00.000Z',
  });

describe('Deal Intelligence analysis (the Analyst stage)', () => {
  it('carries the parent mission outcome onto the snapshot', () => {
    const snapshot = analyse(pkg());
    expect(snapshot.missingInformation.join(' ')).toContain('Joined 10 of 10 child mission(s).');
    expect(snapshot.missingInformation.join(' ')).toContain('di_1');
  });

  it('does NOT turn a supporting gap into a blocker', () => {
    // Phase 5: a missing lane affects only what it materially bears on. Market
    // Pulse is context; its absence must never read as a blocked deal.
    const snapshot = analyse(pkg({
      gaps: [gap('market_intelligence', 'supporting')],
      requiredGaps: [],
      specialists: [specialist('parcel_identity', 'completed'), specialist('market_intelligence', 'blocked', 'supporting')],
    }));
    expect(snapshot.blockers.join(' ')).not.toMatch(/market_intelligence/);
    expect(snapshot.missingInformation.join(' ')).toMatch(/market_intelligence/);
    expect(snapshot.missingInformation.join(' ')).toMatch(/does not change the conclusions/i);
  });

  it('names a required gap as a blocker with its acceptance state', () => {
    const snapshot = analyse(pkg({
      gaps: [gap('zoning_land_use', 'required')],
      requiredGaps: [gap('zoning_land_use', 'required')],
    }));
    expect(snapshot.blockers.join(' ')).toMatch(/zoning_land_use \(blocked, blocked\)/);
    expect(snapshot.blockers.join(' ')).toMatch(/could not run/);
  });

  it('does not repeat a skipped lane as its own blocker', () => {
    // A skipped lane is a consequence of another gap, already named at its root.
    const skipped: AssemblyGap = { ...gap('government_records', 'required'), status: 'skipped' };
    const snapshot = analyse(pkg({ gaps: [skipped], requiredGaps: [skipped] }));
    expect(snapshot.blockers.join(' ')).not.toMatch(/government_records \(skipped/);
    // It still shows as missing information via its specialist row.
  });

  it('withholds every parcel-specific conclusion on an unresolved identity', () => {
    const unresolved: SnapshotIdentity = { ...CONFIRMED, state: 'unresolved', apn: null, explanation: 'No official record matched.' };
    const snapshot = analyse(pkg({ identity: unresolved }));
    expect(snapshot.status).toBe('blocked_identity');
    expect(snapshot.headline.confidence).toBe('none');
    expect(snapshot.valuation.priceable).toBe(false);
    expect(snapshot.blockers.join(' ')).toMatch(/has not been identified against an official record/);
  });

  it('states the package blockers the Operator recorded', () => {
    const snapshot = analyse(pkg({ packageBlockers: ['The parent mission did not complete cleanly: timeout.'] }));
    expect(snapshot.blockers.join(' ')).toMatch(/did not complete cleanly/);
  });

  it('produces one snapshot with no duplicated blocker or missing-information line', () => {
    const snapshot = analyse(pkg({
      packageBlockers: ['Same line.', 'Same line.'],
      gaps: [gap('zoning_land_use', 'required')],
      requiredGaps: [gap('zoning_land_use', 'required')],
    }));
    expect(new Set(snapshot.blockers).size).toBe(snapshot.blockers.length);
    expect(new Set(snapshot.missingInformation).size).toBe(snapshot.missingInformation.length);
  });
});
