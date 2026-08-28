// The control system Deal 90 exposed: Re-run Research must know the difference
// between "the workflow ran" and "the required output was established", must
// reuse what is already satisfied, and must only attempt what a registered
// capability can actually close.

import { describe, expect, it } from 'vitest';
import {
  coverageStateFor,
  planResearchCoverage,
  runResearchCoverageCycle,
  specialistEvidenceRequirements,
} from './research-coverage-cycle.js';
import type {
  ResearchReadinessManifest,
  ResearchReadinessManifestItem,
  ResearchReadinessStatus,
} from './research-readiness.js';

function item(
  id: string,
  status: ResearchReadinessStatus,
  overrides: Partial<ResearchReadinessManifestItem> = {},
): ResearchReadinessManifestItem {
  return {
    id,
    label: id,
    group: 'property',
    question: `What about ${id}?`,
    status,
    statusLabel: status,
    owner: { kind: 'capability', capabilityId: `${id}-capability`, label: `${id} owner` },
    machineBackfillAllowed: true,
    attempted: true,
    technicalSuccess: true,
    usableEvidence: status === 'green',
    partial: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    reason: `${id} reason`,
    nextAction: null,
    blocksIntelligence: false,
    knowledgePlan: null,
    ...overrides,
  };
}

function manifestOf(items: ResearchReadinessManifestItem[]): ResearchReadinessManifest {
  return {
    contractVersion: 'research-readiness-manifest-v1',
    dealCardId: 90,
    propertyCardId: 7,
    generatedAt: '2026-08-28T00:00:00.000Z',
    items,
    counts: { total: items.length, ready: 0, needsMachineAttention: 0, unresolved: 0, stale: 0, expectedUnknown: 0 },
    headline: 'test',
    groups: {} as ResearchReadinessManifest['groups'],
    backfillCandidates: [],
    operatorCompleteness: {
      returned: 0, denominator: items.length, partial: 0, unresolved: 0, blocked: 0, notRequired: 0,
      headline: 'test', items: [],
    },
  };
}

describe('research coverage states', () => {
  it('separates evidence LandOS already held from work this cycle did', () => {
    const green = item('landportal_research', 'green');
    expect(coverageStateFor(green, false)).toBe('REUSED');
    expect(coverageStateFor(green, true)).toBe('RETURNED');
  });

  it('calls a lane that executed without establishing its output PARTIAL, not complete', () => {
    // The Deal 90 zoning case: the LDR PDF was found, the district was not.
    expect(coverageStateFor(item('current_zoning', 'yellow'))).toBe('PARTIAL');
  });

  it('distinguishes a lane nobody attempted from one that was refused', () => {
    expect(coverageStateFor(item('public_water', 'red', { attempted: false }))).toBe('NOT_RUN');
    expect(coverageStateFor(item('public_water', 'red', { attempted: true }))).toBe('BLOCKED');
  });
});

describe('planned delta', () => {
  it('reuses what is satisfied and attempts only the machine-owned gaps', () => {
    const plan = planResearchCoverage(manifestOf([
      item('property_resolution', 'green'),
      item('landportal_research', 'green'),
      item('current_zoning', 'yellow'),
      item('public_water', 'red', { attempted: false }),
      item('market_statistics', 'red', {
        group: 'market',
        machineBackfillAllowed: false,
        owner: { kind: 'operator_surface', capabilityId: null, label: 'Market Research' },
      }),
      item('seller_information', 'gray', { group: 'seller' }),
    ]));

    expect(plan.reuseItemIds).toEqual(['property_resolution', 'landportal_research']);
    expect(plan.runItemIds).toEqual(['current_zoning', 'public_water']);
    // Nothing registered owns it, so it is reported honestly rather than faked.
    expect(plan.entries.find((entry) => entry.id === 'market_statistics')?.action).toBe('blocked');
    expect(plan.entries.find((entry) => entry.id === 'seller_information')?.action).toBe('not_applicable');
    expect(plan.headline).toContain('2 reused');
  });

  it('never implies a full research package completed when lanes never ran', () => {
    const plan = planResearchCoverage(manifestOf([
      item('a', 'green'), item('b', 'red', { attempted: false }), item('c', 'red', { attempted: false }),
    ]));
    expect(plan.headline).toBe('1 reused · 2 not run');
  });
});

