import { describe, expect, it } from 'vitest';
import { buildLeadWorkspace } from './lead-workspace.js';

describe('Lead Workspace read model', () => {
  it('adapts canonical services without independently calculating their states', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 9, title: 'Unresolved lead' }, report: { parcelVerified: false, parcelVerificationStatus: 'Unresolved', dataGaps: ['APN needed'], riskFlags: [], sourceTable: [] },
      acquisition: { profile: {}, communications: [], discovery: [] }, nextAction: { label: 'Resolve identity' },
      operatorRecord: { researchCompleteness: { complete: false }, tylerDecisions: ['Confirm acreage'] },
      canonical: { unifiedReadiness: { offer: { state: 'researching' } }, strategyReadiness: { strategies: [{ strategy: 'Cash Flip', status: 'blocked' }], pricingBlockers: ['Parcel identity is not confirmed.'] } },
      compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
    });
    expect(workspace.contract.version).toBe('1.0');
    expect(workspace.property.resolutionState).toBe('Unresolved');
    expect(workspace.strategies.entries).toEqual([{ strategy: 'Cash Flip', status: 'blocked' }]);
    expect(workspace.work.blockers).toContain('Confirm acreage');
    expect(workspace.departmentOutputs[1].dependencies).toContain('WS1 acreage basis');
  });

  // Regression: reconciliation-ignores-acreage-conflict (QA finding F1).
  // The canonical WS1 acreage basis on operatorRecord.identity must outrank the
  // legacy per-report reconciliation whenever it exists, so a conflicted basis
  // can never render as a clean legacy "reconciled" record.
  it('renders the canonical identity acreage basis, never the legacy reconciliation, when both exist', () => {
    const canonicalBasis = {
      entries: [
        { basis: 'assessed', acres: 1.32, source: 'County assessor roll', disputed: true },
        { basis: 'gis_geometry', acres: 1.15, source: 'County GIS geometry', disputed: true },
      ],
      disputed: true,
      tylerDecisionRequired: true,
    };
    const workspace = buildLeadWorkspace({
      deal: { id: 19, title: 'Conflicted acreage lead' },
      report: {
        parcelVerified: true, parcelVerificationStatus: 'verified (county records)',
        reconciliation: { acreage: { primary: '1.15 ac', primarySource: 'Provider verification', conflict: false, status: 'reconciled' } },
        dataGaps: [], riskFlags: [], sourceTable: [],
      },
      acquisition: {}, nextAction: { label: 'Resolve acreage' },
      operatorRecord: { identity: { acreageBasis: canonicalBasis }, researchCompleteness: {}, tylerDecisions: ['Confirm acreage basis'] },
      canonical: { unifiedReadiness: {}, strategyReadiness: {} },
      compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
    });
    expect(workspace.property.canonicalAcreage).toEqual(canonicalBasis);
  });

  it('tolerates partial legacy data: legacy reconciliation appears only when no canonical basis exists', () => {
    const legacy = { acreage: { primary: '2.0 ac', conflict: false, status: 'reconciled' } };
    const workspace = buildLeadWorkspace({
      deal: { id: 7, title: 'Legacy-only lead' },
      report: { parcelVerified: false, reconciliation: legacy, dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
    });
    expect(workspace.property.canonicalAcreage).toEqual(legacy);
  });

  // Regression: resolution-state-label-not-run-after-attempt (QA finding F4).
  // A recorded resolution attempt that honestly stayed unresolved must surface
  // its recorded state and provenance — never "Not run".
  it('surfaces recorded resolution provenance instead of the stale report label', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 20, title: 'Unresolved lead with recorded attempt' },
      report: { parcelVerified: false, parcelVerificationStatus: 'Not run', dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
      resolution: {
        state: 'unresolved', confidence: 0.3,
        basis: 'Parcel not yet confirmed - only a geocoded location is known.',
        matchedReason: 'geocode-only', missing: ['apn'], smallestNextIdentifier: 'APN',
        capturedAt: '2026-07-15T00:00:00.000Z',
      },
    });
    expect(workspace.property.resolutionState).toBe('unresolved');
    const resolution = workspace.property.resolution as Record<string, unknown>;
    expect(resolution.attempted).toBe(true);
    expect(resolution.basis).toContain('geocoded location');
    expect(resolution.confidence).toBe(0.3);
  });

  it('reports not_run honestly when no resolution attempt was ever recorded', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 8, title: 'Never-resolved lead' },
      report: { parcelVerified: false, parcelVerificationStatus: 'Not run', dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
      resolution: null,
    });
    expect(workspace.property.resolutionState).toBe('Not run');
    expect((workspace.property.resolution as Record<string, unknown>).attempted).toBe(false);
  });

  // A genuine requested-vs-resolved APN conflict is a hard stop: both
  // identifiers and the block reason must surface as a blocker.
  it('discloses a recorded APN identity conflict as a blocker with both identifiers', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 30, title: 'Conflicted identity lead' },
      report: { parcelVerified: false, parcelVerificationStatus: 'Unresolved', dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
      resolution: {
        state: 'unresolved', confidence: 0.2, basis: 'Requested parcel differs from resolved parcel.',
        identityConflict: { requestedApn: '1234-56-78-9012', resolvedApn: '9999-00-11-2222', source: 'county records' },
        capturedAt: '2026-07-15T00:00:00.000Z',
      },
    });
    const conflictBlocker = (workspace.work.blockers as string[]).find((b) => b.includes('Parcel identity conflict'));
    expect(conflictBlocker).toBeDefined();
    expect(conflictBlocker).toContain('1234-56-78-9012');
    expect(conflictBlocker).toContain('9999-00-11-2222');
    const resolution = workspace.property.resolution as Record<string, unknown>;
    expect(resolution.identityConflict).toMatchObject({ requestedApn: '1234-56-78-9012', resolvedApn: '9999-00-11-2222' });
  });
});

// Regression: stale-resolution-provenance-contradicts-verified-chip (W2-F3).
// A pre-verification snapshot is history: it must never contradict the
// verified provenance, and a verified lead without a snapshot must present
// its verification status, never "no attempt recorded".
describe('verified-lead resolution provenance', () => {
  it('marks a pre-verification snapshot as historical and states the verified provenance', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 19, title: 'Verified lead with old candidate snapshot' },
      report: { parcelVerified: true, parcelVerificationStatus: 'Parcel verified (county records)', dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
      resolution: { state: 'candidate', confidence: 0.7, basis: 'Parcel not yet confirmed - geocode only.', capturedAt: '2026-07-14T00:00:00.000Z' },
    });
    const resolution = workspace.property.resolution as Record<string, unknown>;
    expect(resolution.state).toBe('confirmed');
    expect(resolution.historical).toBe(true);
    expect(resolution.verifiedStatus).toBe('Parcel verified (county records)');
    expect(workspace.property.resolutionState).toBe('Parcel verified (county records)');
  });

  it('a verified lead with no snapshot presents the verification status, not a contradiction', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 23, title: 'Verified lead, no snapshot' },
      report: { parcelVerified: true, parcelVerificationStatus: 'Parcel verified (official layer)', dataGaps: [], riskFlags: [], sourceTable: [] },
      acquisition: {}, nextAction: {},
      operatorRecord: { identity: {} },
      canonical: {}, compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
      resolution: null,
    });
    const resolution = workspace.property.resolution as Record<string, unknown>;
    expect(resolution.attempted).toBe(false);
    expect(resolution.state).toBe('confirmed');
    expect(resolution.verifiedStatus).toBe('Parcel verified (official layer)');
    expect(resolution.historical).toBe(false);
  });
});
