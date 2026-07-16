import { describe, expect, it } from 'vitest';
import { buildLeadWorkspace } from './lead-workspace.js';

describe('Lead Workspace read model', () => {
  it('adapts canonical services without independently calculating their states', () => {
    const workspace = buildLeadWorkspace({
      deal: { id: 9, title: 'Unresolved lead' }, report: { parcelVerified: false, parcelVerificationStatus: 'Unresolved', dataGaps: ['APN needed'], riskFlags: [], sourceTable: [] },
      acquisition: { profile: {}, communications: [], discovery: [] }, nextAction: { label: 'Resolve identity' },
      operatorRecord: { researchCompleteness: { complete: false }, tylerDecisions: ['Confirm acreage'] },
      canonical: { unifiedReadiness: { offer: { state: 'researching' } }, strategyReadiness: { strategies: [{ strategy: 'Quick Flip', status: 'blocked' }], pricingBlockers: ['Parcel identity is not confirmed.'] } },
      compRegistry: {}, documents: {}, mission: {}, activity: [], marketPulse: null, marketMatrix: null,
    });
    expect(workspace.contract.version).toBe('1.0');
    expect(workspace.property.resolutionState).toBe('Unresolved');
    expect(workspace.strategies.entries).toEqual([{ strategy: 'Quick Flip', status: 'blocked' }]);
    expect(workspace.work.blockers).toContain('Confirm acreage');
    expect(workspace.departmentOutputs[1].dependencies).toContain('WS1 acreage basis');
  });
});