describe('specialist evidence requirements', () => {
  it('names the requesting layer, its reason, and whether it is a hard blocker', () => {
    const manifest = manifestOf([
      item('current_zoning', 'yellow', { blocksIntelligence: true, nextAction: 'Read the Lake Butler LDR district table.' }),
      item('property_development_history', 'red', { attempted: false }),
      item('landportal_research', 'green'),
    ]);
    const requirements = specialistEvidenceRequirements(planResearchCoverage(manifest), manifest);

    expect(requirements.map((req) => req.itemId)).toEqual(['current_zoning', 'property_development_history']);
    const zoning = requirements[0];
    expect(zoning.requestedBy).toBe('property');
    expect(zoning.priority).toBe('hard_blocker');
    expect(zoning.status).toBe('PARTIAL');
    // The answer MiniMax later needs to "why don't we have zoning?".
    expect(zoning.nextRetrievalAction).toBe('Read the Lake Butler LDR district table.');
    expect(requirements[1].priority).toBe('confidence');
  });
});

describe('the cycle', () => {
  const entity = 'land' as never;

  it('attempts the gaps, cascades to the specialists, and reports honest coverage', async () => {
    const before = manifestOf([
      item('landportal_research', 'green'),
      item('current_zoning', 'red', { attempted: false }),
    ]);
    const after = manifestOf([
      item('landportal_research', 'green'),
      item('current_zoning', 'green'),
    ]);
    let reconciles = 0;
    const backfilled: string[] = [];
    const cascaded: number[] = [];

    const result = await runResearchCoverageCycle({ dealCardId: 90, entity }, {
      reconcile: () => (reconciles++ === 0 ? before : after),
      backfill: async (_id, _entity, itemIds) => { backfilled.push(...itemIds); return after; },
      cascade: async (id) => {
        cascaded.push(id);
        return { outcome: 'produced', reason: null, refreshedLayers: ['property', 'market', 'deal'], reusedLayers: [] };
      },
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(backfilled).toEqual(['current_zoning']);
    expect(cascaded).toEqual([90]);
    expect(result.cascade?.refreshed).toEqual(['property', 'market', 'deal']);
    // Re-run, so it is RETURNED; the untouched lane stays REUSED.
    expect(result.after?.entries.find((entry) => entry.id === 'current_zoning')?.state).toBe('RETURNED');
    expect(result.after?.entries.find((entry) => entry.id === 'landportal_research')?.state).toBe('REUSED');
    expect(result.requirements).toHaveLength(0);
  });

  it('does not re-run what is already satisfied', async () => {
    const satisfied = manifestOf([item('landportal_research', 'green'), item('assessor_tax', 'green')]);
    let backfillCalls = 0;
    const result = await runResearchCoverageCycle({ dealCardId: 90, entity }, {
      reconcile: () => satisfied,
      backfill: async () => { backfillCalls++; return satisfied; },
      cascade: async () => ({ outcome: 'reused', reason: null, refreshedLayers: [], reusedLayers: ['property'] }),
    });
    expect(backfillCalls).toBe(0);
    expect('error' in result ? null : result.attemptedItemIds).toEqual([]);
  });

  it('keeps the cycle bounded and honest when retrieval fails', async () => {
    const stuck = manifestOf([item('public_water', 'red', { attempted: true })]);
    const result = await runResearchCoverageCycle({ dealCardId: 90, entity }, {
      reconcile: () => stuck,
      backfill: async () => { throw new Error('utility screen transport refused'); },
      cascade: async () => ({ outcome: 'produced', reason: null, refreshedLayers: ['property'], reusedLayers: [] }),
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.warnings.join(' ')).toContain('utility screen transport refused');
    // Still BLOCKED with the real reason, and the specialists still ran.
    expect(result.after?.entries[0].state).toBe('BLOCKED');
    expect(result.cascade?.refreshed).toEqual(['property']);
  });
});
