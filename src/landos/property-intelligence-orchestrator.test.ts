import { describe, expect, it } from 'vitest';
import { buildCompRegistry } from './comp-registry.js';
import {
  PUBLIC_INTELLIGENCE_TASKS,
  type PublicIntelligenceAdapter,
} from './public-property-intelligence.js';
import { runPropertyIntelligenceOrchestrator } from './property-intelligence-orchestrator.js';
import {
  PUBLIC_INTELLIGENCE_FIXTURE_EVIDENCE,
  PUBLIC_INTELLIGENCE_FIXTURE_FINDINGS,
  PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
} from './fixtures/public-intelligence-contract.fixture.js';

const adapters = (): PublicIntelligenceAdapter[] => PUBLIC_INTELLIGENCE_TASKS.map((task) => ({
  task,
  adapterId: `fixture_${task}`,
  async run() {
    return {
      status: 'succeeded' as const,
      finding: PUBLIC_INTELLIGENCE_FIXTURE_FINDINGS[task],
      evidence: PUBLIC_INTELLIGENCE_FIXTURE_EVIDENCE[task],
      confidence: 'high' as const,
      retryEligible: false,
    };
  },
}));

const subjectMarket = { state: 'TN', county: 'Example County', acres: 10 };
const seedRegistry = buildCompRegistry(subjectMarket, [1, 2, 3].map((row) => ({
  provider: row === 1 ? 'Realie' : 'County recorded sales',
  lane: 'sold' as const,
  addressDesc: `${row} Fixture Comp Rd, Example, TN`,
  state: 'TN', price: 90_000 + row * 10_000, priceKind: 'sold',
  saleOrListDate: `2026-0${row}-01`, acres: 9 + row / 2,
  sourceUrl: `https://example.test/comp/${row}`,
})));

describe('canonical Property Intelligence orchestrator', () => {
  it('joins public stages with the retained canonical comp registry and reconciliation audit', async () => {
    const run = await runPropertyIntelligenceOrchestrator({
      subject: PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      adapters: adapters(),
      compJobs: [],
      captureMode: 'fixture',
      subjectMarket,
      seedRegistry,
    });

    expect(run.status).toBe('complete');
    expect(run.validation).toEqual({ valid: true, violations: [] });
    expect(run.registry?.counts.validatedSold).toBe(3);
    expect(run.compReconciliation).toMatchObject({ valuationBlockers: [] });
    expect(run.stages.find((stage) => stage.stageId === 'marketplace_comps')).toMatchObject({ completionState: 'complete' });
    expect(run.stages.find((stage) => stage.stageId === 'valuation_synthesis')).toMatchObject({ completionState: 'complete' });
    expect(run.stages.filter((stage) => stage.role === 'required').every((stage) => stage.completionState === 'complete')).toBe(true);
  });

  it('stops before providers and valuation when parcel identity is blocked', async () => {
    const run = await runPropertyIntelligenceOrchestrator({
      subject: { ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, resolutionStatus: 'conflicted' },
      adapters: adapters(),
      compJobs: [],
      captureMode: 'fixture',
      subjectMarket,
      seedRegistry,
    });
    expect(run.status).toBe('blocked_identity');
    expect(run.downstreamAllowed).toBe(false);
    expect(run.compRuns).toEqual([]);
    expect(run.registry).toBeNull();
    expect(run.propertyIntelligence?.tasks.every((task) => task.status === 'skipped_identity_gate')).toBe(true);
  });

  it('retains already-returned report outcomes as context when identity blocks downstream work', async () => {
    const retainedCompRuns = [
      { provider: 'Realie', status: 'succeeded' as const, result: null, elapsedMs: 12, candidates: [], note: 'Retained report result.' },
      { provider: 'Redfin', status: 'timeout' as const, result: null, elapsedMs: 30_000, candidates: [], note: 'Retained timeout.' },
      { provider: 'LandPortal visible', status: 'blocked' as const, result: null, elapsedMs: 5, candidates: [], note: 'Retained free-surface blocker.' },
    ];
    const run = await runPropertyIntelligenceOrchestrator({
      subject: { ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, resolvedApn: undefined, resolutionStatus: 'provisional' },
      adapters: adapters(),
      compJobs: [],
      retainedCompRuns,
      captureMode: 'fixture',
      subjectMarket,
      seedRegistry,
    });

    expect(run.status).toBe('blocked_identity');
    expect(run.downstreamAllowed).toBe(false);
    expect(run.compRuns).toEqual(retainedCompRuns);
    expect(run.registry?.counts.validatedSold).toBe(3);
    expect(run.stages.find((stage) => stage.stageId === 'marketplace_comps')?.providerOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'Redfin', status: 'timeout' }),
      expect.objectContaining({ providerId: 'LandPortal visible', status: 'blocked' }),
    ]));
    expect(run.stages.find((stage) => stage.stageId === 'valuation_synthesis')).toMatchObject({ completionState: 'blocked' });
    expect(run.compReconciliation?.valuationBlockers).toContain('Parcel identity must be confirmed before valuation synthesis.');
  });

  it('retains prior provider outcomes beside the seeded registry without dropping canonical candidates', async () => {
    const retainedCompRuns = [
      { provider: 'Realie', status: 'succeeded' as const, result: null, elapsedMs: 0, candidates: [], note: 'Retained report result.' },
      { provider: 'Zillow', status: 'no_result' as const, result: null, elapsedMs: 0, candidates: [], note: 'Retained no-result.' },
      { provider: 'Redfin', status: 'timeout' as const, result: null, elapsedMs: 0, candidates: [], note: 'Retained timeout.' },
      { provider: 'LandPortal visible', status: 'blocked' as const, result: null, elapsedMs: 0, candidates: [], note: 'Retained free-surface blocker.' },
    ];
    const run = await runPropertyIntelligenceOrchestrator({
      subject: PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      adapters: adapters(),
      compJobs: [],
      retainedCompRuns,
      captureMode: 'fixture',
      subjectMarket,
      seedRegistry,
    });

    expect(run.compRuns).toEqual(retainedCompRuns);
    expect(run.registry?.counts.validatedSold).toBe(3);
    expect(run.stages.find((stage) => stage.stageId === 'marketplace_comps')?.providerOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'Zillow', status: 'no_result' }),
      expect.objectContaining({ providerId: 'Redfin', status: 'timeout' }),
      expect.objectContaining({ providerId: 'LandPortal visible', status: 'blocked' }),
    ]));
    expect(run.status).toBe('complete');
    expect(run.validation.valid).toBe(true);
  });
});
