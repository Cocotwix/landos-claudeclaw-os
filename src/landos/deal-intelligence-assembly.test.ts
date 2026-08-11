import { describe, expect, it } from 'vitest';

import {
  assembleDealIntelligencePackage,
  assemblySpecialistRecords,
  UNRESOLVED_ASSEMBLY_IDENTITY,
  UNPRICED_VALUATION,
} from './deal-intelligence-assembly.js';
import { DEAL_INTELLIGENCE_CHILDREN } from './deal-intelligence-mission.js';
import { joinMissionChildren, missionChildIdentity, type MissionChildState } from './mission-graph.js';

function child(key: string, overrides: Partial<MissionChildState> = {}): MissionChildState {
  const spec = DEAL_INTELLIGENCE_CHILDREN.find((s) => s.key === key)!;
  return {
    key,
    label: spec.label,
    purpose: spec.purpose,
    role: spec.role,
    dependsOn: spec.dependsOn,
    identity: missionChildIdentity(spec, 'di_1'),
    status: 'completed',
    summary: `${spec.label} done.`,
    acceptance: { state: 'accepted', reason: 'ok', checks: [] },
    provider: null,
    failureCategory: null,
    failureMessage: null,
    retryable: false,
    result: null,
    startedAt: '2026-07-27T00:00:00.000Z',
    completedAt: '2026-07-27T00:01:00.000Z',
    durationMs: 60_000,
    attempt: 1,
    ...overrides,
  };
}

const IDENTITY_RESULT = {
  dealCardId: 32,
  identityState: 'confirmed' as const,
  address: 'OLD RIDGE RD',
  apn: '073090 04200',
  county: 'Roane',
  state: 'TN',
  owner: 'SACHAN DILEEP S',
  acres: 12.28,
  identity: {
    state: 'confirmed' as const, normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
    apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
    situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
    hasParcelGeometry: false, sourceConfidence: 'high' as const, conflicts: [], explanation: 'Confirmed.',
  },
  facts: [{ key: 'apn', label: 'APN', value: '073090 04200', grade: 'confirmed_fact' as const, source: 'TN', sourceUrl: null, retrievedAt: null, note: null }],
  subjectMarket: { state: 'TN', county: 'Roane' },
  subjectAcres: 12.28,
  acreageConflict: false,
  subjectResearch: { ran: true, ok: true, note: 'ran' },
  summary: 'Confirmed.',
};

function assemble(children: MissionChildState[]) {
  const join = joinMissionChildren({ specs: DEAL_INTELLIGENCE_CHILDREN, children });
  return { join, pkg: assembleDealIntelligencePackage({ dealCardId: 32, missionId: 'di_1', join, children }) };
}

describe('Deal Intelligence assembly (the Operator stage)', () => {
  it('names every non-contributing lane as a gap instead of dropping it', () => {
    const children = [
      child('parcel_identity', { result: IDENTITY_RESULT }),
      child('government_records', { status: 'blocked', summary: 'No recorded snapshot exists yet.', acceptance: { state: 'blocked', reason: 'No recorded snapshot exists yet.', checks: [] } }),
      child('zoning_land_use', { status: 'failed', failureCategory: 'network', failureMessage: 'Zoning service unreachable.' }),
      child('market_intelligence', { status: 'skipped', summary: 'Upstream missing.' }),
    ];
    const { pkg } = assemble(children);
    const keys = pkg.gaps.map((gap) => gap.key);
    expect(keys).toEqual(expect.arrayContaining(['government_records', 'zoning_land_use', 'market_intelligence']));
    expect(pkg.gaps.find((gap) => gap.key === 'zoning_land_use')!.reason).toBe('Zoning service unreachable.');
    // A supporting lane's absence is a gap, but never a REQUIRED one.
    expect(pkg.requiredGaps.map((gap) => gap.key)).not.toContain('market_intelligence');
  });

  it('carries a rejection reason rather than a bare failure message', () => {
    const children = [
      child('parcel_identity', { result: IDENTITY_RESULT }),
      child('comparables', {
        status: 'rejected',
        failureMessage: 'unacceptable_result',
        acceptance: { state: 'rejected', reason: 'Comparables named a government source, which is out of scope for comps.', checks: [] },
      }),
    ];
    const { pkg } = assemble(children);
    const gap = pkg.gaps.find((g) => g.key === 'comparables')!;
    expect(gap.acceptanceState).toBe('rejected');
    expect(gap.reason).toMatch(/out of scope for comps/);
    const specialist = pkg.specialists.find((s) => s.id === 'comparables')!;
    expect(specialist.failureMessage).toMatch(/out of scope for comps/);
  });

  it('never invents an identity when subject research did not contribute', () => {
    const children = [child('parcel_identity', { status: 'blocked', summary: 'No subject card.', result: null })];
    const { pkg } = assemble(children);
    expect(pkg.identity).toEqual(UNRESOLVED_ASSEMBLY_IDENTITY);
    expect(pkg.identity.state).toBe('unresolved');
    expect(pkg.packageBlockers.join(' ')).toMatch(/no identified subject parcel/i);
  });

  it('never invents a value when the valuation lane did not contribute', () => {
    const children = [child('parcel_identity', { result: IDENTITY_RESULT })];
    const { pkg } = assemble(children);
    expect(pkg.valuation).toEqual(UNPRICED_VALUATION);
    expect(pkg.valuation.priceable).toBe(false);
    expect(pkg.strategies).toEqual([]);
    expect(pkg.recommendation.preferredStrategy).toBeNull();
  });

  it('merges facts, due diligence and evidence from the lanes that DID land', () => {
    const children = [
      child('parcel_identity', { result: IDENTITY_RESULT }),
      child('zoning_land_use', {
        result: {
          dealCardId: 32, zoningKnown: true, zoning: 'A-1',
          items: [{ key: 'zoning', label: 'Zoning', verdict: 'good', headline: 'A-1', grade: 'confirmed_fact', detail: null, sourceUrl: null, missing: [] }],
          facts: [{ key: 'zoning_district', label: 'Zoning district', value: 'A-1', grade: 'confirmed_fact', source: 'map', sourceUrl: null, retrievedAt: null, note: null }],
          summary: '',
        },
      }),
      child('evidence_visuals', {
        result: {
          dealCardId: 32, evidenceCount: 1, screenshotCount: 1, documentCount: 0, sourceLinkCount: 0,
          evidence: [{ id: 'v1', kind: 'screenshot', label: 'Parcel page', sourceType: 'landportal', sourceUrl: null, viewUrl: '/x', retrievedAt: null, confidence: 'high', supports: 'visual_evidence', sha256: null, bytes: 1 }],
          summary: '',
        },
      }),
    ];
    const { pkg } = assemble(children);
    expect(pkg.facts.map((f) => f.key)).toEqual(['apn', 'zoning_district']);
    expect(pkg.dueDiligence).toHaveLength(1);
    expect(pkg.evidence).toHaveLength(1);
  });

  it('refuses to treat a comp handback claiming government verification as validated', () => {
    const children = [
      child('parcel_identity', { result: IDENTITY_RESULT }),
      child('comparables', {
        result: { dealCardId: 32, sources: ['Zillow'], candidateCount: 1, candidates: [], duplicatesMerged: 0, governmentVerificationPerformed: true, summary: '' },
      }),
    ];
    const { pkg } = assemble(children);
    expect(pkg.packageBlockers.join(' ')).toMatch(/out of scope for discovery-stage comps/i);
  });

  it('keeps a specialist row for every child, contributing or not', () => {
    const children = DEAL_INTELLIGENCE_CHILDREN.map((spec) => child(spec.key, { status: spec.key === 'strategy' ? 'failed' : 'completed' }));
    const rows = assemblySpecialistRecords(children);
    expect(rows).toHaveLength(DEAL_INTELLIGENCE_CHILDREN.length);
    expect(rows.find((row) => row.id === 'strategy')!.status).toBe('failed');
  });

  it('preserves the richer retained county acreage matrix instead of rebuilding it from selected comps', () => {
    const retained = {
      bands: [{ band: '5-10', soldVolume: 19, snapshotPeriod: '2026-Q2', source: 'LandOS Market Research' }],
      bestMovingBands: ['5-10'],
    };
    const children = [
      child('parcel_identity', { result: IDENTITY_RESULT }),
      child('market_intelligence', {
        result: {
          dealCardId: 32,
          marketMatrix: { title: 'County matrix' },
          marketPulse: null,
          marketScan: { acreageMatrix: retained },
          marketMatrixAvailable: true,
          marketPulseAvailable: false,
          facts: [],
          summary: 'County bands retained.',
        },
      }),
    ];
    const { pkg } = assemble(children);
    expect((pkg.marketIntelligence?.marketScan as { acreageMatrix: unknown }).acreageMatrix).toEqual(retained);
  });

  it('reports a rejected child as failed on the snapshot, never softened', () => {
    const rows = assemblySpecialistRecords([child('comparables', { status: 'rejected', acceptance: { state: 'rejected', reason: 'no', checks: [] } })]);
    expect(rows[0].status).toBe('failed');
  });
});
